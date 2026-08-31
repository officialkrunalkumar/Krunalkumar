/* ==========================================================================
   osint-self-check.js — what a stranger can learn from the things you post.
   --------------------------------------------------------------------------
   This is the only tool in Labs whose subject is a person, so the rule it is
   built around is narrower than the usual "nothing is uploaded": it analyses
   ONLY what the visitor pastes about themselves, it never looks anyone up, and
   it makes no network request of any kind. There is no fetch, no XHR, no image
   loaded from a remote host, no username probed against a site. Everything
   below is string matching and arithmetic in this tab.

   That restraint is the point rather than a limitation. A tool that took a
   username and went and found the accounts would be a stalking tool with a
   safety notice on it, and I am not shipping one. So the username panel shows
   you how enumeration works and hands you the checklist to run yourself, and
   every other panel reads text you already own.

   WHY REGEXES AND NOT A SCORE
   Each rule is a pattern plus two sentences: what it hands a stranger, and
   which account-recovery question or reset flow it helps answer. That mapping
   is the useful part — "your dog is called Simba" is not interesting until you
   notice it is the literal answer to a security question you set in 2014.
   There is deliberately no percentage: nothing here is calibrated against a
   measured population, and a number would be the part people remembered
   instead of the reasons.

   WHAT IT CANNOT DO, SAID OUT LOUD IN THE OUTPUT TOO
   It only knows the patterns written down here. Plenty of real disclosure is
   an ordinary sentence with no pattern in it at all — the name of the cafe you
   are always in, a photo of a hospital ceiling, the fact that you replied at
   3am. A clean result is not a clean bill of health, and the tool says so.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 25 * 1024 * 1024;
  var out = LabTool.out('tool-out');
  var COL = 62;               /* wrap width, chosen to fit the terminal pane */
  var lastFile = null;        /* also the token that guards the async decode */

  /* ------------------------------------------------------------------ *
   * The rule table.
   *
   * modes  — which panels the rule runs in, matched with indexOf.
   * sev    — high / med / low. Severity here means "how directly does this
   *          help someone take an account or find a door", not how private
   *          it feels.
   * what   — the finding, in plain words.
   * why    — what it hands a stranger.
   * opens  — the recovery question, reset flow or pretext it feeds. This is
   *          the column people actually learn from.
   *
   * No lookbehind anywhere: this file has to parse in older engines, and the
   * site ships ES5 under assets/js.
   * ------------------------------------------------------------------ */
  var RULES = [
    {
      modes: 'bio ooo cv', sev: 'high', what: 'An email address',
      re: /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,24}/gi,
      why: 'An address is the username half of most of your logins, so publishing it hands over half of every credential pair at once.',
      opens: 'Password reset, credential stuffing against old breach data, and the first field of nearly every account-recovery form.'
    },
    {
      modes: 'bio ooo cv', sev: 'high', what: 'A phone number',
      re: /(?:\+\d{1,3}[ \-.]?)?\b\d{10}\b/g,
      why: 'A number that reads like a mobile. It is the second factor on many accounts and the identifier a SIM-swap attack needs.',
      opens: 'SMS one-time codes, "confirm the number on file" calls, and WhatsApp-based impersonation of you to your own contacts.'
    },
    {
      modes: 'bio ooo cv', sev: 'high', what: 'A phone number, spaced or hyphenated',
      re: /\b\d{5}[ \-]\d{5}\b|\b\d{3}[ \-]\d{3}[ \-]\d{4}\b/g,
      why: 'Splitting the digits up does not hide them from anything that reads text, including every scraper.',
      opens: 'SMS one-time codes and voice-call social engineering, same as an unspaced number.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A UPI handle',
      re: /\b[a-z0-9.\-_]{3,}@(?:ok(?:hdfcbank|icicibank|axis|sbi)|paytm|ybl|ibl|axl|upi|apl|abfspay|yapl)\b/gi,
      why: 'A UPI address names your bank, usually carries your legal name in the app that resolves it, and proves the account is live.',
      opens: 'The "I sent it by mistake, please refund" script and collect-request fraud. There is a walkthrough at /labs/upi-fraud.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A date or year of birth',
      re: /\b(?:b\.|born|dob|d\.o\.b\.?|birthday|date of birth)\b[^\n]{0,12}?((?:[0-3]?\d[\/\-. ][01]?\d[\/\-. ](?:19|20)\d\d)|(?:19|20)\d\d)/gi,
      why: 'Date of birth is treated as a secret by banks and telcos and as a public fact by everyone else. Both cannot be true.',
      opens: 'Telephone identity checks at a bank or mobile operator, and the age gate on most account-recovery flows.'
    },
    {
      modes: 'bio cv', sev: 'low', what: 'A bare four-digit year',
      re: /\b(?:19[5-9]\d|20[0-2]\d)\b/g,
      why: 'Could be a birth year, a graduation year or nothing at all. On its own it is weak; next to a school name it stops being weak.',
      opens: 'Narrowing your age to a single year, which is enough to sit alongside a name in an identity check.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A graduating class',
      re: /\bclass of\s*'?(?:19|20)?\d\d\b/gi,
      why: 'A graduation year plus a school name gives your age and your home town in one phrase.',
      opens: '"What school did you attend?" and age verification, together.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A school, college or university',
      /* No dot in the leading word class on purpose: with one, "Pune. Fergusson
         College" matched from "Pune", and a quote that starts mid-sentence
         reads like the tool found something it did not. */
      re: /\b[A-Z][A-Za-z&'\-]+(?:\s+[A-Z][A-Za-z&'\-]+){0,3}\s+(?:School|College|University|Vidyalaya|Vidyalay|Institute|Academy|Polytechnic|Gurukul)\b/g,
      why: 'The name of a school is one of the oldest security questions in use, and it is printed on half the profiles on the internet.',
      opens: '"Name of your first school" and "where did you go to college" — both still offered as recovery questions today.'
    },
    {
      modes: 'bio ooo cv', sev: 'med', what: 'An employer',
      /* Spelled with explicit [Ww] pairs rather than the /i flag: the capture
         needs [A-Z] to mean a capital letter, and /i would quietly turn it
         into "any letter" and swallow the rest of the sentence. */
      re: /\b(?:[Ww]orks? at|[Ww]orking (?:at|with)|[Ee]mployed at|[Cc]urrently at|[Jj]oined|[Ee]ngineer at|[Dd]eveloper at|[Aa]nalyst at|[Mm]anager at|[Cc]onsultant at|@)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,3})/g,
      why: 'Where you work decides which internal systems you can reach, which is the first thing a targeted attacker wants to know.',
      opens: 'A helpdesk pretext — a caller who already knows your employer, your team and your manager sounds like a colleague.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A previous employer',
      re: /\b(?:[Ee]x|[Ff]ormer|[Pp]reviously(?: at)?)[\s\-]+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,2})/g,
      why: 'A work history is a map of which alumni networks, old mailboxes and dormant accounts still exist in your name.',
      opens: 'Dormant corporate accounts, and a "former colleague" pretext that is hard to check.'
    },
    {
      modes: 'bio ooo cv', sev: 'med', what: 'A job title',
      re: /\b(?:software|senior|junior|lead|principal|chief)?\s?(?:engineer|developer|analyst|manager|consultant|designer|architect|scientist|intern|associate|director|officer|founder|accountant|nurse|doctor|teacher|professor|advocate|banker|recruiter)\b/gi,
      why: 'A title tells a caller what you are allowed to approve and which requests will not look strange coming to you.',
      opens: 'Invoice fraud and payroll diversion, which are aimed at whoever has the authority the title advertises.'
    },
    {
      modes: 'bio ooo cv', sev: 'med', what: 'A city or a place you are in',
      re: /\b(?:[Bb]ased in|[Ll]ives? in|[Ll]iving in|[Ff]rom|[Rr]elocated to|[Mm]oved to|[Nn]ow in|[Ss]hifted to)\s+([A-Z][a-z]+(?:[ \-][A-Z][a-z]+){0,2})/g,
      why: 'A city narrows you from a billion people to a few million, and it is the field every other clue gets combined with.',
      opens: '"Which city were you born in", "city of your first job", and the geographic challenge some banks use on the phone.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A street address',
      re: /\b\d{1,4}[\/\-]?[A-Za-z]?,?\s+(?:[A-Z][\w.]+,?\s+){0,3}(?:Road|Rd\.?|Street|St\.?|Lane|Ln\.?|Marg|Nagar|Colony|Society|Apartments?|Apts?\.?|Block|Sector|Cross|Avenue|Ave\.?|Chowk|Bhavan|Towers?)\b/g,
      why: 'This is the one that stops being a privacy problem and becomes a physical safety problem.',
      opens: 'Delivery-based scams, physical access, and identity checks that ask for the address on file.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A postal code',
      re: /\b(?:pin|pincode|pin code|postcode|zip)\s*[:\-]?\s*\d{5,6}\b/gi,
      why: 'A postcode is a small enough area that one more detail — a school run, a gym, a photo of a street — finishes the job.',
      opens: 'Address confirmation on the phone, and narrowing a search to a few streets.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A pet, by name',
      re: /\b(?:dog|cat|puppy|kitten|pup|labrador|beagle|retriever|pug|indie|parrot|rabbit)\b[^.\n]{0,20}?\bnamed?\s+([A-Z][a-z]+)/gi,
      why: 'A pet name is the single most reused password base and a stock security answer, in the same breath.',
      opens: '"What was the name of your first pet?" — still offered by banks, insurers and school portals.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A pet, unnamed',
      re: /\b(?:dog|cat) (?:mom|mum|dad|parent|lover)\b|\bmy (?:dog|cat|puppy|kitten)\b/gi,
      why: 'You have told a stranger the security answer exists and what kind of animal it is. The name is usually two posts away.',
      opens: '"What was the name of your first pet?", once they read the rest of your feed.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A family member, by name',
      re: /\b(?:[Ww]ife|[Hh]usband|[Ss]pouse|[Ss]on|[Dd]aughter|[Mm]other|[Ff]ather|[Mm]om|[Mm]um|[Dd]ad|[Bb]rother|[Ss]ister)[,\s]+(?:is\s+|to\s+|of\s+)?([A-Z][a-z]+)\b/g,
      why: 'A relative’s name is both a security answer and the person an impersonation scam will pretend to be.',
      opens: '"Mother’s maiden name", and the "hello mum, this is my new number" message that follows.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'Family, mentioned',
      re: /\b(?:my |our )(?:wife|husband|spouse|fianc[eé]e?|partner|kids?|children|son|daughter|in\-laws|parents)\b/gi,
      why: 'Family structure is what makes an emergency story believable, and it names other people who did not agree to be posted.',
      opens: 'The family-emergency pretext, and relationship-based security questions.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A maiden name',
      re: /\b(?:n[eé]e|maiden name)\s*[:\-]?\s*([A-Z][a-z]+)/gi,
      why: 'This is not like a security answer. It is the security answer, written out.',
      opens: '"Mother’s maiden name" — the oldest bank verification question there is.'
    },
    {
      modes: 'bio', sev: 'med', what: 'A routine',
      re: /\b(?:every|each)\s+(?:morning|evening|night|weekend|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      why: 'A repeated time is a repeated place. Posted often enough, it says when you are out and when the house is empty.',
      opens: 'Physical timing — burglary, following, or simply knowing when you will not answer the phone to verify something.'
    },
    {
      modes: 'bio', sev: 'med', what: 'An exercise or travel pattern',
      re: /\b(?:strava|parkrun|morning run|gym at|swim at|yoga at|cycling route|5\s?am|6\s?am|daily commute|local train|metro at)\b/gi,
      why: 'Fitness apps publish routes by default, and a route that starts at the same point every day starts at your front door.',
      opens: 'Home location by inference, without a single geotag being involved.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A vehicle',
      re: /\b(?:my|our) (?:new )?(?:car|bike|scooter|swift|creta|thar|nexon|activa|bullet|scorpio|innova|baleno|i20|jeep|honda|toyota|hyundai|maruti|royal enfield)\b/gi,
      why: 'A car model dates you, places you in an income band, and answers a security question that is still in wide use.',
      opens: '"What was the make of your first car?"'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A vehicle registration',
      re: /\b[A-Z]{2}[ \-]?\d{1,2}[ \-]?[A-Z]{1,3}[ \-]?\d{4}\b/g,
      why: 'A plate is a lookup key in databases you do not control, and it identifies the vehicle parked outside your home.',
      opens: 'Vehicle-based tracing, and fake challan or insurance-renewal scams that quote your own plate back at you.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A government identifier',
      re: /\b[A-Z]{5}\d{4}[A-Z]\b|\b\d{4}\s\d{4}\s\d{4}\b/g,
      why: 'This is shaped like a PAN or an Aadhaar number. It may be a coincidence — but if it is not, it does not belong anywhere public.',
      opens: 'Direct identity theft, loan applications in your name, and KYC fraud. Nothing about this is recoverable by changing a password.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A bank or payment provider',
      re: /\b(?:hdfc|icici|sbi|axis|kotak|yes bank|idfc|paytm|phonepe|google ?pay|gpay|salary account|ifsc)\b/gi,
      why: 'Naming your bank turns a generic phishing message into one that arrives with the right logo on it.',
      opens: 'Targeted bank phishing and the "your account is blocked" call, which works far better when the bank is right.'
    },
    {
      modes: 'bio cv', sev: 'high', what: 'A favourite something',
      re: /\bfavou?rite\s+([a-z]+(?:\s+[a-z]+)?)/gi,
      why: 'Read the sentence again as if it were a form field. That is what it is.',
      opens: 'Favourite-colour, favourite-teacher, favourite-food security questions, verbatim.'
    },
    {
      modes: 'bio', sev: 'med', what: 'A team or fandom',
      re: /\b(?:rcb|csk|mumbai indians|manchester united|man utd|liverpool|barcelona|real madrid|arsenal|chelsea|tottenham|juventus)\b/gi,
      why: 'A sports allegiance is a security answer, a password base, and a very effective phishing hook around a fixture.',
      opens: '"Favourite sports team", and ticket or merchandise scams timed to a match.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A community or religious detail',
      re: /\b(?:gotra|caste|community|brahmin|jain|sikh|hindu|muslim|christian|parsi|rashi|nakshatra|manglik)\b/gi,
      why: 'A sensitive attribute in most jurisdictions, and the sorting key matrimonial fraud runs on.',
      opens: 'Targeted matrimonial and community-based fraud. There is a longer piece at /blog/what-a-marriage-biodata-leaks.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'A health detail',
      re: /\b(?:diabet\w*|asthma\w*|surgery|chemo\w*|therapy|medication|hospitali[sz]ed|blood group\s*[:\-]?\s*(?:a|b|ab|o)\s*[+\-])/gi,
      why: 'Health information is sensitive on its own and is also the most effective emotional lever in a scam call.',
      opens: 'Insurance and medical-bill fraud, and pretexts that are hard to refuse.'
    },
    {
      modes: 'bio cv', sev: 'med', what: 'Another platform, named',
      re: /\b(?:instagram|insta|telegram|snapchat|discord|reddit|github|gitlab|linkedin|steam|strava|spotify|pinterest|tumblr)\b/gi,
      why: 'Each named platform is another profile to read, and each profile carries a different slice of the same life.',
      opens: 'Cross-platform correlation — the thing this whole page exists to demonstrate.'
    },
    {
      modes: 'bio cv', sev: 'low', what: 'A link',
      re: /\bhttps?:\/\/[^\s<>"']+/gi,
      why: 'A personal site carries a domain registration, a hosting provider, a footer and often an address in the terms page.',
      opens: 'WHOIS and certificate history, which are public records with your name on them.'
    },

    /* --- out-of-office only ------------------------------------------- */
    {
      modes: 'ooo', sev: 'high', what: 'A return date',
      re: /\b(?:back|returning|return|until|till|through|away until)\b[^\n]{0,10}?(?:(?:on\s+)?(?:[0-3]?\d(?:st|nd|rd|th)?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,4}|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi,
      why: 'An auto-reply answers anybody, including a scraper, so this is a published window during which you are not reading email.',
      opens: 'Business email compromise — a payment request timed for a week when you cannot be asked "did you really send this?".'
    },
    {
      modes: 'ooo', sev: 'high', what: 'A colleague named as cover',
      re: /\b(?:contact|reach out to|please email|escalate to|in my absence|covering for me|speak to|write to)\b[^\n]{0,60}/gi,
      why: 'You have named a second person, often with their address and their place in the hierarchy, to anyone who emails you.',
      opens: 'A pretext aimed at them: "your colleague is away and asked me to sort this out with you."'
    },
    {
      modes: 'ooo', sev: 'med', what: 'A reason for the absence',
      re: /\b(?:annual leave|on leave|vacation|holiday|maternity|paternity|honeymoon|wedding|medical leave|sick leave|surgery|abroad|out of the country|travel(?:ling)? to|conference in)\b/gi,
      why: 'The reason is never needed and often personal — a honeymoon says the house is empty and says who else is away.',
      opens: 'Physical timing, and an emotional hook for whoever is left covering.'
    },
    {
      modes: 'ooo', sev: 'med', what: 'A promise of slow verification',
      re: /\b(?:limited access to email|no access to email|checking email infrequently|intermittent|poor connectivity|not be checking)\b/gi,
      why: 'This tells the reader that a request will not be double-checked quickly. That is precisely the condition fraud waits for.',
      opens: 'Any request that relies on you not phoning to confirm it.'
    },

    /* --- CV only ------------------------------------------------------- */
    {
      modes: 'cv', sev: 'high', what: 'An employee or payroll identifier',
      re: /\b(?:emp(?:loyee)?\.?\s?(?:id|code|no\.?|number)|payroll (?:id|no\.?)|staff id)\s*[:\-]?\s*([A-Za-z0-9\-]{3,14})\b/gi,
      why: 'An internal identifier is the detail that makes a caller sound like they are already inside the company.',
      opens: 'Helpdesk password resets, which frequently verify with exactly this number.'
    },
    {
      modes: 'cv', sev: 'med', what: 'An internal system or vendor',
      re: /\b(?:sap|oracle ebs|salesforce|servicenow|active directory|okta|jira|confluence|citrix|fortinet|palo alto|sonicwall|checkpoint|crowdstrike|splunk|qradar|vmware|sccm|tally)\b/gi,
      why: 'A CV that lists the stack you administer is a shopping list for whoever wants into it.',
      opens: 'Targeted phishing that names the right product, and vulnerability research aimed at your employer.'
    },
    {
      modes: 'cv', sev: 'low', what: 'A software version',
      re: /\b(?:v(?:ersion)?\.?\s?)?\d+\.\d+(?:\.\d+)?\b/g,
      why: 'A version number on a CV tells a stranger which published vulnerabilities are worth reading about.',
      opens: 'Reconnaissance against your employer, dated to the year you wrote the CV.'
    },
    {
      modes: 'cv', sev: 'med', what: 'Pay or package',
      re: /\b(?:ctc|lpa|salary|current package|expected package|drawing)\b[^\n.]{0,24}/gi,
      why: 'Compensation on a public CV is a filter that fraud uses to pick targets, and it weakens your position with real recruiters too.',
      opens: 'Advance-fee job scams, which are priced against what you say you earn.'
    },
    {
      modes: 'cv', sev: 'high', what: 'A reference, with contact details',
      re: /\b(?:references?|referee)s?\b[^\n]{0,60}/gi,
      why: 'A referee is a third party whose phone number you have published without their agreement, and who can be called about you.',
      opens: 'Pretext calls to your referee, and a second identity to impersonate on the way back to you.'
    },
    {
      modes: 'cv', sev: 'med', what: 'Marital or family status',
      re: /\b(?:marital status|married|unmarried|single|father’s name|father's name|mother’s name|mother's name|spouse’s name|spouse's name)\b/gi,
      why: 'Marital status and a parent’s name are a CV convention in some countries and a security answer everywhere.',
      opens: '"Mother’s maiden name" and family-based verification, straight off a document you emailed to strangers.'
    }
  ];

  /* ------------------------------------------------------------------ *
   * Output helpers
   * ------------------------------------------------------------------ */

  function clip(text, max) {
    var s = String(text).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  /* Word-wrap at COL with a fixed indent. The pane is pre-wrap, so long
     unbroken lines would wrap at an arbitrary column and lose the indent that
     ties a sentence to the finding above it. `hang` is the indent for the
     second and later lines, which is what keeps a wrapped bullet lined up
     under its own text instead of under the bullet mark. */
  function wrap(text, indent, cls, hang) {
    var words = String(text).split(/\s+/);
    var pad = indent;
    var line = '';
    var i;
    for (i = 0; i < words.length; i++) {
      if (line && (pad + line + ' ' + words[i]).length > COL) {
        out.line(pad + line, cls);
        pad = hang || indent;
        line = words[i];
      } else {
        line = line ? line + ' ' + words[i] : words[i];
      }
    }
    if (line) out.line(pad + line, cls);
  }

  function bullet(text, cls) {
    wrap('• ' + text, '  ', cls, '    ');
  }

  var SEV_TAG = { high: '[high]  ', med: '[medium]', low: '[low]   ' };
  var SEV_CLS = { high: 't-err', med: 't-warn', low: 't-info' };
  var SEV_ORDER = { high: 0, med: 1, low: 2 };

  function consentLine() {
    out.line('');
    out.rule();
    out.dim('Nothing here was uploaded and nothing was looked up. If the text');
    out.dim('above is about somebody else, that is not what this page is for.');
  }

  /* ------------------------------------------------------------------ *
   * The shared scanner
   * ------------------------------------------------------------------ */

  function scan(text, mode) {
    var findings = [];
    var seen = {};
    RULES.forEach(function (rule) {
      if (rule.modes.indexOf(mode) < 0) return;
      rule.re.lastIndex = 0;
      var hits = 0;
      var m;
      /* A rule that can match empty would spin forever on a global regex, and
         a rule that matches a hundred times would bury the report. Both are
         handled here rather than trusted to every pattern above. */
      while (hits < 3 && (m = rule.re.exec(text)) !== null) {
        if (m[0] === '') { rule.re.lastIndex++; continue; }
        var quote = clip(m[0], 300);
        var key = 'k:' + rule.what + '|' + quote.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        hits++;
        findings.push({
          sev: rule.sev, what: rule.what, quote: quote,
          why: rule.why, opens: rule.opens, at: m.index
        });
      }
    });
    findings.sort(function (a, b) {
      if (SEV_ORDER[a.sev] !== SEV_ORDER[b.sev]) return SEV_ORDER[a.sev] - SEV_ORDER[b.sev];
      return a.at - b.at;
    });
    return findings;
  }

  function renderFindings(findings, text) {
    var counts = { high: 0, med: 0, low: 0 };
    findings.forEach(function (f) { counts[f.sev]++; });

    out.row('characters read', String(text.length));
    out.row('findings', counts.high + ' high, ' + counts.med + ' medium, ' + counts.low + ' low');
    out.rule();

    if (!findings.length) {
      out.ok('Nothing here matched a pattern I wrote down.');
      out.line('');
      wrap('That is not the same as safe. This tool only knows the patterns in ' +
           'its own rule table, and the most revealing things people post are ' +
           'ordinary sentences with no pattern in them at all: the cafe you are ' +
           'always in, the ceiling of a hospital ward, the fact that you replied ' +
           'at three in the morning. Read it again yourself with the question ' +
           '"what could somebody do with this".', '', 't-dim');
      return;
    }

    findings.forEach(function (f) {
      out.line('');
      out.line(SEV_TAG[f.sev] + ' ' + f.what, SEV_CLS[f.sev]);
      out.line('         “' + clip(f.quote, 58) + '”', 't-out');
      wrap(f.why, '         ', 't-dim');
      wrap('opens: ' + f.opens, '         ', 't-dim');
    });

    /* The summary people remember. Findings repeat; the doors they open do
       not, so they are deduped and listed once. */
    var doors = [];
    var seenDoor = {};
    findings.forEach(function (f) {
      var key = 'd:' + f.opens;
      if (seenDoor[key]) return;
      seenDoor[key] = true;
      doors.push(f.opens);
    });
    out.line('');
    out.rule();
    out.heading('What this text helps somebody attempt');
    doors.forEach(function (d) {
      out.line('');
      bullet(d, 't-dim');
    });
  }

  /* ------------------------------------------------------------------ *
   * Panel: bio, caption or profile text
   * ------------------------------------------------------------------ */
  function reportBio(text) {
    out.clear();
    out.heading('Your bio, caption or profile text');
    renderFindings(scan(text, 'bio'), text);
    out.line('');
    out.rule();
    wrap('Nothing in a single line of this is a mistake on its own. The ' +
         'problem is arithmetic: a city plus a school plus a birth year plus a ' +
         'pet name is not four facts, it is one identity and most of a ' +
         'recovery flow.', '', 't-dim');
    consentLine();
  }

  /* ------------------------------------------------------------------ *
   * Panel: out-of-office
   * ------------------------------------------------------------------ */
  function reportOoo(text) {
    out.clear();
    out.heading('Your out-of-office reply');
    out.line('');
    wrap('An auto-reply is the only message you write that is sent to people ' +
         'you have never met, including everyone who mails the address to see ' +
         'whether it bounces. Treat it as published, because it is.', '', 't-dim');
    out.line('');
    renderFindings(scan(text, 'ooo'), text);

    out.line('');
    out.rule();
    out.heading('A version that gives nothing away');
    out.line('');
    out.line('  Thank you for your message. I am away from email and will', 't-out');
    out.line('  reply when I am back.', 't-out');
    out.line('', 't-out');
    out.line('  For anything urgent, please write to the team address you', 't-out');
    out.line('  already have.', 't-out');
    out.line('');
    wrap('No date, no reason, no named colleague, no mobile number. Everyone ' +
         'who genuinely needs to reach the team already knows the team address, ' +
         'and everyone who does not is exactly who the detail was leaking to. ' +
         'If your organisation requires a return date, put it in the internal ' +
         'reply only — most mail systems can send a different message inside ' +
         'and outside the company.', '', 't-dim');
    consentLine();
  }

  /* ------------------------------------------------------------------ *
   * Panel: public CV
   * ------------------------------------------------------------------ */
  function reportCv(text) {
    out.clear();
    out.heading('Your public CV or resume');
    out.line('');
    wrap('A CV sent to one recruiter is a document. A CV on a job board, a ' +
         'personal site or a public drive link is a published record, indexed ' +
         'and copied, and it stays available long after the job search ends.',
         '', 't-dim');
    out.line('');
    renderFindings(scan(text, 'cv'), text);

    out.line('');
    out.rule();
    out.heading('Take these out of the public copy');
    [
      'Full date of birth, marital status, and a parent’s name. None of these belong on a CV and all three are verification answers.',
      'Home address. A city and a country is enough for any employer to judge whether you can take the job.',
      'Your personal mobile. Use one address you can retire, and let the phone number come after a real conversation.',
      'Photograph and signature. A scanned signature on a public document is worth more to a forger than to a recruiter.',
      'Referees and their numbers. Write that references are available, and give them only when someone has actually asked.',
      'Employee IDs, internal project code names, and exact product versions of the systems you run.',
      'Salary, current or expected. It has no upside in public and it prices you for a scam.'
    ].forEach(function (item) {
      out.line('');
      bullet(item, 't-dim');
    });
    consentLine();
  }

  /* ------------------------------------------------------------------ *
   * Panel: username
   *
   * No network calls, and none of the derivations below are ever requested.
   * They exist so you can see the list an enumeration tool would build, and
   * then go and check it yourself, deliberately, one account at a time.
   * ------------------------------------------------------------------ */

  var ACCOUNT_TYPES = [
    ['Social networks', 'the account you think of first, plus the two you abandoned'],
    ['Photo and video', 'old albums are usually more revealing than current ones'],
    ['Code hosting', 'commit emails and commit times are public even on a bare profile'],
    ['Forums and Q&A', 'years of posts, often written before you were careful'],
    ['Gaming and voice chat', 'friend lists, play times, and a real-name field nobody remembers filling in'],
    ['Marketplaces and classifieds', 'past listings carry photographs of the inside of your home'],
    ['Dating', 'the profile is written to be identifying, which is the whole problem'],
    ['Fitness and running', 'routes that start at your door, on by default in several apps'],
    ['Music and playlists', 'a public listening history is a routine in disguise'],
    ['Reviews and maps', 'restaurant and shop reviews draw a map of your week'],
    ['Crowdfunding and donations', 'a public donor name attached to a cause is a sensitive attribute'],
    ['Package and app registries', 'a published package carries an email address in its manifest'],
    ['Blogs and newsletters', 'archives outlive the platform they were written on'],
    ['Dead platforms', 'the account is gone; the archived copy of it is not'],
    ['Breach corpora', 'not an account — a record of the account existing, with a password beside it']
  ];

  function reportHandle(raw) {
    out.clear();
    /* Take one token, and cope with somebody pasting a whole profile URL by
       keeping the last path segment. String work only — nothing is requested
       and no URL is resolved; a URL() constructor would not fetch either, but
       hand-splitting keeps the "no network anything" claim obvious to read.

       The first version filtered out segments containing a dot to drop the
       host, which also dropped "priya.kulkarni" and left the visitor being told
       about a handle called "https:". So the host is removed by position — it
       is always the first segment — and the routing words that sit in front of
       a username on the big sites are removed by name. */
    var NOISE = { 'in': 1, 'u': 1, 'user': 1, 'users': 1, 'profile': 1, 'people': 1, 'p': 1, 'c': 1 };
    var first = String(raw).replace(/^\s+|\s+$/g, '').split(/\s+/)[0] || '';
    var handle = first.replace(/^@+/, '');
    if (/^https?:\/\//i.test(handle)) {
      var segs = handle.replace(/^https?:\/\//i, '').split(/[?#]/)[0].split('/');
      segs.shift();
      segs = segs.filter(function (p) {
        return p && !Object.prototype.hasOwnProperty.call(NOISE, p.toLowerCase());
      });
      if (segs.length) handle = segs[segs.length - 1];
      handle = handle.replace(/^@+/, '');
    }

    out.heading('Your handle');
    if (!handle) {
      out.warn('Type a username in the box on the left, then press Check.');
      return;
    }
    /* A bare domain survives the extraction above with a slash still in it,
       which is the one shape that is not a username at all. Say that, rather
       than solemnly analysing "example.com/" as if it were a handle. */
    if (handle.indexOf('/') >= 0 || handle.indexOf('.') === handle.length - 1) {
      out.warn('There is no username in that — it is a site address on its own.');
      out.line('');
      out.dim('Type just the handle, for example  priya_k92, or paste a link that');
      out.dim('goes to a profile rather than to a home page.');
      return;
    }
    out.row('handle', handle);
    out.row('length', handle.length + ' characters');

    var hasDigits = /\d/.test(handle);
    var hasSep = /[._\-]/.test(handle);
    var yearMatch = handle.match(/(19[5-9]\d|20[0-2]\d)/);
    var twoDigit = handle.match(/(\d{2})$/);
    var nameShape = /^[a-z]{3,}[._\-][a-z]{3,}$/i.test(handle);

    out.rule();
    out.heading('What the handle itself says');
    out.line('');
    if (nameShape) {
      wrap('• It reads as a first name and a last name. That is your legal ' +
           'name published on every site you use it on, whether or not the ' +
           'profile has a name field.', '  ', 't-warn');
      out.line('');
    }
    if (yearMatch) {
      wrap('• It contains ' + yearMatch[1] + '. If that is a birth year, the ' +
           'handle carries your age on every platform at once, and age is a ' +
           'verification field at banks and telcos.', '  ', 't-err');
      out.line('');
    } else if (twoDigit) {
      wrap('• It ends in ' + twoDigit[1] + '. Two trailing digits are most ' +
           'often a birth year, sometimes a house number. Either way it is a ' +
           'guessable fact rather than a random one.', '  ', 't-warn');
      out.line('');
    }
    if (handle.length >= 8 && !/^[a-z]+$/i.test(handle)) {
      wrap('• It is distinctive. That is good for remembering and bad for ' +
           'privacy: a distinctive string that appears on two sites is almost ' +
           'certainly the same person, and no proof beyond the match is needed ' +
           'for someone to act on it.', '  ', 't-warn');
      out.line('');
    } else {
      wrap('• It is short or plain, so a match elsewhere is weaker evidence. ' +
           'That is genuinely better for you, and it is the only good news on ' +
           'this panel.', '  ', 't-ok');
      out.line('');
    }
    if (hasSep || hasDigits) {
      wrap('• Separators and trailing digits do not create a new identity. ' +
           'Every tool that does this strips them and tries the base string too.',
           '  ', 't-dim');
      out.line('');
    }

    out.rule();
    out.heading('The variants a tool would derive');
    out.line('');
    wrap('None of these are requested by this page. This is the list, so you ' +
         'can see the shape of the problem.', '  ', 't-dim');
    out.line('');
    var base = handle.toLowerCase().replace(/[._\-]/g, '');
    var stripped = base.replace(/\d+$/, '');
    var variants = [handle.toLowerCase(), base, stripped,
                    stripped + '1', stripped + '01', stripped + '123',
                    'the' + stripped, 'real' + stripped, stripped + '.official',
                    stripped + '_', '_' + stripped + '_'];
    var seenV = {};
    variants.forEach(function (v) {
      if (!v || seenV['v:' + v]) return;
      seenV['v:' + v] = true;
      out.line('  ' + v, 't-out');
    });

    out.line('');
    out.rule();
    out.heading('How enumeration actually works');
    out.line('');
    [
      'Profile URLs are predictable. A tool holds a list of templates and asks for each one, then reads the status code: 200 means the name is taken, 404 means it is free. No login and no API key needed.',
      'Some sites answer more quietly — a 200 for everything, with the words "user not found" in the body. So the tool matches on the text instead. Both are just reading a public page.',
      'Sign-up forms leak the same fact from the other direction: "that username is already taken" is a yes.',
      'So do password reset forms that say "no account with that address" instead of the careful "if an account exists, we have sent an email".',
      'Archives hold the accounts that are gone. A deleted profile often survives as a snapshot with the text intact.',
      'The result is not proof. Common handles collide, and people are impersonated. A confident list of "your accounts" is a hypothesis somebody else is about to act on.'
    ].forEach(function (item) {
      bullet(item, 't-dim');
      out.line('');
    });

    out.rule();
    out.heading('Check these yourself, by hand');
    out.line('');
    wrap('This page performs none of the above, on you or on anyone. Work down ' +
         'the list in your own browser, searching for the variants printed ' +
         'above. What you find is yours to close, rename or clean up.',
         '  ', 't-dim');
    out.line('');
    ACCOUNT_TYPES.forEach(function (pair) {
      out.line('  [ ] ' + pair[0], 't-info');
      wrap(pair[1], '        ', 't-dim');
    });
    out.line('');
    wrap('One more, and it is the one worth doing first: search the handle in ' +
         'quotation marks, and search your email address the same way. Then ' +
         'check the address against a breach index — /labs/breach-check does ' +
         'that with k-anonymity, and unlike this page it does make a network ' +
         'request, deliberately, and says so.', '  ', 't-dim');
    consentLine();
  }

  /* ------------------------------------------------------------------ *
   * Panel: photo
   *
   * This deliberately does NOT decode EXIF. /labs/exif already does that
   * properly, and a second half-built parser here would be worse than a link.
   * What happens instead is a segment walk that answers one question — is
   * there metadata in this file at all — and then the checklist of things
   * metadata does not cover, which is where most photo disclosure lives.
   * ------------------------------------------------------------------ */

  function jpegSegments(bytes) {
    var found = [];
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    var offset = 2;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset < bytes.length - 4) {
      if (bytes[offset] !== 0xff) break;
      var marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break;
      var size = dv.getUint16(offset + 2, false);
      if (size < 2) break;
      /* The size is a claim the file makes about itself. A truncated download
         claimed a 472-byte colour profile inside a 200-byte file, and reporting
         it would be inventing a segment that is not there. */
      if (offset + 2 + size > bytes.length) break;
      var tagBytes = bytes.subarray(offset + 4, offset + 4 + 24);
      var tag = '';
      for (var i = 0; i < tagBytes.length; i++) {
        var c = tagBytes[i];
        tag += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' ';
      }
      if (marker === 0xe1 && tag.indexOf('Exif') === 0) {
        found.push(['EXIF', size, 'camera, timestamp, often GPS', 't-err']);
      } else if (marker === 0xe1 && tag.indexOf('http://ns.adobe.com') === 0) {
        found.push(['XMP', size, 'editing history, sometimes author and location', 't-warn']);
      } else if (marker === 0xed && tag.indexOf('Photoshop') === 0) {
        found.push(['IPTC', size, 'captions, credit, keywords added by an editor', 't-warn']);
      } else if (marker === 0xe2 && tag.indexOf('ICC_PROFILE') === 0) {
        found.push(['ICC profile', size, 'colour data — harmless, but it names the software that wrote the file', 't-dim']);
      } else if (marker === 0xfe) {
        found.push(['JPEG comment', size, 'free text, whatever wrote the file put there', 't-warn']);
      }
      offset += 2 + size;
    }
    return found;
  }

  function pngChunks(bytes) {
    var sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 16) return null;
    for (var s = 0; s < 8; s++) if (bytes[s] !== sig[s]) return null;
    var found = [];
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var offset = 8;
    while (offset + 8 <= bytes.length) {
      var len = dv.getUint32(offset, false);
      /* Same reasoning as the JPEG walk: a chunk that runs off the end of the
         file was never written, so it is not reported. 12 is the chunk's own
         overhead — length, type and CRC. */
      if (offset + 12 + len > bytes.length) break;
      var name = String.fromCharCode(bytes[offset + 4], bytes[offset + 5],
                                     bytes[offset + 6], bytes[offset + 7]);
      if (name === 'tEXt' || name === 'iTXt' || name === 'zTXt') {
        found.push(['PNG text chunk (' + name + ')', len, 'free text, often the tool that saved it', 't-warn']);
      } else if (name === 'eXIf') {
        found.push(['EXIF in PNG', len, 'the same camera block a JPEG carries', 't-err']);
      } else if (name === 'tIME') {
        found.push(['Last-modified time', len, 'when the file was last written', 't-dim']);
      }
      if (name === 'IEND') break;
      offset += 12 + len;
    }
    return found;
  }

  var PHOTO_CHECKS = [
    ['Reflections', 'Glasses, a window, a kettle, a car door, a phone screen, a spoon. Reflections have identified rooms, streets and the person holding the camera, and nobody ever checks them.'],
    ['What is on your screen', 'An open inbox, a client name in a tab title, a calendar with a home address in it. Screens behind you are legible at surprisingly low resolution.'],
    ['Paper on the desk', 'A bank letter, an envelope with an address window, a prescription, a boarding pass, a delivery label. Turn them over or move them out of frame.'],
    ['Barcodes and QR codes', 'A boarding pass barcode carries the booking reference, which is often enough to open the booking and read the rest of the itinerary. A parcel label carries the delivery address.'],
    ['House numbers and nameplates', 'A number on a gate, a nameplate, a society board, a letterbox. One number plus a neighbourhood is an address.'],
    ['Street furniture', 'A road sign, a bus stop name, a shop hoarding across the road, a distinctive tree. This is how photographs get located without a single coordinate.'],
    ['The view from the window', 'A skyline, a hill, a water tank, a mobile tower. Two landmarks and an angle put you on a specific floor of a specific building.'],
    ['Uniforms and ID badges', 'A school crest on a child’s uniform names the school and the neighbourhood. A work badge names the employer and often prints the employee number.'],
    ['Keys', 'A photograph of a key, held flat and in focus, is enough to cut a copy. Keys should never be in a picture at all.'],
    ['Vehicle plates', 'Yours and your neighbour’s. A plate is a lookup key in registers you do not control.'],
    ['Wifi and router labels', 'The sticker on a router carries the network name and the default password, and the network name is searchable in public wardriving databases.'],
    ['Laptop stickers and lanyards', 'A conference badge, a vendor sticker, a team logo. Together they say where you work and what you run.'],
    ['Medicine and hospital detail', 'A strip of tablets, a wristband, a discharge slip. Health information is sensitive and is the strongest emotional lever a caller can hold.'],
    ['Other people', 'Anyone else in frame did not choose to be posted, and children least of all. The same is true of the people behind you in a queue.'],
    ['The background you always have', 'The same tiles, the same curtain, the same corner of the same balcony. Across enough posts, a repeated background is a location even when no single photo shows one.']
  ];

  function reportPhoto(bytes, file, dims) {
    out.clear();
    out.heading('Photo you supplied');
    out.row('name', file.name);
    out.row('size', LabTool.humanBytes(bytes.length));
    out.row('type', file.type || 'unknown');
    if (dims) {
      out.row('pixels', dims.w + ' × ' + dims.h);
      if (dims.w >= 2400 || dims.h >= 2400) {
        wrap('Full camera resolution, so this is an original rather than ' +
             'something a platform has already resized. Originals carry the ' +
             'most — in metadata, and in how much of the background is legible.',
             '  ', 't-warn');
      } else {
        wrap('Smaller than a camera original, so it has been resized or ' +
             're-saved at least once. That drops some detail. It removes no ' +
             'reflections and no house numbers.', '  ', 't-dim');
      }
    }

    out.rule();
    out.heading('The filename');
    out.line('');
    var nameFacts = 0;
    var dateInName = file.name.match(/(?:19|20)\d{2}[-_]?[01]\d[-_]?[0-3]\d/);
    if (dateInName) {
      wrap('• It contains ' + dateInName[0] + ', which is a date. Camera and ' +
           'messaging apps name files this way, so the date survives even after ' +
           'metadata is stripped.', '  ', 't-warn');
      out.line('');
      nameFacts++;
    }
    if (/^(?:IMG|DSC|PXL|DSCN|P\d{7})/i.test(file.name)) {
      wrap('• The prefix is a camera or phone naming convention, which narrows ' +
           'the kind of device that took it.', '  ', 't-dim');
      out.line('');
      nameFacts++;
    }
    if (/whatsapp|screenshot|screen shot|snapchat|telegram/i.test(file.name)) {
      wrap('• The name says which app produced it. A screenshot in particular ' +
           'usually contains more than the photograph it is a screenshot of.',
           '  ', 't-warn');
      out.line('');
      nameFacts++;
    }
    if (/aadhaar|aadhar|pan[\s_\-]?card|passport|licen[cs]e|salary|payslip|offer[\s_\-]?letter|invoice|statement|kyc/i.test(file.name)) {
      wrap('• The name suggests this is a document rather than a photograph. ' +
           'Do not post it anywhere, and be careful where the copy on your ' +
           'phone is backed up to.', '  ', 't-err');
      out.line('');
      nameFacts++;
    }
    if (!nameFacts) {
      out.line('  Nothing obvious in the filename.', 't-ok');
      out.line('');
    }

    out.rule();
    out.heading('Metadata carried inside the file');
    out.line('');
    var segs = jpegSegments(bytes);
    var kind = 'JPEG';
    if (segs === null) { segs = pngChunks(bytes); kind = 'PNG'; }
    if (segs === null) {
      wrap('This is not a JPEG or a PNG, so the segment walk was skipped. Drop ' +
           'it into the EXIF viewer at /labs/exif, which reads anything the ' +
           'browser can decode.', '  ', 't-dim');
    } else if (!segs.length) {
      out.line('  No metadata segments found in this ' + kind + '.', 't-ok');
      out.line('');
      wrap('Either it never had any, or something removed it — most social ' +
           'networks strip metadata on upload, which is why a photo saved from ' +
           'a feed looks clean while the original on your phone does not.',
           '  ', 't-dim');
    } else {
      segs.forEach(function (seg) {
        out.line('  ' + seg[0] + '  (' + seg[1] + ' bytes)', 't-warn');
        wrap(seg[2], '        ', 't-dim');
      });
      out.line('');
      wrap('This is a segment walk, not a parser: it says the block is there, ' +
           'not what is in it. To read the tags — camera, serial number, the ' +
           'exact second, and the GPS coordinates if they are present — use the ' +
           'EXIF viewer at /labs/exif, which decodes them properly and hands ' +
           'you a stripped copy of the file.', '  ', 't-dim');
    }

    out.line('');
    out.rule();
    out.heading('Now the part metadata does not cover');
    out.line('');
    wrap('Stripping EXIF is the easy half and most people stop there. Everything ' +
         'below is in the pixels, survives every stripper, and is what actually ' +
         'locates people. Look at your photo again, once for each line.',
         '  ', 't-dim');
    out.line('');
    PHOTO_CHECKS.forEach(function (pair) {
      out.line('  [ ] ' + pair[0], 't-info');
      wrap(pair[1], '        ', 't-dim');
      out.line('');
    });
    consentLine();
  }

  /* Pixel dimensions only arrive once the browser has decoded the file, which
     it does asynchronously, so the whole report waits for that rather than
     having a size row turn up underneath a finished page. The decode is a blob
     URL — local bytes with a local address, no request leaves the tab.

     `token` guards against a second photo being dropped while the first is
     still decoding: without it, the slower of the two overwrites the report of
     the faster one, and the visitor reads the wrong file's findings. */
  function withDimensions(bytes, file, done) {
    var blob = new Blob([bytes], { type: file.type || 'image/jpeg' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    var token = file;
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (token !== lastFile) return;
      done({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      if (token !== lastFile) return;
      done(null);
    };
    img.src = url;
  }

  /* ------------------------------------------------------------------ *
   * Worked examples. All invented. The addresses use reserved documentation
   * domains and the numbers are not allocatable.
   * ------------------------------------------------------------------ */
  var SAMPLES = {
    bio: 'Priya | Senior QA engineer at Northwind Retail (ex-Halcyon Systems)\n' +
         'Based in Pune. Fergusson College, class of 2014. Born 1992.\n' +
         'Dog mom to a beagle named Coco. Wife to Arjun, two kids.\n' +
         'Favourite team RCB. Morning run every day at 6am, Strava in bio.\n' +
         'Bookings: priya.k.qa@example.com | 9876543210 | priya.k@ybl',
    handle: 'priya_k92',
    ooo: 'Subject: Out of Office: Priya Kulkarni\n\n' +
         'Thanks for your email. I am on annual leave and travelling to Bali, ' +
         'back on 14 March. I will have limited access to email while I am away.\n\n' +
         'For anything urgent, please contact Rohit Mehra, Finance Manager, ' +
         'rohit.mehra@example.com or 9812345670.\n\n' +
         'For payment approvals please escalate to Sunita Rao in Accounts.\n\n' +
         'Priya Kulkarni | Senior QA Engineer | Northwind Retail',
    cv: 'PRIYA KULKARNI\n' +
        '12/B, Sunrise Society, Baner Road, Pune. PIN: 411045\n' +
        'priya.k.qa@example.com | 9876543210 | Date of birth: 14/07/1992\n' +
        'Marital status: Married | Father’s name: Suresh Kulkarni\n\n' +
        'EXPERIENCE\n' +
        'Senior QA Engineer, Northwind Retail (2019 - present). Employee ID: NW-40217\n' +
        '  Owned test automation for the SAP and ServiceNow integration.\n' +
        '  Administered Jira 8.20 and Confluence 7.13 for a team of 40.\n' +
        'QA Engineer, Halcyon Systems (2014 - 2019)\n\n' +
        'EDUCATION\n' +
        'B.E. Computer Science, Fergusson College, class of 2014\n\n' +
        'Current CTC: 18 LPA. Expected: 26 LPA.\n' +
        'References: Rohit Mehra, Finance Manager, 9812345670'
  };

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  var MODES = {
    bio: {
      label: 'Bio, caption or profile text',
      hint: 'Paste the text of your own bio, a caption, or a dating or matrimonial profile.',
      placeholder: 'Paste your own bio, caption or profile text.\n\nThis is for text you wrote about yourself. Do not paste somebody else’s.'
    },
    handle: {
      label: 'Username or handle',
      hint: 'Type one handle. Nothing is looked up — you get the checklist to run yourself.',
      placeholder: 'One username, for example  priya_k92\n\nA profile URL works too; only the last part of the path is read.\n\nNothing is requested. No account is checked. This page has no network access to any site.'
    },
    ooo: {
      label: 'Out-of-office reply',
      hint: 'Paste the auto-reply you have switched on, exactly as it goes out.',
      placeholder: 'Paste your own out-of-office auto-reply.\n\nInclude the signature block if it goes out with it — that is usually where the phone number is.'
    },
    cv: {
      label: 'Public CV or resume text',
      hint: 'Paste the text of a CV you have published, or are about to publish.',
      placeholder: 'Paste the text of your own CV.\n\nSelect all in the PDF or document, copy, and paste it here. The file itself is not needed and is not read.'
    },
    photo: {
      label: 'A photo you posted',
      hint: 'Drop your own photo. Read locally; the tags themselves are read at /labs/exif.',
      placeholder: ''
    }
  };

  function currentMode() {
    var sel = document.getElementById('tool-mode');
    return (sel && sel.value) || 'bio';
  }

  /* out.clear() is what arms the shell's screen-reader announcer, and the
     announcer is deliberately silent until the visitor asks for something. The
     first call here happens at page load, where the pane is empty anyway and
     an announcement would talk over the heading, so the first pass writes its
     help text without clearing. */
  var opened = false;

  function applyMode() {
    var mode = currentMode();
    var spec = MODES[mode];
    var text = document.getElementById('tool-text');
    var drop = document.getElementById('tool-drop');
    var label = document.getElementById('tool-text-label');
    var paneLabel = document.getElementById('tool-pane-label');
    var sample = document.getElementById('tool-sample');
    var isPhoto = mode === 'photo';

    paneLabel.textContent = spec.label;
    label.textContent = spec.label;
    text.placeholder = spec.placeholder;
    text.hidden = isPhoto;
    drop.hidden = !isPhoto;
    /* No example to load for a photo: I am not shipping a stock picture and
       pretending it is yours. The button goes rather than sitting there dead. */
    sample.hidden = isPhoto;

    if (opened) out.clear();
    opened = true;
    out.dim(spec.hint);
    out.line('');
    out.dim('Nothing is uploaded. Nothing is looked up. No request of any kind');
    out.dim('is made, for you or for anybody else.');
  }

  /* Forty regexes over an unbounded paste is the one way this page can lock a
     tab up, and somebody pasting an entire exported profile archive is a
     realistic accident rather than an attack. Cut it, and say so, rather than
     silently reading part of it. */
  var MAX_TEXT = 120000;

  /* Every render path goes through here.
     run() is invoked bare from a click handler, so anything that escapes lands
     in the console where the visitor will never see it — and each report calls
     out.clear() first, which means a throw halfway down leaves the pane wiped
     and silent, with the tool looking broken and no message to search for.
     Whatever printed before the throw stays on screen and the message is
     appended under it, which also shows how far the read got. */
  function safely(fn) {
    try {
      fn();
    } catch (err) {
      out.rule();
      out.err('Something in that input stopped the read part way through.');
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
      out.dim('If you can tell me roughly what you pasted, I will fix it.');
    }
  }

  function run() {
    var mode = currentMode();
    if (mode === 'photo') {
      out.clear();
      out.warn('Drop one of your own photos on the left first.');
      return;
    }
    var text = document.getElementById('tool-text').value || '';
    if (!text.replace(/\s+/g, '')) {
      out.clear();
      out.warn('Paste something of your own on the left first.');
      out.line('');
      out.dim('There is a worked example on the toolbar if you would rather see');
      out.dim('what the output looks like before pasting anything real.');
      return;
    }
    var trimmed = text.length > MAX_TEXT;
    if (trimmed) text = text.slice(0, MAX_TEXT);
    safely(function () {
      if (mode === 'handle') { reportHandle(text); }
      else if (mode === 'ooo') { reportOoo(text); }
      else if (mode === 'cv') { reportCv(text); }
      else { reportBio(text); }
      if (trimmed) {
        out.line('');
        out.warn('That paste was longer than ' + MAX_TEXT + ' characters, so only');
        out.warn('the first ' + MAX_TEXT + ' were read. The work happens on your');
        out.warn('processor, in this tab, and I would rather cut it than freeze');
        out.warn('the page. Run the rest in a second pass.');
      }
    });
  }

  LabTool.define({
    id: 'osintselfcheck',
    run: run,
    onReady: function () {
      var sel = document.getElementById('tool-mode');
      var text = document.getElementById('tool-text');
      sel.addEventListener('change', applyMode);

      document.getElementById('tool-sample').addEventListener('click', function () {
        var mode = currentMode();
        if (!SAMPLES[mode]) return;
        text.value = SAMPLES[mode];
        run();
      });

      document.getElementById('tool-clear').addEventListener('click', function () {
        text.value = '';
        lastFile = null;
        var dropName = document.getElementById('tool-dropname');
        if (dropName) dropName.textContent = '';
        /* The file input keeps the last filename, and an <input type="file">
           fires no change event when you choose the same file twice. Without
           this, clearing and then picking the same photo again did nothing at
           all, which reads as a broken button. */
        var fileInput = document.getElementById('tool-file');
        if (fileInput) fileInput.value = '';
        applyMode();
        if (!text.hidden) text.focus();
      });

      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          lastFile = file;
          document.getElementById('tool-dropname').textContent = file.name;
          withDimensions(bytes, file, function (dims) {
            safely(function () { reportPhoto(bytes, file, dims); });
          });
        },
        onError: function (msg) { out.clear().err(msg); }
      });

      applyMode();
    }
  });
})();

/* ==========================================================================
   har.js — read a .har the way the person you emailed it to will.
   --------------------------------------------------------------------------
   A HAR is the browser's Network tab saved as JSON. Support desks ask for one
   constantly, and people attach it without looking, because "it's just the
   network log". It is not. Every request header went in, which means every
   Cookie and Authorization line. Every response header went in, which means
   every Set-Cookie. If the export included content, every response body went
   in too. A HAR from a logged-in session is a live credential file with a
   .har extension, and it travels by email, ticket attachment and Slack.

   So this tool leads with secrets, and the redaction download is the point of
   the exercise rather than a footnote: rotate what leaked if you can, and send
   the scrubbed copy if you cannot.

   Decisions a reader would question:

   - Findings are masked in the output (first few and last few characters,
     plus a length). The file is already on your disk, so printing the whole
     token buys nothing and makes a screenshot of this pane dangerous. Values
     found in password fields are never shown at all, only their length.

   - Credit-card detection requires Luhn AND a real brand prefix at the right
     length. Luhn alone cries wolf: IMEIs are Luhn-valid 15-digit numbers that
     start 35, and plenty of order ids pass by chance. Requiring, say, "15
     digits starting 34 or 37" for Amex kills nearly all of that.

   - Phone detection is deliberately narrow — E.164 with a leading +, or the
     classic North American shape. Anything looser turns every timestamp,
     version string and product code into a phone number.

   - Display scanning is capped (see the constants below) so a 64 MB HAR does
     not lock the tab; when a cap is hit the output says so. Redaction does not
     share those caps — it rewrites every body in full, because a redacted copy
     that skipped the last 30 MB would be worse than useless. Its only limit is
     a ceiling on how many strings the final sweep visits, which a 64 MB file
     cannot reach, and which is reported if it ever does.

   - Two encoding traps. Some Windows tooling writes HAR as UTF-16LE, which
     decodes to mojibake as UTF-8 and fails to parse; and a UTF-8 BOM makes
     JSON.parse throw on character 0. Both are detected from the first bytes.

   - Emails are found by indexing to each "@" and walking outwards, not with
     the textbook /[A-Za-z0-9._%+-]+@.../ pattern. That pattern backtracks
     quadratically on any long run of word characters that is not followed by
     an "@", which is what a minified JavaScript response body is: it took
     twelve seconds on a 5 MB capture, versus about 200 ms for the whole
     analysis now. Every other pattern here is anchored on a fixed prefix for
     the same reason.

   Nothing is uploaded. The file is read with FileReader, parsed here, and the
   redacted copy comes back as a blob download — which matters more than usual
   for this tool, since the input is by definition full of live secrets.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 64 * 1024 * 1024;

  /* ---- work caps, all reported in the output when they bite -------------- */
  var BODY_SCAN_LIMIT   = 256 * 1024;        // per response body, for display
  var BODY_BUDGET       = 8 * 1024 * 1024;   // total body bytes scanned
  var MATCH_LIMIT       = 30;                // matches per rule per field
  var MAX_FINDINGS      = 800;               // distinct secrets kept
  var MAX_PII           = 400;               // distinct values per PII class
  var SHOW_SECRETS      = 60;
  var SHOW_PII          = 25;
  var SHOW_HOSTS        = 40;
  var SHOW_HTML         = 12;
  var SHOW_ERRORS       = 25;
  var SHOW_SLOW         = 12;
  var SCRUB_NODE_LIMIT  = 4000000;           // strings visited during redaction

  var out = LabTool.out('tool-out');

  /* ---------------------------------------------------------------------- */
  /* Small helpers. Everything in a HAR is optional in practice — exporters  */
  /* disagree about which fields they write — so nothing is assumed present. */
  /* ---------------------------------------------------------------------- */
  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function isObj(v) { return v && typeof v === 'object'; }

  function clip(text, n) {
    var s = String(text == null ? '' : text);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function bump(map, key, by) {
    map[key] = (map[key] || 0) + (by === undefined ? 1 : by);
  }

  /* Shown instead of the raw value. Enough to recognise which key it is,
     not enough to use. */
  function mask(value) {
    var s = String(value);
    if (s.length <= 8) return '•'.repeat(s.length);
    if (s.length <= 20) return s.slice(0, 3) + '…' + s.slice(-2);
    return s.slice(0, 8) + '…' + s.slice(-4);
  }

  function hostOf(url) {
    var u = String(url || '');
    try {
      return new URL(u).hostname.toLowerCase();
    } catch (err) {
      // Relative or malformed URLs turn up in hand-edited HARs.
      var m = u.replace(/^[a-z][a-z0-9+.\-]*:\/\//i, '').match(/^([^/?#:]+)/);
      return m ? m[1].toLowerCase() : '';
    }
  }

  /* Naive registrable domain. This is not the Public Suffix List — it just
     knows the common two-level suffixes, which is enough to decide whether
     cdn.example.co.uk is "the same company" as www.example.co.uk. */
  var TWO_LEVEL = ['co.uk','org.uk','ac.uk','gov.uk','co.jp','co.kr','co.in','co.nz',
    'co.za','com.au','com.br','com.mx','com.sg','com.tr','com.cn','com.hk','com.tw',
    'net.au','org.au','com.ar','com.co','co.il','com.my','com.ph','com.pk','com.ua'];

  function registrable(host) {
    var parts = String(host).split('.');
    if (parts.length < 3) return String(host);
    var last2 = parts.slice(-2).join('.');
    if (TWO_LEVEL.indexOf(last2) !== -1) return parts.slice(-3).join('.');
    return last2;
  }

  /* ---------------------------------------------------------------------- */
  /* Secret patterns.                                                        */
  /* `scrub: true` means the pattern is also used to rewrite the redacted    */
  /* copy. Patterns are deliberately anchored on issuer prefixes rather than */
  /* on entropy: prefixes have no false positives worth worrying about, and  */
  /* "this 40-character string looks random" fires on every cache-buster.    */
  /* ---------------------------------------------------------------------- */
  var SECRET_RULES = [
    { tag: 'AWS-KEY', label: 'AWS access key id', sev: 3, scrub: true,
      re: /\b(?:AKIA|ASIA|AIDA|AROA|AGPA|ANPA|ANVA|ABIA|ACCA|AIPA)[0-9A-Z]{16}\b/g,
      note: 'AKIA is long-lived; ASIA is a temporary session key. Both act as the identity that issued them.' },

    { tag: 'AWS-SECRET', label: 'AWS secret access key', sev: 3, scrub: true,
      re: /aws_?secret_?access_?key["'\s:=]+([A-Za-z0-9/+=]{40})/gi, group: 1,
      note: 'Matched only next to its own parameter name — a bare 40-character blob is unidentifiable.' },

    { tag: 'GOOGLE-KEY', label: 'Google API key', sev: 3, scrub: true,
      re: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
      note: 'Often shipped in front-end code on purpose. Check the referrer/IP restrictions on it before panicking.' },

    /* No `mixed` filter on this one: real Slack tokens are frequently all
       lowercase and digits, so demanding a capital would drop genuine hits.
       The xox?- prefix is distinctive enough on its own. */
    { tag: 'SLACK-TOKEN', label: 'Slack token', sev: 3, scrub: true,
      re: /\bxox[baprse]-[0-9A-Za-z\-]{10,}/g,
      note: 'Slack revokes these automatically when it finds them in public — it cannot see your inbox.' },

    { tag: 'SLACK-HOOK', label: 'Slack incoming webhook', sev: 2, scrub: true,
      re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\-\/]{20,}/g,
      note: 'Anyone holding this URL can post into that channel as your app.' },

    { tag: 'GITHUB-TOKEN', label: 'GitHub token', sev: 3, scrub: true, mixed: true,
      re: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g,
      note: 'ghp_ personal, gho_ OAuth, ghu_ user-to-server, ghs_ server, ghr_ refresh.' },

    { tag: 'STRIPE-LIVE', label: 'Stripe LIVE secret key', sev: 3, scrub: true,
      re: /\b[sr]k_live_[A-Za-z0-9]{10,120}\b/g,
      note: 'A live secret key can move real money. Roll it in the dashboard now, not after sending the file.' },

    { tag: 'STRIPE-TEST', label: 'Stripe test secret key', sev: 1, scrub: true,
      re: /\b[sr]k_test_[A-Za-z0-9]{10,120}\b/g,
      note: 'Test mode only — worth rotating, not worth an incident.' },

    { tag: 'STRIPE-PUB', label: 'Stripe publishable key', sev: 0, scrub: false,
      re: /\bpk_(?:live|test)_[A-Za-z0-9]{10,120}\b/g,
      note: 'Publishable by design. Listed for completeness, not redacted, because removing it breaks the capture.' },

    { tag: 'OPENAI-KEY', label: 'OpenAI API key', sev: 3, scrub: true, mixed: true,
      re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{24,}\b/g,
      note: 'Billed to your organisation until revoked.' },

    { tag: 'SENDGRID-KEY', label: 'SendGrid API key', sev: 3, scrub: true,
      re: /\bSG\.[A-Za-z0-9_\-]{16,48}\.[A-Za-z0-9_\-]{16,64}\b/g,
      note: 'Sends mail as your domain, which is a phishing engine with your SPF record behind it.' },

    { tag: 'TWILIO-KEY', label: 'Twilio SID or API key', sev: 3, scrub: true,
      re: /\b(?:SK|AC)[0-9a-fA-F]{32}\b/g,
      note: 'SK is an API key, AC is the account SID. Paired with a secret they place calls and send SMS on your bill.' },

    { tag: 'NPM-TOKEN', label: 'npm access token', sev: 3, scrub: true,
      re: /\bnpm_[A-Za-z0-9]{36}\b/g,
      note: 'Publish rights to whatever packages that account owns.' },

    /* The `|$` alternative matters: a key block that was cut off by a body
       size limit has no END line, and a pattern that insisted on one would
       match nothing and leave the key material in the redacted copy. Running
       to the end of the string is the safe direction to be wrong in. */
    { tag: 'PRIVATE-KEY', label: 'Private key block', sev: 3, scrub: true,
      re: /-----BEGIN (?:[A-Z0-9 ]{0,20})PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]{0,20})PRIVATE KEY-----|$)/g,
      note: 'A whole private key inside an HTTP capture. Treat it as compromised the moment the file leaves your machine.' },

    { tag: 'JWT', label: 'JSON Web Token', sev: 3, scrub: true,
      re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]*/g,
      note: 'A bearer credential: whoever holds it is the user until it expires.' }
  ];

  /* Parameter and header names whose value is a secret whatever it looks
     like. `code` is included only for long values — short ones are country
     codes, status codes and discount codes. */
  var SENSITIVE_NAME = /^(?:x-)?(?:api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|auth|authorization|authentication|token|secret|client[-_]?secret|password|passwd|pwd|pass|passphrase|session|sessionid|session[-_]?token|sid|signature|sig|otp|mfa|totp|private[-_]?key|credential|credentials|bearer|csrf|xsrf)$/i;
  var PASSWORDISH  = /^(?:password|passwd|pwd|pass|passphrase|new[-_]?password|old[-_]?password|current[-_]?password)$/i;
  var CODEISH      = /^(?:code|auth[-_]?code|access[-_]?code)$/i;

  /* Header names that are always credentials, redacted wholesale. */
  var SECRET_HEADER = /^(?:authorization|proxy-authorization|authentication|www-authenticate|x-api-key|api-key|apikey|x-auth-token|x-authorization|x-access-token|x-session-token|x-session-id|x-csrf-token|x-xsrf-token|x-amz-security-token|x-goog-api-key|x-functions-key|x-ms-client-secret)$/i;

  /* Cookie names that carry a session. Matched loosely because every stack
     spells it differently, and a false positive here only costs a warning. */
  var SESSION_COOKIE = /(sess|sid$|^sid|auth|token|jwt|login|logged|remember|identity|_ac$|csrf|xsrf)/i;

  /* Tokens with an issuer prefix but no digit-and-uppercase mix are almost
     always something else that happens to start the same way — a CSS class
     called sk-loading-indicator, a git branch called ghp_foo. Rules marked
     `mixed` are held to that bar. */
  function looksRandom(value) {
    return /[A-Z]/.test(value) && /[0-9]/.test(value);
  }

  /* ---- credit cards ----------------------------------------------------- */
  var CARD_RE = /\b\d[\d \-]{11,21}\d\b/g;

  function luhn(digits) {
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var d = digits.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  /* Brand AND length. Together with Luhn this is what stops IMEIs, order
     numbers and account references from being reported as card numbers. */
  function cardBrand(d) {
    var n = d.length;
    if (d.charAt(0) === '4' && (n === 13 || n === 16 || n === 19)) return 'Visa';
    if (n === 16 && /^5[1-5]/.test(d)) return 'Mastercard';
    if (n === 16 && /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(d)) return 'Mastercard';
    if (n === 15 && /^3[47]/.test(d)) return 'American Express';
    if (n === 16 && /^(6011|65|64[4-9])/.test(d)) return 'Discover';
    if (n === 16 && /^35(2[89]|[3-8]\d)/.test(d)) return 'JCB';
    if (n === 14 && /^3(0[0-5]|[68])/.test(d)) return 'Diners Club';
    if (n >= 16 && n <= 19 && /^62/.test(d)) return 'UnionPay';
    return null;
  }

  function isCard(text) {
    var d = String(text).replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d) && cardBrand(d) ? d : null;
  }

  /* ---- other PII -------------------------------------------------------- */
  /* Emails are found by walking out from each "@" rather than with the usual
     /[A-Za-z0-9._%+-]+@.../ pattern. That pattern is a trap: on a long run of
     ordinary characters with no "@" after it, the leading + matches the whole
     run, fails, backs off one character and tries again, at every starting
     position. On minified JavaScript response bodies it turned a 5 MB HAR
     into a twelve-second freeze. Indexing to the "@" first is linear, and
     an email cannot exist anywhere else. */
  var EMAIL_SHAPE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,24}$/;
  var E164_RE  = /\+\d[\d ().\-]{7,18}\d/g;
  var NANP_RE  = /\b\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}\b/g;

  function isLocalChar(code) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
           (code >= 97 && code <= 122) ||
           code === 46 || code === 95 || code === 37 || code === 43 || code === 45;
  }
  function isHostChar(code) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
           (code >= 97 && code <= 122) || code === 46 || code === 45;
  }

  function scanEmails(text, where, rep) {
    var from = 0, hits = 0, at;
    while (hits < MATCH_LIMIT && (at = text.indexOf('@', from)) !== -1) {
      from = at + 1;
      var start = at;
      while (start > 0 && at - start < 64 && isLocalChar(text.charCodeAt(start - 1))) start--;
      if (start === at) continue;
      var end = at + 1;
      while (end < text.length && end - at < 255 && isHostChar(text.charCodeAt(end))) end++;
      // A trailing dot belongs to the sentence, not the domain.
      while (end > at + 1 && (text.charAt(end - 1) === '.' || text.charAt(end - 1) === '-')) end--;
      var candidate = text.slice(start, end);
      hits++;
      if (!EMAIL_SHAPE.test(candidate)) continue;
      if (NOISE_EMAIL.test(candidate)) continue;
      addPii(rep.emails, rep.emailKeys, candidate.toLowerCase(), where);
      from = end;
    }
  }

  /* Addresses that are machinery, not people. Sentry DSNs, no-reply senders
     and example.com litter response bodies and drown the real hits. */
  var NOISE_EMAIL = /^(?:no-?reply|do-?not-?reply|postmaster|abuse|webmaster|support|info|hello|sentry|admin)@|@(?:example\.(?:com|org|net)|sentry\.io|localhost|test|invalid)$/i;

  /* ---- trackers --------------------------------------------------------- */
  var TRACKERS = [
    ['google-analytics.com', 'Google Analytics'],
    ['analytics.google.com', 'Google Analytics 4'],
    ['googletagmanager.com', 'Google Tag Manager'],
    ['doubleclick.net', 'Google ad network'],
    ['googlesyndication.com', 'Google AdSense'],
    ['googleadservices.com', 'Google Ads conversion'],
    ['connect.facebook.net', 'Meta Pixel'],
    ['facebook.net', 'Meta Pixel'],
    ['facebook.com', 'Meta'],
    ['hotjar.com', 'Hotjar — session recording'],
    ['hotjar.io', 'Hotjar — session recording'],
    ['clarity.ms', 'Microsoft Clarity — session recording'],
    ['fullstory.com', 'FullStory — session recording'],
    ['logrocket.com', 'LogRocket — session recording'],
    ['logrocket.io', 'LogRocket — session recording'],
    ['mouseflow.com', 'Mouseflow — session recording'],
    ['smartlook.com', 'Smartlook — session recording'],
    ['luckyorange.com', 'Lucky Orange — session recording'],
    ['crazyegg.com', 'Crazy Egg — heatmaps'],
    ['segment.com', 'Segment — event pipeline'],
    ['segment.io', 'Segment — event pipeline'],
    ['mixpanel.com', 'Mixpanel'],
    ['amplitude.com', 'Amplitude'],
    ['heap.io', 'Heap'],
    ['heapanalytics.com', 'Heap'],
    ['pendo.io', 'Pendo'],
    ['intercom.io', 'Intercom'],
    ['intercomcdn.com', 'Intercom'],
    ['drift.com', 'Drift'],
    ['optimizely.com', 'Optimizely'],
    ['braze.com', 'Braze'],
    ['klaviyo.com', 'Klaviyo'],
    ['onesignal.com', 'OneSignal push'],
    ['bat.bing.com', 'Microsoft Advertising'],
    ['tiktok.com', 'TikTok pixel'],
    ['snapchat.com', 'Snap pixel'],
    ['licdn.com', 'LinkedIn Insight tag'],
    ['ads-twitter.com', 'X ads'],
    ['t.co', 'X/Twitter'],
    ['pinterest.com', 'Pinterest tag'],
    ['criteo.com', 'Criteo'],
    ['criteo.net', 'Criteo'],
    ['taboola.com', 'Taboola'],
    ['outbrain.com', 'Outbrain'],
    ['scorecardresearch.com', 'Comscore'],
    ['quantserve.com', 'Quantcast'],
    ['adsrvr.org', 'The Trade Desk'],
    ['adnxs.com', 'Xandr'],
    ['rubiconproject.com', 'Magnite'],
    ['pubmatic.com', 'PubMatic'],
    ['casalemedia.com', 'Index Exchange'],
    ['yandex.ru', 'Yandex Metrica'],
    ['nr-data.net', 'New Relic RUM'],
    ['newrelic.com', 'New Relic RUM'],
    ['sentry.io', 'Sentry — error reporting'],
    ['bugsnag.com', 'Bugsnag — error reporting'],
    ['datadoghq.com', 'Datadog RUM'],
    ['plausible.io', 'Plausible — cookieless'],
    ['usefathom.com', 'Fathom — cookieless']
  ];

  function trackerName(host) {
    for (var i = 0; i < TRACKERS.length; i++) {
      var d = TRACKERS[i][0];
      if (host === d || host.length > d.length && host.slice(-(d.length + 1)) === '.' + d) {
        return TRACKERS[i][1];
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Decode and parse                                                        */
  /* ---------------------------------------------------------------------- */
  function decodeText(bytes) {
    // UTF-16 exports are rare but real (PowerShell and some Windows proxies
    // write them), and a UTF-8 BOM makes JSON.parse throw on character zero.
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), enc: 'UTF-16LE with BOM' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), enc: 'UTF-16BE with BOM' };
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), enc: 'UTF-8 with BOM (stripped)' };
    }
    // A HAR is ASCII-heavy JSON; if byte 1 is NUL this is UTF-16 without a BOM.
    if (bytes.length >= 4 && bytes[0] !== 0 && bytes[1] === 0 && bytes[3] === 0) {
      return { text: new TextDecoder('utf-16le').decode(bytes), enc: 'UTF-16LE, no BOM' };
    }
    // The mirror image: a leading NUL, a non-NUL second byte, then another NUL
    // is UTF-16BE without a BOM. Its first byte is zero, so without this branch
    // it would sniff as UTF-8 and decode to mojibake.
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0) {
      return { text: new TextDecoder('utf-16be').decode(bytes), enc: 'UTF-16BE, no BOM' };
    }
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), enc: 'UTF-8' };
  }

  function describeParseFailure(text, err) {
    var msg = err && err.message ? err.message : String(err);
    out.err('This file is not valid JSON, so it is not a readable HAR.');
    out.line('');
    out.row('parser said', msg);
    var m = /position (\d+)/.exec(msg);
    if (m) {
      var pos = parseInt(m[1], 10);
      var line = text.slice(0, pos).split('\n').length;
      out.row('at line', line);
      var from = Math.max(0, pos - 70);
      out.line('');
      out.dim('context:');
      out.line('  ' + text.slice(from, pos + 70).replace(/\n/g, '⏎'));
      out.line('  ' + ' '.repeat(Math.min(70, pos - from)) + '^', 't-err');
    }
    out.line('');
    out.dim('Common causes: the file was truncated mid-download, a HAR was');
    out.dim('pasted into a document and back out, or this is a .har.gz or a zip');
    out.dim('that still has its .har name. Nothing here decompresses.');
  }

  /* ---------------------------------------------------------------------- */
  /* Finding collection                                                      */
  /* ---------------------------------------------------------------------- */
  function newReport() {
    return {
      // Dedup maps are keyed on values taken from the file, so they use a null
      // prototype to keep a value like "__proto__" or "toString" from colliding
      // with an Object.prototype member.
      secrets: [], secretKeys: Object.create(null), secretsCapped: false,
      emails: [], emailKeys: Object.create(null),
      cards: [], cardKeys: Object.create(null),
      phones: [], phoneKeys: Object.create(null),
      bodyBudget: BODY_BUDGET, bodiesTruncated: 0, bodiesSkipped: 0
    };
  }

  function addSecret(rep, tag, label, sev, value, note, where, extra) {
    var key = tag + '|' + value;
    var seen = rep.secretKeys[key];
    if (seen) {
      seen.count++;
      if (seen.where.length < 4) seen.where.push(where);
      return seen;
    }
    if (rep.secrets.length >= MAX_FINDINGS) { rep.secretsCapped = true; return null; }
    var rec = { tag: tag, label: label, sev: sev, value: value, note: note,
                where: [where], count: 1, extra: extra || null };
    rep.secretKeys[key] = rec;
    rep.secrets.push(rec);
    return rec;
  }

  function addPii(list, keys, value, where) {
    var seen = keys[value];
    if (seen) {
      seen.count++;
      if (seen.where.length < 3) seen.where.push(where);
      return;
    }
    if (list.length >= MAX_PII) return;
    var rec = { value: value, where: [where], count: 1 };
    keys[value] = rec;
    list.push(rec);
  }

  /* A JWT is worth opening: an expired token in a HAR is an embarrassment, a
     live one is an incident, and the difference is three lines of decode. */
  function describeJwt(token) {
    var parts = token.split('.');
    if (parts.length < 2) return null;
    var lines = [];
    try {
      var body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (body.length % 4) body += '=';
      var payload = JSON.parse(new TextDecoder().decode(bytesFromBinary(atob(body))));
      var head = null;
      try {
        var h = parts[0].replace(/-/g, '+').replace(/_/g, '/');
        while (h.length % 4) h += '=';
        head = JSON.parse(new TextDecoder().decode(bytesFromBinary(atob(h))));
      } catch (e0) { head = null; }
      if (head && head.alg) {
        lines.push('alg ' + head.alg + (String(head.alg).toLowerCase() === 'none' ? '  — unsigned!' : ''));
      }
      var who = payload.sub || payload.email || payload.user_id || payload.uid ||
                payload.preferred_username || payload.name;
      if (who) lines.push('subject ' + clip(String(who), 60));
      if (payload.iss) lines.push('issuer ' + clip(String(payload.iss), 60));
      if (payload.scope) lines.push('scope ' + clip(String(payload.scope), 70));
      if (typeof payload.exp === 'number') {
        var when = new Date(payload.exp * 1000);
        var live = when.getTime() > Date.now();
        lines.push('expires ' + when.toISOString() + (live ? '  — STILL VALID' : '  — already expired'));
      } else {
        lines.push('no exp claim — this token does not expire on its own');
      }
    } catch (e) {
      return null;
    }
    return lines.length ? lines : null;
  }

  function bytesFromBinary(binary) {
    var b = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) b[i] = binary.charCodeAt(i) & 0xff;
    return b;
  }

  /* ---------------------------------------------------------------------- */
  /* Scanning                                                                */
  /* ---------------------------------------------------------------------- */
  function scanSecrets(text, where, rep) {
    if (!text || text.length < 8) return;
    for (var i = 0; i < SECRET_RULES.length; i++) {
      var rule = SECRET_RULES[i];
      rule.re.lastIndex = 0;
      var m, hits = 0;
      while ((m = rule.re.exec(text)) !== null) {
        var value = rule.group ? m[rule.group] : m[0];
        // A zero-length match would spin forever; guard the index by hand.
        if (!m[0].length) { rule.re.lastIndex++; continue; }
        if (++hits > MATCH_LIMIT) break;
        if (rule.mixed && !looksRandom(value)) continue;
        var extra = rule.tag === 'JWT' ? describeJwt(value) : null;
        // Key the dedup on the full matched block, so two different private keys
        // are two findings and the reported length is the key's, not the header
        // line's. Keep just the header line for display.
        var rec = addSecret(rep, rule.tag, rule.label, rule.sev, value, rule.note, where, extra);
        if (rec && rule.tag === 'PRIVATE-KEY' && !rec.display) {
          rec.display = value.split('\n')[0].trim();   // the header line names the key type
        }
      }
    }
  }

  function scanPii(text, where, rep) {
    if (!text) return;

    scanEmails(text, where, rep);

    CARD_RE.lastIndex = 0;
    var m, hits = 0;
    while ((m = CARD_RE.exec(text)) !== null && hits < MATCH_LIMIT) {
      hits++;
      var digits = isCard(m[0]);
      if (digits) {
        addPii(rep.cards, rep.cardKeys,
               cardBrand(digits) + ' ' + digits.slice(0, 6) + '••••••' + digits.slice(-4), where);
      }
    }

    // The two phone patterns overlap: "+1 415 555 0132" matches E.164 whole
    // and the North American shape from character four. Spans already claimed
    // by the first pass are off limits to the second, so one number is
    // reported once rather than as two different people.
    var spans = [];
    scanPhones(E164_RE, text, where, rep, 8, 15, spans);
    scanPhones(NANP_RE, text, where, rep, 10, 10, spans);
  }

  function overlaps(spans, from, to) {
    for (var i = 0; i < spans.length; i++) {
      if (from < spans[i][1] && to > spans[i][0]) return true;
    }
    return false;
  }

  function scanPhones(re, text, where, rep, minDigits, maxDigits, spans) {
    re.lastIndex = 0;
    var m, hits = 0;
    while ((m = re.exec(text)) !== null && hits < MATCH_LIMIT) {
      hits++;
      var digits = m[0].replace(/\D/g, '');
      if (digits.length < minDigits || digits.length > maxDigits) continue;
      if (isCard(m[0])) continue;                       // already counted as a card
      if (/^(\d)\1+$/.test(digits)) continue;           // 000000000, 111111111
      // Reject a match that is really a slice of a longer digit run — an id,
      // a timestamp in microseconds, a hash of decimal digits.
      var before = text.charAt(m.index - 1);
      var after = text.charAt(m.index + m[0].length);
      if (/[0-9]/.test(before) || /[0-9]/.test(after)) continue;
      if (overlaps(spans, m.index, m.index + m[0].length)) continue;
      spans.push([m.index, m.index + m[0].length]);
      addPii(rep.phones, rep.phoneKeys, m[0].trim(), where);
    }
  }

  function scanNamedValue(name, value, where, rep) {
    var n = String(name || '');
    var v = String(value == null ? '' : value);
    if (!v) return;

    if (PASSWORDISH.test(n)) {
      // Never echoed, not even masked: this is very likely the visitor's own
      // password, and it is already on screen once too often.
      addSecret(rep, 'PASSWORD', 'Password submitted in a form', 3,
                '(' + v.length + ' characters, not shown)',
                'Sent in the clear inside the capture. Change it — redacting the file does not un-send it.',
                where);
      return;
    }
    if (CODEISH.test(n) && v.length >= 16) {
      addSecret(rep, 'AUTH-CODE', 'Authorisation code parameter', 2, v,
                'OAuth codes are single-use but usually still live when a HAR is fresh.', where);
      return;
    }
    if (SENSITIVE_NAME.test(n) && v.length >= 8) {
      addSecret(rep, 'NAMED-SECRET', 'Secret-named parameter: ' + clip(n, 40), 2, v,
                'Flagged on the name, not the shape — whatever this value is, it is called a secret.', where);
    }
  }

  function decodeContent(content) {
    var text = str(content.text);
    if (!text) return '';
    if (str(content.encoding).toLowerCase() === 'base64') {
      try { return atob(text.replace(/\s+/g, '')); }
      catch (e) { return ''; }        // truncated or mangled base64
    }
    return text;
  }

  var BINARY_MIME = /^(?:image|video|audio|font)\//i;

  /* ---------------------------------------------------------------------- */
  /* The main pass over entries                                              */
  /* ---------------------------------------------------------------------- */
  function analyseEntries(entries, rep, stats) {
    for (var i = 0; i < entries.length; i++) {
      if (isObj(entries[i])) analyseEntry(entries[i], i + 1, rep, stats);
    }
  }

  /* One entry, kept in its own function so the closures below capture a fresh
     scope per request rather than the loop variable. `idx` is 1-based and
     counts entries in file order — the same order DevTools shows them in. */
  function analyseEntry(entry, idx, rep, stats) {
    var req = isObj(entry.request) ? entry.request : {};
    var res = isObj(entry.response) ? entry.response : {};
    var url = str(req.url);
    var method = str(req.method) || '?';

    function at(field) { return { idx: idx, url: url, method: method, field: field }; }

    /* --- URL and query --------------------------------------------------- */
    scanSecrets(url, at('request URL'), rep);
    scanPii(url, at('request URL'), rep);

    arr(req.queryString).forEach(function (q) {
      if (!isObj(q)) return;
      var where = at('query parameter "' + clip(str(q.name), 40) + '"');
      scanNamedValue(q.name, q.value, where, rep);
      scanSecrets(str(q.value), where, rep);
      scanPii(str(q.value), where, rep);
    });

    /* --- request headers ------------------------------------------------- */
    arr(req.headers).forEach(function (h) {
      if (!isObj(h)) return;
      var name = str(h.name), value = str(h.value);
      if (!value) return;
      var lower = name.toLowerCase();
      var where = at('request header ' + name);

      if (lower === 'authorization' || lower === 'proxy-authorization') {
        handleAuthorization(value, where, rep);
      } else if (lower === 'cookie') {
        scanCookieHeader(value, where, rep, stats);
      } else if (SECRET_HEADER.test(lower)) {
        addSecret(rep, 'SECRET-HEADER', 'Credential header: ' + name, 3, value,
                  'Header names like this exist to carry a key. It is in the file verbatim.', where);
      }
      scanSecrets(value, where, rep);
    });

    /* --- request cookies ------------------------------------------------- */
    arr(req.cookies).forEach(function (c) {
      if (!isObj(c)) return;
      var name = str(c.name), value = str(c.value);
      if (!value) return;
      var where = at('request cookie "' + clip(name, 40) + '"');
      if (SESSION_COOKIE.test(name)) {
        addSecret(rep, 'COOKIE', 'Session cookie: ' + clip(name, 40), 3, value,
                  'A session cookie is a login. Pasting it into a browser is the whole attack.', where);
      } else if (value.length >= 20) {
        addSecret(rep, 'COOKIE', 'Long cookie value: ' + clip(name, 40), 2, value,
                  'Not named like a session cookie, but long enough to be one — worth a glance.', where);
      }
      scanSecrets(value, where, rep);
    });

    /* --- request body ---------------------------------------------------- */
    if (isObj(req.postData)) {
      var pd = req.postData;
      var bodyWhere = at('request body (' + (clip(str(pd.mimeType), 40) || 'unknown type') + ')');
      var bodyText = str(pd.text);
      if (bodyText) {
        stats.postBodies++;
        var slice = bodyText.length > BODY_SCAN_LIMIT
          ? bodyText.slice(0, BODY_SCAN_LIMIT) : bodyText;
        if (slice.length < bodyText.length) rep.bodiesTruncated++;
        scanSecrets(slice, bodyWhere, rep);
        scanPii(slice, bodyWhere, rep);
        scanJsonPairs(slice, bodyWhere, rep);
        scanFormPairs(slice, str(pd.mimeType), bodyWhere, rep);
      }
      // Chrome fills params[] for form posts, Firefox often does not, and
      // neither fills it for JSON — hence the text sweep above as well.
      arr(pd.params).forEach(function (p) {
        if (!isObj(p)) return;
        var pwhere = at('form field "' + clip(str(p.name), 40) + '"');
        scanNamedValue(p.name, decodePlus(str(p.value)), pwhere, rep);
        scanSecrets(str(p.value), pwhere, rep);
        scanPii(decodePlus(str(p.value)), pwhere, rep);
      });
    }

    /* --- response headers ------------------------------------------------ */
    var contentType = '';
    arr(res.headers).forEach(function (h) {
      if (!isObj(h)) return;
      var name = str(h.name), value = str(h.value);
      var lower = name.toLowerCase();
      if (lower === 'content-type') contentType = value.toLowerCase();
      if (!value) return;
      var where = at('response header ' + name);
      if (lower === 'set-cookie') {
        scanSetCookie(value, where, rep, stats);
      } else if (SECRET_HEADER.test(lower)) {
        addSecret(rep, 'SECRET-HEADER', 'Credential header in the response: ' + name, 3, value,
                  'The server handed this back and the capture kept it.', where);
      }
      scanSecrets(value, where, rep);
    });

    arr(res.cookies).forEach(function (c) {
      if (!isObj(c)) return;
      var name = str(c.name), value = str(c.value);
      if (!value) return;
      var where = at('Set-Cookie "' + clip(name, 40) + '"');
      var rec = null;
      if (SESSION_COOKIE.test(name)) {
        rec = addSecret(rep, 'COOKIE', 'Session cookie issued: ' + clip(name, 40), 3, value,
                  'Freshly issued by the server, so it is almost certainly still valid.', where);
      } else if (value.length >= 20) {
        rec = addSecret(rep, 'COOKIE', 'Long cookie value issued: ' + clip(name, 40), 2, value,
                  'Not named like a session cookie, but long enough to be one.', where);
      }
      // The flags live on the cookie object here rather than in the header
      // text, so they are read from the booleans instead of by regex.
      if (rec && rec.count === 1) {
        var flags = [];
        if (c.httpOnly === false) flags.push('no HttpOnly');
        if (c.secure === false) flags.push('no Secure');
        if (flags.length) rec.extra = ['cookie flags: ' + flags.join(', ')];
      }
      scanSecrets(value, where, rep);
    });

    /* --- response body --------------------------------------------------- */
    var content = isObj(res.content) ? res.content : {};
    if (str(content.text)) {
      stats.withBody++;
      if (BINARY_MIME.test(str(content.mimeType))) {
        rep.bodiesSkipped++;                    // no secrets worth chasing in a PNG
      } else if (rep.bodyBudget <= 0) {
        rep.bodiesSkipped++;
      } else {
        var decoded = decodeContent(content);
        if (decoded.length > BODY_SCAN_LIMIT) {
          decoded = decoded.slice(0, BODY_SCAN_LIMIT);
          rep.bodiesTruncated++;
        }
        rep.bodyBudget -= decoded.length;
        var rwhere = at('response body (' + (clip(str(content.mimeType), 40) || 'unknown type') + ')');
        scanSecrets(decoded, rwhere, rep);
        scanPii(decoded, rwhere, rep);
        scanJsonPairs(decoded, rwhere, rep);
      }
    }

    /* --- per-entry statistics -------------------------------------------- */
    collectStats(entry, req, res, url, contentType, idx, stats);
  }

  function decodePlus(value) {
    try { return decodeURIComponent(String(value).replace(/\+/g, ' ')); }
    catch (e) { return String(value); }
  }

  /* Key/value pairs inside a JSON body, which is where modern APIs put
     credentials and where params[] never reaches. */
  function scanJsonPairs(text, where, rep) {
    if (text.indexOf('"') === -1) return;
    var re = /"([A-Za-z0-9_.\-]{1,48})"\s*:\s*"((?:[^"\\]|\\.)*?)"/g;
    var m, hits = 0;
    while ((m = re.exec(text)) !== null && hits < 400) {
      hits++;
      if (SENSITIVE_NAME.test(m[1]) || PASSWORDISH.test(m[1]) || CODEISH.test(m[1])) {
        scanNamedValue(m[1], m[2], where, rep);
      }
    }
  }

  function scanFormPairs(text, mime, where, rep) {
    if (String(mime).indexOf('x-www-form-urlencoded') === -1) return;
    var pairs = text.split('&');
    for (var i = 0; i < pairs.length && i < 200; i++) {
      var eq = pairs[i].indexOf('=');
      if (eq < 1) continue;
      scanNamedValue(decodePlus(pairs[i].slice(0, eq)), decodePlus(pairs[i].slice(eq + 1)), where, rep);
    }
  }

  function handleAuthorization(value, where, rep) {
    var m = /^\s*([A-Za-z][A-Za-z0-9\-_]*)\s+(.+)$/.exec(value);
    var scheme = m ? m[1] : '';
    var rest = m ? m[2].trim() : value.trim();

    if (/^basic$/i.test(scheme)) {
      var user = null, passLen = 0;
      try {
        var plain = atob(rest.replace(/\s+/g, ''));
        var cut = plain.indexOf(':');
        user = cut === -1 ? plain : plain.slice(0, cut);
        passLen = cut === -1 ? 0 : plain.length - cut - 1;
      } catch (e) { user = null; }
      addSecret(rep, 'BASIC-AUTH', 'HTTP Basic credentials', 3, rest,
                'Basic auth is base64, not encryption. Anyone with the file has the password.',
                where,
                user !== null
                  ? ['username: ' + clip(user, 60),
                     'password: ' + passLen + ' characters (decoded here, deliberately not shown)']
                  : ['the base64 did not decode — it may be truncated']);
      return;
    }
    if (/^bearer$/i.test(scheme)) {
      var extra = rest.slice(0, 3) === 'eyJ' ? describeJwt(rest) : null;
      addSecret(rep, 'BEARER', 'Bearer token', 3, rest,
                'Bearer means exactly that: holding it is enough.', where, extra);
      return;
    }
    addSecret(rep, 'AUTH-HEADER', 'Authorization header (' + (scheme || 'no scheme') + ')', 3,
              rest, 'Whatever the scheme, this line authenticates someone.', where);
  }

  function scanCookieHeader(value, where, rep, stats) {
    var parts = value.split(';');
    for (var i = 0; i < parts.length && i < 100; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 1) continue;
      var name = parts[i].slice(0, eq).trim();
      var val = parts[i].slice(eq + 1).trim();
      if (!val) continue;
      stats.cookieNames[name] = true;
      if (SESSION_COOKIE.test(name)) {
        addSecret(rep, 'COOKIE', 'Session cookie sent: ' + clip(name, 40), 3, val,
                  'Replaying this cookie is replaying the login.', where);
      }
      scanSecrets(val, where, rep);
    }
  }

  function scanSetCookie(value, where, rep, stats) {
    var first = value.split(';')[0];
    var eq = first.indexOf('=');
    if (eq < 1) return;
    var name = first.slice(0, eq).trim();
    var val = first.slice(eq + 1).trim();
    stats.cookieNames[name] = true;
    if (!val) return;
    var flags = [];
    if (!/;\s*httponly/i.test(value)) flags.push('no HttpOnly');
    if (!/;\s*secure/i.test(value)) flags.push('no Secure');
    if (!/;\s*samesite/i.test(value)) flags.push('no SameSite');
    if (SESSION_COOKIE.test(name)) {
      addSecret(rep, 'COOKIE', 'Session cookie issued: ' + clip(name, 40), 3, val,
                'Set-Cookie in a capture is a credential the server just minted.',
                where, flags.length ? ['cookie flags: ' + flags.join(', ')] : null);
    } else if (val.length >= 20) {
      addSecret(rep, 'COOKIE', 'Long cookie value issued: ' + clip(name, 40), 2, val,
                'Not named like a session cookie, but long enough to be one.',
                where, flags.length ? ['cookie flags: ' + flags.join(', ')] : null);
    }
    scanSecrets(val, where, rep);
  }

  /* ---------------------------------------------------------------------- */
  /* Per-entry statistics                                                    */
  /* ---------------------------------------------------------------------- */
  function newStats() {
    return {
      // Maps keyed on host names, cookie names and methods read out of the file
      // use a null prototype so a key such as "__proto__", "constructor" or
      // "toString" counts correctly instead of colliding with Object.prototype.
      hosts: Object.create(null), hostBytes: Object.create(null),
      transferred: 0, contentSize: 0,
      firstStart: null, lastEnd: null, insecure: 0, withBody: 0, postBodies: 0,
      failures: [], slow: [], html: [], cookieNames: Object.create(null), cached: 0,
      methods: Object.create(null), statusless: 0, firstRaw: ''
    };
  }

  /* HAR size fields are a minefield: -1 means "not known", bodySize is what
     crossed the wire while content.size is after decompression, and Chrome's
     _transferSize is the only field that includes response headers. Prefer
     _transferSize, fall back to the spec fields, ignore negatives. */
  function transferredBytes(res) {
    var t = num(res._transferSize);
    if (t !== null && t >= 0) return t;
    var h = num(res.headersSize), b = num(res.bodySize);
    return (h && h > 0 ? h : 0) + (b && b > 0 ? b : 0);
  }

  function collectStats(entry, req, res, url, contentType, idx, stats) {
    var host = hostOf(url);
    if (host) {
      bump(stats.hosts, host);
      bump(stats.hostBytes, host, transferredBytes(res));
    }
    stats.transferred += transferredBytes(res);
    var csize = num(isObj(res.content) ? res.content.size : null);
    if (csize && csize > 0) stats.contentSize += csize;
    bump(stats.methods, str(req.method).toUpperCase() || '?');

    if (/^http:\/\//i.test(url)) stats.insecure++;

    var started = str(entry.startedDateTime);
    var t = num(entry.time);
    if (started) {
      var ms = Date.parse(started);
      if (!isNaN(ms)) {
        if (stats.firstStart === null || ms < stats.firstStart) {
          stats.firstStart = ms;
          // Kept verbatim as well as parsed: the UTC offset in the original
          // string says which timezone the machine was in, which is often the
          // fastest way to line a HAR up against a server log.
          stats.firstRaw = started;
        }
        var end = ms + (t && t > 0 ? t : 0);
        if (stats.lastEnd === null || end > stats.lastEnd) stats.lastEnd = end;
      }
    }

    var status = num(res.status);
    // Chrome writes status 0 for a request that never completed — blocked by
    // an extension, cancelled, DNS failure, CORS preflight refusal.
    if (status === null) stats.statusless++;
    else if (status === 0 || status >= 400) {
      if (stats.failures.length < 400) {
        stats.failures.push({ idx: idx, status: status, url: url,
                              method: str(req.method), text: str(res.statusText) });
      }
    }

    if (t !== null && t > 0 && stats.slow.length < 20000) {
      var wait = isObj(entry.timings) ? num(entry.timings.wait) : null;
      stats.slow.push({ idx: idx, time: t, url: url, method: str(req.method),
                        status: status, wait: wait });
    }

    if (transferredBytes(res) === 0 && csize && csize > 0) stats.cached++;

    if (contentType.indexOf('text/html') === 0 && status !== null && status >= 200 && status < 300) {
      if (stats.html.length < 500) {
        stats.html.push({ idx: idx, url: url, headers: arr(res.headers) });
      }
    }
  }

  /* Whose site is this? The first HTML document is the best answer, because
     the first entry in the file is often a preflight, a service worker fetch
     or an analytics beacon that fired before the page did. Fall back to the
     first request, then to the busiest host. */
  function firstParty(log, entries, stats) {
    if (stats.html.length) return registrable(hostOf(stats.html[0].url));

    var pages = arr(log.pages);
    for (var p = 0; p < pages.length; p++) {
      if (isObj(pages[p]) && /^https?:\/\//i.test(str(pages[p].title))) {
        return registrable(hostOf(str(pages[p].title)));   // DevTools puts the URL here
      }
    }
    for (var i = 0; i < entries.length && i < 20; i++) {
      if (isObj(entries[i]) && isObj(entries[i].request)) {
        var host = hostOf(str(entries[i].request.url));
        if (host) return registrable(host);
      }
    }
    var hosts = Object.keys(stats.hosts);
    if (!hosts.length) return '';
    hosts.sort(function (a, b) { return stats.hosts[b] - stats.hosts[a]; });
    return registrable(hosts[0]);
  }

  function headerValue(headers, name) {
    for (var i = 0; i < headers.length; i++) {
      if (isObj(headers[i]) && str(headers[i].name).toLowerCase() === name) {
        return str(headers[i].value);
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Output                                                                  */
  /* ---------------------------------------------------------------------- */
  var SEV_TAG = ['NOTE', 'LOW', 'MEDIUM', 'CRITICAL'];
  var SEV_CLS = ['t-dim', 't-info', 't-warn', 't-err'];

  function duration(ms) {
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    var mins = Math.floor(ms / 60000);
    return mins + ' min ' + Math.round((ms - mins * 60000) / 1000) + ' s';
  }

  function reportSecrets(rep) {
    out.rule();
    var live = rep.secrets.filter(function (s) { return s.sev >= 2; });

    if (!rep.secrets.length) {
      out.ok('SECRETS AND CREDENTIALS — nothing matched.');
      out.line('');
      out.dim('That is a real result, not a guarantee. This looks for tokens with');
      out.dim('recognisable shapes and for fields named like secrets. A bespoke');
      out.dim('session id called "q" is invisible to it, and so is anything in a');
      out.dim('response body the export did not include.');
      return;
    }

    if (live.length) {
      out.err('SECRETS AND CREDENTIALS — ' + rep.secrets.length + ' found, ' +
              live.length + ' that should be treated as live');
    } else {
      out.warn('SECRETS AND CREDENTIALS — ' + rep.secrets.length + ' found');
    }
    out.line('');
    out.dim('Do not send this file until these are dealt with. Rotating a leaked');
    out.dim('credential beats redacting it; redaction is for when you cannot.');

    var sorted = rep.secrets.slice().sort(function (a, b) {
      return b.sev - a.sev || b.count - a.count;
    });

    for (var i = 0; i < sorted.length && i < SHOW_SECRETS; i++) {
      var f = sorted[i];
      out.line('');
      out.line('  [' + SEV_TAG[f.sev] + '] ' + f.label, SEV_CLS[f.sev]);
      // A PASSWORD finding carries a description rather than the value, so it
      // is printed as-is; a PRIVATE-KEY shows its header line via f.display;
      // everything else is masked. The length is always the full value's.
      out.line('    value   ' + (f.tag === 'PASSWORD'
        ? f.value
        : (f.display || mask(f.value)) + '   ' + f.value.length + ' chars'), 't-dim');
      var w = f.where[0];
      out.line('    at      #' + w.idx + '  ' + w.field, 't-dim');
      out.line('            ' + (w.method ? w.method + ' ' : '') + clip(w.url, 86), 't-dim');
      if (f.count > 1) {
        // "Seen", not "repeats": a HAR stores a cookie in both the header
        // string and the parsed cookies array, so a single cookie legitimately
        // turns up twice in one entry. Other entry numbers are listed once.
        var others = [];
        for (var k = 1; k < f.where.length; k++) {
          if (f.where[k].idx !== w.idx && others.indexOf(f.where[k].idx) === -1) {
            others.push(f.where[k].idx);
          }
        }
        out.line('    seen    ' + f.count + ' times in the file' +
                 (others.length ? ', also at #' + others.join(', #') : ''), 't-dim');
      }
      if (f.extra) {
        f.extra.forEach(function (line) { out.line('    ' + line, 't-warn'); });
      }
      if (f.note) out.line('    ' + f.note, 't-dim');
    }

    if (sorted.length > SHOW_SECRETS) {
      out.line('');
      out.warn('… and ' + (sorted.length - SHOW_SECRETS) + ' more, not listed. The redacted');
      out.warn('copy covers all of them, not just the ones printed here.');
    }
    if (rep.secretsCapped) {
      out.warn('Collection stopped at ' + MAX_FINDINGS + ' distinct secrets.');
    }
  }

  function reportPii(rep) {
    out.rule();
    var total = rep.emails.length + rep.cards.length + rep.phones.length;
    if (!total) {
      out.ok('PERSONAL DATA — no email addresses, card numbers or phone numbers matched.');
      return;
    }
    out.warn('PERSONAL DATA');
    out.line('');
    out.dim('Hits in request fields are things the session sent. Hits in response');
    out.dim('bodies are things the page displayed — often the site\'s own content,');
    out.dim('sometimes another customer\'s record.');

    piiBlock('Card numbers (Luhn-valid, known brand)', rep.cards, 't-err');
    piiBlock('Email addresses', rep.emails, 't-warn');
    piiBlock('Phone numbers', rep.phones, 't-warn');

    if (rep.cards.length) {
      out.line('');
      out.err('A card number in an HTTP capture is a PCI problem on its own, and');
      out.err('the redacted copy replaces every one of them.');
    }
  }

  function piiBlock(title, list, cls) {
    if (!list.length) return;
    out.line('');
    out.line('  ' + title + ' — ' + list.length + ' distinct', cls);
    var sorted = list.slice().sort(function (a, b) { return b.count - a.count; });
    for (var i = 0; i < sorted.length && i < SHOW_PII; i++) {
      var rec = sorted[i];
      out.line('    ' + clip(rec.value, 54) + '   ×' + rec.count +
               '   first at #' + rec.where[0].idx + ' ' + clip(rec.where[0].field, 46), 't-dim');
    }
    if (sorted.length > SHOW_PII) {
      out.line('    … ' + (sorted.length - SHOW_PII) + ' more not listed', 't-dim');
    }
  }

  function reportHosts(stats, ownDomain) {
    out.rule();
    var hosts = Object.keys(stats.hosts);
    out.heading('HOSTS CONTACTED — ' + hosts.length);
    if (ownDomain) out.row('first party', ownDomain);
    out.line('');

    hosts.sort(function (a, b) { return stats.hosts[b] - stats.hosts[a]; });
    var trackers = 0, thirdParty = 0, recorders = 0;
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      // Same registrable domain counts as first party: cdn.example.com and
      // api.example.com are the same people as www.example.com.
      var own = ownDomain && registrable(host) === ownDomain;
      var label = trackerName(host);
      if (!own) thirdParty++;
      if (label) trackers++;
      if (label && label.indexOf('session recording') !== -1) recorders++;
      if (i >= SHOW_HOSTS) continue;
      var line = '  ' + clip(host, 44);
      while (line.length < 48) line += ' ';
      line += String(stats.hosts[host]);
      while (line.length < 55) line += ' ';
      line += LabTool.humanBytes(stats.hostBytes[host] || 0);
      if (label) line += '   ' + label;
      else if (own) line += '   (first party)';
      out.line(line, label ? 't-warn' : (own ? 't-ok' : null));
    }
    if (hosts.length > SHOW_HOSTS) {
      out.line('  … ' + (hosts.length - SHOW_HOSTS) + ' more hosts not listed', 't-dim');
    }

    out.line('');
    out.row('third-party hosts', thirdParty);
    out.row('known trackers', trackers, trackers ? 't-warn' : 't-ok');
    if (recorders) {
      out.line('');
      out.warn(recorders + ' session-recording service' + (recorders === 1 ? '' : 's') + ' in this capture.');
      out.dim('Those replay the page, not just the URL — whatever was on screen');
      out.dim('during this session was sent to them as well, including anything');
      out.dim('this tool just found in the response bodies.');
    }
  }

  function reportSecurityHeaders(stats) {
    out.rule();
    out.heading('SECURITY HEADERS ON HTML RESPONSES');
    if (!stats.html.length) {
      out.dim('No 2xx text/html responses in this capture, so there is nothing to');
      out.dim('check. These headers only matter on documents.');
      return;
    }
    out.line('');
    var missing = { csp: 0, hsts: 0, xfo: 0, xcto: 0, refpol: 0 };
    var listed = 0;
    stats.html.forEach(function (page) {
      var csp = headerValue(page.headers, 'content-security-policy');
      var hsts = headerValue(page.headers, 'strict-transport-security');
      var xfo = headerValue(page.headers, 'x-frame-options');
      var xcto = headerValue(page.headers, 'x-content-type-options');
      var ref = headerValue(page.headers, 'referrer-policy');
      // CSP frame-ancestors supersedes X-Frame-Options; counting it as missing
      // when a modern CSP covers it would be noise.
      var framed = xfo || (csp && /frame-ancestors/i.test(csp));
      var isHttps = /^https:/i.test(page.url);
      var gaps = [];
      if (!csp) { gaps.push('CSP'); missing.csp++; }
      if (isHttps && !hsts) { gaps.push('HSTS'); missing.hsts++; }
      if (!framed) { gaps.push('X-Frame-Options'); missing.xfo++; }
      if (!xcto) { gaps.push('X-Content-Type-Options'); missing.xcto++; }
      if (!ref) { gaps.push('Referrer-Policy'); missing.refpol++; }
      if (gaps.length && listed < SHOW_HTML) {
        listed++;
        out.line('  #' + page.idx + '  ' + clip(page.url, 70), 't-dim');
        out.line('      missing: ' + gaps.join(', '), 't-warn');
      }
    });
    if (!listed) {
      out.ok('  All ' + stats.html.length + ' HTML responses carry the headers checked here.');
    } else {
      out.line('');
      out.row('HTML responses', stats.html.length);
      out.row('no CSP', missing.csp, missing.csp ? 't-warn' : 't-ok');
      out.row('no HSTS (https only)', missing.hsts, missing.hsts ? 't-warn' : 't-ok');
      out.row('framable', missing.xfo, missing.xfo ? 't-warn' : 't-ok');
      out.row('no nosniff', missing.xcto, missing.xcto ? 't-warn' : 't-ok');
      out.row('no Referrer-Policy', missing.refpol, missing.refpol ? 't-warn' : 't-ok');
      out.line('');
      out.dim('A missing header here is what the server sent during this capture.');
      out.dim('A CDN or a proxy in front of it may add them elsewhere, and a HAR');
      out.dim('taken through a corporate proxy can have them stripped.');
    }
  }

  function reportTiming(stats) {
    out.rule();
    out.heading('SLOW AND FAILED REQUESTS');
    out.line('');

    if (stats.failures.length) {
      out.warn('  ' + stats.failures.length + ' request' +
               (stats.failures.length === 1 ? '' : 's') + ' returned 4xx, 5xx or never completed');
      for (var i = 0; i < stats.failures.length && i < SHOW_ERRORS; i++) {
        var f = stats.failures[i];
        var code = f.status === 0 ? '---' : String(f.status);
        out.line('    #' + f.idx + '  ' + code + '  ' + (f.method || '') + ' ' + clip(f.url, 66),
                 f.status >= 500 || f.status === 0 ? 't-err' : 't-warn');
      }
      if (stats.failures.length > SHOW_ERRORS) {
        out.line('    … ' + (stats.failures.length - SHOW_ERRORS) + ' more not listed', 't-dim');
      }
      out.line('');
      out.dim('Status --- is a request that produced no response: cancelled, blocked');
      out.dim('by an extension, DNS failure, or a preflight the server refused.');
    } else {
      out.ok('  No 4xx or 5xx responses.');
    }

    out.line('');
    var slow = stats.slow.slice().sort(function (a, b) { return b.time - a.time; });
    if (!slow.length) {
      out.dim('  No usable timings in this file.');
      return;
    }
    out.line('  Slowest requests', 't-info');
    for (var j = 0; j < slow.length && j < SHOW_SLOW; j++) {
      var s = slow[j];
      var label = '    ' + duration(s.time);
      while (label.length < 16) label += ' ';
      if (s.wait !== null && s.wait > 0) {
        var w = 'ttfb ' + Math.round(s.wait) + ' ms';
        while (w.length < 16) w += ' ';
        label += w;
      } else {
        label += ' '.repeat(16);
      }
      label += '#' + s.idx + '  ' + clip(s.url, 58);
      out.line(label, s.time > 3000 ? 't-warn' : null);
    }
    out.line('');
    out.dim('entry.time is the whole life of the request including queueing and');
    out.dim('blocked time, which is why a fast server can still appear slow here.');
    out.dim('ttfb is the wait phase alone — that one is the server.');
  }

  /* ---------------------------------------------------------------------- */
  /* Driver                                                                  */
  /* ---------------------------------------------------------------------- */
  var state = { text: null, name: '', size: 0 };

  function analyse(bytes, file) {
    out.clear();
    out.heading(file.name);
    out.row('size', LabTool.humanBytes(file.size || bytes.length) +
            '  (' + (file.size || bytes.length) + ' bytes)');

    /* Forget the previous file before anything can fail. Otherwise dropping a
       gzip on top of a HAR that analysed cleanly would leave the redact button
       armed and pointing at the old text, and hand back a download named after
       a file the visitor is no longer looking at. */
    state.text = null;
    setRedactEnabled(false);

    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      out.err('This is a gzip file, not JSON. Decompress it first — nothing here');
      out.err('unpacks archives, deliberately.');
      return;
    }
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
      out.err('This is a zip archive. Some browsers export HAR inside one —');
      out.err('extract the .har and drop that.');
      return;
    }

    var decoded = decodeText(bytes);
    state.text = decoded.text;
    state.name = file.name;
    state.size = bytes.length;
    if (decoded.enc !== 'UTF-8') out.row('text encoding', decoded.enc, 't-warn');

    var root;
    try {
      root = JSON.parse(decoded.text);
    } catch (err) {
      out.rule();
      describeParseFailure(decoded.text, err);
      state.text = null;
      setRedactEnabled(false);
      return;
    }

    var log = isObj(root) && isObj(root.log) ? root.log : null;
    if (!log) {
      out.rule();
      out.err('Parsed as JSON, but there is no "log" object at the top level, so');
      out.err('this is not a HAR. A HAR always looks like { "log": { ... } }.');
      setRedactEnabled(false);
      return;
    }

    var entries = arr(log.entries);
    var creator = isObj(log.creator) ? log.creator : {};
    out.row('HAR version', str(log.version) || 'not stated');
    out.row('exported by', (str(creator.name) || 'unknown') +
            (str(creator.version) ? ' ' + str(creator.version) : ''));
    if (isObj(log.browser) && str(log.browser.name)) {
      out.row('browser', str(log.browser.name) + ' ' + str(log.browser.version));
    }

    if (!entries.length) {
      out.rule();
      out.warn('The log contains no entries. An empty capture usually means the');
      out.warn('Network panel was cleared, or recording was off when it was saved.');
      setRedactEnabled(false);
      return;
    }

    var rep = newReport();
    var stats = newStats();

    try {
      analyseEntries(entries, rep, stats);
    } catch (err) {
      out.rule();
      out.err('Analysis stopped early: ' + (err && err.message ? err.message : err));
      out.dim('Everything found before that point is shown below. The file is');
      out.dim('probably malformed in a way this tool did not anticipate.');
    }

    /* ---- summary ---- */
    out.rule();
    out.heading('SUMMARY');
    out.row('pages', arr(log.pages).length);
    out.row('requests', entries.length);
    out.row('unique hosts', Object.keys(stats.hosts).length);
    out.row('transferred', LabTool.humanBytes(stats.transferred));
    out.row('content decoded', LabTool.humanBytes(stats.contentSize) +
            '  (after decompression)');
    if (stats.firstStart !== null) {
      out.row('first request', stats.firstRaw || new Date(stats.firstStart).toISOString());
      out.row('in UTC', new Date(stats.firstStart).toISOString());
      out.row('time span', duration(Math.max(0, stats.lastEnd - stats.firstStart)));
    }
    var methods = Object.keys(stats.methods).sort(function (a, b) {
      return stats.methods[b] - stats.methods[a];
    }).map(function (m) { return m + ' ' + stats.methods[m]; });
    out.row('methods', methods.join(', '));
    out.row('response bodies kept', stats.withBody + ' of ' + entries.length,
            stats.withBody ? 't-warn' : 't-ok');
    if (!stats.withBody) {
      out.dim('    exported without content — headers and cookies only');
    }
    out.row('distinct cookie names', Object.keys(stats.cookieNames).length);
    if (stats.insecure) {
      out.row('plain http requests', stats.insecure, 't-warn');
    }
    if (stats.cached) out.row('served from cache', stats.cached);
    if (stats.statusless) {
      out.row('no response status', stats.statusless, 't-warn');
      out.dim('    a response object with no status field — usually a half-written');
      out.dim('    capture, or an exporter that logs the request only');
    }

    /* ---- the headline ---- */
    reportSecrets(rep);
    reportPii(rep);

    reportHosts(stats, firstParty(log, entries, stats));
    reportSecurityHeaders(stats);
    reportTiming(stats);

    /* ---- caps actually hit ---- */
    if (rep.bodiesTruncated || rep.bodiesSkipped) {
      out.rule();
      out.warn('Scanning was capped to keep the page responsive:');
      if (rep.bodiesTruncated) {
        out.dim('  ' + rep.bodiesTruncated + ' body/bodies read only to the first ' +
                LabTool.humanBytes(BODY_SCAN_LIMIT) + '.');
      }
      if (rep.bodiesSkipped) {
        out.dim('  ' + rep.bodiesSkipped + ' body/bodies skipped — binary content, or the ' +
                LabTool.humanBytes(BODY_BUDGET) + ' total budget was used up.');
      }
      out.dim('  Redaction has no such cap: it rewrites every string in the file.');
    }

    /* ---- closing ---- */
    out.rule();
    out.heading('BEFORE YOU SEND THIS FILE');
    out.line('');
    out.dim('A HAR is not a log of what went wrong, it is a recording of the');
    out.dim('session. Cookies and Authorization headers in it are live until they');
    out.dim('expire or you revoke them, and an attachment on a ticket outlives the');
    out.dim('ticket. In order of preference: rotate the credentials, then re-record');
    out.dim('the capture in a private window with a throwaway account, and only');
    out.dim('then reach for redaction.');
    out.line('');
    if (rep.secrets.length) {
      out.ok('Use the redaction button: it replaces every secret above — plus all');
      out.ok('cookie values, Authorization headers, password fields and card');
      out.ok('numbers — and hands back a .har you can attach.');
    } else {
      out.dim('Redaction is still available, and still worth running: it blanks');
      out.dim('every cookie value and auth header whether or not it was flagged.');
    }
    out.line('');
    out.dim('Email addresses are left intact in the redacted copy on purpose —');
    out.dim('they are usually the account the ticket is about, and removing them');
    out.dim('makes the file useless to the person you are asking for help.');

    setRedactEnabled(true);
  }

  /* ---------------------------------------------------------------------- */
  /* Redaction                                                              */
  /* ---------------------------------------------------------------------- */
  function scrubText(text, tally) {
    if (typeof text !== 'string' || text.length < 8) return text;
    var result = text;
    for (var i = 0; i < SECRET_RULES.length; i++) {
      var rule = SECRET_RULES[i];
      if (!rule.scrub) continue;
      rule.re.lastIndex = 0;
      // test() first: on the overwhelmingly common miss it is much cheaper
      // than building a replacement string.
      if (!rule.re.test(result)) continue;
      rule.re.lastIndex = 0;
      result = result.replace(rule.re, (function (r) {
        return function (match, g1) {
          bump(tally, r.tag);
          // Rules with a capture group match name+value; keep the name so the
          // redacted file still shows which parameter was carrying the secret.
          if (r.group && g1) return match.replace(g1, '[REDACTED-' + r.tag + ']');
          return '[REDACTED-' + r.tag + ']';
        };
      })(rule));
    }
    if (/\d[\d \-]{11,}\d/.test(result)) {
      result = result.replace(CARD_RE, function (m) {
        if (isCard(m)) { bump(tally, 'CARD'); return '[REDACTED-CARD]'; }
        return m;
      });
    }
    return result;
  }

  /* Values whose name says "secret" go regardless of what they look like. */
  function scrubNamed(item, tally) {
    if (!isObj(item)) return;
    var name = str(item.name);
    if (SENSITIVE_NAME.test(name) || PASSWORDISH.test(name) ||
        (CODEISH.test(name) && str(item.value).length >= 16)) {
      if (str(item.value)) { item.value = '[REDACTED]'; bump(tally, 'NAMED'); }
    } else if (typeof item.value === 'string') {
      item.value = scrubText(item.value, tally);
    }
  }

  /* Keep cookie names and attributes, replace only values. A support engineer
     often needs to know which cookies were present; nobody needs their
     contents. */
  function scrubCookieHeader(value, tally) {
    return value.split(';').map(function (part) {
      var eq = part.indexOf('=');
      if (eq < 1) return part;
      bump(tally, 'COOKIE');
      return part.slice(0, eq) + '=[REDACTED]';
    }).join(';');
  }

  function scrubSetCookie(value, tally) {
    var semi = value.indexOf(';');
    var first = semi === -1 ? value : value.slice(0, semi);
    var rest = semi === -1 ? '' : value.slice(semi);
    var eq = first.indexOf('=');
    if (eq < 1) return value;
    bump(tally, 'COOKIE');
    return first.slice(0, eq) + '=[REDACTED]' + rest;
  }

  function scrubUrl(url, tally) {
    var result = String(url).replace(
      /([?&#](?:[a-z0-9_\-]*(?:token|key|secret|password|passwd|pwd|auth|session|sig|signature|code|otp)[a-z0-9_\-]*)=)([^&#]+)/gi,
      function (m, head) { bump(tally, 'URL-PARAM'); return head + '[REDACTED]'; });
    return scrubText(result, tally);
  }

  function scrubHeaders(headers, tally) {
    arr(headers).forEach(function (h) {
      if (!isObj(h)) return;
      var name = str(h.name).toLowerCase();
      var value = str(h.value);
      if (!value) return;
      if (name === 'authorization' || name === 'proxy-authorization') {
        // Keep the scheme: knowing it was Bearer rather than Basic is often
        // the whole question, and the scheme is not the secret.
        var m = /^\s*([A-Za-z][A-Za-z0-9\-_]*)\s+/.exec(value);
        h.value = (m ? m[1] + ' ' : '') + '[REDACTED]';
        bump(tally, 'AUTH-HEADER');
      } else if (name === 'cookie') {
        h.value = scrubCookieHeader(value, tally);
      } else if (name === 'set-cookie') {
        h.value = scrubSetCookie(value, tally);
      } else if (SECRET_HEADER.test(name)) {
        h.value = '[REDACTED]';
        bump(tally, 'SECRET-HEADER');
      } else if (name === 'location' || name === 'referer' || name === 'referrer') {
        h.value = scrubUrl(value, tally);
      } else {
        h.value = scrubText(value, tally);
      }
    });
  }

  function scrubEntry(entry, tally) {
    if (!isObj(entry)) return;
    var req = isObj(entry.request) ? entry.request : null;
    var res = isObj(entry.response) ? entry.response : null;

    if (req) {
      if (typeof req.url === 'string') req.url = scrubUrl(req.url, tally);
      scrubHeaders(req.headers, tally);
      arr(req.cookies).forEach(function (c) {
        if (isObj(c) && str(c.value)) { c.value = '[REDACTED]'; bump(tally, 'COOKIE'); }
      });
      arr(req.queryString).forEach(function (q) { scrubNamed(q, tally); });
      if (isObj(req.postData)) {
        arr(req.postData.params).forEach(function (p) { scrubNamed(p, tally); });
        if (typeof req.postData.text === 'string') {
          req.postData.text = scrubBody(req.postData.text, str(req.postData.mimeType), tally);
        }
      }
    }

    if (res) {
      if (typeof res.redirectURL === 'string' && res.redirectURL) {
        res.redirectURL = scrubUrl(res.redirectURL, tally);
      }
      scrubHeaders(res.headers, tally);
      arr(res.cookies).forEach(function (c) {
        if (isObj(c) && str(c.value)) { c.value = '[REDACTED]'; bump(tally, 'COOKIE'); }
      });
      var content = isObj(res.content) ? res.content : null;
      if (content && typeof content.text === 'string' && content.text) {
        scrubContent(content, tally);
      }
    }
  }

  /* Form and JSON bodies get name-based redaction on top of the pattern
     sweep, because a password is only recognisable by the field it is in. */
  function scrubBody(text, mime, tally) {
    var result = text;
    if (String(mime).indexOf('x-www-form-urlencoded') !== -1) {
      result = result.replace(
        /(^|&)([a-z0-9_\-.\[\]%]{1,64})=([^&]*)/gi,
        function (m, sep, name, value) {
          var plain = decodePlus(name);
          if (!value) return m;
          if (SENSITIVE_NAME.test(plain) || PASSWORDISH.test(plain) ||
              (CODEISH.test(plain) && value.length >= 16)) {
            bump(tally, 'FORM-FIELD');
            return sep + name + '=[REDACTED]';
          }
          return m;
        });
    }
    result = result.replace(
      /("([A-Za-z0-9_.\-]{1,48})"\s*:\s*")((?:[^"\\]|\\.)*?)(")/g,
      function (m, head, name, value, tail) {
        if (SENSITIVE_NAME.test(name) || PASSWORDISH.test(name) ||
            (CODEISH.test(name) && value.length >= 16)) {
          bump(tally, 'JSON-FIELD');
          return head + '[REDACTED]' + tail;
        }
        return m;
      });
    return scrubText(result, tally);
  }

  /* Note that size, bodySize and headersSize are left alone throughout. They
     describe the original transfer, and a support engineer reading the
     redacted copy still wants the real numbers — a body that shrank because a
     token was replaced should not make the capture claim it was 40 bytes
     smaller on the wire. */
  function scrubContent(content, tally) {
    var mime = str(content.mimeType);
    var isBase64 = str(content.encoding).toLowerCase() === 'base64';

    if (isBase64) {
      // Images, fonts and media hold nothing worth scanning, and decoding a
      // few megabytes of PNG to run regexes over it is the slowest possible
      // way to find nothing.
      if (BINARY_MIME.test(mime)) return;
      var plain;
      try { plain = atob(content.text.replace(/\s+/g, '')); }
      catch (e) { return; }                       // leave undecodable base64 alone
      var scrubbed = scrubBody(plain, mime, tally);
      if (scrubbed === plain) return;
      try {
        content.text = btoa(scrubbed);
      } catch (e2) {
        // btoa only accepts latin1. Our replacements are ASCII so this should
        // not happen, but if the body was re-encoded oddly, drop it rather
        // than ship a body we could not verify.
        content.text = btoa('[REDACTED BODY — could not be re-encoded safely]');
        content.size = content.text.length;
        bump(tally, 'BODY-DROPPED');
      }
      return;
    }
    content.text = scrubBody(content.text, mime, tally);
  }

  /* Final sweep over everything else: WebSocket frames, _initiator stacks,
     vendor `_` extensions, comments. Exporters invent fields freely and a
     token pasted into one of them is just as live. */
  function deepScrub(node, depth, tally, counter) {
    if (depth > 64 || counter.n > SCRUB_NODE_LIMIT) return node;
    if (typeof node === 'string') {
      counter.n++;
      // Cheap gate: every pattern here needs a long token, a PEM header or a
      // 13-digit run, and most strings in a HAR are short header names and
      // mime types. 12 is below the shortest thing that can possibly match.
      if (node.length < 12) return node;
      if (!/[A-Za-z0-9_\-+/]{16,}/.test(node) && node.indexOf('BEGIN') === -1 &&
          !/\d[\d \-]{11,}\d/.test(node)) return node;
      return scrubText(node, tally);
    }
    if (!isObj(node)) return node;
    var i;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (i = 0; i < node.length; i++) node[i] = deepScrub(node[i], depth + 1, tally, counter);
      return node;
    }
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) {
        node[k] = deepScrub(node[k], depth + 1, tally, counter);
      }
    }
    return node;
  }

  function redact() {
    if (!state.text) {
      out.line('');
      out.warn('Load a HAR first — there is nothing to redact.');
      return;
    }
    out.line('');
    out.rule();
    out.heading('REDACTING');
    out.dim('Re-parsing the original text so the copy is built from the file as');
    out.dim('it was, not from anything shown above. On a large HAR this takes a');
    out.dim('few seconds — every string in the file is rewritten, not a sample.');

    var root;
    try {
      root = JSON.parse(state.text);
    } catch (err) {
      out.err('The file no longer parses: ' + (err && err.message ? err.message : err));
      return;
    }

    var tally = Object.create(null);
    var counter = { n: 0 };
    try {
      var log = isObj(root) && isObj(root.log) ? root.log : null;
      if (!log) { out.err('No log object — nothing to redact.'); return; }
      arr(log.entries).forEach(function (entry) { scrubEntry(entry, tally); });
      deepScrub(root, 0, tally, counter);

      // A legal HAR field, so no parser breaks, and the next person to open
      // the file learns immediately that it is not the original.
      log.comment = (str(log.comment) ? str(log.comment) + ' | ' : '') +
        'Redacted in-browser by the Labs HAR analyzer on ' + new Date().toISOString() +
        '. Credentials, cookie values, auth headers, password fields and card ' +
        'numbers were replaced with [REDACTED...] markers. Best effort only — ' +
        'review before sharing.';
    } catch (err2) {
      out.err('Redaction failed: ' + (err2 && err2.message ? err2.message : err2));
      out.dim('No file was produced. Nothing was sent anywhere either — this all');
      out.dim('happened in the tab.');
      return;
    }

    var json;
    try {
      json = JSON.stringify(root, null, 2);
    } catch (err3) {
      try { json = JSON.stringify(root); }
      catch (err4) {
        out.err('The redacted copy was too large to serialise in this tab.');
        return;
      }
    }

    var name = state.name.replace(/\.har$/i, '') + '.redacted.har';
    LabTool.download(new TextEncoder().encode(json), name, 'application/json');

    out.line('');
    out.ok('Saved ' + name + '  (' + LabTool.humanBytes(json.length) + ')');
    out.line('');
    var keys = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
    if (!keys.length) {
      out.dim('Nothing matched, so the copy differs from the original only by the');
      out.dim('note added to log.comment.');
    } else {
      out.line('replacements made:', 't-info');
      keys.forEach(function (k) { out.row('  ' + k, tally[k]); });
    }
    if (counter.n > SCRUB_NODE_LIMIT) {
      out.line('');
      out.warn('The final sweep stopped after ' + SCRUB_NODE_LIMIT.toLocaleString() +
               ' strings. Structured fields');
      out.warn('(headers, cookies, bodies) were all still redacted; treat the tail');
      out.warn('of a file this size as unchecked.');
    }
    out.line('');
    out.warn('Check the result before sending it. Redaction is pattern matching:');
    out.warn('an opaque session id in a field called "u" looks like every other');
    out.warn('random string, and this cannot tell them apart. It is a safety net,');
    out.warn('not a guarantee — rotating what leaked is the guarantee.');
  }

  function setRedactEnabled(on) {
    var btn = document.getElementById('tool-redact');
    if (btn) btn.disabled = !on;
  }

  /* ---------------------------------------------------------------------- */
  LabTool.define({
    id: 'haranalyzertool',
    run: function () {
      if (!state.text) {
        out.clear().warn('Choose or drop a .har file to analyse.');
        return;
      }
      var text = state.text, name = state.name, size = state.size;
      // Re-run from the text already in memory; re-reading the file would
      // need another FileReader round trip for no benefit.
      analyse(new TextEncoder().encode(text), { name: name, size: size });
    },
    onReady: function () {
      setRedactEnabled(false);
      var btn = document.getElementById('tool-redact');
      if (btn) btn.addEventListener('click', function () {
        try { redact(); }
        catch (err) { out.err('Redaction failed: ' + (err && err.message ? err.message : err)); }
      });

      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          var label = document.getElementById('tool-dropname');
          if (label) label.textContent = file.name;
          try {
            analyse(bytes, file);
          } catch (err) {
            out.clear().err('That file could not be analysed: ' +
                            (err && err.message ? err.message : err));
            out.dim('Nothing was uploaded — the failure happened in this tab.');
            setRedactEnabled(false);
          }
        },
        onError: function (msg) { out.clear().err(msg); setRedactEnabled(false); }
      });

      out.dim('Drop the .har you were about to email to support.');
      out.dim('');
      out.dim('It is the browser Network tab saved as JSON, which means every');
      out.dim('request header — Cookie, Authorization — and every Set-Cookie the');
      out.dim('server sent back. If it was exported with content, the response');
      out.dim('bodies are in there too. This reads all of it and tells you what');
      out.dim('you would be handing over, then offers a redacted copy.');
      out.dim('');
      out.dim('Up to 64 MB. Nothing is uploaded: the file is read and rewritten');
      out.dim('here, and the redacted copy comes back as a download.');
    }
  });
})();

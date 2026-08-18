/* ==========================================================================
   password.js — entropy, crack-time estimates, and a generator.
   --------------------------------------------------------------------------
   Most "strength meters" score the shape of a password: a capital, a digit,
   a symbol, tick, "Strong". That is why P@ssw0rd1 scores well and is in every
   wordlist ever assembled. This one measures entropy instead, and separately
   penalises the patterns that make a high-entropy-looking password weak —
   dictionary words, keyboard runs, dates, leetspeak substitutions.

   The generator uses crypto.getRandomValues, not Math.random. Math.random is
   not a cryptographic source and must never pick a password.

   Nothing is transmitted. A password strength checker with a server behind it
   is a password collection service with a helpful interface.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  var COMMON = ['password','123456','qwerty','letmein','welcome','admin','login',
    'iloveyou','monkey','dragon','sunshine','princess','football','baseball',
    'master','shadow','superman','trustno1','abc123','passw0rd','root','toor',
    'changeme','secret','summer','winter','spring','autumn','india','krunal'];

  var KEYBOARD = ['qwerty','asdf','zxcv','1234','qazwsx','yuiop','hjkl','wasd',
    '098765','4321','poiuy','lkjh'];

  function charsetSize(pw) {
    var size = 0;
    if (/[a-z]/.test(pw)) size += 26;
    if (/[A-Z]/.test(pw)) size += 26;
    if (/[0-9]/.test(pw)) size += 10;
    if (/[^A-Za-z0-9]/.test(pw)) size += 33;
    return size || 1;
  }

  function deLeet(pw) {
    return pw.toLowerCase()
      .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i')
      .replace(/[0]/g, 'o').replace(/[5$]/g, 's').replace(/[7]/g, 't');
  }

  function findPatterns(pw) {
    var issues = [];
    var lower = pw.toLowerCase();
    var plain = deLeet(pw);

    COMMON.forEach(function (w) {
      if (lower.indexOf(w) !== -1) issues.push('contains the common password "' + w + '"');
      else if (plain.indexOf(w) !== -1)
        issues.push('is "' + w + '" with character substitutions — wordlists expand those automatically');
    });
    KEYBOARD.forEach(function (k) {
      if (lower.indexOf(k) !== -1) issues.push('contains the keyboard run "' + k + '"');
    });
    if (/(.)\1{2,}/.test(pw)) issues.push('has a character repeated three or more times');
    if (/(19|20)\d{2}/.test(pw)) issues.push('contains what looks like a year');
    if (/^[A-Z][a-z]+\d{1,4}[!@#$]?$/.test(pw))
      issues.push('follows the Capital + word + digits + symbol pattern almost everyone uses');
    if (/^\d+$/.test(pw)) issues.push('is digits only');
    if (/^[a-z]+$/.test(pw)) issues.push('is lowercase letters only');
    return issues;
  }

  /* Guesses per second, offline, against each hash — the number that actually
     decides how long a password survives once a database leaks. */
  var SPEEDS = [
    { name: 'MD5, unsalted', rate: 1e11 },
    { name: 'SHA-256, unsalted', rate: 2e10 },
    { name: 'bcrypt, cost 10', rate: 5e4 },
    { name: 'Argon2id, sane params', rate: 5e3 }
  ];

  /* Attackers do not brute-force the whole keyspace. They run a wordlist
     through a rule set, and when a password decomposes into "known word plus
     short suffix" the real work is only: which word, which rule, and the
     suffix. That is a far smaller number than raw entropy suggests, and
     subtracting a flat penalty per pattern does not capture it — P@ssw0rd1
     has 59 raw bits and is cracked in well under a second. So a password that
     decomposes this way gets a hard ceiling instead. */
  var WORDLIST_BITS = 14;   // position within a real cracking list
  var RULE_BITS = 6;        // which mangling rule produced this form

  function suffixBits(suffix) {
    if (!suffix) return 0;
    if (/^(19|20)\d{2}[^0-9]?$/.test(suffix)) return 7;   // a year, maybe a symbol
    if (/^\d+$/.test(suffix)) return suffix.length * 3.32;
    return suffix.length * 5.4;
  }

  function structuralCeiling(pw) {
    /* Split the trailing suffix off BEFORE de-leeting. Doing it the other way
       round turns the 1 in P@ssw0rd1 into an i, leaving "passwordi", which
       matches nothing — and that single ordering mistake is what makes the
       most-cracked password shape on earth look like it takes hours. */
    var m = String(pw).match(/^(.*?)([0-9!@#$%^&*_.\-]*)$/);
    var base = deLeet(m[1]), suffix = m[2];
    var known = COMMON.indexOf(base) !== -1 || KEYBOARD.indexOf(base) !== -1;
    if (!known) return Infinity;
    return WORDLIST_BITS + RULE_BITS + suffixBits(suffix);
  }

  function humanTime(seconds) {
    if (seconds < 1) return 'instantly';
    var units = [['second', 60], ['minute', 60], ['hour', 24], ['day', 365], ['year', 0]];
    var value = seconds, i = 0;
    while (i < units.length - 1 && value >= units[i][1]) { value /= units[i][1]; i++; }
    if (units[i][0] === 'year' && value > 1e6) {
      return value.toExponential(1) + ' years';
    }
    return Math.round(value) + ' ' + units[i][0] + (Math.round(value) === 1 ? '' : 's');
  }

  function analyse(pw) {
    out.clear();
    if (!pw) { out.warn('Type a password to analyse. It is never sent anywhere.'); return; }

    var size = charsetSize(pw);
    var bits = pw.length * (Math.log(size) / Math.LN2);
    var issues = findPatterns(pw);
    // Each recognised pattern removes roughly the work a cracker skips, and a
    // password that is a wordlist entry plus a suffix is capped outright.
    var ceiling = structuralCeiling(pw);
    var effective = Math.max(4, Math.min(bits - issues.length * 8, ceiling));

    out.heading('Composition');
    out.row('length', pw.length + ' characters');
    out.row('character set', size + ' possible symbols per position');
    out.row('raw entropy', bits.toFixed(1) + ' bits');
    if (issues.length) {
      out.row('effective entropy', effective.toFixed(1) + ' bits', 't-warn');
    } else {
      out.row('effective entropy', effective.toFixed(1) + ' bits', 't-ok');
    }

    out.rule();
    out.heading('Time to crack offline');
    out.dim('assuming the attacker has the hash and can guess at full speed');
    SPEEDS.forEach(function (s) {
      var guesses = Math.pow(2, effective) / 2;
      var seconds = guesses / s.rate;
      var cls = seconds < 3600 ? 't-err' : (seconds < 31536000 * 100 ? 't-warn' : 't-ok');
      out.row(s.name, humanTime(seconds), cls);
    });

    out.rule();
    if (issues.length) {
      out.heading('Why the effective figure is lower');
      issues.forEach(function (i) { out.line('  · ' + i, 't-warn'); });
      if (ceiling !== Infinity) {
        out.line('');
        out.err('This is a wordlist entry with a predictable modification, so');
        out.err('the raw entropy above is meaningless. An attacker does not');
        out.err('guess blindly — they run a list of common passwords through a');
        out.err('set of mangling rules, and this password falls out of that in');
        out.err('roughly ' + Math.round(Math.pow(2, ceiling)).toExponential(1) +
                ' guesses rather than ' + Math.pow(2, bits).toExponential(1) + '.');
      }
      out.line('');
      out.dim('Raw entropy assumes an attacker guesses blindly. They do not —');
      out.dim('they run wordlists and rule sets first, and every pattern above');
      out.dim('is one those rules already cover.');
    } else {
      out.ok('No common patterns detected.');
      out.dim('Nothing here matched a wordlist, keyboard run, date or the usual');
      out.dim('Capital-word-digits shape.');
    }

    out.rule();
    out.dim('Length beats complexity. Four random words are stronger and far');
    out.dim('easier to type than a short string of symbols — and a password');
    out.dim('manager makes both arguments moot.');
  }

  function generate() {
    var mode = document.getElementById('tool-genmode').value;
    var length = parseInt(document.getElementById('tool-genlen').value, 10) || 20;
    var value;

    if (mode === 'passphrase') {
      var words = ['anchor','ballad','cactus','dagger','ember','falcon','granite','harbor',
        'ivory','jungle','kernel','lantern','marble','nebula','orchid','pepper','quartz',
        'ribbon','saffron','timber','umbra','velvet','walnut','xenon','yonder','zephyr',
        'cobalt','driftwood','eclipse','fathom','glacier','hollow'];
      var picked = [];
      var rand = new Uint32Array(6);
      crypto.getRandomValues(rand);
      for (var i = 0; i < 5; i++) picked.push(words[rand[i] % words.length]);
      value = picked.join('-') + '-' + (rand[5] % 100);
    } else {
      var alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      if (mode === 'symbols') alphabet += '!@#$%^&*()-_=+[]{};:,.<>?';
      var bytes = new Uint32Array(length);
      crypto.getRandomValues(bytes);
      value = '';
      for (var j = 0; j < length; j++) value += alphabet[bytes[j] % alphabet.length];
    }

    document.getElementById('tool-text').value = value;
    analyse(value);
    out.rule();
    out.ok('Generated with crypto.getRandomValues — the browser’s cryptographic');
    out.ok('random source, not Math.random, which must never pick a password.');
  }

  LabTool.define({
    id: 'passwordtool',
    run: function () { analyse(document.getElementById('tool-text').value); },
    onReady: function () {
      document.getElementById('tool-generate').addEventListener('click', generate);
      document.getElementById('tool-text').addEventListener('input', function (e) {
        if (e.target.value.length > 2) analyse(e.target.value);
      });
      out.dim('Type a password above. It is analysed as you type, in this tab,');
      out.dim('and never transmitted — check the Network tab if you like.');
    }
  });
})();

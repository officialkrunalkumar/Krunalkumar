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

  /* `generated` is supplied only by generate(), as { bits, how }.

     It is the difference between knowing and guessing. For anything typed in,
     entropy has to be inferred from the characters, because how the password
     was chosen is unknowable — that is what charsetSize() and findPatterns()
     are for, and they stay in charge of that case. For something this page just
     generated, the entropy is known exactly: it is a property of the draw, not
     of the spelling. Measuring the characters instead is what let six random
     words read as 226 bits.

     Nothing else calls analyse() with a second argument, so every other caller
     keeps the behaviour it had. Editing a generated value fires the input
     handler with one argument, which correctly drops back to inference. */
  function analyse(pw, generated) {
    out.clear();
    if (!pw) { out.warn('Type a password to analyse. It is never sent anywhere.'); return; }

    // Called with one argument by the Analyse button, by Ctrl+Enter and by the
    // input listener. If the field still holds exactly what generate() made,
    // the provenance is still known and must not be re-guessed from spelling.
    if (!generated && lastGenerated && lastGenerated.value === pw) {
      generated = lastGenerated;
    }

    var size = charsetSize(pw);
    var issues = generated ? [] : findPatterns(pw);
    var bits, effective, ceiling;

    if (generated) {
      bits = effective = generated.bits;
      ceiling = Infinity;
    } else {
      bits = pw.length * (Math.log(size) / Math.LN2);
      // Each recognised pattern removes roughly the work a cracker skips, and a
      // password that is a wordlist entry plus a suffix is capped outright.
      ceiling = structuralCeiling(pw);
      effective = Math.max(4, Math.min(bits - issues.length * 8, ceiling));
    }

    out.heading('Composition');
    out.row('length', pw.length + ' characters');
    if (generated) {
      out.row('drawn as', generated.how);
      out.row('entropy', bits.toFixed(1) + ' bits', 't-ok');
      if (generated.kind === 'passphrase') {
        out.dim('Measured from the draw, not from the spelling — the words being');
        out.dim('dictionary words costs nothing when each one was chosen at random.');
      } else {
        // "the words being dictionary words" is meaningless for a random
        // character string, and symbols is the default mode.
        out.dim('Measured from the draw, not from the spelling — every position');
        out.dim('was chosen independently, so length times alphabet size is exact.');
      }
    } else {
      out.row('character set', size + ' possible symbols per position');
      out.row('raw entropy', bits.toFixed(1) + ' bits');
      out.row('effective entropy', effective.toFixed(1) + ' bits',
              issues.length ? 't-warn' : 't-ok');
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
    } else if (generated) {
      out.ok('Chosen at random by this page, so there is no pattern to find.');
      if (generated.kind === 'passphrase') {
        // Saying "nothing matched a wordlist" would be false here — the words
        // ARE wordlist entries. The point is that it does not matter.
        out.dim('An attacker who knows the exact list and the exact method still');
        out.dim('faces every combination of it, which is what the figure above');
        out.dim('counts. Secrecy of the wordlist is not what makes this strong.');
      } else {
        // The character modes draw from an alphabet, not a wordlist, so the
        // wordlist wording above would be nonsense. symbols is the default
        // mode, so this is what most visitors see first.
        out.dim('Every character was drawn independently from the full alphabet,');
        out.dim('so there is no word, date or keyboard run for a rule set to');
        out.dim('exploit — the figure above is the whole search space.');
      }
    } else {
      out.ok('No common patterns detected.');
      out.dim('Nothing here matched a wordlist, keyboard run, date or the usual');
      out.dim('Capital-word-digits shape.');
    }

    out.rule();
    out.dim('Length beats complexity. Six random words are stronger and far');
    out.dim('easier to type than a short string of symbols — and a password');
    out.dim('manager makes both arguments moot.');
  }

  /* Diceware, done to the actual standard: 7776 words, six of them.

     The list this used to carry held 32 words, and five of those plus a
     two-digit number is 5*log2(32) + log2(100) = 31.6 bits — about 3.4 billion
     guesses, which is seconds of work. The page then measured the *spelling* of
     the result (37 characters over a 69-symbol set) and printed 226 bits, so
     the weakest thing the tool could produce was also the strongest thing it
     claimed. Both halves are fixed here: the list is the real one, and the
     entropy is carried out of the generator as a number rather than re-derived
     from the characters. */
  var lastGenerated = null;   // { value, bits, how, kind } from the last generate()

  /* Six is the Diceware standard and the floor, not a default that the length
     control may bargain down. The control is labelled in characters, and EFF
     words are short — two of them clear "16 characters" — so honouring it as a
     word count would hand out a 25-bit passphrase under a heading that says the
     generator is cryptographically sound. That is the exact failure this file
     already exists to have fixed once. The control raises the count; it never
     lowers it. */
  var PASSPHRASE_MIN_WORDS = 6;
  /* Purely a runaway stop. Every added word contributes at least four
     characters, so the loop below terminates on its own; this bounds it anyway
     in case the option list ever grows a value nobody thought about. */
  var PASSPHRASE_MAX_WORDS = 24;
  var EFF_WORDLIST_SIZE = 7776;

  /* Uniform in [0, n). `x % n` on its own is biased whenever n does not divide
     2^32 — the low (2^32 mod n) values come up once more often than the rest.
     The bias is around 1 part in 1.7 million for the wordlist and nothing a
     visitor would ever observe, but a password generator is precisely the place
     not to hand-wave a known-biased shortcut. Rejection sampling costs one
     extra draw about six times in ten million. */
  function randomIndex(n) {
    var limit = Math.floor(4294967296 / n) * n;
    var buf = new Uint32Array(1);
    var x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % n;
  }

  function generate() {
    var mode = document.getElementById('tool-genmode').value;
    var length = parseInt(document.getElementById('tool-genlen').value, 10) || 20;
    var value, knownBits, provenance;

    if (mode === 'passphrase') {
      var words = (typeof EFF_LONG_WORDLIST !== 'undefined') ? EFF_LONG_WORDLIST : null;
      // Refuse rather than degrade. Falling back to a shorter list would hand
      // out a weak passphrase under a strong-looking number, which is the exact
      // failure this rewrite exists to remove.
      if (!words || words.length !== EFF_WORDLIST_SIZE) {
        out.clear();
        out.err('The wordlist did not load, so nothing was generated.');
        out.dim('A passphrase is only as strong as the list it is drawn from, so');
        out.dim('this will not quietly fall back to a smaller one. Reload the page.');
        return;
      }
      /* The length control used to be read for the character modes only, so in
         passphrase mode the visitor changed it and nothing whatsoever happened
         — a control that lies about having an effect. It is labelled in
         characters, so that is what it means here: draw the standard six words,
         then keep drawing until the joined result is at least as long as asked.

         Which is not cosmetic. EFF long-list words run from three letters up,
         so six of them plus separators can land at 23 characters — under the
         24- and 32-character settings — and a seventh word is genuinely needed.
         Adding words rather than truncating is also the only direction that is
         safe: cutting a passphrase to fit a character count would throw away
         exactly the entropy the figure above it claims. */
      var picked = [];
      while (picked.length < PASSPHRASE_MIN_WORDS ||
             (picked.join('-').length < length && picked.length < PASSPHRASE_MAX_WORDS)) {
        picked.push(words[randomIndex(words.length)]);
      }
      value = picked.join('-');
      // Counted from the draw that actually happened, not from the constant.
      // The whole point of carrying bits out of the generator is that it is the
      // real number; hardcoding six here would reintroduce the mismatch in
      // miniature the moment a seventh word is drawn.
      knownBits = picked.length * (Math.log(words.length) / Math.LN2);
      provenance = picked.length + ' words drawn uniformly from the EFF long ' +
                   'wordlist (' + words.length + ' words, ' +
                   (Math.log(words.length) / Math.LN2).toFixed(1) + ' bits each)';
    } else {
      var alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      if (mode === 'symbols') alphabet += '!@#$%^&*()-_=+[]{};:,.<>?';
      value = '';
      for (var j = 0; j < length; j++) value += alphabet[randomIndex(alphabet.length)];
      knownBits = length * (Math.log(alphabet.length) / Math.LN2);
      provenance = length + ' characters drawn uniformly from a ' + alphabet.length +
                   '-symbol alphabet';
    }

    document.getElementById('tool-text').value = value;
    // Remembered, not just passed. The "Analyse" button beside Generate calls
    // analyse(field.value) with ONE argument, so without this it re-infers from
    // the characters and reports a completely different number for the very
    // string this function just produced — 294 bits against 77.5 for a
    // passphrase. Two figures for one password is worse than one wrong figure.
    //
    // Keyed on the exact string, so it self-expires: the moment the visitor
    // edits the field the values no longer match and inference takes over
    // again, which is the correct behaviour for a password we no longer know
    // the provenance of.
    lastGenerated = { value: value, bits: knownBits, how: provenance, kind: mode };
    analyse(value, lastGenerated);
    out.rule();
    out.ok('Generated with crypto.getRandomValues — the browser’s cryptographic');
    out.ok('random source, not Math.random, which must never pick a password.');
  }

  LabTool.define({
    id: 'passwordtool',
    run: function () { analyse(document.getElementById('tool-text').value); },
    onReady: function () {
      document.getElementById('tool-generate').addEventListener('click', generate);
      // One or two characters is not worth a verdict, but doing nothing at all
      // left the PREVIOUS verdict standing — clear the box after typing
      // "password123" and the pane still read "length 11 characters, effective
      // entropy 30.0 bits" about a string that was no longer there. A stale
      // number the visitor believes is about what they are looking at is worse
      // than no number. analyse('') already prints exactly the "type a
      // password" line the tool opens with, so the short case reuses it rather
      // than spelling the same sentence out a second time.
      document.getElementById('tool-text').addEventListener('input', function (e) {
        analyse(e.target.value.length > 2 ? e.target.value : '');
      });
      out.dim('Type a password above. It is analysed as you type, in this tab,');
      out.dim('and never transmitted — check the Network tab if you like.');
    }
  });
})();

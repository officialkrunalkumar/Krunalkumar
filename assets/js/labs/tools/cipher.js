/* ==========================================================================
   cipher.js — classical ciphers, frequency analysis, and an automatic break.
   --------------------------------------------------------------------------
   None of these are secure and that is the lesson. Caesar and Vigenère were
   state-of-the-art for centuries; here a browser breaks a Caesar cipher in
   about a millisecond by trying all 25 keys, and breaks a Vigenère by finding
   the key length from index of coincidence. Seeing that happen is a better
   argument for modern cryptography than being told "don't roll your own".

   The XOR mode is included because it turns up constantly in malware analysis
   and CTFs — single-byte XOR is the most common "obfuscation" in the wild, and
   it falls to the same brute force for the same reason.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* English letter frequencies, used to score candidate plaintexts. */
  var ENGLISH = [8.17,1.49,2.78,4.25,12.70,2.23,2.02,6.09,6.97,0.15,0.77,4.03,
    2.41,6.75,7.51,1.93,0.10,5.99,6.33,9.06,2.76,0.98,2.36,0.15,1.97,0.07];

  function shift(text, n) {
    return text.replace(/[a-z]/gi, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + n + 26) % 26 + base);
    });
  }

  function atbash(text) {
    return text.replace(/[a-z]/gi, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(base + 25 - (c.charCodeAt(0) - base));
    });
  }

  function vigenere(text, key, dir) {
    var k = String(key).toUpperCase().replace(/[^A-Z]/g, '');
    if (!k) return text;
    var i = 0;
    return text.replace(/[a-z]/gi, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      var offset = (k.charCodeAt(i % k.length) - 65) * dir;
      i++;
      return String.fromCharCode((c.charCodeAt(0) - base + offset + 26) % 26 + base);
    });
  }

  function xorText(text, key) {
    var k = String(key);
    if (!k) return text;
    var result = '';
    for (var i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    }
    return result;
  }

  function counts(text) {
    var c = new Array(26).fill(0), total = 0;
    text.toUpperCase().replace(/[A-Z]/g, function (ch) {
      c[ch.charCodeAt(0) - 65]++; total++; return ch;
    });
    return { c: c, total: total };
  }

  /* Chi-squared against English letter frequencies — lower is more English.
     Returns a large finite number rather than Infinity for text with no
     letters in it: candidate lists get sorted by difference, and
     Infinity - Infinity is NaN, which makes a comparator invalid and leaves
     the whole sort in an implementation-defined order. */
  var NOT_ENGLISH = 1e9;
  function score(text) {
    var f = counts(text);
    if (!f.total) return NOT_ENGLISH;
    var chi = 0;
    for (var i = 0; i < 26; i++) {
      var expected = f.total * ENGLISH[i] / 100;
      var diff = f.c[i] - expected;
      chi += diff * diff / (expected || 1);
    }
    return chi;
  }

  /* Common English bigrams, roughly percent of all bigrams. Letter frequency
     alone cannot finish the job: a Vigenère key with one letter wrong still
     produces near-perfect single-letter statistics, because every letter is
     still a permutation of a correct column. Its bigrams collapse, though —
     "THE" becomes "TIE" — so this is what separates the right key from the
     nearly-right one. */
  var BIGRAMS = {
    TH: 3.56, HE: 3.07, IN: 2.43, ER: 2.05, AN: 1.99, RE: 1.85, ON: 1.76,
    AT: 1.49, EN: 1.45, ND: 1.35, TI: 1.34, ES: 1.34, OR: 1.28, TE: 1.20,
    OF: 1.17, ED: 1.17, IS: 1.13, IT: 1.12, AL: 1.09, AR: 1.07, ST: 1.05,
    TO: 1.05, NT: 1.04, NG: 0.95, SE: 0.93, HA: 0.93, AS: 0.87, OU: 0.87,
    IO: 0.83, LE: 0.83, VE: 0.83, CO: 0.79, ME: 0.79, DE: 0.76, HI: 0.76,
    RI: 0.73, RO: 0.73, IC: 0.70, NE: 0.69, EA: 0.69, RA: 0.69, CE: 0.65,
    LI: 0.62, CH: 0.60, LL: 0.58, BE: 0.58, MA: 0.57, SI: 0.55, OM: 0.55,
    UR: 0.54, CA: 0.53, EL: 0.53, TA: 0.53, LA: 0.53, NS: 0.51, DI: 0.50,
    FO: 0.50, HO: 0.49, PE: 0.49, EC: 0.48, PR: 0.48, NO: 0.48, CT: 0.46,
    US: 0.45, AC: 0.45, IL: 0.43, WA: 0.43, UT: 0.42, WH: 0.42
  };

  /* Higher is more English. Random letters score around 0.08; real prose
     lands between 0.35 and 0.6. */
  function bigramScore(text) {
    var t = String(text).toUpperCase().replace(/[^A-Z]/g, '');
    if (t.length < 2) return 0;
    var total = 0;
    for (var i = 0; i < t.length - 1; i++) {
      total += BIGRAMS[t.substr(i, 2)] || 0;
    }
    return total / (t.length - 1);
  }

  /* Index of coincidence: ~0.067 for English, ~0.038 for random text. This is
     what reveals a Vigenère key length — split the text into N columns and the
     IC jumps to English levels once N is the real key length. */
  function ic(text) {
    var f = counts(text);
    if (f.total < 2) return 0;
    var sum = 0;
    for (var i = 0; i < 26; i++) sum += f.c[i] * (f.c[i] - 1);
    return sum / (f.total * (f.total - 1));
  }

  function breakCaesar(text) {
    var best = [];
    for (var n = 1; n < 26; n++) {
      var candidate = shift(text, -n);
      best.push({ key: n, text: candidate, score: score(candidate) });
    }
    best.sort(function (a, b) { return a.score - b.score; });
    return best;
  }

  function breakXor(text) {
    var best = [];
    for (var k = 1; k < 256; k++) {
      var candidate = '', printable = 0;
      for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i) ^ k;
        // Anything above 0x7f is not plaintext produced by a single-byte XOR
        // over ASCII, and control characters other than tab/newline are not
        // plaintext either.
        if (code > 0x7e || (code < 0x20 && code !== 9 && code !== 10 && code !== 13)) {
          printable--;
        } else {
          printable++;
        }
        candidate += String.fromCharCode(code);
      }
      if (printable < text.length * 0.9) continue;
      best.push({ key: k, text: candidate, score: bigramScore(candidate) });
    }
    // Bigram score: higher is better, so this sorts descending.
    best.sort(function (a, b) { return b.score - a.score; });
    return best;
  }

  /* Hill-climb the key one position at a time, keeping whichever letter makes
     the whole decryption read most like English. This is what turns a key
     that is one letter off — the usual outcome of per-column frequency
     analysis on short text — into the right one. */
  function refineKey(clean, key) {
    var letters = key.split('');
    for (var pass = 0; pass < 4; pass++) {
      var changed = false;
      for (var p = 0; p < letters.length; p++) {
        var bestLetter = letters[p];
        var bestValue = bigramScore(vigenere(clean, letters.join(''), -1));
        for (var s = 0; s < 26; s++) {
          if (A[s] === letters[p]) continue;
          var trial = letters.slice();
          trial[p] = A[s];
          var value = bigramScore(vigenere(clean, trial.join(''), -1));
          if (value > bestValue) { bestValue = value; bestLetter = A[s]; }
        }
        if (bestLetter !== letters[p]) { letters[p] = bestLetter; changed = true; }
      }
      if (!changed) break;
    }
    return letters.join('');
  }

  /* Index of coincidence alone is not a reliable test on short ciphertext:
     with a six-letter key and 150 characters each column holds only 25
     letters, and the estimate is far too noisy to threshold against 0.067.
     So the IC is still computed and shown — it is the part worth teaching —
     but the decision is made by actually deriving a key for every candidate
     length, decrypting, and scoring the result. A wrong length produces
     garbage and scores terribly; the right one produces English. */
  function breakVigenere(text) {
    var clean = text.toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length < 40) return null;

    var maxLen = Math.min(16, Math.floor(clean.length / 3));
    var lengths = [];
    for (var n = 1; n <= maxLen; n++) {
      var icTotal = 0;
      var key = '';
      for (var col = 0; col < n; col++) {
        var column = '';
        for (var i = col; i < clean.length; i += n) column += clean[i];
        icTotal += ic(column);
        var bestShift = 0, bestScore = Infinity;
        for (var s = 0; s < 26; s++) {
          var sc = score(shift(column, -s));
          if (sc < bestScore) { bestScore = sc; bestShift = s; }
        }
        key += A[bestShift];
      }
      key = refineKey(clean, key);
      lengths.push({
        n: n, ic: icTotal / n, key: key,
        fit: bigramScore(vigenere(clean, key, -1))
      });
    }

    var best = lengths.reduce(function (a, b) { return b.fit > a.fit ? b : a; });
    // Multiples of the true key length decrypt just as correctly, so among the
    // lengths that fit essentially as well, the shortest is the real one.
    var chosen = lengths.filter(function (l) { return l.fit >= best.fit * 0.97; })
                        .sort(function (a, b) { return a.n - b.n; })[0];
    // Random letters score around 0.08; real English lands well above 0.25.
    if (!chosen || chosen.fit < 0.25) return { lengths: lengths, key: null, best: best };
    return { lengths: lengths, key: chosen.key, n: chosen.n, best: best };
  }

  function frequencyBars(text) {
    var f = counts(text);
    if (!f.total) return;
    out.heading('Letter frequency');
    var max = Math.max.apply(null, f.c);
    for (var i = 0; i < 26; i++) {
      var pct = f.total ? (f.c[i] / f.total * 100) : 0;
      var width = max ? Math.round(f.c[i] / max * 30) : 0;
      out.write(' ' + A[i] + ' ', 't-dim');
      out.write('█'.repeat(width) + '░'.repeat(30 - width),
                pct > ENGLISH[i] * 1.6 ? 't-warn' : 't-info');
      out.line('  ' + pct.toFixed(1) + '%  (English ' + ENGLISH[i].toFixed(1) + '%)', 't-dim');
    }
    out.line('');
    out.row('index of coincidence', ic(text).toFixed(4));
    out.dim('English prose sits near 0.067; random text near 0.038. A value in');
    out.dim('between usually means a polyalphabetic cipher such as Vigenère.');
  }

  function run() {
    var text = document.getElementById('tool-text').value;
    var mode = document.getElementById('tool-mode').value;
    var key = document.getElementById('tool-key').value;
    out.clear();
    if (!text) { out.warn('Type or paste some text above.'); return; }

    /* Validate the key before enciphering, because the failure is silent and
       dangerous otherwise.

       vigenere() strips non-letters and xorText() takes the raw string; both
       return the input UNCHANGED when nothing usable is left. The key field is
       shared across modes with the placeholder "Key (or shift number for
       Caesar)", so typing 1234 for Caesar and then switching to Vigenere prints
       the plaintext back under the heading "Result", followed by the usual
       "none of these ciphers are secure" footer. Someone copies that out
       believing it is ciphertext. */
    if (mode === 'vig-enc' || mode === 'vig-dec') {
      var letters = String(key).toUpperCase().replace(/[^A-Z]/g, '');
      if (!letters) {
        out.err('Vigenere needs a key made of letters.');
        out.dim(key ? '"' + key + '" has none, so there is nothing to shift by.'
                    : 'The key field is empty.');
        out.dim('Try a word: LEMON, PALIMPSEST, anything alphabetic.');
        return;
      }
      if (letters.length !== String(key).length) {
        out.warn('Only the letters in the key are used: "' + letters + '".');
        out.line('');
      }
    }
    if (mode === 'xor' && !String(key).length) {
      out.err('XOR needs a key.');
      out.dim('With an empty key there is nothing to XOR against, so the text');
      out.dim('would come back unchanged and look like it had been encrypted.');
      return;
    }

    var result = null;

    switch (mode) {
      case 'rot13':      result = shift(text, 13); break;
      case 'caesar-enc': result = shift(text, parseInt(key, 10) || 3); break;
      case 'caesar-dec': result = shift(text, -(parseInt(key, 10) || 3)); break;
      case 'atbash':     result = atbash(text); break;
      case 'vig-enc':    result = vigenere(text, key, 1); break;
      case 'vig-dec':    result = vigenere(text, key, -1); break;
      case 'xor':        result = xorText(text, key); break;

      case 'break-caesar': {
        out.heading('Brute force — all 25 shifts, ranked by how English they look');
        out.dim('There are only 25 possible keys. That is the entire problem.');
        out.line('');
        breakCaesar(text).slice(0, 5).forEach(function (r, i) {
          out.row('shift ' + r.key + (i === 0 ? '  ← best' : ''),
                  r.text.slice(0, 60), i === 0 ? 't-ok' : null);
        });
        out.line('');
        var top = breakCaesar(text)[0];
        out.rule();
        out.heading('Most likely plaintext (shift ' + top.key + ')');
        out.line(top.text);
        document.getElementById('tool-result').value = top.text;
        out.rule();
        out.dim('Broken by trying every key and scoring each result against');
        out.dim('English letter frequencies. Total work: 25 attempts.');
        return;
      }

      case 'break-xor': {
        out.heading('Single-byte XOR brute force — all 255 keys');
        var xr = breakXor(text);
        if (!xr.length) {
          out.err('No key produced printable text. This may be multi-byte XOR,');
          out.err('or the input may need hex-decoding first.');
          return;
        }
        xr.slice(0, 5).forEach(function (r, i) {
          out.row('0x' + r.key.toString(16).padStart(2, '0') +
                  (i === 0 ? '  ← best' : ''),
                  r.text.slice(0, 60).replace(/[\r\n]/g, ' '), i === 0 ? 't-ok' : null);
        });
        out.rule();
        out.heading('Most likely plaintext (key 0x' + xr[0].key.toString(16) + ')');
        out.line(xr[0].text);
        document.getElementById('tool-result').value = xr[0].text;
        out.rule();
        out.dim('Single-byte XOR is the most common "obfuscation" in malware and');
        out.dim('CTF challenges. It has 255 keys, so it is not obfuscation at all.');
        return;
      }

      case 'break-vig': {
        out.heading('Vigenère analysis');
        var vr = breakVigenere(text);
        if (!vr) {
          out.warn('Need at least 40 letters. Statistical attacks need enough');
          out.warn('text for the statistics to mean anything.');
          return;
        }
        out.dim('per candidate key length: index of coincidence, and how English');
        out.dim('the text actually reads once decrypted with that length');
        out.line('');
        vr.lengths.forEach(function (l) {
          var picked = vr.n === l.n;
          out.row('length ' + l.n,
                  'IC ' + l.ic.toFixed(4) + '   fit ' + l.fit.toFixed(2) +
                  (picked ? '   ← chosen (key ' + l.key + ')' : ''),
                  picked ? 't-ok' : null);
        });
        out.rule();
        if (!vr.key) {
          out.warn('No key length produced readable English. The text may be too');
          out.warn('short, not a Vigenère cipher, or not English.');
          out.dim('Best attempt was length ' + vr.best.n + ' with key ' + vr.best.key + '.');
          return;
        }
        out.heading('Recovered key: ' + vr.key);
        var plain = vigenere(text, vr.key, -1);
        out.line(plain);
        document.getElementById('tool-result').value = plain;
        out.rule();
        out.dim('Key length came from the index of coincidence; each letter of the');
        out.dim('key then fell to the same frequency attack as a Caesar cipher.');
        out.dim('No key was guessed — it was derived from the ciphertext alone.');
        return;
      }

      case 'frequency':
        frequencyBars(text);
        return;
    }

    out.heading('Result');
    out.line(result);
    document.getElementById('tool-result').value = result;
    out.rule();
    out.warn('None of these ciphers are secure. Every one of them is breakable');
    out.warn('by hand, and the break modes in the dropdown do it automatically.');
    out.dim('They are worth knowing because they explain what modern ciphers');
    out.dim('had to fix — and because CTFs are full of them.');
  }

  LabTool.define({
    id: 'ciphertool',
    run: run,
    onReady: function () {
      out.dim('Pick a cipher, or pick one of the break modes and watch it fall.');
      out.dim('Try "break Caesar" on:  Wkh txlfn eurzq ira mxpsv ryhu wkh odcb grj');
    }
  });
})();

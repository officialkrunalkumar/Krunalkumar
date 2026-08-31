/* ==========================================================================
   cipher-escape.js — five locked rooms, and the tools you break them with.
   --------------------------------------------------------------------------
   /labs/cipher is a workbench: one message, every classical cipher, run it
   forwards and backwards until you are bored. That is the right shape for a
   tool and the wrong shape for learning the order in which cryptanalysis
   actually happens. Nobody ever sits down to "do a Vigenere". They sit down
   with a blob, work out what KIND of thing it is, reach for the measurement
   that narrows it, and only then turn a key. This is that sequence, with a
   door at the end of each step.

   FIVE ROOMS, CHAINED. Each plaintext is the next room's briefing: room one
   tells you the second lock takes a six-letter keyword and that you will
   have to take it off the message; room two names the rail count; room
   three hands over twelve letters of crib; room four names the crib for the
   XOR. Nothing is a difficulty ramp for its own sake — the chain is the
   reason to read the plaintext instead of glancing at it and moving on.

   THE PLAINTEXTS ARE NOT STORED. Only the ciphertext and the right setting
   are. Every plaintext on this page is produced by running the room's own
   decoder over its own ciphertext with the right key — the same function,
   on the same data, that the player is running from the slider. There is
   therefore no way for the answer panel and the live output to disagree,
   which is the kind of bug a stored "expected" string invites and that
   nobody notices until a comma moves.

   THE TOOLS ARE THE GAME. Five of them, in a tab strip under the room, and
   every one is live on the current room's ciphertext rather than being a
   picture of what such a tool would say:

     - a letter histogram against English, with bigrams and trigrams;
     - all twenty-six Caesar shifts at once, which is what "the keyspace is
       25" means when you can see it;
     - Kasiski and the index of coincidence: real repeated trigrams, real
       spacings, real factor tallies, and the average per-column IC for
       every candidate key length, then chi-squared against English one
       column at a time;
     - a crib dragger, which does something different per cipher because
       the technique is different per cipher — implied key letters for a
       Caesar or a Vigenere, an implied partial alphabet with a consistency
       test for a substitution, implied key BYTES for the XOR;
     - a hex/text view, because the last room is bytes and pretending
       otherwise is how people end up trying frequency analysis on a
       binary.

   None of the tools is gated, none of them costs anything, and none of
   them is a hint. Hints are separate, cost a quarter of the room, and are
   charged only if the room is then solved — the rule ctf-arcade.js settled
   on and for the same reason: charge on reading and you teach people to sit
   and stare rather than ask. Every room also has an "Open it for me", which
   scores nothing for that room and lets the chain carry on, because an
   escape room you cannot leave is not a puzzle, it is a wall.

   WHAT IS DELIBERATELY MISSING. There is no bed. Seven toys on this shell
   shipped a sound button wired to nothing, so the temptation to add a drone
   is real — but this is a reading game, and a held layer under three
   hundred words of ciphertext is the first thing anybody switches off. The
   sounds here are events: a latch, a hint, a door.

   AND THE OBVIOUS DISCLAIMER, SAID OUT LOUD. Not one of these five is
   encryption in any modern sense. The Caesar has twenty-five keys. The
   final XOR key is five lowercase letters, which is under twelve million
   possibilities and therefore under a second of laptop. They are here
   because they are the ciphers whose attacks you can see, and because
   seeing an attack land is the only way "AES is different" stops being a
   thing somebody told you. /labs/cryptography and /labs/hash are what
   replaced them.

   ES5 throughout, no dependencies, no network, nothing stored but the best
   score. Everything is inline-styled: this game ships one file, and adding
   two hundred lines to a shared games.css for one page's benefit is not a
   trade worth making.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  var AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* Relative letter frequencies of English text, per cent. The usual
     Lewand table. Used for the histogram's comparison row and as the
     expected distribution in the chi-squared column test — one table, so
     the picture and the arithmetic cannot tell different stories. */
  var ENG = [
    8.17, 1.49, 2.78, 4.25, 12.70, 2.23, 2.02, 6.09, 6.97, 0.15, 0.77,
    4.03, 2.41, 6.75, 7.51, 1.93, 0.10, 5.99, 6.33, 9.06, 2.76, 0.98,
    2.36, 0.15, 1.97, 0.07
  ];

  /* The two reference points the IC readout is only meaningful against.
     English running text sits near 0.066; a uniformly random string of
     letters sits at 1/26. A polyalphabetic cipher pulls the figure down
     towards the second, and how far down is the whole signal. */
  var IC_ENGLISH = 0.0667;
  var IC_RANDOM = 0.0385;

  /* ==================================================================
     Cipher primitives. Every one of these is used twice — once by the
     player through a control, once by the room to work out what the
     right answer looks like. Deliberately: see the header.
     ================================================================== */

  function shiftBy(text, n) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      var u = AL.indexOf(c);
      out += u < 0 ? c : AL.charAt((u + n + 26 * 40) % 26);
    }
    return out;
  }

  /* Vigenere, with the one implementation choice that trips everybody up
     written down: the key advances only on LETTERS. Punctuation and spaces
     pass through and do not consume a key letter. Implementations disagree
     about this, and picking the other convention garbles everything after
     the first space — which is exactly the bug people spend an evening on. */
  function vigenere(text, key, dir) {
    var k = String(key).toUpperCase().replace(/[^A-Z]/g, '');
    if (!k) return text;
    var out = '';
    var j = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      var u = AL.indexOf(c);
      if (u < 0) { out += c; continue; }
      var s = AL.indexOf(k.charAt(j % k.length));
      out += AL.charAt((u + dir * s + 26 * 40) % 26);
      j++;
    }
    return out;
  }

  /* Which rail each position of the zigzag lands on. One rail is the
     identity and is excluded by the control's range, but the guard stays
     because a saved setting from a future edit must not divide by zero. */
  function railRows(n, rails) {
    var rows = [];
    if (rails < 2) {
      for (var z = 0; z < n; z++) rows.push(0);
      return rows;
    }
    var row = 0;
    var dir = 1;
    for (var i = 0; i < n; i++) {
      rows.push(row);
      if (row === 0) dir = 1;
      else if (row === rails - 1) dir = -1;
      row += dir;
    }
    return rows;
  }

  /* Decrypting a rail fence: the ciphertext was READ row by row, so it goes
     back into the fence row by row, and the message is then the zigzag. */
  function railDecode(ct, rails) {
    var rows = railRows(ct.length, rails);
    var out = new Array(ct.length);
    var p = 0;
    for (var k = 0; k < rails; k++) {
      for (var i = 0; i < ct.length; i++) {
        if (rows[i] === k) out[i] = ct.charAt(p++);
      }
    }
    return out.join('');
  }

  /* map is cipher letter -> plain letter. Unassigned letters come back as a
     middle dot rather than as themselves: a partial solution that quietly
     leaves cipher letters standing reads as though those letters were
     already right, which is the single most misleading thing a
     substitution helper can do. */
  function subApply(text, map, blank) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (AL.indexOf(c) < 0) { out += c; continue; }
      out += map[c] ? map[c] : (blank == null ? '·' : blank);
    }
    return out;
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      out += (h.length < 2 ? '0' : '') + h;
    }
    return out;
  }

  function hexToBytes(hex) {
    var s = String(hex).replace(/[^0-9a-fA-F]/g, '');
    var out = [];
    for (var i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
    return out;
  }

  function xorDecode(bytes, key) {
    if (!key || !key.length) return '';
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i] ^ (key.charCodeAt(i % key.length) & 255));
    }
    return out;
  }

  /* What a byte looks like when it is shown as text. Non-printables become
     a middle dot, because a terminal that prints them makes the pane jump
     and a terminal that drops them makes the offsets lie. */
  function showByte(b) {
    return (b >= 32 && b <= 126) ? String.fromCharCode(b) : '·';
  }

  function bytesToText(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += showByte(bytes[i]);
    return out;
  }

  function textToBytes(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 255);
    return out;
  }

  function strToHexView(text) {
    return hexView(textToBytes(text));
  }

  /* Sixteen bytes to a line with an offset in front, which is what every
     hex dump on earth looks like and therefore what people can read. */
  function hexView(bytes) {
    var lines = [];
    for (var i = 0; i < bytes.length; i += 16) {
      var off = i.toString(16);
      while (off.length < 4) off = '0' + off;
      var hex = '';
      var txt = '';
      for (var j = 0; j < 16; j++) {
        if (i + j < bytes.length) {
          var h = bytes[i + j].toString(16);
          hex += (h.length < 2 ? '0' : '') + h + ' ';
          txt += showByte(bytes[i + j]);
        } else {
          hex += '   ';
        }
      }
      lines.push(off + '  ' + hex + ' |' + txt + '|');
    }
    return lines.join('\n');
  }

  /* ==================================================================
     Analysis. Nothing below is hardcoded for these five messages — feed
     any of them a different string and it answers about that string.
     ================================================================== */

  function lettersOf(text) {
    return String(text).toUpperCase().replace(/[^A-Z]/g, '');
  }

  function letterCounts(text) {
    var s = lettersOf(text);
    var out = [];
    var i;
    for (i = 0; i < 26; i++) out.push(0);
    for (i = 0; i < s.length; i++) out[AL.indexOf(s.charAt(i))]++;
    return out;
  }

  /* Index of coincidence: the chance that two letters drawn at random from
     the text are the same letter. It is the one measurement that tells a
     monoalphabetic cipher from a polyalphabetic one WITHOUT any guessing,
     because shuffling the alphabet cannot change it and using more than
     one alphabet must. */
  function indexOfCoincidence(text) {
    var c = letterCounts(text);
    var n = 0;
    var i;
    for (i = 0; i < 26; i++) n += c[i];
    if (n < 2) return 0;
    var sum = 0;
    for (i = 0; i < 26; i++) sum += c[i] * (c[i] - 1);
    return sum / (n * (n - 1));
  }

  /* Kasiski. Every trigram that appears more than once, and the gap between
     consecutive appearances. With a repeating key, a repeat of the same
     plaintext at a distance that happens to be a multiple of the key length
     produces the same ciphertext — so the key length divides most of these
     gaps. Some of them are coincidence and always will be, which is why the
     answer is a tally and not a proof. */
  function repeatedTrigrams(text) {
    var s = lettersOf(text);
    var pos = {};
    var i;
    for (i = 0; i + 3 <= s.length; i++) {
      var g = s.substr(i, 3);
      if (!pos[g]) pos[g] = [];
      pos[g].push(i);
    }
    var out = [];
    for (var key in pos) {
      if (!Object.prototype.hasOwnProperty.call(pos, key)) continue;
      if (pos[key].length < 2) continue;
      for (i = 1; i < pos[key].length; i++) {
        out.push({ gram: key, at: pos[key][i - 1], gap: pos[key][i] - pos[key][i - 1] });
      }
    }
    out.sort(function (a, b) { return b.gap - a.gap; });
    return out;
  }

  function factorTally(gaps, max) {
    var out = [];
    var k;
    for (k = 0; k <= max; k++) out.push(0);
    for (var i = 0; i < gaps.length; i++) {
      for (k = 2; k <= max; k++) if (gaps[i].gap % k === 0) out[k]++;
    }
    return out;
  }

  function columnOf(text, len, c) {
    var s = lettersOf(text);
    var out = '';
    for (var i = c; i < s.length; i += len) out += s.charAt(i);
    return out;
  }

  function averageColumnIC(text, len) {
    var tot = 0;
    for (var c = 0; c < len; c++) tot += indexOfCoincidence(columnOf(text, len, c));
    return tot / len;
  }

  /* Chi-squared of one column against English, for every one of the 26
     possible shifts. Returns them sorted best first: the winner is the key
     letter for that column, and the gap to the runner-up is how much you
     should trust it. A column of nine letters routinely gets this wrong,
     and printing the runners-up is the honest way to say so. */
  function columnCandidates(col) {
    var out = [];
    for (var s = 0; s < 26; s++) {
      var cnt = [];
      var i;
      for (i = 0; i < 26; i++) cnt.push(0);
      for (i = 0; i < col.length; i++) {
        cnt[(AL.indexOf(col.charAt(i)) - s + 26) % 26]++;
      }
      var chi = 0;
      for (i = 0; i < 26; i++) {
        var e = col.length * ENG[i] / 100;
        if (e <= 0) continue;
        chi += (cnt[i] - e) * (cnt[i] - e) / e;
      }
      out.push({ letter: AL.charAt(s), chi: chi });
    }
    out.sort(function (a, b) { return a.chi - b.chi; });
    return out;
  }

  /* N-grams counted INSIDE words rather than across the whole letter
     stream. Both are defensible; this one is what a person doing it by hand
     does, and it stops "ETH" turning up two hundred times because "the"
     keeps following a word that ends in E. */
  function topNgrams(text, n, limit) {
    var words = String(text).toUpperCase().split(/[^A-Z]+/);
    var tally = {};
    var i;
    for (i = 0; i < words.length; i++) {
      var w = words[i];
      for (var j = 0; j + n <= w.length; j++) {
        var g = w.substr(j, n);
        tally[g] = (tally[g] || 0) + 1;
      }
    }
    var list = [];
    for (var k in tally) {
      if (!Object.prototype.hasOwnProperty.call(tally, k)) continue;
      if (tally[k] < 2) continue;
      list.push({ gram: k, n: tally[k] });
    }
    list.sort(function (a, b) { return b.n - a.n || (a.gram < b.gram ? -1 : 1); });
    return list.slice(0, limit);
  }

  /* The shortest period p that the array repeats on, or 0 if it does not.
     This is what turns the crib dragger from "these bytes are printable" —
     which over half the offsets manage by luck — into "these bytes are a
     key repeating", which exactly one offset manages.

     THE PERIOD IS CAPPED AT HALF THE LENGTH, and that cap is the whole
     difference between a useful answer and a useless one. Without it, a
     thirteen-byte run "has period 12" whenever its last byte happens to
     equal its first — one coincidence out of 256, dressed up as structure —
     and the lowercase spelling of the room-five crib produced two such
     phantom hits. A repeat is only evidence when it has actually repeated,
     which needs the crib to be at least twice the key. */
  function shortestPeriod(arr, max) {
    var cap = Math.min(max, Math.floor(arr.length / 2));
    for (var p = 1; p <= cap; p++) {
      var ok = true;
      for (var j = p; j < arr.length; j++) {
        if (arr[j] !== arr[j - p]) { ok = false; break; }
      }
      if (ok) return p;
    }
    return 0;
  }

  /* Turn the key bytes a crib implies at some offset back into the key as
     it sits at the START of the message.

     Worth writing down because the obvious version is wrong. If the crib
     lands at offset OFF and the key has period P, then the jth byte the
     crib implies is key[(off + j) mod p] — so what you are looking at is
     the key rotated by off mod p, and a rotation of the whole implied
     string is NOT the same thing unless the string happens to be an exact
     number of periods long. A thirteen-character crib against a five-byte
     key is not, and rotating the thirteen gave "erber" where the key was
     "ember" — right letters, wrong order, and a door that stays shut with
     no explanation. Index into the implied bytes per key position instead. */
  function alignKey(implied, off, period) {
    var out = '';
    for (var m = 0; m < period; m++) {
      out += implied.charAt((((m - off) % period) + period) % period);
    }
    return out;
  }

  /* ==================================================================
     The five rooms.
     ==================================================================
     ct is the ciphertext exactly as the player sees it. answer is the
     setting that opens the door. There is no plaintext field: plain() runs
     the room's own decoder with that answer and returns what comes out, so
     the answer key IS the tool. carries is the one line this room adds
     to the notes panel once it is open — written by hand, because a
     sentence pulled out of the plaintext by a regex would read like a
     ransom note.
     ================================================================== */
  var ROOMS = [
    {
      kind: 'caesar',
      name: 'The shifted note',
      cipher: 'Caesar shift',
      points: 150,
      answer: 19,
      ct: 'MAX LXVHGW WHHK MTDXL T DXRPHKW HY LBQ EXMMXKL. B GXOXK PKHMX BM WHPG, ' +
        'LH RHN PBEE ATOX MH MTDX BM HYY MAX FXLLTZX BMLXEY. BM BL EHGZ XGHNZA. ' +
        'VHNGM MAX ZTIL UXMPXXG KXIXTMXW MKBZKTFL, MTDX MAX VHFFHG YTVMHK, ' +
        'MAXG PHKD HGX VHENFG TM T MBFX.',
      story: 'A note pinned inside the door you came through. The punctuation is untouched and ' +
        'the word lengths are untouched, so nothing has been moved &mdash; only the letters have ' +
        'been replaced, and every one of them by the same amount. There are twenty-five amounts ' +
        'it could be. Slide through them and read.',
      teach: 'A Caesar shift has a keyspace of 25. Not 25 million &mdash; 25. That is small enough that ' +
        'you do not attack it, you simply look at all of it, which is what the Shifts tool is doing ' +
        'below: every possible decryption, at once, and one of them is English.',
      hints: [
        'The first word of the ciphertext is three letters and the message is an instruction. ' +
          'In English, a three-letter word at the start of a sentence is THE far more often than it is anything else.',
        'M stands for T, A stands for H and X stands for E. Counting forward from T and wrapping past Z, ' +
          'you reach M after nineteen steps &mdash; so the whole message was moved forward nineteen and you ' +
          'take nineteen back off it.'
      ],
      carries: 'The second lock takes a keyword of six letters, and it was never written down &mdash; ' +
        'it has to come off the message itself.'
    },
    {
      kind: 'vigenere',
      name: 'The keyword door',
      cipher: 'Vigenere',
      points: 250,
      answer: 'CANDLE',
      ct: 'VHR WSMTD QRZV KS N ULMN FRQNI CNQ LE YUEF ITZG RNLWW. C RNLW JGNPH OSGS ARE ' +
        'GJAAJP E UIAJWI NEGWPV, KT BQWC EHNQRIU WUHCI VHR OPXVEEV DMV. TUDE MU WUB ELG ' +
        'FEHBYGNPB SMUTBJCEO OS D CEKL SHYGG LBRVW GXNFEPA LVNP IPGYLDL YHVOP XJE GHIX ' +
        'KTFHWJ TENGD PKKR QZXJIAJ LX CLY. WSEV IF WSI VEYO. TJ VHR OPXVEE FZYPTF OZSM ' +
        'RVJSX CNQ WSI YOEGD PQOX ZCSPG, LRF ETE URWHKNT D EVCNFSZWKTVRY EPD ARE E UUOVEMVUGLZR.',
      story: 'Three hundred and eighteen letters, and the histogram has gone flat &mdash; no letter is ' +
        'anywhere near the twelve per cent English gives E. That flatness is the whole tell: one alphabet ' +
        'cannot hide a frequency profile, so more than one alphabet is in use. Find how many, then break ' +
        'each of them separately as an ordinary shift.',
      teach: 'Two independent measurements find the key length, and the Kasiski &amp; IC tool runs both. ' +
        'Kasiski counts the gaps between repeated trigrams and tallies their factors. The index of ' +
        'coincidence slices the message into candidate columns and asks which slicing makes each column ' +
        'look like English again. When they agree, you have the length &mdash; and the message collapses into ' +
        'that many separate Caesar shifts.',
      hints: [
        'Kasiski tallies 2, 3 and 6 equally, because every gap divisible by six is divisible by two and ' +
          'three as well. Take the LARGEST factor that still explains the repeats, then check it against the ' +
          'column IC table &mdash; only one candidate length pushes the average column IC back up near 0.066.',
        'The key is six letters and it is an object you would carry into a dark room. ' +
          'Run the per-column chi-squared at length 6 and it writes the word out for you, one column at a time.'
      ],
      carries: 'The third door is a rail fence, and it uses five rails.'
    },
    {
      kind: 'rail',
      name: 'The fence',
      cipher: 'Rail fence transposition',
      points: 150,
      answer: 5,
      ct: 'THPSNEHHOEOESHTNALBTOAPNTETEDOVLSFSNOTEROSAUIINOSHWSVTRLERCIOTAFUTIISTTDTWTODALTETERBUHROENUIIRUWTIGT',
      story: 'Run the frequency histogram on this one before you touch anything. It is English &mdash; E on ' +
        'top, then T, then H and O and S about where they should be &mdash; and the text is unreadable anyway. ' +
        'That combination means no letter was substituted for another. They were only moved.',
      teach: 'A transposition changes position, never identity, so it leaves the letter counts exactly as it ' +
        'found them. If the counts look right and the words look wrong, stop trying to substitute. Here the ' +
        'message was written down a zigzag across some number of rails and then read off row by row; ' +
        'putting it back needs only that number.',
      hints: [
        'The note behind the second door named the number in words. If you did not read it: the count is ' +
          'small, and the fence redraws instantly, so walking the slider from 2 upwards costs you nothing but a few seconds.',
        'Five rails. Watch the first row of the fence as you pass it &mdash; at the right count its letters ' +
          'stop being scattered and start landing on the tops of real words.'
      ],
      carries: 'The fourth note is a plain substitution, and it opens with the words THE VAULT DOOR &mdash; ' +
        'twelve letters of crib.'
    },
    {
      kind: 'sub',
      name: 'The vault',
      cipher: 'Simple substitution',
      points: 250,
      answer: 'QMZWDCXKFVTBRPSJIYHGNULOAE',
      ct: 'GKD UQNBG WSSY FH GKD BQHG SPD QPW FG FH PSG Q BDGGDY JNEEBD QG QBB. GKD CFPQB ' +
        'PSGD FH Q YNP SC MAGDH OSYDW QXQFPHG Q TDA GKQG YDJDQGH, HS PSGKFPX FP FG LFBB ' +
        'BSST BFTD DPXBFHK NPGFB GKD TDA FH YFXKG. ASN WS PSG KQUD GKD TDA. LKQG ASN KQUD ' +
        'FH Q ZYFM: HSRDLKDYD FPHFWD GKQG RDHHQXD QYD GKD LSYWH GKD BQHG WSSY. WYQX GKDR ' +
        'QBSPX GKD MAGDH, QPW LKDYDUDY GKD MAGDH GKDA FRJBA ZSRD SNG QH JYFPGQMBD GDOG ' +
        'GKQG YDJDQGH, ASN KQUD CSNPW MSGK GKD JBQZD QPW GKD TDA.',
      story: 'Every letter has been swapped for a different letter, consistently, all the way through. ' +
        'There are 403 septillion ways to shuffle an alphabet, so this one cannot be brute-forced by ' +
        'looking &mdash; and it falls over in about ten minutes anyway, because the shuffle does not hide how ' +
        'often each letter is used, how often two of them sit together, or which three-letter word ' +
        'turns up nine times.',
      teach: 'This is the room the tools were built for. The histogram gives you the candidates: the ' +
        'commonest cipher letter is almost certainly E or T. The trigram list gives you the anchor &mdash; ' +
        'whatever GKD is, it is THE. And the crib from the last room pins ten letters before you start, ' +
        'which is more than a third of the alphabet. Fill those in and the rest of the message argues ' +
        'for itself.',
      hints: [
        'Press "Fill in the crib" to place THE VAULT DOOR over the opening. That gives you T, H, E, V, A, ' +
          'U, L, D, O and R. Now look for a two-letter word ending in the letter you have as S &mdash; and for the ' +
          'word that appears as Q on its own, which in English is A or I.',
        'The cipher alphabet, in plain order A to Z, is Q M Z W D C X K F V T B R P S J I Y H G N U L O A E. ' +
          'Reading it the other way: cipher G is T, K is H, D is E.'
      ],
      carries: 'The last message is a repeating-key XOR, and somewhere inside it are the words ' +
        '&ldquo;The last door&rdquo;.'
    },
    {
      kind: 'xor',
      name: 'The last door',
      cipher: 'Repeating-key XOR',
      points: 200,
      answer: 'ember',
      ct: '3c02174513170842111a170217021a4b4d360d17450103160645090d0a004505030152044d040c' +
        '04004d0e00061108104519001458450612080c110b451e0b1d52110242111a004d040c141105420c' +
        '01450c000a07114d161217091b07451f0c010e0c1d0b4d09000b164142041c014d03451e041d160a' +
        '024519100c17164d0713171714420a1c004d0d0352110507085212050b091745140d105207010b0b' +
        '194b4d271317171442091d0606420c1c45190a0c01451f0d0a1f45041145060d0c164505000c0945' +
        '1d174d1500130e08104b52310507453104081104004505030152111a070b061c4d040c04004d0d03' +
        '52110507085c',
      story: 'Not letters this time. Bytes, each one exclusive-ORed against a short key that repeats ' +
        'from the start of the message to the end of it. Frequency analysis has nothing to work with, ' +
        'because most of these bytes are not printable characters at all &mdash; open the hex view and see. ' +
        'What XOR does have is a property nothing above it has: it is its own inverse.',
      teach: 'Because ciphertext XOR plaintext gives you key, a guess about the plaintext is directly a ' +
        'guess about the key. Slide a crib along the message and at every position read off the key bytes ' +
        'it would imply. At almost every position they are junk. At the right one they are printable, ' +
        'and &mdash; the part that clinches it &mdash; they repeat, because the key repeats. That is the whole ' +
        'attack, and it needs no key length known in advance.',
      hints: [
        'The crib is already in the field, spelled exactly as the last note gave it. Case matters: XOR ' +
          'works on bytes, and &ldquo;T&rdquo; and &ldquo;t&rdquo; are different bytes. Turn on ' +
          '&ldquo;only offsets that repeat&rdquo; and the 233 positions come down to one.',
        'The crib lands at offset 17 and the bytes it implies read b, e, r, e, m, b, e, r, e, m, b, e, r. ' +
          'That is the key rotated, because 17 is not a multiple of 5. The tool prints it rotated back to ' +
          'the start of the message for you: five lowercase letters, a thing left burning in a grate.'
      ],
      carries: ''
    }
  ];

  /* Fill in each room's plaintext by running its own decoder with its own
     answer. Done once, at load, so the door test is a string compare. */
  function plainOf(room) {
    if (room.kind === 'caesar') return shiftBy(room.ct, -room.answer);
    if (room.kind === 'vigenere') return vigenere(room.ct, room.answer, -1);
    if (room.kind === 'rail') return railDecode(room.ct, room.answer);
    if (room.kind === 'sub') {
      var map = {};
      for (var i = 0; i < 26; i++) map[room.answer.charAt(i)] = AL.charAt(i);
      return subApply(room.ct, map);
    }
    if (room.kind === 'xor') return xorDecode(hexToBytes(room.ct), room.answer);
    return '';
  }

  for (var ri = 0; ri < ROOMS.length; ri++) {
    ROOMS[ri].no = ri + 1;
    ROOMS[ri].pt = plainOf(ROOMS[ri]);
    if (ROOMS[ri].kind === 'xor') ROOMS[ri].bytes = hexToBytes(ROOMS[ri].ct);
  }

  /* The crib each room starts with in the dragger. Rooms three and five get
     the exact phrase the previous plaintext named, spelled the way that
     room needs it — the case in room five is not a courtesy, it is the
     difference between one hit and none, and the panel says so. */
  var CRIBS = ['THE', 'THE', '', 'THE VAULT DOOR', 'The last door'];

  var HINT_SHARE = 0.25;

  /* Quotes included. Most of what goes through here is ciphertext and ends
     up as text content, but two buttons carry a recovered key in a
     data- attribute — and a crib a player typed with a quote in it would
     otherwise close the attribute and hand the page whatever came next. */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pct(n, d) {
    if (!d) return '0.0';
    return (100 * n / d).toFixed(1);
  }

  GameShell.define({
    id: 'game-cipher-escape',
    slug: 'cipher-escape',
    title: 'Cipher escape',
    bestKey: 'cipher-escape',
    board: true,
    pauseOnBlur: false,
    startTitle: 'Five doors',
    startText: 'Every room decrypts to what the next room needs. The tools are free and always open; ' +
      'hints cost a quarter of the room. Nothing is uploaded and nothing is stored but your best score.',

    setup: function (g) {
      /* The manifest declares board: true, so the generated page hands the
         shell a .game-board and no canvas. Belt and braces anyway: a page
         built the other way round would otherwise render nothing at all,
         which is a worse failure than six lines of guard. */
      var host = g.board;
      if (!host) {
        host = document.createElement('div');
        host.className = 'game-board';
        if (g.canvas) g.canvas.hidden = true;
        (g.stage || g.el).appendChild(host);
        g.board = host;
        g.focusTarget = host;
        host.setAttribute('tabindex', '0');
      }
      host.style.display = 'block';
      host.style.width = '100%';
      host.style.maxWidth = '52rem';
      host.style.textAlign = 'left';
      /* .game-board sets user-select: none, which is right for a grid of
         tiles you drag across and completely wrong here: the entire point
         of a ciphertext panel is that you can select it and paste it into
         /labs/cipher to check the game's arithmetic against the lab's. */
      host.style.webkitUserSelect = 'text';
      host.style.userSelect = 'text';

      var INK = 'var(--ink)';
      var INK3 = 'var(--ink-3)';
      var INK4 = 'var(--ink-4)';
      var LINE = 'rgb(var(--line-rgb) / 0.28)';
      var SHEET = 'rgb(var(--sheet-rgb) / 0.6)';
      var MONO = "'Cascadia Code',Consolas,'SF Mono',Menlo,monospace";
      var GOOD = '#4ade80';
      var WARN = '#fbbf24';
      var BAD = '#f87171';
      var CALM = '#60a5fa';

      var hintBtn = g.el.querySelector('#game-hint');
      var openBtn = g.el.querySelector('#game-unlock');

      /* ------------------------------------------------------------
         Run state. Rebuilt whole by reset().
         ------------------------------------------------------------ */
      var at = 0;
      var solved = [];          // 'solved' | 'given' | null, one per room
      var hintsAt = [];         // hints taken, one per room
      var earned = [];          // points banked, one per room
      var hintsTotal = 0;
      var done = false;

      /* Per-room working values. Cleared on entry to a room. */
      var wShift = 0;
      var wKey = '';
      var wRails = 2;
      var wMap = {};
      var wXorKey = '';
      var tool = 'freq';
      var cribText = '';
      var cribOffset = 0;
      var cribStrict = true;
      var hexMode = 'hex';
      var kasLen = 6;
      var shiftPick = 0;
      var sayTimer = null;

      var node = {};

      function room() { return ROOMS[at]; }

      /* Announcements are debounced. A slider fires an event per pixel of
         travel, and a live region fed one string per pixel says nothing at
         all — the screen reader is still reading shift 4 when the thumb is
         at 19. Four hundred milliseconds is long enough to land on a value
         and short enough not to feel detached from the control. */
      function say(msg) {
        if (sayTimer) clearTimeout(sayTimer);
        sayTimer = setTimeout(function () {
          sayTimer = null;
          g.announce(msg);
        }, 400);
      }

      function sayNow(msg) {
        if (sayTimer) { clearTimeout(sayTimer); sayTimer = null; }
        g.announce(msg);
      }

      /* ============================================================
         Small markup helpers. Everything is inline-styled — see the
         header for why this file ships no stylesheet.
         ============================================================ */
      function label(text) {
        return '<p style="margin:0 0 0.3rem;font-size:0.68rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">' + text + '</p>';
      }

      function pre(id, text, extra) {
        return '<pre' + (id ? ' id="' + id + '"' : '') + ' style="margin:0 0 0.9rem;padding:0.6rem 0.7rem;' +
          'background:' + SHEET + ';border:1px solid ' + LINE + ';border-radius:8px;' +
          'font-family:' + MONO + ';font-size:0.76rem;line-height:1.65;color:' + INK3 + ';' +
          'white-space:pre-wrap;word-break:break-word;overflow-x:auto;' +
          (extra || '') + '">' + esc(text) + '</pre>';
      }

      function scrollPre(text) {
        return '<pre style="margin:0 0 0.8rem;padding:0.6rem 0.7rem;background:' + SHEET + ';' +
          'border:1px solid ' + LINE + ';border-radius:8px;font-family:' + MONO + ';' +
          'font-size:0.7rem;line-height:1.6;color:' + INK3 + ';white-space:pre;overflow-x:auto;">' +
          esc(text) + '</pre>';
      }

      function note(text) {
        return '<p style="margin:0 0 0.8rem;font-size:0.78rem;line-height:1.6;color:' + INK4 + ';">' +
          text + '</p>';
      }

      function para(text) {
        return '<p style="margin:0 0 0.9rem;font-size:0.88rem;line-height:1.65;color:' + INK3 + ';">' +
          text + '</p>';
      }

      /* A slider with a minus and a plus beside it. The buttons are not
         decoration: dragging a range thumb inside .game-board on a phone
         competes with the page's own pan, and a control that sometimes
         scrolls the article instead of moving is a control nobody trusts.
         Two taps always work. */
      function slider(id, min, max, value, name) {
        return '<div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;margin:0 0 0.6rem;">' +
          '<button class="game-btn" type="button" data-step="' + id + '|-1" ' +
          'aria-label="Decrease ' + name + '" style="min-width:2.2rem;">&minus;</button>' +
          '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + value + '" ' +
          'aria-label="' + name + '" style="flex:1 1 9rem;min-width:7rem;accent-color:var(--accent-2);" />' +
          '<button class="game-btn" type="button" data-step="' + id + '|1" ' +
          'aria-label="Increase ' + name + '" style="min-width:2.2rem;">+</button>' +
          /* A span, NOT an <output>. An <output> has an implicit live-region
             role, and four of them on this board would each announce every
             pixel of a slider drag on top of the value the range control is
             already announcing for itself. The readout is here to be looked
             at; the announcing is done once, debounced, by the shell's live
             region. */
          '<span id="' + id + '-out" style="font-family:' + MONO + ';font-size:0.82rem;color:' + INK + ';' +
          'min-width:5.5rem;">&nbsp;</span>' +
          '</div>';
      }

      function field(id, value, name, placeholder) {
        return '<input type="text" id="' + id + '" value="' + esc(value) + '" ' +
          'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
          'placeholder="' + esc(placeholder || '') + '" aria-label="' + name + '" ' +
          'style="width:100%;max-width:22rem;padding:0.5rem 0.6rem;border-radius:8px;' +
          'border:1px solid ' + LINE + ';background:' + SHEET + ';color:' + INK + ';' +
          'font-family:' + MONO + ';font-size:0.9rem;letter-spacing:0.08em;" />';
      }

      /* ============================================================
         The room strip along the top.
         ============================================================ */
      function stripHtml() {
        var out = '<ol style="list-style:none;display:flex;flex-wrap:wrap;gap:0.35rem;margin:0 0 1rem;padding:0;">';
        for (var i = 0; i < ROOMS.length; i++) {
          var state = solved[i];
          var bg = 'rgba(148,163,184,0.14)';
          var col = INK4;
          var mark = String(i + 1);
          if (state === 'solved') { bg = 'rgba(74,222,128,0.18)'; col = GOOD; mark = '✓'; }
          else if (state === 'given') { bg = 'rgba(251,191,36,0.16)'; col = WARN; mark = '–'; }
          else if (i === at) { bg = 'rgba(96,165,250,0.2)'; col = CALM; }
          var word = state === 'solved' ? 'open' : (state === 'given' ? 'opened for you' : (i === at ? 'you are here' : 'locked'));
          out += '<li style="flex:1 1 5.5rem;padding:0.35rem 0.5rem;border-radius:8px;background:' + bg + ';' +
            'border:1px solid ' + (i === at ? 'rgba(96,165,250,0.5)' : LINE) + ';">' +
            '<span style="display:block;font-size:0.66rem;letter-spacing:0.06em;text-transform:uppercase;' +
            'color:' + col + ';">' + mark + ' &middot; ' + esc(word) + '</span>' +
            '<span style="display:block;font-size:0.74rem;color:' + INK3 + ';">' + esc(ROOMS[i].cipher) + '</span>' +
            '</li>';
        }
        return out + '</ol>';
      }

      /* ============================================================
         Notes carried forward. The chain, made visible — without it a
         player who solved room two an hour ago has no way back to the
         rail count except solving it again.
         ============================================================ */
      function notesHtml() {
        var lines = [];
        for (var i = 0; i < ROOMS.length; i++) {
          if (i >= at || !ROOMS[i].carries) continue;
          lines.push('<li style="margin:0 0 0.4rem;font-size:0.8rem;line-height:1.6;color:' + INK3 + ';">' +
            '<span style="color:' + INK4 + ';font-family:' + MONO + ';">room ' + (i + 1) + '</span> &mdash; ' +
            ROOMS[i].carries + '</li>');
        }
        if (!lines.length) return '';
        return '<section style="margin:1.1rem 0 0;padding:0.75rem 0.85rem;background:' + SHEET + ';' +
          'border:1px solid ' + LINE + ';border-radius:10px;">' +
          label('What the rooms behind you said') +
          '<ul style="list-style:none;margin:0;padding:0;">' + lines.join('') + '</ul></section>';
      }

      /* ============================================================
         Room controls, one builder per cipher.
         ============================================================ */
      function controlsHtml() {
        var r = room();
        if (r.kind === 'caesar') {
          return slider('ce-shift', 0, 25, wShift, 'Shift, 0 to 25') +
            note('Twenty-six positions, one of which is no shift at all. That is the entire keyspace, ' +
              'and the Shifts tool below is showing you all of it at once.');
        }
        if (r.kind === 'vigenere') {
          return '<div style="margin:0 0 0.6rem;">' + field('ce-key', wKey, 'Vigenere key', 'type the keyword') + '</div>' +
            note('The key repeats across the letters only. Spaces and punctuation pass through and do ' +
              'not advance it &mdash; implementations disagree about that, and choosing wrong garbles ' +
              'everything after the first space.');
        }
        if (r.kind === 'rail') {
          return slider('ce-rails', 2, 12, wRails, 'Number of rails, 2 to 12') +
            '<div id="ce-fence"></div>';
        }
        if (r.kind === 'sub') {
          return '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin:0 0 0.7rem;">' +
            '<button class="game-btn" type="button" id="ce-crib-fill">Fill in the crib</button>' +
            '<button class="game-btn" type="button" id="ce-map-clear">Clear the table</button>' +
            '</div>' +
            '<div id="ce-map"></div>' +
            '<p id="ce-conflict" style="margin:0 0 0.8rem;font-size:0.78rem;line-height:1.6;color:' + INK4 + ';"></p>';
        }
        return '<div style="margin:0 0 0.6rem;">' + field('ce-xor', wXorKey, 'XOR key, as text', 'type the key') + '</div>' +
          note('Typed as text and used as bytes. Five lowercase letters is about twelve million keys, ' +
            'which is not a number that protects anything &mdash; it is here because it is small enough to see.');
      }

      /* The fence, redrawn on every change of the rail count. One line per
         rail with a middle dot wherever that rail is empty, which is the
         picture the phrase "rail fence" is describing and which no amount
         of prose replaces. Each rail line is one span, so a redraw is a
         handful of nodes rather than a cell per letter. */
      var RAIL_COLOURS = ['#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa',
        '#22d3ee', '#fb923c', '#94a3b8', '#34d399', '#e879f9', '#facc15', '#7dd3fc'];

      function fenceHtml() {
        var r = room();
        var ct = r.ct;
        var rows = railRows(ct.length, wRails);
        var placed = new Array(ct.length);
        var p = 0;
        var k, i;
        for (k = 0; k < wRails; k++) {
          for (i = 0; i < ct.length; i++) if (rows[i] === k) placed[i] = ct.charAt(p++);
        }
        var out = '<div style="margin:0 0 0.8rem;overflow-x:auto;padding:0.55rem 0.6rem;' +
          'background:' + SHEET + ';border:1px solid ' + LINE + ';border-radius:8px;">' +
          '<pre style="margin:0;font-family:' + MONO + ';font-size:0.68rem;line-height:1.55;' +
          'white-space:pre;color:' + INK4 + ';">';
        for (k = 0; k < wRails; k++) {
          var line = '';
          for (i = 0; i < ct.length; i++) line += rows[i] === k ? placed[i] : '·';
          out += '<span style="color:' + RAIL_COLOURS[k % RAIL_COLOURS.length] + ';">' +
            'rail ' + (k + 1) + ' ' + esc(line) + '</span>\n';
        }
        out += '</pre></div>';
        out += note('The ciphertext has been laid into ' + wRails + ' rails, row by row, exactly as it ' +
          'arrived. Reading it back down the zigzag &mdash; rail 1, rail 2, rail 3, back up &mdash; gives the ' +
          'message below. Rails are numbered as well as coloured, so the picture does not depend on ' +
          'telling the colours apart.');
        return out;
      }

      /* The mapping table. Ordered by how often each cipher letter occurs,
         because that order is the first thing you use: the top cell is
         almost always E or T.

         Built as one small input per cipher letter rather than as a
         two-step "click a cipher letter, then click a plaintext letter"
         mode. The click version was written first and thrown away: it has a
         mode, so every click is ambiguous until you remember which half you
         are in, and it cannot be driven from a keyboard without inventing a
         focus model the rest of the page does not have. A row of one-
         character fields is a mapping table you click into and type. */
      function mapHtml() {
        var r = room();
        var counts = letterCounts(r.ct);
        var total = 0;
        var order = [];
        var i;
        for (i = 0; i < 26; i++) { total += counts[i]; order.push({ c: AL.charAt(i), n: counts[i] }); }
        order.sort(function (a, b) { return b.n - a.n || (a.c < b.c ? -1 : 1); });

        var out = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(4.3rem,1fr));' +
          'gap:0.35rem;margin:0 0 0.7rem;">';
        for (i = 0; i < order.length; i++) {
          var o = order[i];
          var dim = o.n === 0;
          out += '<div style="padding:0.3rem 0.35rem;border-radius:8px;border:1px solid ' + LINE + ';' +
            'background:' + (dim ? 'transparent' : SHEET) + ';opacity:' + (dim ? '0.45' : '1') + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;">' +
            '<span style="font-family:' + MONO + ';font-size:0.92rem;color:' + INK + ';">' + o.c + '</span>' +
            '<span style="font-size:0.62rem;color:' + INK4 + ';">' + o.n + '</span>' +
            '</div>' +
            '<input type="text" maxlength="1" data-sub="' + o.c + '" value="' + esc(wMap[o.c] || '') + '" ' +
            'autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" ' +
            'aria-label="Plaintext letter for cipher letter ' + o.c + ', which occurs ' + o.n + ' times" ' +
            'style="width:100%;margin-top:0.2rem;padding:0.2rem;text-align:center;text-transform:uppercase;' +
            'border-radius:6px;border:1px solid ' + LINE + ';background:transparent;color:' + CALM + ';' +
            'font-family:' + MONO + ';font-size:0.9rem;" />' +
            '</div>';
        }
        out += '</div>';
        out += note('Ordered by how often each cipher letter appears in this message, commonest first. ' +
          'In English E is about 12.7 per cent of letters and T about 9.1, so the first two cells are ' +
          'where you start. ' + total + ' letters in all.');
        return out;
      }

      function conflictText() {
        var seen = {};
        var clash = [];
        for (var c in wMap) {
          if (!Object.prototype.hasOwnProperty.call(wMap, c)) continue;
          var v = wMap[c];
          if (!v) continue;
          if (seen[v]) clash.push(seen[v] + ' and ' + c + ' are both set to ' + v);
          else seen[v] = c;
        }
        var n = 0;
        for (var k in wMap) if (Object.prototype.hasOwnProperty.call(wMap, k) && wMap[k]) n++;
        if (clash.length) {
          return '<span style="color:' + BAD + ';">Clash: ' + esc(clash.join('; ')) + '. ' +
            'A substitution is one-to-one, so two cipher letters cannot share a plaintext letter.</span>';
        }
        return n + ' of 26 assigned, no clashes.';
      }

      /* ============================================================
         What the current settings produce.
         ============================================================ */
      function currentPlain() {
        var r = room();
        if (r.kind === 'caesar') return shiftBy(r.ct, -wShift);
        if (r.kind === 'vigenere') return wKey ? vigenere(r.ct, wKey, -1) : r.ct;
        if (r.kind === 'rail') return railDecode(r.ct, wRails);
        if (r.kind === 'sub') return subApply(r.ct, wMap);
        if (r.kind === 'xor') return wXorKey ? xorDecode(r.bytes, wXorKey) : bytesToText(r.bytes);
        return '';
      }

      function outputText() {
        var r = room();
        var text = currentPlain();
        if (r.kind !== 'xor') return text;
        /* The XOR room's output can contain any byte at all, so it is shown
           through the same printable filter the hex pane uses. Printing raw
           control characters into a <pre> makes the panel jump about and
           silently swallows some of them, which moves every offset the crib
           dragger just told you about. */
        var out = '';
        for (var i = 0; i < text.length; i++) {
          var b = text.charCodeAt(i) & 255;
          out += showByte(b);
        }
        return out;
      }

      function settingText() {
        var r = room();
        if (r.kind === 'caesar') return 'shift ' + wShift;
        if (r.kind === 'vigenere') return wKey ? 'key ' + wKey.toUpperCase() : 'no key yet';
        if (r.kind === 'rail') return wRails + ' rails';
        if (r.kind === 'sub') return conflictText().replace(/<[^>]+>/g, '');
        return wXorKey ? 'key "' + wXorKey + '"' : 'no key yet';
      }

      function isOpen() {
        return currentPlain() === room().pt;
      }

      /* ============================================================
         The five tools.
         ============================================================ */
      var TOOLS = [
        { key: 'freq', name: 'Frequency' },
        { key: 'shifts', name: 'All 26 shifts' },
        { key: 'kasiski', name: 'Kasiski &amp; IC' },
        { key: 'crib', name: 'Crib dragger' },
        { key: 'hex', name: 'Hex / text' }
      ];

      /* A group of toggle buttons, NOT a role="tablist". The full tab
         pattern owes the reader roving tabindex, arrow-key navigation
         within the strip and a matching role="tabpanel" with aria-controls,
         and a half-built one is worse than none: a screen reader announces
         "tab, 1 of 5" and then the arrow keys do not do what it just
         promised. Five pressed-state buttons say exactly what is true. */
      function tabsHtml() {
        var out = '<div role="group" aria-label="Cryptanalysis tools" ' +
          'style="display:flex;flex-wrap:wrap;gap:0.35rem;margin:0 0 0.7rem;">';
        for (var i = 0; i < TOOLS.length; i++) {
          var on = TOOLS[i].key === tool;
          out += '<button class="game-btn" type="button" data-tool="' + TOOLS[i].key + '" ' +
            'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
            'style="' + (on ? 'border-color:var(--accent-2);color:' + INK + ';' : '') + '">' +
            TOOLS[i].name + '</button>';
        }
        return out + '</div>';
      }

      /* ---- Frequency ---- */
      function freqHtml() {
        var r = room();
        if (r.kind === 'xor') {
          return note('This room is bytes, not letters. A letter histogram over it would be a histogram ' +
            'of the handful of bytes that happen to land in the printable range, which is not a sample ' +
            'of anything &mdash; the majority of the message is outside it. Frequency analysis is the wrong ' +
            'tool here and saying so is the point: the crib dragger and the hex view are the two that ' +
            'apply. On a much longer XOR message you would split the bytes into columns by key length ' +
            'and run frequency analysis inside each column, which is the same idea one level up.');
        }
        var counts = letterCounts(r.ct);
        var total = 0;
        var max = 0;
        var i;
        for (i = 0; i < 26; i++) { total += counts[i]; if (counts[i] > max) max = counts[i]; }
        var scale = Math.max(max / Math.max(1, total) * 100, 13);

        var out = note('Each row is one letter of this ciphertext. The upper bar is what the message ' +
          'does; the lower, dimmer bar is what English does. Both numbers are printed, so nothing here ' +
          'depends on reading a bar.');
        out += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:0.15rem 0.9rem;">';
        for (i = 0; i < 26; i++) {
          var mine = total ? counts[i] * 100 / total : 0;
          out += '<div style="display:flex;align-items:center;gap:0.4rem;font-family:' + MONO + ';font-size:0.7rem;">' +
            '<span style="width:1.1rem;color:' + INK + ';">' + AL.charAt(i) + '</span>' +
            '<span style="flex:1 1 auto;min-width:3rem;">' +
            '<span style="display:block;height:5px;border-radius:999px;background:' + CALM + ';' +
            'width:' + Math.min(100, mine / scale * 100).toFixed(1) + '%;"></span>' +
            '<span style="display:block;height:3px;margin-top:2px;border-radius:999px;' +
            'background:rgba(148,163,184,0.45);width:' + Math.min(100, ENG[i] / scale * 100).toFixed(1) + '%;"></span>' +
            '</span>' +
            '<span style="width:4.6rem;text-align:right;color:' + INK4 + ';">' +
            counts[i] + ' &middot; ' + mine.toFixed(1) + '%</span>' +
            '</div>';
        }
        out += '</div>';

        var bi = topNgrams(r.ct, 2, 8);
        var tri = topNgrams(r.ct, 3, 8);
        out += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:0.9rem;margin-top:0.9rem;">';
        out += '<div>' + label('Repeated pairs, inside words') + ngramList(bi, 'No pair repeats in this message.') + '</div>';
        out += '<div>' + label('Repeated triples, inside words') + ngramList(tri, 'No triple repeats in this message.') + '</div>';
        out += '</div>';

        out += note('In English the commonest pairs are TH, HE, IN, ER and AN, and the commonest triple ' +
          'by a distance is THE. A substitution moves those patterns to different letters but cannot ' +
          'remove them; a transposition breaks them up entirely while leaving the single-letter counts ' +
          'alone. Which of the two you are looking at is usually visible right here.');
        return out;
      }

      function ngramList(list, empty) {
        if (!list.length) return note(empty);
        var out = '<ul style="list-style:none;margin:0 0 0.6rem;padding:0;font-family:' + MONO + ';font-size:0.74rem;">';
        for (var i = 0; i < list.length; i++) {
          out += '<li style="display:flex;justify-content:space-between;gap:0.6rem;color:' + INK3 + ';">' +
            '<span>' + esc(list[i].gram) + '</span><span style="color:' + INK4 + ';">' + list[i].n + '</span></li>';
        }
        return out + '</ul>';
      }

      /* ---- All 26 shifts ---- */
      function shiftsHtml() {
        var r = room();
        var sample = r.kind === 'xor' ? bytesToText(r.bytes) : r.ct;
        var out = note('Every one of the twenty-six shifts of the first eighty characters, computed on ' +
          'this room&rsquo;s ciphertext. Twenty-five of them do something and one is the message ' +
          'unchanged, which is the whole key space of a Caesar cipher. There is nothing to attack &mdash; ' +
          'you read it.');
        out += slider('ce-shiftpick', 0, 25, shiftPick, 'Highlight shift 0 to 25');
        out += '<div id="ce-shiftlist" style="overflow-x:auto;padding:0.5rem 0.6rem;background:' + SHEET + ';' +
          'border:1px solid ' + LINE + ';border-radius:8px;">';
        for (var s = 0; s < 26; s++) {
          var line = shiftBy(sample.substr(0, 80).toUpperCase(), -s);
          out += '<div data-shiftrow="' + s + '" style="font-family:' + MONO + ';font-size:0.68rem;' +
            'line-height:1.6;white-space:pre;color:' + (s === shiftPick ? INK : INK4) + ';' +
            'background:' + (s === shiftPick ? 'rgba(96,165,250,0.16)' : 'transparent') + ';border-radius:4px;">' +
            (s < 10 ? ' ' : '') + s + '  ' + esc(line) + '</div>';
        }
        out += '</div>';
        if (r.kind === 'caesar') {
          out += '<div style="margin-top:0.7rem;"><button class="game-btn" type="button" id="ce-use-shift">' +
            'Use shift ' + shiftPick + ' on the door</button></div>';
        }
        return out;
      }

      /* ---- Kasiski and the index of coincidence ---- */
      function kasiskiHtml() {
        var r = room();
        var text = r.kind === 'xor' ? '' : r.ct;
        if (!text) {
          return note('Both measurements below are about letters, and this room is bytes. The index of ' +
            'coincidence of a byte stream against a 26-letter alphabet is not a number that means ' +
            'anything, so it is not printed. The equivalent for a repeating-key XOR is Hamming distance ' +
            'between blocks at each candidate key length &mdash; the same idea, a different alphabet &mdash; and ' +
            'with a message this short the crib is faster than either.');
        }
        var ic = indexOfCoincidence(text);
        var n = lettersOf(text).length;
        var out = '<div style="display:flex;flex-wrap:wrap;gap:0.9rem;margin:0 0 0.8rem;font-size:0.8rem;color:' + INK3 + ';">' +
          '<span>Index of coincidence: <strong style="font-family:' + MONO + ';color:' + INK + ';">' +
          ic.toFixed(4) + '</strong></span>' +
          '<span style="color:' + INK4 + ';">English &asymp; ' + IC_ENGLISH.toFixed(4) + '</span>' +
          '<span style="color:' + INK4 + ';">random letters &asymp; ' + IC_RANDOM.toFixed(4) + '</span>' +
          '<span style="color:' + INK4 + ';">' + n + ' letters</span>' +
          '</div>';
        out += note(ic > 0.06
          ? 'That is up near English, so one alphabet is doing all the work &mdash; this is a substitution ' +
            'or a transposition, not a polyalphabetic cipher. Kasiski has nothing to find here.'
          : 'That is down near random, which is what more than one alphabet does to a message. The key ' +
            'length is what to look for next.');

        var tris = repeatedTrigrams(text);
        if (!tris.length) {
          out += note('No trigram repeats in this message, so Kasiski has nothing to count. On a short ' +
            'text that is normal and is not evidence of anything.');
        } else {
          var tally = factorTally(tris, 12);
          var maxT = 0;
          var i;
          for (i = 2; i <= 12; i++) if (tally[i] > maxT) maxT = tally[i];

          out += label('Repeated trigrams and the gaps between them');
          out += '<div style="max-height:11rem;overflow:auto;margin:0 0 0.8rem;padding:0.5rem 0.6rem;' +
            'background:' + SHEET + ';border:1px solid ' + LINE + ';border-radius:8px;">' +
            '<table style="width:100%;border-collapse:collapse;font-family:' + MONO + ';font-size:0.72rem;">' +
            '<thead><tr style="color:' + INK4 + ';text-align:left;">' +
            '<th style="font-weight:400;padding:0 0.5rem 0.3rem 0;">trigram</th>' +
            '<th style="font-weight:400;padding:0 0.5rem 0.3rem 0;">at</th>' +
            '<th style="font-weight:400;padding:0 0.5rem 0.3rem 0;">gap</th>' +
            '<th style="font-weight:400;padding:0 0 0.3rem 0;">factors</th></tr></thead><tbody>';
          for (i = 0; i < tris.length; i++) {
            var f = [];
            for (var k = 2; k <= 12; k++) if (tris[i].gap % k === 0) f.push(k);
            out += '<tr style="color:' + INK3 + ';"><td style="padding:0.1rem 0.5rem 0.1rem 0;">' +
              esc(tris[i].gram) + '</td><td style="padding:0.1rem 0.5rem 0.1rem 0;color:' + INK4 + ';">' +
              tris[i].at + '</td><td style="padding:0.1rem 0.5rem 0.1rem 0;">' + tris[i].gap + '</td>' +
              '<td style="padding:0.1rem 0 0.1rem 0;color:' + INK4 + ';">' + f.join(' ') + '</td></tr>';
          }
          out += '</tbody></table></div>';

          out += label('How many gaps each length divides');
          out += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr));gap:0.15rem 0.8rem;margin:0 0 0.8rem;">';
          for (i = 2; i <= 12; i++) {
            out += '<div style="display:flex;align-items:center;gap:0.4rem;font-family:' + MONO + ';font-size:0.7rem;">' +
              '<span style="width:1.3rem;color:' + INK + ';">' + i + '</span>' +
              '<span style="flex:1 1 auto;height:6px;border-radius:999px;background:rgba(148,163,184,0.18);overflow:hidden;">' +
              '<span style="display:block;height:100%;border-radius:999px;background:' + CALM + ';width:' +
              (maxT ? (tally[i] * 100 / maxT).toFixed(1) : 0) + '%;"></span></span>' +
              '<span style="width:1.8rem;text-align:right;color:' + INK4 + ';">' + tally[i] + '</span></div>';
          }
          out += '</div>';
          out += note('Every gap divisible by six is divisible by two and three as well, so short lengths ' +
            'always score at least as highly as the real one. Kasiski does not hand you an answer &mdash; it ' +
            'hands you the LARGEST length that still explains most of the repeats, and then you check ' +
            'that length against the table below.');
        }

        out += label('Average index of coincidence per column, by candidate key length');
        out += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:0.15rem 0.8rem;margin:0 0 0.8rem;">';
        var best = 1;
        var bestV = 0;
        var vals = [];
        var L;
        for (L = 1; L <= 12; L++) {
          var v = averageColumnIC(text, L);
          vals.push(v);
          if (L > 1 && v > bestV) { bestV = v; best = L; }
        }
        for (L = 1; L <= 12; L++) {
          var vv = vals[L - 1];
          var near = vv >= 0.06;
          out += '<div style="display:flex;align-items:center;gap:0.4rem;font-family:' + MONO + ';font-size:0.7rem;">' +
            '<span style="width:1.3rem;color:' + INK + ';">' + L + '</span>' +
            '<span style="flex:1 1 auto;height:6px;border-radius:999px;background:rgba(148,163,184,0.18);overflow:hidden;">' +
            '<span style="display:block;height:100%;border-radius:999px;background:' + (near ? GOOD : CALM) + ';' +
            'width:' + Math.min(100, vv / 0.08 * 100).toFixed(1) + '%;"></span></span>' +
            '<span style="width:3.2rem;text-align:right;color:' + (near ? GOOD : INK4) + ';">' + vv.toFixed(4) + '</span></div>';
        }
        out += '</div>';
        out += note('Slice the letters into <em>L</em> columns, taking every <em>L</em>th letter, and ask ' +
          'whether each column looks like English on its own. At the right length every column is a plain ' +
          'Caesar of English and the average climbs back towards 0.066; at a wrong length the columns stay ' +
          'mixed and it sits near 0.038. The peak here, ignoring 1, is length <strong>' + best + '</strong> ' +
          'at ' + bestV.toFixed(4) + ' &mdash; and multiples of the right length score well too, which is why ' +
          'you take the shortest length that peaks rather than the highest number on the chart.');

        out += label('Per-column frequency analysis');
        out += slider('ce-kaslen', 1, 12, kasLen, 'Candidate key length, 1 to 12');
        out += '<div id="ce-kascols"></div>';
        return out;
      }

      function kasColsHtml() {
        var r = room();
        if (r.kind === 'xor') return '';
        var out = '<div style="overflow-x:auto;padding:0.5rem 0.6rem;background:' + SHEET + ';' +
          'border:1px solid ' + LINE + ';border-radius:8px;margin:0 0 0.7rem;">' +
          '<table style="width:100%;border-collapse:collapse;font-family:' + MONO + ';font-size:0.72rem;">' +
          '<thead><tr style="color:' + INK4 + ';text-align:left;">' +
          '<th style="font-weight:400;padding:0 0.6rem 0.3rem 0;">column</th>' +
          '<th style="font-weight:400;padding:0 0.6rem 0.3rem 0;">letters</th>' +
          '<th style="font-weight:400;padding:0 0.6rem 0.3rem 0;">best</th>' +
          '<th style="font-weight:400;padding:0 0.6rem 0.3rem 0;">chi&sup2;</th>' +
          '<th style="font-weight:400;padding:0 0 0.3rem 0;">runners-up</th></tr></thead><tbody>';
        var key = '';
        for (var c = 0; c < kasLen; c++) {
          var col = columnOf(r.ct, kasLen, c);
          var cand = columnCandidates(col);
          key += cand[0].letter;
          out += '<tr style="color:' + INK3 + ';">' +
            '<td style="padding:0.12rem 0.6rem 0.12rem 0;color:' + INK4 + ';">' + (c + 1) + '</td>' +
            '<td style="padding:0.12rem 0.6rem 0.12rem 0;color:' + INK4 + ';">' + col.length + '</td>' +
            '<td style="padding:0.12rem 0.6rem 0.12rem 0;color:' + INK + ';">' + cand[0].letter + '</td>' +
            '<td style="padding:0.12rem 0.6rem 0.12rem 0;">' + cand[0].chi.toFixed(1) + '</td>' +
            '<td style="padding:0.12rem 0 0.12rem 0;color:' + INK4 + ';">' +
            cand[1].letter + ' (' + cand[1].chi.toFixed(1) + ') &middot; ' +
            cand[2].letter + ' (' + cand[2].chi.toFixed(1) + ')</td></tr>';
        }
        out += '</tbody></table></div>';
        out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + INK3 + ';">' +
          'Best key at length ' + kasLen + ': <strong style="font-family:' + MONO + ';color:' + INK + ';' +
          'letter-spacing:0.1em;">' + esc(key) + '</strong>' +
          (r.kind === 'vigenere' ? ' <button class="game-btn" type="button" id="ce-use-key" ' +
            'style="margin-left:0.4rem;">Try it on the door</button>' : '') + '</p>';
        out += note('Each column is shifted by one key letter and nothing else, so it is an ordinary ' +
          'Caesar of English. Chi-squared measures how far a column&rsquo;s letter counts sit from the ' +
          'English profile once that shift is undone: the smallest value wins. Where the runner-up is ' +
          'close, the column is short and the answer is a guess &mdash; which is exactly when the word the ' +
          'key spells is the thing that settles it.');
        return out;
      }

      /* ---- Crib dragger ---- */
      function cribHtml() {
        var r = room();
        if (r.kind === 'rail') {
          return note('A crib dragger recovers a KEY by assuming a stretch of plaintext, and a rail ' +
            'fence has no key in that sense &mdash; it has a shape. Dragging a word along this ciphertext ' +
            'would tell you nothing, so it is not offered. What does work on a transposition is exactly ' +
            'what the room asks for: try each rail count and look. There are ten of them.');
        }
        var mode = r.kind === 'xor'
          ? 'Guessing a stretch of plaintext gives you the key bytes it implies, because ciphertext XOR ' +
            'plaintext IS key. Drag the crib along and watch what falls out.'
          : (r.kind === 'sub'
            ? 'On a substitution a crib does not give you a key, it gives you a partial ALPHABET: this ' +
              'cipher letter is that plain letter, and so on. Offsets where the implied mapping ' +
              'contradicts itself are impossible and are marked as such.'
            : 'Subtracting the crib from the ciphertext gives the key letters that would have produced ' +
              'it. On a Caesar the implied letters are all the same; on a Vigenere they repeat with the ' +
              'key length.');
        var out = note(mode);
        out += '<div style="margin:0 0 0.6rem;">' + field('ce-crib', cribText, 'Crib &mdash; the plaintext you are guessing', 'a word you expect') + '</div>';
        if (r.kind === 'xor') {
          out += '<label style="display:inline-flex;align-items:center;gap:0.4rem;margin:0 0 0.6rem;' +
            'font-size:0.8rem;color:' + INK3 + ';cursor:pointer;">' +
            '<input type="checkbox" id="ce-strict"' + (cribStrict ? ' checked' : '') + ' ' +
            'style="accent-color:var(--accent-2);" />' +
            'Only offsets whose implied bytes repeat</label>';
        }
        out += slider('ce-offset', 0, Math.max(0, cribSpan() - 1), Math.min(cribOffset, Math.max(0, cribSpan() - 1)), 'Crib offset');
        out += '<div id="ce-cribout"></div>';
        return out;
      }

      /* How many offsets there are to drag through: bytes for the XOR room,
         letters for everything else, because the letter ciphers ignore
         spaces and punctuation and an offset counted in raw characters
         would not line up with anything. */
      function cribSpan() {
        var r = room();
        var crib = cribKey();
        if (!crib.length) return 1;
        var n = r.kind === 'xor' ? r.bytes.length : lettersOf(r.ct).length;
        return Math.max(1, n - crib.length + 1);
      }

      function cribKey() {
        var r = room();
        if (r.kind === 'xor') return cribText;
        return lettersOf(cribText);
      }

      function cribOutHtml() {
        var r = room();
        var crib = cribKey();
        if (!crib.length) return note('Type something you expect the message to contain. THE is a fair ' +
          'first guess in any English plaintext; a phrase named by the room behind you is a much better one.');

        if (r.kind === 'xor') return cribXorHtml(crib);
        return cribLetterHtml(crib);
      }

      function cribXorHtml(crib) {
        var r = room();
        var bytes = r.bytes;
        var span = cribSpan();
        var off = Math.min(cribOffset, span - 1);
        var hits = [];
        var o, j;
        for (o = 0; o < span; o++) {
          var imp = [];
          var printable = true;
          for (j = 0; j < crib.length; j++) {
            var kb = bytes[o + j] ^ (crib.charCodeAt(j) & 255);
            imp.push(kb);
            if (kb < 32 || kb > 126) printable = false;
          }
          if (!printable) continue;
          var per = shortestPeriod(imp, 12);
          if (cribStrict && !per) continue;
          hits.push({ off: o, per: per });
        }

        var out = '<p style="margin:0 0 0.6rem;font-size:0.82rem;color:' + INK3 + ';">' +
          hits.length + ' of ' + span + ' offsets ' +
          (cribStrict ? 'give printable key bytes that repeat' : 'give key bytes that are all printable') +
          '.</p>';
        if (hits.length && hits.length <= 60) {
          out += '<div style="display:flex;flex-wrap:wrap;gap:0.25rem;margin:0 0 0.8rem;">';
          for (var h = 0; h < hits.length; h++) {
            out += '<button class="game-btn" type="button" data-cribhit="' + hits[h].off + '" ' +
              'style="padding:0.15rem 0.45rem;font-size:0.72rem;min-width:0;' +
              (hits[h].off === off ? 'border-color:var(--accent-2);' : '') + '" ' +
              'aria-label="Jump to offset ' + hits[h].off + '">' + hits[h].off +
              (hits[h].per ? '<span style="color:' + GOOD + ';"> &middot;' + hits[h].per + '</span>' : '') +
              '</button>';
          }
          out += '</div>';
        }

        /* The selected offset, in full. */
        var sel = [];
        var allPrintable = true;
        for (j = 0; j < crib.length && off + j < bytes.length; j++) {
          var b = bytes[off + j] ^ (crib.charCodeAt(j) & 255);
          sel.push(b);
          if (b < 32 || b > 126) allPrintable = false;
        }
        var period = shortestPeriod(sel, 12);
        var implied = '';
        for (j = 0; j < sel.length; j++) implied += showByte(sel[j]);

        out += label('At offset ' + off);
        out += scrollPre(
          'ciphertext  ' + bytesToHex(bytes.slice(off, off + crib.length)).replace(/(..)/g, '$1 ') + '\n' +
          'crib        ' + bytesToHex(textToBytes(crib)).replace(/(..)/g, '$1 ') + '\n' +
          'implied key ' + bytesToHex(sel).replace(/(..)/g, '$1 ') + '\n' +
          'as text     ' + implied);

        if (!allPrintable) {
          out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + BAD + ';">' +
            'Some implied bytes are not printable characters, so this offset is almost certainly wrong &mdash; ' +
            'keys people choose are typed, and typed bytes are printable.</p>';
        } else if (!period) {
          out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + WARN + ';">' +
            'Printable, but with no repeat in it. Over half the offsets in a message this size manage ' +
            'printable by luck, so printable on its own is not evidence. A repeating key must produce a ' +
            'repeating pattern once the crib is longer than it.</p>';
        } else {
          var aligned = alignKey(implied, off, period);
          out += '<p style="margin:0 0 0.5rem;font-size:0.82rem;color:' + GOOD + ';">' +
            'Printable, and it repeats every ' + period + ' bytes. That is a key length as well as a hit.</p>';
          out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + INK3 + ';">' +
            'The crib starts at byte ' + off + ', and ' + off + ' mod ' + period + ' is ' + (off % period) +
            ', so what you are reading is the key rotated by that much. Lined back up with the start of ' +
            'the message it is <strong style="font-family:' + MONO + ';color:' + INK + ';">' +
            esc(aligned) + '</strong>. ' +
            '<button class="game-btn" type="button" data-usexor="' + esc(aligned) + '" ' +
            'style="margin-left:0.3rem;">Try it on the door</button></p>';
        }
        out += note('XOR is over bytes, so case matters: &ldquo;The&rdquo; and &ldquo;the&rdquo; are ' +
          'different cribs and only one of them can be right. If a crib you are sure about finds nothing, ' +
          'that is the first thing to change.');
        return out;
      }

      function cribLetterHtml(crib) {
        var r = room();
        var letters = lettersOf(r.ct);
        var span = cribSpan();
        var off = Math.min(cribOffset, span - 1);
        var j;

        /* Consistency, for the substitution room: a mapping that asks one
           cipher letter to be two different plaintext letters, or two
           cipher letters to be the same plaintext letter, cannot exist. */
        function consistent(o) {
          var fwd = {};
          var back = {};
          for (var k = 0; k < crib.length; k++) {
            var c = letters.charAt(o + k);
            var p = crib.charAt(k);
            if (fwd[c] && fwd[c] !== p) return false;
            if (back[p] && back[p] !== c) return false;
            fwd[c] = p;
            back[p] = c;
          }
          return true;
        }

        var out = '';
        if (r.kind === 'sub') {
          var ok = [];
          for (var o = 0; o < span; o++) if (consistent(o)) ok.push(o);
          out += '<p style="margin:0 0 0.6rem;font-size:0.82rem;color:' + INK3 + ';">' +
            ok.length + ' of ' + span + ' offsets give a mapping that does not contradict itself.</p>';
          if (ok.length && ok.length <= 60) {
            out += '<div style="display:flex;flex-wrap:wrap;gap:0.25rem;margin:0 0 0.8rem;">';
            for (var i = 0; i < ok.length; i++) {
              out += '<button class="game-btn" type="button" data-cribhit="' + ok[i] + '" ' +
                'style="padding:0.15rem 0.45rem;font-size:0.72rem;min-width:0;' +
                (ok[i] === off ? 'border-color:var(--accent-2);' : '') + '" ' +
                'aria-label="Jump to offset ' + ok[i] + '">' + ok[i] + '</button>';
            }
            out += '</div>';
          }
          var pairs = [];
          var seenC = {};
          for (j = 0; j < crib.length; j++) {
            var cc = letters.charAt(off + j);
            if (seenC[cc]) continue;
            seenC[cc] = 1;
            pairs.push(cc + ' → ' + crib.charAt(j));
          }
          out += label('At offset ' + off + ', in the letter stream');
          out += scrollPre('cipher  ' + letters.substr(off, crib.length) + '\ncrib    ' + crib);
          out += '<p style="margin:0 0 0.6rem;font-size:0.82rem;color:' +
            (consistent(off) ? INK3 : BAD) + ';">' +
            (consistent(off)
              ? 'Implies: ' + esc(pairs.join(', ')) + '.'
              : 'This offset asks one letter to be two things at once, so it cannot be right.') + '</p>';
          if (consistent(off)) {
            out += '<div style="margin:0 0 0.8rem;"><button class="game-btn" type="button" id="ce-crib-apply">' +
              'Put this mapping into the table</button></div>';
          }
          out += note('The crib the third room handed over sits at offset 0 &mdash; a message that opens ' +
            'with the words you were told it opens with. Everything else is a coincidence of letter ' +
            'shapes, and most of them fall over as soon as the crib is longer than four or five letters.');
          return out;
        }

        /* Caesar and Vigenere: implied key letters. */
        var implied = '';
        for (j = 0; j < crib.length && off + j < letters.length; j++) {
          var u = (AL.indexOf(letters.charAt(off + j)) - AL.indexOf(crib.charAt(j)) + 26) % 26;
          implied += AL.charAt(u);
        }
        var arr = [];
        for (j = 0; j < implied.length; j++) arr.push(implied.charCodeAt(j));
        var per = shortestPeriod(arr, 12);

        out += label('At offset ' + off + ', in the letter stream');
        out += scrollPre('cipher      ' + letters.substr(off, crib.length) + '\n' +
          'crib        ' + crib + '\n' +
          'implied key ' + implied);
        if (per === 1 && implied.length > 1) {
          out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + GOOD + ';">' +
            'Every implied letter is the same &mdash; ' + implied.charAt(0) + ' &mdash; which is what a single ' +
            'shift looks like. That is a Caesar of ' + AL.indexOf(implied.charAt(0)) + '.</p>';
        } else if (per) {
          out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + GOOD + ';">' +
            'The implied letters repeat every ' + per + ', which is a candidate key length and a ' +
            'candidate key: ' + esc(alignKey(implied, off, per)) + ' once lined back up with the start ' +
            'of the letters.</p>';
        } else {
          out += '<p style="margin:0 0 0.7rem;font-size:0.82rem;color:' + INK4 + ';">' +
            'No repeat in the implied letters at this offset. Keep dragging, or lengthen the crib &mdash; a ' +
            'three-letter crib will look like a hit somewhere in almost any message.</p>';
        }
        return out;
      }

      /* ---- Hex and text ---- */
      function hexHtml() {
        var r = room();
        var bytes = r.kind === 'xor' ? r.bytes : textToBytes(r.ct);
        var out = '<div style="display:flex;gap:0.35rem;margin:0 0 0.7rem;">' +
          '<button class="game-btn" type="button" data-hexmode="hex" aria-pressed="' + (hexMode === 'hex') + '" ' +
          'style="' + (hexMode === 'hex' ? 'border-color:var(--accent-2);' : '') + '">Hex</button>' +
          '<button class="game-btn" type="button" data-hexmode="text" aria-pressed="' + (hexMode === 'text') + '" ' +
          'style="' + (hexMode === 'text' ? 'border-color:var(--accent-2);' : '') + '">Text</button>' +
          '</div>';
        out += label('Ciphertext, ' + bytes.length + ' bytes');
        out += scrollPre(hexMode === 'hex' ? hexView(bytes) : bytesToText(bytes));
        if (r.kind === 'xor') {
          var dec = wXorKey ? xorDecode(bytes, wXorKey) : '';
          out += label('With the key currently in the door' + (wXorKey ? '' : ' — nothing typed yet'));
          out += scrollPre(wXorKey
            ? (hexMode === 'hex' ? strToHexView(dec) : bytesToText(textToBytes(dec)))
            : '(type a key in the room above)');
        }
        var np = 0;
        for (var i = 0; i < bytes.length; i++) if (bytes[i] < 32 || bytes[i] > 126) np++;
        out += note(np
          ? np + ' of ' + bytes.length + ' bytes are outside printable ASCII, which is roughly ' +
            pct(np, bytes.length) + ' per cent. That alone says the message is not text in any encoding &mdash; ' +
            'and it is the reason the frequency histogram has nothing useful to say about this room.'
          : 'Every byte here is printable ASCII, which is what you would expect: this room is letters and ' +
            'punctuation. The hex view is worth having anyway, because it is the only view in which ' +
            '&ldquo;the same letter twice&rdquo; and &ldquo;two bytes that happen to render alike&rdquo; are ' +
            'different things.');
        return out;
      }

      function toolHtml() {
        if (tool === 'freq') return freqHtml();
        if (tool === 'shifts') return shiftsHtml();
        if (tool === 'kasiski') return kasiskiHtml();
        if (tool === 'crib') return cribHtml();
        return hexHtml();
      }

      /* ============================================================
         Painting.
         ============================================================ */
      /* The word first, the colour second. A player who cannot tell the
         green from the amber still reads "Open", "Opened for you" or
         "Locked", and the setting is spelled out either way. */
      function statusHtml() {
        var state = solved[at];
        if (state === 'given') {
          return '<span style="color:' + WARN + ';">Opened for you. ' +
            'The setting was ' + esc(answerWords()) + ', and this room scores nothing.</span>';
        }
        if (state === 'solved') {
          /* Once a door is open it stays open, even if the player then
             drags the slider off the answer to see what happens — which
             several will, and which should not re-lock a room they have
             already been paid for. */
          return '<span style="color:' + GOOD + ';">Open. You found ' + esc(answerWords()) + '.' +
            (isOpen() ? '' : ' The controls have been moved since; the door does not close again.') + '</span>';
        }
        return '<span style="color:' + INK4 + ';">Locked. Current setting: ' + esc(settingText()) + '.</span>';
      }

      function answerWords() {
        var r = room();
        if (r.kind === 'caesar') return 'a shift of ' + r.answer;
        if (r.kind === 'vigenere') return 'the key ' + r.answer;
        if (r.kind === 'rail') return r.answer + ' rails';
        if (r.kind === 'sub') return 'the alphabet A to Z mapping to ' + r.answer;
        return 'the key "' + r.answer + '"';
      }

      function build() {
        var r = room();
        var html = '<div id="ce-strip">' + stripHtml() + '</div>' +
          '<section>' +
          '<p style="margin:0 0 0.2rem;font-size:0.68rem;letter-spacing:0.07em;text-transform:uppercase;' +
          'color:' + INK4 + ';">Room ' + r.no + ' of ' + ROOMS.length + ' &middot; ' + esc(r.cipher) +
          ' &middot; ' + r.points + ' points</p>' +
          '<h3 style="margin:0 0 0.5rem;font-size:1.05rem;color:' + INK + ';">' + esc(r.name) + '</h3>' +
          para(r.story) +
          label('Ciphertext') +
          pre('ce-ct', r.ct, 'max-height:11rem;overflow:auto;') +
          '<div id="ce-controls">' + controlsHtml() + '</div>' +
          label('What that gives you') +
          pre('ce-out', '', 'min-height:4.5rem;max-height:13rem;overflow:auto;') +
          '<p id="ce-status" style="margin:0 0 0.6rem;font-size:0.85rem;line-height:1.6;"></p>' +
          '<p id="ce-hintbox" style="margin:0 0 0.7rem;padding:0.55rem 0.7rem;border-radius:8px;' +
          'background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);font-size:0.82rem;' +
          'line-height:1.6;color:' + INK3 + ';" hidden></p>' +
          '<div id="ce-door" style="margin:0 0 1rem;"></div>' +
          para(r.teach) +
          '</section>' +
          '<section style="margin:1.2rem 0 0;padding-top:0.9rem;border-top:1px solid ' + LINE + ';">' +
          label('Tools &mdash; free, always open, live on this room&rsquo;s ciphertext') +
          '<div id="ce-tabs">' + tabsHtml() + '</div>' +
          '<div id="ce-tool"></div>' +
          '</section>' +
          '<div id="ce-notes">' + notesHtml() + '</div>' +
          '<p style="margin:1.1rem 0 0;font-size:0.76rem;line-height:1.6;color:' + INK4 + ';">' +
          'The same five ciphers sit in <a href="/labs/cipher">the cipher playground</a> as a workbench &mdash; ' +
          'one box, every cipher, no story and nothing locked. This is the chain; that is the bench. ' +
          'Neither is encryption: <a href="/labs/cryptography">the cryptography visualiser</a> and ' +
          '<a href="/labs/hash">the hash tools</a> are what actually replaced these.</p>';

        host.innerHTML = html;
        node.out = host.querySelector('#ce-out');
        node.status = host.querySelector('#ce-status');
        node.door = host.querySelector('#ce-door');
        node.hintbox = host.querySelector('#ce-hintbox');
        node.tool = host.querySelector('#ce-tool');
        node.tabs = host.querySelector('#ce-tabs');

        paintTool();
        wireControls();
        paintOutput();
        paintHints();
        g.stat('room', r.no + '/' + ROOMS.length);
      }

      function paintTool() {
        node.tool.innerHTML = toolHtml();
        if (tool === 'kasiski') paintKasCols();
        if (tool === 'crib') paintCribOut();
        syncOutputs();
      }

      function paintKasCols() {
        var slot = host.querySelector('#ce-kascols');
        if (slot) slot.innerHTML = kasColsHtml();
      }

      function paintCribOut() {
        var slot = host.querySelector('#ce-cribout');
        if (slot) slot.innerHTML = cribOutHtml();
      }

      function paintFence() {
        var slot = host.querySelector('#ce-fence');
        if (slot) slot.innerHTML = fenceHtml();
      }

      function paintMap() {
        var slot = host.querySelector('#ce-map');
        if (slot) slot.innerHTML = mapHtml();
      }

      /* Every <output> beside a slider, refreshed from the live values.
         Kept in one place because four sliders in three panels would
         otherwise each need to remember to do it. */
      function syncOutputs() {
        setOut('ce-shift-out', wShift + ' → ' + (wShift ? 'back ' + wShift : 'unchanged'));
        setOut('ce-rails-out', wRails + ' rails');
        setOut('ce-shiftpick-out', 'shift ' + shiftPick);
        setOut('ce-kaslen-out', 'length ' + kasLen);
        setOut('ce-offset-out', 'offset ' + Math.min(cribOffset, Math.max(0, cribSpan() - 1)));
      }

      function setOut(id, text) {
        var el = host.querySelector('#' + id);
        if (el) el.textContent = text;
      }

      function paintOutput() {
        if (!node.out) return;
        node.out.textContent = outputText();
        node.status.innerHTML = statusHtml();
        paintDoor();
      }

      function paintDoor() {
        if (!node.door) return;
        var state = solved[at];
        if (state) {
          var last = at === ROOMS.length - 1;
          node.door.innerHTML = '<button class="btn btn-primary" type="button" id="ce-next">' +
            (last ? 'Leave' : 'Go through the door') + '</button>';
          var b = host.querySelector('#ce-next');
          b.addEventListener('click', function () { advance(); });
          return;
        }
        node.door.innerHTML = '';
      }

      function paintHints() {
        if (!node.hintbox) return;
        var taken = hintsAt[at] || 0;
        var r = room();
        if (!taken) {
          node.hintbox.hidden = true;
          node.hintbox.innerHTML = '';
        } else {
          var lines = [];
          for (var i = 0; i < taken && i < r.hints.length; i++) {
            lines.push('<span style="display:block;margin-bottom:0.3rem;">' + r.hints[i] + '</span>');
          }
          node.hintbox.hidden = false;
          node.hintbox.innerHTML = lines.join('');
        }
        if (hintBtn) {
          var left = r.hints.length - taken;
          hintBtn.disabled = done || !!solved[at] || left <= 0;
          hintBtn.textContent = left > 0
            ? 'Hint (−' + Math.round(r.points * HINT_SHARE) + ')'
            : 'No hints left';
        }
        if (openBtn) openBtn.disabled = done || !!solved[at];
        g.stat('hints', hintsTotal);
      }

      /* ============================================================
         Wiring. Re-run after every rebuild of the room or the tool
         panel, because innerHTML throws the old listeners away with the
         old nodes.
         ============================================================ */
      function wireControls() {
        var r = room();
        if (r.kind === 'rail') paintFence();
        if (r.kind === 'sub') { paintMap(); paintConflict(); }
        syncOutputs();
      }

      function paintConflict() {
        var slot = host.querySelector('#ce-conflict');
        if (slot) slot.innerHTML = conflictText();
      }

      /* One delegated listener for the whole board, rather than a listener
         per control. The room and the tool panel are both rebuilt by
         innerHTML — several times a minute in the substitution room — and a
         per-node listener would have to be re-attached every time, which is
         the shape of bug where one panel quietly stops responding after the
         third redraw. */
      host.addEventListener('click', function (event) {
        var t = event.target;
        if (!t || !t.closest) return;
        var b = t.closest('button');
        if (!b) return;

        var step = b.getAttribute('data-step');
        if (step) {
          var bits = step.split('|');
          nudge(bits[0], parseInt(bits[1], 10));
          return;
        }
        var tk = b.getAttribute('data-tool');
        if (tk) {
          if (tk === tool) return;
          tool = tk;
          node.tabs.innerHTML = tabsHtml();
          paintTool();
          sayNow(b.textContent + ' tool');
          return;
        }
        var hm = b.getAttribute('data-hexmode');
        if (hm) { hexMode = hm; paintTool(); return; }
        var hit = b.getAttribute('data-cribhit');
        if (hit != null) {
          cribOffset = parseInt(hit, 10);
          var os = host.querySelector('#ce-offset');
          if (os) os.value = String(cribOffset);
          syncOutputs();
          paintCribOut();
          return;
        }
        var ux = b.getAttribute('data-usexor');
        if (ux) {
          wXorKey = ux;
          var xf = host.querySelector('#ce-xor');
          if (xf) xf.value = ux;
          changed();
          return;
        }
        if (b.id === 'ce-use-shift') { wShift = shiftPick; setRange('ce-shift', wShift); changed(); return; }
        if (b.id === 'ce-use-key') {
          var key = '';
          for (var c = 0; c < kasLen; c++) key += columnCandidates(columnOf(room().ct, kasLen, c))[0].letter;
          wKey = key;
          var kf = host.querySelector('#ce-key');
          if (kf) kf.value = key;
          changed();
          return;
        }
        if (b.id === 'ce-crib-fill') { fillCrib(); return; }
        if (b.id === 'ce-crib-apply') { applyCribMapping(); return; }
        if (b.id === 'ce-map-clear') { wMap = {}; paintMap(); paintConflict(); changed(); return; }
      });

      /* ONE delegated input listener, not two. The first version had a
         second one just for the substitution table's cells, because they
         are the only inputs on the board with no id — and every keystroke
         in that table then ran the handler twice, which was harmless right
         up until it was not. The cells are matched on data-sub here
         instead. */
      host.addEventListener('input', function (event) {
        var t = event.target;
        if (!t) return;
        if (t.getAttribute && t.getAttribute('data-sub')) { onMapInput(t); return; }
        if (!t.id) return;
        if (t.id === 'ce-shift') { wShift = Number(t.value) || 0; changed(); return; }
        if (t.id === 'ce-rails') { wRails = Number(t.value) || 2; paintFence(); changed(); return; }
        if (t.id === 'ce-key') { wKey = t.value; changed(); return; }
        if (t.id === 'ce-xor') { wXorKey = t.value; changed(); return; }
        if (t.id === 'ce-shiftpick') { shiftPick = Number(t.value) || 0; highlightShift(); return; }
        if (t.id === 'ce-kaslen') { kasLen = Number(t.value) || 1; syncOutputs(); paintKasCols(); return; }
        if (t.id === 'ce-offset') { cribOffset = Number(t.value) || 0; syncOutputs(); paintCribOut(); return; }
        if (t.id === 'ce-crib') { cribText = t.value; cribOffset = 0; retuneOffset(); paintCribOut(); return; }
      });

      host.addEventListener('change', function (event) {
        var t = event.target;
        if (t && t.id === 'ce-strict') { cribStrict = !!t.checked; paintCribOut(); }
      });

      function onMapInput(input) {
        var c = input.getAttribute('data-sub');
        var v = String(input.value || '').toUpperCase().replace(/[^A-Z]/g, '');
        input.value = v;
        if (v) wMap[c] = v; else delete wMap[c];
        paintConflict();
        changed();
      }

      function setRange(id, value) {
        var el = host.querySelector('#' + id);
        if (el) el.value = String(value);
        syncOutputs();
      }

      function nudge(id, delta) {
        var el = host.querySelector('#' + id);
        if (!el) return;
        var min = Number(el.min);
        var max = Number(el.max);
        var v = Number(el.value) + delta;
        if (v < min) v = min;
        if (v > max) v = max;
        el.value = String(v);
        /* Dispatching would need a constructed event, which is more
           machinery than calling the same code the event handler calls. */
        if (id === 'ce-shift') { wShift = v; changed(); }
        else if (id === 'ce-rails') { wRails = v; paintFence(); changed(); }
        else if (id === 'ce-shiftpick') { shiftPick = v; highlightShift(); }
        else if (id === 'ce-kaslen') { kasLen = v; syncOutputs(); paintKasCols(); }
        else if (id === 'ce-offset') { cribOffset = v; syncOutputs(); paintCribOut(); }
      }

      function retuneOffset() {
        var el = host.querySelector('#ce-offset');
        if (!el) return;
        el.max = String(Math.max(0, cribSpan() - 1));
        if (Number(el.value) > Number(el.max)) el.value = el.max;
        cribOffset = Number(el.value) || 0;
        syncOutputs();
      }

      function highlightShift() {
        var rows = host.querySelectorAll('[data-shiftrow]');
        for (var i = 0; i < rows.length; i++) {
          var on = Number(rows[i].getAttribute('data-shiftrow')) === shiftPick;
          rows[i].style.color = on ? INK : INK4;
          rows[i].style.background = on ? 'rgba(96,165,250,0.16)' : 'transparent';
        }
        var use = host.querySelector('#ce-use-shift');
        if (use) use.textContent = 'Use shift ' + shiftPick + ' on the door';
        syncOutputs();
        say('Shift ' + shiftPick);
      }

      function fillCrib() {
        var r = room();
        var letters = lettersOf(r.ct);
        var crib = lettersOf(CRIBS[at]);
        for (var i = 0; i < crib.length; i++) wMap[letters.charAt(i)] = crib.charAt(i);
        paintMap();
        paintConflict();
        changed();
        sayNow('Crib placed. ' + crib.length + ' positions assigned.');
      }

      function applyCribMapping() {
        var r = room();
        var letters = lettersOf(r.ct);
        var crib = cribKey();
        var off = Math.min(cribOffset, Math.max(0, cribSpan() - 1));
        for (var i = 0; i < crib.length; i++) wMap[letters.charAt(off + i)] = crib.charAt(i);
        paintMap();
        paintConflict();
        changed();
        sayNow('Mapping from offset ' + off + ' applied to the table.');
      }

      /* ============================================================
         The door.
         ============================================================ */
      function changed() {
        paintOutput();
        if (tool === 'crib') { retuneOffset(); paintCribOut(); }
        if (!solved[at] && !done && isOpen()) open();
        else say(settingText());
      }

      function open() {
        solved[at] = 'solved';
        var r = room();
        var pts = Math.max(0, r.points - Math.round(r.points * HINT_SHARE) * (hintsAt[at] || 0));
        earned[at] = pts;
        bank();
        /* A latch, then the door. Two sounds rather than one because the
           moment worth marking is the click of recognition, and a single
           sweep puts all of it after the fact. */
        g.noise(0.09, { type: 'bandpass', freq: 1700, q: 2.4, level: 0.05 });
        g.pluck(523.25, 0.5, 0.05);
        g.pluck(784, 0.7, 0.045);
        host.querySelector('#ce-strip').innerHTML = stripHtml();
        paintOutput();
        paintHints();
        sayNow('Room ' + r.no + ' is open. ' + pts + ' points. ' +
          (at === ROOMS.length - 1 ? 'Press Enter to leave.' : 'Press Enter to go through.'));
      }

      function giveUp() {
        if (done || solved[at]) return;
        solved[at] = 'given';
        earned[at] = 0;
        var r = room();
        /* The room is set to its answer so the plaintext is actually
           readable — the chain depends on the player being able to read
           what this room says next, and a door that opens onto a blank
           wall breaks the game rather than the puzzle. */
        if (r.kind === 'caesar') { wShift = r.answer; setRange('ce-shift', wShift); }
        else if (r.kind === 'vigenere') { wKey = r.answer; var kf = host.querySelector('#ce-key'); if (kf) kf.value = wKey; }
        else if (r.kind === 'rail') { wRails = r.answer; setRange('ce-rails', wRails); paintFence(); }
        else if (r.kind === 'sub') {
          wMap = {};
          for (var i = 0; i < 26; i++) wMap[r.answer.charAt(i)] = AL.charAt(i);
          paintMap();
          paintConflict();
        } else { wXorKey = r.answer; var xf = host.querySelector('#ce-xor'); if (xf) xf.value = wXorKey; }
        bank();
        g.beep(180, 0.09, 'square');
        host.querySelector('#ce-strip').innerHTML = stripHtml();
        paintOutput();
        paintHints();
        sayNow('Opened for you. The setting was ' + answerWords() + '. This room scores nothing.');
      }

      function bank() {
        var total = 0;
        for (var i = 0; i < earned.length; i++) total += earned[i] || 0;
        g.setScore(total);
      }

      function takeHint() {
        if (done || solved[at]) return;
        var r = room();
        var taken = hintsAt[at] || 0;
        if (taken >= r.hints.length) return;
        hintsAt[at] = taken + 1;
        hintsTotal++;
        g.beep(420, 0.05, 'sine', 0.04);
        paintHints();
        sayNow(String(r.hints[taken]).replace(/<[^>]+>/g, ''));
      }

      function advance() {
        if (!solved[at]) return;
        if (at === ROOMS.length - 1) { finish(); return; }
        at++;
        enter();
      }

      function enter() {
        var r = room();
        wShift = 0;
        wKey = '';
        wRails = 2;
        wMap = {};
        wXorKey = '';
        shiftPick = 0;
        kasLen = r.kind === 'vigenere' ? 6 : 1;
        cribText = CRIBS[at] || '';
        cribOffset = 0;
        cribStrict = true;
        hexMode = r.kind === 'xor' ? 'hex' : 'text';
        tool = r.kind === 'xor' ? 'crib' : 'freq';
        build();
        g.noise(0.3, { type: 'lowpass', freq: 420, to: 120, q: 0.7, level: 0.05 });
        sayNow('Room ' + r.no + ' of ' + ROOMS.length + '. ' + r.cipher + '.');
      }

      function finish() {
        done = true;
        var total = 0;
        var clean = 0;
        var given = 0;
        for (var i = 0; i < ROOMS.length; i++) {
          total += earned[i] || 0;
          if (solved[i] === 'solved') clean++;
          if (solved[i] === 'given') given++;
        }
        var message = clean + ' of ' + ROOMS.length + ' rooms broken yourself';
        message += given ? ', ' + given + ' opened for you' : '';
        message += hintsTotal ? ', ' + hintsTotal + (hintsTotal === 1 ? ' hint' : ' hints') + ' taken.' : ', no hints.';
        if (clean === ROOMS.length && !hintsTotal) {
          message += ' That is the maximum. Every one of these would have fallen to a laptop in under a ' +
            'second, which is the only reason you were allowed to enjoy it.';
        } else if (clean >= 4) {
          message += ' The substitution is the one worth going back for — it is the room where the tools ' +
            'stop being a demonstration and start doing the work.';
        } else {
          message += ' Worth another run. The tools carry over between rooms on purpose: the histogram ' +
            'is what tells a transposition from a substitution before you have decided anything.';
        }
        g.over({ won: clean >= 4, score: total, title: total + ' points', message: message });
      }

      if (hintBtn) hintBtn.addEventListener('click', function () { takeHint(); });
      if (openBtn) openBtn.addEventListener('click', function () { giveUp(); });

      return {
        reset: function () {
          at = 0;
          done = false;
          hintsTotal = 0;
          solved = [];
          hintsAt = [];
          earned = [];
          for (var i = 0; i < ROOMS.length; i++) { solved.push(null); hintsAt.push(0); earned.push(0); }
          g.setScore(0);
          g.stat('hints', 0);
          enter();
        },

        /* Arrows and the action key only, and only when the keyboard is on
           the board itself or on a button — a range input, a text field and
           a checkbox all handle their own arrows, and the shell already
           declines to forward keys from them. So this covers exactly the
           case where a player has tabbed to the playfield and has not yet
           reached a control. */
        key: function (name) {
          if (name === 'action') {
            var next = host.querySelector('#ce-next');
            if (next) next.click();
            return;
          }
          if (name === 'left' || name === 'right') {
            var d = name === 'right' ? 1 : -1;
            var r = room();
            if (r.kind === 'caesar') nudge('ce-shift', d);
            else if (r.kind === 'rail') nudge('ce-rails', d);
            else if (tool === 'crib') nudge('ce-offset', d);
            return;
          }
          if (name === 'up' || name === 'down') {
            var idx = 0;
            for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].key === tool) idx = i;
            idx = (idx + (name === 'down' ? 1 : -1) + TOOLS.length) % TOOLS.length;
            tool = TOOLS[idx].key;
            node.tabs.innerHTML = tabsHtml();
            paintTool();
            sayNow(TOOLS[idx].name.replace(/&amp;/g, 'and') + ' tool');
          }
        }
      };
    }
  });
})();

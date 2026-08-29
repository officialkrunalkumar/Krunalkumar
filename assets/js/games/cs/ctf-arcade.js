/* ==========================================================================
   ctf-arcade.js — twelve small capture-the-flag challenges, hardest last.
   --------------------------------------------------------------------------
   Two decisions here are not obvious from the code.

   A HINT CAN NEVER COST YOU ANYTHING. The cost is subtracted at the moment
   the challenge is solved, not at the moment the hint is read. Charge it up
   front and a player who takes the hint, still fails, and gives up ends the
   challenge worse off than one who never tried — which teaches people to sit
   and stare rather than ask, the opposite of what a ladder like this is for.
   Giving up always scores zero, hint or no hint, so reading one is at worst
   free.

   THE TYPING INPUT IS OFF-SCREEN, AND IT DOES NOT ALWAYS TAKE FOCUS. The
   shell binds no keys at all under rawInput, so a real <input> has to exist
   to catch keystrokes and to raise the keyboard on a phone; it lives at
   -9999px, the same trick subnet-sprint uses. But the whole point of these
   artefacts is that you can select a base64 blob and paste it into the
   matching lab, and grabbing focus on every pointerdown collapses the
   selection as you start dragging. So the focus grab is skipped when the
   press lands inside the artefact panel or on a control of its own.
   ========================================================================== */

(function () {
  'use strict';

  /* Every artefact below was produced by encoding the flag beside it, then
     pasted in verbatim. 'why' is what the player is owed once it is over. */
  var LEVELS = [
    {
      name: 'Base64',
      pts: 40,
      brief: 'A note left in a public paste. It is not long and it is not random.',
      art: 'Q1RGe2Jhc2U2NF9pc19ub3RfZW5jcnlwdGlvbn0=',
      flag: 'CTF{base64_is_not_encryption}',
      hint: 'Letters, digits, and a trailing equals sign used as padding. That alphabet and that padding are base64 and almost nothing else.',
      why: 'Base64 rewrites three bytes as four characters drawn from a 64-character alphabet, so binary can travel ' +
        'through anything that only accepts text &mdash; mail bodies, JSON, a URL. It is an encoding, not a cipher: there ' +
        'is no key, the table is published, and anyone who recognises it can undo it. The <code>=</code> on the end ' +
        'is padding to a multiple of four, and it is usually the thing that gives base64 away at a glance.',
      lab: 'The <a href="/labs/encoding">encoder and decoder</a> in Labs detects the format for you and shows the bytes.'
    },
    {
      name: 'Hex',
      pts: 50,
      brief: 'Twenty-two pairs pulled out of a file dump.',
      art: '43 54 46 7B 68 65 78 5F 69 73 5F 6A 75 73 74 5F\n62 79 74 65 73 7D',
      flag: 'CTF{hex_is_just_bytes}',
      hint: '0x43 is 67 in decimal, and 67 is the ASCII code for a capital C.',
      why: 'Two hexadecimal digits are exactly one byte, which is why every hex dump on earth prints them in pairs. ' +
        'The alphabet only ever runs 0&ndash;9 and A&ndash;F and the digit count is always even, so hex is one of ' +
        'the easiest encodings to recognise. <code>7B</code> and <code>7D</code> are the curly braces, and spotting ' +
        'those two at the start and end of a run is often how you find a flag in a binary.',
      lab: 'Paste it into the <a href="/labs/encoding">encoder and decoder</a> to see the bytes line up against ASCII.'
    },
    {
      name: 'Backwards',
      pts: 50,
      brief: 'Recovered from a config file. No encoding was involved at all.',
      art: '}sdrawkcab_em_daer{FTC',
      flag: 'CTF{read_me_backwards}',
      hint: 'Read the last character first. A flag never ends with an opening brace.',
      why: 'There is nothing to decode here &mdash; the string is simply written in reverse, and it is in the ladder ' +
        'because it is the one people stare straight past while trying every decoder they own. The braces settle ' +
        'it in a second: a flag opens with <code>{</code> and closes with <code>}</code>, so a string that starts ' +
        'with a closing brace is either reversed or not a flag. Check the cheap thing first.',
      lab: 'Nothing in Labs for this one. Reversing a string is one line in any language, and your eyes do it faster.'
    },
    {
      name: 'ROT13',
      pts: 60,
      brief: 'Posted under a spoiler warning on a forum.',
      art: 'PGS{ebg13_vf_pnrfne_guvegrra}',
      flag: 'CTF{rot13_is_caesar_thirteen}',
      hint: 'Every flag starts with the same three letters. Here they arrived as P, G and S — count the distance from C to P.',
      why: 'ROT13 shifts each letter thirteen places through the alphabet. Because the alphabet is twenty-six letters ' +
        'long, applying it twice returns the original, which is why it needs no separate encoder and decoder. ' +
        'It exists to stop you reading a spoiler by accident, and it protects nothing from anybody who is trying. ' +
        'Digits and punctuation pass through untouched, which is why <code>13</code> is still <code>13</code>.',
      lab: 'The <a href="/labs/cipher">classical cipher playground</a> will show you all twenty-five shifts at once.'
    },
    {
      name: 'Percent-encoding',
      pts: 60,
      brief: 'One line out of a web server access log.',
      art: 'GET /track?id=99&ref=CTF%7Bpercent_encoding_hides_braces%7D&src=e%2Dmail HTTP/1.1',
      flag: 'CTF{percent_encoding_hides_braces}',
      hint: 'A percent sign followed by two hex digits is one byte. You already know from the hex level what 7B and 7D are.',
      why: 'A URL may only carry a limited set of characters, so everything else is written as <code>%</code> ' +
        'followed by that byte in hex. <code>%7B</code> is <code>{</code>, <code>%7D</code> is <code>}</code> and ' +
        '<code>%20</code> is a space. That is why a flag sitting in a query string nearly always turns up as ' +
        '<code>CTF%7B...%7D</code>, and why <code>%2D</code> here is just a hyphen encoded for no reason &mdash; which ' +
        'is allowed, and is a common way of slipping a string past a filter that only checks for the literal text.',
      lab: 'The <a href="/labs/url-inspector">URL inspector</a> pulls a link apart parameter by parameter and unwraps each encoding layer.'
    },
    {
      name: 'Binary',
      pts: 70,
      brief: 'Fifteen groups of eight, from a puzzle box.',
      art: '01000011 01010100 01000110 01111011 01100101\n01101001 01100111 01101000 01110100 01011111\n01100010 01101001 01110100 01110011 01111101',
      flag: 'CTF{eight_bits}',
      hint: 'Each group is one ASCII byte. 01000011 is 64 + 2 + 1 = 67.',
      why: 'Eight bits to a byte, one byte per character, plain ASCII. Two patterns are worth memorising because ' +
        'they let you read a binary blob without converting anything: capital letters all begin <code>010</code> ' +
        'and lowercase letters all begin <code>011</code>. The gap between the two is a single bit &mdash; bit 5 &mdash; which ' +
        'is the whole reason changing case in ASCII is one XOR with 32.',
      lab: 'The <a href="/labs/encoding">encoder and decoder</a> handles binary in both directions, spaces or no spaces.'
    },
    {
      name: 'EXIF dump',
      pts: 80,
      brief: 'The metadata block from a photograph somebody posted publicly. The flag is a field, not a puzzle.',
      art: 'File Name          : IMG_20240817_161302.jpg\n' +
        'File Size          : 3.1 MB\n' +
        'Make               : Google\n' +
        'Model              : Pixel 7a\n' +
        'Software           : HDR+ 1.0.540215162zd\n' +
        'Date/Time Original : 2024:08:17 16:13:02\n' +
        'Exposure Time      : 1/120\n' +
        'F Number           : 1.9\n' +
        'ISO                : 58\n' +
        'Focal Length       : 4.9 mm\n' +
        'Orientation        : Rotate 90 CW\n' +
        'GPS Latitude       : 51 deg 30\' 26.11" N\n' +
        'GPS Longitude      : 0 deg 7\' 39.93" W\n' +
        'GPS Altitude       : 21.4 m\n' +
        'Color Space        : sRGB\n' +
        'User Comment       : CTF{metadata_outlives_the_photo}\n' +
        'Image Description  : holiday snap, do not publish\n' +
        'Artist             :\n' +
        'Copyright          :',
      flag: 'CTF{metadata_outlives_the_photo}',
      hint: 'Read every field, including the ones cameras leave for the user rather than fill in themselves.',
      why: 'EXIF is a block of tags a camera writes into the image file itself, and it travels with the picture ' +
        'wherever it goes. Most of it is dull &mdash; exposure, focal length &mdash; but the same block routinely carries the ' +
        'exact coordinates the shutter was pressed at, the phone\'s model, and free-text fields like ' +
        '<code>UserComment</code> that editing software fills in and nobody ever looks at. The coordinates above ' +
        'are a real place. This is how people have published their own home address attached to a photo of a cat.',
      lab: 'The <a href="/labs/exif">EXIF viewer</a> reads the same fields out of a photo of your own and will write a stripped copy back out.'
    },
    {
      name: 'Response headers',
      pts: 80,
      brief: 'The response headers from a login page. One of them is carrying more than it should.',
      art: 'HTTP/1.1 200 OK\n' +
        'Date: Tue, 11 Mar 2025 09:14:22 GMT\n' +
        'Server: nginx\n' +
        'Content-Type: text/html; charset=utf-8\n' +
        'Cache-Control: no-store\n' +
        'Set-Cookie: sid=8f3ac91e0b41d7; Path=/; HttpOnly; Secure\n' +
        'Set-Cookie: theme=dark; Path=/; Max-Age=31536000\n' +
        'Set-Cookie: debug_note=CTF%7Bset_cookie_is_just_a_header%7D; Path=/; SameSite=Lax\n' +
        'X-Powered-By: Express\n' +
        'Vary: Accept-Encoding',
      flag: 'CTF{set_cookie_is_just_a_header}',
      hint: 'Three cookies are set. One of them is not doing a job any site needs, and its value still has percent-encoding on it.',
      why: 'A cookie is not a special kind of storage &mdash; it is a header the server sends and the browser sends back ' +
        'on every subsequent request to that host. Anything a developer puts in one is visible in the response, ' +
        'in the browser\'s own tools, and to anything sitting on the path that can read the traffic. The braces ' +
        'arrive percent-encoded not because they are illegal &mdash; RFC 6265 actually allows them in a cookie value ' +
        '&mdash; but because most frameworks encode everything outside a safe subset rather than track which characters ' +
        'are reserved (semicolons, commas, quotes and whitespace are). So decode it exactly as in the URL level. ' +
        'Note which cookies here carry <code>HttpOnly</code> and <code>Secure</code>, and which one does not.',
      lab: 'The <a href="/labs/url-inspector">URL inspector</a> decodes values like this one without you having to visit the site.'
    },
    {
      name: 'Caesar shift',
      pts: 100,
      brief: 'A shifted alphabet, but not by thirteen. Work out how far.',
      art: 'JAM{jhlzhy_zopma_vm_zlclu}',
      flag: 'CTF{caesar_shift_of_seven}',
      hint: 'You know the plaintext of the first three characters. C became J.',
      why: 'A Caesar cipher shifts every letter by a fixed amount, and there are only twenty-five shifts that do ' +
        'anything at all, so it is broken by trying them. You did not need to: the flag format hands you a crib. ' +
        'Knowing three characters of plaintext collapses the whole key space to one candidate &mdash; <code>C</code> to ' +
        '<code>J</code> is seven places. A known-plaintext attack is the same idea at industrial scale, and it is ' +
        'why real ciphers are designed to survive an attacker who already knows what some of the message says.',
      lab: 'The <a href="/labs/cipher">cipher playground</a> lists every shift down the page, so the readable one just appears.'
    },
    {
      name: 'Vigenere',
      pts: 120,
      brief: 'A Vigenere cipher. The key is KEY. Only letters were enciphered, and the key does not advance on the underscores or the braces.',
      art: 'MXD{fmeorcbi_loibc_e_ioc}',
      flag: 'CTF{vigenere_needs_a_key}',
      hint: 'K is the eleventh letter, so it shifts by 10. E shifts by 4, Y by 24. Subtract those in turn, repeating, and skip anything that is not a letter.',
      why: 'Vigenere is a Caesar whose shift changes every letter, taken from a repeating key: with ' +
        '<code>KEY</code> the shifts run 10, 4, 24, 10, 4, 24 and so on. That defeats simple frequency analysis, ' +
        'because the same plaintext letter comes out differently depending on where it lands. It held up for ' +
        'three centuries and it is still breakable without the key: find the key length first, usually with the ' +
        'index of coincidence, and each slice of the message is then an ordinary Caesar. The awkward part in ' +
        'practice is exactly the rule stated above &mdash; whether the key steps forward on punctuation, since ' +
        'different implementations disagree and the wrong choice garbles everything after the first symbol.',
      lab: 'The <a href="/labs/cipher">cipher playground</a> does Vigenere with a key, and will attack one without a key.'
    },
    {
      name: 'Two layers',
      pts: 130,
      brief: 'One encoding wrapped around another. Peel the outer one first.',
      art: 'UEdTe2dqYl95bmxyZWZfcXJyY30=',
      flag: 'CTF{two_layers_deep}',
      hint: 'Base64, from the padding. What falls out is the right shape for a flag but the wrong letters — you have seen that shape already in this ladder.',
      why: 'The rule for a chain is to peel whichever layer you can identify from the outside, and never to guess. ' +
        'Padding and the base64 alphabet identify the outer layer here. What it yields is ' +
        '<code>PGS{gjb_ynlref_qrrc}</code>: braces and underscores in the right places, so the structure survived ' +
        'the first decode, which means the second layer only touched letters. That narrows it to a substitution, ' +
        'and <code>PGS</code> for <code>CTF</code> is ROT13 again. Multi-layer challenges are almost always a ' +
        'transport encoding on the outside and something that mangles letters underneath.',
      lab: 'Run the base64 through the <a href="/labs/encoding">encoder</a>, then the result through the <a href="/labs/cipher">cipher playground</a>.'
    },
    {
      name: 'Two layers, harder',
      pts: 160,
      brief: 'The last one. Two layers again, both of them encodings you have already met.',
      art: '51 31 52 47 65 33 42 6C 5A 57 78 66 61 58 52 66\n62 47 46 35 5A 58 4A 66 59 6E 6C 66 62 47 46 35\n5A 58 4A 39',
      flag: 'CTF{peel_it_layer_by_layer}',
      hint: 'Pairs of hex digits, so decode that first. The text that comes out is not the flag, but its alphabet and its length should look familiar.',
      why: 'Hex on the outside, base64 underneath. The tell after the first decode is that the result is printable ' +
        'ASCII made only of letters, digits and a padding character &mdash; which is base64 rather than a message. ' +
        'That is the general skill this ladder is really about: identify a layer by its alphabet and its length ' +
        'rather than by trying decoders at random. Hex is always an even number of characters from a set of ' +
        'sixteen; base64 is a set of sixty-four in blocks of four; a Caesar or Vigenere keeps the punctuation and ' +
        'moves only the letters. Three checks, and most chains fall apart in front of you.',
      lab: 'Both layers are the same tool: the <a href="/labs/encoding">encoder and decoder</a>, run twice.'
    }
  ];

  /* Whitespace is stripped before comparing, because a pasted answer often
     drags a newline in with it and rejecting that teaches nothing. */
  function normalise(s) {
    return String(s).replace(/\s+/g, '').toLowerCase();
  }

  function innerOf(flag) {
    return flag.replace(/^CTF\{/, '').replace(/\}$/, '');
  }

  function hintCost(level) {
    return Math.round(level.pts * 0.4);
  }

  GameShell.define({
    id: 'game-ctf-arcade',
    slug: 'ctf-arcade',
    title: 'CTF arcade',
    bestKey: 'ctf-arcade',
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var at = 0;
      var solved = 0;
      var hintsUsed = 0;
      var typed = '';
      var tries = 0;
      var hintOn = false;
      var settled = false;      // this challenge is finished, right or wrong
      var input = null;
      var hintBtn = null;
      var skipBtn = null;
      var node = {};

      function build() {
        host.className = 'game-board board-ctf';
        host.innerHTML =
          '<div class="ctf-top">' +
          '  <span class="ctf-step" id="ctf-step"></span>' +
          '  <span class="ctf-pts" id="ctf-pts"></span>' +
          '</div>' +
          '<h3 class="ctf-title" id="ctf-title"></h3>' +
          '<p class="ctf-brief" id="ctf-brief"></p>' +
          '<pre class="ctf-artefact" id="ctf-art" tabindex="0"></pre>' +
          '<div class="ctf-entry">' +
          '  <p class="ctf-typed is-empty" id="ctf-typed">Type the flag</p>' +
          '  <button class="game-btn ctf-check" type="button" id="ctf-check">Check</button>' +
          '</div>' +
          '<p class="ctf-fb" id="ctf-fb" role="status" aria-live="polite"></p>' +
          '<p class="ctf-hint" id="ctf-hint" hidden></p>' +
          '<div class="ctf-explain" id="ctf-explain" hidden>' +
          '  <p class="ctf-verdict" id="ctf-verdict"></p>' +
          '  <p class="ctf-why" id="ctf-why"></p>' +
          '  <p class="ctf-lab" id="ctf-lab"></p>' +
          '  <button class="btn btn-primary" type="button" id="ctf-next"></button>' +
          '</div>';

        var ids = ['step', 'pts', 'title', 'brief', 'art', 'typed', 'check', 'fb', 'hint', 'explain', 'verdict', 'why', 'lab', 'next'];
        for (var i = 0; i < ids.length; i++) node[ids[i]] = host.querySelector('#ctf-' + ids[i]);

        node.check.addEventListener('click', function () { submit(); });
        node.next.addEventListener('click', function () { advance(); });

        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Type the flag, then press Enter');
        host.appendChild(input);
        input.addEventListener('keydown', onKey);
        /* Covers paste and phone keyboards, which do not always produce a
           keydown per character. */
        input.addEventListener('input', function () {
          var v = input.value;
          input.value = '';
          for (var i = 0; i < v.length; i++) type(v.charAt(i));
        });

        host.addEventListener('pointerdown', function (event) {
          var t = event.target;
          if (t && t.closest && t.closest('#ctf-art, button, a, input')) return;
          focus();
        });

        /* The shell makes the board itself focusable and focuses it when a
           run starts, so a keyboard visitor who tabs to the playfield would
           otherwise be typing into a div. Hand focus straight on to the
           input that is actually listening. */
        host.addEventListener('focusin', function (event) {
          if (event.target === host) focus();
        });

        hintBtn = g.el.querySelector('#game-hint');
        skipBtn = g.el.querySelector('#game-skip');
        if (hintBtn) hintBtn.addEventListener('click', function () { reveal(); });
        if (skipBtn) skipBtn.addEventListener('click', function () { giveUp(); });
      }

      function focus() {
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
      }

      function onKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (g.state !== 'playing') {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (g.state === 'paused') g.resume(); else g.start();
          }
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (settled) advance(); else submit();
          return;
        }
        if (event.key === 'Backspace') {
          event.preventDefault();
          typed = typed.slice(0, -1);
          paintTyped();
          return;
        }
        if (event.key.length !== 1) return;
        event.preventDefault();
        type(event.key);
      }

      function type(ch) {
        if (g.state !== 'playing' || settled) return;
        if (typed.length > 120) return;
        typed += ch;
        paintTyped();
      }

      function paintTyped() {
        node.typed.textContent = typed || 'Type the flag';
        node.typed.className = 'ctf-typed' + (typed ? '' : ' is-empty');
      }

      function say(text, kind) {
        node.fb.textContent = text;
        node.fb.className = 'ctf-fb' + (kind ? ' is-' + kind : '');
      }

      function render() {
        var lv = LEVELS[at];
        settled = false;
        hintOn = false;
        tries = 0;
        typed = '';

        node.step.textContent = 'Challenge ' + (at + 1) + ' of ' + LEVELS.length;
        node.pts.textContent = lv.pts + ' points';
        node.title.textContent = lv.name;
        node.brief.innerHTML = lv.brief;
        node.art.textContent = lv.art;
        node.hint.hidden = true;
        node.hint.textContent = '';
        node.explain.hidden = true;
        node.check.disabled = false;
        say('', null);
        paintTyped();

        if (hintBtn) {
          hintBtn.disabled = false;
          hintBtn.textContent = 'Hint (-' + hintCost(lv) + ')';
        }
        if (skipBtn) skipBtn.disabled = false;

        g.stat('solved', solved + '/' + LEVELS.length);
        focus();
      }

      function reveal() {
        if (g.state !== 'playing' || settled || hintOn) return;
        hintOn = true;
        hintsUsed++;
        node.hint.hidden = false;
        node.hint.textContent = LEVELS[at].hint;
        if (hintBtn) hintBtn.disabled = true;
        g.beep(420, 0.05, 'sine', 0.04);
        focus();
      }

      function submit() {
        if (g.state !== 'playing' || settled) return;
        var lv = LEVELS[at];
        var given = normalise(typed);
        if (!given) { say('Nothing typed yet.', 'wrong'); focus(); return; }

        if (given === normalise(lv.flag)) {
          var gain = lv.pts - (hintOn ? hintCost(lv) : 0);
          solved++;
          g.addScore(gain);
          g.stat('solved', solved + '/' + LEVELS.length);
          g.beep(760, 0.06, 'sine');
          finishLevel(true, gain);
          return;
        }

        tries++;
        /* The commonest near-miss by a distance: the right plaintext with no
           wrapper. Saying so is more use than "wrong" for the sixth time. */
        if (given === normalise(innerOf(lv.flag))) {
          say('That is the right text. Flags are submitted whole, braces and all: CTF{...}', 'wrong');
        } else if (given.indexOf('ctf{') !== 0) {
          say('Not it. Every flag here is the whole thing, from CTF{ to the closing brace.', 'wrong');
        } else {
          say('Not it' + (tries > 2 ? ' — ' + tries + ' tries on this one.' : '.'), 'wrong');
        }
        g.beep(200, 0.07, 'square');
        focus();
      }

      function giveUp() {
        if (g.state !== 'playing' || settled) return;
        g.beep(180, 0.09, 'square');
        finishLevel(false, 0);
      }

      function finishLevel(won, gain) {
        var lv = LEVELS[at];
        settled = true;
        node.check.disabled = true;
        if (hintBtn) hintBtn.disabled = true;
        if (skipBtn) skipBtn.disabled = true;
        say('', null);

        node.explain.hidden = false;
        node.explain.className = 'ctf-explain ' + (won ? 'is-solved' : 'is-given');
        node.verdict.textContent = won
          ? 'Solved. ' + gain + ' points' + (hintOn ? ' after the hint.' : '.')
          : 'The flag was ' + lv.flag;
        node.why.innerHTML = lv.why;
        node.lab.innerHTML = lv.lab;
        node.next.textContent = at + 1 < LEVELS.length ? 'Next challenge' : 'See the score';
        try { node.next.focus({ preventScroll: true }); } catch (err) {}
      }

      function advance() {
        if (!settled) return;
        at++;
        if (at >= LEVELS.length) { finish(); return; }
        render();
      }

      function finish() {
        var message = solved + ' of ' + LEVELS.length + ' solved';
        message += hintsUsed ? ', with ' + hintsUsed + (hintsUsed === 1 ? ' hint.' : ' hints.') : ', no hints.';
        if (solved === LEVELS.length && !hintsUsed) {
          message += ' That is the maximum — every layer identified on sight.';
        } else if (solved >= 9) {
          message += ' The ones that catch people are the chains, where the trick is to name the outer layer before touching it.';
        } else {
          message += ' Worth another run once you have had a play with the labs these link to.';
        }
        g.over({
          won: solved >= 9,
          score: g.score,
          title: g.score + ' points',
          message: message
        });
      }

      build();

      return {
        reset: function () {
          at = 0;
          solved = 0;
          hintsUsed = 0;
          g.setScore(0);
          render();
        }
      };
    }
  });
})();

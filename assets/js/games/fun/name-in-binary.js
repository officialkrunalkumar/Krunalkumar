/* ==========================================================================
   name-in-binary.js — one piece of text, seven encodings, live.
   --------------------------------------------------------------------------
   Three decisions worth writing down.

   EVERYTHING IS DERIVED FROM CODE POINTS AND A HAND-ROLLED UTF-8 ENCODER,
   not from btoa() or String.fromCharCode. Both of those read a JavaScript
   string as Latin-1, so "café" and "નમસ્તે" come out as the wrong bytes or
   throw, and the failure is silent. A page whose entire subject is what your
   name looks like as bytes cannot be wrong about the names that are not
   English — that is most of them. So the text is walked once into code
   points (surrogate pairs joined, unpaired surrogates replaced with U+FFFD
   because UTF-8 cannot carry them), and every row is built from that.

   NONE OF THE SEVEN OUTPUTS IS A LIVE REGION. They all change on every
   keystroke, and seven aria-live boxes announcing nine hundred ones and
   zeros would make this unusable with a screen reader — the opposite of the
   help it looks like. Each output is instead labelled by its own heading, so
   it can be read on demand, and the only thing that announces itself is the
   result of pressing Copy, which is a deliberate action with a short answer.

   THE TYPING SOUND IS THE ENCODING, NOT A CLICK. Every character entered
   plays one short note, and the note is picked by the low half of that
   character's last UTF-8 byte — the second of the two digits sitting in
   the Hexadecimal row. So the tune is not decoration laid over the data,
   it is the data read out loud: the same name always gives the same
   melody, and a name in Devanagari gives a different one for the same
   reason its rows above are longer. Sixteen notes of a major pentatonic
   scale rather than sixteen raw frequencies, because a byte read straight
   as hertz makes anything longer than a word unlistenable, while a
   five-note scale has no interval in it that can clash however far the
   bytes jump. Space is 0x20, so its low nibble is zero and every word
   break lands back on the root. A paste is one gesture rather than forty
   keystrokes and gets a five-note phrase off the front instead of a note
   per character; both paths go through the same gate, so holding a key
   down thins out rather than machine-guns. None of this is announced to a
   screen reader — it is a texture under the typing, not a reading of it,
   and the live region above still says only what Copy did.
   ========================================================================== */

(function () {
  'use strict';

  /* Long enough for a full name and a greeting; short enough that the binary
     row stays a thing you can look at rather than a wall. */
  var MAX = 400;

  var SAMPLES = ['Ada Lovelace', 'café', 'नमस्ते', 'Grace Hopper 🙂'];

  /* ITU Morse: letters, digits and the punctuation the standard actually
     defines. Anything absent from this table genuinely has no Morse code. */
  var MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
    H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
    O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
    V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
    '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
    ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
    '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
  };

  var LEET = { a: '4', b: '8', e: '3', g: '6', i: '1', o: '0', s: '5', t: '7', z: '2' };

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  var ROWS = [
    {
      key: 'binary',
      name: 'Binary',
      note: 'The actual bits: every UTF-8 byte written as eight ones and zeros. Every other row on this page is a shorter way of writing the same thing.'
    },
    {
      key: 'hex',
      name: 'Hexadecimal',
      note: 'The same bytes in base 16, two digits per byte. Hex editors, memory dumps and CSS colours all use it because two hex digits fit one byte exactly.'
    },
    {
      key: 'points',
      name: 'Unicode code points (decimal)',
      note: 'The number Unicode gives each character, before any encoding. Latin letters keep their old ASCII values; anything else is one number here but several bytes above.'
    },
    {
      key: 'base64',
      name: 'Base64',
      note: 'Three bytes rewritten as four characters from a 64-symbol alphabet, so binary survives channels that only carry text — email attachments, data: URLs, tokens in JSON.'
    },
    {
      key: 'morse',
      name: 'Morse code',
      note: 'An 1840s telegraph code with no case and no accents. A slash marks a word break. Characters it cannot carry are left out, and the line below says how many.'
    },
    {
      key: 'rot13',
      name: 'ROT13',
      note: 'Each Latin letter moved thirteen places, which means doing it twice gives you the original back. Usenet used it to hide punchlines and spoilers, never to protect anything.'
    },
    {
      key: 'leet',
      name: 'Leetspeak',
      note: 'Letters swapped for digits that look like them, from 1980s bulletin boards. It turns up in passwords, where every cracking tool has known the substitutions for decades.'
    }
  ];

  /* ------------------------------------------------------------------
     Text to numbers.
     ------------------------------------------------------------------ */
  function codePoints(text) {
    var out = [];
    var i = 0;
    while (i < text.length) {
      var hi = text.charCodeAt(i);
      if (hi >= 0xD800 && hi <= 0xDBFF && i + 1 < text.length) {
        var lo = text.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          out.push((hi - 0xD800) * 0x400 + (lo - 0xDC00) + 0x10000);
          i += 2;
          continue;
        }
      }
      out.push(hi);
      i++;
    }
    return out;
  }

  function utf8Bytes(points) {
    var bytes = [];
    for (var i = 0; i < points.length; i++) {
      var cp = points[i];
      /* An unpaired surrogate is not a character and has no UTF-8 form. Every
         real encoder substitutes U+FFFD rather than inventing bytes. */
      if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;
      if (cp < 0x80) {
        bytes.push(cp);
      } else if (cp < 0x800) {
        bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      } else if (cp < 0x10000) {
        bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return bytes;
  }

  function toBinary(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i++) {
      parts.push(('0000000' + bytes[i].toString(2)).slice(-8));
    }
    return parts.join(' ');
  }

  function toHex(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i++) {
      parts.push(('0' + bytes[i].toString(16)).slice(-2));
    }
    return parts.join(' ');
  }

  function toBase64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = bytes[i + 1];
      var b2 = bytes[i + 2];
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4));
      out += b1 === undefined ? '=' : B64.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6));
      out += b2 === undefined ? '=' : B64.charAt(b2 & 63);
    }
    return out;
  }

  /* Returns the code and the count of characters that had none, because a
     Morse line that quietly drops a third of a name is a lie by omission. */
  function toMorse(text) {
    var parts = [];
    var dropped = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === ' ' || ch === '\n' || ch === '\t') {
        if (parts.length && parts[parts.length - 1] !== '/') parts.push('/');
        continue;
      }
      var code = MORSE[ch.toUpperCase()];
      if (code) parts.push(code);
      else dropped++;
    }
    /* A trailing word break is not a word break. It appears while somebody is
       still typing, or when the last character was one Morse cannot carry. */
    while (parts.length && parts[parts.length - 1] === '/') parts.pop();
    return { text: parts.join(' '), dropped: dropped };
  }

  function toRot13(text) {
    return text.replace(/[a-zA-Z]/g, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
  }

  function toLeet(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var swap = LEET[ch.toLowerCase()];
      out += swap === undefined ? ch : swap;
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Numbers to notes. See decision 3 in the header.
     ------------------------------------------------------------------ */

  /* Major pentatonic, in semitones above the root. The melody here is
     chosen by somebody's name rather than by anyone's taste, so the scale
     has to be one where no two notes can sound wrong together: this one
     contains no semitone step at all, which means even the widest jump
     from one byte to the next arrives as an interval rather than a clash. */
  var PENTA = [0, 2, 4, 7, 9];

  /* Sixteen notes, A3 up to A6: one per value a hex digit can take. Built
     once, because a lookup is cheaper than Math.pow on every keystroke and
     the table is sixteen numbers. */
  var NOTES = [];
  for (var ni = 0; ni < 16; ni++) {
    NOTES.push(220 * Math.pow(2, (PENTA[ni % 5] + 12 * Math.floor(ni / 5)) / 12));
  }

  /* Which of those sixteen a character plays.

     The LAST of its UTF-8 bytes, not the first. For anything in ASCII
     there is only one byte and the question does not arise, but above that
     the first byte is a header: every three-byte character begins 0xE0 to
     0xEF, so choosing on it would give every Devanagari letter in a name
     the same note. The last byte carries the low six bits of the code
     point, which is what separates क from ख — exactly the distinction this
     page exists to show.

     Then the low nibble of that byte, which is the second of the two
     digits sitting in the Hexadecimal row. Characters that are neighbours
     in the encoding get neighbouring scale degrees, so a word rises and
     falls the way its bytes do rather than at random. */
  function noteIndex(cp) {
    var bytes = utf8Bytes([cp]);
    return bytes[bytes.length - 1] & 15;
  }

  /* ------------------------------------------------------------------
     Clipboard. Same two-path approach as lab-copy.js: the async API where
     it exists and the page is secure, the old selection trick otherwise,
     because Safari on http:// still has nothing else.
     ------------------------------------------------------------------ */
  function legacyCopy(text) {
    var scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    document.body.appendChild(scratch);
    scratch.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(scratch);
    return ok;
  }

  function copy(text, done) {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(legacyCopy(text)); }
      );
      return;
    }
    done(legacyCopy(text));
  }

  GameShell.define({
    id: 'game-name-in-binary',
    slug: 'name-in-binary',
    title: 'Your name in binary',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var input = null;
      var live = null;
      var sampleAt = 0;
      var outs = {};
      var copies = {};
      var flags = {};
      var values = {};
      var timers = {};

      /* What the box held last time render() ran, and the handle on a
         phrase still playing. Both are sound and nothing else: they are
         how a keystroke is told apart from a paste and from a backspace,
         and no row on the page is derived from either. */
      var heard = '';
      var runTimer = 0;

      function build() {
        host.className = 'game-board board-name-binary';
        host.innerHTML = '';

        var warn = document.createElement('p');
        warn.className = 'nib-warn';
        warn.innerHTML = '<strong>None of this is encryption.</strong> An encoding has no key and no password: ' +
          'anyone holding the output can turn it straight back into your text, and the ' +
          '<a href="/labs/encoding">encoder and decoder</a> in the Labs section will do exactly that in one click. ' +
          'Encodings exist to move text through something that cannot carry it, not to hide it from anybody.';
        host.appendChild(warn);

        var label = document.createElement('label');
        label.className = 'nib-field';
        label.setAttribute('for', 'nib-text');
        label.textContent = 'Type anything — a name, a word, a sentence';
        host.appendChild(label);

        input = document.createElement('textarea');
        input.id = 'nib-text';
        input.className = 'nib-input';
        input.rows = 2;
        input.setAttribute('maxlength', String(MAX));
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        host.appendChild(input);

        var limit = document.createElement('p');
        limit.className = 'nib-limit';
        limit.textContent = 'Up to ' + MAX + ' characters. Accents, Devanagari and emoji are all handled properly — ' +
          'they are simply worth more than one byte each.';
        host.appendChild(limit);

        for (var i = 0; i < ROWS.length; i++) buildRow(ROWS[i]);

        live = document.createElement('p');
        live.className = 'nib-live';
        live.setAttribute('role', 'status');
        live.setAttribute('aria-live', 'polite');
        host.appendChild(live);

        input.addEventListener('input', render);
      }

      function buildRow(row) {
        var wrap = document.createElement('div');
        wrap.className = 'nib-row';

        var head = document.createElement('div');
        head.className = 'nib-head';

        var name = document.createElement('h3');
        name.className = 'nib-name';
        name.id = 'nib-name-' + row.key;
        name.textContent = row.name;
        head.appendChild(name);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'game-btn nib-copy';
        btn.textContent = 'Copy';
        btn.setAttribute('aria-label', 'Copy the ' + row.name + ' output');
        btn.addEventListener('click', function () { onCopy(row, btn); });
        head.appendChild(btn);
        copies[row.key] = btn;

        wrap.appendChild(head);

        var note = document.createElement('p');
        note.className = 'nib-note';
        note.textContent = row.note;
        wrap.appendChild(note);

        var out = document.createElement('p');
        out.className = 'nib-out';
        out.setAttribute('tabindex', '0');
        out.setAttribute('role', 'group');
        out.setAttribute('aria-labelledby', name.id);
        wrap.appendChild(out);
        outs[row.key] = out;

        var flag = document.createElement('p');
        flag.className = 'nib-flag';
        flag.hidden = true;
        wrap.appendChild(flag);
        flags[row.key] = flag;

        host.appendChild(wrap);
      }

      function onCopy(row, btn) {
        var text = values[row.key];
        if (!text) return;
        copy(text, function (ok) {
          btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
          if (live) live.textContent = ok ? row.name + ' copied to the clipboard' : 'Copying failed — select the text and press Ctrl+C';
          /* The two outcomes have always read differently and looked
             differently; they may as well sound different too. A clean
             sine up top for the copy that worked, a low square for the one
             that did not — far enough apart in pitch and in timbre to be
             told apart while you are still looking at the output rather
             than at the button, which is the only reason to sound either. */
          if (ok) g.beep(720, 0.05, 'sine');
          else g.beep(140, 0.18, 'square', 0.05);
          clearTimeout(timers[row.key]);
          timers[row.key] = setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
        });
      }

      function setRow(key, text, flagText) {
        var out = outs[key];
        var btn = copies[key];
        out.textContent = text || '—';
        out.className = 'nib-out' + (text ? '' : ' is-empty');
        btn.disabled = !text;
        var flag = flags[key];
        flag.textContent = flagText || '';
        flag.hidden = !flagText;
      }

      /* One character, struck. High notes are shorter and quieter than low
         ones, which is both what a plucked string actually does — the
         brightness dies before the note does — and what the ear needs,
         since an A6 at the level an A3 wants is a spike rather than a
         tick. Nothing here goes above 0.024: this fires on every single
         keystroke, so it has to sit well under the Copy beep, which fires
         once and is meant to be noticed. */
      function tick(cp, level) {
        var i = noteIndex(cp);
        g.pluck(NOTES[i], 0.30 - i * 0.009, level - i * 0.0005, 'triangle');
      }

      /* A paste, or the Sample button, heard as a phrase. It is one
         gesture rather than forty keystrokes, so it gets five notes off
         the front and the rest of a pasted paragraph is never played at
         all — the point is to hear what arrived, not to sit through it.
         The spacing is wider than the gate below on purpose, so every note
         of the phrase gets through it, and the whole thing is quieter than
         typing because nobody pressed five keys to ask for it. */
      function phrase(points) {
        var n = points.length < 5 ? points.length : 5;
        var i = 0;
        function step() {
          if (g.gate('key', 0.08)) tick(points[i], 0.018);
          i++;
          if (i < n) runTimer = setTimeout(step, 110);
        }
        clearTimeout(runTimer);
        step();
      }

      /* Turn the change in the box into sound.

         The gate sits at 0.08 s because the two rates that matter are far
         apart: real typing tops out around eight characters a second and
         should be heard in full, while a key held down repeats at three or
         four times that and would otherwise be a machine gun on one note.

         A deletion is silent. Backspace takes a note away; it does not add
         one, and sounding it would make holding backspace the loudest
         thing on the page. */
      function sound(text) {
        var was = heard;
        heard = text;
        if (text.length <= was.length) return;

        var at = 0;
        while (at < was.length && text.charAt(at) === was.charAt(at)) at++;
        /* Code points rather than UTF-16 units, so an emoji is one
           keystroke and one note instead of a two-character paste. */
        var added = codePoints(text.slice(at, at + (text.length - was.length)));
        if (!added.length) return;
        if (added.length > 1) { phrase(added); return; }
        if (g.gate('key', 0.08)) tick(added[0], 0.024);
      }

      function render() {
        var text = input.value;
        /* maxlength does not apply to a programmatic value or to every
           paste path, so the cap is enforced here as well. */
        if (text.length > MAX) {
          text = text.slice(0, MAX);
          input.value = text;
        }

        /* Ahead of the seven encodings rather than after them, so the note
           lands with the keystroke that caused it. */
        sound(text);

        var points = codePoints(text);
        var bytes = utf8Bytes(points);

        g.stat('chars', points.length);
        g.stat('bytes', bytes.length);

        values.binary = toBinary(bytes);
        values.hex = toHex(bytes);
        values.points = points.join(' ');
        values.base64 = toBase64(bytes);

        var morse = toMorse(text);
        values.morse = morse.text;
        values.rot13 = toRot13(text);
        values.leet = toLeet(text);

        setRow('binary', values.binary, '');
        setRow('hex', values.hex, '');
        setRow('points', values.points,
          points.length && points.length !== bytes.length
            ? points.length + ' characters, ' + bytes.length + ' bytes — the two only match while the text stays inside ASCII.'
            : '');
        setRow('base64', values.base64, '');
        setRow('morse', values.morse,
          morse.dropped
            ? morse.dropped + (morse.dropped === 1 ? ' character has' : ' characters have') + ' no Morse code, so ' +
              (morse.dropped === 1 ? 'it is' : 'they are') + ' not in that line.'
            : '');
        setRow('rot13', values.rot13, '');
        setRow('leet', values.leet, '');
      }

      function setText(text) {
        input.value = text;
        render();
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
      }

      build();

      var clearBtn = g.el.querySelector('#game-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () { setText(''); });
      }

      var sampleBtn = g.el.querySelector('#game-sample');
      if (sampleBtn) {
        sampleBtn.addEventListener('click', function () {
          setText(SAMPLES[sampleAt % SAMPLES.length]);
          sampleAt++;
        });
      }

      return {
        reset: function () {
          /* Restart puts the first sample back rather than emptying the
             board: a toy with nothing in it explains nothing. */
          sampleAt = 1;
          input.value = SAMPLES[0];
          render();
        }
      };
    }
  });
})();

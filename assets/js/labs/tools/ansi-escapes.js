/* ==========================================================================
   ansi-escapes.js — name and explain terminal escape sequences, render them,
   build new ones, and defuse the ones that arrive in somebody else's output.
   --------------------------------------------------------------------------
   Three things people actually want from ANSI escapes, in one page. Reading
   them: you found 1b 5b 30 31 3b 33 34 6d in a log file and want to know what
   it is. Writing them: you want a bold orange warning line and cannot remember
   whether the 256-colour form takes a 5 or a 2. Surviving them: someone else's
   bytes are sitting in a file you are about to cat, and cursor movement plus
   erase is enough to make a line that has already been printed say something
   it never said.

   The renderer is a small screen model, not a regular expression that maps
   colour codes onto spans. Cells carry a style, CUU and CUP move a cursor, ED
   and EL wipe cells that were already printed, and the count of "characters
   overwritten after they were printed" falls out of that model rather than
   being asserted in prose. It is the only honest way to show the third thing:
   the attack is not the colour, it is that terminal output can go backwards.

   What this is not: a terminal emulator. Eighty fixed columns, no scrollback,
   no scroll region, tab stops every eight and nothing configurable, no
   alternate screen buffer, no reflow. Private modes, OSC and the device
   reports are named and explained rather than obeyed, because obeying ?1049
   inside a div would mean nothing. Blink is a CSS animation that drops to a
   dotted underline under prefers-reduced-motion. The 256-colour table is
   xterm's default palette; every terminal ships its own, so the hex values
   here are a reference point and not a promise about your screen.

   No raw ESC byte for anything dangerous is ever placed on this page. The
   built-in examples ship quoted, the tool unquotes them in memory to analyse
   them, and the sanitiser hands back the visible form. The build side emits
   SGR and nothing else, so the copy button cannot hand you a weapon.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var ESC = '\u001b';
  var MAX_INPUT = 200 * 1024;
  var MAX_LISTED = 250;
  var COLS = 80;
  var MAX_ROWS = 240;
  /* One SGR may legally carry as many parameters as fit on a line, and a 200 kB
     paste of "1;1;1;..." is a single sequence with a hundred thousand of them.
     Describing every one pushed a hundred thousand rows into the output pane
     and blocked the tab for over a second before the browser had begun laying
     them out. Every parameter is still applied; only the listing stops, and it
     says how many it stopped short of. */
  var MAX_SGR_NOTES = 64;
  /* Same reasoning for window titles: OSC 0 in a loop put thirty thousand of
     them into the render note, which is a role="status" live region — a screen
     reader would have read the lot aloud. */
  var MAX_TITLES = 3;
  var DEF_FG = '#cdd6e4';
  var DEF_BG = '#020617';

  var out = LabTool.out('tool-out');

  function $(id) { return document.getElementById(id); }

  /* Several lookup tables are indexed by a string taken straight out of the
     input, and "constructor", "toString" and "__proto__" are all things an
     attacker can write after ESC ]. Plain table[key] finds those on the
     prototype and hands back a function, which then reads as a named command
     whose name is undefined. Own properties only. */
  function own(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
  }

  /* --- xterm's default palette ------------------------------------------
     Written down rather than computed for 0-15 because those sixteen are not
     derivable from anything: they are a table of historical values, and every
     terminal overrides them. 16-255 genuinely are arithmetic, so they are
     computed below and the arithmetic is shown to the visitor. */
  var BASIC16 = [
    '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'
  ];
  var CUBE = [0, 95, 135, 175, 215, 255];
  var HUES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

  function hex2(n) { var s = (n & 255).toString(16); return s.length < 2 ? '0' + s : s; }

  function cubeParts(n) {
    var k = n - 16;
    return { r: Math.floor(k / 36) % 6, g: Math.floor(k / 6) % 6, b: k % 6 };
  }

  function xterm256(n) {
    n = n & 255;
    if (n < 16) return BASIC16[n];
    if (n < 232) {
      var p = cubeParts(n);
      return '#' + hex2(CUBE[p.r]) + hex2(CUBE[p.g]) + hex2(CUBE[p.b]);
    }
    var g = 8 + (n - 232) * 10;
    return '#' + hex2(g) + hex2(g) + hex2(g);
  }

  function describe256(n) {
    if (n < 8) return 'index ' + n + ' = ' + HUES[n] + ', the SGR 3' + n + ' palette slot';
    if (n < 16) return 'index ' + n + ' = bright ' + HUES[n - 8] + ', the SGR 9' + (n - 8) + ' palette slot';
    if (n < 232) {
      var p = cubeParts(n);
      return 'index ' + n + ' is in the 6x6x6 cube: 16 + 36*' + p.r + ' + 6*' + p.g + ' + ' + p.b +
        ', so red level ' + p.r + ', green ' + p.g + ', blue ' + p.b +
        ' out of 0-5, and the levels are 0/95/135/175/215/255';
    }
    return 'index ' + n + ' is on the 24-step grey ramp: 8 + 10*(' + n + ' - 232) = ' +
      (8 + (n - 232) * 10) + ' on all three channels';
  }

  /* --- byte and text display -------------------------------------------- */

  function utf8Bytes(s) {
    var b = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) { b.push(c); continue; }
      if (c < 0x800) { b.push(0xc0 | (c >> 6), 0x80 | (c & 63)); continue; }
      /* A high surrogate is only half a character when a LOW surrogate follows
         it. The first version of this assumed one always did, and \ud800A came
         out as four nonsense bytes with the A swallowed — an unpaired half
         arrives here the moment somebody types \ud800 into the unquote box, so
         this is reachable input rather than a theoretical case. Unpaired halves
         fall through to the three-byte form, which is what WTF-8 does and is at
         least reversible. */
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var lo = s.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
          b.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
          continue;
        }
      }
      b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return b;
  }

  function hexDump(s) {
    var b = utf8Bytes(s), parts = [], i;
    for (i = 0; i < b.length && i < 20; i++) parts.push(hex2(b[i]));
    if (b.length > 20) parts.push('+' + (b.length - 20) + ' more');
    return parts.join(' ');
  }

  /* The cat -v convention, which is the one people already recognise from a
     terminal: ESC becomes ^[, the other C0 controls become ^ plus the letter
     0x40 above them, DEL becomes ^?, and the C1 range becomes M-^ plus the
     same letter. One honest difference from the real cat -v: that works on
     bytes and also marks every byte above 0x7f, while this runs on characters
     the browser has already decoded from UTF-8, so accented text stays
     readable and only control characters are marked. */
  function visible(s, keepWhitespace) {
    var res = '', i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (keepWhitespace && (c === 10 || c === 9)) { res += s.charAt(i); continue; }
      if (c === 127) { res += '^?'; continue; }
      if (c < 32) { res += '^' + String.fromCharCode(c + 64); continue; }
      if (c >= 128 && c <= 159) { res += 'M-^' + String.fromCharCode(c - 128 + 64); continue; }
      res += s.charAt(i);
    }
    return res;
  }

  /* --- unquoting --------------------------------------------------------
     A single pass rather than a stack of .replace() calls, so that a real
     escaped backslash is not misread. In "C:\\escape" the \\ is one literal
     backslash and the e that follows it is a letter, not an ESC. A chain of
     replaces gets that wrong; this does not. */
  function unquote(text) {
    var res = '', i = 0, n = text.length, c, d, m;
    while (i < n) {
      c = text.charAt(i);
      if (c === '^' && text.charAt(i + 1) === '[') { res += ESC; i += 2; continue; }
      if (c === '^' && text.charAt(i + 1) === 'G') { res += '\u0007'; i += 2; continue; }
      if (c !== '\\') { res += c; i++; continue; }
      d = text.charAt(i + 1);
      if (d === '\\') { res += '\\'; i += 2; continue; }
      if (d === 'e' || d === 'E') { res += ESC; i += 2; continue; }
      if (d === 'a') { res += '\u0007'; i += 2; continue; }
      if (d === 'b') { res += '\b'; i += 2; continue; }
      if (d === 'f') { res += '\f'; i += 2; continue; }
      if (d === 'r') { res += '\r'; i += 2; continue; }
      if (d === 'n') { res += '\n'; i += 2; continue; }
      if (d === 't') { res += '\t'; i += 2; continue; }
      if (d === 'v') { res += '\v'; i += 2; continue; }
      if (d === 'x' || d === 'X') {
        m = /^[0-9a-fA-F]{1,2}/.exec(text.substr(i + 2, 2));
        if (m) { res += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
      }
      if (d === 'u') {
        m = /^[0-9a-fA-F]{4}/.exec(text.substr(i + 2, 4));
        if (m) { res += String.fromCharCode(parseInt(m[0], 16)); i += 6; continue; }
      }
      if (d >= '0' && d <= '7') {
        m = /^[0-7]{1,3}/.exec(text.substr(i + 1, 3));
        res += String.fromCharCode(parseInt(m[0], 8) & 255);
        i += 1 + m[0].length;
        continue;
      }
      res += c;
      i++;
    }
    return res;
  }

  /* --- tokeniser --------------------------------------------------------
     The shape of a CSI sequence comes straight out of ECMA-48 clause 5.4:
     parameter bytes 30-3F, then intermediate bytes 20-2F, then exactly one
     final byte 40-7E. Splitting on that grammar rather than on a colour-shaped
     regular expression is what lets the tool name a sequence it has never seen
     before instead of leaving it in the text run.

     Truncation is an outcome the parser expects, not an error. Log files are cut at a
     rotation boundary in the middle of a sequence all the time, and a reader
     that throws on the last four bytes of a 40 MB file is useless. */

  function readCsi(s, start, j, eight) {
    var p = j;
    while (p < s.length && s.charCodeAt(p) >= 0x30 && s.charCodeAt(p) <= 0x3f) p++;
    var paramEnd = p;
    while (p < s.length && s.charCodeAt(p) >= 0x20 && s.charCodeAt(p) <= 0x2f) p++;
    var interEnd = p;
    if (p >= s.length) {
      return { kind: 'ctrl', form: 'csi', cut: true, eight: eight,
               raw: s.slice(start), end: s.length };
    }
    var code = s.charCodeAt(p);
    if (code < 0x40 || code > 0x7e) {
      return { kind: 'ctrl', form: 'csi', cut: true, eight: eight,
               raw: s.slice(start, p + 1), end: p + 1 };
    }
    return { kind: 'ctrl', form: 'csi', eight: eight,
             params: s.slice(j, paramEnd), inter: s.slice(paramEnd, interEnd),
             fin: s.charAt(p), raw: s.slice(start, p + 1), end: p + 1 };
  }

  function readString(s, start, j, form, eight) {
    var p = j, c;
    while (p < s.length) {
      c = s.charCodeAt(p);
      if (c === 0x07) {
        return { kind: 'ctrl', form: form, eight: eight, body: s.slice(j, p),
                 term: 'BEL', raw: s.slice(start, p + 1), end: p + 1 };
      }
      if (c === 0x9c) {
        return { kind: 'ctrl', form: form, eight: eight, body: s.slice(j, p),
                 term: 'ST (8-bit, 0x9C)', raw: s.slice(start, p + 1), end: p + 1 };
      }
      if (c === 0x1b && s.charAt(p + 1) === '\\') {
        return { kind: 'ctrl', form: form, eight: eight, body: s.slice(j, p),
                 term: 'ST (ESC backslash)', raw: s.slice(start, p + 2), end: p + 2 };
      }
      p++;
    }
    return { kind: 'ctrl', form: form, eight: eight, cut: true, body: s.slice(j),
             raw: s.slice(start), end: s.length };
  }

  function tokenise(s) {
    var toks = [], i = 0, buf = '', c, d, t;
    function flush() { if (buf.length) { toks.push({ kind: 'text', raw: buf }); buf = ''; } }
    while (i < s.length) {
      c = s.charCodeAt(i);
      t = null;
      if (c === 0x1b) {
        d = s.charAt(i + 1);
        if (d === '[') t = readCsi(s, i, i + 2, false);
        else if (d === ']') t = readString(s, i, i + 2, 'osc', false);
        else if (d === 'P') t = readString(s, i, i + 2, 'dcs', false);
        else if (d === '_') t = readString(s, i, i + 2, 'apc', false);
        else if (d === '^') t = readString(s, i, i + 2, 'pm', false);
        else if (d === 'X') t = readString(s, i, i + 2, 'sos', false);
        else if (d === '') t = { kind: 'ctrl', form: 'esc', cut: true, raw: ESC, end: i + 1 };
        else if ('()*+-./# '.indexOf(d) >= 0 && i + 2 < s.length) {
          t = { kind: 'ctrl', form: 'esc2', inter: d, fin: s.charAt(i + 2),
                raw: s.slice(i, i + 3), end: i + 3 };
        } else {
          t = { kind: 'ctrl', form: 'esc', fin: d, raw: s.slice(i, i + 2), end: i + 2 };
        }
      } else if (c === 0x9b) { t = readCsi(s, i, i + 1, true); }
      else if (c === 0x9d) { t = readString(s, i, i + 1, 'osc', true); }
      else if (c === 0x90) { t = readString(s, i, i + 1, 'dcs', true); }
      else if (c === 0x9f) { t = readString(s, i, i + 1, 'apc', true); }
      else if (c === 0x9e) { t = readString(s, i, i + 1, 'pm', true); }
      else if (c === 0x98) { t = readString(s, i, i + 1, 'sos', true); }
      else if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) {
        t = { kind: 'ctrl', form: 'c0', code: c, raw: s.charAt(i), end: i + 1 };
      }
      if (t) { flush(); t.at = i; toks.push(t); i = t.end; continue; }
      buf += s.charAt(i);
      i++;
    }
    flush();
    return toks;
  }

  /* --- naming tables ---------------------------------------------------- */

  var ECMA = 'ECMA-48 (ISO/IEC 6429, ANSI X3.64)';
  var XTERM = 'xterm ctlseqs, de facto — not in ECMA-48';
  var DEC = 'DEC private, VT100/VT220 lineage; CSI ? Pm h/l';

  var CSI_FINAL = {
    '@': ['ICH', 'Insert Character', 'insert', 'inserts Pn blank cells at the cursor and pushes the rest of the line right'],
    'A': ['CUU', 'Cursor Up', 'cursor', 'moves the cursor up Pn rows, stopping at the top margin'],
    'B': ['CUD', 'Cursor Down', 'cursor', 'moves the cursor down Pn rows'],
    'C': ['CUF', 'Cursor Forward', 'cursor', 'moves the cursor right Pn columns'],
    'D': ['CUB', 'Cursor Back', 'cursor', 'moves the cursor left Pn columns'],
    'E': ['CNL', 'Cursor Next Line', 'cursor', 'moves down Pn rows and to column 1'],
    'F': ['CPL', 'Cursor Preceding Line', 'cursor', 'moves up Pn rows and to column 1'],
    'G': ['CHA', 'Cursor Character Absolute', 'cursor', 'moves to column Pn on the current row'],
    'H': ['CUP', 'Cursor Position', 'cursor', 'moves to row Pn, column Pn — both 1-based, both default 1'],
    'I': ['CHT', 'Cursor Forward Tabulation', 'cursor', 'moves forward Pn tab stops'],
    'J': ['ED', 'Erase in Display', 'erase', 'erases part or all of the screen'],
    'K': ['EL', 'Erase in Line', 'erase', 'erases part or all of the current line'],
    'L': ['IL', 'Insert Line', 'insert', 'inserts Pn blank lines at the cursor row'],
    'M': ['DL', 'Delete Line', 'erase', 'deletes Pn lines from the cursor row'],
    'P': ['DCH', 'Delete Character', 'erase', 'deletes Pn characters and pulls the rest of the line left'],
    'S': ['SU', 'Scroll Up', 'cursor', 'scrolls the scrolling region up Pn lines'],
    'T': ['SD', 'Scroll Down', 'cursor', 'scrolls the scrolling region down Pn lines'],
    'X': ['ECH', 'Erase Character', 'erase', 'blanks Pn characters at the cursor without moving it'],
    'Z': ['CBT', 'Cursor Backward Tabulation', 'cursor', 'moves back Pn tab stops'],
    'a': ['HPR', 'Character Position Forward', 'cursor', 'moves right Pn columns, the relative form of HPA'],
    'b': ['REP', 'Repeat', 'other', 'repeats the previous printable character Pn more times'],
    'c': ['DA', 'Device Attributes', 'report', 'asks the terminal what it is — the terminal answers by writing bytes back on your stdin'],
    'd': ['VPA', 'Line Position Absolute', 'cursor', 'moves to row Pn, keeping the column'],
    'e': ['VPR', 'Line Position Forward', 'cursor', 'moves down Pn rows, keeping the column'],
    'f': ['HVP', 'Horizontal and Vertical Position', 'cursor', 'the same move as CUP, kept for compatibility with older devices'],
    'g': ['TBC', 'Tabulation Clear', 'other', 'clears a tab stop, or all of them with parameter 3'],
    'h': ['SM', 'Set Mode', 'mode', 'turns an ANSI mode on'],
    'l': ['RM', 'Reset Mode', 'mode', 'turns an ANSI mode off'],
    'm': ['SGR', 'Select Graphic Rendition', 'sgr', 'sets the rendition — colour, weight, underline and the rest'],
    'n': ['DSR', 'Device Status Report', 'report', 'asks the terminal for status; CSI 6n asks for the cursor position and the answer arrives on your stdin'],
    'p': ['DECSTR / DECSCL', 'Soft Terminal Reset or set conformance level', 'mode', 'CSI ! p is a soft reset; with intermediates it sets the conformance level'],
    'q': ['DECSCUSR / DECLL', 'Set Cursor Style or load LEDs', 'mode', 'CSI Ps SP q picks the cursor shape; without the space it drives the keyboard LEDs'],
    'r': ['DECSTBM', 'Set Top and Bottom Margins', 'mode', 'sets the scrolling region to rows Pt through Pb'],
    's': ['SCOSC / DECSLRM', 'Save Cursor Position', 'save', 'saves the cursor position, the ANSI.SYS form; with two parameters it sets left and right margins instead'],
    't': ['XTWINOPS', 'Window manipulation', 'report', 'resizes, moves, raises or QUERIES the window — the query forms make the terminal write the answer, including the window title, back on your stdin'],
    'u': ['SCORC', 'Restore Cursor Position', 'save', 'restores the cursor saved by CSI s'],
    'x': ['DECREQTPARM', 'Request Terminal Parameters', 'report', 'another form that makes the terminal reply on your stdin'],
    '~': ['Function key', 'VT220 keypad and function key report', 'other', 'this is the shape a key sends to the program, not something a program sends to the screen']
  };
  CSI_FINAL['\u0060'] = ['HPA', 'Character Position Absolute', 'cursor', 'moves to column Pn, the absolute form'];

  var C0_NAMES = {
    0x00: ['NUL', 'Null', 'does nothing; a padding byte'],
    0x07: ['BEL', 'Bell', 'rings the terminal bell, or flashes it, or fires a desktop notification'],
    0x08: ['BS', 'Backspace', 'moves the cursor one column left without erasing — combined with overprinting it is how underlining worked on paper terminals'],
    0x09: ['HT', 'Horizontal Tab', 'moves to the next tab stop, every eight columns unless changed'],
    0x0a: ['LF', 'Line Feed', 'moves down one row; the terminal driver in ONLCR mode also returns to column 1, which is why a bare newline looks like CR LF on screen'],
    0x0b: ['VT', 'Vertical Tab', 'moves down, treated as a line feed by nearly everything'],
    0x0c: ['FF', 'Form Feed', 'a page break on a printer; most terminals treat it as a line feed, some clear the screen'],
    0x0d: ['CR', 'Carriage Return', 'moves to column 1 of the SAME row — everything printed after it overwrites what is already there'],
    0x0e: ['SO', 'Shift Out', 'switches to the G1 character set; a stray one is why a terminal suddenly prints line-drawing glyphs'],
    0x0f: ['SI', 'Shift In', 'switches back to G0 — this is what reset -Q or printf "\\017" fixes'],
    0x1a: ['SUB', 'Substitute', 'stands in for a character that could not be represented'],
    0x7f: ['DEL', 'Delete', 'originally an all-holes punch on paper tape; ignored on output']
  };

  var C1_NAMES = {
    0x84: ['IND', 'Index', 'moves down one line, the 8-bit form of ESC D'],
    0x85: ['NEL', 'Next Line', 'the 8-bit form of ESC E'],
    0x88: ['HTS', 'Horizontal Tab Set', 'sets a tab stop at the cursor column'],
    0x8d: ['RI', 'Reverse Index', 'moves UP one line, scrolling the screen down at the top margin'],
    0x9c: ['ST', 'String Terminator', 'ends an OSC, DCS, APC, PM or SOS string'],
    0x9b: ['CSI', 'Control Sequence Introducer', 'the 8-bit form of ESC ['],
    0x9d: ['OSC', 'Operating System Command', 'the 8-bit form of ESC ]'],
    0x90: ['DCS', 'Device Control String', 'the 8-bit form of ESC P']
  };

  var ESC_SINGLE = {
    '7': ['DECSC', 'Save Cursor', 'save', 'saves cursor position, rendition and character set together'],
    '8': ['DECRC', 'Restore Cursor', 'save', 'restores everything DECSC saved'],
    'D': ['IND', 'Index', 'cursor', 'moves down one line'],
    'E': ['NEL', 'Next Line', 'cursor', 'moves down one line and to column 1'],
    'H': ['HTS', 'Horizontal Tab Set', 'other', 'sets a tab stop at the current column'],
    'M': ['RI', 'Reverse Index', 'cursor', 'moves UP one line and scrolls the screen down at the top margin'],
    'N': ['SS2', 'Single Shift Two', 'other', 'the next character comes from the G2 set'],
    'O': ['SS3', 'Single Shift Three', 'other', 'the next character comes from the G3 set — this is the prefix arrow keys send in application mode'],
    'P': ['DCS', 'Device Control String', 'string', 'starts a device control string'],
    'V': ['SPA', 'Start of Protected Area', 'other', 'marks the start of a protected area'],
    'W': ['EPA', 'End of Protected Area', 'other', 'marks the end of a protected area'],
    'Z': ['DECID', 'Identify Terminal', 'report', 'obsolete request for identification; the terminal replies on your stdin'],
    '\\': ['ST', 'String Terminator', 'string', 'ends an OSC, DCS, APC, PM or SOS string'],
    'c': ['RIS', 'Reset to Initial State', 'mode', 'a HARD reset — clears the screen, the scrollback in some terminals, the palette, tab stops and every mode'],
    '=': ['DECKPAM', 'Keypad Application Mode', 'mode', 'the numeric keypad starts sending escape sequences instead of digits'],
    '>': ['DECKPNM', 'Keypad Numeric Mode', 'mode', 'the keypad goes back to sending digits'],
    'n': ['LS2', 'Locking Shift Two', 'other', 'locks G2 into GL'],
    'o': ['LS3', 'Locking Shift Three', 'other', 'locks G3 into GL'],
    '<': ['Exit VT52', 'Enter ANSI mode', 'mode', 'leaves VT52 compatibility mode']
  };

  var OSC_NAMES = {
    '0': ['Set icon name and window title', 'title'],
    '1': ['Set icon name', 'title'],
    '2': ['Set window title', 'title'],
    '4': ['Set or query a palette colour', 'palette'],
    '7': ['Report the working directory as a file:// URL', 'shell'],
    '8': ['Hyperlink', 'link'],
    '9': ['Desktop notification (iTerm2, ConEmu)', 'notify'],
    '10': ['Set or query the default foreground colour', 'palette'],
    '11': ['Set or query the default background colour', 'palette'],
    '12': ['Set or query the cursor colour', 'palette'],
    '52': ['Manipulate the selection, which on most terminals means the clipboard', 'clipboard'],
    '104': ['Reset palette colours', 'palette'],
    '110': ['Reset the default foreground colour', 'palette'],
    '111': ['Reset the default background colour', 'palette'],
    '112': ['Reset the cursor colour', 'palette'],
    '133': ['Shell integration prompt marks (FinalTerm, iTerm2, and now several others)', 'shell'],
    '777': ['urxvt module dispatch, usually notify', 'notify'],
    '1337': ['iTerm2 proprietary: inline images, file transfer, and more', 'notify']
  };

  var DEC_MODES = {
    1: ['DECCKM', 'cursor keys send application sequences (ESC O A) instead of ESC [ A'],
    3: ['DECCOLM', '132-column mode; setting or resetting it clears the screen on a real VT100'],
    5: ['DECSCNM', 'reverse video for the whole screen'],
    6: ['DECOM', 'origin mode: row 1 becomes the top of the scrolling region'],
    7: ['DECAWM', 'autowrap at the right margin'],
    8: ['DECARM', 'auto-repeat keys'],
    9: ['X10 mouse', 'report mouse button presses as escape sequences on stdin'],
    12: ['att610', 'blink the cursor'],
    25: ['DECTCEM', 'show the cursor; ?25l hides it'],
    47: ['Alternate screen', 'the old alternate screen buffer, without saving the cursor'],
    66: ['DECNKM', 'application keypad'],
    1000: ['X11 mouse', 'report button press and release on stdin'],
    1002: ['Mouse drag', 'report motion while a button is held'],
    1003: ['Mouse any-motion', 'report every mouse movement over the window'],
    1004: ['Focus reporting', 'send CSI I and CSI O when the window gains or loses focus'],
    1005: ['UTF-8 mouse', 'encode mouse coordinates as UTF-8'],
    1006: ['SGR mouse', 'encode mouse coordinates in the SGR form'],
    1015: ['urxvt mouse', 'the urxvt mouse encoding'],
    1047: ['Alternate screen', 'switch to the alternate screen buffer'],
    1048: ['Save cursor', 'save or restore the cursor as DECSC does'],
    1049: ['Alternate screen + save cursor', 'save the cursor, switch to a cleared alternate screen, and on reset switch back — this is what less and vim use'],
    2004: ['Bracketed paste', 'wrap pasted text in ESC [ 200~ and ESC [ 201~ so a program can tell a paste from typing'],
    2026: ['Synchronised output', 'ask the terminal to hold the frame until the application says it is done'],
    9001: ['win32-input-mode', 'Windows Terminal extended key reporting']
  };

  /* --- SGR -------------------------------------------------------------- */

  var SGR_TEXT = {
    0: 'reset — every attribute back to the terminal default',
    1: 'bold, or increased intensity; many terminals render it as the bright colour instead of a heavier face',
    2: 'faint, or decreased intensity',
    3: 'italic',
    4: 'underline (the colon forms 4:1 4:2 4:3 4:4 4:5 pick single, double, curly, dotted, dashed where supported)',
    5: 'slow blink, defined as under 150 per minute',
    6: 'rapid blink, over 150 per minute — rarely implemented',
    7: 'reverse video: swap the foreground and background',
    8: 'conceal: the text is written to the screen but not displayed. It is still in the scrollback and still copies out',
    9: 'crossed out',
    10: 'primary (default) font',
    20: 'Fraktur, almost never implemented',
    21: 'doubly underlined in ECMA-48; several terminals read it as bold off instead',
    22: 'normal intensity — cancels both 1 and 2',
    23: 'not italic, not Fraktur',
    24: 'not underlined',
    25: 'not blinking',
    26: 'proportional spacing',
    27: 'not reversed',
    28: 'reveal — cancels conceal',
    29: 'not crossed out',
    39: 'default foreground colour',
    49: 'default background colour',
    50: 'not proportionally spaced',
    51: 'framed',
    52: 'encircled',
    53: 'overlined',
    54: 'not framed, not encircled',
    55: 'not overlined',
    73: 'superscript (mintty extension)',
    74: 'subscript (mintty extension)',
    75: 'neither superscript nor subscript'
  };

  function newStyle() {
    return { bold: false, faint: false, italic: false, ul: 0, blink: false,
             rev: false, conceal: false, strike: false, over: false, fg: null, bg: null };
  }

  function cloneStyle(s) {
    return { bold: s.bold, faint: s.faint, italic: s.italic, ul: s.ul, blink: s.blink,
             rev: s.rev, conceal: s.conceal, strike: s.strike, over: s.over,
             fg: s.fg, bg: s.bg };
  }

  function styleKey(s) {
    if (!s) return 'default';
    return [s.bold, s.faint, s.italic, s.ul, s.blink, s.rev, s.conceal, s.strike, s.over,
            s.fg ? s.fg.hex : '-', s.bg ? s.bg.hex : '-'].join('|');
  }

  function makeColour(hex, label) { return { hex: hex, label: label }; }

  /* One walk that both describes and applies, so the explanation and the
     rendered strip can never drift apart: if the text says "foreground orange"
     it is because the same branch set the style the renderer then used. */
  function sgrWalk(params, state) {
    var notes = [];
    var unlisted = 0;
    var raw = params === '' ? '0' : params;
    var parts = raw.split(';');
    var i = 0;

    function push(code, text) {
      if (notes.length >= MAX_SGR_NOTES) { unlisted++; return; }
      notes.push(code + ' — ' + text);
    }

    /* Terminals clamp a truecolour component to a byte. Printing the raw 999
       next to a hex computed with & 255 would have claimed 999 was #e7. */
    function byte255(v) {
      var n = parseInt(v, 10);
      if (isNaN(n)) return 0;
      return n < 0 ? 0 : (n > 255 ? 255 : n);
    }

    while (i < parts.length) {
      var piece = parts[i];
      var sub = piece.split(':');
      var n = sub[0] === '' ? 0 : parseInt(sub[0], 10);

      if (isNaN(n)) {
        push(piece, 'not a number. ECMA-48 allows only digits, semicolons and colons here, and most terminals abandon the whole sequence at this point');
        i++;
        continue;
      }

      if (n === 38 || n === 48 || n === 58) {
        var target = n === 38 ? 'foreground' : (n === 48 ? 'background' : 'underline');
        var mode = NaN, args = null, consumed = 1;
        if (sub.length > 1) {
          mode = parseInt(sub[1], 10);
          args = sub.slice(2);
          if (mode === 2 && args.length >= 4) args = args.slice(1);
        } else {
          mode = parseInt(parts[i + 1], 10);
          if (mode === 5) { args = [parts[i + 2]]; consumed = 3; }
          else if (mode === 2) { args = [parts[i + 2], parts[i + 3], parts[i + 4]]; consumed = 5; }
          else { consumed = 2; }
        }
        i += consumed;

        if (mode === 5 && args && args.length >= 1) {
          var idx = parseInt(args[0], 10);
          if (isNaN(idx) || idx < 0 || idx > 255) {
            push(n + ';5;' + args[0], 'a 256-colour index outside 0-255; ignored');
            continue;
          }
          var hx = xterm256(idx);
          push(n + ';5;' + idx, target + ' from the 256-colour table: ' + describe256(idx) +
               ', which is ' + hx + ' in xterm default colours');
          if (n === 38) state.fg = makeColour(hx, '256-colour index ' + idx);
          else if (n === 48) state.bg = makeColour(hx, '256-colour index ' + idx);
          continue;
        }
        if (mode === 2 && args && args.length >= 3) {
          /* Echo the parameters as they were written, but build the hex from
             the CLAMPED components: hex2 masks with & 255, so an out-of-range
             999 came out as #e7 and the tool asserted a colour no terminal
             would ever show. A terminal clamps to a byte, so 999 is #ff. */
          var rawR = args[0], rawG = args[1], rawB = args[2];
          var r = byte255(rawR), g = byte255(rawG), b = byte255(rawB);
          var th = '#' + hex2(r) + hex2(g) + hex2(b);
          push(n + ';2;' + rawR + ';' + rawG + ';' + rawB, target + ' as 24-bit truecolour ' + th +
               '. Defined by ITU-T T.416 / ISO 8613-6 with colons; the semicolon form here is xterm practice and is what nearly everything emits');
          if (n === 38) state.fg = makeColour(th, 'truecolour ' + th);
          else if (n === 48) state.bg = makeColour(th, 'truecolour ' + th);
          continue;
        }
        push(String(n), 'extended ' + target + ' colour introducer, but the selector that follows is ' +
             (isNaN(mode) ? 'missing' : mode) + ' rather than 5 or 2, so there is nothing to apply');
        continue;
      }

      i++;

      if (n >= 30 && n <= 37) {
        state.fg = makeColour(BASIC16[n - 30], HUES[n - 30]);
        push(String(n), 'foreground ' + HUES[n - 30] + ' (palette slot ' + (n - 30) +
             '; xterm default ' + BASIC16[n - 30] + ', but this one is whatever your theme sets)');
        continue;
      }
      if (n >= 40 && n <= 47) {
        state.bg = makeColour(BASIC16[n - 40], HUES[n - 40]);
        push(String(n), 'background ' + HUES[n - 40] + ' (palette slot ' + (n - 40) + ')');
        continue;
      }
      if (n >= 90 && n <= 97) {
        state.fg = makeColour(BASIC16[n - 90 + 8], 'bright ' + HUES[n - 90]);
        push(String(n), 'foreground bright ' + HUES[n - 90] + ' (palette slot ' + (n - 90 + 8) +
             '). This is an aixterm extension, not ECMA-48');
        continue;
      }
      if (n >= 100 && n <= 107) {
        state.bg = makeColour(BASIC16[n - 100 + 8], 'bright ' + HUES[n - 100]);
        push(String(n), 'background bright ' + HUES[n - 100] + ' (aixterm extension)');
        continue;
      }
      if (n >= 11 && n <= 19) { push(String(n), 'alternative font ' + (n - 10)); continue; }
      if (n >= 60 && n <= 65) { push(String(n), 'ideogram underline, overline or stress marking'); continue; }

      if (n === 0) {
        var fresh = newStyle();
        state.bold = fresh.bold; state.faint = fresh.faint; state.italic = fresh.italic;
        state.ul = fresh.ul; state.blink = fresh.blink; state.rev = fresh.rev;
        state.conceal = fresh.conceal; state.strike = fresh.strike; state.over = fresh.over;
        state.fg = null; state.bg = null;
      } else if (n === 1) { state.bold = true; }
      else if (n === 2) { state.faint = true; }
      else if (n === 3) { state.italic = true; }
      else if (n === 4) { state.ul = sub.length > 1 ? (parseInt(sub[1], 10) || 0) : 1; }
      else if (n === 5 || n === 6) { state.blink = true; }
      else if (n === 7) { state.rev = true; }
      else if (n === 8) { state.conceal = true; }
      else if (n === 9) { state.strike = true; }
      else if (n === 21) { state.ul = 2; }
      else if (n === 22) { state.bold = false; state.faint = false; }
      else if (n === 23) { state.italic = false; }
      else if (n === 24) { state.ul = 0; }
      else if (n === 25) { state.blink = false; }
      else if (n === 27) { state.rev = false; }
      else if (n === 28) { state.conceal = false; }
      else if (n === 29) { state.strike = false; }
      else if (n === 39) { state.fg = null; }
      else if (n === 49) { state.bg = null; }
      else if (n === 53) { state.over = true; }
      else if (n === 55) { state.over = false; }

      if (SGR_TEXT[n]) push(String(n), SGR_TEXT[n]);
      else push(String(n), 'not assigned in ECMA-48 and not a common extension; terminals differ on whether they skip it or drop the rest of the sequence');
    }
    return notes;
  }

  /* --- describing one token --------------------------------------------- */

  function firstParam(params, dflt) {
    var v = parseInt(String(params).split(';')[0], 10);
    return isNaN(v) ? dflt : v;
  }

  var ED_TEXT = {
    0: 'from the cursor to the end of the screen',
    1: 'from the start of the screen to the cursor',
    2: 'the entire screen — the cursor usually does not move, which is why clear is ED 2 followed by a cursor home',
    3: 'the SCROLLBACK as well (xterm extension) — this is the one that destroys evidence you thought had scrolled away'
  };
  var EL_TEXT = {
    0: 'from the cursor to the end of the line',
    1: 'from the start of the line to the cursor',
    2: 'the whole line, cursor unchanged'
  };

  function describe(tok) {
    var d = { cat: 'other', abbr: '?', name: 'Unrecognised', std: ECMA, effect: [], risk: null };

    if (tok.form === 'c0') {
      var c = tok.code;
      if (C0_NAMES[c]) {
        d.abbr = C0_NAMES[c][0]; d.name = C0_NAMES[c][1];
        d.effect.push(C0_NAMES[c][2]);
        d.std = 'ECMA-48 C0 set (also ASCII / ISO 646)';
        d.cat = (c === 0x0d || c === 0x08) ? 'cursor' : 'c0';
        if (c === 0x0d) d.risk = 'A carriage return with no line feed puts the cursor back at column 1 of a line that is already on screen. Everything printed next replaces it. This is the cheapest way to make a log line lie.';
        if (c === 0x0e) d.risk = 'A stray Shift Out leaves the terminal in the line-drawing character set, so all later output is garbage until a reset.';
        return d;
      }
      if (C1_NAMES[c]) {
        d.abbr = C1_NAMES[c][0]; d.name = C1_NAMES[c][1];
        d.std = 'ECMA-48 C1 set, 8-bit form';
        d.effect.push(C1_NAMES[c][2]);
        d.effect.push('This is the single-byte C1 form. It only exists as one byte in an 8-bit single-byte encoding: in a UTF-8 stream the same code point is the two bytes C2 ' + hex2(c) + ', which is why C1 escapes usually stop working the moment a pipeline becomes UTF-8.');
        d.cat = 'c1';
        return d;
      }
      d.abbr = 'C0/C1 ' + hex2(c);
      d.name = 'Unnamed control character';
      d.std = 'ECMA-48 C0/C1';
      d.effect.push('A control character with no common meaning on output. Terminals differ on whether they drop it or print a placeholder.');
      d.cat = 'c0';
      return d;
    }

    if (tok.form === 'esc') {
      if (tok.cut) {
        d.abbr = 'ESC'; d.name = 'Truncated escape';
        d.effect.push('The input ends with a bare ESC and nothing after it. A terminal would sit waiting for the next byte, which is what a log file cut mid-sequence does to a tail -f.');
        return d;
      }
      var e = ESC_SINGLE[tok.fin];
      if (e) {
        d.abbr = e[0]; d.name = e[1]; d.cat = e[2]; d.effect.push(e[3]);
        d.std = tok.fin === '7' || tok.fin === '8' || tok.fin === '=' || tok.fin === '>' || tok.fin === '<'
          ? 'DEC private, VT100 lineage' : ECMA;
        if (tok.fin === 'c') d.risk = 'RIS is a hard reset. In several terminals it also clears the scrollback, so an attacker who can print two bytes into your log can erase what you were reading.';
        if (tok.fin === 'Z') d.risk = 'The terminal answers this by writing bytes onto your stdin. If your shell is at a prompt, those bytes are typed for you.';
        return d;
      }
      d.abbr = 'ESC ' + tok.fin;
      d.name = 'Escape sequence, single final byte';
      d.effect.push('ESC followed by ' + tok.fin + ' is not one of the common Fe/Fs sequences. It is well-formed, so a terminal will consume both bytes and act on them or drop them silently.');
      return d;
    }

    if (tok.form === 'esc2') {
      d.cat = 'other';
      if (tok.inter === '#') {
        d.abbr = 'DEC line/screen';
        d.name = tok.fin === '8' ? 'DECALN, Screen Alignment Pattern' : 'DEC double-width or double-height line';
        d.std = 'DEC private';
        d.effect.push(tok.fin === '8'
          ? 'Fills the entire screen with the letter E. It was a VT100 alignment test and it still works, so it is a two-byte way to destroy whatever you were reading.'
          : 'Marks the current line as double-height or double-width.');
        if (tok.fin === '8') d.risk = 'DECALN overwrites the whole screen with E characters.';
        return d;
      }
      if (tok.inter === ' ') {
        d.abbr = 'ESC SP ' + tok.fin;
        d.name = tok.fin === 'F' ? 'S7C1T, send 7-bit C1' : (tok.fin === 'G' ? 'S8C1T, send 8-bit C1' : 'ANSI conformance level');
        d.effect.push('Chooses whether the terminal sends C1 controls as single 8-bit bytes or as two-byte ESC forms.');
        return d;
      }
      d.abbr = 'SCS';
      d.name = 'Select Character Set';
      d.std = ECMA + ', designation per ISO 2022';
      d.effect.push('Designates a character set into G0-G3. ESC ( B is US ASCII into G0 and is the usual way to undo a terminal that has been left drawing lines. ESC ( 0 is the DEC special graphics set, which turns letters into box-drawing characters.');
      if (tok.fin === '0') d.risk = 'ESC ( 0 leaves following text rendered as box-drawing glyphs. Harmless by itself, confusing in a log.';
      return d;
    }

    if (tok.form === 'osc' || tok.form === 'dcs' || tok.form === 'apc' || tok.form === 'pm' || tok.form === 'sos') {
      return describeString(tok, d);
    }

    if (tok.form === 'csi') return describeCsi(tok, d);
    return d;
  }

  function describeCsi(tok, d) {
    d.std = ECMA + ' clause 5.4';
    if (tok.cut) {
      d.abbr = 'CSI';
      d.name = 'Truncated control sequence';
      d.effect.push('A CSI that never reached a final byte in 40-7E. A terminal keeps swallowing input until one arrives, so a file that ends here can eat the beginning of whatever you print next.');
      return d;
    }

    var priv = tok.params.charAt(0);
    if (priv === '?' && (tok.fin === 'h' || tok.fin === 'l' || tok.fin === 's' || tok.fin === 'r')) {
      var on = tok.fin === 'h';
      d.cat = 'mode';
      d.abbr = on ? 'DECSET' : (tok.fin === 'l' ? 'DECRST' : (tok.fin === 's' ? 'XTSAVE' : 'XTRESTORE'));
      d.name = on ? 'DEC Private Mode Set' : (tok.fin === 'l' ? 'DEC Private Mode Reset' : 'Save or restore DEC private modes');
      d.std = DEC + ' — most of the numbers above 1000 are xterm, not DEC';
      var nums = tok.params.slice(1).split(';');
      nums.forEach(function (raw) {
        var n = parseInt(raw, 10);
        if (isNaN(n)) return;
        var m = DEC_MODES[n];
        var verb = on ? 'ON' : (tok.fin === 'l' ? 'OFF' : (tok.fin === 's' ? 'saved' : 'restored'));
        if (m) d.effect.push('?' + n + ' ' + m[0] + ' turned ' + verb + ' — ' + m[1]);
        else d.effect.push('?' + n + ' turned ' + verb + ' — no widely documented meaning; terminals ignore modes they do not know');
        if (n === 1049 || n === 47 || n === 1047) {
          d.risk = 'Alternate screen. Left set, your shell is drawing into a buffer that disappears; left reset in the middle of a full-screen program, the program and the screen disagree about what is on it.';
        }
        if (n === 2004 && !on) {
          d.risk = 'Bracketed paste turned OFF. With it off, a multi-line paste is delivered to the shell as if typed, so the newline in the middle of it runs the command. This is the mode you want left ON.';
        }
        if (n === 25 && !on) {
          d.risk = 'The cursor is hidden. Every later prompt still works, but you cannot see where you are typing.';
        }
        if (n === 1000 || n === 1002 || n === 1003 || n === 1006) {
          d.risk = 'Mouse reporting left on means every click and every scroll writes escape sequences into whatever program is reading your terminal, including your shell.';
        }
      });
      return d;
    }

    var f = CSI_FINAL[tok.fin];
    if (!f) {
      d.abbr = 'CSI ' + tok.fin;
      d.name = 'Control sequence with an uncommon final byte';
      d.effect.push('Well-formed by the ECMA-48 grammar, but ' + tok.fin + ' is not one of the finals in common use. The terminal consumes the whole sequence either way.');
      return d;
    }

    d.abbr = f[0]; d.name = f[1]; d.cat = f[2];
    if (priv === '>' || priv === '<' || priv === '=' || priv === '?') {
      d.std = 'private-parameter form of ' + f[0] + ' — ' + XTERM;
    }

    if (tok.fin === 'm') {
      d.std = ECMA + ' clause 8.3.117 (SGR)';
      d.name = 'Select Graphic Rendition';
      d.sgr = true;
      return d;
    }

    var p1 = firstParam(tok.params, tok.fin === 'J' || tok.fin === 'K' ? 0 : 1);
    if (tok.fin === 'J') {
      d.effect.push('Erases ' + (ED_TEXT[p1] || 'an undefined region — parameter ' + p1 + ' is not 0, 1, 2 or 3') + '.');
      d.risk = 'Erase in Display removes text that has already been printed. In a log you are reading, that is deletion of the record in front of you.';
      return d;
    }
    if (tok.fin === 'K') {
      d.effect.push('Erases ' + (EL_TEXT[p1] || 'an undefined region — parameter ' + p1 + ' is not 0, 1 or 2') + '.');
      d.risk = 'Erase in Line blanks a line that is already on screen so something else can be written over it.';
      return d;
    }
    if (tok.fin === 'H' || tok.fin === 'f') {
      var ps = tok.params.split(';');
      var row = parseInt(ps[0], 10) || 1;
      var col = parseInt(ps[1], 10) || 1;
      d.effect.push('Moves the cursor to row ' + row + ', column ' + col + '. Both are 1-based and both default to 1, so a bare ' + (tok.fin === 'H' ? 'CSI H' : 'CSI f') + ' means the top-left corner.');
      d.risk = 'Absolute cursor positioning puts the next output anywhere on the screen, including on top of a line you have already read.';
      return d;
    }
    if (tok.fin === 'r') {
      var rp = tok.params.split(';');
      d.effect.push('Sets the scrolling region to rows ' + (parseInt(rp[0], 10) || 1) + ' through ' +
        (rp[1] ? parseInt(rp[1], 10) : 'the bottom of the screen') + '. Text outside the region stops scrolling.');
      d.risk = 'A scroll region left set pins part of your screen. Output keeps arriving in a narrow band and the rest of the screen freezes with stale text on it.';
      return d;
    }
    if (d.cat === 'report') {
      d.effect.push(f[3] + '.');
      d.risk = 'This is a request, and the terminal answers by writing bytes onto the program\u2019s standard input. If nothing is reading, they land at your shell prompt as if you had typed them. This is the mechanism behind the classic "terminal answerback" injection.';
      return d;
    }
    if (d.cat === 'cursor' || d.cat === 'erase' || d.cat === 'insert') {
      d.effect.push(f[3].replace(/Pn/g, String(p1)) + (tok.params === '' ? ' (no parameter given, so the default of 1 applies)' : ''));
      if (d.cat !== 'insert') {
        d.risk = 'Movement and erasure allow output to rewrite what is already on the screen.';
      }
      return d;
    }
    d.effect.push(f[3] + '.');
    return d;
  }

  function describeString(tok, d) {
    var body = tok.body || '';
    if (tok.form !== 'osc') {
      d.abbr = tok.form.toUpperCase();
      d.name = { dcs: 'Device Control String', apc: 'Application Program Command',
                 pm: 'Privacy Message', sos: 'Start of String' }[tok.form];
      d.cat = 'string';
      d.std = ECMA + ' clause 8.3.27 and neighbours';
      d.effect.push('A control string carrying ' + body.length + ' characters of payload' +
        (tok.cut ? ', unterminated' : ', terminated by ' + tok.term) + '.');
      d.effect.push('Payload, shown inert: ' + visible(body).slice(0, 160));
      d.risk = 'Control strings are a free-form channel into the terminal. DCS carries things like sixel images and ReGIS graphics, and the parsers for those are where several terminal emulators have had memory-safety bugs. An unterminated one also swallows every byte after it.';
      return d;
    }

    d.cat = 'osc';
    d.std = XTERM + ' (ECMA-48 defines the OSC frame, not the commands inside it)';
    var semi = body.indexOf(';');
    var num = semi < 0 ? body : body.slice(0, semi);
    var rest = semi < 0 ? '' : body.slice(semi + 1);
    var known = OSC_NAMES[num];
    d.abbr = 'OSC ' + num;
    d.name = known ? known[0] : 'Operating System Command';
    d.effect.push('Terminated by ' + (tok.cut ? 'nothing — the string never ended, so a terminal keeps consuming input' : tok.term) + '.');

    if (!known) {
      d.effect.push('Command number ' + num + ' has no widely documented meaning. Payload, inert: ' + visible(rest).slice(0, 160));
      d.risk = 'An OSC a terminal does not know is usually ignored, but the parser still has to walk to the terminator, and OSC handlers are historically where terminal emulators have shipped bugs.';
      return d;
    }

    if (num === '8') {
      var bits = rest.split(';');
      var uri = bits.slice(1).join(';');
      d.std = 'the OSC 8 hyperlink convention agreed between terminal authors, not a formal standard';
      if (uri) {
        d.effect.push('Opens a hyperlink to: ' + uri);
        d.effect.push('Everything printed until the closing OSC 8 ; ; ST becomes the clickable text.');
        d.risk = 'The visible text and the link target are independent. A line that reads "docs.example.com" can point anywhere at all — the terminal equivalent of a mismatched anchor in an email.';
      } else {
        d.effect.push('Closes the current hyperlink. An OSC 8 with an empty URI is the end marker.');
      }
      if (bits[0]) d.effect.push('Link parameters: ' + bits[0]);
      return d;
    }

    if (num === '52') {
      var cbits = rest.split(';');
      var sel = cbits[0] || 's0';
      var payload = cbits.slice(1).join(';');
      d.effect.push('Selection targeted: "' + sel + '" — c is the CLIPBOARD, p the PRIMARY selection, s the one the terminal has been configured to prefer.');
      if (payload === '?') {
        d.effect.push('The payload is "?", which is the READ form: the terminal base64-encodes your current clipboard and writes it back on the program\u2019s standard input.');
        d.risk = 'This reads your clipboard. Any program that can print to your terminal can ask for it, and the answer arrives as input. Most terminals ship with the read form disabled for exactly this reason; check allowWindowOps in xterm, or the clipboard write/read permissions in whichever terminal you use.';
      } else {
        var decoded = null;
        try { decoded = window.atob(payload.replace(/[^A-Za-z0-9+/=]/g, '')); } catch (err) { decoded = null; }
        d.effect.push('The payload is ' + payload.length + ' base64 characters, which is the WRITE form: it replaces your clipboard.');
        if (decoded !== null) {
          d.effect.push('Decoded, and shown inert with control characters made visible: ' + visible(decoded).slice(0, 160));
          if (decoded.indexOf('\n') >= 0 || decoded.indexOf('\r') >= 0) {
            d.effect.push('That payload contains a line break. A line break in a clipboard payload is the difference between text you have to press Enter on and a command that runs the instant it is pasted.');
          }
        } else {
          d.effect.push('The payload did not decode as base64, so there is nothing to show.');
        }
        d.risk = 'This writes your clipboard. Nothing on screen changes. The next time you paste — into a root shell, into a change ticket, into a terminal on another machine — you paste what this sequence put there, not what you copied. This page never executes it: it decodes the payload and prints it as inert text.';
      }
      return d;
    }

    if (known[1] === 'title') {
      d.effect.push('Sets the window or icon title to: ' + visible(rest).slice(0, 160));
      d.risk = 'Window titles are attacker-controlled text in a place people trust: a tab that says "prod-db" can be made to say "staging". Worse, xterm and its relatives can be asked to REPORT the title back on standard input (CSI 21 t), so a title set by hostile output can be replayed as typed characters. Modern xterm disables the report by default; older builds and clones did not.';
      return d;
    }

    if (known[1] === 'palette') {
      d.effect.push(known[0] + '. Payload: ' + visible(rest).slice(0, 120));
      if (rest.indexOf('?') >= 0) {
        d.risk = 'A colour QUERY. The terminal replies with the colour on your standard input, which is another way for output to become input.';
      } else {
        d.risk = 'Repainting the palette can make red and green identical, which is enough to make a FAILED line read as passing at a glance.';
      }
      return d;
    }

    if (known[1] === 'shell') {
      d.effect.push(known[0] + '. Payload: ' + visible(rest).slice(0, 160));
      d.risk = 'Shell integration marks tell the terminal where a prompt, a command and its output begin. Output that forges them can make its own text appear to be part of a command you ran.';
      return d;
    }

    d.effect.push(known[0] + '. Payload: ' + visible(rest).slice(0, 160));
    if (known[1] === 'notify') {
      d.risk = 'This raises a desktop notification with attacker-chosen text, outside the terminal window.';
    }
    return d;
  }

  /* ======================================================================
     The screen model
     ----------------------------------------------------------------------
     Eighty columns, rows growing downwards, one style per cell. Small on
     purpose: enough to show that cursor movement plus erase rewrites history,
     and not one line more than that. Everything it does not do is printed
     under the render, every run, rather than left for someone to discover.
     ====================================================================== */

  function runScreen(toks) {
    var rows = [];
    var cur = { r: 0, c: 0 };
    var st = newStyle();
    var saved = null;
    var stat = { printed: 0, overwrote: 0, clamped: 0, wrapped: 0, truncated: false,
                 titles: [], notPerformed: {} };

    function noted(what) { stat.notPerformed[what] = true; }

    function rowAt(r) {
      while (rows.length <= r) rows.push([]);
      return rows[r];
    }
    function padRow(row, c) {
      while (row.length <= c) row.push({ ch: ' ', st: null, printed: false });
    }
    function clearCell(row, c) {
      padRow(row, c);
      if (row[c].printed) stat.overwrote++;
      row[c] = { ch: ' ', st: cloneStyle(st), printed: false };
    }
    function put(ch) {
      if (cur.c >= COLS) { cur.c = 0; cur.r++; stat.wrapped++; }
      if (cur.r >= MAX_ROWS || cur.c >= COLS) { stat.truncated = true; return; }
      var row = rowAt(cur.r);
      padRow(row, cur.c);
      if (row[cur.c].printed && row[cur.c].ch !== ch) stat.overwrote++;
      row[cur.c] = { ch: ch, st: cloneStyle(st), printed: true };
      stat.printed++;
      cur.c++;
    }
    function up(n) { var t = cur.r - n; if (t < 0) { t = 0; stat.clamped++; } cur.r = t; }
    function down(n) { cur.r = Math.min(MAX_ROWS - 1, cur.r + n); }
    function left(n) { var t = cur.c - n; if (t < 0) { t = 0; stat.clamped++; } cur.c = t; }
    function right(n) { cur.c = Math.min(COLS - 1, cur.c + n); }
    function goTo(r, c) {
      cur.r = Math.max(0, Math.min(MAX_ROWS - 1, r));
      cur.c = Math.max(0, Math.min(COLS - 1, c));
    }
    function countRow(row) {
      var k = 0;
      for (var i = 0; i < row.length; i++) if (row[i] && row[i].printed) k++;
      return k;
    }

    toks.forEach(function (tok) {
      if (stat.truncated) return;
      if (tok.kind === 'text') {
        for (var i = 0; i < tok.raw.length; i++) put(tok.raw.charAt(i));
        return;
      }

      if (tok.form === 'c0') {
        var c = tok.code;
        if (c === 0x0a) { cur.r++; cur.c = 0; if (cur.r >= MAX_ROWS) stat.truncated = true; return; }
        if (c === 0x0d) { cur.c = 0; return; }
        if (c === 0x09) { cur.c = Math.min(COLS - 1, (Math.floor(cur.c / 8) + 1) * 8); return; }
        if (c === 0x08) { left(1); return; }
        if (c === 0x0b || c === 0x0c) { cur.r++; if (cur.r >= MAX_ROWS) stat.truncated = true; return; }
        if (c === 0x84 || c === 0x85) { cur.r++; if (c === 0x85) cur.c = 0; return; }
        if (c === 0x8d) { up(1); return; }
        return;
      }

      if (tok.form === 'esc') {
        if (tok.fin === '7') { saved = { r: cur.r, c: cur.c, st: cloneStyle(st) }; return; }
        if (tok.fin === '8') {
          if (saved) { cur.r = saved.r; cur.c = saved.c; st = cloneStyle(saved.st); }
          return;
        }
        if (tok.fin === 'D') { cur.r++; return; }
        if (tok.fin === 'E') { cur.r++; cur.c = 0; return; }
        if (tok.fin === 'M') { up(1); return; }
        if (tok.fin === 'c') { rows.length = 0; cur.r = 0; cur.c = 0; st = newStyle(); return; }
        return;
      }

      if (tok.form === 'osc') {
        var semi = (tok.body || '').indexOf(';');
        var num = semi < 0 ? tok.body : tok.body.slice(0, semi);
        if (num === '0' || num === '1' || num === '2') {
          stat.titles.push(visible(tok.body.slice(semi + 1)).slice(0, 120));
          noted('window title');
        } else if (num === '52') { noted('clipboard'); }
        else if (num === '8') { noted('hyperlink'); }
        else { noted('other OSC'); }
        return;
      }

      if (tok.form === 'dcs' || tok.form === 'apc' || tok.form === 'pm' || tok.form === 'sos') {
        noted('control strings');
        return;
      }

      if (tok.form !== 'csi' || tok.cut) return;

      if (tok.params.charAt(0) === '?') { noted('private modes'); return; }

      var p = tok.params.split(';');
      var n1 = parseInt(p[0], 10);
      var d1 = isNaN(n1) ? 1 : (n1 || 1);
      var e1 = isNaN(n1) ? 0 : n1;
      var row, i;

      switch (tok.fin) {
        case 'm': sgrWalk(tok.params, st); break;
        case 'A': up(d1); break;
        case 'B': down(d1); break;
        case 'C': right(d1); break;
        case 'D': left(d1); break;
        case 'E': down(d1); cur.c = 0; break;
        case 'F': up(d1); cur.c = 0; break;
        case 'G': goTo(cur.r, d1 - 1); break;
        case 'd': goTo(d1 - 1, cur.c); break;
        case 'H':
        case 'f': goTo(d1 - 1, (parseInt(p[1], 10) || 1) - 1); break;
        case 'K':
          row = rowAt(cur.r);
          if (e1 === 0) {
            for (i = cur.c; i < row.length; i++) if (row[i] && row[i].printed) stat.overwrote++;
            row.length = Math.min(row.length, cur.c);
          } else if (e1 === 1) {
            for (i = 0; i <= cur.c; i++) clearCell(row, i);
          } else {
            stat.overwrote += countRow(row);
            row.length = 0;
          }
          break;
        case 'J':
          if (e1 === 0) {
            row = rowAt(cur.r);
            for (i = cur.c; i < row.length; i++) if (row[i] && row[i].printed) stat.overwrote++;
            row.length = Math.min(row.length, cur.c);
            for (i = cur.r + 1; i < rows.length; i++) stat.overwrote += countRow(rows[i]);
            rows.length = Math.min(rows.length, cur.r + 1);
          } else {
            for (i = 0; i < rows.length; i++) stat.overwrote += countRow(rows[i]);
            if (e1 === 1) {
              for (i = 0; i < cur.r; i++) rows[i] = [];
              row = rowAt(cur.r);
              for (var j = 0; j <= cur.c && j < row.length; j++) clearCell(row, j);
            } else {
              rows.length = 0;
            }
          }
          break;
        case 'X':
          row = rowAt(cur.r);
          for (i = cur.c; i < cur.c + d1 && i < COLS; i++) clearCell(row, i);
          break;
        case 'P':
          row = rowAt(cur.r);
          if (cur.c < row.length) {
            var cutOut = row.splice(cur.c, d1);
            for (i = 0; i < cutOut.length; i++) if (cutOut[i].printed) stat.overwrote++;
          }
          break;
        case '@':
          row = rowAt(cur.r);
          padRow(row, cur.c);
          for (i = 0; i < d1 && row.length < COLS; i++) {
            row.splice(cur.c, 0, { ch: ' ', st: cloneStyle(st), printed: false });
          }
          break;
        case 'L':
          for (i = 0; i < d1 && rows.length < MAX_ROWS; i++) rows.splice(cur.r, 0, []);
          break;
        case 'M':
          for (i = 0; i < d1 && cur.r < rows.length; i++) {
            stat.overwrote += countRow(rows[cur.r]);
            rows.splice(cur.r, 1);
          }
          break;
        case 's': saved = { r: cur.r, c: cur.c, st: cloneStyle(st) }; break;
        case 'u':
          if (saved) { cur.r = saved.r; cur.c = saved.c; st = cloneStyle(saved.st); }
          break;
        case 'r': noted('scroll regions'); break;
        case 'n':
        case 'c':
        case 't': noted('device reports'); break;
        default: break;
      }
    });

    while (rows.length && !countRow(rows[rows.length - 1])) rows.pop();
    return { rows: rows, stat: stat };
  }

  /* --- painting the screen ----------------------------------------------
     Every cell goes in through textContent, never innerHTML, so a payload that
     happens to contain markup is text and stays text. That is not a nicety
     here: the whole point of the tool is to take hostile bytes and look at
     them. */
  function paint(rows) {
    var mount = $('tool-render');
    if (!mount) return;
    mount.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'ae-line ae-empty';
      empty.textContent = 'Nothing rendered yet.';
      mount.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'ae-line';
      if (!row.length) {
        line.appendChild(document.createTextNode('\u00a0'));
        mount.appendChild(line);
        return;
      }
      var runText = '', runStyle = row[0] ? row[0].st : null, runKey = styleKey(runStyle);
      function emit() {
        if (!runText) return;
        line.appendChild(styledSpan(runText, runStyle));
        runText = '';
      }
      row.forEach(function (cell) {
        var k = styleKey(cell.st);
        if (k !== runKey) { emit(); runStyle = cell.st; runKey = k; }
        runText += cell.ch;
      });
      emit();
      mount.appendChild(line);
    });
  }

  function styledSpan(text, s) {
    var span = document.createElement('span');
    span.textContent = text;
    if (!s) return span;
    var fg = s.fg ? s.fg.hex : DEF_FG;
    var bg = s.bg ? s.bg.hex : null;
    if (s.rev) { var t = bg || DEF_BG; bg = fg; fg = t; }
    if (s.conceal) fg = bg || DEF_BG;
    span.style.color = fg;
    if (bg) span.style.backgroundColor = bg;
    if (s.bold) span.style.fontWeight = '700';
    if (s.faint) span.style.opacity = '0.6';
    if (s.italic) span.style.fontStyle = 'italic';
    var deco = [];
    if (s.ul) deco.push('underline');
    if (s.strike) deco.push('line-through');
    if (s.over) deco.push('overline');
    if (deco.length) {
      span.style.textDecoration = deco.join(' ');
      if (s.ul === 2) span.style.textDecorationStyle = 'double';
      if (s.ul === 3) span.style.textDecorationStyle = 'wavy';
      if (s.ul === 4) span.style.textDecorationStyle = 'dotted';
      if (s.ul === 5) span.style.textDecorationStyle = 'dashed';
    }
    if (s.blink) span.className = 'ae-blink';
    return span;
  }

  function renderNote(res) {
    var el = $('tool-rendernote');
    if (!el) return;
    var stat = res.stat;
    var bits = [];
    bits.push(res.rows.length + (res.rows.length === 1 ? ' line' : ' lines') + ', ' +
              stat.printed + ' characters written');
    if (stat.overwrote) {
      bits.push(stat.overwrote + ' characters that had already been printed were erased or ' +
        'replaced afterwards — output going backwards, which is how a progress bar ' +
        'redraws and equally how a log line is forged');
    } else {
      bits.push('nothing already printed was erased or overwritten');
    }
    if (stat.clamped) {
      bits.push(stat.clamped + (stat.clamped === 1 ? ' cursor move' : ' cursor moves') +
        ' ran off the top or left edge and was clamped');
    }
    if (stat.wrapped) {
      bits.push(stat.wrapped + (stat.wrapped === 1 ? ' line' : ' lines') +
        ' wrapped at column ' + COLS);
    }
    if (stat.truncated) bits.push('the model stopped at ' + MAX_ROWS + ' rows');
    if (stat.titles.length) bits.push('window title would have become: ' + stat.titles.join(' then '));
    var skipped = Object.keys(stat.notPerformed);
    if (skipped.length) bits.push('named but not performed here: ' + skipped.join(', '));
    el.textContent = bits.join('. ') + '.';
  }

  /* --- categorising for the summary ------------------------------------- */

  function categoryOf(tok, d) {
    if (tok.form === 'csi' && tok.fin === 'm') return 'sgr';
    if (d.cat === 'cursor' || d.cat === 'insert') return 'cursor';
    if (d.cat === 'erase') return 'erase';
    if (d.cat === 'mode') return 'mode';
    if (d.cat === 'osc') return 'osc';
    if (d.cat === 'string') return 'string';
    if (d.cat === 'report') return 'report';
    if (d.cat === 'c0' || d.cat === 'c1') return 'c0';
    return 'other';
  }

  var CAT_LABEL = {
    sgr: 'colour, SGR',
    cursor: 'cursor movement',
    erase: 'erase and delete',
    mode: 'mode changes',
    osc: 'OSC commands',
    string: 'control strings',
    report: 'terminal replies',
    c0: 'control characters',
    other: 'everything else'
  };

  /* --- decode mode ------------------------------------------------------ */

  function decodeReport(text) {
    var toks = tokenise(text);
    var style = newStyle();
    var counts = {}, risks = [], seenRisk = {};
    var listed = 0, ctrlTotal = 0, plainChars = 0, whitespace = 0;

    out.clear();
    out.heading('Input');
    out.row('characters', text.length);
    out.row('bytes as UTF-8', utf8Bytes(text).length);

    var entries = [];
    toks.forEach(function (tok) {
      if (tok.kind === 'text') { plainChars += tok.raw.length; return; }
      if (tok.form === 'c0' && (tok.code === 0x0a || tok.code === 0x09)) { whitespace++; return; }
      ctrlTotal++;
      var d = describe(tok);
      var cat = categoryOf(tok, d);
      counts[cat] = (counts[cat] || 0) + 1;
      entries.push({ tok: tok, d: d, cat: cat });
      if (d.risk && !seenRisk[d.risk]) { seenRisk[d.risk] = true; risks.push({ abbr: d.abbr, text: d.risk }); }
    });

    out.row('printable text', plainChars + ' characters');
    out.row('newlines and tabs', whitespace);
    out.row('control sequences', ctrlTotal);
    Object.keys(CAT_LABEL).forEach(function (k) {
      if (counts[k]) out.row('  ' + CAT_LABEL[k], counts[k]);
    });
    out.rule();

    if (!ctrlTotal) {
      out.ok('No escape sequences in this text.');
      out.dim('If you expected some, the quoting toggle in the toolbar is the usual');
      out.dim('reason: a log file holds a real 0x1B byte, but text copied out of an');
      out.dim('editor often holds the four characters \\ 0 3 3 instead.');
      out.line('');
    }

    entries.forEach(function (e, n) {
      if (listed >= MAX_LISTED) return;
      listed++;
      var tok = e.tok, d = e.d;
      out.heading('[' + (n + 1) + '] ' + visible(tok.raw).slice(0, 72));
      out.row('  bytes', hexDump(tok.raw));
      out.row('  name', d.abbr + ' \u2014 ' + d.name);
      out.row('  standard', d.std);
      if (tok.eight) out.row('  form', '8-bit C1 introducer, not the two-byte ESC form');
      if (tok.cut) out.row('  note', 'truncated \u2014 no terminator in the input');

      if (d.sgr) {
        var notes = sgrWalk(tok.params, style);
        if (!notes.length) out.line('  effect              no parameters, which means SGR 0: a full reset');
        notes.forEach(function (line, k) {
          out.row(k === 0 ? '  effect' : '  ', line);
        });
      } else {
        d.effect.forEach(function (line, k) {
          out.row(k === 0 ? '  effect' : '  ', line);
        });
      }
      if (d.risk) out.line('  risk                ' + d.risk, 't-warn');
      out.line('');
    });

    if (entries.length > listed) {
      out.warn('Another ' + (entries.length - listed) + ' sequences were found and are not listed.');
      out.dim('The listing stops at ' + MAX_LISTED + ' so the page stays usable; the counts above');
      out.dim('and the render below cover all of them.');
      out.line('');
    }

    out.rule();
    if (risks.length) {
      out.err('What this text could do to a terminal');
      out.line('');
      risks.forEach(function (r) {
        out.warn('  ' + r.abbr + ': ' + r.text);
        out.line('');
      });
    } else {
      out.ok('Nothing here moves the cursor, erases, talks to the window manager or');
      out.ok('asks the terminal to reply. On the evidence of these bytes, this is');
      out.ok('colour and nothing else.');
      out.line('');
    }

    out.rule();
    out.dim('The copy box below holds this same text with every control character');
    out.dim('made visible — the form that is safe to paste into a ticket, a chat');
    out.dim('message or a commit body without it acting on the reader’s terminal.');
    out.line('');
    limitsBlock();
    return toks;
  }

  function limitsBlock() {
    out.dim('What this did not do');
    out.dim('  It is not a terminal emulator. The render below is 80 fixed columns,');
    out.dim('  no scrollback, no scroll region, no alternate screen, tab stops every');
    out.dim('  eight. SGR, cursor movement, erase, insert and delete are performed.');
    out.dim('  Private modes, OSC, device reports and control strings are explained');
    out.dim('  and deliberately not obeyed.');
    out.dim('  Colours are xterm default values. Your terminal ships its own palette,');
    out.dim('  so 31 is "whatever your theme calls red", not the hex printed here.');
    out.dim('  Nothing was uploaded. There is no server here to upload to.');
  }

  /* --- sanitise mode ---------------------------------------------------- */

  function sanitiseReport(text) {
    var toks = tokenise(text);
    var counts = {}, risks = [], seenRisk = {};
    var stripped = '', total = 0;

    toks.forEach(function (tok) {
      if (tok.kind === 'text') { stripped += tok.raw; return; }
      if (tok.form === 'c0' && (tok.code === 0x0a || tok.code === 0x09)) { stripped += tok.raw; return; }
      total++;
      var d = describe(tok);
      var cat = categoryOf(tok, d);
      counts[cat] = (counts[cat] || 0) + 1;
      if (d.risk && !seenRisk[d.risk]) { seenRisk[d.risk] = true; risks.push({ abbr: d.abbr, text: d.risk }); }
    });

    var caretForm = visible(text, true);

    out.clear();
    out.heading('Sanitiser');
    out.row('characters in', text.length);
    out.row('control sequences', total);
    Object.keys(CAT_LABEL).forEach(function (k) {
      if (counts[k]) out.row('  ' + CAT_LABEL[k], counts[k]);
    });
    out.row('characters out, stripped', stripped.length);
    out.row('characters out, visible', caretForm.length);
    out.rule();

    if (risks.length) {
      out.err('Dangerous constructs in this text');
      out.line('');
      risks.forEach(function (r) { out.warn('  ' + r.abbr + ': ' + r.text); out.line(''); });
      out.rule();
    } else if (total) {
      out.ok('Sequences found, but none of them move the cursor, erase, set a title,');
      out.ok('touch the clipboard or ask the terminal to reply.');
      out.rule();
    }

    out.heading('Visible form \u2014 the cat -v convention, and what is in the copy box');
    out.dim('Control characters are shown, not obeyed: ESC becomes ^[, the other C0');
    out.dim('controls become ^ plus a letter, DEL becomes ^?, C1 becomes M-^ plus a');
    out.dim('letter. Tabs and newlines are left alone so the text stays readable.');
    out.line('');
    out.line(caretForm.slice(0, 8000));
    if (caretForm.length > 8000) out.dim('\u2026 truncated at 8000 characters for display; the copy box has all of it.');
    out.line('');
    out.rule();
    out.heading('Stripped form \u2014 every sequence removed');
    out.dim('Newlines and tabs kept, everything else discarded. This is the form to');
    out.dim('put in a report or an incident ticket, where the escape sequences are');
    out.dim('noise rather than evidence.');
    out.line('');
    out.line(stripped.slice(0, 8000));
    out.line('');
    out.rule();
    out.dim('How to read a hostile file safely, in order of preference:');
    out.dim('  cat -v file      makes control bytes visible instead of acting on them');
    out.dim('  less file        with no -R, less shows escapes as ESC[ and is safe');
    out.dim('  vim / an editor  shows ^[ and does not obey it');
    out.dim('  less -R file     NOT a safety measure. -R passes colour through, which');
    out.dim('                   means it passes the sequence through. -r is worse: it');
    out.dim('                   passes everything.');
    out.dim('  cat file         obeys all of it, including the parts that rewrite');
    out.dim('                   lines you already read.');
    out.line('');
    out.dim('cat -v is closer to a safety measure than less -R, but neither is a');
    out.dim('security boundary. cat -v works on bytes and predates most of what a');
    out.dim('modern terminal understands; treat it as "much less likely to hurt",');
    out.dim('not as "sanitised". Strip at the point where the log is WRITTEN.');
    out.line('');
    limitsBlock();

    setResult(caretForm);
    return toks;
  }

  /* --- build mode ------------------------------------------------------- */

  function readColour(which) {
    var mode = $('b-' + which).value;
    if (mode === 'none') return null;
    if (mode === '256') {
      var idx = Math.max(0, Math.min(255, parseInt($('b-' + which + '-idx').value, 10) || 0));
      return { params: (which === 'fg' ? '38' : '48') + ';5;' + idx,
               note: (which === 'fg' ? 'Foreground' : 'Background') + ' 256-colour: ' + describe256(idx) };
    }
    if (mode === 'rgb') {
      var hexv = String($('b-' + which + '-rgb').value || '#000000');
      var r = parseInt(hexv.substr(1, 2), 16) || 0;
      var g = parseInt(hexv.substr(3, 2), 16) || 0;
      var b = parseInt(hexv.substr(5, 2), 16) || 0;
      return { params: (which === 'fg' ? '38' : '48') + ';2;' + r + ';' + g + ';' + b,
               note: (which === 'fg' ? 'Foreground' : 'Background') + ' truecolour ' + hexv +
                     '. Needs a terminal that supports 24-bit colour; the ones that do not will usually ignore the whole sequence rather than approximate it.' };
    }
    var n = parseInt(mode, 10);
    var note;
    if (n === 39) note = 'Foreground back to the terminal default';
    else if (n === 49) note = 'Background back to the terminal default';
    /* 100-107 must be tested BEFORE 90-107: every bright-background code also
       satisfies n >= 90, so with the tests the other way round the background
       branch was unreachable and HUES[n - 90] indexed past the end of an
       eight-entry table, printing "Foreground bright undefined". */
    else if (n >= 100) note = 'Background bright ' + HUES[n - 100] + ' — aixterm extension';
    else if (n >= 90) note = 'Foreground bright ' + HUES[n - 90] + ' — aixterm extension, not ECMA-48';
    else if (n >= 40) note = 'Background ' + HUES[n - 40];
    else note = 'Foreground ' + HUES[n - 30];
    return { params: mode, note: note };
  }

  var ATTRS = [
    { code: 1, id: 'b-a1', label: 'bold' },
    { code: 2, id: 'b-a2', label: 'faint' },
    { code: 3, id: 'b-a3', label: 'italic' },
    { code: 4, id: 'b-a4', label: 'underline' },
    { code: 5, id: 'b-a5', label: 'blink' },
    { code: 7, id: 'b-a7', label: 'reverse' },
    { code: 8, id: 'b-a8', label: 'conceal' },
    { code: 9, id: 'b-a9', label: 'strikethrough' }
  ];

  /* Shell single-quoting done properly, because the sample text is the visitor's
     and an apostrophe in it would otherwise hand them a command line that does
     not run. Close the quote, emit an escaped apostrophe, reopen: '\'' */
  function shellQuote(s) {
    return "'" + String(s).split("'").join("'\\''") + "'";
  }

  function buildReport() {
    var params = [], notes = [];
    ATTRS.forEach(function (a) {
      var el = $(a.id);
      if (el && el.checked) {
        params.push(String(a.code));
        notes.push(a.code + ' ' + a.label + ' — ' + SGR_TEXT[a.code]);
      }
    });
    var fg = readColour('fg');
    if (fg) { params.push(fg.params); notes.push(fg.params + ' — ' + fg.note); }
    var bg = readColour('bg');
    if (bg) { params.push(bg.params); notes.push(bg.params + ' — ' + bg.note); }

    var body = String($('b-text').value || '');
    var joined = params.join(';');
    var seq = joined === '' ? '' : ESC + '[' + joined + 'm';
    var reset = ESC + '[0m';
    var full = seq + body + reset;

    var esc = joined === '' ? '' : '[' + joined + 'm';
    var formX = (joined === '' ? '' : '\\x1b' + esc) + body + '\\x1b[0m';
    var formO = (joined === '' ? '' : '\\033' + esc) + body + '\\033[0m';
    var formE = (joined === '' ? '' : '\\e' + esc) + body + '\\e[0m';
    var fmtPrintf = "printf '" + (joined === '' ? '' : '\\033' + esc) + "%s\\033[0m\\n' " + shellQuote(body);
    var fmtEcho = 'echo -e ' + shellQuote((joined === '' ? '' : '\\e' + esc) + body + '\\e[0m');

    out.clear();
    out.heading('The sequence');
    out.row('parameters', joined === '' ? '(none selected)' : joined);
    if (!notes.length) {
      out.row('what it means', 'nothing selected, so only the trailing reset is emitted');
    } else {
      notes.forEach(function (n, k) { out.row(k === 0 ? 'what it means' : '  ', n); });
    }
    out.rule();
    out.heading('Every form of the same bytes');
    out.row('raw (shown inert)', visible(full).slice(0, 200));
    out.dim('  The raw form contains a real 0x1B byte. In a file, in a terminal and');
    out.dim('  in this box it is invisible: that is exactly why escape sequences in');
    out.dim('  untrusted output are hard to notice.');
    out.line('');
    out.row('\\x1b (C, most langs)', formX);
    out.row('\\033 (octal, C, sh)', formO);
    out.row('\\e (GNU extension)', formE);
    out.row('printf', fmtPrintf);
    out.row('echo -e (bash)', fmtEcho);
    out.rule();
    out.dim('Notes on the two command lines, both of which matter in practice:');
    out.dim('  printf puts the text in an argument and uses %s, not in the format');
    out.dim('  string. A per cent sign in your text would otherwise be read as a');
    out.dim('  conversion specifier and eat the next argument.');
    out.dim('  echo -e is not POSIX. bash and zsh builtins honour it; dash prints');
    out.dim('  the literal -e; /bin/echo differs again. printf is the portable one.');
    out.dim('  \\e is a GNU extension. \\033 is the form that works everywhere.');
    out.line('');
    out.dim('The trailing reset is not decoration. Without ' + visible(reset) + ' the');
    out.dim('attribute stays set on everything printed afterwards, including your');
    out.dim('shell prompt, until something else resets it.');
    out.rule();
    var honest = [];
    if ($('b-a5') && $('b-a5').checked) honest.push('blink (5) is ignored by most modern terminals');
    if ($('b-a8') && $('b-a8').checked) honest.push('conceal (8) hides the text on screen but it is still in the buffer and still copies out');
    if ($('b-a3') && $('b-a3').checked) honest.push('italic (3) is not universal; some terminals substitute reverse video');
    if ($('b-fg').value === 'rgb' || $('b-bg').value === 'rgb') honest.push('truecolour needs a terminal that advertises it; check with printf and your eyes, not with $COLORTERM alone');
    if (honest.length) {
      out.warn('Portability, honestly:');
      honest.forEach(function (h) { out.warn('  ' + h); });
      out.line('');
    }
    limitsBlock();

    var form = $('b-form').value;
    setResult(form === 'x' ? formX : form === 'o' ? formO : form === 'e' ? formE :
              form === 'printf' ? fmtPrintf : form === 'echo' ? fmtEcho : full);

    return tokenise(full);
  }

  /* --- glue ------------------------------------------------------------- */

  function setResult(text) {
    var el = $('tool-result');
    if (el) el.value = text;
  }

  var EXAMPLES = {
    ls: 'total 12\n' +
        '\\033[0m\\033[01;34mDocuments\\033[0m  \\033[01;32mbackup.sh\\033[0m  ' +
        '\\033[01;31marchive.tar.gz\\033[0m  report.txt\n' +
        '\n' +
        'That is what ls --color=always leaves behind when you redirect it into a\n' +
        'file. Without --color=always, ls checks isatty(1), sees a file rather than\n' +
        'a terminal, and prints none of it.\n',
    prompt: '\\e[1m\\e[38;5;208mkrunal\\e[0m@\\e[38;5;39mworkstation\\e[0m:' +
            '\\e[38;2;122;162;247m~/src/site\\e[0m$ \\e[48;5;236m\\e[38;5;250m git status \\e[0m\n' +
            '\\e[3m\\e[2mOn branch main\\e[0m\n' +
            '\\e[9m\\e[31mdeleted:    old-notes.txt\\e[0m\n' +
            '\\e[4m\\e[32mmodified:   labs/index.html\\e[0m\n',
    progress: 'Building\\rBuilding [          ]   0%\\rBuilding [####      ]  40%' +
              '\\r\\e[2KBuilding [##########] 100%  done\n' +
              'Every one of those frames was printed. Only the last is visible,\n' +
              'because CR goes back to column 1 of the same line and the next\n' +
              'characters land on top of the old ones.\n',
    osc: '\\e]0;deploy: production\\a' +
         'Build \\e]8;;https://example.com/builds/4821\\e\\\\#4821\\e]8;;\\e\\\\ finished\n' +
         '\\e]52;c;Y2xpcGJvYXJkIHdyaXRlIGRlbW8=\\a' +
         'and this line writes your clipboard without changing anything on screen.\n',
    attack: '2026-08-31 09:14:02 INFO  user=alice   action=login   result=ok\n' +
            '2026-08-31 09:14:07 WARN  user=mallory action=sudo    result=DENIED\n' +
            '2026-08-31 09:14:09 INFO  user=mallory action=logout  result=ok\n' +
            '\\e[2A\\r\\e[2K2026-08-31 09:14:07 INFO  user=mallory action=whoami  result=ok\\e[2B\\r',
    modes: '\\e[?25l\\e[?1049h\\e[?2004l\\e[?1000h\\e[6n\\e[?1049l\\e[?25h\n' +
           '\\x9b1;33mAnd this one uses the eight-bit C1 form of CSI\\x9b0m\n'
  };

  function currentMode() {
    var el = $('tool-mode');
    return el ? el.value : 'decode';
  }

  function applyMode() {
    var mode = currentMode();
    var root = $('ansiescapes');
    var buildbar = $('tool-buildbar');
    var inputPane = $('tool-inpane');
    var panes = $('tool-panes');
    var label = $('tool-inlabel');
    var area = $('tool-in');
    if (buildbar) buildbar.hidden = mode !== 'build';
    if (inputPane) inputPane.hidden = mode === 'build';
    if (panes) {
      if (mode === 'build') panes.classList.add('lab-panes-single');
      else panes.classList.remove('lab-panes-single');
    }
    if (root) {
      if (mode === 'build') root.classList.add('ae-build');
      else root.classList.remove('ae-build');
    }
    if (label) {
      label.textContent = mode === 'sanitise'
        ? 'Untrusted output to defuse'
        : 'Terminal output, or a log excerpt';
    }
    if (area) {
      area.placeholder = mode === 'sanitise'
        ? 'Paste the log lines you do not trust'
        : 'Paste terminal output, or pick an example above';
    }
  }

  function run() {
    var mode = currentMode();
    try {
      var toks;
      if (mode === 'build') {
        toks = buildReport();
      } else {
        var text = String($('tool-in').value || '');
        if (text.length > MAX_INPUT) {
          out.clear();
          out.err('That is ' + text.length + ' characters. This tool stops at ' + MAX_INPUT + ',');
          out.err('because the parse and the render both run on your processor in this tab.');
          return;
        }
        if ($('tool-unquote') && $('tool-unquote').checked) text = unquote(text);
        toks = mode === 'sanitise' ? sanitiseReport(text) : decodeReport(text);
        if (mode === 'decode') setResult(visible(text, true));
      }
      var res = runScreen(toks);
      paint(res.rows);
      renderNote(res);
    } catch (err) {
      /* run() is called bare from a click handler and from the mode select, and
         decodeReport() clears the pane before it prints anything. A throw
         halfway down would otherwise leave a wiped pane and a console message
         nobody sees. Whatever printed before the throw stays, and the failure
         is appended underneath it, which also says how far the parse got. */
      out.rule();
      out.err('Could not finish reading that input.');
      out.err('Details: ' + ((err && err.message) || String(err)));
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('If you can tell me what you pasted, I would like to fix it.');
    }
  }

  LabTool.define({
    id: 'ansiescapes',
    run: run,
    onReady: function () {
      var mode = $('tool-mode');
      if (mode) mode.addEventListener('change', function () { applyMode(); run(); });

      var ex = $('tool-example');
      if (ex) {
        ex.addEventListener('change', function () {
          var key = ex.value;
          if (!key || !EXAMPLES[key]) return;
          if (mode && mode.value === 'build') { mode.value = 'decode'; applyMode(); }
          $('tool-in').value = EXAMPLES[key];
          if ($('tool-unquote')) $('tool-unquote').checked = true;
          run();
        });
      }

      var live = ['b-fg', 'b-bg', 'b-fg-idx', 'b-bg-idx', 'b-fg-rgb', 'b-bg-rgb', 'b-text', 'b-form'];
      live.forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener('input', function () { if (currentMode() === 'build') run(); });
      });
      ATTRS.forEach(function (a) {
        var el = $(a.id);
        if (el) el.addEventListener('change', function () { if (currentMode() === 'build') run(); });
      });
      var uq = $('tool-unquote');
      if (uq) uq.addEventListener('change', function () { if (currentMode() !== 'build') run(); });

      applyMode();
      $('tool-in').value = EXAMPLES.attack;
      out.dim('Pick an example, or paste your own, and press Run.');
      out.dim('The box starts with a log excerpt whose last line rewrites the line');
      out.dim('two rows above it. Run it and read the rendered screen at the bottom.');
      out.dim('');
      out.dim('Nothing is uploaded. There is no server here to upload to.');
    }
  });
})();

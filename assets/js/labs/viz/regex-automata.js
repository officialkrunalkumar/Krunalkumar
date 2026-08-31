/* ==========================================================================
   regex-automata.js — the automaton half of regular expressions, drawn.
   --------------------------------------------------------------------------
   Labs already has two regex pages. /labs/regex is a tester: it answers "did
   this match". /labs/regex-engine is the backtracking search, stepped, and it
   is the engine almost every language actually ships. This page is the other
   family entirely — the compilation pipeline that Ken Thompson published in
   1968 and that RE2, Go's regexp and rust's regex crate still use:

       pattern -> AST -> NFA -> DFA -> minimal DFA -> run

   Every stage here is built for real and drawn for real. The graph layout is
   a hand-rolled layered BFS, about ninety lines at the bottom of this file,
   because pulling in a graph library for six nodes and eight edges would be
   the only dependency on the entire site.

   Four decisions worth spelling out.

   1. Matching is full-string. The automaton accepts the whole input or it
      does not. Partial matching drags in leftmost-longest rules and capture
      semantics that differ between engines, and none of that survives the
      trip through a DFA anyway — a DFA has no memory beyond its current
      state, so it cannot tell you WHERE a group matched, only whether the
      string is in the language. Saying that out loud is half the lesson.

   2. Backreferences and lookaround are refused, loudly, with the reason. They
      are not a gap in this implementation. A language like "some string, then
      the same string again" is provably not regular, so no finite automaton
      of any size can recognise it, so there is nothing for Thompson's
      construction to build. The refusal is the lesson. Word boundaries are
      refused too, but for a different and weaker reason, and the page says
      which is which, because conflating them would be a lie.

   3. The alphabet is folded into equivalence classes before subset
      construction runs. A DFA over all of Unicode is not something you can
      draw, or build. So the 128 ASCII codes plus one catch-all symbol for
      everything above U+007F are partitioned by which of the pattern's
      character sets contain them, and the DFA is built over those classes.
      This is what real engines do. It also means this page cannot tell two
      non-ASCII characters apart — it says so when the pattern contains one.

   4. Everything is capped and every cap is announced. Subset construction is
      exponential in the worst case; the state count is capped and the page
      refuses to continue rather than hanging the tab. The backtracker counts
      steps against a ceiling and reports that it hit it. A number on this
      page that was not computed does not appear on this page.

   The payload is the last tab. A real backtracking matcher and a real DFA
   simulation are run against the same pattern and the same inputs, both
   counting their own steps, and both plotted. The backtracker goes vertical.
   The DFA is a straight line at exactly one step per character. Then the
   trade-off closes the loop: that straight line is bought with the refusal in
   point 2.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ======================================================================== */
  /*  SMALL HELPERS                                                           */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";
  var SVGNS = 'http://www.w3.org/2000/svg';
  var ELLIPSIS = '…';

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function S(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
      }
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function num(n) {
    if (typeof LabViz !== 'undefined' && LabViz.humanNumber) return LabViz.humanNumber(n);
    return String(n);
  }
  /* String.prototype.repeat is ES6 and this file is ES5. */
  function rep(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }
  function shorten(text, max) {
    var s = String(text);
    return s.length <= max ? s : s.slice(0, max - 1) + ELLIPSIS;
  }
  function button(text, onClick, cls) {
    var el = E('button', 'ra-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }
  function note(text, kind) {
    var p = E('p', 'ra-note' + (kind ? ' ra-' + kind : ''), text);
    return p;
  }
  function heading(text) { return E('p', 'ra-h', text); }

  /* ======================================================================== */
  /*  CHARACTER SETS                                                          */
  /* ------------------------------------------------------------------------ */
  /*  A set is 128 ASCII flags plus one catch-all flag standing for every        */
  /*  codepoint at or above U+0080. That single catch-all is the reason this   */
  /*  page cannot distinguish an e-acute from an umlaut-u: to the automaton    */
  /*  they are the same symbol. Anything smarter needs the full Unicode        */
  /*  category tables, which are larger than this entire lab.                  */
  /* ======================================================================== */

  var OTHER = 128;

  function newSet() { return { bits: new Uint8Array(128), other: false }; }
  function setAdd(s, code) { if (code >= 0 && code < 128) s.bits[code] = 1; else s.other = true; }
  function setAddRange(s, a, b) {
    for (var i = a; i <= b; i++) { if (i < 128) s.bits[i] = 1; else { s.other = true; break; } }
  }
  function setUnion(a, b) {
    var o = newSet();
    for (var i = 0; i < 128; i++) o.bits[i] = (a.bits[i] || b.bits[i]) ? 1 : 0;
    o.other = a.other || b.other;
    return o;
  }
  function setNegate(s) {
    var o = newSet();
    for (var i = 0; i < 128; i++) o.bits[i] = s.bits[i] ? 0 : 1;
    o.other = !s.other;
    return o;
  }
  function setHasSym(s, sym) { return sym === OTHER ? !!s.other : !!s.bits[sym]; }
  function setSize(s) {
    var c = 0;
    for (var i = 0; i < 128; i++) if (s.bits[i]) c++;
    return c;
  }
  function setKey(s) {
    var k = s.other ? '1' : '0';
    for (var i = 0; i < 128; i++) k += s.bits[i] ? '1' : '0';
    return k;
  }

  function mkDot() { var s = newSet(); setAddRange(s, 0, 127); s.bits[10] = 0; s.bits[13] = 0; s.other = true; return s; }
  function mkDigit() { var s = newSet(); setAddRange(s, 48, 57); return s; }
  function mkWord() {
    var s = newSet();
    setAddRange(s, 48, 57); setAddRange(s, 65, 90); setAddRange(s, 97, 122); setAdd(s, 95);
    return s;
  }
  function mkSpace() {
    var s = newSet();
    var codes = [9, 10, 11, 12, 13, 32];
    for (var i = 0; i < codes.length; i++) setAdd(s, codes[i]);
    return s;
  }
  var PRESETS = null;
  function presets() {
    if (PRESETS) return PRESETS;
    var d = mkDigit(), w = mkWord(), sp = mkSpace(), dot = mkDot();
    PRESETS = [
      { key: setKey(dot), label: '.' },
      { key: setKey(d), label: '\\d' }, { key: setKey(setNegate(d)), label: '\\D' },
      { key: setKey(w), label: '\\w' }, { key: setKey(setNegate(w)), label: '\\W' },
      { key: setKey(sp), label: '\\s' }, { key: setKey(setNegate(sp)), label: '\\S' }
    ];
    return PRESETS;
  }

  /* Space inside a bracket range would be invisible, so it prints as SP. The
     legend under every graph says so, because a symbol nobody can read is
     worse than no symbol. */
  function charLabel(code) {
    if (code === 32) return 'SP';
    if (code === 9) return '\\t';
    if (code === 10) return '\\n';
    if (code === 13) return '\\r';
    if (code < 32 || code === 127) {
      var h = code.toString(16);
      return '\\x' + (h.length < 2 ? '0' + h : h);
    }
    return String.fromCharCode(code);
  }
  function rangesOf(bits) {
    var out = [], i = 0;
    while (i < 128) {
      if (bits[i]) {
        var j = i;
        while (j + 1 < 128 && bits[j + 1]) j++;
        if (j - i >= 2) out.push(charLabel(i) + '-' + charLabel(j));
        else for (var q = i; q <= j; q++) out.push(charLabel(q));
        i = j + 1;
      } else i++;
    }
    return out;
  }
  function describeSet(s) {
    var key = setKey(s), p = presets();
    for (var i = 0; i < p.length; i++) if (p[i].key === key) return p[i].label;
    var size = setSize(s);
    if (size === 0 && !s.other) return 'nothing';
    if (size === 0 && s.other) return 'non-ASCII';
    if (size === 1 && !s.other) {
      for (var c = 0; c < 128; c++) if (s.bits[c]) return charLabel(c);
    }
    if (size > 64) {
      var comp = setNegate(s);
      return '[^' + rangesOf(comp.bits).join('') + ']' + (s.other ? '' : ' ASCII only');
    }
    return '[' + rangesOf(s.bits).join('') + ']' + (s.other ? ' or non-ASCII' : '');
  }

  /* ======================================================================== */
  /*  PARSER                                                                  */
  /* ------------------------------------------------------------------------ */
  /*  Recursive descent over the usual grammar:                                */
  /*      alt    := cat ('|' cat)*                                             */
  /*      cat    := rep*                                                       */
  /*      rep    := atom ('*' | '+' | '?' | '{m,n}')*                          */
  /*      atom   := '(' alt ')' | '[' set ']' | '.' | '^' | '$' | escape | ch  */
  /*  Refusals are thrown as objects carrying a reason paragraph, not as bare     */
  /*  strings, because the reason is the point and a one-word error would      */
  /*  waste the most interesting failure this page has.                        */
  /* ======================================================================== */

  function refuse(message, why, kind) {
    throw { ra: true, kind: kind || 'refused', message: message, why: why };
  }

  function parse(src) {
    var i = 0, n = src.length, groups = 0, warnings = [];

    function fail(message, why) { refuse(message, why, 'syntax'); }
    function peek() { return i < n ? src.charAt(i) : ''; }

    function parseAlt() {
      var kids = [parseCat()];
      while (peek() === '|') { i++; kids.push(parseCat()); }
      return kids.length === 1 ? kids[0] : { t: 'alt', kids: kids };
    }

    function parseCat() {
      var kids = [];
      while (i < n && peek() !== '|' && peek() !== ')') kids.push(parseRep());
      if (kids.length === 0) return { t: 'empty' };
      return kids.length === 1 ? kids[0] : { t: 'cat', kids: kids };
    }

    function eatLazy() {
      if (peek() === '?') { i++; return true; }
      return false;
    }

    function parseRep() {
      var node = parseAtom();
      for (;;) {
        var c = peek();
        if (c === '*') { i++; node = { t: 'star', kid: node, lazy: eatLazy() }; }
        else if (c === '+') { i++; node = { t: 'plus', kid: node, lazy: eatLazy() }; }
        else if (c === '?') { i++; node = { t: 'opt', kid: node, lazy: eatLazy() }; }
        else if (c === '{') {
          var counted = tryCounted();
          if (!counted) break;
          node = expandCounted(node, counted.min, counted.max);
        } else break;
      }
      return node;
    }

    /* {m,n} is not a new kind of machine, it is copy and paste. JavaScript
       treats a malformed brace as a literal '{', and so does this, which is
       why the scanner rewinds instead of failing. */
    function tryCounted() {
      var save = i;
      i++;
      var a = '', b = null;
      while (i < n && src.charAt(i) >= '0' && src.charAt(i) <= '9') { a += src.charAt(i); i++; }
      if (a === '') { i = save; return null; }
      if (peek() === ',') {
        i++; b = '';
        while (i < n && src.charAt(i) >= '0' && src.charAt(i) <= '9') { b += src.charAt(i); i++; }
      }
      if (peek() !== '}') { i = save; return null; }
      i++;
      var min = parseInt(a, 10);
      var max = b === null ? min : (b === '' ? -1 : parseInt(b, 10));
      if (max !== -1 && max < min) {
        fail('Counted repetition {' + min + ',' + max + '} has its bounds the wrong way round.',
             'The upper bound has to be at least the lower bound. Nothing can repeat between four and two times.');
      }
      if (min > MAX_COUNTED || max > MAX_COUNTED) {
        fail('Counted repetition above ' + MAX_COUNTED + ' is refused here.',
             'A counted repetition is compiled by copying the body out that many times, so {200} really does mean two hundred copies of the machine. That is exactly how real engines do it, and it is exactly why a pattern like a{1000}{1000} is a denial-of-service bug in the compiler rather than in the matcher. The cap here is ' + MAX_COUNTED + ' so the graph stays drawable.');
      }
      return { min: min, max: max };
    }

    function parseAtom() {
      var c = peek();
      if (c === '') fail('The pattern ended in the middle of something.', 'Usually a trailing backslash or an unclosed group.');
      if (c === '*' || c === '+' || c === '?') {
        fail('There is nothing for ' + c + ' to repeat.',
             'A quantifier has to follow something. Put it after a character, a group or a character set.');
      }
      if (c === ')') fail('Closing bracket with no opening one.', 'A closing bracket has to have an opening one before it. Put a backslash in front of it if you meant a literal bracket.');
      if (c === '(') return parseGroup();
      if (c === '[') return parseCharSet();
      if (c === '.') { i++; return { t: 'set', set: mkDot(), src: '.' }; }
      if (c === '^' || c === '$') { i++; return { t: 'anchor', kind: c, src: c }; }
      if (c === '\\') return parseEscape();
      i++;
      var code = src.charCodeAt(i - 1);
      if (code >= 128) warnings.push('The pattern contains a character above U+007F (' + c + '). Every non-ASCII character is one single symbol to this automaton, so it cannot tell that one apart from any other non-ASCII character.');
      var s = newSet(); setAdd(s, code);
      return { t: 'set', set: s, src: c };
    }

    function parseGroup() {
      i++;
      var capturing = true, gi = 0;
      if (peek() === '?') {
        var two = src.substr(i, 2), three = src.substr(i, 3);
        if (two === '?=' || two === '?!') {
          refuse('Lookahead is refused: ' + (two === '?=' ? '(?=' : '(?!') + ' cannot be compiled to a finite automaton by this pipeline.',
                 'A lookahead asks a second question about the same position without consuming anything, and the answer can depend on unboundedly much of what follows. Thompson’s construction has one rule per operator and no rule for "run another machine here and throw away its progress". Some lookarounds over a fixed alphabet can be encoded by an intersection or a complement of automata, so lookaround is not always outside the regular languages the way a backreference is — but building that is a different program from this one, and pretending otherwise would be dishonest. Refused, with the reason stated.');
        }
        if (three === '?<=' || three === '?<!') {
          refuse('Lookbehind is refused: ' + three.replace('?', '(?') + ' cannot be compiled by this pipeline.',
                 'Same reason as lookahead. It is a zero-width test that runs a second machine at the current position, and there is no Thompson rule that builds one. A DFA state is a single number; it has nowhere to keep the result of a side query.');
        }
        if (three === '?<:' || (three.charAt(0) === '?' && three.charAt(1) === '<')) {
          i += 2;
          var name = '';
          while (i < n && src.charAt(i) !== '>') { name += src.charAt(i); i++; }
          if (peek() !== '>') fail('A named group was opened and never closed with >.', 'The syntax is (?<name>pattern).');
          i++;
          groups++; gi = groups;
        } else if (two === '?:') {
          i += 2; capturing = false;
        } else {
          refuse('The group flag (' + two + ' is not supported here.',
                 'This pipeline understands a plain group, a non-capturing group (?: and a named group (?<name>. Inline flags and the other (? forms are engine-specific and none of them survive compilation to an automaton anyway.');
        }
      } else { groups++; gi = groups; }
      var inner = parseAlt();
      if (peek() !== ')') fail('A group was opened and never closed.', 'Count the brackets from the left: every opening bracket needs a closing one before the pattern ends.');
      i++;
      return { t: 'group', kid: inner, capturing: capturing, gi: gi };
    }

    function classEscape(ch) {
      if (ch === 'd') return mkDigit();
      if (ch === 'D') return setNegate(mkDigit());
      if (ch === 'w') return mkWord();
      if (ch === 'W') return setNegate(mkWord());
      if (ch === 's') return mkSpace();
      if (ch === 'S') return setNegate(mkSpace());
      return null;
    }
    var SIMPLE = { n: 10, t: 9, r: 13, f: 12, v: 11, '0': 0 };

    function escapeCode(inSet) {
      i++;
      if (i >= n) fail('The pattern ends with a lone backslash.', 'A backslash has to escape something.');
      var ch = src.charAt(i); i++;
      if (ch === 'x') {
        var hx = src.substr(i, 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hx)) fail('\\x needs two hex digits after it.', 'For example \\x41 is the letter A.');
        i += 2;
        return { code: parseInt(hx, 16), src: '\\x' + hx };
      }
      if (ch === 'u') {
        var hu = src.substr(i, 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hu)) fail('\\u needs four hex digits after it.', 'For example \\u0041 is the letter A.');
        i += 4;
        var cu = parseInt(hu, 16);
        if (cu >= 128) warnings.push('\\u' + hu + ' is above U+007F, so it collapses into the single catch-all symbol this automaton uses for every non-ASCII character. It will match any of them.');
        return { code: cu, src: '\\u' + hu };
      }
      if (Object.prototype.hasOwnProperty.call(SIMPLE, ch)) return { code: SIMPLE[ch], src: '\\' + ch };
      if (ch >= '1' && ch <= '9' && !inSet) {
        refuse('Backreference \\' + ch + ' is refused, and this one is not a limitation of this page.',
               'A backreference asks the machine to remember what an earlier group matched and compare it again later. That memory is unbounded — the group could have matched a thousand characters. A finite automaton has, by definition, a finite number of states and no other memory, so there is no automaton of any size that recognises "some string, then that same string again". The pumping lemma proves it. This is not a feature nobody got round to writing: the machine on this page provably cannot express it, which is precisely why engines that guarantee linear time (RE2, Go regexp, rust regex) do not offer backreferences either.');
      }
      if (ch === 'k') {
        refuse('Named backreference \\k is refused for the same reason as \\1.',
               'It is still a backreference, and the language it describes is still not regular. No finite automaton can recognise it.');
      }
      if (ch === 'b' || ch === 'B') {
        if (inSet) return { code: 8, src: '\\b' };
        refuse('Word boundary \\' + ch + ' is refused here — and the reason is a weaker one than the backreference reason.',
               'A word boundary is a zero-width test on the two characters either side of the current position. Unlike a backreference, that IS expressible by a finite automaton: you can push "the previous character was a word character" into the state and split every state in two. So \\b stays inside the regular languages. What it does not have is a Thompson rule — there is no fragment to build — so this pipeline refuses it. That distinction matters: \\1 is impossible, \\b is merely unimplemented here, and a page that reported both with the same message would be teaching something false.');
      }
      if (ch === 'p' || ch === 'P') {
        refuse('Unicode property escapes (\\p) are refused.',
               'They are perfectly regular — a property is just a large character set. The problem is size: the property tables are hundreds of kilobytes, and the alphabet on this page is 128 ASCII codes plus one catch-all symbol for everything else. There is nowhere to put them.');
      }
      var cls = classEscape(ch);
      if (cls) return { set: cls, src: '\\' + ch };
      if (/[a-zA-Z]/.test(ch)) {
        fail('Unknown escape \\' + ch + '.', 'This pipeline knows \\d \\D \\w \\W \\s \\S, \\n \\t \\r \\f \\v \\0, \\xHH and \\uHHHH, plus a backslash in front of any punctuation.');
      }
      return { code: ch.charCodeAt(0), src: '\\' + ch };
    }

    function parseEscape() {
      var e = escapeCode(false);
      if (e.set) return { t: 'set', set: e.set, src: e.src };
      if (e.code >= 128) warnings.push('An escape in the pattern names a character above U+007F, which this automaton cannot tell apart from any other non-ASCII character.');
      var s = newSet(); setAdd(s, e.code);
      return { t: 'set', set: s, src: e.src };
    }

    /* Bracketed character sets. ] first is a literal, exactly as in JavaScript,
       and a '-' at either end is a literal too. */
    function parseCharSet() {
      var start = i;
      i++;
      var negated = false;
      if (peek() === '^') { negated = true; i++; }
      var s = newSet(), first = true, any = false;
      while (i < n) {
        var c = src.charAt(i);
        if (c === ']' && !first) break;
        first = false;
        var lo = null, loSet = null;
        if (c === '\\') {
          var e = escapeCode(true);
          if (e.set) { loSet = e.set; } else { lo = e.code; }
        } else { lo = src.charCodeAt(i); i++; }
        if (loSet) { s = setUnion(s, loSet); any = true; continue; }
        if (peek() === '-' && i + 1 < n && src.charAt(i + 1) !== ']') {
          i++;
          var hi;
          if (peek() === '\\') {
            var e2 = escapeCode(true);
            if (e2.set) {
              fail('A character range cannot end with ' + e2.src + '.',
                   'The right-hand side of a range has to be a single character, not a whole set.');
            }
            hi = e2.code;
          } else { hi = src.charCodeAt(i); i++; }
          if (hi < lo) {
            fail('The range ' + charLabel(lo) + '-' + charLabel(hi) + ' runs backwards.',
                 'The first character of a range has to come before the second in code order.');
          }
          setAddRange(s, lo, hi);
        } else {
          setAdd(s, lo);
        }
        if (lo >= 128) warnings.push('A non-ASCII character appears in a bracketed set, and this automaton folds every non-ASCII character into one symbol.');
        any = true;
      }
      if (peek() !== ']') {
        i = start;
        fail('A bracketed set was opened at position ' + start + ' and never closed.', 'Count the brackets: a bracketed set runs until the matching close bracket, and this one never arrives.');
      }
      i++;
      if (!any && !negated) {
        return { t: 'set', set: newSet(), src: '[]' };
      }
      return { t: 'set', set: negated ? setNegate(s) : s, src: src.slice(start, i) };
    }

    var ast = parseAlt();
    if (i < n) fail('Unexpected ' + peek() + ' at position ' + i + '.', 'Most often a closing bracket with no opening one, which ends the pattern early and leaves the rest stranded.');
    markAnchors(ast, true, true);
    return { ast: ast, warnings: warnings, groups: groups };
  }

  var MAX_COUNTED = 24;

  function cloneAst(nd) {
    var c = { t: nd.t };
    if (nd.set) c.set = nd.set;
    if (nd.kind) c.kind = nd.kind;
    if (nd.lazy) c.lazy = nd.lazy;
    if (nd.src != null) c.src = nd.src;
    if (nd.capturing != null) c.capturing = nd.capturing;
    if (nd.gi != null) c.gi = nd.gi;
    if (nd.kid) c.kid = cloneAst(nd.kid);
    if (nd.kids) {
      c.kids = [];
      for (var i = 0; i < nd.kids.length; i++) c.kids.push(cloneAst(nd.kids[i]));
    }
    return c;
  }

  function expandCounted(node, min, max) {
    var kids = [], i;
    for (i = 0; i < min; i++) kids.push(cloneAst(node));
    if (max === -1) {
      kids.push({ t: 'star', kid: cloneAst(node) });
    } else {
      for (i = min; i < max; i++) kids.push({ t: 'opt', kid: cloneAst(node) });
    }
    if (kids.length === 0) return { t: 'empty' };
    if (kids.length === 1) return kids[0];
    return { t: 'cat', kids: kids, counted: true };
  }

  /* --- anchors ----------------------------------------------------------- */
  /*  A DFA state is one number. It does not know the input position, so it
      cannot check "am I at the start". The compiler has to answer that
      statically instead: an anchor is redundant when nothing can consume a
      character before it (for ^) or after it (for $), and since matching here
      is full-string, a redundant anchor is exactly epsilon. Anywhere else the
      anchor can never be satisfied, so it compiles to an edge labelled with
      the empty set, which no input symbol can take. Both branches are correct
      rather than convenient, and the second one is why a pattern like a^b
      draws a machine with a dead edge in the middle of it. */

  function emptyOnly(nd) {
    switch (nd.t) {
      case 'empty': return true;
      case 'anchor': return true;
      case 'set': return false;
      case 'group': return emptyOnly(nd.kid);
      case 'star': case 'plus': case 'opt': return emptyOnly(nd.kid);
      case 'cat': case 'alt':
        for (var i = 0; i < nd.kids.length; i++) if (!emptyOnly(nd.kids[i])) return false;
        return true;
    }
    return false;
  }

  function markAnchors(nd, atStart, atEnd) {
    var i;
    switch (nd.t) {
      case 'anchor':
        nd.redundant = nd.kind === '^' ? !!atStart : !!atEnd;
        return;
      case 'group': markAnchors(nd.kid, atStart, atEnd); return;
      case 'opt': markAnchors(nd.kid, atStart, atEnd); return;
      case 'star': case 'plus': {
        var e = emptyOnly(nd.kid);
        markAnchors(nd.kid, atStart && e, atEnd && e);
        return;
      }
      case 'alt':
        for (i = 0; i < nd.kids.length; i++) markAnchors(nd.kids[i], atStart, atEnd);
        return;
      case 'cat': {
        var pre = [], post = [], acc = true;
        for (i = 0; i < nd.kids.length; i++) { pre[i] = acc; acc = acc && emptyOnly(nd.kids[i]); }
        acc = true;
        for (i = nd.kids.length - 1; i >= 0; i--) { post[i] = acc; acc = acc && emptyOnly(nd.kids[i]); }
        for (i = 0; i < nd.kids.length; i++) markAnchors(nd.kids[i], atStart && pre[i], atEnd && post[i]);
        return;
      }
      default: return;
    }
  }

  /* ======================================================================== */
  /*  THOMPSON CONSTRUCTION                                                   */
  /* ------------------------------------------------------------------------ */
  /*  One fragment per operator, each with exactly one entry state and one     */
  /*  exit state, glued with epsilon edges. The epsilon edges are the whole    */
  /*  trick: they are what makes every rule composable without ever looking    */
  /*  inside the fragment being composed. They are also why the graph looks    */
  /*  bushier than a hand-drawn machine for the same language would — nobody  */
  /*  draws it this way by hand, and that is the point: this is mechanical.    */
  /* ======================================================================== */

  var MAX_NFA = 400;

  function thompson(ast) {
    var states = [];
    function add() {
      if (states.length >= MAX_NFA) {
        refuse('This pattern needs more than ' + MAX_NFA + ' NFA states, so the build was stopped.',
               'Thompson’s construction produces roughly two states per character of pattern, and counted repetition multiplies that. Past a few hundred the graph stops being something you can read, so the build stops here rather than drawing a hairball. Shorten the pattern.', 'size');
      }
      var st = { id: states.length, eps: [], edges: [] };
      states.push(st);
      return st.id;
    }
    function link(a, b) { states[a].eps.push(b); }
    function edge(a, b, set, label) { states[a].edges.push({ to: b, set: set, label: label }); }

    function build(nd) {
      var s, a, f, i, kids;
      switch (nd.t) {
        case 'empty':
          s = add(); a = add(); link(s, a);
          return { s: s, a: a };
        case 'set':
          s = add(); a = add();
          edge(s, a, nd.set, describeSet(nd.set));
          return { s: s, a: a };
        case 'anchor':
          s = add(); a = add();
          if (nd.redundant) link(s, a);
          else edge(s, a, newSet(), nd.kind + ' here is impossible');
          return { s: s, a: a };
        case 'group':
          return build(nd.kid);
        case 'cat':
          kids = [];
          for (i = 0; i < nd.kids.length; i++) kids.push(build(nd.kids[i]));
          for (i = 0; i + 1 < kids.length; i++) link(kids[i].a, kids[i + 1].s);
          return { s: kids[0].s, a: kids[kids.length - 1].a };
        case 'alt':
          s = add(); a = add();
          for (i = 0; i < nd.kids.length; i++) {
            f = build(nd.kids[i]);
            link(s, f.s); link(f.a, a);
          }
          return { s: s, a: a };
        case 'star':
          s = add(); a = add();
          f = build(nd.kid);
          link(s, f.s); link(s, a); link(f.a, f.s); link(f.a, a);
          return { s: s, a: a };
        case 'plus':
          s = add(); a = add();
          f = build(nd.kid);
          link(s, f.s); link(f.a, f.s); link(f.a, a);
          return { s: s, a: a };
        case 'opt':
          s = add(); a = add();
          f = build(nd.kid);
          link(s, f.s); link(s, a); link(f.a, a);
          return { s: s, a: a };
      }
      refuse('Internal: unknown node ' + nd.t, 'This is a bug in the lab. Please tell me the pattern you used.', 'bug');
    }

    var frag = build(ast);
    var eps = 0, sym = 0;
    for (var i = 0; i < states.length; i++) { eps += states[i].eps.length; sym += states[i].edges.length; }
    return { states: states, start: frag.s, accept: frag.a, epsCount: eps, symCount: sym };
  }

  /* ======================================================================== */
  /*  ALPHABET EQUIVALENCE CLASSES                                            */
  /* ------------------------------------------------------------------------ */
  /*  Two input symbols that appear in exactly the same character sets can     */
  /*  never send the machine anywhere different, so they can share one column  */
  /*  of the transition table. Folding 129 symbols down to a handful is what   */
  /*  makes the DFA both buildable and drawable, and it is what every serious  */
  /*  engine does before it builds a table.                                    */
  /* ======================================================================== */

  function buildAlphabet(nfa) {
    var sets = [], seen = {}, i, j;
    for (i = 0; i < nfa.states.length; i++) {
      var es = nfa.states[i].edges;
      for (j = 0; j < es.length; j++) {
        var k = setKey(es[j].set);
        if (seen[k] == null) { seen[k] = sets.length; sets.push(es[j].set); }
      }
    }
    var sigIndex = {}, classOf = new Array(OTHER + 1), classes = [];
    for (var sym = 0; sym <= OTHER; sym++) {
      var sig = '';
      for (var t = 0; t < sets.length; t++) sig += setHasSym(sets[t], sym) ? '1' : '0';
      if (sigIndex[sig] == null) {
        sigIndex[sig] = classes.length;
        classes.push({ id: classes.length, syms: [], sig: sig });
      }
      classOf[sym] = sigIndex[sig];
      classes[sigIndex[sig]].syms.push(sym);
    }
    for (i = 0; i < classes.length; i++) {
      var cs = newSet(), sy = classes[i].syms;
      for (j = 0; j < sy.length; j++) {
        if (sy[j] === OTHER) cs.other = true; else cs.bits[sy[j]] = 1;
      }
      classes[i].set = cs;
      classes[i].label = describeSet(cs);
      classes[i].short = shorten(classes[i].label, 13);
      classes[i].dead = classes[i].sig.indexOf('1') < 0;
    }
    return { classes: classes, classOf: classOf, sets: sets };
  }

  /* ======================================================================== */
  /*  SUBSET CONSTRUCTION                                                     */
  /* ------------------------------------------------------------------------ */
  /*  Each DFA state IS a set of NFA states. That sentence is the entire       */
  /*  insight, and the table on the DFA tab prints the set beside every state  */
  /*  so it is not something you have to take on faith. The empty set is a     */
  /*  real state too — the trap — and it is drawn rather than hidden, because a  */
  /*  partial DFA is not a total function and minimisation needs a total one.  */
  /* ======================================================================== */

  var MAX_DFA = 300;

  function closure(nfa, seedList, counter) {
    var mark = {}, stack = [], out = [], i;
    for (i = 0; i < seedList.length; i++) {
      if (!mark[seedList[i]]) { mark[seedList[i]] = 1; stack.push(seedList[i]); }
    }
    while (stack.length) {
      var s = stack.pop();
      out.push(s);
      var eps = nfa.states[s].eps;
      for (i = 0; i < eps.length; i++) {
        if (counter) counter.steps++;
        if (!mark[eps[i]]) { mark[eps[i]] = 1; stack.push(eps[i]); }
      }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function moveOn(nfa, subset, cls, counter) {
    var out = [], mark = {}, sym = cls.syms[0];
    for (var i = 0; i < subset.length; i++) {
      var es = nfa.states[subset[i]].edges;
      for (var j = 0; j < es.length; j++) {
        if (counter) counter.steps++;
        if (setHasSym(es[j].set, sym) && !mark[es[j].to]) { mark[es[j].to] = 1; out.push(es[j].to); }
      }
    }
    return out;
  }

  function subsetConstruct(nfa, alpha) {
    var classes = alpha.classes;
    var states = [], index = {}, work = [], capped = false;
    var counter = { steps: 0 };

    function add(subset) {
      var key = subset.join(',');
      if (index[key] != null) return index[key];
      if (states.length >= MAX_DFA) { capped = true; return -1; }
      var id = states.length;
      index[key] = id;
      states.push({
        id: id, subset: subset,
        accepting: subset.indexOf(nfa.accept) >= 0,
        trap: subset.length === 0,
        trans: new Array(classes.length)
      });
      work.push(id);
      return id;
    }

    var start = add(closure(nfa, [nfa.start], counter));
    while (work.length && !capped) {
      var id = work.shift();
      var st = states[id];
      for (var c = 0; c < classes.length; c++) {
        var next = closure(nfa, moveOn(nfa, st.subset, classes[c], counter), counter);
        var to = add(next);
        if (to < 0) { capped = true; break; }
        st.trans[c] = to;
      }
    }

    var trapId = index[''] == null ? -1 : index[''];
    return {
      states: states, start: start, classes: classes, classOf: alpha.classOf,
      trap: trapId, capped: capped, work: counter.steps
    };
  }

  /* ======================================================================== */
  /*  MOORE MINIMISATION                                                      */
  /* ------------------------------------------------------------------------ */
  /*  Hopcroft is asymptotically better — n log n against Moore’s n squared      */
  /*  times the alphabet — and for a production tool it is the right choice.    */
  /*  Moore is the right choice here, because it refines in visible rounds:    */
  /*  every state gets a signature made of the blocks its transitions land in, */
  /*  states with equal signatures stay together, and the round where two      */
  /*  states come apart names the symbol that separated them. Hopcroft’s       */
  /*  worklist order is efficient and impossible to narrate.                   */
  /*                                                                          */
  /*  Subset construction only ever emits reachable states, so the usual first */
  /*  half of minimisation — throwing away what cannot be reached — already     */
  /*  happened. What is left is indistinguishability, which is the interesting */
  /*  half anyway.                                                             */
  /* ======================================================================== */

  function minimise(dfa) {
    var n = dfa.states.length, k = dfa.classes.length, i, c;
    var blockOf = new Array(n);
    var seenLabel = {}, blocks = 0;
    for (i = 0; i < n; i++) {
      var lab = dfa.states[i].accepting ? 'A' : 'R';
      if (seenLabel[lab] == null) { seenLabel[lab] = blocks++; }
      blockOf[i] = seenLabel[lab];
    }

    var rounds = [{
      round: 0, count: blocks,
      why: blocks === 1
        ? 'Round 0 starts with a single block: every state agrees on accepting.'
        : 'Round 0 splits on the only thing known without looking at any input: accepting against rejecting. Two states that disagree there are separated by the empty string.',
      members: groupBy(blockOf, n), splits: []
    }];

    for (var r = 1; r <= n + 1; r++) {
      var sigMap = {}, next = new Array(n), count = 0;
      for (i = 0; i < n; i++) {
        var sig = String(blockOf[i]);
        for (c = 0; c < k; c++) sig += '|' + blockOf[dfa.states[i].trans[c]];
        if (sigMap[sig] == null) sigMap[sig] = count++;
        next[i] = sigMap[sig];
      }
      if (count === blocks) {
        rounds.push({
          round: r, count: count, stable: true,
          why: 'Round ' + r + ' produced no new split, so the partition is stable and the algorithm stops. Every block is now a set of states that no input string can tell apart.',
          members: groupBy(blockOf, n), splits: []
        });
        break;
      }
      var splits = collectSplits(dfa, blockOf, next, n, k);
      blockOf = next; blocks = count;
      rounds.push({
        round: r, count: count,
        why: 'Round ' + r + ' looked at where each state goes on every column of the transition table and split any block whose members disagreed.',
        members: groupBy(blockOf, n), splits: splits
      });
    }

    var members = groupBy(blockOf, n);
    var mstates = [];
    for (var b = 0; b < members.length; b++) {
      var reps = members[b], rep0 = dfa.states[reps[0]];
      var trans = new Array(k);
      for (c = 0; c < k; c++) trans[c] = blockOf[rep0.trans[c]];
      mstates.push({
        id: b, from: reps, accepting: rep0.accepting,
        trap: rep0.trap && reps.length === 1 ? true : allTrap(dfa, reps),
        trans: trans
      });
    }
    var merged = [];
    for (b = 0; b < members.length; b++) if (members[b].length > 1) merged.push({ block: b, states: members[b] });

    return {
      states: mstates, start: blockOf[dfa.start], classes: dfa.classes,
      classOf: dfa.classOf, blockOf: blockOf, rounds: rounds, merged: merged
    };
  }

  function allTrap(dfa, ids) {
    for (var i = 0; i < ids.length; i++) if (!dfa.states[ids[i]].trap) return false;
    return true;
  }
  function groupBy(blockOf, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      if (!out[blockOf[i]]) out[blockOf[i]] = [];
      out[blockOf[i]].push(i);
    }
    for (var b = 0; b < out.length; b++) if (!out[b]) out[b] = [];
    return out;
  }

  /* For every block that came apart this round, name the column that did
     it and the two different places the members landed. "These merged" is a
     claim; "these two disagree on b, one goes to block 1 and the other to
     block 2" is a reason. */
  function collectSplits(dfa, prev, next, n, k) {
    var byOld = {}, i, out = [];
    for (i = 0; i < n; i++) {
      if (!byOld[prev[i]]) byOld[prev[i]] = [];
      byOld[prev[i]].push(i);
    }
    for (var key in byOld) {
      if (!Object.prototype.hasOwnProperty.call(byOld, key)) continue;
      var group = byOld[key], distinct = {}, dcount = 0;
      for (i = 0; i < group.length; i++) {
        if (distinct[next[group[i]]] == null) { distinct[next[group[i]]] = 1; dcount++; }
      }
      if (dcount < 2) continue;
      var witness = -1;
      for (var c = 0; c < k && witness < 0; c++) {
        var first = prev[dfa.states[group[0]].trans[c]];
        for (i = 1; i < group.length; i++) {
          if (prev[dfa.states[group[i]].trans[c]] !== first) { witness = c; break; }
        }
      }
      var parts = [];
      var partIndex = {};
      for (i = 0; i < group.length; i++) {
        var nb = next[group[i]];
        if (partIndex[nb] == null) { partIndex[nb] = parts.length; parts.push({ block: nb, states: [], target: witness >= 0 ? prev[dfa.states[group[i]].trans[witness]] : -1 }); }
        parts[partIndex[nb]].states.push(group[i]);
      }
      out.push({ oldBlock: Number(key), witness: witness, parts: parts });
    }
    return out;
  }

  /* ======================================================================== */
  /*  SIMULATORS                                                              */
  /* ======================================================================== */

  function symOf(str, i) {
    var c = str.charCodeAt(i);
    return c >= 128 ? OTHER : c;
  }

  /* The DFA. One table lookup per input character, and the loop counts them
     so the "one step per character" claim on the last tab is measured rather
     than asserted. */
  function runDfa(dfa, input) {
    var st = dfa.start, steps = 0;
    for (var i = 0; i < input.length; i++) {
      steps++;
      st = dfa.states[st].trans[dfa.classOf[symOf(input, i)]];
      if (st == null) return { steps: steps, accept: false, state: -1 };
    }
    return { steps: steps, accept: !!dfa.states[st].accepting, state: st };
  }

  /* The NFA kept as a set of live states, which is what Thompson's paper
     actually proposed and what RE2 falls back to when a DFA would be too
     large. Linear in the input, linear in the machine, no backtracking. */
  function runNfaSet(nfa, alpha, input) {
    var counter = { steps: 0 };
    var set = closure(nfa, [nfa.start], counter);
    for (var i = 0; i < input.length; i++) {
      var cls = alpha.classes[alpha.classOf[symOf(input, i)]];
      set = closure(nfa, moveOn(nfa, set, cls, counter), counter);
      if (set.length === 0) break;
    }
    return { steps: counter.steps, accept: set.indexOf(nfa.accept) >= 0, set: set };
  }

  /* The backtracker, written the way a real one is: continuation passing, one
     path at a time, greedy by default and lazy where the pattern says so.
     Laziness changes the order the paths are tried and not the set of strings
     accepted, which is exactly why the automaton above is allowed to ignore
     it. The step counter and the ceiling are the reason this function exists
     at all. */
  var STOP = { stop: true };

  function backtrack(ast, input, cap) {
    var steps = 0, capped = false, deep = false;
    function bump() {
      steps++;
      if (steps > cap) { capped = true; throw STOP; }
    }
    function seq(kids, i, pos, k) {
      if (i === kids.length) return k(pos);
      return m(kids[i], pos, function (p2) { return seq(kids, i + 1, p2, k); });
    }
    function starLoop(nd, p, k) {
      if (nd.lazy) {
        if (k(p)) return true;
        return m(nd.kid, p, function (p2) { return p2 > p ? starLoop(nd, p2, k) : false; });
      }
      if (m(nd.kid, p, function (p2) { return p2 > p ? starLoop(nd, p2, k) : false; })) return true;
      return k(p);
    }
    function m(nd, pos, k) {
      bump();
      var i;
      switch (nd.t) {
        case 'empty': return k(pos);
        case 'set':
          if (pos >= input.length) return false;
          return setHasSym(nd.set, symOf(input, pos)) ? k(pos + 1) : false;
        /* The backtracker knows the position, so an anchor is one comparison.
           The automaton does not, which is why the compiler above had to prove
           statically where an anchor could sit. Same operator, two very
           different amounts of work, and the difference is exactly the
           information the machine carries. */
        case 'anchor':
          if (nd.kind === '^') return pos === 0 ? k(pos) : false;
          return pos === input.length ? k(pos) : false;
        case 'group': return m(nd.kid, pos, k);
        case 'cat': return seq(nd.kids, 0, pos, k);
        case 'alt':
          for (i = 0; i < nd.kids.length; i++) if (m(nd.kids[i], pos, k)) return true;
          return false;
        case 'opt':
          if (nd.lazy) return k(pos) ? true : m(nd.kid, pos, k);
          return m(nd.kid, pos, k) ? true : k(pos);
        case 'star': return starLoop(nd, pos, k);
        case 'plus':
          return m(nd.kid, pos, function (p2) {
            return p2 > pos ? starLoop(nd, p2, k) : k(p2);
          });
      }
      return false;
    }
    var accept = false;
    try {
      accept = m(ast, 0, function (p) { return p === input.length; });
    } catch (err) {
      if (err === STOP) accept = false;
      else if (err instanceof RangeError) { deep = true; accept = false; }
      else throw err;
    }
    return { steps: steps, accept: accept, capped: capped, deep: deep };
  }

  /* ======================================================================== */
  /*  GRAPH DRAWING                                                           */
  /* ------------------------------------------------------------------------ */
  /*  A layered layout: BFS from the start state gives each node a column, and */
  /*  nodes in a column are stacked and centred. Edges are quadratic curves    */
  /*  with the bend chosen from how many edges share the pair and whether the  */
  /*  edge runs backwards. It is not a pretty layout and it is not trying to   */
  /*  be one — it is ninety lines of arithmetic instead of a graph library, and */
  /*  for machines of this size it reads fine.                                 */
  /* ======================================================================== */

  var MAX_DRAW = 90;
  var arrowSeq = 0;

  function graphSvg(spec) {
    var nodes = spec.nodes, edges = spec.edges;
    if (nodes.length > MAX_DRAW) return null;

    var idx = {}, i, j;
    for (i = 0; i < nodes.length; i++) idx[nodes[i].id] = i;

    /* BFS layering. Anything the BFS never reaches (which should not happen
       for a Thompson NFA, but a hostile pattern is a hostile pattern) is
       appended to the last column rather than silently dropped. */
    var depth = new Array(nodes.length), q = [], head = 0;
    for (i = 0; i < nodes.length; i++) depth[i] = -1;
    var startIdx = idx[spec.start] != null ? idx[spec.start] : 0;
    depth[startIdx] = 0; q.push(startIdx);
    var adj = [];
    for (i = 0; i < nodes.length; i++) adj.push([]);
    for (i = 0; i < edges.length; i++) {
      var a = idx[edges[i].from], b = idx[edges[i].to];
      if (a != null && b != null) adj[a].push(b);
    }
    while (head < q.length) {
      var cur = q[head++];
      for (j = 0; j < adj[cur].length; j++) {
        if (depth[adj[cur][j]] < 0) { depth[adj[cur][j]] = depth[cur] + 1; q.push(adj[cur][j]); }
      }
    }
    var maxDepth = 0;
    for (i = 0; i < nodes.length; i++) if (depth[i] > maxDepth) maxDepth = depth[i];
    for (i = 0; i < nodes.length; i++) if (depth[i] < 0) depth[i] = maxDepth + 1;
    maxDepth = 0;
    for (i = 0; i < nodes.length; i++) if (depth[i] > maxDepth) maxDepth = depth[i];

    var cols = [];
    for (i = 0; i <= maxDepth; i++) cols.push([]);
    for (i = 0; i < nodes.length; i++) cols[depth[i]].push(i);

    var R = 16, DX = 134, DY = 82, PADX = 78, PADY = 54;
    var rows = 1;
    for (i = 0; i < cols.length; i++) if (cols[i].length > rows) rows = cols[i].length;
    var width = PADX * 2 + maxDepth * DX;
    var height = PADY * 2 + (rows - 1) * DY;
    if (width < 340) width = 340;
    if (height < 190) height = 190;

    var pos = [];
    for (i = 0; i < cols.length; i++) {
      var colLen = cols[i].length;
      for (j = 0; j < colLen; j++) {
        pos[cols[i][j]] = {
          x: PADX + i * DX,
          y: height / 2 + (j - (colLen - 1) / 2) * DY
        };
      }
    }

    var svg = S('svg', {
      viewBox: '0 0 ' + Math.round(width) + ' ' + Math.round(height),
      width: Math.round(width), height: Math.round(height),
      role: 'img', 'aria-label': spec.label || 'State machine diagram'
    });
    svg.setAttribute('class', 'ra-svg');

    arrowSeq++;
    var arrowId = 'ra-arrow-' + arrowSeq;
    var arrowEpsId = 'ra-arrow-e-' + arrowSeq;
    var defs = S('defs');
    defs.appendChild(marker(arrowId, C.blue));
    defs.appendChild(marker(arrowEpsId, C.faint));
    svg.appendChild(defs);

    /* Merge every edge that shares a source, a target and a kind into one
       drawn curve with a joined label. Without this, [a-z] against a
       twenty-way alternation draws twenty overlapping arrows. */
    var groups = {}, order = [];
    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      var key = e.from + '>' + e.to + '>' + (e.eps ? 'e' : 's');
      if (!groups[key]) { groups[key] = { from: e.from, to: e.to, eps: e.eps, labels: [] }; order.push(key); }
      if (e.label != null && groups[key].labels.indexOf(e.label) < 0) groups[key].labels.push(e.label);
    }

    var pairCount = {};
    for (i = 0; i < order.length; i++) {
      var g0 = groups[order[i]];
      var pk = g0.from < g0.to ? g0.from + '|' + g0.to : g0.to + '|' + g0.from;
      if (pairCount[pk] == null) pairCount[pk] = 0;
      g0.slot = pairCount[pk]++;
    }

    for (i = 0; i < order.length; i++) {
      var g = groups[order[i]];
      var ai = idx[g.from], bi = idx[g.to];
      if (ai == null || bi == null) continue;
      var text = g.labels.length === 0 ? '' :
        (g.labels.length > 3 ? g.labels.slice(0, 3).join(',') + ELLIPSIS : g.labels.join(','));
      drawEdge(svg, pos[ai], pos[bi], text, g, R, arrowId, arrowEpsId, ai === bi);
    }

    for (i = 0; i < nodes.length; i++) drawNode(svg, nodes[i], pos[i], R, i === startIdx);
    return svg;
  }

  function marker(id, colour) {
    var mk = S('marker', {
      id: id, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'
    });
    mk.appendChild(S('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: colour }));
    return mk;
  }

  function drawEdge(svg, p1, p2, text, g, R, arrowId, arrowEpsId, self) {
    var colour = g.eps ? C.faint : C.blue;
    var head = g.eps ? arrowEpsId : arrowId;
    var path, lx, ly;
    if (self) {
      var top = p1.y - R - 34;
      path = 'M ' + (p1.x - 9) + ' ' + (p1.y - R + 3) +
             ' C ' + (p1.x - 44) + ' ' + top + ' ' + (p1.x + 44) + ' ' + top +
             ' ' + (p1.x + 9) + ' ' + (p1.y - R + 3);
      lx = p1.x; ly = top + 12;
    } else {
      var dx = p2.x - p1.x, dy = p2.y - p1.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var back = p2.x <= p1.x;
      var bend = (back ? 46 : 0) + g.slot * 24;
      if (back && Math.abs(dy) < 1) bend = 52 + g.slot * 24;
      var mx = (p1.x + p2.x) / 2 + nx * bend;
      var my = (p1.y + p2.y) / 2 + ny * bend;
      var a1 = Math.atan2(my - p1.y, mx - p1.x);
      var a2 = Math.atan2(my - p2.y, mx - p2.x);
      var sx = p1.x + R * Math.cos(a1), sy = p1.y + R * Math.sin(a1);
      var ex = p2.x + (R + 7) * Math.cos(a2), ey = p2.y + (R + 7) * Math.sin(a2);
      path = 'M ' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) +
             ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1);
      lx = 0.25 * sx + 0.5 * mx + 0.25 * ex;
      ly = 0.25 * sy + 0.5 * my + 0.25 * ey;
    }
    svg.appendChild(S('path', {
      d: path, fill: 'none', stroke: colour, 'stroke-width': 1.4,
      'stroke-dasharray': g.eps ? '4 3' : '0',
      'marker-end': 'url(#' + head + ')'
    }));
    var label = g.eps ? (text ? 'ε' : 'ε') : text;
    if (g.eps) label = 'ε';
    if (!label) return;
    var w = label.length * 6.1 + 8;
    svg.appendChild(S('rect', {
      x: (lx - w / 2).toFixed(1), y: (ly - 8).toFixed(1), width: w.toFixed(1), height: 16,
      rx: 4, fill: C.bg0, stroke: g.eps ? 'none' : C.line, 'stroke-width': 1
    }));
    var tx = S('text', {
      x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': 'middle',
      'font-size': 11, fill: g.eps ? C.faint : C.cyan, 'font-family': FONT
    });
    tx.textContent = label;
    svg.appendChild(tx);
  }

  function drawNode(svg, nd, p, R, isStart) {
    if (isStart) {
      svg.appendChild(S('path', {
        d: 'M ' + (p.x - R - 32) + ' ' + p.y + ' L ' + (p.x - R - 4) + ' ' + p.y,
        stroke: C.green, 'stroke-width': 1.6, fill: 'none'
      }));
      var st = S('text', { x: p.x - R - 18, y: p.y - 9, 'text-anchor': 'middle', 'font-size': 10, fill: C.green, 'font-family': FONT });
      st.textContent = 'start';
      svg.appendChild(st);
    }
    if (nd.accepting) {
      svg.appendChild(S('circle', { cx: p.x, cy: p.y, r: R + 4, fill: 'none', stroke: nd.active ? C.amber : C.green, 'stroke-width': 1.4 }));
    }
    var fill = nd.active ? 'rgba(251,191,36,0.22)' : (nd.trap ? 'rgba(252,165,165,0.12)' : 'rgba(56,189,248,0.10)');
    var stroke = nd.active ? C.amber : (nd.trap ? C.red : (nd.accepting ? C.green : C.blue));
    svg.appendChild(S('circle', { cx: p.x, cy: p.y, r: R, fill: fill, stroke: stroke, 'stroke-width': nd.active ? 2.4 : 1.4 }));
    var t = S('text', {
      x: p.x, y: p.y + 4, 'text-anchor': 'middle', 'font-size': 11.5,
      fill: nd.active ? C.amber : C.ink, 'font-family': FONT, 'font-weight': nd.active ? '700' : '400'
    });
    t.textContent = nd.label;
    svg.appendChild(t);
    if (nd.sub) {
      var s2 = S('text', { x: p.x, y: p.y + R + 15, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.faint, 'font-family': FONT });
      s2.textContent = shorten(nd.sub, 16);
      svg.appendChild(s2);
    }
    var title = S('title');
    title.textContent = nd.title || nd.label;
    svg.appendChild(title);
  }

  function graphBox(svg, fallbackText, legendItems) {
    var wrap = E('div', 'ra-graphwrap');
    if (svg) wrap.appendChild(svg);
    else wrap.appendChild(E('p', 'ra-sub', fallbackText));
    var box = E('div');
    box.appendChild(wrap);
    if (legendItems && legendItems.length) {
      var lg = E('div', 'ra-legend');
      for (var i = 0; i < legendItems.length; i++) lg.appendChild(E('span', null, legendItems[i]));
      box.appendChild(lg);
    }
    return box;
  }

  /* ======================================================================== */
  /*  TABLE HELPER                                                            */
  /* ======================================================================== */

  function table(headers, rows, rowClass) {
    var scroll = E('div', 'ra-scroll');
    var t = E('table', 'ra-table');
    var thead = E('thead'), tr = E('tr');
    for (var i = 0; i < headers.length; i++) tr.appendChild(E('th', null, headers[i]));
    thead.appendChild(tr); t.appendChild(thead);
    var tb = E('tbody');
    for (var r = 0; r < rows.length; r++) {
      var row = E('tr');
      if (rowClass) { var rc = rowClass(r); if (rc) row.className = rc; }
      for (var c = 0; c < rows[r].length; c++) row.appendChild(E('td', 'ra-td', rows[r][c]));
      tb.appendChild(row);
    }
    t.appendChild(tb);
    scroll.appendChild(t);
    return scroll;
  }

  function cards(list) {
    var wrap = E('div', 'ra-cards');
    for (var i = 0; i < list.length; i++) {
      var c = E('div', 'ra-card' + (list[i].tone ? ' ra-card-' + list[i].tone : ''));
      c.appendChild(E('p', 'ra-card-h', list[i].h));
      c.appendChild(E('p', 'ra-big', list[i].v));
      if (list[i].n) c.appendChild(E('p', 'ra-card-note', list[i].n));
      wrap.appendChild(c);
    }
    return wrap;
  }

  /* ======================================================================== */
  /*  SCOPED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Injected from here rather than added to labs.css, for the same reason as */
  /*  db-index.js: every selector below is meaningless outside this lab and    */
  /*  would only rot next to six thousand lines of other people’s rules. The   */
  /*  CSP allows inline style and forbids inline script, so a <style> node is  */
  /*  fine and nothing here is built from a string and executed. Every rule is */
  /*  scoped under the root id so the rest of the site is untouched.           */
  /* ======================================================================== */

  var CSS = [
    /* An opaque dark ground, in both themes deliberately. Every panel below is
       translucent navy over whatever is behind it, and on the light theme that
       is a pale card — the labels would composite down to about 1.1:1 and the
       colours the lab teaches with would all read as the same grey. labs.css
       carries the same fix, written out at length, for the four older mounts.
       This is that fix, kept beside the rules that need it. */
    '#regexautomata .ra-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';background:' + C.bg1 + ';}',
    '#regexautomata .ra-wrap :is(span,div,p,b,i,small,label,td,th,li):not([class]){color:inherit;}',
    '#regexautomata .lab-regexautomata-mount{min-height:22rem;}',
    '#regexautomata.is-fullscreen .lab-regexautomata-mount{flex:1 1 auto;min-height:0;overflow-y:auto;}',

    '#regexautomata .ra-head{padding:11px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,.6);display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;}',
    '#regexautomata .ra-fieldwrap{flex:1 1 17rem;min-width:0;}',
    '#regexautomata .ra-label{display:block;margin:0 0 4px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#regexautomata .ra-input{width:100%;font:inherit;font-size:14px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:7px;padding:7px 9px;}',
    '#regexautomata .ra-input:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#regexautomata .ra-exrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 12px 11px;background:rgba(15,23,42,.6);border-bottom:1px solid ' + C.line + ';}',
    '#regexautomata .ra-exlabel{font-size:11px;color:' + C.faint + ';margin-right:2px;}',

    '#regexautomata .ra-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:5px 9px;cursor:pointer;}',
    '#regexautomata .ra-btn:hover{background:#213152;border-color:#40608f;}',
    '#regexautomata .ra-btn:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#regexautomata .ra-btn[disabled]{opacity:.4;cursor:default;}',
    '#regexautomata .ra-btn-bad{border-color:rgba(252,165,165,.45);color:' + C.red + ';}',
    '#regexautomata .ra-btnrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}',

    '#regexautomata .ra-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(11,18,32,.6);}',
    '#regexautomata .ra-tab{font:inherit;font-size:12px;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#regexautomata .ra-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#regexautomata .ra-tab[aria-selected="true"]{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#regexautomata .ra-tab:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#regexautomata .ra-body{padding:12px;display:flex;flex-direction:column;gap:12px;min-width:0;}',
    '#regexautomata .ra-body:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:10px;}',

    '#regexautomata .ra-h{margin:2px 0 0;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#regexautomata .ra-sub{margin:0;font-size:11.5px;line-height:1.65;color:' + C.faint + ';}',
    '#regexautomata .ra-note{margin:0;padding:9px 12px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '#regexautomata .ra-warn{border-left-color:' + C.amber + ';background:rgba(251,191,36,.07);}',
    '#regexautomata .ra-bad{border-left-color:' + C.red + ';background:rgba(252,165,165,.08);}',
    '#regexautomata .ra-good{border-left-color:' + C.green + ';background:rgba(52,211,153,.07);}',
    '#regexautomata .ra-title{margin:0 0 4px;font-size:13px;font-weight:700;color:' + C.ink + ';}',

    '#regexautomata .ra-graphwrap{overflow-x:auto;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';padding:10px;}',
    '#regexautomata .ra-svg{display:block;max-width:none;}',
    '#regexautomata .ra-plot{display:block;width:100%;height:auto;max-width:100%;}',
    '#regexautomata .ra-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;font-size:11px;color:' + C.faint + ';}',

    '#regexautomata .ra-scroll{overflow-x:auto;}',
    '#regexautomata .ra-table{width:100%;border-collapse:collapse;font-size:12px;}',
    '#regexautomata .ra-table th{padding:5px 8px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#regexautomata .ra-td{padding:4px 8px;border-bottom:1px solid rgba(28,43,68,.6);color:' + C.ink + ';white-space:nowrap;}',
    '#regexautomata .ra-row-on .ra-td{color:' + C.amber + ';font-weight:700;}',
    '#regexautomata .ra-row-trap .ra-td{color:' + C.red + ';}',
    '#regexautomata .ra-row-merge .ra-td{color:' + C.green + ';}',

    '#regexautomata .ra-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:10px;}',
    '#regexautomata .ra-card{padding:11px 12px;border:1px solid ' + C.line + ';border-radius:10px;background:rgba(15,23,42,.55);min-width:0;}',
    '#regexautomata .ra-card-good{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.06);}',
    '#regexautomata .ra-card-bad{border-color:rgba(252,165,165,.45);background:rgba(252,165,165,.06);}',
    '#regexautomata .ra-card-h{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';}',
    '#regexautomata .ra-big{margin:0;font-size:20px;font-weight:700;line-height:1.2;color:' + C.cyan + ';overflow-wrap:anywhere;}',
    '#regexautomata .ra-card-good .ra-big{color:' + C.green + ';}',
    '#regexautomata .ra-card-bad .ra-big{color:' + C.red + ';}',
    '#regexautomata .ra-card-note{margin:5px 0 0;font-size:11px;line-height:1.6;color:' + C.dim + ';}',

    '#regexautomata .ra-tree{margin:0;padding:0;list-style:none;}',
    '#regexautomata .ra-tree ul{margin:0;padding:0 0 0 18px;list-style:none;border-left:1px solid ' + C.line + ';}',
    '#regexautomata .ra-tree li{margin:2px 0;position:relative;padding-left:10px;}',
    '#regexautomata .ra-tree li::before{content:"";position:absolute;left:0;top:.8em;width:8px;height:1px;background:' + C.line + ';}',
    '#regexautomata .ra-nodeop{color:' + C.violet + ';font-weight:700;}',
    '#regexautomata .ra-nodelit{color:' + C.cyan + ';}',
    '#regexautomata .ra-nodenote{color:' + C.faint + ';font-size:11px;}',

    '#regexautomata .ra-tape{display:flex;flex-wrap:wrap;gap:4px;}',
    '#regexautomata .ra-cell{min-width:24px;padding:5px 4px;text-align:center;border:1px solid #253651;border-radius:6px;background:#0d1729;color:' + C.dim + ';font-size:12px;}',
    '#regexautomata .ra-cell-done{color:' + C.green + ';border-color:rgba(52,211,153,.4);}',
    '#regexautomata .ra-cell-next{color:#04121f;background:' + C.amber + ';border-color:' + C.amber + ';font-weight:700;}',
    '#regexautomata .ra-caret{min-width:12px;padding:5px 2px;color:' + C.amber + ';font-weight:700;}',

    '#regexautomata .ra-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:12px;align-items:start;}',
    '#regexautomata .ra-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 7px;}',
    '#regexautomata .ra-field-label{color:' + C.dim + ';font-size:12px;}',
    '#regexautomata .ra-select{font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:100%;}',
    '#regexautomata .ra-select:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#regexautomata .ra-range{width:100%;accent-color:' + C.blue + ';cursor:pointer;}',
    '#regexautomata .ra-range:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;}',
    '#regexautomata .ra-pill{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;}',
    '#regexautomata .ra-pill-ok{background:rgba(52,211,153,.16);color:' + C.green + ';}',
    '#regexautomata .ra-pill-no{background:rgba(252,165,165,.14);color:' + C.red + ';}',
    '#regexautomata .ra-pill-warn{background:rgba(251,191,36,.14);color:' + C.amber + ';}',
    '#regexautomata .ra-limits{margin:0;padding:9px 12px;border:1px dashed ' + C.line + ';border-radius:9px;font-size:11px;line-height:1.7;color:' + C.faint + ';}',
    '#regexautomata .ra-limits b{color:' + C.dim + ';}'
  ].join('');

  /* ======================================================================== */
  /*  AST VIEW                                                                */
  /* ======================================================================== */

  function astNodeText(nd) {
    switch (nd.t) {
      case 'empty': return { op: 'empty', note: 'matches the empty string' };
      case 'set': return { op: 'match', lit: describeSet(nd.set), note: nd.src ? 'written ' + nd.src : '' };
      case 'anchor': return { op: 'anchor ' + nd.kind, note: nd.redundant ? 'compiles to ε — matching is full-string, so this is already implied' : 'compiles to an edge no symbol can take — it can never be satisfied here' };
      case 'cat': return { op: 'concat', note: nd.counted ? 'expanded from a counted repetition' : '' };
      case 'alt': return { op: 'alternate', note: '' };
      case 'star': return { op: 'star *', note: nd.lazy ? 'lazy — the automaton ignores this, the backtracker does not' : '' };
      case 'plus': return { op: 'plus +', note: nd.lazy ? 'lazy — same language, different search order' : '' };
      case 'opt': return { op: 'optional ?', note: nd.lazy ? 'lazy — same language, different search order' : '' };
      case 'group': return { op: nd.capturing ? 'group ' + nd.gi : 'group (?:', note: nd.capturing ? 'the capture is discarded: a DFA state cannot remember where a group started' : 'non-capturing' };
    }
    return { op: nd.t, note: '' };
  }

  function astTree(nd) {
    var li = E('li');
    var info = astNodeText(nd);
    var line = E('div');
    line.appendChild(E('span', 'ra-nodeop', info.op));
    if (info.lit) { line.appendChild(document.createTextNode(' ')); line.appendChild(E('span', 'ra-nodelit', info.lit)); }
    if (info.note) { line.appendChild(document.createTextNode('  ')); line.appendChild(E('span', 'ra-nodenote', info.note)); }
    li.appendChild(line);
    var kids = nd.kids || (nd.kid ? [nd.kid] : null);
    if (kids) {
      var ul = E('ul');
      for (var i = 0; i < kids.length; i++) ul.appendChild(astTree(kids[i]));
      li.appendChild(ul);
    }
    return li;
  }

  /* ======================================================================== */
  /*  MODEL                                                                   */
  /* ======================================================================== */

  function compileAll(pattern) {
    var model = { pattern: pattern, ok: false, warnings: [] };
    try {
      var p = parse(pattern);
      model.ast = p.ast;
      model.warnings = p.warnings;
      model.groups = p.groups;
      model.nfa = thompson(p.ast);
      model.alpha = buildAlphabet(model.nfa);
      model.dfa = subsetConstruct(model.nfa, model.alpha);
      if (!model.dfa.capped) model.min = minimise(model.dfa);
      model.ok = true;
    } catch (err) {
      if (err && err.ra) model.error = err;
      else model.error = { ra: true, kind: 'bug', message: 'Something went wrong building this pattern: ' + ((err && err.message) || String(err)), why: 'That is a bug in the lab rather than in your pattern. Please tell me the pattern you typed.' };
    }
    return model;
  }

  /* ======================================================================== */
  /*  THE APP                                                                 */
  /* ======================================================================== */

  var EXAMPLES = [
    '(a|b)*abb', 'a(b|c)*d', 'colou?r', '[a-z]+@[a-z]+\\.(com|org)',
    '^-?[0-9]+$', '(ab){2,3}', '(a+)+b', '\\d{3}-\\d{4}'
  ];
  var REFUSED = ['(a)\\1', 'a(?=b)', '(?<=a)b', '\\bword\\b'];

  var BLOWUP = [
    { p: '(a+)+b', label: '(a+)+b' },
    { p: '(a|a)+b', label: '(a|a)+b' },
    { p: '(a*)*b', label: '(a*)*b' },
    { p: '(a|aa)+b', label: '(a|aa)+b' },
    { p: 'a*b', label: 'a*b (well behaved, for contrast)' }
  ];

  function App(root) {
    this.root = root;
    this.pattern = '(a|b)*abb';
    this.test = 'abaabb';
    this.active = 0;
    this.stepPos = 0;
    this.blowIndex = 0;
    this.blowMax = 22;
    this.blowCap = 2000000;
    this.model = compileAll(this.pattern);
    this.build();
    this.select(0);
  }

  App.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'ra-wrap');

    var head = E('div', 'ra-head');
    var f1 = E('div', 'ra-fieldwrap');
    var l1 = E('label', 'ra-label', 'Pattern');
    l1.setAttribute('for', 'ra-pattern');
    this.patternInput = E('input', 'ra-input');
    this.patternInput.type = 'text';
    this.patternInput.id = 'ra-pattern';
    this.patternInput.value = this.pattern;
    this.patternInput.spellcheck = false;
    this.patternInput.setAttribute('autocomplete', 'off');
    this.patternInput.setAttribute('autocapitalize', 'off');
    this.patternInput.addEventListener('input', function () { self.setPattern(self.patternInput.value); });
    f1.appendChild(l1); f1.appendChild(this.patternInput);

    var f2 = E('div', 'ra-fieldwrap');
    var l2 = E('label', 'ra-label', 'Test string');
    l2.setAttribute('for', 'ra-test');
    this.testInput = E('input', 'ra-input');
    this.testInput.type = 'text';
    this.testInput.id = 'ra-test';
    this.testInput.value = this.test;
    this.testInput.spellcheck = false;
    this.testInput.setAttribute('autocomplete', 'off');
    this.testInput.setAttribute('autocapitalize', 'off');
    this.testInput.addEventListener('input', function () {
      self.test = self.testInput.value.slice(0, MAX_TEST);
      if (self.test !== self.testInput.value) self.testInput.value = self.test;
      self.stepPos = 0;
      self.redraw();
    });
    f2.appendChild(l2); f2.appendChild(this.testInput);

    head.appendChild(f1); head.appendChild(f2);
    wrap.appendChild(head);

    var ex = E('div', 'ra-exrow');
    ex.appendChild(E('span', 'ra-exlabel', 'Try:'));
    EXAMPLES.forEach(function (p) {
      ex.appendChild(button(p, function () { self.patternInput.value = p; self.setPattern(p); }));
    });
    ex.appendChild(E('span', 'ra-exlabel', 'Refused on purpose:'));
    REFUSED.forEach(function (p) {
      ex.appendChild(button(p, function () { self.patternInput.value = p; self.setPattern(p); }, 'ra-btn-bad'));
    });
    wrap.appendChild(ex);

    this.panelDefs = [
      { label: '1. Parse', render: function (c) { self.renderParse(c); } },
      { label: '2. NFA', render: function (c) { self.renderNfa(c); } },
      { label: '3. DFA', render: function (c) { self.renderDfa(c); } },
      { label: '4. Minimise', render: function (c) { self.renderMin(c); } },
      { label: '5. Step a string', render: function (c) { self.renderStep(c); } },
      { label: '6. The blowup', render: function (c) { self.renderBlowup(c); } }
    ];

    var tabs = E('div', 'ra-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Pipeline stages');
    this.tabs = this.panelDefs.map(function (panel, i) {
      var b = E('button', 'ra-tab', panel.label);
      b.type = 'button';
      b.id = 'ra-tab-' + i;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-controls', 'ra-panel');
      b.tabIndex = -1;
      b.addEventListener('click', function () { self.select(i); });
      b.addEventListener('keydown', function (e) {
        var d = 0;
        if (e.key === 'ArrowRight') d = 1;
        else if (e.key === 'ArrowLeft') d = -1;
        else if (e.key === 'Home') { e.preventDefault(); self.select(0); self.tabs[0].focus(); return; }
        else if (e.key === 'End') {
          e.preventDefault();
          var last = self.tabs.length - 1;
          self.select(last); self.tabs[last].focus(); return;
        }
        if (!d) return;
        e.preventDefault();
        var nx = (i + d + self.tabs.length) % self.tabs.length;
        self.select(nx); self.tabs[nx].focus();
      });
      tabs.appendChild(b);
      return b;
    });
    wrap.appendChild(tabs);

    this.body = E('div', 'ra-body');
    this.body.id = 'ra-panel';
    this.body.setAttribute('role', 'tabpanel');
    this.body.tabIndex = 0;
    wrap.appendChild(this.body);

    this.root.appendChild(wrap);
  };

  var MAX_TEST = 120;

  App.prototype.setPattern = function (p) {
    this.pattern = p;
    this.model = compileAll(p);
    this.stepPos = 0;
    this.redraw();
  };

  App.prototype.select = function (i) {
    this.active = i;
    for (var k = 0; k < this.tabs.length; k++) {
      var on = k === i;
      this.tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
      this.tabs[k].tabIndex = on ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', 'ra-tab-' + i);
    this.redraw();
  };

  App.prototype.redraw = function () {
    clear(this.body);
    var m = this.model;
    if (m.error) {
      this.renderError(this.body, m.error);
      if (this.active !== 5) { this.body.appendChild(this.limitsBox()); return; }
    }
    this.panelDefs[this.active].render(this.body);
    this.body.appendChild(this.limitsBox());
  };

  App.prototype.limitsBox = function () {
    var p = E('p', 'ra-limits');
    p.appendChild(E('b', null, 'Hard limits, stated rather than hidden: '));
    p.appendChild(document.createTextNode(
      'no backreferences and no lookaround (refused with the reason on tab 1); no word boundaries; ' +
      'every character above U+007F is folded into one catch-all symbol, so this machine cannot tell two non-ASCII characters apart; ' +
      'NFA construction stops at ' + MAX_NFA + ' states; subset construction stops at ' + MAX_DFA + ' DFA states and says so instead of hanging; ' +
      'a machine over ' + MAX_DRAW + ' states is tabulated instead of drawn; the test string is capped at ' + MAX_TEST + ' characters; ' +
      'counted repetition is capped at ' + MAX_COUNTED + '; the backtracker stops at its step ceiling and reports that it stopped. ' +
      'Matching is full-string throughout: this page answers "is this string in the language", not "where is the match".'
    ));
    return p;
  };

  App.prototype.renderError = function (c, err) {
    var box = E('div', 'ra-note ra-bad');
    box.appendChild(E('p', 'ra-title', err.message));
    box.appendChild(document.createTextNode(err.why));
    c.appendChild(box);
  };

  /* --- tab 1: parse ------------------------------------------------------- */
  App.prototype.renderParse = function (c) {
    var m = this.model;
    c.appendChild(note(
      'Stage one is an ordinary recursive-descent parser over concatenation, alternation, star, plus, optional, ' +
      'bracketed character sets with ranges and negation, the dot, anchors, escapes and counted repetition. ' +
      'It is also where the pipeline refuses things, and the refusals carry their reasons: press one of the red buttons above.'
    ));
    if (!m.ok) return;

    var warned = m.warnings;
    if (warned && warned.length) {
      for (var w = 0; w < warned.length; w++) c.appendChild(note(warned[w], 'warn'));
    }

    c.appendChild(heading('Syntax tree'));
    var ul = E('ul', 'ra-tree');
    ul.appendChild(astTree(m.ast));
    c.appendChild(ul);

    c.appendChild(heading('What the parser threw away'));
    var kept = [];
    kept.push(m.groups + ' capturing ' + (m.groups === 1 ? 'group' : 'groups') + ' parsed, ' +
      (m.groups ? 'and every one of them discarded' : 'so nothing to discard') +
      '. A DFA state is a single number. It has nowhere to record that group 2 started at position 4, which is why an automaton engine either gives up capture groups or bolts a second machine on beside the first.');
    kept.push('Greedy against lazy is recorded on the tree and then ignored by the compiler. Laziness picks between matches; it does not change which strings match, and the language is all an automaton has.');
    var ol = E('ul', 'ra-tree');
    for (var i = 0; i < kept.length; i++) {
      var li = E('li');
      li.appendChild(E('span', 'ra-nodenote', kept[i]));
      ol.appendChild(li);
    }
    c.appendChild(ol);

    c.appendChild(note(
      'The two refusals are not the same kind of refusal, and the page will not pretend they are. A backreference describes a ' +
      'language that is provably not regular, so no finite automaton of any size can recognise it — that is a fact about mathematics. ' +
      'A word boundary is regular and merely has no Thompson rule here — that is a fact about this program. Lookaround sits ' +
      'between the two. Every refusal message says which case it is.'
    ));
  };

  /* --- tab 2: NFA --------------------------------------------------------- */
  App.prototype.nfaGraphSpec = function (activeSet) {
    var nfa = this.model.nfa, nodes = [], edges = [], i, j;
    var on = {};
    if (activeSet) for (i = 0; i < activeSet.length; i++) on[activeSet[i]] = 1;
    for (i = 0; i < nfa.states.length; i++) {
      nodes.push({
        id: i, label: String(i),
        accepting: i === nfa.accept,
        active: !!on[i],
        title: 'NFA state ' + i + (i === nfa.start ? ' (start)' : '') + (i === nfa.accept ? ' (accepting)' : '')
      });
      var st = nfa.states[i];
      for (j = 0; j < st.eps.length; j++) edges.push({ from: i, to: st.eps[j], eps: true });
      for (j = 0; j < st.edges.length; j++) {
        edges.push({ from: i, to: st.edges[j].to, label: shorten(st.edges[j].label, 12) });
      }
    }
    return { nodes: nodes, edges: edges, start: nfa.start, label: 'Thompson NFA state diagram' };
  };

  App.prototype.renderNfa = function (c) {
    var m = this.model;
    if (!m.ok) return;
    var nfa = m.nfa;
    c.appendChild(note(
      'Thompson’s construction, one rule per operator. Each fragment has exactly one way in and one way out, which is what lets ' +
      'the rules be glued together without ever inspecting the fragment being glued. The dashed arrows are ε (epsilon) edges: ' +
      'they cost no input and they exist purely so the gluing works. That is why this machine has more states than one you would ' +
      'draw by hand — nobody draws it this way, and that is the point. It is mechanical.'
    ));
    c.appendChild(cards([
      { h: 'NFA states', v: num(nfa.states.length) },
      { h: 'Epsilon edges', v: num(nfa.epsCount), n: 'dashed, unlabelled, cost no input' },
      { h: 'Symbol edges', v: num(nfa.symCount), n: 'solid, labelled with the set they accept' },
      { h: 'Alphabet classes', v: num(m.alpha.classes.length), n: 'the 129 input symbols folded down by behaviour' }
    ]));

    var spec = this.nfaGraphSpec(null);
    c.appendChild(graphBox(
      graphSvg(spec),
      'This machine has ' + nfa.states.length + ' states, which is over the ' + MAX_DRAW + '-state drawing cap. The table below still holds every transition.',
      ['Dashed arrow with ε = free move, consumes nothing', 'Solid arrow = consumes one character from the set on it', 'Double ring = accepting state', 'SP in a set means the space character']
    ));

    c.appendChild(heading('Transition table'));
    var rows = [];
    for (var i = 0; i < nfa.states.length; i++) {
      var st = nfa.states[i], parts = [];
      for (var j = 0; j < st.edges.length; j++) parts.push(st.edges[j].label + ' → ' + st.edges[j].to);
      rows.push([
        String(i),
        i === nfa.start ? 'start' : (i === nfa.accept ? 'accepting' : ''),
        st.eps.length ? st.eps.join(', ') : '—',
        parts.length ? parts.join('   ') : '—'
      ]);
    }
    c.appendChild(table(['State', 'Role', 'ε to', 'On input'], rows));

    c.appendChild(heading('Alphabet folding'));
    c.appendChild(E('p', 'ra-sub',
      'Before the DFA can be built the input alphabet has to be finite and small. Two characters that appear in exactly the same ' +
      'character sets can never send the machine anywhere different, so they share a column. Here that folds 129 symbols (128 ASCII ' +
      'codes plus one catch-all for everything above U+007F) into ' + m.alpha.classes.length + '.'));
    var crows = [];
    for (var k = 0; k < m.alpha.classes.length; k++) {
      var cl = m.alpha.classes[k];
      crows.push(['c' + k, cl.label, num(cl.syms.length), cl.dead ? 'in no set in this pattern — always leads to the trap' : '']);
    }
    c.appendChild(table(['Class', 'Characters', 'Count', 'Note'], crows));
  };

  /* --- tab 3: DFA --------------------------------------------------------- */
  App.prototype.dfaGraphSpec = function (activeId, useMin) {
    var m = this.model;
    var d = useMin ? m.min : m.dfa;
    var nodes = [], edges = [], i, c;
    for (i = 0; i < d.states.length; i++) {
      var st = d.states[i];
      nodes.push({
        id: i,
        label: (useMin ? 'M' : 'D') + i,
        sub: useMin ? ('D' + st.from.join('+D')) : ('{' + st.subset.join(',') + '}'),
        accepting: st.accepting,
        trap: st.trap,
        active: activeId === i,
        title: useMin
          ? 'Minimal state M' + i + ' merges DFA states ' + st.from.join(', ')
          : 'DFA state D' + i + ' is the NFA subset {' + st.subset.join(',') + '}'
      });
      for (c = 0; c < d.classes.length; c++) {
        if (st.trans[c] == null) continue;
        edges.push({ from: i, to: st.trans[c], label: d.classes[c].short });
      }
    }
    return { nodes: nodes, edges: edges, start: d.start, label: useMin ? 'Minimal DFA state diagram' : 'DFA state diagram' };
  };

  App.prototype.renderDfa = function (c) {
    var m = this.model;
    if (!m.ok) return;
    var d = m.dfa;
    c.appendChild(note(
      'Subset construction. Every DFA state here IS a set of NFA states — the set the NFA could be in after reading the same input — ' +
      'and the table prints that set next to every state so it is not something you have to take on trust. That single sentence is the ' +
      'whole of the construction: run the NFA in parallel down every branch at once, and call the collection of branches a state.'
    ));
    if (d.capped) {
      c.appendChild(note(
        'Subset construction hit the ' + MAX_DFA + '-state cap on this pattern and was stopped. Nothing below this line is a complete ' +
        'machine, and minimisation and stepping are switched off for it. This is not a bug: the number of subsets of an n-state NFA is ' +
        '2 to the n, and there are patterns whose smallest DFA really is exponentially larger than the NFA. Capping and saying so beats ' +
        'freezing the tab, which is what an uncapped version would do.', 'bad'));
      return;
    }
    var trapCount = 0;
    for (var t = 0; t < d.states.length; t++) if (d.states[t].trap) trapCount++;
    c.appendChild(cards([
      { h: 'DFA states', v: num(d.states.length), n: 'from ' + num(m.nfa.states.length) + ' NFA states' },
      { h: 'Input classes', v: num(d.classes.length) },
      { h: 'Table cells built', v: num(d.states.length * d.classes.length) },
      { h: 'Construction work', v: num(d.work), n: 'edge and epsilon visits counted during the build' }
    ]));

    c.appendChild(graphBox(
      graphSvg(this.dfaGraphSpec(-1, false)),
      'This DFA has ' + d.states.length + ' states, over the ' + MAX_DRAW + '-state drawing cap. The table below is complete.',
      ['Every arrow consumes exactly one character', 'Double ring = accepting', 'Red ring = the trap: the empty subset, which nothing escapes', 'The small text under each state is the NFA subset it stands for']
    ));

    c.appendChild(heading('State to subset, which is the entire insight'));
    var headers = ['DFA', 'NFA subset', 'Accepting'];
    for (var k = 0; k < d.classes.length; k++) headers.push('on ' + d.classes[k].short);
    var rows = [];
    for (var i = 0; i < d.states.length; i++) {
      var st = d.states[i];
      var row = ['D' + i, '{' + st.subset.join(',') + '}' + (st.trap ? '  (trap)' : ''), st.accepting ? 'yes' : 'no'];
      for (k = 0; k < d.classes.length; k++) row.push(st.trans[k] == null ? '—' : 'D' + st.trans[k]);
      rows.push(row);
    }
    c.appendChild(table(headers, rows, function (r) { return d.states[r].trap ? 'ra-row-trap' : ''; }));
    c.appendChild(E('p', 'ra-sub',
      'The trap state is the empty subset, and it is drawn rather than hidden. A DFA with missing transitions is a partial function, ' +
      'and minimisation in the next tab needs a total one, so the empty set earns a state like any other set does. ' +
      (trapCount ? 'This machine has one.' : 'This machine does not need one — every subset reachable here is non-empty.')));
  };

  /* --- tab 4: minimisation ------------------------------------------------ */
  App.prototype.renderMin = function (c) {
    var m = this.model;
    if (!m.ok) return;
    if (m.dfa.capped || !m.min) {
      c.appendChild(note('Minimisation is switched off because subset construction hit its cap for this pattern. There is no complete DFA to minimise.', 'bad'));
      return;
    }
    var mn = m.min;
    c.appendChild(note(
      'Moore’s algorithm, not Hopcroft’s, and the choice is deliberate. Hopcroft is faster — n log n against Moore’s n squared times the ' +
      'alphabet — and for a production tool it is the right one. Moore refines in visible rounds: give every state a signature made of ' +
      'the blocks its transitions land in, keep states with matching signatures together, repeat until nothing moves. The round in which ' +
      'two states come apart names the character that separated them, and that is what this tab is for. Hopcroft’s worklist order is ' +
      'efficient and impossible to narrate.'
    ));
    c.appendChild(cards([
      { h: 'DFA states', v: num(m.dfa.states.length) },
      { h: 'Minimal states', v: num(mn.states.length), tone: mn.states.length < m.dfa.states.length ? 'good' : '' },
      { h: 'States removed', v: num(m.dfa.states.length - mn.states.length), n: mn.merged.length ? 'by merging, listed below' : 'the DFA was already minimal' },
      { h: 'Refinement rounds', v: num(mn.rounds.length - 1), n: 'plus the final round that changed nothing' }
    ]));

    c.appendChild(heading('Round by round'));
    for (var r = 0; r < mn.rounds.length; r++) {
      var rd = mn.rounds[r];
      var box = E('div', 'ra-note' + (rd.stable ? ' ra-good' : ''));
      box.appendChild(E('p', 'ra-title', 'Round ' + rd.round + ' — ' + rd.count + ' ' + (rd.count === 1 ? 'block' : 'blocks')));
      box.appendChild(document.createTextNode(rd.why));
      var list = E('ul', 'ra-tree');
      for (var b = 0; b < rd.members.length; b++) {
        var li = E('li');
        li.appendChild(E('span', 'ra-nodelit', 'B' + b));
        li.appendChild(document.createTextNode(' = {' + rd.members[b].map(function (x) { return 'D' + x; }).join(', ') + '}'));
        list.appendChild(li);
      }
      box.appendChild(list);
      if (rd.splits && rd.splits.length) {
        var sl = E('ul', 'ra-tree');
        for (var s = 0; s < rd.splits.length; s++) {
          var sp = rd.splits[s];
          var wl = sp.witness >= 0 ? mn.classes[sp.witness].label : 'some input';
          var li2 = E('li');
          var txt = 'The old block B' + sp.oldBlock + ' came apart on ' + wl + ': ';
          var bits = [];
          for (var q = 0; q < sp.parts.length; q++) {
            bits.push('{' + sp.parts[q].states.map(function (x) { return 'D' + x; }).join(', ') + '} went to B' +
              (sp.parts[q].target >= 0 ? sp.parts[q].target : '?'));
          }
          li2.appendChild(E('span', 'ra-nodenote', txt + bits.join(', and ') + '. Two states that disagree about where one character takes them cannot be the same state.'));
          sl.appendChild(li2);
        }
        box.appendChild(sl);
      }
      c.appendChild(box);
    }

    c.appendChild(heading('What merged, and why it was safe'));
    if (!mn.merged.length) {
      c.appendChild(E('p', 'ra-sub', 'Nothing merged. Subset construction happened to produce a machine that was already minimal for this pattern, which is common for small patterns and not something to read anything into.'));
    } else {
      var mrows = [];
      for (var i = 0; i < mn.merged.length; i++) {
        var g = mn.merged[i];
        mrows.push([
          'M' + g.block,
          g.states.map(function (x) { return 'D' + x; }).join(' + '),
          m.dfa.states[g.states[0]].accepting ? 'accepting' : 'rejecting',
          'no input string separates them'
        ]);
      }
      c.appendChild(table(['Minimal state', 'Merged DFA states', 'Kind', 'Reason'], mrows, function () { return 'ra-row-merge'; }));
      c.appendChild(E('p', 'ra-sub',
        'The refinement above is a proof, not an assertion: two states are separated the moment some character sends them into different ' +
        'blocks, and the loop only stops when no character separates anything. Anything still sharing a block at the end therefore agrees ' +
        'on every string, forever, so replacing the group with one state cannot change the language.'));
    }

    c.appendChild(heading('Minimal machine'));
    c.appendChild(graphBox(
      graphSvg(this.dfaGraphSpec(-1, true)),
      'The minimal DFA still has ' + mn.states.length + ' states, over the drawing cap.',
      ['Small text under a state names the DFA states it merges', 'Double ring = accepting', 'Red ring = trap']
    ));
    c.appendChild(E('p', 'ra-sub',
      'Minimisation normally has two halves: throw away states nothing can reach, then merge states nothing can tell apart. ' +
      'The first half came free — subset construction only ever creates a state by reaching it — so only the second half runs here. ' +
      'The result is unique: for a given language there is exactly one minimal DFA, up to renaming the states.'));
  };

  /* --- tab 5: stepping ---------------------------------------------------- */
  App.prototype.trace = function () {
    var m = this.model;
    var nfa = m.nfa, d = m.dfa, alpha = m.alpha;
    var out = [];
    var counter = { steps: 0 };
    var set = closure(nfa, [nfa.start], counter);
    var dstate = d.start;
    out.push({ pos: 0, set: set, dfa: dstate, cls: -1 });
    for (var i = 0; i < this.test.length; i++) {
      var ci = alpha.classOf[symOf(this.test, i)];
      set = closure(nfa, moveOn(nfa, set, alpha.classes[ci], counter), counter);
      dstate = d.states[dstate].trans[ci];
      out.push({ pos: i + 1, set: set, dfa: dstate, cls: ci });
    }
    return out;
  };

  App.prototype.renderStep = function (c) {
    var self = this, m = this.model;
    if (!m.ok) return;
    if (m.dfa.capped) {
      c.appendChild(note('Stepping is switched off because subset construction hit its cap for this pattern, so there is no DFA to step through.', 'bad'));
      return;
    }
    c.appendChild(note(
      'One character at a time, through both machines at once. The NFA is simulated the way Thompson’s paper says: not by guessing a ' +
      'branch, but by keeping the whole set of states it could be in. The DFA is simulated with one table lookup. Watch the two lines: ' +
      'the NFA’s live set and the DFA state’s subset are the same set at every position, and they are the same set because subset ' +
      'construction built the DFA state out of exactly that set in the first place. Below the check is computed, not claimed.'
    ));

    var tr = this.trace();
    if (this.stepPos > tr.length - 1) this.stepPos = tr.length - 1;
    if (this.stepPos < 0) this.stepPos = 0;
    var cur = tr[this.stepPos];

    var controls = E('div', 'ra-btnrow');
    controls.appendChild(button('⏮ Reset', function () { self.stepPos = 0; self.redraw(); }));
    var back = button('◀ Back', function () { self.stepPos--; self.redraw(); });
    back.disabled = this.stepPos === 0;
    back.setAttribute('aria-label', 'Step back one character');
    controls.appendChild(back);
    var fwd = button('Forward ▶', function () { self.stepPos++; self.redraw(); });
    fwd.disabled = this.stepPos >= tr.length - 1;
    fwd.setAttribute('aria-label', 'Step forward one character');
    controls.appendChild(fwd);
    controls.appendChild(button('⏭ To the end', function () { self.stepPos = tr.length - 1; self.redraw(); }));
    c.appendChild(controls);

    var tape = E('div', 'ra-tape');
    for (var i = 0; i < this.test.length; i++) {
      var cell = E('div', 'ra-cell' + (i < this.stepPos ? ' ra-cell-done' : (i === this.stepPos ? ' ra-cell-next' : '')),
        this.test.charAt(i) === ' ' ? 'SP' : this.test.charAt(i));
      tape.appendChild(cell);
    }
    if (!this.test.length) tape.appendChild(E('p', 'ra-sub', 'The test string is empty, so there is only position 0.'));
    c.appendChild(tape);

    var dst = m.dfa.states[cur.dfa];
    var setText = '{' + cur.set.join(', ') + '}';
    var subText = '{' + dst.subset.join(', ') + '}';
    var same = setText === subText;
    var minState = m.min ? m.min.blockOf[cur.dfa] : null;

    var status = E('p', 'ra-note' + (same ? '' : ' ra-bad'));
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent =
      'Position ' + this.stepPos + ' of ' + (tr.length - 1) + '. ' +
      (cur.cls >= 0 ? 'Just read ' + (this.test.charAt(this.stepPos - 1) === ' ' ? 'a space' : '"' + this.test.charAt(this.stepPos - 1) + '"') +
        ', which falls in the column labelled ' + m.dfa.classes[cur.cls].label + '. ' : 'Nothing read yet. ') +
      'NFA live set ' + setText + '. DFA state D' + cur.dfa + ', whose subset is ' + subText + '. ' +
      (same ? 'Identical, as they must be.' : 'These differ, which would be a bug in this lab — please report it.') +
      (minState != null ? ' Minimal state M' + minState + '.' : '') +
      ' ' + (this.stepPos === tr.length - 1
        ? (dst.accepting ? 'The whole string was consumed and the machine is in an accepting state: it matches.'
                         : 'The whole string was consumed and the machine is not accepting: it does not match.')
        : 'Not finished yet.');
    c.appendChild(status);

    c.appendChild(cards([
      { h: 'NFA live states', v: setText, n: 'the set of states Thompson’s machine could be in' },
      { h: 'DFA state', v: 'D' + cur.dfa + (dst.trap ? ' (trap)' : ''), n: 'one number, one table lookup per character' },
      { h: 'Same set?', v: same ? 'yes' : 'no', tone: same ? 'good' : 'bad', n: 'checked at every position, not assumed' },
      { h: 'Minimal state', v: minState != null ? 'M' + minState : 'n/a', n: minState != null ? 'after merging indistinguishable states' : 'minimisation unavailable' }
    ]));

    var allSame = true;
    for (var q = 0; q < tr.length; q++) {
      if (tr[q].set.join(',') !== m.dfa.states[tr[q].dfa].subset.join(',')) allSame = false;
    }
    c.appendChild(E('p', 'ra-sub',
      'Checked across all ' + tr.length + ' positions of this run: the NFA live set and the DFA state’s subset were ' +
      (allSame ? 'identical every time.' : 'NOT identical somewhere, which is a bug — please tell me the pattern and string.')));

    c.appendChild(heading('NFA, with the live set highlighted'));
    c.appendChild(graphBox(
      graphSvg(this.nfaGraphSpec(cur.set)),
      'Over the drawing cap; the live set is ' + setText + '.',
      ['Amber, thick ring = currently live. The set is also written out in the status line above.', 'Dashed = ε']
    ));

    c.appendChild(heading('DFA, with the current state highlighted'));
    c.appendChild(graphBox(
      graphSvg(this.dfaGraphSpec(cur.dfa, false)),
      'Over the drawing cap; the current state is D' + cur.dfa + '.',
      ['Amber, thick ring = current state, also named in the status line', 'Double ring = accepting']
    ));
  };

  /* --- tab 6: the blowup -------------------------------------------------- */
  App.prototype.renderBlowup = function (c) {
    var self = this;
    c.appendChild(note(
      'This is the tab the rest of the lab exists for. Two engines, the same pattern, the same inputs, both counting their own steps. ' +
      'The backtracker explores one path at a time and undoes it when it fails. The DFA does one table lookup per character and then ' +
      'stops. Neither number below is a formula: both are counters incremented inside the matching loops on this page.'
    ));

    var row = E('div', 'ra-two');

    var box1 = E('div');
    var lab1 = E('label', 'ra-field-label', 'Pattern to torture');
    lab1.setAttribute('for', 'ra-blowpat');
    var sel = E('select', 'ra-select');
    sel.id = 'ra-blowpat';
    BLOWUP.forEach(function (b, i) {
      var o = E('option', null, b.label);
      o.value = String(i);
      sel.appendChild(o);
    });
    var own = E('option', null, 'the pattern in the box at the top');
    own.value = 'own';
    sel.appendChild(own);
    sel.value = String(this.blowIndex);
    sel.addEventListener('change', function () {
      self.blowIndex = sel.value === 'own' ? 'own' : parseInt(sel.value, 10);
      self.redraw();
    });
    var f1 = E('div', 'ra-field');
    f1.appendChild(lab1); f1.appendChild(sel);
    box1.appendChild(f1);

    var lab2 = E('label', 'ra-field-label', 'Longest input: ' + this.blowMax + ' characters');
    lab2.setAttribute('for', 'ra-blowmax');
    var rng = E('input', 'ra-range');
    rng.type = 'range'; rng.id = 'ra-blowmax';
    rng.min = '4'; rng.max = '34'; rng.step = '1'; rng.value = String(this.blowMax);
    rng.addEventListener('change', function () { self.blowMax = parseInt(rng.value, 10); self.redraw(); });
    box1.appendChild(lab2); box1.appendChild(rng);

    var lab3 = E('label', 'ra-field-label', 'Backtracker step ceiling');
    lab3.setAttribute('for', 'ra-blowcap');
    var cap = E('select', 'ra-select');
    cap.id = 'ra-blowcap';
    [100000, 500000, 2000000, 8000000].forEach(function (v) {
      var o = E('option', null, num(v) + ' steps');
      o.value = String(v);
      cap.appendChild(o);
    });
    cap.value = String(this.blowCap);
    cap.addEventListener('change', function () { self.blowCap = parseInt(cap.value, 10); self.redraw(); });
    var f3 = E('div', 'ra-field');
    f3.appendChild(lab3); f3.appendChild(cap);
    box1.appendChild(f3);
    box1.appendChild(E('p', 'ra-sub',
      'The input is the letter a repeated, with no b on the end, so the pattern very nearly matches and the backtracker has to ' +
      'exhaust every way of splitting the a run before it can say no. That near-miss is the whole trick behind a ReDoS payload.'));
    row.appendChild(box1);

    var pat = this.blowIndex === 'own' ? this.pattern : BLOWUP[this.blowIndex].p;
    var bm = compileAll(pat);
    var box2 = E('div');
    if (!bm.ok) {
      box2.appendChild(note('That pattern does not compile: ' + bm.error.message, 'bad'));
      row.appendChild(box2);
      c.appendChild(row);
      return;
    }
    box2.appendChild(heading('One-time cost of the automaton route'));
    box2.appendChild(cards([
      { h: 'NFA states', v: num(bm.nfa.states.length) },
      { h: 'DFA states', v: bm.dfa.capped ? 'capped' : num(bm.dfa.states.length), tone: bm.dfa.capped ? 'bad' : '' },
      { h: 'Build work', v: num(bm.dfa.work), n: 'counted during subset construction, paid once' }
    ]));
    box2.appendChild(E('p', 'ra-sub',
      'The DFA is linear per match, but building it is not free and in the worst case it is exponential in the pattern. That is why ' +
      'RE2 builds the DFA lazily, caches it, and falls back to the NFA set simulation when the cache would grow too large. The third ' +
      'line on the plot is that fallback.'));
    row.appendChild(box2);
    c.appendChild(row);

    if (bm.dfa.capped) {
      c.appendChild(note('Subset construction hit the ' + MAX_DFA + '-state cap for this pattern, so there is no DFA to race. Pick another pattern.', 'bad'));
      return;
    }

    /* Run both engines for real, at every length. */
    var data = [], anyCapped = false, anyDeep = false;
    for (var n = 1; n <= this.blowMax; n++) {
      var input = rep('a', n);
      var bt = backtrack(bm.ast, input, this.blowCap);
      var df = runDfa(bm.dfa, input);
      var ns = runNfaSet(bm.nfa, bm.alpha, input);
      if (bt.capped) anyCapped = true;
      if (bt.deep) anyDeep = true;
      data.push({ n: n, bt: bt.steps, btCapped: bt.capped, dfa: df.steps, nfa: ns.steps, accept: df.accept, btAccept: bt.accept });
    }

    var last = data[data.length - 1];
    c.appendChild(cards([
      { h: 'At ' + last.n + ' characters', v: num(last.bt) + (last.btCapped ? '+' : ''), tone: 'bad', n: 'backtracker steps' + (last.btCapped ? ', stopped at the ceiling' : '') },
      { h: 'At ' + last.n + ' characters', v: num(last.dfa), tone: 'good', n: 'DFA steps: exactly one per character' },
      { h: 'At ' + last.n + ' characters', v: num(last.nfa), n: 'NFA set simulation steps: linear in input times machine' },
      { h: 'Ratio', v: last.dfa ? num(Math.round(last.bt / last.dfa)) + '×' : '—', tone: 'bad', n: 'backtracker steps per DFA step, at this length' }
    ]));

    c.appendChild(this.plot(data));

    c.appendChild(heading('The measured numbers'));
    var rows = [];
    for (var i = 0; i < data.length; i++) {
      rows.push([
        String(data[i].n),
        num(data[i].bt) + (data[i].btCapped ? ' (capped)' : ''),
        num(data[i].dfa),
        num(data[i].nfa),
        data[i].accept ? 'match' : 'no match'
      ]);
    }
    c.appendChild(table(['Input length', 'Backtracker steps', 'DFA steps', 'NFA set steps', 'Result'], rows,
      function (r) { return data[r].btCapped ? 'ra-row-trap' : ''; }));

    if (anyCapped) {
      c.appendChild(note(
        'The rows marked capped hit the ' + num(this.blowCap) + '-step ceiling and were stopped there. The real count is larger — ' +
        'often very much larger — and this page will not print a number it did not count. That ceiling is also the only reason this ' +
        'tab does not freeze your browser, which is exactly what the same pattern does to a server that has no ceiling.', 'warn'));
    }
    if (anyDeep) {
      c.appendChild(note('At least one run ran out of call stack rather than steps. The backtracker here is recursive, like most real ones, and deep recursion is its other failure mode.', 'warn'));
    }

    c.appendChild(note(
      'Why the DFA line is flat: a DFA in state q reading character x moves to exactly one state. There is no choice to make, so there ' +
      'is nothing to undo, so the cost is one step per character no matter how baroque the pattern was. The backtracker has choices, and ' +
      'on a near-miss input it must try all of them before it can say no. For (a+)+b that is every way of cutting a run of a characters ' +
      'into groups, and the count of those grows exponentially. This is ReDoS: a denial of service where the payload is forty bytes of ' +
      'text and the vulnerable code is one line of pattern that passed review.', 'warn'));

    c.appendChild(note(
      'This is why RE2, Go’s regexp package and rust’s regex crate are linear in the input and why JavaScript, Python, Java, PCRE ' +
      'and almost every other engine are not. It is a deliberate trade, and the other half of the trade is the refusal on tab 1: the ' +
      'linear engines have no backreferences and no arbitrary lookaround, because a machine that promises one step per character cannot ' +
      'also promise to remember what group 2 matched. The same fact arrives twice — once as a parser error, once as a flat line — and ' +
      'it is the same fact both times.', 'good'));
  };

  /* Log-scale step plot, drawn by hand. Log because a linear axis at these
     ratios draws the DFA line flat on the floor and tells you nothing; the
     axis labels say so, and the exact numbers are in the table above it. */
  App.prototype.plot = function (data) {
    var W = 760, H = 330, L = 62, R = 16, T = 22, B = 42;
    var maxSteps = 10;
    for (var i = 0; i < data.length; i++) {
      if (data[i].bt > maxSteps) maxSteps = data[i].bt;
      if (data[i].nfa > maxSteps) maxSteps = data[i].nfa;
    }
    var decades = Math.ceil(Math.log(maxSteps) / Math.LN10);
    if (decades < 1) decades = 1;
    var maxN = data[data.length - 1].n;

    function px(n) { return L + (maxN <= 1 ? 0 : (n - 1) / (maxN - 1)) * (W - L - R); }
    function py(v) {
      var lg = Math.log(Math.max(1, v)) / Math.LN10;
      return H - B - (lg / decades) * (H - B - T);
    }

    var svg = S('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
      'aria-label': 'Steps taken against input length, on a logarithmic scale. The backtracking line climbs steeply while the DFA line stays flat at one step per character.'
    });
    svg.setAttribute('class', 'ra-plot');

    var d;
    for (d = 0; d <= decades; d++) {
      var y = py(Math.pow(10, d));
      svg.appendChild(S('line', { x1: L, y1: y, x2: W - R, y2: y, stroke: C.line, 'stroke-width': 1 }));
      var lt = S('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: C.faint, 'font-family': FONT });
      lt.textContent = d === 0 ? '1' : (d < 3 ? String(Math.pow(10, d)) : (d < 6 ? Math.pow(10, d - 3) + 'k' : Math.pow(10, d - 6) + 'M'));
      svg.appendChild(lt);
    }
    svg.appendChild(S('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: C.faint, 'stroke-width': 1 }));

    var step = Math.max(1, Math.round(maxN / 10));
    for (var n = 1; n <= maxN; n += step) {
      var xt = S('text', { x: px(n), y: H - B + 16, 'text-anchor': 'middle', 'font-size': 10, fill: C.faint, 'font-family': FONT });
      xt.textContent = String(n);
      svg.appendChild(xt);
    }
    var xl = S('text', { x: (L + W - R) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: C.dim, 'font-family': FONT });
    xl.textContent = 'input length, characters';
    svg.appendChild(xl);
    var yl = S('text', { x: L, y: 13, 'font-size': 11, fill: C.dim, 'font-family': FONT });
    yl.textContent = 'steps (log scale)';
    svg.appendChild(yl);

    function line(key, colour, dash) {
      var pts = [];
      for (var i = 0; i < data.length; i++) pts.push(px(data[i].n).toFixed(1) + ',' + py(data[i][key]).toFixed(1));
      svg.appendChild(S('polyline', {
        points: pts.join(' '), fill: 'none', stroke: colour, 'stroke-width': 2, 'stroke-dasharray': dash
      }));
    }
    line('nfa', C.violet, '5 4');
    line('dfa', C.green, '0');
    line('bt', C.red, '0');

    for (var k = 0; k < data.length; k++) {
      if (!data[k].btCapped) continue;
      svg.appendChild(S('rect', {
        x: px(data[k].n) - 3.5, y: py(data[k].bt) - 3.5, width: 7, height: 7,
        fill: C.bg0, stroke: C.red, 'stroke-width': 1.6
      }));
    }

    var box = E('div');
    var wrap = E('div', 'ra-graphwrap');
    wrap.appendChild(svg);
    box.appendChild(wrap);
    var legend = E('div', 'ra-legend');
    legend.appendChild(E('span', null, 'Solid steep line (red): backtracking matcher'));
    legend.appendChild(E('span', null, 'Solid flat line (green): DFA, one step per character'));
    legend.appendChild(E('span', null, 'Dashed line (violet): NFA set simulation'));
    legend.appendChild(E('span', null, 'Hollow square: the backtracker was stopped at the ceiling, so its true value is higher'));
    legend.appendChild(E('span', null, 'Vertical axis is logarithmic; the exact counts are in the table below'));
    box.appendChild(legend);
    return box;
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var app = null, built = false;

  function boot() {
    if (built) return;
    var rootEl = document.getElementById('regexautomata');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-regexautomata-mount') || rootEl;
    clear(mount);
    try {
      app = new App(mount);
      if (window.KSLab && window.KSLab.used) window.KSLab.used('run');
    } catch (err) {
      clear(mount);
      mount.appendChild(E('p', 'lab-viz-error',
        'This lab could not start in your browser: ' + ((err && err.message) || String(err)) +
        ' — the write-up below still explains what it would have shown. ' +
        'Please tell me, and mention which browser you are using.'));
    }
  }

  function rerun() {
    if (app) app.setPattern(app.patternInput.value);
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'regexautomata', onReady: boot, run: rerun });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

/* ==========================================================================
   regex-engine.js — a regular expression engine you can watch run, and watch
   catastrophically fail.
   --------------------------------------------------------------------------
   There is already a regex tester in Labs: type a pattern, type a string, see
   the matches. It is useful and it explains nothing. This page is the machine
   underneath — the parse tree, the state machine Thompson's construction
   builds from it, the deterministic machine subset construction turns that
   into, and the backtracking search that almost every real engine actually
   uses instead.

   The last family is the reason the lab exists. A backtracking engine given
   a pattern like (a+)+ and a string that nearly matches does not run in
   linear time or quadratic time; it runs in exponential time, and thirty
   characters of input can hang a thread for longer than the universe has
   existed. That is ReDoS, it is a real and common denial-of-service bug, and
   it stops being folklore the moment you watch the step counter double for
   every character you add.

   Design decisions worth spelling out:

   1. Full-match semantics, always. The engine asks "does this pattern match
      the entire string", not "is there a match somewhere in it". Partial
      matching drags in leftmost-longest rules, capture-group semantics and
      anchoring behaviour that differ between engines and would bury the
      lesson. Full match is unambiguous, and it is what the tests compare
      against JavaScript's own RegExp wrapped in ^(?:...)$.

   2. Two engines, deliberately. The NFA simulation tracks a SET of states and
      is linear in the input; the backtracker explores one path at a time and
      is exponential in the worst case. Both are correct — they always agree
      on the answer, which the tests check exhaustively — and they differ only
      in cost. Showing them side by side is the whole argument for why
      RE2-style engines exist.

   3. A step ceiling, not a hung tab. The backtracker counts every step and
      gives up at a limit rather than freezing the page. Hitting that ceiling
      is not an error, it is the finding: the page reports how far it got and
      what that implies for a server running the same pattern on user input.

   Nothing here opens a network connection, and nothing is passed to the
   built-in RegExp constructor — this is a real parser, not a wrapper.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  var STEP_LIMIT = 2000000;    // the backtracker gives up rather than hang
  var MAX_STATES = 4000;

  /* ======================================================================== */
  /*  CORE 1 — PARSER                                                         */
  /* ------------------------------------------------------------------------ */
  /*  Recursive descent over the classic grammar:                             */
  /*    alt    := concat ('|' concat)*                                        */
  /*    concat := repeat*                                                     */
  /*    repeat := atom ('*' | '+' | '?')*                                     */
  /*    atom   := char | '.' | '[' class ']' | '(' alt ')'                    */
  /*  Small enough to read in one sitting, which is the point.                */
  /* ======================================================================== */

  function parse(pattern) {
    var pos = 0;
    var groupCount = 0;

    function peek() { return pos < pattern.length ? pattern.charAt(pos) : null; }
    function eat(c) {
      if (peek() !== c) throw new Error('expected ' + c + ' at position ' + pos);
      pos++;
      return c;
    }
    function fail(msg) { throw new Error(msg + ' at position ' + pos); }

    function parseAlt() {
      var options = [parseConcat()];
      while (peek() === '|') {
        pos++;
        options.push(parseConcat());
      }
      return options.length === 1 ? options[0] : { type: 'alt', options: options };
    }

    function parseConcat() {
      var parts = [];
      while (pos < pattern.length && peek() !== '|' && peek() !== ')') {
        parts.push(parseRepeat());
      }
      if (!parts.length) return { type: 'empty' };
      return parts.length === 1 ? parts[0] : { type: 'concat', parts: parts };
    }

    function parseRepeat() {
      var node = parseAtom();
      for (;;) {
        var c = peek();
        if (c === '*') { pos++; node = { type: 'star', node: node }; }
        else if (c === '+') { pos++; node = { type: 'plus', node: node }; }
        else if (c === '?') { pos++; node = { type: 'opt', node: node }; }
        else break;
        // A quantifier applied to something that can match nothing — (a*)* —
        // is the classic way to build an infinite loop in a naive engine. It
        // is legal, so it is accepted, but flagged for the ReDoS panel.
      }
      return node;
    }

    function parseAtom() {
      var c = peek();
      if (c === null) fail('unexpected end of pattern');
      if (c === '(') {
        pos++;
        groupCount++;
        var index = groupCount;
        var inner = parseAlt();
        if (peek() !== ')') fail('unclosed group');
        eat(')');
        return { type: 'group', node: inner, index: index };
      }
      if (c === '[') return parseClass();
      if (c === '.') { pos++; return { type: 'any' }; }
      if (c === '\\') {
        pos++;
        var e = peek();
        if (e === null) fail('trailing backslash');
        pos++;
        if (e === 'd') return { type: 'class', ranges: [['0', '9']], neg: false, src: '\\d' };
        if (e === 'w') return { type: 'class', neg: false, src: '\\w',
                                ranges: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']] };
        if (e === 's') return { type: 'class', neg: false, src: '\\s',
                                ranges: [[' ', ' '], ['\t', '\t'], ['\n', '\n']] };
        return { type: 'char', c: e };
      }
      if (c === ')' || c === '*' || c === '+' || c === '?' || c === '|') {
        fail('unexpected ' + c);
      }
      pos++;
      return { type: 'char', c: c };
    }

    function parseClass() {
      eat('[');
      var neg = false;
      if (peek() === '^') { pos++; neg = true; }
      var ranges = [];
      var first = true;
      while (pos < pattern.length && (peek() !== ']' || first)) {
        first = false;
        var lo = peek();
        if (lo === '\\') { pos++; lo = peek(); }
        if (lo === null) fail('unclosed character class');
        pos++;
        if (peek() === '-' && pos + 1 < pattern.length && pattern.charAt(pos + 1) !== ']') {
          pos++;
          var hi = peek();
          if (hi === '\\') { pos++; hi = peek(); }
          pos++;
          ranges.push([lo, hi]);
        } else {
          ranges.push([lo, lo]);
        }
      }
      if (peek() !== ']') fail('unclosed character class');
      eat(']');
      return { type: 'class', ranges: ranges, neg: neg };
    }

    var ast = parseAlt();
    if (pos !== pattern.length) fail('unexpected ' + peek());
    return { ast: ast, groups: groupCount };
  }

  function classMatches(node, ch) {
    var hit = false;
    for (var i = 0; i < node.ranges.length; i++) {
      if (ch >= node.ranges[i][0] && ch <= node.ranges[i][1]) { hit = true; break; }
    }
    return node.neg ? !hit : hit;
  }

  /* Render an AST back to a readable tree, for the parse family. */
  function astLines(node, depth, out, label) {
    out = out || [];
    depth = depth || 0;
    var d = { depth: depth, label: label || '' };
    switch (node.type) {
      case 'char': d.text = 'char  ' + JSON.stringify(node.c); break;
      case 'any': d.text = 'any   . (any single character)'; break;
      case 'empty': d.text = 'empty (matches the empty string)'; break;
      case 'class':
        d.text = 'class ' + (node.src || ('[' + (node.neg ? '^' : '') +
          node.ranges.map(function (r) { return r[0] === r[1] ? r[0] : r[0] + '-' + r[1]; }).join('') + ']'));
        break;
      case 'concat': d.text = 'concat (' + node.parts.length + ' in sequence)'; break;
      case 'alt': d.text = 'alt (' + node.options.length + ' alternatives)'; break;
      case 'star': d.text = 'star   * (zero or more)'; break;
      case 'plus': d.text = 'plus   + (one or more)'; break;
      case 'opt': d.text = 'opt    ? (zero or one)'; break;
      case 'group': d.text = 'group  ( ) number ' + node.index; break;
      default: d.text = node.type;
    }
    out.push(d);
    if (node.parts) node.parts.forEach(function (p, i) { astLines(p, depth + 1, out, '#' + (i + 1)); });
    if (node.options) node.options.forEach(function (p, i) { astLines(p, depth + 1, out, 'alt ' + (i + 1)); });
    if (node.node) astLines(node.node, depth + 1, out, '');
    return out;
  }

  /* ======================================================================== */
  /*  CORE 2 — THOMPSON NFA CONSTRUCTION                                      */
  /* ------------------------------------------------------------------------ */
  /*  Every node becomes a small fragment with one entry and one exit, glued   */
  /*  together with epsilon transitions. The result has at most 2 states per   */
  /*  character of pattern, which is the bound that makes the whole approach   */
  /*  predictable — no pattern, however nested, can explode the machine.       */
  /* ======================================================================== */

  function toNFA(ast) {
    var states = [];
    var build = [];

    function newState() {
      if (states.length > MAX_STATES) throw new Error('pattern is too large to build a machine for');
      states.push({ id: states.length, eps: [], trans: [], accepting: false });
      return states.length - 1;
    }

    /* Each frag() returns {start, out} and records how it was built, so the
       construction can be replayed one fragment at a time on screen. */
    function frag(node) {
      var s, e, a, b, inner;
      switch (node.type) {
        case 'empty':
          s = newState(); e = newState();
          states[s].eps.push(e);
          build.push({ kind: 'empty', start: s, end: e, note: 'An empty pattern: one epsilon hop.' });
          return { start: s, out: e };
        case 'char':
          s = newState(); e = newState();
          states[s].trans.push({ on: node.c, to: e, kind: 'char' });
          build.push({ kind: 'char', start: s, end: e,
                       note: 'Literal ' + JSON.stringify(node.c) + ': one state, one labelled edge, one state.' });
          return { start: s, out: e };
        case 'any':
          s = newState(); e = newState();
          states[s].trans.push({ on: null, to: e, kind: 'any' });
          build.push({ kind: 'any', start: s, end: e, note: 'Dot: an edge that accepts any character.' });
          return { start: s, out: e };
        case 'class':
          s = newState(); e = newState();
          states[s].trans.push({ on: node, to: e, kind: 'class' });
          build.push({ kind: 'class', start: s, end: e, note: 'Character class: one edge that tests a set.' });
          return { start: s, out: e };
        case 'concat':
          inner = node.parts.map(frag);
          for (var i = 0; i + 1 < inner.length; i++) states[inner[i].out].eps.push(inner[i + 1].start);
          build.push({ kind: 'concat', start: inner[0].start, end: inner[inner.length - 1].out,
                       note: 'Concatenation: the exit of each fragment is wired to the entry of the next.' });
          return { start: inner[0].start, out: inner[inner.length - 1].out };
        case 'alt':
          s = newState(); e = newState();
          inner = node.options.map(frag);
          inner.forEach(function (f) {
            states[s].eps.push(f.start);
            states[f.out].eps.push(e);
          });
          build.push({ kind: 'alt', start: s, end: e,
                       note: 'Alternation: a new state branches into every option, and they all rejoin.' });
          return { start: s, out: e };
        case 'star':
          s = newState(); e = newState();
          a = frag(node.node);
          states[s].eps.push(a.start);
          states[s].eps.push(e);
          states[a.out].eps.push(a.start);
          states[a.out].eps.push(e);
          build.push({ kind: 'star', start: s, end: e,
                       note: 'Star: skip the body entirely, or run it and loop back. Both are epsilon edges.' });
          return { start: s, out: e };
        case 'plus':
          a = frag(node.node);
          e = newState();
          states[a.out].eps.push(a.start);
          states[a.out].eps.push(e);
          build.push({ kind: 'plus', start: a.start, end: e,
                       note: 'Plus: the body must run once, then may loop back.' });
          return { start: a.start, out: e };
        case 'opt':
          s = newState(); e = newState();
          a = frag(node.node);
          states[s].eps.push(a.start);
          states[s].eps.push(e);
          states[a.out].eps.push(e);
          build.push({ kind: 'opt', start: s, end: e, note: 'Question mark: run the body, or hop straight past it.' });
          return { start: s, out: e };
        case 'group':
          b = frag(node.node);
          build.push({ kind: 'group', start: b.start, end: b.out,
                       note: 'A group adds no states at all — it only changed how the pattern was parsed.' });
          return b;
        default:
          throw new Error('cannot compile node type ' + node.type);
      }
    }

    var f = frag(ast);
    states[f.out].accepting = true;
    return { states: states, start: f.start, accept: f.out, build: build };
  }

  function epsilonClosure(nfa, set) {
    var stack = set.slice(), seen = {}, out = [];
    set.forEach(function (s) { seen[s] = true; });
    while (stack.length) {
      var s = stack.pop();
      out.push(s);
      nfa.states[s].eps.forEach(function (t) {
        if (!seen[t]) { seen[t] = true; stack.push(t); }
      });
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function edgeAccepts(tr, ch) {
    if (tr.kind === 'char') return tr.on === ch;
    if (tr.kind === 'any') return true;
    if (tr.kind === 'class') return classMatches(tr.on, ch);
    return false;
  }

  /* NFA simulation: one set of live states, advanced once per input
     character. Cost is O(states x input) whatever the pattern looks like —
     this is the engine that cannot be ReDoS'd. */
  function nfaMatch(nfa, input) {
    var current = epsilonClosure(nfa, [nfa.start]);
    var steps = [{ pos: 0, ch: null, active: current.slice(), note: 'Start: every state reachable by epsilon edges alone.' }];
    var work = 0;

    for (var i = 0; i < input.length; i++) {
      var ch = input.charAt(i);
      var next = [];
      var seen = {};
      current.forEach(function (s) {
        nfa.states[s].trans.forEach(function (tr) {
          work++;
          if (edgeAccepts(tr, ch) && !seen[tr.to]) { seen[tr.to] = true; next.push(tr.to); }
        });
      });
      current = next.length ? epsilonClosure(nfa, next) : [];
      steps.push({ pos: i + 1, ch: ch, active: current.slice(),
                   note: current.length
                     ? 'After ' + JSON.stringify(ch) + ': ' + current.length + ' states still live.'
                     : 'After ' + JSON.stringify(ch) + ': no state survives, so the match has failed.' });
      if (!current.length) break;
    }

    var matched = current.indexOf(nfa.accept) >= 0;
    return { matched: matched, steps: steps, work: work, engine: 'nfa' };
  }

  /* ======================================================================== */
  /*  CORE 3 — SUBSET CONSTRUCTION (NFA -> DFA)                               */
  /* ======================================================================== */

  /* The DFA alphabet is not "every character" — that would be a table 65,536
     columns wide. It is the set of EQUIVALENCE CLASSES: groups of characters
     that every edge in the machine treats identically. For /[a-z]+/ the whole
     of a-z behaves the same, so it collapses to a single column.

     Two earlier attempts at this were wrong in instructive ways. Taking only
     the low end of each range meant /[a-c]+/ built a machine that accepted
     only "a". Using the empty string to stand for "any other character" meant
     dot edges rejected it, because no character is not a character. Both
     produced a DFA that disagreed with the other two engines — which is
     exactly what the differential test exists to catch. */
  function signatureOf(nfa, ch) {
    var out = [];
    for (var i = 0; i < nfa.states.length; i++) {
      var trans = nfa.states[i].trans;
      for (var t = 0; t < trans.length; t++) out.push(edgeAccepts(trans[t], ch) ? '1' : '0');
    }
    return out.join('');
  }

  function alphabetOf(nfa) {
    var cands = {}, i;
    nfa.states.forEach(function (st) {
      st.trans.forEach(function (tr) {
        if (tr.kind === 'char') cands[tr.on] = true;
        else if (tr.kind === 'class') {
          tr.on.ranges.forEach(function (r) {
            var lo = r[0].charCodeAt(0), hi = r[1].charCodeAt(0);
            if (hi < lo) { var swap = lo; lo = hi; hi = swap; }
            var stop = Math.min(hi, lo + 255);
            for (var c = lo; c <= stop; c++) cands[String.fromCharCode(c)] = true;
          });
        }
      });
    });

    // One real character to stand for "everything the pattern never names".
    // It has to be a genuine character, so that dot edges and negated classes
    // judge it the way they would judge any other unnamed input.
    var rep = null;
    for (i = 33; i < 127 && rep === null; i++) {
      var ch = String.fromCharCode(i);
      if (!cands[ch]) rep = ch;
    }
    if (rep === null) rep = '§';
    cands[rep] = true;

    var groups = {}, order = [];
    Object.keys(cands).forEach(function (c) {
      var sig = signatureOf(nfa, c);
      if (!groups[sig]) { groups[sig] = { sig: sig, chars: [] }; order.push(groups[sig]); }
      groups[sig].chars.push(c);
    });

    order.forEach(function (g) {
      g.chars.sort();
      g.other = g.chars.indexOf(rep) >= 0;
      g.rep = g.other ? rep : g.chars[0];
      if (g.other) g.label = 'other';
      else if (g.chars.length === 1) g.label = g.chars[0];
      else if (g.chars.length <= 3) g.label = g.chars.join('');
      else g.label = g.chars[0] + '-' + g.chars[g.chars.length - 1];
    });
    // Named columns first, "anything else" last: it reads as the fallback it is.
    order.sort(function (a, b) {
      if (a.other !== b.other) return a.other ? 1 : -1;
      return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
    });
    /* Every column is kept, including ones no edge accepts. Dropping them
       looked like a tidy optimisation and was a correctness bug: for /[^a]/
       the "a" column accepts nothing, and removing it made an input "a" fall
       through to the fallback column, which DOES accept — so /[^a]/ matched
       "a". A dead column is not noise, it is the machine's way of saying "this
       character kills the match". */
    return order;
  }

  /* Which alphabet column an input character belongs to. */
  function symbolIndex(alphabet, ch) {
    var i;
    for (i = 0; i < alphabet.length; i++) if (alphabet[i].chars.indexOf(ch) >= 0) return i;
    for (i = 0; i < alphabet.length; i++) if (alphabet[i].other) return i;
    return -1;
  }

  function toDFA(nfa) {
    var alphabet = alphabetOf(nfa);
    var byKey = {};
    var states = [];
    var steps = [];

    function intern(set) {
      var k = set.join(',');
      if (byKey[k] === undefined) {
        byKey[k] = states.length;
        states.push({ id: states.length, nfaSet: set.slice(), trans: {},
                      accepting: set.indexOf(nfa.accept) >= 0 });
      }
      return byKey[k];
    }

    intern(epsilonClosure(nfa, [nfa.start]));
    var queue = [0];
    while (queue.length) {
      if (states.length > 600) break;   // a pathological pattern stops growing
      var id = queue.shift();
      var st = states[id];
      /* eslint-disable no-loop-func */
      alphabet.forEach(function (sym, symIdx) {
        var next = [], seen = {};
        st.nfaSet.forEach(function (s) {
          nfa.states[s].trans.forEach(function (tr) {
            if (edgeAccepts(tr, sym.rep) && !seen[tr.to]) { seen[tr.to] = true; next.push(tr.to); }
          });
        });
        if (!next.length) return;
        var closed = epsilonClosure(nfa, next);
        var before = states.length;
        var target = intern(closed);
        st.trans[symIdx] = target;
        if (states.length > before) queue.push(target);
        steps.push({ from: id, sym: sym.label, symIdx: symIdx, to: target,
                     fresh: states.length > before, set: closed.slice() });
      });
      /* eslint-enable no-loop-func */
    }

    return { states: states, alphabet: alphabet, steps: steps, start: 0 };
  }

  /* One table lookup per input character, whatever the pattern. This is the
     engine that cannot be made to blow up. */
  function dfaMatch(dfa, input) {
    var cur = 0, work = 0;
    var path = [{ state: 0, ch: null, sym: null }];
    for (var i = 0; i < input.length; i++) {
      var ch = input.charAt(i);
      var symIdx = symbolIndex(dfa.alphabet, ch);
      work++;
      var next = symIdx < 0 ? undefined : dfa.states[cur].trans[symIdx];
      if (next === undefined) {
        path.push({ state: -1, ch: ch, sym: symIdx });
        return { matched: false, path: path, work: work, dead: true };
      }
      cur = next;
      path.push({ state: cur, ch: ch, sym: symIdx });
    }
    return { matched: !!dfa.states[cur].accepting, path: path, work: work, dead: false };
  }

  /* ======================================================================== */
  /*  CORE 4 — BACKTRACKING MATCHER                                           */
  /* ------------------------------------------------------------------------ */
  /*  This is what Perl, Python, Java, .NET and JavaScript all really do. It   */
  /*  explores one possibility at a time and undoes it when it fails, which is */
  /*  what makes backreferences and lookaround possible — and what makes the   */
  /*  worst case exponential.                                                  */
  /* ======================================================================== */

  function backtrack(ast, input, limit, recordTrace) {
    var steps = 0;
    var trace = [];
    var bailed = false;
    var maxDepth = 0;

    function record(node, pos, depth, what) {
      if (recordTrace && trace.length < 4000) {
        trace.push({ step: steps, node: node.type, pos: pos, depth: depth, what: what });
      }
    }

    function m(node, pos, depth, k) {
      steps++;
      if (steps > limit) { bailed = true; return false; }
      if (depth > maxDepth) maxDepth = depth;

      switch (node.type) {
        case 'empty':
          return k(pos);
        case 'char':
          record(node, pos, depth, 'try ' + JSON.stringify(node.c) + ' at ' + pos);
          if (pos < input.length && input.charAt(pos) === node.c) return k(pos + 1);
          return false;
        case 'any':
          if (pos < input.length) return k(pos + 1);
          return false;
        case 'class':
          if (pos < input.length && classMatches(node, input.charAt(pos))) return k(pos + 1);
          return false;
        case 'group':
          return m(node.node, pos, depth + 1, k);
        case 'concat':
          return (function step(i, p) {
            if (i === node.parts.length) return k(p);
            return m(node.parts[i], p, depth + 1, function (np) { return step(i + 1, np); });
          })(0, pos);
        case 'alt':
          for (var a = 0; a < node.options.length; a++) {
            record(node, pos, depth, 'alternative ' + (a + 1));
            if (m(node.options[a], pos, depth + 1, k)) return true;
          }
          return false;
        case 'opt':
          // Greedy: try to consume first, fall back to skipping.
          if (m(node.node, pos, depth + 1, k)) return true;
          return k(pos);
        case 'star':
          // Greedy star. The guard on `np > p` is what stops (a*)* looping
          // forever on an empty body; without it this recurses until the
          // stack dies rather than until the pattern fails.
          return (function rep(p) {
            steps++;
            if (steps > limit) { bailed = true; return false; }
            record(node, p, depth, 'star iteration at ' + p);
            if (m(node.node, p, depth + 1, function (np) {
              return np > p ? rep(np) : false;
            })) return true;
            return k(p);
          })(pos);
        case 'plus':
          return m(node.node, pos, depth + 1, function (np) {
            return (function rep(p) {
              steps++;
              if (steps > limit) { bailed = true; return false; }
              if (m(node.node, p, depth + 1, function (nnp) {
                return nnp > p ? rep(nnp) : false;
              })) return true;
              return k(p);
            })(np);
          });
        default:
          throw new Error('cannot match node type ' + node.type);
      }
    }

    var matched = m(ast, 0, 0, function (p) { return p === input.length; });
    return { matched: !!matched && !bailed, steps: steps, trace: trace,
             bailed: bailed, maxDepth: maxDepth, engine: 'backtracking' };
  }

  /* ======================================================================== */
  /*  CORE 5 — ReDoS MEASUREMENT                                              */
  /* ------------------------------------------------------------------------ */
  /*  Run both engines over the same pattern at growing input lengths and      */
  /*  record what each costs. The shape of the two curves IS the finding.      */
  /* ======================================================================== */

  function redosProfile(pattern, buildInput, maxLen, limit) {
    var parsed = parse(pattern);
    var nfa = toNFA(parsed.ast);
    var rows = [];
    var blewUp = -1;
    for (var n = 1; n <= maxLen; n++) {
      var input = buildInput(n);
      var bt = backtrack(parsed.ast, input, limit || STEP_LIMIT, false);
      var sim = nfaMatch(nfa, input);
      rows.push({ n: n, input: input, backtrack: bt.steps, bailed: bt.bailed,
                  nfa: sim.work, matched: bt.matched });
      if (bt.bailed && blewUp < 0) blewUp = n;
      if (bt.bailed) break;
    }
    // Growth factor between the last two completed rows: about 2 means the
    // cost doubles per added character, which is the signature of ReDoS.
    var growth = null;
    var done = rows.filter(function (r) { return !r.bailed; });
    if (done.length >= 2) {
      var a = done[done.length - 2].backtrack, b = done[done.length - 1].backtrack;
      if (a > 0) growth = b / a;
    }
    return { rows: rows, blewUp: blewUp, growth: growth, pattern: pattern };
  }

  /* A pattern is suspicious when a quantifier contains something that can
     match the same text more than one way — nested quantifiers, or an
     alternation whose branches overlap. This is a heuristic, deliberately:
     deciding it exactly is not something a page should pretend to do. */
  function suspicious(node, insideQuant, found) {
    found = found || [];
    if (!node || typeof node !== 'object') return found;
    var isQuant = node.type === 'star' || node.type === 'plus' || node.type === 'opt';
    if (isQuant && insideQuant) {
      found.push('a quantifier nested directly inside another quantifier');
    }
    if (node.type === 'alt' && insideQuant && node.options.length > 1) {
      found.push('an alternation inside a quantifier, whose branches may overlap');
    }
    var within = insideQuant || isQuant;
    if (node.parts) node.parts.forEach(function (p) { suspicious(p, within, found); });
    if (node.options) node.options.forEach(function (p) { suspicious(p, within, found); });
    if (node.node) suspicious(node.node, within, found);
    return found;
  }

  var CORE = {
    parse: parse, astLines: astLines, classMatches: classMatches,
    toNFA: toNFA, nfaMatch: nfaMatch, epsilonClosure: epsilonClosure,
    toDFA: toDFA, dfaMatch: dfaMatch, alphabetOf: alphabetOf,
    backtrack: backtrack, redosProfile: redosProfile, suspicious: suspicious,
    STEP_LIMIT: STEP_LIMIT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var M = root.LabVizMulti;
  var E = M.el, clear = M.clear, table = M.table, button = M.button;
  var group = M.group, textBox = M.textBox, numBox = M.numBox, field = M.field;
  var CC = M.C;

  /* Pattern and subject are shared by every family: switching tabs to see the
     same regex through a different engine is the entire point, so each panel
     edits one state object and they all redraw their fields from it. */
  var STATE = { pattern: '(a+)+', subject: 'aaaaaaaaaaaaaaaaaaa!' };
  var FIELDS = [];

  function syncFields(except) {
    FIELDS.forEach(function (f) {
      if (f.el !== except && f.el.value !== STATE[f.key]) f.el.value = STATE[f.key];
    });
  }

  function sharedInputs(host, onChange, opts) {
    opts = opts || {};
    var g = group('Pattern');
    var pat = textBox(STATE.pattern, function (v) {
      STATE.pattern = v;
      syncFields(pat);
      onChange();
    }, 'e.g. (a+)+');
    pat.className = 'oa-text oa-text-mono';
    g.appendChild(pat);
    FIELDS.push({ el: pat, key: 'pattern' });
    g.appendChild(E('p', 'oa-hint',
      'Supported: literals, . * + ? | ( ) [ ] ranges, negated classes, \\d \\w \\s. ' +
      'Matching is whole-string, not search.'));
    host.appendChild(g);

    if (!opts.noSubject) {
      var g2 = group('Test string');
      var sub = textBox(STATE.subject, function (v) {
        STATE.subject = v;
        syncFields(sub);
        onChange();
      }, 'the string to match');
      sub.className = 'oa-text oa-text-mono';
      g2.appendChild(sub);
      FIELDS.push({ el: sub, key: 'subject' });
      host.appendChild(g2);
    }

    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    PRESETS.forEach(function (p) {
      row.appendChild(button(p.label, function () {
        STATE.pattern = p.pattern;
        STATE.subject = p.subject;
        syncFields(null);
        onChange();
      }));
    });
    g3.appendChild(row);
    host.appendChild(g3);
  }

  var PRESETS = [
    { label: 'Evil (a+)+', pattern: '(a+)+', subject: 'aaaaaaaaaaaaaaaaaaa!' },
    { label: 'Evil (a|a)*', pattern: '(a|a)*', subject: 'aaaaaaaaaaaaaaaaaaa!' },
    { label: 'Safe a+b', pattern: 'a+b', subject: 'aaaaaaaaaaaaaaaaaaa!' },
    { label: 'Alternation', pattern: 'colou?r', subject: 'colour' },
    { label: 'Classes', pattern: '[a-z]+[0-9]*', subject: 'abc123' },
    { label: 'Nested groups', pattern: '(ab|a)(b?)c', subject: 'abc' }
  ];

  var EXTRA_CSS = [
    '.rx-tree{font-size:12px;line-height:1.75;}',
    '.rx-node{white-space:pre;color:' + CC.ink + ';}',
    '.rx-node .rx-lbl{color:' + CC.faint + ';}',
    '.rx-node.hot{background:rgba(56,189,248,.14);border-radius:4px;}',
    '.rx-verdict{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:4px;}',
    '.rx-tag{padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;}',
    '.rx-tag-yes{background:rgba(52,211,153,.16);color:' + CC.green + ';}',
    '.rx-tag-no{background:rgba(252,165,165,.14);color:' + CC.red + ';}',
    '.rx-tag-warn{background:rgba(251,191,36,.16);color:' + CC.amber + ';}',
    '.rx-tape{display:flex;flex-wrap:wrap;gap:2px;margin:6px 0;}',
    '.rx-ch{min-width:1.5rem;padding:5px 3px;text-align:center;border-radius:4px;background:#131f36;border:1px solid #24344f;font-size:12px;color:' + CC.dim + ';}',
    '.rx-ch.done{color:' + CC.ink + ';border-color:#39557d;}',
    '.rx-ch.now{background:rgba(251,191,36,.2);border-color:' + CC.amber + ';color:#fff;font-weight:700;}',
    '.rx-states{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0;}',
    '.rx-state{padding:3px 9px;border-radius:999px;font-size:11px;background:#131f36;border:1px solid #24344f;color:' + CC.dim + ';}',
    '.rx-state.live{background:rgba(56,189,248,.2);border-color:' + CC.blue + ';color:#e6f6ff;font-weight:700;}',
    '.rx-state.acc{border-color:' + CC.green + ';}',
    '.rx-bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding:6px 0;}',
    '.rx-bar{flex:1 1 0;min-width:4px;display:flex;flex-direction:column;justify-content:flex-end;}',
    '.rx-bar i{display:block;background:' + CC.blue + ';border-radius:2px 2px 0 0;}',
    '.rx-bar.now i{background:' + CC.amber + ';}',
    '.rx-bar.bail i{background:' + CC.red + ';}',
    '.rx-bar u{display:block;background:' + CC.green + ';border-radius:2px 2px 0 0;text-decoration:none;}',
    '.rx-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:' + CC.faint + ';}',
    '.rx-legend b{font-weight:400;}',
    '.rx-key{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:middle;}',
    '.rx-mono{font-size:12px;color:' + CC.dim + ';word-break:break-all;}'
  ].join('');

  function verdictTag(matched, extra) {
    var wrap = E('div', 'rx-verdict');
    wrap.appendChild(E('span', 'rx-tag ' + (matched ? 'rx-tag-yes' : 'rx-tag-no'),
                       matched ? 'MATCHES' : 'no match'));
    if (extra) wrap.appendChild(E('span', 'rx-mono', extra));
    return wrap;
  }

  function safeParse() {
    try {
      return { parsed: parse(STATE.pattern) };
    } catch (err) {
      return { error: 'Cannot parse that pattern: ' + err.message };
    }
  }

  /* ======================================================================== */
  /*  FAMILY 1 — PARSE TREE                                                   */
  /* ======================================================================== */

  function ParseFamily() {
    this.key = 'parse';
    this.label = 'Parse tree';
    this.algoKey = 'tree';
  }
  ParseFamily.prototype.algoOptions = function () { return [{ key: 'tree', label: 'Recursive descent parse' }]; };
  ParseFamily.prototype.buildPanel = function (host, onChange) { sharedInputs(host, onChange, { noSubject: true }); };
  ParseFamily.prototype.buildStage = function (host) {
    this.treeHost = E('div', 'rx-tree');
    this.outHost = E('div', 'oa-tableout');
    host.appendChild(this.treeHost);
    host.appendChild(this.outHost);
  };
  ParseFamily.prototype.compute = function () {
    var r = safeParse();
    this.error = r.error || null;
    if (r.error) { this.lines = []; return 1; }
    this.lines = astLines(r.parsed.ast, 0, [], '');
    this.groups = r.parsed.groups;
    return Math.max(1, this.lines.length);
  };
  ParseFamily.prototype.render = function (idx) {
    clear(this.treeHost);
    clear(this.outHost);
    if (this.error) return;
    var cur = Math.min(idx, this.lines.length - 1);
    this.lines.forEach(function (l, i) {
      var pad = new Array(l.depth + 1).join('   ');
      var node = E('div', 'rx-node' + (i === cur ? ' hot' : ''));
      node.appendChild(document.createTextNode(pad + (i > cur ? '' : '') + l.text + ' '));
      if (l.label) node.appendChild(E('span', 'rx-lbl', l.label));
      if (i > cur) node.style.opacity = '.25';
      this.treeHost.appendChild(node);
    }, this);
    this.outHost.appendChild(table(['Nodes', 'Capture groups', 'Pattern'],
      [[this.lines.length, this.groups, STATE.pattern || '(empty)']]));
  };
  ParseFamily.prototype.note = function (idx) {
    if (this.error) return this.error;
    var l = this.lines[Math.min(idx, this.lines.length - 1)];
    return 'Node ' + (Math.min(idx, this.lines.length - 1) + 1) + ' of ' + this.lines.length +
      ', at depth ' + l.depth + ': ' + l.text.trim() +
      '. The parser is plain recursive descent — alternation calls concatenation, which calls ' +
      'repetition, which calls atom, and an atom may be a bracketed group that starts the cycle again.';
  };
  ParseFamily.prototype.compare = function () { return null; };

  /* ======================================================================== */
  /*  FAMILY 2 — THOMPSON NFA                                                 */
  /* ======================================================================== */

  function NfaFamily() {
    this.key = 'nfa';
    this.label = 'NFA';
    this.algoKey = 'run';
  }
  NfaFamily.prototype.algoOptions = function () {
    return [{ key: 'build', label: 'Build the machine (Thompson)' },
            { key: 'run', label: 'Run it on the test string' }];
  };
  NfaFamily.prototype.buildPanel = function (host, onChange) { sharedInputs(host, onChange); };
  NfaFamily.prototype.buildStage = function (host) {
    this.topHost = E('div');
    this.tapeHost = E('div');
    this.stateHost = E('div');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.tapeHost);
    host.appendChild(this.stateHost);
    host.appendChild(this.tableHost);
  };
  NfaFamily.prototype.compute = function () {
    var r = safeParse();
    this.error = r.error || null;
    if (r.error) return 1;
    try {
      this.nfa = toNFA(r.parsed.ast);
    } catch (err) {
      this.error = err.message;
      return 1;
    }
    this.run = nfaMatch(this.nfa, STATE.subject);
    return this.algoKey === 'build'
      ? Math.max(1, this.nfa.build.length)
      : Math.max(1, this.run.steps.length);
  };
  NfaFamily.prototype.render = function (idx) {
    clear(this.topHost); clear(this.tapeHost); clear(this.stateHost); clear(this.tableHost);
    if (this.error) return;
    var self = this;

    if (this.algoKey === 'build') {
      var b = this.nfa.build[Math.min(idx, this.nfa.build.length - 1)];
      this.topHost.appendChild(E('p', 'cy-pane-title', 'Fragment ' + (idx + 1) +
        ' of ' + this.nfa.build.length + ' — ' + b.kind));
      var states = E('div', 'rx-states');
      this.nfa.states.forEach(function (st) {
        var cls = 'rx-state';
        if (st.id === b.start || st.id === b.end) cls += ' live';
        if (st.accepting) cls += ' acc';
        states.appendChild(E('span', cls, 'q' + st.id));
      });
      this.stateHost.appendChild(states);
      this.tableHost.appendChild(table(['States so far', 'Entry', 'Exit', 'Pattern length'],
        [[this.nfa.states.length, 'q' + b.start, 'q' + b.end, STATE.pattern.length]]));
      return;
    }

    var step = this.run.steps[Math.min(idx, this.run.steps.length - 1)];
    this.topHost.appendChild(verdictTag(this.run.matched,
      'NFA simulation · ' + this.run.work + ' edge tests for ' + STATE.subject.length + ' characters'));

    var tape = E('div', 'rx-tape');
    for (var i = 0; i < STATE.subject.length; i++) {
      var cls = 'rx-ch' + (i < step.pos ? ' done' : '') + (i === step.pos - 1 ? ' now' : '');
      tape.appendChild(E('span', cls, STATE.subject.charAt(i)));
    }
    if (!STATE.subject.length) tape.appendChild(E('span', 'rx-ch', '(empty)'));
    this.tapeHost.appendChild(tape);

    var live = E('div', 'rx-states');
    this.nfa.states.forEach(function (st) {
      var cls = 'rx-state';
      if (step.active.indexOf(st.id) >= 0) cls += ' live';
      if (st.accepting) cls += ' acc';
      live.appendChild(E('span', cls, 'q' + st.id + (st.accepting ? ' ✓' : '')));
    });
    this.stateHost.appendChild(live);
    this.tableHost.appendChild(table(['Characters read', 'Live states', 'Machine states', 'Accepting?'],
      [[step.pos, step.active.length, this.nfa.states.length,
        step.active.indexOf(this.nfa.accept) >= 0 ? 'yes' : 'not yet']]));
  };
  NfaFamily.prototype.note = function (idx) {
    if (this.error) return this.error;
    if (this.algoKey === 'build') {
      return this.nfa.build[Math.min(idx, this.nfa.build.length - 1)].note +
        ' Thompson’s construction never creates more than two states per character of ' +
        'pattern, so the machine cannot explode however deeply the pattern nests.';
    }
    var step = this.run.steps[Math.min(idx, this.run.steps.length - 1)];
    return step.note + ' The simulation tracks a SET of states at once, so it never backtracks ' +
      'and its cost is states x input length whatever the pattern looks like.';
  };
  NfaFamily.prototype.compare = function () { return null; };

  /* ======================================================================== */
  /*  FAMILY 3 — SUBSET CONSTRUCTION                                          */
  /* ======================================================================== */

  function DfaFamily() {
    this.key = 'dfa';
    this.label = 'DFA';
    this.algoKey = 'run';
  }
  DfaFamily.prototype.algoOptions = function () {
    return [{ key: 'build', label: 'Build it (subset construction)' },
            { key: 'run', label: 'Run it on the test string' }];
  };
  DfaFamily.prototype.buildPanel = function (host, onChange) { sharedInputs(host, onChange); };
  DfaFamily.prototype.buildStage = function (host) {
    this.topHost = E('div');
    this.gridHost = E('div', 'oa-scroll');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.gridHost);
    host.appendChild(this.tableHost);
  };
  DfaFamily.prototype.compute = function () {
    var r = safeParse();
    this.error = r.error || null;
    if (r.error) return 1;
    try {
      this.nfa = toNFA(r.parsed.ast);
      this.dfa = toDFA(this.nfa);
    } catch (err) {
      this.error = err.message;
      return 1;
    }
    this.run = dfaMatch(this.dfa, STATE.subject);
    return this.algoKey === 'build'
      ? Math.max(1, this.dfa.steps.length)
      : Math.max(1, this.run.path.length);
  };
  DfaFamily.prototype.render = function (idx) {
    clear(this.topHost); clear(this.gridHost); clear(this.tableHost);
    if (this.error) return;
    var dfa = this.dfa, self = this;
    var upto = this.algoKey === 'build' ? Math.min(idx, dfa.steps.length - 1) : dfa.steps.length - 1;
    var cur = this.algoKey === 'build' ? dfa.steps[upto] : null;
    var here = this.algoKey === 'run'
      ? this.run.path[Math.min(idx, this.run.path.length - 1)].state : -1;

    if (this.algoKey === 'run') {
      this.topHost.appendChild(verdictTag(this.run.matched,
        'DFA · exactly ' + this.run.work + ' table lookups for ' + STATE.subject.length + ' characters'));
      var tape = E('div', 'rx-tape');
      var pathIdx = Math.min(idx, this.run.path.length - 1);
      for (var i = 0; i < STATE.subject.length; i++) {
        var cls = 'rx-ch' + (i < pathIdx ? ' done' : '') + (i === pathIdx - 1 ? ' now' : '');
        tape.appendChild(E('span', cls, STATE.subject.charAt(i)));
      }
      this.topHost.appendChild(tape);
    } else {
      this.topHost.appendChild(E('p', 'cy-pane-title',
        'Transition ' + (upto + 1) + ' of ' + dfa.steps.length + ' discovered'));
    }

    // transition table: rows are DFA states, columns are equivalence classes
    var head = ['state'].concat(dfa.alphabet.map(function (g) { return g.label; })).concat(['accepts?']);
    var rows = dfa.states.map(function (st, si) {
      var cells = [E('span', 'rx-state' + (si === here ? ' live' : '') +
                     (st.accepting ? ' acc' : ''), 'D' + si)];
      dfa.alphabet.forEach(function (g, gi) {
        var to = st.trans[gi];
        var shown = to === undefined ? '—' : 'D' + to;
        if (self.algoKey === 'build') {
          var found = false;
          for (var k = 0; k <= upto; k++) {
            if (dfa.steps[k].from === si && dfa.steps[k].symIdx === gi) { found = true; break; }
          }
          if (!found) shown = '';
        }
        cells.push(shown);
      });
      cells.push(st.accepting ? 'yes' : '');
      return { cls: si === here ? 'oa-row-cur' : '', cells: cells };
    });
    this.gridHost.appendChild(table(head, rows));

    this.tableHost.appendChild(table(
      ['DFA states', 'NFA states', 'Alphabet columns', this.algoKey === 'run' ? 'Lookups' : 'Transitions'],
      [[dfa.states.length, this.nfa.states.length, dfa.alphabet.length,
        this.algoKey === 'run' ? this.run.work : dfa.steps.length]]));
  };
  DfaFamily.prototype.note = function (idx) {
    if (this.error) return this.error;
    if (this.algoKey === 'build') {
      var s = this.dfa.steps[Math.min(idx, this.dfa.steps.length - 1)];
      return 'From D' + s.from + ' on "' + s.sym + '" the set of reachable NFA states is {' +
        s.set.map(function (q) { return 'q' + q; }).join(', ') + '}' +
        (s.fresh ? ', which is new, so it becomes D' + s.to + '.' : ', which is already D' + s.to + '.') +
        ' Each column is a group of characters every edge treats identically, which is why a whole ' +
        'range like a-z needs only one.';
    }
    var p = this.run.path[Math.min(idx, this.run.path.length - 1)];
    if (p.state < 0) {
      return 'On "' + p.ch + '" there is no transition out of the current state, so the match ' +
        'fails immediately. No backtracking is possible — and none is needed.';
    }
    if (p.ch === null) {
      return 'The machine starts in D0. From here every character costs exactly one table lookup, ' +
        'no matter how the pattern was written.';
    }
    return 'Read "' + p.ch + '" and move to D' + p.state + '. One lookup, no alternatives kept, ' +
      'nothing to undo — this is the engine that cannot be made to blow up.';
  };
  DfaFamily.prototype.compare = function () {
    if (this.error) return null;
    var bt = null;
    try {
      bt = backtrack(parse(STATE.pattern).ast, STATE.subject, 400000, false);
    } catch (err) { bt = null; }
    return {
      title: 'The same pattern and string through all three engines',
      head: ['Engine', 'Work done', 'Answer', 'Worst case'],
      rows: [
        { key: 'nfa', cells: ['NFA simulation', nfaMatch(this.nfa, STATE.subject).work + ' edge tests',
                              this.run.matched ? 'match' : 'no match', 'O(states x input)'] },
        { key: 'dfa', cells: ['DFA', this.run.work + ' lookups',
                              this.run.matched ? 'match' : 'no match', 'O(input)'] },
        { key: 'bt', cells: ['Backtracking', bt ? (bt.steps + (bt.bailed ? '+ steps (gave up)' : ' steps')) : 'n/a',
                             bt ? (bt.bailed ? 'gave up' : (bt.matched ? 'match' : 'no match')) : 'n/a',
                             'exponential'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 4 — BACKTRACKING                                                 */
  /* ======================================================================== */

  function BtFamily() {
    this.key = 'bt';
    this.label = 'Backtracking';
    this.algoKey = 'bt';
  }
  BtFamily.prototype.algoOptions = function () { return [{ key: 'bt', label: 'Backtracking search' }]; };
  BtFamily.prototype.buildPanel = function (host, onChange) { sharedInputs(host, onChange); };
  BtFamily.prototype.buildStage = function (host) {
    this.topHost = E('div');
    this.tapeHost = E('div');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.tapeHost);
    host.appendChild(this.tableHost);
  };
  BtFamily.prototype.compute = function () {
    var r = safeParse();
    this.error = r.error || null;
    if (r.error) return 1;
    // The trace is capped inside the core; a run that bails still reports how
    // far it got, which is the finding rather than a failure.
    this.run = backtrack(r.parsed.ast, STATE.subject, 400000, true);
    if (this.run.bailed) {
      this.error = 'The backtracker gave up after 400,000 steps without deciding. That is not a ' +
        'bug in the engine — it is what ReDoS looks like from the inside. Open the ReDoS tab.';
    }
    return Math.max(1, this.run.trace.length);
  };
  BtFamily.prototype.render = function (idx) {
    clear(this.topHost); clear(this.tapeHost); clear(this.tableHost);
    var r = this.run;
    if (!r) return;
    var t = r.trace.length ? r.trace[Math.min(idx, r.trace.length - 1)] : null;

    this.topHost.appendChild(verdictTag(r.matched,
      'backtracking · ' + r.steps + (r.bailed ? '+ steps, gave up' : ' steps') +
      ' · deepest recursion ' + r.maxDepth));

    var tape = E('div', 'rx-tape');
    var pos = t ? t.pos : 0;
    for (var i = 0; i < STATE.subject.length; i++) {
      var cls = 'rx-ch' + (i < pos ? ' done' : '') + (i === pos ? ' now' : '');
      tape.appendChild(E('span', cls, STATE.subject.charAt(i)));
    }
    this.tapeHost.appendChild(tape);

    this.tableHost.appendChild(table(
      ['Steps taken', 'Position', 'Recursion depth', 'Trace entries'],
      [[r.steps + (r.bailed ? '+' : ''), pos, t ? t.depth : 0, r.trace.length]]));
  };
  BtFamily.prototype.note = function (idx) {
    if (!this.run) return this.error || '';
    var r = this.run;
    if (!r.trace.length) return this.error || 'Nothing to trace for this pattern.';
    var t = r.trace[Math.min(idx, r.trace.length - 1)];
    return 'Step ' + t.step + ', depth ' + t.depth + ': ' + (t.what || t.node) +
      '. A backtracking engine commits to one possibility, and if it fails it rewinds and tries ' +
      'the next — which is what makes backreferences possible and what makes the worst case exponential.';
  };
  BtFamily.prototype.compare = function () { return null; };

  /* ======================================================================== */
  /*  FAMILY 5 — ReDoS                                                        */
  /* ======================================================================== */

  function RedosFamily() {
    this.key = 'redos';
    this.label = 'ReDoS';
    this.algoKey = 'profile';
    this.maxLen = 24;
    this.suffix = '!';
  }
  RedosFamily.prototype.algoOptions = function () { return [{ key: 'profile', label: 'Cost against input length' }]; };
  RedosFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    sharedInputs(host, onChange, { noSubject: true });
    var g = group('Attack string');
    g.appendChild(field('Repeat "a" up to', numBox(this.maxLen, 4, 34, function (v) {
      self.maxLen = v;
      onChange();
    })));
    var sfx = textBox(this.suffix, function (v) { self.suffix = v; onChange(); }, 'trailing characters');
    g.appendChild(field('then append', sfx));
    g.appendChild(E('p', 'oa-hint',
      'The classic attack is a run of characters the pattern nearly accepts, followed by one it ' +
      'cannot. The engine must prove every possible split fails before it gives up.'));
    host.appendChild(g);
  };
  RedosFamily.prototype.buildStage = function (host) {
    this.topHost = E('div');
    this.chartHost = E('div');
    this.legendHost = E('div', 'rx-legend');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.chartHost);
    host.appendChild(this.legendHost);
    host.appendChild(this.tableHost);
  };
  RedosFamily.prototype.compute = function () {
    var r = safeParse();
    this.error = r.error || null;
    if (r.error) return 1;
    var self = this;
    try {
      this.profile = redosProfile(STATE.pattern, function (n) {
        return new Array(n + 1).join('a') + self.suffix;
      }, this.maxLen, 2000000);
    } catch (err) {
      this.error = err.message;
      return 1;
    }
    this.flags = suspicious(r.parsed.ast, false, []);
    return Math.max(1, this.profile.rows.length);
  };
  RedosFamily.prototype.render = function (idx) {
    clear(this.topHost); clear(this.chartHost); clear(this.legendHost); clear(this.tableHost);
    if (this.error && !this.profile) return;
    var p = this.profile;
    var cur = Math.min(idx, p.rows.length - 1);

    var tag = E('div', 'rx-verdict');
    var risky = p.blewUp > 0 || (p.growth !== null && p.growth > 1.5);
    tag.appendChild(E('span', 'rx-tag ' + (risky ? 'rx-tag-no' : 'rx-tag-yes'),
                      risky ? 'VULNERABLE' : 'looks linear'));
    if (p.growth !== null) {
      tag.appendChild(E('span', 'rx-mono', 'cost multiplies by about ' +
        (Math.round(p.growth * 100) / 100) + ' for each extra character'));
    }
    this.topHost.appendChild(tag);
    if (this.flags.length) {
      this.topHost.appendChild(E('p', 'oa-warn', 'Static warning: this pattern contains ' +
        this.flags.slice(0, 2).join(', and ') + '.'));
    }

    // Log-scaled bars: on a linear axis the early rows would be invisible next
    // to the last one, which is precisely the shape being demonstrated.
    var maxLog = 1;
    p.rows.forEach(function (r) { maxLog = Math.max(maxLog, Math.log(r.backtrack + 1)); });
    var bars = E('div', 'rx-bars');
    p.rows.forEach(function (r, i) {
      var bar = E('div', 'rx-bar' + (i === cur ? ' now' : '') + (r.bailed ? ' bail' : ''));
      var bt = E('i');
      bt.style.height = Math.max(2, (Math.log(r.backtrack + 1) / maxLog) * 100) + '%';
      var nf = E('u');
      nf.style.height = Math.max(1, (Math.log(r.nfa + 1) / maxLog) * 22) + '%';
      bar.appendChild(bt);
      bar.appendChild(nf);
      bar.title = 'n=' + r.n + ': backtracking ' + r.backtrack + ' steps, NFA ' + r.nfa;
      bars.appendChild(bar);
    });
    this.chartHost.appendChild(bars);

    var l1 = E('span'); l1.appendChild(E('i', 'rx-key')).style.background = CC.blue;
    l1.appendChild(document.createTextNode(' backtracking (log scale)'));
    var l2 = E('span'); l2.appendChild(E('i', 'rx-key')).style.background = CC.green;
    l2.appendChild(document.createTextNode(' NFA simulation'));
    this.legendHost.appendChild(l1);
    this.legendHost.appendChild(l2);

    var row = p.rows[cur];
    this.tableHost.appendChild(table(
      ['Input length', 'Backtracking steps', 'NFA edge tests', 'Ratio'],
      [[row.input.length, row.backtrack + (row.bailed ? '+ (gave up)' : ''), row.nfa,
        row.nfa ? Math.round(row.backtrack / row.nfa) + 'x' : '—']]));
  };
  RedosFamily.prototype.note = function (idx) {
    if (this.error && !this.profile) return this.error;
    var p = this.profile;
    var row = p.rows[Math.min(idx, p.rows.length - 1)];
    if (row.bailed) {
      return 'At ' + row.input.length + ' characters the backtracker passed two million steps ' +
        'without deciding, and was stopped. On a server with no such ceiling this request would ' +
        'still be running, holding a thread — one short string, one hung worker. That is ReDoS.';
    }
    var msg = 'Input of ' + row.input.length + ' characters: backtracking took ' + row.backtrack +
      ' steps, the NFA simulation ' + row.nfa + '.';
    if (p.growth !== null && p.growth > 1.5) {
      msg += ' Each extra character multiplies the backtracking cost by about ' +
        (Math.round(p.growth * 100) / 100) + ', so ten more characters means roughly ' +
        Math.round(Math.pow(p.growth, 10)) + ' times the work.';
    } else {
      msg += ' The cost is growing gently, so this pattern is not the exponential kind.';
    }
    return msg;
  };
  RedosFamily.prototype.compare = function () {
    var p = this.profile;
    if (!p) return null;
    var rows = p.rows.filter(function (r, i) { return i % Math.max(1, Math.floor(p.rows.length / 8)) === 0 || r.bailed; });
    return {
      title: 'Backtracking against the state-machine engines',
      head: ['Input length', 'Backtracking steps', 'NFA edge tests', 'How much worse'],
      rows: rows.map(function (r) {
        return { key: 'n' + r.n,
                 cells: [r.input.length, r.backtrack + (r.bailed ? '+' : ''), r.nfa,
                         r.nfa ? Math.round(r.backtrack / r.nfa) + 'x' : '—'] };
      })
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  M.boot({
    rootId: 'regexviz',
    mountId: 'viz-regex-mount',
    name: 'The regex engine visualiser',
    css: EXTRA_CSS,
    families: function () {
      return [new ParseFamily(), new NfaFamily(), new DfaFamily(),
              new BtFamily(), new RedosFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

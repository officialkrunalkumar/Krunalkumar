/* ==========================================================================
   compiler.js — a small language taken all the way from text to execution.
   --------------------------------------------------------------------------
   Every compiler explanation I have read shows the stages as a diagram: source
   goes in one end, machine code comes out the other, and the four boxes in
   between are labelled but empty. This page fills the boxes with one program at
   a time, all four at once, and wires them together — click a token, a tree
   node or an instruction and the other three panes light up the part that
   corresponds to it. That mapping is the whole value here. A parse tree nobody
   can connect back to the text is a picture; a parse tree that highlights the
   exact characters it came from and the exact instructions it produced is an
   explanation.

   Then the bytecode is handed to a stack machine that really runs it, one
   instruction at a time, with the value stack, the call frames and the
   instruction pointer on screen. Recursion is the reason the frames are worth
   drawing: fib(10) builds and unwinds 177 of them, and watching that happen is
   worth more than any sentence about "the call stack".

   Decisions worth spelling out:

   1. A real front end, not a demo. The lexer is a single left-to-right pass,
      the parser is recursive descent with one function per precedence level,
      and the emitter is single-pass with backpatched jumps. There is no
      RegExp anywhere in the parser and nothing is eval'd — the CSP here is
      script-src 'self', which forbids eval outright, and a page about
      compilers that secretly used the host language's compiler would be a
      poor joke.

   2. Bytecode rather than tree-walking. A tree-walking interpreter would be
      shorter and would hide the two things most worth seeing: that a while
      loop is a jump backwards, and that an if is a jump forwards over the
      branch you did not take. Bytecode makes control flow a number you can
      point at.

   3. Locals are stack slots, and declaring one costs no instruction at all.
      That surprises people, so the tool says it out loud rather than emitting
      a fake DEF_LOCAL to make the listing look busier.

   4. Every limit is a message, never a hang. The VM records each step so the
      transport can scrub backwards, so the record is capped; recursion is
      capped; the value stack is capped. Hitting one of those is reported with
      the call stack intact, because that is the same thing a real runtime
      does and it is the interesting case.

   Nothing here opens a network connection and nothing leaves the tab.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  var MAX_SOURCE = 4000;      // characters accepted in the editor
  var MAX_STEPS = 25000;      // instructions recorded before the VM gives up
  var MAX_CALL_DEPTH = 64;    // frames before "call stack overflow"
  var MAX_VALUE_STACK = 512;  // values before "value stack overflow"
  var MAX_LOCALS = 64;        // slots per function

  /* ======================================================================== */
  /*  ERRORS                                                                  */
  /* ------------------------------------------------------------------------ */
  /*  One shape for everything the front end can refuse: a stage, a message,   */
  /*  and a position precise enough to put a caret under. A compiler that      */
  /*  says "syntax error" and nothing else is the reason people are afraid of  */
  /*  compilers, so every throw below carries the column with it.              */
  /* ======================================================================== */

  function fail(stage, message, pos, line, col, length) {
    var e = new Error(message);
    e.stage = stage;
    e.pos = pos;
    e.line = line;
    e.col = col;
    e.length = Math.max(1, length || 1);
    throw e;
  }

  /* ======================================================================== */
  /*  STAGE 1 — LEXER                                                         */
  /* ------------------------------------------------------------------------ */
  /*  One pass, one character of lookahead, no grammar knowledge whatsoever.   */
  /*  That is why "print print" lexes perfectly and only falls over later.     */
  /* ======================================================================== */

  var KEYWORDS = {
    'let': 1, 'fn': 1, 'if': 1, 'else': 1, 'while': 1,
    'return': 1, 'print': 1, 'true': 1, 'false': 1, 'nil': 1
  };
  var TWO_CHAR = ['==', '!=', '<=', '>='];
  var ONE_CHAR = '+-*/%(){},;=<>!';

  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  function isAlphaNum(c) { return isAlpha(c) || isDigit(c); }

  function lex(src) {
    var tokens = [], i = 0, line = 1, lineStart = 0;

    function add(type, start, text, value) {
      tokens.push({
        index: tokens.length, type: type, text: text, value: value,
        start: start, end: i, line: line, col: start - lineStart + 1
      });
    }

    while (i < src.length) {
      var c = src.charAt(i);
      if (c === '\n') { i++; line++; lineStart = i; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src.charAt(i + 1) === '/') {
        while (i < src.length && src.charAt(i) !== '\n') i++;
        continue;
      }

      var start = i, col = start - lineStart + 1;

      if (isDigit(c)) {
        while (i < src.length && isDigit(src.charAt(i))) i++;
        if (src.charAt(i) === '.' && isDigit(src.charAt(i + 1))) {
          i++;
          while (i < src.length && isDigit(src.charAt(i))) i++;
        }
        add('number', start, src.slice(start, i), parseFloat(src.slice(start, i)));
        continue;
      }

      if (isAlpha(c)) {
        while (i < src.length && isAlphaNum(src.charAt(i))) i++;
        var word = src.slice(start, i);
        add(KEYWORDS[word] ? 'keyword' : 'name', start, word, word);
        continue;
      }

      if (c === '"') {
        i++;
        var buf = '';
        for (;;) {
          if (i >= src.length || src.charAt(i) === '\n') {
            fail('lexer', 'this string is never closed', start, line, col, 1);
          }
          var d = src.charAt(i);
          if (d === '"') { i++; break; }
          if (d === '\\') {
            var esc = src.charAt(i + 1);
            if (esc === 'n') buf += '\n';
            else if (esc === 't') buf += '\t';
            else if (esc === '"' || esc === '\\') buf += esc;
            else fail('lexer', '\\' + esc + ' is not an escape this language knows — it has \\n, \\t, \\" and \\\\',
                      i, line, i - lineStart + 1, 2);
            i += 2;
            continue;
          }
          buf += d;
          i++;
        }
        add('string', start, src.slice(start, i), buf);
        continue;
      }

      if (TWO_CHAR.indexOf(src.substr(i, 2)) >= 0) {
        var pair = src.substr(i, 2);
        i += 2;
        add('op', start, pair, pair);
        continue;
      }
      if (ONE_CHAR.indexOf(c) >= 0) {
        i += 1;
        add('op', start, c, c);
        continue;
      }
      fail('lexer', '"' + c + '" means nothing in this language', start, line, col, 1);
    }

    // The parser wants a token that means "there is no more input", so it can
    // report the end of the file as a position like any other.
    add('eof', src.length, '', null);
    return tokens;
  }

  /* ======================================================================== */
  /*  STAGE 2 — PARSER                                                        */
  /* ------------------------------------------------------------------------ */
  /*  Recursive descent. One function per precedence level, each calling the   */
  /*  tighter one below it:                                                   */
  /*    assignment -> equality -> comparison -> term -> factor -> unary        */
  /*               -> call -> primary                                         */
  /*  That chain IS the precedence table. 2 + 3 * 4 comes out with the         */
  /*  multiplication underneath because term() calls factor() and not the      */
  /*  other way round — there is no separate precedence machinery at all.      */
  /* ======================================================================== */

  function parse(tokens) {
    var p = 0, seq = 0;

    function peek() { return tokens[p]; }
    function prev() { return tokens[p - 1]; }
    function check(type, text) {
      var t = tokens[p];
      if (!t || t.type !== type) return false;
      return text === undefined || t.text === text;
    }
    function match(type, text) {
      if (check(type, text)) { p++; return true; }
      return false;
    }
    function at(tok, msg) {
      fail('parser', msg, tok.start, tok.line, tok.col,
           Math.max(1, tok.end - tok.start));
    }
    function expect(type, text, msg) {
      if (check(type, text)) { p++; return prev(); }
      at(peek(), msg);
    }
    /* Called once the node's last token has been consumed, so prev() is the
       end of its source range. Every node carries that range for the rest of
       its life — it is what the four panes are synchronised on. */
    function mk(type, startTok, props) {
      var n = props || {};
      n.type = type;
      n.id = seq++;
      n.start = startTok.start;
      n.end = prev() ? prev().end : startTok.end;
      n.line = startTok.line;
      n.col = startTok.col;
      return n;
    }

    function program() {
      var startTok = peek();
      var body = [];
      while (!check('eof')) body.push(declaration());
      return mk('Program', startTok, { body: body });
    }

    function declaration() {
      if (check('keyword', 'fn')) return fnDecl();
      return statement();
    }

    function fnDecl() {
      var start = peek();
      p++;
      var nameTok = expect('name', undefined, 'a function needs a name here');
      expect('op', '(', 'expected "(" after the function name');
      var params = [];
      if (!check('op', ')')) {
        do {
          var pt = expect('name', undefined, 'expected a parameter name');
          params.push({ name: pt.text, tok: pt });
        } while (match('op', ','));
      }
      expect('op', ')', 'expected ")" after the parameter list');
      if (!check('op', '{')) at(peek(), 'a function body has to be a block in braces');
      var body = block();
      return mk('FnDecl', start, {
        name: nameTok.text, nameTok: nameTok, params: params, body: body
      });
    }

    function block() {
      var start = peek();
      expect('op', '{', 'expected "{"');
      var body = [];
      while (!check('op', '}') && !check('eof')) body.push(statement());
      if (!check('op', '}')) {
        at(peek(), 'this block is never closed — the "{" on line ' + start.line + ' has no "}"');
      }
      p++;
      return mk('Block', start, { body: body });
    }

    function statement() {
      if (check('keyword', 'let')) return letStmt();
      if (check('keyword', 'print')) return printStmt();
      if (check('keyword', 'if')) return ifStmt();
      if (check('keyword', 'while')) return whileStmt();
      if (check('keyword', 'return')) return returnStmt();
      if (check('op', '{')) return block();
      if (check('keyword', 'fn')) {
        at(peek(), 'functions can only be declared at the top level of the program');
      }
      return exprStmt();
    }

    function letStmt() {
      var start = peek();
      p++;
      var nameTok = expect('name', undefined, 'expected a variable name after "let"');
      expect('op', '=', 'a "let" has to give the variable a value: let ' + nameTok.text + ' = ...');
      var init = expression();
      expect('op', ';', 'expected ";" at the end of this statement');
      return mk('Let', start, { name: nameTok.text, nameTok: nameTok, init: init });
    }

    function printStmt() {
      var start = peek();
      p++;
      var value = expression();
      expect('op', ';', 'expected ";" at the end of this statement');
      return mk('Print', start, { value: value });
    }

    function ifStmt() {
      var start = peek();
      p++;
      expect('op', '(', 'expected "(" after "if"');
      var cond = expression();
      expect('op', ')', 'expected ")" after the condition');
      var then = statement();
      var alt = null;
      if (match('keyword', 'else')) alt = statement();
      return mk('If', start, { cond: cond, then: then, alt: alt });
    }

    function whileStmt() {
      var start = peek();
      p++;
      expect('op', '(', 'expected "(" after "while"');
      var cond = expression();
      expect('op', ')', 'expected ")" after the condition');
      var body = statement();
      return mk('While', start, { cond: cond, body: body });
    }

    function returnStmt() {
      var start = peek();
      p++;
      var value = null;
      if (!check('op', ';')) value = expression();
      expect('op', ';', 'expected ";" at the end of this statement');
      return mk('Return', start, { value: value });
    }

    function exprStmt() {
      var start = peek();
      var expr = expression();
      expect('op', ';', 'expected ";" at the end of this statement');
      return mk('ExprStmt', start, { expr: expr });
    }

    function expression() { return assignment(); }

    function assignment() {
      var start = peek();
      var left = equality();
      if (check('op', '=')) {
        p++;
        var value = assignment();
        if (left.type !== 'Name') {
          fail('parser', 'only a variable can be assigned to', left.start, left.line,
               left.col, Math.max(1, left.end - left.start));
        }
        return mk('Assign', start, { name: left.name, target: left, value: value });
      }
      return left;
    }

    function binaryLevel(next, texts) {
      return function () {
        var start = peek();
        var left = next();
        while (peek() && peek().type === 'op' && texts.indexOf(peek().text) >= 0) {
          var op = peek().text;
          p++;
          var right = next();
          left = mk('Binary', start, { op: op, left: left, right: right });
        }
        return left;
      };
    }

    function unary() {
      if (check('op', '-') || check('op', '!')) {
        var start = peek();
        var op = start.text;
        p++;
        var operand = unary();
        return mk('Unary', start, { op: op, operand: operand });
      }
      return call();
    }

    function call() {
      var start = peek();
      var expr = primary();
      while (check('op', '(')) {
        p++;
        var args = [];
        if (!check('op', ')')) {
          do { args.push(expression()); } while (match('op', ','));
        }
        expect('op', ')', 'expected ")" after the arguments');
        expr = mk('Call', start, { callee: expr, args: args });
      }
      return expr;
    }

    function primary() {
      var t = peek();
      if (check('number')) { p++; return mk('Number', t, { value: t.value }); }
      if (check('string')) { p++; return mk('String', t, { value: t.value }); }
      if (check('keyword', 'true')) { p++; return mk('Bool', t, { value: true }); }
      if (check('keyword', 'false')) { p++; return mk('Bool', t, { value: false }); }
      if (check('keyword', 'nil')) { p++; return mk('Nil', t, {}); }
      if (check('name')) { p++; return mk('Name', t, { name: t.text }); }
      if (check('op', '(')) {
        p++;
        var inner = expression();
        expect('op', ')', 'expected ")" to close this group');
        return mk('Group', t, { inner: inner });
      }
      if (t.type === 'eof') at(t, 'the program ends in the middle of an expression');
      at(t, 'expected a value here, and found "' + t.text + '"');
    }

    var factor = binaryLevel(unary, ['*', '/', '%']);
    var term = binaryLevel(factor, ['+', '-']);
    var comparison = binaryLevel(term, ['<', '<=', '>', '>=']);
    var equality = binaryLevel(comparison, ['==', '!=']);

    return program();
  }

  /* ======================================================================== */
  /*  TREE SHAPE                                                              */
  /* ------------------------------------------------------------------------ */
  /*  childrenOf and nodeLabel are the only two places that know how a node    */
  /*  is drawn, so adding a node type means touching two functions rather      */
  /*  than four panes.                                                        */
  /* ======================================================================== */

  function childrenOf(node) {
    var out = [];
    function add(label, n) { if (n) out.push({ label: label, node: n }); }
    switch (node.type) {
      case 'Program': node.body.forEach(function (s) { add('', s); }); break;
      case 'Block': node.body.forEach(function (s) { add('', s); }); break;
      case 'FnDecl': add('body', node.body); break;
      case 'Let': add('value', node.init); break;
      case 'Print': add('value', node.value); break;
      case 'If': add('cond', node.cond); add('then', node.then); add('else', node.alt); break;
      case 'While': add('cond', node.cond); add('body', node.body); break;
      case 'Return': add('value', node.value); break;
      case 'ExprStmt': add('', node.expr); break;
      case 'Assign': add('value', node.value); break;
      case 'Binary': add('left', node.left); add('right', node.right); break;
      case 'Unary': add('', node.operand); break;
      case 'Group': add('', node.inner); break;
      case 'Call':
        add('callee', node.callee);
        node.args.forEach(function (a, i) { add('arg ' + (i + 1), a); });
        break;
      default: break;
    }
    return out;
  }

  function nodeLabel(node) {
    switch (node.type) {
      case 'Program': return 'program — ' + node.body.length + ' top-level statements';
      case 'Block': return 'block { } — ' + node.body.length + ' statements';
      case 'FnDecl': return 'fn ' + node.name + '(' + node.params.map(function (x) { return x.name; }).join(', ') + ')';
      case 'Let': return 'let ' + node.name;
      case 'Print': return 'print';
      case 'If': return node.alt ? 'if / else' : 'if';
      case 'While': return 'while';
      case 'Return': return 'return';
      case 'ExprStmt': return 'expression statement';
      case 'Assign': return 'assign to ' + node.name;
      case 'Binary': return 'binary  ' + node.op;
      case 'Unary': return 'unary  ' + node.op;
      case 'Group': return 'group ( )';
      case 'Call': return 'call';
      case 'Name': return 'name  ' + node.name;
      case 'Number': return 'number  ' + node.value;
      case 'String': return 'string  ' + JSON.stringify(node.value);
      case 'Bool': return node.value ? 'true' : 'false';
      case 'Nil': return 'nil';
      default: return node.type;
    }
  }

  var STATEMENTS = {
    Program: 1, Block: 1, FnDecl: 1, Let: 1, Print: 1,
    If: 1, While: 1, Return: 1, ExprStmt: 1
  };

  /* Pre-order flatten. `last` records, for every ancestor level, whether that
     ancestor was its parent's final child — which is exactly what decides
     whether the tree connector at that level is a corner or a straight line. */
  function flattenAst(rootNode) {
    var out = [];
    function walk(node, depth, label, lastFlags, parentRow) {
      var row = {
        node: node, depth: depth, label: label,
        last: lastFlags, parent: parentRow, order: out.length
      };
      out.push(row);
      var kids = childrenOf(node);
      kids.forEach(function (k, i) {
        walk(k.node, depth + 1, k.label, lastFlags.concat([i === kids.length - 1]), row);
      });
    }
    walk(rootNode, 0, '', [], null);
    return out;
  }

  /* ======================================================================== */
  /*  STAGE 3 — EMITTER                                                       */
  /* ------------------------------------------------------------------------ */
  /*  Single pass, straight out of the tree, one chunk of bytecode per         */
  /*  function. Jumps are emitted with a placeholder target and backpatched    */
  /*  once the branch length is known, which is what a single-pass compiler    */
  /*  has to do and is worth watching in the bytecode pane.                    */
  /*                                                                          */
  /*  Targets are absolute addresses inside the chunk rather than relative     */
  /*  offsets. Real VMs mostly use offsets to keep the operand small; here the */
  /*  operand is a number on a screen, and "jump to 0021" is readable in a way */
  /*  that "jump forward 9" is not.                                           */
  /* ======================================================================== */

  var BINOPS = {
    '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD',
    '==': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LE', '>': 'GT', '>=': 'GE'
  };

  function compileProgram(ast) {
    var funcs = [];
    var byName = {};
    var cur = null;

    function newFunc(name, arity, node) {
      var f = {
        index: funcs.length, name: name, arity: arity, params: [],
        code: [], consts: [], slotNames: [], node: node
      };
      funcs.push(f);
      return f;
    }

    function ctxFor(f) { return { fn: f, locals: [], depth: 0 }; }

    function emit(op, a, node, hint) {
      var ins = {
        op: op, a: a, node: node.id, start: node.start, end: node.end,
        line: node.line, hint: hint || '', fn: cur.fn.index, i: cur.fn.code.length
      };
      cur.fn.code.push(ins);
      return ins;
    }

    function constant(value) {
      for (var i = 0; i < cur.fn.consts.length; i++) {
        if (cur.fn.consts[i] === value && typeof cur.fn.consts[i] === typeof value) return i;
      }
      cur.fn.consts.push(value);
      return cur.fn.consts.length - 1;
    }

    function declareLocal(name, tok) {
      for (var i = cur.locals.length - 1; i >= 0; i--) {
        if (cur.locals[i].depth < cur.depth) break;
        if (cur.locals[i].name === name) {
          fail('compiler', '"' + name + '" is already declared in this block',
               tok.start, tok.line, tok.col, name.length);
        }
      }
      if (cur.locals.length >= MAX_LOCALS) {
        fail('compiler', 'more than ' + MAX_LOCALS + ' variables in one function',
             tok.start, tok.line, tok.col, name.length);
      }
      cur.locals.push({ name: name, depth: cur.depth });
      cur.fn.slotNames[cur.locals.length - 1] = name;
      return cur.locals.length - 1;
    }

    function resolveLocal(name) {
      for (var i = cur.locals.length - 1; i >= 0; i--) {
        if (cur.locals[i].name === name) return i;
      }
      return -1;
    }

    function endScope(node) {
      cur.depth--;
      while (cur.locals.length && cur.locals[cur.locals.length - 1].depth > cur.depth) {
        var dead = cur.locals.pop();
        emit('POP', null, node, 'drop ' + dead.name + ', whose block has ended');
      }
    }

    /* Every node records which chunk it emitted into and the half-open range
       of instructions it produced, children included. Selecting an `if` in the
       tree therefore lights its condition, both branches and both jumps — the
       whole of what that node became. */
    function gen(node) {
      if (node.type === 'FnDecl') { genFunction(node); return; }
      var chunk = cur.fn.index;
      var from = cur.fn.code.length;
      genNode(node);
      node.opFn = chunk;
      node.opStart = from;
      node.opEnd = cur.fn.code.length;
    }

    function genFunction(node) {
      var f = byName[node.name];
      var outer = cur;
      cur = ctxFor(f);
      // The call convention leaves the arguments in slots 0..arity-1 already,
      // so parameters cost no instruction: they are declared, not stored.
      node.params.forEach(function (prm) {
        declareLocal(prm.name, prm.tok);
        f.params.push(prm.name);
      });
      gen(node.body);
      // A function that runs off the end still owes its caller a value.
      emit('NIL', null, node, 'fell off the end, so the result is nil');
      emit('RET', null, node, 'return to the caller');
      node.opFn = f.index;
      node.opStart = 0;
      node.opEnd = f.code.length;
      cur = outer;
    }

    function genNode(node) {
      switch (node.type) {
        case 'Program':
          node.body.forEach(gen);
          emit('HALT', null, node, 'the program is over');
          break;
        case 'Block':
          cur.depth++;
          node.body.forEach(gen);
          endScope(node);
          break;
        case 'Let':
          gen(node.init);
          // No instruction. The value the initialiser left on top of the stack
          // IS the variable: the slot it occupies is the next free one, and the
          // compiler simply remembers the name for it. This surprises people,
          // which is why the note says so rather than emitting a fake store.
          node.slot = declareLocal(node.name, node.nameTok);
          break;
        case 'Print':
          gen(node.value);
          emit('PRINT', null, node, 'pop one value and write it out');
          break;
        case 'ExprStmt':
          gen(node.expr);
          emit('POP', null, node, 'nothing uses this value, so throw it away');
          break;
        case 'If': genIf(node); break;
        case 'While': genWhile(node); break;
        case 'Return': genReturn(node); break;
        case 'Assign': genAssign(node); break;
        case 'Binary':
          gen(node.left);
          gen(node.right);
          emit(BINOPS[node.op], null, node, 'pop two, push the result');
          break;
        case 'Unary':
          gen(node.operand);
          emit(node.op === '-' ? 'NEG' : 'NOT', null, node, 'replace the top of the stack');
          break;
        case 'Group':
          // Parentheses vanish here. They did their work in the parser, by
          // changing the shape of the tree; there is nothing left to emit.
          gen(node.inner);
          break;
        case 'Call': genCall(node); break;
        case 'Name': genName(node); break;
        case 'Number': emit('CONST', constant(node.value), node, String(node.value)); break;
        case 'String': emit('CONST', constant(node.value), node, JSON.stringify(node.value)); break;
        case 'Bool': emit(node.value ? 'TRUE' : 'FALSE', null, node, ''); break;
        case 'Nil': emit('NIL', null, node, ''); break;
        default:
          fail('compiler', 'this compiler has no rule for a ' + node.type + ' node',
               node.start, node.line, node.col, 1);
      }
    }

    function genIf(node) {
      gen(node.cond);
      var skipThen = emit('JUMP_IF_FALSE', 0, node, 'condition false: skip the then-branch');
      gen(node.then);
      if (node.alt) {
        var skipElse = emit('JUMP', 0, node, 'then-branch done: jump over the else-branch');
        skipThen.a = cur.fn.code.length;
        gen(node.alt);
        skipElse.a = cur.fn.code.length;
      } else {
        skipThen.a = cur.fn.code.length;
      }
    }

    function genWhile(node) {
      var top = cur.fn.code.length;
      gen(node.cond);
      var out = emit('JUMP_IF_FALSE', 0, node, 'condition false: leave the loop');
      gen(node.body);
      emit('JUMP', top, node, 'back to the top of the loop and test again');
      out.a = cur.fn.code.length;
    }

    function genReturn(node) {
      if (cur.fn.index === 0) {
        fail('compiler', 'a "return" only means something inside a function',
             node.start, node.line, node.col, 6);
      }
      if (node.value) gen(node.value);
      else emit('NIL', null, node, 'a bare return still returns a value: nil');
      emit('RET', null, node, 'pop the result, drop this frame, resume the caller');
    }

    function genAssign(node) {
      var slot = resolveLocal(node.name);
      if (slot < 0) {
        if (byName[node.name]) {
          fail('compiler', '"' + node.name + '" is a function, and functions cannot be reassigned',
               node.start, node.line, node.col, node.name.length);
        }
        fail('compiler', 'there is nothing called "' + node.name + '" in scope here',
             node.start, node.line, node.col, node.name.length);
      }
      gen(node.value);
      // Assignment is an expression, so the value stays on the stack. The
      // statement wrapper is what pops it.
      emit('SET_LOCAL', slot, node, 'store into slot ' + slot + ' (' + node.name + '), value stays');
    }

    function genName(node) {
      var slot = resolveLocal(node.name);
      if (slot >= 0) {
        emit('GET_LOCAL', slot, node, 'read slot ' + slot + ' (' + node.name + ')');
        return;
      }
      var f = byName[node.name];
      if (f) {
        emit('FN', f.index, node, 'push the function ' + f.name);
        return;
      }
      fail('compiler', 'there is nothing called "' + node.name + '" in scope here',
           node.start, node.line, node.col, node.name.length);
    }

    function genCall(node) {
      if (node.callee.type !== 'Name') {
        fail('compiler', 'only a named function can be called in this language',
             node.callee.start, node.callee.line, node.callee.col,
             Math.max(1, node.callee.end - node.callee.start));
      }
      // There are no function values in this language, so a name that resolves
      // to a local can never be callable and the compiler can say so now rather
      // than leaving it for the VM to discover halfway through a run.
      if (resolveLocal(node.callee.name) >= 0) {
        fail('compiler', '"' + node.callee.name + '" is a variable, and this language has no ' +
             'function values — only a function declared with fn can be called',
             node.callee.start, node.callee.line, node.callee.col, node.callee.name.length);
      }
      // Where the callee is known at compile time, so is the arity. Checking it
      // here rather than at run time is the whole reason to have a compiler.
      var target = byName[node.callee.name];
      if (target && node.args.length !== target.arity) {
        fail('compiler', target.name + ' takes ' + target.arity + ' argument' +
             (target.arity === 1 ? '' : 's') + ', but this call passes ' + node.args.length,
             node.start, node.line, node.col, Math.max(1, node.end - node.start));
      }
      gen(node.callee);
      node.args.forEach(gen);
      emit('CALL', node.args.length, node,
           'call with ' + node.args.length + ' argument' + (node.args.length === 1 ? '' : 's'));
    }

    var main = newFunc('main', 0, ast);

    /* Top-level function declarations are hoisted before anything is compiled,
       so a function may call one declared further down the file and two
       functions may call each other. Nothing else in this language is hoisted. */
    ast.body.forEach(function (stmt) {
      if (stmt.type !== 'FnDecl') return;
      if (byName[stmt.name]) {
        fail('compiler', 'there is already a function called "' + stmt.name + '"',
             stmt.nameTok.start, stmt.nameTok.line, stmt.nameTok.col, stmt.name.length);
      }
      byName[stmt.name] = newFunc(stmt.name, stmt.params.length, stmt);
    });

    cur = ctxFor(main);
    gen(ast);

    return { funcs: funcs, byName: byName, main: main };
  }

  /* ======================================================================== */
  /*  STAGE 4 — THE STACK MACHINE                                             */
  /* ------------------------------------------------------------------------ */
  /*  One value stack, one array of call frames, and a frame is nothing more   */
  /*  than {which function, where in it, where its slot 0 lives}. Slot 0 of a  */
  /*  frame is the first argument, because CALL leaves the arguments exactly   */
  /*  where the callee wants them. That is the entire calling convention.      */
  /*                                                                          */
  /*  Every step is recorded before it executes, so the transport can scrub    */
  /*  backwards for free. The record is what MAX_STEPS bounds — an infinite    */
  /*  loop ends as a message with the stack intact rather than a frozen tab.   */
  /* ======================================================================== */

  function isFn(v) { return v !== null && typeof v === 'object' && typeof v.fn === 'number'; }

  function typeName(v) {
    if (v === null) return 'nil';
    if (isFn(v)) return 'function';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'boolean') return 'boolean';
    return 'value';
  }

  function printable(v, funcs) {
    if (v === null) return 'nil';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (isFn(v)) return '<fn ' + (funcs ? funcs[v.fn].name : v.fn) + '>';
    return String(v);
  }

  function showValue(v, funcs) {
    if (typeof v === 'string') return JSON.stringify(v);
    return printable(v, funcs);
  }

  function truthy(v) { return v !== false && v !== null; }

  function execute(program) {
    var funcs = program.funcs;
    var stack = [{ fn: 0 }];                       // slot below main's base
    var frames = [{ fn: 0, ip: 0, base: 1 }];
    var out = [];
    var trace = [];
    var callCounts = [];
    var error = null, stopped = null;
    var maxDepth = 1, maxStack = 1, calls = 0;

    funcs.forEach(function () { callCounts.push(0); });

    function copyFrames() {
      return frames.map(function (f) { return { fn: f.fn, ip: f.ip, base: f.base }; });
    }

    function snapshot(ins) {
      var top = frames[frames.length - 1];
      trace.push({
        fn: top ? top.fn : 0,
        ip: top ? top.ip : 0,
        ins: ins,
        stack: stack.slice(),
        frames: copyFrames(),
        outLen: out.length
      });
    }

    function rt(msg) {
      var e = new Error(msg);
      e.runtime = true;
      throw e;
    }

    function push(v) {
      if (stack.length >= MAX_VALUE_STACK) {
        rt('the value stack overflowed at ' + MAX_VALUE_STACK + ' values');
      }
      stack.push(v);
      if (stack.length > maxStack) maxStack = stack.length;
    }

    function pop() {
      if (!stack.length) rt('an instruction needed a value and the stack was empty');
      return stack.pop();
    }

    function numbers(verb) {
      var b = pop(), a = pop();
      if (typeof a !== 'number' || typeof b !== 'number') {
        rt('cannot ' + verb + ' a ' + typeName(a) + ' and a ' + typeName(b));
      }
      return [a, b];
    }

    function equalValues(a, b) {
      if (isFn(a) && isFn(b)) return a.fn === b.fn;
      return a === b;
    }

    try {
      for (;;) {
        if (trace.length >= MAX_STEPS) { stopped = 'limit'; break; }
        var fr = frames[frames.length - 1];
        var code = funcs[fr.fn].code;
        if (fr.ip < 0 || fr.ip >= code.length) {
          rt('the instruction pointer ran off the end of ' + funcs[fr.fn].name);
        }
        var ins = code[fr.ip];
        snapshot(ins);
        fr.ip++;

        var pair, a, b, v, argc, calleeAt, callee, target, done;
        switch (ins.op) {
          case 'CONST': push(funcs[fr.fn].consts[ins.a]); break;
          case 'NIL': push(null); break;
          case 'TRUE': push(true); break;
          case 'FALSE': push(false); break;
          case 'FN': push({ fn: ins.a }); break;
          case 'POP': pop(); break;
          case 'GET_LOCAL': push(stack[fr.base + ins.a]); break;
          case 'SET_LOCAL':
            if (!stack.length) rt('an instruction needed a value and the stack was empty');
            stack[fr.base + ins.a] = stack[stack.length - 1];
            break;
          case 'PRINT': out.push(printable(pop(), funcs)); break;
          case 'JUMP': fr.ip = ins.a; break;
          case 'JUMP_IF_FALSE': if (!truthy(pop())) fr.ip = ins.a; break;
          case 'ADD':
            b = pop(); a = pop();
            if (typeof a === 'number' && typeof b === 'number') push(a + b);
            else if (typeof a === 'string' || typeof b === 'string') {
              push(printable(a, funcs) + printable(b, funcs));
            } else rt('cannot add a ' + typeName(a) + ' and a ' + typeName(b));
            break;
          case 'SUB': pair = numbers('subtract'); push(pair[0] - pair[1]); break;
          case 'MUL': pair = numbers('multiply'); push(pair[0] * pair[1]); break;
          case 'DIV':
            pair = numbers('divide');
            if (pair[1] === 0) rt('division by zero');
            push(pair[0] / pair[1]);
            break;
          case 'MOD':
            pair = numbers('take the remainder of');
            if (pair[1] === 0) rt('remainder by zero');
            push(pair[0] % pair[1]);
            break;
          case 'NEG':
            v = pop();
            if (typeof v !== 'number') rt('cannot negate a ' + typeName(v));
            push(-v);
            break;
          case 'NOT': push(!truthy(pop())); break;
          case 'EQ': b = pop(); a = pop(); push(equalValues(a, b)); break;
          case 'NEQ': b = pop(); a = pop(); push(!equalValues(a, b)); break;
          case 'LT': pair = numbers('compare'); push(pair[0] < pair[1]); break;
          case 'LE': pair = numbers('compare'); push(pair[0] <= pair[1]); break;
          case 'GT': pair = numbers('compare'); push(pair[0] > pair[1]); break;
          case 'GE': pair = numbers('compare'); push(pair[0] >= pair[1]); break;
          case 'CALL':
            argc = ins.a;
            calleeAt = stack.length - argc - 1;
            if (calleeAt < 0) rt('a call found fewer values on the stack than it needed');
            callee = stack[calleeAt];
            if (!isFn(callee)) rt('tried to call a ' + typeName(callee) + ', which is not a function');
            target = funcs[callee.fn];
            if (target.arity !== argc) {
              rt(target.name + ' takes ' + target.arity + ' argument' +
                 (target.arity === 1 ? '' : 's') + ', but was called with ' + argc);
            }
            if (frames.length >= MAX_CALL_DEPTH) {
              rt('call stack overflow at ' + MAX_CALL_DEPTH + ' frames — a recursion with ' +
                 'no reachable base case looks exactly like this');
            }
            frames.push({ fn: callee.fn, ip: 0, base: calleeAt + 1 });
            callCounts[callee.fn]++;
            calls++;
            if (frames.length > maxDepth) maxDepth = frames.length;
            break;
          case 'RET':
            v = pop();
            done = frames.pop();
            // Everything this frame owned — its locals and the callee slot it
            // was called through — is discarded in one assignment, and the
            // result takes the callee's place.
            stack.length = done.base - 1;
            push(v);
            break;
          case 'HALT': stopped = 'halt'; break;
          default: rt('unknown instruction ' + ins.op);
        }
        if (stopped) break;
      }
    } catch (err) {
      if (!err.runtime) throw err;
      error = { message: err.message, frames: copyFrames() };
      stopped = 'error';
    }

    snapshot(null);
    var last = trace[trace.length - 1];
    last.done = true;
    if (error) last.error = error;
    if (stopped === 'limit') last.limit = true;

    return {
      trace: trace, out: out, error: error, stopped: stopped,
      steps: trace.length - 1, calls: calls, callCounts: callCounts,
      maxDepth: maxDepth, maxStack: maxStack, funcs: funcs
    };
  }

  /* ======================================================================== */
  /*  THE WHOLE PIPELINE, ONCE                                                */
  /* ======================================================================== */

  function buildAll(source) {
    var b = {
      source: source, tokens: [], ast: null, nodes: [], nodeById: {},
      program: null, ops: [], offsets: [], error: null, vm: null
    };
    try {
      b.tokens = lex(source);
      b.ast = parse(b.tokens);
      b.program = compileProgram(b.ast);
    } catch (err) {
      if (!err.stage) throw err;
      b.error = {
        stage: err.stage, message: err.message, pos: err.pos,
        line: err.line, col: err.col, length: err.length
      };
      return b;
    }
    b.nodes = flattenAst(b.ast);
    b.nodes.forEach(function (row) { b.nodeById[row.node.id] = row; });
    var offset = 0;
    b.program.funcs.forEach(function (f, fi) {
      b.offsets[fi] = offset;
      f.code.forEach(function (ins) { b.ops.push(ins); });
      offset += f.code.length;
    });
    return b;
  }

  /* The VM is only run when a pane actually needs it. Compiling on every
     keystroke is a fraction of a millisecond; running twenty-five thousand
     recorded instructions is not, and the pipeline panes never look at it. */
  function vmOf(b) {
    if (!b.program) return null;
    if (!b.vm) {
      try {
        b.vm = execute(b.program);
      } catch (err) {
        b.vm = { fatal: err.message, trace: [], out: [], steps: 0, funcs: b.program.funcs };
      }
    }
    return b.vm;
  }

  var CORE = {
    lex: lex, parse: parse, compileProgram: compileProgram, execute: execute,
    buildAll: buildAll, flattenAst: flattenAst, childrenOf: childrenOf,
    nodeLabel: nodeLabel, printable: printable,
    MAX_STEPS: MAX_STEPS, MAX_CALL_DEPTH: MAX_CALL_DEPTH
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var M = root.LabVizMulti;
  var E = M.el, clear = M.clear, table = M.table, button = M.button, group = M.group;
  var CC = M.C;

  var SHELL = null;   // set at boot; the panes need it to move the transport

  var EXAMPLES = [
    {
      label: 'Fibonacci',
      code: '// Two calls per level, so the frames pile up and unwind.\n' +
            'fn fib(n) {\n' +
            '  if (n < 2) { return n; }\n' +
            '  return fib(n - 1) + fib(n - 2);\n' +
            '}\n' +
            '\n' +
            'print fib(10);\n'
    },
    {
      label: 'Precedence',
      code: '// The tree is where precedence lives. Compare the two shapes.\n' +
            'let a = 2 + 3 * 4;\n' +
            'let b = (2 + 3) * 4;\n' +
            'print a;\n' +
            'print b;\n' +
            'print a < b;\n'
    },
    {
      label: 'A loop',
      code: '// A while loop is a jump backwards. Watch the last instruction.\n' +
            'let total = 0;\n' +
            'let i = 1;\n' +
            'while (i <= 10) {\n' +
            '  total = total + i;\n' +
            '  i = i + 1;\n' +
            '}\n' +
            'print total;\n'
    },
    {
      label: 'FizzBuzz',
      code: 'fn label(n) {\n' +
            '  if (n % 15 == 0) { return "FizzBuzz"; }\n' +
            '  if (n % 3 == 0) { return "Fizz"; }\n' +
            '  if (n % 5 == 0) { return "Buzz"; }\n' +
            '  return n;\n' +
            '}\n' +
            '\n' +
            'let i = 1;\n' +
            'while (i <= 15) {\n' +
            '  print label(i);\n' +
            '  i = i + 1;\n' +
            '}\n'
    },
    {
      label: 'Euclid',
      code: '// Greatest common divisor. The block-scoped t is popped every lap.\n' +
            'fn gcd(a, b) {\n' +
            '  while (b != 0) {\n' +
            '    let t = b;\n' +
            '    b = a % b;\n' +
            '    a = t;\n' +
            '  }\n' +
            '  return a;\n' +
            '}\n' +
            '\n' +
            'print gcd(1071, 462);\n'
    },
    {
      label: 'Strings',
      code: 'fn repeat(word, times) {\n' +
            '  let out = "";\n' +
            '  let i = 0;\n' +
            '  while (i < times) {\n' +
            '    out = out + word + " ";\n' +
            '    i = i + 1;\n' +
            '  }\n' +
            '  return out;\n' +
            '}\n' +
            '\n' +
            'print repeat("hello", 3);\n'
    },
    {
      label: 'Broken: syntax',
      code: '// Deliberately broken. The caret points at what the parser could\n' +
            '// not use, in the column where it found it.\n' +
            'let x = 3;\n' +
            'print x +;\n'
    },
    {
      label: 'Broken: run time',
      code: '// Deliberately broken three frames down, so the call stack at the\n' +
            '// moment of failure is worth reading.\n' +
            'fn inner(n) { return 100 / n; }\n' +
            'fn middle(n) { return inner(n - 5); }\n' +
            'fn outer(n) { return middle(n + 1); }\n' +
            '\n' +
            'print outer(4);\n'
    }
  ];

  var MODES = [
    { key: 'lex', label: 'Tokens' },
    { key: 'parse', label: 'Tree' },
    { key: 'emit', label: 'Bytecode' }
  ];

  var STATE = { source: EXAMPLES[0].code };
  var EDITORS = [];
  var CACHE = { source: null, built: null };

  function pipeline() {
    if (CACHE.source !== STATE.source) {
      CACHE.source = STATE.source;
      CACHE.built = buildAll(STATE.source);
    }
    return CACHE.built;
  }

  function syncEditors(except) {
    EDITORS.forEach(function (el) {
      if (el !== except && el.value !== STATE.source) el.value = STATE.source;
    });
  }

  function stageName(stage) {
    if (stage === 'lexer') return 'Lex';
    if (stage === 'parser') return 'Parse';
    return 'Compile';
  }

  function splitLines(src) {
    var out = [], start = 0;
    for (var i = 0; i <= src.length; i++) {
      if (i === src.length || src.charAt(i) === '\n') {
        out.push({ start: start, text: src.slice(start, i) });
        start = i + 1;
      }
    }
    return out;
  }

  function padLeft(value, width) {
    var s = String(value);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /* Scroll the selected row into view inside its own pane. scrollIntoView would
     also move the page, which yanks the other three panes off screen every time
     the transport steps. */
  function keepVisible(box, el) {
    if (!box || !el) return;
    var top = el.offsetTop;
    var bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 8);
    else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = bottom - box.clientHeight + 8;
    }
  }

  function pane(title, meta) {
    var wrap = E('section', 'cx-pane');
    var head = E('div', 'cx-pane-head');
    head.appendChild(E('p', 'cx-pane-title', title));
    var metaEl = E('span', 'cx-pane-meta', meta || '');
    head.appendChild(metaEl);
    wrap.appendChild(head);
    var body = E('div', 'cx-body');
    wrap.appendChild(body);
    wrap.setAttribute('aria-label', title);
    return { wrap: wrap, body: body, meta: metaEl };
  }

  /* ======================================================================== */
  /*  THE MAPPING                                                             */
  /* ------------------------------------------------------------------------ */
  /*  Everything the four panes draw comes out of one focus object, whichever  */
  /*  stage is being stepped. That is what keeps them synchronised: there is   */
  /*  no per-pane notion of "selected", only this.                            */
  /*                                                                          */
  /*    srcStart/srcEnd   the exact characters selected                       */
  /*    stmtStart/stmtEnd the statement they sit inside, painted fainter      */
  /*    token             index into the token stream                         */
  /*    nodeId            the tree node                                       */
  /*    opFrom/opTo       the instructions selected                           */
  /*    nodeFrom/nodeTo   every instruction the whole node produced           */
  /* ======================================================================== */

  function emptyFocus(mode, idx) {
    return {
      mode: mode, idx: idx, srcStart: 0, srcEnd: 0, stmtStart: 0, stmtEnd: 0,
      token: -1, nodeId: -1, opFrom: -1, opTo: -1, nodeFrom: -1, nodeTo: -1
    };
  }

  function nodeRowAt(b, pos) {
    var best = null;
    for (var i = 0; i < b.nodes.length; i++) {
      var n = b.nodes[i].node;
      if (n.start <= pos && pos < n.end) {
        if (!best || (n.end - n.start) < (best.node.end - best.node.start)) best = b.nodes[i];
      }
    }
    return best;
  }

  function tokenAt(b, pos) {
    for (var i = 0; i < b.tokens.length; i++) {
      if (b.tokens[i].start >= pos) return i;
    }
    return Math.max(0, b.tokens.length - 1);
  }

  function statementOf(row) {
    while (row && !STATEMENTS[row.node.type]) row = row.parent;
    return row ? row.node : null;
  }

  function nodeOps(b, f, node) {
    if (!node || typeof node.opFn !== 'number') return;
    f.nodeFrom = b.offsets[node.opFn] + node.opStart;
    f.nodeTo = b.offsets[node.opFn] + node.opEnd;
  }

  function focusOf(b, mode, idx) {
    var f = emptyFocus(mode, idx);
    if (b.error || !b.program) return f;
    var row = null;

    if (mode === 'lex') {
      var t = b.tokens[Math.min(idx, b.tokens.length - 1)];
      if (!t) return f;
      f.token = t.index;
      f.srcStart = t.start;
      f.srcEnd = Math.max(t.end, t.start + (t.type === 'eof' ? 0 : 1));
      row = nodeRowAt(b, t.start);
    } else if (mode === 'parse') {
      row = b.nodes[Math.min(idx, b.nodes.length - 1)];
      if (!row) return f;
      f.srcStart = row.node.start;
      f.srcEnd = row.node.end;
      f.token = tokenAt(b, row.node.start);
    } else {
      var ins = b.ops[Math.min(idx, b.ops.length - 1)];
      if (!ins) return f;
      f.srcStart = ins.start;
      f.srcEnd = ins.end;
      f.opFrom = b.offsets[ins.fn] + ins.i;
      f.opTo = f.opFrom + 1;
      f.token = tokenAt(b, ins.start);
      row = b.nodeById[ins.node] || null;
    }

    if (row) {
      f.nodeId = row.node.id;
      nodeOps(b, f, row.node);
      var stmt = statementOf(row);
      if (stmt) { f.stmtStart = stmt.start; f.stmtEnd = stmt.end; }
    }
    if (mode !== 'emit') { f.opFrom = f.nodeFrom; f.opTo = f.nodeTo; }
    return f;
  }

  /* Clicking in a pane never changes which stage is being stepped — it moves
     the transport to whatever position in the CURRENT stage corresponds to the
     thing that was clicked. Clicking a token while stepping the tree selects
     the node that token sits in; clicking it while stepping bytecode selects
     the first instruction that node produced. */
  function frameForNode(b, mode, row) {
    if (!row) return 0;
    if (mode === 'parse') return row.order;
    if (mode === 'lex') return tokenAt(b, row.node.start);
    if (typeof row.node.opFn === 'number' && row.node.opEnd > row.node.opStart) {
      return b.offsets[row.node.opFn] + row.node.opStart;
    }
    return 0;
  }

  function frameForToken(b, mode, ti) {
    if (mode === 'lex') return ti;
    var t = b.tokens[ti];
    return frameForNode(b, mode, t ? nodeRowAt(b, t.start) : null);
  }

  function frameForOp(b, mode, gi) {
    if (mode === 'emit') return gi;
    var ins = b.ops[gi];
    return frameForNode(b, mode, ins ? b.nodeById[ins.node] : null);
  }

  /* Switching stage keeps the visitor where they were looking, rather than
     throwing them back to the first token every time. */
  function remap(b, focus, mode) {
    if (!focus || b.error || !b.program) return 0;
    if (mode === 'lex') return tokenAt(b, focus.srcStart);
    var row = b.nodeById[focus.nodeId] || nodeRowAt(b, focus.srcStart);
    return frameForNode(b, mode, row);
  }

  /* ======================================================================== */
  /*  PANE PAINTING                                                           */
  /* ======================================================================== */

  function classAt(i, focus) {
    if (focus.srcEnd > focus.srcStart && i >= focus.srcStart && i < focus.srcEnd) return 'cx-hit';
    if (focus.stmtEnd > focus.stmtStart && i >= focus.stmtStart && i < focus.stmtEnd) return 'cx-near';
    return '';
  }

  function renderSource(box, b, focus) {
    var lines = splitLines(b.source);
    var width = String(lines.length).length;
    var hot = null;
    lines.forEach(function (ln, n) {
      var rowEl = E('div', 'cx-srcline');
      rowEl.appendChild(E('span', 'cx-gutter', padLeft(n + 1, width)));
      var codeEl = E('span', 'cx-srccode');
      // Grouped run by run rather than span per character: two ranges overlap
      // here (the selection and the statement around it) and runs are the
      // simplest thing that gets both right without special cases.
      var i = 0, cls = null, buf = '';
      function flush() {
        if (!buf) return;
        if (cls) {
          var mark = E(cls === 'cx-hit' ? 'mark' : 'span', cls, buf);
          codeEl.appendChild(mark);
          if (cls === 'cx-hit' && !hot) hot = rowEl;
        } else {
          codeEl.appendChild(document.createTextNode(buf));
        }
        buf = '';
      }
      for (i = 0; i < ln.text.length; i++) {
        var c = classAt(ln.start + i, focus);
        if (c !== cls) { flush(); cls = c; }
        buf += ln.text.charAt(i);
      }
      flush();
      if (!ln.text.length) codeEl.appendChild(document.createTextNode(' '));
      rowEl.appendChild(codeEl);
      box.appendChild(rowEl);
    });
    if (hot) keepVisible(box, hot);
  }

  function renderTokens(box, b, focus, onPick) {
    var hot = null;
    b.tokens.forEach(function (t, i) {
      var el = E('button', 'cx-item' + (i === focus.token ? ' on' : ''));
      el.type = 'button';
      el.tabIndex = -1;
      if (i === focus.token) el.setAttribute('aria-current', 'true');
      el.appendChild(E('span', 'cx-ttype', t.type));
      el.appendChild(E('span', 'cx-ttext', t.type === 'eof' ? '(end of input)' : t.text));
      el.appendChild(E('span', 'cx-tpos', t.line + ':' + t.col));
      el.addEventListener('click', function () { onPick(i); });
      box.appendChild(el);
      if (i === focus.token) hot = el;
    });
    keepVisible(box, hot);
  }

  function treePrefix(row) {
    var s = '';
    for (var d = 0; d < row.last.length; d++) {
      var isLast = row.last[d];
      if (d === row.last.length - 1) s += isLast ? '└─ ' : '├─ ';
      else s += isLast ? '   ' : '│  ';
    }
    return s;
  }

  function renderTree(box, b, focus, onPick) {
    var hot = null;
    b.nodes.forEach(function (row, i) {
      var el = E('button', 'cx-item cx-node' + (row.node.id === focus.nodeId ? ' on' : ''));
      el.type = 'button';
      el.tabIndex = -1;
      if (row.node.id === focus.nodeId) el.setAttribute('aria-current', 'true');
      el.appendChild(E('span', 'cx-pre', treePrefix(row)));
      el.appendChild(E('span', 'cx-lbl', nodeLabel(row.node)));
      if (row.label) el.appendChild(E('span', 'cx-role', row.label));
      if (row.node.type === 'Let' && typeof row.node.slot === 'number') {
        el.appendChild(E('span', 'cx-role', 'slot ' + row.node.slot));
      }
      el.addEventListener('click', function () { onPick(i); });
      box.appendChild(el);
      if (row.node.id === focus.nodeId) hot = el;
    });
    keepVisible(box, hot);
  }

  function chunkTitle(f) {
    if (f.index === 0) return 'chunk  main — the top-level script';
    return 'chunk  fn ' + f.name + '(' + f.params.join(', ') + ')';
  }

  /* In the pipeline panes an instruction is a control: clicking one selects it
     and moves everything else. In the run pane it is a read-out, so it is a
     plain element there — a disabled button would announce itself to a screen
     reader as an unavailable control, which is not what it is. */
  function opRow(ins, cls, clickable) {
    var el = E(clickable ? 'button' : 'div', 'cx-item cx-op' + (cls ? ' ' + cls : ''));
    if (clickable) {
      el.type = 'button';
      el.tabIndex = -1;
    } else {
      el.className += ' cx-static';
    }
    el.appendChild(E('span', 'cx-addr', padLeft(ins.i, 4)));
    el.appendChild(E('span', 'cx-mn', ins.op));
    el.appendChild(E('span', 'cx-arg', ins.a === null || ins.a === undefined ? '' : String(ins.a)));
    if (ins.hint) el.appendChild(E('span', 'cx-cmt', '; ' + ins.hint));
    return el;
  }

  function renderCode(box, b, focus, onPick, dimAfter) {
    var lastFn = -1, hot = null;
    b.ops.forEach(function (ins, gi) {
      if (ins.fn !== lastFn) {
        lastFn = ins.fn;
        box.appendChild(E('p', 'cx-chunk', chunkTitle(b.program.funcs[ins.fn])));
      }
      var cls = '';
      if (gi >= focus.opFrom && gi < focus.opTo) cls = 'on';
      else if (gi >= focus.nodeFrom && gi < focus.nodeTo) cls = 'near';
      var el = opRow(ins, cls, true);
      if (typeof dimAfter === 'number' && gi > dimAfter) el.className += ' cx-future';
      if (typeof ins.a === 'number' && (ins.op === 'JUMP' || ins.op === 'JUMP_IF_FALSE')) {
        el.title = 'target: instruction ' + padLeft(ins.a, 4) + ' of this chunk';
      }
      el.addEventListener('click', function () { onPick(gi); });
      box.appendChild(el);
      if (cls === 'on' && !hot) hot = el;
    });
    keepVisible(box, hot);
  }

  /* A caret under the offending column, which is the one thing every compiler
     error message should have and half of them still do not. Tabs are copied
     through into the caret line so the two stay aligned in a monospace font. */
  function renderError(box, b) {
    var e = b.error;
    var lines = splitLines(b.source);
    var idx = Math.max(0, Math.min(lines.length - 1, e.line - 1));
    var width = String(lines.length).length;

    box.appendChild(E('p', 'cx-errhead',
      stageName(e.stage) + ' error — line ' + e.line + ', column ' + e.col));

    function srcRow(n, cls) {
      if (n < 0 || n >= lines.length) return;
      var rowEl = E('div', 'cx-srcline' + (cls ? ' ' + cls : ''));
      rowEl.appendChild(E('span', 'cx-gutter', padLeft(n + 1, width)));
      rowEl.appendChild(E('span', 'cx-srccode', lines[n].text || ' '));
      box.appendChild(rowEl);
    }

    srcRow(idx - 1, 'cx-dim');
    srcRow(idx, '');

    var text = lines[idx] ? lines[idx].text : '';
    var lead = '';
    for (var i = 0; i < e.col - 1 && i < text.length; i++) {
      lead += text.charAt(i) === '\t' ? '\t' : ' ';
    }
    while (lead.length < e.col - 1) lead += ' ';
    var caret = '';
    for (var k = 0; k < e.length; k++) caret += '^';
    var caretRow = E('div', 'cx-srcline');
    caretRow.appendChild(E('span', 'cx-gutter', ''));
    var caretCode = E('span', 'cx-srccode');
    caretCode.appendChild(document.createTextNode(lead));
    caretCode.appendChild(E('span', 'cx-caret', caret));
    caretRow.appendChild(caretCode);
    box.appendChild(caretRow);

    box.appendChild(E('p', 'cx-errmsg', e.message));
  }

  /* ======================================================================== */
  /*  STYLES                                                                  */
  /* ------------------------------------------------------------------------ */
  /*  Scoped to .cx-* and injected once by the shell. Literal hexes rather     */
  /*  than site tokens, for the reason main.css already documents about the    */
  /*  multi-shell mount: these panels are one of the dark instruments and stay */
  /*  dark in both themes, so a token that flips underneath them would leave   */
  /*  light ink on a ground that never moved.                                 */
  /* ======================================================================== */

  var EXTRA_CSS = [
    '.cx-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}',
    '@media (max-width:1000px){.cx-grid{grid-template-columns:minmax(0,1fr);}}',
    '.cx-pane{display:flex;flex-direction:column;min-width:0;border:1px solid ' + CC.line +
      ';border-radius:10px;background:' + CC.bg0 + ';overflow:hidden;}',
    '.cx-pane-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;' +
      'padding:6px 10px;border-bottom:1px solid ' + CC.line + ';background:rgba(15,23,42,.6);}',
    '.cx-pane-title{margin:0;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.dim + ';}',
    '.cx-pane-meta{font-size:11px;color:' + CC.faint + ';white-space:nowrap;}',
    '.cx-body{position:relative;overflow:auto;max-height:17rem;min-height:6rem;padding:6px 4px 8px;}',
    '.cx-body-tall{max-height:22rem;}',
    '@media (max-width:640px){.cx-body{max-height:13rem;}}',

    '.cx-item{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;font:inherit;' +
      'font-size:12px;line-height:1.6;color:#cbd5e1;background:transparent;border:0;border-radius:5px;' +
      'padding:1px 6px;cursor:pointer;white-space:pre;}',
    '.cx-item:hover{background:rgba(56,189,248,.12);color:' + CC.ink + ';}',
    '.cx-item.near{background:rgba(56,189,248,.08);}',
    '.cx-item.on{background:rgba(56,189,248,.24);color:#eaf6ff;}',
    '.cx-item:focus-visible{outline:2px solid ' + CC.blue + ';outline-offset:-2px;}',
    '.cx-future{opacity:.32;}',
    '.cx-static{cursor:default;}',
    '.cx-static:hover{background:transparent;color:#cbd5e1;}',
    '.cx-static.on:hover{background:rgba(56,189,248,.24);color:#eaf6ff;}',

    '.cx-ttype{flex:0 0 4.4rem;color:' + CC.faint + ';}',
    '.cx-ttext{flex:1 1 auto;min-width:0;color:' + CC.cyan + ';overflow:hidden;text-overflow:ellipsis;}',
    '.cx-tpos{flex:0 0 auto;color:' + CC.faint + ';font-size:11px;}',

    '.cx-pre{color:#41597f;flex:0 0 auto;}',
    '.cx-lbl{flex:0 0 auto;}',
    '.cx-role{flex:0 0 auto;color:' + CC.faint + ';font-size:11px;}',

    '.cx-chunk{margin:8px 0 3px;padding:0 6px;font-size:11px;letter-spacing:.04em;' +
      'color:' + CC.amber + ';}',
    '.cx-addr{flex:0 0 2.6rem;color:' + CC.faint + ';}',
    '.cx-mn{flex:0 0 7.2rem;color:' + CC.cyan + ';}',
    '.cx-arg{flex:0 0 2.6rem;color:' + CC.ink + ';text-align:right;}',
    '.cx-cmt{flex:1 1 auto;min-width:0;color:' + CC.faint + ';overflow:hidden;text-overflow:ellipsis;}',

    '.cx-srcline{display:flex;gap:8px;font-size:12px;line-height:1.65;white-space:pre;padding:0 6px;}',
    '.cx-srcline.cx-dim{opacity:.5;}',
    '.cx-gutter{flex:0 0 auto;min-width:1.4rem;text-align:right;color:' + CC.faint + ';user-select:none;}',
    '.cx-srccode{flex:1 1 auto;min-width:0;color:#cbd5e1;}',
    '.cx-hit{background:rgba(56,189,248,.28);color:#eaf6ff;border-radius:3px;}',
    '.cx-near{background:rgba(56,189,248,.09);border-radius:3px;}',
    '.cx-caret{color:' + CC.red + ';font-weight:700;}',
    '.cx-errhead{margin:2px 6px 8px;font-size:12px;font-weight:700;color:' + CC.red + ';}',
    '.cx-errmsg{margin:10px 6px 2px;font-size:12px;line-height:1.65;color:#e8d5a8;}',
    '.cx-empty{margin:10px 8px;font-size:12px;line-height:1.65;color:' + CC.faint + ';}',

    '.cx-editor{display:block;width:100%;min-height:12rem;font:12px/1.6 ' + M.FONT + ';' +
      'color:' + CC.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:8px;' +
      'padding:8px;white-space:pre;overflow:auto;resize:vertical;}',
    '.cx-editor:focus{outline:2px solid ' + CC.blue + ';outline-offset:1px;}',

    '.cx-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
    '.cx-chip{padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;}',
    '.cx-chip-ok{background:rgba(52,211,153,.16);color:' + CC.green + ';}',
    '.cx-chip-no{background:rgba(252,165,165,.14);color:' + CC.red + ';}',
    '.cx-chip-warn{background:rgba(251,191,36,.16);color:' + CC.amber + ';}',
    '.cx-meta{font-size:11px;color:' + CC.faint + ';}',

    '.cx-out{margin:0;padding:8px 10px;font:12px/1.65 ' + M.FONT + ';color:#d7f7e6;' +
      'white-space:pre-wrap;word-break:break-word;}',
    '.cx-out-empty{color:' + CC.faint + ';}',
    '.cx-slot{display:flex;gap:8px;font-size:12px;line-height:1.6;padding:1px 6px;white-space:pre;}',
    '.cx-slot.top{background:rgba(251,191,36,.16);border-radius:5px;}',
    '.cx-slot-n{flex:0 0 2.2rem;color:' + CC.faint + ';}',
    '.cx-slot-name{flex:0 0 6rem;color:' + CC.dim + ';overflow:hidden;text-overflow:ellipsis;}',
    '.cx-slot-v{flex:1 1 auto;min-width:0;color:' + CC.ink + ';overflow:hidden;text-overflow:ellipsis;}',
    '.cx-frame{padding:4px 6px;border-left:2px solid #24344f;margin:0 0 4px;font-size:12px;line-height:1.55;}',
    '.cx-frame.live{border-left-color:' + CC.amber + ';background:rgba(251,191,36,.07);}',
    '.cx-frame b{font-weight:700;color:' + CC.cyan + ';}',
    '.cx-frame span{color:' + CC.faint + ';}',
    '.cx-ip{color:' + CC.amber + ';}'
  ].join('');

  /* ======================================================================== */
  /*  SHARED PANEL                                                            */
  /* ======================================================================== */

  function sharedPanel(host, onChange) {
    var g = group('Program');
    var ta = E('textarea', 'cx-editor');
    ta.value = STATE.source;
    ta.rows = 14;
    ta.spellcheck = false;
    ta.wrap = 'off';
    ta.maxLength = MAX_SOURCE;
    ta.setAttribute('aria-label', 'The program to compile');
    ta.addEventListener('input', function () {
      STATE.source = ta.value;
      syncEditors(ta);
      onChange();
    });
    EDITORS.push(ta);
    g.appendChild(ta);
    g.appendChild(E('p', 'oa-hint',
      'Numbers, strings, let, assignment, arithmetic with the usual precedence, comparisons, ' +
      'if / else, while, fn with parameters and recursion, print, and // comments. Functions are ' +
      'declared at the top level and see only their own parameters and locals — there are no closures.'));
    host.appendChild(g);

    var g2 = group('Example programs');
    var row = E('div', 'oa-btnrow');
    EXAMPLES.forEach(function (ex) {
      row.appendChild(button(ex.label, function () {
        STATE.source = ex.code;
        syncEditors(null);
        onChange();
      }));
    });
    g2.appendChild(row);
    host.appendChild(g2);
  }

  /* ======================================================================== */
  /*  FAMILY 1 — THE PIPELINE, FOUR PANES AT ONCE                             */
  /* ======================================================================== */

  function PipelineFamily() {
    this.key = 'pipeline';
    this.label = 'Compile';
    this.mode = 'lex';
    /* algoKey is the shell's own field, read in two places: to preselect the
       algorithm picker (hidden here, because algoOptions returns one entry) and
       to decide which compare() row is the current one. With the picker gone it
       is free, so it carries the stage being stepped and the summary table
       highlights the right row for nothing. */
    this.algoKey = 'lex';
    this.focus = null;
    this.modeButtons = [];
  }

  PipelineFamily.prototype.algoOptions = function () {
    return [{ key: 'pipeline', label: 'Source to bytecode' }];
  };

  PipelineFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.onChange = onChange;
    sharedPanel(host, onChange);

    var g = group('Step through');
    var row = E('div', 'oa-btnrow');
    MODES.forEach(function (m) {
      var b = button(m.label, function () { self.setMode(m.key); });
      self.modeButtons.push({ key: m.key, el: b });
      row.appendChild(b);
    });
    g.appendChild(row);
    g.appendChild(E('p', 'oa-hint',
      'This picks what the transport steps through. Whichever you choose, clicking anything in ' +
      'any pane moves the selection there and lights up the matching part of the other three. ' +
      'From the keyboard the transport below does the same job: the arrow keys step, and ' +
      'switching stage here keeps the selection where it was rather than starting over.'));
    host.appendChild(g);
    this.syncModeButtons();
  };

  PipelineFamily.prototype.syncModeButtons = function () {
    var self = this;
    this.modeButtons.forEach(function (m) {
      m.el.className = 'oa-btn' + (m.key === self.mode ? ' on' : '');
      m.el.setAttribute('aria-pressed', m.key === self.mode ? 'true' : 'false');
    });
  };

  PipelineFamily.prototype.setMode = function (key) {
    if (key === this.mode) return;
    var b = pipeline();
    var was = this.focus;
    this.mode = key;
    this.algoKey = key;
    this.syncModeButtons();
    if (this.onChange) this.onChange();
    if (SHELL) SHELL.goto(remap(b, was, key));
  };

  PipelineFamily.prototype.buildStage = function (host) {
    var grid = E('div', 'cx-grid');
    this.src = pane('Source');
    this.tok = pane('Tokens');
    this.tree = pane('Syntax tree');
    this.code = pane('Bytecode');
    grid.appendChild(this.src.wrap);
    grid.appendChild(this.tok.wrap);
    grid.appendChild(this.tree.wrap);
    grid.appendChild(this.code.wrap);
    host.appendChild(grid);
  };

  PipelineFamily.prototype.compute = function () {
    var b = pipeline();
    this.build = b;
    this.error = b.error
      ? stageName(b.error.stage) + ' error on line ' + b.error.line + ', column ' +
        b.error.col + ': ' + b.error.message
      : null;
    if (b.error) return 1;
    if (this.mode === 'lex') return Math.max(1, b.tokens.length);
    if (this.mode === 'parse') return Math.max(1, b.nodes.length);
    return Math.max(1, b.ops.length);
  };

  PipelineFamily.prototype.render = function (idx) {
    var self = this;
    var b = this.build;
    [this.src, this.tok, this.tree, this.code].forEach(function (p) { clear(p.body); });

    if (b.error) {
      renderError(this.src.body, b);
      this.src.meta.textContent = 'stopped at the ' + b.error.stage;
      [this.tok, this.tree, this.code].forEach(function (p) { p.meta.textContent = ''; });
      if (b.error.stage !== 'lexer') {
        this.tok.body.appendChild(E('p', 'cx-empty',
          'The lexer finished; the tokens are fine. It is the shape they are in that the next ' +
          'stage could not use.'));
      } else {
        this.tok.body.appendChild(E('p', 'cx-empty', 'The lexer stopped here, so there is no token stream.'));
      }
      this.tree.body.appendChild(E('p', 'cx-empty', 'No tree — the parser never finished one.'));
      this.code.body.appendChild(E('p', 'cx-empty', 'No bytecode. Nothing is emitted until the tree is complete.'));
      return;
    }

    var focus = focusOf(b, this.mode, idx);
    this.focus = focus;

    renderSource(this.src.body, b, focus);
    renderTokens(this.tok.body, b, focus, function (i) { SHELL.goto(frameForToken(b, self.mode, i)); });
    renderTree(this.tree.body, b, focus, function (i) {
      SHELL.goto(frameForNode(b, self.mode, b.nodes[i]));
    });
    renderCode(this.code.body, b, focus, function (i) { SHELL.goto(frameForOp(b, self.mode, i)); },
               this.mode === 'emit' ? idx : null);

    this.src.meta.textContent = b.source.length + ' characters';
    this.tok.meta.textContent = (this.mode === 'lex' ? 'step ' + (idx + 1) + ' of ' : '') +
      b.tokens.length + ' tokens';
    this.tree.meta.textContent = (this.mode === 'parse' ? 'step ' + (idx + 1) + ' of ' : '') +
      b.nodes.length + ' nodes';
    this.code.meta.textContent = (this.mode === 'emit' ? 'step ' + (idx + 1) + ' of ' : '') +
      b.ops.length + ' instructions';
  };

  PipelineFamily.prototype.note = function (idx) {
    var b = this.build;
    if (!b) return '';
    if (b.error) {
      return b.error.message + ' The caret in the source pane is under the exact column the ' +
        stageName(b.error.stage).toLowerCase() + 'er stopped at. Everything before it was fine, ' +
        'which is why the position matters more than the message.';
    }
    if (this.mode === 'lex') {
      var t = b.tokens[Math.min(idx, b.tokens.length - 1)];
      if (!t) return '';
      if (t.type === 'eof') {
        return 'The end-of-input token. The lexer produces one so that the parser can report ' +
          '"the program ends in the middle of an expression" as a position like any other, ' +
          'rather than as a special case.';
      }
      return 'Token ' + (t.index + 1) + ' of ' + b.tokens.length + ': a ' + t.type +
        ' spelling ' + JSON.stringify(t.text) + ', at line ' + t.line + ' column ' + t.col +
        '. The lexer is one left-to-right pass with a single character of lookahead and no ' +
        'knowledge of grammar at all, which is why nonsense like "print print" lexes perfectly ' +
        'and only falls over one stage later.';
    }
    if (this.mode === 'parse') {
      var row = b.nodes[Math.min(idx, b.nodes.length - 1)];
      if (!row) return '';
      var ops = (typeof row.node.opFn === 'number') ? (row.node.opEnd - row.node.opStart) : 0;
      var where = row.node.type === 'Let' && typeof row.node.slot === 'number'
        ? ' It costs no instruction of its own: the value its initialiser leaves on the stack ' +
          'IS the variable, in slot ' + row.node.slot + '.'
        : '';
      return 'Node ' + (idx + 1) + ' of ' + b.nodes.length + ', depth ' + row.depth + ': ' +
        nodeLabel(row.node) + '. It covers characters ' + row.node.start + ' to ' + row.node.end +
        ' of the source and produced ' + ops + ' instruction' + (ops === 1 ? '' : 's') +
        ', children included.' + where;
    }
    var ins = b.ops[Math.min(idx, b.ops.length - 1)];
    if (!ins) return '';
    var owner = b.nodeById[ins.node];
    return 'Instruction ' + (idx + 1) + ' of ' + b.ops.length + ': ' + describe(ins, b) +
      (owner ? ' It was emitted for the ' + nodeLabel(owner.node) + ' on line ' + ins.line + '.' : '');
  };

  PipelineFamily.prototype.compare = function () {
    var b = this.build;
    if (!b || b.error) return null;
    return {
      title: 'This program at every stage',
      head: ['Stage', 'What it produces', 'How many', 'Cost'],
      rows: [
        { key: 'lex', cells: ['Lexer', 'tokens', b.tokens.length, 'one pass, linear'] },
        { key: 'parse', cells: ['Parser', 'syntax tree nodes', b.nodes.length, 'one pass, linear'] },
        { key: 'emit', cells: ['Emitter', 'bytecode instructions', b.ops.length,
                               b.program.funcs.length + ' chunk' + (b.program.funcs.length === 1 ? '' : 's')] }
      ]
    };
  };

  /* ======================================================================== */
  /*  WHAT ONE INSTRUCTION DOES                                               */
  /* ------------------------------------------------------------------------ */
  /*  Written out longhand rather than as a table of one-word glosses: the     */
  /*  sentence under the transport is where somebody who has never seen a      */
  /*  stack machine learns what a stack machine is.                           */
  /* ======================================================================== */

  function describe(ins, b) {
    var funcs = b.program.funcs;
    var chunk = funcs[ins.fn];
    switch (ins.op) {
      case 'CONST':
        return 'CONST ' + ins.a + ' pushes constant ' + ins.a + ' of this chunk, which is ' +
          showValue(chunk.consts[ins.a], funcs) + '. Literals live in a pool per chunk, so the ' +
          'instruction stays a fixed size however long the string is.';
      case 'NIL': return 'NIL pushes nil.';
      case 'TRUE': return 'TRUE pushes true.';
      case 'FALSE': return 'FALSE pushes false.';
      case 'FN':
        return 'FN ' + ins.a + ' pushes the function ' + funcs[ins.a].name +
          '. A call needs the callee under its arguments, so this always comes first.';
      case 'POP': return 'POP discards the top of the stack.';
      case 'GET_LOCAL':
        return 'GET_LOCAL ' + ins.a + ' copies slot ' + ins.a + ' of the current frame onto the ' +
          'top of the stack. A local variable is not stored anywhere else — the slot IS the ' +
          'variable, at a fixed offset from this frame’s base.';
      case 'SET_LOCAL':
        return 'SET_LOCAL ' + ins.a + ' writes the top of the stack into slot ' + ins.a +
          ' without popping it, because assignment is an expression and something may still want ' +
          'its value.';
      case 'PRINT': return 'PRINT pops one value and writes it to the output.';
      case 'JUMP':
        return 'JUMP sets the instruction pointer to ' + padLeft(ins.a, 4) + '. ' +
          (ins.a <= ins.i ? 'It goes backwards, which is the entire mechanism of a loop.'
                          : 'It goes forwards, over code that is not to run this time.');
      case 'JUMP_IF_FALSE':
        return 'JUMP_IF_FALSE pops the condition and, if it was false or nil, jumps to ' +
          padLeft(ins.a, 4) + '. If it was anything else, execution simply carries on.';
      case 'ADD': return 'ADD pops two values and pushes their sum, or their concatenation if ' +
        'either side is a string.';
      case 'SUB': return 'SUB pops two numbers and pushes the first minus the second. Order ' +
        'matters, and the order is the order they were pushed.';
      case 'MUL': return 'MUL pops two numbers and pushes their product.';
      case 'DIV': return 'DIV pops two numbers and pushes the quotient, or fails if the divisor is zero.';
      case 'MOD': return 'MOD pops two numbers and pushes the remainder.';
      case 'NEG': return 'NEG replaces the top of the stack with its negation.';
      case 'NOT': return 'NOT replaces the top of the stack with true if it was false or nil, ' +
        'and false otherwise.';
      case 'EQ': return 'EQ pops two values and pushes whether they are equal.';
      case 'NEQ': return 'NEQ pops two values and pushes whether they differ.';
      case 'LT': return 'LT pops two numbers and pushes whether the first is smaller.';
      case 'LE': return 'LE pops two numbers and pushes whether the first is smaller or equal.';
      case 'GT': return 'GT pops two numbers and pushes whether the first is larger.';
      case 'GE': return 'GE pops two numbers and pushes whether the first is larger or equal.';
      case 'CALL':
        return 'CALL ' + ins.a + ' pushes a new frame. The callee and its ' + ins.a + ' argument' +
          (ins.a === 1 ? '' : 's') + ' are already on the stack, and the new frame’s base is ' +
          'set to the first argument — so slot 0 of the callee is that argument, with nothing copied.';
      case 'RET':
        return 'RET pops the return value, throws away everything this frame owned including the ' +
          'callee slot, and pushes the value where the callee used to be. The caller finds it ' +
          'exactly where it expected.';
      case 'HALT': return 'HALT ends the program.';
      default: return ins.op + ' ' + (ins.a === null ? '' : ins.a);
    }
  }

  /* ======================================================================== */
  /*  FAMILY 2 — RUNNING IT                                                   */
  /* ======================================================================== */

  function VmFamily() {
    this.key = 'run';
    this.label = 'Run';
    this.algoKey = 'run';
  }

  VmFamily.prototype.algoOptions = function () {
    return [{ key: 'run', label: 'Step the stack machine' }];
  };

  VmFamily.prototype.buildPanel = function (host, onChange) {
    sharedPanel(host, onChange);
    var g = group('How to drive it');
    g.appendChild(E('p', 'oa-hint',
      'Play runs to completion at whatever speed the slider is set to; the step buttons and the ' +
      'arrow keys move one instruction at a time, forwards or backwards. Every step is recorded ' +
      'before it runs, so stepping backwards is exact rather than a re-simulation.'));
    g.appendChild(E('p', 'oa-hint',
      'The machine stops after ' + MAX_STEPS + ' recorded instructions, at ' + MAX_CALL_DEPTH +
      ' call frames, or at ' + MAX_VALUE_STACK + ' values on the stack. Each of those ends as a ' +
      'message with the stack still readable, not as a frozen tab.'));
    host.appendChild(g);
  };

  VmFamily.prototype.buildStage = function (host) {
    this.chips = E('div', 'cx-chips');
    host.appendChild(this.chips);

    var top = E('div', 'cx-grid');
    this.out = pane('Output');
    this.src = pane('Source');
    top.appendChild(this.out.wrap);
    top.appendChild(this.src.wrap);
    host.appendChild(top);

    var mid = E('div', 'cx-grid');
    this.stack = pane('Value stack');
    this.frames = pane('Call frames');
    mid.appendChild(this.stack.wrap);
    mid.appendChild(this.frames.wrap);
    host.appendChild(mid);

    this.code = pane('Instructions');
    this.code.body.className = 'cx-body cx-body-tall';
    host.appendChild(this.code.wrap);
  };

  VmFamily.prototype.compute = function () {
    var b = pipeline();
    this.build = b;
    this.vm = null;
    if (b.error) {
      this.error = stageName(b.error.stage) + ' error on line ' + b.error.line + ', column ' +
        b.error.col + ': ' + b.error.message + ' Nothing runs until that is fixed.';
      return 1;
    }
    this.vm = vmOf(b);
    if (this.vm.fatal) {
      this.error = 'The virtual machine stopped unexpectedly: ' + this.vm.fatal +
        '. That is a bug in this page rather than in your program — please tell me what you ran.';
      return 1;
    }
    if (this.vm.error) this.error = 'Runtime error: ' + this.vm.error.message;
    else if (this.vm.stopped === 'limit') {
      this.error = 'Stopped after ' + MAX_STEPS + ' instructions without finishing. Every step is ' +
        'recorded so you can scrub backwards, and that record has to end somewhere.';
    } else this.error = null;
    return Math.max(1, this.vm.trace.length);
  };

  VmFamily.prototype.render = function (idx) {
    var self = this;
    var b = this.build;
    var boxes = [this.out, this.src, this.stack, this.frames, this.code];
    boxes.forEach(function (p) { clear(p.body); p.meta.textContent = ''; });
    clear(this.chips);

    if (b.error) {
      renderError(this.src.body, b);
      this.out.body.appendChild(E('p', 'cx-empty', 'Nothing ran, so nothing was printed.'));
      this.stack.body.appendChild(E('p', 'cx-empty', 'The machine was never started.'));
      this.frames.body.appendChild(E('p', 'cx-empty', 'No frames.'));
      this.code.body.appendChild(E('p', 'cx-empty', 'No bytecode was emitted.'));
      this.chips.appendChild(E('span', 'cx-chip cx-chip-no', 'DID NOT COMPILE'));
      return;
    }
    var vm = this.vm;
    if (!vm || !vm.trace.length) {
      this.out.body.appendChild(E('p', 'cx-empty', 'Nothing to run.'));
      return;
    }

    var entry = vm.trace[Math.min(idx, vm.trace.length - 1)];
    var funcs = b.program.funcs;

    /* --- status ------------------------------------------------------- */
    if (entry.error) {
      this.chips.appendChild(E('span', 'cx-chip cx-chip-no', 'RUNTIME ERROR'));
    } else if (entry.limit) {
      this.chips.appendChild(E('span', 'cx-chip cx-chip-warn', 'STOPPED AT THE LIMIT'));
    } else if (entry.done) {
      this.chips.appendChild(E('span', 'cx-chip cx-chip-ok', 'FINISHED'));
    } else {
      this.chips.appendChild(E('span', 'cx-chip cx-chip-warn', 'RUNNING'));
    }
    this.chips.appendChild(E('span', 'cx-meta',
      'instruction ' + (idx + 1) + ' of ' + vm.trace.length + ' · ' + vm.calls + ' call' +
      (vm.calls === 1 ? '' : 's') + ' · deepest ' + vm.maxDepth + ' frames · tallest stack ' +
      vm.maxStack + ' values'));

    /* --- output ------------------------------------------------------- */
    if (entry.outLen) {
      this.out.body.appendChild(E('pre', 'cx-out', vm.out.slice(0, entry.outLen).join('\n')));
      this.out.meta.textContent = entry.outLen + ' line' + (entry.outLen === 1 ? '' : 's');
    } else {
      this.out.body.appendChild(E('p', 'cx-out cx-out-empty', 'Nothing printed yet.'));
    }

    /* --- source ------------------------------------------------------- */
    var focus = emptyFocus('run', idx);
    if (entry.ins) {
      focus.srcStart = entry.ins.start;
      focus.srcEnd = entry.ins.end;
      var row = b.nodeById[entry.ins.node];
      var stmt = row ? statementOf(row) : null;
      if (stmt) { focus.stmtStart = stmt.start; focus.stmtEnd = stmt.end; }
      this.src.meta.textContent = 'line ' + entry.ins.line;
    }
    renderSource(this.src.body, b, focus);

    /* --- the value stack, bottom slot first --------------------------- */
    var owners = [];
    entry.frames.forEach(function (f) { owners.push(f); });
    for (var i = 0; i < entry.stack.length; i++) {
      var el = E('div', 'cx-slot' + (i === entry.stack.length - 1 ? ' top' : ''));
      el.appendChild(E('span', 'cx-slot-n', String(i)));
      el.appendChild(E('span', 'cx-slot-name', slotName(owners, funcs, i)));
      el.appendChild(E('span', 'cx-slot-v', showValue(entry.stack[i], funcs)));
      this.stack.body.appendChild(el);
      if (i === entry.stack.length - 1) keepVisible(this.stack.body, el);
    }
    if (!entry.stack.length) this.stack.body.appendChild(E('p', 'cx-empty', 'The stack is empty.'));
    this.stack.meta.textContent = entry.stack.length + ' value' + (entry.stack.length === 1 ? '' : 's');

    /* --- call frames, innermost last ---------------------------------- */
    entry.frames.forEach(function (f, n) {
      var live = n === entry.frames.length - 1;
      var el = E('div', 'cx-frame' + (live ? ' live' : ''));
      var head = E('p', null);
      head.style.margin = '0';
      head.appendChild(E('b', null, funcs[f.fn].name + '(' + funcs[f.fn].params.join(', ') + ')'));
      el.appendChild(head);
      var at = live ? f.ip : Math.max(0, f.ip - 1);
      var here = funcs[f.fn].code[at];
      var line = E('p', null);
      line.style.margin = '0';
      line.appendChild(E('span', null, 'base ' + f.base + ' · '));
      line.appendChild(E('span', 'cx-ip', 'ip ' + padLeft(f.ip, 4)));
      if (here) {
        line.appendChild(E('span', null, ' · ' + (live ? 'about to run ' : 'waiting on ') +
          here.op + (here.a === null ? '' : ' ' + here.a) + ', line ' + here.line));
      }
      el.appendChild(line);
      self.frames.body.appendChild(el);
      if (live) keepVisible(self.frames.body, el);
    });
    if (!entry.frames.length) {
      this.frames.body.appendChild(E('p', 'cx-empty', 'No frames left — the program is over.'));
    }
    this.frames.meta.textContent = entry.frames.length + ' deep';

    if (entry.error) {
      var box = E('div');
      box.appendChild(E('p', 'cx-errhead', 'Runtime error: ' + entry.error.message));
      var listHead = E('p', 'cx-empty', 'Call stack at the moment it failed, innermost first:');
      box.appendChild(listHead);
      var stackFrames = entry.error.frames.slice();
      stackFrames.reverse();
      stackFrames.forEach(function (f) {
        var here = funcs[f.fn].code[Math.max(0, f.ip - 1)];
        box.appendChild(E('p', 'cx-errmsg', '  in ' + funcs[f.fn].name +
          (here ? ', line ' + here.line + ', at ' + here.op : '')));
      });
      this.frames.body.appendChild(box);
    }

    /* --- the chunk being executed ------------------------------------- */
    var fn = funcs[entry.fn];
    this.code.body.appendChild(E('p', 'cx-chunk', chunkTitle(fn)));
    var hot = null;
    fn.code.forEach(function (ins, i) {
      var cls = (i === entry.ip && !entry.done) ? 'on' : '';
      var el = opRow(ins, cls, false);
      if (cls) hot = el;
      self.code.body.appendChild(el);
    });
    keepVisible(this.code.body, hot);
    this.code.meta.textContent = 'ip ' + padLeft(entry.ip, 4) + ' of ' + fn.code.length;
  };

  /* Which frame owns stack index i, and what the compiler called that slot.
     Slots are reused as blocks come and go, so the name is the last one the
     compiler put there — right for every example here, and honest about being
     a label rather than something the machine knows. */
  function slotName(frames, funcs, i) {
    var owner = null;
    for (var n = 0; n < frames.length; n++) {
      if (frames[n].base <= i) owner = frames[n];
      if (frames[n].base - 1 === i) return 'callee';
    }
    if (!owner) return '';
    var slot = i - owner.base;
    var name = funcs[owner.fn].slotNames[slot];
    return name ? funcs[owner.fn].name + '.' + name : '';
  }

  VmFamily.prototype.note = function (idx) {
    var b = this.build;
    if (!b) return '';
    if (b.error) return this.error || '';
    var vm = this.vm;
    if (!vm || !vm.trace.length) return this.error || '';
    var entry = vm.trace[Math.min(idx, vm.trace.length - 1)];

    if (entry.error) {
      return 'The machine stopped: ' + entry.error.message + '. The call frames beside the stack ' +
        'are the ones that were open at that instant, innermost last — which is exactly what a ' +
        'stack trace in any language is printing when it prints one.';
    }
    if (entry.limit) {
      return 'Stopped after ' + vm.steps + ' instructions without reaching HALT. On a machine with ' +
        'no such ceiling this program would still be running.';
    }
    if (entry.done) {
      return 'Finished after ' + vm.steps + ' instructions, ' + vm.calls + ' call' +
        (vm.calls === 1 ? '' : 's') + ' and a deepest nesting of ' + vm.maxDepth + ' frames. ' +
        'The stack is back to one value, the main function itself, which is how you know nothing ' +
        'was left behind.';
    }
    return describe(entry.ins, b) + ' Frame ' + entry.frames.length + ', ip ' +
      padLeft(entry.ip, 4) + ', from line ' + entry.ins.line + '.';
  };

  VmFamily.prototype.compare = function () {
    var b = this.build;
    var vm = this.vm;
    if (!b || b.error || !vm || vm.fatal) return null;
    return {
      title: 'Every function this program compiled to',
      head: ['Function', 'Parameters', 'Instructions', 'Constants', 'Times called'],
      rows: b.program.funcs.map(function (f) {
        return {
          key: 'fn' + f.index,
          cells: [f.index === 0 ? 'main (the script)' : f.name,
                  f.index === 0 ? '—' : f.params.join(', ') || 'none',
                  f.code.length, f.consts.length,
                  f.index === 0 ? 'once, at startup' : vm.callCounts[f.index]]
        };
      })
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ------------------------------------------------------------------------ */
  /*  Not LabVizMulti.boot, which builds the shell and drops the reference.    */
  /*  Every pane on this page is clickable and a click has to move the         */
  /*  transport, so the Shell instance has to be kept. Everything else here is */
  /*  the same contract boot() implements, including saying so on the page     */
  /*  rather than only in the console when construction throws.                */
  /* ======================================================================== */

  function start() {
    var rootEl = document.getElementById('compilerviz');
    if (!rootEl || SHELL) return;
    var mount = document.getElementById('viz-compiler-mount') || rootEl;
    clear(mount);
    try {
      SHELL = new M.Shell(mount, [new PipelineFamily(), new VmFamily()], EXTRA_CSS);
    } catch (err) {
      mount.appendChild(E('p', 'lab-proc-fallback',
        'The compiler visualiser could not start in this browser (' + err.message +
        '). Please tell me, and mention which browser you are using.'));
    }
  }

  if (root.LabViz && root.LabViz.define) {
    root.LabViz.define({ id: 'compilerviz', onReady: start });
  } else if (document.readyState !== 'loading') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})(typeof self !== 'undefined' ? self : this);

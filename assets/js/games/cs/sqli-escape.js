/* ==========================================================================
   sqli-escape.js — an escape room over a toy in-page SQL database.
   --------------------------------------------------------------------------
   THE DATABASE AND ITS SQL PARSER ARE REAL; NOTHING ELSE ABOUT THEM IS.
   There is a genuine little engine in here — a tokeniser, a recursive-descent
   parser for SELECT with WHERE, AND/OR, comparisons, LIKE, UNION SELECT,
   ORDER BY, LIMIT, string functions and both comment syntaxes — running over
   five arrays of plain objects that live in this closure and nowhere else.
   When the player breaks out of a quote, the injected SQL is tokenised,
   parsed and executed exactly like the rest of the query, because that is the
   only thing that teaches anything: a diagram of an attack teaches you the
   diagram, and a query that actually returns the admin row teaches you the
   attack. No network call is made, no real database is touched, and there is
   no way for any of this to reach one — the point is made against a target
   that is safe precisely because it is a toy.

   WHY THE ASSEMBLED QUERY IS ON SCREEN AS YOU TYPE. The single most effective
   teaching device available here is the string the server would build. The
   template is drawn dim; the characters the player typed are drawn bright, so
   the moment a stray quote turns the rest of the line into code is visible as
   it happens rather than explained afterwards. Every room ends by showing the
   parameterised query that would have stopped it, with the placeholder and
   the bound value on separate lines, because the whole lesson reduces to one
   sentence: the value travels on a different channel from the query text, so
   the database can never be talked into reading it as code.

   FOUR ROOMS, EACH THE REAL TECHNIQUE AND NOT A CARTOON OF IT.
     1. Login bypass — break the quote, comment out the password check.
     2. UNION SELECT — find the column count first, then the compatible types,
        then read another table, because that is the actual order of the work.
     3. Blind boolean — no output, only "found" or "not found"; the value
        comes out one character at a time through a comparison.
     4. Time-based — the same, but the only signal is a delay, and the SLEEP
        is SIMULATED in this tab: a setTimeout holds the answer back so the
        clock is the channel. It is said plainly on the page that nothing is
        actually blocking a server.

   A note on scope and ethics, because a page about injection has to be clear
   about it: this is a defensive teaching tool. Every payload here is aimed at
   the toy tables above and could not be aimed anywhere else. There is no
   product named, no filter-evasion catalogue and no exfiltration tooling —
   the deliverable of the whole game is the prepared statement at the end of
   each room. The prose links /labs/sql and /labs/sqlite-browser next door.

   SCORING IS QUERIES SENT, LOWER IS BETTER. An attacker pays for every
   request, and a clean run is a small number of well-chosen ones — a binary
   search on the blind rooms rather than a march through the alphabet. So the
   best kept on this device is the query count, and bestOrder is 'low', which
   the module passes to GameShell.define as well as the manifest declaring,
   or the shell would default to 'higher is better' and record the sloppiest
   run as the record.

   STYLES ARE INJECTED, id-scoped, from here. Every other game leans on a
   block in games.css; this one ships its rules in a <style> node built in
   setup() instead, so the whole game is the two files it was asked to be and
   depends on no central stylesheet edit. The CSP allows 'unsafe-inline' for
   style and forbids it for script, which is exactly why this is a style node
   and nothing in this file is ever built from a string and run.

   ES5 only, per the rest of assets/js: var, no arrow functions, no template
   literals, no class. Arrow keys are never bound — all typing goes through
   the rooms' own inputs, and rawInput opts the shell's key handling out.
   ========================================================================== */

/* global GameShell */
(function () {
  'use strict';

  /* ==================================================================
     THE ENGINE. Tokeniser, parser, evaluator. Verified against every
     room's solution payload before it went in; see the note above.
     ================================================================== */

  function SqlError(msg) { this.name = 'SqlError'; this.message = msg; }
  SqlError.prototype = new Error();

  var KEYWORDS = {
    SELECT: 1, FROM: 1, WHERE: 1, AND: 1, OR: 1, NOT: 1, UNION: 1, ALL: 1,
    ORDER: 1, BY: 1, LIMIT: 1, LIKE: 1, 'NULL': 1, 'TRUE': 1, 'FALSE': 1,
    AS: 1, ASC: 1, DESC: 1, DISTINCT: 1
  };

  function isIdentStart(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  }
  function isIdentChar(c) {
    return isIdentStart(c) || (c >= '0' && c <= '9');
  }

  /* -- tokeniser -------------------------------------------------------
     Both comment forms are handled here rather than in the parser, which
     is where a real lexer draws the line: by the time the parser sees the
     tokens, a "-- " that ate the rest of the line has already vanished,
     which is precisely why appending "-- " to a payload silences the
     trailing quote the template was about to add. */
  function tokenise(sql) {
    var toks = [];
    var i = 0, n = sql.length;
    while (i < n) {
      var c = sql.charAt(i);
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '-' && sql.charAt(i + 1) === '-') {
        while (i < n && sql.charAt(i) !== '\n') i++;
        continue;
      }
      if (c === '#') {                      /* MySQL's line comment, for good measure */
        while (i < n && sql.charAt(i) !== '\n') i++;
        continue;
      }
      if (c === '/' && sql.charAt(i + 1) === '*') {
        i += 2;
        while (i < n && !(sql.charAt(i) === '*' && sql.charAt(i + 1) === '/')) i++;
        if (i >= n) throw new SqlError('unterminated /* comment */');
        i += 2;
        continue;
      }
      if (c === "'") {
        i++;
        var s = '';
        var closed = false;
        while (i < n) {
          var ch = sql.charAt(i);
          if (ch === "'") {
            /* '' is an escaped quote inside a string, the standard SQL way —
               so a payload cannot be defused just by doubling quotes, which
               is half the reason hand-escaping is a losing game. */
            if (sql.charAt(i + 1) === "'") { s += "'"; i += 2; continue; }
            closed = true; i++; break;
          }
          s += ch; i++;
        }
        if (!closed) throw new SqlError('unterminated string literal (an odd number of quotes)');
        toks.push({ t: 'str', v: s });
        continue;
      }
      if (c >= '0' && c <= '9') {
        var num = '';
        while (i < n && ((sql.charAt(i) >= '0' && sql.charAt(i) <= '9') || sql.charAt(i) === '.')) {
          num += sql.charAt(i); i++;
        }
        toks.push({ t: 'num', v: parseFloat(num) });
        continue;
      }
      if (isIdentStart(c)) {
        var id = '';
        while (i < n && isIdentChar(sql.charAt(i))) { id += sql.charAt(i); i++; }
        var up = id.toUpperCase();
        if (KEYWORDS[up]) toks.push({ t: 'kw', v: up });
        else toks.push({ t: 'id', v: id });
        continue;
      }
      var two = sql.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
        toks.push({ t: 'op', v: two === '!=' ? '<>' : two }); i += 2; continue;
      }
      if (c === '=' || c === '<' || c === '>') { toks.push({ t: 'op', v: c }); i++; continue; }
      if (c === '*') { toks.push({ t: 'star' }); i++; continue; }
      if (c === '(' || c === ')' || c === ',' || c === ';' || c === '.') {
        toks.push({ t: 'punct', v: c }); i++; continue;
      }
      throw new SqlError("unrecognised character '" + c + "'");
    }
    toks.push({ t: 'eof' });
    return toks;
  }

  /* -- parser ---------------------------------------------------------- */
  function Parser(toks) { this.toks = toks; this.at = 0; }
  Parser.prototype.peek = function () { return this.toks[this.at]; };
  Parser.prototype.next = function () { return this.toks[this.at++]; };
  Parser.prototype.isKw = function (kw) { var t = this.peek(); return t.t === 'kw' && t.v === kw; };
  Parser.prototype.eatKw = function (kw) { if (this.isKw(kw)) { this.at++; return true; } return false; };
  Parser.prototype.expectKw = function (kw) { if (!this.eatKw(kw)) throw new SqlError('expected ' + kw); };
  Parser.prototype.isPunct = function (p) { var t = this.peek(); return t.t === 'punct' && t.v === p; };
  Parser.prototype.eatPunct = function (p) { if (this.isPunct(p)) { this.at++; return true; } return false; };
  Parser.prototype.expectPunct = function (p) { if (!this.eatPunct(p)) throw new SqlError("expected '" + p + "'"); };

  Parser.prototype.parseQuery = function () {
    var selects = [this.parseSelect()];
    var unionAll = [];
    while (this.eatKw('UNION')) {
      unionAll.push(this.eatKw('ALL'));
      this.expectKw('SELECT');
      selects.push(this.parseSelect(true));
    }
    /* ORDER BY and LIMIT bind to the whole UNION and so are parsed once,
       here, after the last SELECT — which is why ORDER BY n against a
       three-column products query is what tells the attacker there are
       three columns. */
    var orderBy = null;
    if (this.eatKw('ORDER')) {
      this.expectKw('BY');
      var key = this.parseOrderKey();
      var dir = 'asc';
      if (this.eatKw('DESC')) dir = 'desc';
      else this.eatKw('ASC');
      orderBy = { key: key, dir: dir };
    }
    var limit = null;
    if (this.eatKw('LIMIT')) {
      var lt = this.next();
      if (lt.t !== 'num') throw new SqlError('LIMIT wants a number');
      limit = lt.v | 0;
    }
    this.eatPunct(';');
    return { selects: selects, unionAll: unionAll, orderBy: orderBy, limit: limit };
  };

  Parser.prototype.parseOrderKey = function () {
    var t = this.peek();
    if (t.t === 'num') { this.at++; return { ord: t.v | 0 }; }
    if (t.t === 'id') { this.at++; return { col: t.v }; }
    throw new SqlError('ORDER BY wants a column name or a position number');
  };

  Parser.prototype.parseSelect = function (selectAlreadyEaten) {
    if (!selectAlreadyEaten) this.expectKw('SELECT');
    this.eatKw('DISTINCT');
    this.eatKw('ALL');
    var cols;
    if (this.peek().t === 'star') { this.at++; cols = '*'; }
    else {
      cols = [];
      do {
        var e = this.parseExpr();
        var alias = null;
        if (this.eatKw('AS')) { alias = this.next().v; }
        cols.push({ expr: e, alias: alias });
      } while (this.eatPunct(','));
    }
    var from = null;
    if (this.eatKw('FROM')) {
      var ft = this.next();
      if (ft.t !== 'id') throw new SqlError('expected a table name after FROM');
      from = ft.v;
    }
    var where = null;
    if (this.eatKw('WHERE')) where = this.parseExpr();
    return { cols: cols, from: from, where: where };
  };

  /* Precedence: OR below AND below NOT below comparison/LIKE below primary. */
  Parser.prototype.parseExpr = function () { return this.parseOr(); };
  Parser.prototype.parseOr = function () {
    var a = this.parseAnd();
    while (this.eatKw('OR')) { a = { k: 'or', a: a, b: this.parseAnd() }; }
    return a;
  };
  Parser.prototype.parseAnd = function () {
    var a = this.parseNot();
    while (this.eatKw('AND')) { a = { k: 'and', a: a, b: this.parseNot() }; }
    return a;
  };
  Parser.prototype.parseNot = function () {
    if (this.eatKw('NOT')) return { k: 'not', a: this.parseNot() };
    return this.parseCmp();
  };
  Parser.prototype.parseCmp = function () {
    var a = this.parsePrimary();
    var t = this.peek();
    if (t.t === 'op') {
      this.at++;
      return { k: 'binop', op: t.v, a: a, b: this.parsePrimary() };
    }
    if (t.t === 'kw' && t.v === 'LIKE') {
      this.at++;
      return { k: 'like', a: a, b: this.parsePrimary() };
    }
    if (t.t === 'kw' && t.v === 'NOT') {
      var save = this.at;
      this.at++;
      if (this.isKw('LIKE')) {
        this.at++;
        return { k: 'not', a: { k: 'like', a: a, b: this.parsePrimary() } };
      }
      this.at = save;
    }
    return a;
  };
  Parser.prototype.parsePrimary = function () {
    var t = this.peek();
    if (t.t === 'punct' && t.v === '(') {
      this.at++;
      /* A parenthesised SELECT is a scalar subquery — this is what makes
         (SELECT token FROM users WHERE role='admin') usable inside a blind
         predicate, which is the whole mechanism of room three. */
      if (this.isKw('SELECT')) {
        var q = this.parseQuery();
        this.expectPunct(')');
        return { k: 'subquery', query: q };
      }
      var e = this.parseExpr();
      this.expectPunct(')');
      return e;
    }
    if (t.t === 'num') { this.at++; return { k: 'lit', v: t.v, type: 'num' }; }
    if (t.t === 'str') { this.at++; return { k: 'lit', v: t.v, type: 'text' }; }
    if (t.t === 'kw' && t.v === 'NULL') { this.at++; return { k: 'lit', v: null, type: 'null' }; }
    if (t.t === 'kw' && t.v === 'TRUE') { this.at++; return { k: 'lit', v: true, type: 'num' }; }
    if (t.t === 'kw' && t.v === 'FALSE') { this.at++; return { k: 'lit', v: false, type: 'num' }; }
    if (t.t === 'id') {
      this.at++;
      if (this.isPunct('(')) {
        this.at++;
        var args = [];
        if (!this.isPunct(')')) {
          do { args.push(this.parseExpr()); } while (this.eatPunct(','));
        }
        this.expectPunct(')');
        return { k: 'func', name: t.v.toUpperCase(), args: args };
      }
      /* Qualified names (t.c) collapse to the column — there is one table
         per query part here, so the qualifier is decorative. */
      var name = t.v;
      while (this.eatPunct('.')) { name = this.next().v; }
      return { k: 'col', name: name };
    }
    if (t.t === 'star') { this.at++; return { k: 'star' }; }
    throw new SqlError('unexpected token near ' + (t.v != null ? JSON.stringify(t.v) : t.t));
  };

  function parseSql(sql) {
    var p = new Parser(tokenise(sql));
    var q = p.parseQuery();
    if (p.peek().t !== 'eof') throw new SqlError('trailing tokens after the query');
    return q;
  }

  /* -- evaluation ------------------------------------------------------ */
  function truthy(v) {
    if (v === true) return true;
    if (v === false || v == null) return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    return !!v;
  }

  function cmp(a, b) {
    if (a == null || b == null) return null;    /* NULL compares to unknown */
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : (a > b ? 1 : 0);
    a = String(a); b = String(b);
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  function likeToRe(pat) {
    var out = '^';
    for (var i = 0; i < pat.length; i++) {
      var c = pat.charAt(i);
      if (c === '%') out += '[\\s\\S]*';
      else if (c === '_') out += '[\\s\\S]';
      else if ('\\^$.|?*+()[]{}'.indexOf(c) >= 0) out += '\\' + c;
      else out += c;
    }
    return new RegExp(out + '$');
  }

  function evalExpr(node, row, db, env) {
    switch (node.k) {
      case 'lit': return node.v;
      case 'col':
        if (!(node.name in row)) throw new SqlError('no such column: ' + node.name);
        return row[node.name];
      case 'binop': {
        var c = cmp(evalExpr(node.a, row, db, env), evalExpr(node.b, row, db, env));
        if (c == null) return null;
        switch (node.op) {
          case '=': return c === 0;
          case '<>': return c !== 0;
          case '<': return c < 0;
          case '>': return c > 0;
          case '<=': return c <= 0;
          case '>=': return c >= 0;
        }
        return null;
      }
      case 'and': {
        /* Short-circuit is load-bearing in the time-based room: SLEEP on the
           right of an AND runs only when the left is true, which is what
           turns one bit of the secret into one second of delay. */
        if (!truthy(evalExpr(node.a, row, db, env))) return false;
        return truthy(evalExpr(node.b, row, db, env));
      }
      case 'or': {
        if (truthy(evalExpr(node.a, row, db, env))) return true;
        return truthy(evalExpr(node.b, row, db, env));
      }
      case 'not': return !truthy(evalExpr(node.a, row, db, env));
      case 'like': {
        var s = evalExpr(node.a, row, db, env);
        var pat = evalExpr(node.b, row, db, env);
        if (s == null || pat == null) return null;
        return likeToRe(String(pat)).test(String(s));
      }
      case 'subquery': {
        env.depth = (env.depth || 0) + 1;
        if (env.depth > 6) throw new SqlError('subqueries nested too deep');
        var res = runQuery(node.query, db, env);
        env.depth--;
        return res.rows.length ? res.rows[0][0] : null;
      }
      case 'func': return evalFunc(node, row, db, env);
      case 'star': throw new SqlError('* is not allowed here');
    }
    throw new SqlError('cannot evaluate ' + node.k);
  }

  function evalFunc(node, row, db, env) {
    var args = node.args;
    function arg(i) { return evalExpr(args[i], row, db, env); }
    switch (node.name) {
      case 'SUBSTRING':
      case 'SUBSTR': {
        var s = arg(0);
        if (s == null) return null;
        s = String(s);
        var start = args.length > 1 ? (arg(1) | 0) : 1;    /* SQL is 1-indexed */
        var len = args.length > 2 ? (arg(2) | 0) : s.length;
        if (start < 1) start = 1;
        return s.substr(start - 1, len);
      }
      case 'LENGTH':
      case 'LEN': { var v = arg(0); return v == null ? null : String(v).length; }
      case 'ASCII': {
        var a0 = arg(0);
        if (a0 == null || String(a0).length === 0) return null;
        return String(a0).charCodeAt(0);
      }
      case 'LOWER': { var lv = arg(0); return lv == null ? null : String(lv).toLowerCase(); }
      case 'UPPER': { var uv = arg(0); return uv == null ? null : String(uv).toUpperCase(); }
      case 'SLEEP': {
        /* The only side effect in the engine. It does not block; it records
           how long the query WOULD have paused, and the room turns that into
           a real setTimeout so the clock is the signal. Said plainly on the
           page: nothing here is holding a server open. */
        var sec = Number(arg(0)) || 0;
        env.sleep = (env.sleep || 0) + Math.max(0, sec);
        return 0;
      }
    }
    throw new SqlError('no such function: ' + node.name);
  }

  function colType(exprNode, from, db) {
    if (exprNode.k === 'lit') return exprNode.type;
    if (exprNode.k === 'col') {
      var schema = db._schema[from];
      if (schema && schema[exprNode.name]) return schema[exprNode.name];
      return 'any';
    }
    if (exprNode.k === 'func') {
      var nm = exprNode.name;
      if (nm === 'LENGTH' || nm === 'LEN' || nm === 'ASCII' || nm === 'SLEEP') return 'num';
      return 'text';
    }
    return 'any';
  }

  function evalSelectOnly(sel, db, env) {
    var rows;
    if (sel.from) {
      if (!db[sel.from]) throw new SqlError('no such table: ' + sel.from);
      rows = db[sel.from];
    } else {
      rows = [{}];
    }
    var colNames = [];
    var colTypes = [];
    var isStar = sel.cols === '*';
    var starCols = null;
    if (isStar) {
      if (!sel.from) throw new SqlError('SELECT * needs a table');
      starCols = db._order[sel.from] || [];
      for (var s = 0; s < starCols.length; s++) {
        colNames.push(starCols[s]);
        colTypes.push((db._schema[sel.from] && db._schema[sel.from][starCols[s]]) || 'any');
      }
    } else {
      for (var ci = 0; ci < sel.cols.length; ci++) {
        var col = sel.cols[ci];
        colNames.push(col.alias || (col.expr.k === 'col' ? col.expr.name : 'col' + (ci + 1)));
        colTypes.push(colType(col.expr, sel.from, db));
      }
    }
    var out = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (sel.where && truthy(evalExpr(sel.where, row, db, env)) !== true) continue;
      var vals = [];
      if (isStar) {
        for (var k = 0; k < starCols.length; k++) vals.push(row[starCols[k]]);
      } else {
        for (var c = 0; c < sel.cols.length; c++) vals.push(evalExpr(sel.cols[c].expr, row, db, env));
      }
      out.push(vals);
    }
    return { columns: colNames, colTypes: colTypes, rows: out };
  }

  function runQuery(query, db, env) {
    env = env || {};
    var res = evalSelectOnly(query.selects[0], db, env);
    for (var u = 1; u < query.selects.length; u++) {
      var right = evalSelectOnly(query.selects[u], db, env);
      if (right.columns.length !== res.columns.length) {
        throw new SqlError('SELECTs to the left and right of UNION do not have the same number of result columns');
      }
      for (var t = 0; t < res.colTypes.length; t++) {
        var lt = res.colTypes[t], rt = right.colTypes[t];
        if (lt !== 'any' && rt !== 'any' && lt !== 'null' && rt !== 'null' && lt !== rt) {
          throw new SqlError('UNION types ' + lt + ' and ' + rt + ' cannot be matched');
        }
      }
      if (query.unionAll[u - 1]) {
        res.rows = res.rows.concat(right.rows);
      } else {
        var seen = {};
        var merged = [];
        var combined = res.rows.concat(right.rows);
        for (var m = 0; m < combined.length; m++) {
          var key = JSON.stringify(combined[m]);
          if (seen[key]) continue;
          seen[key] = 1;
          merged.push(combined[m]);
        }
        res.rows = merged;
      }
    }
    if (query.orderBy) {
      var idx;
      if (query.orderBy.key.ord != null) {
        idx = query.orderBy.key.ord - 1;
        if (idx < 0 || idx >= res.columns.length) {
          throw new SqlError('ORDER BY position ' + query.orderBy.key.ord +
            ' is out of range - should be between 1 and ' + res.columns.length);
        }
      } else {
        idx = res.columns.indexOf(query.orderBy.key.col);
        if (idx < 0) throw new SqlError('no such column: ' + query.orderBy.key.col);
      }
      var dir = query.orderBy.dir === 'desc' ? -1 : 1;
      res.rows = res.rows.slice().sort(function (a, b) {
        var c = cmp(a[idx], b[idx]);
        return (c == null ? 0 : c) * dir;
      });
    }
    if (query.limit != null) res.rows = res.rows.slice(0, Math.max(0, query.limit));
    return res;
  }

  /* ==================================================================
     THE TOY DATABASE. Five tables. The passwords the player is trying
     to get around are here, which is safe because "here" is a closure
     in one tab that no query can leave.
     ================================================================== */
  function buildDb() {
    var users = [
      { id: 1, user: 'admin', pass: 'k3pt-in-the-db', role: 'admin', email: 'admin@forge.example', token: '7F3K9Q' },
      { id: 2, user: 'mira', pass: 'hunter2', role: 'staff', email: 'mira@forge.example', token: 'AA11BB' },
      { id: 3, user: 'devon', pass: 'letmein', role: 'staff', email: 'devon@forge.example', token: 'ZZ99YY' }
    ];
    var products = [
      { id: 10, name: 'Anvil, 20kg', price: 129 },
      { id: 11, name: 'Ball-peen hammer', price: 24 },
      { id: 12, name: 'Cast-iron tongs', price: 41 }
    ];
    var vault = [{ id: 1, secret: 'FLAG{UN10N}' }];
    var accounts = [{ id: 1, email: 'root@forge.example' }];
    var pins = [{ id: 1, code: '4B8D' }];
    return {
      users: users, products: products, vault: vault, accounts: accounts, pins: pins,
      _order: {
        users: ['id', 'user', 'pass', 'role', 'email', 'token'],
        products: ['id', 'name', 'price'],
        vault: ['id', 'secret'],
        accounts: ['id', 'email'],
        pins: ['id', 'code']
      },
      _schema: {
        users: { id: 'num', user: 'text', pass: 'text', role: 'text', email: 'text', token: 'text' },
        products: { id: 'num', name: 'text', price: 'num' },
        vault: { id: 'num', secret: 'text' },
        accounts: { id: 'num', email: 'text' },
        pins: { id: 'num', code: 'text' }
      }
    };
  }

  /* Secrets the blind rooms extract, kept as constants so the win check and
     the confirmed-prefix display read the same value the engine returns. */
  var BLIND_SECRET = '7F3K9Q';
  var TIME_SECRET = '4B8D';
  var ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* ==================================================================
     Scoped styles — see the header note on why these live here.
     ================================================================== */
  var CSS =
    '#game-sqli-escape .board-sqli{display:block;width:100%;max-width:52rem;-webkit-user-select:text;user-select:text;}' +
    '#game-sqli-escape .sqli-rooms{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 .8rem;padding:0;list-style:none;}' +
    '#game-sqli-escape .sqli-room{flex:1 1 8rem;display:flex;align-items:center;gap:.45rem;padding:.4rem .6rem;font-size:.78rem;line-height:1.3;color:var(--ink-4);background:rgb(var(--well-rgb) / .6);border:1px solid rgb(var(--line-rgb) / .25);border-radius:8px;}' +
    '#game-sqli-escape .sqli-room .sqli-dot{flex:0 0 auto;width:1.15rem;height:1.15rem;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;border:1px solid rgb(var(--line-rgb) / .5);color:var(--ink-4);}' +
    '#game-sqli-escape .sqli-room.is-current{color:var(--ink);border-color:var(--accent-2);}' +
    '#game-sqli-escape .sqli-room.is-current .sqli-dot{background:var(--accent-2);color:#04121f;border-color:var(--accent-2);}' +
    '#game-sqli-escape .sqli-room.is-done{color:var(--ink-3);}' +
    '#game-sqli-escape .sqli-room.is-done .sqli-dot{background:#166534;border-color:#22c55e;color:#eafff0;}' +
    '#game-sqli-escape .sqli-brief{margin:0 0 .8rem;padding:.7rem .85rem;background:rgb(var(--well-rgb) / .8);border-left:3px solid var(--accent-2);border-radius:8px;}' +
    '#game-sqli-escape .sqli-room-title{margin:0 0 .3rem;font-size:.95rem;font-weight:700;color:var(--ink);}' +
    '#game-sqli-escape .sqli-goal{margin:0;font-size:.86rem;line-height:1.6;color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-goal code{font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.82em;color:var(--accent-1);}' +
    '#game-sqli-escape .sqli-goal a{color:var(--accent-1);}' +
    '#game-sqli-escape .sqli-stage{margin:0 0 .85rem;}' +
    '#game-sqli-escape .sqli-field{margin:0 0 .6rem;}' +
    '#game-sqli-escape .sqli-label{display:block;margin:0 0 .25rem;font-size:.78rem;color:var(--ink-3);}' +
    '#game-sqli-escape .sqli-input{display:block;width:100%;font:inherit;font-size:.95rem;line-height:1.5;padding:.5rem .65rem;color:var(--ink);background:rgb(var(--well-rgb) / .85);border:1px solid rgb(var(--accent-rgb) / .3);border-radius:8px;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;}' +
    '#game-sqli-escape .sqli-input:focus-visible{outline:2px solid var(--accent-2);outline-offset:1px;}' +
    '#game-sqli-escape .sqli-input.sqli-char{width:4rem;text-align:center;text-transform:uppercase;}' +
    '#game-sqli-escape .sqli-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:.5rem;}' +
    '#game-sqli-escape .sqli-row .sqli-field{margin:0;}' +
    '#game-sqli-escape .sqli-select{font:inherit;color:var(--ink);background:rgb(var(--well-rgb) / .85);border:1px solid rgb(var(--accent-rgb) / .3);border-radius:8px;padding:.5rem .55rem;}' +
    '#game-sqli-escape .sqli-select:focus-visible{outline:2px solid var(--accent-2);outline-offset:1px;}' +
    '#game-sqli-escape .sqli-go{flex:0 0 auto;}' +
    '#game-sqli-escape .sqli-hint-line{margin:.55rem 0 0;font-size:.8rem;line-height:1.55;color:#fcd34d;}' +
    '#game-sqli-escape .sqli-hint-line:empty{display:none;}' +
    '#game-sqli-escape .sqli-querybox{margin:0 0 .7rem;padding:.6rem .7rem;background:#020617;border:1px solid rgb(var(--line-rgb) / .3);border-radius:10px;overflow-x:auto;}' +
    '#game-sqli-escape .sqli-query-label{margin:0 0 .35rem;font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-4);}' +
    '#game-sqli-escape .sqli-sql{margin:0;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.8rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;-webkit-user-select:text;user-select:text;}' +
    '#game-sqli-escape .sqli-tpl{color:#7f97b5;}' +
    '#game-sqli-escape .sqli-inj{color:#fca5a5;background:rgba(248,113,113,.14);border-radius:3px;font-weight:600;}' +
    '#game-sqli-escape .sqli-result{margin:0 0 .7rem;padding:.55rem .75rem;font-size:.85rem;line-height:1.55;border-radius:8px;border-left:3px solid var(--ink-4);background:rgb(var(--well-rgb) / .6);color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-result:empty{display:none;}' +
    '#game-sqli-escape .sqli-result[data-kind="ok"]{border-left-color:#22c55e;color:#bbf7d0;}' +
    '#game-sqli-escape .sqli-result[data-kind="bad"]{border-left-color:#f87171;color:#fecaca;}' +
    '#game-sqli-escape .sqli-result[data-kind="wait"]{border-left-color:var(--accent-2);color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-result .sqli-badge{font-weight:700;}' +
    '#game-sqli-escape .sqli-table-wrap{overflow-x:auto;margin:.5rem 0 0;}' +
    '#game-sqli-escape table.sqli-table{border-collapse:collapse;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.78rem;min-width:100%;}' +
    '#game-sqli-escape table.sqli-table th,#game-sqli-escape table.sqli-table td{border:1px solid rgb(var(--line-rgb) / .3);padding:.28rem .55rem;text-align:left;color:var(--ink-2);white-space:nowrap;}' +
    '#game-sqli-escape table.sqli-table th{color:var(--ink-4);font-weight:700;}' +
    '#game-sqli-escape table.sqli-table td.is-loot{color:#fde047;font-weight:700;}' +
    '#game-sqli-escape .sqli-prefix{display:flex;flex-wrap:wrap;gap:.3rem;margin:0 0 .55rem;}' +
    '#game-sqli-escape .sqli-cell{width:1.7rem;height:2rem;display:inline-flex;align-items:center;justify-content:center;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:1rem;font-weight:700;color:var(--ink);background:rgb(var(--well-rgb) / .8);border:1px solid rgb(var(--line-rgb) / .4);border-radius:6px;}' +
    '#game-sqli-escape .sqli-cell.is-known{border-color:#22c55e;color:#bbf7d0;}' +
    '#game-sqli-escape .sqli-cell.is-current{border-color:var(--accent-2);color:var(--accent-1);}' +
    '#game-sqli-escape .sqli-log{margin:.5rem 0 0;padding:0;list-style:none;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.76rem;line-height:1.5;max-height:8rem;overflow-y:auto;}' +
    '#game-sqli-escape .sqli-log li{color:var(--ink-3);padding:.1rem 0;}' +
    '#game-sqli-escape .sqli-log li .yes{color:#86efac;}' +
    '#game-sqli-escape .sqli-log li .no{color:#fca5a5;}' +
    '#game-sqli-escape .sqli-fix{margin:.2rem 0 0;padding:.8rem .9rem;background:rgb(var(--well-rgb) / .85);border:1px solid rgb(34,197,94,.4);border-radius:10px;}' +
    '#game-sqli-escape .sqli-fix[hidden]{display:none;}' +
    '#game-sqli-escape .sqli-fix h3{margin:0 0 .5rem;font-size:.9rem;color:#bbf7d0;}' +
    '#game-sqli-escape .sqli-fix .sqli-fix-code{margin:0 0 .55rem;padding:.55rem .65rem;background:#020617;border:1px solid rgb(var(--line-rgb) / .3);border-radius:8px;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.78rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#93c5fd;}' +
    '#game-sqli-escape .sqli-fix .sqli-bind{margin:.15rem 0;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.78rem;color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-fix .sqli-bind b{color:#fde047;}' +
    '#game-sqli-escape .sqli-fix .sqli-why{margin:.55rem 0 0;font-size:.82rem;line-height:1.6;color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-fix .sqli-why a{color:var(--accent-1);}' +
    '#game-sqli-escape .sqli-fix ul{margin:.55rem 0 0;padding-left:1.1rem;font-size:.82rem;line-height:1.6;color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-fix ul li{margin:.25rem 0;}' +
    '#game-sqli-escape .sqli-help{margin:0 0 .8rem;padding:.7rem .85rem;background:rgb(var(--well-rgb) / .7);border:1px solid rgb(var(--line-rgb) / .3);border-radius:8px;font-size:.8rem;line-height:1.6;color:var(--ink-2);}' +
    '#game-sqli-escape .sqli-help[hidden]{display:none;}' +
    '#game-sqli-escape .sqli-help h3{margin:0 0 .35rem;font-size:.82rem;color:var(--ink);}' +
    '#game-sqli-escape .sqli-help code{font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:.82em;color:var(--accent-1);}' +
    '#game-sqli-escape .sqli-help table{border-collapse:collapse;margin:.3rem 0;font-size:.76rem;}' +
    '#game-sqli-escape .sqli-help th,#game-sqli-escape .sqli-help td{border:1px solid rgb(var(--line-rgb) / .3);padding:.2rem .5rem;text-align:left;font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;}' +
    '#game-sqli-escape .sqli-primary{background:#0f766e;border-color:#14b8a6;}' +
    '#game-sqli-escape .sqli-primary:hover:not(:disabled){background:#115e59;}' +
    '@media (max-width:30rem){#game-sqli-escape .sqli-room{flex:1 1 100%;}#game-sqli-escape .sqli-sql,#game-sqli-escape .sqli-fix .sqli-fix-code{font-size:.74rem;}}';

  /* Small HTML escaper for the few author-static strings that are dropped in
     with innerHTML. User-typed text NEVER takes this path — it only ever
     reaches the DOM through textContent, so an injected quote cannot become
     page markup any more than it can become a real query. */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ==================================================================
     The game.
     ================================================================== */
  GameShell.define({
    id: 'game-sqli-escape',
    slug: 'sqli-escape',
    title: 'SQL injection escape room',
    bestKey: 'sqli-escape',
    bestOrder: 'low',
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,
    formatBest: function (n) { return n + ' queries'; },

    setup: function (g) {
      var host = g.board;
      var db = null;
      var attempts = 0;
      var roomIndex = 0;

      /* DOM handles, filled in build(). */
      var roomsEl, briefTitleEl, briefGoalEl, stageEl, sqlEl, resultEl, fixEl, helpEl;

      /* -- one-time style injection -- */
      (function injectStyle() {
        if (document.getElementById('sqli-escape-style')) return;
        var st = document.createElement('style');
        st.id = 'sqli-escape-style';
        st.textContent = CSS;
        document.head.appendChild(st);
      })();

      /* -- scoring: every query the player sends is counted, win or lose,
            because an attacker pays for every request and a tidy run is a
            small number of them. -- */
      function runSql(sql) {
        attempts++;
        g.stat('tries', attempts);
        var env = { sleep: 0 };
        try {
          var res = runQuery(parseSql(sql), db, env);
          return { ok: true, res: res, sleep: env.sleep };
        } catch (e) {
          return { ok: false, error: e.message || String(e) };
        }
      }

      /* -- the live assembled query. Template segments dim, injected
            segments bright; textContent throughout so a typed quote is shown,
            never executed as markup. Returns the concatenated SQL string so
            the display and the executed query cannot disagree. -- */
      function paintQuery(segs) {
        sqlEl.innerHTML = '';
        var full = '';
        for (var i = 0; i < segs.length; i++) {
          var span = document.createElement('span');
          span.className = segs[i].inj ? 'sqli-inj' : 'sqli-tpl';
          span.textContent = segs[i].v;
          sqlEl.appendChild(span);
          full += segs[i].v;
        }
        return full;
      }

      function setResult(kind, html) {
        resultEl.setAttribute('data-kind', kind);
        resultEl.innerHTML = html;
        /* Announce the plain words, not the markup. */
        g.announce(resultEl.textContent);
      }
      function clearResult() { resultEl.removeAttribute('data-kind'); resultEl.innerHTML = ''; }

      function setHint(text) {
        var el = stageEl.querySelector('.sqli-hint-line');
        if (el) el.textContent = text || '';
      }

      /* ---------------- the four rooms ---------------- */

      /* Room one: two fields build a login query; the win is the admin row.

         The fields in this game are typed INTO and read BY the player, so they
         must not carry 'typing-catch'. That class belongs to the off-screen
         keystroke catcher the terminal games use — game-shell.js parks it at
         left:-9999px, opacity:0 — and putting it on a visible field renders
         the box nowhere while the shell still focuses it, so typing vanishes
         into an input nobody can see. Each room already calls focusSoon() on
         its own first field, so nothing is lost by leaving the class off. */
      function mountLogin() {
        stageEl.innerHTML =
          '<div class="sqli-field">' +
          '<label class="sqli-label" for="sqli-user">Username</label>' +
          '<input class="sqli-input" id="sqli-user" type="text" autocomplete="off" ' +
          'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="try: admin" />' +
          '</div>' +
          '<div class="sqli-field">' +
          '<label class="sqli-label" for="sqli-pass">Password</label>' +
          '<input class="sqli-input" id="sqli-pass" type="text" autocomplete="off" ' +
          'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="you do not know it" />' +
          '</div>' +
          '<div class="sqli-row">' +
          '<button class="game-btn sqli-primary sqli-go" type="button" id="sqli-login">Log in</button>' +
          '</div>' +
          '<p class="sqli-hint-line" role="status" aria-live="polite"></p>';

        var userEl = stageEl.querySelector('#sqli-user');
        var passEl = stageEl.querySelector('#sqli-pass');
        var btn = stageEl.querySelector('#sqli-login');

        function segs() {
          return [
            { v: "SELECT id, user, role FROM users WHERE user='" },
            { v: userEl.value, inj: true },
            { v: "' AND pass='" },
            { v: passEl.value, inj: true },
            { v: "'" }
          ];
        }
        function repaint() { paintQuery(segs()); }
        function submit() {
          var sql = paintQuery(segs());
          var out = runSql(sql);
          if (!out.ok) { setResult('bad', '<span class="sqli-badge">SQL error.</span> ' + esc(out.error)); return; }
          var rows = out.res.rows;
          if (!rows.length) {
            setResult('bad', '<span class="sqli-badge">Login failed.</span> No row matched &mdash; the query returned nothing.');
            return;
          }
          /* The app logs in as the first row it gets back. */
          var role = rows[0][2];
          if (role === 'admin') {
            setResult('ok', '<span class="sqli-badge">Access granted.</span> Logged in as <b>admin</b> without the password. The quote broke out of the string and <code>--</code> deleted the password check.');
            solveRoom();
          } else {
            setResult('bad', '<span class="sqli-badge">Logged in as ' + esc(String(rows[0][1])) + ' (not admin).</span> The bypass works &mdash; now make the <em>first</em> row the admin one.');
          }
        }
        userEl.addEventListener('input', repaint);
        passEl.addEventListener('input', repaint);
        onEnter(userEl, submit);
        onEnter(passEl, submit);
        btn.addEventListener('click', submit);
        repaint();
        focusSoon(userEl);
      }

      /* Room two: a product search; the win is a row carrying the vault
         secret, reached by counting columns and matching types. */
      function mountUnion() {
        stageEl.innerHTML =
          '<div class="sqli-field">' +
          '<label class="sqli-label" for="sqli-search">Search products</label>' +
          '<input class="sqli-input" id="sqli-search" type="text" autocomplete="off" ' +
          'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="hammer" />' +
          '</div>' +
          '<div class="sqli-row">' +
          '<button class="game-btn sqli-primary sqli-go" type="button" id="sqli-run">Search</button>' +
          '</div>' +
          '<p class="sqli-hint-line" role="status" aria-live="polite"></p>';

        var searchEl = stageEl.querySelector('#sqli-search');
        var btn = stageEl.querySelector('#sqli-run');

        function segs() {
          return [
            { v: "SELECT id, name, price FROM products WHERE name LIKE '%" },
            { v: searchEl.value, inj: true },
            { v: "%'" }
          ];
        }
        function repaint() { paintQuery(segs()); }
        function submit() {
          var sql = paintQuery(segs());
          var out = runSql(sql);
          if (!out.ok) {
            setResult('bad', '<span class="sqli-badge">Database error.</span> ' + esc(out.error) +
              '<br><span style="color:var(--ink-4)">That message is the technique: the error tells you the column count and the types.</span>');
            return;
          }
          var res = out.res;
          var loot = false;
          for (var i = 0; i < res.rows.length; i++) {
            for (var j = 0; j < res.rows[i].length; j++) {
              if (res.rows[i][j] === 'FLAG{UN10N}') loot = true;
            }
          }
          setResult(loot ? 'ok' : 'info',
            (loot
              ? '<span class="sqli-badge">Extracted.</span> A row from <code>vault</code> is sitting in the product results &mdash; the yellow cell was never a product.'
              : '<span class="sqli-badge">' + res.rows.length + ' row' + (res.rows.length === 1 ? '' : 's') + '.</span> These are just products. Union another table in.') +
            renderTable(res));
          if (loot) solveRoom();
        }
        searchEl.addEventListener('input', repaint);
        onEnter(searchEl, submit);
        btn.addEventListener('click', submit);
        repaint();
        focusSoon(searchEl);
      }

      function renderTable(res) {
        var html = '<div class="sqli-table-wrap"><table class="sqli-table"><thead><tr>';
        for (var c = 0; c < res.columns.length; c++) html += '<th>' + esc(res.columns[c]) + '</th>';
        html += '</tr></thead><tbody>';
        if (!res.rows.length) {
          html += '<tr><td colspan="' + res.columns.length + '" style="color:var(--ink-4)">(no rows)</td></tr>';
        }
        for (var r = 0; r < res.rows.length; r++) {
          html += '<tr>';
          for (var k = 0; k < res.rows[r].length; k++) {
            var v = res.rows[r][k];
            var cls = v === 'FLAG{UN10N}' ? ' class="is-loot"' : '';
            html += '<td' + cls + '>' + esc(v == null ? 'NULL' : v) + '</td>';
          }
          html += '</tr>';
        }
        return html + '</tbody></table></div>';
      }

      /* Rooms three and four share a stepper. The player chooses the operator
         and the character; the scaffolding around the comparison is written
         for them, so it is a puzzle of deduction rather than a typing
         marathon — but the whole assembled query is on screen so the
         mechanism is never hidden. mode is 'blind' or 'time'. */
      function mountStepper(mode) {
        var secret = mode === 'blind' ? BLIND_SECRET : TIME_SECRET;
        var subq = mode === 'blind'
          ? "(SELECT token FROM users WHERE role='admin')"
          : '(SELECT code FROM pins)';
        var confirmed = '';

        stageEl.innerHTML =
          '<div class="sqli-prefix" id="sqli-prefix" role="status" aria-live="polite"></div>' +
          '<div class="sqli-row">' +
          '<div class="sqli-field"><label class="sqli-label" for="sqli-op">Comparison</label>' +
          '<select class="sqli-select" id="sqli-op">' +
          '<option value="=">SUBSTRING = char</option>' +
          '<option value="&gt;">SUBSTRING &gt; char</option>' +
          '<option value="&lt;">SUBSTRING &lt; char</option>' +
          '</select></div>' +
          '<div class="sqli-field"><label class="sqli-label" for="sqli-ch">Character</label>' +
          '<input class="sqli-input sqli-char" id="sqli-ch" type="text" maxlength="1" ' +
          'autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" /></div>' +
          '<div class="sqli-field"><button class="game-btn sqli-primary sqli-go" type="button" id="sqli-send">Send probe</button></div>' +
          '</div>' +
          '<p class="sqli-hint-line" role="status" aria-live="polite"></p>' +
          '<ul class="sqli-log" id="sqli-log" aria-label="Probe log"></ul>';

        var opEl = stageEl.querySelector('#sqli-op');
        var chEl = stageEl.querySelector('#sqli-ch');
        var sendEl = stageEl.querySelector('#sqli-send');
        var logEl = stageEl.querySelector('#sqli-log');
        var prefixEl = stageEl.querySelector('#sqli-prefix');

        function pos() { return confirmed.length + 1; }

        function payload(op, ch) {
          var predicate = 'SUBSTRING(' + subq + ',' + pos() + ',1)' + op + "'" + ch + "'";
          if (mode === 'blind') {
            return "x' OR " + predicate + ' -- ';
          }
          return "x' OR (" + predicate + ' AND SLEEP(1)) -- ';
        }
        function templatePre() {
          return mode === 'blind'
            ? "SELECT id FROM users WHERE email='"
            : "SELECT id FROM accounts WHERE email='";
        }
        function segs(op, ch) {
          return [{ v: templatePre() }, { v: payload(op, ch), inj: true }, { v: "'" }];
        }
        function currentChar() {
          var c = (chEl.value || '').toUpperCase().charAt(0);
          return c;
        }
        /* The two comparison options are written &gt; and &lt; in the markup
           above, because that is how you put those characters in an HTML
           attribute. The parser decodes them, so opEl.value is already '>'
           or '<' — comparing it against the entity text matched nothing and
           every probe went out as '=', which quietly made the greater-than
           and less-than options dead and the blind search unusable. Read the
           decoded value, and fall back to '=' for anything unexpected. */
        function currentOp() {
          var v = opEl.value;
          return (v === '>' || v === '<') ? v : '=';
        }
        function repaint() {
          var op = currentOp();
          paintQuery(segs(op, currentChar() || '?'));
          paintPrefix();
        }
        function paintPrefix() {
          prefixEl.innerHTML = '';
          for (var i = 0; i < secret.length; i++) {
            var cell = document.createElement('span');
            cell.className = 'sqli-cell';
            if (i < confirmed.length) { cell.className += ' is-known'; cell.textContent = confirmed.charAt(i); }
            else if (i === confirmed.length) { cell.className += ' is-current'; cell.textContent = '_'; }
            else { cell.textContent = '_'; }
            prefixEl.appendChild(cell);
          }
          prefixEl.setAttribute('aria-label',
            'Value is ' + secret.length + ' characters. Confirmed so far: ' +
            (confirmed || 'none') + '. Now working on position ' + pos() + '.');
        }
        function logLine(op, ch, positive) {
          var li = document.createElement('li');
          var word = mode === 'blind'
            ? (positive ? 'FOUND' : 'not found')
            : (positive ? 'SLOW' : 'fast');
          var human = 'pos ' + pos() + ':  char ' + op + " '" + ch + "'  →  ";
          li.appendChild(document.createTextNode(human));
          var span = document.createElement('span');
          span.className = positive ? 'yes' : 'no';
          span.textContent = word;
          li.appendChild(span);
          logEl.insertBefore(li, logEl.firstChild);
        }

        function send() {
          var ch = currentChar();
          if (!ch) { setHint('Type one character to compare against.'); return; }
          var op = currentOp();
          var sql = paintQuery(segs(op, ch));

          if (mode === 'blind') {
            var out = runSql(sql);
            if (!out.ok) { setResult('bad', '<span class="sqli-badge">SQL error.</span> ' + esc(out.error)); return; }
            var positive = out.res.rows.length > 0;
            logLine(op, ch, positive);
            setResult(positive ? 'ok' : 'info',
              '<span class="sqli-badge">' + (positive ? 'Account found.' : 'No account.') +
              '</span> The page leaks one bit: whether the predicate was true.');
            afterProbe(op, ch, positive);
          } else {
            timeSend(sql, op, ch);
          }
        }

        /* The time-based probe: run the query, read how long it WOULD have
           slept, then actually hold the answer back that long with a
           setTimeout so the clock is the only signal. The delay is simulated
           and the copy says so. */
        function timeSend(sql, op, ch) {
          sendEl.disabled = true;
          setResult('wait', '<span class="sqli-badge">Sending&hellip;</span> waiting for the response.');
          var out = runSql(sql);
          if (!out.ok) { sendEl.disabled = false; setResult('bad', '<span class="sqli-badge">SQL error.</span> ' + esc(out.error)); return; }
          var base = 140;
          var delay = base + Math.min(1100, out.sleep * 1000);
          var t0 = now();
          setTimeout(function () {
            var elapsed = (now() - t0) / 1000;
            sendEl.disabled = false;
            var slow = out.sleep > 0;
            logLine(op, ch, slow);
            setResult(slow ? 'ok' : 'info',
              '<span class="sqli-badge">Request completed in ' + elapsed.toFixed(2) + ' s (' +
              (slow ? 'slow' : 'fast') + ').</span> The condition was ' + (slow ? '<b>true</b>' : '<b>false</b>') +
              '. <span style="color:var(--ink-4)">The delay is simulated in this tab; no server is held open.</span>');
            afterProbe(op, ch, slow);
          }, delay);
        }

        function afterProbe(op, ch, positive) {
          /* Only an equality that came back positive pins a character down
             and moves the cursor on. The inequalities are for narrowing, and
             the player is meant to choose them — a binary search is a handful
             of queries where marching the alphabet is dozens. */
          if (op === '=' && positive) {
            confirmed += ch;
            chEl.value = '';
            paintPrefix();
            if (confirmed === secret) {
              setHint('');
              setResult('ok', '<span class="sqli-badge">Recovered:</span> <code>' + esc(secret) +
                '</code> &mdash; extracted through a channel that never printed it.');
              solveRoom();
              return;
            }
            setHint('Locked in "' + ch + '". On to position ' + pos() + '.');
          } else if (op === '=') {
            setHint('Not that character. Narrow it down with < and > first.');
          } else {
            setHint('Good &mdash; now you know which half. Confirm the exact character with =.');
          }
          repaint();
          focusSoon(chEl);
        }

        opEl.addEventListener('change', repaint);
        chEl.addEventListener('input', function () {
          /* Keep the field to a single uppercase character. */
          var up = (chEl.value || '').toUpperCase().slice(0, 1);
          if (up !== chEl.value) chEl.value = up;
          repaint();
        });
        onEnter(chEl, send);
        sendEl.addEventListener('click', send);
        repaint();
        focusSoon(chEl);
      }

      /* ---------------- room definitions ---------------- */
      var ROOMS = [
        {
          num: '1', title: 'Login bypass',
          goal: 'The form runs <code>SELECT * FROM users WHERE user=\'&hellip;\' AND pass=\'&hellip;\'</code>. ' +
            'You do not know the admin password. Break out of the username quote and log in as <b>admin</b> anyway. ' +
            'Watch the query build as you type.',
          hint: 'Put a single quote where the username goes to close the string, then comment out the rest with ' +
            '<code>--</code>. Try <code>admin\' --</code> as the username, and anything as the password.',
          mount: mountLogin,
          fix: {
            code: "db.query('SELECT id, user, role FROM users WHERE user = ? AND pass = ?', [user, pass])",
            binds: [{ ph: '?1 (user)', v: "admin' --" }, { ph: '?2 (pass)', v: 'anything' }],
            why: 'The driver sends the query text and the two values on separate channels. The <b>\'</b> and the ' +
              '<b>--</b> arrive as ordinary characters to look for in the <code>user</code> column, not as SQL &mdash; ' +
              'so no row has that literal username, and the login fails as it should.'
          }
        },
        {
          num: '2', title: 'UNION SELECT',
          goal: 'The shop runs <code>SELECT id, name, price FROM products WHERE name LIKE \'%&hellip;%\'</code>. ' +
            'Read the secret out of the <code>vault</code> table and into these results. Work out the column count ' +
            'first (try <code>\' ORDER BY 4 --</code>), then match the types.',
          hint: 'There are three columns and the middle one is text. Pad the numeric columns with NULL: ' +
            '<code>\' UNION SELECT NULL, secret, NULL FROM vault --</code>. Put text in a numeric slot and it errors ' +
            'on purpose &mdash; that is the type check.',
          mount: mountUnion,
          fix: {
            code: "db.query('SELECT id, name, price FROM products WHERE name LIKE ?', ['%' + term + '%'])",
            binds: [{ ph: '?1 (term)', v: "' UNION SELECT NULL, secret, NULL FROM vault --" }],
            why: 'The whole payload becomes the search term, wrapped in the <code>%</code> signs and bound as one ' +
              'string. <code>UNION</code>, <code>SELECT</code> and the rest are matched literally against product ' +
              'names &mdash; nothing matches, and the parser never sees a second query.'
          }
        },
        {
          num: '3', title: 'Blind boolean',
          goal: 'A password-reset page says only <b>Account found</b> or <b>No account</b> &mdash; no data at all. ' +
            'The admin\'s 6-character token is in <code>users.token</code>. Pull it out one character at a time. ' +
            'The scaffolding is written for you; you choose the comparison and the character.',
          hint: 'Use <code>&gt;</code> and <code>&lt;</code> to binary-search each position (halve the alphabet each ' +
            'probe), then confirm the exact character with <code>=</code>. The alphabet is 0-9 then A-Z.',
          mount: function () { mountStepper('blind'); },
          fix: {
            code: "db.query('SELECT id FROM users WHERE email = ?', [email])",
            binds: [{ ph: '?1 (email)', v: "x' OR SUBSTRING(token,1,1)='7' --" }],
            why: 'The entire payload is one bound value compared against <code>email</code>. The <code>OR</code> and ' +
              'the <code>SUBSTRING</code> are never executed &mdash; they are just text no email equals &mdash; so the ' +
              'found / not-found bit stops depending on the secret, and there is nothing left to read one character at a time.'
          }
        },
        {
          num: '4', title: 'Time-based blind',
          goal: 'Same idea, but the page gives back nothing at all &mdash; not even found or not-found. The only ' +
            'signal is how long the response takes. Extract the 4-character reset code from <code>pins.code</code> by ' +
            'making the database pause when your guess is right. The delay is simulated in this tab.',
          hint: 'Wrap the comparison so a match runs <code>SLEEP</code>: the stepper builds ' +
            '<code>&hellip; AND SLEEP(1)</code> for you. A slow response means true, a fast one means false. Binary-search, ' +
            'then confirm with <code>=</code>.',
          mount: function () { mountStepper('time'); },
          fix: {
            code: "db.query('SELECT id FROM accounts WHERE email = ?', [email])",
            binds: [{ ph: '?1 (email)', v: "x' OR (SUBSTRING(code,1,1)='4' AND SLEEP(1)) --" }],
            why: 'Bound as a value, the <code>SLEEP</code> never runs, so the response time no longer depends on the ' +
              'secret. A prepared statement closes the timing channel for the same reason it closes every other one: ' +
              'the value can never become part of the code.',
            /* The closing lesson lives on the last room, per the brief. */
            extra: [
              'Escaping quotes by hand loses: you have to get every context right (strings, numbers, identifiers, LIKE, ' +
                'each with different rules) every single time, and one miss is the whole hole. The database escapes ' +
                'exactly once, correctly, when you parameterise.',
              'A blocklist of keywords loses too: <code>UNION</code>, <code>SELECT</code> and <code>OR</code> appear in ' +
                'ordinary data, comments and case-tricks slip past filters, and the list is a promise to enumerate every ' +
                'attack, forever. Parameterising needs no list.',
              'Stored procedures are not automatically safe &mdash; one that builds a string with <code>EXEC(@sql)</code> ' +
                'inside it is just as injectable. They are safe only when they, too, use bound parameters.',
              'An ORM is safe only where it parameterises. Its query builder does; its raw-SQL and string-interpolation ' +
                'escape hatches do not, and those are where the same bug comes straight back.'
            ]
          }
        }
      ];

      /* ---------------- fix panel ---------------- */
      function renderFix(room) {
        var fix = room.fix;
        var html = '<h3>The prepared statement that would have stopped this</h3>' +
          '<div class="sqli-fix-code">' + esc(fix.code) + '</div>';
        for (var i = 0; i < fix.binds.length; i++) {
          html += '<p class="sqli-bind">' + esc(fix.binds[i].ph) + ' &nbsp;=&nbsp; <b>' + esc(fix.binds[i].v) + '</b></p>';
        }
        html += '<p class="sqli-why">' + fix.why + '</p>';
        if (fix.extra) {
          html += '<ul>';
          for (var e = 0; e < fix.extra.length; e++) html += '<li>' + fix.extra[e] + '</li>';
          html += '</ul>';
          html += '<p class="sqli-why">The tools next door do this the safe way, and show a query plan while they do it: ' +
            '<a href="/labs/sql">the SQL playground</a> and <a href="/labs/sqlite-browser">the SQLite browser</a>.</p>';
        }
        var last = roomIndex === ROOMS.length - 1;
        html += '<div class="sqli-row" style="margin-top:.7rem">' +
          '<button class="game-btn sqli-primary" type="button" id="sqli-next">' +
          (last ? 'Finish &mdash; you are out' : 'Next room &rarr;') + '</button></div>';
        fixEl.innerHTML = html;
        fixEl.hidden = false;

        var nextBtn = fixEl.querySelector('#sqli-next');
        nextBtn.addEventListener('click', function () {
          if (last) {
            g.over({
              won: true,
              score: attempts,
              title: 'You are out',
              message: 'Four rooms, ' + attempts + ' queries. Fewer is better, and a binary search on the two blind ' +
                'rooms is the difference between a tidy run and a slog. The fix was the same door every time: a bound value.'
            });
          } else {
            showRoom(roomIndex + 1);
          }
        });
        focusSoon(nextBtn);
      }

      function solveRoom() {
        g.beep(720, 0.07, 'sine');
        g.sweep(440, 760, 0.2);
        /* Disable the room's inputs so the solved query cannot be re-fired. */
        var inputs = stageEl.querySelectorAll('input, select, button');
        for (var i = 0; i < inputs.length; i++) inputs[i].disabled = true;
        paintRooms();
        renderFix(ROOMS[roomIndex]);
      }

      /* ---------------- room chrome ---------------- */
      function paintRooms() {
        roomsEl.innerHTML = '';
        for (var i = 0; i < ROOMS.length; i++) {
          var li = document.createElement('li');
          var cls = 'sqli-room';
          if (i < roomIndex) cls += ' is-done';
          else if (i === roomIndex) cls += ' is-current';
          li.className = cls;
          var dot = document.createElement('span');
          dot.className = 'sqli-dot';
          dot.textContent = i < roomIndex ? '✓' : ROOMS[i].num;
          li.appendChild(dot);
          var label = document.createElement('span');
          label.textContent = ROOMS[i].title;
          li.appendChild(label);
          li.setAttribute('aria-label', 'Room ' + ROOMS[i].num + ', ' + ROOMS[i].title + ', ' +
            (i < roomIndex ? 'solved' : (i === roomIndex ? 'in progress' : 'locked')));
          roomsEl.appendChild(li);
        }
      }

      function showRoom(i) {
        roomIndex = i;
        g.stat('room', (i + 1) + '/' + ROOMS.length);
        fixEl.hidden = true;
        fixEl.innerHTML = '';
        clearResult();
        helpEl.hidden = true;
        var room = ROOMS[i];
        briefTitleEl.textContent = 'Room ' + room.num + ' — ' + room.title;
        briefGoalEl.innerHTML = room.goal;
        paintRooms();
        room.mount();
      }

      /* ---------------- help / hint ---------------- */
      function helpHtml() {
        return '<h3>The tables (this is your schema)</h3>' +
          '<table><thead><tr><th>table</th><th>columns</th></tr></thead><tbody>' +
          '<tr><td>users</td><td>id, user, pass, role, email, token</td></tr>' +
          '<tr><td>products</td><td>id, name, price</td></tr>' +
          '<tr><td>vault</td><td>id, secret</td></tr>' +
          '<tr><td>accounts</td><td>id, email</td></tr>' +
          '<tr><td>pins</td><td>id, code</td></tr>' +
          '</tbody></table>' +
          '<p>The engine understands <code>SELECT</code>, <code>WHERE</code>, <code>AND</code>/<code>OR</code>, ' +
          'comparisons, <code>LIKE</code>, <code>UNION SELECT</code>, <code>ORDER BY</code>, <code>LIMIT</code>, ' +
          'scalar subqueries, the comment forms <code>--</code> and <code>/* */</code>, and the functions ' +
          '<code>SUBSTRING</code>, <code>LENGTH</code>, <code>ASCII</code>, <code>UPPER</code>, <code>LOWER</code> and ' +
          '<code>SLEEP</code>. It is a teaching toy, not a full SQL engine &mdash; there are no writes, no joins and ' +
          'no real database anywhere near it.</p>';
      }

      function wireToolbar() {
        var helpBtn = g.el.querySelector('#game-help');
        if (helpBtn) {
          helpBtn.addEventListener('click', function () {
            if (helpEl.hidden) { helpEl.innerHTML = helpHtml(); helpEl.hidden = false; }
            else helpEl.hidden = true;
          });
        }
        var hintBtn = g.el.querySelector('#game-hint');
        if (hintBtn) {
          hintBtn.addEventListener('click', function () {
            setHint(''); /* clear the stepper's own hint line first, if any */
            var h = ROOMS[roomIndex].hint;
            setResult('info', '<span class="sqli-badge">Hint.</span> ' + h);
          });
        }
      }

      /* ---------------- small helpers ---------------- */
      function onEnter(el, fn) {
        el.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); fn(); }
        });
      }
      function focusSoon(el) {
        if (!el) return;
        setTimeout(function () {
          try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
        }, 0);
      }
      function now() {
        return (root_perf() ? performance.now() : +new Date());
      }
      function root_perf() { return typeof performance !== 'undefined' && performance.now; }

      /* ---------------- build the board once ---------------- */
      function build() {
        host.className = 'game-board board-sqli';
        host.innerHTML =
          '<ul class="sqli-rooms" id="sqli-rooms" aria-label="Rooms"></ul>' +
          '<div class="sqli-help" id="sqli-help" hidden></div>' +
          '<div class="sqli-brief">' +
          '<p class="sqli-room-title" id="sqli-brief-title"></p>' +
          '<p class="sqli-goal" id="sqli-brief-goal"></p>' +
          '</div>' +
          '<div class="sqli-stage" id="sqli-stage"></div>' +
          '<div class="sqli-querybox">' +
          '<p class="sqli-query-label">The query the server will run</p>' +
          '<pre class="sqli-sql" id="sqli-sql" aria-label="Assembled query" tabindex="0"></pre>' +
          '</div>' +
          '<div class="sqli-result" id="sqli-result" role="status" aria-live="polite"></div>' +
          '<div class="sqli-fix" id="sqli-fix" hidden></div>';

        roomsEl = host.querySelector('#sqli-rooms');
        helpEl = host.querySelector('#sqli-help');
        briefTitleEl = host.querySelector('#sqli-brief-title');
        briefGoalEl = host.querySelector('#sqli-brief-goal');
        stageEl = host.querySelector('#sqli-stage');
        sqlEl = host.querySelector('#sqli-sql');
        resultEl = host.querySelector('#sqli-result');
        fixEl = host.querySelector('#sqli-fix');

        wireToolbar();
      }

      build();

      return {
        reset: function () {
          db = buildDb();
          attempts = 0;
          roomIndex = 0;
          g.stat('tries', 0);
          g.stat('room', '1/' + ROOMS.length);
          helpEl.hidden = true;
          showRoom(0);
        }
      };
    }
  });
})();

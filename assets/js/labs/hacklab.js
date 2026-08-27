/* ==========================================================================
   hacklab.js — a deliberately vulnerable app you are meant to break.
   --------------------------------------------------------------------------
   Every other tool in Labs is defensive. This one is the range: real
   vulnerabilities, live, with an objective and a "you got it" the moment you
   land the exploit. The point is that reading about SQL injection and actually
   watching ' OR '1'='1 walk past a login are different kinds of understanding,
   and only one of them sticks.

   Why this is safe to host, stated plainly because a security page owes it:

   - The SQL is real. It runs against sql.js — the same SQLite engine as
     /labs/sql — in the visitor's own tab. There is no server and no database
     of anyone's but a throwaway one built in memory each time. The injection
     genuinely executes; there is simply nothing behind it to reach.
   - The XSS is real, and fires inside a sandboxed <iframe> loaded from a
     throwaway page (/labs/hacklab-guestbook) that carries its own connect-src
     'none' policy, so a payload running in it cannot fetch, beacon or
     websocket a stolen value anywhere — it can only postMessage back to us,
     which is how we detect the solve. And what it "steals" is a hardcoded
     fake token: this whole site is static, with no accounts, no secrets and
     no real user data, so even a flawless exploit walks away with a string
     that was never worth anything. That harmlessness, not sandbox trickery,
     is what makes it safe to host. (An opaque-origin sandbox would be tidier,
     but a no-same-origin frame inherits this site's strict CSP and the
     injected inline script would never run — the exercise has to allow the
     script to fire to teach anything.)
   - Everything else — traversal, command injection, IDOR — runs against
     in-memory fakes. No real filesystem, no real shell.

   Nothing here talks to a network. Like the offline tools, it must not: this
   file is not built on tool-shell.js (which forbids it) but it holds to the
   same rule, because a "hacking sandbox" that phoned home would be the joke
   that writes itself.

   Each challenge carries its own real-world fix. Breaking the thing is the
   hook; the fix is the point.
   ========================================================================== */

/* global initSqlJs */
(function () {
  'use strict';

  var STORE_KEY = 'lab.hacklab.solved';
  var host = document.getElementById('hacklab');
  if (!host) return;

  /* ---- progress, kept on the device only -------------------------------- */
  function loadSolved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveSolved(map) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch (e) {}
  }
  var solved = loadSolved();

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* sql.js is loaded once and shared by every SQL challenge. */
  var sqlReady = null;
  function getSql() {
    if (!sqlReady) {
      // sql-wasm.js arrives as a plain <script> tag, so a missing global means
      // it never downloaded — every SQL challenge below depends on it.
      if (typeof initSqlJs !== 'function') {
        sqlFailed('network');
        return Promise.reject(new Error('sql.js failed to load'));
      }
      sqlReady = initSqlJs({ locateFile: function (f) { return '/assets/vendor/sqljs/' + f; } })
        .catch(function (err) {
          sqlReady = null;            // clear it so a retry gets a fresh attempt
          sqlFailed(window.LabFail ? window.LabFail.classify(err) : 'unknown');
          throw err;
        });
    }
    return sqlReady;
  }

  function sqlFailed(kind) {
    var anchor = document.getElementById('hacklab');
    if (!window.LabFail || !anchor) return;
    window.LabFail.show({
      anchor: anchor, what: 'SQLite engine (sql.js)', kind: kind,
      retry: function () { location.reload(); }
    });
  }

  /* ====================================================================== *
     CHALLENGES
     Each: { id, title, category, level, brief, objective, mount(host, win),
             hints[], solution, fix }.  mount() builds the UI and calls win()
     the moment the objective is genuinely met — never on a string match
     against the input, always on the actual effect.
   * ====================================================================== */
  var CHALLENGES = [];

  /* ---- 1. SQL injection: authentication bypass -------------------------- */
  CHALLENGES.push({
    id: 'sqli-login',
    title: 'Log in as admin without the password',
    category: 'SQL injection',
    level: 1,
    brief: 'A staff portal checks your credentials with a query built by pasting your input straight into a string. Walk past it.',
    objective: 'Authenticate as the user "admin" without knowing their password.',
    hints: [
      'The query is shown live below the form. Your username and password land inside single quotes. What happens if your input contains a single quote of its own?',
      'A quote ends the string early; everything after is read as SQL. In SQLite, -- starts a comment that swallows the rest of the line.',
      'Put admin\'-- in the username and anything in the password. The password check gets commented out entirely.',
      'Or make the WHERE always true: a username of  \'  OR 1=1 --  matches the first row, which is admin.'
    ],
    solution: 'Username:  admin\'--   (password anything). The query becomes\nSELECT * FROM users WHERE username=\'admin\'--\' AND password=\'x\'\nand the password comparison is commented out, so the admin row is returned.',
    fix: 'Never build SQL by concatenating input. Use a parameterised query — SELECT * FROM users WHERE username=? AND password=? — so the driver sends your input as data that can never become SQL. Then hash passwords with bcrypt/argon2 and compare the hash, so a database leak does not hand over plaintext.',
    mount: function (root, win) {
      getSql().then(function (SQL) {
        var db = new SQL.Database();
        db.run("CREATE TABLE users(id INTEGER, username TEXT, password TEXT, role TEXT);" +
               "INSERT INTO users VALUES (1,'admin','S3cr3t-x9f2-Do-Not-Guess','administrator');" +
               "INSERT INTO users VALUES (2,'jsmith','hunter2','staff');" +
               "INSERT INTO users VALUES (3,'agarcia','p@ssw0rd','staff');");

        var form = el('div', 'hl-app');
        form.appendChild(el('p', 'hl-app-title', 'Acme Corp — Staff Portal'));
        var uWrap = el('label', 'hl-field'); uWrap.appendChild(el('span', null, 'Username'));
        var u = el('input'); u.type = 'text'; u.autocomplete = 'off'; uWrap.appendChild(u);
        var pWrap = el('label', 'hl-field'); pWrap.appendChild(el('span', null, 'Password'));
        var p = el('input'); p.type = 'text'; p.autocomplete = 'off'; pWrap.appendChild(p);
        var go = el('button', 'hl-btn', 'Sign in');
        var query = el('pre', 'hl-query');
        var result = el('div', 'hl-result');
        form.appendChild(uWrap); form.appendChild(pWrap); form.appendChild(go);
        form.appendChild(el('p', 'hl-label', 'The query your input builds:'));
        form.appendChild(query); form.appendChild(result);
        root.appendChild(form);

        function renderQuery() {
          // Deliberately the wrong way to do this. That is the exercise.
          query.textContent = "SELECT * FROM users WHERE username='" + u.value +
                              "' AND password='" + p.value + "'";
        }
        u.addEventListener('input', renderQuery);
        p.addEventListener('input', renderQuery);
        renderQuery();

        go.addEventListener('click', function () {
          result.className = 'hl-result';
          var sql = "SELECT * FROM users WHERE username='" + u.value +
                    "' AND password='" + p.value + "'";
          var rows;
          try {
            rows = db.exec(sql);
          } catch (err) {
            result.classList.add('is-err');
            result.textContent = 'SQL error: ' + err.message +
              '  — a thrown error is itself a signal that your input reached the parser.';
            return;
          }
          if (!rows.length || !rows[0].values.length) {
            result.classList.add('is-err');
            result.textContent = 'Access denied. No row matched.';
            return;
          }
          // Find which user actually authenticated.
          var cols = rows[0].columns, vals = rows[0].values[0];
          var rec = {};
          cols.forEach(function (c, i) { rec[c] = vals[i]; });
          result.classList.add('is-ok');
          result.textContent = 'Signed in as ' + rec.username + ' (' + rec.role + ').';
          if (rec.username === 'admin') win();
        });
      }).catch(function (e) {
        root.appendChild(el('p', 'hl-result is-err', 'Could not load the SQL engine: ' + e));
      });
    }
  });

  /* ---- 2. SQL injection: UNION-based data extraction -------------------- */
  CHALLENGES.push({
    id: 'sqli-union',
    title: 'Steal a secret out of a table you were never shown',
    category: 'SQL injection',
    level: 2,
    brief: 'A product search returns name and price. Somewhere else in the database is a vault table. Use the search to read it.',
    objective: 'Retrieve the value stored in the secrets table and read the flag.',
    hints: [
      'The search runs   SELECT name, price FROM products WHERE name LIKE \'%YOUR_INPUT%\'. It returns two columns. A UNION lets you append rows from another query — but only if the column counts match.',
      'Close the string and the LIKE, then UNION your own two-column SELECT. Something like:  \' UNION SELECT 1,2 --  should return a row of 1 and 2 if the shape is right.',
      'Once the shape works, swap the constants for real columns. The table is called secrets with columns label and value.',
      'Full payload:  \' UNION SELECT label, value FROM secrets --'
    ],
    solution: "Search for:  ' UNION SELECT label, value FROM secrets --\nThe query becomes SELECT name, price FROM products WHERE name LIKE '%' UNION SELECT label, value FROM secrets --%' and the secrets rows appear in the results.",
    fix: 'Same root cause and same fix as any injection: parameterise the query so input is data, not code. Defence in depth helps too — the application account should not have SELECT on a secrets table it never legitimately reads, and a UNION that changes the column set should be impossible because the query text is fixed.',
    mount: function (root, win) {
      getSql().then(function (SQL) {
        var db = new SQL.Database();
        db.run("CREATE TABLE products(id INTEGER, name TEXT, price TEXT);" +
               "INSERT INTO products VALUES (1,'Blue Widget','12.00');" +
               "INSERT INTO products VALUES (2,'Red Widget','9.50');" +
               "INSERT INTO products VALUES (3,'Green Gadget','24.99');" +
               "CREATE TABLE secrets(label TEXT, value TEXT);" +
               "INSERT INTO secrets VALUES ('flag','HL{union_select_is_not_your_friend}');" +
               "INSERT INTO secrets VALUES ('db_root_password','c0rrect-horse-vault');");

        var app = el('div', 'hl-app');
        app.appendChild(el('p', 'hl-app-title', 'Acme Shop — product search'));
        var sWrap = el('label', 'hl-field'); sWrap.appendChild(el('span', null, 'Search products'));
        var s = el('input'); s.type = 'text'; s.autocomplete = 'off'; s.placeholder = 'widget'; sWrap.appendChild(s);
        var go = el('button', 'hl-btn', 'Search');
        var query = el('pre', 'hl-query');
        var result = el('div', 'hl-result');
        app.appendChild(sWrap); app.appendChild(go);
        app.appendChild(el('p', 'hl-label', 'The query your search builds:'));
        app.appendChild(query); app.appendChild(result);
        root.appendChild(app);

        function build() {
          return "SELECT name, price FROM products WHERE name LIKE '%" + s.value + "%'";
        }
        function renderQuery() { query.textContent = build(); }
        s.addEventListener('input', renderQuery);
        renderQuery();

        go.addEventListener('click', function () {
          result.className = 'hl-result';
          result.textContent = '';
          var rows;
          try { rows = db.exec(build()); }
          catch (err) {
            result.classList.add('is-err');
            result.textContent = 'SQL error: ' + err.message;
            return;
          }
          if (!rows.length || !rows[0].values.length) {
            result.textContent = 'No products matched.';
            return;
          }
          var table = el('table', 'hl-table');
          var head = el('tr');
          rows[0].columns.forEach(function (c) { head.appendChild(el('th', null, c)); });
          table.appendChild(head);
          var leaked = false;
          rows[0].values.forEach(function (r) {
            var tr = el('tr');
            r.forEach(function (v) { tr.appendChild(el('td', null, String(v))); });
            table.appendChild(tr);
            r.forEach(function (v) { if (String(v).indexOf('HL{') !== -1) leaked = true; });
          });
          result.appendChild(table);
          if (leaked) {
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{union_select_is_not_your_friend}'));
            win();
          }
        });
      }).catch(function (e) {
        root.appendChild(el('p', 'hl-result is-err', 'Could not load the SQL engine: ' + e));
      });
    }
  });

  /* ---- 3. Reflected XSS into a sandboxed victim ------------------------- */
  CHALLENGES.push({
    id: 'xss-reflected',
    title: 'Steal a session token with a script that should never have run',
    category: 'Cross-site scripting',
    level: 2,
    brief: 'A guestbook echoes your comment straight back into the page, unescaped. A victim viewing that page carries a session token in a script variable. Take it.',
    objective: 'Make the victim page send its session token back to you — get your injected script to run and exfiltrate window.SESSION.',
    hints: [
      'Your comment is written into the victim page as raw HTML. A plain <script> tag added after load will not execute, but an element with an inline event handler will.',
      'Try an image that fails to load, with an onerror handler:  <img src=x onerror="...">.',
      'The token lives in window.SESSION. The victim page listens for the attacker via parent.postMessage. Send it:  <img src=x onerror="parent.postMessage(window.SESSION,\'*\')">',
      'Full payload:  <img src=x onerror="parent.postMessage(\'stolen:\'+window.SESSION,\'*\')">'
    ],
    solution: "Post this as your comment:\n<img src=x onerror=\"parent.postMessage('stolen:'+window.SESSION,'*')\">\nThe browser tries to load the missing image, the onerror handler runs your script inside the victim page, reads its session variable and posts it out to the attacker (us).",
    fix: 'Escape output by context. Before writing user input into HTML, convert < > & " \' to entities, so a comment can never become a tag. Better still, insert text with element.textContent rather than innerHTML, and add a Content-Security-Policy that forbids inline event handlers (script-src without unsafe-inline) as a second line of defence. HttpOnly cookies keep session tokens out of JavaScript\'s reach entirely.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Community Guestbook'));
      app.appendChild(el('p', 'hl-label', 'Your comment is shown to everyone who visits — including a logged-in moderator whose session token sits in window.SESSION on their view of the page.'));
      var cWrap = el('label', 'hl-field'); cWrap.appendChild(el('span', null, 'Leave a comment'));
      var c = el('textarea'); c.rows = 3; c.placeholder = 'Nice site!'; cWrap.appendChild(c);
      var go = el('button', 'hl-btn', 'Post comment');
      /* Says what the frame actually is. It used to read "isolated,
         opaque-origin iframe", which allow-same-origin below makes untrue — and
         on a page teaching people how sandboxing works, describing the sandbox
         wrongly is worse than saying nothing. What contains the payload here is
         the guestbook's own response CSP (connect-src 'none'), not the origin
         it runs in. */
      var label = el('p', 'hl-label',
        'The moderator\'s view of the guestbook (sandboxed same-origin iframe, ' +
        'served with connect-src \'none\' so nothing can be sent out):');
      var frame = el('iframe', 'hl-frame');
      /* The victim is loaded from a real URL, not srcdoc, and that is a fix
         for a genuine bug rather than a detail. A srcdoc or blob: frame — and,
         as it turns out, any no-same-origin sandboxed frame — inherits this
         site's strict CSP, which forbids inline script, so the student's
         injected onerror handler would silently never run: the exercise would
         be dead under the production CSP while working fine with no CSP at
         all. A same-origin document loaded from a real URL uses its OWN
         response CSP instead, and /labs/hacklab-guestbook is served with a
         policy that permits inline script (so the payload fires) while
         setting connect-src 'none' (so the payload cannot send the stolen
         value anywhere — it can only postMessage back here). The token is
         fake, and the whole origin is a static site with no accounts and no
         secrets, so a working exploit steals a string that was never worth
         anything. That harmlessness is what makes this safe to host. */
      /* The one iframe on the site built in JS rather than HTML, so the one
         place a title has to be set by hand — without it a screen reader
         announces an unnamed frame. */
      frame.setAttribute('title', "The moderator's view of the vulnerable guestbook");
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.src = '/labs/hacklab-guestbook';
      var result = el('div', 'hl-result');
      app.appendChild(cWrap); app.appendChild(go); app.appendChild(label);
      app.appendChild(frame); app.appendChild(result);
      root.appendChild(app);

      var TOKEN = 'MOD-SESSION-7f3a91c8e2';
      var victimReady = false;
      var pending = null;

      function send(comment) {
        if (frame.contentWindow) frame.contentWindow.postMessage({ comment: comment }, '*');
      }

      window.addEventListener('message', function (ev) {
        // The frame is opaque-origin, so ev.origin is "null"; accept messages
        // only from our own frame element's content window.
        if (ev.source !== frame.contentWindow) return;
        if (ev.data && ev.data.ready) {
          victimReady = true;
          if (pending !== null) { send(pending); pending = null; }
          return;
        }
        var data = String(ev.data);
        if (data.indexOf(TOKEN) !== -1) {
          result.className = 'hl-result is-ok';
          result.textContent = 'Token exfiltrated: ' + data +
            '\nYour script ran inside the victim\'s page and sent their session token to you.';
          win();
        }
      });

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        result.textContent = 'Comment posted. If a script fired, the token will arrive here.';
        // The victim writes the comment into its DOM with innerHTML — the sink.
        if (victimReady) send(c.value);
        else pending = c.value;
      });
    }
  });

  /* ---- 4. Path traversal ------------------------------------------------ */
  CHALLENGES.push({
    id: 'path-traversal',
    title: 'Read a file the viewer was never meant to serve',
    category: 'Path traversal',
    level: 1,
    brief: 'A document viewer loads files from a public folder by name. It trusts the name. Escape the folder.',
    objective: 'Read the contents of the private file at config/secrets.env.',
    hints: [
      'The app joins your input onto a base directory: public/ + your filename. It never checks for ../, which climbs one directory up.',
      'From public/, one ../ reaches the app root. The private file is at config/secrets.env relative to that root.',
      'Ask for:  ../config/secrets.env',
      'If a single ../ is stripped, try more, or ....//  which becomes ../ after a naive single strip.'
    ],
    solution: 'Request the filename  ../config/secrets.env  — the viewer builds the path public/../config/secrets.env, which resolves to config/secrets.env, outside the folder it meant to expose.',
    fix: 'Never trust a supplied path. Resolve the final absolute path and verify it still sits inside the intended directory before opening it, rejecting anything that does not. Strip or refuse .. rather than stripping it once (a single pass turns ....// into ../). Best of all, do not accept filenames at all — map an opaque id to a known-safe path on the server side.',
    mount: function (root, win) {
      // A virtual filesystem. There is no real disk here.
      var FS = {
        'public/welcome.txt': 'Welcome! Public documents live in this folder.',
        'public/brochure.txt': 'Acme Corp — we make widgets.',
        'public/pricing.txt': 'Widgets: $12. Gadgets: $25.',
        'config/secrets.env': 'DB_PASSWORD=vault-9931\nAPI_KEY=HL{traversal_left_the_folder}\nADMIN_EMAIL=root@acme.example',
        'config/app.ini': '[app]\ndebug=false'
      };

      function resolve(path) {
        // Naive resolver that DOES honour ../, which is the whole bug.
        var parts = path.split('/');
        var stack = [];
        parts.forEach(function (seg) {
          if (seg === '' || seg === '.') return;
          if (seg === '..') { stack.pop(); return; }
          stack.push(seg);
        });
        return stack.join('/');
      }

      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Acme Document Viewer'));
      var fWrap = el('label', 'hl-field'); fWrap.appendChild(el('span', null, 'File to open (inside public/)'));
      var f = el('input'); f.type = 'text'; f.autocomplete = 'off'; f.value = 'welcome.txt'; fWrap.appendChild(f);
      var go = el('button', 'hl-btn', 'Open');
      var query = el('pre', 'hl-query');
      var result = el('div', 'hl-result');
      app.appendChild(fWrap); app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The path the viewer opens:'));
      app.appendChild(query); app.appendChild(result);
      root.appendChild(app);

      function build() { return 'public/' + f.value; }
      function renderQuery() { query.textContent = build(); }
      f.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var real = resolve(build());
        if (Object.prototype.hasOwnProperty.call(FS, real)) {
          // Only a file the viewer was never meant to serve is "is-ok" — this
          // is the attacker's console, so escaping public/ is the success
          // state and a plain public/ read is the ordinary one, styled by
          // .hl-result alone. That has to be an `if`, not a ternary with ''
          // in the else arm: classList.add('') throws a SyntaxError ("the
          // token provided must not be empty"), and because it threw on the
          // very first line of the branch, opening welcome.txt — the value
          // this box starts with — left the result panel completely blank.
          // The viewer looked dead to anyone who tried it the honest way
          // first, before the traversal that this challenge is teaching.
          if (real.indexOf('config/') === 0) result.classList.add('is-ok');
          result.textContent = '── ' + real + ' ──\n' + FS[real];
          if (FS[real].indexOf('HL{') !== -1) {
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{traversal_left_the_folder}'));
            win();
          }
        } else {
          result.classList.add('is-err');
          result.textContent = 'No such file: ' + real;
        }
      });
    }
  });

  /* ---- 5. Command injection (simulated shell) --------------------------- */
  CHALLENGES.push({
    id: 'cmd-injection',
    title: 'Run your own command through a form that only meant to ping',
    category: 'Command injection',
    level: 2,
    brief: 'A network tool runs ping against the host you type, by handing your input straight to a shell. Add a command of your own.',
    objective: 'Read the flag by running cat flag.txt through the ping form.',
    note: 'The "shell" here is a small simulation — there is no real shell in your browser. The parsing of ; && | and the danger they carry are real.',
    hints: [
      'The server runs literally:  sh -c "ping -c1 <your input>". Your text is part of a shell command line. Shell metacharacters end one command and start another.',
      'A semicolon separates commands: host ; second-command. So  localhost; ls  would run ls after the ping.',
      'List the files first to find the flag:  localhost; ls',
      'Then read it:  localhost; cat flag.txt'
    ],
    solution: 'Enter  localhost; cat flag.txt  — the shell runs ping, then, after the semicolon, runs cat flag.txt, printing the flag. && and | work too.',
    fix: 'Do not build a shell command from input. Call the program directly with an argument vector (execFile("ping", ["-c1", host]) rather than exec("ping -c1 " + host)), so there is no shell to interpret metacharacters. Validate that host is actually a hostname or IP. If a shell is truly unavoidable, allow-list the exact characters permitted and reject everything else.',
    mount: function (root, win) {
      var FILES = { 'flag.txt': 'HL{never_pass_input_to_a_shell}', 'notes.txt': 'todo: fix this form', 'app.js': '// server code' };

      function runShell(line) {
        // A deliberately faithful-enough shell: split on ; && |, run each.
        var out = [];
        var commands = line.split(/\s*(?:;|&&|\|\|)\s*/);
        commands.forEach(function (cmd) {
          cmd = cmd.trim();
          if (!cmd) return;
          var argv = cmd.split(/\s+/);
          var prog = argv[0];
          if (prog === 'ping') {
            var host = argv[argv.indexOf('-c1') !== -1 ? argv.length - 1 : 1] || '';
            out.push('PING ' + host + ' : 1 packets transmitted, 1 received');
          } else if (prog === 'ls') {
            out.push(Object.keys(FILES).join('  '));
          } else if (prog === 'cat') {
            var name = argv[1];
            out.push(FILES.hasOwnProperty(name) ? FILES[name] : 'cat: ' + name + ': No such file');
          } else if (prog === 'whoami') {
            out.push('www-data');
          } else if (prog === 'id') {
            out.push('uid=33(www-data) gid=33(www-data)');
          } else if (prog === 'pwd') {
            out.push('/var/www/app');
          } else {
            out.push('sh: ' + prog + ': command not found');
          }
        });
        return out.join('\n');
      }

      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Network Diagnostics'));
      var hWrap = el('label', 'hl-field'); hWrap.appendChild(el('span', null, 'Host to ping'));
      var h = el('input'); h.type = 'text'; h.autocomplete = 'off'; h.value = 'localhost'; hWrap.appendChild(h);
      var go = el('button', 'hl-btn', 'Ping');
      var query = el('pre', 'hl-query');
      var result = el('div', 'hl-result');
      app.appendChild(hWrap); app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The command the server runs:'));
      app.appendChild(query); app.appendChild(result);
      root.appendChild(app);

      function build() { return 'sh -c "ping -c1 ' + h.value + '"'; }
      function renderQuery() { query.textContent = build(); }
      h.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var output = runShell('ping -c1 ' + h.value);
        result.textContent = output;
        if (output.indexOf('HL{') !== -1) {
          result.classList.add('is-ok');
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{never_pass_input_to_a_shell}'));
          win();
        }
      });
    }
  });

  /* ---- 6. IDOR ---------------------------------------------------------- */
  CHALLENGES.push({
    id: 'idor',
    title: 'Read someone else\'s invoice by changing a number',
    category: 'Broken access control (IDOR)',
    level: 1,
    brief: 'You are logged in as customer #2 and can view your own invoice. The id is right there in the request. Nothing checks it belongs to you.',
    objective: 'Read the confidential invoice #1001, which belongs to a different customer.',
    hints: [
      'You are viewing invoice 2002, your own. The viewer fetches by id with no ownership check. What other ids might exist?',
      'Invoice numbers are sequential and predictable. Yours is in the 2000s; try the 1000s.',
      'Set the invoice id to 1001 and view it.'
    ],
    solution: 'Change the invoice id from your own (2002) to 1001 and view it. The server returns it because it only checks that you are logged in, not that the invoice is yours — an Insecure Direct Object Reference.',
    fix: 'Check authorisation on every object access, not just authentication. Before returning invoice N, confirm invoice N belongs to the logged-in user. Predictable ids are not the vulnerability — the missing ownership check is — but using unguessable ids (UUIDs) is useful defence in depth.',
    mount: function (root, win) {
      var INVOICES = {
        2001: { owner: 2, to: 'You', amount: '$120.00', note: 'Your March invoice.' },
        2002: { owner: 2, to: 'You', amount: '$98.50', note: 'Your April invoice.' },
        1001: { owner: 1, to: 'Northwind Ltd', amount: '$44,900.00', note: 'CONFIDENTIAL — acquisition retainer. Flag: HL{check_the_owner_not_just_the_login}' },
        1002: { owner: 1, to: 'Northwind Ltd', amount: '$12,000.00', note: 'Consulting, Q1.' }
      };
      var ME = 2;

      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Billing — logged in as customer #2'));
      var iWrap = el('label', 'hl-field'); iWrap.appendChild(el('span', null, 'Invoice id'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = '2002'; iWrap.appendChild(i);
      var go = el('button', 'hl-btn', 'View invoice');
      var query = el('pre', 'hl-query');
      var result = el('div', 'hl-result');
      app.appendChild(iWrap); app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The request the app makes:'));
      app.appendChild(query); app.appendChild(result);
      root.appendChild(app);

      function renderQuery() { query.textContent = 'GET /api/invoice?id=' + i.value + '   (session: customer #2)'; }
      i.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var inv = INVOICES[parseInt(i.value, 10)];
        if (!inv) { result.classList.add('is-err'); result.textContent = 'Invoice not found.'; return; }
        // The bug: authenticated, but no check that inv.owner === ME.
        result.classList.add('is-ok');
        result.textContent = 'Invoice #' + i.value + '\nBill to: ' + inv.to +
          '\nAmount: ' + inv.amount + '\n' + inv.note;
        if (inv.owner !== ME && inv.note.indexOf('HL{') !== -1) {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{check_the_owner_not_just_the_login}'));
          win();
        }
      });
    }
  });


  /* ====================================================================== *
     ADDITIONAL CHALLENGES — appended after the original six. Each is a real
     class of bug run against an in-memory fake, in the same shape as the rest:
     mount(root, win) builds the vulnerable app and calls win() on the solve.
   * ====================================================================== */

  function b64urlEncode(obj) {
    var s = JSON.stringify(obj);
    var b = btoa(unescape(encodeURIComponent(s)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    var b = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    try { return decodeURIComponent(escape(atob(b))); } catch (e) { return atob(b); }
  }

  /* ---- JWT alg:none --------------------------------------------------- */
  CHALLENGES.push({
    id: 'jwt-none',
    title: 'Forge an admin token by turning the signature off',
    category: 'Authentication (JWT)',
    level: 2,
    brief: 'This API accepts JSON Web Tokens. It reads the algorithm from the token’s own header and, fatally, honours "alg":"none" — a token that says it needs no signature.',
    objective: 'Present a token that the server accepts as user "admin" with role "admin".',
    hints: [
      'A JWT is three base64url parts: header.payload.signature. The header names the algorithm. Decode the given token and read it.',
      'The verifier trusts the header. If the header says {"alg":"none"}, it skips signature checking entirely. Change the payload to role admin, set alg to none, and leave the signature part empty.',
      'Header {"alg":"none","typ":"JWT"} and payload {"user":"admin","role":"admin"}, base64url-encoded, joined with dots, with a trailing dot and no signature: header.payload.'
    ],
    solution: 'Base64url-encode {"alg":"none","typ":"JWT"} and {"user":"admin","role":"admin"}, join them with a dot, and add a trailing dot for the empty signature. The server sees alg:none and accepts the unsigned token.',
    fix: 'Never let the token choose the algorithm. Pin the expected algorithm server-side (e.g. HS256 or RS256) and reject "none" outright. Verify the signature before reading any claim, and treat a token that fails verification as absent, not as a guest.',
    mount: function (root, win) {
      var startHeader = { alg: 'HS256', typ: 'JWT' };
      var startPayload = { user: 'guest', role: 'user' };
      var startTok = b64urlEncode(startHeader) + '.' + b64urlEncode(startPayload) + '.c2lnbmVkX3dpdGhfYV9zZWNyZXQ';

      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Account API — send a bearer token'));
      app.appendChild(el('p', 'hl-label', 'Your current token (guest):'));
      var given = el('pre', 'hl-query'); given.textContent = startTok; app.appendChild(given);

      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Authorization: Bearer'));
      var i = el('textarea'); i.rows = 3; i.value = startTok; i.spellcheck = false; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Call /api/me');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var parts = i.value.trim().split('.');
        if (parts.length < 2) { result.classList.add('is-err'); result.textContent = 'Malformed token.'; return; }
        var header, payload;
        try { header = JSON.parse(b64urlDecode(parts[0])); payload = JSON.parse(b64urlDecode(parts[1])); }
        catch (e) { result.classList.add('is-err'); result.textContent = 'Could not decode token: ' + e.message; return; }
        // The bug: honour the header's alg, and skip verification when it is "none".
        var alg = String(header.alg || '').toLowerCase();
        if (alg !== 'none' && parts[2] !== 'c2lnbmVkX3dpdGhfYV9zZWNyZXQ') {
          result.classList.add('is-err');
          result.textContent = 'Signature invalid for alg ' + header.alg + '. (Tip: the server also accepts alg "none".)';
          return;
        }
        result.classList.add('is-ok');
        result.textContent = 'Authenticated as ' + payload.user + ' (role: ' + payload.role + ').';
        if (payload.role === 'admin' && payload.user === 'admin' && alg === 'none') {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{alg_none_is_not_a_signature}'));
          win();
        }
      });
    }
  });

  /* ---- NoSQL injection ------------------------------------------------ */
  CHALLENGES.push({
    id: 'nosql-injection',
    title: 'Log in without a password using a query operator',
    category: 'NoSQL injection',
    level: 2,
    brief: 'This login builds a MongoDB query from the JSON body: { user, pass }. It never checks that the values are strings, so an object with an operator slips straight into the query.',
    objective: 'Log in as "admin" without knowing the password.',
    hints: [
      'The query is db.users.findOne({ user: <your user>, pass: <your pass> }). What if pass were not a string but an object?',
      'MongoDB treats { "$ne": "" } as "not equal to empty" — which matches any real password. Send that as the password value.',
      'Set user to "admin" and pass to the JSON object {"$ne":""}. Use the JSON body editor.'
    ],
    solution: 'Send a JSON body where the password is a query operator, e.g. {"user":"admin","pass":{"$ne":""}}. The database matches the admin row because their password is "not equal to empty", and you are logged in without ever knowing it.',
    fix: 'Cast inputs to the type you expect before querying — a password must be a string, not an object. Reject non-string credentials, use a data-access layer that parameterises queries, and never build a query straight from an untrusted JSON body.',
    mount: function (root, win) {
      var USERS = [{ user: 'admin', pass: 'S3cr3t-f9x2!', flag: 'HL{operators_are_not_strings}' }];
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Login — JSON body'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'POST /login body (JSON)'));
      var i = el('textarea'); i.rows = 3; i.spellcheck = false;
      i.value = '{ "user": "admin", "pass": "guess" }';
      w.appendChild(i); app.appendChild(w);
      var go = el('button', 'hl-btn', 'Log in');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The query the app runs:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function parseBody() { try { return JSON.parse(i.value); } catch (e) { return null; } }
      function renderQuery() {
        var b = parseBody();
        query.textContent = b ? 'db.users.findOne(' + JSON.stringify({ user: b.user, pass: b.pass }) + ')'
                              : '(invalid JSON)';
      }
      i.addEventListener('input', renderQuery);
      renderQuery();

      function matches(cond, value) {
        // a tiny fake Mongo matcher: strings match by equality, objects by operator
        if (cond && typeof cond === 'object') {
          if ('$ne' in cond) return value !== cond.$ne;
          if ('$gt' in cond) return value > cond.$gt;
          if ('$regex' in cond) { try { return new RegExp(cond.$regex).test(value); } catch (e) { return false; } }
          return false;
        }
        return value === cond;
      }

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var b = parseBody();
        if (!b) { result.classList.add('is-err'); result.textContent = 'Invalid JSON body.'; return; }
        var hit = USERS.filter(function (u) { return matches(b.user, u.user) && matches(b.pass, u.pass); })[0];
        if (!hit) { result.classList.add('is-err'); result.textContent = 'Invalid credentials.'; return; }
        result.classList.add('is-ok');
        result.textContent = 'Logged in as ' + hit.user + '.';
        // solved only if the password was NOT the real string (i.e. an injection)
        if (typeof b.pass !== 'string') {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: ' + hit.flag));
          win();
        }
      });
    }
  });

  /* ---- Mass assignment ------------------------------------------------ */
  CHALLENGES.push({
    id: 'mass-assignment',
    title: 'Make yourself an admin by adding a field the form never showed',
    category: 'Mass assignment',
    level: 2,
    brief: 'The "update profile" endpoint copies every field of your JSON body onto the user record. The form only shows name and email — but nothing stops you sending more.',
    objective: 'Change your own role to "admin".',
    hints: [
      'The server does user = Object.assign(user, body). It trusts that the body only contains the fields the form renders.',
      'Add a field the form never offered. The role is stored on the same record.',
      'Send {"name":"You","email":"you@example.com","role":"admin"}.'
    ],
    solution: 'Add "role":"admin" to the JSON body. The endpoint blindly merges the whole body onto your user object, so the extra field overwrites your role — classic mass assignment (over-posting).',
    fix: 'Never bind a request body straight onto a model. Use an explicit allow-list of fields a user may change (name, email) and ignore everything else. Sensitive fields like role, isAdmin or credit balance must only ever be set by trusted server code.',
    mount: function (root, win) {
      var user = { id: 7, name: 'You', email: 'you@example.com', role: 'user' };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Edit profile'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'PATCH /me body (JSON)'));
      var i = el('textarea'); i.rows = 4; i.spellcheck = false;
      i.value = '{\n  "name": "You",\n  "email": "you@example.com"\n}';
      w.appendChild(i); app.appendChild(w);
      var go = el('button', 'hl-btn', 'Save profile');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Your record after saving:'));
      var out = el('pre', 'hl-query'); out.textContent = JSON.stringify(user, null, 2); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var body; try { body = JSON.parse(i.value); } catch (e) { result.classList.add('is-err'); result.textContent = 'Invalid JSON.'; return; }
        // The bug: merge the whole body, no allow-list.
        Object.keys(body).forEach(function (k) { user[k] = body[k]; });
        out.textContent = JSON.stringify(user, null, 2);
        result.classList.add('is-ok');
        result.textContent = 'Profile saved.';
        if (user.role === 'admin') {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{allow_list_your_writable_fields}'));
          win();
        }
      });
    }
  });

  /* ---- Open redirect -------------------------------------------------- */
  CHALLENGES.push({
    id: 'open-redirect',
    title: 'Bounce a victim to an attacker site through a trusted link',
    category: 'Open redirect',
    level: 2,
    brief: 'After login the app sends you wherever ?next= says. It never checks that the destination is one of its own pages, so the link — on a domain the victim trusts — can point anywhere.',
    objective: 'Craft a next value that redirects off-site, to https://evil.example.',
    hints: [
      'The app does location = decodeURIComponent(next) with no validation. It assumes next is a path like /account.',
      'A full URL is a valid value too. What happens if next is an absolute URL to another origin?',
      'Set next to https://evil.example/phish and submit.'
    ],
    solution: 'Put an absolute off-site URL in next, e.g. ?next=https://evil.example/phish. Because the app redirects to the raw value without checking it stays on-site, the trusted login link delivers the victim to the attacker.',
    fix: 'Only redirect to destinations you control. Accept a relative path and reject anything that starts with a scheme, "//", or a different host. A safe pattern is an allow-list of paths, or storing the intended destination server-side against a key instead of passing a URL in the query string.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Login redirect — trusted-site.example'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Continue link: /login?next='));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = '/account'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Follow the link');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The redirect the browser performs:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function dest() { try { return decodeURIComponent(i.value); } catch (e) { return i.value; } }
      function renderQuery() { query.textContent = '302 Location: ' + dest(); }
      i.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var d = dest();
        // simulate: parse the destination's origin. No real navigation happens.
        var offsite = /^[a-z][a-z0-9+.-]*:\/\//i.test(d) || d.indexOf('//') === 0;
        var host = '';
        try { host = new URL(d, 'https://trusted-site.example').host; } catch (e) { host = ''; }
        if (offsite && host && host !== 'trusted-site.example') {
          result.classList.add('is-ok');
          result.textContent = 'The victim’s browser leaves trusted-site.example and lands on ' + host + '.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{redirect_only_to_paths_you_own}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Redirected within trusted-site.example to ' + d + '. Still on-site — no victim harmed.';
        }
      });
    }
  });

  /* ---- XXE ------------------------------------------------------------ */
  CHALLENGES.push({
    id: 'xxe',
    title: 'Read a server file through an XML document',
    category: 'XML external entities (XXE)',
    level: 3,
    brief: 'This importer parses uploaded XML with external entities enabled. An entity can be made to point at a file on the server, and its contents are then substituted into the parsed output.',
    objective: 'Make the parser disclose the contents of /etc/passwd.',
    hints: [
      'XML lets you declare entities in a DOCTYPE. A normal one is text; an EXTERNAL one can reference a URI, including file://.',
      'Declare an entity whose SYSTEM identifier is the file you want, then reference it in the body so its contents are expanded into an element.',
      'Use: <!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]> and put &xxe; inside an element.'
    ],
    solution: 'Define an external entity pointing at the file and reference it in the document, e.g. <?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>. The parser resolves file:///etc/passwd and expands its contents into the element.',
    fix: 'Disable DOCTYPE and external entity resolution in your XML parser (in most libraries a single flag, e.g. FEATURE_SECURE_PROCESSING / disallow-doctype-decl). Better still, prefer a format without this footgun — JSON — for untrusted input.',
    mount: function (root, win) {
      var FILES = {
        'file:///etc/passwd': 'root:x:0:0:root:/root:/bin/bash\nwww-data:x:33:33:/var/www:/usr/sbin/nologin\ndeploy:x:1000:1000::/home/deploy:/bin/bash\n# flag: HL{disable_external_entities}',
        'file:///etc/hostname': 'app-prod-01'
      };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'XML product importer'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Paste XML to import'));
      var i = el('textarea'); i.rows = 5; i.spellcheck = false;
      i.value = '<?xml version="1.0"?>\n<product>\n  <name>Widget</name>\n</product>';
      w.appendChild(i); app.appendChild(w);
      var go = el('button', 'hl-btn', 'Import');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Parsed result:'));
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var xml = i.value;
        // fake parser: find <!ENTITY name SYSTEM "uri"> and expand &name; from FILES
        var ent = /<!ENTITY\s+([A-Za-z0-9_]+)\s+SYSTEM\s+"([^"]+)"\s*>/.exec(xml);
        var expanded = xml, leaked = false;
        if (ent) {
          var name = ent[1], uri = ent[2];
          var content = FILES[uri];
          if (content && new RegExp('&' + name + ';').test(xml)) {
            expanded = xml.replace(new RegExp('&' + name + ';', 'g'), content);
            if (content.indexOf('HL{') !== -1) leaked = true;
          }
        }
        // strip the doctype/prolog for display of the "element text"
        var body = expanded.replace(/<\?xml[^?]*\?>/, '').replace(/<!DOCTYPE[\s\S]*?\]>/, '').trim();
        out.textContent = body || '(empty)';
        if (leaked) {
          result.classList.add('is-ok');
          result.textContent = 'The parser resolved an external entity and expanded a server file into the document.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{disable_external_entities}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Imported. No external entity was resolved.';
        }
      });
    }
  });

  /* ---- SSRF ----------------------------------------------------------- */
  CHALLENGES.push({
    id: 'ssrf',
    title: 'Reach an internal service through a URL-preview feature',
    category: 'Server-side request forgery (SSRF)',
    level: 3,
    brief: 'The link-preview fetches whatever URL you paste — from the server. The server sits inside a network with services a visitor could never reach directly, and it happily fetches those too.',
    objective: 'Read the cloud metadata service at http://169.254.169.254/latest/meta-data/iam/credentials.',
    hints: [
      'The server fetches your URL with no restriction on where it points. It can reach addresses your browser cannot — localhost and link-local ranges inside the datacentre.',
      'Cloud instances expose a metadata service on a fixed link-local address that hands out credentials to anything on the box.',
      'Fetch http://169.254.169.254/latest/meta-data/iam/credentials.'
    ],
    solution: 'Paste an internal URL. The server-side fetcher will retrieve http://169.254.169.254/latest/meta-data/iam/credentials — the cloud metadata endpoint — and return its response, leaking instance credentials to you.',
    fix: 'Do not let user input choose what the server connects to. Resolve and validate the host against an allow-list, block private, loopback and link-local ranges (127.0.0.0/8, 169.254.0.0/16, 10/8, 192.168/16, ::1), disable redirects to those ranges, and require the metadata service to use signed requests (IMDSv2).',
    mount: function (root, win) {
      var INTERNAL = {
        'http://169.254.169.254/latest/meta-data/iam/credentials': '{ "AccessKeyId": "AKIAINTERNAL", "SecretAccessKey": "wJalr...", "Token": "flag:HL{block_link_local_and_private_ranges}" }',
        'http://localhost:9200/_cat/indices': 'green open users  5 1 10423 0 8mb\ngreen open orders 5 1 88211 0 40mb',
        'http://10.0.0.5/admin': '<h1>Internal admin</h1>'
      };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Link preview'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'URL to preview'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'https://example.com'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Fetch preview (from the server)');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'What the server fetched:'));
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var url = i.value.trim();
        if (INTERNAL[url]) {
          out.textContent = INTERNAL[url];
          result.classList.add('is-ok');
          result.textContent = 'The server reached an internal address on your behalf.';
          if (INTERNAL[url].indexOf('HL{') !== -1) {
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{block_link_local_and_private_ranges}'));
            win();
          }
        } else if (/^https?:\/\//i.test(url)) {
          out.textContent = '<!DOCTYPE html><title>Example</title><h1>External page preview</h1>';
          result.classList.add('is-err');
          result.textContent = 'Fetched an external page. Try an address that only the server can reach.';
        } else {
          out.textContent = '';
          result.classList.add('is-err');
          result.textContent = 'Invalid URL.';
        }
      });
    }
  });

  /* ---- Prototype pollution -------------------------------------------- */
  CHALLENGES.push({
    id: 'proto-pollution',
    title: 'Poison every object at once by writing to __proto__',
    category: 'Prototype pollution',
    level: 3,
    brief: 'This settings endpoint deep-merges your JSON into a config object. The merge walks keys recursively and never guards the special key __proto__, so a write there lands on Object.prototype and every object in the program inherits it.',
    objective: 'Pollute the prototype so that a brand-new, empty object has isAdmin === true.',
    hints: [
      'A naive recursive merge does target[key] = merge(target[key], source[key]). When key is "__proto__", target[key] is Object.prototype.',
      'Nest the payload so the dangerous key sits one level down: { "__proto__": { "isAdmin": true } }.',
      'Send {"__proto__":{"isAdmin":true}}. Afterwards the app checks ({}).isAdmin.'
    ],
    solution: 'Send {"__proto__":{"isAdmin":true}}. The unsafe deep-merge follows the __proto__ key onto Object.prototype and sets isAdmin there, so every object — including a fresh {} used later for an authorisation check — now reports isAdmin true.',
    fix: 'Reject or skip the keys __proto__, constructor and prototype in any recursive merge. Use a null-prototype object (Object.create(null)) or a Map for untrusted data, freeze Object.prototype, and prefer vetted libraries whose merge is hardened against this.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Application settings — deep merge'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'POST /settings body (JSON)'));
      var i = el('textarea'); i.rows = 3; i.spellcheck = false;
      i.value = '{ "theme": "dark" }';
      w.appendChild(i); app.appendChild(w);
      var go = el('button', 'hl-btn', 'Save settings');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Authorisation probe — a fresh object’s inherited isAdmin:'));
      var out = el('pre', 'hl-query'); out.textContent = '({}).isAdmin === undefined'; app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      // an intentionally unsafe recursive merge
      function unsafeMerge(target, src) {
        for (var k in src) {
          if (src[k] && typeof src[k] === 'object') {
            if (!target[k] || typeof target[k] !== 'object') target[k] = {};
            unsafeMerge(target[k], src[k]);
          } else {
            target[k] = src[k];
          }
        }
        return target;
      }

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var body; try { body = JSON.parse(i.value); } catch (e) { result.classList.add('is-err'); result.textContent = 'Invalid JSON.'; return; }
        var config = {};
        try { unsafeMerge(config, body); } catch (e) {}
        // The authorisation probe: does a brand-new object now inherit isAdmin?
        var probe = {};
        var polluted = probe.isAdmin === true;
        out.textContent = '({}).isAdmin === ' + JSON.stringify(probe.isAdmin);
        if (polluted) {
          result.classList.add('is-ok');
          result.textContent = 'Object.prototype is polluted — every object now inherits isAdmin.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{guard___proto___in_merges}'));
          // clean up so the page itself is not left poisoned
          try { delete Object.prototype.isAdmin; } catch (e) {}
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Settings saved. The probe object is still clean.';
        }
        try { delete Object.prototype.isAdmin; } catch (e) {}
      });
    }
  });

  /* ---- CORS misconfiguration ------------------------------------------ */
  CHALLENGES.push({
    id: 'cors-misconfig',
    title: 'Read another origin’s data by reflecting the Origin header',
    category: 'CORS misconfiguration',
    level: 3,
    brief: 'This API reflects whatever Origin the request carries back into Access-Control-Allow-Origin, and sets Allow-Credentials: true. That combination lets any site read the response with the victim’s cookies attached.',
    objective: 'Craft a cross-origin request whose Origin the server will trust, so evil.example can read the private response.',
    hints: [
      'A safe API echoes an Origin only if it is on an allow-list. This one echoes it unconditionally, and pairs it with Access-Control-Allow-Credentials: true.',
      'When the allowed origin is reflected and credentials are allowed, the attacker’s page (any Origin) can read the response including private data.',
      'Set the Origin header to https://evil.example and send the request.'
    ],
    solution: 'Send the request with Origin: https://evil.example. The server reflects it into Access-Control-Allow-Origin and allows credentials, so a script on evil.example can read the private response with the victim’s session cookie — a cross-origin data leak.',
    fix: 'Never reflect the Origin blindly. Compare it against a strict allow-list and only then echo it. Do not combine a wildcard or reflected origin with Access-Control-Allow-Credentials: true. If the resource is not meant to be shared cross-origin, send no CORS headers at all.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'GET https://api.trusted.example/me  (cookies attached)'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Origin header of the cross-site request'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'https://trusted.example'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Send request from that origin');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Response headers + whether the calling page may read the body:'));
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var origin = i.value.trim();
        // The bug: reflect any origin, allow credentials.
        var acao = origin;
        var headers = 'Access-Control-Allow-Origin: ' + acao + '\n' +
                      'Access-Control-Allow-Credentials: true';
        // the browser lets the page read the body iff ACAO === the page's Origin
        var canRead = acao === origin;
        var body = canRead
          ? '{ "user": "victim", "email": "victim@trusted.example", "flag": "HL{never_reflect_origin_with_credentials}" }'
          : '(blocked by the browser — ACAO did not match)';
        out.textContent = headers + '\n\nBody readable by ' + origin + ': ' + canRead + '\n' + body;
        if (canRead && origin && origin !== 'https://trusted.example') {
          result.classList.add('is-ok');
          result.textContent = 'A page on ' + origin + ' just read the victim’s private response.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{never_reflect_origin_with_credentials}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Request sent from ' + origin + '. Try an origin that is clearly not the trusted site.';
        }
      });
    }
  });


  /* ---- Insecure deserialization -------------------------------------- */
  CHALLENGES.push({
    id: 'insecure-deser',
    title: 'Promote yourself by tampering with a base64 session cookie',
    category: 'Insecure deserialization',
    level: 2,
    brief: 'Your session is a base64-encoded JSON object handed straight back to you, with no signature. The server decodes it and trusts every field, including your role.',
    objective: 'Present a session that the server reads as role "admin".',
    hints: [
      'The cookie is not encrypted or signed — it is just base64 of JSON. Decode it and read what is inside.',
      'Change the role to admin, re-encode the JSON as base64, and send it back. Nothing verifies it was not tampered with.',
      'base64( {"user":"you","role":"admin"} ) — paste that as the session value.'
    ],
    solution: 'Base64-decode the session to reveal a JSON object, change "role" to "admin", base64-encode it again and submit. Because the session is neither signed nor encrypted, the server accepts the modified object as-is.',
    fix: 'Never trust client-held state. Either keep the session server-side and give the client only an opaque random id, or sign the cookie (HMAC) and verify the signature before reading any field. Encoding is not integrity — base64 is not a security boundary.',
    mount: function (root, win) {
      var start = btoa(JSON.stringify({ user: 'you', role: 'user' }));
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Session cookie (base64 of JSON)'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Cookie: session='));
      var i = el('textarea'); i.rows = 2; i.spellcheck = false; i.value = start; w.appendChild(i);
      app.appendChild(w);
      app.appendChild(el('p', 'hl-label', 'What the server decodes it to:'));
      var decoded = el('pre', 'hl-query'); app.appendChild(decoded);
      var go = el('button', 'hl-btn', 'Load dashboard');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderDecoded() {
        try { decoded.textContent = JSON.stringify(JSON.parse(atob(i.value.trim())), null, 2); }
        catch (e) { decoded.textContent = '(not valid base64 JSON)'; }
      }
      i.addEventListener('input', renderDecoded);
      renderDecoded();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var obj; try { obj = JSON.parse(atob(i.value.trim())); } catch (e) { result.classList.add('is-err'); result.textContent = 'Corrupt session.'; return; }
        result.classList.add('is-ok');
        result.textContent = 'Dashboard for ' + obj.user + ' (role: ' + obj.role + ').';
        if (obj.role === 'admin') {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{sign_or_server_side_your_sessions}'));
          win();
        }
      });
    }
  });

  /* ---- Server-side template injection --------------------------------- */
  CHALLENGES.push({
    id: 'ssti',
    title: 'Break out of a template and read a server secret',
    category: 'Template injection (SSTI)',
    level: 2,
    brief: 'The greeting page drops your name straight into a server-side template string. The template engine evaluates {{ ... }} expressions — including ones you supply.',
    objective: 'Make the template evaluate an expression and reveal the value of {{ secret }}.',
    hints: [
      'The page renders "Hello, <your name>". Your name is placed inside the template before it is evaluated, not after.',
      'Template engines evaluate {{ expression }}. Try {{7*7}} and watch it become 49 — proof your input is being evaluated as code.',
      'The engine exposes a variable called secret. Submit {{secret}}.'
    ],
    solution: 'Enter a template expression as your name. {{7*7}} renders as 49, confirming injection; {{secret}} then evaluates the server-side secret variable and prints it — server-side template injection leading to data disclosure (and, in real engines, remote code execution).',
    fix: 'Never build a template from untrusted input. Pass user data as *values* into a pre-compiled template (context variables), never concatenate it into the template source. Sandbox or disable dangerous globals in the template engine, and prefer logic-less templating.',
    mount: function (root, win) {
      var CONTEXT = { secret: 'HL{user_input_is_data_never_template_source}' };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Greeting page'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Your name'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'Alex'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Render greeting');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The template the server renders:'));
      var tmpl = el('pre', 'hl-query'); app.appendChild(tmpl);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderTmpl() { tmpl.textContent = "render('Hello, " + i.value + "!')"; }
      i.addEventListener('input', renderTmpl);
      renderTmpl();

      // a deliberately unsafe mini template engine: evaluate {{ ... }} against CONTEXT
      function renderTemplate(src) {
        return src.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (_, expr) {
          try {
            if (/^[\w.]+$/.test(expr) && expr in CONTEXT) return String(CONTEXT[expr]);
            // arithmetic only — enough to demonstrate evaluation without real eval
            if (/^[\d\s+\-*/().]+$/.test(expr)) {
              // eslint-disable-next-line no-new-func
              return String(Function('"use strict";return (' + expr + ')')());
            }
            return '';
          } catch (e) { return ''; }
        });
      }

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var rendered = renderTemplate('Hello, ' + i.value + '!');
        result.classList.add('is-ok');
        result.textContent = rendered;
        if (rendered.indexOf('HL{') !== -1) {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{user_input_is_data_never_template_source}'));
          win();
        }
      });
    }
  });

  /* ---- LDAP injection ------------------------------------------------- */
  CHALLENGES.push({
    id: 'ldap-injection',
    title: 'Bypass an LDAP login with a wildcard filter',
    category: 'LDAP injection',
    level: 2,
    brief: 'This login builds an LDAP search filter by pasting your input between parentheses. LDAP filter syntax uses * and () as operators, and none of it is escaped.',
    objective: 'Authenticate as any valid user without a correct password.',
    hints: [
      'The filter is (&(uid=<user>)(userPassword=<pass>)). Both halves must match. What does * mean in an LDAP filter?',
      'In LDAP, * is a wildcard that matches any value. If the password field becomes just *, it matches any stored password.',
      'Set user to admin and password to * — the filter becomes (&(uid=admin)(userPassword=*)), which matches.'
    ],
    solution: 'Enter * as the password (or user). LDAP treats * as "matches any value", so the filter (&(uid=admin)(userPassword=*)) is satisfied by the admin entry regardless of the real password, and you are authenticated.',
    fix: 'Escape LDAP filter metacharacters ( ) * \\ NUL in all user input before building a filter (RFC 4515), or use a parameterised LDAP API. As always, bind with least privilege and never interpolate raw input into a query language.',
    mount: function (root, win) {
      var DIR = [{ uid: 'admin', pass: 'Zx9-qq!' }, { uid: 'jsmith', pass: 'hunter2' }];
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Directory login'));
      var uw = el('label', 'hl-field'); uw.appendChild(el('span', null, 'uid')); var u = el('input'); u.type = 'text'; u.autocomplete = 'off'; u.value = 'admin'; uw.appendChild(u);
      var pw = el('label', 'hl-field'); pw.appendChild(el('span', null, 'password')); var pp = el('input'); pp.type = 'text'; pp.autocomplete = 'off'; pp.value = 'guess'; pw.appendChild(pp);
      app.appendChild(uw); app.appendChild(pw);
      var go = el('button', 'hl-btn', 'Bind');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The LDAP filter:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderQuery() { query.textContent = '(&(uid=' + u.value + ')(userPassword=' + pp.value + '))'; }
      u.addEventListener('input', renderQuery); pp.addEventListener('input', renderQuery);
      renderQuery();

      function ldapMatch(pattern, value) {
        // convert an LDAP-ish value with * wildcards into a regex
        var re = '^' + pattern.split('*').map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$';
        try { return new RegExp(re).test(value); } catch (e) { return false; }
      }

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var hit = DIR.filter(function (e) { return ldapMatch(u.value, e.uid) && ldapMatch(pp.value, e.pass); })[0];
        if (!hit) { result.classList.add('is-err'); result.textContent = 'Bind failed.'; return; }
        result.classList.add('is-ok');
        result.textContent = 'Bound as ' + hit.uid + '.';
        if (pp.value.indexOf('*') !== -1 || u.value.indexOf('*') !== -1) {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{escape_ldap_filter_metacharacters}'));
          win();
        }
      });
    }
  });

  /* ---- CSV / formula injection ---------------------------------------- */
  CHALLENGES.push({
    id: 'csv-injection',
    title: 'Smuggle a spreadsheet formula into an exported report',
    category: 'CSV formula injection',
    level: 2,
    brief: 'Your display name is written verbatim into a CSV export that staff open in a spreadsheet. A cell that starts with =, +, - or @ is run as a formula when the file is opened.',
    objective: 'Set a display name that becomes an executable formula in the exported CSV.',
    hints: [
      'Whatever you type becomes a cell value in the CSV. Spreadsheets treat a leading =, +, - or @ as the start of a formula, not text.',
      'A formula cell can call functions — the dangerous ones reach the shell or exfiltrate data. Even a simple =1+1 proves the cell is executable.',
      'Set your name to something like =2+5 (or =HYPERLINK("http://evil","click")). The export cell will begin with =.'
    ],
    solution: 'Put a formula in your name, e.g. =2+5. When the CSV is generated your name is written straight into a cell, and any spreadsheet opening the file evaluates it as a formula. Real payloads use =HYPERLINK, =WEBSERVICE or DDE/command execution.',
    fix: 'Sanitise every field written to CSV: prefix any value beginning with =, +, -, @, tab or CR with a single quote (or a space), quote fields properly, and set the correct content type. Do not rely on the spreadsheet to treat attacker data as text.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Profile → export to CSV'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Display name'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'Jordan'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Generate CSV');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'report.csv:'));
      var csv = el('pre', 'hl-query'); app.appendChild(csv);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var name = i.value;
        csv.textContent = 'id,name,role\n7,' + name + ',user';
        var first = name.charAt(0);
        if (first === '=' || first === '+' || first === '-' || first === '@') {
          result.classList.add('is-ok');
          result.textContent = 'The name cell begins with "' + first + '" — a spreadsheet opening this file will execute it as a formula.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{prefix_dangerous_cells_with_a_quote}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Exported. The name is inert text.';
        }
      });
    }
  });

  /* ---- Host header injection (password reset poisoning) --------------- */
  CHALLENGES.push({
    id: 'host-header',
    title: 'Poison a password-reset link with the Host header',
    category: 'Host header injection',
    level: 3,
    brief: 'The password-reset email builds its link from the incoming Host header instead of a fixed configured domain. Control the Host and you control where the victim’s reset token is sent.',
    objective: 'Make the reset link point at attacker-controlled evil.example so the token lands on your server.',
    hints: [
      'The app does resetUrl = "https://" + req.headers.host + "/reset?token=...". It trusts the Host header the client sent.',
      'If you can set the Host header (or an X-Forwarded-Host that the app honours), the generated link uses your domain. The victim clicks it and their token reaches you.',
      'Set the Host header to evil.example.'
    ],
    solution: 'Send the reset request with Host: evil.example. The app builds the reset link from that header, so the email to the victim contains https://evil.example/reset?token=... — when they click it, their token is delivered to the attacker.',
    fix: 'Never build absolute URLs from the Host header. Use a fixed, configured canonical domain for links in emails. Validate the Host / X-Forwarded-Host against an allow-list at the edge, and reject requests with an unexpected Host.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Forgot password — request a reset for victim@site.example'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Host header of your request'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'site.example'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Send reset email');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The link placed in the victim’s email:'));
      var link = el('pre', 'hl-query'); app.appendChild(link);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderLink() { link.textContent = 'https://' + i.value + '/reset?token=8f3a1c...'; }
      i.addEventListener('input', renderLink);
      renderLink();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var host = i.value.trim();
        if (host && host !== 'site.example') {
          result.classList.add('is-ok');
          result.textContent = 'The victim’s reset link now points at ' + host + '. When they click it, their token is sent to you.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{build_links_from_a_fixed_domain}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Reset email sent with the legitimate domain. No harm done.';
        }
      });
    }
  });

  /* ---- Predictable token (insecure randomness) ------------------------ */
  CHALLENGES.push({
    id: 'weak-random',
    title: 'Predict a “secure” token built from the clock',
    category: 'Insecure randomness',
    level: 3,
    brief: 'Password-reset tokens here are generated from the current time in milliseconds, hashed. Time is not a secret: if you know roughly when a token was issued, you can regenerate it.',
    objective: 'Reproduce the victim’s reset token, issued at a known timestamp.',
    hints: [
      'The token is hash(issuedAtMillis). The issue time is shown to you (it is in the email’s Date header in reality). There is no random component.',
      'Feed the same millisecond value through the same hash and you get the same token. Try the exact issuedAt shown.',
      'Enter the issuedAt value shown as the "guessed time" and generate — the token will match.'
    ],
    solution: 'Because the token derives only from the issue time, hashing the known issuedAt reproduces it exactly. There is no entropy to guess — the "random" token is a pure function of a value the attacker can read.',
    fix: 'Generate tokens from a cryptographically secure random source (crypto.getRandomValues / crypto.randomBytes), at least 128 bits, never from the clock, a counter or Math.random. Store the token hashed and expire it quickly.',
    mount: function (root, win) {
      // pick a fixed "issue time" so the challenge is deterministic and offline
      var issuedAt = 1734300000000;
      function weakHash(n) { // a tiny deterministic hash of the millisecond value
        var h1 = 2166136261 >>> 0, h2 = 0x9e3779b9 >>> 0;
        var s = String(n);
        for (var k = 0; k < s.length; k++) {
          h1 ^= s.charCodeAt(k); h1 = Math.imul(h1, 16777619) >>> 0;
          h2 = Math.imul(h2 ^ s.charCodeAt(k), 2246822519) >>> 0;
        }
        function hx(v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }
        return hx(h1) + hx(h2);
      }
      var victimToken = weakHash(issuedAt);

      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Password reset — victim’s token was issued at:'));
      var info = el('pre', 'hl-query');
      info.textContent = 'issuedAt = ' + issuedAt + '  (' + new Date(issuedAt).toISOString() + ')\nvictim token = ' + victimToken.slice(0, 4) + '…(hidden)';
      app.appendChild(info);
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Guessed issue time (ms)'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = String(issuedAt - 5000); w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Regenerate token');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var guess = parseInt(i.value, 10);
        if (isNaN(guess)) { result.classList.add('is-err'); result.textContent = 'Enter a millisecond timestamp.'; return; }
        var token = weakHash(guess);
        if (token === victimToken) {
          result.classList.add('is-ok');
          result.textContent = 'Your token matches the victim’s: ' + token + '. You can reset their password.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{tokens_need_csprng_not_the_clock}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Generated ' + token.slice(0, 8) + '… — no match. The issue time is shown above; use it exactly.';
        }
      });
    }
  });


  /* ---- Price / quantity manipulation ---------------------------------- */
  CHALLENGES.push({
    id: 'price-manip',
    title: 'Check out for a negative total by editing the quantity',
    category: 'Business logic',
    level: 2,
    brief: 'The cart trusts the quantity the client sends and multiplies it by the price with no sanity check. A negative quantity produces a negative line — a refund you never earned.',
    objective: 'Reach a checkout total of zero or less.',
    hints: [
      'total = price × quantity, computed from whatever quantity the client posts. There is no check that quantity is a positive integer.',
      'What happens to the total if the quantity is negative?',
      'Set the quantity to a negative number large enough that the line total drives the whole cart to zero or below.'
    ],
    solution: 'Post a negative quantity. Because the server multiplies price by the client-supplied quantity without validating it, a negative quantity yields a negative line total, dragging the order total to zero or into credit.',
    fix: 'Validate every quantity and price server-side: positive integers within sane bounds, and recompute prices from the catalogue rather than trusting the client. Enforce business rules (no negative lines, minimum totals) before charging or shipping.',
    mount: function (root, win) {
      var PRICE = 20;
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Cart — Widget @ $' + PRICE + ' each'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Quantity (client-controlled)'));
      var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = '2'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Checkout');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Order:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function total() { var q = parseInt(i.value, 10); return isNaN(q) ? NaN : q * PRICE; }
      function renderQuery() { var t = total(); query.textContent = 'POST /checkout { qty: ' + i.value + ' }  →  total: ' + (isNaN(t) ? '?' : '$' + t.toFixed(2)); }
      i.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var t = total();
        if (isNaN(t)) { result.classList.add('is-err'); result.textContent = 'Enter a quantity.'; return; }
        if (t <= 0) {
          result.classList.add('is-ok');
          result.textContent = 'Order accepted with total $' + t.toFixed(2) + '. The store just paid you.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{validate_quantities_server_side}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Charged $' + t.toFixed(2) + '. A normal order.';
        }
      });
    }
  });

  /* ---- Type juggling -------------------------------------------------- */
  CHALLENGES.push({
    id: 'type-juggling',
    title: 'Slip past a token check using loose equality',
    category: 'Type juggling',
    level: 2,
    brief: 'The API compares your token to a secret with loose equality (==). In languages that coerce types, two strings that look like numbers in scientific notation can compare equal even when the characters differ — the "magic hash" trap.',
    objective: 'Provide a token that is not the secret yet passes the loose == check.',
    hints: [
      'The check is inputToken == secretToken with ==, not ===. The secret is the string "0e462097431906509019562988736854".',
      'When both operands look like numbers, == converts them to numbers first. A string like "0e123..." is parsed as 0 × 10^123 = 0. Any "0e<digits>" string equals 0.',
      'Send a different "0e<digits>" string, e.g. 0e1 — a numeric 0, equal to the secret under == but not identical.'
    ],
    solution: 'The secret is a "0e…" string, which numeric coercion turns into 0. Send any other all-digit "0e…" value (like 0e1); under loose == both sides coerce to 0 and compare equal, even though the strings differ. This is the classic PHP magic-hash / type-juggling bypass.',
    fix: 'Always compare secrets with strict, type-safe equality (=== in JS, hash_equals / === in PHP) and, for tokens, a constant-time comparison. Never let a security decision ride on implicit type coercion.',
    mount: function (root, win) {
      var SECRET = '0e462097431906509019562988736854';
      function looseEq(a, b) {
        // model == coercion for the two shapes we care about
        var na = Number(a), nb = Number(b);
        if (!isNaN(na) && !isNaN(nb) && /^[0-9.eE+-]+$/.test(a) && /^[0-9.eE+-]+$/.test(b)) return na === nb;
        return a === b;
      }
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Token check — if (token == secret) ...'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Your token')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'guess'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Submit token');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var t = i.value;
        if (looseEq(t, SECRET)) {
          if (t === SECRET) { result.classList.add('is-err'); result.textContent = 'That is the real secret — no bypass, you just guessed it.'; return; }
          result.classList.add('is-ok');
          result.textContent = 'Accepted. "' + t + '" == the secret under loose equality, though the strings differ.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{use_strict_equality_for_secrets}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Rejected.';
        }
      });
    }
  });

  /* ---- GraphQL introspection ------------------------------------------ */
  CHALLENGES.push({
    id: 'graphql-introspection',
    title: 'Discover a hidden field with GraphQL introspection, then read it',
    category: 'GraphQL introspection',
    level: 2,
    brief: 'This GraphQL API leaves introspection enabled in production. The schema — including fields the UI never calls — is queryable, and one of those fields returns something it should not.',
    objective: 'Use introspection to find the hidden field on User, then query it.',
    hints: [
      'Send the introspection query { __type(name:"User"){ fields{ name } } } to list every field the type exposes.',
      'The UI only ever asks for name and email, but the type also exposes a field that holds a secret. Find its name.',
      'Query { user { ssnToken } } once introspection has revealed the ssnToken field.'
    ],
    solution: 'Introspection ({ __type(name:"User"){ fields { name } } }) lists a field the UI never uses — ssnToken. Querying { user { ssnToken } } then returns the sensitive value, because the field exists in the schema and nothing authorises access to it.',
    fix: 'Disable introspection in production, but do not rely on it for security — obscurity is not access control. Put field-level authorisation on sensitive fields, and do not expose secrets through the schema at all.',
    mount: function (root, win) {
      var SCHEMA = { User: { fields: ['id', 'name', 'email', 'ssnToken'] } };
      var USER = { id: 1, name: 'Dana', email: 'dana@site.example', ssnToken: 'HL{disable_introspection_and_authorise_fields}' };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'GraphQL endpoint  POST /graphql'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'query')); var i = el('textarea'); i.rows = 2; i.spellcheck = false; i.value = '{ user { name email } }'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Run query');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Response:'));
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var q = i.value;
        var m = /__type\s*\(\s*name\s*:\s*"([^"]+)"/.exec(q);
        if (m && SCHEMA[m[1]]) {
          out.textContent = JSON.stringify({ data: { __type: { fields: SCHEMA[m[1]].fields.map(function (f) { return { name: f }; }) } } }, null, 2);
          result.classList.add('is-err'); result.textContent = 'Introspection succeeded — now query the hidden field it revealed.';
          return;
        }
        // otherwise treat as a user query; return requested fields
        var fields = [];
        var fm = /user\s*\{([^}]*)\}/.exec(q);
        if (fm) fields = fm[1].split(/\s+/).filter(Boolean);
        var data = {}; fields.forEach(function (f) { if (f in USER) data[f] = USER[f]; });
        out.textContent = JSON.stringify({ data: { user: data } }, null, 2);
        if (data.ssnToken) {
          result.classList.add('is-ok'); result.textContent = 'You read a field the UI never exposes.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{disable_introspection_and_authorise_fields}'));
          win();
        } else {
          result.classList.add('is-err'); result.textContent = 'Query ran. Nothing sensitive returned.';
        }
      });
    }
  });

  /* ---- XPath injection ------------------------------------------------ */
  CHALLENGES.push({
    id: 'xpath-injection',
    title: 'Bypass an XML-backed login with an XPath tautology',
    category: 'XPath injection',
    level: 2,
    brief: 'Users live in an XML document, and login builds an XPath query by concatenating your input. XPath has the same tautology weakness as SQL: a condition that is always true.',
    objective: 'Log in without a valid password.',
    hints: [
      'The query is //user[name/text()=\'<user>\' and pass/text()=\'<pass>\']. Your input is pasted between the quotes.',
      'Close the string and add a condition that is always true, the XPath version of \' OR \'1\'=\'1.',
      'Set the password to: \' or \'1\'=\'1'
    ],
    solution: 'Inject an always-true clause into the password, e.g. \' or \'1\'=\'1. The XPath becomes //user[name/text()=\'admin\' and pass/text()=\'\' or \'1\'=\'1\'], which matches every user, and the first is returned — logged in without the password.',
    fix: 'Never build XPath from raw input. Use parameterised/variable-bound XPath (XQuery variables) or escape input, and store credentials hashed rather than in a queryable XML document at all.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'XML user store login'));
      var uw = el('label', 'hl-field'); uw.appendChild(el('span', null, 'user')); var u = el('input'); u.type = 'text'; u.autocomplete = 'off'; u.value = 'admin'; uw.appendChild(u);
      var pw = el('label', 'hl-field'); pw.appendChild(el('span', null, 'pass')); var pp = el('input'); pp.type = 'text'; pp.autocomplete = 'off'; pp.value = 'guess'; pw.appendChild(pp);
      app.appendChild(uw); app.appendChild(pw);
      var go = el('button', 'hl-btn', 'Log in');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The XPath query:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function build() { return "//user[name/text()='" + u.value + "' and pass/text()='" + pp.value + "']"; }
      function renderQuery() { query.textContent = build(); }
      u.addEventListener('input', renderQuery); pp.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var q = build();
        // detect a tautology: an ' or '...'='... that is always true
        var tautology = /'\s*or\s*'([^']*)'\s*=\s*'\1'/i.test(q) || /'\s*or\s*'?1'?\s*=\s*'?1'?/i.test(q);
        if (tautology) {
          result.classList.add('is-ok'); result.textContent = 'Logged in as admin — the query matched every user.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{bind_xpath_variables}'));
          win();
        } else if (u.value === 'admin' && pp.value === 'S3cr3t') {
          result.classList.add('is-err'); result.textContent = 'Logged in with the real password — not an injection.';
        } else {
          result.classList.add('is-err'); result.textContent = 'Invalid credentials.';
        }
      });
    }
  });

  /* ---- Unrestricted file upload --------------------------------------- */
  CHALLENGES.push({
    id: 'file-upload',
    title: 'Upload a web shell past a broken file-type check',
    category: 'Unrestricted file upload',
    level: 2,
    brief: 'The avatar upload only checks that the filename ends in an image extension — and it checks with a naive test that a double extension defeats. A server-executable file slips through and lands in a web-served directory.',
    objective: 'Upload a file the server will execute as code (a .php file) despite the image-only check.',
    hints: [
      'The check is filename.endsWith(".jpg") OR the extension appears anywhere. A file can have more than one dot.',
      'Name the file so it satisfies the weak check but still ends in an executable extension the web server runs.',
      'Try shell.jpg.php (passes a contains-".jpg" check, but the server runs .php) — or shell.php with content-type image/jpeg.'
    ],
    solution: 'Give the file a double extension like shell.jpg.php: the naive check sees ".jpg" and allows it, but the web server executes the final .php. (Spoofing the Content-Type to image/jpeg defeats a content-type-only check the same way.) The uploaded file is then requestable and runs as code.',
    fix: 'Validate the real file type by content (magic bytes), not the name or Content-Type. Store uploads outside the web root with a generated random name and a safe extension, serve them via a handler that never executes them, and disable script execution in the upload directory.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Avatar upload (images only)'));
      var fw = el('label', 'hl-field'); fw.appendChild(el('span', null, 'filename')); var f = el('input'); f.type = 'text'; f.autocomplete = 'off'; f.value = 'me.jpg'; fw.appendChild(f);
      var cw = el('label', 'hl-field'); cw.appendChild(el('span', null, 'Content-Type')); var ct = el('input'); ct.type = 'text'; ct.autocomplete = 'off'; ct.value = 'image/jpeg'; cw.appendChild(ct);
      app.appendChild(fw); app.appendChild(cw);
      var go = el('button', 'hl-btn', 'Upload');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var name = f.value.toLowerCase();
        // the broken check: allow if the name CONTAINS an image extension, or the content-type is an image
        var passesCheck = /\.(jpg|jpeg|png|gif)/.test(name) || /^image\//.test(ct.value);
        if (!passesCheck) { result.classList.add('is-err'); result.textContent = 'Rejected: not an image.'; return; }
        // but the server executes by the FINAL extension
        var finalExt = name.split('.').pop();
        if (finalExt === 'php' || finalExt === 'jsp' || finalExt === 'aspx') {
          result.classList.add('is-ok');
          result.textContent = 'Stored as ' + f.value + ' in /uploads/ — and the server runs .' + finalExt + '. You have a web shell.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{check_content_not_the_filename}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Uploaded ' + f.value + '. Stored as an inert image.';
        }
      });
    }
  });

  /* ---- HTTP verb tampering -------------------------------------------- */
  CHALLENGES.push({
    id: 'verb-tampering',
    title: 'Skip an authorisation check by changing the HTTP method',
    category: 'Broken access control (verb tampering)',
    level: 2,
    brief: 'An access rule only protects GET on /admin. The framework still routes other methods to the same handler, so a different verb reaches the admin action without ever passing the check.',
    objective: 'Reach the admin action using a method the access rule does not cover.',
    hints: [
      'The rule reads: deny GET /admin unless role=admin. It names one method. Which methods does it NOT name?',
      'The handler responds to more than GET. A POST (or PUT) to the same path runs the same code, but the GET-only rule never fires.',
      'Send POST /admin instead of GET /admin.'
    ],
    solution: 'The authorisation rule is scoped to GET, but the admin handler answers other verbs too. Sending POST /admin (or PUT/HEAD) executes the admin action while the GET-only rule stays silent — verb tampering.',
    fix: 'Apply authorisation to the action, not a specific method. Default-deny all verbs and explicitly allow the ones a route supports, checking authorisation on each. Never write access rules that name a single HTTP method.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Access rule: DENY GET /admin unless role=admin  (you are role=user)'));
      var mw = el('label', 'hl-field'); mw.appendChild(el('span', null, 'Method'));
      var m = el('select');
      ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].forEach(function (v) { var o = el('option', null, v); o.value = v; m.appendChild(o); });
      mw.appendChild(m);
      app.appendChild(mw);
      var go = el('button', 'hl-btn', 'Send to /admin');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var method = m.value;
        // the rule only guards GET
        if (method === 'GET') {
          result.classList.add('is-err'); result.textContent = '403 Forbidden — the GET rule blocked you.';
          return;
        }
        // any other verb reaches the handler
        result.classList.add('is-ok');
        result.textContent = method + ' /admin → 200. The admin action ran; the GET-only rule never applied.';
        result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{authorise_the_action_not_the_verb}'));
        win();
      });
    }
  });

  /* ---- 2FA bypass ----------------------------------------------------- */
  CHALLENGES.push({
    id: '2fa-bypass',
    title: 'Reach the account by skipping straight past the 2FA step',
    category: 'Broken authentication (2FA)',
    level: 3,
    brief: 'Login is two steps: password, then a 2FA code. But the app marks you logged in after the password step and only *shows* the 2FA prompt — the final account page never re-checks that 2FA actually passed.',
    objective: 'Get to /account without submitting a valid 2FA code.',
    hints: [
      'After the password step the session is already authenticated; the 2FA page is just the next screen, not a gate.',
      'The /account endpoint checks that you are logged in, not that you completed 2FA. What if you request it directly instead of entering the code?',
      'Skip the code entry and navigate straight to /account.'
    ],
    solution: 'The password step sets the authenticated session, and /account only checks authentication — not whether the 2FA challenge was satisfied. Requesting /account directly (skipping the code) lands you in the account, because the second factor was never actually enforced.',
    fix: 'Do not mark the session fully authenticated until the second factor succeeds. Keep a distinct "pending 2FA" state that grants no access, verify 2FA server-side, and gate every protected endpoint on the *completed* multi-factor state, not merely on the password step.',
    mount: function (root, win) {
      var state = { passwordOk: false, twofaOk: false };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Two-step login'));
      var pw = el('label', 'hl-field'); pw.appendChild(el('span', null, 'password')); var pp = el('input'); pp.type = 'text'; pp.autocomplete = 'off'; pp.value = 'correct-horse'; pw.appendChild(pp);
      app.appendChild(pw);
      var step1 = el('button', 'hl-btn', 'Step 1 — submit password');
      app.appendChild(step1);
      var twofaWrap = el('div'); app.appendChild(twofaWrap);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      step1.addEventListener('click', function () {
        result.className = 'hl-result';
        // the bug: the session is authenticated here, before 2FA
        state.passwordOk = true;
        twofaWrap.textContent = '';
        twofaWrap.appendChild(el('p', 'hl-label', 'Step 2 — enter your 2FA code (or skip straight to the account):'));
        var cw = el('label', 'hl-field'); cw.appendChild(el('span', null, '2FA code')); var code = el('input'); code.type = 'text'; code.autocomplete = 'off'; code.value = ''; cw.appendChild(code); twofaWrap.appendChild(cw);
        var verify = el('button', 'hl-btn', 'Verify code'); twofaWrap.appendChild(verify);
        var skip = el('button', 'hl-btn hl-btn-ghost', 'GET /account'); twofaWrap.appendChild(skip);
        verify.addEventListener('click', function () {
          result.className = 'hl-result';
          if (code.value === '424242') { state.twofaOk = true; result.classList.add('is-err'); result.textContent = 'Correct code — but that is the legitimate path, not the bypass.'; }
          else { result.classList.add('is-err'); result.textContent = 'Wrong code.'; }
        });
        skip.addEventListener('click', function () {
          result.className = 'hl-result';
          // /account only checks passwordOk (authenticated), not twofaOk
          if (state.passwordOk) {
            result.classList.add('is-ok');
            result.textContent = 'Account page loaded without a valid 2FA code — the second factor was never enforced.';
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{gate_access_on_completed_2fa}'));
            win();
          }
        });
      });
    }
  });

  /* ---- Race condition (double spend) ---------------------------------- */
  CHALLENGES.push({
    id: 'race-condition',
    title: 'Redeem a one-time gift card twice by racing the check',
    category: 'Race condition (TOCTOU)',
    level: 3,
    brief: 'Redeeming a gift card reads the balance, then writes the new balance a moment later. Two requests that arrive together both read the old balance before either writes — so both succeed. Time-of-check to time-of-use.',
    objective: 'Redeem the single $50 balance more than once by firing concurrent requests.',
    hints: [
      'A single redeem: read balance ($50) → if ≥ amount, deduct → write. The gap between read and write is the whole vulnerability.',
      'If several requests read the balance before any of them writes, each sees $50 and each redeems. Fire them at once rather than one after another.',
      'Use the "Fire 5 at once" button, which sends the redeem requests concurrently rather than sequentially.'
    ],
    solution: 'Sending redeem requests concurrently means they all execute the "read balance" step before any executes "write balance". Each sees the full $50 and deducts, so the one-time card pays out several times — a classic time-of-check/time-of-use race.',
    fix: 'Make the check-and-deduct atomic: a single conditional UPDATE (UPDATE cards SET balance=balance-50 WHERE id=? AND balance>=50), a row lock / SELECT ... FOR UPDATE, or an idempotency key so a card can only be redeemed once. Never read, decide, and write as separate un-synchronised steps.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Gift card — balance $50, redeem $50'));
      var seq = el('button', 'hl-btn hl-btn-ghost', 'Redeem once (sequential)');
      var race = el('button', 'hl-btn', 'Fire 5 at once (concurrent)');
      app.appendChild(seq); app.appendChild(race);
      app.appendChild(el('p', 'hl-label', 'Ledger:'));
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      var payouts;
      function reset() { payouts = 0; }
      reset();

      // A redeem models read → (async gap) → write. Concurrent calls interleave
      // so they all read the same starting balance.
      function runBatch(concurrent) {
        reset();
        var balance = 50;
        var reads = [];
        var n = concurrent ? 5 : 3;
        for (var k = 0; k < n; k++) {
          (function () {
            var seen = balance;                 // time-of-check: read now
            reads.push(function () {            // time-of-use: write later
              if (seen >= 50) { payouts++; balance -= 50; }
            });
          })();
          if (!concurrent) {
            // sequential: apply the write immediately before the next read
            reads.pop()();
          }
        }
        if (concurrent) reads.forEach(function (fn) { fn(); });

        var lines = [];
        for (var p = 0; p < payouts; p++) lines.push('payout #' + (p + 1) + ': +$50');
        out.textContent = (lines.join('\n') || '(no payout)') + '\nfinal balance: $' + balance;
        result.className = 'hl-result';
        if (payouts > 1) {
          result.classList.add('is-ok');
          result.textContent = 'The $50 card paid out ' + payouts + ' times — a race on the balance check.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{make_check_and_deduct_atomic}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Redeemed once, as intended. Try firing them concurrently.';
        }
      }

      seq.addEventListener('click', function () { runBatch(false); });
      race.addEventListener('click', function () { runBatch(true); });
    }
  });

  /* ---- Web cache poisoning -------------------------------------------- */
  CHALLENGES.push({
    id: 'cache-poisoning',
    title: 'Poison the shared cache through an unkeyed header',
    category: 'Web cache poisoning',
    level: 3,
    brief: 'The page reflects the X-Forwarded-Host header into a script URL, and the cache keys responses only by path — not by that header. Send the header once and every later visitor is served your poisoned copy.',
    objective: 'Get a response cached that loads a script from an attacker host.',
    hints: [
      'The page builds <script src="https://<X-Forwarded-Host>/app.js">. The cache stores the result under just the URL path, ignoring the header you sent.',
      'If your request populates the cache with a poisoned Host, subsequent users who request the same path get your version — including your script src.',
      'Set X-Forwarded-Host to evil.example and request the page so the poisoned response is cached.'
    ],
    solution: 'Send X-Forwarded-Host: evil.example. The origin reflects it into the script tag and the cache stores that response keyed only by path. Every visitor who then requests the page is served the cached copy loading https://evil.example/app.js — cache poisoning turning one request into mass compromise.',
    fix: 'Include every header that affects the response in the cache key (or add a Vary), and never reflect Host / X-Forwarded-Host into output. Build absolute URLs from a fixed configured domain, and strip untrusted forwarding headers at the edge.',
    mount: function (root, win) {
      var cache = null;
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'GET /home  (behind a shared cache)'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'X-Forwarded-Host header')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'site.example'; w.appendChild(i);
      app.appendChild(w);
      var send = el('button', 'hl-btn', 'Request /home (populates cache)');
      var visit = el('button', 'hl-btn hl-btn-ghost', 'Visit as another user (reads cache)');
      app.appendChild(send); app.appendChild(visit);
      app.appendChild(el('p', 'hl-label', 'HTML served:'));
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      send.addEventListener('click', function () {
        result.className = 'hl-result';
        // origin reflects the header; cache stores keyed by path only
        var html = '<script src="https://' + i.value + '/app.js"></script>';
        cache = html;
        out.textContent = html + '\n\n[cache] stored under key: /home';
        result.classList.add('is-err');
        result.textContent = 'Response cached. Now visit as another user.';
      });
      visit.addEventListener('click', function () {
        result.className = 'hl-result';
        if (!cache) { result.classList.add('is-err'); result.textContent = 'Cache is empty — populate it first.'; return; }
        out.textContent = cache + '\n\n[cache] HIT for /home';
        var m = /src="https:\/\/([^/"]+)\//.exec(cache);
        if (m && m[1] !== 'site.example') {
          result.classList.add('is-ok');
          result.textContent = 'Another user just loaded a script from ' + m[1] + ' — your poisoned response was served from cache.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{key_the_cache_on_every_relevant_header}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Served the legitimate cached page.';
        }
      });
    }
  });

  /* ---- Clickjacking --------------------------------------------------- */
  CHALLENGES.push({
    id: 'clickjacking',
    title: 'Frame a page that forgot to say it must not be framed',
    category: 'Clickjacking',
    level: 2,
    brief: 'The "delete account" page sends no framing protection — no X-Frame-Options, no frame-ancestors CSP. An attacker can load it in an invisible iframe over a decoy, and the victim’s click lands on the real button.',
    objective: 'Confirm the page can be framed by an attacker origin (the precondition for a clickjacking attack).',
    hints: [
      'A page is safe from framing only if it sends X-Frame-Options: DENY/SAMEORIGIN or a CSP frame-ancestors directive. Check what this page sends.',
      'Toggle the response headers. With neither protection present, any site may iframe the page and overlay a decoy.',
      'Remove both framing protections, then load the page in the attacker frame.'
    ],
    solution: 'With neither X-Frame-Options nor a frame-ancestors CSP, the attacker’s site can load the sensitive page in a transparent iframe positioned over a harmless-looking decoy. The victim thinks they are clicking the decoy but actually clicks the framed "delete" button — clickjacking.',
    fix: 'Send Content-Security-Policy: frame-ancestors \'none\' (or \'self\') on every sensitive page, and X-Frame-Options: DENY for older browsers. For actions, add a confirmation step and anti-CSRF tokens so a single hijacked click cannot complete a destructive operation.',
    mount: function (root, win) {
      var headers = { xfo: false, csp: false };
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Sensitive page: POST /account/delete'));
      var h1 = el('label', 'hl-toggle'); var c1 = el('input'); c1.type = 'checkbox'; h1.appendChild(c1); h1.appendChild(document.createTextNode(' Send X-Frame-Options: DENY'));
      var h2 = el('label', 'hl-toggle'); var c2 = el('input'); c2.type = 'checkbox'; h2.appendChild(c2); h2.appendChild(document.createTextNode(' Send CSP frame-ancestors \'none\''));
      app.appendChild(h1); app.appendChild(h2);
      var go = el('button', 'hl-btn', 'Load in attacker frame (evil.example)');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      c1.addEventListener('change', function () { headers.xfo = c1.checked; });
      c2.addEventListener('change', function () { headers.csp = c2.checked; });

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        if (headers.xfo || headers.csp) {
          result.classList.add('is-err');
          result.textContent = 'The browser refused to frame the page — a framing protection is present.';
        } else {
          result.classList.add('is-ok');
          result.textContent = 'The page loaded inside evil.example’s invisible iframe. A decoy over the delete button would clickjack the victim.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{set_frame_ancestors_none}'));
          win();
        }
      });
    }
  });


  /* ---- Boolean-based blind SQL injection ------------------------------ */
  CHALLENGES.push({
    id: 'blind-sqli',
    title: 'Extract a hidden value one bit at a time with blind SQL injection',
    category: 'SQL injection (blind)',
    level: 3,
    brief: 'This search returns only "found" or "not found" — never the data. But you can still read secrets: inject a condition about a secret value and let the yes/no answer leak it, character by character.',
    objective: 'Recover the admin password’s first character using boolean conditions.',
    hints: [
      'The query is SELECT 1 FROM users WHERE name=\'<input>\'. The page tells you only whether a row matched. You can append AND (a condition about the secret).',
      'Ask a true/false question about the secret: name=\'admin\' AND SUBSTR(password,1,1)=\'a\'. If the page says "found", the guess was right.',
      'Inject: admin\' AND SUBSTR(password,1,1)=\'S\' -- and adjust the letter until it says found.'
    ],
    solution: 'Append a boolean condition testing one character of the secret, e.g. admin\' AND SUBSTR(password,1,1)=\'S\' -- . A "found" response confirms that character; repeat for each position to reconstruct the whole value. The single yes/no bit is enough to exfiltrate arbitrary data.',
    fix: 'Parameterise every query so input can never change its logic. Blind injection is still injection — the fix is the same bound parameters, plus least-privilege DB accounts and not exposing row-existence as an oracle.',
    mount: function (root, win) {
      var SECRET = 'Sunf1sh';
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'User search — returns only found / not found'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'name')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'admin'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Search');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The query:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderQuery() { query.textContent = "SELECT 1 FROM users WHERE name='" + i.value + "'"; }
      i.addEventListener('input', renderQuery);
      renderQuery();

      // model the injectable query: strip a -- comment, evaluate name and an
      // optional SUBSTR(password,N,1)='x' predicate against the secret row.
      function evaluate(inp) {
        var q = inp.replace(/--.*$/, '');
        // must reference admin
        if (!/name\s*=\s*'admin'/i.test("name='" + q) && !/^admin/i.test(q)) return false;
        var m = /SUBSTR\s*\(\s*password\s*,\s*(\d+)\s*,\s*1\s*\)\s*=\s*'([^'])'?/i.exec(q);
        if (m) {
          var pos = parseInt(m[1], 10) - 1;
          return SECRET.charAt(pos) === m[2];
        }
        // an input that mentions SUBSTR but is malformed is a failed probe, not a hit
        if (/substr/i.test(q)) return false;
        // plain name='admin' with no predicate always matches (the row exists)
        return /^admin'?\s*$/i.test(q.trim()) || /name\s*=\s*'admin'/i.test("name='" + q.trim());
      }

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var found = evaluate(i.value);
        var m = /SUBSTR\s*\(\s*password\s*,\s*1\s*,\s*1\s*\)\s*=\s*'([^'])'?/i.exec(i.value);
        if (found) {
          result.classList.add('is-ok');
          result.textContent = 'found';
          if (m && m[1] === SECRET.charAt(0)) {
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{blind_is_still_injectable}'));
            win();
          }
        } else {
          result.classList.add('is-err');
          result.textContent = 'not found';
        }
      });
    }
  });

  /* ---- Second-order SQL injection ------------------------------------- */
  CHALLENGES.push({
    id: 'second-order-sqli',
    title: 'Store a payload now, detonate it in a query later',
    category: 'SQL injection (second-order)',
    level: 3,
    brief: 'Registration safely escapes your username when it stores it. But a later "rename" feature builds a query from the stored value without re-escaping — the payload you saved earlier fires then.',
    objective: 'Register a username that, when the rename step runs, drops the audit filter and reveals every user.',
    hints: [
      'Your name is escaped on the way in, so nothing happens at registration. The rename step reads it back and concatenates it into a new query, un-escaped.',
      'Store a name that becomes an injection when placed into: UPDATE users SET name=\'<stored>\' WHERE ... — a classic \' OR \'1\'=\'1 works once it is read back.',
      'Register with the username: x\' OR \'1\'=\'1 — then run the rename step.'
    ],
    solution: 'Register a username containing an injection payload (x\' OR \'1\'=\'1). It is stored safely, so nothing happens yet. When the rename feature later reads the stored value and concatenates it into a query without escaping, the payload executes — second-order injection.',
    fix: 'Escaping on input is not enough — data read back from the database is still untrusted. Parameterise the *later* query too. Treat every value as untrusted at the point it is used in a query, no matter where it came from.',
    mount: function (root, win) {
      var stored = null;
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Step 1 — register (input is escaped and stored)'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'username')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'newuser'; w.appendChild(i);
      app.appendChild(w);
      var reg = el('button', 'hl-btn', 'Register');
      app.appendChild(reg);
      var stage2 = el('div'); app.appendChild(stage2);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      reg.addEventListener('click', function () {
        result.className = 'hl-result';
        stored = i.value;                 // stored verbatim (escaping happened at the DB layer, safely)
        stage2.textContent = '';
        stage2.appendChild(el('p', 'hl-label', 'Stored username: ' + stored));
        stage2.appendChild(el('p', 'hl-app-title', 'Step 2 — rename (reads the stored value, no re-escaping):'));
        var q = el('pre', 'hl-query');
        q.textContent = "UPDATE users SET name='" + stored + "' WHERE id=7; SELECT * FROM users WHERE name='" + stored + "'";
        stage2.appendChild(q);
        var run = el('button', 'hl-btn', 'Run rename');
        stage2.appendChild(run);
        run.addEventListener('click', function () {
          result.className = 'hl-result';
          var injected = /'\s*or\s*'1'\s*=\s*'1/i.test(stored) || /'\s*or\s*'?1'?\s*=\s*'?1/i.test(stored);
          if (injected) {
            result.classList.add('is-ok');
            result.textContent = 'The rename query matched every user — the value you stored earlier just executed as SQL.';
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{parameterise_the_later_query_too}'));
            win();
          } else {
            result.classList.add('is-err');
            result.textContent = 'Renamed cleanly. The stored value was inert.';
          }
        });
      });
    }
  });

  /* ---- JWT weak secret (crackable HMAC) ------------------------------- */
  CHALLENGES.push({
    id: 'jwt-weak-secret',
    title: 'Crack a JWT signed with a guessable secret, then forge one',
    category: 'Authentication (JWT)',
    level: 3,
    brief: 'This token is properly signed with HS256 — but the secret is a dictionary word. If you can find the secret you can mint any token you like, signature and all.',
    objective: 'Recover the HMAC secret from the wordlist, then present an admin token signed with it.',
    hints: [
      'HS256 signs with a shared secret. Try each word in the list as the key and re-sign the token’s header.payload; the word whose signature matches the given token is the secret.',
      'Once you know the secret, build {"alg":"HS256"} + {"user":"admin","role":"admin"} and sign it with that secret.',
      'Click "Crack" to run the wordlist, then "Forge admin token".'
    ],
    solution: 'HMAC lets anyone who knows the key both sign and verify. Trying each dictionary word as the key and comparing the resulting signature to the token’s reveals the secret; then you sign a new admin payload with it and the server accepts your forged token as genuine.',
    fix: 'Use a long, high-entropy random secret (32+ bytes) for HMAC, never a word or a short string. Rotate it, keep it out of source control, and prefer asymmetric signing (RS256/ES256) so verifiers never hold a signing key at all.',
    mount: function (root, win) {
      var subtle = (window.crypto && window.crypto.subtle) || null;
      var WORDLIST = ['password', 'secret', 'letmein', 'admin', 's3cr3t', 'hunter2', 'changeme', 'qwerty', 'sunshine'];
      var REAL_SECRET = 's3cr3t';
      var enc = new TextEncoder();
      function b64url(bytes) {
        var s = ''; for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      function b64urlStr(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
      function hmac(secret, msg) {
        return subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
          .then(function (key) { return subtle.sign('HMAC', key, enc.encode(msg)); })
          .then(function (sig) { return b64url(new Uint8Array(sig)); });
      }

      var header = b64urlStr('{"alg":"HS256","typ":"JWT"}');
      var payload = b64urlStr('{"user":"guest","role":"user"}');
      var givenTokenP = hmac(REAL_SECRET, header + '.' + payload).then(function (sig) { return header + '.' + payload + '.' + sig; });

      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'A validly-signed HS256 token (guest):'));
      var given = el('pre', 'hl-query'); given.textContent = 'computing…'; app.appendChild(given);
      givenTokenP.then(function (t) { given.textContent = t; });
      app.appendChild(el('p', 'hl-label', 'Wordlist: ' + WORDLIST.join(', ')));
      var crack = el('button', 'hl-btn', 'Crack the secret');
      var forge = el('button', 'hl-btn hl-btn-ghost', 'Forge admin token');
      app.appendChild(crack); app.appendChild(forge);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      if (!subtle) { result.className = 'hl-result is-err'; result.textContent = 'This challenge needs WebCrypto (a secure context).'; return; }

      var found = null;
      crack.addEventListener('click', function () {
        result.className = 'hl-result';
        givenTokenP.then(function (token) {
          var sig = token.split('.')[2];
          var body = header + '.' + payload;
          var chain = Promise.resolve();
          WORDLIST.forEach(function (word) {
            chain = chain.then(function () {
              if (found) return;
              return hmac(word, body).then(function (s) { if (s === sig) found = word; });
            });
          });
          return chain;
        }).then(function () {
          if (found) { result.classList.add('is-ok'); result.textContent = 'Secret cracked: "' + found + '". Now forge an admin token.'; }
          else { result.classList.add('is-err'); result.textContent = 'No word in the list matched.'; }
        });
      });

      forge.addEventListener('click', function () {
        result.className = 'hl-result';
        if (!found) { result.classList.add('is-err'); result.textContent = 'Crack the secret first.'; return; }
        var h = b64urlStr('{"alg":"HS256","typ":"JWT"}');
        var p = b64urlStr('{"user":"admin","role":"admin"}');
        hmac(found, h + '.' + p).then(function (sig) {
          // verify with the REAL secret, as the server would
          return hmac(REAL_SECRET, h + '.' + p).then(function (real) {
            if (sig === real) {
              result.classList.add('is-ok');
              result.textContent = 'Forged token verifies against the server secret — you are admin.';
              result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{use_a_long_random_hmac_secret}'));
              win();
            } else { result.classList.add('is-err'); result.textContent = 'Signature mismatch.'; }
          });
        });
      });
    }
  });

  /* ---- OAuth redirect_uri abuse --------------------------------------- */
  CHALLENGES.push({
    id: 'oauth-redirect',
    title: 'Steal an OAuth code by pointing redirect_uri at your own site',
    category: 'OAuth / open redirect',
    level: 3,
    brief: 'The authorisation server sends the login code to whatever redirect_uri the request names, without checking it against the ones the client registered. Name your own URL and the victim’s code arrives at your server.',
    objective: 'Get the authorisation code delivered to https://evil.example.',
    hints: [
      'The authorize endpoint does 302 to redirect_uri?code=... It never checks that redirect_uri is on the client’s registered allow-list.',
      'If you can set redirect_uri to a site you control, the victim who approves the login sends their code to you.',
      'Set redirect_uri to https://evil.example/callback.'
    ],
    solution: 'Because the authorisation server does not validate redirect_uri against the client’s pre-registered URIs, setting it to https://evil.example/callback makes the server deliver the victim’s authorisation code to the attacker, who exchanges it for the victim’s tokens.',
    fix: 'Strictly allow-list redirect_uri: compare the full string against the exact URIs registered for the client, with no wildcards or prefix matching. Bind the code to the client and the exact redirect_uri, and use PKCE so a stolen code alone is useless.',
    mount: function (root, win) {
      var REGISTERED = 'https://app.trusted.example/callback';
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Authorize — client "trusted-app" (registered: ' + REGISTERED + ')'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'redirect_uri')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = REGISTERED; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Victim approves login');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Where the code is delivered:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderQuery() { query.textContent = '302 Location: ' + i.value + '?code=AUTH_CODE_9f3a'; }
      i.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var uri = i.value.trim();
        var host = '';
        try { host = new URL(uri).host; } catch (e) { host = ''; }
        if (uri !== REGISTERED && host && host !== 'app.trusted.example') {
          result.classList.add('is-ok');
          result.textContent = 'The victim’s authorisation code was delivered to ' + host + '. Exchange it for their tokens.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{exact_match_registered_redirect_uris}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Code delivered to the registered URI. No leak.';
        }
      });
    }
  });

  /* ---- IDOR via a leaked identifier ----------------------------------- */
  CHALLENGES.push({
    id: 'idor-uuid',
    title: 'Chain a leaky list endpoint into reading another user’s record',
    category: 'Broken access control (IDOR)',
    level: 2,
    brief: 'Ids here are unguessable UUIDs — good — but a public "team members" list hands them out, and the record endpoint then serves any UUID without an ownership check. Unguessable is not the same as authorised.',
    objective: 'Read teammate Dana’s private record by discovering and using her id.',
    hints: [
      'You cannot guess a UUID, but you do not have to: the /team endpoint lists members and their ids. Read Dana’s id from there.',
      'The /record?id= endpoint returns any id you give it, with no check that it is yours. Paste Dana’s id.',
      'List the team, copy Dana’s UUID, then fetch her record.'
    ],
    solution: 'Random ids resist guessing but do not enforce access control. The team-list endpoint leaks Dana’s UUID, and the record endpoint returns it without checking ownership — so reading her private record is just two requests. The missing authorisation check is the bug, not the id format.',
    fix: 'Authorise every object access against the logged-in user, regardless of how unguessable the id is. Do not leak identifiers of resources the caller cannot access, and scope list endpoints to what the user is allowed to see.',
    mount: function (root, win) {
      var TEAM = [
        { name: 'You', id: 'a1b2-you', note: 'Your own record.' },
        { name: 'Dana', id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', note: 'Private: salary band L6, PIP notes. Flag: HL{unguessable_is_not_authorised}' }
      ];
      var ME = 'a1b2-you';
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Team app'));
      var listBtn = el('button', 'hl-btn hl-btn-ghost', 'GET /team (list members)');
      app.appendChild(listBtn);
      var listOut = el('pre', 'hl-query'); app.appendChild(listOut);
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'GET /record?id=')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = ME; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'View record');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      listBtn.addEventListener('click', function () {
        listOut.textContent = TEAM.map(function (m) { return m.name + ': ' + m.id; }).join('\n');
      });
      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var rec = TEAM.filter(function (m) { return m.id === i.value.trim(); })[0];
        if (!rec) { result.classList.add('is-err'); result.textContent = 'Record not found.'; return; }
        result.classList.add('is-ok');
        result.textContent = rec.name + '’s record: ' + rec.note;
        if (rec.id !== ME && rec.note.indexOf('HL{') !== -1) {
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{unguessable_is_not_authorised}'));
          win();
        }
      });
    }
  });

  /* ---- SSRF filter bypass --------------------------------------------- */
  CHALLENGES.push({
    id: 'ssrf-bypass',
    title: 'Defeat a blocklist that only knows the word “localhost”',
    category: 'SSRF (filter bypass)',
    level: 3,
    brief: 'This fetcher learned its lesson and blocks "localhost" and "127.0.0.1" by string match. But an IP address has many spellings, and the blocklist only knows two of them.',
    objective: 'Reach the internal admin service on the loopback interface despite the filter.',
    hints: [
      'The filter rejects a URL if it contains the text "localhost" or "127.0.0.1". It matches strings, not addresses.',
      '127.0.0.1 can be written as a single decimal (2130706433), in octal, in IPv6 (::1 / [::1]), or as 127.1. The filter recognises none of those.',
      'Try http://2130706433/admin or http://[::1]/admin.'
    ],
    solution: 'A string blocklist cannot enumerate every spelling of an address. 127.0.0.1 is also 2130706433 (decimal), 0x7f000001 (hex), 127.1 (short form) and ::1 (IPv6) — all reach the loopback interface, none contain the blocked text. The request sails past the filter to the internal service.',
    fix: 'Never filter SSRF by string matching the URL. Resolve the hostname to an IP, then reject the request if the resolved address is in a private, loopback or link-local range — and re-check after every redirect. Allow-list destinations where possible.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'URL fetcher — filter blocks "localhost" and "127.0.0.1"'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'URL')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'http://127.0.0.1/admin'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Fetch');
      app.appendChild(go);
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function isLoopback(url) {
        var m = /^https?:\/\/([^/]+)/i.exec(url); if (!m) return false;
        var host = m[1].replace(/^\[|\]$/g, '');
        if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
        if (host === '2130706433') return true;               // decimal
        if (host === '0x7f000001' || host === '0x7f.0.0.1') return true;
        if (host === '127.1' || host === '127.0.0.1') return true;
        if (/^0177\./.test(host)) return true;                // octal-ish
        return false;
      }

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var url = i.value.trim();
        // the naive string filter
        if (/localhost|127\.0\.0\.1/i.test(url)) {
          out.textContent = ''; result.classList.add('is-err');
          result.textContent = 'Blocked by the filter (matched a forbidden string).';
          return;
        }
        if (isLoopback(url)) {
          out.textContent = '{ "service": "internal-admin", "flag": "HL{resolve_then_check_the_ip}" }';
          result.classList.add('is-ok');
          result.textContent = 'Reached the loopback admin service — the filter never saw it coming.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{resolve_then_check_the_ip}'));
          win();
        } else {
          out.textContent = '<external page>'; result.classList.add('is-err');
          result.textContent = 'Fetched an external URL. Find another spelling of the loopback address.';
        }
      });
    }
  });

  /* ---- DOM-based XSS -------------------------------------------------- */
  CHALLENGES.push({
    id: 'dom-xss',
    title: 'Fire a script the server never saw, straight from the URL fragment',
    category: 'Cross-site scripting (DOM)',
    level: 2,
    brief: 'This page reads the URL fragment (the part after #) and writes it into the document with innerHTML. The server never sees the fragment, so no server-side filter can help — the sink is in the browser.',
    objective: 'Craft a fragment value that would execute script when the page renders it.',
    hints: [
      'The code does el.innerHTML = decodeURIComponent(location.hash.slice(1)). Whatever is in the fragment becomes live HTML.',
      'innerHTML with an <img> that has an onerror handler runs script without a <script> tag (which innerHTML ignores).',
      'Set the fragment to <img src=x onerror=alert(1)>.'
    ],
    solution: 'Because the fragment is written with innerHTML, HTML in it becomes live. <script> is ignored by innerHTML, but <img src=x onerror=...> runs the handler when the bogus image fails to load — DOM-based XSS, entirely client-side and invisible to server filters.',
    fix: 'Never write untrusted data with innerHTML. Use textContent, or sanitise with a vetted library (DOMPurify) and set a strict CSP. Treat every DOM sink (innerHTML, document.write, eval, setAttribute for on*) as dangerous and keep untrusted data out of them.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Profile page — reads location.hash into innerHTML'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'URL fragment (after #)')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'Welcome'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Render fragment');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'The sink:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function renderQuery() { query.textContent = 'greeting.innerHTML = decodeURIComponent("' + i.value + '")'; }
      i.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var payload = i.value;
        // detect an executable HTML sink without actually running it
        var executes = /<\s*img[^>]+on\w+\s*=/i.test(payload) ||
                       /<\s*svg[^>]+on\w+\s*=/i.test(payload) ||
                       /<\s*\w+[^>]+on(error|load|click)\s*=/i.test(payload) ||
                       /<\s*iframe[^>]+srcdoc/i.test(payload);
        if (executes) {
          result.classList.add('is-ok');
          result.textContent = 'That fragment written via innerHTML would execute — DOM XSS. (Nothing is actually run here.)';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{keep_untrusted_data_out_of_innerHTML}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Rendered as ' + payload + '. No script would fire.';
        }
      });
    }
  });

  /* ---- Zip slip (path traversal on extract) --------------------------- */
  CHALLENGES.push({
    id: 'zip-slip',
    title: 'Escape the extract directory with a crafted archive path',
    category: 'Path traversal (zip slip)',
    level: 2,
    brief: 'The uploader extracts each archive entry by joining its name to the target directory. An entry whose name contains ../ walks out of that directory and writes anywhere the process can — overwriting real files.',
    objective: 'Name an archive entry so it writes outside /tmp/extract, over /etc/cron.d/.',
    hints: [
      'Extraction does writeFile(targetDir + "/" + entry.name). It never checks that the result stays inside targetDir.',
      'An entry name can contain path traversal. ../ segments climb out of the extract directory.',
      'Name the entry ../../etc/cron.d/evil so it resolves outside /tmp/extract.'
    ],
    solution: 'A zip entry name is attacker-controlled. Naming it ../../etc/cron.d/evil makes the naive join (targetDir + "/" + name) resolve to /etc/cron.d/evil, writing a file far outside the extraction directory — zip slip, which can overwrite binaries, cron jobs or config.',
    fix: 'After joining, resolve the final path and verify it is still inside the intended directory (path.resolve(target, name).startsWith(target + sep)); reject any entry that escapes. Strip or reject "..", absolute paths and symlinks in archive entries.',
    mount: function (root, win) {
      var TARGET = '/tmp/extract';
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Archive extractor → ' + TARGET));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'entry filename inside the zip')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'photos/pic.jpg'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Extract entry');
      app.appendChild(go);
      app.appendChild(el('p', 'hl-label', 'Resolved write path:'));
      var query = el('pre', 'hl-query'); app.appendChild(query);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function resolvePath(name) {
        var parts = (TARGET + '/' + name).split('/');
        var stack = [];
        parts.forEach(function (p) {
          if (p === '..') stack.pop();
          else if (p !== '.' && p !== '') stack.push(p);
        });
        return '/' + stack.join('/');
      }
      function renderQuery() { query.textContent = resolvePath(i.value); }
      i.addEventListener('input', renderQuery);
      renderQuery();

      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var resolved = resolvePath(i.value);
        if (resolved.indexOf(TARGET) !== 0) {
          result.classList.add('is-ok');
          result.textContent = 'Wrote to ' + resolved + ' — outside the extract directory. That is arbitrary file write.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{verify_the_resolved_path_stays_inside}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'Extracted safely to ' + resolved + '.';
        }
      });
    }
  });

  /* ---- Subdomain takeover --------------------------------------------- */
  CHALLENGES.push({
    id: 'subdomain-takeover',
    title: 'Claim a dangling subdomain that still points at nothing',
    category: 'Subdomain takeover',
    level: 3,
    brief: 'A company subdomain still has a DNS CNAME to a cloud host, but the resource behind it was deleted. Anyone who registers that resource name on the provider now serves content on the company’s subdomain.',
    objective: 'Identify the dangling subdomain and claim its backing resource.',
    hints: [
      'Check each subdomain’s CNAME target. One points at a provider bucket that returns "NoSuchBucket" — the DNS record outlived the resource.',
      'The provider lets anyone register an unclaimed name. Claim the exact bucket the dangling CNAME points to.',
      'assets.acme.example → CNAME acme-assets.storage.example (unclaimed). Register acme-assets.storage.example.'
    ],
    solution: 'assets.acme.example still has a CNAME to acme-assets.storage.example, but that bucket was deleted and is unclaimed. Registering that exact bucket name on the provider makes your content serve from the trusted acme.example subdomain — subdomain takeover, useful for phishing, cookie theft and CSP bypass.',
    fix: 'Remove DNS records the moment the resource they point to is decommissioned. Audit for dangling CNAMEs, use providers that verify domain ownership before serving, and monitor your DNS for records pointing at unclaimed resources.',
    mount: function (root, win) {
      var DNS = [
        { sub: 'www.acme.example', cname: 'acme-web.hosting.example', status: 'active' },
        { sub: 'blog.acme.example', cname: 'acme-blog.hosting.example', status: 'active' },
        { sub: 'assets.acme.example', cname: 'acme-assets.storage.example', status: 'NoSuchBucket (unclaimed)' }
      ];
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'DNS records for acme.example'));
      var enumBtn = el('button', 'hl-btn hl-btn-ghost', 'Enumerate CNAMEs');
      app.appendChild(enumBtn);
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'Register provider resource')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = ''; i.placeholder = 'name.storage.example'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Claim it');
      app.appendChild(go);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      enumBtn.addEventListener('click', function () {
        out.textContent = DNS.map(function (r) { return r.sub + '  CNAME  ' + r.cname + '  [' + r.status + ']'; }).join('\n');
      });
      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var dangling = DNS.filter(function (r) { return /unclaimed/.test(r.status); })[0];
        if (i.value.trim() === dangling.cname) {
          result.classList.add('is-ok');
          result.textContent = 'You now control ' + dangling.cname + ' — and it is served from ' + dangling.sub + ', a trusted subdomain.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{remove_dns_when_you_delete_the_resource}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'That resource is already claimed or does not match a dangling record.';
        }
      });
    }
  });

  /* ---- HTTP parameter pollution --------------------------------------- */
  CHALLENGES.push({
    id: 'http-param-pollution',
    title: 'Slip past a filter by sending the same parameter twice',
    category: 'HTTP parameter pollution',
    level: 2,
    brief: 'A WAF checks the first value of the "role" parameter, but the application framework reads the last one. Send the parameter twice and the two layers disagree — the check passes, the app sees your value.',
    objective: 'Get the application to read role=admin while the filter sees role=user.',
    hints: [
      'When a query string has role=user&role=admin, different components pick different occurrences. The filter reads the first; the app reads the last.',
      'Put the safe value first (to satisfy the filter) and the payload last (which the app uses).',
      'Send role=user&role=admin.'
    ],
    solution: 'Sending role=user&role=admin exploits inconsistent duplicate-parameter handling: the WAF validates the first occurrence (user, allowed) while the application framework uses the last (admin). The two layers disagree, and the malicious value reaches the app unchecked — HTTP parameter pollution.',
    fix: 'Make every layer agree on duplicate handling, and reject requests with duplicate parameters where it matters. Validate at the same layer that consumes the value, canonicalise the query string first, and never rely on a front-end filter that parses differently from the app.',
    mount: function (root, win) {
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Filter allows role=user only. App reads the LAST role.'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'query string')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'role=user'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Send request');
      app.appendChild(go);
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      function values(qs) {
        var vals = [];
        qs.split('&').forEach(function (pair) { var kv = pair.split('='); if (kv[0] === 'role') vals.push(kv[1]); });
        return vals;
      }
      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var vals = values(i.value);
        if (!vals.length) { result.classList.add('is-err'); result.textContent = 'No role parameter.'; return; }
        var filterSees = vals[0];               // WAF: first
        var appSees = vals[vals.length - 1];    // framework: last
        out.textContent = 'filter sees role=' + filterSees + '\napp sees role=' + appSees;
        if (filterSees !== 'admin') {           // filter must pass
          if (appSees === 'admin') {
            result.classList.add('is-ok');
            result.textContent = 'Filter passed (saw user) but the app granted admin — the layers disagreed.';
            result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{make_every_layer_parse_the_same}'));
            win();
          } else {
            result.classList.add('is-err');
            result.textContent = 'App read role=' + appSees + '. Not admin.';
          }
        } else {
          result.classList.add('is-err');
          result.textContent = 'The filter blocked the request (first value was admin).';
        }
      });
    }
  });

  /* ---- Timing attack -------------------------------------------------- */
  CHALLENGES.push({
    id: 'timing-attack',
    title: 'Recover an API key from how long a comparison takes',
    category: 'Timing attack',
    level: 3,
    brief: 'The key check compares character by character and returns the moment two differ. A correct prefix takes measurably longer to reject — so the response time leaks how many leading characters you got right.',
    objective: 'Use the timing oracle to recover the 6-character key’s first character.',
    hints: [
      'The comparison is not constant-time: it stops at the first mismatch. More matching leading characters means more loop iterations means more time.',
      'Try each first character; the one that yields the longest response time is correct, because the comparison had to go one step further before failing.',
      'Submit guesses of the form "A00000", "B00000", … and watch the reported time. The slowest is the right first character.'
    ],
    solution: 'A non-constant-time compare returns early on the first wrong character, so response time grows with the length of the correct prefix. Measuring the time for each candidate first character reveals which one matches (the slowest); repeating position by position recovers the whole key without ever seeing it.',
    fix: 'Compare secrets in constant time (crypto.timingSafeEqual, hash_equals, or compare fixed-length HMACs of both sides). Never let the duration of a check depend on how much of a secret matched.',
    mount: function (root, win) {
      var KEY = 'K7pQ2z';
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'API key check (non-constant-time). 6 characters.'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'guess')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = 'A00000'; w.appendChild(i);
      app.appendChild(w);
      var go = el('button', 'hl-btn', 'Submit (returns response time)');
      app.appendChild(go);
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      var bestFirst = null, bestTime = -1;
      go.addEventListener('click', function () {
        result.className = 'hl-result';
        var g = i.value;
        // matching prefix length
        var match = 0;
        while (match < KEY.length && g.charAt(match) === KEY.charAt(match)) match++;
        // simulated time: ~5ms per matching char + tiny jitter-free base
        var ms = 2 + match * 5;
        out.textContent = 'response time: ' + ms + ' ms   (matched a ' + match + '-char prefix)';
        // track the slowest first-character guess
        if (g.length && ms > bestTime) { bestTime = ms; bestFirst = g.charAt(0); }
        if (match >= 1 && g.charAt(0) === KEY.charAt(0)) {
          result.classList.add('is-ok');
          result.textContent = 'The slowest response points at the first character "' + KEY.charAt(0) + '". Timing leaked it.';
          result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{compare_secrets_in_constant_time}'));
          win();
        } else {
          result.classList.add('is-err');
          result.textContent = 'First character wrong — its time was shorter. Try others; the slowest is correct.';
        }
      });
    }
  });

  /* ---- 2FA with no rate limit ----------------------------------------- */
  CHALLENGES.push({
    id: '2fa-brute',
    title: 'Brute-force a 4-digit 2FA code that has no attempt limit',
    category: 'Broken authentication (2FA)',
    level: 2,
    brief: 'The one-time code is only four digits and the endpoint never limits attempts or expires the code. Ten thousand guesses is nothing to a script.',
    objective: 'Confirm the code space is small enough to brute-force by trying codes until one works.',
    hints: [
      'A 4-digit code has 10,000 possibilities. With no rate limit and no expiry, an attacker just tries them all.',
      'Use the "auto-brute" button, which submits codes rapidly until one is accepted — the server never stops it.',
      'Run the auto-brute; it will find the code within 10,000 tries.'
    ],
    solution: 'With only 10,000 possible codes and no rate limiting, lockout or expiry, an automated client simply enumerates every code until one is accepted. The short code is weak, but the missing rate limit is what makes it exploitable.',
    fix: 'Rate-limit and lock out after a few failed 2FA attempts, expire codes quickly (30–60s) and make them single-use. Use longer codes or TOTP, and alert the user on repeated failures. Defence is the attempt limit, not just the code length.',
    mount: function (root, win) {
      var CODE = '4827';
      var app = el('div', 'hl-app');
      app.appendChild(el('p', 'hl-app-title', 'Enter your 4-digit code (no attempt limit)'));
      var w = el('label', 'hl-field'); w.appendChild(el('span', null, 'code')); var i = el('input'); i.type = 'text'; i.autocomplete = 'off'; i.value = '0000'; w.appendChild(i);
      app.appendChild(w);
      var one = el('button', 'hl-btn hl-btn-ghost', 'Try this code');
      var brute = el('button', 'hl-btn', 'Auto-brute (0000–9999)');
      app.appendChild(one); app.appendChild(brute);
      var out = el('pre', 'hl-query'); app.appendChild(out);
      var result = el('div', 'hl-result'); app.appendChild(result);
      root.appendChild(app);

      one.addEventListener('click', function () {
        result.className = 'hl-result';
        if (i.value === CODE) { result.classList.add('is-ok'); result.textContent = 'Accepted — but you knew it. Try the brute button to make the point.'; }
        else { result.classList.add('is-err'); result.textContent = 'Wrong code. (The server did not count this attempt against you.)'; }
      });
      brute.addEventListener('click', function () {
        result.className = 'hl-result';
        var tries = 0, hit = null;
        for (var n = 0; n < 10000; n++) {
          tries++;
          var guess = ('000' + n).slice(-4);
          if (guess === CODE) { hit = guess; break; }
        }
        out.textContent = 'submitted ' + tries + ' codes — none rejected by rate limiting\ncode found: ' + hit;
        result.classList.add('is-ok');
        result.textContent = 'Brute-forced the code in ' + tries + ' tries. The endpoint never slowed down.';
        result.appendChild(el('p', 'hl-flag', 'Flag captured: HL{rate_limit_and_expire_2fa_codes}'));
        win();
      });
    }
  });

  /* ====================================================================== *
     SHELL — challenge list, detail view, hints, progress
   * ====================================================================== */
  var listNode, detailNode, layoutNode, current = null;

  /* On a phone the list and the challenge stack vertically, so a long list
     would force the visitor to scroll past every problem to reach the one they
     opened. This flips the layout into a master-detail: tapping a challenge
     shows only its workspace (with a back button); the back button returns to
     the list. On desktop both panes are always visible and this class is inert. */
  function showDetail(on) {
    if (!layoutNode) return;
    if (on) layoutNode.classList.add('showing-detail');
    else layoutNode.classList.remove('showing-detail');
  }

  function levelLabel(n) { return n === 1 ? 'Starter' : n === 2 ? 'Intermediate' : 'Advanced'; }

  /* Order the challenges easy -> hard so the unlock chain is a difficulty ramp.
     Array.prototype.sort is stable in every engine this site supports, so
     challenges of the same level keep their authored order. */
  CHALLENGES.sort(function (a, b) { return (a.level || 1) - (b.level || 1); });

  /* Progressive unlocking: the first challenge is always open; every other one
     unlocks only once the challenge before it (in this difficulty order) is
     solved. An already-solved challenge stays open even if you later reset a
     later one. */
  function isUnlocked(index) {
    if (index <= 0) return true;
    var prev = CHALLENGES[index - 1];
    return !!solved[prev.id];
  }
  function indexOfChallenge(c) {
    for (var i = 0; i < CHALLENGES.length; i++) if (CHALLENGES[i] === c) return i;
    return -1;
  }

  function buildList() {
    listNode.textContent = '';
    var solvedCount = CHALLENGES.filter(function (c) { return solved[c.id]; }).length;
    var head = el('div', 'hl-list-head');
    head.appendChild(el('h2', null, 'Challenges'));
    head.appendChild(el('p', 'hl-progress', solvedCount + ' of ' + CHALLENGES.length + ' solved'));
    listNode.appendChild(head);

    CHALLENGES.forEach(function (c, idx) {
      var unlocked = isUnlocked(idx) || solved[c.id];
      var item = el('button', 'hl-list-item' + (current === c ? ' is-active' : ''));
      if (solved[c.id]) item.classList.add('is-solved');
      if (!unlocked) item.classList.add('is-locked');
      var top = el('div', 'hl-list-top');
      top.appendChild(el('span', 'hl-list-cat', c.category));
      top.appendChild(el('span', 'hl-list-level', levelLabel(c.level)));
      item.appendChild(top);
      item.appendChild(el('span', 'hl-list-title', unlocked ? c.title : 'Locked'));
      if (solved[c.id]) item.appendChild(el('span', 'hl-list-check', '✓ solved'));
      else if (!unlocked) {
        item.appendChild(el('span', 'hl-list-lock', '🔒 solve “' + CHALLENGES[idx - 1].title + '” to unlock'));
        item.disabled = true;
      }
      item.addEventListener('click', function () { if (unlocked) { showDetail(true); open(c); } });
      listNode.appendChild(item);
    });

    if (solvedCount === CHALLENGES.length) {
      var done = el('p', 'hl-alldone', 'All challenges solved. Now re-read each fix — that half is the job.');
      listNode.appendChild(done);
    }
  }

  function open(c) {
    // Refuse to open a locked challenge, even if something calls open() directly.
    var idx = indexOfChallenge(c);
    if (!isUnlocked(idx) && !solved[c.id]) {
      for (var k = 0; k < CHALLENGES.length; k++) {
        if (isUnlocked(k) && !solved[CHALLENGES[k].id]) { c = CHALLENGES[k]; break; }
      }
    }
    current = c;
    buildList();
    detailNode.textContent = '';
    detailNode.scrollTop = 0;

    var header = el('div', 'hl-detail-head');
    // Mobile-only "back to the challenge list" control (hidden on desktop by CSS).
    var back = el('button', 'hl-back', '← All challenges');
    back.addEventListener('click', function () { showDetail(false); listNode.scrollTop = 0; });
    header.appendChild(back);
    header.appendChild(el('span', 'hl-detail-cat', c.category + '  ·  ' + levelLabel(c.level)));
    header.appendChild(el('h2', null, c.title));
    header.appendChild(el('p', 'hl-brief', c.brief));
    var obj = el('p', 'hl-objective');
    obj.appendChild(el('strong', null, 'Objective: '));
    obj.appendChild(document.createTextNode(c.objective));
    header.appendChild(obj);
    if (c.note) header.appendChild(el('p', 'hl-note', c.note));
    detailNode.appendChild(header);

    if (solved[c.id]) {
      detailNode.appendChild(el('p', 'hl-solved-banner', '✓ You have solved this. Feel free to try other payloads, or read the fix below.'));
    }

    var stage = el('div', 'hl-stage');
    detailNode.appendChild(stage);

    var won = false;
    function win() {
      if (won) return;
      won = true;
      var wasSolved = !!solved[c.id];
      solved[c.id] = true;
      saveSolved(solved);
      var banner = el('div', 'hl-win');
      banner.appendChild(el('strong', null, 'Solved. '));
      banner.appendChild(document.createTextNode('That is the vulnerability. Now the important half:'));
      stage.appendChild(banner);
      revealFix();
      buildList();
      // Point them at the challenge this just unlocked (if any).
      if (!wasSolved) {
        var myIdx = indexOfChallenge(c);
        var next = CHALLENGES[myIdx + 1];
        if (next && !solved[next.id]) {
          var nb = el('div', 'hl-next');
          nb.appendChild(el('span', null, 'Unlocked next: ' + next.title));
          var nextBtn = el('button', 'hl-btn hl-btn-ghost', 'Go to it →');
          nextBtn.addEventListener('click', function () { open(next); });
          nb.appendChild(nextBtn);
          stage.appendChild(nb);
        }
      }
    }

    try {
      c.mount(stage, win);
    } catch (e) {
      stage.appendChild(el('p', 'hl-result is-err', 'This challenge failed to load: ' + e));
    }

    /* progressive hints */
    var hintWrap = el('div', 'hl-hints');
    hintWrap.appendChild(el('h3', null, 'Stuck?'));
    var shown = 0;
    var hintList = el('div', 'hl-hint-list');
    var hintBtn = el('button', 'hl-btn hl-btn-ghost', 'Show a hint');
    hintBtn.addEventListener('click', function () {
      if (shown < c.hints.length) {
        var h = el('p', 'hl-hint');
        h.appendChild(el('strong', null, 'Hint ' + (shown + 1) + '. '));
        h.appendChild(document.createTextNode(c.hints[shown]));
        hintList.appendChild(h);
        shown++;
      }
      if (shown >= c.hints.length) {
        hintBtn.disabled = true;
        hintBtn.textContent = 'No more hints';
        var sol = el('details', 'hl-solution');
        sol.appendChild(el('summary', null, 'Show the full solution'));
        sol.appendChild(el('pre', null, c.solution));
        hintList.appendChild(sol);
      } else {
        hintBtn.textContent = 'Show another hint (' + shown + '/' + c.hints.length + ')';
      }
    });
    hintWrap.appendChild(hintBtn);
    hintWrap.appendChild(hintList);
    detailNode.appendChild(hintWrap);

    /* the fix, revealed on solve or on demand */
    var fixWrap = el('div', 'hl-fix');
    function revealFix() {
      if (fixWrap.dataset.open) return;
      fixWrap.dataset.open = '1';
      fixWrap.textContent = '';
      fixWrap.appendChild(el('h3', null, 'How to fix it'));
      fixWrap.appendChild(el('p', null, c.fix));
    }
    var fixBtn = el('button', 'hl-btn hl-btn-ghost', 'Show the fix without solving');
    fixBtn.addEventListener('click', function () { revealFix(); fixBtn.remove(); });
    fixWrap.appendChild(fixBtn);
    if (solved[c.id]) revealFix();
    detailNode.appendChild(fixWrap);
  }

  /* ---- reset progress --------------------------------------------------- */
  function mountShell() {
    host.textContent = '';
    var layout = el('div', 'hl-layout');
    layoutNode = layout;
    listNode = el('aside', 'hl-list');
    detailNode = el('section', 'hl-detail');
    layout.appendChild(listNode);
    layout.appendChild(detailNode);
    host.appendChild(layout);

    buildList();
    // Open the first challenge that is unlocked and not yet solved, so a
    // returning visitor lands where they left off rather than back at the start.
    var start = CHALLENGES[0];
    for (var s = 0; s < CHALLENGES.length; s++) {
      if (isUnlocked(s) && !solved[CHALLENGES[s].id]) { start = CHALLENGES[s]; break; }
    }
    open(start);

    var resetBtn = el('button', 'hl-reset', 'Reset my progress');
    resetBtn.addEventListener('click', function () {
      solved = {};
      saveSolved(solved);
      buildList();
      if (current) open(current);
    });
    listNode.appendChild(resetBtn);
  }

  /* The consent/intro gate uses the offline key — nothing here is uploaded. */
  var PREFIX = 'lab.';
  /* The gate only paints over the lab: .lab-gate is position:absolute with an
     opaque background, so without this every control beneath it stays in the
     tab order and in the accessibility tree while the visitor is still being
     asked to agree. `inert` removes a subtree from focus, hit-testing and
     assistive tech in one property. Browsers without support ignore it, so
     this cannot regress anything. */
  function setGateInert(on) {
    var g = document.getElementById('lab-gate');
    if (!g || !host) return;
    var kids = host.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== g) kids[i].inert = on;
    }
  }

  function gate() {
    var agreed;
    try { agreed = localStorage.getItem(PREFIX + 'consent'); } catch (e) { agreed = null; }
    if (agreed === 'yes') { host.setAttribute('data-consent', 'granted'); mountShell(); return; }
    setGateInert(true);
    var yes = document.getElementById('lab-agree');
    var no = document.getElementById('lab-leave');
    yes && yes.addEventListener('click', function () {
      try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (e) {}
      host.setAttribute('data-consent', 'granted');
      setGateInert(false);
      mountShell();
    });
    no && no.addEventListener('click', function () { window.location.href = '/'; });
  }

  gate();
})();

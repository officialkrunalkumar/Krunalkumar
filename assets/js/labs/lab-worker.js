/* ==========================================================================
   lab-worker.js — runs user code off the main thread.
   --------------------------------------------------------------------------
   Everything in here executes inside a Web Worker, which buys three things:

     1. A runaway program (infinite loop, fork bomb, huge allocation) freezes
        the worker, not the page — so the Stop button can still be clicked.
        Stopping is worker.terminate() from lab-app.js; there is deliberately
        no cooperative "please stop" flag, because a tight `while(1)` would
        never check one.
     2. Multi-megabyte runtimes are fetched and instantiated without blocking
        first paint or input on the page itself.
     3. No DOM access, so a runtime bug cannot reach the document.

   Runtimes are cached in `loaded` for the life of the worker, and lab-app.js
   keeps the worker alive across runs of the same language — measured, that is
   3535ms for a cold Python against 3ms for the next run. Only a language
   switch or a Stop drops the worker. Because it survives, anything that must
   look freshly started is reset per run instead: Python clears its globals,
   Lua builds a new engine, SQLite and Postgres each get a new database.

   stdin is supplied up-front from the Input panel rather than read
   interactively. Blocking reads from a worker need SharedArrayBuffer +
   Atomics.wait, which needs COOP/COEP headers site-wide, which would break
   the embedded analytics. Pre-supplied stdin is how most online compilers
   work anyway, and it costs no headers at all.

   Message protocol
     in   { type: 'run', lang, code, stdin }
          { type: 'transpile', code }            (TypeScript -> JavaScript)
     out  { type: 'status',     text }           progress, shown in toolbar
          { type: 'progress',   label, loaded, total, done }
                                             byte counts for a multi-megabyte
                                             download, so the page can draw a
                                             real bar. total 0 means "size
                                             unknown, show it indeterminate";
                                             done true means "hide the bar".
                                             Deliberately NOT a status message:
                                             it fires four times a second and
                                             the status line is a live region.
          { type: 'exec',       text }           the runtime is up and the
                                             program is about to run: the page
                                             restarts its watchdog clock here
                                             so a slow first download is never
                                             mistaken for an infinite loop
          { type: 'out',        cls, text }      cls -> .t-* class in the CSS
          { type: 'done',       ok, ms, failure }
                                             failure is null for a normal run,
                                             or { kind, lang } when the runtime
                                             itself never finished loading
          { type: 'transpiled', js, error }
   ========================================================================== */

/* global loadPyodide, initSqlJs, wasmoon, ts, API */
'use strict';

/* Absolute, not '/assets/vendor/'. Emscripten builds hand the path from
   locateFile() to their own loader, and some of them resolve it against the
   emitting script rather than the document root — WebPerl silently failed to
   fetch emperl.data that way, initialising with no standard library and then
   producing no output at all, with no error anywhere. An absolute URL removes
   the ambiguity for every runtime here.

   It is also the single place to change if these assets ever move to separate
   storage: point this at that origin and nothing else needs touching. */
var VENDOR = self.location.origin + '/assets/vendor/';
var loaded = {};   // lang -> instantiated runtime

/* Which entry in `loaded` proves a language's runtime finished initialising.
   A runtime that never downloaded and a program with a syntax error both land
   in the same catch at the bottom of this file, and reporting the first as if
   it were the second sends people hunting for a bug in code that is fine. */
var RUNTIME_KEY = {
  python: 'python', sql: 'sql', lua: 'luaReady', c: 'clang', cpp: 'clang',
  postgres: 'pglite', ruby: 'rubyReady', perl: 'perlReady', php: 'php'
};

function runtimeLoaded(lang) {
  var key = RUNTIME_KEY[lang];
  return key ? !!loaded[key] : true;   // unmapped languages: assume it loaded
}

/* Best-effort cause, used only to choose the wording the page shows. A wrong
   guess costs a less helpful sentence, never a wrong result. */
function failureKind(err) {
  var text = String((err && err.message) || err);
  if (typeof WebAssembly === 'undefined') return 'unsupported';
  if (err instanceof RangeError) return 'memory';
  if (/out of memory|\bOOM\b|enlarge memory|allocation failed|buffer allocation/i.test(text)) return 'memory';
  // A download failure wearing a compiler error's clothes: the bytes arrived,
  // they were just an error page. Must be tested before the support rule below,
  // which would otherwise blame the browser and hide the retry button.
  if (/magic word|magic number|MIME type|fetching of the wasm failed|status code is not ok/i.test(text)) return 'network';
  if (/failed to fetch|load failed|network|importScripts|net::|ERR_|failed to load/i.test(text)) return 'network';
  if (/refused to compile|blocked by CSP|wasm-unsafe-eval/i.test(text)) return 'unsupported';
  if (/WebAssembly|\bwasm\b/i.test(text) && /not supported|unsupported|disabled/i.test(text)) return 'unsupported';
  return 'unknown';
}
var stdinLines = [];
var stdinCursor = 0;

/* NOT named `out`. Emscripten builds declare `var out = Module["print"] || …`
   at global scope, and importScripts() runs them in exactly this scope — so a
   function called `out` here is silently replaced the moment such a runtime
   loads. WebPerl does this, and the symptom is brutal to diagnose: the program
   runs correctly, the output is captured correctly, and then nothing is ever
   posted to the page. Any runtime loaded afterwards in the same worker would
   lose its output too. */
function post(msg) { self.postMessage(msg); }
function status(text) { post({ type: 'status', text: text }); }

/* The load/run boundary, announced once per run.

   Everything before this point is fetching and instantiating a runtime — up to
   ~18 MB over the wire for the clang toolchain, which is slow on a phone and
   entirely outside the visitor's control. Everything after it is their program.
   The page runs a watchdog that kills a program still going after 60s and warns
   at 8s that it is "probably an infinite loop"; timing that from the Run click
   meant a cold start on a slow connection got killed mid-download and blamed on
   the visitor's code. So each runtime calls this at the moment it is ready, and
   the page restarts the clock here.

   Compilation and type-checking count as run, not load: they are work the
   program's own source is responsible for. */
function execPhase(text) { post({ type: 'exec', text: text }); }
function labOut(text, cls) { post({ type: 'out', text: String(text), cls: cls || 't-out' }); }

/* Hand the next line of the Input panel to a runtime asking for stdin.
   Returns null at EOF, which is what CPython, Lua and JSCPP all expect. */
function readLine() {
  if (stdinCursor >= stdinLines.length) return null;
  return stdinLines[stdinCursor++];
}

/* --------------------------------------------------------------------------
   Python — Pyodide (real CPython on WebAssembly)
   -------------------------------------------------------------------------- */
async function pythonRuntime() {
  if (loaded.python) return loaded.python;
  status('Downloading CPython (~12 MB, cached after this)…');
  importScripts(VENDOR + 'pyodide/pyodide.js');
  var py = await loadPyodide({
    indexURL: VENDOR + 'pyodide/',
    stdout: function (line) { labOut(line + '\n'); },
    stderr: function (line) { labOut(line + '\n', 't-err'); },
    stdin: function () { var l = readLine(); return l === null ? '' : l; }
  });
  loaded.python = py;
  return py;
}

/* Pyodide runs the user's code through its own eval_code_async machinery, so
   an uncaught exception arrives wrapped in half a dozen frames from
   /lib/python313.zip/_pyodide/_base.py. Those are noise — they point at
   Pyodide's plumbing, not at anything the user wrote — and on a beginner's
   first NameError they bury the one line that matters. Strip them, keeping
   the header, the user's own frames and the final exception line. */
function cleanTraceback(text) {
  var lines = String(text).split('\n');
  var kept = lines.filter(function (line) {
    if (/File "\/lib\/python[0-9.]*\.zip\/_pyodide\//.test(line)) return false;
    if (/^\s+(await CodeRunner|coroutine = eval|\.run_async|return await)/.test(line)) return false;
    return true;
  });
  // If filtering removed everything meaningful, the original is better than a
  // stub — never leave the user with an empty error.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() || String(text);
}

async function runPython(code) {
  var py = await pythonRuntime();
  execPhase('Running…');
  try {
    // The worker is reused between runs so the interpreter stays loaded, but a
    // script must behave identically the second time it is run — so the user
    // namespace is cleared first. Without this a deleted line would appear to
    // keep working, which is a genuinely confusing bug to hit.
    py.runPython([
      'import builtins as __b',
      'for __k in list(globals()):',
      '    if not __k.startswith("__") and __k not in dir(__b):',
      '        del globals()[__k]'
    ].join('\n'));
    await py.runPythonAsync(code);
  } catch (err) {
    var cleaned = new Error(cleanTraceback((err && err.message) || err));
    cleaned.__labClean = true;
    throw cleaned;
  }
}

/* --------------------------------------------------------------------------
   SQL — sql.js (real SQLite)
   Results are rendered as a monospace table; sql.js hands back one result set
   per statement that returns rows.
   -------------------------------------------------------------------------- */
async function sqlRuntime() {
  if (loaded.sql) return loaded.sql;
  status('Downloading SQLite (~700 KB, cached after this)…');
  importScripts(VENDOR + 'sqljs/sql-wasm.js');
  loaded.sql = await initSqlJs({ locateFile: function (f) { return VENDOR + 'sqljs/' + f; } });
  return loaded.sql;
}

function renderTable(columns, values) {
  var widths = columns.map(function (c, i) {
    return values.reduce(function (max, row) {
      return Math.max(max, String(row[i] === null ? 'NULL' : row[i]).length);
    }, String(c).length);
  });
  var pad = function (s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
  var line = function (l, m, r) {
    return l + widths.map(function (w) { return '─'.repeat(w + 2); }).join(m) + r;
  };
  var rowText = function (cells) {
    return '│ ' + cells.map(function (c, i) {
      return pad(c === null ? 'NULL' : c, widths[i]);
    }).join(' │ ') + ' │';
  };

  labOut(line('┌', '┬', '┐') + '\n', 't-dim');
  labOut(rowText(columns) + '\n', 't-info');
  labOut(line('├', '┼', '┤') + '\n', 't-dim');
  values.forEach(function (row) { labOut(rowText(row) + '\n'); });
  labOut(line('└', '┴', '┘') + '\n', 't-dim');
  labOut(values.length + (values.length === 1 ? ' row' : ' rows') + '\n\n', 't-dim');
}

async function runSql(code) {
  var SQL = await sqlRuntime();
  execPhase('Running…');
  var db = new SQL.Database();
  try {
    var results = db.exec(code);
    if (!results.length) {
      labOut('Statement executed. No rows returned.\n', 't-dim');
      return;
    }
    results.forEach(function (r) { renderTable(r.columns, r.values); });
  } finally {
    db.close();
  }
}

/* --------------------------------------------------------------------------
   Lua — Wasmoon (real Lua 5.4)
   print / io.write / io.read are replaced so they route through the terminal
   pane and the Input panel instead of the runtime's own buffers.
   -------------------------------------------------------------------------- */
async function runLua(code) {
  if (!loaded.luaFactory) {
    status('Downloading Lua (~420 KB, cached after this)…');
    importScripts(VENDOR + 'wasmoon/index.js');
    loaded.luaFactory = new wasmoon.LuaFactory(VENDOR + 'wasmoon/glue.wasm');
  }
  execPhase('Running…');
  // A fresh engine per run: Lua globals must not leak between runs.
  var lua = await loaded.luaFactory.createEngine();
  // The factory constructor does not fetch glue.wasm — createEngine() does.
  loaded.luaReady = true;
  try {
    lua.global.set('print', function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
      labOut(parts.join('\t') + '\n');
    });
    lua.global.set('__lab_write', function () {
      for (var i = 0; i < arguments.length; i++) labOut(String(arguments[i]));
    });
    lua.global.set('__lab_read', function () { return readLine(); });
    await lua.doString(
      'io.write = __lab_write\n' +
      'io.read = __lab_read\n' +
      '__lab_write, __lab_read = nil, nil\n'
    );
    await lua.doString(code);
  } finally {
    lua.global.close();
  }
}


/* --------------------------------------------------------------------------
   Download progress
   --------------------------------------------------------------------------
   A status line that never changes is fine for 700 KB of SQLite. It is not
   fine for the clang toolchain: clang.wasm and lld.wasm are ~17 MB over the
   wire between them, which is 30-65 seconds on a typical Indian 4G
   connection, and for all of that time a static string is indistinguishable
   from a page that has hung. So those two are read through a tapped stream
   and the byte counts posted to the page, which draws a real bar.

   Two figures are tracked per file, because they are not the same figure.
   response.body hands over DECODED bytes; Content-Length reports what
   actually crossed the wire, and these are served Brotli-compressed —
   clang.wasm is 31 MB unpacked but ~10 MB on the wire. Counting decoded
   bytes against Content-Length would sail past 100% in the first few
   seconds. So the fraction is measured in decoded bytes (the only ones that
   can be counted from here) and reported in wire bytes (the only ones the
   visitor is actually waiting for).

   Every part of this is optional by construction. No Content-Length, no
   ReadableStream, an engine that will not build a Response from a stream —
   each falls back to the plain fetch this file has always used. The readout
   can be lost; the download cannot.
   -------------------------------------------------------------------------- */

/* Unpacked size of each module, read off the files in the repo. Only used to
   convert decoded bytes into wire bytes for display, so a stale number here
   costs a slightly wrong percentage and nothing else. */
var CLANG_UNPACKED = { 'clang.wasm': 31214472, 'lld.wasm': 19490094 };

var dl = null;   // the download being reported right now, or null for none

function dlBegin(label, names, unpacked) {
  dl = { label: label, files: {}, seen: 0, last: 0 };
  names.forEach(function (name) {
    dl.files[name] = { got: 0, wire: 0, unpacked: (unpacked && unpacked[name]) || 0 };
  });
  // Nothing is known yet, so this only asks the page to show the bar.
  post({ type: 'progress', label: label, loaded: 0, total: 0 });
}

function dlEnd() {
  if (!dl) return;
  dl = null;
  post({ type: 'progress', done: true });
}

function dlPost(force) {
  if (!dl) return;
  var now = Date.now();
  // Four messages a second at most. A 10 MB body arrives in thousands of
  // chunks and one postMessage per chunk would cost more than the download.
  if (!force && now - dl.last < 250) return;
  dl.last = now;

  var names = Object.keys(dl.files);
  var raw = 0, wireTotal = 0, unpackedTotal = 0;
  var allWire = true, allUnpacked = true;
  names.forEach(function (name) {
    var f = dl.files[name];
    raw += f.got;
    if (f.wire > 0) wireTotal += f.wire; else allWire = false;
    if (f.unpacked > 0) unpackedTotal += f.unpacked; else allUnpacked = false;
  });

  // Indeterminate until proven otherwise: bytes-so-far and no total. That is
  // what the page gets when a header is missing, and it is still enough to
  // answer the only question being asked — is anything still arriving?
  var loaded = raw;
  var total = 0;

  // Only once every response has actually been seen. Measuring against half
  // the files would draw a bar that reaches the end and then keeps going.
  if (dl.seen === names.length) {
    if (allWire) {
      total = wireTotal;
      loaded = 0;
      names.forEach(function (name) {
        var f = dl.files[name];
        var frac = f.unpacked > 0 ? f.got / f.unpacked : f.got / f.wire;
        loaded += f.wire * Math.min(1, frac);
      });
    } else if (allUnpacked) {
      // No Content-Length anywhere — chunked, or a proxy stripped it. The
      // known unpacked sizes still give an honest bar, just counted in
      // unpacked megabytes rather than wire ones.
      total = unpackedTotal;
      loaded = Math.min(total, raw);
    }
  }

  post({
    type: 'progress', label: dl.label,
    loaded: Math.round(loaded), total: Math.round(total)
  });
}

/* Count the bytes of a response as they arrive, changing nothing the caller
   can observe: same status, same headers — so the application/wasm type
   survives and WebAssembly.compileStreaming still compiles while the module
   downloads, which is the only thing that makes 31 MB bearable — and the same
   streaming behaviour. Hands back the response untouched whenever the wrapping
   cannot be done. */
function tapResponse(response, name) {
  if (!dl || !dl.files[name]) return response;
  var f = dl.files[name];

  var len = parseInt(response.headers.get('Content-Length'), 10);
  f.wire = (isFinite(len) && len > 0) ? len : 0;
  dl.seen++;
  dlPost(true);

  if (typeof ReadableStream === 'undefined' || typeof Response !== 'function' ||
      !response.body || typeof response.body.getReader !== 'function') {
    return response;   // nothing to tap; the download itself is unaffected
  }

  var reader = null;
  try {
    var tapped = new ReadableStream({
      pull: function (controller) {
        // Acquired here rather than up front: getReader() locks the body, and
        // if either constructor below throws the ORIGINAL response still has
        // to be usable. highWaterMark 0 means pull does not run until
        // something reads, so a throw happens while the body is still free.
        if (!reader) reader = response.body.getReader();
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            // Forced, because the throttle below would otherwise swallow the
            // last update: a file that arrives inside one 250ms window — a
            // service-worker cache hit, or a fast connection — would leave the
            // bar showing the zero it started at for its whole lifetime.
            dlPost(true);
            controller.close();
            return;
          }
          f.got += chunk.value.byteLength;
          dlPost(false);
          controller.enqueue(chunk.value);
        }, function (err) {
          // The connection dropped mid-body. Pass it on rather than
          // swallowing it: the caller's own fallback and the page's failure
          // banner are what handle this, and a silent close here would leave
          // compileStreaming holding a truncated module.
          controller.error(err);
        });
      },
      cancel: function (reason) {
        if (reader) { try { reader.cancel(reason); } catch (err) {} }
      }
    }, { highWaterMark: 0 });
    return new Response(tapped, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (err) {
    // Building a Response from a JS stream is not universal. The original has
    // not been read (see above), so it is still perfectly good.
    return response;
  }
}

/* fetch() plus byte counting, where the counting is strictly a side effect:
   anything that goes wrong with it yields the plain response and the caller
   never knows the difference. */
function fetchTapped(url, name) {
  return fetch(url).then(function (response) {
    if (!response.ok) return response;   // an error page: hand it straight on
    try { return tapResponse(response, name); }
    catch (err) { return response; }
  });
}

/* --------------------------------------------------------------------------
   C and C++ — a real clang, not an interpreter.
   --------------------------------------------------------------------------
   clang and lld are compiled to WebAssembly (the wasm-clang project). The
   pipeline is the genuine one: clang -cc1 compiles the source to a wasm32-wasi
   object file, lld links it against the sysroot's libc and libc++, and the
   resulting .wasm module is instantiated and run. That is why the whole
   standard library works here — <vector>, <string>, <algorithm>, templates,
   classes — where an interpreter would fall over.

   It is also 58 MB unpacked — but about 19 MB over the wire, because every
   one of these files is served Brotli-compressed. The wire figure is the one
   worth quoting to a visitor: it is what they wait for. Either way it is why
   nothing is fetched until the first Run, why the browser's immutable cache
   matters so much afterwards, and why this is the one runtime that reports
   its download byte by byte.

   `-x c` versus `-x c++` is threaded through deliberately: compiling C as C++
   silently changes its meaning, so /labs/c really does compile as C.
   -------------------------------------------------------------------------- */
var CLANG_DIR = VENDOR + 'clang/';

/* The toolchain talks in ANSI colour and writes progress with a "> " prefix.
   The terminal pane renders classes, not escape codes, so the codes are
   stripped and the toolchain's own chatter is dimmed to keep the user's
   program output the thing that stands out. */
function makeClangWriter() {
  var atLineStart = true;
  var lineIsLog = false;
  return function hostWrite(text) {
    var clean = String(text).replace(/\x1b\[[0-9;]*m/g, '');
    for (var i = 0; i < clean.length; i++) {
      var ch = clean.charAt(i);
      if (atLineStart) { lineIsLog = (ch === '>'); atLineStart = false; }
      if (ch === '\n') atLineStart = true;
      labOut(ch, lineIsLog ? 't-dim' : 't-out');
    }
  };
}

async function clangApi() {
  if (loaded.clang) return loaded.clang;
  // Said before anything starts, not after. ~19 MB is half a minute or more
  // on a phone, and a visitor who was never told that is watching a page that
  // looks broken rather than one that is working.
  //
  // But only when it is true. This said "First compile downloads…" on the
  // tenth compile too, so the one lab with the largest download was also the
  // one that most loudly denied ever having cached it. caches.match searches
  // every cache this origin owns, which is what we want: the question is
  // whether the bytes are on the machine, not which cache happens to hold them.
  var clangCached = false;
  try { clangCached = !!(await caches.match(CLANG_DIR + 'clang.wasm')); } catch (e) {}
  status(clangCached
    ? 'Loading clang and lld from this device’s cache…'
    : 'First compile downloads about 19 MB of clang and lld, then it is cached…');
  importScripts(CLANG_DIR + 'shared.js');
  var api = new API({
    readBuffer: function (f) {
      return fetch(CLANG_DIR + f).then(function (r) { return r.arrayBuffer(); });
    },
    // The binaries are served as .wasm so the MIME type is application/wasm
    // and streaming compilation works — it matters at 31 MB. The fallback
    // covers hosts that mislabel the type, where compileStreaming throws.
    //
    // fetchTapped is fetch with a byte counter attached; it degrades to a
    // plain fetch on its own whenever it cannot count, so this stays exactly
    // as reliable as it was, and the fallback below is still the last word.
    compileStreaming: function (f) {
      return WebAssembly.compileStreaming(fetchTapped(CLANG_DIR + f, f)).catch(function () {
        return fetch(CLANG_DIR + f)
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (b) { return WebAssembly.compile(b); });
      });
    },
    hostWrite: makeClangWriter(),
    clang: 'clang.wasm', lld: 'lld.wasm', memfs: 'memfs.wasm', sysroot: 'sysroot.tar'
  });
  await api.ready;
  // api.ready only waits for memfs.wasm and sysroot.tar. clang.wasm and
  // lld.wasm together are another ~50 MB, fetched lazily on the first compile —
  // pull them now so a failed download is reported as a failed download rather
  // than as an error in whatever the user happened to be compiling.
  if (typeof api.getModule === 'function') {
    dlBegin('clang and lld', ['clang.wasm', 'lld.wasm'], CLANG_UNPACKED);
    // The toolchain narrates every fetch through hostWrite ("> Fetching and
    // compiling clang.wasm..."). Two of those running at once interleave
    // character by character into one unreadable line, and the progress bar
    // says the same thing far better. Muted only for the length of the
    // prefetch and put straight back, because compileLinkRun's diagnostics —
    // the output that actually matters — go through the same function.
    var narrate = api.hostWrite;
    api.hostWrite = function () {};
    try {
      // Two independent files, so there is no reason to wait for the first
      // before starting the second: serially this was ~10 MB and then ~6 MB
      // back to back, which on a slow connection is twice the wait for no
      // benefit at all.
      await Promise.all([api.getModule('clang.wasm'), api.getModule('lld.wasm')]);
    } finally {
      api.hostWrite = narrate;
      dlEnd();
    }
  }
  loaded.clang = api;
  return api;
}

async function runClang(code, lang) {
  var api = await clangApi();
  // stdin is handed to the linked program, not to the compiler.
  api.memfs.setStdinStr(stdinLines.join('\n') + '\n');
  execPhase(lang === 'c' ? 'Compiling C…' : 'Compiling C++…');
  await api.compileLinkRun(code, lang);
}

/* --------------------------------------------------------------------------
   PostgreSQL — PGlite (real Postgres compiled to WebAssembly)
   --------------------------------------------------------------------------
   Not a Postgres-compatible reimplementation: this is the actual server,
   built to WASM and running single-user in this tab. That is why the dialect,
   the error messages and the type system all match a real installation, and
   why it is worth a ~5.5 MB compressed download when SQLite is ~350 KB
   (17 MB against 700 KB unpacked in the cache).

   PGlite ships as an ES module, so it is loaded with a dynamic import()
   rather than importScripts(). That is allowed inside a classic worker and
   keeps the rest of this file unchanged.
   -------------------------------------------------------------------------- */
async function pgliteDb() {
  if (loaded.pglite) return loaded.pglite;
  status('Downloading PostgreSQL (~17 MB, cached after this)…');
  var mod = await import(VENDOR + 'pglite/index.js');
  var PGlite = mod.PGlite || (mod.default && mod.default.PGlite);
  if (!PGlite) throw new Error('PGlite failed to load.');
  loaded.pglite = PGlite;
  return PGlite;
}

async function runPostgres(code) {
  var PGlite = await pgliteDb();
  status('Starting Postgres…');
  // A fresh in-memory database per run: leaking a schema between runs would
  // make the same script behave differently the second time.
  var db = new PGlite();
  try {
    await db.waitReady;
    execPhase('Running…');
    var results = await db.exec(code);
    var printed = 0;
    results.forEach(function (r) {
      if (r.fields && r.fields.length && r.rows && r.rows.length) {
        var columns = r.fields.map(function (f) { return f.name; });
        var values = r.rows.map(function (row) {
          return columns.map(function (c) {
            var v = row[c];
            return v === null || v === undefined ? null : String(v);
          });
        });
        renderTable(columns, values);
        printed++;
      }
    });
    if (!printed) labOut('Statement executed. No rows returned.\n', 't-dim');
  } finally {
    try { await db.close(); } catch (err) { /* already gone */ }
  }
}

/* --------------------------------------------------------------------------
   Ruby — ruby.wasm (the real CRuby, from the Ruby core team)
   --------------------------------------------------------------------------
   $stdout is redirected inside Ruby rather than through the WASI layer: the
   WASI console writes are buffered and only flush at exit, which means a
   long-running script would print nothing until it finished.
   -------------------------------------------------------------------------- */
async function rubyVm() {
  if (loaded.rubyMod) return loaded.rubyMod;
  status('Downloading Ruby (~17 MB, cached after this)…');
  // The UMD build, loaded from our own origin — an ESM import from a CDN
  // would mean a third party serving code on every Ruby run, which is exactly
  // what the privacy claim on these pages rules out.
  importScripts(VENDOR + 'ruby/browser.umd.js');
  var mod = self['ruby-wasm-wasi'];
  if (!mod || !mod.DefaultRubyVM) throw new Error('Ruby failed to load.');
  loaded.rubyMod = mod;
  return mod;
}

async function runRuby(code) {
  var mod = await rubyVm();
  status('Starting Ruby…');
  var module = await WebAssembly.compileStreaming(fetch(VENDOR + 'ruby/ruby.wasm'));
  var vm = await mod.DefaultRubyVM(module);
  // rubyVm() only proves the 100 KB loader arrived. The 16.6 MB ruby.wasm is
  // fetched here, so this is the first point at which Ruby can actually run.
  loaded.rubyReady = true;
  execPhase('Running…');

  // Route Ruby's own stdout/stderr into the terminal a line at a time.
  vm.vm.eval([
    'require "stringio"',
    '$__lab_out = StringIO.new',
    '$stdout = $__lab_out',
    '$stderr = $__lab_out'
  ].join('\n'));

  try {
    vm.vm.eval(code);
  } finally {
    var text = vm.vm.eval('$__lab_out.string').toString();
    if (text) labOut(text.replace(/\n?$/, '\n'));
  }
}

/* --------------------------------------------------------------------------
   Perl — WebPerl (Perl 5 compiled with Emscripten)
   --------------------------------------------------------------------------
   WebPerl is an older Emscripten build that expects a `Module` global with
   preRun/print hooks, and it reads its script from a <script type="text/perl">
   tag in a page. Neither applies in a worker, so the emperl module is driven
   directly: the program is written into its virtual filesystem and perl is
   invoked on it, which is what the page wrapper does underneath anyway.
   -------------------------------------------------------------------------- */
/* WebPerl's Emscripten build does NOT export Module.FS, so the program cannot
   be written into a virtual file — it goes in with `perl -e` instead, which
   needs no filesystem at all.

   Output arrives through the per-character stdout/stderr hooks rather than
   print/printErr, and Emscripten copies those hooks into its internals at
   startup. That is why the buffer lives at module scope: re-pointing
   Module.stdout on a later run has no effect, because the closure Emscripten
   captured on the first run is the one still being called. The hooks always
   append to perlOut, and each run simply empties it first. */
var perlOut = [];

function perlPushChar(codePoint) {
  if (codePoint === null || codePoint === undefined) return;
  perlOut.push(String.fromCharCode(codePoint));
}

function perlPushLine(text) {
  perlOut.push(text + '\n');
}

async function runPerl(code) {
  if (!loaded.perlReady) {
    status('Downloading Perl (~16 MB, cached after this)…');
    self.Module = {
      noInitialRun: true,
      locateFile: function (path) { return VENDOR + 'perl/' + path; },
      print: perlPushLine,
      printErr: perlPushLine,
      stdout: perlPushChar,
      stderr: perlPushChar
    };
    importScripts(VENDOR + 'perl/emperl.js');
    var booted = await new Promise(function (resolve) {
      var started = Date.now();
      var check = setInterval(function () {
        if (self.Module && self.Module.calledRun) { clearInterval(check); resolve(true); }
        else if (Date.now() - started > 40000) { clearInterval(check); resolve(false); }
      }, 40);
    });
    // Timing out means emperl.data or emperl.wasm never arrived. Falling
    // through would run nothing and report success.
    if (!booted) throw new Error('Perl failed to load — fetching the runtime timed out.');
    loaded.perlReady = true;
  }

  perlOut = [];
  execPhase('Running…');
  try {
    self.Module.callMain(['-e', code]);
  } catch (err) {
    // Emscripten reports a normal exit() by throwing ExitStatus.
    if (!/ExitStatus|exit\(/.test(String(err))) throw err;
  }

  var text = perlOut.join('');
  if (text) {
    labOut(text.replace(/\n?$/, '\n'));
  } else {
    // Nothing captured. Say why rather than finishing silently — a blank
    // terminal is indistinguishable from a program that printed nothing.
    labOut('[perl produced no output] calledRun=' + !!self.Module.calledRun +
        ' hooksIntact=' + (self.Module.stdout === perlPushChar) +
        ' callMain=' + (typeof self.Module.callMain) + '\n', 't-warn');
  }
}

/* --------------------------------------------------------------------------
   PHP — php-wasm (real PHP 8.4)
   -------------------------------------------------------------------------- */
/* php-wasm's Emscripten glue reaches for `document` on load — not for
   anything PHP itself needs, but for the SDL/canvas/fullscreen helpers
   Emscripten always emits. In a Worker there is no document, so those throw
   before PHP ever starts. A stub with the handful of members they touch is
   enough; none of those code paths do anything for a CLI PHP script. */
function stubDocumentForEmscripten() {
  if (self.document) return;
  var noop = function () {};
  // Emscripten's browser shims also assume `window`. In a Worker the global
  // object plays that role perfectly well, so point it at self rather than
  // inventing a second one — anything they set stays visible to the module.
  if (!self.window) self.window = self;
  var el = function () {
    return {
      style: {}, appendChild: noop, setAttribute: noop,
      addEventListener: noop, removeEventListener: noop,
      getContext: function () { return null; }
    };
  };
  self.document = {
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: el,
    body: el(),
    documentElement: el(),
    addEventListener: noop,
    removeEventListener: noop,
    currentScript: null,
    fullscreenEnabled: false,
    fullscreenElement: null
  };
}

async function runPhp(code) {
  if (!loaded.php) {
    status('Downloading PHP (~14 MB, cached after this)…');
    stubDocumentForEmscripten();
    var mod = await import(VENDOR + 'php/PhpWeb.mjs');
    var instance = new mod.PhpWeb({ persist: false });
    // The constructor returns immediately; this is where the 13.8 MB wasm
    // lands. Caching before it settles would pin a rejected promise forever.
    await instance.binary;
    loaded.php = instance;
  }
  execPhase('Running…');
  var php = loaded.php;

  var buffered = [];
  var onOutput = function (event) { buffered.push(event.detail); };
  php.addEventListener('output', onOutput);
  php.addEventListener('error', onOutput);
  try {
    // PHP only executes what is inside <?php ?>, so a bare script needs the
    // tag adding — but never twice, or the second one prints as literal text.
    var program = /^\s*<\?php/.test(code) ? code : '<?php\n' + code;
    await php.run(program);
  } finally {
    php.removeEventListener('output', onOutput);
    php.removeEventListener('error', onOutput);
  }
  if (buffered.length) labOut(buffered.join(''));
}

/* --------------------------------------------------------------------------
   TypeScript — the official compiler. Type-checks first, then emits the
   JavaScript that lab-app.js runs in a blob Worker like any other script.

   ts.transpileModule() would be far simpler, but it ONLY strips annotations —
   it never type-checks, so `const n: number = "x"` would run happily and the
   whole point of a TypeScript playground would be lost. Real checking needs
   ts.createProgram, which needs a CompilerHost, which needs the lib.*.d.ts
   declaration files. Those are fetched once (~440 KB for the ES2020 chain,
   with lib.dom deliberately absent — there is no DOM in a Worker) and cached
   for the life of the worker.
   -------------------------------------------------------------------------- */
var LIB_DIR = VENDOR + 'typescript/lib/';
var libFiles = null;   // filename -> source text

/* The globals the blob-Worker sandbox actually provides. Without lib.dom
   there is no ambient `console`, and declaring the real DOM lib instead would
   be a lie: document, window and fetch do not exist in there, and letting
   people type-check against them would just move the failure to runtime.
   This declares exactly what js-sandbox.js defines and nothing more. */
var LAB_GLOBALS = 'declare const stdin: string;\n' +
  'declare const console: {\n' +
  '  log(...data: any[]): void;\n' +
  '  info(...data: any[]): void;\n' +
  '  debug(...data: any[]): void;\n' +
  '  warn(...data: any[]): void;\n' +
  '  error(...data: any[]): void;\n' +
  '  trace(...data: any[]): void;\n' +
  '  table(...data: any[]): void;\n' +
  '  dir(...data: any[]): void;\n' +
  '  group(...data: any[]): void;\n' +
  '  groupEnd(): void;\n' +
  '  assert(condition?: boolean, ...data: any[]): void;\n' +
  '  time(label?: string): void;\n' +
  '  timeEnd(label?: string): void;\n' +
  '};\n' +
  'declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;\n' +
  'declare function clearTimeout(id?: number): void;\n' +
  'declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;\n' +
  'declare function clearInterval(id?: number): void;\n' +
  'declare function queueMicrotask(callback: () => void): void;\n' +
  'declare function structuredClone<T>(value: T): T;\n';

async function loadTsLibs() {
  if (libFiles) return libFiles;
  var names = await (await fetch(LIB_DIR + 'index.json')).json();
  var texts = await Promise.all(names.map(function (n) {
    return fetch(LIB_DIR + n).then(function (r) { return r.text(); });
  }));
  libFiles = {};
  names.forEach(function (n, i) { libFiles[n] = texts[i]; });
  return libFiles;
}

async function transpile(code) {
  if (!loaded.ts) {
    status('Downloading the TypeScript compiler (~9 MB, cached after this)…');
    importScripts(VENDOR + 'typescript/typescript.js');
    loaded.ts = ts;
  }
  var T = loaded.ts;
  status('Loading type definitions…');
  var libs = await loadTsLibs();

  execPhase('Type-checking…');
  var MAIN = '/main.ts';
  var GLOBALS = '/lab.globals.d.ts';
  var sources = {};
  var emitted = null;

  var options = {
    target: T.ScriptTarget.ES2020,
    module: T.ModuleKind.None,
    lib: ['lib.es2020.d.ts'],
    strict: true,
    noEmitOnError: true,
    skipLibCheck: true,
    allowJs: false
  };

  function sourceText(name) {
    if (name === MAIN) return code;
    if (name === GLOBALS) return LAB_GLOBALS;
    var base = name.replace(/^.*\//, '');
    return Object.prototype.hasOwnProperty.call(libs, base) ? libs[base] : undefined;
  }

  var host = {
    getSourceFile: function (name, langVersion) {
      if (sources[name]) return sources[name];
      var text = sourceText(name);
      if (text === undefined) return undefined;
      sources[name] = T.createSourceFile(name, text, langVersion, true);
      return sources[name];
    },
    writeFile: function (name, text) {
      // Only main.ts produces runnable output; the .d.ts emits nothing useful.
      if (name.indexOf('lab.globals') === -1) emitted = text;
    },
    getDefaultLibFileName: function () { return 'lib.es2020.d.ts'; },
    getCurrentDirectory: function () { return '/'; },
    getDirectories: function () { return []; },
    getCanonicalFileName: function (n) { return n; },
    useCaseSensitiveFileNames: function () { return true; },
    getNewLine: function () { return '\n'; },
    fileExists: function (n) { return sourceText(n) !== undefined; },
    readFile: function (n) { return sourceText(n); }
  };

  var program = T.createProgram([GLOBALS, MAIN], options, host);
  // getPreEmitDiagnostics is the syntactic AND semantic set — the semantic
  // half is the part transpileModule cannot give you.
  var diagnostics = T.getPreEmitDiagnostics(program).filter(function (d) {
    return d.category === T.DiagnosticCategory.Error;
  });

  if (diagnostics.length) {
    diagnostics.forEach(function (d) {
      var where = '';
      if (d.file && typeof d.start === 'number') {
        var pos = d.file.getLineAndCharacterOfPosition(d.start);
        where = 'line ' + (pos.line + 1) + ', col ' + (pos.character + 1) + ': ';
      }
      labOut(where + T.flattenDiagnosticMessageText(d.messageText, ' ') +
          ' (TS' + d.code + ')\n', 't-err');
    });
    labOut('\n' + diagnostics.length +
        (diagnostics.length === 1 ? ' type error — nothing was run.\n'
                                  : ' type errors — nothing was run.\n'), 't-warn');
    post({ type: 'transpiled', js: null, error: 'type errors' });
    return;
  }

  program.emit();
  post({ type: 'transpiled', js: emitted || '', error: null });
}

/* --------------------------------------------------------------------------
   Dispatch
   -------------------------------------------------------------------------- */
self.onmessage = async function (event) {
  var msg = event.data || {};
  stdinLines = String(msg.stdin || '').replace(/\r\n/g, '\n').split('\n');
  stdinCursor = 0;

  if (msg.type === 'transpile') {
    try {
      await transpile(msg.code);
    } catch (err) {
      labOut(String((err && err.message) || err) + '\n', 't-err');
      // TypeScript answers here rather than through 'done', so the same
      // load-versus-program distinction has to be drawn again.
      post({
        type: 'transpiled', js: null, error: String(err),
        failure: loaded.ts ? null : { kind: failureKind(err), lang: 'typescript' }
      });
    }
    return;
  }

  if (msg.type !== 'run') return;

  var started = Date.now();
  try {
    switch (msg.lang) {
      case 'python': await runPython(msg.code); break;
      case 'sql':    await runSql(msg.code);    break;
      case 'lua':    await runLua(msg.code);    break;
      case 'c':      await runClang(msg.code, 'c');    break;
      case 'cpp':    await runClang(msg.code, 'c++');  break;
      case 'postgres': await runPostgres(msg.code); break;
      case 'ruby':     await runRuby(msg.code);     break;
      case 'perl':     await runPerl(msg.code);     break;
      case 'php':      await runPhp(msg.code);      break;
      default:
        throw new Error('No runtime is registered for "' + msg.lang + '".');
    }
    post({ type: 'done', ok: true, ms: Date.now() - started });
  } catch (err) {
    // Runtime errors are the normal case here (a syntax error in the user's
    // program), so they are reported as program output, not as a lab failure.
    var text = (err && err.message) ? err.message : String(err);
    labOut(text.replace(/\s+$/, '') + '\n', 't-err');
    // ...but if the runtime never finished loading, the program never ran at
    // all. Saying only "error" there reads as a mistake in the user's code.
    post({
      type: 'done', ok: false, ms: Date.now() - started,
      failure: runtimeLoaded(msg.lang) ? null
                                       : { kind: failureKind(err), lang: msg.lang }
    });
  }
};

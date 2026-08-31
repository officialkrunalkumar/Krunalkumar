/* ==========================================================================
   sbom-inspector.js — read a lockfile and say where to look.
   --------------------------------------------------------------------------
   A lockfile is the only honest inventory of what a project actually installs.
   The manifest lists a dozen names; the lockfile lists the thousand packages
   that arrive with them. Nearly every supply-chain question people ask —
   "how much of this did we choose?", "what runs code at install time?", "what
   licence did we just ship?" — is answerable from that file alone, on a laptop,
   without asking a registry anything.

   So that is the line this tool holds. It reads the file in front of it and
   computes from it. It never resolves a name against a registry, never fetches
   an advisory database, never checks a signature. Which means it cannot tell
   you a package is malicious. It can only tell you where a human should look,
   and it tries very hard to be honest about the difference.

   Four decisions worth defending:

   - The three npm lockfile shapes carry different facts, and the tool refuses
     to paper over that. A v2/v3 lockfile has a "packages" map with a root entry,
     so direct-versus-transitive is exact, and it records "hasInstallScript" and
     "license" per package. A v1 lockfile records none of those three: it has no
     root entry, no licence field and no install-script flag. Where a fact is
     unavailable the output says UNAVAILABLE rather than printing a reassuring
     zero. A clean-looking report generated from a file that could not carry the
     evidence is worse than no report.

   - Lookalike names are a prompt, not a verdict, and the tool proves it rather
     than asserting it: it runs the same edit-distance check across its own list
     of well-known packages and reports how many pairs of unquestionably
     legitimate packages sit within distance two of each other. That number is
     computed at run time from the built-in list, and it is never small.

   - Licences are bucketed from whatever field the lockfile happened to carry.
     The unknown count is printed first and loudest, because a lockfile omitting
     the licence is the normal case, not the exception, and a licence report
     that quietly treats "not recorded" as "fine" is the exact failure people
     use these tools to avoid.

   - The CycloneDX export contains what was derivable and nothing else. Hashes
     appear only where the lockfile carried an integrity value; there are no
     vulnerabilities at all, because a vulnerability list would require a
     network lookup this page will never make.

   Everything is arithmetic in this tab. The file is read with FileReader, and
   the SBOM comes back through a blob URL. Nothing is uploaded.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_BYTES = 24 * 1024 * 1024;   // input ceiling, reported when it bites
  var MAX_SCAN  = 20000;              // packages examined by the name checks
  var SHOW      = 12;                 // rows in each "worst offenders" table
  var MAX_NODES = 60000;              // guard on the v1 recursive walk
  var MAX_DEPTH = 400;                // and a guard on how deep that walk goes
  var MAX_BAD   = 200;                // unparseable requirement lines kept
  var MAX_SNIFF = 262144;             // bytes of the head used for shape detection

  var out = LabTool.out('tool-out');

  /* ======================================================================
     Output. Everything printed also lands in mirror, which is what the
     copy button hands over. Rebuilding a plain-text version separately from
     the rendered one is how the two drift apart.
     ====================================================================== */
  var mirror = [];
  var R = {
    clear: function () { mirror.length = 0; out.clear(); return R; },
    line: function (text, cls) {
      var s = (text === undefined || text === null) ? '' : String(text);
      mirror.push(s); out.line(s, cls); return R;
    },
    heading: function (t) { return R.line(t, 't-info'); },
    dim:     function (t) { return R.line(t, 't-dim'); },
    ok:      function (t) { return R.line(t, 't-ok'); },
    warn:    function (t) { return R.line(t, 't-warn'); },
    err:     function (t) { return R.line(t, 't-err'); },
    row: function (label, value, cls) {
      var text = String(label);
      var left = text.length >= 22 ? text + '  ' : text.padEnd(22, ' ');
      mirror.push(left + String(value));
      out.write(left, 't-dim'); out.line(String(value), cls);
      return R;
    },
    rule: function () { return R.line('─'.repeat(52), 't-dim'); },
    text: function () { return mirror.join('\n'); }
  };

  /* ======================================================================
     Small helpers
     ====================================================================== */
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function bag() { return Object.create(null); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function keysOf(o) { return isObj(o) ? Object.keys(o) : []; }

  function plural(n, word) {
    if (n === 1) return num(n) + ' ' + word;
    var w = String(word);
    if (/[^aeiou]y$/.test(w)) w = w.slice(0, -1) + 'ies';
    else if (/(s|x|z|ch|sh)$/.test(w)) w = w + 'es';
    else w = w + 's';
    return num(n) + ' ' + w;
  }

  function clip(text, n) {
    var s = String(text === undefined || text === null ? '' : text);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function pct(a, b) { return b ? (a * 100 / b).toFixed(1) + '%' : '0.0%'; }

  /* Sort a {key: count} bag into a descending array of pairs. */
  function ranked(counts) {
    var pairs = Object.keys(counts).map(function (k) { return [k, counts[k]]; });
    pairs.sort(function (a, b) {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : 1;
    });
    return pairs;
  }

  /* ======================================================================
     The built-in list of well-known package names.

     This is not "the registry". It is a fixed list of names that are widely
     downloaded and therefore worth impersonating, kept short enough to scan
     against every package in a large lockfile without stalling the tab. A
     name absent from this list is not suspicious; a name close to one on it
     is not guilty. Both statements are printed in the output.
     ====================================================================== */
  var POPULAR_NPM = (
    'lodash react react-dom chalk express axios debug commander moment uuid ' +
    'request semver glob minimist tslib rxjs typescript webpack eslint prettier ' +
    'jest mocha chai sinon async bluebird underscore jquery vue socket.io ' +
    'mongoose mysql pg redis dotenv cors body-parser helmet morgan winston ' +
    'nodemon ws yargs inquirer ora colors cross-env rimraf mkdirp fs-extra ' +
    'graceful-fs readable-stream through2 minimatch resolve is-promise ' +
    'ansi-styles supports-color strip-ansi ansi-regex color-convert color-name ' +
    'escape-string-regexp has-flag path-parse function-bind object-assign ' +
    'inherits util-deprecate safe-buffer isarray concat-map brace-expansion ' +
    'balanced-match wrappy once inflight path-is-absolute ms cookie qs ' +
    'iconv-lite mime mime-types mime-db negotiator accepts content-type depd ' +
    'destroy encodeurl escape-html etag finalhandler fresh http-errors ' +
    'on-finished parseurl path-to-regexp proxy-addr range-parser send ' +
    'serve-static setprototypeof statuses toidentifier type-is unpipe ' +
    'utils-merge vary bytes raw-body media-typer forwarded ipaddr.js ' +
    'follow-redirects form-data asynckit combined-stream delayed-stream ' +
    'proxy-from-env node-fetch whatwg-url tr46 webidl-conversions punycode ' +
    'tough-cookie psl universalify jsonfile js-yaml argparse esprima ' +
    'source-map source-map-support acorn chokidar picomatch anymatch braces ' +
    'fill-range to-regex-range is-number normalize-path readdirp fsevents ' +
    'binary-extensions is-binary-path postcss autoprefixer tailwindcss sass ' +
    'less stylelint rollup vite esbuild terser uglify-js core-js ' +
    'regenerator-runtime classnames prop-types redux react-redux redux-thunk ' +
    'immer zustand next svelte preact bootstrap d3 three chart.js dayjs ' +
    'date-fns luxon numeral big.js decimal.js crypto-js bcrypt bcryptjs ' +
    'jsonwebtoken passport multer nodemailer sharp canvas puppeteer ' +
    'playwright cheerio jsdom xml2js fast-xml-parser papaparse csv-parse ' +
    'exceljs archiver tar unzipper adm-zip node-gyp node-sass lerna husky ' +
    'lint-staged ava tape nyc supertest nock left-pad execa cross-spawn which ' +
    'shebang-command shebang-regex npm-run-path path-key signal-exit onetime ' +
    'mimic-fn p-limit p-locate locate-path find-up pkg-dir make-dir del ' +
    'globby fast-glob ignore slash camelcase decamelize meow boxen ' +
    'cli-spinners log-symbols figures wrap-ansi string-width emoji-regex ' +
    'is-fullwidth-code-point ansi-escapes cli-cursor restore-cursor ' +
    '@types/node @types/react @babel/core @babel/runtime @babel/preset-env ' +
    '@angular/core @vue/cli @eslint/js @typescript-eslint/parser ' +
    '@nestjs/core @sentry/node @tanstack/react-query @mui/material ' +
    '@emotion/react @reduxjs/toolkit @octokit/rest @prisma/client'
  ).split(' ');

  var POPULAR_PYPI = (
    'requests urllib3 boto3 botocore setuptools six python-dateutil s3transfer ' +
    'pip certifi idna charset-normalizer typing-extensions packaging numpy ' +
    'pandas pyyaml cryptography jmespath click attrs wheel rsa pyasn1 jinja2 ' +
    'markupsafe protobuf cffi pycparser colorama importlib-metadata zipp ' +
    'chardet awscli docutils pytz scipy matplotlib flask django fastapi ' +
    'uvicorn starlette pydantic sqlalchemy psycopg2 psycopg2-binary pymysql ' +
    'redis celery kombu billiard amqp vine gunicorn werkzeug itsdangerous ' +
    'blinker pytest pluggy iniconfig coverage tox virtualenv filelock ' +
    'platformdirs distlib mock freezegun faker factory-boy beautifulsoup4 ' +
    'soupsieve lxml html5lib selenium scrapy twisted tornado aiohttp ' +
    'aiosignal frozenlist multidict yarl async-timeout httpx httpcore h11 ' +
    'anyio sniffio openpyxl et-xmlfile xlrd pillow opencv-python ' +
    'scikit-learn joblib threadpoolctl torch tensorflow keras transformers ' +
    'tokenizers huggingface-hub tqdm regex sentencepiece nltk gensim spacy ' +
    'google-cloud-storage azure-core paramiko bcrypt pynacl pyopenssl ' +
    'oauthlib requests-oauthlib pyjwt python-dotenv toml tomli rich typer ' +
    'poetry black flake8 pylint mypy isort autopep8 pycodestyle pyflakes ' +
    'astroid wrapt lazy-object-proxy mccabe sqlparse asgiref ' +
    'djangorestframework alembic marshmallow jsonschema pyrsistent ' +
    'more-itertools cachetools decorator future websockets grpcio ' +
    'google-auth google-api-python-client pyarrow polars'
  ).split(' ');

  /* ======================================================================
     Name-similarity checks.

     Four independent tests, because they catch different tricks and a single
     score would hide which one fired:

       separator   underscore for hyphen, dot for hyphen, or none at all
       homoglyph   characters or pairs that render alike at small sizes
       scope-drop  the unscoped form of a scoped package
       distance    Damerau-Levenshtein 1 or 2

     There was a fifth, and taking it out is the most useful thing in this
     file. "scope-add" flagged a scoped name whose tail is a well-known
     unscoped package — @evil/lodash for lodash. On a real TypeScript
     lockfile it flagged @types/express, @types/qs, @types/ws, @types/cookie
     and every other member of DefinitelyTyped, plus @sentry/react,
     @storybook/react and @testing-library/react. Nine of fourteen names in
     the first project I tried it on, all of them entirely ordinary. And the
     true-positive rate is close to zero, because there is no typo path from
     "lodash" to "@evil/lodash": you cannot reach a scope by accident, you
     have to type it. A check that lengthens the list a person has to read
     rather than shortening it is worse than no check, so it is gone.
     scope-DROP stays: crossenv for cross-env is a real, historical attack.

     The distance is the restricted variant (optimal string alignment): it
     counts a swap of two ADJACENT characters as one edit, which is the whole
     reason to use Damerau here, but it will not reuse an edited character in a
     later transposition. For names of this length the difference never shows
     up, and the restricted version is a quarter of the code.
     ====================================================================== */

  /* Pairs first, then singles — 'rn' has to become 'm' before 'r' and 'n' are
     considered on their own. Applied to a lowercased name. */
  function skeleton(name) {
    return String(name)
      .toLowerCase()
      .replace(/rn/g, 'm')
      .replace(/vv/g, 'w')
      .replace(/cl/g, 'd')
      .replace(/[1il|]/g, 'l')
      .replace(/[0o]/g, 'o')
      .replace(/5/g, 's')
      .replace(/3/g, 'e')
      .replace(/[-_.]/g, '');
  }

  function flatten(name) { return String(name).toLowerCase().replace(/[-_.]/g, ''); }

  /* A character-multiset lower bound, which is the reason this tool can scan a
     thousand-package lockfile without stalling the tab.

     Every single edit changes the multiset of characters by at most two counts
     (a substitution removes one and adds one; an insertion or deletion moves
     one; a transposition moves none). So if the summed absolute difference of
     the two count vectors exceeds 2 * max, the distance certainly exceeds max
     and the matrix never has to be built. On a real lockfile this throws away
     the overwhelming majority of candidate pairs for the cost of a few array
     subtractions, and it can never throw away a true match, because it is a
     bound rather than a heuristic.

     Buckets: a-z, 0-9, hyphen, everything else. */
  function charVec(s) {
    var v = new Int32Array(38);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), k;
      if (c >= 97 && c <= 122) k = c - 97;
      else if (c >= 48 && c <= 57) k = 26 + (c - 48);
      else if (c === 45) k = 36;
      else k = 37;
      v[k]++;
    }
    return v;
  }
  function vecDiff(a, b, cap) {
    var d = 0;
    for (var i = 0; i < 38; i++) {
      var x = a[i] - b[i];
      d += x < 0 ? -x : x;
      if (d > cap) return d;
    }
    return d;
  }

  /* Optimal string alignment distance, abandoned as soon as the whole row
     exceeds max.

     Three rows are rotated rather than reallocated. The first version copied
     the row-before-last with slice() on every iteration — needed, because
     reusing one array aliased the two rows together and silently disabled the
     transposition rule — and that copy dominated the run time on a large
     lockfile. Rotating three buffers keeps the rows distinct without copying. */
  var _rowA = [], _rowB = [], _rowC = [];
  function osa(a, b, max) {
    var al = a.length, bl = b.length;
    if (Math.abs(al - bl) > max) return max + 1;
    if (a === b) return 0;
    var two = _rowA, one = _rowB, cur = _rowC, i, j, t;
    for (j = 0; j <= bl; j++) one[j] = j;
    for (i = 1; i <= al; i++) {
      cur[0] = i;
      var best = i;
      var ca = a.charCodeAt(i - 1);
      for (j = 1; j <= bl; j++) {
        var v = cur[j - 1] + 1;
        var w = one[j] + 1;
        if (w < v) v = w;
        w = one[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
        if (w < v) v = w;
        if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) &&
            a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          w = two[j - 2] + 1;
          if (w < v) v = w;
        }
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      t = two; two = one; one = cur; cur = t;
    }
    return one[bl];
  }

  /* The unscoped spellings of a scoped name that an impostor would use. */
  function scopeForms(name) {
    var forms = [];
    if (name.charAt(0) !== '@') return forms;
    var slash = name.indexOf('/');
    if (slash < 1) return forms;
    var scope = name.slice(1, slash), tail = name.slice(slash + 1);
    forms.push(tail);
    forms.push(scope + '-' + tail);
    forms.push(scope + tail);
    return forms;
  }

  function buildIndex(list, eco) {
    var idx = { list: list, eco: eco, flat: bag(), skel: bag(), unscoped: bag(),
                norm: bag(), vecs: [], lens: [] };
    list.forEach(function (p, i) {
      var f = flatten(p);
      if (!idx.flat[f]) idx.flat[f] = p;
      var s = skeleton(p);
      if (!idx.skel[s]) idx.skel[s] = p;
      if (eco === 'pypi' && !idx.norm[normPypi(p)]) idx.norm[normPypi(p)] = p;
      scopeForms(p).forEach(function (form) {
        if (!idx.unscoped[form]) idx.unscoped[form] = p;
      });
      idx.vecs[i] = charVec(p);
      idx.lens[i] = p.length;
    });
    return idx;
  }

  var INDEX_NPM = null, INDEX_PYPI = null;
  function indexFor(eco) {
    if (eco === 'pypi') {
      if (!INDEX_PYPI) INDEX_PYPI = buildIndex(POPULAR_PYPI, 'pypi');
      return INDEX_PYPI;
    }
    if (!INDEX_NPM) INDEX_NPM = buildIndex(POPULAR_NPM, 'npm');
    return INDEX_NPM;
  }

  /* The honesty check. Runs the distance test over the built-in list against
     itself and counts the pairs that would have been flagged if one of them
     had turned up in a lockfile. Every one of those pairs is a pair of real,
     legitimate packages. Memoised, because it is O(n squared) on 200 names. */
  var BASELINE = bag();
  function baselineCollisions(eco) {
    if (has(BASELINE, eco)) return BASELINE[eco];
    var idx = indexFor(eco), list = idx.list, pairs = 0, examples = [];
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (Math.abs(idx.lens[i] - idx.lens[j]) > 2) continue;
        if (vecDiff(idx.vecs[i], idx.vecs[j], 4) > 4) continue;
        var d = osa(list[i], list[j], 2);
        if (d >= 1 && d <= 2) {
          pairs++;
          if (examples.length < 3) examples.push(list[i] + ' / ' + list[j]);
        }
      }
    }
    BASELINE[eco] = { pairs: pairs, total: list.length, examples: examples };
    return BASELINE[eco];
  }

  /* Returns null, or the reason this name resembles a well-known one. */
  function lookalike(name, eco) {
    var idx = indexFor(eco);
    var lower = String(name).toLowerCase();

    // A name that IS the well-known package is not a lookalike. Checked first
    // so nothing below can flag lodash for resembling lodash.
    if (idx.flat[flatten(lower)] === lower) return null;

    /* PyPI names are compared after PEP 503 normalisation: case is ignored and
       any run of - _ . collapses to a single hyphen. So "python_dateutil" and
       "Python.DateUtil" ARE python-dateutil — pip installs the same project
       from all three. The separator rule below used to flag them as
       lookalikes, which was flatly wrong: it accused a file of impersonating
       the package it was actually asking for. npm has no such rule, so
       cross_env and cross-env really are two different packages there and the
       separator rule stays live for npm. */
    if (idx.eco === 'pypi' && idx.norm[normPypi(lower)]) return null;

    var nonAscii = /[^\x20-\x7e]/.test(name);
    if (nonAscii) {
      return { kind: 'non-ascii', target: '', detail:
        'contains a character outside plain ASCII' };
    }

    var f = flatten(lower);
    if (idx.flat[f] && idx.flat[f] !== lower) {
      return { kind: 'separator', target: idx.flat[f], detail:
        'same letters, different hyphen / underscore / dot' };
    }

    if (idx.unscoped[lower]) {
      return { kind: 'scope-drop', target: idx.unscoped[lower], detail:
        'the unscoped spelling of a scoped package' };
    }

    var s = skeleton(lower);
    if (idx.skel[s] && idx.skel[s] !== lower) {
      return { kind: 'homoglyph', target: idx.skel[s], detail:
        'renders almost identically at small sizes' };
    }

    var list = idx.list, bestName = '', bestDist = 3, lv = charVec(lower);
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(idx.lens[i] - lower.length) > 2) continue;
      if (vecDiff(lv, idx.vecs[i], 4) > 4) continue;
      var d = osa(lower, list[i], 2);
      if (d >= 1 && d < bestDist) { bestDist = d; bestName = list[i]; }
      if (bestDist === 1) break;
    }
    if (bestName) {
      return { kind: 'distance', target: bestName, dist: bestDist, detail:
        'edit distance ' + bestDist + ' from a well-known name' };
    }
    return null;
  }

  /* ======================================================================
     Licences.

     SPDX identifiers, bucketed. The tables are deliberately short: an id the
     tables do not know lands in "unknown", which is the correct answer for a
     tool that has not read the licence text.
     ====================================================================== */
  function tableOf(names) {
    var t = bag();
    names.split(' ').forEach(function (n) { t[n.toUpperCase()] = true; });
    return t;
  }
  var LIC_PERMISSIVE = tableOf(
    'MIT MIT-0 ISC 0BSD BSD BSD-2-CLAUSE BSD-3-CLAUSE BSD-3-CLAUSE-CLEAR ' +
    'APACHE-2.0 APACHE-1.1 UNLICENSE CC0-1.0 ZLIB PYTHON-2.0 PSF-2.0 ' +
    'PYTHON-2.0.1 WTFPL BLUEOAK-1.0.0 ARTISTIC-2.0 BSL-1.0 POSTGRESQL ' +
    'X11 NCSA AFL-2.1 AFL-3.0 CC-BY-4.0 CC-BY-3.0 UPL-1.0 MPL-1.0');
  var LIC_WEAK = tableOf(
    'LGPL-2.0 LGPL-2.0-ONLY LGPL-2.0-OR-LATER LGPL-2.1 LGPL-2.1-ONLY ' +
    'LGPL-2.1-OR-LATER LGPL-3.0 LGPL-3.0-ONLY LGPL-3.0-OR-LATER MPL-2.0 ' +
    'EPL-1.0 EPL-2.0 CDDL-1.0 CDDL-1.1 MS-PL CPL-1.0 CECILL-C ' +
    'APACHE-2.0-WITH-LLVM-EXCEPTION');
  var LIC_STRONG = tableOf(
    'GPL-2.0 GPL-2.0-ONLY GPL-2.0-OR-LATER GPL-3.0 GPL-3.0-ONLY ' +
    'GPL-3.0-OR-LATER AGPL-3.0 AGPL-3.0-ONLY AGPL-3.0-OR-LATER SSPL-1.0 ' +
    'OSL-3.0 EUPL-1.2 EUPL-1.1 CC-BY-SA-4.0 CECILL-2.1 BUSL-1.1');

  var BUCKETS = ['permissive', 'weak', 'strong', 'unknown'];
  var BUCKET_LABEL = {
    permissive: 'permissive',
    weak: 'weak copyleft',
    strong: 'strong copyleft',
    unknown: 'unknown / not recorded'
  };

  function bucketOfId(id) {
    var k = String(id).toUpperCase().replace(/\s+/g, '');
    if (LIC_PERMISSIVE[k]) return 'permissive';
    if (LIC_WEAK[k]) return 'weak';
    if (LIC_STRONG[k]) return 'strong';
    // Family fallbacks for the versions and suffixes the tables miss.
    if (/^LGPL/.test(k)) return 'weak';
    if (/^(AGPL|SSPL|GPL)/.test(k)) return 'strong';
    if (/^(MPL|EPL|CDDL)/.test(k)) return 'weak';
    if (/^(MIT|ISC|BSD|APACHE|ZLIB|UNLICENSE|CC0)/.test(k)) return 'permissive';
    return 'unknown';
  }

  var RANK = { permissive: 1, weak: 2, strong: 3 };

  /* SPDX expressions. With OR the consumer picks, so the most permissive
     alternative is the one that binds; with AND every term binds, so the
     strictest wins. Getting this backwards is the classic way a licence
     report understates its own risk. */
  function licenceOf(raw) {
    var s = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!s) return { bucket: 'unknown', raw: '', why: 'no licence field in the lockfile' };
    if (/^unlicensed$/i.test(s)) {
      return { bucket: 'unknown', raw: s, proprietary: true,
               why: 'declared UNLICENSED — proprietary, no grant at all' };
    }
    if (/^see licen[sc]e in/i.test(s)) {
      return { bucket: 'unknown', raw: s, proprietary: true,
               why: 'points at a file this tool cannot read' };
    }
    var tokens = s.match(/[A-Za-z0-9.+-]+/g) || [];
    var ids = [], hasOr = false, hasAnd = false;
    tokens.forEach(function (t) {
      var u = t.toUpperCase();
      if (u === 'OR') { hasOr = true; return; }
      if (u === 'AND') { hasAnd = true; return; }
      if (u === 'WITH') return;
      ids.push(t);
    });
    if (!ids.length) return { bucket: 'unknown', raw: s, why: 'unparseable licence string' };

    var ranks = [], anyUnknown = false;
    ids.forEach(function (id) {
      var b = bucketOfId(id);
      if (b === 'unknown') { anyUnknown = true; return; }
      ranks.push(RANK[b]);
    });
    if (!ranks.length) return { bucket: 'unknown', raw: s, why: 'licence id not recognised' };

    var chosen;
    if (hasOr && !hasAnd) chosen = Math.min.apply(null, ranks);
    else chosen = Math.max.apply(null, ranks);
    var bucket = chosen === 1 ? 'permissive' : (chosen === 2 ? 'weak' : 'strong');
    return { bucket: bucket, raw: s, partial: anyUnknown, expression: hasOr || hasAnd };
  }

  /* npm writes either "license": "MIT" or, on much older packages,
     "licenses": [{ "type": "MIT" }]. Both appear in real lockfiles. */
  function licenceField(entry) {
    if (!isObj(entry)) return '';
    if (typeof entry.license === 'string') return entry.license;
    if (isObj(entry.license) && typeof entry.license.type === 'string') return entry.license.type;
    if (Array.isArray(entry.license)) {
      return entry.license.map(function (l) {
        return typeof l === 'string' ? l : (isObj(l) ? str(l.type) : '');
      }).filter(Boolean).join(' OR ');
    }
    if (Array.isArray(entry.licenses)) {
      return entry.licenses.map(function (l) {
        return typeof l === 'string' ? l : (isObj(l) ? str(l.type) : '');
      }).filter(Boolean).join(' OR ');
    }
    if (isObj(entry.licenses) && typeof entry.licenses.type === 'string') return entry.licenses.type;
    return '';
  }

  /* ======================================================================
     Version ranges. sev orders the "worst offenders" table: 4 is "whatever
     the registry serves today", 0 is an exact version.
     ====================================================================== */
  function npmRange(spec) {
    var s = String(spec === undefined || spec === null ? '' : spec).trim();
    if (!s || s === '*' || s === 'x' || s === 'X') {
      return { kind: 'any version', sev: 4, pinned: false };
    }
    if (/^latest$|^next$|^beta$|^canary$/i.test(s)) {
      return { kind: 'dist-tag "' + s + '"', sev: 4, pinned: false };
    }
    if (/^(https?:|git\+|git:|github:|gitlab:|bitbucket:|file:|link:|workspace:|portal:|npm:)/i.test(s)) {
      return { kind: 'not a registry range', sev: 2, pinned: false, other: true };
    }
    if (s.indexOf('||') >= 0) return { kind: 'union of ranges', sev: 3, pinned: false };
    if (/\s-\s/.test(s)) return { kind: 'hyphen range', sev: 3, pinned: false };
    if (s.charAt(0) === '^') return { kind: 'caret ^ (minor and patch float)', sev: 2, pinned: false };
    if (s.charAt(0) === '~') return { kind: 'tilde ~ (patch floats)', sev: 1, pinned: false };
    if (/^(>=|>|<=|<)/.test(s)) return { kind: 'open comparator', sev: 3, pinned: false };
    // "=1.2.3" and "v1.2.3" are both exact to npm — semver strips the leading
    // "v", and a range that was only exact without it read as unrecognised.
    if (/^[=v]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(s)) {
      return { kind: 'exact', sev: 0, pinned: true };
    }
    if (/^\d+(\.\d+)?([.][xX*])?$/.test(s)) {
      return { kind: 'partial version', sev: 3, pinned: false };
    }
    return { kind: 'unrecognised range', sev: 2, pinned: false };
  }

  function pypiRange(specs, url) {
    if (url) return { kind: 'direct URL or VCS reference', sev: 2, pinned: false, other: true };
    if (!specs.length) return { kind: 'no specifier at all', sev: 4, pinned: false };
    var ops = specs.map(function (s) { return s.op; });
    var exact = null;
    for (var i = 0; i < specs.length; i++) {
      if (specs[i].op === '==' || specs[i].op === '===') { exact = specs[i]; break; }
    }
    if (exact) {
      if (exact.version.indexOf('*') >= 0) {
        return { kind: 'wildcard == ' + exact.version, sev: 3, pinned: false };
      }
      return { kind: 'exact', sev: 0, pinned: true, version: exact.version };
    }
    if (ops.indexOf('~=') >= 0) return { kind: 'compatible release ~=', sev: 2, pinned: false };
    if (ops.indexOf('>=') >= 0 || ops.indexOf('>') >= 0) {
      return { kind: 'lower bound only', sev: 3, pinned: false };
    }
    return { kind: 'bounded but not pinned', sev: 3, pinned: false };
  }

  /* ======================================================================
     purl and hash helpers for the CycloneDX export.
     ====================================================================== */
  function purlNpm(name, version) {
    var ns = '', nm = name;
    if (name.charAt(0) === '@') {
      var slash = name.indexOf('/');
      if (slash > 0) { ns = name.slice(0, slash); nm = name.slice(slash + 1); }
    }
    var base = 'pkg:npm/' + (ns ? encodeURIComponent(ns) + '/' : '') + encodeURIComponent(nm);
    return version ? base + '@' + encodeURIComponent(version) : base;
  }

  /* PEP 503 normalisation, which is what a pypi purl is supposed to carry. */
  function normPypi(name) {
    return String(name).toLowerCase().replace(/[-_.]+/g, '-');
  }
  function purlPypi(name, version) {
    var base = 'pkg:pypi/' + encodeURIComponent(normPypi(name));
    return version ? base + '@' + encodeURIComponent(version) : base;
  }

  var ALG = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1', md5: 'MD5' };
  var ALG_HEX = { 'SHA-512': 128, 'SHA-384': 96, 'SHA-256': 64, 'SHA-1': 40, 'MD5': 32 };

  /* CycloneDX pins hashes.content to an exact length per algorithm, so a
     digest of the wrong size is not a slightly-off SBOM, it is one a
     validator rejects. A lockfile with "sha512-" and ten bytes of base64
     after it went straight through as a 20-character SHA-512. Anything that
     does not measure up is dropped, which is the same rule the rest of the
     export follows: omit rather than invent. */
  function checkedHash(alg, hex) {
    if (!alg || !ALG_HEX[alg]) return null;
    if (hex.length !== ALG_HEX[alg]) return null;
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    return { alg: alg, content: hex };
  }

  /* npm integrity is "sha512-<base64>", occasionally several separated by
     spaces. CycloneDX wants hex, so the base64 is decoded here rather than
     copied across in a form the schema does not accept. */
  function integrityHash(value) {
    var v = str(value).trim();
    if (!v) return null;
    var first = v.split(/\s+/)[0];
    var dash = first.indexOf('-');
    if (dash < 1) return null;
    var alg = ALG[first.slice(0, dash).toLowerCase()];
    if (!alg) return null;
    var bin;
    try { bin = atob(first.slice(dash + 1)); } catch (err) { return null; }
    var hex = '';
    for (var i = 0; i < bin.length; i++) {
      var b = bin.charCodeAt(i) & 0xff;
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    return checkedHash(alg, hex);
  }

  function uuid4() {
    var b = new Uint8Array(16), i;
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = LabTool.toHex(b);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
           h.slice(16, 20) + '-' + h.slice(20);
  }

  /* ======================================================================
     Shape detection. Being wrong about the shape makes every number below it
     wrong, so this refuses to guess: a file it does not recognise is named
     and rejected rather than parsed as something it is not.
     ====================================================================== */
  /* The formats this tool refuses by name. Sniffed on a bounded head rather
     than the whole file: the markers are all near the top of a real lockfile,
     and running a regex over 24 MB to find out it is not yarn is wasteful.

     The yarn key pattern is written as @?[^"@\n]+ and not [^"]+ on purpose.
     The lazy version could not tell where the name ended and the range began,
     so on a line like "@@@@@…  it tried every split. 40 kB of that took two
     seconds here; a 24 MB paste would have hung the tab for the rest of the
     afternoon. Excluding '@' from the first run fixes the split in place and
     makes the match linear, and it still reads scoped keys because of the
     optional leading @. */
  function sniffOther(head) {
    if (/^#\s*yarn lockfile/m.test(head) ||
        /^"@?[^"@\n]+@[^"\n]*":[ \t]*$/m.test(head) ||
        /^ {2}version\s+"/m.test(head)) {
      return 'yarn';
    }
    if (/^lockfileVersion:/m.test(head) && /^(packages|importers):/m.test(head)) return 'pnpm';
    if (/^\[\[package\]\]/m.test(head)) return 'poetry';
    return null;
  }

  function detect(text) {
    var t = text.replace(/^﻿/, '').replace(/^\s+/, '');
    if (!t) return { shape: 'empty' };
    var head = t.length > MAX_SNIFF ? t.slice(0, MAX_SNIFF) : t;

    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      /* A poetry.lock opens "[[package]]", which is a '[' and so lands here.
         Before the sniff moved above the parse it was reported as broken JSON
         — technically true and useless, when the tool's whole promise about
         these formats is that it names them. JSON cannot start with
         "[[package]]" or a bare yarn key, so testing first costs nothing. */
      var other = t.charAt(0) === '{' ? null : sniffOther(head);
      if (other) return { shape: other };

      var json;
      try { json = JSON.parse(t); }
      catch (err) {
        // A file that opens like JSON, will not parse, and carries another
        // format's markers is that other format, not a corrupt lockfile.
        var alt = sniffOther(head);
        if (alt) return { shape: alt };
        return { shape: 'bad-json', message: (err && err.message) || String(err) };
      }
      if (!isObj(json)) return { shape: 'unknown-json' };

      if (json.bomFormat === 'CycloneDX' || json.spdxVersion) {
        return { shape: 'already-sbom', json: json };
      }
      if (isObj(json._meta) && (isObj(json['default']) || isObj(json.develop))) {
        return { shape: 'pipfile-lock' };
      }
      var lv = typeof json.lockfileVersion === 'number' ? json.lockfileVersion : null;
      if (isObj(json.packages)) {
        return { shape: 'npm-packages', json: json, version: lv };
      }
      if (lv === 1 && isObj(json.dependencies)) return { shape: 'npm1', json: json, version: 1 };
      if (isObj(json.dependencies)) {
        // A package.json and a v1 lockfile both have "dependencies". In the
        // manifest the values are range STRINGS; in the lockfile they are
        // objects with a resolved version. That distinction is the only
        // reliable one when lockfileVersion is missing.
        var names = Object.keys(json.dependencies);
        var objectValues = 0;
        for (var i = 0; i < names.length && i < 40; i++) {
          if (isObj(json.dependencies[names[i]])) objectValues++;
        }
        if (objectValues === 0 && names.length) return { shape: 'manifest', json: json };
        return { shape: 'npm1', json: json, version: lv };
      }
      if (isObj(json.devDependencies) || typeof json.name === 'string') {
        return { shape: 'manifest', json: json };
      }
      return { shape: 'unknown-json' };
    }

    var sniffed = sniffOther(head);
    if (sniffed) return { shape: sniffed };

    return { shape: 'requirements', text: t };
  }

  /* ======================================================================
     npm v2 / v3 — the "packages" map.
     ====================================================================== */
  function parsePackagesMap(json, declaredVersion) {
    var pk = json.packages;
    var keys = Object.keys(pk);
    var root = isObj(pk['']) ? pk[''] : null;

    var model = {
      ecosystem: 'npm',
      shape: 'npm-packages',
      shapeLabel: 'npm lockfile v' + (declaredVersion || '2 or 3') + ' (packages map)',
      evidence: [],
      rootName: root ? str(root.name) || str(json.name) : str(json.name),
      rootVersion: root ? str(root.version) || str(json.version) : str(json.version),
      installScripts: 'available',
      licences: 'available',
      directKnown: !!root,
      entries: [], byKey: bag(), notes: [],
      counts: {}, declared: [], fanIn: bag()
    };

    model.evidence.push('a "packages" map with ' + plural(keys.length, 'entry'));
    if (declaredVersion) model.evidence.push('"lockfileVersion": ' + declaredVersion);
    else model.evidence.push('no "lockfileVersion" field, which npm always writes — treated as v3-shaped');
    if (isObj(json.dependencies) && declaredVersion === 2) {
      model.evidence.push('a mirrored "dependencies" tree, which is what makes it v2 rather than v3');
    }
    if (!root) {
      model.notes.push('There is no "" root entry, so the direct-versus-transitive split below is not available.');
    }

    var links = 0, workspaces = 0, devOnly = 0, optional = 0;

    keys.forEach(function (key) {
      var e = pk[key];
      if (!isObj(e)) return;
      if (key === '') return;

      var isNm = key.indexOf('node_modules/') >= 0;
      var name = isNm ? key.slice(key.lastIndexOf('node_modules/') + 13) : (str(e.name) || key);
      var depth = key.split('node_modules/').length - 1;

      if (e.link === true) { links++; return; }
      if (!isNm) { workspaces++; return; }

      var lic = licenceOf(licenceField(e));
      var integrity = integrityHash(e.integrity);
      var rec = {
        key: key, name: name, version: str(e.version), depth: depth,
        dev: e.dev === true || e.devOptional === true,
        optional: e.optional === true,
        hasInstallScript: e.hasInstallScript === true,
        licence: lic,
        integrity: integrity,
        resolved: str(e.resolved),
        deps: isObj(e.dependencies) ? e.dependencies : {},
        optDeps: isObj(e.optionalDependencies) ? e.optionalDependencies : {},
        peerDeps: isObj(e.peerDependencies) ? e.peerDependencies : {},
        ref: purlNpm(name, str(e.version))
      };
      if (rec.dev) devOnly++;
      if (rec.optional) optional++;
      model.entries.push(rec);
      model.byKey[key] = rec;
    });

    /* Direct set, straight from the root manifest as the lockfile recorded it. */
    var direct = bag(), dcount = { dependencies: 0, devDependencies: 0, optionalDependencies: 0, peerDependencies: 0 };
    if (root) {
      ['dependencies', 'devDependencies', 'optionalDependencies'].forEach(function (field) {
        keysOf(root[field]).forEach(function (n) {
          direct[n] = true;
          dcount[field]++;
          var range = npmRange(root[field][n]);
          model.declared.push({ from: 'root', field: field, name: n, spec: String(root[field][n]), range: range });
        });
      });
      dcount.peerDependencies = keysOf(root.peerDependencies).length;
    }
    model.direct = direct;
    model.directCounts = dcount;

    /* Transitive declared ranges, and the reverse-dependency count. Resolution
       follows node's own rule — look in the dependent's own node_modules, then
       walk up — so an edge points at the copy that would actually be loaded. */
    model.entries.forEach(function (rec) {
      var seenHere = bag();
      ['deps', 'optDeps'].forEach(function (field) {
        keysOf(rec[field]).forEach(function (n) {
          if (!seenHere[n]) { seenHere[n] = true; model.fanIn[n] = (model.fanIn[n] || 0) + 1; }
          model.declared.push({ from: 'transitive', field: field, name: n,
                                spec: String(rec[field][n]), range: npmRange(rec[field][n]) });
          var target = resolveNpmKey(model.byKey, rec.key, n);
          if (target) {
            if (!rec.edges) rec.edges = [];
            if (rec.edges.indexOf(target.ref) < 0) rec.edges.push(target.ref);
          }
        });
      });
    });

    /* The dedupe here was Array.indexOf against the list being built, which is
       quadratic in the number of direct dependencies. It did not show on the
       worked examples — eleven names — and it was 28 seconds on a 20,000
       package lockfile, which is the size this tool exists for. A seen-set
       makes it linear; the same file now finishes in about a second and a
       half on this machine. */
    if (root) {
      model.rootEdges = [];
      var seenRootEdge = bag();
      Object.keys(direct).forEach(function (n) {
        var target = resolveNpmKey(model.byKey, '', n);
        if (target && !seenRootEdge[target.ref]) {
          seenRootEdge[target.ref] = true;
          model.rootEdges.push(target.ref);
        }
      });
    }

    /* Distinct names, duplicate versions, depths. */
    var byName = bag();
    model.entries.forEach(function (rec) {
      if (!byName[rec.name]) byName[rec.name] = bag();
      byName[rec.name][rec.version || '(no version)'] = true;
    });
    var distinct = Object.keys(byName);
    var dupes = distinct.filter(function (n) { return Object.keys(byName[n]).length > 1; });

    var directPresent = 0, missing = [];
    Object.keys(direct).forEach(function (n) {
      if (byName[n]) directPresent++; else missing.push(n);
    });

    var physical = 0;
    model.entries.forEach(function (r) { if (r.depth > physical) physical = r.depth; });

    model.byName = byName;
    model.counts = {
      entries: model.entries.length,
      distinct: distinct.length,
      duplicates: dupes.length,
      dupeNames: dupes,
      direct: directPresent,
      missingDirect: missing,
      transitive: Math.max(0, distinct.length - directPresent),
      links: links, workspaces: workspaces, devOnly: devOnly, optional: optional
    };
    model.physicalDepth = physical;
    model.logicalDepth = logicalDepth(model, Object.keys(direct));
    return model;
  }

  /* Node's resolution algorithm, which is the only correct way to say which
     copy of a package an edge points at when several versions are installed. */
  function resolveNpmKey(byKey, fromKey, name) {
    var base = fromKey;
    for (var guard = 0; guard < 64; guard++) {
      var cand = (base ? base + '/' : '') + 'node_modules/' + name;
      if (byKey[cand]) return byKey[cand];
      if (base === '') return null;
      var cut = base.lastIndexOf('/node_modules/');
      base = cut < 0 ? '' : base.slice(0, cut);
    }
    return null;
  }

  /* Breadth-first over names, from the direct set. This is the depth people
     mean when they ask "how deep does this go" — how many hops from something
     we chose to something we did not. It is not the same as the node_modules
     nesting depth, which describes disk layout after npm's deduping. */
  function logicalDepth(model, roots) {
    var seen = bag(), frontier = [], depth = 0, i;
    roots.forEach(function (n) { if (!seen[n]) { seen[n] = true; frontier.push(n); } });
    if (!frontier.length) return null;
    var byName = bag();
    model.entries.forEach(function (r) {
      if (!byName[r.name]) byName[r.name] = [];
      byName[r.name].push(r);
    });
    var guard = 0;
    while (frontier.length && guard++ < 512) {
      var next = [];
      for (i = 0; i < frontier.length; i++) {
        var recs = byName[frontier[i]] || [];
        for (var j = 0; j < recs.length; j++) {
          var edges = keysOf(recs[j].deps).concat(keysOf(recs[j].optDeps));
          for (var k = 0; k < edges.length; k++) {
            if (!seen[edges[k]]) { seen[edges[k]] = true; next.push(edges[k]); }
          }
        }
      }
      if (!next.length) break;
      depth++;
      frontier = next;
    }
    return depth;
  }

  /* ======================================================================
     npm v1 — the nested "dependencies" tree.

     Three facts a v1 lockfile simply does not carry, and the report says so
     in each place rather than printing a zero: which packages the root
     declared, whether a package has an install script, and its licence.
     ====================================================================== */
  function parseV1(json) {
    var model = {
      ecosystem: 'npm',
      shape: 'npm1',
      shapeLabel: 'npm lockfile v1 (nested dependencies tree)',
      evidence: [],
      rootName: str(json.name), rootVersion: str(json.version),
      installScripts: 'unavailable',
      licences: 'unavailable',
      directKnown: false,
      entries: [], notes: [], counts: {}, declared: [], fanIn: bag()
    };
    model.evidence.push('a nested "dependencies" tree whose values carry "version" and "resolved"');
    model.evidence.push(typeof json.lockfileVersion === 'number'
      ? '"lockfileVersion": ' + json.lockfileVersion
      : 'no "lockfileVersion" field at all, which is how npm 5 and 6 wrote it');

    var nodes = [], rootChildren = bag(), truncated = false, tooDeep = false, physical = 0;

    /* walk() is recursive, and a hostile file can be nested as deep as it
       likes. Fifteen thousand levels of nested "dependencies" objects overflowed
       JS stack — caught upstream, so the pane said "could not finish reading
       that file" rather than going blank, but that is a worse answer than the
       truth. A real npm 6 tree nests tens of levels, not hundreds, so cutting
       at MAX_DEPTH loses nothing real and turns a stack overflow into a
       counted, reported limit. */
    function walk(depsObj, parent, depth) {
      if (depth > MAX_DEPTH) { tooDeep = true; return; }
      Object.keys(depsObj).forEach(function (name) {
        if (nodes.length >= MAX_NODES) { truncated = true; return; }
        var e = depsObj[name];
        if (!isObj(e)) return;
        var node = {
          name: name, version: str(e.version), depth: depth, parent: parent,
          dev: e.dev === true, optional: e.optional === true,
          requires: isObj(e.requires) ? e.requires : {},
          integrity: integrityHash(e.integrity),
          resolved: str(e.resolved),
          licence: licenceOf(licenceField(e)),
          hasInstallScript: null,
          children: bag(),
          ref: purlNpm(name, str(e.version))
        };
        if (depth > physical) physical = depth;
        if (parent) parent.children[name] = node; else rootChildren[name] = node;
        nodes.push(node);
        model.entries.push(node);
        if (isObj(e.dependencies)) walk(e.dependencies, node, depth + 1);
      });
    }
    walk(json.dependencies, null, 1);
    if (truncated) {
      model.notes.push('The tree was cut off at ' + num(MAX_NODES) +
        ' entries so the tab stays responsive. Counts below are of what was read.');
    }
    if (tooDeep) {
      model.notes.push('The tree nests deeper than ' + num(MAX_DEPTH) + ' levels, which no' +
        ' real npm tree does. Everything below that level was not read.');
    }

    /* The requires graph. A top-level entry that nothing else requires can
       only have come from the root manifest; one that something else requires
       may be direct as well, and a v1 lockfile does not record which. */
    var required = bag();
    nodes.forEach(function (n) {
      var seenHere = bag();
      Object.keys(n.requires).forEach(function (dep) {
        required[dep] = true;
        if (!seenHere[dep]) { seenHere[dep] = true; model.fanIn[dep] = (model.fanIn[dep] || 0) + 1; }
        model.declared.push({ from: 'transitive', field: 'requires', name: dep,
                              spec: String(n.requires[dep]), range: npmRange(n.requires[dep]) });
        var target = resolveV1(n, rootChildren, dep);
        if (target) {
          if (!n.edges) n.edges = [];
          if (n.edges.indexOf(target.ref) < 0) n.edges.push(target.ref);
        }
      });
    });

    var topNames = Object.keys(rootChildren);
    var certain = topNames.filter(function (n) { return !required[n]; });
    var ambiguous = topNames.length - certain.length;

    var byName = bag();
    model.entries.forEach(function (rec) {
      if (!byName[rec.name]) byName[rec.name] = bag();
      byName[rec.name][rec.version || '(no version)'] = true;
    });
    var distinct = Object.keys(byName);
    var dupes = distinct.filter(function (n) { return Object.keys(byName[n]).length > 1; });

    model.byName = byName;
    model.rootChildren = rootChildren;
    model.counts = {
      entries: model.entries.length,
      distinct: distinct.length,
      duplicates: dupes.length,
      dupeNames: dupes,
      topLevel: topNames.length,
      certainDirect: certain.length,
      ambiguousDirect: ambiguous,
      devOnly: model.entries.filter(function (n) { return n.dev; }).length,
      optional: model.entries.filter(function (n) { return n.optional; }).length
    };
    model.direct = bag();
    certain.forEach(function (n) { model.direct[n] = true; });
    model.physicalDepth = physical;

    /* Depth over the requires graph, from the entries that are certainly
       direct. With v1 that start set is a lower bound, so the depth is too. */
    var byNameNodes = bag();
    model.entries.forEach(function (r) {
      if (!byNameNodes[r.name]) byNameNodes[r.name] = [];
      byNameNodes[r.name].push(r);
    });
    var seen = bag(), frontier = certain.slice(), depth = 0, guard = 0;
    frontier.forEach(function (n) { seen[n] = true; });
    while (frontier.length && guard++ < 512) {
      var next = [];
      frontier.forEach(function (n) {
        (byNameNodes[n] || []).forEach(function (rec) {
          Object.keys(rec.requires).forEach(function (d) {
            if (!seen[d]) { seen[d] = true; next.push(d); }
          });
        });
      });
      if (!next.length) break;
      depth++; frontier = next;
    }
    model.logicalDepth = certain.length ? depth : null;
    model.rootEdges = certain.map(function (n) {
      return rootChildren[n] ? rootChildren[n].ref : null;
    }).filter(Boolean);
    return model;
  }

  function resolveV1(node, rootChildren, name) {
    var cur = node;
    for (var guard = 0; guard < 64 && cur; guard++) {
      if (cur.children[name]) return cur.children[name];
      cur = cur.parent;
    }
    return rootChildren[name] || null;
  }

  /* ======================================================================
     package.json. Not a lockfile, and the report leads with that, but the
     declared ranges and the names are still worth checking.
     ====================================================================== */
  function parseManifest(json) {
    var model = {
      ecosystem: 'npm', shape: 'manifest',
      shapeLabel: 'package.json manifest (NOT a lockfile)',
      evidence: ['"dependencies" whose values are range strings rather than resolved objects'],
      rootName: str(json.name), rootVersion: str(json.version),
      installScripts: 'unavailable', licences: 'unavailable', directKnown: true,
      entries: [], notes: [], counts: {}, declared: [], fanIn: bag(),
      physicalDepth: null, logicalDepth: null
    };
    var direct = bag(), dcount = { dependencies: 0, devDependencies: 0, optionalDependencies: 0, peerDependencies: 0 };
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].forEach(function (field) {
      keysOf(json[field]).forEach(function (n) {
        dcount[field]++;
        if (field !== 'peerDependencies') direct[n] = true;
        model.declared.push({ from: 'root', field: field, name: n,
                              spec: String(json[field][n]), range: npmRange(json[field][n]) });
        model.entries.push({
          name: n, version: '', depth: 1, dev: field === 'devDependencies',
          optional: field === 'optionalDependencies', hasInstallScript: null,
          licence: licenceOf(''), integrity: null, resolved: '',
          deps: {}, optDeps: {}, ref: purlNpm(n, ''), declaredRange: String(json[field][n])
        });
      });
    });
    model.direct = direct;
    model.directCounts = dcount;

    /* The name index the lookalike check reads. It was missing here at first,
       which silently scanned zero names and reported a clean manifest — the
       exact failure this tool is supposed to refuse to make. */
    var byName = bag();
    model.entries.forEach(function (rec) {
      if (!byName[rec.name]) byName[rec.name] = bag();
      byName[rec.name][rec.declaredRange || '(unpinned)'] = true;
    });
    model.byName = byName;

    model.counts = {
      entries: model.entries.length, distinct: Object.keys(byName).length,
      duplicates: 0, dupeNames: [], direct: Object.keys(direct).length,
      missingDirect: [], transitive: 0, links: 0, workspaces: 0,
      devOnly: dcount.devDependencies, optional: dcount.optionalDependencies
    };
    var scripts = keysOf(json.scripts).filter(function (k) {
      return k === 'preinstall' || k === 'install' || k === 'postinstall' || k === 'prepare';
    });
    model.ownScripts = scripts;
    model.notes.push('A manifest lists what you asked for. It cannot tell you what');
    model.notes.push('you got — that is the lockfile’s job, and the whole transitive');
    model.notes.push('tree is missing here.');
    return model;
  }

  /* ======================================================================
     requirements.txt, including pip-compile output.

     A plain requirements.txt is a flat list of things somebody typed. It has
     no licence field, no install-script flag and no record of who required
     what, so most of this report is a list of things that cannot be computed.
     pip-compile output is different: its "# via" comments carry the real
     dependency edges, and the tool uses them when they are there.
     ====================================================================== */
  function parseRequirements(text) {
    var model = {
      ecosystem: 'pypi', shape: 'requirements',
      shapeLabel: 'requirements.txt',
      evidence: [],
      rootName: '', rootVersion: '',
      installScripts: 'unavailable', licences: 'unavailable',
      directKnown: false,
      entries: [], notes: [], counts: {}, declared: [], fanIn: bag(),
      options: [], includes: [], badLines: [], badCount: 0
    };

    /* Continuation lines first, so a requirement split over three physical
       lines with trailing backslashes is parsed as one. */
    var raw = text.split(/\r?\n/);
    var logical = [], buffer = '', i;
    for (i = 0; i < raw.length; i++) {
      var line = raw[i];
      if (/\\\s*$/.test(line)) { buffer += line.replace(/\\\s*$/, ' '); continue; }
      logical.push(buffer + line);
      buffer = '';
    }
    if (buffer) logical.push(buffer);

    var last = null, inVia = false, compiled = false;

    for (i = 0; i < logical.length; i++) {
      var text0 = logical[i];
      var t = text0.trim();
      if (!t) { last = null; inVia = false; continue; }

      if (t.charAt(0) === '#') {
        var body = t.replace(/^#+\s*/, '');
        if (/^via\b/i.test(body)) {
          compiled = true; inVia = true;
          var rest = body.replace(/^via\b\s*/i, '').trim();
          if (rest && last) addVia(last, rest);
          continue;
        }
        if (inVia && last) { addVia(last, body.trim()); continue; }
        continue;
      }
      inVia = false;

      if (t.charAt(0) === '-') {
        if (/^(-r|--requirement|-c|--constraint)\b/.test(t)) model.includes.push(t);
        else model.options.push(t);
        last = null;
        continue;
      }

      var rec = parseReqLine(t, i + 1);
      if (!rec) {
        // Counted always, kept only up to MAX_BAD. Dropping a 24 MB file of
        // junk lines in here built a couple of hundred thousand objects to
        // print five of them.
        model.badCount++;
        if (model.badLines.length < MAX_BAD) model.badLines.push({ line: i + 1, text: clip(t, 70) });
        last = null;
        continue;
      }
      model.entries.push(rec);
      last = rec;
    }

    function addVia(rec, token) {
      String(token).split(/[,\s]+/).forEach(function (v) {
        var s = v.trim();
        if (!s || s === '#') return;
        rec.via.push(s);
      });
    }

    model.compiled = compiled;

    /* requirements.txt is the fallback shape: anything that is not JSON and
       carries no other format's markers lands here, which includes prose, a
       CSV and a JPEG. Saying "shape detected: requirements.txt" about a file
       where not one line parsed is the same kind of lie as printing zero
       install scripts for a v1 lockfile, so it does not say it. */
    model.notRequirements = model.entries.length === 0 && model.badCount > 0;
    model.shapeLabel = model.notRequirements
      ? 'unrecognised text — not a lockfile this tool reads'
      : (compiled ? 'requirements.txt written by pip-compile'
                  : 'requirements.txt (hand-written or frozen)');
    model.evidence.push('no JSON, no yarn or pnpm markers, and ' +
      plural(model.entries.length, 'requirement line'));
    if (compiled) {
      model.evidence.push('"# via" annotations, which pip-compile writes and nothing else does');
      model.directKnown = true;
    }

    /* Direct versus transitive, only where pip-compile recorded it. */
    var direct = bag(), transitive = 0;
    model.entries.forEach(function (rec) {
      var isDirect = false;
      rec.via.forEach(function (v) {
        if (/^-r/.test(v) || /^-e/.test(v) || /\.in$/.test(v) || /\.txt$/.test(v)) { isDirect = true; return; }
        model.fanIn[rec.name] = (model.fanIn[rec.name] || 0) + 1;
        if (!rec.parents) rec.parents = [];
        rec.parents.push(v);
      });
      if (!compiled) isDirect = false;
      rec.direct = isDirect;
      if (isDirect) direct[rec.name] = true;
      else if (compiled) transitive++;
      model.declared.push({ from: 'root', field: 'requirements', name: rec.name,
                            spec: rec.specText, range: rec.range });
    });
    model.direct = direct;

    var byName = bag();
    model.entries.forEach(function (rec) {
      if (!byName[rec.name]) byName[rec.name] = bag();
      byName[rec.name][rec.version || '(unpinned)'] = true;
    });
    var distinct = Object.keys(byName);
    model.byName = byName;
    model.counts = {
      entries: model.entries.length,
      distinct: distinct.length,
      duplicates: distinct.filter(function (n) { return Object.keys(byName[n]).length > 1; }).length,
      dupeNames: distinct.filter(function (n) { return Object.keys(byName[n]).length > 1; }),
      direct: Object.keys(direct).length,
      transitive: transitive,
      missingDirect: [], links: 0, workspaces: 0,
      devOnly: 0, optional: 0
    };
    model.physicalDepth = null;

    /* Depth over the "via" edges, when they exist. */
    if (compiled) {
      /* And the same edges into the model the SBOM is built from. They were
         computed here, used for the depth number, and then thrown away: the
         export said "dependency edges: none — not derivable from this shape"
         about a file it had just walked two sections earlier. A "# via flask"
         comment is flask depending on this line; the arrow points from the
         parent, so the edge is recorded on the parent's record. Matched under
         PEP 503 normalisation, because pip-compile writes the canonical name
         in the comment and the requirement line may be spelled differently. */
      var byNorm = bag();
      model.entries.forEach(function (rec) {
        var k = normPypi(rec.name);
        if (!byNorm[k]) byNorm[k] = rec;
      });
      model.entries.forEach(function (rec) {
        (rec.parents || []).forEach(function (p) {
          var parent = byNorm[normPypi(p)];
          if (!parent || parent === rec || !rec.ref) return;
          if (!parent.edges) parent.edges = [];
          if (parent.edges.indexOf(rec.ref) < 0) parent.edges.push(rec.ref);
        });
      });

      var kids = bag();
      model.entries.forEach(function (rec) {
        (rec.parents || []).forEach(function (p) {
          var k = normPypi(p);
          if (!kids[k]) kids[k] = [];
          kids[k].push(normPypi(rec.name));
        });
      });
      var seen = bag(), frontier = Object.keys(direct).map(normPypi), depth = 0, guard = 0;
      frontier.forEach(function (n) { seen[n] = true; });
      while (frontier.length && guard++ < 256) {
        var next = [];
        frontier.forEach(function (n) {
          (kids[n] || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; next.push(c); } });
        });
        if (!next.length) break;
        depth++; frontier = next;
      }
      model.logicalDepth = Object.keys(direct).length ? depth : null;
    } else {
      model.logicalDepth = null;
    }
    return model;
  }

  var REQ_NAME = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/;

  function parseReqLine(line, lineNo) {
    // A trailing comment needs whitespace before the '#'; "#egg=name" inside a
    // VCS URL has none, and stripping it would throw the package name away.
    var work = line.replace(/\s+#.*$/, '').trim();
    if (!work) return null;

    var hashes = [];
    work = work.replace(/--hash=([A-Za-z0-9]+):([A-Fa-f0-9]+)/g, function (all, alg, hex) {
      // Same length rule as npm integrity: a --hash of the wrong size would
      // travel into the SBOM and fail validation there instead of here.
      var h = checkedHash(ALG[alg.toLowerCase()], hex.toLowerCase());
      if (h) hashes.push(h);
      return ' ';
    }).trim();

    var marker = '';
    var semi = work.indexOf(';');
    if (semi >= 0) { marker = work.slice(semi + 1).trim(); work = work.slice(0, semi).trim(); }

    var m = REQ_NAME.exec(work);
    if (!m) return null;
    var name = m[1];
    var extras = m[2] ? m[2].slice(1, -1).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var rest = (m[3] || '').trim();

    var url = '';
    if (rest.charAt(0) === '@') { url = rest.slice(1).trim(); rest = ''; }
    else if (/^(https?:|git\+|file:)/i.test(rest)) { url = rest; rest = ''; }

    var specs = [];
    if (rest) {
      var parts = rest.split(',');
      for (var i = 0; i < parts.length; i++) {
        var sm = /^\s*(===|==|!=|<=|>=|~=|<|>)\s*(.+?)\s*$/.exec(parts[i]);
        if (sm) specs.push({ op: sm[1], version: sm[2] });
        else if (parts[i].trim()) return null;
      }
    }

    var range = pypiRange(specs, url);
    return {
      name: name, version: range.pinned ? range.version : '',
      specs: specs, specText: rest || (url ? '@ ' + clip(url, 40) : '(none)'),
      extras: extras, marker: marker, url: url, hashes: hashes,
      via: [], line: lineNo, range: range, depth: 1,
      licence: licenceOf(''), hasInstallScript: null,
      integrity: hashes.length ? hashes[0] : null,
      ref: purlPypi(name, range.pinned ? range.version : ''),
      dev: false, optional: false, resolved: url
    };
  }

  /* ======================================================================
     Report
     ====================================================================== */
  var current = null;   // the last successfully parsed model

  function analyse(text, label) {
    current = null;
    var started = Date.now();
    R.clear();
    R.heading(label || 'pasted input');
    R.row('size', LabTool.humanBytes(text.length) + ' of text');

    var d = detect(text);

    if (d.shape === 'empty') {
      R.warn('Nothing to read. Paste a package-lock.json or a requirements.txt,');
      R.warn('or drop the file into the panel on the left.');
      return;
    }
    if (d.shape === 'bad-json') {
      R.rule();
      R.err('This starts like JSON but will not parse.');
      R.dim(clip(d.message, 120));
      R.line('');
      R.dim('A lockfile truncated by a copy-paste is the usual cause. Drop the');
      R.dim('file itself rather than pasting it and the whole thing arrives.');
      return;
    }
    if (d.shape === 'yarn' || d.shape === 'pnpm' || d.shape === 'poetry' || d.shape === 'pipfile-lock') {
      var names = { yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml', poetry: 'poetry.lock', 'pipfile-lock': 'Pipfile.lock' };
      R.rule();
      R.warn('That looks like a ' + names[d.shape] + ', which this tool does not read.');
      R.line('');
      R.dim('It is not a small gap that a regular expression would close: each of');
      R.dim('those formats needs its own parser, and half-parsing a lockfile is');
      R.dim('worse than refusing it, because the counts would look plausible.');
      R.line('');
      R.dim('Handled here: npm package-lock.json v1, v2 and v3, package.json,');
      R.dim('and requirements.txt including pip-compile output.');
      return;
    }
    if (d.shape === 'already-sbom') {
      R.rule();
      R.warn('That is already an SBOM. This tool produces one, it does not read one.');
      R.dim('Feed it the lockfile the SBOM was generated from.');
      return;
    }
    if (d.shape === 'unknown-json') {
      R.rule();
      R.err('That is valid JSON, but not a shape this tool recognises.');
      R.dim('It expects a package-lock.json (any of v1, v2, v3) or a package.json.');
      return;
    }

    var model;
    try {
      if (d.shape === 'npm-packages') model = parsePackagesMap(d.json, d.version);
      else if (d.shape === 'npm1') model = parseV1(d.json);
      else if (d.shape === 'manifest') model = parseManifest(d.json);
      else model = parseRequirements(d.text);
    } catch (err) {
      R.rule();
      R.err('Could not finish reading that file.');
      R.dim('Details: ' + ((err && err.message) || String(err)));
      R.dim('Nothing was uploaded and nothing else on the page is affected.');
      return;
    }

    if (model.notRequirements) {
      var howMany = model.badCount === 1
        ? 'its single line does not parse'
        : 'not one of its ' + num(model.badCount) + ' lines parses';
      R.rule();
      R.err('Not a file this tool reads.');
      R.dim('It is not JSON, and it carries no yarn, pnpm or poetry marker, so the');
      R.dim('last thing left to try was requirements.txt — and ' + howMany);
      R.dim('as a requirement. Rather than print a report full of zeroes under the');
      R.dim('heading "requirements.txt", here is what did not fit:');
      model.badLines.slice(0, 5).forEach(function (b) { R.dim('  line ' + b.line + ': ' + b.text); });
      R.line('');
      R.dim('Handled: npm package-lock.json v1, v2 and v3, package.json, and');
      R.dim('requirements.txt including pip-compile output.');
      return;
    }

    model.sourceLabel = label || 'pasted input';
    model.started = started;
    current = model;

    /* The parse above is guarded and so is this. Everything below reads a
       model this file built, so a throw here is a bug rather than bad input —
       but a bug that leaves half a report on screen with no explanation is the
       one failure mode this pane must not have. */
    try {
      render(model);
    } catch (err) {
      R.line('');
      R.rule();
      R.err('The report stopped part way through. That is a fault in this tool,');
      R.err('not in your file.');
      R.dim('Details: ' + ((err && err.message) || String(err)));
      R.dim('Everything above this line was computed normally. Nothing was');
      R.dim('uploaded, and the Report a problem link below goes to me.');
    }
  }

  function render(m) {
    R.row('shape detected', m.shapeLabel, m.shape === 'manifest' ? 't-warn' : 't-ok');
    m.evidence.forEach(function (e, i) { R.row(i === 0 ? 'detected from' : '', e); });
    if (m.rootName) R.row('root package', m.rootName + (m.rootVersion ? '@' + m.rootVersion : ''));
    m.notes.forEach(function (n) { R.warn(n); });

    sectionInventory(m);
    sectionInstallScripts(m);
    sectionLookalikes(m);
    sectionLicences(m);
    sectionRanges(m);
    sectionDepth(m);
    sectionLimits(m);
  }

  function sectionInventory(m) {
    var c = m.counts;
    R.rule();
    R.heading('INVENTORY');
    if (m.shape === 'npm-packages') {
      R.row('node_modules entries', num(c.entries));
      R.row('distinct packages', num(c.distinct));
      if (m.directKnown) {
        R.row('direct (root declared)', num(c.direct), 't-info');
        R.row('  dependencies', num(m.directCounts.dependencies));
        R.row('  devDependencies', num(m.directCounts.devDependencies));
        R.row('  optionalDependencies', num(m.directCounts.optionalDependencies));
        if (m.directCounts.peerDependencies) {
          R.row('  peerDependencies', num(m.directCounts.peerDependencies) + ' (not counted as direct)');
        }
        R.row('transitive', num(c.transitive), 't-info');
        R.dim('Direct is exact here: the "" root entry records the manifest’s own');
        R.dim('dependency lists, so nothing has to be inferred.');
        if (c.missingDirect.length) {
          R.warn('Declared but not installed: ' + c.missingDirect.slice(0, 8).join(', ') +
                 (c.missingDirect.length > 8 ? ' and ' + (c.missingDirect.length - 8) + ' more' : ''));
        }
      } else {
        R.warn('direct vs transitive    UNAVAILABLE — no root entry in this file');
      }
      if (c.links) R.row('workspace links', num(c.links));
      if (c.workspaces) R.row('workspace members', num(c.workspaces));
      R.row('dev-only entries', num(c.devOnly));
      R.row('optional entries', num(c.optional));
    } else if (m.shape === 'npm1') {
      R.row('tree entries', num(c.entries));
      R.row('distinct packages', num(c.distinct));
      R.row('top-level entries', num(c.topLevel));
      R.row('certainly direct', num(c.certainDirect), 't-info');
      R.row('possibly direct', num(c.ambiguousDirect), 't-warn');
      R.dim('A v1 lockfile has no root entry, so it never records which packages');
      R.dim('the manifest asked for. What can be computed: a top-level entry that');
      R.dim('nothing else "requires" must have come from the manifest. The other');
      R.dim(num(c.ambiguousDirect) + ' are required by something else and may be direct as well.');
      R.dim('So the direct count is a lower bound, not an answer. Read the');
      R.dim('package.json alongside it, or re-lock with npm 7 or later.');
      R.row('dev-only entries', num(c.devOnly));
      R.row('optional entries', num(c.optional));
    } else if (m.shape === 'manifest') {
      R.warn('This is a manifest, not a lockfile.');
      R.row('dependencies', num(m.directCounts.dependencies));
      R.row('devDependencies', num(m.directCounts.devDependencies));
      R.row('optionalDependencies', num(m.directCounts.optionalDependencies));
      R.row('peerDependencies', num(m.directCounts.peerDependencies));
      R.row('transitive', 'UNAVAILABLE — a manifest does not contain them', 't-warn');
      if (m.ownScripts.length) {
        R.warn('This package declares its own install-time scripts: ' + m.ownScripts.join(', '));
      }
    } else {
      R.row('requirement lines', num(c.entries));
      R.row('distinct packages', num(c.distinct));
      if (m.compiled) {
        R.row('direct (via a .in file)', num(c.direct), 't-info');
        R.row('transitive (via a package)', num(c.transitive), 't-info');
        R.dim('Derived from pip-compile’s "# via" annotations, which record which');
        R.dim('package pulled each line in. That is real edge data, not a guess.');
      } else {
        R.warn('direct vs transitive    UNAVAILABLE for a plain requirements.txt');
        R.dim('The file is a flat list. Nothing in it says whether a line is there');
        R.dim('because you wanted it or because something else did. If you generate');
        R.dim('it with pip-compile, the "# via" comments carry exactly that, and');
        R.dim('this tool will use them.');
      }
      if (m.includes.length) R.row('include directives', num(m.includes.length) + ' (-r / -c, not followed)');
      if (m.options.length) R.row('pip options', num(m.options.length));
      if (m.badCount) {
        R.warn(plural(m.badCount, 'line') + ' could not be parsed as a requirement:');
        m.badLines.slice(0, 5).forEach(function (b) { R.dim('  line ' + b.line + ': ' + b.text); });
      }
    }
    if (c.duplicates) {
      R.row('at 2+ versions', num(c.duplicates) + ' packages', 't-warn');
      R.dim('  ' + clip(c.dupeNames.slice(0, 10).join(', '), 100));
    }
  }

  function sectionInstallScripts(m) {
    R.rule();
    R.heading('INSTALL SCRIPTS');
    if (m.installScripts !== 'available') {
      var why = m.shape === 'npm1'
        ? 'An npm v1 lockfile does not carry "hasInstallScript". The field did not\nexist until the v2 packages map, so this check cannot be run on this file —\nwhich is not the same as the file being clean.'
        : (m.shape === 'manifest'
          ? 'A manifest records only its OWN scripts, never its dependencies’. The\ninstall-time code that matters lives in packages this file does not list.'
          : 'requirements.txt records nothing about install-time behaviour. A source\ndistribution runs setup.py on install and can do anything it likes there;\nthe file in front of you cannot tell you which of these do.');
      why.split('\n').forEach(function (l) { R.warn(l); });
      R.line('');
      R.err('UNAVAILABLE for this file shape. Treat that as unknown, not as zero.');
      return;
    }
    var withScripts = m.entries.filter(function (e) { return e.hasInstallScript; });
    R.row('packages with one', num(withScripts.length) + ' of ' + num(m.entries.length) +
          '  (' + pct(withScripts.length, m.entries.length) + ')',
          withScripts.length ? 't-warn' : 't-ok');
    R.dim('npm writes "hasInstallScript": true only when a package has a preinstall,');
    R.dim('install or postinstall script. Absence means npm found none while it was');
    R.dim('resolving — which is a real signal, provided the lockfile came from npm 7');
    R.dim('or later. It is not a verdict either way: build tools legitimately');
    R.dim('compile native code here. It is where install-time code runs, so it is');
    R.dim('the shortest list worth reading by hand.');
    if (withScripts.length) {
      R.line('');
      withScripts.slice(0, SHOW * 2).forEach(function (e) {
        R.row('  ' + clip(e.name, 30), (e.version || '?') +
              (e.dev ? '   [dev]' : '') + (e.optional ? '   [optional]' : ''));
      });
      if (withScripts.length > SHOW * 2) {
        R.dim('  and ' + num(withScripts.length - SHOW * 2) + ' more');
      }
    }
  }

  function sectionLookalikes(m) {
    R.rule();
    R.heading('NAMES THAT RESEMBLE WELL-KNOWN PACKAGES');

    var names = Object.keys(m.byName || bag());
    var scanned = Math.min(names.length, MAX_SCAN);
    var hits = [];
    for (var i = 0; i < scanned; i++) {
      var hit = lookalike(names[i], m.ecosystem);
      if (hit) hits.push({ name: names[i], hit: hit });
    }

    var base = baselineCollisions(m.ecosystem);
    R.row('names checked', num(scanned) + ' against ' + num(base.total) + ' well-known names');
    if (names.length > scanned) {
      R.warn('Only the first ' + num(scanned) + ' names were checked, so the tab stays responsive.');
    }
    R.row('flagged', num(hits.length), hits.length ? 't-warn' : 't-ok');
    R.line('');
    R.err('A FLAG IS A PROMPT TO LOOK, NOT A VERDICT.');
    R.warn('Here is the proof, computed from the built-in list just now: of the ' +
           num(base.total));
    R.warn('well-known names in that list, ' + num(base.pairs) + ' PAIRS are within edit distance 2');
    R.warn('of each other. Every one of those is a pair of legitimate packages.');
    if (base.examples.length) {
      base.examples.forEach(function (ex) { R.dim('  for example: ' + ex); });
    }
    R.dim('So the check cannot separate a typosquat from a package that simply has');
    R.dim('a similar name. What it does is shorten the list a person has to read.');
    R.dim('Checked: separator swaps, homoglyphs, scope drops, and Damerau-');
    R.dim('Levenshtein distance 1 to 2, which counts a swap of two neighbouring');
    R.dim('letters as one edit.');
    if (m.ecosystem === 'pypi') {
      R.dim('Names are compared after PEP 503 normalisation, so python_dateutil is');
      R.dim('not flagged against python-dateutil: pip resolves both to the same');
      R.dim('project, and calling that a lookalike would be wrong rather than noisy.');
    } else {
      R.dim('A scoped name whose tail is a well-known package — @types/express,');
      R.dim('@sentry/react — is NOT flagged. You cannot reach a scope by typo, and');
      R.dim('flagging that pattern buried the real hits under DefinitelyTyped.');
    }

    if (!hits.length) {
      R.line('');
      R.ok('Nothing in this file resembles a name on the built-in list.');
      R.dim('That list is short. A package impersonating something not on it would');
      R.dim('pass this check silently.');
      return;
    }
    R.line('');
    var order = { 'non-ascii': 0, 'separator': 1, 'homoglyph': 2, 'scope-drop': 3, 'distance': 4 };
    var KIND_LABEL = {
      'non-ascii': 'non-ASCII', 'separator': 'separator swap',
      'homoglyph': 'homoglyph', 'scope-drop': 'scope dropped',
      'distance': 'near miss'
    };
    hits.sort(function (a, b) {
      var oa = order[a.hit.kind], ob = order[b.hit.kind];
      if (oa !== ob) return oa - ob;
      return (a.hit.dist || 0) - (b.hit.dist || 0);
    });
    hits.slice(0, SHOW * 3).forEach(function (h) {
      var line = h.hit.target ? 'looks like  ' + h.hit.target : '';
      R.row('  ' + clip(h.name, 28), line, 't-warn');
      R.row('', '    ' + KIND_LABEL[h.hit.kind] + ' — ' + h.hit.detail);
    });
    if (hits.length > SHOW * 3) R.dim('  and ' + num(hits.length - SHOW * 3) + ' more');
    R.line('');
    R.dim('To check one of these: open its registry page and look at the publisher,');
    R.dim('the repository link, the download count and the publish dates. This page');
    R.dim('cannot do any of that, because it never contacts the registry.');
  }

  function sectionLicences(m) {
    R.rule();
    R.heading('LICENCE MIX');
    if (m.licences !== 'available') {
      var why = m.shape === 'npm1'
        ? 'An npm v1 lockfile has no licence field. Entries carry version, resolved,\nintegrity and requires, and nothing else — so every package here is unknown\nfor the reason that the file could not have said.'
        : (m.shape === 'manifest'
          ? 'A manifest carries its own licence at most, never its dependencies’.'
          : 'requirements.txt has no licence field of any kind. Not one line of this\nfile could carry a licence even if somebody wanted it to.');
      why.split('\n').forEach(function (l) { R.warn(l); });
      R.line('');
      if (m.counts.distinct) {
        R.row('unknown', num(m.counts.distinct) + ' of ' + num(m.counts.distinct) + '  (100.0%)', 't-err');
      }
      R.err('UNAVAILABLE for this file shape. Read the installed packages instead.');
      return;
    }
    var counts = { permissive: 0, weak: 0, strong: 0, unknown: 0 };
    var seen = bag(), proprietary = 0, expressions = 0;
    var examples = { permissive: bag(), weak: bag(), strong: bag(), unknown: bag() };
    m.entries.forEach(function (e) {
      if (seen[e.name]) return;
      seen[e.name] = true;
      var b = e.licence.bucket;
      counts[b]++;
      if (e.licence.proprietary) proprietary++;
      if (e.licence.expression) expressions++;
      var raw = e.licence.raw || '(none)';
      examples[b][raw] = (examples[b][raw] || 0) + 1;
    });
    var total = Object.keys(seen).length;

    // Unknown first and loudest. A licence report that buries it is telling
    // you the answer you wanted rather than the one the file supports.
    R.row('unknown / not recorded', num(counts.unknown) + '  (' + pct(counts.unknown, total) + ')',
          counts.unknown ? 't-err' : 't-ok');
    R.dim('A lockfile omits the licence more often than people expect: npm only');
    R.dim('writes it when the package’s own metadata carried one. Unknown here');
    R.dim('means "this file did not say", never "there is no licence".');
    if (proprietary) {
      R.warn('  of those, ' + num(proprietary) + ' say UNLICENSED or point at a licence file.');
    }
    R.line('');
    ['permissive', 'weak', 'strong'].forEach(function (b) {
      R.row(BUCKET_LABEL[b], num(counts[b]) + '  (' + pct(counts[b], total) + ')',
            b === 'strong' && counts[b] ? 't-warn' : null);
    });
    if (counts.strong) {
      R.line('');
      R.warn('Strong copyleft in a dependency is a question for a lawyer, not a tool.');
      R.warn('Whether it matters depends on how you distribute, and this page knows');
      R.warn('nothing about that.');
    }
    if (expressions) {
      R.dim(num(expressions) + (expressions === 1 ? ' package carries' : ' packages carry') +
            ' an SPDX expression. With OR the most');
      R.dim('permissive alternative was used, because the consumer chooses; with AND');
      R.dim('the strictest, because every term binds.');
    }
    R.line('');
    BUCKETS.forEach(function (b) {
      var rows = ranked(examples[b]).slice(0, 6);
      if (!rows.length || !counts[b]) return;
      R.row(BUCKET_LABEL[b], rows.map(function (r) {
        return clip(r[0], 28) + ' x' + r[1];
      }).join(', '));
    });
  }

  function sectionRanges(m) {
    R.rule();
    R.heading('UNPINNED RANGES');
    var rootDecl = m.declared.filter(function (d) { return d.from === 'root'; });
    var transDecl = m.declared.filter(function (d) { return d.from === 'transitive'; });

    if (!rootDecl.length && !transDecl.length) {
      R.warn('No declared ranges in this file at all.');
      return;
    }

    if (rootDecl.length) {
      var unpinned = rootDecl.filter(function (d) { return !d.range.pinned; });
      var label = m.ecosystem === 'pypi' ? 'requirement lines' : 'ranges the root declares';
      R.row(label, num(rootDecl.length));
      R.row('not pinned', num(unpinned.length) + '  (' + pct(unpinned.length, rootDecl.length) + ')',
            unpinned.length ? 't-warn' : 't-ok');
      if (m.ecosystem === 'pypi') {
        R.dim('Pinned means "==" or "===" with a concrete version. Everything else —');
        R.dim('">=", "~=", a wildcard, or no specifier at all — lets pip choose on the');
        R.dim('day it runs, which is how two machines get different code from one file.');
      } else {
        R.dim('Pinned means an exact version. A caret lets minor and patch move, a');
        R.dim('tilde lets patch move, and "*" or a dist-tag lets anything move. The');
        R.dim('lockfile still pins what was installed; the range is what a fresh');
        R.dim('resolve would be free to pick.');
      }
      var byKind = bag();
      rootDecl.forEach(function (d) { byKind[d.range.kind] = (byKind[d.range.kind] || 0) + 1; });
      R.line('');
      ranked(byKind).forEach(function (r) { R.row('  ' + clip(r[0], 32), num(r[1])); });

      var worst = unpinned.slice().sort(function (a, b) {
        if (b.range.sev !== a.range.sev) return b.range.sev - a.range.sev;
        return a.name < b.name ? -1 : 1;
      });
      if (worst.length) {
        R.line('');
        R.warn('Widest first:');
        worst.slice(0, SHOW).forEach(function (d) {
          R.row('  ' + clip(d.name, 28), clip(d.spec, 24) + '   ' + d.range.kind, 't-warn');
        });
        if (worst.length > SHOW) R.dim('  and ' + num(worst.length - SHOW) + ' more');
      }
    } else if (m.shape === 'npm1') {
      R.warn('The root’s own ranges are UNAVAILABLE — a v1 lockfile does not record');
      R.warn('the manifest’s dependency list at all. Only the ranges packages');
      R.warn('declare on each other survive, and those are summarised below.');
    }

    if (transDecl.length) {
      R.line('');
      var tUn = transDecl.filter(function (d) { return !d.range.pinned; });
      R.row('ranges between packages', num(transDecl.length));
      R.row('  of those, not pinned', num(tUn.length) + '  (' + pct(tUn.length, transDecl.length) + ')');
      R.dim('These are other people’s choices, not yours. They are worth a number');
      R.dim('and not much more: you cannot pin them without overrides, and the');
      R.dim('lockfile has already frozen what they resolved to.');
    }
  }

  function sectionDepth(m) {
    R.rule();
    R.heading('DEPTH AND FAN-IN');
    if (m.physicalDepth !== null && m.physicalDepth !== undefined) {
      R.row('node_modules nesting', num(m.physicalDepth) + ' deep');
      R.dim('That is disk layout after npm hoisted what it could, not the shape of');
      R.dim('the dependency graph. A flat tree with one nested copy reads as 2.');
    }
    if (m.logicalDepth !== null && m.logicalDepth !== undefined) {
      R.row('dependency graph depth', num(m.logicalDepth) + ' hops', 't-info');
      R.dim('Hops from something you chose to something you did not, computed');
      R.dim('breadth-first over the declared edges.');
      if (m.shape === 'npm1') {
        R.dim('Starting from the certainly-direct set only, so this is a lower bound.');
      }
    } else if (m.shape === 'requirements' && !m.compiled) {
      R.row('dependency graph depth', 'UNAVAILABLE — no edges in this file', 't-warn');
    } else if (m.shape === 'manifest') {
      R.row('dependency graph depth', 'UNAVAILABLE — a manifest has no tree', 't-warn');
    } else {
      // v1 with nothing certainly direct, or a packages map with no root:
      // there is no start set, so there is no depth. Say so rather than
      // leaving the row out and letting the gap read as zero.
      R.row('dependency graph depth', 'UNAVAILABLE — no starting set to walk from', 't-warn');
    }

    var fan = ranked(m.fanIn);
    if (!fan.length) {
      R.line('');
      R.warn('Most-depended-upon    UNAVAILABLE — this file records no edges between');
      R.warn('packages, so there is nothing to count.');
      return;
    }
    R.line('');
    R.heading('Most depended upon');
    R.dim('Counted as: how many distinct packages in this file declare a dependency');
    R.dim('on this name. High fan-in means a lot of blast radius, not a lot of risk.');
    fan.slice(0, SHOW).forEach(function (r) {
      var versions = m.byName && m.byName[r[0]] ? Object.keys(m.byName[r[0]]).length : 0;
      R.row('  ' + clip(r[0], 28), plural(r[1], 'dependent') +
            (versions > 1 ? '   (' + versions + ' versions installed)' : ''));
    });
  }

  function sectionLimits(m) {
    R.rule();
    R.heading('WHAT THIS DID NOT DO');
    R.dim('It read the file and nothing else. In particular it did not:');
    R.dim('  • ask any registry whether these packages exist, or who published them');
    R.dim('  • check a single version against any vulnerability database');
    R.dim('  • verify one integrity hash against the tarball it describes');
    R.dim('  • read any package’s code, or its actual install scripts');
    R.dim('  • read a licence file, only the field the lockfile carried');
    R.line('');
    R.dim('All of that needs a network request, and this page makes none. So it');
    R.dim('cannot tell you a package is malicious. What it does is turn a file of');
    R.dim(num(m.counts.distinct) + ' packages into the short list above, which a person can read.');
    R.line('');
    R.ok('Export CycloneDX 1.5 to hand the inventory to something that can.');

    /* Measured on your machine, in this tab, for this file — not a benchmark
       and not a promise about any other file. It is here because the whole
       run is synchronous: a big lockfile locks the tab up while it works, and
       a number is a fairer thing to hand someone than a spinner. */
    if (m.started) {
      R.line('');
      R.dim('All of that took ' + num(Math.max(1, Date.now() - m.started)) +
            ' ms on this machine, in this tab, for this file.');
      if (m.counts.distinct > MAX_SCAN) {
        R.dim('The name check stopped at ' + num(MAX_SCAN) + ' names, which is why it did not');
        R.dim('take proportionally longer.');
      }
    }
  }

  /* ======================================================================
     CycloneDX 1.5 export.
     ====================================================================== */
  function buildSbom(m) {
    var components = [], seenRef = bag(), deps = [], seenDep = bag();

    m.entries.forEach(function (e) {
      var ref = e.ref;
      if (!ref || seenRef[ref]) return;
      seenRef[ref] = true;
      var comp = {
        type: 'library',
        'bom-ref': ref,
        name: e.name,
        purl: ref
      };
      if (e.version) comp.version = e.version;
      comp.scope = e.optional ? 'optional' : 'required';

      var lic = e.licence;
      if (lic && lic.raw) {
        if (lic.expression) comp.licenses = [{ expression: lic.raw }];
        else if (bucketOfId(lic.raw) !== 'unknown') comp.licenses = [{ license: { id: lic.raw } }];
        else comp.licenses = [{ license: { name: lic.raw } }];
      }
      if (e.integrity) comp.hashes = [{ alg: e.integrity.alg, content: e.integrity.content }];
      if (e.resolved && /^https?:/i.test(e.resolved)) {
        comp.externalReferences = [{ type: 'distribution', url: e.resolved }];
      }

      var props = [];
      if (e.dev) props.push({ name: 'npm:dev', value: 'true' });
      if (e.hasInstallScript === true) props.push({ name: 'npm:hasInstallScript', value: 'true' });
      if (e.declaredRange) props.push({ name: 'declaredRange', value: e.declaredRange });
      if (!e.version && e.specText) props.push({ name: 'declaredRange', value: e.specText });
      if (props.length) comp.properties = props;

      components.push(comp);
    });

    /* Two entries can share a bom-ref: the same name at the same version
       installed at two paths in node_modules. Their resolved edges are not
       necessarily identical, because each resolves against its own folder
       first. Keeping only the first entry's list silently dropped edges from
       the second, so the lists are merged — one node per ref, the union of
       what both copies depend on. */
    m.entries.forEach(function (e) {
      if (!e.ref || !e.edges || !e.edges.length) return;
      var node = seenDep[e.ref];
      if (!node) {
        node = { ref: e.ref, dependsOn: [] };
        seenDep[e.ref] = node;
        deps.push(node);
      }
      e.edges.forEach(function (target) {
        // A package that depends on its own name at its own version resolves
        // to itself. Harmless in a lockfile, a self-loop in a dependency graph.
        if (target === e.ref) return;
        if (node.dependsOn.indexOf(target) < 0) node.dependsOn.push(target);
      });
    });

    var bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: 'urn:uuid:' + uuid4(),
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: {
          components: [{
            type: 'application',
            name: 'SBOM inspector',
            publisher: 'Krunalkumar Shah'
          }]
        }
      },
      components: components
    };

    if (m.rootName) {
      var rootRef = m.ecosystem === 'pypi'
        ? purlPypi(m.rootName, m.rootVersion)
        : purlNpm(m.rootName, m.rootVersion);
      bom.metadata.component = {
        type: 'application',
        'bom-ref': rootRef,
        name: m.rootName,
        purl: rootRef
      };
      if (m.rootVersion) bom.metadata.component.version = m.rootVersion;
      if (m.rootEdges && m.rootEdges.length) {
        deps.unshift({ ref: rootRef, dependsOn: m.rootEdges.slice() });
      }
    }
    if (deps.length) bom.dependencies = deps;
    return { bom: bom, componentCount: components.length, depCount: deps.length };
  }

  function exportSbom() {
    if (!current) {
      R.clear().warn('Analyse a lockfile first — there is nothing to export yet.');
      return;
    }
    var built;
    try { built = buildSbom(current); }
    catch (err) {
      R.rule(); R.err('Could not build the SBOM: ' + ((err && err.message) || String(err)));
      return;
    }
    var text = JSON.stringify(built.bom, null, 2) + '\n';
    var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    LabTool.download(text, 'sbom-cyclonedx-' + stamp + '.json', 'application/vnd.cyclonedx+json');

    var withHash = 0, withLic = 0;
    built.bom.components.forEach(function (c) {
      if (c.hashes) withHash++;
      if (c.licenses) withLic++;
    });

    R.rule();
    R.heading('CYCLONEDX 1.5 EXPORTED');
    R.row('components', num(built.componentCount) + ' of type "library"');
    R.row('with a purl', num(built.componentCount) + ' (every component)');
    R.row('with a hash', num(withHash) + ' — only where the file carried integrity');
    R.row('with a licence', num(withLic) + ' — only where the file carried one');
    var noEdges = current.shape === 'manifest'
      ? 'none — a manifest carries no tree to derive one from'
      : (current.shape === 'requirements' && !current.compiled
        ? 'none — a plain requirements.txt records no edges'
        : 'none — nothing in this file resolved to an edge');
    R.row('dependency edges', built.depCount ? num(built.depCount) + ' nodes' : noEdges);
    R.row('metadata.component', built.bom.metadata.component ? built.bom.metadata.component.name : 'omitted — the input did not name one');
    R.line('');
    R.warn('What this SBOM does NOT contain, and will not:');
    R.dim('  • no vulnerabilities. Not one. That needs an advisory database, which');
    R.dim('    needs a network request, which this page does not make.');
    R.dim('  • no hashes beyond the integrity values already in your lockfile, and');
    R.dim('    none of them verified against a tarball.');
    R.dim('  • no licence text, no copyright holders, no signatures, no VEX.');
    R.dim('  • no components for workspace links, which resolve to your own folders');
    R.dim('    rather than to a package.');
    R.line('');
    R.dim('The serial number is a fresh random UUID, so exporting twice produces');
    R.dim('two documents describing the same inventory. That is what the field is');
    R.dim('for: it identifies the document, not the software.');
    R.dim('Written here in the tab, handed over as a blob. Nothing was uploaded.');
  }

  /* ======================================================================
     Worked examples. Synthetic files written for this page — the well-known
     names in them are real packages, the odd-looking ones are invented to
     make each check fire. No claim is made about any real package.
     ====================================================================== */
  var SAMPLES = {};

  SAMPLES.v3 = JSON.stringify({
    name: 'example-app', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': {
        name: 'example-app', version: '1.0.0', license: 'UNLICENSED',
        dependencies: {
          express: '^4.18.2', lodash: '4.17.21', chalk: '~5.3.0',
          'node-sass': '*', 'left-pad': '>=1.0.0', lodahs: '^1.0.0',
          cross_env: '^7.0.3', 'types-node': '^20.0.0'
        },
        devDependencies: { typescript: 'latest', jest: '^29.7.0', 'internal-report-engine': '^2.1.0' }
      },
      'node_modules/express': {
        version: '4.18.2', license: 'MIT',
        resolved: 'https://registry.npmjs.org/express/-/express-4.18.2.tgz',
        integrity: 'sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ==',
        dependencies: { accepts: '~1.3.8', 'body-parser': '1.20.1', cookie: '0.5.0', qs: '6.11.0' }
      },
      'node_modules/express/node_modules/qs': { version: '6.9.7', license: 'BSD-3-Clause' },
      'node_modules/accepts': { version: '1.3.8', license: 'MIT', dependencies: { 'mime-types': '~2.1.34' } },
      'node_modules/body-parser': { version: '1.20.1', license: 'MIT', dependencies: { qs: '6.11.0', bytes: '3.1.2' } },
      'node_modules/cookie': { version: '0.5.0', license: 'MIT' },
      'node_modules/qs': { version: '6.11.0', license: 'BSD-3-Clause' },
      'node_modules/bytes': { version: '3.1.2', license: 'MIT' },
      'node_modules/mime-types': { version: '2.1.35', license: 'MIT', dependencies: { 'mime-db': '1.52.0' } },
      'node_modules/mime-db': { version: '1.52.0', license: 'MIT' },
      'node_modules/lodash': {
        version: '4.17.21', license: 'MIT',
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
      },
      'node_modules/lodahs': { version: '1.0.2' },
      'node_modules/cross_env': { version: '7.0.3', license: 'MIT' },
      'node_modules/types-node': { version: '20.11.5', license: 'MIT' },
      'node_modules/chalk': { version: '5.3.0', license: 'MIT' },
      'node_modules/left-pad': { version: '1.3.0', license: 'WTFPL' },
      'node_modules/node-sass': {
        version: '9.0.0', license: 'MIT', hasInstallScript: true,
        dependencies: { chalk: '^4.1.2' }
      },
      'node_modules/node-sass/node_modules/chalk': { version: '4.1.2', license: 'MIT' },
      'node_modules/typescript': { version: '5.4.5', license: 'Apache-2.0', dev: true },
      'node_modules/jest': { version: '29.7.0', license: 'MIT', dev: true },
      'node_modules/internal-report-engine': {
        version: '2.1.4', license: 'GPL-3.0-or-later', dev: true, hasInstallScript: true
      },
      'node_modules/legacy-charting': { version: '0.9.1', license: '(MIT OR LGPL-2.1-only)' }
    }
  }, null, 2);

  SAMPLES.v2 = JSON.stringify({
    name: 'example-v2', version: '0.3.0', lockfileVersion: 2, requires: true,
    packages: {
      '': { name: 'example-v2', version: '0.3.0', license: 'MIT',
            dependencies: { axios: '^1.6.0', 'follow-redirects': '1.15.4' },
            devDependencies: { eslint: '^8.57.0' } },
      'node_modules/axios': { version: '1.6.7', license: 'MIT',
        resolved: 'https://registry.npmjs.org/axios/-/axios-1.6.7.tgz',
        dependencies: { 'follow-redirects': '^1.15.4', 'form-data': '^4.0.0' } },
      'node_modules/follow-redirects': { version: '1.15.5', license: 'MIT' },
      'node_modules/form-data': { version: '4.0.0', license: 'MIT' },
      'node_modules/eslint': { version: '8.57.0', license: 'MIT', dev: true }
    },
    dependencies: {
      axios: { version: '1.6.7', requires: { 'follow-redirects': '^1.15.4', 'form-data': '^4.0.0' } },
      'follow-redirects': { version: '1.15.5' },
      'form-data': { version: '4.0.0' },
      eslint: { version: '8.57.0', dev: true }
    }
  }, null, 2);

  SAMPLES.v1 = JSON.stringify({
    name: 'legacy-app', version: '2.0.0', lockfileVersion: 1, requires: true,
    dependencies: {
      express: {
        version: '4.17.1',
        resolved: 'https://registry.npmjs.org/express/-/express-4.17.1.tgz',
        integrity: 'sha512-mHJ9O79RqluphRrcw2X/GTh3k9tVv8YcoyY4Kkh4WDMUYKRZUq0h1o0w2rrrxBqM7VoeUVqgb27xlEMXTnYt4g==',
        requires: { accepts: '~1.3.7', cookie: '0.4.0', qs: '6.7.0' }
      },
      accepts: { version: '1.3.7', requires: { 'mime-types': '~2.1.24' } },
      cookie: { version: '0.4.0' },
      qs: { version: '6.7.0' },
      'mime-types': { version: '2.1.35', requires: { 'mime-db': '1.52.0' } },
      'mime-db': { version: '1.52.0' },
      lodash: { version: '4.17.21' },
      requst: { version: '0.1.0' },
      gulp: {
        version: '4.0.2',
        dev: true,
        requires: { glob: '^7.1.0' },
        dependencies: { glob: { version: '7.2.3', dev: true } }
      }
    }
  }, null, 2);

  SAMPLES.requirements = [
    '# Hand-written requirements for the example service',
    'requests>=2.28',
    'urllib3==1.26.18',
    'django==4.2.11',
    'djangorestframework',
    'psycopg2-binary~=2.9',
    'celery[redis]==5.3.6',
    'pyyaml==6.0.1',
    'reqests==2.31.0',
    'pyyam1==6.0.1',
    'python_dateutil==2.8.2',
    'boto3>=1.26,<2',
    'internal-tooling @ https://example.invalid/internal-tooling-1.2.0.tar.gz',
    'gunicorn==21.2.0 ; python_version >= "3.8"',
    '--index-url https://pypi.org/simple'
  ].join('\n');

  SAMPLES.compiled = [
    '#',
    '# This file is autogenerated by pip-compile with Python 3.11',
    '#    pip-compile requirements.in',
    '#',
    'certifi==2024.2.2',
    '    # via requests',
    'charset-normalizer==3.3.2',
    '    # via requests',
    'click==8.1.7',
    '    # via flask',
    'flask==3.0.2',
    '    # via -r requirements.in',
    'idna==3.6',
    '    # via requests',
    'itsdangerous==2.1.2',
    '    # via flask',
    'jinja2==3.1.3',
    '    # via flask',
    'markupsafe==2.1.5',
    '    # via jinja2',
    'requests==2.31.0',
    '    # via -r requirements.in',
    'urllib3==2.2.1',
    '    # via requests',
    'werkzeug==3.0.1',
    '    # via flask'
  ].join('\n');

  var SAMPLE_NOTE = {
    v3: 'worked example: synthetic npm v3 lockfile',
    v2: 'worked example: synthetic npm v2 lockfile',
    v1: 'worked example: synthetic npm v1 lockfile',
    requirements: 'worked example: synthetic requirements.txt',
    compiled: 'worked example: synthetic pip-compile output'
  };

  /* ======================================================================
     Wiring
     ====================================================================== */
  function box() { return document.getElementById('tool-text'); }
  function currentText() { var b = box(); return b ? b.value : ''; }

  function setText(text, label) {
    var b = box();
    if (b) b.value = text;
    var nameEl = document.getElementById('tool-dropname');
    if (nameEl) nameEl.textContent = label || '';
    analyse(text, label);
  }

  function run() {
    var text = currentText();
    if (!text.trim()) {
      R.clear();
      R.warn('Paste a lockfile first, or drop one into the panel on the left.');
      R.dim('Handled: package-lock.json v1, v2 and v3; package.json; and');
      R.dim('requirements.txt, including pip-compile output.');
      return;
    }
    analyse(text, document.getElementById('tool-dropname').textContent || 'pasted input');
  }

  LabTool.define({
    id: 'sbominspector',
    run: run,
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX_BYTES,
        onFile: function (bytes, file) {
          var text;
          try {
            text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          } catch (err) {
            // Older engines without TextDecoder, and files that are not UTF-8.
            // Chunked so a large lockfile does not blow the argument limit.
            text = '';
            for (var i = 0; i < bytes.length; i += 4096) {
              text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 4096, bytes.length)));
            }
          }
          setText(text, file.name + '  (' + LabTool.humanBytes(bytes.length) + ')');
        },
        onError: function (msg) { R.clear().err(msg); }
      });

      var sample = document.getElementById('tool-sample');
      if (sample) {
        sample.addEventListener('change', function () {
          var key = sample.value;
          if (!key || !SAMPLES[key]) return;
          setText(SAMPLES[key], SAMPLE_NOTE[key]);
          R.line('');
          R.dim('This is a synthetic file written for this page. The well-known names');
          R.dim('in it are real packages; the odd-looking ones were invented so each');
          R.dim('check has something to fire on. Nothing here describes any real');
          R.dim('package’s actual behaviour.');
          sample.value = '';
        });
      }

      var sbomBtn = document.getElementById('tool-sbom');
      if (sbomBtn) sbomBtn.addEventListener('click', exportSbom);

      var copyBtn = document.getElementById('tool-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          if (!mirror.length) { R.clear().warn('There is no report to copy yet.'); return; }
          LabTool.copy(R.text(), copyBtn);
        });
      }

      var clearBtn = document.getElementById('tool-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          var b = box();
          if (b) { b.value = ''; b.focus(); }
          var nameEl = document.getElementById('tool-dropname');
          if (nameEl) nameEl.textContent = '';
          current = null;
          R.clear();
          R.dim('Cleared. Nothing was stored anywhere to begin with.');
        });
      }

      out.dim('Paste a package-lock.json or a requirements.txt, or drop the file on');
      out.dim('the left. Everything is computed in this tab; the file is never sent.');
      out.dim('');
      out.dim('This reads the lockfile. It does not resolve the registry, so it');
      out.dim('cannot tell you whether a package is malicious — only where to look.');
    }
  });
})();

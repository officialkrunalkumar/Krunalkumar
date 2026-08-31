/* ==========================================================================
   docker-layers.js — why the image is 1.6 GB, and where the bytes went.
   --------------------------------------------------------------------------
   Almost everybody who ships containers has had the moment: `docker images`
   says 1.6 GB for an application that is four megabytes of JavaScript. The
   answers are always the same handful of mistakes, and all of them are
   invisible in the Dockerfile itself because a Dockerfile does not tell you
   what anything costs.

   So this lab prices it. You edit a Dockerfile, it parses the instructions,
   models what each one writes to the filesystem, and draws the layer stack
   with a number against every line. Four things it insists on showing, because
   they are the four that cost real money:

   1. THE UNION FILESYSTEM. A layer is a diff. Deleting a file in layer 8 does
      not remove it from layer 5 — it writes a whiteout marker, the earlier
      bytes stay in the image, and anyone holding the image can still extract
      them. This is the single most expensive misunderstanding in practice and
      the reason "we deleted the key in the next line" is not a fix. The Union
      filesystem tab shows every byte that is paid for but unreachable, and
      names the secrets that are still extractable.

   2. THE CACHE. Every instruction is a cache step, and the first one that
      changes invalidates all of it downstream. That is the whole reason
      `COPY package.json` before `COPY . .` exists, and the tool measures the
      difference rather than asserting it.

   3. MULTI-STAGE. Layers in a stage nothing copies from are built and thrown
      away. The summary separates "bytes built" from "bytes shipped" so the
      gap is a number rather than a slogan.

   4. THE FINDINGS. Root, unpinned tags, secrets baked into layers or into the
      image config, and a missing .dockerignore — each with the megabytes or
      the exposure it costs, and the line it came from.

   HONESTY, WHICH MATTERS MORE HERE THAN USUAL
   Every size on screen is a MODELLED ESTIMATE, not a build. Nothing here runs
   Docker, pulls a manifest or opens a network connection — there is no server
   and the page works offline. The numbers come from tables in this file:
   measured uncompressed sizes for common base images (what `docker images`
   reports, not the compressed download), and typical installed sizes for
   common packages. They are close enough to make the right decision and wrong
   enough that you should never quote them. Where a command is not modelled the
   tool says so in that layer's detail and contributes zero, rather than
   inventing a plausible number — an invented number is worse than a gap,
   because you cannot see it.

   ES5 only, no dependencies, no eval. The scoped stylesheet is injected as a
   <style> node, which the production CSP permits (style-src allows
   'unsafe-inline'); script-src does not, so nothing here is eval'd.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ======================================================================== */
  /*  PART 1 — THE MODEL                                                      */
  /*  Pure arithmetic over parsed text. No DOM in this section, deliberately:  */
  /*  it means the model can be reasoned about, and checked, on its own.       */
  /* ======================================================================== */

  /* --- units ------------------------------------------------------------- */
  /* Everything in the model is megabytes as a float. Bytes would be more
     precise than the inputs deserve: the tables below are rounded to the
     nearest tenth of a megabyte at best, so carrying byte counts would dress
     up an estimate as a measurement. */

  function fmtSize(mb) {
    if (mb == null || isNaN(mb)) return '—';
    if (mb <= 0) return '0 B';
    if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
    if (mb >= 100) return Math.round(mb) + ' MB';
    if (mb >= 1) return (Math.round(mb * 10) / 10) + ' MB';
    if (mb >= 0.001) return Math.round(mb * 1024) + ' KB';
    return Math.max(1, Math.round(mb * 1024 * 1024)) + ' B';
  }

  function fmtTime(s) {
    if (s == null || isNaN(s)) return '—';
    if (s < 60) return (Math.round(s * 10) / 10) + ' s';
    var m = Math.floor(s / 60);
    var r = Math.round(s - m * 60);
    if (r === 60) { m += 1; r = 0; }
    return m + ' min ' + r + ' s';
  }

  /* --- base images -------------------------------------------------------- */
  /* Uncompressed on-disk sizes, the number `docker images` prints. Docker Hub
     shows the COMPRESSED size on the tag page, which is roughly a third of
     this, and the mismatch is itself a common source of confusion — people
     read "55 MB" on the website and then find 135 MB on their disk. `layers`
     is how many layers the real image has; this tool collapses them into one
     row because their individual sizes teach nothing. */
  var BASES = {
    'scratch':            { size: 0,    layers: 0, pkg: 'none', shell: false, user: 'root' },
    'alpine':             { size: 7.8,  layers: 1, pkg: 'apk',  user: 'root' },
    'busybox':            { size: 4.3,  layers: 1, pkg: 'none', user: 'root' },
    'debian':             { size: 117,  layers: 1, pkg: 'apt',  user: 'root' },
    'debian-slim':        { size: 74,   layers: 1, pkg: 'apt',  user: 'root' },
    'ubuntu':             { size: 78,   layers: 1, pkg: 'apt',  user: 'root' },
    'node':               { size: 1090, layers: 8, pkg: 'apt',  user: 'root', build: true },
    'node-slim':          { size: 220,  layers: 6, pkg: 'apt',  user: 'root' },
    'node-alpine':        { size: 135,  layers: 5, pkg: 'apk',  user: 'root' },
    'python':             { size: 1020, layers: 9, pkg: 'apt',  user: 'root', build: true },
    'python-slim':        { size: 155,  layers: 6, pkg: 'apt',  user: 'root' },
    'python-alpine':      { size: 56,   layers: 5, pkg: 'apk',  user: 'root' },
    'golang':             { size: 830,  layers: 8, pkg: 'apt',  user: 'root', build: true },
    'golang-alpine':      { size: 250,  layers: 5, pkg: 'apk',  user: 'root', build: true },
    'rust':               { size: 1300, layers: 8, pkg: 'apt',  user: 'root', build: true },
    'ruby':               { size: 900,  layers: 8, pkg: 'apt',  user: 'root', build: true },
    'ruby-alpine':        { size: 90,   layers: 5, pkg: 'apk',  user: 'root' },
    'php':                { size: 480,  layers: 8, pkg: 'apt',  user: 'root' },
    'php-alpine':         { size: 105,  layers: 5, pkg: 'apk',  user: 'root' },
    'nginx':              { size: 190,  layers: 6, pkg: 'apt',  user: 'root' },
    'nginx-alpine':       { size: 43,   layers: 5, pkg: 'apk',  user: 'root' },
    'httpd':              { size: 170,  layers: 6, pkg: 'apt',  user: 'root' },
    'redis-alpine':       { size: 41,   layers: 5, pkg: 'apk',  user: 'root' },
    'postgres':           { size: 430,  layers: 8, pkg: 'apt',  user: 'root' },
    'postgres-alpine':    { size: 240,  layers: 6, pkg: 'apk',  user: 'root' },
    'mysql':              { size: 600,  layers: 8, pkg: 'apt',  user: 'root' },
    'temurin-jdk':        { size: 460,  layers: 6, pkg: 'apt',  user: 'root', build: true },
    'temurin-jre':        { size: 275,  layers: 6, pkg: 'apt',  user: 'root' },
    'openjdk':            { size: 470,  layers: 7, pkg: 'apt',  user: 'root', build: true },
    'distroless-static':  { size: 2.4,  layers: 2, pkg: 'none', shell: false, user: 'root' },
    'distroless-base':    { size: 21,   layers: 3, pkg: 'none', shell: false, user: 'root' },
    'distroless-nodejs':  { size: 110,  layers: 4, pkg: 'none', shell: false, user: 'root' },
    'distroless-python':  { size: 54,   layers: 4, pkg: 'none', shell: false, user: 'root' },
    'unknown':            { size: 120,  layers: 4, pkg: 'apt',  user: 'root', unknown: true }
  };

  /* Family matchers, in order. The tag is scanned separately for the variant
     words, because `node:20-alpine3.19` and `node:alpine` and
     `node:20-bookworm-slim` all have to land somewhere sensible. */
  var BASE_RULES = [
    { re: /^scratch$/,                    key: 'scratch' },
    { re: /distroless\/static/,           key: 'distroless-static' },
    { re: /distroless\/base/,             key: 'distroless-base' },
    { re: /distroless\/(nodejs|node)/,    key: 'distroless-nodejs' },
    { re: /distroless\/python/,           key: 'distroless-python' },
    { re: /distroless\/cc/,               key: 'distroless-base' },
    { re: /(^|\/)node$/,                  key: 'node',    alpine: 'node-alpine',   slim: 'node-slim' },
    { re: /(^|\/)python$/,                key: 'python',  alpine: 'python-alpine', slim: 'python-slim' },
    { re: /(^|\/)golang$/,                key: 'golang',  alpine: 'golang-alpine' },
    { re: /(^|\/)go$/,                    key: 'golang',  alpine: 'golang-alpine' },
    { re: /(^|\/)rust$/,                  key: 'rust' },
    { re: /(^|\/)ruby$/,                  key: 'ruby',    alpine: 'ruby-alpine' },
    { re: /(^|\/)php$/,                   key: 'php',     alpine: 'php-alpine' },
    { re: /(^|\/)nginx$/,                 key: 'nginx',   alpine: 'nginx-alpine' },
    { re: /(^|\/)httpd$/,                 key: 'httpd' },
    { re: /(^|\/)redis$/,                 key: 'redis-alpine', alpine: 'redis-alpine' },
    { re: /(^|\/)postgres$/,              key: 'postgres', alpine: 'postgres-alpine' },
    { re: /(^|\/)(mysql|mariadb)$/,       key: 'mysql' },
    { re: /(^|\/)eclipse-temurin$/,       key: 'temurin-jre', jdk: 'temurin-jdk' },
    { re: /(^|\/)openjdk$/,               key: 'openjdk' },
    { re: /(^|\/)debian$/,                key: 'debian',  slim: 'debian-slim' },
    { re: /(^|\/)ubuntu$/,                key: 'ubuntu' },
    { re: /(^|\/)alpine$/,                key: 'alpine' },
    { re: /(^|\/)busybox$/,               key: 'busybox' }
  ];

  /* Split an image reference into repository, tag and digest. Deliberately
     tolerant: a registry host with a port (`localhost:5000/app:1.2`) puts a
     colon in the middle, so the tag is only ever looked for after the last
     slash. */
  function splitRef(ref) {
    var s = String(ref || '').trim();
    var digest = '';
    var at = s.indexOf('@');
    if (at >= 0) { digest = s.slice(at + 1); s = s.slice(0, at); }
    var slash = s.lastIndexOf('/');
    var last = s.slice(slash + 1);
    var colon = last.indexOf(':');
    var tag = '';
    if (colon >= 0) {
      tag = last.slice(colon + 1);
      s = s.slice(0, slash + 1) + last.slice(0, colon);
    }
    return { repo: s.toLowerCase(), tag: tag.toLowerCase(), digest: digest };
  }

  function lookupBase(ref) {
    var parts = splitRef(ref);
    var repo = parts.repo, tag = parts.tag;
    var key = 'unknown';
    for (var i = 0; i < BASE_RULES.length; i++) {
      var rule = BASE_RULES[i];
      if (!rule.re.test(repo)) continue;
      key = rule.key;
      if (rule.alpine && tag.indexOf('alpine') >= 0) key = rule.alpine;
      else if (rule.slim && tag.indexOf('slim') >= 0) key = rule.slim;
      else if (rule.jdk && tag.indexOf('jdk') >= 0) key = rule.jdk;
      break;
    }
    var spec = BASES[key];
    var info = {
      key: key, repo: repo, tag: tag, digest: parts.digest,
      size: spec.size, layers: spec.layers, pkg: spec.pkg,
      shell: spec.shell !== false, user: spec.user,
      build: !!spec.build, unknown: !!spec.unknown,
      nonroot: tag.indexOf('nonroot') >= 0 || tag.indexOf('debug-nonroot') >= 0
    };
    if (info.nonroot) info.user = 'nonroot';
    return info;
  }

  /* --- package sizes ------------------------------------------------------ */
  /* Installed size including the dependencies apt or apk drags in, which is
     the number that matters and never the one on the package page. */
  var APT = {
    'build-essential': 420, 'gcc': 130, 'g++': 190, 'make': 1.6, 'cmake': 60,
    'git': 55, 'curl': 12, 'wget': 4.2, 'ca-certificates': 0.9, 'openssl': 3.2,
    'python3': 30, 'python3-pip': 42, 'python3-dev': 22, 'python3-venv': 3.1,
    'nodejs': 60, 'npm': 30, 'yarn': 5.2,
    'vim': 35, 'nano': 2.8, 'less': 1.4, 'procps': 2.1, 'net-tools': 1.1,
    'iputils-ping': 0.4, 'dnsutils': 2.4, 'netcat-openbsd': 0.2, 'jq': 1.3,
    'unzip': 0.6, 'zip': 0.6, 'tar': 0.1, 'xz-utils': 0.5, 'bzip2': 0.2,
    'imagemagick': 130, 'ffmpeg': 220, 'graphviz': 40,
    'libpq-dev': 8.4, 'postgresql-client': 21, 'default-mysql-client': 12,
    'default-jre': 190, 'default-jdk': 400,
    'nginx': 60, 'supervisor': 6.2, 'cron': 0.5,
    'openssh-client': 12, 'openssh-server': 15, 'sudo': 3.4,
    'tzdata': 8.1, 'locales': 17, 'gnupg': 8.4, 'lsb-release': 0.1,
    'libssl-dev': 8.6, 'zlib1g-dev': 0.6, 'libffi-dev': 0.7, 'libjpeg-dev': 1.1,
    'libxml2-dev': 3.2, 'libxslt1-dev': 1.7, 'pkg-config': 1.9,
    'software-properties-common': 2.4, 'apt-transport-https': 0.2,
    'dumb-init': 0.1, 'tini': 0.1, 'chromium': 320, 'fonts-liberation': 2.6
  };
  var APK = {
    'build-base': 200, 'gcc': 100, 'g++': 145, 'make': 1.3, 'musl-dev': 22,
    'cmake': 42, 'git': 12, 'curl': 3.6, 'wget': 0.6, 'ca-certificates': 0.7,
    'openssl': 2.9, 'bash': 3.6, 'python3': 55, 'py3-pip': 12, 'python3-dev': 2.1,
    'nodejs': 45, 'npm': 24, 'yarn': 4.8, 'tzdata': 3.5, 'libc6-compat': 1.5,
    'tini': 0.1, 'dumb-init': 0.1, 'su-exec': 0.02, 'shadow': 3.1,
    'libpq': 1.2, 'postgresql-client': 8.5, 'jq': 0.6, 'vim': 28,
    'imagemagick': 42, 'ffmpeg': 96, 'openssh-client': 6.2, 'libffi-dev': 0.4,
    'jpeg-dev': 0.6, 'zlib-dev': 0.2, 'chromium': 280, 'font-noto': 12
  };
  var APT_DEFAULT = 12;
  var APK_DEFAULT = 3;

  /* Python wheels. torch and tensorflow are in here because they are the two
     that turn a 155 MB image into a 3 GB one and people are always surprised. */
  var PIP = {
    'django': 42, 'flask': 6.5, 'fastapi': 5.4, 'uvicorn': 2.1, 'gunicorn': 1.1,
    'requests': 1.2, 'httpx': 2.4, 'sqlalchemy': 14, 'psycopg2-binary': 12,
    'psycopg': 5.1, 'alembic': 3.2, 'celery': 8.4, 'redis': 1.1,
    'numpy': 68, 'pandas': 120, 'scipy': 95, 'matplotlib': 62,
    'scikit-learn': 110, 'pillow': 15, 'boto3': 24, 'pydantic': 9.2,
    'torch': 2400, 'tensorflow': 1900, 'transformers': 42, 'opencv-python': 190
  };
  var PIP_DEFAULT = 6;
  var PIP_REQUIREMENTS = 118;   // a typical mid-sized requirements.txt, resolved

  /* Node dependency trees. The dev/prod split is the whole argument for
     --omit=dev, so it is a first-class number rather than a percentage. */
  var NPM_DEV = 181;
  var NPM_PROD = 54;
  var NPM_CACHE = 46;
  var PIP_CACHE = 34;
  var APT_LISTS = 42;
  var APK_CACHE = 6;
  var GO_MODCACHE = 240;
  var GO_BINARY = 14;

  /* --- build contexts ----------------------------------------------------- */
  /* A COPY costs whatever is in the build context, so the context has to be a
     real object in this model rather than an assumption. Three modelled
     project trees; the visitor picks one, and can see every entry and its
     size. `secret: true` marks a file that must never reach a layer. */
  var CONTEXTS = {
    node: {
      label: 'Node project',
      files: [
        { path: 'package.json',      size: 0.004 },
        { path: 'package-lock.json', size: 0.62 },
        { path: 'src',               size: 2.4,  dir: true },
        { path: 'public',            size: 3.1,  dir: true },
        { path: 'dist',              size: 1.4,  dir: true, built: true },
        { path: 'node_modules',      size: 181,  dir: true, built: true },
        { path: '.git',              size: 46,   dir: true, leak: true },
        { path: '.env',              size: 0.001, secret: true },
        { path: 'secrets/deploy_key', size: 0.003, secret: true },
        { path: 'README.md',         size: 0.01 },
        { path: 'Dockerfile',        size: 0.001 }
      ]
    },
    python: {
      label: 'Python project',
      files: [
        { path: 'requirements.txt',  size: 0.002 },
        { path: 'app',               size: 1.8,  dir: true },
        { path: 'static',            size: 5.2,  dir: true },
        { path: 'tests',             size: 0.9,  dir: true },
        { path: '.venv',             size: 260,  dir: true, built: true },
        { path: '.git',              size: 38,   dir: true, leak: true },
        { path: '.env',              size: 0.001, secret: true },
        { path: 'README.md',         size: 0.01 },
        { path: 'Dockerfile',        size: 0.001 }
      ]
    },
    go: {
      label: 'Go project',
      files: [
        { path: 'go.mod',            size: 0.001 },
        { path: 'go.sum',            size: 0.01 },
        { path: 'cmd',               size: 0.4,  dir: true },
        { path: 'internal',          size: 1.9,  dir: true },
        { path: 'web',               size: 2.6,  dir: true },
        { path: '.git',              size: 22,   dir: true, leak: true },
        { path: 'README.md',         size: 0.01 },
        { path: 'Dockerfile',        size: 0.001 }
      ]
    }
  };

  /* --- glob matching ------------------------------------------------------ */
  /* Enough of the pattern language for .dockerignore and COPY sources: `*`,
     `?`, `**`, and a leading `!` for negation handled by the caller. Not the
     full Go filepath.Match that BuildKit uses — character classes are not
     supported, and that is stated on the page. */
  function globToRe(pattern) {
    var out = '';
    for (var i = 0; i < pattern.length; i++) {
      var c = pattern.charAt(i);
      if (c === '*') {
        if (pattern.charAt(i + 1) === '*') { out += '.*'; i++; }
        else out += '[^/]*';
      } else if (c === '?') out += '[^/]';
      else if ('\\^$.|+()[]{}'.indexOf(c) >= 0) out += '\\' + c;
      else out += c;
    }
    return new RegExp('^' + out + '$');
  }

  /* A pattern matches a context entry if it matches the entry itself or any
     directory above it — `secrets` has to exclude `secrets/deploy_key`. */
  function matchesPattern(entryPath, pattern) {
    var pat = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!pat) return false;
    var re = globToRe(pat);
    if (re.test(entryPath)) return true;
    var parts = entryPath.split('/');
    var acc = '';
    for (var i = 0; i < parts.length; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      if (re.test(acc)) return true;
    }
    return false;
  }

  function parseIgnore(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/^\s+|\s+$/g, '');
      if (!line || line.charAt(0) === '#') return;
      var negate = line.charAt(0) === '!';
      if (negate) line = line.slice(1).replace(/^\s+/, '');
      if (!line) return;
      out.push({ pattern: line, negate: negate });
    });
    return out;
  }

  function isIgnored(entryPath, rules) {
    var ignored = false;
    for (var i = 0; i < rules.length; i++) {
      if (matchesPattern(entryPath, rules[i].pattern)) ignored = !rules[i].negate;
    }
    return ignored;
  }

  /* --- Dockerfile parsing -------------------------------------------------- */
  /* Line continuations, comments inside continuations, and the parser
     directives at the top. Heredocs (RUN <<EOF) are NOT parsed — BuildKit
     supports them, this does not, and the page says so. */
  function parseDockerfile(text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    var pending = '';
    var startLine = 0;

    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].replace(/\s+$/, '').replace(/^[ \t]+/, '');
      if (pending === '') {
        if (s === '' || s.charAt(0) === '#') continue;
        startLine = i + 1;
      } else if (s.charAt(0) === '#') {
        continue;               // a comment line inside a continuation is legal
      }
      if (/\\$/.test(s)) { pending += s.slice(0, -1) + ' '; continue; }
      pending += s;
      out.push(makeInstruction(pending, startLine));
      pending = '';
    }
    if (pending !== '') out.push(makeInstruction(pending, startLine));
    return out;
  }

  function makeInstruction(text, line) {
    var clean = text.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var m = /^([A-Za-z][A-Za-z0-9_]*)\s+([\s\S]*)$/.exec(clean);
    return {
      line: line,
      text: clean,
      cmd: m ? m[1].toUpperCase() : clean.toUpperCase(),
      args: m ? m[2] : ''
    };
  }

  /* Split a shell command on the operators that separate commands. Quoting is
     not tracked, so a literal "&&" inside a quoted string would split here —
     rare in a Dockerfile, and it costs an over-count rather than a wrong
     answer, because both halves are then classified separately. */
  function splitShell(body) {
    return String(body).split(/\s*(?:&&|\|\||;)\s*/).map(function (s) {
      return s.replace(/^\s+|\s+$/g, '');
    }).filter(function (s) { return s.length > 0; });
  }

  /* Tokens after the sub-command name that are not flags. `apt-get install -y
     --no-install-recommends git curl` gives ['git', 'curl']. */
  function packageArgs(op, dropWords) {
    var toks = op.split(/\s+/);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (t.charAt(0) === '-') continue;
      if (dropWords.indexOf(t.toLowerCase()) >= 0) continue;
      if (t.indexOf('=') >= 0 && t.indexOf('/') < 0 && /^[A-Z_]+=/.test(t)) continue;
      out.push(t.replace(/[=<>].*$/, ''));
    }
    return out;
  }

  function pathJoin(base, rel) {
    if (!rel || rel === '.' || rel === './') return base;
    if (rel.charAt(0) === '/') return rel.replace(/\/+$/, '') || '/';
    var b = base === '/' ? '' : base.replace(/\/+$/, '');
    return (b + '/' + rel.replace(/^\.\//, '')).replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
  }

  function basename(p) {
    var parts = String(p).replace(/\/+$/, '').split('/');
    return parts[parts.length - 1];
  }

  var SECRET_RE = /(^|\/)(\.env|\.npmrc|\.netrc|id_rsa|id_ed25519|.*\.pem|.*\.key|credentials|deploy_key|\.aws|\.ssh)$/i;
  var SECRET_ENV_RE = /(pass|passwd|password|secret|token|api[-_]?key|apikey|access[-_]?key|credential|private[-_]?key|auth)/i;

  function looksSecret(p) { return SECRET_RE.test(String(p)); }

  /* ======================================================================== */
  /*  FILESYSTEM SIMULATION                                                    */
  /* ------------------------------------------------------------------------ */
  /*  The heart of the lab. `all` is every artifact ever written by any layer;  */
  /*  `live` is the union view a running container would see. An image's size   */
  /*  on disk is the sum of the LAYERS, which is `all`; what `du` inside the    */
  /*  container reports is `live`. The gap between those two numbers is the     */
  /*  whole lesson, so both are tracked separately rather than derived.         */
  /* ======================================================================== */

  function newState() {
    return { all: [], live: {}, workdir: '/', user: null, env: {}, args: {} };
  }

  function addArtifact(state, layer, path, size, opts) {
    opts = opts || {};
    /* Writing the same path twice inside ONE layer is not two copies — the
       second write replaces the first before the layer is ever committed, so
       only the survivor is charged for. Across layers it is the opposite, and
       that difference is exactly what the union tab exists to show. */
    for (var i = layer.adds.length - 1; i >= 0; i--) {
      if (layer.adds[i].path === path) layer.adds.splice(i, 1);
    }
    var prev = state.live[path];
    if (prev && prev.layer !== layer) prev.shadowedBy = layer;
    var art = {
      path: path, size: size, layer: layer, kind: opts.kind || 'file',
      secret: !!opts.secret || looksSecret(path), leak: !!opts.leak,
      note: opts.note || '', shadowedBy: null, deletedBy: null
    };
    state.all.push(art);
    state.live[path] = art;
    layer.adds.push(art);
    return art;
  }

  /* `rm` semantics. Two completely different outcomes depending on WHERE the
     bytes came from, and the tool has to be able to tell them apart:

       - written by this same layer  -> the bytes never reach the image at all.
         This is why `apt-get update && apt-get install && rm -rf lists` on one
         line is the fix and three lines is not.

       - written by an earlier layer -> a whiteout marker. The earlier layer is
         already committed and immutable; the file disappears from the union
         view and stays in the image, extractable by anyone. */
  function removePath(state, layer, pattern) {
    var pat = String(pattern).replace(/\/\*+$/, '').replace(/\/+$/, '');
    if (!pat || pat === '/') return;
    var re = globToRe(pat);
    var paths = Object.keys(state.live);
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var hit = re.test(p) || p.indexOf(pat + '/') === 0;
      if (!hit) continue;
      var art = state.live[p];
      delete state.live[p];
      if (art.layer === layer) {
        for (var j = layer.adds.length - 1; j >= 0; j--) {
          if (layer.adds[j] === art) layer.adds.splice(j, 1);
        }
        art.neverWritten = true;
        layer.sameLayerRemoved = (layer.sameLayerRemoved || 0) + art.size;
      } else {
        art.deletedBy = layer;
        layer.whiteouts.push(art);
      }
    }
  }

  function layerSize(layer) {
    var total = 0;
    for (var i = 0; i < layer.adds.length; i++) total += layer.adds[i].size;
    return total;
  }

  function liveSize(state) {
    var total = 0;
    var paths = Object.keys(state.live);
    for (var i = 0; i < paths.length; i++) total += state.live[paths[i]].size;
    return total;
  }

  /* ======================================================================== */
  /*  RUN — what a shell command costs                                         */
  /* ------------------------------------------------------------------------ */
  /*  Each recognised command reports what it writes, what it deletes, and     */
  /*  roughly how long it takes. Anything not recognised reports NOTHING and   */
  /*  says so in the layer detail. Guessing a size for an unknown command      */
  /*  would make the total look complete while quietly being fiction.          */
  /* ======================================================================== */

  function sumPackages(names, table, fallback, unknownOut) {
    var total = 0;
    for (var i = 0; i < names.length; i++) {
      var n = names[i].toLowerCase();
      if (table.hasOwnProperty(n)) total += table[n];
      else { total += fallback; if (unknownOut) unknownOut.push(names[i]); }
    }
    return total;
  }

  function applyRun(state, layer, body, base) {
    var ops = splitShell(body);
    if (!ops.length) { layer.notes.push('Empty RUN, so nothing happens.'); return; }
    var unmodelled = [];

    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var low = op.toLowerCase();
      var wd = state.workdir;

      /* --- apt --------------------------------------------------------- */
      if (/^(apt-get|apt)\s+(-\S+\s+)*update\b/.test(low)) {
        addArtifact(state, layer, '/var/lib/apt/lists', APT_LISTS,
          { kind: 'cache', note: 'The package index apt-get update downloads.' });
        layer.seconds += 7;
        layer.aptUpdate = true;
        continue;
      }
      if (/^(apt-get|apt)\s+(-\S+\s+)*install\b/.test(low)) {
        var aptNames = packageArgs(op, ['apt-get', 'apt', 'install', 'y']);
        var aptUnknown = [];
        var recommends = low.indexOf('--no-install-recommends') < 0;
        var aptTotal = 0;
        for (var a = 0; a < aptNames.length; a++) {
          var lowName = aptNames[a].toLowerCase();
          var known = APT.hasOwnProperty(lowName);
          if (!known) aptUnknown.push(aptNames[a]);
          var each = (known ? APT[lowName] : APT_DEFAULT) * (recommends ? 1.35 : 1);
          aptTotal += each;
          addArtifact(state, layer, '/usr/pkg/' + aptNames[a], each, {
            kind: 'package',
            note: known ? '' : 'Not in my size table, so this is the ' + APT_DEFAULT + ' MB default.'
          });
        }
        layer.installed = (layer.installed || []).concat(aptNames);
        layer.aptInstall = true;
        layer.recommends = recommends;
        layer.seconds += 3 + 0.05 * aptTotal;
        if (aptUnknown.length) {
          layer.notes.push('Not in my size table, modelled at ' + APT_DEFAULT + ' MB each: ' +
            aptUnknown.join(', ') + '.');
        }
        if (recommends) {
          layer.notes.push('There is no --no-install-recommends here, so apt also pulls the ' +
            'recommended packages. Modelled as 35 per cent on top.');
        }
        continue;
      }
      if (/^(apt-get|apt)\s+clean\b/.test(low)) {
        removePath(state, layer, '/var/cache/apt');
        layer.seconds += 0.4;
        continue;
      }
      if (/^(apt-get|apt)\s+(-\S+\s+)*(remove|purge|autoremove)\b/.test(low)) {
        var gone = packageArgs(op, ['apt-get', 'apt', 'remove', 'purge', 'autoremove', 'y']);
        for (var g = 0; g < gone.length; g++) removePath(state, layer, '/usr/pkg/' + gone[g]);
        layer.seconds += 2;
        continue;
      }

      /* --- apk --------------------------------------------------------- */
      if (/^apk\s+(--\S+\s+)*add\b/.test(low)) {
        var apkNames = packageArgs(op, ['apk', 'add', 'update']);
        var apkUnknown = [];
        for (var k = 0; k < apkNames.length; k++) {
          var apkLow = apkNames[k].toLowerCase();
          var apkKnown = APK.hasOwnProperty(apkLow);
          if (!apkKnown) apkUnknown.push(apkNames[k]);
          addArtifact(state, layer, '/usr/pkg/' + apkNames[k],
            apkKnown ? APK[apkLow] : APK_DEFAULT, { kind: 'package' });
        }
        layer.installed = (layer.installed || []).concat(apkNames);
        if (low.indexOf('--no-cache') < 0) {
          addArtifact(state, layer, '/var/cache/apk', APK_CACHE,
            { kind: 'cache', note: 'The apk index, left behind because --no-cache was not passed.' });
          layer.apkNoCacheMissing = true;
        }
        layer.seconds += 1 + 0.03 * layerSize(layer);
        if (apkUnknown.length) {
          layer.notes.push('Not in my size table, modelled at ' + APK_DEFAULT + ' MB each: ' +
            apkUnknown.join(', ') + '.');
        }
        continue;
      }
      if (/^apk\s+(--\S+\s+)*del\b/.test(low)) {
        var apkGone = packageArgs(op, ['apk', 'del']);
        for (var dd = 0; dd < apkGone.length; dd++) removePath(state, layer, '/usr/pkg/' + apkGone[dd]);
        layer.seconds += 1;
        continue;
      }

      /* --- npm and friends ---------------------------------------------- */
      if (/^(npm|yarn|pnpm)\s+(ci|install|i|add)\b/.test(low) && low.indexOf(' -g') < 0) {
        var prod = /--omit[= ]dev|--production|--only[= ]production|--prod\b/.test(low);
        var deps = prod ? NPM_PROD : NPM_DEV;
        addArtifact(state, layer, pathJoin(wd, 'node_modules'), deps, {
          kind: 'deps',
          note: prod ? 'Runtime dependencies only, because --omit=dev was passed.'
                     : 'Dependencies and devDependencies, because nothing told it otherwise.'
        });
        addArtifact(state, layer, '/root/.npm', NPM_CACHE,
          { kind: 'cache', note: 'The package manager download cache.' });
        layer.npmProd = prod;
        layer.npmInstall = true;
        layer.seconds += 12 + 0.6 * deps;
        continue;
      }
      if (/^(npm|yarn)\s+cache\s+clean/.test(low)) {
        removePath(state, layer, '/root/.npm');
        layer.seconds += 1.5;
        continue;
      }
      if (/^(npm|yarn|pnpm)\s+run\s+build\b/.test(low) || /^(npm|yarn)\s+build\b/.test(low)) {
        addArtifact(state, layer, pathJoin(wd, 'dist'), 1.4,
          { kind: 'artifact', note: 'The bundled application.' });
        layer.seconds += 45;
        continue;
      }

      /* --- pip ----------------------------------------------------------- */
      if (/^(pip3?|python3?\s+-m\s+pip)\s+install\b/.test(low)) {
        var reqs = /-r\s+\S+/.test(low);
        var pipUnknown = [];
        var pipSize;
        if (reqs) {
          pipSize = PIP_REQUIREMENTS;
        } else {
          var pipNames = packageArgs(op, ['pip', 'pip3', 'python', 'python3', 'm', 'install']);
          pipSize = sumPackages(pipNames, PIP, PIP_DEFAULT, pipUnknown);
          if (!pipNames.length) pipSize = PIP_DEFAULT;
        }
        addArtifact(state, layer, '/usr/local/lib/python/site-packages', pipSize, {
          kind: 'deps',
          note: reqs ? 'A mid-sized requirements.txt, resolved. Yours will differ.' : ''
        });
        if (low.indexOf('--no-cache-dir') < 0) {
          addArtifact(state, layer, '/root/.cache/pip', PIP_CACHE,
            { kind: 'cache', note: 'pip keeps every wheel it downloaded. --no-cache-dir stops it.' });
          layer.pipCache = true;
        }
        layer.pipInstall = true;
        layer.seconds += 8 + 0.45 * pipSize;
        if (pipUnknown.length) {
          layer.notes.push('Not in my wheel-size table, modelled at ' + PIP_DEFAULT + ' MB each: ' +
            pipUnknown.join(', ') + '.');
        }
        continue;
      }

      /* --- go ------------------------------------------------------------ */
      if (/^go\s+mod\s+(download|tidy)\b/.test(low)) {
        addArtifact(state, layer, '/root/go/pkg/mod', GO_MODCACHE,
          { kind: 'cache', note: 'The Go module cache. Large, and needed only in order to build.' });
        layer.seconds += 35;
        continue;
      }
      if (/(^|\s)go\s+build\b/.test(low)) {
        var outMatch = /-o\s+(\S+)/.exec(op);
        var target = outMatch ? outMatch[1] : 'app';
        addArtifact(state, layer, pathJoin(wd, target), GO_BINARY, {
          kind: 'artifact',
          note: 'A statically linked binary. This is the only thing that has to ship.'
        });
        layer.seconds += 26;
        continue;
      }

      /* --- users ---------------------------------------------------------- */
      if (/^(useradd|adduser|groupadd|addgroup)\b/.test(low)) {
        addArtifact(state, layer, '/etc/passwd-entries', 0.05, { kind: 'file' });
        layer.seconds += 0.6;
        continue;
      }

      /* --- the recursive-ownership trap ------------------------------------ */
      /* chown -R and chmod -R change metadata, and a layer records a changed
         file by storing the whole file again. Run one over a directory that
         came from an earlier layer and every byte in it is duplicated. It is
         the most surprising line in this model and one of the most common in
         real Dockerfiles. */
      if (/^(chown|chmod)\b/.test(low) && /\s-[a-zA-Z]*[rR]/.test(op)) {
        var tgtMatch = /\s(\S+)\s*$/.exec(op);
        var tgt = tgtMatch ? pathJoin(wd, tgtMatch[1]) : null;
        if (tgt) {
          var dupTotal = 0;
          var dupPaths = Object.keys(state.live);
          for (var q = 0; q < dupPaths.length; q++) {
            var pth = dupPaths[q];
            if (pth !== tgt && pth.indexOf(tgt + '/') !== 0) continue;
            var srcArt = state.live[pth];
            if (srcArt.layer === layer) continue;
            addArtifact(state, layer, pth, srcArt.size, {
              kind: srcArt.kind, secret: srcArt.secret,
              note: 'Rewritten whole by ' + (low.indexOf('chown') === 0 ? 'chown -R' : 'chmod -R') +
                    '. The copy in the earlier layer is still in the image.'
            });
            dupTotal += srcArt.size;
          }
          if (dupTotal > 0) {
            layer.duplicated = dupTotal;
            layer.notes.push('This rewrote ' + fmtSize(dupTotal) + ' that already existed in an ' +
              'earlier layer. Changing a file owner or mode stores the whole file again.');
          }
        }
        layer.seconds += 3;
        continue;
      }

      /* --- downloads and builds -------------------------------------------- */
      if (/^(curl|wget)\b/.test(low)) {
        var dl = /-[oO]\s+(\S+)/.exec(op);
        var dest = dl && dl[1] !== '-' ? dl[1] : 'downloaded';
        addArtifact(state, layer, pathJoin(wd, dest), 25, {
          kind: 'file',
          note: 'A downloaded file. I model every download at 25 MB, because I cannot fetch it.'
        });
        layer.seconds += 8;
        continue;
      }
      if (/^(make|cmake|\.\/configure|gcc|g\+\+|cargo\s+build|mvn|gradle)\b/.test(low)) {
        addArtifact(state, layer, pathJoin(wd, 'build-output'), 8,
          { kind: 'artifact', note: 'Compiler output, modelled at 8 MB.' });
        layer.seconds += 60;
        continue;
      }
      if (/^git\s+clone\b/.test(low)) {
        addArtifact(state, layer, pathJoin(wd, 'cloned-repo'), 22,
          { kind: 'file', note: 'A cloned repository, history included.' });
        layer.seconds += 12;
        continue;
      }

      /* --- deletions -------------------------------------------------------- */
      if (/^rm\b/.test(low)) {
        var targets = op.split(/\s+/).slice(1).filter(function (t) { return t.charAt(0) !== '-'; });
        for (var r = 0; r < targets.length; r++) removePath(state, layer, pathJoin(wd, targets[r]));
        layer.seconds += 0.5;
        layer.isDelete = true;
        continue;
      }

      /* --- free ------------------------------------------------------------- */
      if (/^(mkdir|cd|ln|touch|export|set|true|:|echo|cat|ls|mv|sed|update-ca-certificates|ldconfig|source|\.)\b/.test(low)) {
        layer.seconds += 0.3;
        continue;
      }

      unmodelled.push(op);
      layer.seconds += 2;
    }

    if (unmodelled.length) {
      layer.unmodelled = unmodelled;
      layer.notes.push('I do not model ' + (unmodelled.length === 1 ? 'this command' : 'these commands') +
        ', so ' + (unmodelled.length === 1 ? 'it contributes' : 'they contribute') +
        ' 0 MB here: ' + unmodelled.join('  |  ') + '. The real layer will not be 0.');
    }
  }

  /* ======================================================================== */
  /*  COPY and ADD                                                             */
  /* ======================================================================== */

  function resolveSources(fromStage, context, sources, stageResults) {
    /* COPY --from reads another stage's finished union, so that side is a
       lookup. Everything else comes out of the build context, already filtered
       by .dockerignore. */
    var hits = [];
    var i, j;
    if (fromStage != null) {
      var donor = stageResults[fromStage];
      if (!donor) return hits;
      var paths = Object.keys(donor.state.live);
      for (i = 0; i < sources.length; i++) {
        var want = sources[i].replace(/\/+$/, '');
        var found = false;
        for (j = 0; j < paths.length; j++) {
          var p = paths[j];
          if (p === want || p.indexOf(want + '/') === 0) {
            hits.push({ path: p, size: donor.state.live[p].size,
                        secret: donor.state.live[p].secret, entry: null });
            found = true;
          }
        }
        if (!found) hits.push({ path: want, size: 0, missing: true, entry: null });
      }
      return hits;
    }
    for (i = 0; i < sources.length; i++) {
      var src = sources[i].replace(/^\.\//, '').replace(/\/+$/, '');
      for (j = 0; j < context.length; j++) {
        var entry = context[j];
        if (entry.ignored) continue;
        var match = src === '.' || src === '' || entry.path === src ||
                    entry.path.indexOf(src + '/') === 0 || matchesPattern(entry.path, src);
        if (match) {
          hits.push({ path: entry.path, size: entry.size, entry: entry, srcSpec: src,
                      secret: !!entry.secret, leak: !!entry.leak });
        }
      }
    }
    return hits;
  }

  function applyCopy(state, layer, ins, spec, stageResults) {
    var args = ins.args;
    var fromStage = null;
    var flagFrom = /--from=(\S+)/.exec(args);
    var chownFlag = /--chown=\S+/.test(args);
    args = args.replace(/--[a-zA-Z-]+(=\S+)?/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');

    if (flagFrom) {
      var ref = flagFrom[1].toLowerCase();
      for (var s = 0; s < stageResults.length; s++) {
        if (!stageResults[s]) continue;
        if (stageResults[s].alias === ref || String(stageResults[s].index) === ref) { fromStage = s; break; }
      }
      if (fromStage === null) {
        layer.notes.push('--from=' + flagFrom[1] + ' does not name a stage in this file, so this ' +
          'copies nothing. In a real build it would try to pull an image by that name.');
      }
    }

    var parts;
    if (args.charAt(0) === '[') {
      parts = args.replace(/^\[|\]$/g, '').split(',').map(function (t) {
        return t.replace(/^[\s"']+|[\s"']+$/g, '');
      });
    } else {
      parts = args.split(' ');
    }
    parts = parts.filter(function (t) { return t.length > 0; });
    if (parts.length < 2) {
      layer.notes.push('This needs at least a source and a destination.');
      return;
    }
    var dest = parts[parts.length - 1];
    var sources = parts.slice(0, parts.length - 1);

    layer.fromStage = fromStage;
    layer.sources = sources;
    layer.chownFlag = chownFlag;

    var hits = resolveSources(fromStage, spec.context, sources, stageResults);
    layer.copiedEntries = hits;

    if (!hits.length) {
      layer.notes.push('Nothing matches ' + sources.join(' ') + ' in the build context' +
        (spec.ignoreRules.length ? ' once .dockerignore has been applied.' : '.'));
      return;
    }

    var destDir = /\/$/.test(dest) || dest === '.' || dest === './' || sources.length > 1;
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      if (hit.missing) {
        layer.notes.push('Stage ' + fromStage + ' never produced ' + hit.path +
          ', so this copies nothing.');
        continue;
      }
      /* `COPY . .` keeps the tree: secrets/deploy_key lands at <dest>/secrets/deploy_key,
         not <dest>/deploy_key. Naming an entry directly copies just that entry. */
      var rel = (hit.srcSpec === '.' || hit.srcSpec === '') ? hit.path : basename(hit.path);
      var target = destDir
        ? pathJoin(pathJoin(state.workdir, dest), rel)
        : pathJoin(state.workdir, dest);
      addArtifact(state, layer, target, hit.size, {
        kind: hit.entry && hit.entry.dir ? 'dir' : 'file',
        secret: hit.secret, leak: hit.leak,
        note: fromStage != null ? 'Copied out of stage ' + fromStage + '.' : ''
      });
    }
    layer.seconds += 0.2 + 0.02 * layerSize(layer);
  }

  /* ======================================================================== */
  /*  BUILD                                                                    */
  /* ======================================================================== */

  var META_CMDS = ['ENV', 'ARG', 'LABEL', 'EXPOSE', 'CMD', 'ENTRYPOINT', 'USER',
                   'WORKDIR', 'VOLUME', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
                   'ONBUILD', 'MAINTAINER'];

  function newLayer(stageIndex, ins, cmd) {
    return {
      stage: stageIndex, cmd: cmd || (ins ? ins.cmd : ''), raw: ins ? ins.text : '',
      args: ins ? ins.args : '', line: ins ? ins.line : 0,
      adds: [], whiteouts: [], notes: [], seconds: 0, size: 0,
      meta: false, cacheState: 'cached', fromStage: null
    };
  }

  /* ENV and ARG write no bytes to any layer, and people therefore assume they
     are private. They are not: both end up in the image configuration that
     ships with the image, which docker history and docker inspect will print
     for anyone holding it. */
  function recordEnv(state, layer, ins) {
    var text = ins.args;
    var pairs = [];
    var re = /([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|(\S*))/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      pairs.push({
        key: m[1],
        value: m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5])
      });
    }
    if (!pairs.length) {
      var simple = /^(\S+)\s+(.*)$/.exec(text);
      if (simple) pairs.push({ key: simple[1], value: simple[2] });
      else if (text) pairs.push({ key: text.replace(/^\s+|\s+$/g, ''), value: '' });
    }
    layer.envPairs = pairs;
    for (var i = 0; i < pairs.length; i++) {
      state.env[pairs[i].key] = pairs[i].value;
      if (SECRET_ENV_RE.test(pairs[i].key) && pairs[i].value && pairs[i].value.charAt(0) !== '$') {
        layer.envSecret = pairs[i];
      }
    }
  }

  function buildStage(stage, spec, done) {
    var state = newState();
    var out = {
      index: stage.index, layers: [], state: state, alias: null,
      baseRef: '', base: null, fromStage: null, ins: stage.ins
    };

    var fromArgs = stage.ins.args.replace(/--platform=\S+/gi, '').replace(/^\s+|\s+$/g, '');
    var asMatch = /\s+as\s+(\S+)\s*$/i.exec(fromArgs);
    if (asMatch) { out.alias = asMatch[1].toLowerCase(); fromArgs = fromArgs.slice(0, asMatch.index); }
    out.baseRef = fromArgs.replace(/^\s+|\s+$/g, '');

    var baseLayer = newLayer(stage.index, stage.ins, 'FROM');
    out.layers.push(baseLayer);

    var donorIndex = null;
    for (var d = 0; d < done.length; d++) {
      if (done[d].alias && done[d].alias === out.baseRef.toLowerCase()) donorIndex = d;
    }
    if (donorIndex !== null) {
      out.fromStage = donorIndex;
      baseLayer.fromStage = donorIndex;
      out.base = done[donorIndex].base;
      var donorPaths = Object.keys(done[donorIndex].state.live);
      for (var p = 0; p < donorPaths.length; p++) {
        var srcArt = done[donorIndex].state.live[donorPaths[p]];
        addArtifact(state, baseLayer, srcArt.path, srcArt.size, {
          kind: srcArt.kind, secret: srcArt.secret,
          note: 'Inherited from stage ' + donorIndex + '.'
        });
      }
      state.workdir = done[donorIndex].state.workdir;
      state.user = done[donorIndex].state.user;
      baseLayer.notes.push('This stage starts from stage ' + donorIndex +
        ', so it inherits everything that stage had built.');
    } else {
      out.base = lookupBase(out.baseRef);
      addArtifact(state, baseLayer, '/ (base image)', out.base.size, {
        kind: 'base',
        note: out.base.unknown
          ? 'I have no measured size for this image, so it is modelled at ' + out.base.size +
            ' MB. Treat that number as a placeholder, not an estimate.'
          : 'The real image is ' + out.base.layers + ' layer' +
            (out.base.layers === 1 ? '' : 's') + '; they are collapsed into one row here.'
      });
      state.user = out.base.user;
    }
    baseLayer.size = layerSize(baseLayer);

    for (var i = 0; i < stage.instrs.length; i++) {
      var ins = stage.instrs[i];
      var layer = newLayer(stage.index, ins);
      out.layers.push(layer);

      if (ins.cmd === 'RUN') {
        if (/--mount=type=(cache|secret|bind|ssh)/.test(ins.args)) layer.usedMount = true;
        var body = ins.args.replace(/--mount=\S+/g, '').replace(/^\s+/, '');
        if (out.base && out.base.shell === false) {
          layer.notes.push('This base image has no shell, so a shell-form RUN cannot run at all.');
        }
        if (/^\[/.test(body)) layer.notes.push('Exec-form RUN. I only model shell-form commands.');
        else applyRun(state, layer, body, out.base);
      } else if (ins.cmd === 'COPY' || ins.cmd === 'ADD') {
        applyCopy(state, layer, ins, spec, done);
        if (ins.cmd === 'ADD') layer.isAdd = true;
      } else if (ins.cmd === 'WORKDIR') {
        state.workdir = pathJoin(state.workdir, ins.args.replace(/^\s+|\s+$/g, ''));
        layer.meta = true;
      } else if (ins.cmd === 'USER') {
        state.user = ins.args.split(':')[0].replace(/^\s+|\s+$/g, '');
        layer.meta = true;
      } else if (ins.cmd === 'ENV' || ins.cmd === 'ARG') {
        recordEnv(state, layer, ins);
        layer.meta = true;
      } else if (META_CMDS.indexOf(ins.cmd) >= 0) {
        layer.meta = true;
      } else {
        layer.meta = true;
        layer.notes.push('I do not recognise the instruction ' + ins.cmd + '.');
        layer.badCmd = true;
      }

      if (layer.meta) layer.seconds = 0.1;
      layer.size = layerSize(layer);
    }

    out.builtSize = 0;
    for (var L = 0; L < out.layers.length; L++) out.builtSize += out.layers[L].size;
    out.liveSize = liveSize(state);
    out.waste = Math.max(0, out.builtSize - out.liveSize);
    out.user = state.user;
    out.workdir = state.workdir;
    out.env = state.env;
    return out;
  }

  /* Which stages actually reach the final image: the last one, plus anything
     it copies from, transitively. Everything else is built and thrown away,
     which is the entire point of multi-stage and worth colouring in. */
  function markShipped(result) {
    var wanted = {};
    var queue = [result.stages.length - 1];
    while (queue.length) {
      var idx = queue.pop();
      if (wanted[idx]) continue;
      wanted[idx] = true;
      var st = result.stages[idx];
      if (st.fromStage != null) queue.push(st.fromStage);
      for (var i = 0; i < st.layers.length; i++) {
        var l = st.layers[i];
        if (l.fromStage != null && !wanted[l.fromStage]) queue.push(l.fromStage);
      }
    }
    for (var j = 0; j < result.stages.length; j++) {
      result.stages[j].shipped = j === result.stages.length - 1;
      result.stages[j].contributes = !!wanted[j];
    }
  }

  function build(dockerfile, ignoreText, contextKey) {
    var instrs = parseDockerfile(dockerfile);
    var ignoreRules = parseIgnore(ignoreText);
    var ctxDef = CONTEXTS[contextKey] || CONTEXTS.node;
    var context = ctxDef.files.map(function (f) {
      return {
        path: f.path, size: f.size, dir: !!f.dir, secret: !!f.secret,
        leak: !!f.leak, built: !!f.built, ignored: isIgnored(f.path, ignoreRules)
      };
    });

    var result = {
      instructions: instrs, stages: [], errors: [], findings: [],
      context: context, contextKey: contextKey, contextLabel: ctxDef.label,
      ignoreRules: ignoreRules, hasIgnore: ignoreRules.length > 0,
      builtSize: 0, shippedSize: 0, shippedLive: 0, shippedWaste: 0,
      discarded: 0, layerCount: 0, contextSize: 0, contextSent: 0
    };

    for (var c = 0; c < context.length; c++) {
      result.contextSize += context[c].size;
      if (!context[c].ignored) result.contextSent += context[c].size;
    }

    if (!instrs.length) { result.empty = true; return result; }

    var spec = { context: context, ignoreRules: ignoreRules };
    var stages = [];
    var current = null;

    for (var i = 0; i < instrs.length; i++) {
      var ins = instrs[i];
      if (ins.cmd === 'FROM') {
        current = { index: stages.length, ins: ins, instrs: [] };
        stages.push(current);
        continue;
      }
      if (ins.cmd === 'ARG' && !current) continue;   // ARG before FROM is legal
      if (!current) {
        result.errors.push('Line ' + ins.line + ': ' + ins.cmd + ' comes before any FROM. ' +
          'A Dockerfile has to open with FROM.');
        continue;
      }
      current.instrs.push(ins);
    }

    if (!stages.length) {
      result.errors.push('There is no FROM instruction, so there is no image to build.');
      return result;
    }

    for (var s = 0; s < stages.length; s++) {
      result.stages.push(buildStage(stages[s], spec, result.stages));
    }

    var last = result.stages[result.stages.length - 1];
    for (var t = 0; t < result.stages.length; t++) result.builtSize += result.stages[t].builtSize;
    result.shippedSize = last.builtSize;
    result.shippedLive = last.liveSize;
    result.shippedWaste = Math.max(0, last.builtSize - last.liveSize);
    result.layerCount = last.layers.length;
    result.discarded = Math.max(0, result.builtSize - result.shippedSize);

    markShipped(result);
    result.findings = analyse(result);
    return result;
  }

  /* ======================================================================== */
  /*  FINDINGS                                                                 */
  /* ------------------------------------------------------------------------ */
  /*  Every finding carries the line it came from and, where it is a size      */
  /*  problem, the megabytes it costs. A finding with no number attached is    */
  /*  an opinion, and this page has enough of those already.                   */
  /* ======================================================================== */

  function finding(level, title, body, fix, line) {
    return { level: level, title: title, body: body, fix: fix || '', line: line || 0 };
  }

  var LEVEL_RANK = { high: 0, medium: 1, low: 2 };

  function analyse(result) {
    var out = [];
    var last = result.stages[result.stages.length - 1];
    if (!last) return out;
    var i, j, k;

    /* --- secrets that are still in a layer ------------------------------- */
    var stillThere = [];
    var wiped = [];
    for (i = 0; i < result.stages.length; i++) {
      var st = result.stages[i];
      if (!st.contributes) continue;
      for (j = 0; j < st.state.all.length; j++) {
        var art = st.state.all[j];
        if (!art.secret || art.neverWritten) continue;
        if (st.shipped) stillThere.push({ art: art, stage: st });
        else wiped.push({ art: art, stage: st });
      }
    }
    for (i = 0; i < stillThere.length; i++) {
      var sec = stillThere[i].art;
      if (sec.deletedBy) {
        out.push(finding('high',
          'Deleted, and still in the image: ' + basename(sec.path),
          sec.path + ' was written by the layer at line ' + sec.layer.line +
          ' and deleted by the layer at line ' + sec.deletedBy.line + '. Deleting a file in a ' +
          'later layer writes a whiteout marker; it does not reach into the earlier layer, ' +
          'which is already committed and immutable. The bytes ship with the image and anyone ' +
          'holding it can read them.',
          'Treat the credential as compromised and rotate it. Then keep it out of the layers ' +
          'entirely: RUN --mount=type=secret for build-time credentials, or fetch it at run time.',
          sec.layer.line));
      } else {
        out.push(finding('high',
          'A credential ships inside the image: ' + basename(sec.path),
          sec.path + ' arrives in the layer at line ' + sec.layer.line + ' and is still there ' +
          'in the image you would push. Anyone who can pull the image can read it.',
          'Take it out of the build context, add it to .dockerignore, and pass it at run time ' +
          'or through RUN --mount=type=secret.',
          sec.layer.line));
      }
    }
    if (wiped.length && !stillThere.length) {
      out.push(finding('low',
        'A secret reached a build stage, but not the final image',
        wiped[0].art.path + ' is written in stage ' + wiped[0].stage.index + ', which nothing ' +
        'copies wholesale into the last stage. This is multi-stage doing exactly what it is for. ' +
        'It is still worth noting: that stage exists on the build machine and in any build cache ' +
        'you export or share.',
        'If the build cache is pushed to a registry, the secret goes with it. Prefer ' +
        'RUN --mount=type=secret even here.',
        wiped[0].art.layer.line));
    }

    /* --- secrets in the image configuration ------------------------------- */
    for (i = 0; i < last.layers.length; i++) {
      var el = last.layers[i];
      if (!el.envSecret) continue;
      out.push(finding('high',
        'A credential is in the image configuration: ' + el.envSecret.key,
        el.cmd + ' ' + el.envSecret.key + ' sets a value that looks like a credential. ENV and ARG ' +
        'write nothing to the filesystem, which is why people assume they are private. They are ' +
        'not: both are stored in the image config and printed by docker history and docker ' +
        'inspect for anyone holding the image.',
        'Pass it at run time with docker run -e, or read it from a mounted file or a secret store.',
        el.line));
    }

    /* --- runs as root ------------------------------------------------------ */
    if (!last.user || last.user === 'root' || last.user === '0') {
      out.push(finding('high',
        'The container runs as root',
        'No USER instruction takes effect in the final stage, so the process starts as uid 0. ' +
        'Root in the container is root on the host kernel; a container escape, a mounted volume ' +
        'or a writable bind mount all become considerably worse from there.',
        'Create an unprivileged user and switch to it before CMD: ' +
        'RUN adduser -S app && USER app. Note that USER has to be in the FINAL stage — one in ' +
        'an earlier stage does not carry over.',
        last.ins ? last.ins.line : 0));
    }

    /* --- unpinned base ----------------------------------------------------- */
    for (i = 0; i < result.stages.length; i++) {
      var bs = result.stages[i];
      if (!bs.base || bs.fromStage != null) continue;
      var ref = splitRef(bs.baseRef);
      if (ref.digest) continue;
      if (!ref.tag || ref.tag === 'latest') {
        out.push(finding('high',
          'The base image tag is not pinned',
          'FROM ' + bs.baseRef + ' resolves to whatever :latest points at on the day of the ' +
          'build. Two builds of the same commit can produce different images, and a broken ' +
          'build is impossible to reproduce or bisect.',
          'Pin at least a version tag, and pin a digest for anything you deploy: ' +
          'FROM node:20.11-alpine@sha256:...',
          bs.ins.line));
      } else if (/^\d+$/.test(ref.tag)) {
        out.push(finding('low',
          'The base tag is a floating major version',
          'FROM ' + bs.baseRef + ' follows the newest release in that major line, so the image ' +
          'changes underneath you without the Dockerfile changing. That is often what you want ' +
          'for security updates, and never what you want when you are trying to reproduce a build.',
          'For deployed images, pin the full version or a digest.',
          bs.ins.line));
      }
      if (bs.base.unknown) {
        out.push(finding('low',
          'I do not know this base image',
          bs.baseRef + ' is not in my table, so it is modelled at ' + bs.base.size + ' MB. ' +
          'Every total on this page that includes it is a placeholder.',
          'Run docker images against the real base to get the number that matters.',
          bs.ins.line));
      }
    }

    /* --- .dockerignore ------------------------------------------------------ */
    var wildCopy = null;
    for (i = 0; i < last.layers.length; i++) {
      var cl = last.layers[i];
      if (cl.cmd !== 'COPY' && cl.cmd !== 'ADD') continue;
      if (cl.fromStage != null || !cl.sources) continue;
      for (j = 0; j < cl.sources.length; j++) {
        if (cl.sources[j] === '.' || cl.sources[j] === './') wildCopy = cl;
      }
    }
    var junk = 0, junkNames = [];
    for (i = 0; i < result.context.length; i++) {
      var ce = result.context[i];
      if (ce.ignored) continue;
      if (ce.built || ce.leak || ce.secret) { junk += ce.size; junkNames.push(ce.path); }
    }
    if (!result.hasIgnore) {
      out.push(finding(junk > 20 ? 'high' : 'medium',
        'There is no .dockerignore',
        'Without one, the whole working directory is sent to the builder and COPY . . takes all ' +
        'of it. In this context that is ' + fmtSize(result.contextSize) + ', of which ' +
        fmtSize(junk) + ' has no business in an image: ' + junkNames.join(', ') + '.',
        'Add a .dockerignore. Start with node_modules, .git, .env, secrets, dist and *.md, ' +
        'then add whatever else your project builds locally.',
        wildCopy ? wildCopy.line : 0));
    } else if (junk > 1 && wildCopy) {
      out.push(finding('medium',
        'The .dockerignore is letting things through',
        'COPY . . at line ' + wildCopy.line + ' still picks up ' + fmtSize(junk) + ': ' +
        junkNames.join(', ') + '.',
        'Add those paths to .dockerignore.',
        wildCopy.line));
    }

    /* --- caches left in the shipped image ------------------------------------ */
    var cachePaths = Object.keys(last.state.live);
    var cacheTotal = 0, cacheNames = [];
    for (i = 0; i < cachePaths.length; i++) {
      var la = last.state.live[cachePaths[i]];
      if (la.kind !== 'cache') continue;
      cacheTotal += la.size;
      cacheNames.push(cachePaths[i] + ' (' + fmtSize(la.size) + ')');
    }
    if (cacheTotal > 0.5) {
      out.push(finding('medium',
        'Package manager caches ship with the image',
        fmtSize(cacheTotal) + ' of download cache is in the final image and nothing at run time ' +
        'will ever read it: ' + cacheNames.join(', ') + '.',
        'Delete each cache in the same RUN that created it, or avoid creating it: ' +
        'apk add --no-cache, pip install --no-cache-dir, and ' +
        'apt-get update && apt-get install -y ... && rm -rf /var/lib/apt/lists/* on one line.',
        0));
    }

    /* --- deletes that saved nothing ------------------------------------------ */
    for (i = 0; i < result.stages.length; i++) {
      var ds = result.stages[i];
      if (!ds.shipped) continue;
      for (j = 0; j < ds.layers.length; j++) {
        var dl = ds.layers[j];
        if (!dl.whiteouts.length) continue;
        var freed = 0, names = [];
        for (k = 0; k < dl.whiteouts.length; k++) {
          if (dl.whiteouts[k].secret) continue;   // already reported above, harder
          freed += dl.whiteouts[k].size;
          names.push(dl.whiteouts[k].path);
        }
        if (freed < 0.5) continue;
        out.push(finding('medium',
          'A delete in a later layer freed nothing',
          'Line ' + dl.line + ' removes ' + names.join(', ') + ', but those bytes were written ' +
          'by an earlier layer. The image is still ' + fmtSize(freed) + ' larger for them; all ' +
          'this layer adds is a whiteout marker saying the files are not visible.',
          'Move the delete into the same RUN as the thing that created it, joined with &&. ' +
          'A layer only ever gets smaller if the file never enters it.',
          dl.line));
      }
    }

    /* --- apt update in its own layer ------------------------------------------ */
    for (i = 0; i < result.stages.length; i++) {
      var as = result.stages[i];
      var updateLayer = null;
      for (j = 0; j < as.layers.length; j++) {
        var al = as.layers[j];
        if (al.aptUpdate && !al.aptInstall) updateLayer = al;
        else if (al.aptInstall && updateLayer) {
          out.push(finding('medium',
            'apt-get update and apt-get install are in separate layers',
            'The update at line ' + updateLayer.line + ' is cached independently of the install ' +
            'at line ' + al.line + '. Change only the package list later and Docker reuses the ' +
            'cached index, which by then can be months old, so apt asks for versions that have ' +
            'been removed from the mirror and the build fails. This is the classic stale-cache bug.',
            'Put them in one RUN: apt-get update && apt-get install -y --no-install-recommends ' +
            'pkg1 pkg2 && rm -rf /var/lib/apt/lists/*',
            updateLayer.line));
          updateLayer = null;
        }
      }
    }

    /* --- recommends ------------------------------------------------------------ */
    for (i = 0; i < last.layers.length; i++) {
      if (last.layers[i].aptInstall && last.layers[i].recommends) {
        out.push(finding('low',
          'apt is installing recommended packages too',
          'Without --no-install-recommends, apt pulls in everything the packages merely suggest ' +
          'would be nice. On a desktop that is helpful; in an image it is documentation, editors ' +
          'and fonts nobody will open.',
          'apt-get install -y --no-install-recommends ...',
          last.layers[i].line));
        break;
      }
    }

    /* --- build tools in the shipped image --------------------------------------- */
    var TOOLING = ['build-essential', 'gcc', 'g++', 'make', 'cmake', 'python3-dev',
                   'libssl-dev', 'libffi-dev', 'libpq-dev', 'git', 'build-base',
                   'musl-dev', 'default-jdk', 'zlib1g-dev', 'libxml2-dev'];
    var tools = 0, toolNames = [];
    for (i = 0; i < cachePaths.length; i++) {
      var name = cachePaths[i].indexOf('/usr/pkg/') === 0 ? cachePaths[i].slice(9) : null;
      if (!name || TOOLING.indexOf(name.toLowerCase()) < 0) continue;
      tools += last.state.live[cachePaths[i]].size;
      toolNames.push(name);
    }
    if (tools > 5) {
      out.push(finding('medium',
        'Compilers ship with the application',
        fmtSize(tools) + ' of build tooling is in the final image (' + toolNames.join(', ') +
        '). It was needed to build, it will never be needed to run, and it hands anyone who ' +
        'lands inside the container a working toolchain.',
        'Build in one stage and copy only the result into a clean final stage: ' +
        'FROM node:20 AS build ... then FROM node:20-alpine and ' +
        'COPY --from=build /app/dist ./dist',
        0));
    }

    /* --- dependency directories copied in from the context ---------------------- */
    for (i = 0; i < last.layers.length; i++) {
      var cl2 = last.layers[i];
      if (!cl2.copiedEntries) continue;
      for (j = 0; j < cl2.copiedEntries.length; j++) {
        var ent = cl2.copiedEntries[j].entry;
        if (!ent || !ent.built) continue;
        out.push(finding('medium',
          ent.path + ' was copied in from your machine',
          fmtSize(ent.size) + ' of locally built files went into the layer at line ' + cl2.line +
          '. They were built against your operating system and your architecture, and if a later ' +
          'RUN installs dependencies again the copied set stays in the earlier layer, paid for ' +
          'and unreachable.',
          'Add ' + ent.path + ' to .dockerignore and let the build produce it.',
          cl2.line));
      }
    }

    /* --- bytes written twice ------------------------------------------------------ */
    var shadowed = 0, shadowNames = [];
    for (i = 0; i < last.state.all.length; i++) {
      var sa = last.state.all[i];
      if (!sa.shadowedBy || sa.neverWritten) continue;
      shadowed += sa.size;
      if (shadowNames.length < 4) shadowNames.push(sa.path);
    }
    if (shadowed > 1) {
      out.push(finding('medium',
        'The same paths are written in more than one layer',
        fmtSize(shadowed) + ' is stored twice: an earlier layer wrote ' + shadowNames.join(', ') +
        ' and a later one wrote over it. Both copies are in the image; only the later one is ' +
        'visible. A layer is a diff, and a diff cannot subtract from the layer beneath it.',
        'Write each path once. If a RUN chown -R or chmod -R is doing it, set ownership as you ' +
        'copy instead: COPY --chown=app:app . .',
        0));
    }

    /* --- ADD where COPY would do --------------------------------------------------- */
    for (i = 0; i < last.layers.length; i++) {
      if (!last.layers[i].isAdd) continue;
      out.push(finding('low',
        'ADD is being used where COPY would do',
        'ADD unpacks local tar archives automatically and, in older syntax versions, fetches ' +
        'remote URLs. Both behaviours are surprising in a line that reads as a copy.',
        'Use COPY unless you specifically want the unpacking. It does only what it says.',
        last.layers[i].line));
      break;
    }

    /* --- single stage that should be two -------------------------------------------- */
    if (result.stages.length === 1 && (tools > 5 || cacheTotal > 20 || last.builtSize > 400)) {
      out.push(finding('medium',
        'One stage, doing two jobs',
        'This image builds and runs in the same filesystem, so everything the build needed ships ' +
        'with everything the application needs. The final image is ' + fmtSize(last.builtSize) +
        '; the files a running container can actually see total ' + fmtSize(last.liveSize) + '.',
        'Split it. Put the build in a first stage, then start a clean final stage from a slim or ' +
        'alpine base and COPY --from only the artefact and the runtime dependencies.',
        0));
    }

    /* --- layer count ------------------------------------------------------------------ */
    if (last.layers.length > 24) {
      out.push(finding('low',
        'That is a lot of layers',
        last.layers.length + ' steps in the final stage. There is no hard limit worth worrying ' +
        'about any more, but every RUN is a commit, and a long chain of tiny RUNs usually means ' +
        'related commands were split for no reason.',
        'Join related commands with && so a cleanup lands in the same layer as the thing it cleans.',
        0));
    }

    /* --- multi-stage doing its job ------------------------------------------------------ */
    if (result.stages.length > 1 && result.discarded > 50) {
      out.push(finding('low',
        'Multi-stage is earning its keep here',
        'The build writes ' + fmtSize(result.builtSize) + ' across ' + result.stages.length +
        ' stages and ships ' + fmtSize(result.shippedSize) + '. The difference, ' +
        fmtSize(result.discarded) + ', never leaves the build machine.',
        'Nothing to fix. This is the shape you want.',
        0));
    }

    out.sort(function (a, b) { return LEVEL_RANK[a.level] - LEVEL_RANK[b.level]; });
    return out;
  }

  /* ======================================================================== */
  /*  CACHE SIMULATION                                                         */
  /* ------------------------------------------------------------------------ */
  /*  Docker's cache rule is one sentence: a step is reused only if every step */
  /*  before it was reused and its own inputs are unchanged. For RUN the input */
  /*  is the command text; for COPY it is the command text plus a checksum of  */
  /*  the files. That second clause is the whole reason COPY package.json      */
  /*  before COPY . . exists, and it is what this function measures.           */
  /* ======================================================================== */

  var BASE_PULL_SECONDS = 42;

  function simulateCache(result, change) {
    var totals = { rebuild: 0, steps: 0, rebuilt: 0 };
    var stageBroken = [];
    for (var s = 0; s < result.stages.length; s++) {
      var st = result.stages[s];
      var broken = false;
      for (var i = 0; i < st.layers.length; i++) {
        var layer = st.layers[i];
        if (!broken) {
          if (layer.cmd === 'FROM') {
            if (layer.fromStage != null) broken = !!stageBroken[layer.fromStage];
            else if (change.type === 'base') broken = true;
          } else if (layer.cmd === 'COPY' || layer.cmd === 'ADD') {
            if (layer.fromStage != null) {
              if (stageBroken[layer.fromStage]) broken = true;
            } else if (change.type === 'context' && layer.copiedEntries) {
              for (var c = 0; c < layer.copiedEntries.length; c++) {
                if (layer.copiedEntries[c].path === change.path) broken = true;
              }
            }
          }
          if (change.type === 'line' && layer.line >= change.line) broken = true;
        }
        layer.cacheState = broken ? 'rebuild' : 'cached';
        totals.steps += 1;
        if (broken) {
          totals.rebuilt += 1;
          totals.rebuild += layer.seconds;
          if (layer.cmd === 'FROM' && layer.fromStage == null) totals.rebuild += BASE_PULL_SECONDS;
        }
      }
      stageBroken[s] = broken;
    }
    /* Sending the build context happens on every build, cached or not, and on
       a big context it is a visible part of the wall clock. */
    totals.context = 0.4 + 0.008 * result.contextSent;
    totals.rebuild += totals.context;
    return totals;
  }

  /* The list of things a visitor can plausibly change, built from what the
     Dockerfile actually reads. Offering "a file in src/" when nothing copies
     src/ would be noise. */
  function changeOptions(result) {
    var opts = [{ label: 'Nothing — you rebuilt without changing anything', value: 'none',
                  change: { type: 'none' } }];
    var seen = {};
    for (var s = 0; s < result.stages.length; s++) {
      var st = result.stages[s];
      for (var i = 0; i < st.layers.length; i++) {
        var layer = st.layers[i];
        if (!layer.copiedEntries || layer.fromStage != null) continue;
        for (var c = 0; c < layer.copiedEntries.length; c++) {
          var p = layer.copiedEntries[c].path;
          if (seen[p]) continue;
          seen[p] = true;
          var entry = layer.copiedEntries[c].entry;
          opts.push({
            label: (entry && entry.dir ? 'A file inside ' + p + '/' : p) + ' changed',
            value: 'ctx:' + p,
            change: { type: 'context', path: p }
          });
        }
      }
    }
    opts.push({ label: 'The base image published a new build', value: 'base',
                change: { type: 'base' } });
    return opts;
  }

  /* ======================================================================== */
  /*  WORKED EXAMPLES                                                          */
  /* ------------------------------------------------------------------------ */
  /*  Four files that load in one click. The first two are the same Node       */
  /*  application written the way it usually ends up and the way it should be, */
  /*  so the before and after is one click apart rather than an argument.      */
  /* ======================================================================== */

  var SAMPLES = [
    {
      id: 'node-naive',
      name: 'Node, the way it usually happens',
      blurb: 'One stage, no .dockerignore, a deploy key that gets deleted a line later.',
      context: 'node',
      ignore: '',
      dockerfile: [
        '# The image nobody sets out to build, and almost everybody ends up with.',
        'FROM node:20',
        '',
        'RUN apt-get update',
        'RUN apt-get install -y git curl',
        '',
        'WORKDIR /app',
        'COPY . .',
        '',
        '# The private key is needed to fetch a package, then removed.',
        '# Watch what the Union filesystem tab says about "removed".',
        'COPY secrets/deploy_key /root/.ssh/id_rsa',
        'RUN npm install',
        'RUN npm run build',
        'RUN rm -f /root/.ssh/id_rsa',
        '',
        'ENV NODE_ENV=production',
        'EXPOSE 3000',
        'CMD ["node", "dist/server.js"]'
      ].join('\n')
    },
    {
      id: 'node-good',
      name: 'The same app, done properly',
      blurb: 'Three stages, a real .dockerignore, dependencies cached separately from source.',
      context: 'node',
      ignore: [
        'node_modules',
        'dist',
        '.git',
        '.env',
        'secrets',
        '*.md',
        'Dockerfile',
        '.dockerignore'
      ].join('\n'),
      dockerfile: [
        '# Runtime dependencies, on their own, so source edits never reinstall them.',
        'FROM node:20-alpine AS deps',
        'WORKDIR /app',
        'COPY package.json package-lock.json ./',
        'RUN npm ci --omit=dev && npm cache clean --force',
        '',
        '# Everything the build needs, in a stage that is thrown away.',
        'FROM node:20-alpine AS build',
        'WORKDIR /app',
        'COPY package.json package-lock.json ./',
        'RUN npm ci',
        'COPY public ./public',
        'COPY src ./src',
        'RUN npm run build',
        '',
        '# The image that actually ships.',
        'FROM node:20-alpine',
        'ENV NODE_ENV=production',
        'WORKDIR /app',
        'RUN addgroup -S app && adduser -S app -G app',
        'COPY --from=deps /app/node_modules ./node_modules',
        'COPY --from=build /app/dist ./dist',
        'COPY package.json ./',
        'USER app',
        'EXPOSE 3000',
        'CMD ["node", "dist/server.js"]'
      ].join('\n')
    },
    {
      id: 'python',
      name: 'Python, and the apt cache trap',
      blurb: 'Three separate RUNs where one would do, plus a password in ENV.',
      context: 'python',
      ignore: '',
      dockerfile: [
        '# Every line here is one somebody has written in earnest.',
        'FROM python:3.12',
        '',
        '# Three layers. The rm cannot reach into the two above it.',
        'RUN apt-get update',
        'RUN apt-get install -y build-essential libpq-dev git',
        'RUN rm -rf /var/lib/apt/lists/*',
        '',
        'WORKDIR /app',
        'COPY . .',
        'RUN pip install -r requirements.txt',
        '',
        'ARG DB_PASSWORD=hunter2',
        'ENV DB_PASSWORD=$DB_PASSWORD',
        'ENV API_TOKEN=sk-live-4f9c2a',
        '',
        'EXPOSE 8000',
        'CMD ["python", "app/main.py"]'
      ].join('\n')
    },
    {
      id: 'go',
      name: 'Go: 1.1 GB built, 16 MB shipped',
      blurb: 'The clearest case for multi-stage there is. A compiler, and then a binary.',
      context: 'go',
      ignore: ['.git', '*.md', 'Dockerfile'].join('\n'),
      dockerfile: [
        '# The build stage carries a compiler and a module cache. Neither ships.',
        'FROM golang:1.22 AS build',
        'WORKDIR /src',
        'COPY go.mod go.sum ./',
        'RUN go mod download',
        'COPY . .',
        'RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server',
        '',
        '# distroless/static has no shell, no package manager and no libc.',
        '# There is nothing in it to exploit because there is nothing in it.',
        'FROM gcr.io/distroless/static-debian12:nonroot',
        'COPY --from=build /out/server /server',
        'USER nonroot:nonroot',
        'EXPOSE 8080',
        'ENTRYPOINT ["/server"]'
      ].join('\n')
    }
  ];

  /* ======================================================================== */
  /*  PART 2 — THE INTERFACE                                                   */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', bg2: '#0d1729', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";

  var KIND_COLOUR = {
    base: '#38bdf8', package: '#a78bfa', deps: '#fbbf24',
    cache: '#fb7185', artifact: '#34d399', dir: '#22d3ee',
    file: '#7dd3fc', meta: '#475569'
  };

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* Scoped styles, injected rather than added to labs.css: every selector here
     is meaningless outside this one lab, and keeping them next to the code
     that generates the markup is the only way the two stay in step. The CSP
     allows inline stylesheets (style-src 'unsafe-inline') and forbids inline
     script, which is why nothing here is eval'd. */
  var CSS = [
    '#dockerviz .dk-wrap{font:13px/1.6 ' + FONT + ';color:' + C.ink + ';}',
    '#dockerviz .dk-lede{margin:0;padding:11px 13px;border-bottom:1px solid ' + C.line + ';' +
      'background:rgba(15,23,42,0.55);font-size:12px;line-height:1.65;color:' + C.dim + ';}',
    '#dockerviz .dk-lede b{color:' + C.amber + ';font-weight:600;}',

    '#dockerviz .dk-samples{display:flex;flex-wrap:wrap;align-items:center;gap:7px;' +
      'padding:10px 13px;border-bottom:1px solid ' + C.line + ';background:rgba(11,18,32,0.6);}',
    '#dockerviz .dk-samples-label{font-size:11px;letter-spacing:.07em;text-transform:uppercase;' +
      'color:' + C.faint + ';margin-right:2px;}',
    '#dockerviz .dk-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;' +
      'border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;text-align:left;}',
    '#dockerviz .dk-btn:hover{background:#213152;border-color:#40608f;}',
    '#dockerviz .dk-btn:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#dockerviz .dk-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#dockerviz .dk-btn small{display:block;font-size:10.5px;font-weight:400;opacity:.75;}',

    '#dockerviz .dk-body{display:grid;grid-template-columns:minmax(0,22rem) minmax(0,1fr);' +
      'align-items:start;}',
    '#dockerviz .dk-side{padding:12px;border-right:1px solid ' + C.line + ';' +
      'background:rgba(11,18,32,0.55);min-width:0;}',
    '#dockerviz .dk-main{padding:12px;min-width:0;}',
    '@media (max-width:980px){#dockerviz .dk-body{grid-template-columns:minmax(0,1fr);}' +
      '#dockerviz .dk-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',

    '#dockerviz .dk-label{display:block;margin:0 0 5px;font-size:11px;letter-spacing:.06em;' +
      'text-transform:uppercase;color:' + C.faint + ';}',
    '#dockerviz .dk-label+.dk-hint{margin:-3px 0 5px;}',
    '#dockerviz .dk-hint{margin:5px 0 0;font-size:11px;line-height:1.6;color:' + C.faint + ';}',
    '#dockerviz .dk-code,#dockerviz .dk-ign{width:100%;box-sizing:border-box;display:block;' +
      'font:12.5px/1.65 ' + FONT + ';color:#d7e2f4;background:#08101d;border:1px solid #22314b;' +
      'border-radius:8px;padding:9px 10px;resize:vertical;tab-size:2;white-space:pre;overflow:auto;}',
    '#dockerviz .dk-code{min-height:290px;}',
    '#dockerviz .dk-ign{min-height:96px;}',
    '#dockerviz .dk-code:focus-visible,#dockerviz .dk-ign:focus-visible,' +
      '#dockerviz .dk-select:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#dockerviz .dk-select{width:100%;box-sizing:border-box;font:inherit;font-size:12px;' +
      'color:' + C.ink + ';background:' + C.bg2 + ';border:1px solid #2a3d5c;border-radius:7px;padding:6px 8px;}',
    '#dockerviz .dk-group{margin:0 0 14px;}',

    '#dockerviz .dk-ctx{margin:6px 0 0;border:1px solid ' + C.line + ';border-radius:8px;overflow:hidden;}',
    '#dockerviz .dk-ctx-row{display:flex;gap:8px;align-items:baseline;padding:4px 8px;' +
      'border-bottom:1px solid rgba(28,43,68,0.6);font-size:11.5px;}',
    '#dockerviz .dk-ctx-row:last-child{border-bottom:0;}',
    '#dockerviz .dk-ctx-p{flex:1;min-width:0;overflow-wrap:anywhere;color:' + C.ink + ';}',
    '#dockerviz .dk-ctx-s{flex:0 0 auto;color:' + C.dim + ';}',
    '#dockerviz .dk-ctx-row.is-ign .dk-ctx-p{color:' + C.faint + ';text-decoration:line-through;}',
    '#dockerviz .dk-ctx-row.is-ign .dk-ctx-s{color:' + C.faint + ';}',
    '#dockerviz .dk-ctx-row.is-secret .dk-ctx-p{color:' + C.red + ';}',
    '#dockerviz .dk-ctx-tag{flex:0 0 auto;font-size:10px;letter-spacing:.05em;color:' + C.faint + ';}',

    '#dockerviz .dk-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));' +
      'gap:8px;margin:0 0 12px;}',
    '#dockerviz .dk-tile{border:1px solid ' + C.line + ';border-radius:9px;padding:9px 11px;' +
      'background:rgba(13,23,41,0.75);min-width:0;}',
    '#dockerviz .dk-tile-k{margin:0;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;' +
      'color:' + C.faint + ';}',
    '#dockerviz .dk-tile-v{margin:2px 0 0;font-size:19px;font-weight:700;color:' + C.cyan + ';' +
      'line-height:1.25;overflow-wrap:anywhere;}',
    '#dockerviz .dk-tile-n{margin:2px 0 0;font-size:11px;line-height:1.5;color:' + C.dim + ';}',
    '#dockerviz .dk-tile.is-bad .dk-tile-v{color:' + C.red + ';}',
    '#dockerviz .dk-tile.is-good .dk-tile-v{color:' + C.green + ';}',

    '#dockerviz .dk-errors{margin:0 0 12px;padding:9px 11px;border-radius:9px;' +
      'border:1px solid rgba(248,113,113,.4);background:rgba(127,29,29,.22);color:' + C.red + ';' +
      'font-size:12px;line-height:1.65;}',
    '#dockerviz .dk-errors[hidden]{display:none;}',
    '#dockerviz .dk-errors p{margin:0 0 4px;}',
    '#dockerviz .dk-errors p:last-child{margin:0;}',

    '#dockerviz .dk-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid ' + C.line + ';}',
    '#dockerviz .dk-tab{font:inherit;font-size:12px;color:' + C.dim + ';background:transparent;' +
      'border:0;border-bottom:2px solid transparent;padding:8px 11px;cursor:pointer;}',
    '#dockerviz .dk-tab:hover{color:' + C.ink + ';}',
    '#dockerviz .dk-tab[aria-selected="true"]{color:' + C.cyan + ';border-bottom-color:' + C.cyan + ';font-weight:700;}',
    '#dockerviz .dk-tab:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:-2px;}',
    '#dockerviz .dk-tab-n{display:inline-block;margin-left:5px;padding:0 5px;border-radius:9px;' +
      'font-size:10.5px;background:#1e293b;color:' + C.dim + ';}',
    '#dockerviz .dk-tab-n.is-bad{background:#7f1d1d;color:#fee2e2;}',
    '#dockerviz .dk-panel{padding:12px 0 0;}',
    '#dockerviz .dk-panel[hidden]{display:none;}',
    '#dockerviz .dk-panel:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:8px;}',
    '#dockerviz .dk-p{margin:0 0 10px;font-size:12.5px;line-height:1.7;color:' + C.dim + ';max-width:56rem;}',
    '#dockerviz .dk-p b{color:' + C.ink + ';font-weight:600;}',
    '#dockerviz .dk-h{margin:16px 0 7px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;' +
      'color:' + C.faint + ';}',
    '#dockerviz .dk-h:first-child{margin-top:0;}',

    '#dockerviz .dk-stage{margin:0 0 14px;border:1px solid ' + C.line + ';border-radius:10px;overflow:hidden;}',
    '#dockerviz .dk-stage-head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;' +
      'padding:8px 11px;background:rgba(15,23,42,0.65);border-bottom:1px solid ' + C.line + ';}',
    '#dockerviz .dk-stage-t{font-size:12.5px;font-weight:700;color:' + C.ink + ';}',
    '#dockerviz .dk-stage-s{font-size:11.5px;color:' + C.dim + ';margin-left:auto;}',
    '#dockerviz .dk-badge{font-size:10px;letter-spacing:.06em;text-transform:uppercase;' +
      'padding:2px 7px;border-radius:20px;border:1px solid currentColor;}',
    '#dockerviz .dk-badge.is-ship{color:' + C.green + ';}',
    '#dockerviz .dk-badge.is-feed{color:' + C.cyan + ';}',
    '#dockerviz .dk-badge.is-drop{color:' + C.faint + ';}',

    '#dockerviz .dk-layer{display:flex;width:100%;box-sizing:border-box;gap:8px;align-items:center;' +
      'font:inherit;text-align:left;background:transparent;border:0;' +
      'border-bottom:1px solid rgba(28,43,68,0.55);padding:6px 11px;cursor:pointer;color:' + C.ink + ';}',
    '#dockerviz .dk-layer:hover{background:rgba(56,189,248,0.07);}',
    '#dockerviz .dk-layer:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:-2px;}',
    '#dockerviz .dk-layer[aria-expanded="true"]{background:rgba(56,189,248,0.1);}',
    '#dockerviz .dk-l-n{flex:0 0 1.8rem;font-size:11px;color:' + C.faint + ';}',
    '#dockerviz .dk-l-cmd{flex:0 0 4.2rem;font-size:10.5px;font-weight:700;letter-spacing:.05em;color:' + C.violet + ';}',
    '#dockerviz .dk-l-txt{flex:1 1 12rem;min-width:0;font-size:12px;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;color:' + C.ink + ';}',
    '#dockerviz .dk-l-bar{flex:0 0 7rem;height:9px;border-radius:5px;background:#111c2f;overflow:hidden;}',
    '#dockerviz .dk-l-bar i{display:block;height:100%;border-radius:5px;}',
    '#dockerviz .dk-l-size{flex:0 0 4.6rem;text-align:right;font-size:11.5px;color:' + C.dim + ';}',
    '#dockerviz .dk-layer.is-meta .dk-l-txt{color:' + C.faint + ';}',
    '#dockerviz .dk-layer.is-meta .dk-l-size{color:' + C.faint + ';}',
    '#dockerviz .dk-l-flag{flex:0 0 auto;font-size:10px;padding:1px 6px;border-radius:20px;' +
      'border:1px solid currentColor;}',
    '#dockerviz .dk-l-flag.is-cached{color:' + C.green + ';}',
    '#dockerviz .dk-l-flag.is-rebuild{color:' + C.amber + ';}',
    '#dockerviz .dk-l-flag.is-white{color:' + C.red + ';}',
    '@media (max-width:640px){#dockerviz .dk-l-bar{display:none;}' +
      '#dockerviz .dk-l-cmd{flex:0 0 3.4rem;}}',

    '#dockerviz .dk-detail{padding:9px 11px 12px 3.2rem;background:rgba(8,16,29,0.75);' +
      'border-bottom:1px solid rgba(28,43,68,0.55);font-size:11.5px;line-height:1.7;color:' + C.dim + ';}',
    '#dockerviz .dk-detail[hidden]{display:none;}',
    '#dockerviz .dk-detail code{color:' + C.cyan + ';overflow-wrap:anywhere;}',
    '#dockerviz .dk-detail ul{margin:4px 0 8px;padding-left:1.1rem;}',
    '#dockerviz .dk-detail li{margin:0 0 2px;overflow-wrap:anywhere;}',
    '#dockerviz .dk-detail li b{color:' + C.ink + ';font-weight:600;}',
    '#dockerviz .dk-detail .dk-note{color:' + C.amber + ';}',
    '#dockerviz .dk-detail .dk-white{color:' + C.red + ';}',
    '@media (max-width:640px){#dockerviz .dk-detail{padding-left:11px;}}',

    '#dockerviz .dk-table{width:100%;border-collapse:collapse;font-size:11.5px;}',
    '#dockerviz .dk-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';' +
      'border-bottom:1px solid ' + C.line + ';}',
    '#dockerviz .dk-table td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,0.55);' +
      'color:' + C.ink + ';vertical-align:top;overflow-wrap:anywhere;}',
    '#dockerviz .dk-table td.dk-num{text-align:right;white-space:nowrap;color:' + C.dim + ';}',
    '#dockerviz .dk-table tr.is-gone td{color:' + C.red + ';}',
    '#dockerviz .dk-table tr.is-shadow td{color:' + C.amber + ';}',
    '#dockerviz .dk-tablewrap{overflow-x:auto;border:1px solid ' + C.line + ';border-radius:9px;}',
    '#dockerviz .dk-tablewrap:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',

    '#dockerviz .dk-call{margin:12px 0;padding:10px 12px;border-radius:9px;' +
      'border:1px solid rgba(248,113,113,.4);background:rgba(127,29,29,.2);}',
    '#dockerviz .dk-call.is-ok{border-color:rgba(52,211,153,.4);background:rgba(6,78,59,.22);}',
    '#dockerviz .dk-call h4{margin:0 0 6px;font-size:12.5px;color:' + C.red + ';}',
    '#dockerviz .dk-call.is-ok h4{color:' + C.green + ';}',
    '#dockerviz .dk-call p{margin:0 0 7px;font-size:12px;line-height:1.7;color:#e6edf8;}',
    '#dockerviz .dk-call p:last-child{margin:0;}',
    '#dockerviz .dk-pre{margin:7px 0 0;padding:9px 10px;border-radius:8px;background:#050b16;' +
      'border:1px solid ' + C.line + ';font-size:11.5px;line-height:1.75;color:' + C.cyan + ';' +
      'white-space:pre;overflow-x:auto;}',
    '#dockerviz .dk-pre:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',

    '#dockerviz .dk-find{margin:0 0 9px;padding:10px 12px;border-radius:9px;' +
      'border:1px solid ' + C.line + ';background:rgba(13,23,41,0.7);border-left-width:3px;}',
    '#dockerviz .dk-find.lv-high{border-left-color:' + C.red + ';}',
    '#dockerviz .dk-find.lv-medium{border-left-color:' + C.amber + ';}',
    '#dockerviz .dk-find.lv-low{border-left-color:' + C.blue + ';}',
    '#dockerviz .dk-find-h{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;margin:0 0 5px;}',
    '#dockerviz .dk-find-t{font-size:12.5px;font-weight:700;color:' + C.ink + ';}',
    '#dockerviz .dk-find-lv{font-size:10px;letter-spacing:.07em;text-transform:uppercase;' +
      'padding:1px 7px;border-radius:20px;border:1px solid currentColor;}',
    '#dockerviz .dk-find.lv-high .dk-find-lv{color:' + C.red + ';}',
    '#dockerviz .dk-find.lv-medium .dk-find-lv{color:' + C.amber + ';}',
    '#dockerviz .dk-find.lv-low .dk-find-lv{color:' + C.blue + ';}',
    '#dockerviz .dk-find-line{margin-left:auto;font-size:11px;color:' + C.faint + ';}',
    '#dockerviz .dk-find-b{margin:0 0 6px;font-size:12px;line-height:1.7;color:' + C.dim + ';}',
    '#dockerviz .dk-find-f{margin:0;font-size:12px;line-height:1.7;color:#c7f9e5;}',
    '#dockerviz .dk-find-f b{color:' + C.green + ';font-weight:600;}',

    '#dockerviz .dk-cacherow{display:flex;flex-wrap:wrap;gap:9px;align-items:flex-end;margin:0 0 12px;}',
    '#dockerviz .dk-cachefield{flex:1 1 18rem;min-width:0;}',

    '#dockerviz .dk-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
      'clip:rect(0 0 0 0);white-space:nowrap;border:0;}',
    '#dockerviz .dk-empty{margin:0;padding:14px;border:1px dashed ' + C.line + ';border-radius:9px;' +
      'font-size:12px;line-height:1.7;color:' + C.faint + ';}'
  ].join('');

  /* ======================================================================== */
  /*  THE WIDGET                                                               */
  /* ======================================================================== */

  var TABS = [
    { id: 'layers',   label: 'Layers' },
    { id: 'union',    label: 'Union filesystem' },
    { id: 'cache',    label: 'Cache' },
    { id: 'findings', label: 'Findings' }
  ];

  function Docker(rootEl) {
    this.root = rootEl;
    this.active = 0;
    this.change = { type: 'none' };
    this.changeValue = 'none';
    this.timer = null;
    this.uid = 0;
    this.build();
    this.loadSample(SAMPLES[0]);
  }

  Docker.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'dk-wrap');

    var lede = E('p', 'dk-lede');
    lede.appendChild(document.createTextNode('Every size on this page is a '));
    var b = E('b', null, 'modelled estimate, not a build');
    lede.appendChild(b);
    lede.appendChild(document.createTextNode(
      '. Nothing here runs Docker or opens a network connection — the numbers come from ' +
      'measured base-image and package sizes held in this file. They are close enough to make ' +
      'the right decision and wrong enough that you should never quote them.'));
    wrap.appendChild(lede);

    /* --- samples --- */
    var samples = E('div', 'dk-samples');
    samples.setAttribute('role', 'group');
    samples.setAttribute('aria-label', 'Worked examples');
    samples.appendChild(E('span', 'dk-samples-label', 'Load an example'));
    this.sampleButtons = SAMPLES.map(function (s) {
      var btn = E('button', 'dk-btn');
      btn.type = 'button';
      btn.appendChild(document.createTextNode(s.name));
      btn.appendChild(E('small', null, s.blurb));
      btn.addEventListener('click', function () { self.loadSample(s); });
      samples.appendChild(btn);
      return btn;
    });
    wrap.appendChild(samples);

    var body = E('div', 'dk-body');
    var side = E('div', 'dk-side');
    var main = E('div', 'dk-main');

    /* --- editors --- */
    var g1 = E('div', 'dk-group');
    var lab1 = E('label', 'dk-label', 'Dockerfile');
    lab1.setAttribute('for', 'dk-file');
    g1.appendChild(lab1);
    this.code = E('textarea', 'dk-code');
    this.code.id = 'dk-file';
    this.code.setAttribute('spellcheck', 'false');
    this.code.setAttribute('autocapitalize', 'off');
    this.code.setAttribute('autocorrect', 'off');
    this.code.setAttribute('wrap', 'off');
    g1.appendChild(this.code);
    g1.appendChild(E('p', 'dk-hint',
      'Edit freely. Line continuations and comments are handled; heredocs are not.'));
    side.appendChild(g1);

    var g2 = E('div', 'dk-group');
    var lab2 = E('label', 'dk-label', '.dockerignore');
    lab2.setAttribute('for', 'dk-ignore');
    g2.appendChild(lab2);
    this.ignore = E('textarea', 'dk-ign');
    this.ignore.id = 'dk-ignore';
    this.ignore.setAttribute('spellcheck', 'false');
    this.ignore.setAttribute('wrap', 'off');
    g2.appendChild(this.ignore);
    g2.appendChild(E('p', 'dk-hint',
      'One pattern per line. * and ** and a leading ! all work; character classes do not.'));
    side.appendChild(g2);

    /* --- context --- */
    var g3 = E('div', 'dk-group');
    var lab3 = E('label', 'dk-label', 'Build context');
    lab3.setAttribute('for', 'dk-context');
    g3.appendChild(lab3);
    this.contextSel = E('select', 'dk-select');
    this.contextSel.id = 'dk-context';
    ['node', 'python', 'go'].forEach(function (key) {
      var opt = E('option', null, CONTEXTS[key].label);
      opt.value = key;
      self.contextSel.appendChild(opt);
    });
    this.contextSel.addEventListener('change', function () { self.recompute(); });
    g3.appendChild(this.contextSel);
    g3.appendChild(E('p', 'dk-hint',
      'A COPY costs whatever is in the context, so the context is a real object here rather ' +
      'than an assumption. Struck-through entries are excluded by .dockerignore.'));
    this.ctxHost = E('div', 'dk-ctx');
    g3.appendChild(this.ctxHost);
    side.appendChild(g3);

    /* --- summary, errors, tabs --- */
    this.summary = E('div', 'dk-summary');
    main.appendChild(this.summary);

    this.errors = E('div', 'dk-errors');
    this.errors.setAttribute('role', 'alert');
    this.errors.hidden = true;
    main.appendChild(this.errors);

    var tabs = E('div', 'dk-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Analysis views');
    this.tabButtons = [];
    this.tabCounts = [];
    this.panels = [];
    TABS.forEach(function (t, i) {
      var btn = E('button', 'dk-tab');
      btn.type = 'button';
      btn.id = 'dk-tab-' + t.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'dk-panel-' + t.id);
      btn.appendChild(document.createTextNode(t.label));
      var count = E('span', 'dk-tab-n');
      count.hidden = true;
      btn.appendChild(count);
      btn.addEventListener('click', function () { self.select(i); });
      btn.addEventListener('keydown', function (ev) { self.tabKey(ev, i); });
      tabs.appendChild(btn);
      self.tabButtons.push(btn);
      self.tabCounts.push(count);

      var panel = E('div', 'dk-panel');
      panel.id = 'dk-panel-' + t.id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'dk-tab-' + t.id);
      panel.tabIndex = 0;
      self.panels.push(panel);
    });
    main.appendChild(tabs);
    this.panels.forEach(function (p) { main.appendChild(p); });

    this.status = E('p', 'dk-sr');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    main.appendChild(this.status);

    body.appendChild(side);
    body.appendChild(main);
    wrap.appendChild(body);
    this.root.appendChild(wrap);

    /* Typing should not re-parse on every keystroke: on a long Dockerfile the
       whole model plus four panels is rebuilt, and doing it per character
       makes the textarea feel sticky. A quarter of a second after the last
       key is soon enough to feel live and slow enough to stay smooth. */
    function debounce() {
      if (self.timer) clearTimeout(self.timer);
      self.timer = setTimeout(function () { self.recompute(); }, 250);
    }
    this.code.addEventListener('input', debounce);
    this.ignore.addEventListener('input', debounce);

    this.select(0);
  };

  Docker.prototype.tabKey = function (ev, i) {
    var next = -1;
    if (ev.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (ev.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    this.select(next);
    this.tabButtons[next].focus();
  };

  Docker.prototype.select = function (i) {
    this.active = i;
    for (var t = 0; t < TABS.length; t++) {
      var on = t === i;
      this.tabButtons[t].setAttribute('aria-selected', on ? 'true' : 'false');
      this.tabButtons[t].tabIndex = on ? 0 : -1;
      this.panels[t].hidden = !on;
    }
  };

  Docker.prototype.loadSample = function (sample) {
    this.code.value = sample.dockerfile;
    this.ignore.value = sample.ignore;
    this.contextSel.value = sample.context;
    this.changeValue = 'none';
    this.change = { type: 'none' };
    for (var i = 0; i < SAMPLES.length; i++) {
      this.sampleButtons[i].className = SAMPLES[i] === sample ? 'dk-btn on' : 'dk-btn';
    }
    this.recompute();
  };

  Docker.prototype.recompute = function () {
    for (var i = 0; i < this.sampleButtons.length; i++) {
      /* The moment the file is edited it is no longer that sample, and leaving
         the button lit says otherwise. */
      if (this.code.value !== SAMPLES[i].dockerfile) this.sampleButtons[i].className = 'dk-btn';
    }
    var result = build(this.code.value, this.ignore.value, this.contextSel.value);
    this.result = result;
    this.cache = simulateCache(result, this.change);
    this.renderContext(result);
    this.renderSummary(result);
    this.renderErrors(result);
    this.renderLayers(result);
    this.renderUnion(result);
    this.renderCache(result);
    this.renderFindings(result);
    this.announce(result);
  };

  Docker.prototype.announce = function (result) {
    if (result.empty || !result.stages.length) {
      this.status.textContent = 'No image: the Dockerfile is empty or has no FROM.';
      return;
    }
    var high = 0;
    for (var i = 0; i < result.findings.length; i++) if (result.findings[i].level === 'high') high++;
    this.status.textContent = 'Final image ' + fmtSize(result.shippedSize) + ' across ' +
      result.layerCount + ' layers. ' + fmtSize(result.shippedWaste) + ' is unreachable. ' +
      result.findings.length + ' findings, ' + high + ' of them serious.';
  };

  /* ======================================================================== */
  /*  RENDERERS                                                                */
  /* ======================================================================== */

  Docker.prototype.renderContext = function (result) {
    clear(this.ctxHost);
    for (var i = 0; i < result.context.length; i++) {
      var e = result.context[i];
      var cls = 'dk-ctx-row';
      if (e.ignored) cls += ' is-ign';
      else if (e.secret) cls += ' is-secret';
      var row = E('div', cls);
      row.appendChild(E('span', 'dk-ctx-p', e.path + (e.dir ? '/' : '')));
      if (e.secret) row.appendChild(E('span', 'dk-ctx-tag', 'secret'));
      else if (e.leak) row.appendChild(E('span', 'dk-ctx-tag', 'history'));
      else if (e.built) row.appendChild(E('span', 'dk-ctx-tag', 'built locally'));
      row.appendChild(E('span', 'dk-ctx-s', fmtSize(e.size)));
      this.ctxHost.appendChild(row);
    }
    var foot = E('div', 'dk-ctx-row');
    foot.appendChild(E('span', 'dk-ctx-p', 'Sent to the builder'));
    foot.appendChild(E('span', 'dk-ctx-s', fmtSize(result.contextSent) + ' of ' +
      fmtSize(result.contextSize)));
    this.ctxHost.appendChild(foot);
  };

  function tile(host, key, value, note, cls) {
    var t = E('div', 'dk-tile' + (cls ? ' ' + cls : ''));
    t.appendChild(E('p', 'dk-tile-k', key));
    t.appendChild(E('p', 'dk-tile-v', value));
    if (note) t.appendChild(E('p', 'dk-tile-n', note));
    host.appendChild(t);
    return t;
  }

  Docker.prototype.renderSummary = function (result) {
    clear(this.summary);
    if (result.empty || !result.stages.length) return;

    var wastePct = result.shippedSize > 0
      ? Math.round(result.shippedWaste / result.shippedSize * 100) : 0;
    var high = 0;
    for (var i = 0; i < result.findings.length; i++) if (result.findings[i].level === 'high') high++;

    tile(this.summary, 'Image you would push', fmtSize(result.shippedSize),
      'The number docker images prints. Uncompressed, on disk.');
    tile(this.summary, 'Bytes actually built', fmtSize(result.builtSize),
      result.stages.length > 1
        ? fmtSize(result.discarded) + ' of that is thrown away with the earlier stages'
        : 'One stage, so everything built also ships',
      result.discarded > 50 ? 'is-good' : '');
    tile(this.summary, 'Paid for, unreachable', fmtSize(result.shippedWaste),
      wastePct + ' per cent of the image is deleted or overwritten in a later layer',
      result.shippedWaste > 5 ? 'is-bad' : 'is-good');
    tile(this.summary, 'Layers', String(result.layerCount),
      'in the final stage, ' + result.stages.length + ' stage' +
      (result.stages.length === 1 ? '' : 's') + ' in the file');
    tile(this.summary, 'Findings', String(result.findings.length),
      high + ' serious', high ? 'is-bad' : 'is-good');

    for (var t = 0; t < TABS.length; t++) {
      var badge = this.tabCounts[t];
      if (TABS[t].id === 'findings' && result.findings.length) {
        badge.textContent = String(result.findings.length);
        badge.className = high ? 'dk-tab-n is-bad' : 'dk-tab-n';
        badge.hidden = false;
      } else if (TABS[t].id === 'layers' && result.layerCount) {
        badge.textContent = String(result.layerCount);
        badge.className = 'dk-tab-n';
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  };

  Docker.prototype.renderErrors = function (result) {
    clear(this.errors);
    var msgs = result.errors.slice(0);
    if (result.empty) msgs.push('There is nothing to build yet. Load an example, or start with FROM.');
    if (!msgs.length) { this.errors.hidden = true; return; }
    for (var i = 0; i < msgs.length; i++) this.errors.appendChild(E('p', null, msgs[i]));
    this.errors.hidden = false;
  };

  /* --- layers -------------------------------------------------------------- */

  Docker.prototype.renderLayers = function (result) {
    var self = this;
    var host = this.panels[0];
    clear(host);
    if (!result.stages.length) {
      host.appendChild(E('p', 'dk-empty', 'No stages to draw.'));
      return;
    }

    var intro = E('p', 'dk-p');
    intro.appendChild(document.createTextNode(
      'Every row is one step. FROM, RUN, COPY and ADD write a filesystem layer; everything ' +
      'else writes only image configuration, costs nothing on disk, and is still a cache step. ' +
      'The bar is that layer’s size against the largest one in the file. Open any row for ' +
      'what it wrote, what it deleted, and where I am guessing.'));
    host.appendChild(intro);

    var max = 1;
    var s, i;
    for (s = 0; s < result.stages.length; s++) {
      for (i = 0; i < result.stages[s].layers.length; i++) {
        if (result.stages[s].layers[i].size > max) max = result.stages[s].layers[i].size;
      }
    }

    for (s = 0; s < result.stages.length; s++) {
      host.appendChild(this.stageBlock(result, result.stages[s], max));
    }

    var note = E('p', 'dk-p');
    note.appendChild(document.createTextNode(
      'The base image row collapses what is really several layers into one, because their ' +
      'individual sizes teach nothing. Sizes are uncompressed, which is what your disk sees; ' +
      'the figure on a registry page is the compressed download and is roughly a third of it.'));
    host.appendChild(note);
  };

  Docker.prototype.stageBlock = function (result, stage, max) {
    var self = this;
    var block = E('div', 'dk-stage');
    var head = E('div', 'dk-stage-head');
    var title = 'Stage ' + stage.index + (stage.alias ? ' — ' + stage.alias : '');
    head.appendChild(E('span', 'dk-stage-t', title));
    head.appendChild(E('span', 'dk-badge ' + (stage.shipped ? 'is-ship' : (stage.contributes ? 'is-feed' : 'is-drop')),
      stage.shipped ? 'ships' : (stage.contributes ? 'feeds the final image' : 'discarded')));
    head.appendChild(E('span', 'dk-stage-s',
      (stage.baseRef || 'no base') + ' · ' + fmtSize(stage.builtSize) + ' built · ' +
      fmtSize(stage.liveSize) + ' visible'));
    block.appendChild(head);

    for (var i = 0; i < stage.layers.length; i++) {
      var layer = stage.layers[i];
      var detailId = 'dk-d-' + (this.uid++);

      var row = E('button', 'dk-layer' + (layer.meta ? ' is-meta' : ''));
      row.type = 'button';
      row.setAttribute('aria-expanded', 'false');
      row.setAttribute('aria-controls', detailId);
      row.appendChild(E('span', 'dk-l-n', String(i)));
      row.appendChild(E('span', 'dk-l-cmd', layer.cmd));

      var txt = E('span', 'dk-l-txt', truncate(layer.raw, 96));
      txt.title = layer.raw;
      row.appendChild(txt);

      if (layer.whiteouts.length) row.appendChild(E('span', 'dk-l-flag is-white', 'whiteout'));
      row.appendChild(E('span', 'dk-l-flag is-' + (layer.cacheState === 'cached' ? 'cached' : 'rebuild'),
        layer.cacheState === 'cached' ? 'cached' : 'rebuild'));

      var bar = E('span', 'dk-l-bar');
      var fill = E('i');
      fill.style.width = Math.max(layer.size > 0 ? 2 : 0, layer.size / max * 100) + '%';
      fill.style.background = KIND_COLOUR[layer.adds.length ? layer.adds[0].kind : 'meta'] || C.blue;
      bar.appendChild(fill);
      row.appendChild(bar);

      row.appendChild(E('span', 'dk-l-size', layer.meta && !layer.size ? '0 B' : fmtSize(layer.size)));

      var detail = this.layerDetail(layer);
      detail.id = detailId;
      detail.hidden = true;

      (function (r, d) {
        r.addEventListener('click', function () {
          var open = r.getAttribute('aria-expanded') === 'true';
          r.setAttribute('aria-expanded', open ? 'false' : 'true');
          d.hidden = open;
        });
      })(row, detail);

      block.appendChild(row);
      block.appendChild(detail);
    }
    return block;
  };

  Docker.prototype.layerDetail = function (layer) {
    var self = this;
    var d = E('div', 'dk-detail');
    var i;

    if (layer.meta && !layer.size) {
      d.appendChild(E('p', null,
        'Metadata only. This writes nothing to the filesystem — it changes the image ' +
        'configuration, which travels with the image and is printed by docker inspect. ' +
        'It is still a cache step, so a change here invalidates everything below it.'));
    }

    if (layer.adds.length) {
      d.appendChild(E('p', null, 'Written by this layer:'));
      var ul = E('ul');
      for (i = 0; i < layer.adds.length; i++) {
        var a = layer.adds[i];
        var li = E('li');
        li.appendChild(E('b', null, a.path));
        li.appendChild(document.createTextNode(' — ' + fmtSize(a.size)));
        if (a.secret) li.appendChild(E('span', 'dk-white', '  · a credential'));
        if (a.note) li.appendChild(E('span', 'dk-note', '  · ' + a.note));
        ul.appendChild(li);
      }
      d.appendChild(ul);
    }

    if (layer.sameLayerRemoved) {
      d.appendChild(E('p', 'dk-note',
        fmtSize(layer.sameLayerRemoved) + ' was created and deleted inside this one layer, so ' +
        'it never reached the image at all. That is the difference a && makes.'));
    }

    if (layer.whiteouts.length) {
      d.appendChild(E('p', 'dk-white', 'Deleted here, and still in the image:'));
      var wl = E('ul');
      for (i = 0; i < layer.whiteouts.length; i++) {
        var w = layer.whiteouts[i];
        var wli = E('li');
        wli.appendChild(E('b', null, w.path));
        wli.appendChild(document.createTextNode(' — ' + fmtSize(w.size) + ', written by the layer ' +
          'at line ' + w.layer.line + ', which is already committed. This layer only records ' +
          'that the file is no longer visible.'));
        wl.appendChild(wli);
      }
      d.appendChild(wl);
    }

    for (i = 0; i < layer.notes.length; i++) {
      d.appendChild(E('p', 'dk-note', layer.notes[i]));
    }

    if (layer.usedMount) {
      d.appendChild(E('p', null,
        'This uses --mount, so whatever it mounts is available during the RUN and is not ' +
        'committed into the layer. That is the right way to handle a build secret or a ' +
        'package cache.'));
    }

    d.appendChild(E('p', null, 'Modelled build time for this step: ' + fmtTime(layer.seconds) +
      (layer.cacheState === 'cached' ? ' — skipped on the rebuild you selected in the Cache tab.'
                                     : ' — spent on the rebuild you selected in the Cache tab.')));

    if (layer.line) {
      var btn = E('button', 'dk-btn');
      btn.type = 'button';
      btn.textContent = 'Edit line ' + layer.line + ' and see what has to rebuild';
      btn.addEventListener('click', function () {
        self.change = { type: 'line', line: layer.line };
        self.changeValue = 'line:' + layer.line;
        self.recompute();
        self.select(2);
        self.panels[2].focus();
      });
      d.appendChild(btn);
    }
    return d;
  };

  /* --- union filesystem ------------------------------------------------------ */

  Docker.prototype.renderUnion = function (result) {
    var host = this.panels[1];
    clear(host);
    if (!result.stages.length) {
      host.appendChild(E('p', 'dk-empty', 'Nothing to show yet.'));
      return;
    }
    var last = result.stages[result.stages.length - 1];

    var p1 = E('p', 'dk-p');
    p1.appendChild(document.createTextNode(
      'A layer is a diff, and a diff can only add. When a later layer deletes a file, it does ' +
      'not reach into the earlier layer — that one is already committed and immutable, and it ' +
      'may be shared with other images. All the delete can do is write a whiteout marker saying ' +
      'the file is no longer visible. The bytes stay, they still count towards the image size, ' +
      'and anyone holding the image can still read them.'));
    host.appendChild(p1);

    var p2 = E('p', 'dk-p');
    p2.appendChild(document.createTextNode('This table is the final stage only. '));
    var strong = E('b', null, 'In the final image');
    p2.appendChild(strong);
    p2.appendChild(document.createTextNode(
      ' means a running container can see it. The other two states are bytes you are paying ' +
      'for and cannot reach.'));
    host.appendChild(p2);

    var wrap = E('div', 'dk-tablewrap');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Every path written by the final stage');
    var table = E('table', 'dk-table');
    var thead = E('thead');
    var hr = E('tr');
    ['Path', 'Size', 'Written by', 'State in the shipped image'].forEach(function (h, i) {
      var th = E('th', i === 1 ? 'dk-num' : null, h);
      th.scope = 'col';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = E('tbody');
    var extractable = [];
    var wasted = 0;
    for (var i = 0; i < last.state.all.length; i++) {
      var art = last.state.all[i];
      if (art.neverWritten) continue;
      var cls = '', stateText;
      if (art.deletedBy) {
        cls = 'is-gone';
        stateText = 'Deleted at line ' + art.deletedBy.line + ' — still in the layer, still extractable';
        wasted += art.size;
        extractable.push(art);
      } else if (art.shadowedBy) {
        cls = 'is-shadow';
        stateText = 'Overwritten at line ' + art.shadowedBy.line + ' — the old copy is still in the layer';
        wasted += art.size;
        if (art.secret) extractable.push(art);
      } else {
        stateText = 'In the final image';
      }
      var tr = E('tr', cls);
      var tdPath = E('td');
      tdPath.appendChild(document.createTextNode(art.path));
      if (art.secret) tdPath.appendChild(E('b', null, '  (credential)'));
      tr.appendChild(tdPath);
      tr.appendChild(E('td', 'dk-num', fmtSize(art.size)));
      tr.appendChild(E('td', null, art.layer.cmd + ' at line ' + art.layer.line));
      tr.appendChild(E('td', null, stateText));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);

    if (!wasted) {
      var ok = E('div', 'dk-call is-ok');
      ok.appendChild(E('h4', null, 'Nothing is stranded in this image'));
      ok.appendChild(E('p', null,
        'Every byte in a layer is still visible in the final union. Nothing was written and ' +
        'then deleted or overwritten by a later layer, which is the state you want and a rarer ' +
        'one than it sounds.'));
      host.appendChild(ok);
      return;
    }

    var call = E('div', 'dk-call');
    call.appendChild(E('h4', null, fmtSize(wasted) + ' is in the image and cannot be reached'));
    call.appendChild(E('p', null,
      'It was written by one layer and hidden by another. It downloads with every pull, it ' +
      'occupies disk on every node that runs the image, and it does nothing.'));

    if (extractable.length) {
      var names = [];
      for (var k = 0; k < extractable.length; k++) {
        if (extractable[k].secret) names.push(extractable[k].path);
      }
      if (names.length) {
        call.appendChild(E('p', null,
          'Worse: ' + names.join(', ') + ' is a credential, and deleting it in a later ' +
          'instruction did not remove it. Anyone with the image can pull the layer out and read ' +
          'it, with nothing more exotic than tar:'));
        var pre = E('pre', 'dk-pre');
        pre.tabIndex = 0;
        pre.textContent = [
          'docker save myimage:latest -o image.tar',
          'mkdir img && tar -xf image.tar -C img',
          '',
          '# each blob under blobs/sha256/ is one layer, as a tarball',
          'for f in img/blobs/sha256/*; do',
          '  tar -tf "$f" 2>/dev/null | grep -i "id_rsa\\|\\.env\\|\\.npmrc" && echo "  ^ in $f"',
          'done'
        ].join('\n');
        call.appendChild(pre);
        call.appendChild(E('p', null,
          'That runs offline, against a file. There is no server to ask for permission. If a ' +
          'credential has ever been in a layer of an image you pushed, treat it as public and ' +
          'rotate it — squashing the image afterwards does not help anyone who already pulled it.'));
      }
    }
    call.appendChild(E('p', null,
      'The fix is always the same shape: the file must never enter a committed layer. Join the ' +
      'create and the delete into one RUN with &&, or use RUN --mount=type=secret so the ' +
      'credential is never part of the filesystem being committed.'));
    host.appendChild(call);
  };

  /* --- cache ------------------------------------------------------------------- */

  Docker.prototype.renderCache = function (result) {
    var self = this;
    var host = this.panels[2];
    clear(host);
    if (!result.stages.length) {
      host.appendChild(E('p', 'dk-empty', 'Nothing to rebuild yet.'));
      return;
    }

    var p = E('p', 'dk-p');
    p.appendChild(document.createTextNode(
      'The cache rule is one sentence: a step is reused only if every step before it was reused ' +
      'and its own inputs are unchanged. For RUN the input is the command text. For COPY it is ' +
      'the command text plus a checksum of the files. That second clause is the whole reason ' +
      'COPY package.json comes before COPY . . — and this is where you can measure it rather ' +
      'than take my word for it.'));
    host.appendChild(p);

    var row = E('div', 'dk-cacherow');
    var field = E('div', 'dk-cachefield');
    var lab = E('label', 'dk-label', 'What changed since the last build?');
    lab.setAttribute('for', 'dk-change');
    field.appendChild(lab);
    var sel = E('select', 'dk-select');
    sel.id = 'dk-change';
    var opts = changeOptions(result);
    if (this.change.type === 'line') {
      opts.push({ label: 'You edited line ' + this.change.line + ' of the Dockerfile',
                  value: 'line:' + this.change.line, change: this.change });
    }
    var matched = false;
    for (var i = 0; i < opts.length; i++) {
      var o = E('option', null, opts[i].label);
      o.value = opts[i].value;
      if (opts[i].value === this.changeValue) { o.selected = true; matched = true; }
      sel.appendChild(o);
    }
    if (!matched) { this.changeValue = 'none'; this.change = { type: 'none' }; sel.value = 'none'; }
    sel.addEventListener('change', function () {
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].value === sel.value) {
          self.changeValue = opts[j].value;
          self.change = opts[j].change;
        }
      }
      self.recompute();
      self.select(2);
    });
    field.appendChild(sel);
    row.appendChild(field);
    host.appendChild(row);

    var cache = this.cache;
    var grid = E('div', 'dk-summary');
    tile(grid, 'Rebuild takes', fmtTime(cache.rebuild),
      cache.rebuilt + ' of ' + cache.steps + ' steps have to run again',
      cache.rebuild > 60 ? 'is-bad' : 'is-good');
    tile(grid, 'Sending the context', fmtTime(cache.context),
      fmtSize(result.contextSent) + ' goes to the builder on every build, cached or not');
    tile(grid, 'Steps reused', String(cache.steps - cache.rebuilt),
      'These cost nothing at all');
    host.appendChild(grid);

    host.appendChild(E('p', 'dk-h', 'Step by step'));
    for (var s = 0; s < result.stages.length; s++) {
      var stage = result.stages[s];
      var block = E('div', 'dk-stage');
      var head = E('div', 'dk-stage-head');
      head.appendChild(E('span', 'dk-stage-t', 'Stage ' + stage.index +
        (stage.alias ? ' — ' + stage.alias : '')));
      block.appendChild(head);
      for (var L = 0; L < stage.layers.length; L++) {
        var layer = stage.layers[L];
        var lr = E('div', 'dk-layer' + (layer.meta ? ' is-meta' : ''));
        lr.appendChild(E('span', 'dk-l-n', String(L)));
        lr.appendChild(E('span', 'dk-l-cmd', layer.cmd));
        var t = E('span', 'dk-l-txt', truncate(layer.raw, 90));
        t.title = layer.raw;
        lr.appendChild(t);
        lr.appendChild(E('span', 'dk-l-flag is-' +
          (layer.cacheState === 'cached' ? 'cached' : 'rebuild'),
          layer.cacheState === 'cached' ? 'cached' : 'rebuild'));
        lr.appendChild(E('span', 'dk-l-size',
          layer.cacheState === 'cached' ? '—' : fmtTime(layer.seconds)));
        block.appendChild(lr);
      }
      host.appendChild(block);
    }

    var advice = E('p', 'dk-p');
    advice.appendChild(document.createTextNode(
      'The ordering rule that falls out of this: put the things that change rarely first, and ' +
      'the things that change on every commit last. Dependency manifests before source, ' +
      'dependency install before the manifest’s own directory, and COPY . . as late as it ' +
      'will go. Try switching between the two Node examples above with "a file inside src/ ' +
      'changed" selected here and watch the two rebuild numbers.'));
    host.appendChild(advice);

    var caveat = E('p', 'dk-p');
    caveat.appendChild(document.createTextNode(
      'Times are modelled from the work each step does, not measured on your machine. They are ' +
      'here for the ratio between them, not the absolute value: a 20 to 1 difference in this ' +
      'panel will be somewhere near 20 to 1 in real life, and neither number will be the one ' +
      'your CI reports.'));
    host.appendChild(caveat);
  };

  /* --- findings ------------------------------------------------------------------ */

  var LEVEL_WORD = { high: 'serious', medium: 'worth fixing', low: 'worth knowing' };

  Docker.prototype.renderFindings = function (result) {
    var host = this.panels[3];
    clear(host);

    if (!result.findings.length) {
      host.appendChild(E('p', 'dk-empty',
        'Nothing flagged. That means nothing I check for is wrong here, which is not the same ' +
        'as the image being right — I check for size waste, secrets in layers or in the image ' +
        'config, root, unpinned bases and a missing .dockerignore, and nothing else.'));
      return;
    }

    var p = E('p', 'dk-p');
    p.appendChild(document.createTextNode(
      'Everything below is derived from the model on the left, so each one carries the line it ' +
      'came from and, where it is a size problem, what it costs. Ordered by how much it matters.'));
    host.appendChild(p);

    for (var i = 0; i < result.findings.length; i++) {
      var f = result.findings[i];
      var card = E('div', 'dk-find lv-' + f.level);
      var head = E('div', 'dk-find-h');
      head.appendChild(E('span', 'dk-find-lv', LEVEL_WORD[f.level]));
      head.appendChild(E('span', 'dk-find-t', f.title));
      if (f.line) head.appendChild(E('span', 'dk-find-line', 'line ' + f.line));
      card.appendChild(head);
      card.appendChild(E('p', 'dk-find-b', f.body));
      if (f.fix) {
        var fix = E('p', 'dk-find-f');
        fix.appendChild(E('b', null, 'Fix: '));
        fix.appendChild(document.createTextNode(f.fix));
        card.appendChild(fix);
      }
      host.appendChild(card);
    }

    var limits = E('p', 'dk-p');
    limits.appendChild(document.createTextNode(
      'What this does not check: anything about the application inside the image, known CVEs in ' +
      'the packages, image signing, or the capabilities and seccomp profile the container ends ' +
      'up running with. Those need a scanner and a runtime; this is a reading of one file.'));
    host.appendChild(limits);
  };

  /* ======================================================================== */
  /*  BOOT                                                                     */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('dockerviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-docker-mount') || rootEl;
    clear(mount);
    try {
      /* eslint-disable-next-line no-new */
      new Docker(mount);
    } catch (err) {
      mount.appendChild(E('p', 'lab-proc-fallback',
        'The Docker layer explorer could not start in this browser (' +
        ((err && err.message) || String(err)) +
        '). Please tell me, and mention which browser you are using.'));
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'dockerviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

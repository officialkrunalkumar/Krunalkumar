/* ==========================================================================
   memdump.js — artefact extraction from memory dumps and raw binaries.
   --------------------------------------------------------------------------
   Point this at a memory dump, a hibernation file, a crash dump, a core file
   or a slice of a disk image and it pulls out the things an investigator is
   actually looking for: URLs, hosts, credentials, paths, registry keys, wallet
   addresses, and any file quietly embedded partway through. It is strings(1)
   with an opinion about what matters.

   The decisions worth explaining, because they are the ones that make the
   difference between a toy and something usable:

   1. UTF-16LE is not optional. On Windows every path the shell touched, every
      URL in a browser tab, every command line and nearly every string the user
      typed sits in memory as UTF-16 — one byte of ASCII followed by a 0x00.
      An extractor that only reads ASCII misses most of a Windows dump and then
      reports confidently that it found nothing. Both scanners run here, and
      each recovered string is tagged A or W so you know which one found it.

   2. Patterns are matched against recovered strings, never against a latin1
      view of the raw bytes. Run /https?:\/\// over the buffer directly and a
      UTF-16 URL reads as "h\0t\0t\0p\0" and never matches. Extract first, then
      match, and the same single pattern finds the ASCII and the wide copy.

   3. A printable run is recorded as a pair of offsets and only turned into a
      JavaScript string once it passes the minimum length. A 512 MB dump
      contains hundreds of millions of two- and three-character printable runs;
      building a string object for each of them is the difference between a
      scan that finishes and a tab that dies.

   4. Short file signatures are worthless at this scale, so they are validated
      rather than trusted. "MZ" occurs by chance roughly once every 64 KB —
      about eight thousand times in a 512 MB dump — so MZ is only reported when
      e_lfanew actually points at a "PE\0\0". Same idea throughout: JPEG needs a
      real marker byte after FF D8 FF, GZIP needs its reserved FLG bits clear,
      PNG needs IHDR at +12, MDMP needs its version word. Two-byte signatures
      with no way to validate them (BM, for instance) are left out entirely,
      because at 512 MB they produce nothing but noise.

   5. Entropy is sampled with a contiguous window per block, never with a
      stride. Taking every Nth byte aliases catastrophically with UTF-16 — a
      stride of two reads either all the text bytes or all the NUL bytes and
      reports entropy that is simply wrong — and it aliases with any fixed-size
      record structure too. A contiguous sample can miss a small region; a
      strided one lies about the region it did read.

   6. Everything here is a heuristic and a memory dump is the most hostile input
      a regular expression will ever see. Heap fragments, hex dumps, symbol
      tables and compression dictionaries all produce strings that look like
      IPv6 addresses, Ethereum wallets and NTLM hashes. The counts are a place
      to start looking, not a finding. Where a category is known to be noisy,
      the output says so instead of pretending.

   Work is chunked with setTimeout so the page keeps repainting, and there is a
   wall-clock budget: a scan that runs out of time stops and reports how far it
   got rather than quietly returning partial results as if they were complete.

   Nothing is uploaded. Every byte is read with FileReader and processed in this
   tab, which is the only reason it is sane to drop a memory dump — the single
   most credential-dense file on any machine — into a web page at all.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_BYTES     = 512 * 1024 * 1024;
  var CHUNK         = 1024 * 1024;   // bytes per inner pass
  var TICK_MS       = 20;            // work per animation-frame-ish slice
  var BUDGET_MS     = 90 * 1000;     // hard wall-clock stop for the walk
  var MIN_RUN_CAP   = 4096;          // longest single string kept intact
  var STRINGS_KEEP  = 300;           // strings listed in the output
  var CAT_KEEP      = 400;           // unique values retained per category
  var CAT_SHOWN     = 40;            // unique values printed per category
  var MATCH_PER_STR = 200;           // matches taken from one string
  var CARVE_PER_SIG = 40;            // offsets printed per signature
  var CARVE_TOTAL   = 20000;         // total carve hits recorded
  var VALUE_WIDTH   = 160;           // printed length of one artefact
  var E_BLOCKS      = 64;            // entropy map resolution
  var E_SAMPLE      = 1024 * 1024;   // bytes sampled per entropy block

  var out = LabTool.out('tool-out');

  /* ==================================================================
     Small helpers
     ================================================================== */

  function hexOff(n) {
    var s = n.toString(16);
    while (s.length < 8) s = '0' + s;
    return '0x' + s;
  }

  function num(n) {
    try { return n.toLocaleString(); } catch (err) { return String(n); }
  }

  /* String.fromCharCode.apply blows the argument limit somewhere around
     100k arguments and the exact ceiling is engine-specific, so runs are
     built in 4k slices and joined. */
  function asciiRun(buf, start, end) {
    var parts = [], i = start, stop;
    while (i < end) {
      stop = Math.min(i + 4096, end);
      parts.push(String.fromCharCode.apply(null, buf.subarray(i, stop)));
      i = stop;
    }
    return parts.join('');
  }

  /* UTF-16LE, restricted to the ASCII plane: every pair is <char> 0x00, so
     only the low byte carries information. Strings in Cyrillic, Greek, CJK or
     anything else outside U+0000..U+00FF are deliberately not recovered — the
     high byte would be non-zero and the run detector below would refuse to
     start. Widening the detector to arbitrary BMP text turns almost any binary
     region into a "string" and drowns the output. */
  function wideRun(buf, start, end) {
    var parts = [], chars = [], i;
    for (i = start; i < end; i += 2) {
      chars.push(buf[i]);
      if (chars.length === 4096) {
        parts.push(String.fromCharCode.apply(null, chars));
        chars = [];
      }
    }
    if (chars.length) parts.push(String.fromCharCode.apply(null, chars));
    return parts.join('');
  }

  function u32le(b, i) {
    return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  }

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clip(text, width) {
    var s = String(text).replace(/[\r\n\t]/g, ' ');
    return s.length > width ? s.slice(0, width - 1) + '…' : s;
  }

  /* ==================================================================
     What counts as an artefact.

     Running twenty-odd regular expressions against every one of several
     million recovered strings is the entire cost of this tool, so every
     category is gated in two stages: `hint`, a list of literal substrings of
     which one must be present (indexOf is close to free), and then `hintRe`,
     a small structural test. Both must pass before the real pattern runs.

     The invariant that makes this safe: a gate must be IMPLIED by the pattern
     it guards — every string the pattern could match must also pass the gate.
     A gate that is merely "usually right" silently loses evidence, which in
     this tool is the worst possible failure.

     That invariant is also why the gates look oddly specific. Guarding the
     NTLM pattern with /[0-9A-Fa-f]{32}:[0-9A-Fa-f]{32}/ costs 2 milliseconds
     on a 4 KB string of hex — the engine tries thirty-two characters at every
     single position — and a memory dump is full of 4 KB strings of hex. The
     same test written as /:[0-9A-Fa-f]{32}/ anchors on the colon, is implied
     by the pattern just as strictly, and runs two hundred times faster. That
     one rewrite took a 16 MB pathological input from ten seconds to under one.

     A gate regex must never carry /g — a global regex keeps lastIndex between
     calls and would start skipping strings.
     ================================================================== */

  var TLD = '(?:com|net|org|edu|gov|mil|int|info|biz|name|pro|xyz|top|site|' +
            'online|shop|app|dev|cloud|ai|io|co|me|tv|cc|ly|to|sh|gg|onion|' +
            'local|lan|internal|corp|us|uk|de|fr|nl|ru|cn|jp|in|au|ca|br|it|' +
            'es|se|no|fi|dk|pl|ch|at|be|cz|gr|pt|tr|ua|kr|sg|hk|tw|za|mx|ar|ir)';

  var IPV6_CORE =
    '(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}' +
    '|(?:[0-9A-Fa-f]{1,4}:){1,7}:' +
    '|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}' +
    '|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}' +
    '|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}' +
    '|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}' +
    '|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}' +
    '|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}' +
    '|:(?::[0-9A-Fa-f]{1,4}){1,7}' +
    '|::[Ff]{4}:(?:\\d{1,3}\\.){3}\\d{1,3}';

  /* Placeholder values that show up constantly in format strings, resource
     tables and template code. Reporting "password=%s" as a credential is how
     a tool teaches people to ignore its output. */
  var PLACEHOLDER = /^(?:\*+|x+|X+|\.+|-+|_+|<[^>]*>?|%[0-9a-zA-Z.$]*|\$\{[^}]*\}?|\{[^}]*\}?|null|nil|none|true|false|yes|no|empty|password|passwd|secret|changeme|todo|test|example|value|string|\d{1,4})$/;

  function trimUrl(v) {
    /* A URL at the end of a sentence, or inside a C string that was itself
       inside a log format, picks up trailing punctuation. Strip the characters
       that can never legitimately end a URL. */
    return v.replace(/[)\]}>.,;:!'"`]+$/, '');
  }

  function base58ish(v) {
    /* A real Bitcoin address mixes cases and digits. Requiring at least two of
       the three character classes throws away the long uppercase identifiers
       (GUID fragments, symbol names, base32 blobs) that otherwise dominate this
       category in any large binary. It also, honestly, throws away the rare
       genuine address that happens to be single-class. */
    var classes = 0;
    if (/[a-z]/.test(v)) classes++;
    if (/[A-Z]/.test(v)) classes++;
    if (/[0-9]/.test(v)) classes++;
    return classes >= 2;
  }

  var CATEGORIES = [
    /* ---- network ------------------------------------------------- */
    { key: 'url', group: 'net', title: 'URLs',
      hint: ['://'],
      re: /(?:https?|ftps?|wss?|file|ldaps?|smb|nfs|gopher|telnet|ssh|sftp|mongodb(?:\+srv)?|redis|postgres(?:ql)?|mysql|amqps?):\/\/[^\s"'<>`{}|\\^\[\]]{2,300}/gi,
      clean: trimUrl },

    { key: 'domain', group: 'net', title: 'Domains and hostnames',
      hint: ['.'], hintRe: /\.[A-Za-z]{2}/,
      re: new RegExp('(?:^|[^A-Za-z0-9.@_/-])((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?\\.){1,4}' + TLD + ')(?![A-Za-z0-9-])', 'g'),
      group_i: 1,
      note: 'Matched against a TLD list, so "readme.in" and "config.co" get in ' +
            'as well. Treat as leads, not findings.' },

    { key: 'email', group: 'net', title: 'Email addresses',
      hint: ['@'],
      re: /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,4}[A-Za-z]{2,24}/g },

    { key: 'ipv4', group: 'net', title: 'IPv4 addresses',
      hint: ['.'], hintRe: /\d\.\d/,
      /* The leading character is consumed rather than looked behind, because
         lookbehind is newer than the rest of this codebase. Without it,
         "1.2.3.4.5" — a version number, not an address — yields "2.3.4.5". */
      re: /(?:^|[^0-9A-Za-z.])((?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))(?![0-9.])/g,
      group_i: 1 },

    { key: 'ipv6', group: 'net', title: 'IPv6 addresses',
      /* Colon followed by a hex digit or another colon — true of every form
         the pattern accepts, including a bare "::1" where nothing precedes
         the first colon. Testing for hex BEFORE a colon instead would look
         equally reasonable and would quietly drop "::1". */
      hint: [':'], hintRe: /:[0-9A-Fa-f:]/,
      re: new RegExp('(?:^|[^0-9A-Fa-f:.])((?:' + IPV6_CORE + '))(?![0-9A-Fa-f:])', 'g'),
      group_i: 1,
      /* Four or more colon-separated hex groups is also what a MAC address
         table, a hex dump and half of every symbol demangler produce. Requiring
         a compressed :: or a full eight groups removes clock times but not
         those. */
      filter: function (v) {
        if (v.length < 3) return false;
        if (v.indexOf('::') !== -1) return true;
        return v.split(':').length === 8;
      },
      note: 'The noisiest category here. Hex dumps and MAC tables match this ' +
            'shape as readily as real addresses.' },

    /* ---- host -------------------------------------------------- */
    { key: 'winpath', group: 'host', title: 'Windows file paths',
      hint: [':\\'],
      re: /[A-Za-z]:\\(?:[^\\\/:*?"<>|\r\n]{1,120}\\){0,12}[^\\\/:*?"<>|\r\n]{0,120}/g,
      /* "C:\" on its own is a drive letter, not a path, and it appears in
         every resource table ever compiled. Require something after the
         backslash and a plausible total length. */
      filter: function (v) { return v.length >= 6 && v.charAt(3) !== '\\'; } },

    { key: 'uncpath', group: 'host', title: 'UNC and NT object paths',
      hint: ['\\\\', '\\Device', '\\SystemRoot', '\\??\\'],
      re: /\\\\[A-Za-z0-9_.$-]{1,63}\\[^\\\/:*?"<>|\r\n]{1,120}(?:\\[^\\\/:*?"<>|\r\n]{1,120}){0,10}|\\(?:Device|SystemRoot|\?\?)\\[^\s"'<>|*?\r\n]{2,180}/g },

    { key: 'registry', group: 'host', title: 'Registry key paths',
      hint: ['HKEY_', 'HKLM', 'HKCU', 'HKCR', 'HKU\\', 'REGISTRY\\'],
      re: /(?:HKEY_(?:LOCAL_MACHINE|CURRENT_USER|CLASSES_ROOT|USERS|CURRENT_CONFIG|PERFORMANCE_DATA)|HKLM|HKCU|HKCR|HKU|\\REGISTRY\\(?:MACHINE|USER))\\[^\s"'<>|*?\r\n]{2,200}/g },

    /* ---- credentials ------------------------------------------- */
    { key: 'aws', group: 'secret', title: 'AWS access key ID', cls: 't-err',
      hintRe: /A(?:KIA|SIA|IDA|ROA|IPA|NPA|NVA|BIA|CCA|GPA)/,
      re: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA|AGPA)[0-9A-Z]{16}\b/g },

    { key: 'awssecret', group: 'secret', title: 'AWS secret access key (labelled)', cls: 't-err',
      hint: ['=', ':'], hintRe: /aws_?secret/i,
      re: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9\/+=]{40}/gi },

    { key: 'bearer', group: 'secret', title: 'Bearer tokens', cls: 't-err',
      hint: ['Bearer '],
      re: /\bBearer [A-Za-z0-9\-._~+\/]{16,400}={0,2}/g },

    { key: 'jwt', group: 'secret', title: 'JSON Web Tokens', cls: 't-err',
      hint: ['eyJ'],
      re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g },

    { key: 'pem', group: 'secret', title: 'Private key headers', cls: 't-err',
      hint: ['PRIVATE KEY'],
      re: /-----BEGIN (?:RSA |DSA |EC |DH |OPENSSH |PGP |SSH2 |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },

    { key: 'assign', group: 'secret', title: 'Password and key assignments', cls: 't-warn',
      /* An assignment must contain a : or an = by definition, and that literal
         test costs nothing next to a case-insensitive alternation. */
      hint: ['=', ':'], hintRe: /pass|pwd|secret|api[_-]?key|apikey|token/i,
      re: /(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?([^\s"'`,;&<>]{3,80})/gi,
      /* The whole match is kept rather than the captured group, because
         "db_password=hunter2" is far more useful in a dump than a bare
         "hunter2" with no idea what it unlocks. The placeholder test below
         still runs against the value half only. */
      filter: function (v) {
        var eq = v.search(/[:=]/);
        var value = v.slice(eq + 1).replace(/^["'\s]+/, '');
        return !PLACEHOLDER.test(value);
      } },

    { key: 'connuri', group: 'secret', title: 'Credentials in a URI', cls: 't-err',
      hint: ['://'],
      /* The user and password halves must not contain a slash or a second @,
         which is what stops this from swallowing an ordinary URL that merely
         has an @ somewhere in the query string. */
      re: /[A-Za-z][A-Za-z0-9+.\-]{2,20}:\/\/[^\s:@\/"'<>]{1,64}:[^\s@\/"'<>]{1,64}@[^\s"'<>]{1,160}/g },

    { key: 'connstr', group: 'secret', title: 'Connection strings with a password', cls: 't-err',
      hint: ['='], hintRe: /(?:pwd|password)\s*=/i,
      re: /(?:Data Source|Server|Initial Catalog|Database|Host)\s*=[^;\r\n"']{1,120};[^\r\n"']{0,240}?(?:Password|Pwd)\s*=[^;\r\n"']{1,120}/gi },

    { key: 'ntlm', group: 'secret', title: 'NTLM hashes (pwdump / LM:NT pair)', cls: 't-err',
      /* Colon-anchored on purpose — see the note above the category table.
         The pattern cannot match without a colon followed by 32 hex digits,
         so this rejects nothing it should keep. */
      hint: [':'], hintRe: /:[0-9A-Fa-f]{32}/,
      re: /(?:[A-Za-z0-9._$\\-]{1,64}:\d{1,10}:)?[A-Fa-f0-9]{32}:[A-Fa-f0-9]{32}:{0,3}/g,
      note: 'aad3b435b51404eeaad3b435b51404ee as the first half is the empty LM ' +
            'hash — a near-certain sign this really is an NT hash and not a ' +
            'coincidence of two 32-character hex blobs.' },

    { key: 'shadow', group: 'secret', title: '/etc/shadow entries', cls: 't-err',
      hint: [':$'], hintRe: /:\$[0-9a-z]{1,2}\$/,
      re: /[A-Za-z0-9._-]{1,32}:\$(?:1|2[abxy]|5|6|7|y|gy)\$[^\s:]{4,140}(?::[^\s:]{0,40}){0,7}/g },

    { key: 'github', group: 'secret', title: 'GitHub tokens', cls: 't-err',
      hintRe: /gh[pousr]_/,
      re: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g },

    { key: 'slack', group: 'secret', title: 'Slack tokens', cls: 't-err',
      hint: ['xox'],
      re: /\bxox[baprse]-[A-Za-z0-9-]{10,}/g },

    { key: 'gcp', group: 'secret', title: 'Google API keys', cls: 't-err',
      hint: ['AIza'],
      re: /\bAIza[0-9A-Za-z_-]{35}\b/g },

    { key: 'stripe', group: 'secret', title: 'Stripe keys', cls: 't-err',
      hintRe: /[sprw]k_(?:live|test)/,
      re: /\b[sprw]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },

    /* ---- cryptocurrency ---------------------------------------- */
    { key: 'btc', group: 'coin', title: 'Bitcoin addresses (base58)', cls: 't-warn',
      hintRe: /(?:^|[^A-Za-z0-9])[13][a-km-zA-HJ-NP-Z1-9]{25}/,
      re: /(?:^|[^A-Za-z0-9])([13][a-km-zA-HJ-NP-Z1-9]{25,34})(?![A-Za-z0-9])/g,
      group_i: 1,
      /* Base58 excludes 0, O, I and l precisely so a human cannot mistranscribe
         one, and that exclusion is most of the filtering power here — a random
         alphanumeric blob of this length usually contains at least one of them.
         The checksum is not verified: doing it properly needs a big-integer
         base58 decode and a double SHA-256 per candidate, which is not worth
         the cost across millions of strings. Verify hits elsewhere. */
      filter: base58ish },

    { key: 'bech32', group: 'coin', title: 'Bitcoin addresses (bech32)', cls: 't-warn',
      hint: ['bc1'],
      re: /\bbc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71}\b/g },

    { key: 'eth', group: 'coin', title: 'Ethereum addresses', cls: 't-warn',
      hint: ['0x'],
      re: /(?:^|[^0-9A-Za-z])(0x[a-fA-F0-9]{40})(?![0-9A-Za-z])/g,
      group_i: 1,
      /* Any 20-byte value printed as hex with an 0x in front matches this.
         Dropping the all-zero and single-repeated-nibble cases removes the
         common padding artefacts; the rest need judgement. */
      filter: function (v) {
        var body = v.slice(2).toLowerCase();
        return !/^(.)\1{39}$/.test(body);
      },
      note: 'Structurally this is just "0x" plus forty hex characters, which ' +
            'any 20-byte hex blob satisfies. Expect false positives.' }
  ];

  var GROUPS = [
    { key: 'net',    title: 'Network artefacts' },
    { key: 'host',   title: 'Filesystem and registry artefacts' },
    { key: 'secret', title: 'Credentials and secrets' },
    { key: 'coin',   title: 'Cryptocurrency addresses' }
  ];

  /* ==================================================================
     File signatures for the carver.

     Anything short enough to appear by chance in half a gigabyte of noise
     needs a validator; the `check` function gets the buffer and the match
     offset and has the last word. Formats whose magic sits at a non-zero
     offset inside their own header (MP4's ftyp, the NTFS OEM name) say so in
     the label, because the reported offset is the match, not the file start.
     ================================================================== */

  function ascii4(b, i, text) {
    for (var k = 0; k < text.length; k++) {
      if (b[i + k] !== text.charCodeAt(k)) return false;
    }
    return true;
  }

  var SIGNATURES = [
    { hex: '89504e470d0a1a0a', name: 'PNG image',
      check: function (b, i) { return ascii4(b, i + 12, 'IHDR'); } },
    { hex: 'ffd8ff', name: 'JPEG image',
      /* FF D8 FF is only three bytes. The fourth must be a JPEG marker, and
         every valid marker is >= 0xC0 — that removes three quarters of the
         chance hits and costs nothing. */
      check: function (b, i) { return b[i + 3] >= 0xc0; } },
    { hex: '474946383761', name: 'GIF image (87a)' },
    { hex: '474946383961', name: 'GIF image (89a)' },
    { hex: '25504446', name: 'PDF document',
      check: function (b, i) { return b[i + 4] === 0x2d; } },
    { hex: '504b0304', name: 'ZIP local file header (also DOCX/XLSX/JAR/APK)' },
    { hex: '526172211a07', name: 'RAR archive' },
    { hex: '377abcaf271c', name: '7-Zip archive' },
    { hex: '1f8b08', name: 'GZIP stream',
      /* Bits 5-7 of FLG are reserved and must be zero in any real member. */
      check: function (b, i) { return i + 4 <= b.length && (b[i + 3] & 0xe0) === 0; } },
    { hex: '425a68', name: 'BZIP2 archive',
      check: function (b, i) { return b[i + 3] >= 0x31 && b[i + 3] <= 0x39; } },
    { hex: 'fd377a585a00', name: 'XZ archive' },
    { hex: '4d5a', name: 'Windows PE executable (MZ + validated PE header)',
      /* The reason this tool can report MZ at all. e_lfanew at +0x3C is a
         header-relative offset to "PE\0\0"; requiring it to land inside the
         buffer and actually read PE turns eight thousand chance hits into the
         handful of real modules mapped in the dump. Note the consequence: a PE
         whose header is paged out, or truncated by the end of the buffer, is
         not reported. That is the right trade at this scale. */
      check: function (b, i) {
        if (i + 0x40 > b.length) return false;
        var e = u32le(b, i + 0x3c);
        if (e < 0x40 || e > 0x10000000) return false;
        if (i + e + 4 > b.length) return false;
        return b[i + e] === 0x50 && b[i + e + 1] === 0x45 &&
               b[i + e + 2] === 0x00 && b[i + e + 3] === 0x00;
      } },
    { hex: '7f454c46', name: 'ELF binary',
      check: function (b, i) {
        return (b[i + 4] === 1 || b[i + 4] === 2) &&
               (b[i + 5] === 1 || b[i + 5] === 2) && b[i + 6] === 1;
      } },
    { hex: 'cffaedfe', name: 'Mach-O binary (64-bit)' },
    { hex: 'cefaedfe', name: 'Mach-O binary (32-bit)' },
    { hex: '53514c69746520666f726d6174203300', name: 'SQLite database' },
    { hex: 'd0cf11e0a1b11ae1', name: 'OLE compound file (DOC/XLS/MSI/MSG)' },
    { hex: '4d534346', name: 'Microsoft cabinet (CAB)',
      check: function (b, i) { return i + 8 <= b.length && u32le(b, i + 4) === 0; } },
    { hex: '52494646', name: 'RIFF container',
      check: function (b, i) {
        return ascii4(b, i + 8, 'WAVE') || ascii4(b, i + 8, 'AVI ') ||
               ascii4(b, i + 8, 'WEBP');
      } },
    { hex: '4f676753', name: 'OGG media' },
    { hex: '664c614300', name: 'FLAC audio' },
    { hex: '494433', name: 'MP3 (ID3 tag)',
      check: function (b, i) { return b[i + 3] < 5 && b[i + 4] === 0; } },
    { hex: '1a45dfa3', name: 'Matroska / WebM' },
    { hex: '66747970', name: 'MP4 / QuickTime (ftyp box; file starts 4 bytes earlier)' },
    { hex: '7b5c72746631', name: 'RTF document' },
    { hex: '25215053', name: 'PostScript document' },
    { hex: '2d2d2d2d2d424547494e20', name: 'PEM block (-----BEGIN )' },
    { hex: '4344303031', name: 'ISO 9660 descriptor' },

    /* Formats that only matter because of what this tool is for. */
    { hex: '5041474544554d50', name: 'Windows crash dump (32-bit, PAGEDUMP)' },
    { hex: '5041474544553634', name: 'Windows crash dump (64-bit, PAGEDU64)' },
    { hex: '4d444d50', name: 'Windows minidump (MDMP)',
      check: function (b, i) { return b[i + 4] === 0x93 && b[i + 5] === 0xa7; } },
    { hex: '48494252', name: 'Hibernation file header (HIBR)' },
    { hex: '72656766', name: 'Windows registry hive (regf)' },
    { hex: '456c6646696c6500', name: 'Windows event log, EVTX (ElfFile)' },
    { hex: '46494c45', name: 'NTFS MFT record (FILE)',
      /* Offset to the update sequence array is 0x30 in every NTFS version
         that matters; without this check the word FILE in ordinary text
         floods the results. */
      check: function (b, i) { return b[i + 4] === 0x30 && b[i + 5] === 0x00; } },
    { hex: '494e4458', name: 'NTFS index buffer (INDX)',
      check: function (b, i) { return b[i + 4] === 0x28 && b[i + 5] === 0x00; } },
    { hex: '4e54465320202020', name: 'NTFS boot sector (OEM name; sector starts 3 bytes earlier)',
      /* 'NTFS' plus four spaces is the eight-byte OEM ID at +0x03. A ninth byte
         would land on BytesPerSector, which is 00 for the universal 512-byte
         sector — so validate BytesPerSector instead of demanding a space there. */
      check: function (b, i) { return i + 10 <= b.length && (b[i + 8] | (b[i + 9] << 8)) >= 512; } },
    { hex: '4c00000001140200', name: 'Windows shortcut (.lnk)' },
    { hex: '2142444e', name: 'Outlook PST/OST store (!BDN)' }
  ];

  /* Precompute the byte arrays and index them by first byte. The carve loop
     then costs one array lookup per byte in the common case — 512 million
     lookups is survivable, 512 million × 40 signature comparisons is not. */
  var SIG_BY_FIRST = [];
  (function prepare() {
    var i, s, bytes, k;
    for (i = 0; i < SIGNATURES.length; i++) {
      s = SIGNATURES[i];
      bytes = [];
      for (k = 0; k < s.hex.length; k += 2) bytes.push(parseInt(s.hex.substr(k, 2), 16));
      s.bytes = bytes;
      k = bytes[0];
      if (!SIG_BY_FIRST[k]) SIG_BY_FIRST[k] = [];
      SIG_BY_FIRST[k].push(s);
    }
  })();

  /* ==================================================================
     Scan state
     ================================================================== */

  var scanId = 0;
  var state = null;
  var lastBytes = null;
  var lastFile = null;

  function newBucket() {
    return { seen: {}, list: [], total: 0, capped: false };
  }

  function record(bucket, value) {
    bucket.total++;
    if (bucket.capped) return;
    /* The '#' prefix keeps values like "__proto__", "constructor" and
       "toString" from colliding with Object.prototype when a plain object is
       used as a set. A memory dump absolutely will contain all three. */
    var key = '#' + value;
    if (Object.prototype.hasOwnProperty.call(bucket.seen, key)) return;
    if (bucket.list.length >= CAT_KEEP) { bucket.capped = true; return; }
    bucket.seen[key] = true;
    bucket.list.push(value);
  }

  /* Literal stage first, structural stage second, both required. */
  function gate(cat, s) {
    var i, seen = false;
    if (cat.hint) {
      for (i = 0; i < cat.hint.length; i++) {
        if (s.indexOf(cat.hint[i]) !== -1) { seen = true; break; }
      }
      if (!seen) return false;
    }
    if (cat.hintRe) return cat.hintRe.test(s);
    return true;
  }

  function harvest(st, text) {
    var c, cat, re, m, guard, value;
    for (c = 0; c < CATEGORIES.length; c++) {
      cat = CATEGORIES[c];
      if (!gate(cat, text)) continue;
      re = cat.re;
      re.lastIndex = 0;
      guard = 0;
      while ((m = re.exec(text)) !== null) {
        /* A pattern that can match the empty string would spin here forever.
           None of the ones above can, but the guard costs nothing and this
           file is pointed at hostile input by design. */
        if (m[0].length === 0) { re.lastIndex++; continue; }
        value = cat.group_i ? m[cat.group_i] : m[0];
        if (value) {
          if (cat.clean) value = cat.clean(value);
          if (value && (!cat.filter || cat.filter(value))) {
            record(st.buckets[cat.key], value);
          }
        }
        if (++guard >= MATCH_PER_STR) break;
      }
    }
  }

  /* Every recovered string goes through here: counted, offered to the pattern
     matchers, and kept for display only if it survives the filter and there is
     still room. Artefact matching runs over ALL strings even when the display
     list is full — the listing is a sample, the artefacts are not. */
  function emit(st, text, offset, enc) {
    if (enc === 'W') st.wideCount++; else st.asciiCount++;
    harvest(st, text);
    if (st.filterRe && !st.filterRe.test(text)) return;
    st.matchCount++;
    if (st.kept.length < STRINGS_KEEP) {
      st.kept.push({ off: offset, enc: enc, text: text });
    } else {
      st.keptCapped = true;
    }
  }

  /* ---- ASCII run scanner ------------------------------------------
     Tab counts as printable, newline and carriage return do not — the same
     convention GNU strings uses, and the one that keeps a run from swallowing
     an entire text file into a single result.
     The run is carried across chunk boundaries as (open, start) state rather
     than by overlapping the chunks, so nothing is scanned twice and nothing
     is reported twice. ---------------------------------------------- */
  function scanAscii(st, limit) {
    var buf = st.buf, i = st.aPos, b, len;
    while (i < limit) {
      b = buf[i];
      if ((b >= 0x20 && b < 0x7f) || b === 0x09) {
        if (!st.aOpen) { st.aOpen = true; st.aStart = i; }
        else if (i - st.aStart >= MIN_RUN_CAP) {
          /* A pathological input — a gigabyte of printable filler — would
             otherwise build one enormous string. Split it instead of dropping
             it, and let the reader see the seam. */
          emit(st, asciiRun(buf, st.aStart, i), st.aStart, 'A');
          st.aStart = i;
        }
      } else if (st.aOpen) {
        if (i - st.aStart >= st.minLen) emit(st, asciiRun(buf, st.aStart, i), st.aStart, 'A');
        st.aOpen = false;
      }
      i++;
    }
    st.aPos = i;
    if (limit >= st.len && st.aOpen) {
      len = st.len - st.aStart;
      if (len >= st.minLen) emit(st, asciiRun(buf, st.aStart, st.len), st.aStart, 'A');
      st.aOpen = false;
    }
  }

  /* ---- UTF-16LE run scanner ---------------------------------------
     A run is a sequence of <printable> 0x00 pairs. The cursor advances two
     bytes at a time inside a run and one byte at a time while hunting for the
     start of one, which is what lets a run beginning at an odd offset be found
     — memory is full of unaligned copies and assuming even alignment loses
     them. The pair test reads buf[i+1] freely because the whole file is in
     memory; the chunk limit only governs where this tick stops, never what the
     scanner is allowed to look at. ---------------------------------- */
  function scanWide(st, limit) {
    var buf = st.buf, len = st.len, i = st.uPos, lo, hi, chars;
    while (i < limit) {
      lo = buf[i];
      hi = (i + 1 < len) ? buf[i + 1] : 0xff;   // past EOF can never be a pair
      if (hi === 0 && ((lo >= 0x20 && lo < 0x7f) || lo === 0x09)) {
        if (!st.uOpen) { st.uOpen = true; st.uStart = i; }
        else if ((i - st.uStart) >= MIN_RUN_CAP * 2) {
          emit(st, wideRun(buf, st.uStart, i), st.uStart, 'W');
          st.uStart = i;
        }
        i += 2;
      } else {
        if (st.uOpen) {
          chars = (i - st.uStart) / 2;
          if (chars >= st.minLen) emit(st, wideRun(buf, st.uStart, i), st.uStart, 'W');
          st.uOpen = false;
        }
        i++;
      }
    }
    st.uPos = i;
    if (limit >= len && st.uOpen) {
      chars = Math.floor((len - st.uStart) / 2);
      if (chars >= st.minLen) {
        emit(st, wideRun(buf, st.uStart, st.uStart + chars * 2), st.uStart, 'W');
      }
      st.uOpen = false;
    }
  }

  /* ---- signature carver ------------------------------------------- */
  function scanCarve(st, limit) {
    var buf = st.buf, len = st.len, i = st.cPos, list, s, k, j, ok, hit;
    if (st.carveCapped) { st.cPos = limit; return; }
    while (i < limit) {
      list = SIG_BY_FIRST[buf[i]];
      if (list) {
        for (k = 0; k < list.length; k++) {
          s = list[k];
          if (i + s.bytes.length > len) continue;
          ok = true;
          for (j = 1; j < s.bytes.length; j++) {
            if (buf[i + j] !== s.bytes[j]) { ok = false; break; }
          }
          if (!ok) continue;
          if (s.check) {
            /* A validator that throws on a truncated header must not kill the
               whole scan — treat a thrown check as "not a match". */
            try { if (!s.check(buf, i)) continue; } catch (err) { continue; }
          }
          hit = st.carve[s.name];
          if (!hit) { hit = st.carve[s.name] = { count: 0, offs: [] }; st.carveOrder.push(s.name); }
          hit.count++;
          st.carveTotal++;
          if (hit.offs.length < CARVE_PER_SIG) hit.offs.push(i);
          if (st.carveTotal >= CARVE_TOTAL) { st.carveCapped = true; i = limit; break; }
        }
      }
      i++;
    }
    st.cPos = i;
  }

  /* ---- entropy map ------------------------------------------------
     Each of the 64 blocks is measured over a contiguous window taken from the
     start of the block, capped at E_SAMPLE. See the header for why this is not
     a stride. The same byte counts feed a whole-file figure, so the headline
     entropy and the map always describe exactly the same bytes. ------- */
  function entropyStep(st, blocks) {
    var i, start, end, stop, counts, total, h, p, b, done = 0;
    while (st.eBlock < E_BLOCKS && done < blocks) {
      /* Block edges are derived from the block index, not from a rounded-up
         block size — with a rounded size the blocks overlap by a byte or two
         each and the "bytes measured" total ends up larger than the file. */
      start = Math.floor(st.eBlock * st.len / E_BLOCKS);
      stop = Math.floor((st.eBlock + 1) * st.len / E_BLOCKS);
      end = Math.min(stop, start + E_SAMPLE);
      if (end <= start) { st.eBlock++; done++; continue; }
      counts = new Uint32Array(256);
      for (i = start; i < end; i++) counts[st.buf[i]]++;
      total = end - start;
      h = 0;
      for (b = 0; b < 256; b++) {
        if (!counts[b]) continue;
        p = counts[b] / total;
        h -= p * (Math.log(p) / Math.LN2);
        st.eCounts[b] += counts[b];
      }
      st.eSampled += total;
      st.eRows.push({ at: start, h: h });
      st.eBlock++;
      done++;
    }
    return st.eBlock >= E_BLOCKS;
  }

  /* ==================================================================
     Driver
     ================================================================== */

  function progressNode() {
    var span = document.createElement('span');
    span.className = 't-dim';
    out.node.appendChild(span);
    return span;
  }

  function readControls() {
    var minEl = document.getElementById('tool-minlen');
    var filEl = document.getElementById('tool-filter');
    var minLen = minEl ? parseInt(minEl.value, 10) : 6;
    if (!minLen || minLen < 3) minLen = 6;
    if (minLen > 64) minLen = 64;
    var term = filEl ? String(filEl.value || '').trim() : '';
    var re = null;
    if (term) {
      /* The term is escaped, so this cannot throw — but a tool that is allowed
         to throw here is a tool that dies on a stray backslash. */
      try { re = new RegExp(escapeRe(term), 'i'); } catch (err) { re = null; }
    }
    return { minLen: minLen, term: term, re: re };
  }

  function start(bytes, file) {
    var ctrl = readControls();
    scanId++;

    state = {
      id: scanId,
      buf: bytes,
      len: bytes.length,
      file: file,
      minLen: ctrl.minLen,
      filterRe: ctrl.re,
      filterTerm: ctrl.term,

      aOpen: false, aStart: 0, aPos: 0,
      uOpen: false, uStart: 0, uPos: 0,
      cPos: 0,

      asciiCount: 0, wideCount: 0,
      matchCount: 0, kept: [], keptCapped: false,

      buckets: {},
      carve: {}, carveOrder: [], carveTotal: 0, carveCapped: false,

      eBlock: 0, eRows: [], eCounts: new Uint32Array(256), eSampled: 0,
      eSize: Math.max(1, Math.floor(bytes.length / E_BLOCKS)),

      phase: 'walk',
      budgetHit: false,
      t0: Date.now(),
      node: null
    };
    for (var i = 0; i < CATEGORIES.length; i++) {
      state.buckets[CATEGORIES[i].key] = newBucket();
    }

    out.clear();
    out.heading(file && file.name ? file.name : 'binary');
    out.row('size', LabTool.humanBytes(state.len) + '  (' + num(state.len) + ' bytes)');
    if (file && file.lastModified) {
      out.row('last modified', new Date(file.lastModified).toISOString());
    }
    out.row('minimum string', ctrl.minLen + ' characters');
    out.row('filter', ctrl.term ? '"' + ctrl.term + '"  (applies to the string list only)' : 'none');
    out.rule();
    state.node = progressNode();
    (function (id) { setTimeout(function () { step(id); }, 0); })(scanId);
  }

  function step(id) {
    var st = state;
    if (!st || st.id !== id) return;   // a newer scan superseded this one

    var tick = Date.now();
    var limit;
    try {
      if (st.phase === 'walk') {
        /* Work is bounded by wall-clock rather than by a fixed byte count:
           a megabyte of NULs and a megabyte of dense text differ by an order
           of magnitude in cost, and a fixed chunk size would either stall the
           tab on the second or crawl on the first. */
        while (st.aPos < st.len && (Date.now() - tick) < TICK_MS) {
          limit = Math.min(st.len, st.aPos + CHUNK);
          scanAscii(st, limit);
          scanWide(st, limit);
          scanCarve(st, limit);
        }
        if (Date.now() - st.t0 > BUDGET_MS && st.aPos < st.len) {
          st.budgetHit = true;
          st.phase = 'entropy';
        } else if (st.aPos >= st.len) {
          st.phase = 'entropy';
        }
        st.node.textContent = 'reading  ' +
          Math.floor(100 * st.aPos / Math.max(1, st.len)) + '%   ' +
          LabTool.humanBytes(st.aPos) + ' of ' + LabTool.humanBytes(st.len) + '   ' +
          ((Date.now() - st.t0) / 1000).toFixed(1) + ' s   ' +
          num(st.asciiCount + st.wideCount) + ' strings\n';
        setTimeout(function () { step(id); }, 0);
        return;
      }

      if (st.phase === 'entropy') {
        st.node.textContent = 'measuring entropy  ' + st.eBlock + ' of ' + E_BLOCKS + '\n';
        if (!entropyStep(st, 8)) { setTimeout(function () { step(id); }, 0); return; }
        st.phase = 'done';
        report(st);
        return;
      }
    } catch (err) {
      st.phase = 'done';
      if (st.node) st.node.textContent = '';
      out.line('');
      out.err('The scan stopped on an internal error: ' +
              (err && err.message ? err.message : String(err)));
      out.dim('Everything printed above this line is still valid. If this is');
      out.dim('reproducible, the file is unusual in a way worth knowing about.');
    }
  }

  /* ==================================================================
     Report
     ================================================================== */

  function report(st) {
    var elapsed = (Date.now() - st.t0) / 1000;

    st.node.textContent = '';
    out.row('scan', 'finished in ' + elapsed.toFixed(1) + ' s', 't-ok');
    out.row('bytes examined', LabTool.humanBytes(st.aPos) +
            (st.budgetHit ? '  — INCOMPLETE' : ''), st.budgetHit ? 't-warn' : '');
    out.row('ASCII strings', num(st.asciiCount));
    out.row('UTF-16LE strings', num(st.wideCount),
            st.wideCount > st.asciiCount ? 't-info' : '');
    if (st.budgetHit) {
      out.line('');
      out.warn('The ' + (BUDGET_MS / 1000) + ' second budget ran out at ' +
               hexOff(st.aPos) + ', so the last ' +
               LabTool.humanBytes(st.len - st.aPos) + ' was never read.');
      out.dim('Everything below covers the first ' + LabTool.humanBytes(st.aPos) +
              ' only. Raise the minimum string length — most of the time goes on');
      out.dim('short runs — or cut the file down and scan it in pieces.');
    }
    if (st.wideCount > st.asciiCount) {
      out.line('');
      out.dim('More UTF-16 than ASCII, which is what a Windows dump looks like.');
      out.dim('A tool that reads only ASCII would have missed the larger half.');
    }

    reportArtefacts(st);
    reportCarve(st);
    reportEntropy(st);
    reportStrings(st);

    out.rule();
    out.dim('Nothing left this tab. The file was read with FileReader and every');
    out.dim('number above was computed here, on your processor.');
  }

  function reportArtefacts(st) {
    var g, c, cat, bucket, shown, i, any;

    out.rule();
    out.heading('ARTEFACTS');
    out.dim('Patterns are matched against every recovered string, ASCII and');
    out.dim('UTF-16 alike — not against the raw bytes, where a wide URL reads');
    out.dim('as h\\0t\\0t\\0p\\0 and matches nothing.');

    for (g = 0; g < GROUPS.length; g++) {
      any = false;
      for (c = 0; c < CATEGORIES.length; c++) {
        cat = CATEGORIES[c];
        if (cat.group !== GROUPS[g].key) continue;
        bucket = st.buckets[cat.key];
        if (!bucket.total) continue;

        if (!any) {
          out.line('');
          out.line('── ' + GROUPS[g].title + ' ' +
                   '─'.repeat(Math.max(0, 48 - GROUPS[g].title.length)), 't-dim');
          any = true;
        }

        out.line('');
        out.line(cat.title + '  —  ' + num(bucket.total) + ' hit' +
                 (bucket.total === 1 ? '' : 's') + ', ' +
                 num(bucket.list.length) + ' unique' +
                 (bucket.capped ? ' (stopped collecting at ' + CAT_KEEP + ')' : ''),
                 't-info');
        shown = Math.min(bucket.list.length, CAT_SHOWN);
        for (i = 0; i < shown; i++) {
          out.line('  ' + clip(bucket.list[i], VALUE_WIDTH), cat.cls || '');
        }
        if (bucket.list.length > shown) {
          out.dim('  … ' + num(bucket.list.length - shown) + ' more unique values not shown');
        }
        if (cat.note) out.dim('  note: ' + cat.note);
        if (cat.key === 'ntlm') {
          for (i = 0; i < bucket.list.length; i++) {
            if (bucket.list[i].toLowerCase().indexOf('aad3b435b51404eeaad3b435b51404ee') !== -1) {
              out.warn('  the empty LM constant is present above — those are real NT hashes');
              break;
            }
          }
        }
      }
    }

    var total = 0;
    for (c = 0; c < CATEGORIES.length; c++) total += st.buckets[CATEGORIES[c].key].total;
    if (!total) {
      out.line('');
      out.warn('No artefacts matched at all.');
      out.dim('On a real dump that usually means the minimum string length is');
      out.dim('too high, or the region is compressed or encrypted — check the');
      out.dim('entropy map below before concluding the file is empty.');
    }
  }

  function reportCarve(st) {
    var i, name, hit, k, line;
    out.rule();
    out.heading('EMBEDDED FILE SIGNATURES');
    out.dim('Magic bytes found at any offset, not just at zero. Short and');
    out.dim('easily-forged signatures are validated before being reported —');
    out.dim('MZ only counts when e_lfanew really points at a PE header.');

    if (!st.carveOrder.length) {
      out.line('');
      out.dim('none found');
      return;
    }

    /* Most-frequent first: on a dump the interesting thing is usually the
       signature that appears three times, not the one that appears 900. */
    st.carveOrder.sort(function (a, b) { return st.carve[b].count - st.carve[a].count; });

    for (i = 0; i < st.carveOrder.length; i++) {
      name = st.carveOrder[i];
      hit = st.carve[name];
      out.line('');
      out.line(name + '  —  ' + num(hit.count) + ' occurrence' +
               (hit.count === 1 ? '' : 's'), 't-info');
      for (k = 0; k < hit.offs.length; k++) {
        line = '  ' + hexOff(hit.offs[k]);
        while (line.length < 16) line += ' ';
        out.line(line + 'dec ' + num(hit.offs[k]));
      }
      if (hit.count > hit.offs.length) {
        out.dim('  … ' + num(hit.count - hit.offs.length) + ' further offsets not listed');
      }
    }
    if (st.carveCapped) {
      out.line('');
      out.warn('Carving stopped at ' + num(CARVE_TOTAL) + ' total hits — there are more.');
    }
  }

  function reportEntropy(st) {
    var i, row, filled, total = 0, h = 0, p, b;

    out.rule();
    out.heading('ENTROPY MAP');
    for (b = 0; b < 256; b++) total += st.eCounts[b];
    for (b = 0; b < 256; b++) {
      if (!st.eCounts[b]) continue;
      p = st.eCounts[b] / total;
      h -= p * (Math.log(p) / Math.LN2);
    }
    out.row('overall', h.toFixed(3) + ' bits/byte', h > 7.5 ? 't-warn' : 't-ok');
    out.row('measured over', LabTool.humanBytes(st.eSampled) +
            (st.eSampled < st.len ? '  (sampled)' : '  (every byte)'));
    if (st.eSampled < st.len) {
      out.dim('Each of the ' + E_BLOCKS + ' blocks is measured over the first ' +
              LabTool.humanBytes(Math.min(st.eSize, E_SAMPLE)) + ' of the block.');
      out.dim('A contiguous window, never every Nth byte: striding a dump aliases');
      out.dim('with UTF-16 — you read either all the text or all the NULs — and');
      out.dim('the number it produces is not the entropy of anything.');
    }
    out.line('');

    for (i = 0; i < st.eRows.length; i++) {
      row = st.eRows[i];
      filled = Math.round((row.h / 8) * 40);
      if (filled < 0) filled = 0;
      if (filled > 40) filled = 40;
      out.write(hexOff(row.at) + '  ', 't-dim');
      out.write('█'.repeat(filled) + '·'.repeat(40 - filled),
                row.h > 7.5 ? 't-warn' : (row.h < 1 ? 't-dim' : 't-ok'));
      out.line('  ' + row.h.toFixed(2));
    }
    out.line('');
    out.dim('Flat 8.0 is compressed or encrypted. Flat 0.0 is a run of one byte —');
    out.dim('unallocated or zeroed pages. The interesting places are the edges:');
    out.dim('a single high block inside ordinary data is where a packed payload,');
    out.dim('an archive or a key blob sits.');
  }

  function reportStrings(st) {
    var i, s, line;
    out.rule();
    out.heading('STRINGS');
    if (st.filterTerm) {
      out.row('filter', '"' + st.filterTerm + '"');
      out.row('matching', num(st.matchCount) + ' of ' +
              num(st.asciiCount + st.wideCount) + ' strings');
    } else {
      out.row('total', num(st.asciiCount + st.wideCount) + ' strings of ' +
              st.minLen + '+ characters');
    }
    out.dim('A is ASCII, W is UTF-16LE. The offset is where the string starts');
    out.dim('in the file, so it can be found again in a hex editor.');
    out.line('');

    if (!st.kept.length) {
      out.warn(st.filterTerm ? 'Nothing matched that filter.'
                             : 'No strings at this minimum length.');
      return;
    }

    for (i = 0; i < st.kept.length; i++) {
      s = st.kept[i];
      line = hexOff(s.off);
      out.write(line + '  ', 't-dim');
      out.write(s.enc + '  ', s.enc === 'W' ? 't-info' : 't-dim');
      out.line(clip(s.text, 200));
    }
    if (st.keptCapped) {
      out.line('');
      out.warn('Listing stopped at ' + STRINGS_KEEP + ' strings.');
      out.dim('Only the listing is truncated. Every string in the file was still');
      out.dim('run through the artefact patterns above — use the filter box to');
      out.dim('reach the ones that are not printed here.');
    }
  }

  /* ==================================================================
     Wiring
     ================================================================== */

  function rerun() {
    if (!lastBytes) {
      out.clear().warn('Choose or drop a binary first — a memory dump, a core');
      out.warn('file, a hibernation file or any large opaque blob.');
      return;
    }
    start(lastBytes, lastFile);
  }

  LabTool.define({
    id: 'memorystringstool',
    run: rerun,
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop',
        inputId: 'tool-file',
        maxBytes: MAX_BYTES,
        onFile: function (bytes, file) {
          var nameEl = document.getElementById('tool-dropname');
          if (nameEl) nameEl.textContent = file.name + '  (' + LabTool.humanBytes(bytes.length) + ')';
          /* The buffer is kept so changing the minimum length or the filter can
             re-scan without re-reading the file. On a 512 MB dump that is 512 MB
             held in this tab until the page is closed — deliberate, because
             asking the browser to read it again is slower and no cheaper. */
          lastBytes = bytes;
          lastFile = file;
          start(bytes, file);
        },
        onError: function (msg) {
          scanId++;            // cancel anything still running
          state = null;
          out.clear().err(msg);
        }
      });

      var minEl = document.getElementById('tool-minlen');
      if (minEl) minEl.addEventListener('change', rerun);
      var filEl = document.getElementById('tool-filter');
      if (filEl) {
        /* change, not input: re-scanning half a gigabyte on every keystroke is
           not a feature. This fires on Enter and on blur. */
        filEl.addEventListener('change', rerun);
      }

      out.dim('Drop a memory dump, a core file, a hibernation file, a crash dump');
      out.dim('or any large opaque binary. Up to ' + LabTool.humanBytes(MAX_BYTES) + '.');
      out.dim('');
      out.dim('It reads ASCII and UTF-16LE strings, then pulls URLs, hosts,');
      out.dim('paths, registry keys, credentials and wallet addresses out of');
      out.dim('them, carves embedded files by signature, and maps entropy so');
      out.dim('you can see where the compressed or encrypted regions are.');
      out.dim('');
      out.dim('Nothing is uploaded. A memory dump is the single most sensitive');
      out.dim('file on a machine — every password the user typed since boot may');
      out.dim('be in it — and that is exactly why this runs in your own tab.');
    }
  });
})();

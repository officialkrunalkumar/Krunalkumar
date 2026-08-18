/* ==========================================================================
   archive.js — read a ZIP's directory without unpacking it.
   --------------------------------------------------------------------------
   Almost everything dangerous about a ZIP is visible in its index. The central
   directory lists every path, every declared size and every CRC in the
   archive, and it sits in plain view at the end of the file. So this tool
   never decompresses a byte: it reads the index, does arithmetic, and tells
   you what extracting the thing would do to your disk. That is the whole
   point — "unzip it and look" is exactly the move that path traversal and zip
   bombs are built to punish.

   Things that are not obvious until you write a ZIP parser:

   - You have to find the End of Central Directory record by scanning
     BACKWARDS from the end of the file. It carries a variable-length comment
     of up to 65535 bytes, so its position is not fixed and there is no length
     prefix to jump to. Worse, the comment can itself contain a valid-looking
     EOCD signature, which is a genuine parser-confusion trick, so this tool
     counts the candidates and says when there is more than one.

   - The central directory and the local file headers store the same fields
     twice, and nothing forces them to agree. Different unzip implementations
     trust different copies. An archive whose two copies disagree is telling
     you something, so both are read and compared.

   - deflate cannot exceed 1032:1. That number is a hard property of the
     format (258 bytes of output from the shortest possible match encoding).
     Any deflate entry claiming a higher ratio is either lying about its sizes
     or sharing compressed data with other entries — which is how the modern
     non-recursive zip bombs work: one blob of compressed zeros, thousands of
     directory entries all pointing at it. Duplicate local header offsets are
     flagged for that reason.

   - Filenames are CP437 unless general purpose bit 11 says UTF-8, and plenty
     of archivers set neither correctly. The decoder here tries strict UTF-8
     first where that is plausible and falls back to a CP437 table, then says
     which it used, because a name that renders differently in two tools is
     itself a finding.

   - A U+202E RIGHT-TO-LEFT OVERRIDE in a filename makes "invoice\u202Efdp.exe"
     display as "invoicexe.pdf" in nearly every file manager. This is real,
     old, and still works. Any bidi or control character is escaped before it
     reaches the output pane — printing it raw would scramble the report too —
     and the tool shows what the name would have looked like on screen.

   - ZIP64 is detected rather than fully trusted. Sizes above 2^53 cannot be
     represented exactly in a JavaScript number, so those are reported as
     "beyond 2^53" instead of a confidently wrong figure.

   Nothing is uploaded. The file is read with FileReader and parsed in this
   tab, which is what makes it safe to point at an archive you were emailed by
   someone you have never met.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 256 * 1024 * 1024;      // FileReader holds the whole file in memory

  /* Work caps. Every one of these prints a line when it bites — silently
     truncating a security report is worse than refusing to produce one. */
  var MAX_ENTRIES = 20000;          // central directory entries parsed
  var MAX_LIST    = 800;            // entries printed in the full listing
  var MAX_LFH     = 3000;           // local headers cross-checked
  var MAX_DETAIL  = 40;             // examples printed per finding category
  var MAX_SALVAGE = 32 * 1024 * 1024; // brute-force scan window when EOCD is gone

  var SIG_LOCAL  = 0x04034b50;      // "PK\3\4"  local file header
  var SIG_CDIR   = 0x02014b50;      // "PK\1\2"  central directory entry
  var SIG_EOCD   = 0x06054b50;      // "PK\5\6"  end of central directory
  var SIG_EOCD64 = 0x06064b50;      // "PK\6\6"  ZIP64 end of central directory
  var SIG_LOC64  = 0x07064b50;      // "PK\6\7"  ZIP64 EOCD locator

  var DEFLATE_CEILING = 1032;       // best ratio deflate can physically reach

  var METHODS = {
    0: 'store', 1: 'shrink', 2: 'reduce1', 3: 'reduce2', 4: 'reduce3',
    5: 'reduce4', 6: 'implode', 7: 'tokenize', 8: 'deflate', 9: 'deflate64',
    10: 'dcl-impl', 12: 'bzip2', 14: 'lzma', 16: 'cmpsc', 18: 'terse',
    19: 'lz77', 20: 'zstd-dep', 93: 'zstd', 94: 'mp3', 95: 'xz', 96: 'jpeg',
    97: 'wavpack', 98: 'ppmd', 99: 'aes'
  };

  /* Extensions that run code on a double click, or that a loader will happily
     execute. .js is here because a bare .js in an archive on Windows runs
     under wscript, not in a sandboxed browser. */
  var EXEC_EXT = {
    exe: 1, dll: 1, scr: 1, bat: 1, cmd: 1, ps1: 1, psm1: 1, vbs: 1, vbe: 1,
    js: 1, jse: 1, wsf: 1, wsh: 1, jar: 1, com: 1, pif: 1, cpl: 1, msi: 1,
    msp: 1, msc: 1, hta: 1, lnk: 1, reg: 1, scf: 1, url: 1,
    sys: 1, ocx: 1, apk: 1, app: 1, sh: 1, elf: 1, so: 1, dylib: 1, py: 1
  };

  /* The half of a double extension that is meant to reassure you. */
  var DOC_EXT = {
    pdf: 1, doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1, txt: 1, rtf: 1,
    jpg: 1, jpeg: 1, png: 1, gif: 1, bmp: 1, csv: 1, htm: 1, html: 1, xml: 1,
    json: 1, log: 1, dat: 1, mp3: 1, mp4: 1, avi: 1, zip: 1, rar: 1, odt: 1
  };

  var ARCHIVE_EXT = {
    zip: 1, jar: 1, war: 1, ear: 1, apk: 1, aar: 1, '7z': 1, rar: 1, gz: 1,
    tgz: 1, bz2: 1, tbz: 1, xz: 1, txz: 1, tar: 1, cab: 1, iso: 1, egg: 1,
    whl: 1, nupkg: 1, vsix: 1, lzh: 1, arj: 1, ace: 1, z: 1, lz4: 1, zst: 1,
    dmg: 1, img: 1, cpio: 1, rpm: 1, deb: 1, msi: 1
  };

  var RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

  /* Bidi controls and the invisible marks that go with them. Anything in here
     can make a displayed filename differ from the stored filename. */
  var BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c\u200b-\u200d\ufeff]/;
  var CONTROL = /[\u0000-\u001f\u007f]/;

  /* CP437 code points 0x80-0xff, the DOS character set ZIP defaults to. */
  var CP437_HIGH =
    '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef' +
    '\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9' +
    '\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa' +
    '\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb' +
    '\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557' +
    '\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f' +
    '\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559' +
    '\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580' +
    '\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4' +
    '\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248' +
    '\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0';

  /* ------------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------------ */
  function pad(s, n)  { s = String(s); while (s.length < n) s += ' '; return s; }
  function padL(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  function hex8(n) {
    var s = (n >>> 0).toString(16);
    while (s.length < 8) s = '0' + s;
    return s;
  }

  function hexAt(n) { return '0x' + n.toString(16); }

  /* A bounds-checked little-endian reader. Every field in a ZIP is a length or
     an offset that some other part of the file supplied, so every read is a
     read at an attacker-chosen position. Returning -1 rather than throwing
     keeps a malformed archive from killing the whole report. */
  function View(bytes) {
    this.b = bytes;
    this.len = bytes.length;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  View.prototype.has = function (p, n) {
    return p >= 0 && n >= 0 && p + n <= this.len;
  };
  View.prototype.u16 = function (p) {
    return this.has(p, 2) ? this.dv.getUint16(p, true) : -1;
  };
  View.prototype.u32 = function (p) {
    return this.has(p, 4) ? this.dv.getUint32(p, true) : -1;
  };
  /* ZIP64 stores 64-bit values. JavaScript numbers are exact only to 2^53, so
     anything above that is reported as Infinity and printed as a caveat
     instead of a wrong number. */
  View.prototype.u64 = function (p) {
    if (!this.has(p, 8)) return -1;
    var lo = this.dv.getUint32(p, true);
    var hi = this.dv.getUint32(p + 4, true);
    if (hi > 0x1fffff) return Infinity;
    return hi * 4294967296 + lo;
  };

  /* ---- filename decoding ------------------------------------------------- */
  function decodeCp437(raw) {
    var s = '';
    for (var i = 0; i < raw.length; i++) {
      s += raw[i] < 0x80 ? String.fromCharCode(raw[i]) : CP437_HIGH.charAt(raw[i] - 0x80);
    }
    return s;
  }

  function strictUtf8(raw) {
    // fatal:true is the point — we want to know when the UTF-8 flag is a lie.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch (err) {
      return null;
    }
  }

  function decodeName(raw, utf8Flag) {
    var highBytes = false, i;
    for (i = 0; i < raw.length; i++) { if (raw[i] > 0x7f) { highBytes = true; break; } }
    if (!highBytes) {
      var ascii = '';
      for (i = 0; i < raw.length; i++) ascii += String.fromCharCode(raw[i]);
      return { text: ascii, enc: 'ascii', note: null };
    }
    if (utf8Flag) {
      var u = strictUtf8(raw);
      if (u !== null) return { text: u, enc: 'utf-8', note: null };
      return {
        text: decodeCp437(raw), enc: 'cp437',
        note: 'flag bit 11 claims UTF-8 but the name bytes are not valid UTF-8'
      };
    }
    // No UTF-8 flag, but high bytes. Most modern archivers write UTF-8 anyway
    // and forget the flag, so try it before falling back to the DOS charset.
    var guess = strictUtf8(raw);
    if (guess !== null) {
      return {
        text: guess, enc: 'utf-8?',
        note: 'high bytes decode cleanly as UTF-8 although the UTF-8 flag is not set — ' +
              'another unzip tool may read this name as CP437 instead'
      };
    }
    return { text: decodeCp437(raw), enc: 'cp437', note: null };
  }

  /* Names go to a <pre>. A raw U+202E would reorder the rest of the report
     line, and a raw \r would overwrite it, so escape both before printing. */
  function safe(text) {
    return String(text).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\u200b-\u200f\u061c\ufeff]/g,
      function (c) {
        var code = c.charCodeAt(0).toString(16).toUpperCase();
        while (code.length < 4) code = '0' + code;
        return '<U+' + code + '>';
      });
  }

  /* What a file manager shows for a name containing RIGHT-TO-LEFT OVERRIDE.
     Real bidi resolution is far more involved than this; reversing the tail is
     enough to demonstrate the trick, which is all this claims to do. */
  function rtlPreview(name) {
    var i = name.indexOf('\u202e');
    if (i < 0) return null;
    return name.slice(0, i) + name.slice(i + 1).split('').reverse().join('');
  }

  /* ---- DOS timestamp ----------------------------------------------------- */
  /* MS-DOS date/time: two 16-bit words, two-second resolution, epoch 1980, and
     no timezone at all. It records the local wall clock of whoever built the
     archive, so it is deliberately NOT converted through a JS Date here — that
     would silently reinterpret it in the viewer's timezone. */
  function dosStamp(time, date) {
    if (date === 0 && time === 0) return { text: 'not set', bad: true };
    var day = date & 0x1f;
    var month = (date >> 5) & 0x0f;
    var year = ((date >> 9) & 0x7f) + 1980;
    var sec = (time & 0x1f) * 2;
    var min = (time >> 5) & 0x3f;
    var hour = (time >> 11) & 0x1f;
    var bad = month < 1 || month > 12 || day < 1 || day > 31 ||
              hour > 23 || min > 59 || sec > 59;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return {
      text: year + '-' + two(month) + '-' + two(day) + ' ' + two(hour) + ':' + two(min),
      year: year, bad: bad
    };
  }

  /* ---- path helpers ------------------------------------------------------ */
  function baseName(path) {
    var parts = String(path).split(/[\/\\]/);
    return parts[parts.length - 1] || '';
  }
  function extOf(name) {
    var m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  }
  function secondExt(name) {
    var m = /\.([A-Za-z0-9]{1,8})\.[A-Za-z0-9]{1,8}$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  function ratioOf(usize, csize) {
    if (!isFinite(usize) || !isFinite(csize)) return null;
    if (usize <= 0) return null;
    if (csize <= 0) return Infinity;
    return usize / csize;
  }
  function ratioText(r) {
    if (r === null) return '-';
    if (r === Infinity) return 'inf';
    if (r >= 10000) return Math.round(r) + ':1';
    return r.toFixed(1) + ':1';
  }
  /* The listing is a fixed-width table, and a fabricated ratio can be nine
     digits long, so the column form falls back to exponent notation rather
     than shunting every later column sideways. */
  function ratioCol(r) {
    if (r !== null && r !== Infinity && r >= 100000) return r.toExponential(1) + ':1';
    return ratioText(r);
  }
  function sizeText(n) {
    if (n === Infinity) return '>2^53';
    if (n < 0) return '?';
    return LabTool.humanBytes(n);
  }

  /* ------------------------------------------------------------------------
     Locating the end of the archive
     ------------------------------------------------------------------------ */
  function findEocd(v) {
    /* Backwards, because of the variable comment. The window is the largest a
       comment can be (65535) plus the 22-byte record itself. */
    var window = Math.min(v.len, 65535 + 22);
    var start = v.len - 22;
    var stop = v.len - window;
    var candidates = [];
    for (var p = start; p >= stop && p >= 0; p--) {
      if (v.u32(p) !== SIG_EOCD) continue;
      var cmt = v.u16(p + 20);
      /* Four bytes matching "PK\5\6" happen by accident inside compressed
         data. A candidate only counts if its own fields are self-consistent:
         the comment has to fit in the file and the directory it points at has
         to be inside the file. Without this the "more than one EOCD" warning
         fires on perfectly ordinary archives. */
      var cdSize = v.u32(p + 12);
      var cdAt = v.u32(p + 16);
      var plausible = (p + 22 + cmt <= v.len) && cdSize >= 0 && cdAt >= 0 &&
                      (cdAt + cdSize <= v.len);
      candidates.push({ at: p, commentLen: cmt, exact: (p + 22 + cmt === v.len),
                        plausible: plausible });
    }
    candidates = candidates.filter(function (c) { return c.plausible; })
                           .concat(candidates.filter(function (c) { return !c.plausible; }));
    if (!candidates.length) return null;
    var plausibleCount = 0;
    for (var q = 0; q < candidates.length; q++) if (candidates[q].plausible) plausibleCount++;
    /* Prefer the record whose comment length lands exactly on the end of the
       file: that is the one a strict reader accepts. Otherwise take the last
       one in the file, which is what most readers land on. */
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].exact) {
        candidates[i].total = plausibleCount;
        return candidates[i];
      }
    }
    candidates[0].total = plausibleCount;
    return candidates[0];
  }

  /* ------------------------------------------------------------------------
     Extra field walker — ZIP64 sizes, WinZip AES, Info-ZIP Unicode path
     ------------------------------------------------------------------------ */
  function parseExtra(v, at, len, e) {
    var seen = [], q = at, end = at + len;
    while (q + 4 <= end) {
      var id = v.u16(q);
      var size = v.u16(q + 2);
      if (id < 0 || size < 0 || q + 4 + size > end) {
        e.extraBroken = true;
        break;
      }
      seen.push(id);
      var body = q + 4;

      if (id === 0x0001) {
        /* ZIP64 extended information. The fields appear in a fixed order but
           ONLY when the corresponding 32-bit field was 0xFFFFFFFF, which is
           why this cannot just read at fixed offsets. */
        e.zip64 = true;
        var r = body;
        if (e.usize === 0xffffffff && r + 8 <= body + size) { e.usize = v.u64(r); r += 8; }
        if (e.csize === 0xffffffff && r + 8 <= body + size) { e.csize = v.u64(r); r += 8; }
        if (e.localAt === 0xffffffff && r + 8 <= body + size) { e.localAt = v.u64(r); r += 8; }
        if (e.diskStart === 0xffff && r + 4 <= body + size) { e.diskStart = v.u32(r); }
      } else if (id === 0x9901 && size >= 7) {
        /* WinZip AES. Method 99 in the header is a placeholder; the real
           compression method lives in here, so an AES entry looks like it uses
           an unknown method until this is read. */
        e.aes = {
          vendorVersion: v.u16(body),
          strength: v.b[body + 4],
          method: v.u16(body + 5)
        };
      } else if (id === 0x7075 && size > 5) {
        /* Info-ZIP Unicode Path: a second, UTF-8 copy of the name. When it
           disagrees with the header name, two unzip tools can disagree about
           where the file lands — worth surfacing. */
        var u = strictUtf8(v.b.subarray(body + 5, body + size));
        if (u !== null) e.unicodePath = u;
      }
      q += 4 + size;
    }
    return seen;
  }

  /* ------------------------------------------------------------------------
     Central directory walk
     ------------------------------------------------------------------------ */
  function readEntries(v, cdStart, model) {
    var p = cdStart;
    while (model.entries.length < MAX_ENTRIES) {
      /* Check the signature before the length, because the record that ends
         the directory is only 22 bytes and would otherwise be reported as the
         file running out early. */
      var sig = v.u32(p);
      if (sig === SIG_EOCD || sig === SIG_EOCD64 || sig === SIG_LOC64) break;
      if (!v.has(p, 46)) {
        model.errors.push('the central directory runs past the end of the file at ' + hexAt(p));
        break;
      }
      if (sig !== SIG_CDIR) {
        model.errors.push('expected a central directory entry at ' + hexAt(p) +
                          ' but found signature ' + hex8(sig));
        break;
      }

      var e = {};
      e.at = p;
      e.versionMadeBy = v.u16(p + 4);
      e.versionNeeded = v.u16(p + 6);
      e.flags = v.u16(p + 8);
      e.method = v.u16(p + 10);
      e.dosTime = v.u16(p + 12);
      e.dosDate = v.u16(p + 14);
      e.crc = v.u32(p + 16);
      e.csize = v.u32(p + 20);
      e.usize = v.u32(p + 24);
      var nameLen = v.u16(p + 28);
      var extraLen = v.u16(p + 30);
      var cmtLen = v.u16(p + 32);
      e.diskStart = v.u16(p + 34);
      e.internal = v.u16(p + 36);
      e.external = v.u32(p + 38);
      e.localAt = v.u32(p + 42);

      var nameAt = p + 46;
      if (!v.has(nameAt, nameLen + extraLen + cmtLen)) {
        model.errors.push('entry ' + model.entries.length +
                          ' declares a name/extra/comment block that runs off the end of the file');
        break;
      }

      var raw = v.b.subarray(nameAt, nameAt + nameLen);
      e.extraIds = parseExtra(v, nameAt + nameLen, extraLen, e);
      e.commentLen = cmtLen;

      var decoded = decodeName(raw, !!(e.flags & 0x0800));
      e.name = decoded.text;
      e.encoding = decoded.enc;
      e.encNote = decoded.note;
      e.rawLen = nameLen;

      e.encrypted = !!(e.flags & 0x0001);
      e.strongCrypto = !!(e.flags & 0x0040);
      e.cdEncrypted = !!(e.flags & 0x2000);
      e.hasDataDescriptor = !!(e.flags & 0x0008);

      var host = e.versionMadeBy >> 8;
      e.unixMode = (host === 3) ? ((e.external >>> 16) & 0xffff) : 0;
      e.isSymlink = (e.unixMode & 0xf000) === 0xa000;
      e.isDir = /[\/\\]$/.test(e.name) || !!(e.external & 0x10) ||
                (e.unixMode & 0xf000) === 0x4000;
      e.setuid = !!(e.unixMode & 0x0800);

      e.stamp = dosStamp(e.dosTime, e.dosDate);
      e.ratio = e.isDir ? null : ratioOf(e.usize, e.csize);

      classify(e);
      model.entries.push(e);

      p = nameAt + nameLen + extraLen + cmtLen;
    }
    return p;
  }

  /* ------------------------------------------------------------------------
     Per-entry findings. sev: 2 = critical, 1 = warning, 0 = note.
     ------------------------------------------------------------------------ */
  function flag(e, sev, code, text) {
    e.issues.push({ sev: sev, code: code, text: text });
    if (sev > e.worst) e.worst = sev;
  }

  function classify(e) {
    e.issues = [];
    e.worst = 0;
    var name = e.name;
    var base = baseName(name);
    var ext = extOf(name);

    /* ---- ZIP SLIP. The headline check. -------------------------------- */
    var segments = name.split(/[\/\\]/);
    var hasDotDot = false;
    for (var i = 0; i < segments.length; i++) {
      // Match the segment, not a substring: "..foo" is a legal filename.
      if (segments[i] === '..') hasDotDot = true;
    }
    if (hasDotDot) {
      flag(e, 2, 'slip', 'contains a ".." path segment — extraction walks up ' +
           'out of the target directory');
    } else if (name.indexOf('..') >= 0) {
      /* A literal ".." inside a name ("report..v2.pdf") is legal and common,
         so it is a note rather than a finding. It is still worth printing:
         some extractors normalise paths in ways that turn it into one. */
      flag(e, 0, 'dots', 'contains ".." but not as its own path segment, so it ' +
           'is not traversal by itself');
    }
    if (name.charAt(0) === '/' || name.charAt(0) === '\\') {
      flag(e, 2, 'slip', 'absolute path — starts at the filesystem root, ' +
           'ignoring the target directory');
    }
    if (/^[A-Za-z]:/.test(name)) {
      flag(e, 2, 'slip', 'Windows drive-absolute path — writes to ' +
           safe(name.slice(0, 2)) + ' regardless of where you extract');
    }
    if (/^\\\\/.test(name)) {
      flag(e, 2, 'slip', 'UNC path — targets a network share');
    }
    if (name.indexOf('\\') >= 0 && !/^[A-Za-z]:/.test(name) && !/^\\\\/.test(name)) {
      /* APPNOTE 4.4.17.1 says forward slash, always. A backslash is either a
         literal character in a filename on Unix, or a Windows path that some
         extractor will helpfully treat as a separator. Either way the two
         readings differ, which is the useful part. */
      flag(e, 1, 'backslash', 'contains a backslash — the ZIP spec requires ' +
           'forward slashes, so extractors disagree on whether this is one ' +
           'directory or several');
    }
    if (e.unicodePath && e.unicodePath !== e.name) {
      flag(e, 1, 'twoname', 'the Unicode Path extra field holds a different ' +
           'name: ' + safe(e.unicodePath));
    }

    /* ---- symlinks: a quieter route to the same escape ------------------ */
    if (e.isSymlink) {
      flag(e, 1, 'symlink', 'is a symbolic link — its target is stored as the ' +
           'file content, and a link to /etc or C:\\ turns later entries into ' +
           'writes outside the target directory');
    }
    if (e.setuid) {
      flag(e, 1, 'setuid', 'carries the setuid bit in its Unix permissions');
    }

    /* ---- ratios -------------------------------------------------------- */
    if (e.ratio !== null && !e.isDir) {
      if (e.ratio === Infinity) {
        flag(e, 2, 'bomb', 'declares ' + sizeText(e.usize) + ' uncompressed from ' +
             'zero compressed bytes — impossible, the header is lying');
      } else if (e.ratio > 1000) {
        flag(e, 2, 'bomb', 'compression ratio ' + ratioText(e.ratio) + ' — ' +
             sizeText(e.csize) + ' expands to ' + sizeText(e.usize));
      } else if (e.ratio > 100) {
        flag(e, 1, 'ratio', 'compression ratio ' + ratioText(e.ratio) + ' — high, ' +
             'though long runs of identical bytes do this legitimately');
      }
      if (e.method === 8 && e.ratio > DEFLATE_CEILING) {
        flag(e, 2, 'impossible', 'claims ' + ratioText(e.ratio) + ' from deflate, ' +
             'which cannot exceed ' + DEFLATE_CEILING + ':1 — the sizes are ' +
             'fabricated or this entry shares its compressed data with others');
      }
    }

    /* ---- names --------------------------------------------------------- */
    if (BIDI.test(name)) {
      var preview = rtlPreview(name);
      flag(e, 2, 'bidi', 'contains a bidirectional control character' +
           (preview ? ' — a file manager displays this as "' + safe(preview) + '"' : ''));
    }
    if (CONTROL.test(name)) {
      flag(e, 1, 'control', 'contains control characters, which can hide the ' +
           'real name in terminal output');
    }
    if (base === '' && !e.isDir) {
      flag(e, 1, 'noname', 'has an empty final path component');
    }
    if (base !== '' && /^\s+$/.test(base)) {
      flag(e, 2, 'blank', 'the filename is nothing but whitespace');
    }
    if (/ {5,}/.test(base)) {
      flag(e, 2, 'spacer', 'a long run of spaces pads the name — in a narrow ' +
           'column this pushes the real extension out of sight');
    }
    if (/[ .]$/.test(base) && !e.isDir) {
      flag(e, 1, 'trailing', 'ends in a space or dot — Windows silently strips ' +
           'those, so the file on disk gets a different name than the archive ' +
           'claims');
    }
    if (RESERVED.test(base.split('.')[0])) {
      flag(e, 1, 'reserved', 'uses a reserved Windows device name (' +
           safe(base.split('.')[0]) + ')');
    }
    if (e.rawLen > 255) {
      flag(e, 1, 'longname', 'path is ' + e.rawLen + ' bytes long');
    }

    /* ---- content type -------------------------------------------------- */
    if (!e.isDir && EXEC_EXT[ext]) {
      var second = secondExt(base);
      if (second && DOC_EXT[second]) {
        flag(e, 2, 'double', 'double extension — presents as ".' + second +
             '" but the real extension is ".' + ext + '", which executes');
      } else {
        flag(e, 1, 'exec', 'executable or script (.' + ext + ')');
      }
    }
    if (!e.isDir && ARCHIVE_EXT[ext]) {
      flag(e, 1, 'nested', 'nested archive (.' + ext + ') — most scanners stop ' +
           'at one level of nesting, and this tool does not open it either');
    }
    if (e.encrypted || e.strongCrypto || e.method === 99) {
      flag(e, 1, 'encrypted', 'encrypted — the content cannot be scanned, which ' +
           'is often the reason it is encrypted');
    }
    if (e.stamp.bad && !(e.dosDate === 0 && e.dosTime === 0)) {
      flag(e, 0, 'date', 'the DOS timestamp does not decode to a real date');
    }
    if (e.usize === Infinity || e.csize === Infinity) {
      flag(e, 1, 'huge', 'declares a size beyond 2^53 bytes, which no real file has');
    }
  }

  /* ------------------------------------------------------------------------
     Cross-check the central directory against the local file headers
     ------------------------------------------------------------------------ */
  function checkLocals(v, model) {
    var limit = Math.min(model.entries.length, MAX_LFH);
    model.lfhChecked = limit;
    model.lfhBadSig = 0;
    model.lfhMismatch = [];
    model.overlaps = 0;

    var offsets = {};
    for (var i = 0; i < limit; i++) {
      var e = model.entries[i];
      var at = e.localAt;
      if (at === Infinity || at < 0) { model.lfhBadSig++; continue; }
      at += model.prepend;

      /* Several central directory entries pointing at the SAME local header is
         the mechanism behind the overlapping-entry zip bomb: one compressed
         blob, referenced thousands of times. */
      if (offsets[at]) { model.overlaps++; } else { offsets[at] = 1; }

      if (!v.has(at, 30) || v.u32(at) !== SIG_LOCAL) {
        model.lfhBadSig++;
        e.localBad = true;
        flag(e, 2, 'nolocal', 'its local header offset ' + hexAt(e.localAt) +
             ' does not point at a local file header');
        continue;
      }
      var lMethod = v.u16(at + 8);
      var lCrc = v.u32(at + 14);
      var lCsize = v.u32(at + 18);
      var lUsize = v.u32(at + 22);
      var lNameLen = v.u16(at + 26);
      var lFlags = v.u16(at + 6);

      var diffs = [];
      if (lMethod !== e.method) {
        diffs.push('method ' + methodName(lMethod) + ' vs ' + methodName(e.method));
      }
      /* With flag bit 3 the local header carries zeros and the real values
         follow the data in a descriptor, so a mismatch there is expected. */
      if (!(lFlags & 0x0008)) {
        if (lCrc !== e.crc) diffs.push('crc ' + hex8(lCrc) + ' vs ' + hex8(e.crc));
        if (lUsize !== 0xffffffff && e.usize !== Infinity &&
            lUsize !== (e.usize > 0xffffffff ? 0xffffffff : e.usize)) {
          diffs.push('size ' + lUsize + ' vs ' + e.usize);
        }
        if (lCsize !== 0xffffffff && e.csize !== Infinity &&
            lCsize !== (e.csize > 0xffffffff ? 0xffffffff : e.csize)) {
          diffs.push('compressed ' + lCsize + ' vs ' + e.csize);
        }
      }
      if (lNameLen !== e.rawLen) {
        diffs.push('name length ' + lNameLen + ' vs ' + e.rawLen);
      } else if (lNameLen > 0 && v.has(at + 30, lNameLen)) {
        var same = true;
        for (var k = 0; k < lNameLen; k++) {
          if (v.b[at + 30 + k] !== v.b[e.at + 46 + k]) { same = false; break; }
        }
        if (!same) diffs.push('the two copies of the filename differ');
      }
      if (diffs.length) {
        e.mismatch = diffs;
        flag(e, 2, 'mismatch', 'local header disagrees with the directory: ' + diffs.join('; '));
        model.lfhMismatch.push(e);
      }
    }
  }

  function methodName(m) {
    return METHODS[m] !== undefined ? METHODS[m] : ('method ' + m);
  }

  /* ------------------------------------------------------------------------
     Container identity — what kind of ZIP this actually is
     ------------------------------------------------------------------------ */
  function identify(model) {
    var have = {};
    var lower = {};
    model.entries.forEach(function (e) {
      have[e.name] = true;
      lower[e.name.toLowerCase()] = true;
    });
    var facts = [];
    var macro = [];

    function anyPrefix(prefix) {
      for (var i = 0; i < model.entries.length; i++) {
        if (model.entries[i].name.toLowerCase().indexOf(prefix) === 0) return true;
      }
      return false;
    }

    if (have['[Content_Types].xml']) {
      var kind = 'an Office Open XML package (OOXML)';
      if (lower['word/document.xml'] || anyPrefix('word/')) kind = 'a Word document (OOXML)';
      else if (lower['xl/workbook.xml'] || anyPrefix('xl/')) kind = 'an Excel workbook (OOXML)';
      else if (lower['ppt/presentation.xml'] || anyPrefix('ppt/')) kind = 'a PowerPoint file (OOXML)';
      facts.push({ sev: 0, text: '[Content_Types].xml is present — this is ' + kind + ', not a plain archive.' });

      model.entries.forEach(function (e) {
        var b = baseName(e.name).toLowerCase();
        if (b === 'vbaproject.bin') macro.push(e.name);
        if (b === 'vbadata.xml' || b === 'vbaprojectsignature.bin') macro.push(e.name);
      });
      if (macro.length) {
        facts.push({
          sev: 2,
          text: 'vbaProject.bin is present: this document contains VBA macros. A .docx or .xlsx ' +
                'is not supposed to hold macros at all — the macro-enabled formats are .docm and ' +
                '.xlsm — so a macro-bearing file with an .docx extension is deliberately mislabelled.'
        });
      } else {
        facts.push({ sev: 0, text: 'No vbaProject.bin — no VBA macro project in this document.' });
      }
      if (anyPrefix('xl/externallinks/')) {
        facts.push({ sev: 1, text: 'xl/externalLinks/ is present — the workbook ' +
                     'pulls data from another file or URL when it opens.' });
      }
      if (anyPrefix('word/embeddings/') || anyPrefix('xl/embeddings/') ||
          anyPrefix('ppt/embeddings/')) {
        facts.push({ sev: 1, text: 'An embeddings/ folder is present — other files, ' +
                     'often OLE objects, are packaged inside the document.' });
      }
    }

    if (lower['meta-inf/manifest.mf']) {
      facts.push({ sev: 0, text: 'META-INF/MANIFEST.MF is present — this is a Java JAR/WAR. A JAR runs code.' });
    }
    if (lower['androidmanifest.xml'] || lower['classes.dex']) {
      facts.push({ sev: 1, text: 'AndroidManifest.xml / classes.dex present — this is an Android APK.' });
    }
    if (lower['mimetype'] && lower['meta-inf/container.xml']) {
      facts.push({ sev: 0, text: 'mimetype + META-INF/container.xml — this is an EPUB book.' });
    } else if (lower['mimetype'] && lower['meta-inf/manifest.xml']) {
      facts.push({ sev: 0, text: 'mimetype + META-INF/manifest.xml — this is an OpenDocument file (ODT/ODS/ODP).' });
    }
    if (anyPrefix('__macosx/')) {
      facts.push({ sev: 0, text: '__MACOSX/ present — resource forks added by the ' +
                   'macOS Archive Utility. Harmless, but it leaks how and where ' +
                   'the archive was made.' });
    }
    return facts;
  }

  /* ------------------------------------------------------------------------
     Salvage mode: no EOCD, so walk local headers by brute force
     ------------------------------------------------------------------------ */
  function salvage(v, model) {
    var limit = Math.min(v.len, MAX_SALVAGE);
    model.salvageWindow = limit;
    var found = 0;
    for (var p = 0; p + 30 <= limit; p++) {
      if (v.dv.getUint32(p, true) !== SIG_LOCAL) continue;
      var e = {};
      e.at = p;
      e.versionMadeBy = 0;
      e.versionNeeded = v.u16(p + 4);
      e.flags = v.u16(p + 6);
      e.method = v.u16(p + 8);
      e.dosTime = v.u16(p + 10);
      e.dosDate = v.u16(p + 12);
      e.crc = v.u32(p + 14);
      e.csize = v.u32(p + 18);
      e.usize = v.u32(p + 22);
      var nameLen = v.u16(p + 26);
      var extraLen = v.u16(p + 28);
      if (nameLen < 0 || !v.has(p + 30, nameLen)) continue;
      var decoded = decodeName(v.b.subarray(p + 30, p + 30 + nameLen), !!(e.flags & 0x0800));
      e.name = decoded.text;
      e.encoding = decoded.enc;
      e.encNote = decoded.note;
      e.rawLen = nameLen;
      e.localAt = p;
      e.diskStart = 0;
      e.external = 0;
      e.unixMode = 0;
      e.extraIds = [];
      parseExtra(v, p + 30 + nameLen, extraLen, e);
      e.encrypted = !!(e.flags & 0x0001);
      e.strongCrypto = !!(e.flags & 0x0040);
      e.hasDataDescriptor = !!(e.flags & 0x0008);
      e.isDir = /[\/\\]$/.test(e.name);
      e.isSymlink = false;
      e.stamp = dosStamp(e.dosTime, e.dosDate);
      e.ratio = e.isDir ? null : ratioOf(e.usize, e.csize);
      classify(e);
      model.entries.push(e);
      found++;
      if (found >= 500) { model.salvageTruncated = true; break; }
      /* Skip past this header's declared data so the scan does not re-find
         signatures that are really compressed bytes. With a data descriptor
         the size is zero here and the scan just continues one byte at a time,
         which is the honest fallback. */
      if (!e.hasDataDescriptor && e.csize > 0 && e.csize !== 0xffffffff) {
        p = p + 30 + nameLen + extraLen + e.csize - 1;
      }
    }
    return found;
  }

  /* Totals, computed for both the normal and the salvaged path — the report
     reads them unconditionally, so they must always exist. */
  function finish(model) {
    var tu = 0, tc = 0, overflow = false;
    model.entries.forEach(function (e) {
      if (e.usize === Infinity || e.csize === Infinity) { overflow = true; return; }
      if (e.usize > 0) tu += e.usize;
      if (e.csize > 0) tc += e.csize;
    });
    model.totalUncompressed = tu;
    model.totalCompressed = tc;
    model.sizeOverflow = overflow;
    model.expansion = model.size > 0 ? tu / model.size : 0;
    if (model.lfhChecked === undefined) model.lfhChecked = 0;
    if (model.overlaps === undefined) model.overlaps = 0;
    return model;
  }

  /* ------------------------------------------------------------------------
     Parse
     ------------------------------------------------------------------------ */
  function parse(bytes) {
    var v = new View(bytes);
    var model = {
      size: bytes.length,
      entries: [],
      errors: [],
      notes: [],
      zip64: false,
      prepend: 0,
      trailing: 0,
      truncatedEntries: false,
      salvaged: false
    };

    if (bytes.length < 22) {
      model.fatal = 'The file is ' + bytes.length + ' bytes. The smallest possible ZIP — ' +
                    'an empty one — is 22 bytes.';
      return model;
    }

    var head = v.u32(0);
    model.startsWithLocal = (head === SIG_LOCAL);
    model.startsWithEocd = (head === SIG_EOCD);
    model.startsWithMZ = (bytes[0] === 0x4d && bytes[1] === 0x5a);

    var eocd = findEocd(v);
    if (!eocd) {
      /* No EOCD at all. Either it is not a ZIP, or the tail was cut off — a
         truncated download, or a deliberately damaged archive that some tools
         still open by reading local headers. Try that. */
      if (model.startsWithLocal || model.startsWithMZ) {
        model.salvaged = true;
        model.notes.push('No end-of-central-directory record was found, so the central directory ' +
                         'is missing or the file is truncated. Falling back to a scan for local ' +
                         'file headers — the results below are best effort, not the archive index. ' +
                         'The scan skips over each entry using the size the entry itself declares, ' +
                         'so one wrong size hides everything after it.');
        var n = salvage(v, model);
        if (!n) model.fatal = 'No ZIP structures found at all. This is not a ZIP archive.';
        return finish(model);
      }
      model.fatal = 'No end-of-central-directory record found. This file is not a ZIP archive, ' +
                    'or it has been truncated past recovery.';
      return model;
    }

    model.eocdAt = eocd.at;
    model.eocdCandidates = eocd.total;
    model.commentLen = eocd.commentLen;
    model.diskNumber = v.u16(eocd.at + 4);
    model.cdDisk = v.u16(eocd.at + 6);
    model.entriesThisDisk = v.u16(eocd.at + 8);
    model.claimedEntries = v.u16(eocd.at + 10);
    model.cdSize = v.u32(eocd.at + 12);
    model.cdOffset = v.u32(eocd.at + 16);
    model.trailing = bytes.length - (eocd.at + 22 + eocd.commentLen);

    if (eocd.commentLen > 0 && v.has(eocd.at + 22, eocd.commentLen)) {
      var cmt = '';
      var cmtBytes = bytes.subarray(eocd.at + 22, eocd.at + 22 + Math.min(eocd.commentLen, 400));
      for (var ci = 0; ci < cmtBytes.length; ci++) {
        cmt += cmtBytes[ci] >= 0x20 && cmtBytes[ci] < 0x7f ? String.fromCharCode(cmtBytes[ci]) : '.';
      }
      model.comment = cmt;
    }

    /* ---- ZIP64 ---- */
    var locAt = eocd.at - 20;
    if (locAt >= 0 && v.u32(locAt) === SIG_LOC64) {
      model.zip64 = true;
      model.zip64LocatorAt = locAt;
      var z64At = v.u64(locAt + 8);
      model.zip64Disks = v.u32(locAt + 16);
      if (z64At !== Infinity && v.has(z64At, 56) && v.u32(z64At) === SIG_EOCD64) {
        model.zip64At = z64At;
        model.claimedEntries = v.u64(z64At + 32);
        model.cdSize = v.u64(z64At + 40);
        model.cdOffset = v.u64(z64At + 48);
        model.zip64VersionNeeded = v.u16(z64At + 14);
        /* In a ZIP64 archive the 32-bit EOCD fields are deliberately set to
           0xFFFF / 0xFFFFFFFF as "look in the ZIP64 record" escapes. Reading
           them literally makes every ZIP64 file look like disk 65535 of a
           spanned set, which it is not. */
        model.diskNumber = v.u32(z64At + 16);
        model.cdDisk = v.u32(z64At + 20);
      } else {
        model.notes.push('A ZIP64 locator is present but the ZIP64 end-of-central-directory ' +
                         'record it points to (' + (z64At === Infinity ? 'beyond 2^53' : hexAt(z64At)) +
                         ') is not there. The 32-bit fields are being used instead, and they may ' +
                         'be truncated values.');
      }
    }

    if (model.cdOffset === Infinity || model.cdSize === Infinity) {
      model.fatal = 'The archive declares a central directory beyond 2^53 bytes. ' +
                    'That cannot be parsed here, and cannot be real.';
      return model;
    }

    /* ---- prepended data ---- */
    /* If the recorded offset does not hold a directory entry, the whole
       archive has probably been appended to something else — a self-extracting
       stub, or a polyglot file that is a valid image AND a valid ZIP. Every
       offset then needs the same constant added to it. */
    var cdStart = model.cdOffset;
    if (v.u32(cdStart) !== SIG_CDIR && model.claimedEntries !== 0) {
      var guess = eocd.at - model.cdSize;
      if (guess >= 0 && v.u32(guess) === SIG_CDIR) {
        model.prepend = guess - model.cdOffset;
        cdStart = guess;
      } else {
        /* Last resort: hunt for the first central directory signature. */
        var scanEnd = Math.min(v.len, MAX_SALVAGE) - 4;
        for (var s = 0; s <= scanEnd; s++) {
          if (v.dv.getUint32(s, true) === SIG_CDIR) {
            model.prepend = s - model.cdOffset;
            cdStart = s;
            model.notes.push('The recorded central directory offset was wrong; a directory ' +
                             'signature was found at ' + hexAt(s) + ' and used instead.');
            break;
          }
        }
      }
    }
    model.cdStart = cdStart;

    var endedAt = readEntries(v, cdStart, model);
    model.cdEnd = endedAt;
    if (model.entries.length >= MAX_ENTRIES) model.truncatedEntries = true;

    checkLocals(v, model);
    return finish(model);
  }

  /* ------------------------------------------------------------------------
     Report
     ------------------------------------------------------------------------ */
  var out = LabTool.out('tool-out');

  function markers(e) {
    var m = '';
    if (has(e, 'slip') || has(e, 'nolocal') || has(e, 'mismatch')) m += '!';
    if (has(e, 'bomb') || has(e, 'impossible')) m += 'B';
    if (has(e, 'bidi') || has(e, 'spacer') || has(e, 'blank') || has(e, 'double')) m += 'U';
    if (has(e, 'exec') || has(e, 'double')) m += 'X';
    if (has(e, 'nested')) m += 'A';
    if (e.encrypted || e.strongCrypto) m += 'E';
    if (e.isSymlink) m += 'L';
    if (!m && e.isDir) m = 'd';
    return pad(m.slice(0, 4), 4);
  }

  function has(e, codes) {
    var want = typeof codes === 'string' ? [codes] : codes;
    for (var i = 0; i < e.issues.length; i++) {
      for (var j = 0; j < want.length; j++) {
        if (e.issues[i].code === want[j]) return true;
      }
    }
    return false;
  }

  /* One entry appears once even when it matched several codes — an entry that
     is both a bomb and an impossible deflate ratio is still one entry, and
     counting it twice would overstate the finding. */
  function collect(model, codes) {
    var list = [];
    for (var i = 0; i < model.entries.length; i++) {
      if (has(model.entries[i], codes)) list.push(model.entries[i]);
    }
    return list;
  }

  function section(title) {
    out.rule();
    out.heading(title);
  }

  function printFindings(list, codes, cls) {
    var want = typeof codes === 'string' ? [codes] : codes;
    var shown = Math.min(list.length, MAX_DETAIL);
    for (var i = 0; i < shown; i++) {
      var e = list[i];
      out.line('  ' + safe(e.name), cls);
      for (var j = 0; j < e.issues.length; j++) {
        if (want.indexOf(e.issues[j].code) < 0) continue;
        out.line('    ' + e.issues[j].text, 't-dim');
      }
    }
    if (list.length > shown) {
      out.dim('    ... and ' + (list.length - shown) + ' more, not listed.');
    }
  }

  function report(model, file) {
    out.clear();
    out.heading(file.name);
    out.row('size on disk', LabTool.humanBytes(model.size) + '  (' + model.size + ' bytes)');
    out.row('last modified',
            file.lastModified ? new Date(file.lastModified).toISOString() : 'unknown');

    if (model.fatal) {
      out.rule();
      out.err(model.fatal);
      if (model.startsWithMZ) {
        out.dim('The file starts with MZ, so it is a Windows executable. Self-extracting');
        out.dim('archives look like this: an .exe with a ZIP glued on the end.');
      }
      out.rule();
      out.dim('Nothing was uploaded. The file was read and parsed in this tab.');
      return;
    }

    /* ---- structure ---- */
    section('Archive structure');
    if (model.salvaged) {
      out.warn('Recovered by scanning for local file headers — see the note above.');
      if (model.salvageTruncated) {
        out.warn('Stopped after 500 recovered headers.');
      }
      out.row('scan window', LabTool.humanBytes(model.salvageWindow));
    } else {
      out.row('EOCD record at', hexAt(model.eocdAt));
      out.row('central directory', hexAt(model.cdStart) + ', ' + LabTool.humanBytes(model.cdSize));
      out.row('entries claimed',
              model.claimedEntries === Infinity ? 'beyond 2^53' : model.claimedEntries);
      out.row('entries read', model.entries.length +
              (model.truncatedEntries ? '  (capped)' : ''),
              model.entries.length === model.claimedEntries ? 't-ok' : 't-warn');
      out.row('ZIP64', model.zip64 ? 'yes' : 'no', model.zip64 ? 't-info' : '');
      out.row('archive comment',
              model.commentLen ? model.commentLen + ' bytes' : 'none');
    }

    /* Only a real disagreement is worth the warning — when the shortfall is
       this tool's own entry cap, the truncation notice below explains it. */
    if (model.entries.length !== model.claimedEntries && !model.salvaged &&
        !model.truncatedEntries) {
      out.warn('The directory says ' + model.claimedEntries + ' entries and ' +
               model.entries.length + ' were actually readable. A reader that trusts the count ' +
               'and a reader that walks the entries will see different archives.');
    }
    if (model.eocdCandidates > 1) {
      out.warn(model.eocdCandidates + ' end-of-central-directory signatures were found in the ' +
               'tail of this file. Only one can be correct; different unzip implementations pick ' +
               'different ones, which is a way to hand two readers two different archives.');
    }
    if (model.zip64) {
      out.dim('ZIP64 lifts the 4 GB and 65535-entry limits by storing 64-bit sizes in an extra');
      out.dim('field. Everything below is read through it where present. Values above 2^53 are');
      out.dim('reported as such rather than rounded.');
    }
    if (model.prepend > 0) {
      out.warn(LabTool.humanBytes(model.prepend) + ' of data sits in front of the archive ' +
               '(' + model.prepend + ' bytes). That is how self-extracting executables and ' +
               'polyglot files are built: something else first, ZIP appended. All offsets have ' +
               'been corrected by that amount.');
    } else if (model.prepend < 0) {
      out.warn('The recorded offsets point ' + LabTool.humanBytes(-model.prepend) + ' past the ' +
               'end of the archive (' + model.prepend + ' bytes): every stored position is larger ' +
               'than the file is long, which is what a stripped self-extracting stub looks like. ' +
               'All offsets have been shifted back by that amount.');
    }
    if (model.trailing > 0) {
      out.warn(model.trailing + ' bytes follow the end-of-central-directory record. Nothing in ' +
               'the format needs them, so they are either padding or a second payload.');
    }
    if (!model.salvaged && (model.diskNumber !== 0 || model.cdDisk !== 0)) {
      out.warn('This is part of a split/spanned archive (disk ' + model.diskNumber + '). ' +
               'The other volumes are not here, so the listing is incomplete.');
    }
    if (model.comment) {
      out.row('comment', safe(model.comment.slice(0, 120)));
    }
    model.notes.forEach(function (n) { out.warn(n); });
    model.errors.forEach(function (n) { out.err(n); });
    if (model.truncatedEntries) {
      out.warn('Stopped after ' + MAX_ENTRIES + ' entries so the page stays responsive. ' +
               'Everything below describes that subset only.');
    }

    if (!model.entries.length) {
      out.rule();
      out.ok('The archive is empty — a valid ZIP with no files in it.');
      out.rule();
      out.dim('Nothing was uploaded. The file was read and parsed in this tab.');
      return;
    }

    /* ---- verdict ---- */
    var slip = collect(model, 'slip');
    var backslash = collect(model, 'backslash');
    var symlinks = collect(model, 'symlink');
    var bombs = collect(model, ['bomb', 'impossible']);
    var ratios = collect(model, 'ratio');
    var bidi = collect(model, 'bidi');
    var doubles = collect(model, 'double');
    var execs = collect(model, 'exec');
    var nested = collect(model, 'nested');
    var spacers = collect(model, ['spacer', 'blank']);
    var encrypted = collect(model, 'encrypted');
    var mismatch = collect(model, ['mismatch', 'nolocal']);
    var twoname = collect(model, 'twoname');

    var critical = 0, warned = 0;
    model.entries.forEach(function (e) {
      if (e.worst === 2) critical++;
      else if (e.worst === 1) warned++;
    });

    section('Verdict');
    var total = model.entries.length;
    if (critical) {
      out.err(critical + ' of ' + total + ' entries ' + (critical === 1 ? 'carries' : 'carry') +
              ' a critical finding. Do not extract this archive with a plain unzip.');
    } else if (warned) {
      out.warn(warned + ' of ' + total + ' entries ' + (warned === 1 ? 'is' : 'are') +
               ' worth a second look. Nothing critical.');
    } else {
      out.ok('No path traversal, no impossible ratios and no disguised names in ' +
             total + (total === 1 ? ' entry.' : ' entries.'));
    }
    /* Each entry is individually finite (u64 returns Infinity above 2^53), but
       the sum of many entries is not bounded, so a large or fabricated archive
       can carry a total past the safe-integer limit and be printed as a
       confidently wrong figure. Disclose it, with wording distinct from the
       per-entry overflow caveat since the cause is different. */
    out.row('total uncompressed', sizeText(model.totalUncompressed) +
            (model.totalUncompressed > 9007199254740991 ? '  (sum past 2^53 — approximate)'
             : (model.sizeOverflow ? '  (plus entries that overflowed)' : '')));
    out.row('total compressed', sizeText(model.totalCompressed) +
            (model.totalCompressed > 9007199254740991 ? '  (sum past 2^53 — approximate)' : ''));
    out.row('expansion vs file', model.expansion >= 1000 ? Math.round(model.expansion) + 'x'
                                                         : model.expansion.toFixed(1) + 'x',
            model.expansion > 1000 ? 't-err' : model.expansion > 100 ? 't-warn' : 't-ok');

    /* ---- zip slip ---- */
    section('Path traversal (ZIP slip)');
    if (slip.length) {
      out.err(slip.length + ' entr' + (slip.length === 1 ? 'y' : 'ies') +
              ' would be written outside the directory you extract into.');
      printFindings(slip, 'slip', 't-err');
      out.line('');
      out.dim('An unzip tool that joins the target directory to the stored path without');
      out.dim('normalising it will happily write ../../../../etc/cron.d/x or');
      out.dim('C:\\Windows\\System32\\x. The archive chooses the destination, not you. This is');
      out.dim('CVE-worthy in library after library and it is still the most common way an');
      out.dim('archive turns into code execution.');
    } else {
      out.ok('No entry escapes the target directory.');
      out.dim('Every path is relative and stays inside it.');
    }
    if (backslash.length) {
      out.line('');
      out.warn(backslash.length + ' entr' + (backslash.length === 1 ? 'y contains' : 'ies contain') +
               ' a backslash in the stored path.');
      printFindings(backslash, 'backslash', 't-warn');
    }
    if (symlinks.length) {
      out.line('');
      out.warn(symlinks.length + ' symbolic link' + (symlinks.length === 1 ? '' : 's') + ' in the archive.');
      printFindings(symlinks, 'symlink', 't-warn');
      out.dim('A link plus a later entry writing "through" it is the same escape as ..,');
      out.dim('and it survives extractors that only check for dot-dot.');
    }
    if (twoname.length) {
      out.line('');
      out.warn('Entries storing two different names:');
      printFindings(twoname, 'twoname', 't-warn');
    }

    /* ---- zip bomb ---- */
    section('Compression ratios (zip bomb)');
    out.row('archive on disk', LabTool.humanBytes(model.size));
    out.row('claims to expand to', sizeText(model.totalUncompressed));
    if (bombs.length) {
      out.err(bombs.length + (bombs.length === 1 ? ' entry declares' : ' entries declare') +
              ' a ratio past 1000:1.');
      var worst = bombs.slice().sort(function (a, b) {
        var ra = a.ratio === null ? 0 : (a.ratio === Infinity ? 1e30 : a.ratio);
        var rb = b.ratio === null ? 0 : (b.ratio === Infinity ? 1e30 : b.ratio);
        return rb - ra;
      });
      printFindings(worst, ['bomb', 'impossible'], 't-err');
      out.line('');
      out.dim('Extracting this would turn ' + LabTool.humanBytes(model.size) + ' on disk into ' +
              sizeText(model.totalUncompressed) + '. Antivirus scanners, mail gateways and CI');
      out.dim('runners have all been knocked over by exactly this — the file is small enough to');
      out.dim('pass every size limit and the damage happens after the limit is checked.');
    } else if (ratios.length) {
      out.warn(ratios.length + ' entr' + (ratios.length === 1 ? 'y compresses' : 'ies compress') +
               ' better than 100:1.');
      printFindings(ratios, 'ratio', 't-warn');
      out.dim('Not conclusive. Log files, sparse disk images and XML all compress like this.');
    } else {
      out.ok('No entry compresses better than 100:1.');
    }
    if (model.overlaps > 0) {
      out.line('');
      out.err(model.overlaps + ' entries share a local file header offset with another entry.');
      out.dim('That is the signature of the overlapping-entry zip bomb: one compressed blob of');
      out.dim('zeros, referenced by thousands of directory entries, so the archive stays tiny');
      out.dim('while the extracted total is enormous. It also breaks the assumption that entry');
      out.dim('count times entry size bounds the work.');
    }
    out.dim('Sizes here are what the archive DECLARES. Confirming them means decompressing,');
    out.dim('which is the thing this tool refuses to do.');

    /* ---- names and content ---- */
    section('Names and content');
    if (bidi.length) {
      out.err('Right-to-left override or other bidi control characters in ' + bidi.length +
              ' name' + (bidi.length === 1 ? '' : 's') + '.');
      printFindings(bidi, 'bidi', 't-err');
      out.dim('U+202E flips the rendering of everything after it. The classic sample is');
      out.dim('"photo_high_re<U+202E>gnp.js", which Explorer, mail clients and most terminals');
      out.dim('draw as "photo_high_resj.png". The bytes on disk still end in .js and Windows');
      out.dim('still runs it. Names above are printed with the control characters escaped so');
      out.dim('this report cannot be reordered the same way.');
    }
    if (doubles.length) {
      out.err('Double extensions in ' + doubles.length + ' name' + (doubles.length === 1 ? '' : 's') + '.');
      printFindings(doubles, 'double', 't-err');
      out.dim('Windows hides known extensions by default, so report.pdf.exe shows as report.pdf');
      out.dim('with a PDF-looking icon.');
    }
    if (spacers.length) {
      out.err('Names padded with whitespace:');
      printFindings(spacers, ['spacer', 'blank'], 't-err');
    }
    if (execs.length) {
      out.warn(execs.length + ' executable or script file' + (execs.length === 1 ? '' : 's') + ':');
      printFindings(execs, 'exec', 't-warn');
    }
    if (!bidi.length && !doubles.length && !spacers.length && !execs.length) {
      out.ok('No executables, disguised names or bidi tricks.');
    }
    /* The quieter name findings, each in its own colour: the first group are
       warnings, the second group are notes that only matter in context. */
    [['control', 't-warn'], ['trailing', 't-warn'], ['reserved', 't-warn'],
     ['longname', 't-warn'], ['noname', 't-warn'], ['setuid', 't-warn'],
     ['huge', 't-warn'], ['date', 't-dim'], ['dots', 't-dim']]
      .forEach(function (pair) {
        var list = collect(model, pair[0]);
        if (!list.length) return;
        out.line('');
        printFindings(list, pair[0], pair[1]);
      });

    /* ---- nested and identity ---- */
    section('Container contents');
    if (nested.length) {
      out.warn(nested.length + ' nested archive' + (nested.length === 1 ? '' : 's') + ':');
      printFindings(nested, 'nested', 't-warn');
      out.dim('Nothing here opens them. Drop one in separately — each layer is its own');
      out.dim('archive with its own paths and its own ratios, and nesting is the oldest way');
      out.dim('to get past a scanner that only looks one level deep.');
    } else {
      out.dim('No nested archives.');
    }
    var facts = identify(model);
    if (facts.length) {
      out.line('');
      facts.forEach(function (f) {
        if (f.sev === 2) out.err(f.text);
        else if (f.sev === 1) out.warn(f.text);
        else out.dim(f.text);
      });
    }

    /* ---- encryption ---- */
    if (encrypted.length) {
      section('Encryption');
      out.warn(encrypted.length + ' of ' + model.entries.length + ' entries ' +
               (encrypted.length === 1 ? 'is' : 'are') + ' encrypted.');
      var aesCount = 0, legacy = 0, bits = {};
      model.entries.forEach(function (e) {
        if (e.aes) {
          aesCount++;
          /* WinZip AES strength: 1 = 128-bit, 2 = 192-bit, 3 = 256-bit. */
          bits[[0, 128, 192, 256][e.aes.strength] || '?'] = 1;
        } else if (e.encrypted) {
          legacy++;
        }
      });
      if (aesCount) {
        out.row('WinZip AES', aesCount + ' entries, ' +
                Object.keys(bits).join('/') + '-bit keys');
      }
      if (legacy) out.row('ZipCrypto (legacy)', legacy + ' entries', 't-warn');
      if (legacy) {
        out.dim('ZipCrypto is the original 1990 stream cipher and is broken: with about 12 bytes');
        out.dim('of known plaintext the key is recoverable, and any other file you already have a');
        out.dim('copy of provides it.');
      }
      var anyCdEncrypted = false;
      model.entries.forEach(function (e) { if (e.cdEncrypted) anyCdEncrypted = true; });
      if (!anyCdEncrypted) {
        out.dim('Note that the filenames, sizes and CRCs above are readable anyway — standard ZIP');
        out.dim('encryption covers file contents only, so the directory leaks the structure of');
        out.dim('whatever is inside.');
      }
    }

    /* ---- header consistency ---- */
    /* Only meaningful when there is a central directory to compare against;
       in salvage mode the local headers ARE the source. */
    if (model.salvaged) {
      section('Directory vs local headers');
      out.dim('Skipped — there is no central directory in this file, so there is nothing');
      out.dim('to compare the local headers against.');
    } else {
      section('Directory vs local headers');
      out.row('entries cross-checked', model.lfhChecked + ' of ' + model.entries.length);
      if (mismatch.length) {
        out.err(mismatch.length + ' entr' + (mismatch.length === 1 ? 'y' : 'ies') +
                ' where the two copies of the metadata disagree.');
        printFindings(mismatch, ['mismatch', 'nolocal'], 't-err');
        out.dim('Every entry is described twice: once in the central directory and once in the');
        out.dim('local header in front of its data. Some tools read one, some the other. When');
        out.dim('they disagree, a scanner and an extractor can be shown different files — which');
        out.dim('is the entire trick behind several mail-gateway bypasses.');
      } else if (model.lfhChecked) {
        out.ok('The central directory and the local headers agree.');
      }
      if (model.lfhChecked < model.entries.length) {
        out.dim('Cross-check stopped at ' + MAX_LFH + ' entries to keep the page responsive.');
      }
    }

    /* ---- full listing ---- */
    section('Full listing');
    out.dim('flags: ! traversal or header mismatch   B bomb ratio   U disguised name');
    out.dim('       X executable   A nested archive   E encrypted   L symlink   d directory');
    out.line('');
    out.line(pad('flag', 5) + pad('method', 12) + padL('size', 10) + padL('packed', 10) +
             padL('ratio', 9) + '  ' + pad('crc32', 9) + pad('modified', 17) + 'path', 't-dim');

    var shown = Math.min(model.entries.length, MAX_LIST);
    for (var i = 0; i < shown; i++) {
      var e = model.entries[i];
      /* WinZip AES stores the real method in the extra field and leaves 99 in
         the header, so show both. Truncated to the column width so one long
         name cannot shunt every later column sideways. */
      var method = methodName(e.method);
      if (e.aes) method = 'aes/' + methodName(e.aes.method);
      var line = pad(markers(e), 5) +
                 pad(method.slice(0, 11), 12) +
                 padL(e.isDir ? '-' : sizeText(e.usize), 10) +
                 padL(e.isDir ? '-' : sizeText(e.csize), 10) +
                 padL(ratioCol(e.ratio), 9) + '  ' +
                 pad(hex8(e.crc), 9) +
                 pad(e.stamp.text, 17) +
                 safe(e.name);
      out.line(line, e.worst === 2 ? 't-err' : e.worst === 1 ? 't-warn' : (e.isDir ? 't-dim' : ''));
    }
    if (model.entries.length > shown) {
      out.dim('... ' + (model.entries.length - shown) + ' more entries not printed. The findings ' +
              'above cover all ' + model.entries.length + ' parsed entries, only the listing is cut.');
    }

    /* encoding footnote — only if anything unusual turned up */
    var encNotes = {};
    model.entries.forEach(function (e) { if (e.encNote) encNotes[e.encNote] = 1; });
    var encKeys = Object.keys(encNotes);
    if (encKeys.length) {
      out.line('');
      encKeys.forEach(function (k) { out.warn('filename encoding: ' + k); });
    }

    out.rule();
    out.dim('Nothing was decompressed and nothing was uploaded. Every number above comes from');
    out.dim('the archive index, read in this tab — which is the point: you can decide whether');
    out.dim('to extract something without extracting it first.');
  }

  /* ------------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------------ */
  var lastBytes = null, lastFile = null;

  function analyse(bytes, file) {
    /* Hostile input is the normal case for this tool, so the whole parse runs
       inside one try. A crash here would leave the pane blank, which tells the
       visitor nothing. */
    try {
      var model = parse(bytes);
      report(model, file);
    } catch (err) {
      out.clear();
      out.err('The parser gave up on this file: ' +
              (err && err.message ? err.message : String(err)));
      out.dim('That is itself a result — a well-formed ZIP does not do this. The file may be');
      out.dim('truncated, deliberately malformed, or not a ZIP at all. Nothing was extracted');
      out.dim('and nothing was uploaded.');
    }
  }

  LabTool.define({
    id: 'archiveinspectortool',
    run: function () {
      if (lastBytes) analyse(lastBytes, lastFile);
      else out.clear().warn('Choose or drop a ZIP archive to inspect.');
    },
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          lastBytes = bytes;
          lastFile = file;
          var nameEl = document.getElementById('tool-dropname');
          if (nameEl) nameEl.textContent = file.name;
          analyse(bytes, file);
        },
        onError: function (msg) { out.clear().err(msg); }
      });
      out.dim('Drop a .zip — or a .docx, .xlsx, .jar, .apk or .epub, which are all ZIPs.');
      out.dim('The archive is never decompressed and never uploaded: this reads the index');
      out.dim('and reports what extracting it would do. That is what makes it safe to point');
      out.dim('at an attachment you do not trust.');
    }
  });
})();

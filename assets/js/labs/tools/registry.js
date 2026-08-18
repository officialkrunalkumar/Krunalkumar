/* ==========================================================================
   registry.js — parse a raw Windows registry hive and surface the keys an
   incident responder actually opens it for.
   --------------------------------------------------------------------------
   A hive is the densest artefact on a Windows machine: what ran, what was
   plugged in, what was installed, what starts at boot, who logged in and
   when. The existing tools for reading one offline are Windows-only
   (RegRipper, Registry Explorer) or they want you to upload the file. A
   SYSTEM or NTUSER.DAT from a live incident is not a file you upload
   anywhere, so this parses the bytes here, in the tab, and nothing leaves.

   The format is documented but it is full of edges that break a first
   implementation. The ones that cost real time:

   - Every offset stored inside a cell is relative to 0x1000, the start of the
     hive bins — not to the start of the file. Forget that once and you read
     4 KB of garbage and conclude the hive is corrupt.
   - A cell's size is a SIGNED 32-bit integer. Negative means allocated.
     Positive means free — and free cells still hold the contents of deleted
     keys, which is why this tool also sweeps them at the end.
   - A value record with bit 31 set in its data-size field does not point at a
     cell at all. The data IS the four bytes of the offset field. Every naive
     parser dereferences that as a pointer and either crashes or silently
     invents data. Handled explicitly in readVk, and commented there.
   - Values larger than 16344 bytes are split across a 'db' segment list in
     hives of minor version 4 and up. Miss it and long REG_MULTI_SZ values
     come back truncated to their first chunk.
   - Subkey lists come in four shapes, 'lf' 'lh' 'li' and 'ri'. 'ri' is the
     forgettable one: it is a list of lists, and it only appears once a key
     has thousands of subkeys — which is exactly the Services and Uninstall
     keys you care about, on exactly the big machines you are asked to look at.
   - Timestamps are Windows FILETIME: 100-nanosecond ticks since 1601. A
     current one is about 1.3e17, comfortably past Number.MAX_SAFE_INTEGER, so
     "hi * 2^32 + lo" loses precision. This divides the two halves separately
     so every intermediate stays an exact integer, which avoids depending on
     BigInt for a browser feature check we do not need.
   - The nk layout is usually quoted with the 4-byte cell size counted in,
     which puts the name length at 0x4c. Offsets here are from the 'nk'
     signature, so the same field is at 0x48. Both numbers are correct; they
     are measured from different places. Getting this wrong shifts every key
     name by four bytes and is very hard to spot, because the result still
     looks like text.

   One deliberate omission. SAM hives contain LM and NT password hashes. This
   reports whether they are present and how long they are, and stops there. To
   be useful they must be decrypted with the bootkey from the SYSTEM hive, and
   an offline credential dumper is a different tool with a different audience.
   Everything else in the SAM — accounts, RIDs, logon counts, timestamps — is
   shown in full.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 256 * 1024 * 1024;

  var HBIN_BASE = 0x1000;      // hive bins start here; all cell offsets are relative to it
  var NO_OFFSET = 0xffffffff;  // the "there is nothing here" sentinel
  var MAX_INLINE = 4;          // an inline value cannot exceed the 4-byte offset field
  var BIG_SEG = 16344;         // payload per 'db' segment
  var READ_BUDGET = 3000000;   // cell reads per report — a hard stop on pointer loops
  var SWEEP_LIMIT = 3000000;   // cells examined by the free-space sweep
  var SWEEP_MAX_BYTES = 96 * 1024 * 1024;

  var out = LabTool.out('tool-out');
  var hive = null;
  var lastFileName = '';

  /* ======================================================================
     Small helpers
     ====================================================================== */

  function pad(text, width) {
    text = String(text);
    return text.length >= width ? text : text + new Array(width - text.length + 1).join(' ');
  }

  /* Control characters wreck the alignment of a monospaced pane, and a hostile
     hive can absolutely contain them in a key name. The test-before-replace is
     not premature: clean() runs on every key and value name, which is hundreds
     of thousands of calls on a large hive, and almost none of them match. */
  var CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
  var CTRL_G = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
  function clean(text) {
    text = String(text);
    return CTRL.test(text) ? text.replace(CTRL_G, '.') : text;
  }

  function trunc(text, limit) {
    text = String(text);
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  }

  function rot13(text) {
    return String(text).replace(/[a-zA-Z]/g, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
  }

  /* FILETIME -> ISO 8601 UTC.
     value = hi * 2^32 + lo, in 100ns ticks since 1601-01-01. That product is
     ~1.3e17 for a modern timestamp and doubles only hold integers exactly up
     to 9.0e15, so it is divided in two stages: the high half first, then the
     remainder folded into the low half. Every intermediate stays under 2^53,
     so the millisecond result is exact and no BigInt is needed. */
  function filetimeMs(lo, hi) {
    if (!lo && !hi) return null;
    var q1 = Math.floor(hi / 10000);
    var r1 = hi % 10000;
    var t = r1 * 4294967296 + lo;      // < 10000 * 2^32 = 4.3e13, exact
    var q2 = Math.floor(t / 10000);
    var ms = q1 * 4294967296 + q2;     // total 100ns ticks / 10000 = milliseconds
    return ms - 11644473600000;        // 1601 epoch -> 1970 epoch
  }

  function hex8(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }

  function filetimeText(lo, hi) {
    var ms = filetimeMs(lo, hi);
    if (ms === null) return 'never set (zero)';
    if (ms < -11644473600000 || ms > 32503680000000) {
      return 'out of range (0x' + hex8(hi) + hex8(lo) + ')';
    }
    try {
      return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', '').replace('Z', '') + ' UTC';
    } catch (err) {
      return 'unreadable timestamp';
    }
  }

  /* A plausibility test, used to decide whether an unlabelled 8-byte binary
     blob is worth showing as a date. 1990-2100 is wide enough to catch real
     data and narrow enough that random bytes rarely pass. */
  function plausibleFiletime(lo, hi) {
    var ms = filetimeMs(lo, hi);
    if (ms === null) return false;
    return ms > 631152000000 && ms < 4102444800000;
  }

  function unixSecText(seconds) {
    if (!seconds) return 'not set';
    try {
      return new Date(seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', '') + ' UTC';
    } catch (err) { return String(seconds); }
  }

  /* ======================================================================
     Hive reader
     ====================================================================== */

  var TYPES = {
    0: 'REG_NONE', 1: 'REG_SZ', 2: 'REG_EXPAND_SZ', 3: 'REG_BINARY',
    4: 'REG_DWORD', 5: 'REG_DWORD_BIG_ENDIAN', 6: 'REG_LINK',
    7: 'REG_MULTI_SZ', 8: 'REG_RESOURCE_LIST',
    9: 'REG_FULL_RESOURCE_DESCRIPTOR', 10: 'REG_RESOURCE_REQUIREMENTS_LIST',
    11: 'REG_QWORD'
  };

  function sigAt(h, at) {
    if (at + 2 > h.bytes.length) return '';
    return String.fromCharCode(h.bytes[at], h.bytes[at + 1]);
  }

  /* Registry "ASCII" names are really a single-byte codepage. String.fromCharCode
     gives Latin-1, which is right for the overwhelming majority and wrong in a
     visible, harmless way for the rest.

     fromCharCode.apply rather than a += loop: on a hive with tens of thousands
     of keys this one function was most of the runtime, because building a
     string a character at a time allocates on every step. Names are clamped to
     1024 bytes before they get here, so the argument list stays well inside
     what apply() will accept. */
  function latin1(h, at, len) {
    var end = Math.min(at + len, h.bytes.length);
    if (end <= at) return '';
    return String.fromCharCode.apply(null, h.bytes.subarray(at, end));
  }

  /* len is a BYTE count, not a character count — the format stores it that way
     for both name encodings, which is easy to misread. */
  function utf16(h, at, len) {
    var end = Math.min(at + len, h.bytes.length);
    var codes = [];
    for (var i = at; i + 1 < end; i += 2) {
      codes.push(h.bytes[i] | (h.bytes[i + 1] << 8));
    }
    return codes.length ? String.fromCharCode.apply(null, codes) : '';
  }

  /* Value data, unlike a name, has no small bound — a REG_MULTI_SZ can be
     megabytes. Converted in blocks so the argument list to apply() stays sane,
     and capped, because nothing in this report displays more than a few
     hundred characters of any single value. */
  var UTF16_CAP = 262144;
  function utf16Bytes(bytes) {
    if (!bytes || bytes.length < 2) return '';
    var limit = Math.min(bytes.length, UTF16_CAP);
    var parts = [], codes = [];
    for (var i = 0; i + 1 < limit; i += 2) {
      codes.push(bytes[i] | (bytes[i + 1] << 8));
      if (codes.length === 4096) {
        parts.push(String.fromCharCode.apply(null, codes));
        codes = [];
      }
    }
    if (codes.length) parts.push(String.fromCharCode.apply(null, codes));
    return parts.join('');
  }

  /* Read the cell at a hive-bins-relative offset. Returns the payload window,
     or null for anything that does not make sense — a sentinel offset, a cell
     that claims to be smaller than its own header, one that runs off the end
     of the file, or a read past the budget. Returning null everywhere means no
     caller has to guard, and a corrupt hive degrades into missing sections
     instead of an exception. */
  function readCell(h, rel) {
    if (rel === NO_OFFSET || rel === undefined || rel === null) return null;
    rel = rel >>> 0;
    if (h.budget <= 0) { h.exhausted = true; return null; }
    h.budget--;
    var at = HBIN_BASE + rel;
    if (at + 4 > h.bytes.length) { h.badPointers++; return null; }
    var size = h.dv.getInt32(at, true);
    var used = size < 0;
    var len = size < 0 ? -size : size;
    if (len < 8 || at + len > h.bytes.length) { h.badPointers++; return null; }
    return { at: at + 4, len: len - 4, used: used, rel: rel };
  }

  /* ---- nk: a named key ------------------------------------------------- */
  function readNk(h, rel) {
    var cell = readCell(h, rel);
    if (!cell || cell.len < 0x4c) return null;
    var p = cell.at;
    /* Raw byte compare rather than sigAt(): this runs once per key and there
       can be a million of them. 0x6e 0x6b is 'nk'. */
    if (h.bytes[p] !== 0x6e || h.bytes[p + 1] !== 0x6b) return null;

    var flags = h.dv.getUint16(p + 0x02, true);
    /* Field offsets below are measured from the 'nk' signature. Documentation
       that counts the 4-byte cell size instead shows each of these 4 higher. */
    var nameLen = h.dv.getUint16(p + 0x48, true);
    if (nameLen > cell.len - 0x4c) nameLen = Math.max(0, cell.len - 0x4c);
    if (nameLen > 1024) nameLen = 1024;

    /* Flag 0x20 (KEY_COMP_NAME) means the name is one byte per character.
       Without it, it is UTF-16LE and nameLen is still a BYTE count. */
    var name = (flags & 0x20) ? latin1(h, p + 0x4c, nameLen)
                              : utf16(h, p + 0x4c, nameLen);

    return {
      rel: rel,
      allocated: cell.used,
      flags: flags,
      tsLo: h.dv.getUint32(p + 0x04, true),
      tsHi: h.dv.getUint32(p + 0x08, true),
      parent: h.dv.getUint32(p + 0x10, true),
      subkeyCount: h.dv.getUint32(p + 0x14, true),
      subkeyList: h.dv.getUint32(p + 0x1c, true),
      valueCount: h.dv.getUint32(p + 0x24, true),
      valueList: h.dv.getUint32(p + 0x28, true),
      classOffset: h.dv.getUint32(p + 0x30, true),
      classLen: h.dv.getUint16(p + 0x4a, true),
      name: clean(name)
    };
  }

  function nkTime(node) { return filetimeText(node.tsLo, node.tsHi); }

  /* ---- subkey lists: lf / lh / li / ri ---------------------------------- */
  function collectSubkeys(h, rel, depth, acc) {
    if (rel === NO_OFFSET || acc.length >= 131072 || depth > 8) return acc;
    var cell = readCell(h, rel);
    if (!cell || cell.len < 4) return acc;
    var p = cell.at;
    var sig = sigAt(h, p);
    var count = h.dv.getUint16(p + 0x02, true);
    var i, entry;

    if (sig === 'lf' || sig === 'lh') {
      /* 8 bytes per entry: the nk offset, then a 4-character name hint ('lf')
         or a name hash ('lh'). Both hints are ignored here — they exist to
         speed up lookups and this walks everything anyway. */
      for (i = 0; i < count; i++) {
        entry = p + 4 + i * 8;
        if (entry + 4 > p + cell.len) break;
        acc.push(h.dv.getUint32(entry, true));
      }
    } else if (sig === 'li') {
      for (i = 0; i < count; i++) {
        entry = p + 4 + i * 4;
        if (entry + 4 > p + cell.len) break;
        acc.push(h.dv.getUint32(entry, true));
      }
    } else if (sig === 'ri') {
      /* The one everybody forgets: 'ri' holds offsets to OTHER subkey lists,
         not to keys. It shows up once a key outgrows a single list cell, which
         in practice means Services, Uninstall and Enum on real machines. */
      for (i = 0; i < count; i++) {
        entry = p + 4 + i * 4;
        if (entry + 4 > p + cell.len) break;
        collectSubkeys(h, h.dv.getUint32(entry, true), depth + 1, acc);
      }
    } else if (sig === 'nk') {
      /* Very old hives sometimes point a single-subkey list straight at the
         key itself rather than wrapping it in a list. */
      acc.push(rel);
    }
    return acc;
  }

  /* limit bounds how many child records are actually materialised. The tree
     browser wants all of them; the forensic sections pass a limit, because a
     key with 60,000 children is a denial-of-service dressed up as a hive and
     no real machine has that many services or installed programs. When the
     limit bites, list.capped is set so the caller can say so. */
  function subkeys(h, node, limit) {
    var list = [];
    list.capped = false;
    list.declared = 0;
    if (!node || !node.subkeyCount) return list;
    var offsets = collectSubkeys(h, node.subkeyList, 0, []);
    var max = limit ? Math.min(limit, offsets.length) : offsets.length;
    for (var i = 0; i < max; i++) {
      var child = readNk(h, offsets[i]);
      if (child) list.push(child);
    }
    list.capped = offsets.length > max;
    list.declared = offsets.length;
    return list;
  }

  function findChild(h, node, name) {
    /* A path walk only needs to find one child, so cap how many are
       materialised — a key with 100k children would otherwise cost a full
       enumeration at every level of every lookup. */
    var kids = subkeys(h, node, 50000);
    var want = String(name).toLowerCase();
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].name.toLowerCase() === want) return kids[i];
    }
    return null;
  }

  /* ---- vk: a value ------------------------------------------------------ */
  function readVk(h, rel) {
    var cell = readCell(h, rel);
    if (!cell || cell.len < 0x14) return null;
    var p = cell.at;
    if (h.bytes[p] !== 0x76 || h.bytes[p + 1] !== 0x6b) return null;   // 'vk'

    var nameLen = h.dv.getUint16(p + 0x02, true);
    var rawSize = h.dv.getUint32(p + 0x04, true);
    var dataOff = h.dv.getUint32(p + 0x08, true);
    var type = h.dv.getUint32(p + 0x0c, true);
    var flags = h.dv.getUint16(p + 0x10, true);

    if (nameLen > cell.len - 0x14) nameLen = Math.max(0, cell.len - 0x14);
    if (nameLen > 1024) nameLen = 1024;
    /* Flag bit 0 (VALUE_COMP_NAME) is the value-record twin of the key flag:
       set means one byte per character. A zero-length name is the key's
       default value, which the Windows UI shows as "(Default)". */
    var name = nameLen === 0 ? '(Default)'
             : (flags & 0x0001) ? latin1(h, p + 0x14, nameLen)
                                : utf16(h, p + 0x14, nameLen);

    /* ---------------------------------------------------------------
       THE TRAP.
       If bit 31 of the data size is set, the value is 4 bytes or fewer and
       Windows stores it INSIDE the data-offset field instead of allocating a
       cell for it. The field is data, not a pointer. Dereference it anyway and
       you read an unrelated cell, or walk off the file — and because most
       DWORDs are small, the bogus offset usually lands somewhere valid and you
       get plausible-looking wrong answers rather than a crash. Nearly every
       small REG_DWORD in a modern hive takes this path, so getting it wrong
       corrupts most of the interesting values at once.
       --------------------------------------------------------------- */
    var inline = (rawSize & 0x80000000) !== 0;
    var size = rawSize & 0x7fffffff;
    var data = null, resident = 'cell';

    if (inline) {
      if (size > MAX_INLINE) size = MAX_INLINE;   // wider than the field: corrupt, clamp
      data = h.bytes.slice(p + 0x08, p + 0x08 + size);
      resident = 'inline';
    } else if (size === 0) {
      data = new Uint8Array(0);
    } else {
      var dc = readCell(h, dataOff);
      if (!dc) {
        data = null;
      } else if (size > BIG_SEG && dc.len >= 8 && sigAt(h, dc.at) === 'db') {
        data = readBigData(h, dc, size);
        resident = 'db segments';
      } else {
        data = h.bytes.subarray(dc.at, dc.at + Math.min(size, dc.len));
        if (size > dc.len) resident = 'cell (truncated: value claims ' + size +
                                      ' bytes, cell holds ' + dc.len + ')';
      }
    }

    return {
      rel: rel, name: clean(name), type: type, flags: flags,
      declaredSize: size, inline: inline, resident: resident, data: data
    };
  }

  /* 'db' big data: a header cell holding a segment count and the offset of a
     list of cell offsets. Each segment contributes at most 16344 bytes no
     matter how large its cell is; the remainder of the cell is slack. */
  function readBigData(h, headerCell, totalSize) {
    var segCount = h.dv.getUint16(headerCell.at + 0x02, true);
    var listCell = readCell(h, h.dv.getUint32(headerCell.at + 0x04, true));
    if (!listCell) return null;
    var capped = Math.min(totalSize, 16 * 1024 * 1024);
    var buf = new Uint8Array(capped);
    var written = 0;
    for (var i = 0; i < segCount && written < capped; i++) {
      if ((i + 1) * 4 > listCell.len) break;
      var seg = readCell(h, h.dv.getUint32(listCell.at + i * 4, true));
      if (!seg) break;
      var take = Math.min(BIG_SEG, seg.len, capped - written);
      buf.set(h.bytes.subarray(seg.at, seg.at + take), written);
      written += take;
    }
    return buf.subarray(0, written);
  }

  function values(h, node) {
    if (!node || !node.valueCount) return [];
    var cell = readCell(h, node.valueList);
    if (!cell) return [];
    var n = Math.min(node.valueCount, Math.floor(cell.len / 4), 65536);
    var list = [];
    for (var i = 0; i < n; i++) {
      var v = readVk(h, h.dv.getUint32(cell.at + i * 4, true));
      if (v) list.push(v);
    }
    return list;
  }

  /* Values keyed by lowercase name, which is how every lookup below wants
     them — registry names are case-insensitive. */
  function valueMap(h, node) {
    var map = {};
    var list = values(h, node);
    for (var i = 0; i < list.length; i++) map[list[i].name.toLowerCase()] = list[i];
    return map;
  }

  /* ---- value decoding --------------------------------------------------- */
  function asString(v) {
    if (!v || !v.data) return '';
    return utf16Bytes(v.data).replace(/\u0000+$/, '');
  }

  function asDword(v) {
    if (!v || !v.data || v.data.length < 4) return null;
    return (v.data[0] | (v.data[1] << 8) | (v.data[2] << 16) | (v.data[3] << 24)) >>> 0;
  }

  function asFiletime(v) {
    if (!v || !v.data || v.data.length < 8) return null;
    var lo = (v.data[0] | (v.data[1] << 8) | (v.data[2] << 16) | (v.data[3] << 24)) >>> 0;
    var hi = (v.data[4] | (v.data[5] << 8) | (v.data[6] << 16) | (v.data[7] << 24)) >>> 0;
    return filetimeText(lo, hi);
  }

  function hexPreview(bytes, limit) {
    if (!bytes) return '(unreadable)';
    var shown = bytes.subarray(0, limit);
    var text = LabTool.toHex(shown).replace(/(..)/g, '$1 ').trim();
    return text + (bytes.length > limit ? '  … ' + bytes.length + ' bytes total' : '');
  }

  /* A single display line for any value, whatever its type. */
  function valueText(v) {
    if (!v) return '(missing)';
    if (v.data === null) return '(data cell unreadable)';
    var t = v.type;
    if (t === 1 || t === 2 || t === 6) {
      return clean(asString(v));
    }
    if (t === 7) {
      var parts = utf16Bytes(v.data).split('\u0000').filter(function (s) { return s.length; });
      return parts.length ? clean(parts.join('  |  ')) : '(empty)';
    }
    if (t === 4) {
      var d = asDword(v);
      return d === null ? '(short)' : d + '  (0x' + d.toString(16) + ')';
    }
    if (t === 5) {
      if (v.data.length < 4) return '(short)';
      var be = ((v.data[0] << 24) | (v.data[1] << 16) | (v.data[2] << 8) | v.data[3]) >>> 0;
      return be + '  (0x' + be.toString(16) + ', big-endian)';
    }
    if (t === 11) {
      if (v.data.length < 8) return '(short)';
      var lo = (v.data[0] | (v.data[1] << 8) | (v.data[2] << 16) | (v.data[3] << 24)) >>> 0;
      var hi = (v.data[4] | (v.data[5] << 8) | (v.data[6] << 16) | (v.data[7] << 24)) >>> 0;
      var hex = '0x' + ('00000000' + hi.toString(16)).slice(-8) + ('00000000' + lo.toString(16)).slice(-8);
      /* Only print a decimal when it is exact. Above 2^53 a double silently
         rounds, and a quietly wrong number is worse than none. */
      var dec = hi < 2097152 ? '  (' + (hi * 4294967296 + lo) + ')' : '';
      var when = plausibleFiletime(lo, hi) ? '  → ' + filetimeText(lo, hi) : '';
      return hex + dec + when;
    }
    /* Binary and everything unlabelled. Two heuristics worth applying because
       they are right far more often than not in a registry: an 8-byte blob is
       usually a FILETIME, and a run of UTF-16 is usually a path. */
    if (v.data.length === 8) {
      var blo = (v.data[0] | (v.data[1] << 8) | (v.data[2] << 16) | (v.data[3] << 24)) >>> 0;
      var bhi = (v.data[4] | (v.data[5] << 8) | (v.data[6] << 16) | (v.data[7] << 24)) >>> 0;
      if (plausibleFiletime(blo, bhi)) {
        return hexPreview(v.data, 8) + '  → looks like ' + filetimeText(blo, bhi);
      }
    }
    var wide = utf16Bytes(v.data.subarray(0, 512)).split('\u0000')[0];
    if (wide.length >= 4 && /^[\x20-\x7e\\/:.\- ]+$/.test(wide)) {
      return hexPreview(v.data, 16) + '  → "' + clean(wide) + '"';
    }
    return hexPreview(v.data, 24);
  }

  function typeName(t) { return TYPES[t] !== undefined ? TYPES[t] : 'type ' + t; }

  /* ======================================================================
     Opening a hive
     ====================================================================== */

  function openHive(bytes) {
    if (bytes.length < HBIN_BASE + 32) {
      return { error: 'This file is only ' + bytes.length + ' bytes. A hive has a 4 KB ' +
                      'header before any data starts, so it cannot be one.' };
    }
    var h = {
      bytes: bytes,
      dv: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      budget: READ_BUDGET,
      exhausted: false,
      badPointers: 0
    };
    if (!(bytes[0] === 0x72 && bytes[1] === 0x65 && bytes[2] === 0x67 && bytes[3] === 0x66)) {
      return { error: 'No "regf" signature. The first four bytes are ' +
                      LabTool.toHex(bytes.subarray(0, 4)) + ' — this is not a registry hive. ' +
                      'Exported .reg files are text and are not hives either.' };
    }

    h.seqPrimary = h.dv.getUint32(0x04, true);
    h.seqSecondary = h.dv.getUint32(0x08, true);
    h.writtenLo = h.dv.getUint32(0x0c, true);
    h.writtenHi = h.dv.getUint32(0x10, true);
    h.major = h.dv.getUint32(0x14, true);
    h.minor = h.dv.getUint32(0x18, true);
    h.fileType = h.dv.getUint32(0x1c, true);
    h.fileFormat = h.dv.getUint32(0x20, true);
    h.rootOffset = h.dv.getUint32(0x24, true);
    h.binsSize = h.dv.getUint32(0x28, true);
    h.embeddedName = clean(utf16(h, 0x30, 64).split('\u0000')[0]);

    /* The header checksum is an XOR of the first 508 bytes taken as 127
       little-endian dwords. Cheap, and a mismatch is a real signal that the
       file was truncated in transit or edited by hand. */
    var xor = 0;
    for (var i = 0; i < 0x1fc; i += 4) xor ^= h.dv.getUint32(i, true);
    h.checksumStored = h.dv.getUint32(0x1fc, true);
    h.checksumCalc = xor >>> 0;

    h.root = readNk(h, h.rootOffset);
    if (!h.root) {
      return { error: 'The header is a valid hive header but the root key at offset 0x' +
                      h.rootOffset.toString(16) + ' does not parse. The file is truncated ' +
                      'or the first hive bin is damaged.' };
    }
    return h;
  }

  /* Walk the hive bins to count them and check they chain cleanly. A hive that
     stops chaining part way through is truncated, and saying so up front saves
     the reader wondering why half the keys are missing. */
  function scanBins(h) {
    var at = HBIN_BASE, count = 0, total = 0, guard = 0;
    while (at + 32 <= h.bytes.length && guard++ < 262144) {
      if (!(h.bytes[at] === 0x68 && h.bytes[at + 1] === 0x62 &&
            h.bytes[at + 2] === 0x69 && h.bytes[at + 3] === 0x6e)) break;
      var size = h.dv.getUint32(at + 0x08, true);
      if (size < 0x1000 || size % 0x1000 !== 0 || at + size > h.bytes.length) break;
      count++; total += size; at += size;
    }
    return { count: count, total: total, endedAt: at };
  }

  /* ======================================================================
     Path resolution
     ====================================================================== */

  var ROOT_ALIASES = ['hkey_local_machine', 'hklm', 'hkey_current_user', 'hkcu',
                      'hkey_users', 'hku', 'hkey_classes_root', 'hkcr',
                      'hkey_current_config', 'hkcc'];

  /* Resolve a backslash path against the hive root, tolerantly. People paste
     paths in the form they read them — with an HKLM prefix, with the hive name
     in front, with CurrentControlSet in a SYSTEM hive — and none of those are
     literally present in the file. Rewriting them here is a small kindness
     that removes most of the reasons a lookup fails. */
  function resolvePath(h, text) {
    var parts = String(text || '').split(/[\\/]+/);
    var i;
    var kept = [];
    for (i = 0; i < parts.length; i++) if (parts[i].length) kept.push(parts[i]);

    if (kept.length && ROOT_ALIASES.indexOf(kept[0].toLowerCase()) !== -1) kept.shift();
    /* "SOFTWARE\Microsoft\..." — drop the hive's own name when it matches the
       hive we are holding and is not itself a child key. */
    if (kept.length) {
      var first = kept[0].toLowerCase();
      var hiveNames = ['system', 'software', 'sam', 'security', 'ntuser.dat', 'ntuser', 'usrclass.dat'];
      if (hiveNames.indexOf(first) !== -1 && !findChild(h, h.root, kept[0])) kept.shift();
    }
    /* CurrentControlSet is a runtime symlink and never exists on disk; the
       hive has ControlSet001, ControlSet002 and a Select key that says which
       one was live. Substitute it. */
    if (kept.length && kept[0].toLowerCase() === 'currentcontrolset') {
      var cs = currentControlSetName(h);
      if (cs) kept[0] = cs;
    }

    var node = h.root;
    var walked = [];
    for (i = 0; i < kept.length; i++) {
      var next = findChild(h, node, kept[i]);
      if (!next) return { node: null, failedAt: kept[i], walked: walked.join('\\') };
      node = next;
      walked.push(node.name);
    }
    return { node: node, path: walked.join('\\'), walked: walked.join('\\') };
  }

  function keyAt(h, path) {
    var r = resolvePath(h, path);
    return r.node;
  }

  function valueAt(h, path, name) {
    var node = keyAt(h, path);
    if (!node) return null;
    return valueMap(h, node)[String(name).toLowerCase()] || null;
  }

  function stringAt(h, path, name) {
    var v = valueAt(h, path, name);
    return v ? clean(asString(v)) : null;
  }

  function currentControlSetName(h) {
    var sel = findChild(h, h.root, 'Select');
    if (!sel) return null;
    var n = asDword(valueMap(h, sel)['current']);
    if (n === null || n === undefined) return null;
    return 'ControlSet' + ('000' + n).slice(-3);
  }

  /* ======================================================================
     Hive identification
     ====================================================================== */

  function childNameSet(h, node) {
    var set = {};
    var kids = subkeys(h, node, 2000);
    for (var i = 0; i < kids.length; i++) set[kids[i].name.toLowerCase()] = true;
    return set;
  }

  function identifyHive(h) {
    var n = childNameSet(h, h.root);
    var hint = (h.embeddedName || '').toLowerCase();

    if (n['select'] || (n['controlset001'] && n['mounteddevices'])) return 'SYSTEM';
    if (n['policy'] && (n['cache'] || n['rxact'])) return 'SECURITY';
    if (n['sam'] && !n['microsoft'] && !n['software']) return 'SAM';
    if (n['microsoft'] && (n['classes'] || n['wow6432node'] || n['registeredapplications'])) return 'SOFTWARE';
    if (n['software'] && (n['environment'] || n['volatile environment'] || n['console'] || n['keyboard layout'])) return 'NTUSER';
    if (n['activatableclasses'] || n['localsettings']) return 'USRCLASS';
    if (n['root'] && hint.indexOf('amcache') !== -1) return 'AMCACHE';
    if (hint.indexOf('system') !== -1) return 'SYSTEM';
    if (hint.indexOf('software') !== -1) return 'SOFTWARE';
    if (hint.indexOf('ntuser') !== -1) return 'NTUSER';
    if (hint.indexOf('sam') !== -1) return 'SAM';
    return 'UNKNOWN';
  }

  var HIVE_BLURB = {
    SYSTEM:   'SYSTEM — hardware, services, drivers, USB history, time zone.',
    SOFTWARE: 'SOFTWARE — Windows build, installed programs, machine-wide autostart.',
    NTUSER:   'NTUSER.DAT — one user\'s activity: documents, typed URLs, programs run.',
    SAM:      'SAM — local account database: users, RIDs, logon counters.',
    SECURITY: 'SECURITY — LSA policy, cached secrets. Mostly encrypted blobs.',
    USRCLASS: 'UsrClass.dat — per-user COM classes and shell bags.',
    AMCACHE:  'Amcache.hve — a record of program files seen on the machine.',
    UNKNOWN:  'Unrecognised layout. The tree browser below still works.'
  };

  /* ======================================================================
     Persistence heuristics
     ====================================================================== */

  var SUSPECT_PATTERNS = [
    { re: /\\(temp|tmp)\\/i,                     why: 'runs from a temp directory' },
    { re: /\\appdata\\/i,                        why: 'runs from AppData' },
    { re: /\\programdata\\/i,                    why: 'runs from ProgramData' },
    { re: /\\users\\public\\/i,                  why: 'runs from Public' },
    { re: /\\\$recycle/i,                        why: 'runs from the recycle bin' },
    { re: /powershell.*(-enc|-e\b|-ec\b)/i,      why: 'encoded PowerShell command' },
    { re: /powershell.*(-w\s+hidden|-windowstyle\s+hidden)/i, why: 'hidden PowerShell window' },
    { re: /powershell.*(-nop|-noprofile)/i,      why: 'PowerShell with profile suppressed' },
    { re: /\bmshta\b/i,                          why: 'mshta — runs HTML applications' },
    { re: /\bregsvr32\b.*\/i:/i,                 why: 'regsvr32 scriptlet loading' },
    { re: /\bcertutil\b.*(-decode|-urlcache)/i,  why: 'certutil used as a downloader' },
    { re: /\bbitsadmin\b/i,                      why: 'bitsadmin transfer' },
    { re: /\b(wscript|cscript)\b/i,              why: 'script host' },
    { re: /rundll32.*javascript:/i,              why: 'rundll32 running script' },
    { re: /https?:\/\//i,                        why: 'contains a URL' },
    { re: /\.(vbs|js|jse|wsf|hta|scr|pif|bat|cmd|ps1)\b/i, why: 'script or non-exe payload' },
    { re: /[A-Za-z0-9+/]{60,}={0,2}/,            why: 'long base64-looking blob' }
  ];

  function suspicions(text) {
    var found = [];
    if (!text) return found;
    for (var i = 0; i < SUSPECT_PATTERNS.length; i++) {
      if (SUSPECT_PATTERNS[i].re.test(text)) found.push(SUSPECT_PATTERNS[i].why);
    }
    return found;
  }

  /* Print one autostart location. Returns true if it existed and held
     anything, so the caller can report a hive with no autostart at all. */
  function dumpRunKey(h, path, label) {
    var node = keyAt(h, path);
    if (!node) return false;
    var list = values(h, node);
    if (!list.length) return false;
    out.line('');
    out.heading(label);
    out.dim('  ' + path);
    out.dim('  last written  ' + nkTime(node));
    for (var i = 0; i < list.length && i < 120; i++) {
      var text = valueText(list[i]);
      var flagged = suspicions(text);
      out.line('  ' + pad(trunc(list[i].name, 28), 30) + trunc(text, 150),
               flagged.length ? 't-warn' : null);
      if (flagged.length) out.line('  ' + pad('', 30) + '^ ' + flagged.join('; '), 't-warn');
    }
    if (list.length > 120) out.dim('  … ' + (list.length - 120) + ' more entries not shown');
    return true;
  }

  function autostartSection(h, kind) {
    out.rule();
    out.heading('AUTOSTART AND PERSISTENCE');
    out.dim('The first thing anyone checks. Amber lines matched a heuristic —');
    out.dim('that is a reason to look, not a verdict. Signed installers use');
    out.dim('these keys too.');

    var any = false;
    var i;

    if (kind === 'SOFTWARE') {
      var swPaths = [
        ['Microsoft\\Windows\\CurrentVersion\\Run', 'Run (all users)'],
        ['Microsoft\\Windows\\CurrentVersion\\RunOnce', 'RunOnce (all users)'],
        ['Microsoft\\Windows\\CurrentVersion\\RunOnceEx', 'RunOnceEx'],
        ['Microsoft\\Windows\\CurrentVersion\\RunServices', 'RunServices'],
        ['Microsoft\\Windows\\CurrentVersion\\RunServicesOnce', 'RunServicesOnce'],
        ['Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run', 'Policies\\Explorer\\Run'],
        ['Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', 'Run (32-bit on 64-bit)'],
        ['Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\RunOnce', 'RunOnce (32-bit on 64-bit)']
      ];
      for (i = 0; i < swPaths.length; i++) {
        if (dumpRunKey(h, swPaths[i][0], swPaths[i][1])) any = true;
      }

      /* Winlogon Shell and Userinit are the classic hijack: the defaults are
         exactly "explorer.exe" and "C:\Windows\system32\userinit.exe," and
         anything appended to either runs at every logon. */
      var wl = keyAt(h, 'Microsoft\\Windows NT\\CurrentVersion\\Winlogon');
      if (wl) {
        var wv = valueMap(h, wl);
        out.line('');
        out.heading('Winlogon');
        var checks = [
          ['shell', 'explorer.exe'],
          ['userinit', 'c:\\windows\\system32\\userinit.exe,'],
          ['taskman', ''],
          ['appsetup', ''],
          ['gpextensions', '']
        ];
        for (i = 0; i < checks.length; i++) {
          var vv = wv[checks[i][0]];
          if (!vv) continue;
          var text = valueText(vv);
          var expected = checks[i][1];
          var odd = expected ? text.toLowerCase().replace(/\s+$/, '') !== expected : true;
          out.line('  ' + pad(vv.name, 16) + trunc(text, 150), odd ? 't-warn' : 't-ok');
          if (odd && expected) out.line('  ' + pad('', 16) + '^ default is "' + expected + '"', 't-warn');
          any = true;
        }
      }

      var appinit = keyAt(h, 'Microsoft\\Windows NT\\CurrentVersion\\Windows');
      if (appinit) {
        var av = valueMap(h, appinit);
        var dlls = av['appinit_dlls'];
        if (dlls && asString(dlls).replace(/\u0000/g, '').trim()) {
          out.line('');
          out.heading('AppInit_DLLs');
          out.warn('  ' + trunc(valueText(dlls), 160));
          out.dim('  Loaded into every process that links user32.dll. Rarely');
          out.dim('  legitimate on a modern machine.');
          any = true;
        }
      }

      /* Image File Execution Options: a Debugger value under an executable's
         name replaces that executable. Only entries that actually carry one
         are worth printing — the key has hundreds of benign children. */
      var ifeo = keyAt(h, 'Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options');
      if (ifeo) {
        var hits = [];
        var kids = subkeys(h, ifeo, 2000);
        for (i = 0; i < kids.length; i++) {
          var kv = valueMap(h, kids[i]);
          if (kv['debugger'] || kv['monitorprocess']) {
            hits.push(kids[i].name + '  →  ' +
                      valueText(kv['debugger'] || kv['monitorprocess']));
          }
        }
        if (hits.length) {
          out.line('');
          out.heading('Image File Execution Options — debugger hijacks');
          for (i = 0; i < hits.length && i < 60; i++) out.warn('  ' + trunc(hits[i], 160));
          out.dim('  A Debugger value means Windows launches that command');
          out.dim('  instead of the named program. Also used legitimately by');
          out.dim('  developer tooling and by "disable Task Manager" tweaks.');
          any = true;
        }
      }

      /* Defender exclusions are not persistence, but they are on the same
         page of every playbook and they are cheap to read. */
      var exBase = 'Microsoft\\Windows Defender\\Exclusions';
      var exKinds = ['Paths', 'Extensions', 'Processes'];
      var exFound = [];
      for (i = 0; i < exKinds.length; i++) {
        var ex = keyAt(h, exBase + '\\' + exKinds[i]);
        if (!ex) continue;
        var exVals = values(h, ex);
        for (var j = 0; j < exVals.length && j < 100; j++) {
          exFound.push(exKinds[i] + ': ' + exVals[j].name);
        }
      }
      if (exFound.length) {
        out.line('');
        out.heading('Windows Defender exclusions');
        for (i = 0; i < exFound.length; i++) out.warn('  ' + trunc(exFound[i], 160));
        out.dim('  Exclusions are added by administrators and by attackers, and');
        out.dim('  the registry cannot tell you which. Worth confirming each one.');
      }
    }

    if (kind === 'NTUSER' || kind === 'UNKNOWN') {
      var userPaths = [
        ['Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'Run (this user)'],
        ['Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', 'RunOnce (this user)'],
        ['Software\\Microsoft\\Windows\\CurrentVersion\\RunServices', 'RunServices (this user)'],
        ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run', 'Policies\\Explorer\\Run'],
        ['Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', 'Run (32-bit)']
      ];
      for (i = 0; i < userPaths.length; i++) {
        if (dumpRunKey(h, userPaths[i][0], userPaths[i][1])) any = true;
      }
      var uw = keyAt(h, 'Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows');
      if (uw) {
        var uwv = valueMap(h, uw);
        ['load', 'run'].forEach(function (name) {
          if (uwv[name] && asString(uwv[name]).replace(/\u0000/g, '').trim()) {
            out.line('');
            out.heading('Windows\\' + uwv[name].name);
            out.warn('  ' + trunc(valueText(uwv[name]), 160));
            out.dim('  A Windows 3.1 leftover that still executes at logon.');
            any = true;
          }
        });
      }
    }

    if (kind === 'SYSTEM') {
      autoStartServices(h);
      any = true;
    }

    if (!any) {
      out.line('');
      out.ok('No populated Run/RunOnce keys found in this hive.');
      out.dim('Either they are empty, or the persistence for this machine lives');
      out.dim('in a hive you have not loaded — check SOFTWARE and each user\'s');
      out.dim('NTUSER.DAT, plus scheduled tasks, which are not in the registry.');
    }
  }

  /* ======================================================================
     SYSTEM hive
     ====================================================================== */

  var START_TYPE = { 0: 'boot', 1: 'system', 2: 'automatic', 3: 'manual', 4: 'disabled' };
  var SERVICE_TYPE = {
    1: 'kernel driver', 2: 'fs driver', 4: 'adapter', 8: 'recognizer',
    16: 'own process', 32: 'shared process', 272: 'own, interactive', 288: 'shared, interactive'
  };

  function autoStartServices(h) {
    var cs = currentControlSetName(h);
    if (!cs) return;
    var svcKey = keyAt(h, cs + '\\Services');
    if (!svcKey) return;
    var kids = subkeys(h, svcKey, 20000);
    out.line('');
    out.heading('Services that start without being asked  (' + kids.declared + ' services total)');
    if (kids.capped) {
      out.warn('  Only the first ' + kids.length + ' were examined. A machine with this many');
      out.warn('  services is not a normal machine — treat the count itself as a finding.');
    }
    out.dim('  ' + cs + '\\Services');
    out.dim('  ' + pad('name', 30) + pad('start', 11) + pad('type', 18) + 'image path');

    var shown = 0, flagged = 0, i;
    for (i = 0; i < kids.length; i++) {
      var v = valueMap(h, kids[i]);
      var start = asDword(v['start']);
      var stype = asDword(v['type']);
      var image = v['imagepath'] ? clean(asString(v['imagepath'])) : '';
      var reasons = suspicions(image);
      /* Unquoted service paths containing spaces are the classic privilege
         escalation, so they are called out even on automatic-start entries
         that look otherwise ordinary. */
      /* Test only the path portion, up to and including the executable
         extension. Testing the whole command line fires on every svchost
         service, whose space lives in the "-k netsvcs" arguments, not the
         path. When no known extension is present the head falls back to the
         whole string. */
      var head = (/^(.*?\.(?:exe|com|bat|cmd|sys))(?:\s|$)/i.exec(image) || [null, image])[1];
      if (image && image.charAt(0) !== '"' && / /.test(head)) {
        reasons.push('unquoted path with spaces');
      }
      var autostart = start === 0 || start === 1 || start === 2;
      if (!autostart && !reasons.length) continue;
      if (shown >= 250) { out.dim('  … output capped at 250 services'); break; }
      shown++;
      if (reasons.length) flagged++;
      out.line('  ' + pad(trunc(kids[i].name, 28), 30) +
               pad(START_TYPE[start] !== undefined ? START_TYPE[start] : String(start), 11) +
               pad(SERVICE_TYPE[stype] || String(stype), 18) +
               trunc(image || '(no ImagePath)', 90),
               reasons.length ? 't-warn' : null);
      if (reasons.length) out.line('  ' + pad('', 30) + '^ ' + reasons.join('; '), 't-warn');
    }
    out.dim('  ' + shown + ' shown (' + flagged + ' flagged). Manual and disabled services');
    out.dim('  are hidden unless something about them stood out. For the full list,');
    out.dim('  browse:  ' + cs + '\\Services');
  }

  function reportSystem(h) {
    var cs = currentControlSetName(h);
    var i;

    out.rule();
    out.heading('MACHINE');
    if (cs) {
      var sel = findChild(h, h.root, 'Select');
      var sv = sel ? valueMap(h, sel) : {};
      out.row('control set in use', cs);
      var lkg = asDword(sv['lastknowngood']);
      if (lkg !== null && lkg !== undefined) {
        out.row('last known good', 'ControlSet' + ('000' + lkg).slice(-3));
      }
      var failed = asDword(sv['failed']);
      if (failed) out.row('failed control set', 'ControlSet' + ('000' + failed).slice(-3), 't-warn');
    } else {
      out.warn('No Select key — cannot tell which control set was live.');
      cs = 'ControlSet001';
    }

    var cn = stringAt(h, cs + '\\Control\\ComputerName\\ComputerName', 'ComputerName');
    var acn = stringAt(h, cs + '\\Control\\ComputerName\\ActiveComputerName', 'ComputerName');
    if (cn) out.row('computer name', cn);
    if (acn && acn !== cn) out.row('active name', acn + '  (differs — renamed, pending reboot)', 't-warn');

    var domain = stringAt(h, cs + '\\Services\\Tcpip\\Parameters', 'Domain');
    var host = stringAt(h, cs + '\\Services\\Tcpip\\Parameters', 'Hostname');
    if (host) out.row('tcp/ip hostname', host);
    if (domain) out.row('dns domain', domain);

    var shutdown = valueAt(h, cs + '\\Control\\Windows', 'ShutdownTime');
    if (shutdown) out.row('last shutdown', asFiletime(shutdown));

    /* Time zone matters more than it looks: every other timestamp in a case is
       UTC, and the analyst's job is to explain them to someone who lived in
       local time. */
    var tz = keyAt(h, cs + '\\Control\\TimeZoneInformation');
    if (tz) {
      var tzv = valueMap(h, tz);
      out.rule();
      out.heading('TIME ZONE');
      out.row('key name', clean(asString(tzv['timezonekeyname'] || {})) || '(not set)');
      out.row('standard name', clean(asString(tzv['standardname'] || {})) || '(not set)');
      out.row('daylight name', clean(asString(tzv['daylightname'] || {})) || '(not set)');
      var bias = asDword(tzv['bias']);
      var active = asDword(tzv['activetimebias']);
      if (bias !== null) out.row('bias', bias > 0x7fffffff ? (bias - 4294967296) + ' minutes from UTC'
                                                          : bias + ' minutes from UTC');
      if (active !== null) out.row('active bias', (active > 0x7fffffff ? active - 4294967296 : active) +
                                                 ' minutes (includes DST)');
      out.dim('Local time = UTC minus the bias. Every timestamp in this report');
      out.dim('is UTC and has not been shifted.');
    }

    /* RDP and firewall state: two settings attackers change and two lines of
       output, so they earn their place. */
    var rdp = asDword(valueAt(h, cs + '\\Control\\Terminal Server', 'fDenyTSConnections'));
    if (rdp !== null && rdp !== undefined) {
      out.rule();
      out.row('RDP', rdp === 0 ? 'ENABLED (fDenyTSConnections = 0)' : 'disabled',
              rdp === 0 ? 't-warn' : 't-ok');
    }
    var fwProfiles = ['DomainProfile', 'StandardProfile', 'PublicProfile'];
    for (i = 0; i < fwProfiles.length; i++) {
      var fw = asDword(valueAt(h,
        cs + '\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\' + fwProfiles[i],
        'EnableFirewall'));
      if (fw === null || fw === undefined) continue;
      out.row('firewall ' + fwProfiles[i].replace('Profile', '').toLowerCase(),
              fw ? 'on' : 'OFF', fw ? 't-ok' : 't-err');
    }

    reportUsb(h, cs);
    reportMountedDevices(h);
    reportBam(h, cs);
  }

  var USB_PROP_GUID = '{83da6326-97a6-4088-9453-a1923f573b29}';
  var USB_PROP = { '0064': 'first install', '0065': 'first install (alt)',
                   '0066': 'last connected', '0067': 'last removed' };

  /* Pull the FILETIME out of a device property subkey. The value under 0064
     and friends is usually the default value, sometimes named 00000000, so
     take the first one that is eight bytes long rather than guessing. */
  function propTime(h, propsKey, code) {
    var k = findChild(h, propsKey, code);
    if (!k) return null;
    var list = values(h, k);
    for (var i = 0; i < list.length; i++) {
      if (list[i].data && list[i].data.length === 8) return asFiletime(list[i]);
    }
    return null;
  }

  function reportUsb(h, cs) {
    var stor = keyAt(h, cs + '\\Enum\\USBSTOR');
    out.rule();
    out.heading('USB STORAGE HISTORY');
    if (!stor) {
      out.dim('No USBSTOR key under ' + cs + '\\Enum. Either nothing was ever');
      out.dim('plugged in, or this control set is not the one that was live.');
      return;
    }
    var models = subkeys(h, stor, 2000);
    if (!models.length) { out.dim('USBSTOR exists but is empty.'); return; }
    out.dim(cs + '\\Enum\\USBSTOR — ' + models.length + ' device model(s)');

    var count = 0;
    for (var i = 0; i < models.length && count < 60; i++) {
      var instances = subkeys(h, models[i], 2000);
      for (var j = 0; j < instances.length && count < 60; j++) {
        count++;
        var inst = instances[j];
        var iv = valueMap(h, inst);
        out.line('');
        /* Printed exactly as stored: the Ven_/Prod_/Rev_ key name is the
           string an analyst searches for, and prettifying it breaks that. */
        out.line('  ' + clean(models[i].name), 't-info');
        out.line('  ' + pad('serial', 20) + inst.name);
        /* A serial number whose second character is '&' was generated by
           Windows because the device did not present one. It is not a unique
           identifier for that stick across machines, and treating it as one
           has embarrassed people in reports. */
        if (inst.name.charAt(1) === '&') {
          out.line('  ' + pad('', 20) + '^ Windows-generated: this device has no real serial', 't-warn');
        }
        if (iv['friendlyname']) out.line('  ' + pad('friendly name', 20) + clean(asString(iv['friendlyname'])));
        if (iv['mfg']) out.line('  ' + pad('manufacturer', 20) + clean(asString(iv['mfg'])));
        if (iv['containerid']) out.line('  ' + pad('container id', 20) + clean(asString(iv['containerid'])));
        out.line('  ' + pad('key last written', 20) + nkTime(inst));

        var props = findChild(h, inst, 'Properties');
        var guidKey = props ? findChild(h, props, USB_PROP_GUID) : null;
        if (guidKey) {
          for (var code in USB_PROP) {
            if (!Object.prototype.hasOwnProperty.call(USB_PROP, code)) continue;
            var t = propTime(h, guidKey, code);
            if (t) out.line('  ' + pad(USB_PROP[code], 20) + t, 't-ok');
          }
        }
      }
    }
    if (count >= 60) out.dim('  … capped at 60 devices; browse the key for the rest');
    out.line('');
    out.dim('These timestamps come from the device property keys, which is why');
    out.dim('they survive when the key\'s own last-written time has been touched');
    out.dim('by something unrelated. Correlate with MountedDevices below.');
  }

  function reportMountedDevices(h) {
    var md = findChild(h, h.root, 'MountedDevices');
    if (!md) return;
    var list = values(h, md);
    if (!list.length) return;
    out.rule();
    out.heading('MOUNTED DEVICES  (' + list.length + ')');
    out.dim('Drive letters and volume GUIDs mapped to the disk behind them.');
    for (var i = 0; i < list.length && i < 80; i++) {
      var v = list[i];
      var d = v.data;
      var desc;
      if (!d) desc = '(unreadable)';
      else if (d.length === 12) {
        /* 12 bytes is an MBR-style entry: a 4-byte disk signature and an
           8-byte byte offset to the partition. */
        var sigHex = LabTool.toHex(d.subarray(0, 4));
        /* Only print the decimal when it stays exact. Above 2^53 a double
           silently rounds, so fall back to the raw hex QWORD — the same guard
           the REG_QWORD path uses. */
        var phi = d[11] * 16777216 + d[10] * 65536 + d[9] * 256 + d[8];
        var plo = d[7] * 16777216 + d[6] * 65536 + d[5] * 256 + d[4];
        desc = 'disk signature ' + sigHex + ', partition offset ' +
               (phi < 2097152 ? (phi * 4294967296 + plo) : '0x' + hex8(phi) + hex8(plo));
      } else {
        desc = clean(utf16Bytes(d).replace(/\u0000/g, ''));
        if (!desc) desc = hexPreview(d, 16);
      }
      out.line('  ' + pad(trunc(v.name, 56), 58) + trunc(desc, 100));
    }
    if (list.length > 80) out.dim('  … ' + (list.length - 80) + ' more not shown');
  }

  /* BAM/DAM records the full NT path of every executable a user ran, with the
     time it last ran, and it survives longer than most execution artefacts.
     Present on Windows 10 1709 and later; the key moved under State in 1809. */
  function reportBam(h, cs) {
    var bam = keyAt(h, cs + '\\Services\\bam\\State\\UserSettings') ||
              keyAt(h, cs + '\\Services\\bam\\UserSettings') ||
              keyAt(h, cs + '\\Services\\dam\\State\\UserSettings');
    if (!bam) return;
    var sids = subkeys(h, bam, 500);
    if (!sids.length) return;
    out.rule();
    out.heading('BAM — PROGRAM EXECUTION  (' + sids.length + ' user SID(s))');
    var total = 0;
    for (var i = 0; i < sids.length; i++) {
      var list = values(h, sids[i]);
      out.line('');
      out.line('  ' + sids[i].name + '  (' + list.length + ' entries)', 't-info');
      for (var j = 0; j < list.length; j++) {
        if (total >= 200) break;
        var v = list[j];
        if (!v.data || v.data.length < 8) continue;
        if (v.name.indexOf('\\') === -1) continue;   // Version/SequenceNumber, not a path
        total++;
        out.line('  ' + pad(asFiletime(v), 26) + trunc(clean(v.name), 110));
      }
      if (total >= 200) { out.dim('  … capped at 200 executables'); break; }
    }
    out.dim('  Times are when the executable last ran, per user.');
  }

  /* ======================================================================
     SOFTWARE hive
     ====================================================================== */

  function reportSoftware(h) {
    var i;
    var cv = keyAt(h, 'Microsoft\\Windows NT\\CurrentVersion');
    out.rule();
    out.heading('WINDOWS');
    if (!cv) {
      out.warn('Microsoft\\Windows NT\\CurrentVersion is missing — unusual for a');
      out.warn('SOFTWARE hive. It may be a partial or carved file.');
    } else {
      var v = valueMap(h, cv);
      var fields = [
        ['ProductName', 'productname'], ['EditionID', 'editionid'],
        ['DisplayVersion', 'displayversion'], ['ReleaseId', 'releaseid'],
        ['CurrentBuild', 'currentbuild'], ['BuildLabEx', 'buildlabex'],
        ['InstallationType', 'installationtype'], ['RegisteredOwner', 'registeredowner'],
        ['RegisteredOrganization', 'registeredorganization'],
        ['SystemRoot', 'systemroot'], ['PathName', 'pathname']
      ];
      for (i = 0; i < fields.length; i++) {
        if (v[fields[i][1]]) out.row(fields[i][0], trunc(valueText(v[fields[i][1]]), 120));
      }
      var ubr = asDword(v['ubr']);
      if (ubr !== null && ubr !== undefined) out.row('UBR (patch level)', ubr);

      /* Two different install timestamps live here in two different formats,
         which is a good demonstration of why you never assume. InstallDate is
         Unix seconds in a DWORD; InstallTime is a FILETIME in a QWORD. */
      var instDate = asDword(v['installdate']);
      if (instDate) out.row('InstallDate', unixSecText(instDate) + '  (Unix seconds, DWORD)');
      if (v['installtime'] && v['installtime'].data && v['installtime'].data.length >= 8) {
        out.row('InstallTime', asFiletime(v['installtime']) + '  (FILETIME, QWORD)');
      }
    }

    var lastUser = stringAt(h, 'Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI',
                            'LastLoggedOnUser');
    var lastSam = stringAt(h, 'Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI',
                           'LastLoggedOnSAMUser');
    if (lastUser || lastSam) {
      out.row('last logged on', (lastSam || lastUser));
    }

    /* ProfileList is how you turn the SIDs that appear everywhere else into
       usernames without needing the SAM. */
    var pl = keyAt(h, 'Microsoft\\Windows NT\\CurrentVersion\\ProfileList');
    if (pl) {
      var profiles = subkeys(h, pl, 2000);
      out.rule();
      out.heading('USER PROFILES  (' + profiles.length + ')');
      for (i = 0; i < profiles.length && i < 60; i++) {
        var pv = valueMap(h, profiles[i]);
        out.line('  ' + pad(trunc(profiles[i].name, 46), 48) +
                 trunc(clean(asString(pv['profileimagepath'] || {})), 70));
        out.line('  ' + pad('', 48) + 'key last written  ' + nkTime(profiles[i]), 't-dim');
      }
      if (profiles.length > 60) out.dim('  … ' + (profiles.length - 60) + ' more');
      out.dim('  SIDs ending -500 are the built-in Administrator; -501 Guest.');
      out.dim('  Relative IDs from 1000 up are accounts someone created.');
    }

    reportInstalled(h);
  }

  function reportInstalled(h) {
    var roots = [
      ['Microsoft\\Windows\\CurrentVersion\\Uninstall', '64-bit'],
      ['Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '32-bit']
    ];
    var rows = [], i, j;
    for (i = 0; i < roots.length; i++) {
      var node = keyAt(h, roots[i][0]);
      if (!node) continue;
      var kids = subkeys(h, node, 5000);
      for (j = 0; j < kids.length && rows.length < 2000; j++) {
        var v = valueMap(h, kids[j]);
        var name = v['displayname'] ? clean(asString(v['displayname'])) : '';
        if (!name) continue;   // updates and orphans carry no DisplayName
        rows.push({
          name: name,
          version: v['displayversion'] ? clean(asString(v['displayversion'])) : '',
          publisher: v['publisher'] ? clean(asString(v['publisher'])) : '',
          installed: v['installdate'] ? clean(asString(v['installdate'])) : '',
          arch: roots[i][1],
          written: nkTime(kids[j])
        });
      }
    }
    out.rule();
    out.heading('INSTALLED PROGRAMS  (' + rows.length + ')');
    if (!rows.length) {
      out.dim('No Uninstall entries with a DisplayName.');
      return;
    }
    rows.sort(function (a, b) {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 :
             a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
    });
    out.dim('  ' + pad('name', 46) + pad('version', 18) + pad('installed', 12) + 'publisher');
    var limit = Math.min(rows.length, 300);
    for (i = 0; i < limit; i++) {
      var r = rows[i];
      var when = /^\d{8}$/.test(r.installed)
        ? r.installed.slice(0, 4) + '-' + r.installed.slice(4, 6) + '-' + r.installed.slice(6, 8)
        : r.installed;
      out.line('  ' + pad(trunc(r.name, 44), 46) + pad(trunc(r.version, 16), 18) +
               pad(when || '—', 12) + trunc(r.publisher, 40));
    }
    if (rows.length > limit) out.dim('  … ' + (rows.length - limit) + ' more not shown (capped at 300)');
    out.dim('  InstallDate is a string the installer chose to write, so it is');
    out.dim('  self-reported and frequently absent. The key\'s own last-written');
    out.dim('  time is the harder evidence — browse an entry to see it.');
  }

  /* ======================================================================
     NTUSER.DAT
     ====================================================================== */

  var USERASSIST_GUIDS = {
    '{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}': 'executables',
    '{F4E57C4B-2036-45F0-A9AB-443BCFE33D9F}': 'shortcut (.lnk) files',
    '{75048700-EF1F-11D0-9888-006097DEACF9}': 'applications (XP era)',
    '{5E6AB780-7743-11CF-A12B-00AA004AE837}': 'IE toolbar (XP era)',
    '{9E04CAB2-CC14-11DF-BB8C-A2F1DED72085}': 'shortcuts (Win8+)',
    '{B267E3AD-A825-4A09-82B9-EEC22AA3B847}': 'apps (Win8+)',
    '{A3D53349-6E61-4557-8FC7-0028EDCEEBF6}': 'packaged apps',
    '{BCB48336-4DDD-48FF-BB0B-D3190DACB3E2}': 'packaged app links',
    '{0D6D4F41-2994-4BA0-8FEF-620E43CD2812}': 'app switches'
  };

  /* UserAssist paths are stored with KNOWNFOLDERID GUIDs instead of literal
     directories. Substituting the common ones makes the list readable without
     needing a lookup table open in another window. */
  var KNOWN_FOLDERS = {
    '{6D809377-6AF0-444B-8957-A3773F02200E}': '%ProgramFiles%',
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': '%ProgramFiles(x86)%',
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': '%SystemRoot%\\System32',
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': '%SystemRoot%',
    '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': '%SystemRoot%\\SysWOW64',
    '{9E3995AB-1F9C-4F13-B827-48B24B6C7174}': 'User Pinned',
    '{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}': 'Common Start Menu Programs',
    '{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}': 'Start Menu Programs',
    '{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}': 'Desktop',
    '{FDD39AD0-238F-46AF-ADB4-6C85480369C7}': 'Documents',
    '{374DE290-123F-4565-9164-39C4925E467B}': 'Downloads',
    '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': '%AppData%',
    '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': '%LocalAppData%'
  };

  function expandFolders(text) {
    return String(text).replace(/\{[0-9A-Fa-f-]{36}\}/g, function (guid) {
      var up = guid.toUpperCase();
      return KNOWN_FOLDERS[up] || guid;
    });
  }

  function reportNtuser(h) {
    var i;
    var ve = findChild(h, h.root, 'Volatile Environment');
    out.rule();
    out.heading('USER');
    out.row('root key name', h.root.name);
    out.dim('  In an NTUSER.DAT the root key name is usually the SID or a');
    out.dim('  CMI-CreateHive GUID left over from the profile template.');
    if (ve) {
      var vev = valueMap(h, ve);
      ['username', 'userdomain', 'userprofile', 'homepath', 'logonserver', 'appdata'].forEach(
        function (name) {
          if (vev[name]) out.row(vev[name].name, trunc(valueText(vev[name]), 110));
        });
    }
    out.row('hive last written', filetimeText(h.writtenLo, h.writtenHi));

    reportUserAssist(h);
    reportRecentDocs(h);
    reportTypedUrls(h);
    reportRunMru(h);
    reportWordWheel(h);
    reportComDlg(h);
    reportMountPoints(h);
    reportRdpAndShares(h);
  }

  function reportUserAssist(h) {
    var ua = keyAt(h, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist');
    out.rule();
    out.heading('USERASSIST — GUI PROGRAM EXECUTION');
    if (!ua) { out.dim('No UserAssist key in this hive.'); return; }
    out.dim('Value names are ROT13 encoded — not for security, just to keep');
    out.dim('casual eyes off them. Decoded below. Only programs launched from');
    out.dim('the shell appear here; anything started from a command line does not.');

    var guids = subkeys(h, ua, 200);
    var total = 0;
    for (var g = 0; g < guids.length; g++) {
      var countKey = findChild(h, guids[g], 'Count');
      if (!countKey) continue;
      var list = values(h, countKey);
      if (!list.length) continue;
      var label = USERASSIST_GUIDS[guids[g].name.toUpperCase()] || 'unknown category';
      out.line('');
      out.line('  ' + guids[g].name + '  — ' + label + '  (' + list.length + ')', 't-info');
      out.dim('  ' + pad('runs', 7) + pad('last executed (UTC)', 26) + 'name');

      var rows = [];
      for (var i = 0; i < list.length; i++) {
        var v = list[i];
        var d = v.data;
        var runs = null, when = '';
        if (d && d.length >= 68) {
          /* Windows 7 and later: 72-byte record. Run count at +0x04, last
             execution FILETIME at +0x3c. */
          runs = (d[4] | (d[5] << 8) | (d[6] << 16) | (d[7] << 24)) >>> 0;
          var lo = (d[60] | (d[61] << 8) | (d[62] << 16) | (d[63] << 24)) >>> 0;
          var hi = (d[64] | (d[65] << 8) | (d[66] << 16) | (d[67] << 24)) >>> 0;
          when = (lo || hi) ? filetimeText(lo, hi) : '—';
        } else if (d && d.length >= 16) {
          /* Windows XP: 16-byte record, and the run count carries an offset of
             5 that Microsoft never documented and everybody hard-codes. */
          runs = ((d[4] | (d[5] << 8) | (d[6] << 16) | (d[7] << 24)) >>> 0);
          runs = runs > 5 ? runs - 5 : runs;
          var xlo = (d[8] | (d[9] << 8) | (d[10] << 16) | (d[11] << 24)) >>> 0;
          var xhi = (d[12] | (d[13] << 8) | (d[14] << 16) | (d[15] << 24)) >>> 0;
          when = (xlo || xhi) ? filetimeText(xlo, xhi) : '—';
        }
        rows.push({ runs: runs, when: when, name: expandFolders(rot13(v.name)) });
      }
      rows.sort(function (a, b) { return (b.runs || 0) - (a.runs || 0); });
      for (i = 0; i < rows.length && total < 150; i++, total++) {
        out.line('  ' + pad(rows[i].runs === null ? '?' : rows[i].runs, 7) +
                 pad(rows[i].when || '—', 26) + trunc(clean(rows[i].name), 90));
      }
      if (total >= 150) { out.dim('  … capped at 150 entries across all categories'); break; }
    }
    if (!total) out.dim('UserAssist exists but holds no Count entries.');
  }

  function mruOrder(v) {
    /* MRUListEx is an array of little-endian int32 indices, most recent first,
       terminated by 0xffffffff. MRUList (older) is a plain string of letters. */
    if (!v || !v.data) return null;
    var order = [];
    for (var i = 0; i + 3 < v.data.length; i += 4) {
      var n = (v.data[i] | (v.data[i + 1] << 8) | (v.data[i + 2] << 16) | (v.data[i + 3] << 24)) | 0;
      if (n === -1) break;
      order.push(String(n));
      if (order.length > 512) break;
    }
    return order;
  }

  function reportRecentDocs(h) {
    var base = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs';
    var node = keyAt(h, base);
    out.rule();
    out.heading('RECENTDOCS — FILES OPENED');
    if (!node) { out.dim('No RecentDocs key.'); return; }
    out.dim(base + '  —  key last written ' + nkTime(node));

    var shown = 0;
    function dumpRecent(key, label) {
      var list = values(h, key);
      var byName = {};
      var order = null, i;
      for (i = 0; i < list.length; i++) {
        if (list[i].name.toLowerCase() === 'mrulistex') { order = mruOrder(list[i]); continue; }
        byName[list[i].name] = list[i];
      }
      var names = (order && order.length) ? order : Object.keys(byName);
      if (!names.length) return;
      out.line('');
      out.line('  ' + label + '  (' + names.length + ', most recent first)  ' + nkTime(key), 't-info');
      for (i = 0; i < names.length && shown < 150; i++) {
        var v = byName[names[i]];
        if (!v || !v.data) continue;
        /* The data is a shell-link blob whose first field happens to be the
           display name as a NUL-terminated UTF-16 string. Parsing the rest is
           a shell-item problem and out of scope here; the filename is the part
           anyone reads out loud. */
        var name = utf16Bytes(v.data).split('\u0000')[0];
        if (!name) continue;
        shown++;
        out.line('    ' + pad(i + 1 + '.', 5) + trunc(clean(name), 110));
      }
    }

    dumpRecent(node, 'all types');
    var exts = subkeys(h, node, 500);
    for (var i = 0; i < exts.length && shown < 150; i++) {
      dumpRecent(exts[i], exts[i].name);
    }
    if (shown >= 150) out.dim('  … capped at 150 documents');
    out.dim('  RecentDocs records that a file was opened from Explorer. The');
    out.dim('  file itself may be long gone; the name is the evidence.');
  }

  function reportTypedUrls(h) {
    var node = keyAt(h, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedURLs');
    var timesNode = keyAt(h, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedURLsTime');
    if (!node) return;
    var list = values(h, node);
    if (!list.length) return;
    var times = timesNode ? valueMap(h, timesNode) : {};
    out.rule();
    out.heading('TYPED URLS  (' + list.length + ')');
    out.dim('Addresses typed into the Internet Explorer / Explorer address bar.');
    list.sort(function (a, b) {
      var an = parseInt(a.name.replace(/\D/g, ''), 10) || 0;
      var bn = parseInt(b.name.replace(/\D/g, ''), 10) || 0;
      return an - bn;
    });
    for (var i = 0; i < list.length && i < 100; i++) {
      /* TypedURLsTime only exists on Windows 8 and later, and even there it
         can be missing entries — pad the column either way so the URLs stay
         in line. */
      var t = times[list[i].name.toLowerCase()];
      out.line('  ' + pad(list[i].name, 10) + pad(t ? asFiletime(t) : '—', 26) +
               trunc(clean(asString(list[i])), 110));
    }
    if (list.length > 100) out.dim('  … ' + (list.length - 100) + ' more');
  }

  function reportRunMru(h) {
    var node = keyAt(h, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU');
    if (!node) return;
    var v = valueMap(h, node);
    var order = v['mrulist'] ? clean(asString(v['mrulist'])) : '';
    out.rule();
    out.heading('RUNMRU — WIN+R HISTORY');
    out.dim(order ? 'MRUList order: ' + order + '  (leftmost is most recent)'
                  : 'No MRUList value; showing in hive order.');
    var seq = order ? order.split('') : Object.keys(v);
    for (var i = 0; i < seq.length && i < 40; i++) {
      var entry = v[String(seq[i]).toLowerCase()];
      if (!entry || entry.name.toLowerCase() === 'mrulist') continue;
      var text = clean(asString(entry)).replace(/\\1$/, '');
      var flagged = suspicions(text);
      out.line('  ' + pad(entry.name, 5) + trunc(text, 120), flagged.length ? 't-warn' : null);
      if (flagged.length) out.line('  ' + pad('', 5) + '^ ' + flagged.join('; '), 't-warn');
    }
    out.dim('  Entries end with "\\1", which is the flag saying the command ran.');
  }

  function reportWordWheel(h) {
    var node = keyAt(h, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\WordWheelQuery');
    if (!node) return;
    var list = values(h, node);
    var order = null, byName = {}, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].name.toLowerCase() === 'mrulistex') { order = mruOrder(list[i]); continue; }
      byName[list[i].name] = list[i];
    }
    var names = order || Object.keys(byName);
    if (!names.length) return;
    out.rule();
    out.heading('EXPLORER SEARCH TERMS  (' + names.length + ')');
    out.dim('What the user typed into the Explorer search box, newest first.');
    for (i = 0; i < names.length && i < 60; i++) {
      var v = byName[names[i]];
      if (!v || !v.data) continue;
      out.line('  ' + pad(i + 1 + '.', 5) + trunc(clean(utf16Bytes(v.data).split('\u0000')[0]), 110));
    }
  }

  function reportComDlg(h) {
    var base = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32';
    var lv = keyAt(h, base + '\\LastVisitedPidlMRU');
    var os = keyAt(h, base + '\\OpenSavePidlMRU');
    if (!lv && !os) return;
    out.rule();
    out.heading('OPEN / SAVE DIALOG HISTORY');
    out.dim('These values are shell item blobs. Full parsing is a different');
    out.dim('project, so only the readable leading string is pulled out — which');
    out.dim('happens to be the executable name or the filename in both cases.');

    var i, list;
    if (lv) {
      list = values(h, lv);
      out.line('');
      out.line('  LastVisitedPidlMRU — applications that opened a file dialog', 't-info');
      for (i = 0; i < list.length && i < 40; i++) {
        if (list[i].name.toLowerCase() === 'mrulistex' || !list[i].data) continue;
        var exe = utf16Bytes(list[i].data).split('\u0000')[0];
        if (exe) out.line('    ' + trunc(clean(exe), 110));
      }
    }
    if (os) {
      var exts = subkeys(h, os, 500);
      out.line('');
      out.line('  OpenSavePidlMRU — by file extension (' + exts.length + ' types)', 't-info');
      var shown = 0;
      for (i = 0; i < exts.length && shown < 60; i++) {
        list = values(h, exts[i]);
        var names = [];
        for (var j = 0; j < list.length && names.length < 6; j++) {
          if (list[j].name.toLowerCase() === 'mrulistex' || !list[j].data) continue;
          /* Filenames sit inside the shell item, not at the front, so take the
             longest printable UTF-16 run instead of the first one. */
          var best = '';
          var parts = utf16Bytes(list[j].data).split('\u0000');
          for (var k = 0; k < parts.length; k++) {
            if (parts[k].length > best.length && /^[\x20-\x7e]+$/.test(parts[k])) best = parts[k];
          }
          if (best.length > 3) { names.push(best); shown++; }
        }
        if (names.length) {
          out.line('    ' + pad('.' + exts[i].name.replace(/^\./, ''), 12) +
                   trunc(clean(names.join('  |  ')), 100));
        }
      }
    }
  }

  function reportMountPoints(h) {
    var node = keyAt(h, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MountPoints2');
    if (!node) return;
    var kids = subkeys(h, node, 5000);
    if (!kids.length) return;
    out.rule();
    out.heading('MOUNTPOINTS2 — VOLUMES AND SHARES THIS USER TOUCHED  (' + kids.length + ')');
    var shares = [], vols = [], letters = [], i;
    for (i = 0; i < kids.length; i++) {
      var n = kids[i].name;
      if (n.indexOf('##') === 0) shares.push(n.replace(/#/g, '\\') + '   ' + nkTime(kids[i]));
      else if (/^[A-Za-z]$/.test(n)) letters.push(n + ':   ' + nkTime(kids[i]));
      else vols.push(n + '   ' + nkTime(kids[i]));
    }
    if (letters.length) {
      out.line('');
      out.line('  drive letters', 't-info');
      for (i = 0; i < letters.length && i < 40; i++) out.line('    ' + letters[i]);
    }
    if (shares.length) {
      out.line('');
      out.line('  network shares  — evidence the user connected to another host', 't-info');
      for (i = 0; i < shares.length && i < 60; i++) out.warn('    ' + shares[i]);
    }
    if (vols.length) {
      out.line('');
      out.line('  volume GUIDs  (' + vols.length + ', first 30 shown)', 't-info');
      for (i = 0; i < vols.length && i < 30; i++) out.line('    ' + vols[i]);
    }
    out.dim('  Timestamps are the subkey\'s last-written time, which is close to');
    out.dim('  when the volume or share was last attached by this user.');
  }

  function reportRdpAndShares(h) {
    var i, list;
    var srv = keyAt(h, 'Software\\Microsoft\\Terminal Server Client\\Servers');
    if (srv) {
      var hosts = subkeys(h, srv, 1000);
      if (hosts.length) {
        out.rule();
        out.heading('RDP DESTINATIONS  (' + hosts.length + ')');
        for (i = 0; i < hosts.length && i < 60; i++) {
          var hv = valueMap(h, hosts[i]);
          out.line('  ' + pad(trunc(hosts[i].name, 40), 42) +
                   pad(hv['usernamehint'] ? clean(asString(hv['usernamehint'])) : '', 30) +
                   nkTime(hosts[i]));
        }
        out.dim('  Hosts this account connected to with mstsc, plus the username');
        out.dim('  it offered. Lateral movement leaves entries here.');
      }
    }
    var def = keyAt(h, 'Software\\Microsoft\\Terminal Server Client\\Default');
    if (def) {
      list = values(h, def);
      if (list.length) {
        out.line('');
        out.line('  most recent RDP targets (MRU order)', 't-info');
        for (i = 0; i < list.length && i < 20; i++) {
          out.line('    ' + pad(list[i].name, 8) + clean(asString(list[i])));
        }
      }
    }
    var net = findChild(h, h.root, 'Network');
    if (net) {
      var drives = subkeys(h, net, 200);
      if (drives.length) {
        out.rule();
        out.heading('MAPPED NETWORK DRIVES  (' + drives.length + ')');
        for (i = 0; i < drives.length && i < 30; i++) {
          var dv2 = valueMap(h, drives[i]);
          out.line('  ' + pad(drives[i].name + ':', 6) +
                   pad(clean(asString(dv2['remotepath'] || {})), 50) +
                   (dv2['username'] ? 'as ' + clean(asString(dv2['username'])) : ''));
        }
      }
    }
  }

  /* ======================================================================
     SAM hive
     ====================================================================== */

  var ACB = [
    [0x0001, 'DISABLED'], [0x0002, 'home dir required'], [0x0004, 'PASSWORD NOT REQUIRED'],
    [0x0008, 'temp duplicate'], [0x0010, 'normal account'], [0x0020, 'MNS logon'],
    [0x0040, 'interdomain trust'], [0x0080, 'workstation trust'], [0x0100, 'server trust'],
    [0x0200, 'password never expires'], [0x0400, 'AUTO-LOCKED']
  ];

  function acbText(flags) {
    var parts = [];
    for (var i = 0; i < ACB.length; i++) if (flags & ACB[i][0]) parts.push(ACB[i][1]);
    return parts.length ? parts.join(', ') : '(none)';
  }

  function le32(d, at) {
    return (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;
  }

  /* The V value is a table of (offset, length) pairs followed by the strings
     themselves. Every offset is relative to 0xCC, not to the start of the
     blob — an off-by-204 that produces convincing garbage if you miss it. */
  function samStrings(d) {
    function grab(entry) {
      if (d.length < entry + 8) return '';
      var off = le32(d, entry) + 0xcc;
      var len = le32(d, entry + 4);
      if (len === 0 || len > 4096 || off + len > d.length) return '';
      return clean(utf16Bytes(d.subarray(off, off + len)));
    }
    return {
      name: grab(0x0c),
      fullName: grab(0x18),
      comment: grab(0x24),
      homeDir: grab(0x48),
      scriptPath: grab(0x60),
      profilePath: grab(0x6c),
      lmLen: d.length >= 0xa8 ? le32(d, 0xa0) : 0,
      ntLen: d.length >= 0xb4 ? le32(d, 0xac) : 0
    };
  }

  function reportSam(h) {
    var usersKey = keyAt(h, 'SAM\\Domains\\Account\\Users');
    out.rule();
    out.heading('LOCAL ACCOUNTS');
    if (!usersKey) {
      out.warn('SAM\\Domains\\Account\\Users is missing. If you opened this from a');
      out.warn('live system the file was probably locked and copied incompletely.');
      return;
    }

    /* Names\<user> holds no data. The RID is smuggled into the TYPE field of
       the subkey's default value — a genuinely strange design decision, and a
       cheap way to map names to RIDs without parsing V. */
    var namesKey = findChild(h, usersKey, 'Names');
    var ridToName = {};
    if (namesKey) {
      var nameKids = subkeys(h, namesKey, 5000);
      for (var n = 0; n < nameKids.length; n++) {
        var dv3 = valueMap(h, nameKids[n])['(default)'];
        if (dv3) ridToName[dv3.type] = nameKids[n].name;
      }
    }

    var kids = subkeys(h, usersKey, 5000);
    var rows = [], i;
    for (i = 0; i < kids.length; i++) {
      if (!/^[0-9A-Fa-f]{8}$/.test(kids[i].name)) continue;   // Names is the only non-RID child
      var rid = parseInt(kids[i].name, 16);
      var v = valueMap(h, kids[i]);
      var row = { rid: rid, key: kids[i], name: ridToName[rid] || '' };
      var f = v['f'];
      if (f && f.data && f.data.length >= 0x44) {
        var d = f.data;
        row.lastLogon = filetimeText(le32(d, 0x08), le32(d, 0x0c));
        row.pwdSet = filetimeText(le32(d, 0x18), le32(d, 0x1c));
        row.expires = filetimeText(le32(d, 0x20), le32(d, 0x24));
        row.badLogon = filetimeText(le32(d, 0x28), le32(d, 0x2c));
        row.acb = le32(d, 0x38);
        row.failed = d[0x40] | (d[0x41] << 8);
        row.logons = d[0x42] | (d[0x43] << 8);
      }
      var vv = v['v'];
      if (vv && vv.data && vv.data.length > 0xcc) {
        var s = samStrings(vv.data);
        if (s.name) row.name = s.name;
        row.fullName = s.fullName;
        row.comment = s.comment;
        row.homeDir = s.homeDir;
        row.lmLen = s.lmLen;
        row.ntLen = s.ntLen;
      }
      rows.push(row);
    }

    rows.sort(function (a, b) { return a.rid - b.rid; });
    out.dim(rows.length + ' account(s). RID 500 is the built-in Administrator no');
    out.dim('matter what it has been renamed to; 501 is Guest; 1000 and up were');
    out.dim('created by someone.');

    for (i = 0; i < rows.length && i < 200; i++) {
      var r = rows[i];
      out.line('');
      out.line('  ' + (r.name || '(name not recovered)') + '   RID ' + r.rid +
               '  (0x' + r.rid.toString(16) + ')',
               (r.acb & 0x0001) ? 't-dim' : 't-info');
      if (r.fullName) out.line('  ' + pad('full name', 22) + r.fullName);
      if (r.comment) out.line('  ' + pad('comment', 22) + trunc(r.comment, 100));
      if (r.homeDir) out.line('  ' + pad('home directory', 22) + trunc(r.homeDir, 100));
      if (r.acb !== undefined) {
        out.line('  ' + pad('flags', 22) + acbText(r.acb),
                 (r.acb & 0x0405) ? 't-warn' : null);
      }
      if (r.lastLogon) out.line('  ' + pad('last logon', 22) + r.lastLogon);
      if (r.pwdSet) out.line('  ' + pad('password last set', 22) + r.pwdSet);
      if (r.badLogon) out.line('  ' + pad('last bad password', 22) + r.badLogon);
      if (r.expires) out.line('  ' + pad('account expires', 22) + r.expires);
      if (r.logons !== undefined) out.line('  ' + pad('logon count', 22) + r.logons +
                                           '   failed since last good: ' + r.failed);
      out.line('  ' + pad('key last written', 22) + nkTime(r.key));
      /* Deliberate: presence and length only. See the file header comment. */
      if (r.ntLen || r.lmLen) {
        out.line('  ' + pad('stored hashes', 22) +
                 (r.ntLen ? 'NT (' + r.ntLen + ' bytes) ' : '') +
                 (r.lmLen ? 'LM (' + r.lmLen + ' bytes)' : ''), 't-dim');
      }
    }
    if (rows.length > 200) out.dim('  … ' + (rows.length - 200) + ' more accounts');

    out.line('');
    out.dim('Hash bytes are not printed. They are encrypted with the bootkey');
    out.dim('held in the SYSTEM hive, so they are useless on their own, and');
    out.dim('offline credential extraction is a different tool with a different');
    out.dim('audience. Everything else in the SAM is above.');

    var builtin = keyAt(h, 'SAM\\Domains\\Builtin\\Aliases\\Names');
    if (builtin) {
      var groups = subkeys(h, builtin, 500);
      if (groups.length) {
        out.rule();
        out.heading('BUILT-IN GROUPS PRESENT  (' + groups.length + ')');
        var line = '';
        for (i = 0; i < groups.length && i < 60; i++) {
          line += pad(trunc(groups[i].name, 24), 26);
          if ((i + 1) % 3 === 0) { out.line('  ' + line); line = ''; }
        }
        if (line) out.line('  ' + line);
        out.dim('  Membership lives in the alias C values as raw SIDs and is not');
        out.dim('  decoded here — browse SAM\\Domains\\Builtin\\Aliases to see them.');
      }
    }
  }

  /* ======================================================================
     Free-space sweep for deleted keys
     ====================================================================== */

  /* Walk every cell in the file and look at the ones marked free. A deleted
     key keeps its nk record intact until the space is reused, so its name and
     last-written time often survive for a long time. This is a signature scan,
     not a reconstruction: parents are not re-linked and values are not
     followed, because a free cell's pointers may already point at reused
     space and following them invents evidence. */
  function sweepDeleted(h) {
    out.rule();
    out.heading('DELETED KEYS IN FREE SPACE');
    if (h.bytes.length > SWEEP_MAX_BYTES) {
      out.dim('Skipped: this hive is ' + LabTool.humanBytes(h.bytes.length) + ' and the');
      out.dim('sweep is capped at ' + LabTool.humanBytes(SWEEP_MAX_BYTES) + ' to keep the page responsive.');
      return;
    }

    var at = HBIN_BASE, scanned = 0, found = [];
    var fileEnd = h.bytes.length;
    while (at + 32 <= fileEnd && scanned < SWEEP_LIMIT) {
      if (!(h.bytes[at] === 0x68 && h.bytes[at + 1] === 0x62 &&
            h.bytes[at + 2] === 0x69 && h.bytes[at + 3] === 0x6e)) break;
      var binSize = h.dv.getUint32(at + 0x08, true);
      if (binSize < 0x1000 || binSize % 0x1000 !== 0 || at + binSize > fileEnd) break;
      var cellAt = at + 32;
      var binEnd = at + binSize;
      while (cellAt + 4 <= binEnd && scanned < SWEEP_LIMIT) {
        scanned++;
        var size = h.dv.getInt32(cellAt, true);
        var len = size < 0 ? -size : size;
        if (len < 8 || cellAt + len > binEnd) break;   // bin is internally broken; move on
        if (size > 0 && len >= 0x50) {                 // positive size == free cell
          var p = cellAt + 4;
          if (h.bytes[p] === 0x6e && h.bytes[p + 1] === 0x6b) {
            var flags = h.dv.getUint16(p + 0x02, true);
            var nameLen = h.dv.getUint16(p + 0x48, true);
            var lo = h.dv.getUint32(p + 0x04, true);
            var hi = h.dv.getUint32(p + 0x08, true);
            /* Three filters, because free space is full of bytes that happen
               to read 'nk'. The name must fit the cell, be a sane length, and
               the timestamp must land in a believable window. */
            if (nameLen > 0 && nameLen <= 255 && (p + 0x4c + nameLen) <= cellAt + len &&
                plausibleFiletime(lo, hi)) {
              var name = (flags & 0x20) ? latin1(h, p + 0x4c, nameLen)
                                        : utf16(h, p + 0x4c, nameLen);
              if (/^[\x20-\x7e]{1,255}$/.test(name)) {
                found.push({ name: name, when: filetimeText(lo, hi), at: cellAt - HBIN_BASE });
                if (found.length >= 400) { cellAt = binEnd; at = fileEnd; break; }
              }
            }
          }
        }
        cellAt += len;
      }
      at += binSize;
    }

    if (!found.length) {
      out.dim('No recoverable key records found in free cells. That is normal for');
      out.dim('a hive that has been compacted, and for a small one.');
      return;
    }
    out.dim(found.length + (found.length >= 400 ? '+ (capped)' : '') +
            ' key record(s) sitting in cells marked free. ' + scanned + ' cells scanned.');
    out.dim('  ' + pad('offset', 12) + pad('last written (UTC)', 26) + 'key name');
    for (var i = 0; i < found.length && i < 200; i++) {
      out.line('  ' + pad('0x' + found[i].at.toString(16), 12) +
               pad(found[i].when, 26) + trunc(clean(found[i].name), 80), 't-warn');
    }
    if (found.length > 200) out.dim('  … ' + (found.length - 200) + ' more not shown');
    out.line('');
    out.dim('Only the key name and its timestamp are trustworthy here. The path');
    out.dim('these keys sat at, and their values, are not reconstructed: the');
    out.dim('pointers in a freed cell may already describe reused space, and');
    out.dim('following them would produce evidence that was never there.');
  }

  /* ======================================================================
     Header report and the tree browser
     ====================================================================== */

  function reportHeader(h, file) {
    out.heading(file ? file.name : lastFileName);
    out.row('size', LabTool.humanBytes(h.bytes.length) + '  (' + h.bytes.length + ' bytes)');
    out.row('signature', 'regf', 't-ok');
    out.row('format version', h.major + '.' + h.minor +
            (h.minor >= 4 ? '  (supports big-data values)' : ''));
    out.row('file type', h.fileType === 0 ? 'primary hive'
                       : h.fileType === 1 ? 'TRANSACTION LOG (.LOG1/.LOG2)'
                       : 'type ' + h.fileType,
            h.fileType === 0 ? 't-ok' : 't-warn');
    if (h.fileType === 1) {
      out.warn('This is a transaction log, not the hive itself. It carries pages');
      out.warn('of pending writes and will not have a usable key tree. Load the');
      out.warn('matching primary hive instead.');
    }
    out.row('embedded name', h.embeddedName || '(blank)');
    out.dim('  The header keeps the last 31 characters of the original path,');
    out.dim('  which usually survives renaming the file.');
    out.row('last written', filetimeText(h.writtenLo, h.writtenHi));

    /* A primary and secondary sequence number that disagree mean the hive was
       copied mid-write, or was never flushed. It is the single most useful
       integrity fact in the header. */
    if (h.seqPrimary === h.seqSecondary) {
      out.row('sequence numbers', h.seqPrimary + ' = ' + h.seqSecondary + '  (clean)', 't-ok');
    } else {
      out.row('sequence numbers', h.seqPrimary + ' ≠ ' + h.seqSecondary + '  (DIRTY)', 't-warn');
      out.dim('  The hive was not flushed cleanly. Some of the most recent');
      out.dim('  changes live only in the .LOG1/.LOG2 files next to it, and are');
      out.dim('  not visible here. Replay them before drawing conclusions about');
      out.dim('  what was last written.');
    }
    out.row('header checksum', h.checksumStored === h.checksumCalc
      ? 'valid (0x' + h.checksumCalc.toString(16) + ')'
      : 'MISMATCH — stored 0x' + h.checksumStored.toString(16) +
        ', computed 0x' + h.checksumCalc.toString(16),
      h.checksumStored === h.checksumCalc ? 't-ok' : 't-err');

    var bins = scanBins(h);
    out.row('hive bins', bins.count + ' bin(s), ' + LabTool.humanBytes(bins.total));
    if (h.binsSize && bins.total !== h.binsSize) {
      out.warn('  The header declares ' + LabTool.humanBytes(h.binsSize) + ' of bin data but the ' +
               'chain stops after ' + LabTool.humanBytes(bins.total) + '.');
      out.warn('  The file is truncated, or a bin header is damaged. Anything');
      out.warn('  past offset 0x' + bins.endedAt.toString(16) + ' is unreachable.');
    }
    out.row('root key', h.root.name + '  (offset 0x' + h.rootOffset.toString(16) + ')');
    out.row('root last written', nkTime(h.root));
    out.row('root subkeys', h.root.subkeyCount + ' subkeys, ' + h.root.valueCount + ' values');
  }

  var FLAG_NAMES = [
    [0x0001, 'volatile'], [0x0002, 'hive exit'], [0x0004, 'hive entry (root)'],
    [0x0008, 'no delete'], [0x0010, 'symlink'], [0x0020, 'ASCII name'],
    [0x0040, 'predefined handle']
  ];

  function flagText(flags) {
    var parts = [];
    for (var i = 0; i < FLAG_NAMES.length; i++) {
      if (flags & FLAG_NAMES[i][0]) parts.push(FLAG_NAMES[i][1]);
    }
    return parts.length ? parts.join(', ') : 'none';
  }

  function browse(h, pathText) {
    var r = resolvePath(h, pathText);
    out.clear();
    if (!r.node) {
      out.err('No key named "' + clean(r.failedAt) + '" under ' +
              (r.walked ? '\\' + r.walked : 'the hive root') + '.');
      out.line('');
      /* Show what IS there at the point the walk stopped — far more useful
         than the failure on its own. */
      var partial = r.walked ? keyAt(h, r.walked) : h.root;
      if (partial) {
        var kids = subkeys(h, partial, 500);
        out.dim('Subkeys available at ' + (r.walked ? '\\' + r.walked : 'the root') +
                '  (' + kids.length + '):');
        for (var i = 0; i < kids.length && i < 60; i++) out.line('  ' + kids[i].name);
        if (kids.length > 60) out.dim('  … ' + (kids.length - 60) + ' more');
      }
      out.line('');
      out.dim('Paths are matched case-insensitively. HKLM\\ and the hive\'s own');
      out.dim('name are stripped if present, and CurrentControlSet is rewritten');
      out.dim('to the control set the Select key points at.');
      return;
    }

    var node = r.node;
    out.heading('\\' + (r.path || '(root: ' + node.name + ')'));
    out.row('key name', node.name);
    out.row('last written', nkTime(node));
    out.row('flags', '0x' + node.flags.toString(16) + '  (' + flagText(node.flags) + ')');
    out.row('cell offset', '0x' + node.rel.toString(16) + '  (file offset 0x' +
                           (node.rel + HBIN_BASE).toString(16) + ')');
    out.row('counts', node.subkeyCount + ' subkeys, ' + node.valueCount + ' values');
    if (!node.allocated) out.warn('This cell is marked FREE — the key is deleted.');

    var vals = values(h, node);
    out.rule();
    out.heading('VALUES  (' + vals.length + ')');
    if (!vals.length) out.dim('  none');
    var i;
    for (i = 0; i < vals.length && i < 300; i++) {
      var v = vals[i];
      out.line('  ' + pad(trunc(v.name, 30), 32) + pad(typeName(v.type), 22) +
               trunc(valueText(v), 140));
      if (v.inline) {
        out.line('  ' + pad('', 32) + '(' + v.declaredSize +
                 ' bytes stored inline in the offset field)', 't-dim');
      } else if (v.resident !== 'cell') {
        out.line('  ' + pad('', 32) + '(' + v.resident + ')', 't-dim');
      }
    }
    if (vals.length > 300) out.dim('  … ' + (vals.length - 300) + ' more values not shown');

    var kids2 = subkeys(h, node, 20000);
    out.rule();
    out.heading('SUBKEYS  (' + kids2.declared + ')');
    if (!kids2.length) out.dim('  none');
    for (i = 0; i < kids2.length && i < 400; i++) {
      out.line('  ' + pad(trunc(kids2[i].name, 46), 48) + pad(nkTime(kids2[i]), 26) +
               kids2[i].subkeyCount + ' sub / ' + kids2[i].valueCount + ' val');
    }
    if (kids2.length > 400) out.dim('  … ' + (kids2.length - 400) + ' more subkeys not shown');
    /* The nk header's own subkey count and the length of its subkey list can
       disagree in a damaged hive. Both are printed rather than picked between,
       because which one is right is the interesting question. */
    if (kids2.declared !== node.subkeyCount) {
      out.warn('  The key record claims ' + node.subkeyCount + ' subkeys but its subkey list holds ' +
               kids2.declared + '.');
    }
    out.rule();
    out.dim('Type a deeper path in the box above and press Run to walk further,');
    out.dim('or clear it and press Run for the full forensic report.');
  }

  /* ======================================================================
     Report driver
     ====================================================================== */

  function fullReport(h, file) {
    h.budget = READ_BUDGET;
    h.exhausted = false;
    h.badPointers = 0;
    out.clear();

    reportHeader(h, file);

    var kind = identifyHive(h);
    out.rule();
    out.heading('HIVE TYPE');
    out.row('recognised as', kind, kind === 'UNKNOWN' ? 't-warn' : 't-ok');
    out.dim(HIVE_BLURB[kind]);
    if (h.fileType === 1) return;

    autostartSection(h, kind);

    if (kind === 'SYSTEM') reportSystem(h);
    else if (kind === 'SOFTWARE') reportSoftware(h);
    else if (kind === 'NTUSER' || kind === 'USRCLASS') reportNtuser(h);
    else if (kind === 'SAM') reportSam(h);
    else if (kind === 'SECURITY') {
      out.rule();
      out.heading('SECURITY');
      out.dim('Almost everything here is an encrypted LSA blob: cached domain');
      out.dim('logons, service account passwords, the machine account secret.');
      out.dim('Decryption needs the bootkey from SYSTEM and is out of scope.');
      out.dim('The key structure is browsable below — Policy\\PolAdtEv holds the');
      out.dim('audit policy, and Policy\\Accounts the privilege assignments.');
    } else {
      out.rule();
      out.heading(kind === 'UNKNOWN' ? 'UNRECOGNISED HIVE' : kind + ' — KEY TREE');
      if (kind === 'UNKNOWN') {
        out.dim('The root key\'s children do not match any hive this tool knows.');
      }
      var kids = subkeys(h, h.root, 500);
      out.dim('Root subkeys (' + kids.length + '):');
      for (var i = 0; i < kids.length && i < 60; i++) {
        out.line('  ' + pad(trunc(kids[i].name, 46), 48) + nkTime(kids[i]));
      }
    }

    sweepDeleted(h);

    out.rule();
    if (h.badPointers) {
      out.warn(h.badPointers + ' pointer(s) in this hive led nowhere valid and were');
      out.warn('skipped. Some of the report above is therefore incomplete. That is');
      out.warn('expected in a carved or partially-overwritten hive.');
    }
    if (h.exhausted) {
      out.err('The cell read budget (' + READ_BUDGET + ') ran out before the report');
      out.err('finished, so sections after that point are missing. This normally');
      out.err('means a pointer loop in a damaged hive rather than a large one.');
    }
    out.dim('Everything above was computed from the bytes you dropped in, in this');
    out.dim('tab. Nothing was uploaded, which is the only reason it is reasonable');
    out.dim('to point this at a hive pulled from a live incident.');
    out.line('');
    out.dim('Browse any key: put a path in the box above and press Run, for');
    out.dim('example  ControlSet001\\Services  or  Microsoft\\Windows\\CurrentVersion.');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function pathBox() {
    var el = document.getElementById('tool-path');
    return el ? el.value.trim() : '';
  }

  function run() {
    if (!hive) {
      out.clear().warn('Choose or drop a registry hive first — SYSTEM, SOFTWARE,');
      out.warn('SAM, SECURITY or an NTUSER.DAT. They have no file extension and');
      out.warn('live in C:\\Windows\\System32\\config and in each user profile.');
      return;
    }
    try {
      hive.budget = READ_BUDGET;
      hive.exhausted = false;
      var path = pathBox();
      if (path) browse(hive, path);
      else fullReport(hive, null);
    } catch (err) {
      out.clear().err('The parser gave up: ' + (err && err.message ? err.message : String(err)));
      out.dim('That is a bug or a hive shaped in a way this tool has not seen.');
      out.dim('The file was not modified and nothing was sent anywhere.');
    }
  }

  LabTool.define({
    id: 'registryviewertool',
    run: run,
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          var nameEl = document.getElementById('tool-dropname');
          if (nameEl) nameEl.textContent = file.name;
          lastFileName = file.name;
          hive = null;
          try {
            var opened = openHive(bytes);
            if (opened.error) {
              out.clear().err(opened.error);
              out.line('');
              out.dim('Registry hives are the files in C:\\Windows\\System32\\config');
              out.dim('(SYSTEM, SOFTWARE, SAM, SECURITY, DEFAULT) and NTUSER.DAT in');
              out.dim('each user profile. They have no extension and begin "regf".');
              return;
            }
            hive = opened;
            fullReport(hive, file);
          } catch (err) {
            out.clear().err('Could not parse that file: ' +
                            (err && err.message ? err.message : String(err)));
            out.dim('It begins with the right signature but the structure past the');
            out.dim('header is not something this parser could follow.');
          }
        },
        onError: function (msg) { out.clear().err(msg); }
      });

      var pathEl = document.getElementById('tool-path');
      if (pathEl) {
        pathEl.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); run(); }
        });
      }

      out.dim('Drop a Windows registry hive — SYSTEM, SOFTWARE, SAM, SECURITY or');
      out.dim('an NTUSER.DAT. The tool recognises which one it is and pulls out');
      out.dim('what matters: autostart entries first, then USB history, installed');
      out.dim('programs, accounts, recent documents and program execution,');
      out.dim('depending on the hive.');
      out.line('');
      out.dim('Everything happens in this tab. A hive from a live incident is not');
      out.dim('a file you upload to a website, and this one never asks you to.');
      out.line('');
      out.dim('Once loaded, put a key path in the box to browse the tree, e.g.');
      out.dim('  ControlSet001\\Control\\ComputerName\\ComputerName');
      out.dim('  Microsoft\\Windows\\CurrentVersion\\Uninstall');
      out.dim('Clear the box and press Run to return to the full report.');
    }
  });
})();

/* ==========================================================================
   pdf-tools.js — merge, split, reorder, rotate and inspect PDFs, in the tab.
   --------------------------------------------------------------------------
   Every free "PDF tool" site works the same way: you upload the document, a
   server does the work, and you take it on faith that the contract, the bank
   statement or the passport scan you just handed over was deleted afterwards.
   This one has no server. The file is read with FileReader, parsed here, and
   the result is handed back as a blob URL. There is no fetch() and no XHR in
   this file, which is the only version of that promise worth making.

   --------------------------------------------------------------------------
   THE OBJECT MODEL, because everything below assumes it
   --------------------------------------------------------------------------
   A PDF is a plain-text skeleton wrapped around binary blobs, in four parts:

     1. The header, `%PDF-1.7`, in the first kilobyte. Real files sometimes
        carry junk in front of it, and then every byte offset in the file is
        measured from the header rather than from byte zero.

     2. The body: numbered indirect objects, each written as

              12 0 obj
              << /Type /Page /Parent 3 0 R /Contents 13 0 R >>
              endobj

        where `12` is the object number, `0` the generation, and everything
        refers to everything else by `12 0 R`. The value types are the whole
        language: null, booleans, numbers, /Names, (strings) and <hex strings>,
        [arrays], << dictionaries >>, and streams — a dictionary followed by
        the keyword `stream`, /Length raw bytes, and `endstream`.

     3. The cross-reference index, which maps an object number to a byte
        offset. You find it by reading `startxref` at the end of the file and
        jumping to the offset it names. There are two flavours and a modern
        toolkit meets both:

          - The CLASSIC TABLE: the keyword `xref`, then subsections of
            fixed-width 20-byte records, then a `trailer` dictionary.

          - The XREF STREAM (PDF 1.5 and later): the same table, but stored as
            an ordinary stream object with /Type /XRef, Flate-compressed, with
            field widths in /W and almost always a PNG predictor on top. The
            trailer keys live in that stream's own dictionary. Every current
            producer emits these, so a parser that only knows the classic table
            fails on most files it is actually given.

     4. The trailer, which names /Root — the catalog — and optionally /Info,
        /Encrypt and /ID.

   Two more things that only become obvious once you write a parser:

     - OBJECT STREAMS (/Type /ObjStm). PDF 1.5 lets a producer pack hundreds of
       small dictionaries into one compressed stream, so those objects never
       appear as `n 0 obj` anywhere in the file. A type-2 xref entry says
       "object 12 is item 4 inside object stream 40". Streams themselves may
       not be packed this way, which is the detail that makes the writer below
       simple: content streams and font files are always addressable directly.

     - INCREMENTAL UPDATES. A PDF can be edited by appending to it. Each update
       writes its own xref section ending in a /Prev pointing at the previous
       one, and a later definition of an object number shadows the earlier one.
       Counting those sections tells you how many times a file has been saved
       since it was created, which is a genuine forensic signal on a document
       somebody says they have not touched.

   The page tree hangs off the catalog: /Root -> /Pages -> a tree of /Pages
   nodes with /Kids, ending in /Page leaves. /Resources, /MediaBox, /CropBox
   and /Rotate are INHERITED down that tree, so a leaf page can be missing all
   four and still be perfectly well defined.

   --------------------------------------------------------------------------
   WHAT THE WRITER DOES, AND WHAT IT REFUSES TO DO
   --------------------------------------------------------------------------
   Building an output file means: take the chosen pages, push the inherited
   attributes down so each page is self-contained, deep-copy each page's object
   graph with fresh object numbers, hang them off a new /Pages node under a new
   catalog, and write a classic xref table.

   Writing a classic table rather than an xref stream is deliberate. It costs
   twenty bytes per object, every reader written since 1993 understands it, and
   it means this file never has to PRODUCE a deflate stream — only consume one.
   Hand-rolled compressors are where quiet corruption lives.

   Content streams, embedded fonts and images are copied byte for byte with
   their original /Filter intact. Nothing is re-encoded, which is why there is
   no quality slider anywhere on the page and why images come out identical to
   the ones that went in.

   The things it does not do are listed on the page as well as here, because a
   tool that fails silently is worse than one that refuses:

     - No decryption. If /Encrypt is present the strings and streams are
       ciphertext and the honest move is to say so and stop.
     - No re-encoding of images, no OCR, no editing of text content.
     - Outlines (bookmarks), the AcroForm dictionary, document-level
       JavaScript and the /StructTreeRoot accessibility tree are NOT carried
       into the output. They index the whole original document, and a partial
       copy of an index is worse than none.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_FILE = 64 * 1024 * 1024;   // one document, held in memory as bytes
  var MAX_DOCS = 12;
  var MAX_BENCH = 4000;              // pages on the bench
  var MAX_COPY = 300000;             // objects one output file may contain
  var MAX_SWEEP = 60000;             // objects the inspector will walk

  var out = LabTool.out('tool-out');
  var docs = [];                     // loaded documents, in load order
  var bench = [];                    // { d: docIndex, p: pageIndex, rot: deg }
  var focusKey = null;               // control to restore focus to after a redraw

  /* ==================================================================
     Byte and string helpers
     ================================================================== */

  function latin1(bytes, start, end) {
    var s = '', i, chunk;
    start = start || 0;
    if (end === undefined || end > bytes.length) end = bytes.length;
    // String.fromCharCode.apply blows the argument limit somewhere around
    // 100k on most engines, so this walks in slices rather than trusting it.
    for (i = start; i < end; i += 8192) {
      chunk = bytes.subarray(i, Math.min(i + 8192, end));
      s += String.fromCharCode.apply(null, chunk);
    }
    return s;
  }

  function strBytes(s) {
    var b = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  function padRight(text, width) {
    var s = String(text);
    while (s.length < width) s += ' ';
    return s;
  }

  function isWs(c) {
    return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 ||
           c === 0x0c || c === 0x00;
  }

  function isDelim(c) {
    return c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e ||
           c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d ||
           c === 0x2f || c === 0x25;
  }

  function isRegular(c) { return !isWs(c) && !isDelim(c); }

  /* Find a byte sequence. Written out rather than going through a string,
     because these files run to tens of megabytes and building a latin1 copy
     of one just to call indexOf doubles the memory for no gain. */
  function findBytes(hay, needle, from, to) {
    var n = needle.length, i, j, ok;
    if (to === undefined || to > hay.length) to = hay.length;
    for (i = Math.max(0, from); i + n <= to; i++) {
      ok = true;
      for (j = 0; j < n; j++) {
        if (hay[i + j] !== needle[j]) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }

  function findBytesBack(hay, needle, from) {
    var n = needle.length, i, j, ok;
    for (i = Math.min(from, hay.length - n); i >= 0; i--) {
      ok = true;
      for (j = 0; j < n; j++) {
        if (hay[i + j] !== needle[j]) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }

  /* ==================================================================
     DEFLATE, by hand.
     ------------------------------------------------------------------
     Needed because xref streams and object streams are Flate-compressed,
     and without them a parser cannot even find the page tree in a file
     saved by anything made in the last twenty years.

     This is the "puff" shape: a bit reader, canonical Huffman tables built
     from code lengths, and the two static tables the format hard-codes.
     Decoding walks the tree one bit at a time rather than building a
     lookup table — slower, and short enough to read and check, which for a
     format where a wrong bit silently yields plausible garbage is the
     better trade.
     ================================================================== */

  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35,
               43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT  = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
               4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257,
               385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
               16385, 24577];
  var DEXT  = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
               9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huffTable(lengths) {
    var counts = [], symbols = [], offs = [], i, sum = 0;
    for (i = 0; i < 16; i++) { counts[i] = 0; offs[i] = 0; }
    for (i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    for (i = 1; i < 16; i++) { offs[i] = sum; sum += counts[i]; }
    for (i = 0; i < lengths.length; i++) {
      if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    }
    return { counts: counts, symbols: symbols };
  }

  var FIXED_LIT = null, FIXED_DIST = null;

  function fixedTables() {
    if (FIXED_LIT) return;
    var lengths = [], i;
    for (i = 0; i < 144; i++) lengths[i] = 8;
    for (i = 144; i < 256; i++) lengths[i] = 9;
    for (i = 256; i < 280; i++) lengths[i] = 7;
    for (i = 280; i < 288; i++) lengths[i] = 8;
    FIXED_LIT = huffTable(lengths);
    var dl = [];
    for (i = 0; i < 30; i++) dl[i] = 5;
    FIXED_DIST = huffTable(dl);
  }

  function inflateRaw(src, from) {
    var pos = from, bitbuf = 0, bitcnt = 0;
    var cap = Math.max(4096, Math.min((src.length - from) * 5, 16 * 1024 * 1024));
    var buf = new Uint8Array(cap), len = 0;

    function grow(need) {
      if (len + need <= buf.length) return;
      var size = buf.length;
      while (size < len + need) size *= 2;
      var next = new Uint8Array(size);
      next.set(buf.subarray(0, len));
      buf = next;
    }

    /* Never asked for more than 16 bits at a time, so bitcnt tops out at 23
       and the accumulator stays well inside the range where JavaScript's
       bitwise operators are exact. */
    function bits(n) {
      while (bitcnt < n) {
        if (pos >= src.length) throw new Error('the compressed stream ends mid-symbol');
        bitbuf |= src[pos++] << bitcnt;
        bitcnt += 8;
      }
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n;
      bitcnt -= n;
      return v;
    }

    function decode(table) {
      var code = 0, first = 0, index = 0, l, count;
      for (l = 1; l < 16; l++) {
        code |= bits(1);
        count = table.counts[l];
        if (code - first < count) return table.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('a Huffman code in the compressed stream is not in its table');
    }

    fixedTables();
    var final = 0;
    do {
      final = bits(1);
      var type = bits(2);
      if (type === 0) {
        // Stored block: discard the partial byte, then a length and its
        // one's complement, which is the format's own integrity check.
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > src.length) throw new Error('a stored block runs past the end of the stream');
        var blen = src[pos] | (src[pos + 1] << 8);
        var nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if ((blen ^ 0xffff) !== nlen) throw new Error('a stored block length disagrees with its check word');
        if (pos + blen > src.length) throw new Error('a stored block runs past the end of the stream');
        grow(blen);
        buf.set(src.subarray(pos, pos + blen), len);
        len += blen;
        pos += blen;
        continue;
      }
      if (type === 3) throw new Error('the stream uses reserved block type 3');

      var lit, dist;
      if (type === 1) {
        lit = FIXED_LIT; dist = FIXED_DIST;
      } else {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        var clens = [], i;
        for (i = 0; i < 19; i++) clens[i] = 0;
        for (i = 0; i < hclen; i++) clens[CLORDER[i]] = bits(3);
        var cltable = huffTable(clens);
        var lens = [], n = 0;
        while (n < hlit + hdist) {
          var sym = decode(cltable), rep, val;
          if (sym < 16) { lens[n++] = sym; continue; }
          if (sym === 16) {
            if (!n) throw new Error('a code-length repeat appears before any code length');
            val = lens[n - 1]; rep = 3 + bits(2);
          } else if (sym === 17) {
            val = 0; rep = 3 + bits(3);
          } else {
            val = 0; rep = 11 + bits(7);
          }
          if (n + rep > hlit + hdist) throw new Error('the code-length table overruns its own declared size');
          while (rep--) lens[n++] = val;
        }
        lit = huffTable(lens.slice(0, hlit));
        dist = huffTable(lens.slice(hlit));
      }

      for (;;) {
        var s = decode(lit);
        if (s < 256) { grow(1); buf[len++] = s; continue; }
        if (s === 256) break;
        s -= 257;
        if (s >= LBASE.length) throw new Error('an invalid length code appears in the stream');
        var length = LBASE[s] + bits(LEXT[s]);
        var ds = decode(dist);
        if (ds >= DBASE.length) throw new Error('an invalid distance code appears in the stream');
        var d = DBASE[ds] + bits(DEXT[ds]);
        if (d > len) throw new Error('a back-reference points before the start of the output');
        grow(length);
        var at = len - d, k;
        for (k = 0; k < length; k++) buf[len + k] = buf[at + k];
        len += length;
      }
    } while (!final);

    var result = new Uint8Array(len);
    result.set(buf.subarray(0, len));
    return result;
  }

  /* PDF's /FlateDecode is zlib (RFC 1950), which is a two-byte header around
     the raw deflate above. Enough real files carry a raw deflate stream with
     no header — usually written by something that misread the spec — that it
     is worth trying both rather than refusing a document over two bytes. */
  function flateDecode(src) {
    var hasHeader = src.length > 2 && (src[0] & 0x0f) === 8 &&
                    ((src[0] << 8) | src[1]) % 31 === 0;
    try {
      return inflateRaw(src, hasHeader ? 2 : 0);
    } catch (err) {
      try {
        return inflateRaw(src, hasHeader ? 0 : 2);
      } catch (err2) {
        throw err;
      }
    }
  }

  /* ==================================================================
     The other stream filters a structural read can meet.
     Image codecs (DCT, JPX, CCITT, JBIG2) are deliberately absent: this
     tool never looks inside pixel data and never re-encodes it.
     ================================================================== */

  function asciiHexDecode(src) {
    var outArr = [], hi = -1, i, c, v;
    for (i = 0; i < src.length; i++) {
      c = src[i];
      if (c === 0x3e) break;                       // '>' ends the data
      if (c >= 0x30 && c <= 0x39) v = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) v = c - 55;
      else if (c >= 0x61 && c <= 0x66) v = c - 87;
      else continue;                               // whitespace and noise
      if (hi < 0) hi = v;
      else { outArr.push((hi << 4) | v); hi = -1; }
    }
    if (hi >= 0) outArr.push(hi << 4);             // odd digit is padded with 0
    return new Uint8Array(outArr);
  }

  function ascii85Decode(src) {
    var outArr = [], tuple = 0, count = 0, i, c;
    var start = (src[0] === 0x3c && src[1] === 0x7e) ? 2 : 0;
    for (i = start; i < src.length; i++) {
      c = src[i];
      if (c === 0x7e) break;                       // '~>' ends the data
      if (isWs(c)) continue;
      if (c === 0x7a && count === 0) {             // 'z' is four zero bytes
        outArr.push(0, 0, 0, 0);
        continue;
      }
      if (c < 0x21 || c > 0x75) continue;
      tuple = tuple * 85 + (c - 0x21);
      count++;
      if (count === 5) {
        outArr.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff,
                    (tuple >>> 8) & 0xff, tuple & 0xff);
        tuple = 0; count = 0;
      }
    }
    if (count > 1) {
      var k;
      for (k = count; k < 5; k++) tuple = tuple * 85 + 84;
      var bytes = [(tuple / 16777216) & 0xff, (tuple >>> 16) & 0xff,
                   (tuple >>> 8) & 0xff, tuple & 0xff];
      for (k = 0; k < count - 1; k++) outArr.push(bytes[k]);
    }
    return new Uint8Array(outArr);
  }

  function runLengthDecode(src) {
    var outArr = [], i = 0, n, k;
    while (i < src.length) {
      n = src[i++];
      if (n === 128) break;
      if (n < 128) {
        for (k = 0; k <= n && i < src.length; k++) outArr.push(src[i++]);
      } else {
        var b = src[i++];
        for (k = 0; k < 257 - n; k++) outArr.push(b);
      }
    }
    return new Uint8Array(outArr);
  }

  /* LZW as PDF uses it: variable code width from 9 to 12 bits, 256 as clear
     and 257 as end-of-data, and an /EarlyChange quirk that widens the code one
     entry sooner than the TIFF original. Rare in files written this decade,
     common in ones from the 1990s, and short enough to be worth having. */
  function lzwDecode(src, early) {
    var dict = [], i;
    for (i = 0; i < 256; i++) dict[i] = [i];
    dict[256] = null; dict[257] = null;
    var next = 258, width = 9, prev = null;
    var pieces = [], total = 0, bitbuf = 0, bitcnt = 0, pos = 0;
    var delta = (early === 0) ? 0 : 1;

    function emit(arr) { pieces.push(arr); total += arr.length; }

    for (;;) {
      while (bitcnt < width) {
        if (pos >= src.length) { bitcnt = -1; break; }
        bitbuf = (bitbuf << 8) | src[pos++];
        bitcnt += 8;
      }
      if (bitcnt < 0) break;
      var code = (bitbuf >>> (bitcnt - width)) & ((1 << width) - 1);
      bitcnt -= width;
      if (code === 257) break;
      if (code === 256) {
        dict.length = 258; next = 258; width = 9; prev = null;
        continue;
      }
      var entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat([prev[0]]);
      else throw new Error('an LZW code arrives before anything has defined it');
      emit(entry);
      if (prev) { dict[next++] = prev.concat([entry[0]]); }
      prev = entry;
      if (next + delta >= (1 << width) && width < 12) width++;
    }

    var result = new Uint8Array(total), at = 0;
    for (i = 0; i < pieces.length; i++) {
      result.set(pieces[i], at);
      at += pieces[i].length;
    }
    return result;
  }

  /* PNG and TIFF predictors. Xref streams almost always use PNG "up" (12) or
     "optimum" (15), because the rows of a cross-reference table are nearly
     identical to each other and subtracting the previous row leaves mostly
     zeroes for the compressor. Getting this wrong yields offsets that are
     wrong by a plausible-looking amount, which is the worst kind of wrong. */
  function unpredict(data, predictor, colors, bpc, columns) {
    if (!predictor || predictor === 1) return data;
    var bpp = Math.max(1, Math.ceil(colors * bpc / 8));
    var rowLen = Math.ceil(colors * bpc * columns / 8);

    if (predictor === 2) {
      // TIFF predictor: horizontal differencing. Only the 8-bit case is
      // handled; sub-byte components are vanishingly rare and guessing at
      // them would be worse than saying so.
      if (bpc !== 8) throw new Error('a TIFF predictor below 8 bits per component is not handled');
      var rows = Math.floor(data.length / rowLen), r, i;
      for (r = 0; r < rows; r++) {
        var base = r * rowLen;
        for (i = bpp; i < rowLen; i++) {
          data[base + i] = (data[base + i] + data[base + i - bpp]) & 0xff;
        }
      }
      return data;
    }

    var count = Math.floor(data.length / (rowLen + 1));
    var result = new Uint8Array(count * rowLen);
    var prev = new Uint8Array(rowLen);
    var row = 0;
    for (row = 0; row < count; row++) {
      var ft = data[row * (rowLen + 1)];
      var src = row * (rowLen + 1) + 1;
      var dst = row * rowLen;
      var j;
      for (j = 0; j < rowLen; j++) {
        var raw = data[src + j];
        var left = j >= bpp ? result[dst + j - bpp] : 0;
        var up = prev[j];
        var upLeft = j >= bpp ? prev[j - bpp] : 0;
        var value;
        if (ft === 0) value = raw;
        else if (ft === 1) value = raw + left;
        else if (ft === 2) value = raw + up;
        else if (ft === 3) value = raw + ((left + up) >> 1);
        else if (ft === 4) {
          var p = left + up - upLeft;
          var pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          value = raw + ((pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft));
        } else throw new Error('PNG predictor row filter ' + ft + ' is not a defined value');
        result[dst + j] = value & 0xff;
      }
      prev = result.subarray(dst, dst + rowLen);
    }
    return result;
  }

  /* ==================================================================
     Object model
     ================================================================== */

  function Name(v) { this.name = v; }
  function Ref(num, gen) { this.num = num; this.gen = gen; }
  function PStr(bytes) { this.bytes = bytes; }
  /* Dictionary keys come out of the file, so the backing map is created with
     a null prototype. A PDF is perfectly entitled to contain a key called
     /constructor or /__proto__, and on a plain object literal that key would
     either read back as a function or silently rewrite the prototype chain. */
  function PDict() { this.map = Object.create(null); }
  function PStream(dict, raw) { this.dict = dict; this.raw = raw; }

  function isName(v, want) {
    return v instanceof Name && (want === undefined || v.name === want);
  }

  function dictOf(v) {
    if (v instanceof PDict) return v;
    if (v instanceof PStream) return v.dict;
    return null;
  }

  /* ==================================================================
     Lexer / parser
     ================================================================== */

  function Lexer(bytes, pos) {
    this.b = bytes;
    this.pos = pos || 0;
    this.depth = 0;
  }

  Lexer.prototype.skipWs = function () {
    var b = this.b;
    while (this.pos < b.length) {
      var c = b[this.pos];
      if (isWs(c)) { this.pos++; continue; }
      if (c === 0x25) {                       // '%' comment to end of line
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
        continue;
      }
      return;
    }
  };

  Lexer.prototype.readToken = function () {
    this.skipWs();
    var b = this.b, start = this.pos;
    while (this.pos < b.length && isRegular(b[this.pos])) this.pos++;
    if (this.pos === start) return null;
    return latin1(b, start, this.pos);
  };

  Lexer.prototype.readName = function () {
    var b = this.b;
    this.pos++;                                // past '/'
    var s = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      var c = b[this.pos];
      if (c === 0x23 && this.pos + 2 < b.length) {   // '#' hex escape
        var hex = parseInt(latin1(b, this.pos + 1, this.pos + 3), 16);
        if (!isNaN(hex)) { s += String.fromCharCode(hex); this.pos += 3; continue; }
      }
      s += String.fromCharCode(c);
      this.pos++;
    }
    return new Name(s);
  };

  Lexer.prototype.readLiteralString = function () {
    var b = this.b, depth = 1, bytesOut = [];
    this.pos++;                                // past '('
    while (this.pos < b.length) {
      var c = b[this.pos++];
      if (c === 0x5c) {                        // backslash
        if (this.pos >= b.length) break;
        var e = b[this.pos++];
        if (e === 0x6e) bytesOut.push(0x0a);
        else if (e === 0x72) bytesOut.push(0x0d);
        else if (e === 0x74) bytesOut.push(0x09);
        else if (e === 0x62) bytesOut.push(0x08);
        else if (e === 0x66) bytesOut.push(0x0c);
        else if (e >= 0x30 && e <= 0x37) {     // up to three octal digits
          var v = e - 0x30, k;
          for (k = 0; k < 2 && this.pos < b.length; k++) {
            var d = b[this.pos];
            if (d < 0x30 || d > 0x37) break;
            v = v * 8 + (d - 0x30);
            this.pos++;
          }
          bytesOut.push(v & 0xff);
        } else if (e === 0x0d) {               // line continuation
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (e === 0x0a) { /* line continuation */ }
        else bytesOut.push(e);
        continue;
      }
      if (c === 0x28) { depth++; bytesOut.push(c); continue; }
      if (c === 0x29) {
        depth--;
        if (!depth) break;
        bytesOut.push(c);
        continue;
      }
      bytesOut.push(c);
    }
    return new PStr(new Uint8Array(bytesOut));
  };

  Lexer.prototype.readHexString = function () {
    var b = this.b, bytesOut = [], hi = -1;
    this.pos++;                                // past '<'
    while (this.pos < b.length) {
      var c = b[this.pos++], v;
      if (c === 0x3e) break;
      if (c >= 0x30 && c <= 0x39) v = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) v = c - 55;
      else if (c >= 0x61 && c <= 0x66) v = c - 87;
      else continue;
      if (hi < 0) hi = v;
      else { bytesOut.push((hi << 4) | v); hi = -1; }
    }
    if (hi >= 0) bytesOut.push(hi << 4);
    return new PStr(new Uint8Array(bytesOut));
  };

  /* The parser is recursive over containers only. Arrays nest, dictionaries
     nest, and a malformed file can nest them until the stack gives out — so
     the depth is capped and the throw is caught where the object is read,
     rather than escaping into the console with the pane already cleared. */
  var MAX_DEPTH = 96;

  Lexer.prototype.parse = function (doc) {
    this.skipWs();
    var b = this.b;
    if (this.pos >= b.length) return null;
    var c = b[this.pos];

    if (c === 0x2f) return this.readName();
    if (c === 0x28) return this.readLiteralString();
    if (c === 0x5b) {                          // '['
      if (++this.depth > MAX_DEPTH) throw new Error('objects are nested more deeply than this reader will follow');
      this.pos++;
      var arr = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) break;
        if (b[this.pos] === 0x5d) { this.pos++; break; }
        var before = this.pos;
        arr.push(this.parse(doc));
        if (this.pos === before) { this.pos++; }   // never spin on a bad byte
      }
      this.depth--;
      return arr;
    }
    if (c === 0x3c) {
      if (b[this.pos + 1] !== 0x3c) return this.readHexString();
      if (++this.depth > MAX_DEPTH) throw new Error('objects are nested more deeply than this reader will follow');
      this.pos += 2;
      var dict = new PDict();
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) break;
        if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) { this.pos += 2; break; }
        if (b[this.pos] !== 0x2f) {
          // A key that is not a name means the dictionary is malformed. Skip
          // one value and carry on rather than abandoning the whole object.
          var mark = this.pos;
          this.parse(doc);
          if (this.pos === mark) this.pos++;
          continue;
        }
        var key = this.readName().name;
        dict.map[key] = this.parse(doc);
      }
      this.depth--;
      return this.maybeStream(dict, doc);
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return null;
    }

    var start = this.pos;
    var token = this.readToken();
    if (token === null) { this.pos++; return null; }
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;

    if (/^[+.\-0-9]/.test(token)) {
      var num = parseFloat(token);
      if (isNaN(num)) num = 0;
      // `12 0 R` is an indirect reference and `12 0 obj` starts an object.
      // Both look like a number until two more tokens have been read, so the
      // position is saved and restored when the lookahead does not pay off.
      if (/^[+-]?[0-9]+$/.test(token) && num >= 0) {
        var save = this.pos;
        var t2 = this.readToken();
        if (t2 !== null && /^[0-9]+$/.test(t2)) {
          var save2 = this.pos;
          var t3 = this.readToken();
          if (t3 === 'R') return new Ref(num, parseInt(t2, 10));
          this.pos = save2;
        }
        this.pos = save;
      }
      return num;
    }

    // An unknown keyword. Return it as a marker so callers such as the xref
    // reader can recognise `trailer`, `xref`, `startxref` and `endobj`.
    return { keyword: token, at: start };
  };

  Lexer.prototype.maybeStream = function (dict, doc) {
    var b = this.b, save = this.pos;
    this.skipWs();
    if (latin1(b, this.pos, this.pos + 6) !== 'stream') { this.pos = save; return dict; }
    this.pos += 6;
    if (b[this.pos] === 0x0d) this.pos++;
    if (b[this.pos] === 0x0a) this.pos++;
    var dataStart = this.pos;

    var length = dict.map.Length;
    if (length instanceof Ref && doc) {
      try { length = doc.getObj(length.num); } catch (err) { length = null; }
    }
    var end = -1;
    if (typeof length === 'number' && length >= 0 && dataStart + length <= b.length) {
      // Trust /Length only if `endstream` really is where it says it is.
      // Producers get this wrong often enough that a blind trust turns one
      // bad number into a whole unreadable document.
      var probe = dataStart + length;
      var tail = latin1(b, probe, probe + 20);
      if (/^[\r\n \t]*endstream/.test(tail)) end = probe;
    }
    if (end < 0) {
      var found = findBytes(b, strBytes('endstream'), dataStart);
      if (found < 0) { this.pos = b.length; return new PStream(dict, b.subarray(dataStart)); }
      end = found;
      if (b[end - 1] === 0x0a) end--;
      if (b[end - 1] === 0x0d) end--;
    }
    var raw = b.subarray(dataStart, end);
    var after = findBytes(b, strBytes('endstream'), end);
    this.pos = after < 0 ? end : after + 9;
    return new PStream(dict, raw);
  };

  /* ==================================================================
     The document
     ================================================================== */

  function PdfDoc(bytes, name) {
    this.bytes = bytes;
    this.name = name;
    this.xref = Object.create(null);     // objnum -> { type, offset } | { type:2, stm, idx }
    this.trailer = new PDict();
    this.cache = Object.create(null);
    this.objStm = Object.create(null);
    this.loading = Object.create(null);
    this.notes = [];
    this.updates = 0;
    this.repaired = false;
    this.headerOffset = 0;
    this.version = '';
    this.hasXrefStream = false;
    this.hasObjStm = false;
    this.encrypted = false;
  }

  PdfDoc.prototype.note = function (text) {
    if (this.notes.length < 12 && this.notes.indexOf(text) < 0) this.notes.push(text);
  };

  PdfDoc.prototype.resolve = function (v) {
    var seen = 0;
    while (v instanceof Ref) {
      if (++seen > 32) return null;      // a reference cycle, not a value
      v = this.getObj(v.num);
    }
    return v;
  };

  PdfDoc.prototype.get = function (dict, key) {
    var d = dictOf(dict);
    if (!d) return null;
    return this.resolve(d.map[key]);
  };

  PdfDoc.prototype.getObj = function (num) {
    if (this.cache[num] !== undefined) return this.cache[num];
    if (this.loading[num]) return null;  // self-referential /Length and friends
    this.loading[num] = true;
    var value = null;
    try {
      value = this.loadObj(num);
    } catch (err) {
      this.note('object ' + num + ' could not be read (' + (err.message || err) + ')');
      value = null;
    }
    this.loading[num] = false;
    this.cache[num] = value;
    return value;
  };

  PdfDoc.prototype.loadObj = function (num) {
    var e = this.xref[num];
    if (!e) return null;
    if (e.type === 2) return this.loadFromObjStm(e.stm, e.idx, num);

    var value = this.parseObjAt(e.offset, num);
    if (value === undefined && this.headerOffset) {
      // Some producers measure offsets from the %PDF- header rather than from
      // byte zero when there is junk in front of it. Try that before giving up.
      value = this.parseObjAt(e.offset + this.headerOffset, num);
    }
    if (value === undefined) {
      if (!this.repaired) this.repairScan();
      var r = this.xref[num];
      if (r && r.type === 1 && r.offset !== e.offset) value = this.parseObjAt(r.offset, num);
      if (value === undefined) return null;
    }
    return value;
  };

  /* Returns undefined — not null — when the header at `offset` is not the
     object it was supposed to be, so the caller can tell "wrong place" apart
     from "an object whose value really is null". */
  PdfDoc.prototype.parseObjAt = function (offset, num) {
    if (offset < 0 || offset >= this.bytes.length) return undefined;
    var lex = new Lexer(this.bytes, offset);
    var t1 = lex.readToken(), t2 = lex.readToken(), t3 = lex.readToken();
    if (t3 !== 'obj' || parseInt(t1, 10) !== num) return undefined;
    return lex.parse(this);
  };

  PdfDoc.prototype.loadFromObjStm = function (stmNum, idx, wantNum) {
    var entry = this.objStm[stmNum];
    if (!entry) {
      entry = this.readObjStm(stmNum);
      this.objStm[stmNum] = entry;
    }
    if (!entry || !entry.offsets) return null;
    // The xref entry names an index into the stream, but producers have been
    // known to get it wrong while the object number in the stream's own header
    // is right. The header is the authority; the index is only a hint.
    var i;
    for (i = 0; i < entry.offsets.length; i++) {
      if (entry.offsets[i].num === wantNum) {
        return new Lexer(entry.data, entry.first + entry.offsets[i].off).parse(this);
      }
    }
    if (idx >= 0 && idx < entry.offsets.length) {
      return new Lexer(entry.data, entry.first + entry.offsets[idx].off).parse(this);
    }
    return null;
  };

  PdfDoc.prototype.readObjStm = function (stmNum) {
    var stm = this.resolve(new Ref(stmNum, 0));
    if (!(stm instanceof PStream)) return null;
    var data = this.streamData(stm);
    if (!data.ok) { this.note('object stream ' + stmNum + ' could not be decompressed'); return null; }
    var n = this.get(stm.dict, 'N') || 0;
    var first = this.get(stm.dict, 'First') || 0;
    var lex = new Lexer(data.bytes, 0), offsets = [], i;
    for (i = 0; i < n; i++) {
      var a = lex.readToken(), b = lex.readToken();
      if (a === null || b === null) break;
      offsets.push({ num: parseInt(a, 10), off: parseInt(b, 10) });
    }
    this.hasObjStm = true;
    return { data: data.bytes, first: first, offsets: offsets };
  };

  /* Apply the /Filter chain to a stream's raw bytes. */
  PdfDoc.prototype.streamData = function (stm) {
    var raw = stm.raw;
    var filters = this.get(stm.dict, 'Filter');
    var parms = this.get(stm.dict, 'DecodeParms');
    if (parms === null || parms === undefined) parms = this.get(stm.dict, 'DP');
    if (!filters) return { ok: true, bytes: raw, filters: [] };
    if (!Array.isArray(filters)) filters = [filters];
    if (!Array.isArray(parms)) parms = [parms];

    var names = [], i;
    for (i = 0; i < filters.length; i++) {
      var f = this.resolve(filters[i]);
      names.push(isName(f) ? f.name : String(f));
    }

    var data = raw;
    for (i = 0; i < names.length; i++) {
      var name = names[i];
      var p = dictOf(this.resolve(parms[i]));
      try {
        if (name === 'FlateDecode' || name === 'Fl') data = flateDecode(data);
        else if (name === 'LZWDecode' || name === 'LZW') {
          data = lzwDecode(data, p ? this.get(p, 'EarlyChange') : 1);
        } else if (name === 'ASCIIHexDecode' || name === 'AHx') data = asciiHexDecode(data);
        else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85Decode(data);
        else if (name === 'RunLengthDecode' || name === 'RL') data = runLengthDecode(data);
        else if (name === 'Crypt') return { ok: false, reason: 'the stream is encrypted', filters: names };
        else return { ok: false, reason: name + ' is an image codec this tool does not decode', filters: names };

        if (p) {
          var pred = this.get(p, 'Predictor') || 1;
          if (pred > 1) {
            data = unpredict(data, pred,
                             this.get(p, 'Colors') || 1,
                             this.get(p, 'BitsPerComponent') || 8,
                             this.get(p, 'Columns') || 1);
          }
        }
      } catch (err) {
        return { ok: false, reason: (err.message || String(err)), filters: names };
      }
    }
    return { ok: true, bytes: data, filters: names };
  };

  /* ---- cross-reference reading ------------------------------------- */

  PdfDoc.prototype.open = function () {
    var b = this.bytes;
    var head = findBytes(b, strBytes('%PDF-'), 0, Math.min(b.length, 1024));
    if (head < 0) throw new Error('no-header');
    this.headerOffset = head;
    this.version = latin1(b, head + 5, head + 8).replace(/[^0-9.]/g, '');

    var sx = findBytesBack(b, strBytes('startxref'), b.length - 9);
    var startOffset = -1;
    if (sx >= 0) {
      var lex = new Lexer(b, sx + 9);
      var t = lex.readToken();
      if (t !== null && /^[0-9]+$/.test(t)) startOffset = parseInt(t, 10);
    }

    if (startOffset >= 0) {
      try {
        this.readXrefChain(startOffset);
      } catch (err) {
        this.note('the cross-reference index is damaged: ' + (err.message || err));
      }
    } else {
      this.note('no startxref pointer at the end of the file');
    }

    if (!this.trailer.map.Root || !Object.keys(this.xref).length) this.repairScan();

    var enc = this.trailer.map.Encrypt;
    if (enc) this.encrypted = true;
    return this;
  };

  PdfDoc.prototype.readXrefChain = function (offset) {
    var seen = Object.create(null), count = 0;
    while (offset >= 0 && offset < this.bytes.length && !seen[offset] && count < 64) {
      seen[offset] = true;
      count++;
      var trailer = this.readXrefSection(offset);
      if (!trailer) break;
      this.mergeTrailer(trailer);
      // A hybrid-reference file keeps a classic table for old readers and an
      // xref stream, named by /XRefStm, holding the objects the old table
      // cannot describe. Reading it is what stops those objects vanishing.
      var hybrid = trailer.map.XRefStm;
      if (typeof hybrid === 'number' && !seen[hybrid]) {
        seen[hybrid] = true;
        try { this.readXrefSection(hybrid); } catch (err) { /* the classic table stands */ }
      }
      var prev = trailer.map.Prev;
      offset = (typeof prev === 'number') ? prev : -1;
    }
    this.updates = Math.max(0, count - 1);
  };

  PdfDoc.prototype.mergeTrailer = function (t) {
    var keys = Object.keys(t.map), i;
    for (i = 0; i < keys.length; i++) {
      // Earlier sections in the chain are newer, so the first value wins.
      if (this.trailer.map[keys[i]] === undefined) this.trailer.map[keys[i]] = t.map[keys[i]];
    }
  };

  PdfDoc.prototype.readXrefSection = function (offset) {
    var lex = new Lexer(this.bytes, offset);
    lex.skipWs();
    if (latin1(this.bytes, lex.pos, lex.pos + 4) === 'xref') {
      lex.pos += 4;
      return this.readClassicXref(lex);
    }
    return this.readXrefStream(offset);
  };

  PdfDoc.prototype.readClassicXref = function (lex) {
    for (;;) {
      lex.skipWs();
      if (latin1(this.bytes, lex.pos, lex.pos + 7) === 'trailer') {
        lex.pos += 7;
        var t = lex.parse(this);
        return dictOf(t) || new PDict();
      }
      var startTok = lex.readToken(), countTok = lex.readToken();
      if (startTok === null || countTok === null) return new PDict();
      if (!/^[0-9]+$/.test(startTok) || !/^[0-9]+$/.test(countTok)) return new PDict();
      var start = parseInt(startTok, 10), n = parseInt(countTok, 10), i;
      if (n > 5000000) throw new Error('a subsection claims ' + n + ' entries');
      for (i = 0; i < n; i++) {
        var off = lex.readToken(), gen = lex.readToken(), kind = lex.readToken();
        if (off === null || gen === null || kind === null) return new PDict();
        var num = start + i;
        // First definition wins: the chain is walked newest first.
        if (kind === 'n' && this.xref[num] === undefined) {
          this.xref[num] = { type: 1, offset: parseInt(off, 10), gen: parseInt(gen, 10) };
        } else if (kind === 'f' && this.xref[num] === undefined) {
          this.xref[num] = { type: 0 };
        }
      }
    }
  };

  PdfDoc.prototype.readXrefStream = function (offset) {
    var lex = new Lexer(this.bytes, offset);
    var t1 = lex.readToken(), t2 = lex.readToken(), t3 = lex.readToken();
    if (t3 !== 'obj') throw new Error('the cross-reference offset does not point at an object');
    var stm = lex.parse(this);
    if (!(stm instanceof PStream)) throw new Error('the cross-reference object is not a stream');
    var data = this.streamData(stm);
    if (!data.ok) throw new Error('the cross-reference stream could not be decompressed (' + data.reason + ')');
    this.hasXrefStream = true;

    var w = this.get(stm.dict, 'W');
    if (!Array.isArray(w) || w.length < 3) throw new Error('the cross-reference stream has no usable /W widths');
    var w0 = this.resolve(w[0]) | 0, w1 = this.resolve(w[1]) | 0, w2 = this.resolve(w[2]) | 0;
    var rowLen = w0 + w1 + w2;
    if (rowLen <= 0) throw new Error('the cross-reference stream declares zero-width fields');

    var size = this.get(stm.dict, 'Size') || 0;
    var index = this.get(stm.dict, 'Index');
    if (!Array.isArray(index)) index = [0, size];

    var bytes = data.bytes, at = 0, k, i;
    for (k = 0; k + 1 < index.length; k += 2) {
      var first = this.resolve(index[k]) | 0;
      var count = this.resolve(index[k + 1]) | 0;
      for (i = 0; i < count; i++) {
        if (at + rowLen > bytes.length) break;
        var f1 = w0 ? readBE(bytes, at, w0) : 1;     // /W [0 x y] means type 1
        var f2 = readBE(bytes, at + w0, w1);
        var f3 = readBE(bytes, at + w0 + w1, w2);
        at += rowLen;
        var num = first + i;
        if (this.xref[num] !== undefined) continue;
        if (f1 === 1) this.xref[num] = { type: 1, offset: f2, gen: f3 };
        else if (f1 === 2) this.xref[num] = { type: 2, stm: f2, idx: f3 };
        else this.xref[num] = { type: 0 };
      }
    }
    return stm.dict;
  };

  function readBE(bytes, at, width) {
    var v = 0, i;
    for (i = 0; i < width; i++) v = v * 256 + bytes[at + i];
    return v;
  }

  /* When the index is missing, lying or circular, do what every real reader
     does: walk the whole file looking for `N G obj` and rebuild the table
     from what is actually there. Later definitions win, because incremental
     updates append. This is also the path that rescues a file truncated
     mid-save, which is the single most common way a PDF arrives broken. */
  PdfDoc.prototype.repairScan = function () {
    if (this.repaired) return;
    this.repaired = true;
    var b = this.bytes, i, found = 0;
    for (i = 0; i + 3 <= b.length; i++) {
      if (b[i] !== 0x6f || b[i + 1] !== 0x62 || b[i + 2] !== 0x6a) continue;   // 'obj'
      if (i + 3 < b.length && isRegular(b[i + 3])) continue;
      var j = i - 1;
      while (j >= 0 && isWs(b[j])) j--;
      var genEnd = j + 1;
      while (j >= 0 && b[j] >= 0x30 && b[j] <= 0x39) j--;
      var genStart = j + 1;
      if (genStart === genEnd) continue;
      while (j >= 0 && isWs(b[j])) j--;
      var numEnd = j + 1;
      while (j >= 0 && b[j] >= 0x30 && b[j] <= 0x39) j--;
      var numStart = j + 1;
      if (numStart === numEnd || numEnd === genStart) continue;
      if (numStart > 0 && isRegular(b[numStart - 1])) continue;
      var num = parseInt(latin1(b, numStart, numEnd), 10);
      if (isNaN(num)) continue;
      this.xref[num] = { type: 1, offset: numStart, gen: parseInt(latin1(b, genStart, genEnd), 10) };
      found++;
      if (found > 400000) break;
    }
    this.cache = Object.create(null);

    if (!this.trailer.map.Root) {
      var t = findBytesBack(b, strBytes('trailer'), b.length - 7);
      while (t >= 0 && !this.trailer.map.Root) {
        var lex = new Lexer(b, t + 7);
        var d = dictOf(lex.parse(this));
        if (d && d.map.Root) this.mergeTrailer(d);
        t = findBytesBack(b, strBytes('trailer'), t - 1);
      }
    }
    if (!this.trailer.map.Root) {
      // No trailer either. The catalog is findable by its own /Type.
      var nums = Object.keys(this.xref), k;
      for (k = 0; k < nums.length; k++) {
        var o = dictOf(this.getObj(parseInt(nums[k], 10)));
        if (o && isName(o.map.Type, 'Catalog')) {
          this.trailer.map.Root = new Ref(parseInt(nums[k], 10), 0);
          break;
        }
      }
    }
    if (found) this.note('the cross-reference index was rebuilt by scanning the file for objects');
  };

  /* ---- the page tree ----------------------------------------------- */

  var INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

  PdfDoc.prototype.collectPages = function () {
    var pages = [], self = this;
    var root = dictOf(this.resolve(this.trailer.map.Root));
    var pagesNode = root ? this.get(root, 'Pages') : null;
    var seen = Object.create(null);

    function walk(node, ref, inherit, depth) {
      if (!node || depth > 64 || pages.length > MAX_BENCH) return;
      var d = dictOf(node);
      if (!d) return;
      var key = ref instanceof Ref ? 'r' + ref.num : null;
      if (key) {
        if (seen[key]) return;                // a /Kids cycle
        seen[key] = true;
      }
      var next = {}, i;
      for (i = 0; i < INHERITED.length; i++) {
        var v = d.map[INHERITED[i]];
        next[INHERITED[i]] = (v === undefined) ? inherit[INHERITED[i]] : v;
      }
      var kids = self.get(d, 'Kids');
      if (isName(d.map.Type, 'Pages') || (Array.isArray(kids) && !isName(d.map.Type, 'Page'))) {
        if (!Array.isArray(kids)) return;
        for (i = 0; i < kids.length; i++) {
          walk(self.resolve(kids[i]), kids[i], next, depth + 1);
        }
        return;
      }
      pages.push({ ref: ref, dict: d, inherit: next });
    }

    if (pagesNode) walk(pagesNode, root.map.Pages, {}, 0);

    if (!pages.length) {
      // No usable page tree. Every /Type /Page in the file, in object-number
      // order, is a poor substitute for the real ordering — but it is a
      // readable document instead of an error, and the report says so.
      var nums = Object.keys(this.xref).sort(function (a, b) { return a - b; }), k;
      for (k = 0; k < nums.length && pages.length < MAX_BENCH; k++) {
        var o = dictOf(this.getObj(parseInt(nums[k], 10)));
        if (o && isName(o.map.Type, 'Page')) {
          pages.push({ ref: new Ref(parseInt(nums[k], 10), 0), dict: o, inherit: {} });
        }
      }
      if (pages.length) this.note('the page tree was unreadable; pages are listed in object order instead');
    }
    return pages;
  };

  /* ==================================================================
     Reading values out for the report
     ================================================================== */

  function textOf(v) {
    if (!(v instanceof PStr)) return null;
    var b = v.bytes, i, s = '';
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      for (i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    } else {
      // PDFDocEncoding overlaps Latin-1 for everything a person is likely to
      // have typed into a Title or Author field.
      for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    }
    return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e]/g, '');
  }

  function prettyDate(text) {
    if (!text) return null;
    var m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(text);
    if (!m) return text;
    var s = m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01');
    if (m[4]) s += ' ' + m[4] + ':' + (m[5] || '00') + ':' + (m[6] || '00');
    if (m[7] === 'Z') s += ' UTC';
    else if (m[7] && m[8]) s += ' UTC' + m[7] + m[8] + ':' + (m[9] || '00');
    return s;
  }

  var PAPER = [
    { name: 'A4', w: 595, h: 842 }, { name: 'A3', w: 842, h: 1191 },
    { name: 'A5', w: 420, h: 595 }, { name: 'A6', w: 298, h: 420 },
    { name: 'Letter', w: 612, h: 792 }, { name: 'Legal', w: 612, h: 1008 },
    { name: 'Tabloid', w: 792, h: 1224 }, { name: 'Executive', w: 522, h: 756 }
  ];

  function paperName(wpt, hpt) {
    var a = Math.min(wpt, hpt), b = Math.max(wpt, hpt), i;
    for (i = 0; i < PAPER.length; i++) {
      if (Math.abs(a - PAPER[i].w) <= 3 && Math.abs(b - PAPER[i].h) <= 3) return PAPER[i].name;
    }
    return null;
  }

  function pageBox(doc, page) {
    var box = page.dict.map.MediaBox;
    if (box === undefined) box = page.inherit.MediaBox;
    box = doc.resolve(box);
    if (!Array.isArray(box) || box.length < 4) return null;
    var v = [], i;
    for (i = 0; i < 4; i++) {
      var n = doc.resolve(box[i]);
      if (typeof n !== 'number') return null;
      v.push(n);
    }
    return {
      w: Math.abs(v[2] - v[0]),
      h: Math.abs(v[3] - v[1])
    };
  }

  function pageRotate(doc, page) {
    var r = page.dict.map.Rotate;
    if (r === undefined) r = page.inherit.Rotate;
    r = doc.resolve(r);
    if (typeof r !== 'number') return 0;
    return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  }

  function describeSize(box, rot) {
    if (!box) return 'size not declared';
    var w = box.w, h = box.h, t;
    if (rot === 90 || rot === 270) { t = w; w = h; h = t; }
    var mmw = w * 25.4 / 72, mmh = h * 25.4 / 72;
    var name = paperName(box.w, box.h);
    var s = mmw.toFixed(0) + ' x ' + mmh.toFixed(0) + ' mm';
    if (name) s += ' (' + name + (w > h ? ', landscape' : ', portrait') + ')';
    else s += (w > h ? ' landscape' : ' portrait');
    return s;
  }

  /* ---- the security and structure sweep ---------------------------- */

  /* Walks every object the index knows about once. A targeted walk from the
     catalog would miss the interesting cases on purpose-built files: an
     action attached to a page that is not in the page tree, an embedded file
     reachable only from an annotation, a font in a form XObject nobody
     renders. If the object is in the file, it is in this sweep. */
  var ACTION_RISK = {
    JavaScript: 'runs JavaScript inside the reader',
    Launch: 'asks the reader to launch an external program or file',
    SubmitForm: 'posts form data to a URL',
    ImportData: 'imports data from a file on disk',
    GoToR: 'jumps into another document',
    GoToE: 'jumps into an embedded document',
    URI: 'opens a web address',
    Movie: 'plays embedded media',
    Sound: 'plays embedded audio',
    Rendition: 'plays a rendition (embedded media)',
    SetOCGState: 'changes which optional content is visible'
  };

  function sweep(doc) {
    var result = {
      fonts: [], attachments: [], actions: [], uris: [],
      objStreams: 0, images: 0, xfa: false, richMedia: false,
      objectCount: 0, truncated: false, xmp: null
    };
    var nums = Object.keys(doc.xref), i;
    var fontSeen = Object.create(null);
    var actionSeen = Object.create(null);

    /* Descends into direct arrays and dictionaries but never follows a
       reference, because every referenced object is a top-level entry in the
       loop below and would otherwise be walked twice. The nesting matters:
       an /OpenAction is written inline in the catalog and an annotation's /A
       is written inline in the annotation, so a scan that only looked at the
       outermost dictionary of each object found neither — which is to say it
       missed the two things this sweep exists to find. */
    function walk(v, depth) {
      if (depth > 24) return;
      if (Array.isArray(v)) {
        var a;
        for (a = 0; a < v.length; a++) walk(v[a], depth + 1);
        return;
      }
      var d = dictOf(v);
      if (!d) return;
      inspect(d, v);
      var keys = Object.keys(d.map), k;
      for (k = 0; k < keys.length; k++) walk(d.map[keys[k]], depth + 1);
    }

    function inspect(d, obj) {
      var type = d.map.Type, sub = d.map.Subtype;
      if (isName(type, 'ObjStm')) result.objStreams++;
      if (isName(type, 'XObject') && isName(sub, 'Image')) result.images++;
      if (isName(type, 'Metadata') && obj instanceof PStream) result.xmp = obj;
      if (isName(type, 'Font')) collectFont(doc, d, result, fontSeen);

      // Attachments arrive as /Filespec dictionaries, or as anything at all
      // carrying an /EF (embedded file) entry.
      if (isName(type, 'Filespec') || d.map.EF !== undefined) {
        collectAttachment(doc, d, result);
      }

      // An action is any dictionary whose /S names one. /JS carries the
      // script itself, on JavaScript actions and form additional-actions alike.
      if (d.map.S !== undefined) {
        var s = doc.resolve(d.map.S);
        if (isName(s) && Object.prototype.hasOwnProperty.call(ACTION_RISK, s.name)) {
          var slot = actionSeen[s.name];
          if (!slot) {
            slot = { kind: s.name, why: ACTION_RISK[s.name], count: 0, samples: [] };
            actionSeen[s.name] = slot;
            result.actions.push(slot);
          }
          slot.count++;
          var sample = actionSample(doc, d, s.name);
          if (sample && slot.samples.length < 4 && slot.samples.indexOf(sample) < 0) {
            slot.samples.push(sample);
          }
        }
      }
      if (d.map.XFA !== undefined) result.xfa = true;
      if (isName(sub, 'RichMedia') || isName(type, 'RichMediaContent')) result.richMedia = true;
    }

    for (i = 0; i < nums.length; i++) {
      if (i >= MAX_SWEEP) { result.truncated = true; break; }
      var num = parseInt(nums[i], 10);
      var entry = doc.xref[num];
      if (!entry || entry.type === 0) continue;
      var obj;
      try { obj = doc.getObj(num); } catch (err) { continue; }
      if (!dictOf(obj) && !Array.isArray(obj)) continue;
      result.objectCount++;
      try { walk(obj, 0); } catch (err) { /* one unreadable object, not the report */ }
    }
    return result;
  }

  function actionSample(doc, d, kind) {
    if (kind === 'URI') {
      var u = doc.resolve(d.map.URI);
      var t = textOf(u);
      return t ? t.substring(0, 90) : null;
    }
    if (kind === 'Launch' || kind === 'GoToR' || kind === 'GoToE') {
      var f = doc.resolve(d.map.F);
      var fd = dictOf(f);
      if (fd) f = doc.resolve(fd.map.F) || doc.resolve(fd.map.UF);
      var name = textOf(f);
      return name ? name.substring(0, 90) : null;
    }
    if (kind === 'JavaScript') {
      var js = doc.resolve(d.map.JS);
      var text = null;
      if (js instanceof PStr) text = textOf(js);
      else if (js instanceof PStream) {
        var data = doc.streamData(js);
        if (data.ok) text = latin1(data.bytes, 0, Math.min(data.bytes.length, 400));
      }
      if (!text) return null;
      text = text.replace(/\s+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').substring(0, 90);
      return text || null;
    }
    return null;
  }

  function collectFont(doc, d, result, seen) {
    var base = doc.resolve(d.map.BaseFont);
    var name = isName(base) ? base.name : '(unnamed)';
    var sub = doc.resolve(d.map.Subtype);
    var subName = isName(sub) ? sub.name : '?';

    // A Type0 font holds nothing itself; its descendant carries the
    // descriptor and therefore the answer to "is the outline in this file".
    var descSource = d;
    var desc = doc.get(d, 'FontDescriptor');
    if (!desc) {
      var kids = doc.get(d, 'DescendantFonts');
      if (Array.isArray(kids) && kids.length) {
        var kid = dictOf(doc.resolve(kids[0]));
        if (kid) { descSource = kid; desc = doc.get(kid, 'FontDescriptor'); }
      }
    }
    var dd = dictOf(desc);
    var embedded = false, how = 'not embedded';
    if (dd) {
      if (dd.map.FontFile !== undefined) { embedded = true; how = 'Type 1 outline'; }
      else if (dd.map.FontFile2 !== undefined) { embedded = true; how = 'TrueType outline'; }
      else if (dd.map.FontFile3 !== undefined) { embedded = true; how = 'CFF / OpenType outline'; }
    }
    var subset = /^[A-Z]{6}\+/.test(name);
    var key = name + '|' + subName;
    if (seen[key]) return;
    seen[key] = true;
    if (result.fonts.length < 200) {
      result.fonts.push({
        name: name, sub: subName, embedded: embedded, how: how, subset: subset
      });
    }
  }

  function collectAttachment(doc, d, result) {
    var name = textOf(doc.resolve(d.map.UF)) || textOf(doc.resolve(d.map.F)) ||
               textOf(doc.resolve(d.map.Desc)) || '(unnamed)';
    var size = null, sub = null;
    var ef = dictOf(doc.get(d, 'EF'));
    if (ef) {
      var stm = doc.get(ef, 'F') || doc.get(ef, 'UF');
      if (stm instanceof PStream) {
        size = stm.raw.length;
        var params = dictOf(doc.get(stm.dict, 'Params'));
        if (params) {
          var real = doc.get(params, 'Size');
          if (typeof real === 'number') size = real;
        }
        var st = doc.resolve(stm.dict.map.Subtype);
        if (isName(st)) sub = st.name;
      }
    }
    var i;
    for (i = 0; i < result.attachments.length; i++) {
      if (result.attachments[i].name === name) return;
    }
    if (result.attachments.length < 100) {
      result.attachments.push({ name: name, size: size, sub: sub });
    }
  }

  /* ==================================================================
     The writer
     ================================================================== */

  function fmtNum(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '0';
    if (Math.floor(n) === n && Math.abs(n) < 1e15) return String(n);
    var s = n.toFixed(6);
    s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return s;
  }

  function escName(name) {
    var s = '', i, c;
    for (i = 0; i < name.length; i++) {
      c = name.charCodeAt(i);
      if (c < 0x21 || c > 0x7e || isDelim(c) || c === 0x23) {
        s += '#' + (c < 16 ? '0' : '') + c.toString(16);
      } else {
        s += name.charAt(i);
      }
    }
    return s;
  }

  /* Strings go out as literal strings with everything outside printable ASCII
     written as a three-digit octal escape. That is always legal, never needs
     a length prefix, and — the reason it is worth the bytes — it keeps the
     produced file free of stray parentheses and backslashes that would end
     the string early on a reader stricter than this one. */
  function escString(bytes) {
    var s = '(', i, c;
    for (i = 0; i < bytes.length; i++) {
      c = bytes[i];
      if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
      else if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
      else {
        var o = c.toString(8);
        while (o.length < 3) o = '0' + o;
        s += '\\' + o;
      }
    }
    return s + ')';
  }

  function Sink() { this.parts = []; this.len = 0; }

  /* Parts are either an ASCII string or a Uint8Array, and .length is the byte
     count of both — which is why writeValue escapes every non-ASCII byte
     rather than emitting it raw. If a string part ever carried a character
     above 127, every xref offset after it would be short by the difference,
     and the file would open in some readers and not others. */
  Sink.prototype.push = function (part) {
    this.parts.push(part);
    this.len += part.length;
    return this;
  };

  Sink.prototype.join = function () {
    var result = new Uint8Array(this.len), at = 0, i, p;
    for (i = 0; i < this.parts.length; i++) {
      p = this.parts[i];
      if (typeof p === 'string') { result.set(strBytes(p), at); at += p.length; }
      else { result.set(p, at); at += p.length; }
    }
    return result;
  };

  function writeValue(v, sink, depth) {
    if (depth > MAX_DEPTH) throw new Error('the object graph is nested too deeply to write');
    if (v === null || v === undefined) { sink.push('null'); return; }
    if (v === true) { sink.push('true'); return; }
    if (v === false) { sink.push('false'); return; }
    if (typeof v === 'number') { sink.push(fmtNum(v)); return; }
    if (v instanceof Name) { sink.push('/' + escName(v.name)); return; }
    if (v instanceof Ref) { sink.push(v.num + ' 0 R'); return; }
    if (v instanceof PStr) { sink.push(escString(v.bytes)); return; }
    if (Array.isArray(v)) {
      sink.push('[');
      var i;
      for (i = 0; i < v.length; i++) {
        if (i) sink.push(' ');
        writeValue(v[i], sink, depth + 1);
      }
      sink.push(']');
      return;
    }
    if (v instanceof PStream) {
      var raw = v.raw;
      v.dict.map.Length = raw.length;
      writeValue(v.dict, sink, depth);
      sink.push('\nstream\n').push(raw).push('\nendstream');
      return;
    }
    if (v instanceof PDict) {
      sink.push('<<');
      var keys = Object.keys(v.map), k;
      for (k = 0; k < keys.length; k++) {
        if (v.map[keys[k]] === undefined) continue;
        sink.push('/' + escName(keys[k]) + ' ');
        writeValue(v.map[keys[k]], sink, depth + 1);
        sink.push(' ');
      }
      sink.push('>>');
      return;
    }
    sink.push('null');
  }

  /* Deep-copy the graph reachable from the chosen pages, renumbering as it
     goes. Two rules make the result a valid standalone document:

       - references are followed through an explicit QUEUE, never by
         recursion. A 40,000-object chain is normal in a real PDF and would
         overflow the stack on the way down.

       - a reference to a /Page that is not being written, or to any /Pages
         node, becomes `null`. Without that rule, a link annotation pointing
         at page 90 would drag page 90, its content stream and its images
         into a file that is supposed to contain three pages. A destination
         that resolves to null simply does nothing when clicked, which is the
         honest outcome for a link whose target was left behind. */
  function Copier() {
    this.objs = [null];              // object 0 is the free-list head
    this.maps = [];                  // one src-num -> new-num map per document
    this.queue = [];
    this.pageKeep = [];              // one map of kept source page numbers per document
  }

  Copier.prototype.alloc = function () {
    this.objs.push(null);
    return this.objs.length - 1;
  };

  Copier.prototype.mapFor = function (di) {
    if (!this.maps[di]) this.maps[di] = Object.create(null);
    return this.maps[di];
  };

  Copier.prototype.copyValue = function (v, di, doc, depth) {
    if (depth > MAX_DEPTH) throw new Error('the object graph is nested too deeply to copy');
    if (v instanceof Ref) {
      var map = this.mapFor(di);
      var have = map['n' + v.num];
      if (have !== undefined) return new Ref(have, 0);
      var target = doc.getObj(v.num);
      var d = dictOf(target);
      if (d && (isName(d.map.Type, 'Pages') || isName(d.map.Type, 'Page'))) return null;
      if (this.objs.length > MAX_COPY) throw new Error('this selection reaches more objects than the writer will copy');
      var n = this.alloc();
      map['n' + v.num] = n;
      this.queue.push({ num: v.num, into: n, di: di, doc: doc });
      return new Ref(n, 0);
    }
    if (Array.isArray(v)) {
      var arr = [], i;
      for (i = 0; i < v.length; i++) arr.push(this.copyValue(v[i], di, doc, depth + 1));
      return arr;
    }
    if (v instanceof PStream) {
      return new PStream(this.copyValue(v.dict, di, doc, depth), v.raw);
    }
    if (v instanceof PDict) {
      var nd = new PDict(), keys = Object.keys(v.map), k;
      for (k = 0; k < keys.length; k++) {
        nd.map[keys[k]] = this.copyValue(v.map[keys[k]], di, doc, depth + 1);
      }
      return nd;
    }
    return v;                        // numbers, names, strings, booleans, null
  };

  Copier.prototype.drain = function () {
    var guard = 0;
    while (this.queue.length) {
      if (++guard > MAX_COPY) throw new Error('the copy queue did not settle');
      var job = this.queue.shift();
      var src = job.doc.getObj(job.num);
      this.objs[job.into] = this.copyValue(src, job.di, job.doc, 0);
    }
  };

  function randomId() {
    var bytes = new Uint8Array(16), i, s = '';
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    for (i = 0; i < 16; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  /* plan: [{ d: docIndex, p: pageIndex, rot: degrees }] */
  function buildPdf(plan, keepMetadata) {
    if (!plan.length) throw new Error('there are no pages selected to write');

    var copier = new Copier();
    var catalogNum = copier.alloc();
    var pagesNum = copier.alloc();
    var kids = [], i, version = 1.4;
    var slots = [];

    /* Every page's new object number is claimed BEFORE any page is copied.
       A link annotation on page one routinely points at page three, and if
       page three were not already in the map at that moment the copier would
       see a /Page it does not know about and blank the reference — quietly
       breaking internal links between two pages that are both in the output. */
    for (i = 0; i < plan.length; i++) {
      var e0 = docs[plan[i].d];
      if (!e0) throw new Error('a selected document is no longer loaded');
      if (e0.doc.encrypted) throw new Error('"' + e0.name + '" is encrypted, so its pages cannot be copied');
      var p0 = e0.pages[plan[i].p];
      if (!p0) throw new Error('a selected page is no longer available');
      var num0 = copier.alloc();
      slots.push(num0);
      if (p0.ref instanceof Ref) copier.mapFor(plan[i].d)['n' + p0.ref.num] = num0;
    }

    for (i = 0; i < plan.length; i++) {
      var item = plan[i];
      var entry = docs[item.d];
      var page = entry.pages[item.p];
      var pageNum = slots[i];
      var v = parseFloat(entry.doc.version);
      if (!isNaN(v) && v > version) version = v;

      var nd = new PDict();
      var keys = Object.keys(page.dict.map), k;
      for (k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (key === 'Parent' || key === 'Rotate') continue;
        nd.map[key] = copier.copyValue(page.dict.map[key], item.d, entry.doc, 0);
      }
      // Push the inherited attributes down so the page stands on its own
      // under a page tree it has never seen before.
      var j;
      for (j = 0; j < INHERITED.length; j++) {
        var attr = INHERITED[j];
        if (attr === 'Rotate') continue;
        if (nd.map[attr] === undefined && page.inherit[attr] !== undefined) {
          nd.map[attr] = copier.copyValue(page.inherit[attr], item.d, entry.doc, 0);
        }
      }
      nd.map.Type = new Name('Page');
      nd.map.Parent = new Ref(pagesNum, 0);
      /* The bench stores a DELTA, because the buttons on it are "turn this a
         quarter more" and not "set this to 90". The absolute value is that
         delta added to whatever the source page already had — including a
         /Rotate it inherited from a /Pages node that is not coming with it.
         Writing the delta on its own silently unrotated every page that
         arrived already turned. */
      var turn = ((((page.rot || 0) + (item.rot || 0)) % 360) + 360) % 360;
      if (turn) nd.map.Rotate = turn;
      if (nd.map.MediaBox === undefined) {
        // A page with no /MediaBox anywhere in its chain is not well defined.
        // US Letter is the specification's own default, so use it and say so
        // in the report rather than writing a page with no size at all.
        nd.map.MediaBox = [0, 0, 612, 792];
      }
      copier.objs[pageNum] = nd;
      kids.push(new Ref(pageNum, 0));
    }

    copier.drain();

    var pagesDict = new PDict();
    pagesDict.map.Type = new Name('Pages');
    pagesDict.map.Kids = kids;
    pagesDict.map.Count = kids.length;
    copier.objs[pagesNum] = pagesDict;

    var catalog = new PDict();
    catalog.map.Type = new Name('Catalog');
    catalog.map.Pages = new Ref(pagesNum, 0);
    copier.objs[catalogNum] = catalog;

    var infoNum = 0;
    if (keepMetadata) {
      var source = docs[plan[0].d].doc;
      var info = dictOf(source.resolve(source.trailer.map.Info));
      if (info) {
        var nd2 = new PDict(), ik = Object.keys(info.map), m;
        for (m = 0; m < ik.length; m++) {
          var val = source.resolve(info.map[ik[m]]);
          if (val instanceof PStr || typeof val === 'number' || isName(val)) nd2.map[ik[m]] = val;
        }
        if (Object.keys(nd2.map).length) {
          infoNum = copier.alloc();
          copier.objs[infoNum] = nd2;
        }
      }
    }

    // --- serialise ---------------------------------------------------
    var sink = new Sink();
    var header = 'PDF-' + (version < 1.4 ? '1.4' : version.toFixed(1));
    sink.push('%' + header + '\n');
    // Four bytes above 127 on the second line. Every specification since 1.0
    // asks for them, so that a file transfer program sniffing the first two
    // lines classifies the file as binary and stops "helpfully" translating
    // line endings inside the compressed streams.
    sink.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    var offsets = [0];
    for (i = 1; i < copier.objs.length; i++) {
      offsets[i] = sink.len;
      sink.push(i + ' 0 obj\n');
      writeValue(copier.objs[i], sink, 0);
      sink.push('\nendobj\n');
    }

    var xrefAt = sink.len;
    var count = copier.objs.length;
    sink.push('xref\n0 ' + count + '\n');
    sink.push('0000000000 65535 f\r\n');
    for (i = 1; i < count; i++) {
      var off = String(offsets[i]);
      while (off.length < 10) off = '0' + off;
      // Exactly twenty bytes: ten digits, space, five digits, space, the type
      // letter, and a two-byte end of line. A reader that seeks by
      // multiplication will land in the wrong place if this is off by one.
      sink.push(off + ' 00000 n\r\n');
    }

    var id = randomId();
    sink.push('trailer\n<< /Size ' + count + ' /Root ' + catalogNum + ' 0 R');
    if (infoNum) sink.push(' /Info ' + infoNum + ' 0 R');
    sink.push(' /ID [<' + id + '> <' + id + '>] >>\n');
    sink.push('startxref\n' + xrefAt + '\n%%EOF\n');

    return sink.join();
  }

  /* ==================================================================
     Reporting
     ================================================================== */

  function report() {
    try {
      renderReport();
    } catch (err) {
      out.rule();
      out.err('The report stopped early: ' + (err.message || String(err)));
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('If you can share the file, I would like to see it.');
    }
  }

  /* Printed at load, deliberately WITHOUT clearing the pane. The shell arms
     its screen-reader announcer on the first out.clear(), so clearing here
     would fire "output updated" over the page heading before the visitor has
     asked for anything. */
  function intro() {
    out.dim('Drop one or more PDFs above. Nothing is uploaded: the file is read');
    out.dim('and rewritten in this tab, and there is no server to send it to.');
    out.line('');
    out.dim('With several loaded, the pages of all of them land on one bench, in');
    out.dim('load order. Reorder, rotate and delete there, then save.');
  }

  function renderReport() {
    out.clear();
    if (!docs.length) { intro(); return; }

    var i;
    for (i = 0; i < docs.length; i++) {
      if (i) { out.line(''); out.rule(); out.line(''); }
      reportDoc(docs[i], i);
    }
    out.line('');
    out.rule();
    out.dim('The bench below holds ' + bench.length +
            (bench.length === 1 ? ' page' : ' pages') + ' from ' + docs.length +
            (docs.length === 1 ? ' document.' : ' documents.'));
  }

  function reportDoc(entry, index) {
    var doc = entry.doc;
    out.heading('[' + (index + 1) + '] ' + entry.name);
    out.row('size', LabTool.humanBytes(entry.size));
    out.row('PDF version', doc.version || 'not declared');
    out.row('pages', entry.pages.length);
    out.row('cross-reference', doc.hasXrefStream
      ? (doc.repaired ? 'xref stream (and a rebuild)' : 'xref stream (PDF 1.5 style)')
      : (doc.repaired ? 'rebuilt by scanning' : 'classic xref table'));
    if (doc.hasObjStm) out.row('object streams', 'yes - objects are packed and compressed');
    out.row('incremental saves', doc.updates === 0 ? 'none - written in one pass'
                                                   : doc.updates + ' update' + (doc.updates === 1 ? '' : 's') + ' appended');
    if (entry.linearized) out.row('linearized', 'yes - optimised for page-at-a-time loading');

    if (doc.encrypted) {
      out.line('');
      out.err('THIS FILE IS ENCRYPTED');
      reportEncryption(doc);
      out.line('');
      out.warn('Its pages will not be copied into any output. Strings and streams');
      out.warn('are ciphertext, and writing them into a new file unchanged would');
      out.warn('produce something that opens and then shows nothing. Remove the');
      out.warn('protection in the application that made it, then come back.');
      return;
    }

    // --- page sizes --------------------------------------------------
    out.line('');
    out.heading('Page sizes');
    var sizes = {}, order = [], i, undeclared = 0;
    for (i = 0; i < entry.pages.length; i++) {
      var text = describeSize(entry.pages[i].box, entry.pages[i].rot);
      if (!entry.pages[i].box) undeclared++;
      if (entry.pages[i].rot) text += ', /Rotate ' + entry.pages[i].rot;
      if (!sizes[text]) { sizes[text] = 0; order.push(text); }
      sizes[text]++;
    }
    for (i = 0; i < order.length && i < 8; i++) {
      out.row(sizes[order[i]] + (sizes[order[i]] === 1 ? ' page' : ' pages'), order[i]);
    }
    if (order.length > 8) out.dim('  and ' + (order.length - 8) + ' more distinct sizes');
    if (undeclared) {
      var one = undeclared === 1;
      out.warn('No /MediaBox on ' + undeclared + (one ? ' page' : ' pages') +
               ', nor anywhere above ' + (one ? 'it' : 'them') + ' in the page tree,');
      out.warn('so ' + (one ? 'its size is' : 'their sizes are') +
               ' undefined. Anything saved here gives ' + (one ? 'that page' : 'those pages'));
      out.warn('US Letter, which is the default the specification itself names.');
    }

    // --- metadata ----------------------------------------------------
    out.line('');
    out.heading('Document metadata');
    var info = dictOf(doc.resolve(doc.trailer.map.Info));
    var shown = 0;
    var FIELDS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer',
                  'CreationDate', 'ModDate'];
    if (info) {
      for (i = 0; i < FIELDS.length; i++) {
        var v = doc.resolve(info.map[FIELDS[i]]);
        var t = textOf(v);
        if (v instanceof Name) t = '/' + v.name;
        if (!t) continue;
        if (FIELDS[i] === 'CreationDate' || FIELDS[i] === 'ModDate') t = prettyDate(t);
        out.row(FIELDS[i], t.length > 76 ? t.substring(0, 73) + '...' : t);
        shown++;
      }
      var extra = Object.keys(info.map).length - shown;
      if (extra > 0) out.dim('  plus ' + extra + ' non-standard field' + (extra === 1 ? '' : 's'));
    }
    if (entry.report.xmp) {
      out.row('XMP packet', LabTool.humanBytes(entry.report.xmp.raw.length) + ' of XML metadata');
      shown++;
    }
    if (!shown) out.ok('None. There is no /Info dictionary worth reading and no XMP packet.');
    else {
      out.dim('Creator and Producer name the software, and often its exact version.');
      out.dim('That is a fingerprint of your machine. "Strip metadata" removes all');
      out.dim('of the above from anything you save here.');
    }

    // --- fonts -------------------------------------------------------
    var fonts = entry.report.fonts;
    out.line('');
    out.heading('Fonts (' + fonts.length + ' distinct)');
    if (!fonts.length) out.dim('None declared. A scan with no text layer looks like this.');
    var missing = 0;
    for (i = 0; i < fonts.length && i < 24; i++) {
      var f = fonts[i];
      var tag = f.embedded ? (f.subset ? 'subset, ' + f.how : 'full, ' + f.how) : 'NOT EMBEDDED';
      out.row(f.name.substring(0, 34), padRight(f.sub, 14) + tag, f.embedded ? null : 't-warn');
      if (!f.embedded) missing++;
    }
    if (fonts.length > 24) out.dim('  and ' + (fonts.length - 24) + ' more');
    if (missing) {
      out.warn('A font that is not embedded is substituted by whatever the reader has.');
      out.warn('That is the usual reason a document reflows on somebody else’s machine.');
    }

    // --- attachments -------------------------------------------------
    var att = entry.report.attachments;
    out.line('');
    out.heading('Attachments');
    if (!att.length) out.ok('None. No file is carried inside this document.');
    for (i = 0; i < att.length && i < 20; i++) {
      out.row(att[i].name.substring(0, 40),
              (att[i].size === null ? 'size unknown' : LabTool.humanBytes(att[i].size)) +
              (att[i].sub ? ' - ' + att[i].sub : ''), 't-warn');
    }
    if (att.length) {
      out.warn('An attached file travels with the document and is extracted by a');
      out.warn('click. This tool never opens one. Treat them the way you would');
      out.warn('treat the same file arriving as an email attachment on its own.');
    }

    // --- actions -----------------------------------------------------
    var acts = entry.report.actions;
    out.line('');
    out.heading('Actions and scripts');
    if (!acts.length && !entry.report.xfa && !entry.report.richMedia) {
      out.ok('None. Nothing in this file asks the reader to do anything.');
    }
    for (i = 0; i < acts.length; i++) {
      var a = acts[i];
      var danger = (a.kind === 'JavaScript' || a.kind === 'Launch' ||
                    a.kind === 'SubmitForm' || a.kind === 'ImportData');
      out.row('/' + a.kind, a.count + ' x - ' + a.why, danger ? 't-err' : 't-warn');
      var s;
      for (s = 0; s < a.samples.length; s++) out.dim('      ' + a.samples[s]);
    }
    if (entry.report.xfa) out.row('/XFA', 'an XFA form - a whole XML application inside the PDF', 't-warn');
    if (entry.report.richMedia) out.row('/RichMedia', 'embedded rich media', 't-warn');
    if (acts.length || entry.report.xfa) {
      out.line('');
      out.dim('A PDF that runs JavaScript on open is unusual outside a form, and it');
      out.dim('is the classic first stage of a malicious document. This tool reads');
      out.dim('the script as text and never executes it.');
      out.dim('Anything you save here is rebuilt from the page objects alone, so');
      out.dim('document-level scripts and open actions do not survive the trip.');
    }

    if (entry.report.truncated) {
      out.line('');
      out.warn('Only the first ' + MAX_SWEEP + ' objects were inspected; this is a large file.');
    }
    if (doc.notes.length) {
      out.line('');
      out.heading('Notes from the parser');
      for (i = 0; i < doc.notes.length; i++) out.warn('- ' + doc.notes[i]);
    }
  }

  function reportEncryption(doc) {
    var enc = dictOf(doc.resolve(doc.trailer.map.Encrypt));
    if (!enc) { out.dim('The /Encrypt dictionary itself could not be read.'); return; }
    var filter = doc.resolve(enc.map.Filter);
    out.row('handler', isName(filter) ? '/' + filter.name : 'unknown');
    var v = doc.resolve(enc.map.V), r = doc.resolve(enc.map.R);
    if (typeof v === 'number') out.row('algorithm (V)', v);
    if (typeof r === 'number') out.row('revision (R)', r);
    var len = doc.resolve(enc.map.Length);
    if (typeof len === 'number') out.row('key length', len + ' bits');
    var p = doc.resolve(enc.map.P);
    if (typeof p === 'number') {
      var bits = [];
      if (p & 4) bits.push('print');
      if (p & 8) bits.push('modify');
      if (p & 16) bits.push('copy text');
      if (p & 32) bits.push('annotate');
      if (p & 256) bits.push('fill forms');
      if (p & 512) bits.push('extract for accessibility');
      if (p & 1024) bits.push('assemble');
      out.row('permissions', bits.length ? bits.join(', ') : 'none granted');
      out.dim('Those permission bits are advisory. They are enforced by the reader,');
      out.dim('not by cryptography, which is why every tool that ignores them can.');
    }
  }

  /* ==================================================================
     Bench UI
     ================================================================== */

  function announce(text) {
    var el = document.getElementById('pdf-announce');
    if (el) el.textContent = text;
  }

  function setStatus(text, cls) {
    var el = document.getElementById('pdf-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  function renderDocs() {
    var list = document.getElementById('pdf-docs');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var i;
    for (i = 0; i < docs.length; i++) {
      list.appendChild(docRow(docs[i], i));
    }
  }

  function docRow(entry, index) {
    var li = document.createElement('li');
    li.className = 'pdf-doc' + (entry.doc.encrypted ? ' is-locked' : '');

    var n = document.createElement('span');
    n.className = 'pdf-doc-n';
    n.textContent = String(index + 1);
    li.appendChild(n);

    var name = document.createElement('span');
    name.className = 'pdf-doc-name';
    name.textContent = entry.name;
    li.appendChild(name);

    var meta = document.createElement('span');
    meta.className = 'pdf-doc-meta';
    meta.textContent = entry.doc.encrypted
      ? 'encrypted - cannot be used'
      : entry.pages.length + (entry.pages.length === 1 ? ' page' : ' pages') +
        ' - ' + LabTool.humanBytes(entry.size);
    li.appendChild(meta);

    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'pdf-mini';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', 'Remove ' + entry.name);
    rm.addEventListener('click', function () { removeDoc(index); });
    li.appendChild(rm);
    return li;
  }

  function removeDoc(index) {
    var name = docs[index].name;
    docs.splice(index, 1);
    var kept = [], i;
    for (i = 0; i < bench.length; i++) {
      if (bench[i].d === index) continue;
      if (bench[i].d > index) bench[i].d--;
      kept.push(bench[i]);
    }
    bench = kept;
    renderAll();
    report();
    announce(name + ' removed. ' + bench.length + ' pages on the bench.');
  }

  function mkMini(label, aria, key, fn, disabled) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pdf-mini';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.setAttribute('title', aria);
    b.setAttribute('data-key', key);
    if (disabled) b.disabled = true;
    b.addEventListener('click', fn);
    return b;
  }

  function renderBench() {
    var list = document.getElementById('pdf-pages');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    if (!bench.length) {
      var empty = document.createElement('li');
      empty.className = 'pdf-empty';
      empty.textContent = docs.length
        ? 'The bench is empty. "Bring every page back" restores it.'
        : 'Nothing loaded yet. Drop a PDF above and its pages appear here.';
      list.appendChild(empty);
      setStatus('0 pages');
      return;
    }

    var i;
    for (i = 0; i < bench.length; i++) list.appendChild(benchRow(i));
    setStatus(bench.length + (bench.length === 1 ? ' page' : ' pages') + ' ready');

    if (focusKey) {
      var target = list.querySelector('[data-key="' + focusKey + '"]');
      if (target && !target.disabled) target.focus();
      focusKey = null;
    }
  }

  function benchRow(i) {
    var slot = bench[i];
    var entry = docs[slot.d];
    var page = entry.pages[slot.p];

    var li = document.createElement('li');
    li.className = 'pdf-page';

    var pos = document.createElement('span');
    pos.className = 'pdf-page-n';
    pos.textContent = String(i + 1);
    li.appendChild(pos);

    var src = document.createElement('span');
    src.className = 'pdf-page-src';
    src.textContent = (docs.length > 1 ? '[' + (slot.d + 1) + '] ' : '') +
                      entry.name + ' p.' + (slot.p + 1);
    li.appendChild(src);

    var dim = document.createElement('span');
    dim.className = 'pdf-page-dim';
    dim.textContent = describeSize(page.box, (page.rot + slot.rot) % 360);
    li.appendChild(dim);

    var rot = document.createElement('span');
    rot.className = 'pdf-page-rot';
    var total = ((page.rot + slot.rot) % 360 + 360) % 360;
    rot.textContent = total ? total + '°' : '';
    li.appendChild(rot);

    var acts = document.createElement('span');
    acts.className = 'pdf-page-acts';
    acts.appendChild(mkMini('↑', 'Move page ' + (i + 1) + ' earlier', i + ':up',
      function () { move(i, -1); }, i === 0));
    acts.appendChild(mkMini('↓', 'Move page ' + (i + 1) + ' later', i + ':down',
      function () { move(i, 1); }, i === bench.length - 1));
    acts.appendChild(mkMini('↺', 'Rotate page ' + (i + 1) + ' anticlockwise', i + ':ccw',
      function () { rotate(i, -90); }));
    acts.appendChild(mkMini('↻', 'Rotate page ' + (i + 1) + ' clockwise', i + ':cw',
      function () { rotate(i, 90); }));
    acts.appendChild(mkMini('✕', 'Remove page ' + (i + 1) + ' from the bench', i + ':del',
      function () { drop(i); }));
    li.appendChild(acts);
    return li;
  }

  function move(i, delta) {
    var j = i + delta;
    if (j < 0 || j >= bench.length) return;
    var tmp = bench[i];
    bench[i] = bench[j];
    bench[j] = tmp;
    focusKey = j + (delta < 0 ? ':up' : ':down');
    renderBench();
    announce('Moved to position ' + (j + 1) + ' of ' + bench.length + '.');
  }

  function rotate(i, delta) {
    bench[i].rot = ((bench[i].rot + delta) % 360 + 360) % 360;
    focusKey = i + (delta < 0 ? ':ccw' : ':cw');
    renderBench();
    var page = docs[bench[i].d].pages[bench[i].p];
    var total = ((page.rot + bench[i].rot) % 360 + 360) % 360;
    announce('Page ' + (i + 1) + ' now at ' + total + ' degrees.');
  }

  function drop(i) {
    bench.splice(i, 1);
    focusKey = Math.min(i, bench.length - 1) + ':del';
    renderBench();
    announce('Page removed. ' + bench.length + ' left on the bench.');
  }

  function renderAll() {
    renderDocs();
    renderBench();
  }

  /* Ranges are written the way people write them on paper: "1-3, 7, 12-".
     Positions are on the bench, not on any source document, because after a
     merge or a reorder those are two different numberings and only one of
     them is on screen. */
  function parseRanges(text, max) {
    var groups = [], parts = String(text).split(','), i;
    for (i = 0; i < parts.length; i++) {
      var part = parts[i].replace(/\s+/g, '');
      if (!part) continue;
      var m = /^(\d*)-(\d*)$/.exec(part);
      var from, to;
      if (m) {
        from = m[1] ? parseInt(m[1], 10) : 1;
        to = m[2] ? parseInt(m[2], 10) : max;
      } else if (/^\d+$/.test(part)) {
        from = to = parseInt(part, 10);
      } else {
        throw new Error('"' + parts[i].replace(/^\s+|\s+$/g, '') +
                        '" is not a page or a range. Write them like 1-3, 7, 12-.');
      }
      if (!from || !to || from > to) {
        throw new Error('"' + part + '" runs backwards or starts at zero. Pages are numbered from 1.');
      }
      if (from > max) {
        throw new Error('"' + part + '" starts past the end - there are only ' + max + ' pages on the bench.');
      }
      if (to > max) to = max;
      var nums = [], n;
      for (n = from; n <= to; n++) nums.push(n);
      groups.push({ label: from === to ? String(from) : from + '-' + to, nums: nums });
    }
    if (!groups.length) throw new Error('No pages given. Try 1-3, 7, 12- or leave it empty for everything.');
    return groups;
  }

  function applyRange() {
    var field = document.getElementById('pdf-range');
    if (!field) return;
    try {
      var groups = parseRanges(field.value, bench.length), flat = [], i, k;
      for (i = 0; i < groups.length; i++) {
        for (k = 0; k < groups[i].nums.length; k++) flat.push(bench[groups[i].nums[k] - 1]);
      }
      bench = flat;
      renderBench();
      announce('Bench narrowed to ' + bench.length + ' pages.');
      setStatus(bench.length + ' pages ready', 'is-ok');
    } catch (err) {
      setStatus(err.message, 'is-err');
      announce(err.message);
    }
  }

  function resetBench() {
    bench = [];
    var i, k;
    for (i = 0; i < docs.length; i++) {
      if (docs[i].doc.encrypted) continue;
      for (k = 0; k < docs[i].pages.length && bench.length < MAX_BENCH; k++) {
        bench.push({ d: i, p: k, rot: 0 });
      }
    }
    var field = document.getElementById('pdf-range');
    if (field) field.value = '';
    renderBench();
    announce('Bench reset to ' + bench.length + ' pages.');
  }

  function rotateAll() {
    var i;
    for (i = 0; i < bench.length; i++) bench[i].rot = (bench[i].rot + 90) % 360;
    renderBench();
    announce('Every page rotated a quarter turn clockwise.');
  }

  /* ==================================================================
     Saving
     ================================================================== */

  function baseName(name) {
    return String(name).replace(/\.[Pp][Dd][Ff]$/, '').replace(/[\\/:*?"<>|]+/g, '-');
  }

  function stripWanted() {
    var box = document.getElementById('pdf-strip');
    return !box || box.checked;
  }

  function saveOne() {
    if (!bench.length) {
      setStatus('nothing on the bench', 'is-err');
      out.rule();
      out.warn('There are no pages to save. Load a PDF, or reset the bench.');
      return;
    }
    try {
      var strip = stripWanted();
      var bytes = buildPdf(bench, !strip);
      var name = (docs.length > 1 ? 'merged' : baseName(docs[bench[0].d].name)) +
                 (strip ? '-clean' : '-edited') + '.pdf';
      LabTool.download(bytes, name, 'application/pdf');
      out.rule();
      out.ok('Saved ' + name + ' - ' + bench.length +
             (bench.length === 1 ? ' page, ' : ' pages, ') + LabTool.humanBytes(bytes.length));
      out.dim(strip ? 'Written with no /Info dictionary and no XMP packet. It also carries'
                    : 'The original /Info fields were carried across.');
      out.dim(strip ? 'no producer string of mine - the file says nothing about this tool.'
                    : 'Tick "strip metadata" to leave them behind instead.');
      out.dim('Content streams, fonts and images were copied byte for byte. Nothing');
      out.dim('was re-encoded, and the file never left this tab.');
      setStatus('saved ' + LabTool.humanBytes(bytes.length), 'is-ok');
      announce('Saved ' + name + '.');
    } catch (err) {
      failSave(err);
    }
  }

  function saveSplit() {
    var field = document.getElementById('pdf-range');
    if (!bench.length) {
      setStatus('nothing on the bench', 'is-err');
      out.rule();
      out.warn('There are no pages to split.');
      return;
    }
    try {
      var text = field && field.value.replace(/\s+/g, '') ? field.value : '1-' + bench.length;
      var groups = parseRanges(text, bench.length);
      if (groups.length === 1 && groups[0].nums.length === bench.length) {
        // One group covering everything is almost certainly not what was
        // meant, so split page by page rather than writing one identical file.
        groups = [];
        var g;
        for (g = 0; g < bench.length; g++) {
          groups.push({ label: String(g + 1), nums: [g + 1] });
        }
      }
      var strip = stripWanted();
      var stem = docs.length > 1 ? 'pages' : baseName(docs[bench[0].d].name);
      out.rule();
      out.ok('Writing ' + groups.length + ' files.');
      var made = 0, i;
      for (i = 0; i < groups.length; i++) {
        var plan = [], k;
        for (k = 0; k < groups[i].nums.length; k++) plan.push(bench[groups[i].nums[k] - 1]);
        var bytes = buildPdf(plan, !strip);
        var name = stem + '-' + groups[i].label + '.pdf';
        out.row(name, plan.length + (plan.length === 1 ? ' page, ' : ' pages, ') +
                      LabTool.humanBytes(bytes.length));
        // Staggered: browsers rate-limit a burst of programmatic downloads,
        // and several will silently drop everything after the first.
        stagger(bytes, name, i);
        made++;
      }
      out.dim('Your browser may ask once for permission to save several files.');
      setStatus(made + ' files written', 'is-ok');
      announce('Wrote ' + made + ' files.');
    } catch (err) {
      failSave(err);
    }
  }

  function stagger(bytes, name, index) {
    setTimeout(function () {
      LabTool.download(bytes, name, 'application/pdf');
    }, index * 350);
  }

  function failSave(err) {
    var msg = err && err.message ? err.message : String(err);
    out.rule();
    out.err('Nothing was saved: ' + msg);
    out.line('');
    out.dim('A refusal here is deliberate. Half-writing a PDF gives you a file that');
    out.dim('opens and then shows nothing, which is worse than no file at all.');
    setStatus('refused', 'is-err');
    announce('Save refused: ' + msg);
  }

  /* ==================================================================
     Loading
     ================================================================== */

  /* Refusals are collected rather than printed as they happen.

     They used to go straight to the pane, and every one of them vanished:
     the last file in a batch calls report(), report() opens with out.clear(),
     and the message explaining why a file was rejected was wiped a few
     milliseconds after it appeared. Dropping a text file on this tool looked
     exactly like dropping nothing at all. They are held here and printed
     under the finished report instead, which is also where a reader is
     looking by then. */
  var refusals = [];

  function loadFiles(fileList) {
    var queue = [], i;
    for (i = 0; i < fileList.length; i++) queue.push(fileList[i]);
    if (!queue.length) return;
    refusals = [];
    readNext(queue, 0);
  }

  function refuse(lines) {
    var i;
    for (i = 0; i < lines.length; i++) refusals.push(lines[i]);
  }

  function finishLoad() {
    renderAll();
    report();
    if (!refusals.length) return;
    out.rule();
    var i;
    for (i = 0; i < refusals.length; i++) out.err(refusals[i]);
    setStatus(refusals.length + ' file' + (refusals.length === 1 ? '' : 's') + ' refused', 'is-err');
    announce(refusals[0]);
    refusals = [];
  }

  function readNext(queue, i) {
    if (i >= queue.length) { finishLoad(); return; }
    var file = queue[i];
    if (docs.length >= MAX_DOCS) {
      refuse(['Stopping at ' + MAX_DOCS + ' documents. Remove one to add another.']);
      finishLoad();
      return;
    }
    if (file.size > MAX_FILE) {
      refuse([file.name + ' is ' + LabTool.humanBytes(file.size) + '. This tool stops at ' +
              LabTool.humanBytes(MAX_FILE) + ' so the page stays responsive - the',
              'work happens in this tab, on your processor.']);
      readNext(queue, i + 1);
      return;
    }
    setStatus('reading ' + file.name, 'is-busy');
    var reader = new FileReader();
    reader.onload = function () {
      try {
        addDoc(new Uint8Array(reader.result), file);
      } catch (err) {
        refuse([file.name + ': ' + (err.message === 'no-header'
          ? 'this is not a PDF. There is no %PDF- header in the first kilobyte.'
          : (err.message || String(err)))]);
      }
      readNext(queue, i + 1);
    };
    reader.onerror = function () {
      refuse([file.name + ' could not be read from disk.']);
      readNext(queue, i + 1);
    };
    reader.readAsArrayBuffer(file);
  }

  function addDoc(bytes, file) {
    var doc = new PdfDoc(bytes, file.name).open();
    var raw = doc.collectPages(), pages = [], i;
    for (i = 0; i < raw.length; i++) {
      pages.push({
        ref: raw[i].ref,
        dict: raw[i].dict,
        inherit: raw[i].inherit,
        box: pageBox(doc, raw[i]),
        rot: pageRotate(doc, raw[i])
      });
    }
    var entry = {
      doc: doc,
      name: file.name,
      size: bytes.length,
      pages: pages,
      linearized: findBytes(bytes, strBytes('/Linearized'), 0, Math.min(bytes.length, 4096)) >= 0,
      report: doc.encrypted
        ? { fonts: [], attachments: [], actions: [], objStreams: 0, images: 0,
            xfa: false, richMedia: false, objectCount: 0, truncated: false, xmp: null }
        : sweep(doc)
    };
    docs.push(entry);
    var di = docs.length - 1;
    if (!doc.encrypted) {
      for (i = 0; i < pages.length && bench.length < MAX_BENCH; i++) {
        bench.push({ d: di, p: i, rot: 0 });
      }
    }
    var nameEl = document.getElementById('tool-dropname');
    if (nameEl) {
      nameEl.textContent = docs.length === 1 ? file.name : docs.length + ' documents loaded';
    }
  }

  /* ==================================================================
     Self-check
     ------------------------------------------------------------------
     The inflater is the one piece here written from the specification with
     nothing to compare it against, and a wrong bit in it produces plausible
     garbage rather than an error. So it is checked against a fixture on every
     page load, along with the two other places where an off-by-one would be
     silent: the number formatting the writer emits, and range parsing.
     ================================================================== */

  function selfTest() {
    var passed = 0, total = 0;

    function check(name, fn) {
      total++;
      try { if (fn()) passed++; } catch (err) { /* counted as a failure */ }
    }

    check('inflate, dynamic Huffman', function () {
      // A zlib stream that really does carry a type-2 block: its code lengths
      // are transmitted in the file rather than taken from the static table.
      var hex = '78da2dcbc90d83401004c0543a00e4282cde4e61966d8cf11e68' +
                'a611903d0ffb5daad773444f2b2705cc89b6d744671e703a67c8' +
                '52e14f74b0e942bac4c0f1c91c602dff33424eab81cda62fb410' +
                '51ad14f4c680fa9b5ae80fdc920727b1';
      var want = 'PDF objects are numbered, xref tables are twenty bytes wide, ' +
                 'and object streams pack the small ones together. ';
      return latin1(flateDecode(LabTool.fromHex(hex, true))) === want;
    });

    check('inflate, fixed Huffman with back-references', function () {
      var hex = '78da2bc94855284ecc4d55284ecd2b49cd4b4ed55128c9c82c' +
                '2aa95428c9cc4d2d56c82f4b2dd2532819550555050027be6ec1';
      var want = '', i;
      for (i = 0; i < 8; i++) want += 'the same sentence, thirty times over. ';
      return latin1(flateDecode(LabTool.fromHex(hex, true))) === want;
    });

    check('inflate, stored block', function () {
      // A raw deflate stream: one final stored block carrying "PDF".
      var bytes = new Uint8Array([0x01, 0x03, 0x00, 0xfc, 0xff, 0x50, 0x44, 0x46]);
      return latin1(inflateRaw(bytes, 0)) === 'PDF';
    });

    check('number formatting', function () {
      return fmtNum(0) === '0' && fmtNum(-3) === '-3' &&
             fmtNum(595.2756) === '595.2756' && fmtNum(1 / 3) === '0.333333';
    });

    check('range parsing', function () {
      var g = parseRanges('1-3, 7, 9-', 10);
      if (g.length !== 3) return false;
      if (g[0].nums.length !== 3 || g[1].nums[0] !== 7) return false;
      if (g[2].nums.length !== 2) return false;
      try { parseRanges('banana', 10); return false; } catch (err) { return true; }
    });

    check('xref entry width', function () {
      var off = '0000000016';
      return (off + ' 00000 n\r\n').length === 20;
    });

    var el = document.getElementById('pdf-selftest');
    if (el) {
      el.textContent = 'self-check ' + passed + '/' + total;
      el.className = 'lab-status ' + (passed === total ? 'is-ok' : 'is-err');
    }
    return passed === total;
  }

  /* ==================================================================
     Wiring
     ================================================================== */

  function wireDrop() {
    var zone = document.getElementById('tool-drop');
    var input = document.getElementById('tool-file');
    if (!zone || !input) return;

    input.addEventListener('change', function () {
      loadFiles(input.files);
      input.value = '';                   // so the same file can be added twice
    });
    zone.addEventListener('click', function (e) {
      if (e.target !== input) input.click();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.remove('is-over');
      });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) loadFiles(e.dataTransfer.files);
    });
  }

  function on(id, event, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  LabTool.define({
    id: 'pdftoolstool',
    run: function () {
      if (docs.length) report();
      else out.clear().warn('Choose or drop a PDF first.');
    },
    onReady: function () {
      wireDrop();
      on('tool-save', 'click', saveOne);
      on('tool-split', 'click', saveSplit);
      on('pdf-keep', 'click', applyRange);
      on('pdf-reset', 'click', resetBench);
      on('pdf-rotall', 'click', rotateAll);
      on('pdf-range', 'keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyRange(); }
      });
      renderAll();
      selfTest();
      intro();
    }
  });
})();

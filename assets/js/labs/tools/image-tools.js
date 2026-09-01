/* ==========================================================================
   image-tools.js — compress, convert and resize pictures without uploading them
   --------------------------------------------------------------------------
   Every "free online image compressor" works the same way: you hand a stranger
   your photograph, their server re-encodes it, and you download the result.
   The picture — your children, your passport scan, your client's floor plan —
   is on somebody else's disk before the progress bar finishes. That is the
   entire reason this file exists. A browser has had a competent image encoder
   built into `canvas.toBlob` for over a decade, so the upload was never
   necessary; it is a business model, not a technical requirement.

   Four things in here are less obvious than they look, and each has a comment
   at the point it happens:

   - Encoder support is probed, not assumed. WebP and AVIF encoding are per
     browser and per build, and `toBlob` fails by silently handing back a PNG
     rather than by throwing. The probe below catches that, and the format
     menu says which encoders THIS browser actually has.
   - Orientation is resolved from the file's own bytes, not trusted to the
     decoder. A canvas has nowhere to keep an EXIF orientation tag, so a photo
     that was upright only because of that tag comes out of a naive resizer
     lying on its side.
   - "Keep metadata" is a real splice of the original APP1 segment back into
     the encoded JPEG, because a canvas cannot carry metadata through. It is
     offered second and off by default: the safe thing to do with a photo's
     GPS coordinates is drop them.
   - The ZIP is written here, byte by byte, store-only. Pulling in a
     compression library to wrap files that are already compressed would add
     a megabyte of download to save nothing.

   Nothing in this file makes a network request. There is no fetch, no XHR and
   no worker fetching anything: the only reads are of files the visitor chose.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_FILE = 60 * 1024 * 1024;
  var MAX_FILES = 40;

  /* Only the head of each file is read as bytes. Everything this module needs
     from the raw file — the magic number, the SOF that says baseline or
     progressive and gives the stored raster size, and the APP1 Exif segment —
     lives in the first few dozen kilobytes of a JPEG. Decoding goes through
     the browser from the File itself, so there is no reason to pull 60 MB into
     a Uint8Array to find out that byte 3 is 0xe0. */
  var HEAD_BYTES = 512 * 1024;

  var out = LabTool.out('tool-out');

  var items = [];        /* one entry per accepted file */
  var selected = -1;
  var busy = false;
  var seq = 0;           /* guards preview draws against a stale async decode */

  var FORMATS = [
    { type: 'image/jpeg', label: 'JPEG', ext: '.jpg', lossy: true },
    { type: 'image/png', label: 'PNG', ext: '.png', lossy: false },
    { type: 'image/webp', label: 'WebP', ext: '.webp', lossy: true },
    { type: 'image/avif', label: 'AVIF', ext: '.avif', lossy: true }
  ];

  function el(id) { return document.getElementById(id); }

  function pct(n) { return n.toFixed(1) + '%'; }

  /* Blob.arrayBuffer is recent enough that a browser old enough to run this
     page without it is plausible, and a batch tool that fails on the last step
     after doing all the work would be a poor way to find out. */
  function blobBytes(blob, ok, fail) {
    if (blob.arrayBuffer) {
      blob.arrayBuffer().then(function (buf) { ok(new Uint8Array(buf)); }, fail);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { ok(new Uint8Array(reader.result)); };
    reader.onerror = fail;
    reader.readAsArrayBuffer(blob);
  }

  /* ------------------------------------------------------------------------
     Encoder detection.

     canvas.toBlob does not report an unsupported type. It falls back to PNG
     and returns a perfectly valid Blob, so a browser with no AVIF encoder
     hands back a PNG with an .avif name — bigger than the original, in the
     wrong format, with nothing anywhere saying so. toDataURL has the same
     fallback but is synchronous, so it can answer the question at page load
     on a 2x2 scratch canvas, which costs nothing.
     ------------------------------------------------------------------------ */
  function probeEncoder(type) {
    var c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    if (!c.toDataURL) return false;
    try {
      return c.toDataURL(type).indexOf('data:' + type) === 0;
    } catch (err) {
      return false;
    }
  }

  var supported = {};

  function formatFor(type) {
    for (var i = 0; i < FORMATS.length; i++) {
      if (FORMATS[i].type === type) return FORMATS[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------------
     What kind of file is this, really.

     File.type is a hint the operating system derives from the filename, so a
     .jpg that is actually a PNG is a hint that lies. The magic bytes are what
     the decoder will see, so they decide.
     ------------------------------------------------------------------------ */
  function sniff(b) {
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b.length > 12 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    if (b.length > 4 && b[0] === 0x3c && (b[1] === 0x3f || b[1] === 0x73)) return 'image/svg+xml';
    if (b.length > 16 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b.length > 16 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      var brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      if (brand.indexOf('hei') === 0 || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    }
    return '';
  }

  /* ------------------------------------------------------------------------
     A minimal JPEG marker walk.

     It answers three questions in one pass: is this progressive, what raster
     size is stored in the file, and where is the Exif APP1 segment. The stored
     size matters more than it sounds — it is how the orientation check below
     works out whether the decoder already rotated the pixels.
     ------------------------------------------------------------------------ */
  function scanJpeg(bytes) {
    var info = {
      jpeg: false, progressive: false, width: 0, height: 0,
      exifStart: -1, exifEnd: -1, orientation: 1, truncated: false
    };
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return info;
    info.jpeg = true;

    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p] !== 0xff) { info.truncated = true; break; }
      var marker = bytes[p + 1];
      /* Standalone markers carry no length word. */
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;   /* end of image, or start of scan */

      var size = dv.getUint16(p + 2, false);
      /* A size below 2 is nonsense and would loop for ever; a size past the
         end of the slice means the answer is simply not in the head we read. */
      if (size < 2 || p + 2 + size > bytes.length) { info.truncated = true; break; }

      /* SOFn: 0xc0-0xcf except the three that are not frame headers —
         0xc4 (Huffman tables), 0xc8 (reserved) and 0xcc (arithmetic tables). */
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        info.progressive = (marker === 0xc2 || marker === 0xc6 || marker === 0xca);
        info.height = dv.getUint16(p + 5, false);
        info.width = dv.getUint16(p + 7, false);
      }
      if (marker === 0xe1 && info.exifStart < 0 && p + 10 <= bytes.length) {
        var tag = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        /* An editor's XMP block is also APP1 and routinely sits ahead of the
           camera's Exif block, so this keeps walking rather than stopping at
           the first APP1 it meets. */
        if (tag === 'Exif') {
          info.exifStart = p;
          info.exifEnd = p + 2 + size;
          info.orientation = readOrientation(dv, p + 10);
        }
      }
      p += 2 + size;
    }
    return info;
  }

  function readOrientation(dv, base) {
    try {
      if (base < 0 || base + 8 > dv.byteLength) return 1;
      var little = dv.getUint16(base, false) === 0x4949;
      if (dv.getUint16(base + 2, little) !== 42) return 1;
      var dir = base + dv.getUint32(base + 4, little);
      if (dir < 0 || dir + 2 > dv.byteLength) return 1;
      var count = dv.getUint16(dir, little);
      for (var i = 0; i < count; i++) {
        var entry = dir + 2 + i * 12;
        if (entry + 12 > dv.byteLength) break;
        if (dv.getUint16(entry, little) === 0x0112) {
          var v = dv.getUint16(entry + 8, little);
          return (v >= 1 && v <= 8) ? v : 1;
        }
      }
    } catch (err) { /* a malformed TIFF header means no orientation, not a crash */ }
    return 1;
  }

  /* Rewrite the Orientation tag in a copied APP1 segment to 1.

     This only runs on the "keep metadata" path, and it is not optional there.
     The pixels coming out of the canvas are already upright — either the
     decoder rotated them or this module did — so carrying the original tag
     through would tell every future viewer to rotate an already-rotated
     picture, and the file would open sideways in exactly the apps that honour
     metadata properly. */
  function neutraliseOrientation(seg) {
    try {
      var dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
      var base = 10;                    /* 0xffe1, length, "Exif\0\0" */
      if (base + 8 > dv.byteLength) return;
      var little = dv.getUint16(base, false) === 0x4949;
      if (dv.getUint16(base + 2, little) !== 42) return;
      var dir = base + dv.getUint32(base + 4, little);
      if (dir + 2 > dv.byteLength) return;
      var count = dv.getUint16(dir, little);
      for (var i = 0; i < count; i++) {
        var entry = dir + 2 + i * 12;
        if (entry + 12 > dv.byteLength) break;
        if (dv.getUint16(entry, little) === 0x0112) {
          dv.setUint16(entry + 8, 1, little);
          return;
        }
      }
    } catch (err) { /* leave the segment alone rather than half-patch it */ }
  }

  /* Splice an APP1 segment straight after the SOI of an encoded JPEG. A JPEG
     accepts application segments in any order before the first scan, so this
     is a legal file and every decoder reads it. */
  function withExif(jpeg, seg) {
    if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
    var merged = new Uint8Array(jpeg.length + seg.length);
    merged[0] = 0xff;
    merged[1] = 0xd8;
    merged.set(seg, 2);
    merged.set(jpeg.subarray(2), 2 + seg.length);
    return merged;
  }

  /* ------------------------------------------------------------------------
     Decoding, with the orientation question settled honestly.

     Current browsers apply an EXIF orientation tag when they decode an image,
     and report the rotated dimensions. Not all of them do, not on every code
     path, and getting it wrong is not subtle — the picture comes out on its
     side. So rather than assume either way, compare what came back against the
     raster size stored in the file: if the file says 4032x3024 and the tag
     says "rotate 90", a decoder that honoured the tag hands back 3024x4032. If
     it hands back 4032x3024, it did not, and this module rotates instead.
     ------------------------------------------------------------------------ */
  function decodeImage(file, onOk, onFail) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      onOk(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      onFail();
    };
    img.src = url;
  }

  function resolveOrientation(item, decW, decH) {
    var o = item.scan.orientation;
    item.rotate = 1;
    if (o >= 5 && o <= 8) {
      /* Only the four quarter-turn orientations swap the dimensions, which is
         what makes this test possible at all. For 2, 3 and 4 (the mirrors and
         the 180) the dimensions are identical either way, so there is nothing
         to compare — those are left to the decoder, which handles them
         universally and where a wrong guess would flip a picture that is
         already correct. */
      /* ...and a SQUARE raster swaps into itself, so the comparison above is
         true whether the decoder rotated or not. Without the inequality a
         square photo shot in portrait got the quarter-turn applied twice and
         came out 90 degrees wrong. Squares fall through to rotate = 1 with
         2, 3 and 4, for the same reason: let the decoder own it. */
      if (item.scan.width && item.scan.width !== item.scan.height &&
          decW === item.scan.width && decH === item.scan.height) {
        item.rotate = o;
      }
    }
    if (item.rotate >= 5) { item.ow = decH; item.oh = decW; }
    else { item.ow = decW; item.oh = decH; }
    item.decW = decW;
    item.decH = decH;
  }

  /* Draw with the transform that orientation N describes. The canvas is
     already the oriented size, so the quarter-turn cases draw into a source
     rectangle with width and height swapped. */
  function drawOriented(ctx, img, o, w, h) {
    var half = Math.PI / 2;
    ctx.save();
    if (o === 2) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    else if (o === 3) { ctx.translate(w, h); ctx.rotate(Math.PI); }
    else if (o === 4) { ctx.translate(0, h); ctx.scale(1, -1); }
    else if (o === 5) { ctx.rotate(half); ctx.scale(1, -1); }
    else if (o === 6) { ctx.translate(w, 0); ctx.rotate(half); }
    else if (o === 7) { ctx.translate(w, h); ctx.rotate(half); ctx.scale(-1, 1); }
    else if (o === 8) { ctx.translate(0, h); ctx.rotate(-half); }
    if (o >= 5) ctx.drawImage(img, 0, 0, h, w);
    else ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  }

  /* ------------------------------------------------------------------------
     Canvas limits.

     Every browser caps both the largest dimension and the total pixel area of
     a canvas, and the failure is silent: the canvas allocates, drawing does
     nothing, and toBlob returns a blank image. So the corner pixel is written
     and read back before any real work happens. A canvas that cannot hold one
     white pixel is not going to hold a photograph.
     ------------------------------------------------------------------------ */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    if (c.width !== w || c.height !== h) return null;
    var ctx = c.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(w - 1, h - 1, 1, 1);
      var probe = ctx.getImageData(w - 1, h - 1, 1, 1).data;
      if (probe[3] === 0) return null;
    } catch (err) {
      return null;
    }
    ctx.clearRect(0, 0, w, h);
    return c;
  }

  /* Only ever called once a real allocation has already failed, and it bisects
     a SCALE of the size that failed rather than searching absolute dimensions.
     That matters: an absolute search would happily ask for a 16384 x 16384
     canvas — a gigabyte — while looking for the ceiling, which is a rough way
     to treat a machine that has just run out of room. Every probe here is
     smaller than the allocation that already failed. */
  function largestThatFits(w, h) {
    var lo = 0, hi = 1;
    for (var i = 0; i < 7; i++) {
      var mid = (lo + hi) / 2;
      if (makeCanvas(Math.max(1, Math.round(w * mid)), Math.max(1, Math.round(h * mid)))) lo = mid;
      else hi = mid;
    }
    return { w: Math.round(w * lo), h: Math.round(h * lo) };
  }

  /* ------------------------------------------------------------------------
     Store-only ZIP writer.

     JPEG, WebP, PNG and AVIF payloads are already entropy-coded, so deflate
     buys somewhere between nothing and half a percent on them. Method 0
     (stored) is a legal ZIP that every unarchiver on every platform opens, and
     writing it needs three record types and a CRC — about eighty lines,
     against roughly a megabyte for a deflate implementation that would make
     the archive no smaller.
     ------------------------------------------------------------------------ */
  var CRC_TABLE = null;

  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    return t;
  }

  function crc32(bytes) {
    var t = crcTable();
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* TextEncoder is not reachable in every context this page has to survive, and
     the encoding is fourteen lines, so it is written out rather than guarded. */
  function utf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                   0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(bytes);
  }

  function dosStamp(d) {
    var y = d.getFullYear();
    if (y < 1980) y = 1980;             /* the epoch the format starts at */
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
      date: (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
    };
  }

  function buildZip(entries) {
    var recs = [];
    var localSize = 0;
    var centralSize = 0;
    var i;
    for (i = 0; i < entries.length; i++) {
      var name = utf8Bytes(entries[i].name);
      var data = entries[i].bytes;
      recs.push({ name: name, data: data, crc: crc32(data), offset: 0 });
      localSize += 30 + name.length + data.length;
      centralSize += 46 + name.length;
    }
    var total = localSize + centralSize + 22;
    /* Past 4 GB, or past 65535 members, the format needs ZIP64 records this
       writer does not emit. The per-file and per-batch caps make it
       unreachable, which is exactly why it is worth refusing rather than
       writing an archive that opens as garbage. */
    if (total > 0xfffffffe || recs.length > 0xfffe) return null;

    var buf = new Uint8Array(total);
    var dv = new DataView(buf.buffer);
    var stamp = dosStamp(new Date());
    var p = 0;

    for (i = 0; i < recs.length; i++) {
      var r = recs[i];
      r.offset = p;
      dv.setUint32(p, 0x04034b50, true);
      dv.setUint16(p + 4, 20, true);           /* version needed: 2.0 */
      dv.setUint16(p + 6, 0x0800, true);       /* bit 11: the name is UTF-8 */
      dv.setUint16(p + 8, 0, true);            /* method 0: stored */
      dv.setUint16(p + 10, stamp.time, true);
      dv.setUint16(p + 12, stamp.date, true);
      dv.setUint32(p + 14, r.crc, true);
      dv.setUint32(p + 18, r.data.length, true);
      dv.setUint32(p + 22, r.data.length, true);
      dv.setUint16(p + 26, r.name.length, true);
      dv.setUint16(p + 28, 0, true);
      p += 30;
      buf.set(r.name, p); p += r.name.length;
      buf.set(r.data, p); p += r.data.length;
    }

    var cdStart = p;
    for (i = 0; i < recs.length; i++) {
      var e = recs[i];
      dv.setUint32(p, 0x02014b50, true);
      dv.setUint16(p + 4, 20, true);           /* version made by */
      dv.setUint16(p + 6, 20, true);           /* version needed */
      dv.setUint16(p + 8, 0x0800, true);
      dv.setUint16(p + 10, 0, true);
      dv.setUint16(p + 12, stamp.time, true);
      dv.setUint16(p + 14, stamp.date, true);
      dv.setUint32(p + 16, e.crc, true);
      dv.setUint32(p + 20, e.data.length, true);
      dv.setUint32(p + 24, e.data.length, true);
      dv.setUint16(p + 28, e.name.length, true);
      dv.setUint16(p + 30, 0, true);           /* extra */
      dv.setUint16(p + 32, 0, true);           /* comment */
      dv.setUint16(p + 34, 0, true);           /* disk number */
      dv.setUint16(p + 36, 0, true);           /* internal attributes */
      dv.setUint32(p + 38, 0, true);           /* external attributes */
      dv.setUint32(p + 42, e.offset, true);
      p += 46;
      buf.set(e.name, p); p += e.name.length;
    }

    dv.setUint32(p, 0x06054b50, true);
    dv.setUint16(p + 4, 0, true);
    dv.setUint16(p + 6, 0, true);
    dv.setUint16(p + 8, recs.length, true);
    dv.setUint16(p + 10, recs.length, true);
    dv.setUint32(p + 12, p - cdStart, true);
    dv.setUint32(p + 16, cdStart, true);
    dv.setUint16(p + 20, 0, true);
    return buf;
  }

  /* ------------------------------------------------------------------------
     Settings read out of the form
     ------------------------------------------------------------------------ */
  function numField(id, min, max, fallback) {
    var raw = parseFloat(el(id).value);
    if (!isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, raw));
  }

  function targetSize(ow, oh) {
    var mode = el('it-resize').value;
    var w = ow, h = oh;
    if (mode === 'percent') {
      var scale = numField('it-percent', 1, 400, 100) / 100;
      w = Math.round(ow * scale);
      h = Math.round(oh * scale);
    } else if (mode === 'dimensions') {
      var tw = Math.round(numField('it-width', 0, 20000, 0));
      var th = Math.round(numField('it-height', 0, 20000, 0));
      if (el('it-lock').checked) {
        /* With the lock on across a batch, one number is honoured and the
           other follows each image's own ratio. That is the only behaviour
           that does not distort a mixed-orientation batch. */
        if (tw) { w = tw; h = Math.round(tw * oh / ow); }
        else if (th) { h = th; w = Math.round(th * ow / oh); }
      } else {
        if (tw) w = tw;
        if (th) h = th;
      }
    } else if (mode === 'fit') {
      var box = numField('it-fit', 16, 20000, 1920);
      /* Never upscales. Enlarging a photograph to hit a target invents pixels
         and makes the file bigger, which is the opposite of what anyone opens
         this page for. */
      var f = Math.min(1, box / Math.max(ow, oh));
      w = Math.round(ow * f);
      h = Math.round(oh * f);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function chosenType(item) {
    var v = el('it-format').value;
    if (v !== 'keep') return v;
    /* "Keep the format" has to land on something a canvas can encode. GIF,
       BMP, HEIC and SVG have no encoder anywhere, so they become PNG — the one
       format every browser is required to write, lossless, and with an alpha
       channel that survives. */
    if (supported[item.srcType]) return item.srcType;
    return 'image/png';
  }

  /* ------------------------------------------------------------------------
     The work
     ------------------------------------------------------------------------ */
  function processOne(item, done) {
    item.result = null;
    item.notes = [];
    item.error = '';

    decodeImage(item.file, function (img, dw, dh) {
      resolveOrientation(item, dw, dh);

      var size = targetSize(item.ow, item.oh);
      var type = chosenType(item);
      var fmt = formatFor(type);
      var canvas = makeCanvas(size.w, size.h);
      if (!canvas) {
        var ceiling = largestThatFits(size.w, size.h);
        item.error = size.w + ' x ' + size.h + ' is past what this browser will give a canvas. ' +
          'At this aspect ratio it managed about ' + ceiling.w + ' x ' + ceiling.h +
          '. Use "Fit within" or a percentage to come under that.';
        done();
        return;
      }

      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';

      /* JPEG has no alpha channel. Left alone, the canvas ships transparent
         pixels to the encoder as black, so a logo on a transparent ground
         comes back on a black square. White is the assumption almost everyone
         actually wants, and the note below says it was made. */
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size.w, size.h);
        if (item.srcType === 'image/png' || item.srcType === 'image/webp' ||
            item.srcType === 'image/gif' || item.srcType === 'image/avif') {
          item.notes.push('any transparency was flattened onto white — JPEG has no alpha channel');
        }
      }

      try {
        drawOriented(ctx, img, item.rotate, size.w, size.h);
      } catch (err) {
        item.error = 'The browser decoded that image but could not draw it: ' +
          ((err && err.message) || String(err));
        done();
        return;
      }

      if (item.rotate > 1) {
        item.notes.push('rotated here — this browser handed back the unrotated pixels ' +
                        'and the orientation tag said ' + item.rotate);
      }
      if (item.scan.progressive) {
        item.notes.push('the original was a progressive JPEG; canvas encoders write baseline only');
      }

      var quality = numField('it-quality', 1, 100, 82) / 100;
      var args = fmt && fmt.lossy ? quality : undefined;

      canvas.toBlob(function (blob) {
        if (!blob) {
          item.error = 'This browser refused to encode that image as ' +
            (fmt ? fmt.label : type) + '.';
          done();
          return;
        }
        /* toBlob answers with PNG when it cannot honour the type asked for.
           The probe at load should have stopped that, but a format the probe
           passed and the encoder then refused would otherwise be saved under a
           name that lies about its contents. */
        var actual = blob.type || type;
        if (actual !== type) {
          item.notes.push('this browser encoded ' + actual + ' rather than the ' +
                          (fmt ? fmt.label : type) + ' that was asked for');
        }
        finishBlob(item, blob, actual, size, done);
      }, type, args);
    }, function () {
      item.error = 'This browser cannot decode that file' +
        (item.srcType ? ' (' + item.srcType + ')' : '') +
        '. HEIC from an iPhone is the usual case: only Safari decodes it.';
      done();
    });
  }

  function finishBlob(item, blob, actual, size, done) {
    var keepMeta = el('it-meta').value === 'keep';
    var wantsSplice = keepMeta && actual === 'image/jpeg' && item.scan.exifStart >= 0;

    blobBytes(blob, function (bytes) {
      if (keepMeta && !wantsSplice) {
        item.notes.push(item.scan.exifStart >= 0
          ? 'metadata was dropped: it can only be carried into a JPEG, and this output is ' + actual
          : 'metadata was dropped because the original had no EXIF block to keep');
      }
      if (wantsSplice) {
        /* A copy, not a view: neutraliseOrientation writes into this segment,
           and the head buffer is the record of what the file originally said. */
        var seg = new Uint8Array(item.head.subarray(item.scan.exifStart, item.scan.exifEnd));
        neutraliseOrientation(seg);
        var merged = withExif(bytes, seg);
        if (merged) {
          bytes = merged;
          item.notes.push('the original EXIF block was spliced back in, with the ' +
                          'orientation tag reset to 1 so nothing rotates it twice');
        } else {
          item.notes.push('metadata could not be spliced back in, so it was dropped');
        }
      }
      item.result = {
        bytes: bytes, type: actual, w: size.w, h: size.h,
        name: outputName(item.name, actual)
      };
      done();
    }, function () {
      item.error = 'The encoded image could not be read back out of the browser.';
      done();
    });
  }

  function outputName(name, type) {
    var fmt = formatFor(type);
    var stem = name.replace(/\.[^.\\/]+$/, '');
    return stem + (fmt ? fmt.ext : '.bin');
  }

  /* Two files called photo.jpg from two different folders are an ordinary
     thing to drop here, and a ZIP with two identical member names is a ZIP
     whose second file some unarchivers silently discard. */
  function uniqueNames(list) {
    var seen = {};
    var names = [];
    for (var i = 0; i < list.length; i++) {
      var base = list[i];
      var dot = base.lastIndexOf('.');
      var stem = dot > 0 ? base.substring(0, dot) : base;
      var ext = dot > 0 ? base.substring(dot) : '';
      var name = base;
      var n = 2;
      while (seen[name.toLowerCase()]) {
        name = stem + '-' + n + ext;
        n++;
      }
      seen[name.toLowerCase()] = true;
      names.push(name);
    }
    return names;
  }

  /* ------------------------------------------------------------------------
     Reporting
     ------------------------------------------------------------------------ */
  function totals() {
    var before = 0, after = 0, count = 0;
    for (var i = 0; i < items.length; i++) {
      if (!items[i].result) continue;
      before += items[i].file.size;
      after += items[i].result.bytes.length;
      count++;
    }
    return { before: before, after: after, count: count, saved: before - after };
  }

  function renderTotal() {
    var t = totals();
    var node = el('it-total');
    if (!t.count) {
      node.textContent = items.length
        ? 'Nothing processed yet. Set the options above and press Process.'
        : 'No images loaded.';
      el('it-zip').disabled = true;
      return;
    }
    /* The total is refreshed after every image, so mid-batch this line already
       has results in it. The archive button stays shut until the run finishes
       anyway — a ZIP of the first four of thirty is not what the button says
       it does. */
    var share = t.before ? (t.saved / t.before) * 100 : 0;
    var verb = t.saved >= 0 ? 'saved' : 'added';
    node.textContent = t.count + (t.count === 1 ? ' image: ' : ' images: ') +
      LabTool.humanBytes(t.before) + ' in, ' + LabTool.humanBytes(t.after) + ' out — ' +
      LabTool.humanBytes(Math.abs(t.saved)) + ' ' + verb + ', ' + pct(Math.abs(share)) + '.';
    el('it-zip').disabled = busy;
  }

  function renderList() {
    var list = el('it-list');
    list.textContent = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'it-empty';
      empty.textContent = 'No images yet. Drop one or many above — they stay on this machine.';
      list.appendChild(empty);
      return;
    }

    for (var i = 0; i < items.length; i++) {
      list.appendChild(rowFor(items[i], i));
    }
  }

  function rowFor(item, index) {
    var li = document.createElement('li');
    li.className = 'it-row' + (index === selected ? ' is-selected' : '');

    var pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'it-row-pick';
    pick.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
    pick.addEventListener('click', function () { selectItem(index); });

    var name = document.createElement('span');
    name.className = 'it-row-name';
    name.textContent = item.name;
    pick.appendChild(name);

    var meta = document.createElement('span');
    meta.className = 'it-row-meta';
    if (item.error) {
      meta.className += ' it-row-bad';
      meta.textContent = item.error;
    } else if (item.result) {
      var delta = item.file.size - item.result.bytes.length;
      var share = item.file.size ? (delta / item.file.size) * 100 : 0;
      meta.textContent = item.ow + '×' + item.oh + ' → ' +
        item.result.w + '×' + item.result.h + ' · ' +
        LabTool.humanBytes(item.file.size) + ' → ' +
        LabTool.humanBytes(item.result.bytes.length) + ' · ' +
        (delta >= 0 ? '−' : '+') + pct(Math.abs(share));
      if (delta < 0) meta.className += ' it-row-warn';
    } else {
      meta.textContent = (item.ow ? item.ow + '×' + item.oh + ' · ' : '') +
        LabTool.humanBytes(item.file.size) + ' · not processed yet';
    }
    pick.appendChild(meta);
    li.appendChild(pick);

    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'lab-btn it-row-save';
    save.textContent = 'Save';
    save.disabled = !item.result;
    save.setAttribute('aria-label', 'Save ' + item.name);
    save.addEventListener('click', function () {
      if (!item.result) return;
      LabTool.download(item.result.bytes, item.result.name, item.result.type);
    });
    li.appendChild(save);

    var drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'lab-btn it-row-drop';
    drop.textContent = 'Remove';
    drop.setAttribute('aria-label', 'Remove ' + item.name);
    drop.addEventListener('click', function () { removeItem(index); });
    li.appendChild(drop);

    return li;
  }

  function removeItem(index) {
    if (busy) return;
    items.splice(index, 1);
    if (selected >= items.length) selected = items.length - 1;
    renderList();
    renderTotal();
    drawPreview();
  }

  /* ------------------------------------------------------------------------
     The before/after split view
     ------------------------------------------------------------------------ */
  var previewBefore = null;
  var previewAfter = null;

  function selectItem(index) {
    selected = index;
    renderList();
    drawPreview();
  }

  function fitBox(cw, ch, iw, ih) {
    var f = Math.min(cw / iw, ch / ih);
    var w = Math.max(1, Math.round(iw * f));
    var h = Math.max(1, Math.round(ih * f));
    return { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w: w, h: h };
  }

  /* The backing store is sized in device pixels and the context is never
     scaled, so every coordinate below is a device pixel. That is deliberate:
     this canvas exists to show what an encoder did to individual pixels, and
     a CSS-pixel context on a 2x screen would resample the evidence before the
     visitor ever saw it. `dpr` is kept so text and rules can be sized against
     it rather than coming out half-height on a retina panel. */
  var dpr = 1;

  function sizeCanvas(c) {
    dpr = window.devicePixelRatio || 1;
    var rect = c.getBoundingClientRect();
    var w = Math.max(160, Math.round((rect.width || 640) * dpr));
    var h = Math.round(w * 9 / 16);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  function drawPreview() {
    var c = el('it-canvas');
    if (!c) return;
    sizeCanvas(c);
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, c.width, c.height);

    var item = items[selected];
    if (!item) {
      previewBefore = null;
      previewAfter = null;
      caption('Drop an image to see it here. Once it has been processed, the split shows the original on the left and the result on the right.');
      label('it-before', '');
      label('it-after', '');
      return;
    }

    var token = ++seq;
    caption('Decoding…');

    decodeImage(item.file, function (img, dw, dh) {
      if (token !== seq) return;
      /* A PNG or WebP has no SOF for the head scan to read, so this is the
         first point at which its real dimensions are known. */
      if (!item.ow) resolveOrientation(item, dw, dh);
      previewBefore = img;
      updateSizeLabels(item);
      if (!item.result) { previewAfter = null; paint(item); return; }
      var blob = new Blob([item.result.bytes], { type: item.result.type });
      decodeImage(blob, function (img2) {
        if (token !== seq) return;
        previewAfter = img2;
        paint(item);
      }, function () {
        if (token !== seq) return;
        previewAfter = null;
        paint(item);
      });
    }, function () {
      if (token !== seq) return;
      previewBefore = null;
      previewAfter = null;
      caption('That image could not be decoded for preview.');
    });
  }

  function label(id, text) {
    var node = el(id);
    if (node) node.textContent = text;
  }

  /* The byte counts live in the DOM rather than only on the canvas, so a
     screen reader gets the comparison the split view is making visually. */
  function updateSizeLabels(item) {
    label('it-before', 'Original: ' + LabTool.humanBytes(item.file.size) +
      (item.ow ? ' · ' + item.ow + ' × ' + item.oh : ''));
    label('it-after', item.result
      ? 'Processed: ' + LabTool.humanBytes(item.result.bytes.length) +
        ' · ' + item.result.w + ' × ' + item.result.h
      : 'Processed: not yet');
  }

  function caption(text) {
    var node = el('it-caption');
    if (node) node.textContent = text;
  }

  function paint(item) {
    var c = el('it-canvas');
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, c.width, c.height);
    if (!previewBefore) return;

    var split = Math.round(c.width * (numField('it-split', 0, 100, 50) / 100));
    var zoom = el('it-zoom').checked;
    var ow = item.ow || previewBefore.naturalWidth || 1;
    var oh = item.oh || previewBefore.naturalHeight || 1;
    var fit = fitBox(c.width, c.height, ow, oh);

    /* Both halves are drawn into the SAME box, at the same magnification, and
       clipped. That is what makes the split honest: the divider always cuts
       one picture rather than juxtaposing two differently-scaled ones. Zooming
       enlarges that shared box until the original sits at one image pixel per
       device pixel — so the processed copy, which usually has fewer pixels, is
       shown blown up to the same size, which is exactly the comparison a
       quality slider needs and exactly what a fitted preview hides. */
    var z = zoom ? Math.max(1, Math.min(8, ow / fit.w)) : 1;
    var box = {
      w: Math.round(fit.w * z), h: Math.round(fit.h * z),
      x: Math.round((c.width - fit.w * z) / 2), y: Math.round((c.height - fit.h * z) / 2)
    };

    drawHalf(ctx, previewBefore, item, box, 0, split, true);
    if (previewAfter) {
      drawHalf(ctx, previewAfter, item, box, split, c.width, false);
    } else {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
      ctx.fillRect(split, 0, c.width - split, c.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = Math.round(13 * dpr) + 'px system-ui, sans-serif';
      ctx.fillText('press Process', split + 14 * dpr, 26 * dpr);
    }

    ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.fillRect(split - dpr, 0, 2 * dpr, c.height);

    ctx.font = Math.round(12 * dpr) + 'px system-ui, sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('original', 10 * dpr, c.height - 10 * dpr);
    if (previewAfter) {
      ctx.fillText('processed', c.width - ctx.measureText('processed').width - 10 * dpr,
                   c.height - 10 * dpr);
    }

    /* Sharing one box is what makes the split readable, and it has one cost
       worth admitting: with the aspect lock off, a processed copy of a
       different shape gets stretched into the original's frame here. The
       saved file is not stretched, so say which is which rather than letting
       the preview quietly libel the output. */
    var stretched = item.result && item.result.h &&
      Math.abs((item.result.w / item.result.h) - (ow / oh)) > 0.01 * (ow / oh);

    caption((zoom
      ? 'Magnified until the original is one image pixel per device pixel, with the processed copy shown at the same size beside it. Drag the divider, or use the split slider.'
      : 'Both copies are drawn into the same box, so the divider cuts one picture rather than comparing two scales. Turn on 1:1 pixels to judge quality rather than framing.') +
      (stretched ? ' The processed copy is a different shape, so it is stretched into the original’s frame for this comparison only — the saved file keeps the dimensions listed above.' : ''));
  }

  function drawHalf(ctx, img, item, box, x0, x1, isBefore) {
    if (x1 <= x0) return;
    var c = ctx.canvas;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, c.height);
    ctx.clip();
    if (isBefore && item.rotate > 1) {
      /* The original still needs its orientation applied here, for the same
         reason it did during encoding: this browser handed back unrotated
         pixels, so an untransformed preview would compare a sideways original
         against an upright result and look like a bug in the resizer. */
      ctx.translate(box.x, box.y);
      drawOriented(ctx, img, item.rotate, box.w, box.h);
    } else {
      ctx.drawImage(img, box.x, box.y, box.w, box.h);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------------
     Intake
     ------------------------------------------------------------------------ */
  function addFiles(fileList) {
    if (busy) return;
    var rejected = [];
    var added = 0;
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      if (items.length >= MAX_FILES) {
        rejected.push(file.name + ' — this tool stops at ' + MAX_FILES + ' images at once');
        continue;
      }
      if (file.size > MAX_FILE) {
        rejected.push(file.name + ' — ' + LabTool.humanBytes(file.size) + ', over the ' +
                      LabTool.humanBytes(MAX_FILE) + ' ceiling; the work happens on your processor');
        continue;
      }
      if (!file.size) {
        rejected.push(file.name + ' — the file is empty');
        continue;
      }
      items.push({
        file: file, name: file.name, head: new Uint8Array(0),
        scan: { jpeg: false, progressive: false, width: 0, height: 0,
                exifStart: -1, exifEnd: -1, orientation: 1, truncated: false },
        srcType: '', rotate: 1, ow: 0, oh: 0, decW: 0, decH: 0,
        result: null, notes: [], error: '', inspected: false
      });
      added++;
    }
    if (rejected.length) {
      out.rule();
      for (var r = 0; r < rejected.length; r++) out.err('Skipped ' + rejected[r]);
    }
    if (!added) { renderList(); return; }
    if (selected < 0) selected = 0;
    renderList();
    renderTotal();
    inspectPending(function () {
      renderList();
      drawPreview();
      updateDropName();
    });
  }

  /* Read the head of every file that has not been looked at yet. This is what
     fills in the source format, the stored dimensions and the EXIF segment, so
     the list can describe an image before anything has been encoded. */
  function inspectPending(done) {
    var pending = [];
    for (var i = 0; i < items.length; i++) if (!items[i].inspected) pending.push(items[i]);
    if (!pending.length) { done(); return; }

    var left = pending.length;
    function one(item) {
      var reader = new FileReader();
      reader.onload = function () {
        item.head = new Uint8Array(reader.result);
        item.srcType = sniff(item.head) || item.file.type || '';
        item.scan = scanJpeg(item.head);
        if (item.scan.width) { item.ow = item.scan.width; item.oh = item.scan.height; }
        if (item.scan.orientation >= 5) { item.ow = item.scan.height; item.oh = item.scan.width; }
        item.inspected = true;
        if (--left === 0) done();
      };
      reader.onerror = function () {
        item.error = 'That file could not be read off disk.';
        item.inspected = true;
        if (--left === 0) done();
      };
      reader.readAsArrayBuffer(item.file.slice(0, HEAD_BYTES));
    }
    for (var j = 0; j < pending.length; j++) one(pending[j]);
  }

  function updateDropName() {
    var node = el('tool-dropname');
    if (!node) return;
    if (!items.length) { node.textContent = ''; return; }
    node.textContent = items.length === 1
      ? items[0].name
      : items.length + ' images loaded';
  }

  /* ------------------------------------------------------------------------
     Run
     ------------------------------------------------------------------------ */
  function setBusy(on) {
    busy = on;
    el('tool-run').disabled = on;
    el('it-zip').disabled = on || !totals().count;
    el('tool-status').textContent = on ? 'Working…' : '';
    el('tool-status').className = 'lab-status' + (on ? ' is-busy' : '');
  }

  function run() {
    if (busy) return;
    if (!items.length) {
      out.clear().warn('Drop one or more images first. Nothing is uploaded — the encoding happens in this tab.');
      return;
    }
    out.clear();
    setBusy(true);

    var type = el('it-format').value;
    out.heading('Encoding ' + items.length + (items.length === 1 ? ' image' : ' images'));
    out.row('output format', type === 'keep' ? 'same as each source, where this browser can encode it'
                                             : (formatFor(type) || { label: type }).label);
    var fmt = formatFor(type);
    if (type === 'keep' || (fmt && fmt.lossy)) {
      out.row('quality', Math.round(numField('it-quality', 1, 100, 82)) + ' / 100');
    }
    out.row('metadata', el('it-meta').value === 'keep'
      ? 'kept where the output is a JPEG' : 'stripped');
    out.rule();

    var i = 0;
    function step() {
      if (i >= items.length) { finishRun(); return; }
      var item = items[i];
      i++;
      processOne(item, function () {
        reportItem(item);
        renderList();
        renderTotal();
        /* Yield between images so a batch of thirty does not lock the tab. */
        setTimeout(step, 0);
      });
    }
    step();
  }

  function reportItem(item) {
    out.heading(item.name);
    if (item.error) {
      out.err(item.error);
      out.line('');
      return;
    }
    var r = item.result;
    var delta = item.file.size - r.bytes.length;
    var share = item.file.size ? (delta / item.file.size) * 100 : 0;
    out.row('source', (item.srcType || 'unknown') + ', ' + item.ow + ' x ' + item.oh);
    out.row('output', r.type + ', ' + r.w + ' x ' + r.h);
    out.row('size', LabTool.humanBytes(item.file.size) + ' → ' + LabTool.humanBytes(r.bytes.length));
    if (delta >= 0) out.row('saved', LabTool.humanBytes(delta) + '  (' + pct(share) + ')', 't-ok');
    else out.row('grew by', LabTool.humanBytes(-delta) + '  (' + pct(-share) + ')', 't-warn');
    if (delta < 0) {
      out.warn('Bigger than the original. That normally means the source was already');
      out.warn('compressed harder than the setting you chose, or a photograph was');
      out.warn('asked for as PNG. Lower the quality, or pick a lossy format.');
    }
    for (var n = 0; n < item.notes.length; n++) out.dim('note: ' + item.notes[n]);
    out.line('');
  }

  function finishRun() {
    var t = totals();
    out.rule();
    if (t.count) {
      out.ok(t.count + (t.count === 1 ? ' image' : ' images') + ' encoded, entirely in this tab.');
      var verb = t.saved >= 0 ? 'saved' : 'added';
      out.row('total in', LabTool.humanBytes(t.before));
      out.row('total out', LabTool.humanBytes(t.after));
      out.row('total ' + verb, LabTool.humanBytes(Math.abs(t.saved)));
    } else {
      out.err('Nothing came out. Every image above failed for the reason printed with it.');
    }
    out.line('');
    out.dim('Nothing was uploaded. Use Save on a row, or Download all as a ZIP,');
    out.dim('which is also built here — there is no server in this page at all.');
    setBusy(false);
    renderTotal();
    drawPreview();
  }

  function downloadZip() {
    var ready = [];
    var names = [];
    for (var i = 0; i < items.length; i++) {
      if (!items[i].result) continue;
      ready.push(items[i].result);
      names.push(items[i].result.name);
    }
    if (!ready.length) { out.rule(); out.warn('Nothing has been processed yet.'); return; }
    names = uniqueNames(names);

    var entries = [];
    for (var j = 0; j < ready.length; j++) {
      entries.push({ name: names[j], bytes: ready[j].bytes });
    }
    var zip = buildZip(entries);
    if (!zip) {
      out.rule();
      out.err('That batch is too large for the simple ZIP this page writes.');
      out.dim('Save the rows individually instead — nothing is lost by doing so.');
      return;
    }
    LabTool.download(zip, 'images-' + entries.length + '.zip', 'application/zip');
    out.rule();
    out.ok('ZIP built in the browser: ' + entries.length + ' files, ' +
           LabTool.humanBytes(zip.length) + '.');
    out.dim('Store-only, because these payloads are already compressed. Deflating');
    out.dim('them again would cost a library and save close to nothing.');
  }

  /* ------------------------------------------------------------------------
     Form wiring
     ------------------------------------------------------------------------ */
  function syncResizeFields() {
    var mode = el('it-resize').value;
    el('it-percent-wrap').hidden = mode !== 'percent';
    el('it-width-wrap').hidden = mode !== 'dimensions';
    el('it-height-wrap').hidden = mode !== 'dimensions';
    el('it-lock-wrap').hidden = mode !== 'dimensions';
    el('it-fit-wrap').hidden = mode !== 'fit';
  }

  function syncQuality() {
    var type = el('it-format').value;
    var fmt = formatFor(type);
    var lossless = fmt && !fmt.lossy;
    el('it-quality').disabled = lossless;
    el('it-qualityval').textContent = lossless
      ? 'n/a'
      : String(Math.round(numField('it-quality', 1, 100, 82)));
    el('it-quality-note').textContent = lossless
      ? 'PNG is lossless, so there is no quality setting to make. It will usually be much larger than a JPEG of the same picture.'
      : 'Lower is smaller. Watch the split view: on most photographs the file stops shrinking meaningfully somewhere in the seventies, and starts looking worse in the fifties.';
  }

  function syncMeta() {
    el('it-meta-note').textContent = el('it-meta').value === 'keep'
      ? 'Kept only where the output is a JPEG and the original had an EXIF block — nothing else can carry it. The orientation tag is reset to 1 so the picture is not rotated twice.'
      : 'Camera, lens, serial number, timestamp and GPS coordinates all go. A canvas has nowhere to keep them, so stripping is what happens by default.';
  }

  function wireDrop() {
    var zone = el('tool-drop');
    var input = el('tool-file');
    input.addEventListener('change', function () {
      addFiles(input.files);
      input.value = '';
    });
    zone.addEventListener('click', function (e) {
      if (e.target !== input) input.click();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    });
  }

  function wireSplitDrag() {
    var c = el('it-canvas');
    var dragging = false;
    function setFromEvent(e) {
      var rect = c.getBoundingClientRect();
      if (!rect.width) return;
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      el('it-split').value = String(Math.max(0, Math.min(100, Math.round(x))));
      if (items[selected]) paint(items[selected]);
    }
    c.addEventListener('pointerdown', function (e) {
      dragging = true;
      if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (err) {} }
      setFromEvent(e);
    });
    c.addEventListener('pointermove', function (e) { if (dragging) setFromEvent(e); });
    ['pointerup', 'pointercancel'].forEach(function (name) {
      c.addEventListener(name, function () { dragging = false; });
    });
  }

  /* Runs once. It edits the option labels, so calling it twice would append
     the same explanation twice. */
  function probeAll() {
    var i;
    for (i = 0; i < FORMATS.length; i++) supported[FORMATS[i].type] = probeEncoder(FORMATS[i].type);
    /* PNG is required of every canvas implementation, so a browser that fails
       the PNG probe has failed the probe, not the format. Trusting the spec
       over a suspicious answer is better than disabling the one format that
       always works and leaving the tool with nothing to fall back to. */
    supported['image/png'] = true;

    var opts = el('it-format').options;
    for (i = 0; i < opts.length; i++) {
      if (opts[i].value === 'keep') continue;
      if (!supported[opts[i].value]) {
        opts[i].disabled = true;
        opts[i].textContent = opts[i].textContent + ' — no encoder in this browser';
      }
    }
  }

  function printIntro() {
    var have = [];
    var missing = [];
    for (var i = 0; i < FORMATS.length; i++) {
      (supported[FORMATS[i].type] ? have : missing).push(FORMATS[i].label);
    }
    out.dim('Encoders this browser has: ' + have.join(', ') + '.');
    if (missing.length) {
      out.dim('Not available here: ' + missing.join(', ') + '. Those options are');
      out.dim('disabled rather than quietly falling back to PNG behind your back.');
    }
    out.line('');
    out.dim('Drop one image or thirty. Everything is decoded, resized and encoded');
    out.dim('in this tab; no byte of any picture leaves your machine.');
  }

  LabTool.define({
    id: 'imagetools',
    run: run,
    onReady: function () {
      if (!document.createElement('canvas').toBlob) {
        out.err('This browser has no canvas.toBlob, so it cannot encode an image');
        out.err('at all. Everything below will stay disabled.');
        el('tool-run').disabled = true;
        return;
      }

      probeAll();
      wireDrop();
      wireSplitDrag();
      renderList();
      renderTotal();

      el('it-format').addEventListener('change', syncQuality);
      el('it-resize').addEventListener('change', syncResizeFields);
      el('it-meta').addEventListener('change', syncMeta);
      el('it-quality').addEventListener('input', syncQuality);
      el('it-split').addEventListener('input', function () {
        if (items[selected]) paint(items[selected]);
      });
      el('it-zoom').addEventListener('change', function () {
        if (items[selected]) paint(items[selected]);
      });
      el('it-zip').addEventListener('click', downloadZip);
      el('it-clear').addEventListener('click', function () {
        if (busy) return;
        items = [];
        selected = -1;
        el('tool-dropname').textContent = '';
        renderList();
        renderTotal();
        drawPreview();
        out.clear();
        printIntro();
      });

      var resizeTimer = null;
      window.addEventListener('resize', function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(drawPreview, 200);
      });

      syncResizeFields();
      syncQuality();
      syncMeta();
      printIntro();
      drawPreview();
    }
  });
})();

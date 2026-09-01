/* ==========================================================================
   exif.js — read the metadata inside a photograph, and strip it back out.
   --------------------------------------------------------------------------
   A JPEG straight off a phone commonly carries the camera model, the exact
   date and time, and GPS coordinates accurate to a few metres. People share
   those files daily without knowing. Showing someone their own photo's
   coordinates is a more convincing privacy lesson than any amount of prose.

   The stripper re-encodes the image through a canvas, which keeps the pixels
   and discards every metadata segment, then hands the clean file back with a
   blob URL. Nothing is uploaded at any point — a tool that asked you to upload
   a photo to remove its GPS data would be a strange bargain.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 40 * 1024 * 1024;
  var out = LabTool.out('tool-out');
  var lastBytes = null, lastFile = null;

  /* --- a compact TIFF/EXIF reader --------------------------------------- */
  var TAGS = {
    0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation',
    0x011a: 'XResolution', 0x011b: 'YResolution', 0x0131: 'Software',
    0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright',
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8827: 'ISO',
    0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
    0x920a: 'FocalLength', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension',
    0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber',
    0xa433: 'LensMake', 0xa434: 'LensModel', 0xa435: 'LensSerialNumber',
    0x8825: '__GPS', 0x8769: '__EXIF'
  };
  var GPS_TAGS = {
    0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude',
    0x0005: 'GPSAltitudeRef', 0x0006: 'GPSAltitude',
    0x0007: 'GPSTimeStamp', 0x001d: 'GPSDateStamp'
  };

  function readExif(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: 'not-jpeg' };
    var offset = 2, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var sawOtherApp1 = false;
    while (offset < bytes.length - 4) {
      if (bytes[offset] !== 0xff) break;
      var marker = bytes[offset + 1];
      var size = dv.getUint16(offset + 2, false);
      if (marker === 0xe1) {
        var start = offset + 4;
        var tag = String.fromCharCode.apply(null, bytes.subarray(start, start + 4));
        if (tag === 'Exif') return parseTiff(dv, start + 6);
        // APP1 that is not EXIF is usually XMP — and a JPEG may carry several
        // APP1 segments. Editors routinely write their XMP block ahead of the
        // camera's Exif block, so returning on the first APP1 answered "no
        // EXIF" for most phone photos that had ever been through an editor.
        // Note it and keep walking until the Exif one turns up.
        sawOtherApp1 = true;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      offset += 2 + size;
    }
    return sawOtherApp1 ? { xmpOnly: true } : { none: true };
  }

  function parseTiff(dv, base) {
    // The TIFF header is 8 bytes. A truncated APP1 segment can point `base`
    // past the end of the file, and getUint16 throws rather than returning
    // nothing, so check before reading instead of after.
    if (base < 0 || base + 8 > dv.byteLength) return { error: 'bad-tiff' };
    var little = dv.getUint16(base, false) === 0x4949;
    if (dv.getUint16(base + 2, little) !== 42) return { error: 'bad-tiff' };
    var result = { fields: {}, gps: {} };
    readIfd(dv, base, base + dv.getUint32(base + 4, little), little, result, TAGS, 0, {});
    return result;
  }

  /* Real EXIF nests one level: IFD0 holds the EXIF and GPS sub-IFD pointers,
     and the EXIF one can hold Interop below that. Two is the honest depth;
     eight leaves room for something unusual but valid. */
  var MAX_IFD_DEPTH = 8;

  /* A sub-IFD pointer is just a number out of the file, and nothing in the
     format stops it pointing back at the directory that contains it. A JPEG
     whose 0x8769 tag pointed at its own IFD recursed until the stack gave out,
     and the RangeError had nowhere to go: report() runs bare from the drop
     handler and out.clear() has already fired, so the analyst was left with a
     permanently blank pane and no clue why. Two independent brakes, because
     they stop different things — `depth` bounds legitimate-looking nesting that
     simply goes too far, and `seen` catches a cycle of any length, including
     A -> B -> A, which a depth cap alone would only stop after eight laps.

     `seen` is keyed on the directory's absolute offset: two distinct IFDs
     cannot share one, so an offset already on the stack means a cycle. */
  function readIfd(dv, base, dirStart, little, result, table, depth, seen) {
    if (depth > MAX_IFD_DEPTH) return;
    // Same bounds reasoning as parseTiff: the entry count itself must be inside
    // the file before it can be read.
    if (dirStart < 0 || dirStart + 2 > dv.byteLength) return;
    if (seen[dirStart]) return;
    seen[dirStart] = true;

    var count = dv.getUint16(dirStart, little);
    for (var i = 0; i < count; i++) {
      var entry = dirStart + 2 + i * 12;
      // count is a 16-bit field, so a corrupt one can claim 65535 entries in a
      // directory that has three. Stop at the end of the file rather than throw.
      if (entry + 12 > dv.byteLength) break;
      var tag = dv.getUint16(entry, little);
      var name = table[tag];
      if (!name) continue;
      var value = readValue(dv, base, entry, little);
      // readValue returns null on a malformed entry and an array for multi-value
      // rationals; neither is an offset, and `base + null` is silently `base`,
      // which would send the reader back to the TIFF header.
      if (name === '__EXIF' || name === '__GPS') {
        if (typeof value !== 'number') continue;
        readIfd(dv, base, base + value, little, result,
                name === '__GPS' ? GPS_TAGS : TAGS, depth + 1, seen);
        continue;
      }
      if (table === GPS_TAGS) result.gps[name] = value;
      else result.fields[name] = value;
    }
  }

  function readValue(dv, base, entry, little) {
    var type = dv.getUint16(entry + 2, little);
    var count = dv.getUint32(entry + 4, little);
    var sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    var unit = sizes[type] || 1;
    var total = unit * count;
    var at = total > 4 ? base + dv.getUint32(entry + 8, little) : entry + 8;
    try {
      if (type === 2) {
        var s = '';
        for (var i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(at + i));
        return s.replace(/\0+$/, '');
      }
      if (type === 3) return dv.getUint16(at, little);
      if (type === 4) return dv.getUint32(at, little);
      if (type === 5 || type === 10) {
        var vals = [];
        for (var j = 0; j < count; j++) {
          var num = dv.getUint32(at + j * 8, little);
          var den = dv.getUint32(at + j * 8 + 4, little);
          vals.push(den ? num / den : 0);
        }
        return count === 1 ? vals[0] : vals;
      }
      return dv.getUint8(at);
    } catch (err) { return null; }
  }

  function dms(parts, ref) {
    if (!Array.isArray(parts) || parts.length < 3) return null;
    var dec = parts[0] + parts[1] / 60 + parts[2] / 3600;
    if (ref === 'S' || ref === 'W') dec = -dec;
    return dec;
  }

  /* --- reporting -------------------------------------------------------- */

  /* Every caller goes through here rather than straight to renderReport.

     report() is invoked bare from the drop handler and from run(), so anything
     that escapes it lands in the console and nowhere the visitor can see. The
     first thing renderReport does is out.clear(), which means a throw halfway
     down leaves the pane wiped and silent — the tool looks broken with no error
     to search for. The specific parser bug that used to do this is fixed above,
     but a metadata reader is fed hostile and malformed files by definition, so
     the guarantee worth having is that no future one can blank the pane either.

     Whatever did get printed before the throw stays on screen; the message is
     appended under it, which also says how far the read got. */
  function report(bytes, file) {
    try {
      renderReport(bytes, file);
    } catch (err) {
      out.rule();
      out.err('Could not finish reading that file — its metadata is malformed');
      out.err('in a way this reader could not follow.');
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
    }
  }

  function renderReport(bytes, file) {
    out.clear();
    out.heading(file.name);
    out.row('size', LabTool.humanBytes(bytes.length));
    out.row('type', file.type || 'unknown');
    out.rule();

    var data = readExif(bytes);
    if (data.error === 'not-jpeg') {
      out.warn('This is not a JPEG. PNG and WebP can carry metadata too, but the');
      out.warn('EXIF block that phones write lives in JPEG — try a photo straight');
      out.warn('from a camera roll.');
      return;
    }
    if (data.none || data.xmpOnly) {
      out.ok('No EXIF block found.');
      out.dim(data.xmpOnly ? 'There is an APP1 segment, but it is XMP rather than EXIF.'
                           : 'Either it never had any, or something already stripped it —');
      out.dim('most social networks remove EXIF on upload, which is why a photo');
      out.dim('saved from Instagram looks clean and the original does not.');
      return;
    }

    var f = data.fields, g = data.gps;
    var keys = Object.keys(f);
    if (keys.length) {
      out.heading('Camera and capture');
      keys.forEach(function (k) { out.row(k, f[k]); });
    }

    var lat = dms(g.GPSLatitude, g.GPSLatitudeRef);
    var lon = dms(g.GPSLongitude, g.GPSLongitudeRef);
    out.rule();
    if (lat !== null && lon !== null) {
      out.err('LOCATION PRESENT');
      out.row('latitude', lat.toFixed(6));
      out.row('longitude', lon.toFixed(6));
      /* GPSAltitude is an UNSIGNED rational holding the magnitude; the sign
         lives in GPSAltitudeRef, where 1 means BELOW sea level (EXIF 2.32
         §4.6.6). Reading the magnitude alone printed a Dead Sea photo as
         +423 m. Tested against `typeof` rather than truthiness so that an
         altitude of exactly 0 — sea level — still prints its row. */
      if (typeof g.GPSAltitude === 'number') {
        var alt = g.GPSAltitudeRef === 1 ? -g.GPSAltitude : g.GPSAltitude;
        out.row('altitude', Math.round(alt) + ' m');
      }
      if (g.GPSDateStamp) out.row('GPS date', g.GPSDateStamp);
      out.line('');
      out.warn('That is roughly street-level accuracy. Anyone with this file can');
      out.warn('read it — the coordinates travel inside the image, so emailing or');
      out.warn('sharing the original shares the location too.');
      out.line('');
      out.dim('Coordinates: ' + lat.toFixed(6) + ', ' + lon.toFixed(6));
      out.dim('(paste into any map — nothing here contacts a mapping service)');
    } else {
      out.ok('No GPS coordinates in this image.');
    }

    out.rule();
    out.dim('Use "Download stripped copy" to get the same picture with every');
    out.dim('metadata segment removed. The pixels are re-encoded here in the tab.');
  }

  /* The stripped copy has to come back in the format it went in as.

     canvas.toBlob was hardcoded to 'image/jpeg', so a PNG dropped here came
     back as a JPEG: its alpha channel composited onto black, and every pixel
     put through a lossy encoder — for a tool whose entire promise is "the same
     picture, minus the metadata". A screenshot with a transparent background
     was silently destroyed by the privacy fix.

     File.type is a hint the OS supplies from the filename, so the magic bytes
     decide instead — they are what the decoder actually saw. GIF and anything
     unrecognised go out as PNG rather than JPEG: PNG is lossless, keeps
     transparency, and is the one format a canvas is required to encode. A
     bigger file is a much cheaper mistake here than lost pixels. */
  var EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

  function encodeAs(bytes, file) {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 &&
        bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 &&
        bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    var declared = (file && file.type) || '';
    if (EXT[declared]) return declared;
    return 'image/png';
  }

  function strip() {
    if (!lastBytes || !lastFile) { out.clear().warn('Load an image first.'); return; }
    var type = encodeAs(lastBytes, lastFile);
    var blob = new Blob([lastBytes], { type: type });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(function (clean) {
        URL.revokeObjectURL(url);
        if (!clean) { out.err('Could not re-encode that image.'); return; }
        // A browser that cannot encode the type it was asked for falls back to
        // PNG rather than failing, so the extension follows what actually came
        // out, not what was requested. A filename that lies about its contents
        // is its own small bug.
        var actual = clean.type || type;
        var name = lastFile.name.replace(/(\.[^.]+)?$/, '') + '-stripped' +
                   (EXT[actual] || '.png');
        clean.arrayBuffer().then(function (buf) {
          LabTool.download(new Uint8Array(buf), name, actual);
          out.rule();
          out.ok('Stripped copy saved as ' + name);
          out.dim('Re-encoding through a canvas keeps the pixels and drops every');
          if (actual === 'image/png') {
            out.dim('metadata segment. PNG is lossless, so the pixels are identical');
            out.dim('to the original — only the file size will differ.');
          } else {
            out.dim('metadata segment. It is a re-compression, so the file size and');
            out.dim('the last few bits of quality will differ from the original.');
          }
        });
      }, type, 0.92);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      out.err('That file could not be decoded as an image.');
    };
    img.src = url;
  }

  LabTool.define({
    id: 'exiftool',
    run: function () {
      if (lastBytes) report(lastBytes, lastFile);
      else out.clear().warn('Choose or drop a photo first.');
    },
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          lastBytes = bytes; lastFile = file;
          document.getElementById('tool-dropname').textContent = file.name;
          report(bytes, file);
        },
        onError: function (msg) { out.clear().err(msg); }
      });
      document.getElementById('tool-strip').addEventListener('click', strip);
      out.dim('Drop a photo taken on a phone — those are the ones that carry GPS.');
      out.dim('Nothing is uploaded; the file is read and re-encoded in this tab.');
    }
  });
})();

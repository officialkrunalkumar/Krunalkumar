/* ==========================================================================
   media-forensics.js — signals in an image, and deliberately no verdict.
   --------------------------------------------------------------------------
   The brief for this page was "a deepfake detector". A browser cannot be one,
   and neither can anything else with the reliability that word promises.
   Error level analysis, the noise floor, the frequency plot — none of them
   separate a real photograph from a generated one. They separate images that
   have been through different processing histories, which is a different
   question that merely rhymes with the one people want answered. Printing
   GENUINE or DEEPFAKE over a photo on the strength of these numbers would be a
   lie told in a confident font, and on a security consultant's own site that
   is a credibility problem, not a feature.

   So this file prints signals and never a conclusion. There is no score, no
   percentage and no traffic light anywhere in it — not because they were hard,
   but because every one of them would be invented precision. Each section says
   what it measured, what that does and does not license you to say, and what
   ordinary thing produces the same reading. Two sentences recur on purpose,
   because they are the two people forget: the absence of a signal proves
   nothing, and the presence of one has innocent explanations far more often
   than not.

   The one thing here that is real evidence is provenance — a C2PA manifest, an
   XMP block, an EXIF Software field. It is also the thing that is almost
   always missing, because every large platform strips it on upload. That is
   why it is reported first, and why its absence is reported as expected rather
   than as suspicious.

   The playground half applies the artefacts by hand so a visitor can watch the
   matching signal move on a file whose history they already know. It refuses
   to be a face swapper: see the note above the ARTEFACTS table.

   Nothing is uploaded. Every pixel read here is read in this tab, and the only
   file that leaves is the one the visitor asks to download.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_FILE = 60 * 1024 * 1024;

  /* A ceiling on the DECODED pixel count, which the file-size gate cannot
     reach: a solid-colour 20000x20000 PNG is a few hundred KB on disk and
     1.6 GB in getImageData. The arithmetic that sets this number:
     one RGBA buffer is 4 bytes a pixel, and the heaviest path here (error
     level analysis) holds three of them at once — the source, the decoded
     recompression, and the output map. At 80 MP that is 80e6 * 4 * 3 = 960 MB,
     which is the point a tab stops being usable. So 80 MP is the line.
     It clears every real sensor I could name: a 61 MP full-frame, a 102 MP
     medium-format back and a 48 MP phone all pass; a 200 MP phone's full-res
     mode and the decompression bomb both do not. */
  var MAX_PIXELS = 80 * 1000 * 1000;

  /* The analyses do NOT run on the whole frame of a large image. They run on a
     crop of it, and the crop is a crop — never a resize.

     That is not laziness. Every measurement below depends on the JPEG 8x8
     grid or on per-pixel noise, and a resample moves every pixel off that grid
     and averages the noise away, so a scaled-down "full frame" view of ELA or
     the noise floor is a picture of the scaler, not of the image. Cropping
     keeps the pixels exactly as the encoder wrote them.
     2400 px on a side is 5.76 M pixels, which is three Float32 arrays of
     23 MB in the noise pass — comfortable — and it is larger than the region
     of a photograph anyone is actually arguing about. Click anywhere on the
     image to move the crop; the report prints the rectangle it used. */
  var ANALYSIS_MAX = 2400;

  /* The FFT runs on a power-of-two window taken from the same place. 256 is
     enough to resolve a period-2 or period-4 ripple, which is what upsampling
     leaves, and small enough that the plot is legible at its own scale rather
     than smeared by the browser's downscaler. */
  var FFT_N = 256;

  /* Copy-move is the one analysis where scaling is fine: it looks for repeated
     CONTENT, not for compression structure, and a duplicated region survives a
     downscale intact. 480 px on the long edge puts the block grid at a few
     thousand blocks rather than a few hundred thousand. */
  var CM_EDGE = 480;

  /* Frames sampled from a video. Nine is enough to see a per-frame jump at a
     blend boundary and few enough that seeking finishes while the visitor is
     still looking at the page. */
  var VIDEO_FRAMES = 9;

  var out = LabTool.out('tool-out');

  var origCanvas = null;   // the pixels as decoded, never written to
  var workCanvas = null;   // what the playground edits and the detector reads
  var srcBytes = null;     // the container bytes, for provenance and DQT
  var srcFile = null;
  var isVideo = false;
  var videoFrames = [];    // { t, canvas } for a sampled video
  var focus = null;        // { x, y } in image space — where the crop centres
  var clicks = [];         // the last two clicked points, for the eye artefact
  var workVersion = 0;     // bumped on every edit, so caches know to expire
  var viewCache = {};
  var previewUrl = null;
  var busy = false;

  function el(id) { return document.getElementById(id); }

  function releasePreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  /* ------------------------------------------------------------------------
     Canvas plumbing
     ------------------------------------------------------------------------ */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function ctxOf(canvas) {
    return canvas.getContext('2d', { willReadFrequently: true });
  }

  function dataOf(canvas) {
    return ctxOf(canvas).getImageData(0, 0, canvas.width, canvas.height);
  }

  function copyCanvas(canvas) {
    var c = makeCanvas(canvas.width, canvas.height);
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c;
  }

  /* A rectangle of at most `maxEdge` on a side, centred on the focus point,
     with both the origin and the size aligned to multiples of 8. The alignment
     is the whole point: an 8-aligned crop of a JPEG contains the same 8x8
     blocks the encoder wrote, so recompressing it lands the quantiser on the
     same coefficients. A crop at an odd offset does not, and the ghost curve
     below turns into noise. */
  function gridRect(w, h, maxEdge, cx, cy) {
    var rw = Math.min(w, maxEdge), rh = Math.min(h, maxEdge);
    rw = Math.max(8, rw - (rw % 8));
    rh = Math.max(8, rh - (rh % 8));
    var x = Math.round(cx - rw / 2), y = Math.round(cy - rh / 2);
    x = Math.max(0, Math.min(w - rw, x));
    y = Math.max(0, Math.min(h - rh, y));
    x -= x % 8;
    y -= y % 8;
    return { x: x, y: y, w: rw, h: rh };
  }

  function analysisRect() {
    if (!workCanvas) return null;
    var f = focus || { x: workCanvas.width / 2, y: workCanvas.height / 2 };
    return gridRect(workCanvas.width, workCanvas.height, ANALYSIS_MAX, f.x, f.y);
  }

  function cropCanvas(rect) {
    var c = makeCanvas(rect.w, rect.h);
    c.getContext('2d').drawImage(workCanvas, rect.x, rect.y, rect.w, rect.h,
                                 0, 0, rect.w, rect.h);
    return c;
  }

  function isCropped(rect) {
    return !!rect && (rect.w !== workCanvas.width || rect.h !== workCanvas.height);
  }

  function luma(imgData) {
    var px = imgData.data, n = imgData.width * imgData.height;
    var l = new Float32Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      l[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    }
    return l;
  }

  function bar(value, max, width) {
    var filled = max > 0 ? Math.round((value / max) * width) : 0;
    if (!isFinite(filled) || filled < 0) filled = 0;
    if (filled > width) filled = width;
    return '█'.repeat(filled) + '·'.repeat(width - filled);
  }

  function median(list) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Section numbers are counted as sections are emitted rather than written
     into the headings. They were hard-coded, and the frame-to-frame section —
     which only exists for a video, and which belongs before the closing
     "look here yourself" checklist in the reading order but after it in the
     numbering — printed "9  FRAME-TO-FRAME" above "8  LOOK HERE YOURSELF" on
     every video. Renumbering by hand would then have left stills running 1-7
     and 9. Counting fixes both at once: a section that does not run does not
     take a number with it. */
  var sectionNo = 0;
  function section(title) {
    sectionNo++;
    out.heading(sectionNo + '  ' + title);
  }

  /* A tiny sequential runner. Half of these analyses need the browser's own
     JPEG encoder and decoder, which are asynchronous, so the report is a chain
     rather than a straight line of calls. Each step is wrapped: one section
     that throws should cost its own section and not the eight below it. A
     forensics tool is fed malformed files by definition, and a blank pane with
     an error only in the console is the worst possible failure here. */
  function series(steps, done) {
    var i = 0;
    function next() {
      if (i >= steps.length) { if (done) done(); return; }
      var step = steps[i++];
      try {
        step(next);
      } catch (err) {
        out.err('  this section could not finish: ' +
                ((err && err.message) || String(err)));
        out.line('');
        next();
      }
    }
    next();
  }

  /* ========================================================================
     1. PROVENANCE — the only thing on this page that is evidence
     ======================================================================== */

  /* The TIFF reader is the one from /labs/exif, cut down to the fields that
     name a writer, and carrying the same two brakes on sub-IFD pointers: a
     depth cap and an offset set. A sub-IFD pointer is a number out of the
     file and nothing in the format stops it pointing at its own directory, so
     without both of these a hostile JPEG recurses until the stack gives out.
     The cycle set catches A -> B -> A, which a depth cap alone only stops
     after eight laps. */
  var TIFF_TAGS = {
    0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model',
    0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist',
    0x013c: 'HostComputer', 0x8298: 'Copyright',
    0x9003: 'DateTimeOriginal', 0x9286: 'UserComment',
    0xa430: 'CameraOwnerName', 0xa433: 'LensMake', 0xa434: 'LensModel',
    0x8769: '__EXIF'
  };
  var MAX_IFD_DEPTH = 8;

  function parseTiff(dv, base, fields) {
    if (base < 0 || base + 8 > dv.byteLength) return;
    var little = dv.getUint16(base, false) === 0x4949;
    if (dv.getUint16(base + 2, little) !== 42) return;
    readIfd(dv, base, base + dv.getUint32(base + 4, little), little, fields, 0, {});
  }

  function readIfd(dv, base, dirStart, little, fields, depth, seen) {
    if (depth > MAX_IFD_DEPTH) return;
    if (dirStart < 0 || dirStart + 2 > dv.byteLength) return;
    if (seen[dirStart]) return;
    seen[dirStart] = true;
    var count = dv.getUint16(dirStart, little);
    for (var i = 0; i < count; i++) {
      var entry = dirStart + 2 + i * 12;
      if (entry + 12 > dv.byteLength) break;
      var name = TIFF_TAGS[dv.getUint16(entry, little)];
      if (!name) continue;
      var value = readValue(dv, base, entry, little);
      if (name === '__EXIF') {
        if (typeof value === 'number') {
          readIfd(dv, base, base + value, little, fields, depth + 1, seen);
        }
        continue;
      }
      if (value !== null && value !== '') fields[name] = value;
    }
  }

  function readValue(dv, base, entry, little) {
    var type = dv.getUint16(entry + 2, little);
    var count = dv.getUint32(entry + 4, little);
    var sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    var unit = sizes[type] || 1;
    var at = unit * count > 4 ? base + dv.getUint32(entry + 8, little) : entry + 8;
    try {
      if (type === 2 || type === 7) {
        var s = '', limit = Math.min(count, 512);
        for (var i = 0; i < limit; i++) {
          var ch = dv.getUint8(at + i);
          if (!ch) break;
          s += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : ' ';
        }
        return s.replace(/^\s+|\s+$/g, '');
      }
      if (type === 3) return dv.getUint16(at, little);
      if (type === 4) return dv.getUint32(at, little);
      return null;
    } catch (err) { return null; }
  }

  function ascii(bytes, start, length) {
    var s = '', end = Math.min(bytes.length, start + length);
    for (var i = start; i < end; i++) {
      var c = bytes[i];
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : (c === 10 ? '\n' : ' ');
    }
    return s;
  }

  function bytesEqual(bytes, at, text) {
    for (var i = 0; i < text.length; i++) {
      if (bytes[at + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  }

  /* Walk a JPEG's marker segments. Everything before the start of scan is
     metadata; the entropy-coded image data after SOS is skipped entirely,
     which is deliberate — a substring search for "Midjourney" across
     compressed pixel data would find one eventually, in noise, and report a
     generator that was never there. */
  function jpegSegments(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var segs = [], off = 2;
    while (off + 4 <= bytes.length) {
      if (bytes[off] !== 0xff) break;
      var marker = bytes[off + 1];
      if (marker === 0xff) { off++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { off += 2; continue; }
      if (marker === 0xda) { segs.push({ marker: marker, start: off + 4, length: 0 }); break; }
      var size = dv.getUint16(off + 2, false);
      if (size < 2 || off + 2 + size > bytes.length) break;
      segs.push({ marker: marker, start: off + 4, length: size - 2 });
      off += 2 + size;
    }
    return segs;
  }

  function pngChunks(bytes) {
    if (bytes.length < 8 || !bytesEqual(bytes, 1, 'PNG')) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var chunks = [], off = 8;
    while (off + 12 <= bytes.length) {
      var length = dv.getUint32(off, false);
      if (length > bytes.length) break;
      var type = ascii(bytes, off + 4, 4);
      chunks.push({ type: type, start: off + 8, length: length });
      if (type === 'IEND') break;
      off += 12 + length;
    }
    return chunks;
  }

  function riffChunks(bytes) {
    if (bytes.length < 16 || !bytesEqual(bytes, 0, 'RIFF') ||
        !bytesEqual(bytes, 8, 'WEBP')) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var chunks = [], off = 12;
    while (off + 8 <= bytes.length) {
      var type = ascii(bytes, off, 4);
      var length = dv.getUint32(off + 4, true);
      if (length > bytes.length) break;
      chunks.push({ type: type, start: off + 8, length: length });
      off += 8 + length + (length % 2);
    }
    return chunks;
  }

  /* Strings that name who wrote a file. A hit is a CLAIM the file makes about
     itself, never a proof: metadata is editable with a text editor, so a hit
     tells you what the file says, and the `means` line is the most that
     licenses you to say out loud. Order matters — the first match wins, so
     provenance standards come before generators, and generators before the
     ordinary editors that half the internet's photographs have been through. */
  var WRITERS = [
    { re: /c2pa|jumbf|contentcredential|content credentials/i,
      what: 'C2PA / Content Credentials',
      means: 'A signed provenance manifest is present. This page does NOT check the signature: verifying one needs a certificate chain and a trust list, which means a network request, and this page makes none. Presence is not validity. Take it to a C2PA verifier before relying on it.' },
    { re: /stable[ -]?diffusion|automatic1111|sd-webui|invokeai|Sampler:|CFG scale/i,
      what: 'a Stable Diffusion pipeline',
      means: 'The metadata carries generation parameters of the kind Automatic1111, InvokeAI and friends write. That is a strong claim of synthetic origin, and it is also the easiest field in the world to paste into an unrelated file.' },
    { re: /comfyui|"class_type"/i,
      what: 'ComfyUI',
      means: 'A ComfyUI workflow graph is embedded. Same caveat: it is a claim written into the file, not a measurement of the pixels.' },
    { re: /midjourney/i, what: 'Midjourney', means: 'The file names Midjourney in its metadata.' },
    { re: /dall[·• .-]?e|openai/i, what: 'OpenAI / DALL-E', means: 'The file names an OpenAI generator in its metadata.' },
    { re: /firefly|adobe generative|generative fill/i, what: 'Adobe Firefly / Generative Fill', means: 'The file names Adobe generative tooling. Note that Generative Fill is often used on a small part of an otherwise ordinary photograph.' },
    { re: /synthid|made with google ai|imagen|nano banana/i, what: 'a Google generator', means: 'The file names Google generative tooling. SynthID itself is an in-pixel watermark that this page cannot read; only Google can.' },
    { re: /black forest labs|flux\.1|ideogram|leonardo\.ai|novelai|recraft|stability\.ai/i,
      what: 'a named image generator', means: 'The file names a generator in its metadata.' },
    { re: /adobe photoshop|photoshop \d|camera raw|lightroom/i,
      what: 'Adobe Photoshop / Lightroom',
      means: 'The file passed through Adobe software. So does most published photography on earth: cropping, colour grading and dust removal all write this string. It says the pixels were edited, not that they were faked.' },
    { re: /affinity photo|pixelmator|luminar|capture one|darktable|rawtherapee|gimp/i,
      what: 'a desktop image editor', means: 'The file passed through an editor. Same reading as Photoshop above: edited, not necessarily faked.' },
    { re: /snapseed|picsart|facetune|faceapp|remini|lensa|meitu|beautyplus|youcam/i,
      what: 'a phone retouching app',
      means: 'These apps reshape faces and skin by default. That is a real, deliberate manipulation of a person’s appearance, and it is also what tens of millions of ordinary selfies have had done to them.' },
    { re: /imagemagick|libvips|graphicsmagick|python-imaging|pillow|sharp \d|libwebp/i,
      what: 'a server-side processing pipeline',
      means: 'Something re-encoded this file automatically — a CMS, an upload handler, a thumbnailer. Expect every pixel-level measurement below to describe that step rather than the original camera.' },
    { re: /skia|chrome|chromium|android|screenshot|screen shot|greenshot|snipping/i,
      what: 'a browser canvas, a screenshot tool or an Android surface',
      means: 'This is very likely a screenshot or a re-save rather than an original file. ELA and the noise floor are close to meaningless on one: the screen capture threw the original compression history away and wrote a fresh one.' }
  ];

  function readProvenance(bytes) {
    var res = { container: 'unrecognised', fields: {}, blocks: [], text: '', hits: [] };
    var i, seg, text;

    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      res.container = 'JPEG';
      var segs = jpegSegments(bytes) || [];
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (i = 0; i < segs.length; i++) {
        seg = segs[i];
        var m = seg.marker;
        if (m === 0xe1 && bytesEqual(bytes, seg.start, 'Exif')) {
          res.blocks.push('APP1 Exif (' + seg.length + ' bytes)');
          parseTiff(dv, seg.start + 6, res.fields);
        } else if (m === 0xe1 && bytesEqual(bytes, seg.start, 'http://ns.adobe.com/xap')) {
          res.blocks.push('APP1 XMP (' + seg.length + ' bytes)');
        } else if (m === 0xeb) {
          // APP11 is where a C2PA manifest lives in a JPEG, wrapped in JUMBF
          // boxes. The 'c2pa' string inside the box is what the WRITERS table
          // then matches on, which is why the payload is also swept into
          // res.text a few lines below.
          res.blocks.push('APP11 JUMBF box (' + seg.length + ' bytes)');
        } else if (m === 0xe2 && bytesEqual(bytes, seg.start, 'ICC_PROFILE')) {
          res.blocks.push('APP2 ICC colour profile (' + seg.length + ' bytes)');
        } else if (m === 0xe2 && bytesEqual(bytes, seg.start, 'MPF')) {
          res.blocks.push('APP2 MPF — a multi-picture container, common on phones');
        } else if (m === 0xed) {
          res.blocks.push('APP13 Photoshop IRB / IPTC (' + seg.length + ' bytes)');
        } else if (m === 0xee) {
          res.blocks.push('APP14 Adobe marker — written by Adobe encoders');
        } else if (m === 0xfe) {
          res.blocks.push('COM comment (' + seg.length + ' bytes)');
        }
        if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) {
          res.text += ascii(bytes, seg.start, Math.min(seg.length, 65536)) + '\n';
        }
      }
    } else if (bytes.length > 8 && bytesEqual(bytes, 1, 'PNG')) {
      res.container = 'PNG';
      var chunks = pngChunks(bytes) || [];
      var pdv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (i = 0; i < chunks.length; i++) {
        var c = chunks[i];
        if (c.type === 'tEXt' || c.type === 'iTXt') {
          text = ascii(bytes, c.start, Math.min(c.length, 65536));
          res.blocks.push(c.type + ' "' + text.split(' ')[0].slice(0, 40) + '"');
          res.text += text + '\n';
        } else if (c.type === 'zTXt') {
          /* The value is raw deflate. There is no inflater in this file and I
             am not shipping one for a metadata field, so the honest thing is
             to say the key is there and the value is unread rather than to
             quietly report "no generator found". */
          res.blocks.push('zTXt "' + ascii(bytes, c.start, 40).split(' ')[0] +
                          '" — value is deflate-compressed and NOT read here');
        } else if (c.type === 'eXIf') {
          res.blocks.push('eXIf chunk (' + c.length + ' bytes)');
          parseTiff(pdv, c.start, res.fields);
        } else if (c.type === 'caBX') {
          res.blocks.push('caBX — a C2PA manifest store');
          res.text += 'c2pa\n';
        }
      }
    } else if (bytes.length > 16 && bytesEqual(bytes, 0, 'RIFF')) {
      res.container = 'WebP';
      var rc = riffChunks(bytes) || [];
      var rdv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (i = 0; i < rc.length; i++) {
        if (rc[i].type === 'EXIF') {
          res.blocks.push('EXIF chunk (' + rc[i].length + ' bytes)');
          // Some writers put the JPEG-style "Exif\0\0" preamble inside the
          // WebP chunk and some start straight at the TIFF header. Both exist
          // in the wild, so check rather than assume.
          parseTiff(rdv, bytesEqual(bytes, rc[i].start, 'Exif') ? rc[i].start + 6
                                                               : rc[i].start, res.fields);
        } else if (rc[i].type === 'XMP ') {
          res.blocks.push('XMP chunk (' + rc[i].length + ' bytes)');
          res.text += ascii(bytes, rc[i].start, Math.min(rc[i].length, 65536)) + '\n';
        } else if (rc[i].type === 'C2PA') {
          res.blocks.push('C2PA chunk');
          res.text += 'c2pa\n';
        }
      }
    }

    var haystack = res.text;
    for (var k in res.fields) {
      if (Object.prototype.hasOwnProperty.call(res.fields, k)) {
        haystack += '\n' + res.fields[k];
      }
    }
    for (i = 0; i < WRITERS.length; i++) {
      if (WRITERS[i].re.test(haystack)) res.hits.push(WRITERS[i]);
    }
    return res;
  }

  function reportProvenance() {
    section('PROVENANCE — what the file says about itself');
    out.dim('   The only thing on this page that is evidence rather than a hint.');
    out.line('');

    if (isVideo) {
      out.warn('   This is a video. Container-level metadata is not read here:');
      out.warn('   the browser gives this page decoded frames, not the MP4 boxes,');
      out.warn('   so a C2PA manifest or an encoder name in the container is');
      out.warn('   invisible to it. Run the file through the file inspector at');
      out.warn('   /labs/file-inspector if you need to see the container.');
      out.line('');
      return;
    }

    var p = readProvenance(srcBytes);
    out.row('container', p.container);
    if (!p.blocks.length) {
      out.warn('   No metadata blocks at all.');
      out.line('');
      out.dim('   THIS MEANS NOTHING BY ITSELF. Every large platform strips');
      out.dim('   metadata on upload — WhatsApp, Instagram, X, Facebook, most');
      out.dim('   chat apps — and so does every screenshot. A photograph that');
      out.dim('   has been anywhere near the internet is expected to look like');
      out.dim('   this. Absence of provenance is not evidence of anything.');
    } else {
      var i;
      for (i = 0; i < p.blocks.length; i++) out.row('block', p.blocks[i]);
      var keys = Object.keys(p.fields);
      if (keys.length) {
        out.line('');
        for (i = 0; i < keys.length; i++) out.row(keys[i], p.fields[keys[i]]);
      }
    }

    if (p.hits.length) {
      out.line('');
      out.heading('   Named in the metadata');
      for (var h = 0; h < p.hits.length; h++) {
        out.line('   • ' + p.hits[h].what, 't-warn');
        wrapDim('     ', p.hits[h].means);
      }
    } else if (p.blocks.length) {
      out.line('');
      out.dim('   Nothing in the metadata names a generator or an editor. That');
      out.dim('   is also not evidence: the fields are optional, and anyone who');
      out.dim('   wanted them gone would have removed them in one command.');
    }
    out.line('');
  }

  /* Wrap a sentence into the terminal's width with a fixed left margin. The
     panes are monospace and do not wrap themselves, so a long explanation
     rendered as one line simply ran off the right edge and was never read. */
  function wrapDim(indent, text, cls) {
    var width = 74 - indent.length;
    var words = String(text).split(/\s+/);
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (line && (line + ' ' + words[i]).length > width) {
        out.line(indent + line, cls || 't-dim');
        line = words[i];
      } else {
        line = line ? line + ' ' + words[i] : words[i];
      }
    }
    if (line) out.line(indent + line, cls || 't-dim');
  }

  /* ========================================================================
     2. ERROR LEVEL ANALYSIS
     ======================================================================== */

  /* ELA is the most misread technique in this whole field, so the tool prints
     the caveat before the picture rather than after it.

     What it does: re-encode the image at a known JPEG quality, subtract, and
     amplify. Regions that were already compressed near that quality change
     very little; regions that were not change more. That is a map of
     COMPRESSION HISTORY. It is not a map of manipulation, and the popular
     reading — "bright means pasted" — is wrong often enough to be dangerous.
     Sharp edges, saturated colour and fine texture are bright in every ELA of
     every untouched photograph.

     The amplification factor is printed with the image, because the single
     most common way ELA is used to mislead is to turn the gain up until
     something looks bright and then show the picture without the number. */
  function computeEla(cb) {
    var rect = analysisRect();
    var src = cropCanvas(rect);
    var base = dataOf(src).data;
    var img = new Image();
    img.onload = function () {
      var re = makeCanvas(src.width, src.height);
      re.getContext('2d').drawImage(img, 0, 0);
      var cmp = dataOf(re).data;
      var outC = makeCanvas(src.width, src.height);
      var octx = ctxOf(outC);
      var od = octx.createImageData(src.width, src.height);
      var i, d, peak = 0, sum = 0;
      var diff = new Uint8Array(base.length / 4 * 3);
      for (i = 0, d = 0; i < base.length; i += 4, d += 3) {
        diff[d] = Math.abs(base[i] - cmp[i]);
        diff[d + 1] = Math.abs(base[i + 1] - cmp[i + 1]);
        diff[d + 2] = Math.abs(base[i + 2] - cmp[i + 2]);
        var mx = Math.max(diff[d], diff[d + 1], diff[d + 2]);
        if (mx > peak) peak = mx;
        sum += mx;
      }
      /* Auto-gain, clamped. Scaling so the single brightest pixel hits white
         makes a flat image look dramatic and a contrasty one look empty, so
         the gain is bounded to a range a reader can hold in their head, and
         then printed. */
      var gain = peak > 0 ? 255 / peak : 1;
      if (gain < 4) gain = 4;
      if (gain > 40) gain = 40;
      for (i = 0, d = 0; i < base.length; i += 4, d += 3) {
        od.data[i] = Math.min(255, diff[d] * gain);
        od.data[i + 1] = Math.min(255, diff[d + 1] * gain);
        od.data[i + 2] = Math.min(255, diff[d + 2] * gain);
        od.data[i + 3] = 255;
      }
      octx.putImageData(od, 0, 0);
      cb(outC, {
        rect: rect, gain: gain, peak: peak,
        mean: sum / (base.length / 4)
      });
    };
    img.onerror = function () { cb(null, null); };
    img.src = src.toDataURL('image/jpeg', 0.90);
  }

  function reportEla(next) {
    section('ERROR LEVEL ANALYSIS');
    computeEla(function (canvas, stats) {
      if (!canvas) {
        out.err('   The browser could not re-encode this image, so there is no ELA.');
        out.line('');
        next();
        return;
      }
      viewCache.ela = { canvas: canvas, rect: stats.rect, version: workVersion };
      out.row('region', rectLabel(stats.rect));
      out.row('re-encoded at', 'JPEG quality 90');
      out.row('amplification', '×' + stats.gain.toFixed(1) +
              '  (auto, clamped to ×4–×40)');
      out.row('mean difference', stats.mean.toFixed(2) + ' of 255');
      out.row('peak difference', stats.peak + ' of 255');
      out.line('');
      out.dim('   Pick "Error level analysis" in the view menu to see the map.');
      out.line('');
      out.warn('   Read this correctly or do not read it at all:');
      wrapDim('   ', 'ELA shows recompression, not manipulation. Bright regions are regions whose compression history differs from the rest — and sharp edges, saturated colour and fine texture are bright in the ELA of every untouched photograph ever taken.');
      wrapDim('   ', 'It is useless on a screenshot, on a PNG, and on anything that has been re-saved once since the edit you are looking for: the last save flattens the whole frame to one history and erases the difference you came to find.');
      wrapDim('   ', 'Uniform brightness does not mean the image is unedited. A great many convincing edits leave no ELA signature at all.');
      wrapDim('   ', 'And treat the mean above as a description of the file, not as a detector. It is an average over every pixel in the region, so a change confined to one part of the frame barely moves it — pasting a heavily recompressed box into a textured photograph here shifted it by 0.1 while the block count in section 5 went from 3 to 51. Look at the map for anything local. Numbers are for things that changed everywhere.');
      out.line('');
      next();
    });
  }

  function rectLabel(rect) {
    if (!isCropped(rect)) return rect.w + '×' + rect.h + '  (whole frame)';
    return rect.w + '×' + rect.h + ' crop at ' + rect.x + ',' + rect.y +
           '  (click the image to move it)';
  }

  /* ========================================================================
     3. JPEG QUANTISATION TABLES
     ======================================================================== */

  /* The tables in ITU-T T.81 Annex K, in natural (raster) order. DQT stores
     its tables in zigzag order, so the parsed table is de-zigzagged before it
     is compared with these. */
  var STD_LUMA = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99
  ];
  var STD_CHROMA = [
    17, 18, 24, 47, 99, 99, 99, 99,
    18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99
  ];
  var ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
  ];

  function readDqt(bytes) {
    var segs = jpegSegments(bytes);
    if (!segs) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var tables = [], sof = null, i, j;
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.marker === 0xdb) {
        var at = s.start, end = s.start + s.length;
        while (at < end) {
          var pq = bytes[at] >> 4, tq = bytes[at] & 15;
          at++;
          var table = new Array(64);
          for (j = 0; j < 64; j++) {
            table[ZIGZAG[j]] = pq ? dv.getUint16(at + j * 2, false) : bytes[at + j];
          }
          at += pq ? 128 : 64;
          tables.push({ id: tq, precision: pq ? 16 : 8, table: table });
        }
      } else if ((s.marker >= 0xc0 && s.marker <= 0xcf) &&
                 s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc) {
        var comps = bytes[s.start + 5], sampling = [];
        for (j = 0; j < comps && j < 4; j++) {
          sampling.push((bytes[s.start + 6 + j * 3 + 1] >> 4) + 'x' +
                        (bytes[s.start + 6 + j * 3 + 1] & 15));
        }
        sof = {
          progressive: s.marker === 0xc2,
          components: comps,
          sampling: sampling
        };
      }
    }
    return { tables: tables, sof: sof };
  }

  /* libjpeg builds a table as  Q[i] = clamp((STD[i]*scale + 50) / 100, 1, 255)
     with INTEGER division, and scale = q < 50 ? 5000/q : 200 - 2q. Inverting
     that per coefficient and taking the median gets close, but not reliably
     closer than a step: the truncation throws away up to 99/100 of a unit at
     every one of 64 coefficients, and inverting the median of what survives
     landed one quality low on 7 of the 79 settings I checked it against
     (49, 63, 71, 74, 81, 88, 90 all came back as q+1).

     So the median is a seed, not the answer. Rebuilding the table at each
     nearby setting and comparing all 64 entries is exact by construction, and
     three steps either side covers the worst error the seed produced. If none
     of them reproduces the table, the encoder was not scaling the Annex K
     tables at all, and the seed is reported as an approximation. */
  function ijgQuality(table, std) {
    var scales = [], i;
    for (i = 0; i < 64; i++) {
      if (table[i] <= 1 || table[i] >= 255) continue;
      scales.push((table[i] * 100 - 50) / std[i]);
    }
    /* Every coefficient clamped, which for the Annex K tables means a table of
       all ones: quality 100. There is no scale left to invert, so fall back to
       reconstructing each setting until one reproduces the table. This is the
       degenerate case, so the exhaustive sweep costs nothing worth counting. */
    if (!scales.length) {
      for (var f = 100; f >= 1; f--) {
        if (tableMatches(table, std, f)) return { quality: f, exact: true };
      }
      return null;
    }
    var scale = median(scales);
    var seed = scale > 100 ? 5000 / scale : (200 - scale) / 2;
    seed = Math.round(Math.max(1, Math.min(100, seed)));
    for (var d = 0; d <= 3; d++) {
      for (var s = -1; s <= 1; s += 2) {
        var q = seed + d * s;
        if (q < 1 || q > 100) continue;
        if (tableMatches(table, std, q)) return { quality: q, exact: true };
        if (d === 0) break;
      }
    }
    return { quality: seed, exact: false };
  }

  function tableMatches(table, std, q) {
    var scale = q < 50 ? 5000 / q : 200 - 2 * q;
    for (var i = 0; i < 64; i++) {
      var v = Math.floor((std[i] * scale + 50) / 100);
      if (v < 1) v = 1;
      if (v > 255) v = 255;
      if (v !== table[i]) return false;
    }
    return true;
  }

  /* FNV-1a over the table bytes. Not a security hash — a short label, so two
     files can be compared by eye without printing 128 numbers twice. */
  function tableHash(table) {
    var h = 0x811c9dc5;
    for (var i = 0; i < 64; i++) {
      h ^= table[i] & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function reportQuant() {
    section('JPEG QUANTISATION TABLES');
    if (isVideo || !srcBytes || srcBytes[0] !== 0xff || srcBytes[1] !== 0xd8) {
      out.dim('   Not a JPEG, so there are no tables to read. PNG and WebP');
      out.dim('   quantise differently or not at all, and a video frame reaches');
      out.dim('   this page already decoded.');
      out.line('');
      return;
    }
    var q = readDqt(srcBytes);
    if (!q || !q.tables.length) {
      out.warn('   No DQT segment found. That is unusual for a baseline JPEG.');
      out.line('');
      return;
    }
    if (q.sof) {
      out.row('encoding', q.sof.progressive ? 'progressive' : 'baseline');
      out.row('components', q.sof.components);
      if (q.sof.sampling.length) {
        out.row('sampling factors', q.sof.sampling.join(', '));
        var sub = q.sof.sampling[0];
        out.dim('   ' + (sub === '2x2' ? '4:2:0 — the ordinary camera and web setting.' :
                sub === '2x1' ? '4:2:2 — common in video stills and some editors.' :
                sub === '1x1' ? '4:4:4 — no chroma subsampling. Unusual for a camera; ' +
                                'typical of screenshots and of editor exports at maximum quality.' :
                'an unusual sampling factor.'));
      }
    }
    out.line('');
    var anyExact = false, anyNot = false;
    for (var t = 0; t < q.tables.length && t < 4; t++) {
      var tab = q.tables[t];
      var std = tab.id === 0 ? STD_LUMA : STD_CHROMA;
      var est = ijgQuality(tab.table, std);
      out.row('table ' + tab.id, (tab.id === 0 ? 'luminance' : 'chrominance') +
              ', ' + tab.precision + '-bit, fingerprint ' + tableHash(tab.table));
      if (est) {
        out.row('  implied quality', est.quality + (est.exact ? '  (exact IJG match)' :
                                                    '  (approximate — not an IJG table)'));
        if (est.exact) anyExact = true; else anyNot = true;
      }
      /* Four rows of the table, which is enough to see its shape without
         turning the pane into a spreadsheet. The top-left corner is the low
         frequencies, and it is where the differences between encoders live. */
      for (var r = 0; r < 4; r++) {
        var row = '   ';
        for (var c = 0; c < 8; c++) {
          var v = String(tab.table[r * 8 + c]);
          row += '    '.slice(v.length) + v;
        }
        out.dim(row);
      }
      out.dim('   … (first 4 of 8 rows)');
      out.line('');
    }
    if (anyExact) {
      wrapDim('   ', 'An exact IJG match means the table was produced by scaling the standard Annex K table — which is what libjpeg, GD, Pillow, ImageMagick, most web servers and most browsers do. It tells you a general-purpose encoder wrote this file. It does not tell you what the file contains.');
    }
    if (anyNot) {
      wrapDim('   ', 'A table that is not an IJG scaling was written by an encoder carrying its own tables. Camera makers, Adobe and Apple all ship their own sets, so this often points at a camera original or an Adobe/Apple save rather than a web pipeline. Matching it to a specific device needs a reference database of tables, which this page does not have and will not fetch.');
    }
    out.line('');
  }

  /* ========================================================================
     4. DOUBLE COMPRESSION — the JPEG ghost curve
     ======================================================================== */

  /* Recompress the image across a sweep of qualities and measure how far each
     result moves. An image compressed once falls smoothly towards its own
     quality. An image compressed at q0 and then re-saved at a higher q1 keeps
     a dip at q0 — the "ghost" — because re-quantising at the quality it
     already carries changes almost nothing.

     The sweep runs on a small grid-aligned crop, never on a resized copy: a
     resample shifts every pixel off the 8x8 grid the ghost lives on and the
     curve collapses into a straight line. */
  function ghostSweep(cb) {
    var f = focus || { x: workCanvas.width / 2, y: workCanvas.height / 2 };
    var rect = gridRect(workCanvas.width, workCanvas.height, 512, f.x, f.y);
    var crop = cropCanvas(rect);
    var base = dataOf(crop).data;
    var qs = [], i;
    for (i = 40; i <= 96; i += 4) qs.push(i);
    var results = [], n = 0;
    function step() {
      if (n >= qs.length) { cb(qs, results, rect); return; }
      var quality = qs[n++];
      var img = new Image();
      img.onload = function () {
        var c2 = makeCanvas(crop.width, crop.height);
        c2.getContext('2d').drawImage(img, 0, 0);
        var d = dataOf(c2).data;
        var sum = 0;
        for (var p = 0; p < base.length; p += 4) {
          sum += Math.abs(base[p] - d[p]) +
                 Math.abs(base[p + 1] - d[p + 1]) +
                 Math.abs(base[p + 2] - d[p + 2]);
        }
        results.push(sum / (base.length / 4 * 3));
        step();
      };
      img.onerror = function () { results.push(NaN); step(); };
      img.src = crop.toDataURL('image/jpeg', quality / 100);
    }
    step();
  }

  function reportGhost(next) {
    section('DOUBLE-COMPRESSION INDICATORS (JPEG ghost)');
    ghostSweep(function (qs, vals, rect) {
      var i, lo = Infinity, hi = -Infinity, minAt = -1;
      for (i = 0; i < vals.length; i++) {
        if (!isFinite(vals[i])) continue;
        if (vals[i] < lo) { lo = vals[i]; minAt = i; }
        if (vals[i] > hi) hi = vals[i];
      }
      if (minAt < 0) {
        out.err('   The recompression sweep produced nothing readable.');
        out.line('');
        next();
        return;
      }
      out.row('region', rect.w + '×' + rect.h + ' at ' + rect.x + ',' + rect.y);
      out.line('');
      for (i = 0; i < vals.length; i++) {
        var label = 'q' + qs[i];
        var marker = i === minAt ? '  ◀ lowest' : '';
        out.line('   ' + label + '  ' +
                 bar(hi - vals[i], hi - lo, 34) + '  ' +
                 vals[i].toFixed(2) + marker,
                 i === minAt ? 't-ok' : 't-dim');
      }
      out.line('');
      /* A second, shallower dip below the global minimum is the interesting
         case. "Local" here means strictly lower than both neighbours, at least
         two steps away from the global minimum, and within 25% of its depth —
         anything shallower than that is sampling noise on a 512px crop. */
      var ghosts = [];
      for (i = 1; i < vals.length - 1; i++) {
        if (i === minAt || Math.abs(i - minAt) < 2) continue;
        if (vals[i] < vals[i - 1] && vals[i] < vals[i + 1] &&
            vals[i] - lo < (hi - lo) * 0.25) {
          ghosts.push(qs[i]);
        }
      }
      /* Deliberately NOT reporting where the curve is lowest.
         The difference falls as the test quality rises, for the trivial reason
         that re-encoding at a higher quality changes fewer coefficients — so
         the minimum sits at the top of the sweep on essentially every file,
         and an earlier draft of this printed "closest match at quality 96" as
         though it had discovered something. It had discovered the shape of the
         experiment. Only a departure from that fall carries information. */
      out.dim('   The curve falls as the test quality rises; that much is');
      out.dim('   arithmetic, not evidence. A DIP against that trend is the');
      out.dim('   part worth reading.');
      out.line('');
      if (ghosts.length) {
        out.line('   Secondary dip at quality ' + ghosts.join(', '), 't-warn');
        out.line('');
        wrapDim('   ', 'A second dip is consistent with the image having been compressed once at that quality and saved again later. It is CONSISTENT WITH, not evidence of, editing: cropping, rotating, a messaging app, a CMS thumbnailer and simply opening and re-saving a file all produce exactly the same double history, and none of them changes what the picture shows.');
      } else {
        out.dim('   No clear secondary dip in this crop.');
        out.line('');
        wrapDim('   ', 'That does not mean the image was compressed once. The ghost disappears when the second save was at a much higher quality than the first, when the region was resized, and whenever the crop under test is flat. Absence here is close to meaningless.');
      }
      out.line('');
      next();
    });
  }

  /* ========================================================================
     5. NOISE FLOOR
     ======================================================================== */

  /* Every sensor writes a faint, roughly uniform grain over the whole frame —
     the physical origin of PRNU-based camera identification. Real PRNU work
     correlates a frame against a reference pattern built from dozens of images
     from the same camera body. That is not possible from one dropped file, so
     this does the much weaker thing it honestly can: measure how much fine
     high-frequency energy each region carries relative to how much structure
     it contains, and mark the regions that disagree with the rest of the
     frame.

     The normalisation by local structure is the part that matters. Raw noise
     variance is dominated by texture: foliage measures high and a clear sky
     measures near zero in every photograph, so an un-normalised map is a map
     of what is in the picture. Dividing fine detail (a Laplacian) by coarse
     structure (a Sobel over a blurred copy) removes most of that, and what is
     left is closer to "how grainy is this region for how busy it is". Only
     most of it, though, which is why the output says look here rather than
     found something. */
  function noiseAnalysis() {
    var rect = analysisRect();
    var crop = cropCanvas(rect);
    var w = crop.width, h = crop.height;
    var lum = luma(dataOf(crop));
    var i, x, y;

    var blur = new Float32Array(w * h);
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        blur[i] = (lum[i - w - 1] + lum[i - w] + lum[i - w + 1] +
                   lum[i - 1] + lum[i] + lum[i + 1] +
                   lum[i + w - 1] + lum[i + w] + lum[i + w + 1]) / 9;
      }
    }
    /* Replicate the border. The blur loop cannot write the outermost ring, so
       it stayed at zero — and the Sobel below reads that ring, which turned a
       flat sky at the edge of the crop into a step from 0 to 130 and gave the
       first and last block of every row a colossal structure reading. The
       symptom was unmistakable once the numbers were on screen: on a perfectly
       ordinary test image the six strongest "regions whose noise floor
       disagrees with the frame" were 864,0 and 0,0 and 864,32 — the corners,
       every time, on every image. A tool that always accuses the edges is
       worse than one that says nothing. */
    for (x = 0; x < w; x++) {
      blur[x] = blur[w + (x === 0 ? 1 : x === w - 1 ? w - 2 : x)];
      blur[(h - 1) * w + x] = blur[(h - 2) * w + (x === 0 ? 1 : x === w - 1 ? w - 2 : x)];
    }
    for (y = 0; y < h; y++) {
      blur[y * w] = blur[y * w + 1];
      blur[y * w + w - 1] = blur[y * w + w - 2];
    }

    var hp = new Float32Array(w * h);
    var ed = new Float32Array(w * h);
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        hp[i] = Math.abs(lum[i] - blur[i]);
        var gx = blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1] -
                 blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1];
        var gy = blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1] -
                 blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1];
        ed[i] = Math.sqrt(gx * gx + gy * gy) / 8;
      }
    }

    var B = 32;
    var bw = Math.floor(w / B), bh = Math.floor(h / B);
    var blocks = [], scores = [];
    for (var by = 0; by < bh; by++) {
      for (var bx = 0; bx < bw; bx++) {
        var sh = 0, se = 0, n = 0;
        for (y = by * B + 1; y < by * B + B - 1; y++) {
          for (x = bx * B + 1; x < bx * B + B - 1; x++) {
            i = y * w + x;
            sh += hp[i];
            se += ed[i];
            n++;
          }
        }
        var ratio = (sh / n + 0.5) / (se / n + 4);
        var s = Math.log(ratio);
        blocks.push({ bx: bx, by: by, hp: sh / n, ed: se / n, score: s });
        scores.push(s);
      }
    }

    var med = median(scores);
    var devs = [];
    for (i = 0; i < scores.length; i++) devs.push(Math.abs(scores[i] - med));
    var mad = median(devs) * 1.4826 + 1e-6;
    var outliers = [];
    for (i = 0; i < blocks.length; i++) {
      blocks[i].z = (blocks[i].score - med) / mad;
      if (Math.abs(blocks[i].z) > 3.5) outliers.push(blocks[i]);
    }
    outliers.sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z); });

    return {
      rect: rect, crop: crop, w: w, h: h, hp: hp, block: B,
      blocks: blocks, outliers: outliers, median: med, mad: mad
    };
  }

  function renderNoiseResidual(a) {
    var c = makeCanvas(a.w, a.h);
    var ctx = ctxOf(c);
    var img = ctx.createImageData(a.w, a.h);
    /* Fixed gain of 12 rather than auto: the point of this view is to compare
       one region against another, and an auto-gain that moves with the frame
       makes two runs incomparable. 12 puts an ordinary sensor grain at a
       readable mid-grey. */
    for (var i = 0, p = 0; i < a.hp.length; i++, p += 4) {
      var v = Math.min(255, a.hp[i] * 12);
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function renderNoiseMap(a) {
    var c = copyCanvas(a.crop);
    var ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
    ctx.fillRect(0, 0, a.w, a.h);
    for (var i = 0; i < a.outliers.length; i++) {
      var b = a.outliers[i];
      var alpha = Math.min(0.55, 0.15 + (Math.abs(b.z) - 3.5) / 14);
      ctx.fillStyle = b.z > 0 ? 'rgba(248, 113, 113, ' + alpha + ')'
                              : 'rgba(96, 165, 250, ' + alpha + ')';
      ctx.fillRect(b.bx * a.block, b.by * a.block, a.block, a.block);
    }
    return c;
  }

  function reportNoise() {
    section('NOISE FLOOR');
    var a = noiseAnalysis();
    viewCache.noise = { canvas: renderNoiseResidual(a), rect: a.rect, version: workVersion };
    viewCache.noisemap = { canvas: renderNoiseMap(a), rect: a.rect, version: workVersion };
    out.row('region', rectLabel(a.rect));
    out.row('blocks measured', a.blocks.length + ' of ' + a.block + '×' + a.block + ' px');
    out.row('disagreeing blocks', a.outliers.length +
            ' (' + (a.outliers.length / a.blocks.length * 100).toFixed(1) + '%)');
    out.line('');
    if (a.outliers.length) {
      out.dim('   The strongest, in original image coordinates:');
      for (var i = 0; i < a.outliers.length && i < 6; i++) {
        var b = a.outliers[i];
        var at = (a.rect.x + b.bx * a.block) + ',' + (a.rect.y + b.by * a.block);
        out.line('   ' + (at.length >= 12 ? at + '  ' : (at + '            ').slice(0, 14)) +
                 (b.z > 0 ? 'grainier' : 'smoother') +
                 ' than the frame explains, z = ' + b.z.toFixed(1),
                 b.z > 0 ? 't-warn' : 't-info');
      }
      out.line('');
      wrapDim('   ', 'Click one of those coordinates on the image and use the magnifier view. A smoother-than-expected block is what a denoised, generated or heavily retouched region looks like; it is also what a defocused background, a flat wall and any part of a photograph shot at low ISO look like.');
    } else {
      out.dim('   No block disagrees with the frame by more than 3.5 MADs.');
      out.line('');
      wrapDim('   ', 'That is the ordinary result and it is not a clean bill of health. A whole-frame re-encode, a resize, or a generator that produced the entire image at once all give a perfectly consistent noise floor, because there is only one history in the file.');
    }
    out.line('');
    wrapDim('   ', 'What this is not: PRNU camera identification. That correlates a frame against a sensor fingerprint built from dozens of images off the same body, which cannot be done from one dropped file. This measures internal consistency only.');
    out.line('');
  }

  /* ========================================================================
     6. FREQUENCY DOMAIN
     ======================================================================== */

  /* Iterative radix-2 Cooley-Tukey, in place, n a power of two. */
  function fft(re, im, n) {
    var i, j = 0, k, len, bit, tr, ti;
    for (i = 1; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        tr = re[i]; re[i] = re[j]; re[j] = tr;
        ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      var half = len >> 1;
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < half; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + half] * cr - im[i + k + half] * ci;
          var vi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ur + vr;
          im[i + k] = ui + vi;
          re[i + k + half] = ur - vr;
          im[i + k + half] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  function fftAnalysis() {
    var f = focus || { x: workCanvas.width / 2, y: workCanvas.height / 2 };
    var n = FFT_N;
    while (n > Math.min(workCanvas.width, workCanvas.height)) n >>= 1;
    if (n < 32) return null;
    var rect = gridRect(workCanvas.width, workCanvas.height, n, f.x, f.y);
    rect.w = n; rect.h = n;
    rect.x = Math.max(0, Math.min(workCanvas.width - n, rect.x));
    rect.y = Math.max(0, Math.min(workCanvas.height - n, rect.y));
    var crop = cropCanvas(rect);
    var lum = luma(dataOf(crop));

    /* A Hann window before the transform. Without one, the crop's four edges
       are a step discontinuity, and a step is broadband: the plot came out
       with a bright cross straight through the centre in every single image,
       which reads exactly like a periodic artefact and is nothing but the
       rectangle the crop was cut with. */
    var win = new Float64Array(n);
    var i, x, y;
    for (i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));

    var re = new Float64Array(n * n), im = new Float64Array(n * n);
    var mean = 0;
    for (i = 0; i < lum.length; i++) mean += lum[i];
    mean /= lum.length;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        re[y * n + x] = (lum[y * n + x] - mean) * win[x] * win[y];
      }
    }

    var rowRe = new Float64Array(n), rowIm = new Float64Array(n);
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) { rowRe[x] = re[y * n + x]; rowIm[x] = im[y * n + x]; }
      fft(rowRe, rowIm, n);
      for (x = 0; x < n; x++) { re[y * n + x] = rowRe[x]; im[y * n + x] = rowIm[x]; }
    }
    for (x = 0; x < n; x++) {
      for (y = 0; y < n; y++) { rowRe[y] = re[y * n + x]; rowIm[y] = im[y * n + x]; }
      fft(rowRe, rowIm, n);
      for (y = 0; y < n; y++) { re[y * n + x] = rowRe[y]; im[y * n + x] = rowIm[y]; }
    }

    // Log magnitude, with the origin moved to the centre so the plot reads.
    var mag = new Float64Array(n * n);
    var half = n >> 1;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        var sx = (x + half) % n, sy = (y + half) % n;
        var k = y * n + x;
        mag[sy * n + sx] = Math.log(1 + Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      }
    }

    /* Peaks. Three things are excluded before anything is called a peak: the
       centre disc, which is the image's own low-frequency content; the axis
       cross, which is ordinary horizontal and vertical structure — a fence, a
       building, a horizon; and six bins either side of each axis rather than
       three, because a Hann window still leaks that far and the leak is what
       gets mistaken for a signal.

       The score is measured against the RADIAL background, not against the
       whole plane. Natural images fall off roughly as 1/f, so the plane's mean
       and standard deviation are dominated by that slope: scoring against them
       made a plain gradient with no periodicity at all come out at z = 42
       while a genuine period-4 checkerboard scored 25, because the gradient's
       floor was so flat that its own leakage towered over it. Comparing each
       bin with the median of its own radius ring removes the slope, and a
       median absolute deviation rather than a standard deviation keeps the
       peak we are hunting for from inflating the spread it is measured
       against. */
    var rings = [], ri, dx, dy, r;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        dx = x - half; dy = y - half;
        r = Math.sqrt(dx * dx + dy * dy);
        if (r < n / 16 || r > half - 1) continue;
        if (Math.abs(dx) < 6 || Math.abs(dy) < 6) continue;
        ri = Math.round(r);
        if (!rings[ri]) rings[ri] = [];
        rings[ri].push(mag[y * n + x]);
      }
    }
    var ringMed = [], ringMad = [];
    for (ri = 0; ri < rings.length; ri++) {
      if (!rings[ri] || rings[ri].length < 8) continue;
      var med = median(rings[ri]);
      var devs = [];
      for (var d2 = 0; d2 < rings[ri].length; d2++) devs.push(Math.abs(rings[ri][d2] - med));
      ringMed[ri] = med;
      ringMad[ri] = median(devs) * 1.4826 + 1e-6;
    }

    var bestZ = 0, px = 0, py = 0, peak = 0;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        dx = x - half; dy = y - half;
        r = Math.sqrt(dx * dx + dy * dy);
        if (r < n / 16 || r > half - 1) continue;
        if (Math.abs(dx) < 6 || Math.abs(dy) < 6) continue;
        ri = Math.round(r);
        if (ringMed[ri] === undefined) continue;
        var z = (mag[y * n + x] - ringMed[ri]) / ringMad[ri];
        if (z > bestZ) { bestZ = z; px = dx; py = dy; peak = mag[y * n + x]; }
      }
    }
    /* A delta against a nearly flat ring produces an enormous ratio — a
       synthetic period-4 checkerboard measures in the tens of thousands here,
       against about 2.5 for an image with no periodicity at all. The
       separation is the useful part; the magnitude past a few hundred is not,
       and printing "z = 41779.7" would be exactly the invented precision this
       page exists to avoid. So it is clamped for display. */
    return {
      rect: rect, n: n, mag: mag, peak: peak,
      z: Math.min(bestZ, 999),
      clamped: bestZ >= 999,
      /* The axis periods rather than the wavelength along the wave vector:
         "it repeats every 4 px across" is something a reader can go and check
         against the picture, and 2.83 px along a diagonal is not. */
      periodX: px ? n / Math.abs(px) : 0,
      periodY: py ? n / Math.abs(py) : 0,
      px: px, py: py
    };
  }

  /* Is this period one of 8, 4, 2.67, 2 — that is, 8/k for a small whole k?
     Those are the bins the JPEG 8x8 block grid and its harmonics occupy. So,
     unfortunately, are a period-2 and a period-4 resampling ripple, and a
     magnitude plot cannot separate the two. Saying that out loud is the whole
     reason this predicate exists as its own function. */
  function dividesEight(period) {
    if (!period || period < 1.9 || period > 8.6) return false;
    var k = 8 / period;
    return Math.abs(k - Math.round(k)) < 0.12;
  }

  function renderFft(a) {
    var n = a.n;
    var c = makeCanvas(n, n);
    var ctx = ctxOf(c);
    var img = ctx.createImageData(n, n);
    var sorted = [], i;
    for (i = 0; i < a.mag.length; i += 7) sorted.push(a.mag[i]);
    sorted.sort(function (x, y) { return x - y; });
    var lo = sorted[Math.floor(sorted.length * 0.30)] || 0;
    var hi = sorted[Math.floor(sorted.length * 0.999)] || (lo + 1);
    var span = Math.max(1e-6, hi - lo);
    for (i = 0; i < a.mag.length; i++) {
      var v = Math.max(0, Math.min(1, (a.mag[i] - lo) / span));
      // A cool-to-warm ramp: dark blue floor, teal midtones, amber peaks.
      img.data[i * 4] = Math.round(255 * Math.pow(v, 1.7));
      img.data[i * 4 + 1] = Math.round(220 * Math.pow(v, 1.1));
      img.data[i * 4 + 2] = Math.round(90 + 120 * v);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function reportFft() {
    section('FREQUENCY DOMAIN');
    var a = fftAnalysis();
    if (!a) {
      out.dim('   The image is smaller than 32 px on a side, so there is no');
      out.dim('   window to transform.');
      out.line('');
      return;
    }
    viewCache.fft = { canvas: renderFft(a), rect: null, version: workVersion };
    out.row('window', a.n + '×' + a.n + ' at ' + a.rect.x + ',' + a.rect.y +
            '  (Hann windowed)');
    out.row('strongest off-axis peak', 'z = ' + (a.clamped ? '999+' : a.z.toFixed(1)) +
            ' above its own radius ring');
    /* The period of the strongest bin is only printed once that bin has been
       called a peak. Below the threshold it is the loudest point in a field of
       noise, and printing "it repeats every 2.3 px" beside "no periodicity
       found" invites a reader to take the number anyway. */
    if (a.z > 8 && a.periodX > 0 && a.periodY > 0) {
      out.row('  it repeats every', a.periodX.toFixed(1) + ' px across and ' +
              a.periodY.toFixed(1) + ' px down');
    }
    out.dim('   For reference: an image with no periodic structure at all');
    out.dim('   measures about z = 2 to 3 here.');
    out.line('');
    if (a.z > 8) {
      out.warn('   There is a strong periodic component in this window.');
      out.line('');
      if (dividesEight(a.periodX) || dividesEight(a.periodY)) {
        wrapDim('   ', 'That period divides 8, which is where the JPEG block grid and its harmonics sit. On a JPEG that is very probably all this is, and it means nothing beyond "this file was compressed".');
        wrapDim('   ', 'It is also, honestly, where a period-2 or period-4 resampling ripple lands. A magnitude plot cannot separate the two, so this reading does not distinguish them and I am not going to pretend it does.');
      } else {
        wrapDim('   ', 'Periodic structure at this scale is what a resampling or transposed-convolution layer leaves — the checkerboard older GAN-era generators were known for. It is also what a resize, a photograph of a screen, a halftone print, a fabric weave, a window screen, a brick wall and a sharpening filter leave. Look at the picture before you read anything into this.');
      }
    } else {
      out.ok('   No strong off-axis periodicity in this window.');
    }
    out.line('');
    wrapDim('   ', 'Say this part out loud: current diffusion models largely do NOT leave the checkerboard. It was a real fingerprint of GAN upsampling around 2018-2021 and it has been engineered away. A clean FFT is evidence that the image has no periodic resampling artefact. It is not evidence that a human took the picture.');
    out.line('');
  }

  /* ========================================================================
     7. COPY-MOVE
     ======================================================================== */

  /* The classic cheap detector: hash small blocks, group identical hashes, and
     keep only the groups whose members share the same displacement. The shift
     vote is what makes it work — two blocks of sky matching each other is
     meaningless, but forty blocks all displaced by exactly (+112, -30) is a
     region that was copied and pasted.

     Two guards, both learned the hard way by anyone who has written this:
     flat blocks are skipped, because a clear sky matches itself everywhere and
     drowns everything; and a hash bucket with more than BUCKET_CAP members is
     dropped entirely, because that is a repeated texture — bricks, tiles,
     foliage — not a copy. */
  var CM_BLOCK = 8;
  var CM_STRIDE = 4;
  var CM_MIN_VAR = 24;
  var BUCKET_CAP = 48;
  var CM_MIN_VOTES = 24;
  var CM_MIN_SHIFT = 16;

  function copyMove() {
    var scale = Math.min(1, CM_EDGE / Math.max(workCanvas.width, workCanvas.height));
    var w = Math.max(8, Math.round(workCanvas.width * scale));
    var h = Math.max(8, Math.round(workCanvas.height * scale));
    var small = makeCanvas(w, h);
    var sctx = small.getContext('2d');
    sctx.drawImage(workCanvas, 0, 0, w, h);
    var lum = luma(dataOf(small));

    var buckets = {}, blocks = [];
    var x, y, i, j;
    for (y = 0; y + CM_BLOCK <= h; y += CM_STRIDE) {
      for (x = 0; x + CM_BLOCK <= w; x += CM_STRIDE) {
        var sum = 0, sum2 = 0, pool = [0, 0, 0, 0, 0, 0, 0, 0,
                                        0, 0, 0, 0, 0, 0, 0, 0];
        for (j = 0; j < CM_BLOCK; j++) {
          for (i = 0; i < CM_BLOCK; i++) {
            var v = lum[(y + j) * w + x + i];
            sum += v; sum2 += v * v;
            pool[(j >> 1) * 4 + (i >> 1)] += v;
          }
        }
        var n = CM_BLOCK * CM_BLOCK;
        var mean = sum / n;
        if (sum2 / n - mean * mean < CM_MIN_VAR) continue;
        /* Mean-subtracted before quantising, so a copied region that was
           brightened afterwards still matches its source. Quantising at 6
           levels of luminance is coarse enough to survive the JPEG that came
           after the paste. */
        var key = '';
        for (i = 0; i < 16; i++) {
          key += String.fromCharCode(65 + Math.max(0, Math.min(40,
                 Math.round((pool[i] / 4 - mean) / 6) + 20)));
        }
        var id = blocks.length;
        blocks.push({ x: x, y: y });
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(id);
      }
    }

    var votes = {}, key2;
    for (key2 in buckets) {
      if (!Object.prototype.hasOwnProperty.call(buckets, key2)) continue;
      var list = buckets[key2];
      if (list.length < 2 || list.length > BUCKET_CAP) continue;
      for (i = 0; i < list.length; i++) {
        for (j = i + 1; j < list.length; j++) {
          var a = blocks[list[i]], b = blocks[list[j]];
          var dx = b.x - a.x, dy = b.y - a.y;
          if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; }
          if (Math.abs(dx) + Math.abs(dy) < CM_MIN_SHIFT) continue;
          var vk = dx + ',' + dy;
          if (!votes[vk]) votes[vk] = { count: 0, pairs: [] };
          votes[vk].count++;
          /* Keep the count in full and the pairs only up to a cap. A large
             mirrored or tiled image can produce hundreds of thousands of
             pairs, and every one of them is a two-element array held until the
             render; the count is what the report uses, and the render only
             needs enough blocks to draw the region. */
          if (votes[vk].pairs.length < 400) votes[vk].pairs.push([a, b]);
        }
      }
    }

    var found = [];
    for (key2 in votes) {
      if (!Object.prototype.hasOwnProperty.call(votes, key2)) continue;
      if (votes[key2].count >= CM_MIN_VOTES) {
        found.push({ shift: key2, count: votes[key2].count, pairs: votes[key2].pairs });
      }
    }
    found.sort(function (p, q) { return q.count - p.count; });
    return { small: small, scale: scale, w: w, h: h, found: found,
             blockCount: blocks.length };
  }

  function renderCopyMove(cm) {
    var c = copyCanvas(cm.small);
    var ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
    ctx.fillRect(0, 0, cm.w, cm.h);
    var colours = ['rgba(248, 113, 113, 0.75)', 'rgba(96, 165, 250, 0.75)',
                   'rgba(74, 222, 128, 0.75)', 'rgba(251, 191, 36, 0.75)'];
    for (var g = 0; g < cm.found.length && g < 4; g++) {
      ctx.fillStyle = colours[g];
      var pairs = cm.found[g].pairs;
      for (var i = 0; i < pairs.length; i++) {
        ctx.fillRect(pairs[i][0].x, pairs[i][0].y, CM_BLOCK, CM_BLOCK);
        ctx.fillRect(pairs[i][1].x, pairs[i][1].y, CM_BLOCK, CM_BLOCK);
      }
    }
    return c;
  }

  function reportCopyMove() {
    section('COPY-MOVE');
    var cm = copyMove();
    viewCache.copymove = { canvas: renderCopyMove(cm), rect: null, version: workVersion };
    out.row('working size', cm.w + '×' + cm.h + ' (downscaled)');
    out.row('textured blocks', cm.blockCount.toLocaleString());
    out.row('shift groups found', cm.found.length);
    out.line('');
    if (cm.found.length) {
      for (var i = 0; i < cm.found.length && i < 4; i++) {
        var parts = cm.found[i].shift.split(',');
        out.line('   ' + cm.found[i].count + ' block pairs displaced by (' +
                 Math.round(parts[0] / cm.scale) + ', ' +
                 Math.round(parts[1] / cm.scale) + ') px in the original',
                 't-warn');
      }
      out.line('');
      wrapDim('   ', 'Regions that repeat at a constant offset. Look at them in the copy-move view before concluding anything: a paved floor, a row of identical windows, a picket fence, a patterned shirt and a mirrored composition all produce this honestly.');
    } else {
      out.ok('   No group of blocks shares a common displacement.');
      out.line('');
      wrapDim('   ', 'This finds pasted duplicates of flat-ish textured regions at the same scale and rotation. A cloned region that was then rotated, scaled, warped or blurred will slip past it, and so will content copied from a different photograph, which is not a copy-move at all.');
    }
    out.line('');
  }

  /* ========================================================================
     8. LOOK HERE YOURSELF
     ======================================================================== */

  /* There is deliberately no face detection on this page.

     Drawing a green box around a face and printing a number beside it is the
     single most common way these tools mislead, because the box implies the
     number came from analysing a face, when it came from analysing pixels that
     happened to be inside a rectangle. Worse, it moves the judgement from the
     visitor to the tool, and on this question the visitor's eyes are still
     better than anything that fits in a browser.

     So: a checklist and a magnifier. The tool gets you a 6x view; you do the
     looking. Every item is something a person can verify without trusting any
     measurement on this page. */
  var EYE_CHECKS = [
    ['Catchlights', 'The bright reflection of the light source in each eye. In one photograph both eyes see the same room, so the two highlights should agree in shape, in count, and in where they sit inside the iris. Generated and composited faces very often disagree — and so, honestly, do real photographs with two light sources or one eye turned away.'],
    ['Ears and jaw', 'Compare the two ears: their height on the head, their shape, the earring in one and not the other. Then follow the jawline for a kink. Faces are asymmetric in real life, so look for a discontinuity rather than for asymmetry.'],
    ['Teeth', 'Individual teeth with their own edges and their own shading, or a smooth white bar with suggestions of gaps? A row of teeth is a hard thing to draw and a common place for the illusion to thin out.'],
    ['Hairline and stray hairs', 'Zoom to where hair meets forehead and where hair meets background. Real hair has individual strands that cross the boundary and background visible between them. A composite has a boundary that is too clean, or hair that dissolves into a smear.'],
    ['Background through hair', 'Follow a straight line in the background — a door frame, a tile edge, a horizon — as it passes behind the head. It should continue at the same angle on the far side. A warp or a paste bends it.'],
    ['Glasses, jewellery, lettering', 'Frames that change thickness across the lens, an earring on one side only, text on clothing that is nearly-but-not-quite letters. Small rigid objects are where generators still fail most visibly.'],
    ['Shadows and skin', 'Does the shadow under the nose agree with the shadow under the chin, and with the catchlights? Is the skin the same texture across the whole face, or smoother in one region than another — which is what the noise map above is measuring.']
  ];

  function reportLookHere() {
    section('LOOK HERE YOURSELF');
    out.dim('   No face detection. See the note in the page below for why.');
    out.line('');
    out.dim('   Click anywhere on the image, then choose the Magnifier view:');
    out.dim('   you get a 6× crop of that point next to its noise residual.');
    out.line('');
    for (var i = 0; i < EYE_CHECKS.length; i++) {
      out.line('   • ' + EYE_CHECKS[i][0], 't-info');
      wrapDim('     ', EYE_CHECKS[i][1]);
      out.line('');
    }
  }

  /* ========================================================================
     Video
     ======================================================================== */

  function reportVideo() {
    if (!isVideo || !videoFrames.length) return;
    section('FRAME-TO-FRAME CONSISTENCY');
    out.row('frames sampled', videoFrames.length + ' of the whole duration');
    out.line('');
    var vals = [], i;
    for (i = 0; i < videoFrames.length; i++) {
      vals.push(frameNoiseEnergy(videoFrames[i].canvas));
    }
    var hi = Math.max.apply(null, vals);
    var med = median(vals);
    for (i = 0; i < videoFrames.length; i++) {
      var jump = med > 0 ? Math.abs(vals[i] - med) / med : 0;
      // Padded, because a clip that runs past ten seconds mixes "t=2.15s" with
      // "t=10.73s" and every bar after the tenth second starts a column late.
      var label = ('t=' + videoFrames[i].t.toFixed(2) + 's');
      while (label.length < 10) label += ' ';
      out.line('   ' + label + bar(vals[i], hi, 30) + '  ' + vals[i].toFixed(2) +
               (jump > 0.35 ? '  ◀ out of line' : ''),
               jump > 0.35 ? 't-warn' : 't-dim');
    }
    out.line('');
    wrapDim('   ', 'Fine-detail energy per frame. A face replacement is composited frame by frame, so the blended region can breathe: its noise floor and sharpness change between frames in a way the rest of the picture does not, and at a blend boundary that reads as flicker.');
    wrapDim('   ', 'What this does not do: it reads frames the browser has already decoded, so it sees nothing of the codec, the container, the GOP structure or the encoder metadata, and it cannot separate compression flicker from blend flicker. A hard cut, a flash, autofocus hunting, a changing scene and a variable-bitrate encoder all move this number. It is a place to look, not a finding.');
    out.line('');
  }

  function frameNoiseEnergy(canvas) {
    var f = gridRect(canvas.width, canvas.height, 512,
                     canvas.width / 2, canvas.height / 2);
    var c = makeCanvas(f.w, f.h);
    c.getContext('2d').drawImage(canvas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    var lum = luma(dataOf(c));
    var w = f.w, sum = 0, n = 0;
    for (var y = 1; y < f.h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        sum += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  /* ========================================================================
     The report
     ======================================================================== */

  function runAll() {
    if (busy) { return; }
    if (!workCanvas) {
      out.clear().warn('Drop an image or a short video first.');
      return;
    }
    busy = true;
    sectionNo = 0;
    setStatus('Running the signal set…');
    out.clear();
    out.heading(srcFile ? srcFile.name : 'loaded image');
    if (srcBytes) out.row('size', LabTool.humanBytes(srcBytes.length));
    out.row('type', (srcFile && srcFile.type) || 'unknown');
    out.row('dimensions', workCanvas.width + '×' + workCanvas.height);
    if (workVersion > 0) {
      out.line('');
      out.warn('This is the EDITED image, not the file you dropped. Artefacts from');
      out.warn('the playground have been applied. Press "Reset to original" to');
      out.warn('measure the file as it arrived.');
    }
    out.rule();
    out.line('');
    out.line('THIS TOOL DOES NOT DECIDE WHETHER AN IMAGE IS REAL.', 't-warn');
    wrapDim('', 'It reports signals. Every one of them has innocent causes, most of them have several, and none of them is a test for synthetic origin. There is no score below and there will not be one, because a number would imply a confidence that no browser-side measurement earns.');
    out.line('');
    out.rule();
    out.line('');

    series([
      function (next) { reportProvenance(); next(); },
      function (next) { reportEla(next); },
      function (next) { reportQuant(); next(); },
      function (next) { reportGhost(next); },
      function (next) { reportNoise(); next(); },
      function (next) { reportFft(); next(); },
      function (next) { reportCopyMove(); next(); },
      function (next) { reportVideo(); next(); },
      function (next) { reportLookHere(); next(); }
    ], function () {
      out.rule();
      out.heading('WHAT THIS PAGE CANNOT TELL YOU');
      wrapDim('', 'Whether a person in this image said or did what it shows. Whether a model made it. Whether it is the original file. Nothing above answers any of those, and a tool that claimed to would be wrong often enough to ruin somebody.');
      out.line('');
      wrapDim('', 'The two rules worth carrying away: a clean result here is not a certificate — a competent fake, a screenshot, or one extra re-save erases every signal on this page. And a dirty result is not an accusation — cropping, resizing, a messaging app and a phone camera’s own processing all light these up on photographs of things that really happened.');
      out.line('');
      wrapDim('', 'What actually settles a question like this is provenance and corroboration: who had the file first, what the camera or the C2PA manifest says, whether another camera saw the same moment, and whether the claim survives contact with anything outside the image. Pixels are the weakest evidence in the room.');
      out.rule();
      busy = false;
      setStatus('');
      renderView();
    });
  }

  /* ========================================================================
     The stage: views, clicks and the magnifier
     ======================================================================== */

  var stageRect = null;   // where the current view sits in image space
  var stageScale = 1;

  function setStatus(text) {
    var s = el('tool-status');
    if (!s) return;
    s.textContent = text;
    s.className = 'lab-status' + (text ? ' is-busy' : '');
  }

  function setCaption(text) {
    var c = el('tool-caption');
    if (c) c.textContent = text;
  }

  function drawToStage(source, rect, caption) {
    var stage = el('tool-canvas');
    if (!stage) return;
    /* The displayed canvas is capped at 1100 px on the long edge. The analyses
       above all ran on real pixels; this is only what gets painted, and a
       48 MP canvas element in the DOM costs a great deal of memory for a
       picture the layout is about to scale down anyway. */
    var scale = Math.min(1, 1100 / Math.max(source.width, source.height));
    stage.width = Math.max(1, Math.round(source.width * scale));
    stage.height = Math.max(1, Math.round(source.height * scale));
    var ctx = stage.getContext('2d');
    ctx.clearRect(0, 0, stage.width, stage.height);
    ctx.drawImage(source, 0, 0, stage.width, stage.height);
    stageRect = rect;
    stageScale = scale;
    setCaption(caption || '');
  }

  function magnifier() {
    var f = focus || { x: workCanvas.width / 2, y: workCanvas.height / 2 };
    /* 90 and not 110: drawToStage caps the painted canvas at 1100 px on the
       long edge, and two 110x6 panels plus the divider came to 1332, so the
       stage quietly scaled the result to 0.83 and the caption's "6x" became a
       lie by a sixth. 90 * 6 * 2 + 12 = 1092, which paints at exactly 1:1. */
    var span = 90, zoom = 6;
    var sx = Math.max(0, Math.min(workCanvas.width - span, Math.round(f.x - span / 2)));
    var sy = Math.max(0, Math.min(workCanvas.height - span, Math.round(f.y - span / 2)));
    var crop = makeCanvas(span, span);
    crop.getContext('2d').drawImage(workCanvas, sx, sy, span, span, 0, 0, span, span);

    var side = span * zoom;
    var c = makeCanvas(side * 2 + 12, side);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(crop, 0, 0, side, side);

    // The same crop as a high-pass residual, beside it, at the same zoom.
    var lum = luma(dataOf(crop));
    var res = makeCanvas(span, span);
    var rctx = ctxOf(res);
    var img = rctx.createImageData(span, span);
    for (var y = 1; y < span - 1; y++) {
      for (var x = 1; x < span - 1; x++) {
        var i = y * span + x;
        var v = Math.min(255, Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] -
                                       lum[i - span] - lum[i + span]) * 8);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
    }
    rctx.putImageData(img, 0, 0);
    ctx.drawImage(res, side + 12, 0, side, side);

    ctx.strokeStyle = 'rgba(45, 212, 191, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, side - 2, side - 2);
    ctx.strokeRect(side + 13, 1, side - 2, side - 2);
    return { canvas: c, at: sx + ',' + sy };
  }

  function renderView() {
    if (!workCanvas) return;
    var view = el('tool-view') ? el('tool-view').value : 'image';
    var cached = viewCache[view];
    if (cached && cached.version === workVersion) {
      drawToStage(cached.canvas, cached.rect, viewCaption(view, cached.rect));
      return;
    }
    if (view === 'image') {
      drawToStage(workCanvas, { x: 0, y: 0, w: workCanvas.width, h: workCanvas.height },
                  viewCaption('image', null));
      return;
    }
    if (view === 'zoom') {
      var m = magnifier();
      drawToStage(m.canvas, null,
                  'Magnifier — 6× crop at ' + m.at +
                  ', pixels on the left, high-pass residual on the right. ' +
                  'Click the image view to move it.');
      return;
    }
    setStatus('Computing…');
    setCaption('Computing…');
    // Deferred so the "Computing" line paints before a long synchronous pass.
    setTimeout(function () {
      try {
        if (view === 'ela') {
          computeEla(function (canvas, stats) {
            setStatus('');
            if (!canvas) { setCaption('The browser could not re-encode this image.'); return; }
            viewCache.ela = { canvas: canvas, rect: stats.rect, version: workVersion };
            drawToStage(canvas, stats.rect, viewCaption('ela', stats.rect) +
                        ' Amplified ×' + stats.gain.toFixed(1) + '.');
          });
          return;
        }
        if (view === 'noise' || view === 'noisemap') {
          var a = noiseAnalysis();
          viewCache.noise = { canvas: renderNoiseResidual(a), rect: a.rect, version: workVersion };
          viewCache.noisemap = { canvas: renderNoiseMap(a), rect: a.rect, version: workVersion };
        } else if (view === 'fft') {
          var fa = fftAnalysis();
          if (!fa) { setStatus(''); setCaption('This image is too small to transform.'); return; }
          viewCache.fft = { canvas: renderFft(fa), rect: null, version: workVersion };
        } else if (view === 'copymove') {
          var cm = copyMove();
          viewCache.copymove = { canvas: renderCopyMove(cm), rect: null, version: workVersion };
        }
        setStatus('');
        var got = viewCache[view];
        if (got) drawToStage(got.canvas, got.rect, viewCaption(view, got.rect));
      } catch (err) {
        setStatus('');
        setCaption('That view could not be computed: ' +
                   ((err && err.message) || String(err)));
      }
    }, 20);
  }

  function viewCaption(view, rect) {
    var where = rect && isCropped(rect)
      ? ' Computed on the ' + rect.w + '×' + rect.h + ' crop at ' +
        rect.x + ',' + rect.y + ' — click to move it.'
      : '';
    if (view === 'image') {
      return (workVersion > 0 ? 'The edited image. ' : 'The image as dropped. ') +
             'Click anywhere to move the analysis crop and the magnifier.';
    }
    if (view === 'ela') {
      return 'Error level analysis. Bright means "compresses differently from its ' +
             'neighbours", which is not the same as "edited".' + where;
    }
    if (view === 'noise') {
      return 'High-pass residual at a fixed gain of 12. Sensor grain looks like ' +
             'even static; a smooth patch in busy surroundings is worth a look.' + where;
    }
    if (view === 'noisemap') {
      return 'Blocks whose fine-detail energy disagrees with the frame. Red is ' +
             'grainier than expected, blue is smoother. Both have innocent causes.' + where;
    }
    if (view === 'fft') {
      return 'Log magnitude of the 2D FFT, centre is DC. Bright spots away from ' +
             'the centre and the axes mean periodic structure — which a resize ' +
             'produces just as readily as a generator.';
    }
    if (view === 'copymove') {
      return 'Blocks that repeat at a shared displacement, one colour per shift ' +
             'group. Fences, tiles and patterned fabric land here honestly.';
    }
    return '';
  }

  function setFocus(x, y, tail) {
    focus = {
      x: Math.max(0, Math.min(workCanvas.width - 1, x)),
      y: Math.max(0, Math.min(workCanvas.height - 1, y))
    };
    /* The last two focus points are also the two eyes the catchlight artefact
       uses. One list rather than two, because a visitor who has just clicked
       two places has already told the tool where they are looking. */
    clicks.push(focus);
    if (clicks.length > 2) clicks.shift();
    viewCache = {};
    renderView();
    setCaption('Focus moved to ' + Math.round(focus.x) + ',' +
               Math.round(focus.y) + '. ' + tail);
  }

  function stageClick(event) {
    if (!workCanvas || !stageRect) return;
    var stage = el('tool-canvas');
    var box = stage.getBoundingClientRect();
    var cx = (event.clientX - box.left) / box.width * stage.width;
    var cy = (event.clientY - box.top) / box.height * stage.height;
    setFocus(stageRect.x + cx / stageScale, stageRect.y + cy / stageScale,
             'The crops and the magnifier now centre here; run the signals ' +
             'again to measure this region.');
  }

  var ARROWS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
  };

  /* Arrow keys move the same point. Clicking a canvas is the one interaction
     on this page a keyboard cannot reach, and without this the crop, the
     magnifier and every artefact would be permanently stuck at the centre of
     the frame for anyone not using a mouse. Shift gives a fifth of the step,
     because 5% of a 4000px frame is 200px and picking out an eye needs less. */
  function stageKey(event) {
    var d = ARROWS[event.key];
    if (!d || !workCanvas) return;
    event.preventDefault();
    var f = focus || { x: workCanvas.width / 2, y: workCanvas.height / 2 };
    var step = event.shiftKey ? 0.01 : 0.05;
    setFocus(f.x + d[0] * Math.max(1, workCanvas.width * step),
             f.y + d[1] * Math.max(1, workCanvas.height * step),
             'Arrow keys move it; hold Shift for finer steps.');
  }

  /* ========================================================================
     The artefact playground
     ======================================================================== */

  /* The brief asked for a deepfake generator. There is no face swapper here
     and there will not be one. A tool that puts one person's face onto another
     person's body has one dominant real-world use and it is non-consensual
     imagery, with fraud a distant second; building it on the same page as the
     detector meant to fight it would be worse than pointless.

     What teaches the same lesson honestly is the opposite move: take a photo
     whose history you already know — your own — add ONE artefact at a time
     with a control you set yourself, then run the detector and watch exactly
     one signal move. Cause and effect on a known input is what makes a signal
     legible. A gallery of fakes made by someone else teaches only that a tool
     agrees with its own captions.

     Every artefact below is a simulation of a mechanism, not a reproduction of
     any particular model's output. They are the artefacts, not the technique.*/
  var ARTEFACTS = {
    resample: {
      label: 'Resampling checkerboard',
      note: 'A transposed convolution that upsamples writes each output pixel from a different number of input taps, so the result carries a periodic gain ripple. This does both halves of that: a real nearest-neighbour 2× round trip for the hard edges, and a period-4 gain pattern for the part the FFT sees. Watch section 6.',
      apply: function (amount) {
        var w = workCanvas.width, h = workCanvas.height;
        var k = amount / 100;
        var half = makeCanvas(Math.max(1, w >> 1), Math.max(1, h >> 1));
        var hctx = half.getContext('2d');
        hctx.imageSmoothingEnabled = true;
        hctx.drawImage(workCanvas, 0, 0, half.width, half.height);
        var up = makeCanvas(w, h);
        var uctx = up.getContext('2d');
        uctx.imageSmoothingEnabled = false;
        uctx.drawImage(half, 0, 0, w, h);
        var ctx = ctxOf(workCanvas);
        ctx.globalAlpha = 0.35 * k;
        ctx.drawImage(up, 0, 0);
        ctx.globalAlpha = 1;
        var d = dataOf(workCanvas), px = d.data;
        var amp = 0.10 * k;
        for (var y = 0; y < h; y++) {
          var sy = (y % 4) < 2 ? 1 : -1;
          for (var x = 0; x < w; x++) {
            var g = 1 + amp * sy * ((x % 4) < 2 ? 1 : -1);
            var i = (y * w + x) * 4;
            px[i] = Math.max(0, Math.min(255, px[i] * g));
            px[i + 1] = Math.max(0, Math.min(255, px[i + 1] * g));
            px[i + 2] = Math.max(0, Math.min(255, px[i + 2] * g));
          }
        }
        ctx.putImageData(d, 0, 0);
      }
    },
    seam: {
      label: 'Blend-seam feathering',
      note: 'An elliptical region blended back in over a feathered edge, slightly softer and slightly brighter than its surroundings — which is what a composited region looks like when someone has made a careful job of the mask. The seam is a ring, and it appears in the ELA and noise-residual VIEWS well before it appears to the eye. Watch what does not happen too: the mean difference printed in section 2 barely moves, because an average over the whole frame is the wrong instrument for a change inside one ellipse. The block count in section 5 does move. Local artefacts show up on maps, not in summary numbers.',
      apply: function (amount) {
        var w = workCanvas.width, h = workCanvas.height;
        var f = focus || { x: w / 2, y: h / 2 };
        var r = Math.min(w, h) * 0.18;
        var feather = 2 + amount * 0.5;
        var d = dataOf(workCanvas), px = d.data;
        var src = new Uint8ClampedArray(px);
        var k = amount / 100;
        /* The blur inside reads one pixel in each direction, so the loop stops
           one pixel short of every edge. Without that, an ellipse that touched
           the frame border read past the end of the array, the arithmetic came
           back NaN, and a Uint8ClampedArray turns NaN into 0 — a black line
           along the edge, silently, only for images where the focus point was
           near a border. */
        for (var y = 1; y < h - 1; y++) {
          for (var x = 1; x < w - 1; x++) {
            var dx = (x - f.x) / r, dy = (y - f.y) / r;
            var dist = Math.sqrt(dx * dx + dy * dy) * r;
            if (dist > r) continue;
            var alpha = Math.min(1, (r - dist) / feather);
            var i = (y * w + x) * 4;
            for (var c = 0; c < 3; c++) {
              var blur = (src[i + c] +
                          src[i + c - 4] + src[i + c + 4] +
                          src[i + c - w * 4] + src[i + c + w * 4]) / 5;
              var target = Math.min(255, blur * (1 + 0.06 * k));
              px[i + c] = src[i + c] + (target - src[i + c]) * alpha * k;
            }
          }
        }
        ctxOf(workCanvas).putImageData(d, 0, 0);
      }
    },
    noisefloor: {
      label: 'Mismatched noise floor',
      note: 'A rectangular region given a noise floor that disagrees with the rest of the frame. Below 50 the region is smoothed — what a denoised or generated patch looks like; above 50 it gains grain the sensor never wrote. Watch section 5, and the noise-floor map view.',
      apply: function (amount) {
        var w = workCanvas.width, h = workCanvas.height;
        var f = focus || { x: w / 2, y: h / 2 };
        var rw = Math.round(Math.min(w, h) * 0.3), rh = rw;
        var x0 = Math.max(1, Math.min(w - rw - 1, Math.round(f.x - rw / 2)));
        var y0 = Math.max(1, Math.min(h - rh - 1, Math.round(f.y - rh / 2)));
        var d = dataOf(workCanvas), px = d.data;
        var src = new Uint8ClampedArray(px);
        var smooth = amount < 50;
        var k = smooth ? (50 - amount) / 50 : (amount - 50) / 50;
        for (var y = y0; y < y0 + rh; y++) {
          for (var x = x0; x < x0 + rw; x++) {
            var i = (y * w + x) * 4;
            for (var c = 0; c < 3; c++) {
              if (smooth) {
                var m = (src[i + c] * 4 + src[i + c - 4] + src[i + c + 4] +
                         src[i + c - w * 4] + src[i + c + w * 4]) / 8;
                px[i + c] = src[i + c] + (m - src[i + c]) * k;
              } else {
                /* Two uniform draws summed: closer to the shape of sensor
                   noise than one, and cheaper than a Box-Muller pair over
                   several hundred thousand pixels. */
                var n = (Math.random() + Math.random() - 1) * 26 * k;
                px[i + c] = Math.max(0, Math.min(255, src[i + c] + n));
              }
            }
          }
        }
        ctxOf(workCanvas).putImageData(d, 0, 0);
      }
    },
    recompress: {
      label: 'Recompression ring',
      note: 'The whole frame re-encoded hard, then pasted back inside one rectangle only — so that region carries a compression history the rest of the image does not. This is the artefact error level analysis was actually designed to find, and the ELA VIEW shows it plainly. The mean difference printed in section 2 will hardly move, because it is an average over the whole frame; the disagreeing-block count in section 5 jumps sharply. Section 4 usually will not react either: its sweep runs on a 512 px window, and a box smaller than that window is diluted inside it.',
      async: true,
      apply: function (amount, done) {
        var w = workCanvas.width, h = workCanvas.height;
        var f = focus || { x: w / 2, y: h / 2 };
        var rw = Math.round(Math.min(w, h) * 0.34), rh = rw;
        var x0 = Math.max(0, Math.min(w - rw, Math.round(f.x - rw / 2)));
        var y0 = Math.max(0, Math.min(h - rh, Math.round(f.y - rh / 2)));
        var quality = Math.max(0.15, 0.95 - amount * 0.008);
        var img = new Image();
        img.onload = function () {
          var ctx = workCanvas.getContext('2d');
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, y0, rw, rh);
          ctx.clip();
          ctx.drawImage(img, 0, 0);
          ctx.restore();
          done(' Re-encoded at JPEG quality ' + Math.round(quality * 100) +
               ' inside a ' + rw + '×' + rh + ' box at ' + x0 + ',' + y0 + '.');
        };
        img.onerror = function () { done(' The browser refused to re-encode it.'); };
        img.src = workCanvas.toDataURL('image/jpeg', quality);
      }
    },
    warp: {
      label: 'Warped geometry',
      note: 'A smooth radial bulge around the focus point, sampled bilinearly — the mechanism behind every "slim the jaw" slider in every retouching app. No detector section catches this one, which is the lesson: check straight lines in the background as they pass behind the warped region, because geometry is verified by eye and not by statistics.',
      apply: function (amount) {
        var w = workCanvas.width, h = workCanvas.height;
        var f = focus || { x: w / 2, y: h / 2 };
        var r = Math.min(w, h) * 0.28;
        var k = amount / 100 * 0.45;
        var d = dataOf(workCanvas);
        var src = new Uint8ClampedArray(d.data);
        var px = d.data;
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var dx = x - f.x, dy = y - f.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > r || dist < 0.5) continue;
            var t = dist / r;
            var factor = 1 - k * (1 - t * t) * (1 - t * t);
            var sxf = f.x + dx * factor, syf = f.y + dy * factor;
            var x1 = Math.floor(sxf), y1 = Math.floor(syf);
            if (x1 < 0 || y1 < 0 || x1 >= w - 1 || y1 >= h - 1) continue;
            var fx = sxf - x1, fy = syf - y1;
            var i = (y * w + x) * 4;
            for (var c = 0; c < 3; c++) {
              var a00 = src[(y1 * w + x1) * 4 + c];
              var a10 = src[(y1 * w + x1 + 1) * 4 + c];
              var a01 = src[((y1 + 1) * w + x1) * 4 + c];
              var a11 = src[((y1 + 1) * w + x1 + 1) * 4 + c];
              px[i + c] = a00 * (1 - fx) * (1 - fy) + a10 * fx * (1 - fy) +
                          a01 * (1 - fx) * fy + a11 * fx * fy;
            }
          }
        }
        ctxOf(workCanvas).putImageData(d, 0, 0);
      }
    },
    catchlight: {
      label: 'Catchlight mismatch',
      note: 'Two specular highlights drawn at two points you click, deliberately disagreeing in angle, size and brightness. In one photograph both eyes see the same room, so both catchlights agree. Nothing in section 1 to 7 measures this. Only your eyes do — which is exactly the point of section 8.',
      apply: function (amount) {
        var w = workCanvas.width, h = workCanvas.height;
        var p1 = clicks.length > 1 ? clicks[0] : { x: w * 0.42, y: h * 0.45 };
        var p2 = clicks.length > 1 ? clicks[1] : { x: w * 0.58, y: h * 0.45 };
        var size = Math.max(2, Math.min(w, h) * 0.012);
        var ctx = workCanvas.getContext('2d');
        var k = amount / 100;
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.beginPath();
        ctx.ellipse(p1.x, p1.y, size, size * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.92 - 0.5 * k).toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(p2.x + size * 2 * k, p2.y - size * 1.5 * k,
                    size * (1 + 0.9 * k), size * 0.8 * (1 - 0.5 * k),
                    Math.PI * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  function applyArtefact() {
    if (!workCanvas) { out.clear().warn('Drop an image first.'); return; }
    var kind = el('tool-artefact').value;
    var spec = ARTEFACTS[kind];
    if (!spec) return;
    var amount = parseInt(el('tool-strength').value, 10) || 0;

    function finish(extra) {
      workVersion++;
      viewCache = {};
      if (el('tool-view')) el('tool-view').value = 'image';
      renderView();
      out.clear();
      out.heading('Artefact applied: ' + spec.label);
      out.row('strength', amount + ' of 100');
      out.row('applied at', focus ? Math.round(focus.x) + ',' + Math.round(focus.y)
                                  : 'the centre of the frame');
      out.row('edits so far', workVersion);
      if (extra) out.dim('  ' + extra.replace(/^\s+/, ''));
      out.line('');
      wrapDim('', spec.note);
      out.line('');
      out.dim('Now press "Run the signal set" and compare it with the run you');
      out.dim('did before applying this. One artefact at a time is the whole');
      out.dim('method — stack three of them and you learn nothing about which');
      out.dim('one moved which number.');
      out.line('');
      out.warn('This is your own image with a simulated artefact in it. It is not');
      out.warn('a fake of anything, and the export is watermarked so it cannot');
      out.warn('become one by accident.');
      setStatus('');
      busy = false;
    }

    busy = true;
    setStatus('Applying…');
    setTimeout(function () {
      try {
        if (spec.async) spec.apply(amount, finish);
        else { spec.apply(amount); finish(''); }
      } catch (err) {
        busy = false;
        setStatus('');
        out.clear().err('That artefact could not be applied: ' +
                        ((err && err.message) || String(err)));
      }
    }, 20);
  }

  function resetWork() {
    if (!origCanvas) return;
    workCanvas = copyCanvas(origCanvas);
    workVersion = 0;
    viewCache = {};
    clicks = [];
    if (el('tool-view')) el('tool-view').value = 'image';
    renderView();
    out.clear();
    out.ok('Back to the image as it was decoded.');
    out.dim('Every playground edit has been discarded.');
  }

  /* ========================================================================
     Export: watermarked pixels, and metadata that says what this is
     ======================================================================== */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function exifDateTime(d) {
    return d.getFullYear() + ':' + pad2(d.getMonth() + 1) + ':' + pad2(d.getDate()) +
           ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* Build an APP1 Exif segment carrying a handful of ASCII IFD0 tags.
     Big-endian ("MM"), because writing it with DataView and littleEndian=false
     means every offset in the file reads in the same order it is written, and
     this is a writer nobody is going to profile.
     EXIF ASCII is 7-bit, so anything outside that range is replaced rather
     than emitted: a stray em dash here produces a field that half the readers
     in the world render as mojibake. */
  function buildExifApp1(entries) {
    var i, payload = [], total = 8 + 2 + entries.length * 12 + 4;
    for (i = 0; i < entries.length; i++) {
      var text = String(entries[i].text).replace(/[^\x20-\x7e]/g, '-') + '\0';
      var bytes = [];
      for (var j = 0; j < text.length; j++) bytes.push(text.charCodeAt(j));
      payload.push(bytes);
      if (bytes.length > 4) total += bytes.length + (bytes.length % 2);
    }
    var tiff = new Uint8Array(total);
    var dv = new DataView(tiff.buffer);
    dv.setUint16(0, 0x4d4d, false);      // "MM"
    dv.setUint16(2, 42, false);
    dv.setUint32(4, 8, false);           // IFD0 begins at byte 8
    dv.setUint16(8, entries.length, false);
    var valueAt = 8 + 2 + entries.length * 12 + 4;
    for (i = 0; i < entries.length; i++) {
      var entry = 10 + i * 12;
      var bytes2 = payload[i];
      dv.setUint16(entry, entries[i].tag, false);
      dv.setUint16(entry + 2, 2, false);          // type 2 = ASCII
      dv.setUint32(entry + 4, bytes2.length, false);
      if (bytes2.length > 4) {
        dv.setUint32(entry + 8, valueAt, false);
        for (var k = 0; k < bytes2.length; k++) tiff[valueAt + k] = bytes2[k];
        valueAt += bytes2.length + (bytes2.length % 2);
      } else {
        for (var m = 0; m < bytes2.length; m++) tiff[entry + 8 + m] = bytes2[m];
      }
    }
    dv.setUint32(10 + entries.length * 12, 0, false);   // no IFD1

    var head = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];    // "Exif\0\0"
    var length = 2 + head.length + tiff.length;
    if (length > 65535) return null;
    var seg = new Uint8Array(2 + length);
    seg[0] = 0xff; seg[1] = 0xe1;
    seg[2] = (length >> 8) & 0xff; seg[3] = length & 0xff;
    seg.set(head, 4);
    seg.set(tiff, 4 + head.length);
    return seg;
  }

  function buildComment(text) {
    var body = String(text).replace(/[^\x20-\x7e]/g, '-');
    var length = 2 + body.length;
    if (length > 65535) return null;
    var seg = new Uint8Array(2 + length);
    seg[0] = 0xff; seg[1] = 0xfe;
    seg[2] = (length >> 8) & 0xff; seg[3] = length & 0xff;
    for (var i = 0; i < body.length; i++) seg[4 + i] = body.charCodeAt(i);
    return seg;
  }

  function spliceSegments(jpeg, segments) {
    var extra = 0, i;
    for (i = 0; i < segments.length; i++) if (segments[i]) extra += segments[i].length;
    var outBytes = new Uint8Array(jpeg.length + extra);
    outBytes[0] = 0xff; outBytes[1] = 0xd8;
    var at = 2;
    for (i = 0; i < segments.length; i++) {
      if (!segments[i]) continue;
      outBytes.set(segments[i], at);
      at += segments[i].length;
    }
    outBytes.set(jpeg.subarray(2), at);
    return outBytes;
  }

  var MARK = 'SYNTHETIC - artefact playground - krunalkumar.dpdns.org/labs/media-forensics';

  function watermarked() {
    var c = copyCanvas(workCanvas);
    var ctx = c.getContext('2d');
    var band = Math.max(20, Math.round(c.height * 0.05));
    var size = Math.max(11, Math.round(band * 0.46));
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(0, c.height - band, c.width, band);
    ctx.fillStyle = '#ffffff';
    ctx.font = size + 'px "Cascadia Code", Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(MARK, Math.round(band * 0.3), c.height - band / 2,
                 c.width - band * 0.6);
    ctx.fillStyle = 'rgba(248, 113, 113, 0.9)';
    ctx.fillRect(0, c.height - band, c.width, 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(0, 0, size * 7, band * 0.7);
    ctx.fillStyle = '#f87171';
    ctx.fillText('SYNTHETIC', Math.round(band * 0.2), band * 0.35);
    return c;
  }

  function exportSynthetic() {
    if (!workCanvas) { out.clear().warn('Drop an image first.'); return; }
    var c = watermarked();
    c.toBlob(function (blob) {
      if (!blob) { out.clear().err('The browser could not encode the export.'); return; }
      blob.arrayBuffer().then(function (buf) {
        var jpeg = new Uint8Array(buf);
        var app1 = buildExifApp1([
          { tag: 0x010e, text: 'SYNTHETIC. Artefacts added by hand in a browser lab for ' +
                               'training. Not a photograph of record and not evidence.' },
          { tag: 0x0131, text: 'krunalkumar.dpdns.org/labs/media-forensics artefact ' +
                               'playground - SYNTHETIC' },
          { tag: 0x0132, text: exifDateTime(new Date()) }
        ]);
        var com = buildComment('SYNTHETIC: produced by the artefact playground at ' +
                               'krunalkumar.dpdns.org/labs/media-forensics. The visible ' +
                               'artefacts in this file were added deliberately.');
        var final = spliceSegments(jpeg, [app1, com]);
        var name = (srcFile ? srcFile.name.replace(/\.[^.]+$/, '') : 'image') +
                   '-synthetic.jpg';
        LabTool.download(final, name, 'image/jpeg');
        out.clear();
        out.ok('Saved as ' + name);
        out.rule();
        out.row('watermark', 'a burned-in band across the bottom, plus a corner tag');
        out.row('EXIF Software', 'names this playground and the word SYNTHETIC');
        out.row('EXIF ImageDescription', 'says it is not a photograph of record');
        out.row('JPEG comment', 'the same sentence, for readers that show COM');
        out.rule();
        wrapDim('', 'Two honest limits. The metadata can be stripped in one command, and the watermark can be cropped off in about four seconds — neither is a control, they are a label. And the export is a JPEG, so it carries one extra generation of compression: run the detector on it and section 4 will find the export itself, which is a useful thing to see happen.');
        out.line('');
        out.dim('Drop this file into /labs/exif to read the fields back, or into');
        out.dim('/labs/file-inspector to see the segments themselves.');
      });
    }, 'image/jpeg', 0.92);
  }

  /* ========================================================================
     Loading
     ======================================================================== */

  function adoptImage(canvas) {
    origCanvas = canvas;
    workCanvas = copyCanvas(canvas);
    workVersion = 0;
    viewCache = {};
    clicks = [];
    focus = { x: canvas.width / 2, y: canvas.height / 2 };
    if (el('tool-view')) el('tool-view').value = 'image';
    renderView();
  }

  function tooManyPixels(w, h) {
    if (w * h <= MAX_PIXELS) return false;
    out.clear().err('That image decodes to ' + w.toLocaleString() + ' × ' +
      h.toLocaleString() + ' — ' + Math.round(w * h / 1e6).toLocaleString() +
      ' megapixels. This tool stops at ' + (MAX_PIXELS / 1e6) + ' megapixels, ' +
      'because the analyses hold three full RGBA buffers at once and anything ' +
      'larger would take this tab down. Nothing was uploaded.');
    return true;
  }

  function loadImageFile(bytes, file) {
    var blob = new Blob([bytes], { type: file.type || 'image/jpeg' });
    releasePreview();
    previewUrl = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      if (tooManyPixels(img.naturalWidth, img.naturalHeight)) return;
      var c = makeCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, 0, 0);
      isVideo = false;
      videoFrames = [];
      var sel = el('tool-frame');
      if (sel) sel.hidden = true;
      adoptImage(c);
      out.clear();
      out.heading(file.name);
      out.row('dimensions', c.width + '×' + c.height);
      out.row('file size', LabTool.humanBytes(bytes.length));
      out.rule();
      out.dim('Press "Run the signal set" to measure it. Click anywhere on the');
      out.dim('image first if there is a particular region you care about — the');
      out.dim('analyses crop around wherever you clicked.');
      out.line('');
      out.warn('Before you read a single number: this page returns no verdict, and');
      out.warn('nothing it prints separates a real photograph from a generated one.');
    };
    img.onerror = function () {
      releasePreview();
      out.clear().err('That file could not be decoded as an image.');
    };
    img.src = previewUrl;
  }

  /* Video handling is deliberately shallow: a <video> element and a canvas,
     seeking to a handful of timestamps and reading back what the browser
     decoded. There is no codec work, no container parsing and no motion
     estimation here, and there is not going to be. What that buys is that the
     still-image analyses can run on a real frame; what it costs is stated in
     section 9 of the report and in the page prose. */
  function loadVideoFile(bytes, file) {
    releasePreview();
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: file.type || 'video/mp4' }));
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    out.clear();
    out.heading(file.name);
    out.dim('Decoding and sampling frames…');
    setStatus('Sampling frames…');

    video.onerror = function () {
      setStatus('');
      releasePreview();
      out.clear().err('This browser could not decode that video. Try an MP4 (H.264) ' +
                      'or a WebM; there is no codec work in this page, only whatever ' +
                      'the browser itself can play.');
    };
    video.onloadeddata = function () {
      if (tooManyPixels(video.videoWidth, video.videoHeight)) { setStatus(''); return; }
      var duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (!duration) {
        setStatus('');
        out.clear().err('That video reports no duration, so there is nothing to sample.');
        return;
      }
      videoFrames = [];
      var n = 0;
      function grab() {
        if (n >= VIDEO_FRAMES) { finishVideo(file, bytes); return; }
        var t = duration * (n + 0.5) / VIDEO_FRAMES;
        n++;
        video.onseeked = function () {
          var c = makeCanvas(video.videoWidth, video.videoHeight);
          c.getContext('2d').drawImage(video, 0, 0);
          videoFrames.push({ t: video.currentTime, canvas: c });
          grab();
        };
        video.currentTime = t;
      }
      grab();
    };
    video.src = previewUrl;
  }

  function finishVideo(file, bytes) {
    setStatus('');
    if (!videoFrames.length) {
      out.clear().err('No frames could be read out of that video.');
      return;
    }
    isVideo = true;
    var sel = el('tool-frame');
    if (sel) {
      sel.innerHTML = '';
      for (var i = 0; i < videoFrames.length; i++) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = 'Frame at ' + videoFrames[i].t.toFixed(2) + 's';
        sel.appendChild(opt);
      }
      sel.selectedIndex = Math.floor(videoFrames.length / 2);
      sel.hidden = false;
    }
    adoptImage(copyCanvas(videoFrames[Math.floor(videoFrames.length / 2)].canvas));
    out.clear();
    out.heading(file.name);
    out.row('dimensions', workCanvas.width + '×' + workCanvas.height);
    out.row('file size', LabTool.humanBytes(bytes.length));
    out.row('frames sampled', videoFrames.length);
    out.rule();
    out.dim('The middle frame is loaded as the working image; use the frame');
    out.dim('picker to switch. Every still analysis then runs on that frame.');
    out.line('');
    out.warn('Frames only. Nothing here reads the container, the codec, the GOP');
    out.warn('structure or the encoder metadata, so provenance for a video has');
    out.warn('to come from somewhere else.');
  }

  function pickFrame() {
    var sel = el('tool-frame');
    if (!sel || !videoFrames.length) return;
    var frame = videoFrames[parseInt(sel.value, 10) || 0];
    if (!frame) return;
    adoptImage(copyCanvas(frame.canvas));
    setCaption('Frame at ' + frame.t.toFixed(2) + 's is now the working image.');
  }

  function onFile(bytes, file) {
    srcBytes = bytes;
    srcFile = file;
    var nameEl = el('tool-dropname');
    if (nameEl) nameEl.textContent = file.name;
    var isVid = /^video\//.test(file.type || '') ||
                /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name || '');
    if (isVid) loadVideoFile(bytes, file);
    else loadImageFile(bytes, file);
  }

  LabTool.define({
    id: 'mediaforensics',
    run: runAll,
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX_FILE,
        onFile: onFile,
        onError: function (msg) { out.clear().err(msg); }
      });
      var view = el('tool-view');
      if (view) view.addEventListener('change', function () { renderView(); });
      var stage = el('tool-canvas');
      if (stage) {
        stage.addEventListener('click', stageClick);
        stage.addEventListener('keydown', stageKey);
      }
      var apply = el('tool-apply');
      if (apply) apply.addEventListener('click', applyArtefact);
      var reset = el('tool-reset');
      if (reset) reset.addEventListener('click', resetWork);
      var save = el('tool-export');
      if (save) save.addEventListener('click', exportSynthetic);
      var frame = el('tool-frame');
      if (frame) frame.addEventListener('change', pickFrame);
      var strength = el('tool-strength');
      var readout = el('tool-strengthval');
      if (strength && readout) {
        strength.addEventListener('input', function () {
          readout.textContent = strength.value;
        });
      }
      var artefact = el('tool-artefact');
      if (artefact) {
        artefact.addEventListener('change', function () {
          var spec = ARTEFACTS[artefact.value];
          if (spec) setCaption(spec.label + ' — press Apply, then run the signals.');
        });
      }

      out.dim('Drop a photograph, or a short video, and nothing is uploaded —');
      out.dim('every pixel below is read in this tab.');
      out.line('');
      out.warn('This tool does not tell you whether an image is real.');
      out.dim('It cannot, and neither can anything else that runs in a browser.');
      out.dim('It shows signals, explains what each one does and does not imply,');
      out.dim('and leaves the conclusion where it belongs, which is with you.');
      out.line('');
      out.dim('There is no score on this page and there will not be one.');
    }
  });
})();

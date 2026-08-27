/* ==========================================================================
   steganography.js — hide a message in the low bits of an image, and find one.
   --------------------------------------------------------------------------
   Least-significant-bit steganography changes the last bit of each colour
   channel. That shifts a value by at most 1 out of 255, which no eye can see,
   and it is why a picture can carry a paragraph without looking different.

   Two reasons this belongs in a forensics lab. First, hiding something is the
   fastest way to understand finding it. Second, the extractor demonstrates the
   weakness: LSB survives nothing. Re-save the image as JPEG, resize it, or let
   any social network re-encode it, and the message is gone — because those all
   rewrite exactly the bits the message lives in.

   This is not encryption. Anyone who suspects LSB can read it with the same
   twenty lines. Encrypt first if the content matters.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 20 * 1024 * 1024;
  var out = LabTool.out('tool-out');
  var image = null, imageName = '';
  /* The blob URL has to outlive the decode, because the preview element uses
     the same URL. Revoking it inside img.onload — before handing it to the
     preview — leaves the preview pointing at a URL the browser has already
     released, and it silently renders nothing. So the previous URL is
     released when the next image is loaded instead. */
  var previewUrl = null;

  function releasePreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  var MAGIC = 'STG1';   // so the extractor can tell a real payload from noise

  function loadImage(bytes, file) {
    // The drop zone's own filename line, set the moment the file arrives rather
    // than after the decode: a file that turns out not to be an image is
    // exactly when the visitor needs to see which one they dropped. Every other
    // file-drop tool on the site fills this element the same way.
    var nameEl = document.getElementById('tool-dropname');
    if (nameEl) nameEl.textContent = file.name;

    var blob = new Blob([bytes], { type: file.type || 'image/png' });
    releasePreview();
    var url = URL.createObjectURL(blob);
    previewUrl = url;
    var img = new Image();
    img.onload = function () {
      image = img;
      imageName = file.name;
      out.clear();
      out.heading(file.name);
      out.row('dimensions', img.naturalWidth + ' × ' + img.naturalHeight);
      out.row('file size', LabTool.humanBytes(bytes.length));
      var capacity = Math.floor(img.naturalWidth * img.naturalHeight * 3 / 8) - 8;
      out.row('capacity', LabTool.humanBytes(Math.max(0, capacity)) +
              '  (' + Math.max(0, capacity).toLocaleString() + ' characters)');
      out.dim('    three colour channels per pixel, one bit each');
      out.rule();
      if (file.type === 'image/jpeg') {
        out.warn('This is a JPEG. You can extract from it, but hiding will only');
        out.warn('work if you keep the PNG this tool produces — JPEG compression');
        out.warn('rewrites the exact bits the message lives in and destroys it.');
        out.line('');
      }
      out.dim('Type a message and press Hide, or press Extract to look for one.');
      var preview = document.getElementById('tool-preview');
      if (preview) { preview.src = previewUrl; preview.hidden = false; }
    };
    img.onerror = function () {
      releasePreview();
      out.clear().err('That file could not be decoded as an image.');
    };
    img.src = url;
  }

  /* A PNG's dimensions live in its header, not in its file size, so the MAX
     file-size gate above cannot stop a decompression bomb: a solid-colour
     30000x30000 PNG compresses to a few hundred KB, sails through that gate,
     and then asks getImageData for 4 * w * h bytes — about 3.6 GB — on the
     main thread. The tab dies before the tool can say anything.
     So cap the DECODED pixel count too. The ceiling has to clear real cameras
     — a 48 MP phone and a 61 MP full-frame are ordinary, and the largest
     medium-format back is 102 MP — while still refusing the bomb.
     120 megapixels is that line, checked against real sensors:
         Fujifilm GFX100  11648x8736 = 102 MP  480 MB   allowed
         Sony A7R V        9504x6336 =  60 MP  240 MB   allowed
         48 MP phone       8000x6000 =  48 MP  190 MB   allowed
         200 MP phone mode 16384x12288 = 201 MP 810 MB  refused
         the bomb         30000x30000 = 900 MP  3.6 GB  refused
     Those figures are getImageData alone; extract() then builds an LSB view
     and a data URL on top, so peak is roughly 3x. At 120 MP that is ~1.4 GB,
     which a browser survives; at 900 MP it is not survivable.
     A tighter 40 MP cap was tried first and rejected: it would have refused an
     everyday 48 MP phone photo costing 190 MB, trading one bug for another. */
  var MAX_PIXELS = 120 * 1000 * 1000;

  function tooLarge() {
    var w = image.naturalWidth, h = image.naturalHeight;
    if (w * h <= MAX_PIXELS) return false;
    out.clear().err('That image is ' + w.toLocaleString() + ' x ' + h.toLocaleString() +
                    ' — ' + Math.round(w * h / 1e6).toLocaleString() + ' megapixels. This tool ' +
                    'decodes up to ' + (MAX_PIXELS / 1e6) + ' megapixels; anything larger would ' +
                    'need gigabytes of memory and freeze this tab. Try a smaller image.');
    return true;
  }

  function pixels() {
    var canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    return { canvas: canvas, ctx: ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }

  function hide() {
    if (!image) { out.clear().warn('Load a PNG first.'); return; }
    if (tooLarge()) return;
    var message = document.getElementById('tool-text').value;
    if (!message) { out.clear().warn('Type a message to hide.'); return; }

    var payload = new TextEncoder().encode(MAGIC + message);
    var p = pixels();
    var data = p.data.data;
    // Every 4th byte is alpha and is left alone: touching it can make pixels
    // subtly transparent, which some viewers and formats handle badly.
    var usable = Math.floor(data.length / 4) * 3;
    var header = 4 * 8;                       // 32-bit big-endian length
    var needed = header + payload.length * 8;
    if (needed > usable) {
      out.clear().err('That message needs ' + needed.toLocaleString() + ' bits but this image ' +
                      'only has ' + usable.toLocaleString() + '. Use a larger image or a shorter message.');
      return;
    }

    var bits = [];
    var len = payload.length;
    for (var h = 31; h >= 0; h--) bits.push((len >>> h) & 1);
    for (var i = 0; i < payload.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((payload[i] >> b) & 1);
    }

    var bit = 0;
    for (var px = 0; px < data.length && bit < bits.length; px += 4) {
      for (var ch = 0; ch < 3 && bit < bits.length; ch++) {
        data[px + ch] = (data[px + ch] & 0xfe) | bits[bit++];
      }
    }
    p.ctx.putImageData(p.data, 0, 0);

    p.canvas.toBlob(function (blob) {
      if (!blob) { out.clear().err('Could not encode the result.'); return; }
      blob.arrayBuffer().then(function (buf) {
        var name = imageName.replace(/\.[^.]+$/, '') + '-hidden.png';
        LabTool.download(new Uint8Array(buf), name, 'image/png');
        out.clear();
        out.ok('Message hidden — saved as ' + name);
        out.rule();
        out.row('message length', message.length + ' characters');
        out.row('bits written', bits.length.toLocaleString());
        out.row('pixels touched', Math.ceil(bits.length / 3).toLocaleString() +
                ' of ' + (image.naturalWidth * image.naturalHeight).toLocaleString());
        out.row('maximum change', '1 of 255 per channel');
        out.rule();
        out.dim('The two images are visually identical because every altered');
        out.dim('channel moved by at most one step out of 255.');
        out.line('');
        out.warn('It must stay a PNG. PNG is lossless, so the low bits survive.');
        out.warn('Saving it as JPEG, resizing it, or uploading it anywhere that');
        out.warn('re-encodes images will destroy the message completely.');
        out.line('');
        out.warn('And this is not encryption. Anyone who suspects LSB can read it');
        out.warn('with the Extract button on this page. If the content matters,');
        out.warn('encrypt it before hiding it.');
      });
    }, 'image/png');
  }

  function extract() {
    if (!image) { out.clear().warn('Load an image first.'); return; }
    if (tooLarge()) return;
    var p = pixels();
    var data = p.data.data;

    function readBits(count, from) {
      var bits = [], seen = 0;
      for (var px = 0; px < data.length && bits.length < count; px += 4) {
        for (var ch = 0; ch < 3 && bits.length < count; ch++) {
          if (seen++ < from) continue;
          bits.push(data[px + ch] & 1);
        }
      }
      return bits;
    }

    out.clear();
    var lenBits = readBits(32, 0);
    var len = 0;
    for (var i = 0; i < 32; i++) len = (len << 1) | lenBits[i];
    len = len >>> 0;

    var capacity = Math.floor(data.length / 4) * 3;
    if (!len || len > (capacity - 32) / 8 || len > 5 * 1024 * 1024) {
      out.warn('No hidden message found.');
      out.rule();
      out.dim('The length header did not read as a sensible value, which means');
      out.dim('the low bits here are ordinary image noise.');
      out.line('');
      out.dim('That is the expected result for almost every image. It is also');
      out.dim('what you would see if a message had been hidden and the file was');
      out.dim('since re-encoded — JPEG compression, a resize, or an upload to a');
      out.dim('site that reprocesses images all wipe the low bits.');
      lsbView(data);
      return;
    }

    var bits = readBits(32 + len * 8, 0).slice(32);
    var bytes = new Uint8Array(len);
    for (var b = 0; b < len; b++) {
      var value = 0;
      for (var k = 0; k < 8; k++) value = (value << 1) | bits[b * 8 + k];
      bytes[b] = value;
    }

    var text;
    try { text = new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch (e) { text = ''; }

    if (text.slice(0, 4) !== MAGIC) {
      out.warn('Found a plausible length header but no valid payload.');
      out.dim('Either this image was not written by this tool, or it uses a');
      out.dim('different LSB scheme — bit order and channel order vary.');
      lsbView(data);
      return;
    }

    out.ok('HIDDEN MESSAGE FOUND');
    out.rule();
    out.row('length', len - 4 + ' bytes');
    out.rule();
    out.heading('Message');
    out.line(text.slice(4));
    document.getElementById('tool-text').value = text.slice(4);
    out.rule();
    out.dim('Recovered by reading the last bit of every colour channel in order.');
    out.dim('No key was needed, because there is no key — that is the whole');
    out.dim('point about steganography being concealment, not protection.');
  }

  /* Amplify the low bits into a visible image. Structure here — text, edges,
     blocks — is a strong sign something was written into them. */
  function lsbView(data) {
    var canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    var ctx = canvas.getContext('2d');
    var view = ctx.createImageData(canvas.width, canvas.height);
    for (var i = 0; i < data.length; i += 4) {
      view.data[i]     = (data[i] & 1) * 255;
      view.data[i + 1] = (data[i + 1] & 1) * 255;
      view.data[i + 2] = (data[i + 2] & 1) * 255;
      view.data[i + 3] = 255;
    }
    ctx.putImageData(view, 0, 0);
    var preview = document.getElementById('tool-preview');
    if (preview) { preview.src = canvas.toDataURL('image/png'); preview.hidden = false; }
    out.rule();
    out.heading('Low-bit view');
    out.dim('The preview now shows every least-significant bit amplified to full');
    out.dim('brightness. Random static is normal. Visible text, sharp edges or a');
    out.dim('rectangle of solid noise in one corner means data was written there.');
  }

  LabTool.define({
    id: 'steganographytool',
    run: extract,
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: loadImage,
        onError: function (msg) { out.clear().err(msg); }
      });
      /* Only "Hide message" is wired by hand. Extract is `run` above, and
         LabTool.define already binds that to #tool-run and to Ctrl+Enter — so
         the toolbar's second plain "Extract" button, wired here to the same
         function, was one action wearing two buttons: two things to keep in
         step, and a visitor left guessing which of the two did more. */
      document.getElementById('tool-hide').addEventListener('click', hide);
      out.dim('Drop a PNG. Then either hide a message in it, or extract one.');
      out.dim('');
      out.dim('Nothing is uploaded — the pixels are read and rewritten in this');
      out.dim('tab, and the result comes back as a download.');
    }
  });
})();

/* ==========================================================================
   file-inspector.js — magic bytes, hex view, strings and entropy.
   --------------------------------------------------------------------------
   The four things you actually do to an unknown file before deciding what it
   is, in one page:

     - the signature, because an extension is a claim and the first bytes are
       evidence. A .jpg that begins MZ is a Windows executable someone renamed.
     - a hex dump, because sometimes you just need to look.
     - printable strings, the oldest triage trick there is — URLs, paths and
       error messages survive inside binaries.
     - a Shannon entropy graph. Uniform ~8 bits/byte means compressed or
       encrypted; a normal executable sits far lower, so a high-entropy block
       inside an otherwise ordinary binary is where packed code hides.

   Everything runs on the bytes in this tab. Nothing is uploaded, which is what
   makes it safe to point at a file you do not trust.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 64 * 1024 * 1024;

  /* Signatures are matched on bytes, never on the filename. Longest first so
     a more specific match wins over a shorter prefix. */
  var SIGNATURES = [
    { hex: '89504e470d0a1a0a', type: 'PNG image' },
    { hex: 'ffd8ff',           type: 'JPEG image' },
    { hex: '474946383761',     type: 'GIF image (87a)' },
    { hex: '474946383961',     type: 'GIF image (89a)' },
    { hex: '52494646',         type: 'RIFF container (WAV, AVI or WEBP)' },
    { hex: '25504446',         type: 'PDF document' },
    { hex: '504b0304',         type: 'ZIP archive — also DOCX, XLSX, PPTX, JAR, APK' },
    { hex: '504b0506',         type: 'ZIP archive (empty)' },
    { hex: '526172211a07',     type: 'RAR archive' },
    { hex: '377abcaf271c',     type: '7-Zip archive' },
    { hex: '1f8b08',           type: 'GZIP archive' },
    { hex: '425a68',           type: 'BZIP2 archive' },
    { hex: 'fd377a585a00',     type: 'XZ archive' },
    { hex: '4d5a',             type: 'Windows executable (PE/EXE/DLL)' },
    { hex: '7f454c46',         type: 'ELF binary (Linux/Unix executable)' },
    { hex: 'cffaedfe',         type: 'Mach-O binary (macOS, 64-bit)' },
    { hex: 'cefaedfe',         type: 'Mach-O binary (macOS, 32-bit)' },
    { hex: 'cafebabe',         type: 'Java class file or Mach-O fat binary' },
    { hex: '0061736d',         type: 'WebAssembly module' },
    { hex: '53514c69746520',   type: 'SQLite database' },
    { hex: 'd0cf11e0a1b11ae1', type: 'Microsoft Compound File — legacy DOC, XLS, MSI' },
    { hex: '7b5c727466',       type: 'RTF document' },
    { hex: '3c3f786d6c',       type: 'XML document' },
    { hex: '4f676753',         type: 'OGG media' },
    { hex: '664c614300',       type: 'FLAC audio' },
    { hex: '494433',           type: 'MP3 audio (ID3)' },
    { hex: '000001ba',         type: 'MPEG program stream' },
    { hex: '1a45dfa3',         type: 'Matroska / WebM' },
    { hex: '38425053',         type: 'Photoshop document' },
    { hex: '4344303031',       type: 'ISO 9660 disc image' },
    { hex: 'edabeedb',         type: 'RPM package' },
    { hex: '213c617263683e',   type: 'Debian package / ar archive' }
  ];

  var EXT_HINT = {
    'png': 'PNG image', 'jpg': 'JPEG image', 'jpeg': 'JPEG image',
    'gif': 'GIF image', 'pdf': 'PDF document', 'zip': 'ZIP archive',
    'docx': 'ZIP archive', 'xlsx': 'ZIP archive', 'pptx': 'ZIP archive',
    'exe': 'Windows executable', 'dll': 'Windows executable',
    'jar': 'ZIP archive', 'apk': 'ZIP archive', 'gz': 'GZIP archive',
    'mp3': 'MP3 audio', 'wav': 'RIFF container', 'sqlite': 'SQLite database',
    'db': 'SQLite database', 'iso': 'ISO 9660 disc image', 'wasm': 'WebAssembly module'
  };

  function detect(bytes) {
    var head = LabTool.toHex(bytes.subarray(0, 16));
    var best = null;
    SIGNATURES.forEach(function (sig) {
      if (head.indexOf(sig.hex) === 0 && (!best || sig.hex.length > best.hex.length)) {
        best = sig;
      }
    });
    return best;
  }

  function hexdump(bytes, limit) {
    var lines = [];
    var end = Math.min(bytes.length, limit);
    for (var off = 0; off < end; off += 16) {
      var slice = bytes.subarray(off, Math.min(off + 16, end));
      var hex = '', ascii = '';
      for (var i = 0; i < 16; i++) {
        hex += (i < slice.length ? ((slice[i] < 16 ? '0' : '') + slice[i].toString(16)) : '  ') + ' ';
        if (i === 7) hex += ' ';
        if (i < slice.length) {
          ascii += (slice[i] >= 0x20 && slice[i] < 0x7f) ? String.fromCharCode(slice[i]) : '.';
        }
      }
      lines.push(('00000000' + off.toString(16)).slice(-8) + '  ' + hex + ' |' + ascii + '|');
    }
    return lines.join('\n');
  }

  function strings(bytes, minLen, limit) {
    var found = [], current = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b >= 0x20 && b < 0x7f) {
        current += String.fromCharCode(b);
      } else {
        if (current.length >= minLen) {
          found.push(current);
          if (found.length >= limit) return found;
        }
        current = '';
      }
    }
    if (current.length >= minLen) found.push(current);
    return found;
  }

  /* A coarse entropy profile: the file in 48 blocks, each drawn as a bar.
     Enough to see a packed section without pretending to be a real plot. */
  function entropyGraph(bytes) {
    var BLOCKS = 48;
    var size = Math.max(1, Math.floor(bytes.length / BLOCKS));
    var rows = [];
    for (var i = 0; i < BLOCKS && i * size < bytes.length; i++) {
      var block = bytes.subarray(i * size, Math.min((i + 1) * size, bytes.length));
      var h = LabTool.entropy(block);
      var filled = Math.round((h / 8) * 30);
      rows.push({ h: h, bar: '█'.repeat(filled) + '·'.repeat(30 - filled),
                  at: i * size });
    }
    return rows;
  }

  var out = LabTool.out('tool-out');

  /* The bytes the report was built from, kept so it can be rebuilt.

     Without this, the "Re-analyse" button (and its Ctrl+Enter binding) had
     nothing to re-analyse: it cleared the pane and asked for a file that was
     already loaded, with the filename still displayed beside it. Every sibling
     tool — archive, exif, pcap, har — re-runs from cached bytes; this one was
     the exception. It also fixes the "Minimum string length" control, which
     re-dispatched a change event at the file input: that never fires for a
     dropped file, because the drop handler reads dataTransfer.files and leaves
     input.files empty. */
  var lastBytes = null;
  var lastFile = null;

  function analyse(bytes, file) {
    lastBytes = bytes;
    lastFile = file;
    out.clear();
    out.heading(file.name);
    out.row('size', LabTool.humanBytes(bytes.length) + '  (' + bytes.length + ' bytes)');
    out.row('last modified', file.lastModified ? new Date(file.lastModified).toISOString() : 'unknown');
    out.rule();

    // ---- signature ----
    var sig = detect(bytes);
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var claimed = EXT_HINT[ext];
    out.row('first 16 bytes', LabTool.toHex(bytes.subarray(0, 16)));
    if (sig) {
      out.row('actual type', sig.type, 't-ok');
    } else {
      out.row('actual type', 'no known signature — plain text, or an unlisted format', 't-warn');
    }
    out.row('extension says', claimed || ('.' + ext + ' (no strong expectation)'));

    if (sig && claimed && sig.type.indexOf(claimed.split(' ')[0]) === -1) {
      out.line('');
      out.err('MISMATCH — the extension claims ' + claimed + ' but the bytes say ' + sig.type + '.');
      out.dim('That is not automatically malicious: .docx really is a ZIP, and');
      out.dim('.apk and .jar are too. It IS the first thing worth explaining.');
    }

    // ---- entropy ----
    var overall = LabTool.entropy(bytes);
    out.rule();
    out.row('entropy', overall.toFixed(3) + ' bits/byte',
            overall > 7.5 ? 't-warn' : 't-ok');
    if (overall > 7.5) {
      out.dim('Near 8 means compressed or encrypted. Expected for an archive or');
      out.dim('a media file; on a plain executable it suggests packing.');
    } else if (overall < 1.5) {
      out.dim('Very low — long runs of the same byte, like a sparse or padded file.');
    } else {
      out.dim('Typical of text, code or an uncompressed binary.');
    }

    out.line('');
    out.dim('entropy across the file (each row is one block)');
    entropyGraph(bytes).forEach(function (row) {
      out.write(('00000000' + row.at.toString(16)).slice(-8) + '  ', 't-dim');
      out.write(row.bar, row.h > 7.5 ? 't-warn' : 't-ok');
      out.line('  ' + row.h.toFixed(2));
    });

    // ---- hex ----
    out.rule();
    out.dim('first 256 bytes');
    out.line(hexdump(bytes, 256));

    // ---- strings ----
    var minLen = parseInt(document.getElementById('tool-minlen').value, 10) || 6;
    var found = strings(bytes, minLen, 200);
    out.rule();
    out.dim('printable strings of ' + minLen + '+ characters (first 200)');
    if (!found.length) {
      out.dim('none — consistent with compressed or encrypted content');
    } else {
      found.forEach(function (s) { out.line('  ' + s); });
    }
  }

  LabTool.define({
    id: 'fileinspectortool',
    run: function () {
      if (lastBytes && lastFile) { analyse(lastBytes, lastFile); return; }
      out.clear().warn('Choose or drop a file to inspect.');
    },
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          document.getElementById('tool-dropname').textContent = file.name;
          analyse(bytes, file);
        },
        onError: function (msg) { out.clear().err(msg); }
      });
      document.getElementById('tool-minlen').addEventListener('change', function () {
        // Re-run from the cached bytes rather than poking the file input, so
        // this works for a dropped file too.
        if (lastBytes && lastFile) analyse(lastBytes, lastFile);
      });
      out.dim('Drop any file above. Nothing is uploaded — it is read and');
      out.dim('analysed inside this tab, which is what makes it safe to point');
      out.dim('at something you do not trust.');
    }
  });
})();

/* ==========================================================================
   hash-worker.js — streams a file through every hash at once, off the main
   thread.
   --------------------------------------------------------------------------
   The file never exists in memory as a whole. It arrives as a File handle
   (structured-cloned, so no bytes are copied across the boundary), and this
   worker pulls it through in 4 MB chunks, feeding each chunk to all five
   engines before letting it go. Peak memory is one chunk plus five small
   states — flat, whatever the file's size. That is what removed the old
   256 MB ceiling.

   Doing it here rather than on the main thread is the other half: hashing a
   few gigabytes is minutes of solid arithmetic, and on the main thread that is
   a frozen tab. The page stays interactive and gets a progress figure.

   Nothing is uploaded. There is no fetch, no XHR and no network of any kind in
   this file — the same promise the rest of the labs make, and the reason it is
   safe to drop evidence into.
   ========================================================================== */

'use strict';

/* The version hash.js put on this worker's own URL is carried through to the
   engines, so the two halves of the implementation can never be served from
   different builds. A worker running last week's engines against this week's
   page would produce digests nobody could reproduce. */
importScripts('/assets/js/labs/tools/hash-engines.js' + self.location.search);

/* 4 MB: big enough that per-chunk overhead disappears against the hashing
   itself, small enough that a phone is never asked for a large allocation and
   progress still moves visibly on a slow disk. */
var CHUNK = 4 * 1024 * 1024;

/* Below this, the file is read whole and the SHA family goes through WebCrypto
   instead of the JavaScript engines. Measured in this worker on 20 MB:

     WebCrypto SHA-256   181 MB/s
     JS        SHA-256    11.4 MB/s
     JS        SHA-384     5.7 MB/s   (64-bit words emulated in 32-bit pairs)
     JS        SHA-512     4.9 MB/s
     JS        all five     1.5 MB/s

   Sixteen times slower for SHA-256, and SHA-384+512 alone are well over half
   the total. Streaming is what makes an arbitrarily large file possible at all,
   but paying its cost on a 30 MB file nobody needed to stream would be silly.

   The ceiling is a performance switch, NOT the old rejection: past it the file
   still hashes, just through the streaming path. And the fast path now costs
   one copy of the file rather than the two the original code needed, because
   the MD5 here is incremental and no longer allocates a padded duplicate. */
var FAST_MAX = 256 * 1024 * 1024;

function hex(buffer) {
  var b = new Uint8Array(buffer);
  var s = '';
  for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

function webCryptoAvailable() {
  return typeof crypto !== 'undefined' && crypto.subtle &&
    typeof crypto.subtle.digest === 'function';
}

var WEB_ALG = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

/* Progress messages are throttled by time, not by chunk count. A fast SSD
   delivers 4 MB chunks faster than a screen refreshes, and posting on every
   one of them makes the main thread do more work rendering the number than
   this worker does hashing. */
var PROGRESS_MS = 120;

var cancelled = false;

function hexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/* HMAC block size in bytes — the compression-function block, not the digest
   length. SHA-384/512 use 1024-bit blocks; everything else here uses 512-bit. */
function blockSizeOf(alg) {
  return (alg === 'sha384' || alg === 'sha512') ? 128 : 64;
}

/* HMAC(K, m) = H((K' ^ opad) || H((K' ^ ipad) || m)), with K' the key padded
   to the block size, or hashed first if it is longer than one block. The inner
   hash is incremental, so the message still streams. */
function HmacEngine(alg, key) {
  var bs = blockSizeOf(alg);
  var k = key;
  if (k.length > bs) {
    var kh = HashEngines.create(alg);
    kh.update(k);
    k = hexToBytes(kh.digest());
  }
  var padded = new Uint8Array(bs);
  padded.set(k);

  this.alg = alg;
  this.opad = new Uint8Array(bs);
  var ipad = new Uint8Array(bs);
  for (var i = 0; i < bs; i++) {
    ipad[i] = padded[i] ^ 0x36;
    this.opad[i] = padded[i] ^ 0x5c;
  }
  this.inner = HashEngines.create(alg);
  this.inner.update(ipad);
}

HmacEngine.prototype.update = function (bytes) { this.inner.update(bytes); };

HmacEngine.prototype.digest = function () {
  var innerDigest = hexToBytes(this.inner.digest());
  var outer = HashEngines.create(this.alg);
  outer.update(this.opad);
  outer.update(innerDigest);
  return outer.digest();
};

function makeEngines(algs, hmacKey) {
  var map = {};
  algs.forEach(function (alg) {
    map[alg] = hmacKey ? new HmacEngine(alg, hmacKey) : HashEngines.create(alg);
  });
  return map;
}

/* Reading. file.stream() is the good path — the browser hands over chunks as
   it reads them and never materialises the file. The slice() fallback is for
   engines without Blob.stream(); it is the same shape, just asking for each
   window explicitly. */
async function streamFile(file, onChunk) {
  if (typeof file.stream === 'function') {
    var reader = file.stream().getReader();
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      if (cancelled) { reader.cancel(); return; }
      var value = step.value;
      /* Some engines hand back an ArrayBuffer rather than a view. */
      onChunk(value instanceof Uint8Array ? value : new Uint8Array(value));
    }
    return;
  }

  for (var offset = 0; offset < file.size; offset += CHUNK) {
    if (cancelled) return;
    var slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
    var buf = await slice.arrayBuffer();
    onChunk(new Uint8Array(buf));
  }
}

self.onmessage = async function (event) {
  var data = event.data || {};

  if (data.op === 'cancel') {
    cancelled = true;
    return;
  }

  if (data.op !== 'file') return;

  cancelled = false;
  var file = data.file;
  var algs = data.algs || HashEngines.names;

  try {
    /* Fast path. Plain digests only: WebCrypto has no MD5, so a keyed run would
       come back missing HMAC-MD5 and the two paths would disagree about what
       they produce. Keying a file is rare enough that always streaming it is
       the honest trade. */
    if (!data.hmacKey && file.size <= FAST_MAX && webCryptoAvailable()) {
      self.postMessage({ type: 'progress', loaded: 0, total: file.size });
      var buffer = await file.arrayBuffer();
      if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }
      var bytes = new Uint8Array(buffer);
      var fast = {};

      /* MD5 is not in WebCrypto, so it stays on the JS engine — over an array
         that already exists, which costs no extra memory. */
      if (algs.indexOf('md5') !== -1) {
        var m = HashEngines.create('md5');
        m.update(bytes);
        fast.md5 = m.digest();
      }
      for (var ai = 0; ai < algs.length; ai++) {
        var a = algs[ai];
        if (a === 'md5') continue;
        fast[a] = hex(await crypto.subtle.digest(WEB_ALG[a], bytes));
        if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }
      }

      self.postMessage({ type: 'progress', loaded: file.size, total: file.size });
      self.postMessage({ type: 'done', digests: fast, bytes: file.size });
      return;
    }

    var engines = makeEngines(algs, data.hmacKey || null);
    var names = Object.keys(engines);
    var read = 0;
    var lastPost = 0;

    await streamFile(file, function (chunk) {
      for (var i = 0; i < names.length; i++) {
        engines[names[i]].update(chunk);
      }
      read += chunk.length;
      var now = Date.now();
      if (now - lastPost >= PROGRESS_MS) {
        lastPost = now;
        self.postMessage({ type: 'progress', loaded: read, total: file.size });
      }
    });

    if (cancelled) {
      self.postMessage({ type: 'cancelled' });
      return;
    }

    var digests = {};
    names.forEach(function (name) { digests[name] = engines[name].digest(); });

    self.postMessage({ type: 'done', digests: digests, bytes: read });
  } catch (err) {
    /* A read can fail mid-way if the file was moved or a network drive went
       away — the page has to say so rather than sit on a stalled progress bar. */
    self.postMessage({
      type: 'error',
      message: (err && err.message) ? err.message : 'That file could not be read.'
    });
  }
};

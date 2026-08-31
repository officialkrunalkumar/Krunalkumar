/* ==========================================================================
   git-objects.js — a real git object store, running in the tab.
   --------------------------------------------------------------------------
   The blog post /blog/git-explained-from-the-object-up argues that every git
   command stops being magic once you can see the three things it moves and the
   four kinds of object it writes. This is that argument made executable: a toy
   working tree you can edit, a shell that takes real commands, and a live view
   of the objects those commands actually write.

   The one thing this had to get right is the hashes.

   A teaching tool that prints a made-up hash teaches nothing — worse, it
   teaches that the hash is decoration. So the object bytes here are formed
   exactly as git forms them:

     blob   "blob "   + byteLength + NUL + content
     tree   "tree "   + byteLength + NUL + repeated( mode + " " + name + NUL + 20 raw bytes )
     commit "commit " + byteLength + NUL + "tree ...\nparent ...\nauthor ...\ncommitter ...\n\nmessage\n"
     tag    "tag "    + byteLength + NUL + "object ...\ntype ...\ntag ...\ntagger ...\n\nmessage\n"

   and SHA-1 is implemented below over those bytes. The proof is checkable
   without trusting me: the empty blob must hash to
   e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 and the empty tree to
   4b825dc642cb6eb9a060e54bf8d69288fbee4904 — two constants any git user can
   confirm with `git hash-object -t blob /dev/null`. Those checks run at start-up
   and their results are printed in the Objects panel. If they ever fail, the
   panel says so instead of pretending.

   The author and committer identity is fixed and the clock is simulated (it
   advances a minute per commit from a fixed epoch) so that the hashes you see
   are reproducible run to run, and so a curious visitor can reproduce them in a
   real repository. Real git uses your name and your system clock, which is
   exactly why two commits of identical content made a second apart still get
   different names.

   Deliberate simplifications, stated here rather than hidden:
     - Merges and rebases resolve per FILE, not per line. Git's own three-way
       merge works on hunks. Conflict detection ("both sides changed this, and
       differently") is the lesson; line-level merging is not.
     - The merge base is the first common ancestor found breadth-first, not a
       full lowest-common-ancestor computation over criss-cross merges.
     - Objects are never garbage-collected, which is what makes the reflog panel
       able to prove nothing is lost.
     - There is no packfile, no delta compression and no zlib. Git compresses
       loose objects before writing them to disk; compression happens AFTER the
       hash is computed, so it changes nothing about the names.

   Nothing here opens a network connection. There is no server and no upload.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  var NUL = String.fromCharCode(0);
  var AUTHOR = 'Toy User <you@example.com>';
  var EPOCH = 1700000000;          // fixed start so every session hashes alike
  var TICK = 60;                   // simulated seconds between commits
  var MAX_GRAPH_ROWS = 80;
  var MAX_FILE_CHARS = 4000;

  /* ====================================================================== */
  /*  SHA-1                                                                 */
  /* ====================================================================== */

  /* Written out rather than delegated to crypto.subtle.digest, which is async:
     every hash here happens inside a synchronous command, and threading a
     promise through `git commit` would buy nothing but complexity. It is the
     plain FIPS 180-1 algorithm; the only subtlety is that every intermediate is
     forced back to 32 bits with |0, because JavaScript numbers are doubles and
     the additions would otherwise silently keep the high bits. */
  function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }

  function sha1Hex(bytes) {
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE,
        h3 = 0x10325476, h4 = 0xC3D2E1F0;
    var len = bytes.length;
    var padLen = (56 - ((len + 1) % 64) + 64) % 64;
    var total = len + 1 + padLen + 8;
    var msg = new Array(total);
    var i, t;
    for (i = 0; i < len; i++) msg[i] = bytes[i] & 0xff;
    msg[len] = 0x80;
    for (i = len + 1; i < total - 8; i++) msg[i] = 0;
    // Message length in BITS as a 64-bit big-endian integer. Splitting on 2^29
    // bytes keeps both halves inside exact double precision.
    var hi = Math.floor(len / 536870912);
    var lo = (len * 8) % 4294967296;
    msg[total - 8] = (hi >>> 24) & 0xff;
    msg[total - 7] = (hi >>> 16) & 0xff;
    msg[total - 6] = (hi >>> 8) & 0xff;
    msg[total - 5] = hi & 0xff;
    msg[total - 4] = Math.floor(lo / 16777216) & 0xff;
    msg[total - 3] = Math.floor(lo / 65536) & 0xff;
    msg[total - 2] = Math.floor(lo / 256) & 0xff;
    msg[total - 1] = lo & 0xff;

    var w = new Array(80);
    for (var off = 0; off < total; off += 64) {
      for (t = 0; t < 16; t++) {
        w[t] = (msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
               (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3];
      }
      for (t = 16; t < 80; t++) {
        w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f, k, tmp;
      for (t = 0; t < 80; t++) {
        if (t < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
        else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        tmp = (rotl(a, 5) + f + e + k + w[t]) | 0;
        e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return hex32(h0) + hex32(h1) + hex32(h2) + hex32(h3) + hex32(h4);
  }

  function hex32(n) {
    var s = (n >>> 0).toString(16);
    while (s.length < 8) s = '0' + s;
    return s;
  }

  /* ====================================================================== */
  /*  BYTES                                                                 */
  /* ====================================================================== */

  /* Byte length is not character length, and git's object header counts bytes.
     A file containing one emoji is 4 bytes to git and 2 "characters" to
     JavaScript; getting that wrong would give every non-ASCII file a wrong
     hash, so the encoder is explicit rather than implied. */
  function utf8Bytes(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff) {
        c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                   0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          out.push(0xef, 0xbf, 0xbd);   // lone high surrogate -> U+FFFD
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        out.push(0xef, 0xbf, 0xbd);     // lone low surrogate -> U+FFFD
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8Decode(bytes, from, to) {
    var out = '', i = from, b, c;
    while (i < to) {
      b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
      else if (b < 0xe0) { out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; }
      else if (b < 0xf0) {
        out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63));
        i += 3;
      } else {
        c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) |
            ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
        c -= 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
        i += 4;
      }
    }
    return out;
  }

  function pushStr(arr, str) {
    var b = utf8Bytes(str);
    for (var i = 0; i < b.length; i++) arr.push(b[i]);
  }

  function pushHex(arr, hex) {
    for (var i = 0; i < hex.length; i += 2) arr.push(parseInt(hex.substr(i, 2), 16));
  }

  function hexFrom(bytes, at, n) {
    var s = '', i, h;
    for (i = 0; i < n; i++) {
      h = (bytes[at + i] & 0xff).toString(16);
      s += h.length < 2 ? '0' + h : h;
    }
    return s;
  }

  function short(oid) { return oid ? oid.slice(0, 7) : '(none)'; }

  /* ====================================================================== */
  /*  THE OBJECT STORE                                                      */
  /* ====================================================================== */

  function Repo() { this.reset(); }

  Repo.prototype.reset = function () {
    this.objects = {};        // oid -> { type, head, body, size, n }
    this.seq = 0;
    this.refs = {};           // full ref name -> oid
    this.head = { detached: false, ref: 'refs/heads/main', oid: null };
    this.index = {};          // path -> blob oid  (the staging area)
    this.work = {};           // path -> string    (the working tree)
    this.conflicts = {};      // path -> true
    this.merging = null;      // { theirs, label } while a conflicted merge is open
    this.reflog = [];         // newest FIRST, so reflog[n] is HEAD@{n}
    this.clock = EPOCH;
    this.wrote = [];          // objects touched by the command in flight
  };

  Repo.prototype.tick = function () {
    this.clock += TICK;
    return this.clock;
  };

  /* The single place an object is ever created. Content addressing lives here:
     the name is computed from the bytes, so storing bytes that are already in
     the store is a no-op that returns the same name. That is not an
     optimisation bolted on top of git — it IS git. */
  Repo.prototype.store = function (type, body) {
    var head = utf8Bytes(type + ' ' + body.length + NUL);
    var full = head.concat(body);
    var oid = sha1Hex(full);
    if (this.objects[oid]) {
      this.wrote.push({ oid: oid, type: type, reused: true });
      return oid;
    }
    this.seq += 1;
    this.objects[oid] = { type: type, head: head, body: body, size: body.length, n: this.seq };
    this.wrote.push({ oid: oid, type: type, reused: false });
    return oid;
  };

  /* Hash without storing — what `git status` and `git hash-object` (without -w)
     do. Keeping these separate is the reason the object count on screen is
     honest: only `add`, `commit` and friends actually write. */
  Repo.prototype.hashOnly = function (type, body) {
    return sha1Hex(utf8Bytes(type + ' ' + body.length + NUL).concat(body));
  };

  Repo.prototype.blobOidOf = function (content) {
    return this.hashOnly('blob', utf8Bytes(content));
  };

  Repo.prototype.writeBlob = function (content) {
    return this.store('blob', utf8Bytes(content));
  };

  Repo.prototype.get = function (oid) { return this.objects[oid] || null; };

  /* ---- trees ----------------------------------------------------------- */

  /* Git sorts tree entries by name as raw bytes, with a '/' conceptually
     appended to directory names — which is why "lib" sorts after "lib.txt"
     inside a tree. Get this wrong and every tree above a subdirectory gets the
     wrong hash even though the entries are all correct. */
  function entrySortKey(e) { return e.type === 'tree' ? e.name + '/' : e.name; }

  Repo.prototype.writeTreeFromPaths = function (paths) {
    var root = { dirs: {}, files: {} };
    var keys = Object.keys(paths), i, j, parts, node;
    for (i = 0; i < keys.length; i++) {
      parts = keys[i].split('/');
      node = root;
      for (j = 0; j < parts.length - 1; j++) {
        if (!node.dirs[parts[j]]) node.dirs[parts[j]] = { dirs: {}, files: {} };
        node = node.dirs[parts[j]];
      }
      node.files[parts[parts.length - 1]] = paths[keys[i]];
    }
    return this.writeTreeNode(root);
  };

  Repo.prototype.writeTreeNode = function (node) {
    var entries = [], names, i, body = [];
    names = Object.keys(node.files);
    for (i = 0; i < names.length; i++) {
      entries.push({ mode: '100644', name: names[i], oid: node.files[names[i]], type: 'blob' });
    }
    names = Object.keys(node.dirs);
    for (i = 0; i < names.length; i++) {
      entries.push({ mode: '40000', name: names[i], oid: this.writeTreeNode(node.dirs[names[i]]), type: 'tree' });
    }
    entries.sort(function (a, b) {
      var ka = entrySortKey(a), kb = entrySortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (i = 0; i < entries.length; i++) {
      pushStr(body, entries[i].mode + ' ' + entries[i].name + NUL);
      pushHex(body, entries[i].oid);
    }
    return this.store('tree', body);
  };

  Repo.prototype.parseTree = function (oid) {
    var o = this.get(oid);
    if (!o || o.type !== 'tree') return [];
    var b = o.body, i = 0, out = [], j, mode, name;
    while (i < b.length) {
      j = i; while (j < b.length && b[j] !== 0x20) j++;
      mode = utf8Decode(b, i, j);
      i = j + 1;
      j = i; while (j < b.length && b[j] !== 0) j++;
      name = utf8Decode(b, i, j);
      i = j + 1;
      out.push({ mode: mode, name: name, oid: hexFrom(b, i, 20), type: mode === '40000' ? 'tree' : 'blob' });
      i += 20;
    }
    return out;
  };

  /* Flatten a tree to the shape everything else here works in: path -> blob. */
  Repo.prototype.flatten = function (treeOid, prefix, into) {
    into = into || {};
    if (!treeOid) return into;
    var e = this.parseTree(treeOid), i;
    for (i = 0; i < e.length; i++) {
      if (e[i].type === 'tree') this.flatten(e[i].oid, (prefix || '') + e[i].name + '/', into);
      else into[(prefix || '') + e[i].name] = e[i].oid;
    }
    return into;
  };

  /* ---- commits --------------------------------------------------------- */

  Repo.prototype.writeCommit = function (treeOid, parents, message, authorTs) {
    var ct = this.tick();
    var at = authorTs == null ? ct : authorTs;
    var text = 'tree ' + treeOid + '\n';
    var i;
    for (i = 0; i < parents.length; i++) text += 'parent ' + parents[i] + '\n';
    text += 'author ' + AUTHOR + ' ' + at + ' +0000\n';
    text += 'committer ' + AUTHOR + ' ' + ct + ' +0000\n';
    text += '\n' + String(message).replace(/\s+$/, '') + '\n';
    return this.store('commit', utf8Bytes(text));
  };

  Repo.prototype.parseCommit = function (oid) {
    var o = this.get(oid);
    if (!o || o.type !== 'commit') return null;
    var text = utf8Decode(o.body, 0, o.body.length);
    var split = text.indexOf('\n\n');
    var headPart = split < 0 ? text : text.slice(0, split);
    var message = split < 0 ? '' : text.slice(split + 2);
    var lines = headPart.split('\n');
    var res = { oid: oid, tree: null, parents: [], author: '', committer: '',
                authorTs: 0, committerTs: 0, message: message, raw: text };
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('tree ') === 0) res.tree = l.slice(5);
      else if (l.indexOf('parent ') === 0) res.parents.push(l.slice(7));
      else if (l.indexOf('author ') === 0) {
        res.author = l.slice(7);
        res.authorTs = parseInt((l.match(/ (\d+) [+-]\d{4}$/) || [0, 0])[1], 10) || 0;
      } else if (l.indexOf('committer ') === 0) {
        res.committer = l.slice(10);
        res.committerTs = parseInt((l.match(/ (\d+) [+-]\d{4}$/) || [0, 0])[1], 10) || 0;
      }
    }
    res.subject = res.message.split('\n')[0];
    return res;
  };

  Repo.prototype.writeTag = function (target, name, message) {
    var text = 'object ' + target + '\ntype commit\ntag ' + name + '\n' +
               'tagger ' + AUTHOR + ' ' + this.tick() + ' +0000\n' +
               '\n' + String(message).replace(/\s+$/, '') + '\n';
    return this.store('tag', utf8Bytes(text));
  };

  /* ---- refs and revisions ---------------------------------------------- */

  Repo.prototype.headOid = function () {
    return this.head.detached ? this.head.oid : (this.refs[this.head.ref] || null);
  };

  Repo.prototype.branchNames = function () {
    var out = [], k = Object.keys(this.refs), i;
    for (i = 0; i < k.length; i++) if (k[i].indexOf('refs/heads/') === 0) out.push(k[i].slice(11));
    out.sort();
    return out;
  };

  Repo.prototype.tagNames = function () {
    var out = [], k = Object.keys(this.refs), i;
    for (i = 0; i < k.length; i++) if (k[i].indexOf('refs/tags/') === 0) out.push(k[i].slice(10));
    out.sort();
    return out;
  };

  /* Peel an annotated tag down to the commit it points at. */
  Repo.prototype.peel = function (oid) {
    var guard = 0;
    while (oid && this.get(oid) && this.get(oid).type === 'tag' && guard++ < 10) {
      var text = utf8Decode(this.get(oid).body, 0, this.get(oid).body.length);
      var m = text.match(/^object ([0-9a-f]{40})/);
      oid = m ? m[1] : null;
    }
    return oid;
  };

  Repo.prototype.resolve = function (spec) {
    if (!spec) return null;
    var self = this, base = spec, steps = [], m;
    // Split trailing ~n / ^ suffixes off the name.
    var suffix = /(~\d+|~|\^\d?)+$/.exec(spec);
    if (suffix) {
      base = spec.slice(0, spec.length - suffix[0].length);
      var re = /(~\d+|~|\^\d?)/g, part;
      while ((part = re.exec(suffix[0])) !== null) steps.push(part[1]);
    }
    var oid = null;
    if (base === 'HEAD' || base === '') {
      oid = this.headOid();
    } else if ((m = /^HEAD@\{(\d+)\}$/.exec(base)) !== null) {
      var entry = this.reflog[parseInt(m[1], 10)];
      oid = entry ? entry.after : null;
    } else if (this.refs['refs/heads/' + base]) {
      oid = this.refs['refs/heads/' + base];
    } else if (this.refs['refs/tags/' + base]) {
      oid = this.peel(this.refs['refs/tags/' + base]);
    } else if (/^[0-9a-f]{4,40}$/.test(base)) {
      var hits = [], keys = Object.keys(this.objects), i;
      for (i = 0; i < keys.length; i++) if (keys[i].indexOf(base) === 0) hits.push(keys[i]);
      if (hits.length === 1) oid = this.peel(hits[0]);
      else if (hits.length > 1) return { ambiguous: true };
    }
    if (!oid) return null;
    for (var s = 0; s < steps.length; s++) {
      var step = steps[s], n = 1, which = 0;
      if (step.charAt(0) === '~') { n = step.length > 1 ? parseInt(step.slice(1), 10) : 1; }
      else { which = step.length > 1 ? parseInt(step.slice(1), 10) - 1 : 0; n = 0; }
      if (n) {
        for (var k = 0; k < n; k++) {
          var c = self.parseCommit(oid);
          if (!c || !c.parents.length) return null;
          oid = c.parents[0];
        }
      } else {
        var cc = self.parseCommit(oid);
        if (!cc || !cc.parents[which]) return null;
        oid = cc.parents[which];
      }
    }
    return oid;
  };

  /* ---- ancestry -------------------------------------------------------- */

  Repo.prototype.ancestors = function (oid) {
    var seen = {}, stack = [oid], c, i;
    while (stack.length) {
      c = stack.pop();
      if (!c || seen[c]) continue;
      seen[c] = true;
      var p = this.parseCommit(c);
      if (p) for (i = 0; i < p.parents.length; i++) stack.push(p.parents[i]);
    }
    return seen;
  };

  /* First common ancestor found breadth-first from `b`. For the shapes this toy
     can produce that is the merge base; for a criss-cross history real git does
     something cleverer, which is noted on the page rather than faked here. */
  Repo.prototype.mergeBase = function (a, b) {
    var inA = this.ancestors(a), queue = [b], seen = {}, c, i;
    while (queue.length) {
      c = queue.shift();
      if (!c || seen[c]) continue;
      seen[c] = true;
      if (inA[c]) return c;
      var p = this.parseCommit(c);
      if (p) for (i = 0; i < p.parents.length; i++) queue.push(p.parents[i]);
    }
    return null;
  };

  Repo.prototype.reachable = function () {
    var seen = {}, keys = Object.keys(this.refs), i, roots = [];
    for (i = 0; i < keys.length; i++) roots.push(this.peel(this.refs[keys[i]]));
    if (this.head.detached && this.head.oid) roots.push(this.head.oid);
    for (i = 0; i < roots.length; i++) {
      var a = this.ancestors(roots[i]), ks = Object.keys(a), j;
      for (j = 0; j < ks.length; j++) seen[ks[j]] = true;
    }
    return seen;
  };

  /* ---- snapshots (undo) ------------------------------------------------
     Objects are deliberately NOT part of a snapshot. Undoing a commit in real
     git leaves the commit object sitting in .git/objects, unreferenced, until
     it ages out — that is the whole reason the reflog can bring it back. Undo
     here restores the labels and the two working areas and leaves the store
     alone, which is both simpler and truer. */
  Repo.prototype.snapshot = function () {
    return JSON.stringify({
      refs: this.refs, head: this.head, index: this.index, work: this.work,
      conflicts: this.conflicts, merging: this.merging, reflog: this.reflog,
      clock: this.clock
    });
  };

  Repo.prototype.restore = function (json) {
    var s = JSON.parse(json);
    this.refs = s.refs; this.head = s.head; this.index = s.index;
    this.work = s.work; this.conflicts = s.conflicts; this.merging = s.merging;
    this.reflog = s.reflog; this.clock = s.clock;
  };

  Repo.prototype.logHead = function (before, after, action) {
    if (before === after) return;
    this.reflog.unshift({ before: before, after: after, action: action });
  };

  /* ---- the three places ------------------------------------------------ */

  Repo.prototype.headTree = function () {
    var h = this.headOid();
    if (!h) return {};
    var c = this.parseCommit(h);
    return c ? this.flatten(c.tree, '') : {};
  };

  /* Replace index and working tree with the contents of a commit — what
     checkout and `reset --hard` both do to the two lower places. */
  Repo.prototype.materialise = function (commitOid) {
    var paths = {};
    if (commitOid) {
      var c = this.parseCommit(commitOid);
      if (c) paths = this.flatten(c.tree, '');
    }
    this.index = {};
    this.work = {};
    this.conflicts = {};
    var keys = Object.keys(paths), i;
    for (i = 0; i < keys.length; i++) {
      this.index[keys[i]] = paths[keys[i]];
      this.work[keys[i]] = utf8Decode(this.get(paths[keys[i]]).body, 0, this.get(paths[keys[i]]).size);
    }
  };

  Repo.prototype.blobText = function (oid) {
    var o = this.get(oid);
    return o ? utf8Decode(o.body, 0, o.body.length) : '';
  };

  Repo.prototype.dirtyPaths = function () {
    var out = [], keys = Object.keys(this.work), i, p;
    for (i = 0; i < keys.length; i++) {
      p = keys[i];
      if (this.index[p] !== this.blobOidOf(this.work[p])) out.push(p);
    }
    var idx = Object.keys(this.index);
    for (i = 0; i < idx.length; i++) {
      if (!(idx[i] in this.work) && out.indexOf(idx[i]) < 0) out.push(idx[i]);
    }
    var head = this.headTree(), hk = Object.keys(head);
    for (i = 0; i < hk.length; i++) {
      if (this.index[hk[i]] !== head[hk[i]] && out.indexOf(hk[i]) < 0) out.push(hk[i]);
    }
    var ik = Object.keys(this.index);
    for (i = 0; i < ik.length; i++) {
      if (!(ik[i] in head) && out.indexOf(ik[i]) < 0) out.push(ik[i]);
    }
    return out;
  };

  /* ====================================================================== */
  /*  COMMAND PARSING                                                       */
  /* ====================================================================== */

  function tokenize(line) {
    var out = [], cur = '', has = false, q = null, i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line.charAt(i);
      if (q !== null) {
        if (ch === q) q = null; else cur += ch;
        has = true;
      } else if (ch === '"' || ch === "'") {
        q = ch; has = true;
      } else if (ch === ' ' || ch === '\t') {
        if (has) { out.push(cur); cur = ''; has = false; }
      } else {
        cur += ch; has = true;
      }
    }
    if (has) out.push(cur);
    return out;
  }

  function takeFlag(args, name) {
    var i = args.indexOf(name);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
  }

  function takeOption(args, name) {
    var i = args.indexOf(name);
    if (i < 0) return null;
    var v = args[i + 1] == null ? '' : args[i + 1];
    args.splice(i, 2);
    return v;
  }

  /* ====================================================================== */
  /*  THE SHELL                                                             */
  /* ====================================================================== */

  /* Every command returns by pushing lines through `o` (the output sink). None
     of them touch the DOM; the UI re-renders from repo state afterwards. That
     split is what makes the scripted walkthroughs possible — they are just the
     same commands run without a keyboard. */
  function Git(repo, o) { this.r = repo; this.o = o; }

  Git.prototype.run = function (line) {
    var args = tokenize(line);
    if (!args.length) return;
    var cmd = args.shift();
    if (cmd === 'git') { if (!args.length) { this.o.err('usage: git <command>'); return; } cmd = args.shift(); }
    var fn = this['cmd_' + cmd.replace(/-/g, '_')];
    if (typeof fn !== 'function') {
      this.o.err("'" + cmd + "' is not a command this toy knows. Type `help` for the list.");
      return;
    }
    fn.call(this, args);
  };

  /* ---- inspection ------------------------------------------------------ */

  Git.prototype.cmd_help = function () {
    var o = this.o;
    o.line('The repository commands, all doing the real thing to real objects:', 'hd');
    o.pair('status', 'compare the three places and report the differences');
    o.pair('add <path>|.', 'copy the file into the index — writes a blob NOW');
    o.pair('commit -m "msg"', 'seal the index into a tree + a commit, move the branch');
    o.pair('log [--all]', 'walk the parent pointers back from HEAD');
    o.pair('branch [name]', 'list branches, or write a new 41-byte label file');
    o.pair('branch -d <name>', 'delete a branch label (the commits stay)');
    o.pair('checkout <rev>', 'move HEAD, and rewrite the index and working tree');
    o.pair('checkout -b <name>', 'create the branch and move onto it');
    o.pair('switch <name>', 'the modern spelling of checkout for branches');
    o.pair('merge <branch>', 'fast-forward, or write a commit with two parents');
    o.pair('rebase <upstream>', 'replay your commits — new objects, new names');
    o.pair('reset [--soft|--mixed|--hard] <rev>', 'move the label, and how much else');
    o.pair('revert <rev>', 'a NEW commit that undoes an old one');
    o.pair('cherry-pick <rev>', 'replay one commit here');
    o.pair('tag <name> | tag -a <name> -m "msg"', 'a label, or a real tag object');
    o.pair('reflog', "every place HEAD has been — git's diary");
    o.pair('diff [--staged]', 'which paths differ between which two places');
    o.line('');
    o.line('The plumbing, which is where the object model shows through:', 'hd');
    o.pair('cat-file -p|-t|-s <rev>', 'print an object, its type, or its size');
    o.pair('ls-tree [-r] <rev>', 'list the entries of a tree');
    o.pair('hash-object <path>', 'hash a file WITHOUT storing it');
    o.pair('rev-parse <rev>', 'resolve a name to a full 40-character hash');
    o.pair('show-ref', 'every ref, and the hash inside it');
    o.line('');
    o.line('Not git — this toy has no editor, so these stand in for one:', 'hd');
    o.pair('write <path> <text>', 'replace a file in the working tree');
    o.pair('append <path> <text>', 'add a line to a file');
    o.pair('rm <path>', 'remove from the working tree and the index');
    o.pair('undo', 'rewind the repository to before the last command');
    o.pair('clear', 'clear this log (nothing else)');
    o.line('');
    o.dim('You can type the commands with or without a leading "git".');
  };

  Git.prototype.cmd_status = function () {
    var r = this.r, o = this.o;
    var head = r.headTree();
    var i, p, keys;

    if (r.head.detached) {
      o.warn('HEAD detached at ' + short(r.head.oid));
      o.dim('You are not on a branch. New commits here would have no label,');
      o.dim('and only the reflog would remember them.');
    } else {
      o.line('On branch ' + r.head.ref.slice(11), 'hd');
      if (!r.refs[r.head.ref]) o.dim('No commits yet — the branch file does not exist until the first commit.');
    }

    if (r.merging) {
      o.warn('Merge in progress with ' + r.merging.label + '.');
    }
    var conflicted = Object.keys(r.conflicts);
    if (conflicted.length) {
      o.err('Unmerged paths (fix them, then `add` to mark resolved):');
      for (i = 0; i < conflicted.length; i++) o.line('    both modified:  ' + conflicted[i], 'er');
    }

    var staged = [];
    keys = Object.keys(r.index);
    for (i = 0; i < keys.length; i++) {
      p = keys[i];
      if (!(p in head)) staged.push('new file:   ' + p);
      else if (head[p] !== r.index[p]) staged.push('modified:   ' + p);
    }
    keys = Object.keys(head);
    for (i = 0; i < keys.length; i++) if (!(keys[i] in r.index)) staged.push('deleted:    ' + keys[i]);

    var unstaged = [], untracked = [];
    keys = Object.keys(r.work);
    for (i = 0; i < keys.length; i++) {
      p = keys[i];
      if (r.conflicts[p]) continue;
      if (!(p in r.index)) untracked.push(p);
      else if (r.index[p] !== r.blobOidOf(r.work[p])) unstaged.push('modified:   ' + p);
    }
    keys = Object.keys(r.index);
    for (i = 0; i < keys.length; i++) if (!(keys[i] in r.work)) unstaged.push('deleted:    ' + keys[i]);

    staged.sort(); unstaged.sort(); untracked.sort();

    if (staged.length) {
      o.line('');
      o.line('Changes to be committed  (index vs HEAD):', 'hd');
      for (i = 0; i < staged.length; i++) o.line('    ' + staged[i], 'ok');
    }
    if (unstaged.length) {
      o.line('');
      o.line('Changes not staged for commit  (working tree vs index):', 'hd');
      for (i = 0; i < unstaged.length; i++) o.line('    ' + unstaged[i], 'wa');
    }
    if (untracked.length) {
      o.line('');
      o.line('Untracked files  (in the working tree, unknown to the index):', 'hd');
      for (i = 0; i < untracked.length; i++) o.line('    ' + untracked[i], 'er');
    }
    if (!staged.length && !unstaged.length && !untracked.length && !conflicted.length) {
      o.line('');
      o.ok('Nothing to commit — all three places agree.');
    }
  };

  Git.prototype.cmd_add = function (args) {
    var r = this.r, o = this.o;
    if (!args.length) { o.err('usage: add <path> | add .'); return; }
    var targets = [], i, keys = Object.keys(r.work);
    for (i = 0; i < args.length; i++) {
      if (args[i] === '.' || args[i] === '-A' || args[i] === '--all') {
        targets = keys.slice();
        // A path staged for deletion is not in the working tree any more, so it
        // has to come from the index side or `add .` would silently skip it.
        var idx = Object.keys(r.index), j;
        for (j = 0; j < idx.length; j++) if (targets.indexOf(idx[j]) < 0) targets.push(idx[j]);
        break;
      }
      targets.push(args[i]);
    }
    var added = 0, removed = 0;
    for (i = 0; i < targets.length; i++) {
      var p = targets[i];
      if (!(p in r.work)) {
        if (p in r.index) { delete r.index[p]; delete r.conflicts[p]; removed++; continue; }
        o.err("pathspec '" + p + "' did not match any file");
        continue;
      }
      var oid = r.writeBlob(r.work[p]);
      r.index[p] = oid;
      delete r.conflicts[p];
      added++;
      o.line('  staged ' + p + '  -> blob ' + short(oid), 'ok');
    }
    if (removed) o.line('  staged ' + removed + ' deletion(s)', 'wa');
    if (added || removed) {
      o.dim('The index changed. Nothing about your history moved yet.');
    }
  };

  Git.prototype.cmd_write = function (args) {
    var r = this.r, o = this.o;
    if (args.length < 1) { o.err('usage: write <path> <text>'); return; }
    var p = args.shift();
    var text = args.join(' ');
    if (text.length > MAX_FILE_CHARS) { o.err('That is longer than this toy allows (' + MAX_FILE_CHARS + ' characters).'); return; }
    r.work[p] = text + (text.length && text.charAt(text.length - 1) === '\n' ? '' : '\n');
    o.ok('wrote ' + p + ' (' + utf8Bytes(r.work[p]).length + ' bytes in the working tree)');
    o.dim('No object was written. The working tree is just files; git has not');
    o.dim('been told about this yet.');
  };

  Git.prototype.cmd_append = function (args) {
    var r = this.r, o = this.o;
    if (args.length < 1) { o.err('usage: append <path> <text>'); return; }
    var p = args.shift();
    var text = args.join(' ');
    var cur = r.work[p] || '';
    if ((cur + text).length > MAX_FILE_CHARS) { o.err('That would make the file longer than this toy allows.'); return; }
    r.work[p] = cur + text + '\n';
    o.ok('appended to ' + p);
  };

  Git.prototype.cmd_rm = function (args) {
    var r = this.r, o = this.o;
    if (!args.length) { o.err('usage: rm <path>'); return; }
    for (var i = 0; i < args.length; i++) {
      if (!(args[i] in r.work) && !(args[i] in r.index)) { o.err("pathspec '" + args[i] + "' did not match any file"); continue; }
      delete r.work[args[i]];
      delete r.index[args[i]];
      delete r.conflicts[args[i]];
      o.line('  rm ' + args[i], 'wa');
    }
    o.dim('Removed from the working tree and the index. Every commit that ever');
    o.dim('contained the file still contains it — the blob is still in the store.');
  };

  Git.prototype.cmd_commit = function (args) {
    var r = this.r, o = this.o;
    var msg = takeOption(args, '-m');
    if (msg === null) msg = takeOption(args, '--message');
    var amend = takeFlag(args, '--amend');
    if (msg === null || msg === '') { o.err('usage: commit -m "your message"'); return; }
    if (Object.keys(r.conflicts).length) {
      o.err('Cannot commit: unmerged paths remain. Fix them, then `add` each one.');
      return;
    }
    var head = r.headTree();
    var parents = [];
    var headOid = r.headOid();
    if (amend) {
      var pc = headOid ? r.parseCommit(headOid) : null;
      if (!pc) { o.err('Nothing to amend — there is no commit yet.'); return; }
      parents = pc.parents.slice();
    } else if (headOid) {
      parents = [headOid];
    }
    if (r.merging) parents = [headOid, r.merging.theirs];

    var sameAsHead = !amend && !r.merging && sameMap(head, r.index);
    if (sameAsHead) { o.err('Nothing to commit — the index is identical to HEAD.'); return; }

    r.wrote = [];
    var tree = r.writeTreeFromPaths(r.index);
    var oid = r.writeCommit(tree, parents, msg);
    var before = r.headOid();
    if (r.head.detached) r.head.oid = oid;
    else r.refs[r.head.ref] = oid;
    r.logHead(before, oid, 'commit: ' + msg.split('\n')[0]);

    var label = r.merging ? 'merge' : 'commit';
    r.merging = null;
    o.ok('[' + (r.head.detached ? 'detached ' + short(oid) : r.head.ref.slice(11) + ' ' + short(oid)) + '] ' + msg.split('\n')[0]);
    o.line('  tree   ' + tree, 'dim2');
    for (var i = 0; i < parents.length; i++) o.line('  parent ' + parents[i], 'dim2');
    o.line('  commit ' + oid, 'hd');
    o.dim('The ' + label + ' moved ' + (r.head.detached ? 'HEAD itself (detached).' : r.head.ref + '.'));
    this.reportWrites();
  };

  Git.prototype.reportWrites = function () {
    var w = this.r.wrote, o = this.o, i, n = 0, reused = [], made = [];
    for (i = 0; i < w.length; i++) {
      if (w[i].reused) reused.push(w[i]); else { made.push(w[i]); n++; }
    }
    if (made.length) o.line('  wrote ' + made.length + ' new object(s): ' + describeSet(made), 'ok');
    if (reused.length) {
      o.line('  reused ' + reused.length + ' existing object(s): ' + describeSet(reused), 'cy');
      o.dim('  Those bytes were already in the store, so their name was already');
      o.dim('  taken. Content addressing means identical content is stored once.');
    }
    this.r.wrote = [];
  };

  function describeSet(list) {
    var counts = {}, order = [], i, out = [];
    for (i = 0; i < list.length; i++) {
      if (!(list[i].type in counts)) { counts[list[i].type] = 0; order.push(list[i].type); }
      counts[list[i].type]++;
    }
    for (i = 0; i < order.length; i++) out.push(counts[order[i]] + ' ' + order[i] + (counts[order[i]] > 1 ? 's' : ''));
    return out.join(', ');
  }

  function sameMap(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b), i;
    if (ka.length !== kb.length) return false;
    for (i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
    return true;
  }

  Git.prototype.cmd_log = function (args) {
    var r = this.r, o = this.o;
    var all = takeFlag(args, '--all');
    var start = args.length ? r.resolve(args[0]) : r.headOid();
    if (all) {
      var names = Object.keys(r.refs), i, seen = {}, list = [];
      var roots = [];
      for (i = 0; i < names.length; i++) roots.push(r.peel(r.refs[names[i]]));
      if (r.headOid()) roots.push(r.headOid());
      for (i = 0; i < roots.length; i++) {
        var a = r.ancestors(roots[i]), ks = Object.keys(a), j;
        for (j = 0; j < ks.length; j++) if (!seen[ks[j]]) { seen[ks[j]] = true; list.push(ks[j]); }
      }
      this.printCommits(list);
      return;
    }
    if (!start || start.ambiguous) { o.err('No commits yet.'); return; }
    var chain = [], cur = start, guard = 0;
    while (cur && guard++ < 200) {
      chain.push(cur);
      var c = r.parseCommit(cur);
      cur = c && c.parents.length ? c.parents[0] : null;
    }
    this.printCommits(chain);
  };

  Git.prototype.printCommits = function (list) {
    var r = this.r, o = this.o, i;
    var byRef = refLabels(r);
    list.sort(function (a, b) { return r.get(b).n - r.get(a).n; });
    if (!list.length) { o.dim('(no commits)'); return; }
    for (i = 0; i < list.length; i++) {
      var c = r.parseCommit(list[i]);
      var pills = byRef[list[i]] ? '  (' + byRef[list[i]].join(', ') + ')' : '';
      o.line(short(list[i]) + pills + '  ' + c.subject, 'hd');
      o.line('        tree ' + short(c.tree) +
             (c.parents.length ? '  parent ' + c.parents.map(short).join(' ') : '  (root commit)'), 'dim2');
    }
  };

  /* The pills a commit carries. The branch HEAD is attached to is deliberately
     not listed twice: git writes "(HEAD -> feature)", not
     "(HEAD -> feature, feature)", and the doubled label read like two separate
     things pointing at one commit — which is the opposite of the lesson. */
  function refLabels(r) {
    var out = {}, keys = Object.keys(r.refs), i, oid, name;
    var onBranch = r.head.detached ? null : r.head.ref;
    for (i = 0; i < keys.length; i++) {
      if (keys[i] === onBranch) continue;
      oid = r.peel(r.refs[keys[i]]);
      name = keys[i].indexOf('refs/heads/') === 0 ? keys[i].slice(11) : 'tag: ' + keys[i].slice(10);
      if (!out[oid]) out[oid] = [];
      out[oid].push(name);
    }
    var h = r.headOid();
    if (h) {
      if (!out[h]) out[h] = [];
      out[h].unshift(r.head.detached ? 'HEAD (detached)' : 'HEAD -> ' + r.head.ref.slice(11));
    }
    return out;
  }

  /* ---- branches and moving around -------------------------------------- */

  Git.prototype.cmd_branch = function (args) {
    var r = this.r, o = this.o, i;
    var del = takeFlag(args, '-d') || takeFlag(args, '-D');
    if (del) {
      if (!args.length) { o.err('usage: branch -d <name>'); return; }
      var full = 'refs/heads/' + args[0];
      if (!r.refs[full]) { o.err("branch '" + args[0] + "' not found"); return; }
      if (!r.head.detached && r.head.ref === full) { o.err('Cannot delete the branch you are standing on.'); return; }
      var gone = r.refs[full];
      delete r.refs[full];
      o.warn('Deleted branch ' + args[0] + ' (was ' + short(gone) + ').');
      o.dim('One 41-byte file removed. The commit object is untouched and still');
      o.dim('in the store — `reflog` and the graph below both still show it.');
      return;
    }
    if (!args.length) {
      var names = r.branchNames();
      if (!names.length) { o.dim('(no branches yet — the first commit creates one)'); return; }
      for (i = 0; i < names.length; i++) {
        var cur = !r.head.detached && r.head.ref === 'refs/heads/' + names[i];
        o.line((cur ? '* ' : '  ') + names[i] + '  ' + short(r.refs['refs/heads/' + names[i]]), cur ? 'ok' : 'out');
      }
      return;
    }
    var target = args.length > 1 ? r.resolve(args[1]) : r.headOid();
    if (!target || target.ambiguous) { o.err('Cannot create a branch: nothing to point it at.'); return; }
    if (r.refs['refs/heads/' + args[0]]) { o.err("branch '" + args[0] + "' already exists"); return; }
    r.refs['refs/heads/' + args[0]] = target;
    o.ok('Created branch ' + args[0] + ' at ' + short(target) + '.');
    o.dim('That is the entire operation: one file, refs/heads/' + args[0] + ',');
    o.dim('containing 40 characters of hex and a newline. 41 bytes. No objects');
    o.dim('were written, because nothing about the content changed.');
  };

  Git.prototype.cmd_switch = function (args) {
    if (takeFlag(args, '-c')) { args.unshift('-b'); }
    this.cmd_checkout(args);
  };

  Git.prototype.cmd_checkout = function (args) {
    var r = this.r, o = this.o;
    var force = takeFlag(args, '-f') || takeFlag(args, '--force');
    var create = takeFlag(args, '-b') || takeFlag(args, '-c');
    if (!args.length) { o.err('usage: checkout <branch|commit> | checkout -b <name>'); return; }
    var name = args[0];

    if (create) {
      var at = args.length > 1 ? r.resolve(args[1]) : r.headOid();
      if (!at || at.ambiguous) { o.err('Nothing to branch from yet — make a commit first.'); return; }
      if (r.refs['refs/heads/' + name]) { o.err("branch '" + name + "' already exists"); return; }
      r.refs['refs/heads/' + name] = at;
      var before0 = r.headOid();
      r.head = { detached: false, ref: 'refs/heads/' + name, oid: null };
      r.logHead(before0, at, 'checkout: moving to ' + name);
      o.ok('Switched to a new branch ' + name + '.');
      o.dim('Two files changed on disk and no object was written: the new label,');
      o.dim('and HEAD, which now reads "ref: refs/heads/' + name + '".');
      return;
    }

    var dirty = r.dirtyPaths();
    if (dirty.length && !force) {
      o.err('Your local changes would be overwritten by checkout:');
      for (var i = 0; i < dirty.length; i++) o.line('    ' + dirty[i], 'er');
      o.dim('Commit them, or use `checkout -f ' + name + '` to throw them away.');
      o.dim('Uncommitted work is the only kind git cannot get back for you.');
      return;
    }

    var before = r.headOid();
    if (r.refs['refs/heads/' + name]) {
      r.head = { detached: false, ref: 'refs/heads/' + name, oid: null };
      r.materialise(r.refs['refs/heads/' + name]);
      r.logHead(before, r.refs['refs/heads/' + name], 'checkout: moving to ' + name);
      o.ok('Switched to branch ' + name + '.');
      o.dim('HEAD now says "ref: refs/heads/' + name + '". The index and the');
      o.dim('working tree were rewritten from that commit’s tree.');
      return;
    }
    var oid = r.resolve(name);
    if (!oid) { o.err("pathspec '" + name + "' did not match any branch, tag or commit"); return; }
    if (oid.ambiguous) { o.err("'" + name + "' is ambiguous — more than one object starts with it"); return; }
    r.head = { detached: true, ref: null, oid: oid };
    r.materialise(oid);
    r.logHead(before, oid, 'checkout: moving to ' + name);
    o.warn('You are in "detached HEAD" state.');
    o.dim('HEAD now contains a commit hash directly instead of "ref: refs/...".');
    o.dim('Nothing is broken and nothing is lost — you are simply standing on a');
    o.dim('commit with no branch label. Commits made here get no label either,');
    o.dim('so only the reflog would remember them. `checkout <branch>` returns,');
    o.dim('and `branch <name>` right here would give this spot a name.');
  };

  /* ---- merge ----------------------------------------------------------- */

  Git.prototype.cmd_merge = function (args) {
    var r = this.r, o = this.o;
    if (!args.length) { o.err('usage: merge <branch>'); return; }
    var theirs = r.resolve(args[0]);
    if (!theirs || theirs.ambiguous) { o.err("merge: '" + args[0] + "' — not something we can merge"); return; }
    var ours = r.headOid();
    if (!ours) { o.err('Nothing to merge into — no commits yet.'); return; }
    if (r.ancestors(ours)[theirs]) { o.ok('Already up to date.'); return; }

    var base = r.mergeBase(ours, theirs);
    if (base === ours) {
      var before = ours;
      if (r.head.detached) r.head.oid = theirs; else r.refs[r.head.ref] = theirs;
      r.materialise(theirs);
      r.logHead(before, theirs, 'merge ' + args[0] + ': fast-forward');
      o.ok('Fast-forward to ' + short(theirs) + '.');
      o.dim('No merge commit was written, and no object at all was created.');
      o.dim('Your branch had not moved since you branched, so git just slid the');
      o.dim('label forward along a line that already existed.');
      return;
    }

    var baseT = base ? r.flatten(r.parseCommit(base).tree, '') : {};
    var ourT = r.flatten(r.parseCommit(ours).tree, '');
    var theirT = r.flatten(r.parseCommit(theirs).tree, '');
    var paths = unionKeys([baseT, ourT, theirT]);
    var result = {}, conflicts = [], i, p, b, x, y;

    for (i = 0; i < paths.length; i++) {
      p = paths[i]; b = baseT[p]; x = ourT[p]; y = theirT[p];
      if (x === y) { if (x) result[p] = x; }
      else if (x === b) { if (y) result[p] = y; }
      else if (y === b) { if (x) result[p] = x; }
      else conflicts.push(p);
    }

    r.wrote = [];
    if (conflicts.length) {
      r.index = {};
      r.work = {};
      r.conflicts = {};
      var keys = Object.keys(result);
      for (i = 0; i < keys.length; i++) {
        r.index[keys[i]] = result[keys[i]];
        r.work[keys[i]] = r.blobText(result[keys[i]]);
      }
      for (i = 0; i < conflicts.length; i++) {
        p = conflicts[i];
        r.conflicts[p] = true;
        r.work[p] = '<<<<<<< HEAD (ours)\n' + (ourT[p] ? r.blobText(ourT[p]) : '(deleted on this side)\n') +
                    '=======\n' + (theirT[p] ? r.blobText(theirT[p]) : '(deleted on the other side)\n') +
                    '>>>>>>> ' + args[0] + ' (theirs)\n';
      }
      r.merging = { theirs: theirs, label: args[0] };
      o.err('CONFLICT: ' + conflicts.length + ' file(s) changed on both sides, differently.');
      for (i = 0; i < conflicts.length; i++) o.line('    both modified: ' + conflicts[i], 'er');
      o.dim('Git refuses to guess, so it wrote both versions into the file between');
      o.dim('markers and stopped. Edit the file in the working tree panel until it');
      o.dim('says what it should, `add` it to declare it resolved, then `commit`.');
      o.dim('Note the limit here: this toy detects conflicts per FILE. Real git');
      o.dim('merges per hunk, so it resolves changes to different parts of one');
      o.dim('file automatically.');
      return;
    }

    var tree = r.writeTreeFromPaths(result);
    var oid = r.writeCommit(tree, [ours, theirs], "Merge branch '" + args[0] + "'");
    var was = r.headOid();
    if (r.head.detached) r.head.oid = oid; else r.refs[r.head.ref] = oid;
    r.materialise(oid);
    r.logHead(was, oid, 'merge ' + args[0]);
    o.ok('Merge made by the three-way strategy.');
    o.line('  merge base ' + short(base), 'dim2');
    o.line('  parent 1   ' + short(ours) + '  (where you were)', 'dim2');
    o.line('  parent 2   ' + short(theirs) + '  (' + args[0] + ')', 'dim2');
    o.line('  commit     ' + oid, 'hd');
    o.dim('Both original commits are untouched and keep their names. The graph');
    o.dim('now records honestly that two lines of work happened and where they');
    o.dim('joined — that is the difference between merge and rebase.');
    this.reportWrites();
  };

  function unionKeys(maps) {
    var seen = {}, out = [], i, j, k;
    for (i = 0; i < maps.length; i++) {
      k = Object.keys(maps[i]);
      for (j = 0; j < k.length; j++) if (!seen[k[j]]) { seen[k[j]] = true; out.push(k[j]); }
    }
    out.sort();
    return out;
  }

  /* ---- replaying commits (rebase, cherry-pick, revert) ------------------ */

  /* Apply the change a commit made — the diff between its first parent's tree
     and its own — onto a different tree. This one function is rebase,
     cherry-pick and revert; only the direction and the loop differ. Everything
     about the object model that makes rebase frightening is visible here: the
     old commit is never touched, and the new one is a genuinely different
     sequence of bytes, so it gets a genuinely different name. */
  function applyChange(r, target, from, to) {
    var fromT = from ? r.flatten(r.parseCommit(from).tree, '') : {};
    var toT = to ? r.flatten(r.parseCommit(to).tree, '') : {};
    var out = {}, keys = Object.keys(target), i, p;
    for (i = 0; i < keys.length; i++) out[keys[i]] = target[keys[i]];
    var paths = unionKeys([fromT, toT]);
    var conflicts = [];
    for (i = 0; i < paths.length; i++) {
      p = paths[i];
      if (fromT[p] === toT[p]) continue;                 // unchanged by this commit
      if (out[p] === toT[p]) continue;                   // already in that state
      if (out[p] !== fromT[p]) { conflicts.push(p); continue; }
      if (toT[p]) out[p] = toT[p]; else delete out[p];
    }
    return { tree: out, conflicts: conflicts };
  }

  Git.prototype.cmd_rebase = function (args) {
    var r = this.r, o = this.o, i;
    if (!args.length) { o.err('usage: rebase <upstream>'); return; }
    if (r.head.detached) { o.err('Rebase here needs a branch — you are on a detached HEAD.'); return; }
    var upstream = r.resolve(args[0]);
    if (!upstream || upstream.ambiguous) { o.err("rebase: invalid upstream '" + args[0] + "'"); return; }
    var ours = r.headOid();
    if (!ours) { o.err('Nothing to rebase.'); return; }
    if (r.ancestors(upstream)[ours]) {
      var was0 = ours;
      r.refs[r.head.ref] = upstream;
      r.materialise(upstream);
      r.logHead(was0, upstream, 'rebase finished: fast-forward');
      o.ok('Fast-forwarded ' + r.head.ref.slice(11) + ' to ' + short(upstream) + '.');
      o.dim('You had no commits of your own to replay.');
      return;
    }
    if (r.ancestors(ours)[upstream]) { o.ok('Current branch is up to date — nothing to replay.'); return; }

    var base = r.mergeBase(ours, upstream);
    var todo = [], cur = ours, guard = 0;
    while (cur && cur !== base && guard++ < 200) {
      var c = r.parseCommit(cur);
      if (c.parents.length > 1) {
        o.warn('Skipping merge commit ' + short(cur) + ' — `git rebase` drops merges by default too.');
      } else {
        todo.unshift(cur);
      }
      cur = c.parents[0];
    }
    if (!todo.length) { o.ok('Nothing to replay.'); return; }

    o.line('Replaying ' + todo.length + ' commit(s) onto ' + short(upstream) + ':', 'hd');
    r.wrote = [];
    var newHead = upstream;
    var pairs = [];
    for (i = 0; i < todo.length; i++) {
      var oldC = r.parseCommit(todo[i]);
      var targetTree = r.flatten(r.parseCommit(newHead).tree, '');
      var res = applyChange(r, targetTree, oldC.parents[0] || null, todo[i]);
      if (res.conflicts.length) {
        o.err('CONFLICT while replaying ' + short(todo[i]) + ': ' + res.conflicts.join(', '));
        o.dim('This toy aborts the whole rebase rather than dropping you into a');
        o.dim('half-finished one — real git stops and waits for you. Nothing was');
        o.dim('changed; your branch still points where it did.');
        r.wrote = [];
        return;
      }
      if (sameMap(res.tree, targetTree)) {
        o.warn('  ' + short(todo[i]) + ' became empty and was dropped.');
        continue;
      }
      var tree = r.writeTreeFromPaths(res.tree);
      // The author line (and its date) is carried over; the committer line is
      // new. That is precisely why the hash changes even when the tree does not.
      var made = r.writeCommit(tree, [newHead], oldC.message, oldC.authorTs);
      pairs.push([todo[i], made, oldC.tree, tree]);
      newHead = made;
    }
    var was = r.headOid();
    r.refs[r.head.ref] = newHead;
    r.materialise(newHead);
    r.logHead(was, newHead, 'rebase finished: ' + r.head.ref);
    for (i = 0; i < pairs.length; i++) {
      o.line('  ' + short(pairs[i][0]) + '  ->  ' + short(pairs[i][1]) +
             (pairs[i][2] === pairs[i][3] ? '   (identical tree ' + short(pairs[i][2]) + ')' : ''), 'cy');
    }
    o.ok('Successfully rebased ' + r.head.ref.slice(11) + ' onto ' + short(upstream) + '.');
    o.dim('Each pair above is the same change by the same author with the same');
    o.dim('author date, under a new name. The hash covers the parent line and the');
    o.dim('committer line, and replaying changed both — so identity cannot survive');
    o.dim('a rebase even when the diff is untouched. Open the Object store tab and');
    o.dim('put the two commits side by side; that is the whole proof.');
    o.dim('Git edited nothing. It wrote new commits and moved one label. The old');
    o.dim('commits are still in the store, now unreferenced, dimmed in the graph.');
    this.reportWrites();
  };

  Git.prototype.cmd_cherry_pick = function (args) {
    var r = this.r, o = this.o;
    if (!args.length) { o.err('usage: cherry-pick <rev>'); return; }
    var pick = r.resolve(args[0]);
    if (!pick || pick.ambiguous) { o.err("cherry-pick: bad revision '" + args[0] + "'"); return; }
    var head = r.headOid();
    if (!head) { o.err('Nothing to cherry-pick onto.'); return; }
    var c = r.parseCommit(pick);
    var res = applyChange(r, r.flatten(r.parseCommit(head).tree, ''), c.parents[0] || null, pick);
    if (res.conflicts.length) {
      o.err('CONFLICT applying ' + short(pick) + ': ' + res.conflicts.join(', '));
      o.dim('The file changed here as well as there, so the change cannot be');
      o.dim('replayed cleanly. Nothing was changed.');
      return;
    }
    r.wrote = [];
    var tree = r.writeTreeFromPaths(res.tree);
    var oid = r.writeCommit(tree, [head], c.message, c.authorTs);
    if (r.head.detached) r.head.oid = oid; else r.refs[r.head.ref] = oid;
    r.materialise(oid);
    r.logHead(head, oid, 'cherry-pick: ' + c.subject);
    o.ok('Cherry-picked ' + short(pick) + ' as ' + short(oid) + '.');
    o.dim('Same change, different parent, therefore different bytes and a');
    o.dim('different name. Both commits now exist, side by side.');
    this.reportWrites();
  };

  Git.prototype.cmd_revert = function (args) {
    var r = this.r, o = this.o;
    if (!args.length) { o.err('usage: revert <rev>'); return; }
    var bad = r.resolve(args[0]);
    if (!bad || bad.ambiguous) { o.err("revert: bad revision '" + args[0] + "'"); return; }
    var head = r.headOid();
    if (!head) { o.err('Nothing to revert onto.'); return; }
    var c = r.parseCommit(bad);
    // The inverse: apply the change from the commit BACK to its parent.
    var res = applyChange(r, r.flatten(r.parseCommit(head).tree, ''), bad, c.parents[0] || null);
    if (res.conflicts.length) {
      o.err('CONFLICT reverting ' + short(bad) + ': ' + res.conflicts.join(', '));
      return;
    }
    r.wrote = [];
    var tree = r.writeTreeFromPaths(res.tree);
    var oid = r.writeCommit(tree, [head], 'Revert "' + c.subject + '"');
    if (r.head.detached) r.head.oid = oid; else r.refs[r.head.ref] = oid;
    r.materialise(oid);
    r.logHead(head, oid, 'revert: ' + c.subject);
    o.ok('Reverted ' + short(bad) + ' with a new commit ' + short(oid) + '.');
    o.dim('Nothing moved backwards. History now records both the mistake and');
    o.dim('the correction, which is what you want on anything already shared.');
    this.reportWrites();
  };

  /* ---- reset ----------------------------------------------------------- */

  Git.prototype.cmd_reset = function (args) {
    var r = this.r, o = this.o;
    var mode = 'mixed';
    if (takeFlag(args, '--soft')) mode = 'soft';
    if (takeFlag(args, '--mixed')) mode = 'mixed';
    if (takeFlag(args, '--hard')) mode = 'hard';
    var spec = args.length ? args[0] : 'HEAD';
    var target = r.resolve(spec);
    if (!target || target.ambiguous) { o.err("reset: bad revision '" + spec + "'"); return; }
    var before = r.headOid();
    // Which files were already dirty has to be answered BEFORE the label moves.
    // Asking afterwards compares the index against the NEW commit and reports
    // every difference between the two commits as work you were about to lose,
    // which turned a clean `reset --hard` into a false alarm every time.
    var lost = mode === 'hard' ? r.dirtyPaths() : null;
    if (r.head.detached) r.head.oid = target; else r.refs[r.head.ref] = target;

    if (mode === 'soft') {
      o.ok('reset --soft to ' + short(target));
      o.dim('The branch label moved. The index and your files did not, so the');
      o.dim('undone work is still staged and ready to commit again.');
    } else if (mode === 'mixed') {
      var work = {}, keys = Object.keys(r.work), i;
      for (i = 0; i < keys.length; i++) work[keys[i]] = r.work[keys[i]];
      r.materialise(target);
      r.work = work;                       // --mixed leaves files alone
      o.ok('reset --mixed to ' + short(target));
      o.dim('The branch label and the index moved. Your files are untouched, so');
      o.dim('the work is still there — just unstaged.');
    } else {
      r.materialise(target);
      o.warn('reset --hard to ' + short(target));
      if (lost.length) o.err('Discarded uncommitted changes in: ' + lost.join(', '));
      o.dim('All three places moved. This is the only reset that can destroy');
      o.dim('work you never committed. Committed work it cannot touch: the old');
      o.dim('commit is still in the store, and `reflog` still knows its name.');
    }
    r.logHead(before, target, 'reset: moving to ' + spec);
  };

  /* ---- tags ------------------------------------------------------------ */

  Git.prototype.cmd_tag = function (args) {
    var r = this.r, o = this.o, i;
    if (takeFlag(args, '-d')) {
      if (!args.length) { o.err('usage: tag -d <name>'); return; }
      if (!r.refs['refs/tags/' + args[0]]) { o.err("tag '" + args[0] + "' not found"); return; }
      delete r.refs['refs/tags/' + args[0]];
      o.warn('Deleted tag ' + args[0] + '.');
      return;
    }
    var annotated = takeFlag(args, '-a');
    var msg = takeOption(args, '-m');
    if (!args.length) {
      var names = r.tagNames();
      if (!names.length) { o.dim('(no tags)'); return; }
      for (i = 0; i < names.length; i++) {
        var raw = r.refs['refs/tags/' + names[i]];
        var kind = r.get(raw) && r.get(raw).type === 'tag' ? 'annotated tag object' : 'lightweight';
        o.line('  ' + names[i] + '  ' + short(raw) + '  (' + kind + ')', 'out');
      }
      return;
    }
    var name = args[0];
    if (r.refs['refs/tags/' + name]) { o.err("tag '" + name + "' already exists"); return; }
    var target = args.length > 1 ? r.resolve(args[1]) : r.headOid();
    if (!target || target.ambiguous) { o.err('Nothing to tag yet.'); return; }
    r.wrote = [];
    if (annotated) {
      var tagOid = r.writeTag(target, name, msg || name);
      r.refs['refs/tags/' + name] = tagOid;
      o.ok('Created annotated tag ' + name + ' -> tag object ' + short(tagOid) + ' -> commit ' + short(target) + '.');
      o.dim('An annotated tag is the fourth object type. It is a real object with');
      o.dim('its own hash, holding the target, a tagger and a message — which is');
      o.dim('why it can be signed and a lightweight tag cannot.');
      this.reportWrites();
    } else {
      r.refs['refs/tags/' + name] = target;
      o.ok('Created lightweight tag ' + name + ' at ' + short(target) + '.');
      o.dim('No object written. A lightweight tag is a branch label that does not');
      o.dim('move: one file under refs/tags with a hash in it.');
    }
  };

  /* ---- plumbing -------------------------------------------------------- */

  Git.prototype.cmd_cat_file = function (args) {
    var r = this.r, o = this.o;
    var pretty = takeFlag(args, '-p'), type = takeFlag(args, '-t'), size = takeFlag(args, '-s');
    if (!args.length) { o.err('usage: cat-file -p|-t|-s <object>'); return; }
    var oid = r.resolve(args[0]);
    if (oid && oid.ambiguous) { o.err('Ambiguous object name.'); return; }
    if (!oid && /^[0-9a-f]{4,40}$/.test(args[0])) {
      var hits = [], keys = Object.keys(r.objects), i;
      for (i = 0; i < keys.length; i++) if (keys[i].indexOf(args[0]) === 0) hits.push(keys[i]);
      if (hits.length === 1) oid = hits[0];
    }
    var obj = oid ? r.get(oid) : null;
    if (!obj) { o.err("Not a valid object name: '" + args[0] + "'"); return; }
    if (type) { o.line(obj.type, 'hd'); return; }
    if (size) { o.line(String(obj.size), 'hd'); return; }
    if (!pretty) { o.err('Say what you want: -p (contents), -t (type) or -s (size).'); return; }
    o.line(obj.type + ' ' + obj.size + '  ' + oid, 'hd');
    if (obj.type === 'tree') {
      var e = r.parseTree(oid);
      for (var j = 0; j < e.length; j++) {
        o.line(e[j].mode + ' ' + e[j].type + ' ' + e[j].oid + '    ' + e[j].name, 'out');
      }
    } else {
      var text = utf8Decode(obj.body, 0, obj.body.length).replace(/\n$/, '');
      var lines = text.split('\n');
      for (var k = 0; k < lines.length && k < 60; k++) o.line(lines[k], 'out');
      if (lines.length > 60) o.dim('… ' + (lines.length - 60) + ' more line(s)');
    }
  };

  Git.prototype.cmd_ls_tree = function (args) {
    var r = this.r, o = this.o;
    var recurse = takeFlag(args, '-r');
    var spec = args.length ? args[0] : 'HEAD';
    var oid = r.resolve(spec);
    if (!oid || oid.ambiguous) { o.err("Not a valid object name: '" + spec + "'"); return; }
    var obj = r.get(oid);
    var treeOid = obj && obj.type === 'commit' ? r.parseCommit(oid).tree : oid;
    if (!r.get(treeOid) || r.get(treeOid).type !== 'tree') { o.err('Not a tree.'); return; }
    if (recurse) {
      var flat = r.flatten(treeOid, ''), keys = Object.keys(flat).sort(), i;
      for (i = 0; i < keys.length; i++) o.line('100644 blob ' + flat[keys[i]] + '    ' + keys[i], 'out');
      return;
    }
    var e = r.parseTree(treeOid);
    for (var j = 0; j < e.length; j++) {
      o.line(e[j].mode + ' ' + e[j].type + ' ' + e[j].oid + '    ' + e[j].name, 'out');
    }
  };

  Git.prototype.cmd_hash_object = function (args) {
    var r = this.r, o = this.o;
    var write = takeFlag(args, '-w');
    if (!args.length) { o.err('usage: hash-object [-w] <path>'); return; }
    var p = args[0];
    if (!(p in r.work)) { o.err("Cannot open '" + p + "'"); return; }
    var bytes = utf8Bytes(r.work[p]);
    var oid = write ? r.store('blob', bytes) : r.hashOnly('blob', bytes);
    o.line(oid, 'hd');
    o.dim('That is SHA-1 over the literal bytes  "blob " + ' + bytes.length + ' + NUL + contents.');
    o.dim(write ? 'Written into the object store.' : 'Not stored — pass -w to store it.');
  };

  Git.prototype.cmd_rev_parse = function (args) {
    var r = this.r, o = this.o;
    if (!args.length) { o.err('usage: rev-parse <rev>'); return; }
    var oid = r.resolve(args[0]);
    if (!oid) { o.err("Unknown revision '" + args[0] + "'"); return; }
    if (oid.ambiguous) { o.err('Ambiguous.'); return; }
    o.line(oid, 'hd');
  };

  Git.prototype.cmd_show_ref = function () {
    var r = this.r, o = this.o;
    var keys = Object.keys(r.refs).sort(), i;
    if (!keys.length) o.dim('(no refs yet)');
    for (i = 0; i < keys.length; i++) {
      o.line(r.refs[keys[i]] + '  ' + keys[i], 'out');
    }
    o.line('');
    if (r.head.detached) {
      o.line('HEAD                       ' + r.head.oid, 'wa');
      o.dim('HEAD holds a hash directly: that is what "detached" means.');
    } else {
      o.line('HEAD                       ref: ' + r.head.ref, 'hd');
      o.dim('HEAD is a file too. Normally it holds the NAME of a branch, which is');
      o.dim('why committing moves the branch and not HEAD.');
    }
    o.dim('Each ref file above is 41 bytes on disk: 40 characters of hex and a');
    o.dim('newline. That is the entire implementation of a branch.');
  };

  Git.prototype.cmd_reflog = function () {
    var r = this.r, o = this.o, i;
    if (!r.reflog.length) { o.dim('(the reflog is empty — nothing has moved HEAD yet)'); return; }
    for (i = 0; i < r.reflog.length && i < 40; i++) {
      var e = r.reflog[i];
      o.line(short(e.after) + '  HEAD@{' + i + '}  ' + e.action, 'out');
    }
    o.line('');
    o.dim('Every one of those commits is still in the object store, whether or');
    o.dim('not a branch points at it. `reset --hard HEAD@{1}` walks back to the');
    o.dim('previous position. This is why losing committed work is hard.');
  };

  Git.prototype.cmd_diff = function (args) {
    var r = this.r, o = this.o, a, b, aName, bName;
    var staged = takeFlag(args, '--staged') || takeFlag(args, '--cached');
    if (args.length >= 2) {
      var x = r.resolve(args[0]), y = r.resolve(args[1]);
      if (!x || !y || x.ambiguous || y.ambiguous) { o.err('Bad revision.'); return; }
      a = r.flatten(r.parseCommit(x).tree, ''); aName = args[0];
      b = r.flatten(r.parseCommit(y).tree, ''); bName = args[1];
    } else if (staged) {
      a = r.headTree(); aName = 'HEAD';
      b = r.index; bName = 'the index';
    } else {
      a = r.index; aName = 'the index';
      b = {}; bName = 'the working tree';
      var keys = Object.keys(r.work), i;
      for (i = 0; i < keys.length; i++) b[keys[i]] = r.blobOidOf(r.work[keys[i]]);
    }
    var paths = unionKeys([a, b]), n = 0, j;
    for (j = 0; j < paths.length; j++) {
      var p = paths[j];
      if (a[p] === b[p]) continue;
      n++;
      if (!a[p]) o.line('A  ' + p, 'ok');
      else if (!b[p]) o.line('D  ' + p, 'er');
      else o.line('M  ' + p + '   ' + short(a[p]) + ' -> ' + short(b[p]), 'wa');
    }
    if (!n) o.ok('No difference between ' + aName + ' and ' + bName + '.');
    else o.dim('Comparing ' + aName + ' with ' + bName + '. This toy reports which');
    if (n) o.dim('PATHS differ, by blob name — not a line-by-line diff.');
  };

  /* ====================================================================== */
  /*  GRAPH LAYOUT                                                          */
  /* ====================================================================== */

  /* Newest first, in creation order. A parent is always stored before its
     child, so descending creation order is a valid reverse-topological order —
     no sorting cleverness required. Lanes are assigned the way `git log
     --graph` does it: a lane holds the commit it is next expecting. */
  function layoutGraph(repo) {
    var oids = [], keys = Object.keys(repo.objects), i;
    for (i = 0; i < keys.length; i++) if (repo.objects[keys[i]].type === 'commit') oids.push(keys[i]);
    oids.sort(function (a, b) { return repo.objects[b].n - repo.objects[a].n; });
    if (oids.length > MAX_GRAPH_ROWS) oids = oids.slice(0, MAX_GRAPH_ROWS);

    var lanes = [], rows = [], maxLane = 0;
    for (i = 0; i < oids.length; i++) {
      var oid = oids[i], lane = lanes.indexOf(oid), k;
      if (lane < 0) {
        lane = lanes.indexOf(null);
        if (lane < 0) { lane = lanes.length; lanes.push(null); }
      }
      for (k = 0; k < lanes.length; k++) if (k !== lane && lanes[k] === oid) lanes[k] = null;
      var c = repo.parseCommit(oid);
      var parents = c ? c.parents : [];
      lanes[lane] = parents.length ? parents[0] : null;
      for (k = 1; k < parents.length; k++) {
        if (lanes.indexOf(parents[k]) < 0) {
          var free = lanes.indexOf(null);
          if (free < 0) { lanes.push(parents[k]); } else { lanes[free] = parents[k]; }
        }
      }
      while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
      if (lane > maxLane) maxLane = lane;
      rows.push({ oid: oid, lane: lane, parents: parents, commit: c, lanesAfter: lanes.slice() });
    }
    var index = {};
    for (i = 0; i < rows.length; i++) index[rows[i].oid] = i;
    return { rows: rows, index: index, maxLane: maxLane, truncated: oids.length < countCommits(repo) };
  }

  function countCommits(repo) {
    var n = 0, keys = Object.keys(repo.objects), i;
    for (i = 0; i < keys.length; i++) if (repo.objects[keys[i]].type === 'commit') n++;
    return n;
  }

  /* ====================================================================== */
  /*  SCRIPTED WALKTHROUGHS                                                 */
  /* ====================================================================== */

  var WALKS = [
    {
      id: 'first',
      name: 'Where objects come from',
      steps: [
        '# A fresh repository. The store is empty: zero objects.',
        'status',
        '# `add` is the moment a blob is written. Watch the object count.',
        'add README.md',
        '# One blob exists now, and nothing else. No tree, no commit.',
        'commit -m "First commit"',
        '# Three objects: the blob, a tree naming it, and a commit pointing at',
        '# the tree. Here is the commit, exactly as it is stored:',
        'cat-file -p HEAD'
      ]
    },
    {
      id: 'dedup',
      name: 'The same content, stored once',
      steps: [
        'add .',
        'commit -m "Everything"',
        '# Now make a second file with byte-for-byte the same content as notes.txt.',
        'write copy.txt buy milk',
        'add copy.txt',
        '# Read that carefully: no new blob. The name of a blob IS its content,',
        '# so identical content already had that name. Two paths, one object.',
        'commit -m "Add a duplicate file"',
        'ls-tree -r HEAD'
      ]
    },
    {
      id: 'branch',
      name: 'A branch is a file with a hash in it',
      steps: [
        'add .',
        'commit -m "First commit"',
        'branch feature',
        '# Two labels, one commit. Look at what a ref actually contains:',
        'show-ref',
        'checkout feature',
        'append notes.txt call the bank',
        'add notes.txt',
        'commit -m "Another errand"',
        '# feature moved; main did not. Nothing copied, nothing duplicated.',
        'show-ref'
      ]
    },
    {
      id: 'detached',
      name: 'What detached HEAD means',
      steps: [
        'add .',
        'commit -m "First commit"',
        'append notes.txt call the bank',
        'add notes.txt',
        'commit -m "Another errand"',
        '# Standing on a commit instead of a branch:',
        'checkout HEAD~1',
        'show-ref',
        '# HEAD holds a hash now instead of the name of a branch. That is the',
        '# whole of it. Walking back is one command:',
        'checkout main'
      ]
    },
    {
      id: 'merge',
      name: 'Merge keeps both lines',
      steps: [
        'add .',
        'commit -m "First commit"',
        'checkout -b feature',
        'write src/app.js function main() { return 43; }',
        'add src/app.js',
        'commit -m "Bump the answer"',
        'checkout main',
        'append README.md A line on main.',
        'add README.md',
        'commit -m "Note on main"',
        '# Both branches moved, so this cannot be a fast-forward:',
        'merge feature',
        'log --all'
      ]
    },
    {
      id: 'rebase',
      name: 'Rebase changes identity, merge does not',
      steps: [
        'add .',
        'commit -m "First commit"',
        'checkout -b feature',
        'write src/app.js function main() { return 43; }',
        'add src/app.js',
        'commit -m "Bump the answer"',
        'checkout main',
        'append README.md A line on main.',
        'add README.md',
        'commit -m "Note on main"',
        'checkout feature',
        '# Watch the old -> new hash pairs:',
        'rebase main',
        '# Now compare the two views. `log --all` walks backwards from the refs,',
        '# so it can only show commits a label reaches:',
        'log --all',
        '# The graph on the right shows every commit OBJECT, so the original is',
        '# still there, dimmed and marked unreferenced. Nothing was deleted.'
      ]
    },
    {
      id: 'lost',
      name: 'Lose a commit, get it back',
      steps: [
        'add .',
        'commit -m "First commit"',
        'append notes.txt call the bank',
        'add notes.txt',
        'commit -m "Work I am about to destroy"',
        '# The classic disaster:',
        'reset --hard HEAD~1',
        'log',
        '# Gone from the branch. Not gone from git:',
        'reflog',
        'reset --hard HEAD@{1}',
        'log'
      ]
    }
  ];

  /* ====================================================================== */
  /*  UI                                                                    */
  /* ====================================================================== */

  var CSS =
    '#gitviz .gt{font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c7d3e6;padding:12px;background:#0a1120;}' +
    '#gitviz .gt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;}' +
    '#gitviz .gt-bar select,#gitviz .gt-btn{font:inherit;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:7px 12px;cursor:pointer;}' +
    '#gitviz .gt-btn:hover:not(:disabled){background:#213152;border-color:#40608f;}' +
    '#gitviz .gt-btn:disabled{opacity:.4;cursor:not-allowed;}' +
    '#gitviz .gt-btn.warn{background:#3a1720;border-color:#7a2c3c;color:#ff9db0;}' +
    '#gitviz .gt-btn.warn:hover:not(:disabled){background:#4d1e2a;}' +
    /* A <select> sizes itself to its longest option, and "Rebase changes
       identity, merge does not" is wider than a phone. .lab clips its overflow,
       so without this the control was silently sliced off at the screen edge
       rather than pushing the page sideways — invisible on desktop and broken
       on the device most likely to meet it. */
    '#gitviz .gt-bar select{max-width:100%;flex:0 1 auto;min-width:0;}' +
    '#gitviz .gt-count{margin-left:auto;color:#8ea0bd;font-size:12px;}' +
    '#gitviz .gt-count b{color:#7ee89a;font-weight:600;}' +
    '#gitviz .gt-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:14px;align-items:start;}' +
    '@media (max-width:960px){#gitviz .gt-main{grid-template-columns:1fr;}}' +
    '#gitviz .gt-col{display:flex;flex-direction:column;gap:14px;min-width:0;}' +
    '#gitviz .gt-panel{background:#0e1626;border:1px solid #223148;border-radius:10px;overflow:hidden;}' +
    '#gitviz .gt-ph{padding:7px 11px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#7f93b3;background:#131f33;border-bottom:1px solid #223148;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}' +
    '#gitviz .gt-ph .gt-phnote{text-transform:none;letter-spacing:0;color:#63758f;font-size:11px;}' +
    /* terminal */
    '#gitviz .gt-log{margin:0;padding:10px 11px;height:280px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#08101d;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;}' +
    '#gitviz .gt-log .cmd{color:#8affc0;}' +
    '#gitviz .gt-log .hd{color:#e6edf8;}' +
    '#gitviz .gt-log .out{color:#aeb9cd;}' +
    '#gitviz .gt-log .ok{color:#7ee89a;}' +
    '#gitviz .gt-log .wa{color:#ffd558;}' +
    '#gitviz .gt-log .er{color:#ff9db0;}' +
    '#gitviz .gt-log .cy{color:#6fd6ff;}' +
    '#gitviz .gt-log .dim{color:#71829e;}' +
    '#gitviz .gt-log .dim2{color:#5f7291;}' +
    '#gitviz .gt-log .note{color:#c9a5ff;}' +
    '#gitviz .gt-log .key{color:#8ea0bd;}' +
    '#gitviz .gt-form{display:flex;align-items:stretch;border-top:1px solid #223148;background:#0b1424;}' +
    '#gitviz .gt-prompt{padding:9px 4px 9px 11px;color:#7ee89a;white-space:nowrap;align-self:center;}' +
    '#gitviz .gt-in{flex:1;min-width:0;font:inherit;color:#e6edf8;background:transparent;border:0;padding:9px 11px 9px 4px;outline:none;}' +
    '#gitviz .gt-in:focus-visible{box-shadow:inset 0 0 0 2px rgba(111,214,255,.45);border-radius:4px;}' +
    '#gitviz .gt-in::placeholder{color:#5c6d88;}' +
    /* working tree */
    '#gitviz .gt-files{display:flex;flex-wrap:wrap;gap:6px;padding:9px 11px;border-bottom:1px solid #1c2942;}' +
    '#gitviz .gt-file{font:inherit;font-size:12px;color:#aeb9cd;background:#0b1526;border:1px solid #223148;border-radius:6px;padding:4px 9px;cursor:pointer;display:inline-flex;gap:6px;align-items:center;}' +
    '#gitviz .gt-file:hover{border-color:#40608f;}' +
    '#gitviz .gt-file[aria-pressed="true"]{background:#16294a;border-color:#3d6fb5;color:#e6edf8;}' +
    '#gitviz .gt-dot{width:7px;height:7px;border-radius:50%;background:#3f5170;flex:none;}' +
    '#gitviz .gt-dot.mod{background:#ffd558;}' +
    '#gitviz .gt-dot.new{background:#ff9db0;}' +
    '#gitviz .gt-dot.stg{background:#7ee89a;}' +
    '#gitviz .gt-dot.cnf{background:#ff5c7a;}' +
    '#gitviz .gt-edit{width:100%;box-sizing:border-box;min-height:150px;resize:vertical;border:0;background:#08101d;color:#d7e2f4;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;padding:10px 11px;tab-size:2;outline:none;display:block;}' +
    '#gitviz .gt-edit:focus-visible{box-shadow:inset 0 0 0 2px rgba(111,214,255,.45);}' +
    '#gitviz .gt-editfoot{padding:7px 11px;font-size:11px;color:#63758f;border-top:1px solid #1c2942;display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
    '#gitviz .gt-mini{font:inherit;font-size:11px;color:#aeb9cd;background:#131f33;border:1px solid #2c3d59;border-radius:6px;padding:3px 8px;cursor:pointer;}' +
    '#gitviz .gt-mini:hover{border-color:#40608f;}' +
    /* graph */
    '#gitviz .gt-graph{position:relative;max-height:340px;overflow:auto;padding:6px 0;}' +
    '#gitviz .gt-svg{position:absolute;left:0;top:6px;pointer-events:none;}' +
    '#gitviz .gt-row{position:relative;display:flex;gap:8px;align-items:center;width:100%;box-sizing:border-box;height:40px;background:transparent;border:0;border-left:2px solid transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}' +
    '#gitviz .gt-row:hover{background:#132038;}' +
    '#gitviz .gt-row[aria-pressed="true"]{background:#16294a;border-left-color:#6fd6ff;}' +
    '#gitviz .gt-row:focus-visible{outline:2px solid #6fd6ff;outline-offset:-2px;}' +
    '#gitviz .gt-row.dead .gt-sha,#gitviz .gt-row.dead .gt-subj{color:#5b6a83;}' +
    '#gitviz .gt-sha{color:#ffd558;flex:none;font-size:12px;}' +
    '#gitviz .gt-subj{color:#c7d3e6;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '#gitviz .gt-pill{flex:none;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid #3d6fb5;color:#9fc4ff;background:#122240;}' +
    '#gitviz .gt-pill.head{border-color:#7ee89a;color:#8affc0;background:#0f2a1c;}' +
    '#gitviz .gt-pill.tag{border-color:#c9a5ff;color:#d9beff;background:#1d1733;}' +
    '#gitviz .gt-pill.orphan{border-color:#5b6a83;color:#8a99b3;background:#131b2b;}' +
    /* tabs */
    '#gitviz .gt-tabs{display:flex;gap:2px;padding:0 6px;background:#131f33;border-bottom:1px solid #223148;flex-wrap:wrap;}' +
    '#gitviz .gt-tab{font:inherit;font-size:12px;color:#8ea0bd;background:transparent;border:0;border-bottom:2px solid transparent;padding:8px 10px;cursor:pointer;}' +
    '#gitviz .gt-tab[aria-selected="true"]{color:#6fd6ff;border-bottom-color:#6fd6ff;}' +
    '#gitviz .gt-tab:focus-visible{outline:2px solid #6fd6ff;outline-offset:-2px;}' +
    '#gitviz .gt-tabpanel{padding:10px 11px;max-height:320px;overflow:auto;font-size:12px;line-height:1.65;}' +
    '#gitviz .gt-tabpanel:focus-visible{outline:2px solid #6fd6ff;outline-offset:-2px;}' +
    '#gitviz .gt-objrow{display:flex;gap:8px;align-items:baseline;width:100%;box-sizing:border-box;background:transparent;border:0;border-radius:6px;color:inherit;font:inherit;font-size:12px;text-align:left;padding:3px 6px;cursor:pointer;}' +
    '#gitviz .gt-objrow:hover{background:#152238;}' +
    '#gitviz .gt-objrow[aria-pressed="true"]{background:#16294a;}' +
    '#gitviz .gt-objrow:focus-visible{outline:2px solid #6fd6ff;outline-offset:-2px;}' +
    '#gitviz .gt-ty{flex:none;width:52px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;}' +
    '#gitviz .gt-ty.blob{color:#7ee89a;}#gitviz .gt-ty.tree{color:#6fd6ff;}' +
    '#gitviz .gt-ty.commit{color:#ffd558;}#gitviz .gt-ty.tag{color:#c9a5ff;}' +
    '#gitviz .gt-objsha{color:#e6edf8;flex:none;}' +
    '#gitviz .gt-objnote{color:#71829e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '#gitviz .gt-bytes{margin:8px 0 0;padding:9px 10px;background:#08101d;border:1px solid #223148;border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#c7d3e6;}' +
    '#gitviz .gt-bytes .h{color:#ffd558;}' +
    '#gitviz .gt-bytes .nul{color:#ff9db0;}' +
    '#gitviz .gt-kv{display:flex;gap:8px;}' +
    '#gitviz .gt-kv .k{color:#7f93b3;flex:none;width:78px;}' +
    '#gitviz .gt-kv .v{color:#e6edf8;word-break:break-all;}' +
    '#gitviz .gt-check{margin:0 0 8px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.6;}' +
    '#gitviz .gt-check.pass{background:#0f2a1c;border:1px solid #2b6b3d;color:#9fe8b6;}' +
    '#gitviz .gt-check.fail{background:#3a1720;border:1px solid #7a2c3c;color:#ff9db0;}' +
    '#gitviz .gt-check code{color:#8affc0;font-size:11px;word-break:break-all;}' +
    '#gitviz .gt-undo{display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px solid #16233a;}' +
    '#gitviz .gt-undo:last-child{border-bottom:0;}' +
    '#gitviz .gt-undo .u{flex:1;min-width:0;color:#aeb9cd;overflow-wrap:anywhere;}' +
    '#gitviz .gt-undo .u b{color:#8affc0;font-weight:600;}' +
    '#gitviz .gt-undo .d{color:#ff9db0;}' +
    '#gitviz .gt-empty{color:#71829e;}' +
    '#gitviz .gt-legend{margin:8px 0 0;font-size:11px;color:#63758f;line-height:1.7;}' +
    /* Every focusable control gets the same visible ring. The panels are much
       darker than the page, and the UA default ring is not reliably legible
       against #0e1626 in either theme — a keyboard user has to be able to see
       where they are, and "probably visible" is not good enough for that. */
    '#gitviz .gt-btn:focus-visible,#gitviz .gt-bar select:focus-visible,' +
    '#gitviz .gt-file:focus-visible,#gitviz .gt-mini:focus-visible,' +
    '#gitviz .gt-log:focus-visible{outline:2px solid #6fd6ff;outline-offset:2px;}' +
    /* iOS zooms the page when a control smaller than 16px takes focus and does
       not zoom back out. Same guard as the one at the end of labs.css. */
    '@media (max-width:560px){#gitviz .gt-in,#gitviz .gt-edit,#gitviz .gt-bar select{font-size:16px;}}';

  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

  var LANE_X0 = 16, LANE_GAP = 20, ROW_H = 40;

  function GitUI(root) {
    this.root = root;
    this.repo = new Repo();
    this.history = [];          // { cmd, snapshot, destructive }
    this.cmdHistory = [];       // what the visitor typed, for Up/Down
    this.cmdAt = 0;
    this.selectedFile = null;
    this.selectedObject = null;
    this.selectedCommit = null;
    this.tab = 'objects';
    this.build();
    this.seed();
    this.intro();
    this.renderAll();
  }

  /* ---- output sink ----------------------------------------------------- */

  GitUI.prototype.sink = function () {
    var self = this;
    return {
      line: function (t, cls) { self.emit(t, cls || 'out'); },
      dim: function (t) { self.emit(t, 'dim'); },
      ok: function (t) { self.emit(t, 'ok'); },
      warn: function (t) { self.emit(t, 'wa'); },
      err: function (t) { self.emit(t, 'er'); },
      pair: function (a, b) { self.emitPair(a, b); }
    };
  };

  GitUI.prototype.emit = function (text, cls) {
    var span = E('span', cls, String(text) + '\n');
    this.elLog.appendChild(span);
    this.elLog.scrollTop = this.elLog.scrollHeight;
  };

  GitUI.prototype.emitPair = function (a, b) {
    var wrap = E('span', 'out');
    var k = E('span', 'cmd', '  ' + a);
    wrap.appendChild(k);
    var padding = 34 - a.length - 2;
    wrap.appendChild(document.createTextNode(new Array(padding > 1 ? padding : 2).join(' ') + ' ' + b + '\n'));
    this.elLog.appendChild(wrap);
    this.elLog.scrollTop = this.elLog.scrollHeight;
  };

  /* ---- build ----------------------------------------------------------- */

  GitUI.prototype.build = function () {
    var self = this;
    var style = document.createElement('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'gt');

    /* toolbar */
    var bar = E('div', 'gt-bar');
    var walkLabel = E('label', 'sr-only', 'Guided walkthrough');
    walkLabel.setAttribute('for', 'gt-walk');
    var walk = document.createElement('select');
    walk.id = 'gt-walk';
    var head = E('option', null, 'Guided walkthrough…');
    head.value = '';
    walk.appendChild(head);
    for (var i = 0; i < WALKS.length; i++) {
      var op = E('option', null, WALKS[i].name);
      op.value = WALKS[i].id;
      walk.appendChild(op);
    }
    bar.appendChild(walkLabel);
    bar.appendChild(walk);

    var undoBtn = E('button', 'gt-btn', 'Undo last command');
    undoBtn.type = 'button';
    var resetBtn = E('button', 'gt-btn warn', 'Reset repository');
    resetBtn.type = 'button';
    bar.appendChild(undoBtn);
    bar.appendChild(resetBtn);

    var count = E('div', 'gt-count');
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    bar.appendChild(count);
    wrap.appendChild(bar);

    var main = E('div', 'gt-main');

    /* --- left column: working tree + terminal --- */
    var left = E('div', 'gt-col');

    var filesPanel = E('div', 'gt-panel');
    var fh = E('div', 'gt-ph');
    fh.appendChild(E('span', null, 'Working tree'));
    fh.appendChild(E('span', 'gt-phnote', '— ordinary files. Git knows nothing about an edit until you add it.'));
    filesPanel.appendChild(fh);
    var files = E('div', 'gt-files');
    files.setAttribute('role', 'group');
    files.setAttribute('aria-label', 'Files in the working tree');
    filesPanel.appendChild(files);
    var edit = document.createElement('textarea');
    edit.className = 'gt-edit';
    edit.spellcheck = false;
    edit.setAttribute('autocapitalize', 'off');
    edit.setAttribute('autocomplete', 'off');
    edit.setAttribute('aria-label', 'Contents of the selected file');
    edit.setAttribute('aria-describedby', 'gt-edithint');
    filesPanel.appendChild(edit);
    var editFoot = E('div', 'gt-editfoot');
    editFoot.id = 'gt-edithint';
    var newBtn = E('button', 'gt-mini', 'New file');
    newBtn.type = 'button';
    var delBtn = E('button', 'gt-mini', 'Delete file');
    delBtn.type = 'button';
    var stageBtn = E('button', 'gt-mini', 'git add this file');
    stageBtn.type = 'button';
    editFoot.appendChild(newBtn);
    editFoot.appendChild(delBtn);
    editFoot.appendChild(stageBtn);
    var editNote = E('span', null, 'Editing here changes only the working tree.');
    editFoot.appendChild(editNote);
    filesPanel.appendChild(editFoot);
    left.appendChild(filesPanel);

    var termPanel = E('div', 'gt-panel');
    var th = E('div', 'gt-ph');
    th.appendChild(E('span', null, 'Shell'));
    th.appendChild(E('span', 'gt-phnote', '— type `help`. Up and Down recall earlier commands.'));
    termPanel.appendChild(th);
    var log = document.createElement('pre');
    log.className = 'gt-log';
    log.tabIndex = 0;
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-label', 'Command output');
    termPanel.appendChild(log);
    var form = document.createElement('form');
    form.className = 'gt-form';
    var prompt = E('span', 'gt-prompt', '$');
    prompt.setAttribute('aria-hidden', 'true');
    var inLabel = E('label', 'sr-only', 'Type a git command');
    inLabel.setAttribute('for', 'gt-input');
    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'gt-input';
    input.className = 'gt-in';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'git status';
    form.appendChild(prompt);
    form.appendChild(inLabel);
    form.appendChild(input);
    termPanel.appendChild(form);
    left.appendChild(termPanel);

    main.appendChild(left);

    /* --- right column: graph + tabs --- */
    var right = E('div', 'gt-col');

    var graphPanel = E('div', 'gt-panel');
    var gh = E('div', 'gt-ph');
    gh.appendChild(E('span', null, 'Commit graph'));
    gh.appendChild(E('span', 'gt-phnote', '— every commit object in the store. Dimmed rows have no label pointing at them.'));
    graphPanel.appendChild(gh);
    var graph = E('div', 'gt-graph');
    graph.setAttribute('role', 'group');
    graph.setAttribute('aria-label', 'Commit graph');
    graphPanel.appendChild(graph);
    right.appendChild(graphPanel);

    var tabPanel = E('div', 'gt-panel');
    var tabs = E('div', 'gt-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Repository internals');
    var defs = [['objects', 'Object store'], ['refs', 'Refs & HEAD'], ['reflog', 'Reflog & undo']];
    this.tabButtons = {};
    for (i = 0; i < defs.length; i++) {
      var tb = E('button', 'gt-tab', defs[i][1]);
      tb.type = 'button';
      tb.id = 'gt-tab-' + defs[i][0];
      tb.setAttribute('role', 'tab');
      tb.setAttribute('aria-controls', 'gt-panel-' + defs[i][0]);
      tabs.appendChild(tb);
      this.tabButtons[defs[i][0]] = tb;
    }
    tabPanel.appendChild(tabs);
    var body = E('div', 'gt-tabpanel');
    body.id = 'gt-panel-objects';
    body.tabIndex = 0;
    body.setAttribute('role', 'tabpanel');
    tabPanel.appendChild(body);
    right.appendChild(tabPanel);

    main.appendChild(right);
    wrap.appendChild(main);
    this.root.appendChild(wrap);

    /* stash refs */
    this.elLog = log; this.elInput = input; this.elFiles = files;
    this.elEdit = edit; this.elGraph = graph; this.elTabBody = body;
    this.elCount = count; this.elTabs = tabs;

    /* wiring */
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var line = input.value;
      input.value = '';
      self.submit(line);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowUp') {
        if (!self.cmdHistory.length) return;
        ev.preventDefault();
        self.cmdAt = Math.max(0, self.cmdAt - 1);
        input.value = self.cmdHistory[self.cmdAt] || '';
      } else if (ev.key === 'ArrowDown') {
        if (!self.cmdHistory.length) return;
        ev.preventDefault();
        self.cmdAt = Math.min(self.cmdHistory.length, self.cmdAt + 1);
        input.value = self.cmdHistory[self.cmdAt] || '';
      }
    });
    edit.addEventListener('input', function () {
      if (!self.selectedFile) return;
      if (edit.value.length > MAX_FILE_CHARS) edit.value = edit.value.slice(0, MAX_FILE_CHARS);
      self.repo.work[self.selectedFile] = edit.value;
      self.renderFiles();
      self.renderCount();
    });
    newBtn.addEventListener('click', function () { self.newFile(); });
    delBtn.addEventListener('click', function () {
      if (!self.selectedFile) return;
      self.submit('rm ' + self.selectedFile);
    });
    stageBtn.addEventListener('click', function () {
      if (!self.selectedFile) return;
      self.submit('git add ' + self.selectedFile);
    });
    undoBtn.addEventListener('click', function () { self.undoLast(); });
    resetBtn.addEventListener('click', function () { self.hardReset(); });
    walk.addEventListener('change', function () {
      if (!walk.value) return;
      self.runWalk(walk.value);
      walk.selectedIndex = 0;
    });
    tabs.addEventListener('click', function (ev) {
      var key = tabKeyOf(ev.target);
      if (key) { self.tab = key; self.renderTabs(); }
    });
    /* Arrow-key movement between tabs, which is what makes a tablist a tablist
       rather than three buttons in a row. */
    tabs.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var order = ['objects', 'refs', 'reflog'];
      var at = order.indexOf(self.tab);
      at = ev.key === 'ArrowRight' ? (at + 1) % order.length : (at + order.length - 1) % order.length;
      ev.preventDefault();
      self.tab = order[at];
      self.renderTabs();
      self.tabButtons[self.tab].focus();
    });
    this.elUndoBtn = undoBtn;
  };

  function tabKeyOf(node) {
    while (node && node.className !== undefined) {
      if (node.id && node.id.indexOf('gt-tab-') === 0) return node.id.slice(7);
      node = node.parentNode;
    }
    return null;
  }

  /* ---- seed and intro -------------------------------------------------- */

  GitUI.prototype.seed = function () {
    var r = this.repo;
    r.reset();
    r.work = {
      'README.md': '# Toy repo\n\nA tiny project for watching git think.\n',
      'notes.txt': 'buy milk\n',
      'src/app.js': 'function main() {\n  return 42;\n}\n'
    };
    this.history = [];
    this.selectedFile = 'README.md';
    this.selectedObject = null;
    this.selectedCommit = null;
    this.git = new Git(r, this.sink());
  };

  GitUI.prototype.intro = function () {
    var o = this.sink();
    o.line('A real object store, empty, in this tab.', 'hd');
    o.dim('Three untracked files are sitting in the working tree and git knows');
    o.dim('nothing about any of them yet: zero objects.');
    o.line('');
    o.line('Try:  git status   then   git add .   then   git commit -m "First commit"', 'cmd');
    o.dim('Or pick a guided walkthrough above. `help` lists every command.');
    o.line('');
    this.checkSelfTest(o);
  };

  /* The claim this whole lab rests on is "these hashes are real". Two constants
     settle it, both reproducible in any real repository:
       git hash-object -t blob /dev/null  -> e69de29...
       git hash-object -t tree /dev/null  -> 4b825dc...
     If either check fails the tool says so in the log and in the Objects panel
     rather than carrying on and teaching a lie. */
  GitUI.prototype.selfTest = function () {
    var r = this.repo;
    var empty = sha1Hex([]);
    var blob = r.hashOnly('blob', []);
    var tree = r.hashOnly('tree', []);
    var hello = r.hashOnly('blob', utf8Bytes('hello, world\n'));
    return {
      cases: [
        { name: 'SHA-1 of the empty input', got: empty, want: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
        { name: 'git’s empty blob', got: blob, want: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' },
        { name: 'git’s empty tree', got: tree, want: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' },
        { name: 'blob of "hello, world" + newline', got: hello, want: '4b5fa63702dd96796042e92787f464e28f09f17d' }
      ]
    };
  };

  GitUI.prototype.checkSelfTest = function (o) {
    var t = this.selfTest(), bad = 0, i;
    for (i = 0; i < t.cases.length; i++) if (t.cases[i].got !== t.cases[i].want) bad++;
    if (bad) {
      o.err('SHA-1 self-check FAILED on ' + bad + ' of ' + t.cases.length + ' known values.');
      o.err('Do not trust the hashes on this page. Please report it.');
    } else {
      o.ok('SHA-1 self-check passed against ' + t.cases.length + ' published git constants.');
      o.dim('The Object store tab shows them. Every hash here is real SHA-1 over');
      o.dim('real git object bytes; you can reproduce them with git itself.');
    }
  };

  /* ---- running commands ------------------------------------------------ */

  GitUI.prototype.submit = function (line) {
    line = String(line == null ? '' : line).replace(/\s+$/, '');
    if (!line.trim()) return;
    this.cmdHistory.push(line);
    this.cmdAt = this.cmdHistory.length;
    this.exec(line);
    this.renderAll();
  };

  GitUI.prototype.exec = function (line) {
    var trimmed = line.replace(/^\s+/, '');
    if (trimmed.charAt(0) === '#') { this.emit(trimmed, 'note'); return; }
    this.emit('$ ' + trimmed, 'cmd');
    if (trimmed === 'clear') { this.clearLog(); return; }
    if (trimmed === 'undo') { this.undoLast(); return; }

    var before = this.repo.snapshot();
    try {
      this.git.run(trimmed);
    } catch (err) {
      // A repository model fed arbitrary text will eventually meet an input its
      // author did not imagine. Losing the whole tool to one of those would be
      // far worse than saying so: the state is rolled back and the shell keeps
      // taking commands.
      this.repo.restore(before);
      this.emit('That command hit a bug in this toy and was rolled back.', 'er');
      this.emit('Nothing in the repository changed. Details: ' +
                ((err && err.message) || String(err)), 'dim');
      return;
    }
    var after = this.repo.snapshot();
    if (after !== before) {
      this.history.push({ cmd: trimmed, snapshot: before, destructive: isDestructive(trimmed) });
      if (this.history.length > 200) this.history.shift();
    }
  };

  function isDestructive(line) {
    return /(^|\s)(reset|rebase|checkout|switch|rm|branch\s+-[dD]|tag\s+-d|merge)(\s|$)/.test(line) ||
           line.indexOf('--hard') >= 0 || line.indexOf('--force') >= 0;
  }

  GitUI.prototype.clearLog = function () {
    while (this.elLog.firstChild) this.elLog.removeChild(this.elLog.firstChild);
  };

  GitUI.prototype.undoLast = function () {
    if (!this.history.length) {
      this.emit('Nothing to undo — no command has changed the repository yet.', 'dim');
      return;
    }
    this.undoTo(this.history.length - 1);
  };

  /* Undo restores the state captured BEFORE history[i], which undoes that
     command and everything after it. It leaves the object store alone, exactly
     as git does: the objects those commands wrote stay in the store and stay
     visible in the graph, dimmed. Nothing here can destroy an object. */
  GitUI.prototype.undoTo = function (i) {
    var entry = this.history[i];
    if (!entry) return;
    this.repo.restore(entry.snapshot);
    this.history = this.history.slice(0, i);
    this.emit('Undone: ' + entry.cmd, 'wa');
    this.emit('The refs, the index and the working tree are back where they were', 'dim');
    this.emit('before that command. Every object it wrote is still in the store —', 'dim');
    this.emit('undo moves labels, it does not delete anything.', 'dim');
    this.renderAll();
  };

  GitUI.prototype.hardReset = function () {
    this.clearLog();
    this.seed();
    this.emit('Repository reset. Object store emptied, working tree back to three files.', 'wa');
    this.intro();
    this.renderAll();
  };

  GitUI.prototype.runWalk = function (id) {
    var walk = null, i;
    for (i = 0; i < WALKS.length; i++) if (WALKS[i].id === id) walk = WALKS[i];
    if (!walk) return;
    this.clearLog();
    this.seed();
    this.emit('── Walkthrough: ' + walk.name + ' ──', 'hd');
    this.emit('Every line below is a real command against a real object store.', 'dim');
    this.emit('Poke at it afterwards; nothing here can be broken permanently.', 'dim');
    this.emit('', 'out');
    for (i = 0; i < walk.steps.length; i++) this.exec(walk.steps[i]);
    this.renderAll();
    this.elInput.focus();
  };

  /* window.prompt rather than a hand-built modal: the browser's own dialog is
     already keyboard-operable and announced by screen readers, and a bespoke
     one would be a second focus trap to get right for a field asked for once.
     The path is then filtered hard — this string becomes a tree entry name, so
     anything outside [A-Za-z0-9._/-] is refused rather than hashed. */
  GitUI.prototype.newFile = function () {
    var name = window.prompt('New file path (a "/" makes a subdirectory, which makes a nested tree):', 'src/util.js');
    if (name == null) return;
    name = String(name).replace(/^\/+|\/+$/g, '').replace(/\s+/g, '');
    if (!name) return;
    if (name.length > 80 || /[^\w./-]/.test(name)) {
      this.emit('That path has characters this toy will not take. Letters, digits, dot, dash, underscore and slash.', 'er');
      return;
    }
    if (name in this.repo.work) { this.emit(name + ' already exists.', 'er'); this.select(name); return; }
    this.repo.work[name] = '';
    this.select(name);
    this.emit('Created ' + name + ' in the working tree. No object was written.', 'dim');
    this.renderAll();
    this.elEdit.focus();
  };

  GitUI.prototype.select = function (path) {
    this.selectedFile = path;
    this.elEdit.value = this.repo.work[path] == null ? '' : this.repo.work[path];
  };

  /* ---- rendering ------------------------------------------------------- */

  GitUI.prototype.renderAll = function () {
    this.renderFiles();
    this.renderGraph();
    this.renderTabs();
    this.renderCount();
    this.elUndoBtn.disabled = !this.history.length;
  };

  GitUI.prototype.renderCount = function () {
    var r = this.repo, keys = Object.keys(r.objects), i;
    var counts = { blob: 0, tree: 0, commit: 0, tag: 0 };
    for (i = 0; i < keys.length; i++) counts[r.objects[keys[i]].type]++;
    while (this.elCount.firstChild) this.elCount.removeChild(this.elCount.firstChild);
    this.elCount.appendChild(document.createTextNode('object store: '));
    var b = E('b', null, String(keys.length));
    this.elCount.appendChild(b);
    this.elCount.appendChild(document.createTextNode(
      ' (' + counts.blob + ' blob, ' + counts.tree + ' tree, ' +
      counts.commit + ' commit' + (counts.tag ? ', ' + counts.tag + ' tag' : '') + ')'));
  };

  GitUI.prototype.renderFiles = function () {
    var r = this.repo, self = this;
    var paths = Object.keys(r.work).sort(), i;
    var head = r.headTree();
    while (this.elFiles.firstChild) this.elFiles.removeChild(this.elFiles.firstChild);
    if (!paths.length) {
      this.elFiles.appendChild(E('span', 'gt-empty', 'The working tree is empty.'));
    }
    if (paths.indexOf(this.selectedFile) < 0) this.selectedFile = paths.length ? paths[0] : null;

    for (i = 0; i < paths.length; i++) {
      (function (p) {
        var btn = E('button', 'gt-file');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', p === self.selectedFile ? 'true' : 'false');
        var state, cls, label;
        if (r.conflicts[p]) { state = 'conflicted'; cls = 'cnf'; }
        else if (!(p in r.index)) { state = 'untracked'; cls = 'new'; }
        else if (r.index[p] !== r.blobOidOf(r.work[p])) { state = 'modified, not staged'; cls = 'mod'; }
        else if (head[p] !== r.index[p]) { state = 'staged'; cls = 'stg'; }
        else { state = 'committed and unchanged'; cls = ''; }
        btn.appendChild(E('span', 'gt-dot' + (cls ? ' ' + cls : '')));
        btn.appendChild(E('span', null, p));
        label = p + ' — ' + state;
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.addEventListener('click', function () {
          self.select(p);
          self.renderFiles();
        });
        self.elFiles.appendChild(btn);
      })(paths[i]);
    }
    if (this.selectedFile) {
      if (this.elEdit.value !== this.repo.work[this.selectedFile]) {
        this.elEdit.value = this.repo.work[this.selectedFile];
      }
      this.elEdit.disabled = false;
    } else {
      this.elEdit.value = '';
      this.elEdit.disabled = true;
    }
  };

  GitUI.prototype.renderGraph = function () {
    var r = this.repo, self = this;
    var g = layoutGraph(r);
    var labels = refLabels(r);
    var live = r.reachable();
    var laneW = LANE_X0 + (g.maxLane + 1) * LANE_GAP + 10;

    while (this.elGraph.firstChild) this.elGraph.removeChild(this.elGraph.firstChild);

    if (!g.rows.length) {
      var empty = E('div', 'gt-empty', 'No commits yet. `git commit` writes the first one.');
      empty.style.padding = '10px 11px';
      this.elGraph.appendChild(empty);
      return;
    }

    var svg = svgEl('svg');
    svg.setAttribute('class', 'gt-svg');
    svg.setAttribute('width', String(laneW));
    svg.setAttribute('height', String(g.rows.length * ROW_H));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    var i, j;
    for (i = 0; i < g.rows.length; i++) {
      var row = g.rows[i];
      var x = LANE_X0 + row.lane * LANE_GAP, y = i * ROW_H + ROW_H / 2;
      for (j = 0; j < row.parents.length; j++) {
        var pi = g.index[row.parents[j]];
        if (pi == null) continue;
        var plane = g.rows[pi].lane;
        var px = LANE_X0 + plane * LANE_GAP, py = pi * ROW_H + ROW_H / 2;
        var path = svgEl('path');
        var midY = y + ROW_H / 2;
        path.setAttribute('d', 'M' + x + ' ' + y + ' C ' + x + ' ' + midY + ', ' +
                          px + ' ' + midY + ', ' + px + ' ' + Math.min(midY, py) +
                          ' L ' + px + ' ' + py);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', live[row.oid] ? '#3d6fb5' : '#33405a');
        path.setAttribute('stroke-width', '2');
        svg.appendChild(path);
      }
    }
    for (i = 0; i < g.rows.length; i++) {
      var r2 = g.rows[i];
      var cx = LANE_X0 + r2.lane * LANE_GAP, cy = i * ROW_H + ROW_H / 2;
      var dot = svgEl('circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', r2.parents.length > 1 ? '6' : '5');
      dot.setAttribute('fill', live[r2.oid] ? '#0a1120' : '#0a1120');
      dot.setAttribute('stroke', live[r2.oid] ? (r2.parents.length > 1 ? '#c9a5ff' : '#6fd6ff') : '#5b6a83');
      dot.setAttribute('stroke-width', '2.5');
      svg.appendChild(dot);
    }
    this.elGraph.appendChild(svg);

    for (i = 0; i < g.rows.length; i++) {
      (function (row) {
        var btn = E('button', 'gt-row' + (live[row.oid] ? '' : ' dead'));
        btn.type = 'button';
        btn.style.paddingLeft = laneW + 'px';
        btn.setAttribute('aria-pressed', row.oid === self.selectedCommit ? 'true' : 'false');
        btn.appendChild(E('span', 'gt-sha', short(row.oid)));
        var pills = labels[row.oid] || [];
        var names = [];
        for (var k = 0; k < pills.length; k++) {
          var cls = 'gt-pill';
          if (pills[k].indexOf('HEAD') === 0) cls += ' head';
          else if (pills[k].indexOf('tag: ') === 0) cls += ' tag';
          btn.appendChild(E('span', cls, pills[k]));
          names.push(pills[k]);
        }
        if (!live[row.oid]) {
          btn.appendChild(E('span', 'gt-pill orphan', 'unreferenced'));
          names.push('unreferenced');
        }
        btn.appendChild(E('span', 'gt-subj', row.commit ? row.commit.subject : ''));
        btn.setAttribute('aria-label', 'Commit ' + short(row.oid) + ': ' +
          (row.commit ? row.commit.subject : '') +
          (names.length ? '. ' + names.join(', ') : '') + '. Show this object.');
        btn.addEventListener('click', function () {
          self.selectedCommit = row.oid;
          self.selectedObject = row.oid;
          self.tab = 'objects';
          self.renderGraph();
          self.renderTabs();
        });
        self.elGraph.appendChild(btn);
      })(g.rows[i]);
    }

    if (g.truncated) {
      var more = E('div', 'gt-empty', 'Showing the newest ' + MAX_GRAPH_ROWS + ' commits.');
      more.style.padding = '6px 11px';
      more.style.paddingLeft = laneW + 'px';
      this.elGraph.appendChild(more);
    }
  };

  GitUI.prototype.renderTabs = function () {
    var keys = ['objects', 'refs', 'reflog'], i;
    for (i = 0; i < keys.length; i++) {
      var on = keys[i] === this.tab;
      this.tabButtons[keys[i]].setAttribute('aria-selected', on ? 'true' : 'false');
      this.tabButtons[keys[i]].tabIndex = on ? 0 : -1;
    }
    this.elTabBody.id = 'gt-panel-' + this.tab;
    this.elTabBody.setAttribute('aria-labelledby', 'gt-tab-' + this.tab);
    while (this.elTabBody.firstChild) this.elTabBody.removeChild(this.elTabBody.firstChild);
    if (this.tab === 'objects') this.renderObjects();
    else if (this.tab === 'refs') this.renderRefs();
    else this.renderReflog();
  };

  GitUI.prototype.renderObjects = function () {
    var r = this.repo, self = this, body = this.elTabBody;
    var t = this.selfTest(), bad = [], i;
    for (i = 0; i < t.cases.length; i++) if (t.cases[i].got !== t.cases[i].want) bad.push(t.cases[i]);

    var check = E('div', 'gt-check' + (bad.length ? ' fail' : ' pass'));
    if (bad.length) {
      check.appendChild(E('div', null, 'SHA-1 self-check FAILED. Do not trust these hashes.'));
      for (i = 0; i < bad.length; i++) {
        check.appendChild(E('div', null, bad[i].name + ': got ' + bad[i].got + ', expected ' + bad[i].want));
      }
    } else {
      check.appendChild(E('div', null,
        'SHA-1 self-check: ' + t.cases.length + ' of ' + t.cases.length + ' known git constants match.'));
      var line = E('div', null, 'Empty blob ');
      line.appendChild(E('code', null, t.cases[1].want));
      line.appendChild(document.createTextNode('  ·  empty tree '));
      line.appendChild(E('code', null, t.cases[2].want));
      check.appendChild(line);
      check.appendChild(E('div', null,
        'Reproduce them yourself: `git hash-object -t blob /dev/null` and `git hash-object -t tree /dev/null`.'));
    }
    body.appendChild(check);

    var keys = Object.keys(r.objects);
    if (!keys.length) {
      body.appendChild(E('p', 'gt-empty', 'The store is empty. `git add` writes the first object.'));
      return;
    }
    keys.sort(function (a, b) { return r.objects[b].n - r.objects[a].n; });
    var live = r.reachable();
    var pathsOfBlob = this.blobPaths();

    var listWrap = E('div');
    for (i = 0; i < keys.length && i < 300; i++) {
      (function (oid) {
        var o = r.objects[oid];
        var btn = E('button', 'gt-objrow');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', oid === self.selectedObject ? 'true' : 'false');
        btn.appendChild(E('span', 'gt-ty ' + o.type, o.type));
        btn.appendChild(E('span', 'gt-objsha', short(oid)));
        var note = o.size + ' B';
        if (o.type === 'blob' && pathsOfBlob[oid]) note += '  ·  ' + pathsOfBlob[oid].join(', ');
        if (o.type === 'commit') {
          var c = r.parseCommit(oid);
          note += '  ·  ' + (c ? c.subject : '');
          if (!live[oid]) note += '  ·  unreferenced';
        }
        btn.appendChild(E('span', 'gt-objnote', note));
        btn.setAttribute('aria-label', o.type + ' ' + short(oid) + ', ' + note + '. Show its bytes.');
        btn.addEventListener('click', function () {
          self.selectedObject = oid;
          self.renderTabs();
        });
        listWrap.appendChild(btn);
      })(keys[i]);
    }
    body.appendChild(listWrap);
    if (keys.length > 300) body.appendChild(E('p', 'gt-empty', 'Showing the newest 300 objects.'));

    if (this.selectedObject && r.objects[this.selectedObject]) {
      body.appendChild(this.objectDetail(this.selectedObject));
    } else {
      body.appendChild(E('p', 'gt-legend',
        'Pick an object to see the exact bytes that were hashed to give it that name.'));
    }
  };

  GitUI.prototype.blobPaths = function () {
    var r = this.repo, out = {}, keys = Object.keys(r.objects), i, j;
    for (i = 0; i < keys.length; i++) {
      if (r.objects[keys[i]].type !== 'commit') continue;
      var c = r.parseCommit(keys[i]);
      var flat = r.flatten(c.tree, ''), fk = Object.keys(flat);
      for (j = 0; j < fk.length; j++) {
        if (!out[flat[fk[j]]]) out[flat[fk[j]]] = [];
        if (out[flat[fk[j]]].indexOf(fk[j]) < 0) out[flat[fk[j]]].push(fk[j]);
      }
    }
    return out;
  };

  /* The payoff panel: the literal header, a visible NUL, and the body — the
     exact byte sequence SHA-1 was run over. A tree's body is binary (20 raw
     bytes per entry), so it is shown decoded as `cat-file -p` shows it, with a
     line saying what the real bytes are. */
  GitUI.prototype.objectDetail = function (oid) {
    var r = this.repo, o = r.objects[oid];
    var box = E('div');
    box.appendChild(kv('name', oid));
    box.appendChild(kv('type', o.type));
    box.appendChild(kv('size', o.size + ' bytes of body'));

    var pre = E('pre', 'gt-bytes');
    pre.appendChild(E('span', 'h', o.type + ' ' + o.size));
    pre.appendChild(E('span', 'nul', '\\0'));
    if (o.type === 'tree') {
      var entries = r.parseTree(oid), i;
      pre.appendChild(document.createTextNode('\n'));
      for (i = 0; i < entries.length; i++) {
        pre.appendChild(document.createTextNode(
          entries[i].mode + ' ' + entries[i].type + ' ' + entries[i].oid + '    ' + entries[i].name + '\n'));
      }
      box.appendChild(pre);
      box.appendChild(E('p', 'gt-legend',
        'A tree entry on disk is "' + '<mode> <name>' + '" then a NUL then twenty RAW bytes of hash — ' +
        'not the forty hex characters shown here. That is why a tree object looks like binary in an editor.'));
    } else {
      var text = utf8Decode(o.body, 0, o.body.length);
      pre.appendChild(document.createTextNode(text.length > 2000 ? text.slice(0, 2000) + '\n…' : text));
      box.appendChild(pre);
      if (o.type === 'commit') {
        box.appendChild(E('p', 'gt-legend',
          'Everything above is inside the hash: the tree, the parents, the author line, ' +
          'the committer line and the message. Change any character and the commit gets a different name — ' +
          'which is exactly why rebase cannot preserve identity.'));
      } else if (o.type === 'blob') {
        box.appendChild(E('p', 'gt-legend',
          'No filename anywhere. A blob is content and nothing else, which is why two files with ' +
          'identical bytes are one object with two names in a tree.'));
      }
    }
    box.appendChild(E('p', 'gt-legend',
      'SHA-1 of that whole sequence, header included, is ' + oid + '.'));
    return box;
  };

  function kv(k, v) {
    var row = E('div', 'gt-kv');
    row.appendChild(E('span', 'k', k));
    row.appendChild(E('span', 'v', v));
    return row;
  }

  GitUI.prototype.renderRefs = function () {
    var r = this.repo, body = this.elTabBody;
    var keys = Object.keys(r.refs).sort(), i;

    var headBox = E('div', 'gt-bytes');
    headBox.appendChild(E('span', 'h', '.git/HEAD'));
    if (r.head.detached) {
      headBox.appendChild(document.createTextNode('\n' + r.head.oid + '\n'));
    } else {
      headBox.appendChild(document.createTextNode('\nref: ' + r.head.ref + '\n'));
    }
    body.appendChild(headBox);
    body.appendChild(E('p', 'gt-legend', r.head.detached
      ? 'HEAD holds a commit hash directly. That is the whole of "detached HEAD": you are standing on a commit, not on a branch, so a commit made here would move nothing and get no label.'
      : 'HEAD holds the NAME of a branch, which is why committing moves the branch file and leaves HEAD alone.'));

    if (!keys.length) {
      body.appendChild(E('p', 'gt-empty', 'No refs yet — the first commit creates refs/heads/main.'));
      return;
    }
    for (i = 0; i < keys.length; i++) {
      var box = E('div', 'gt-bytes');
      box.appendChild(E('span', 'h', '.git/' + keys[i]));
      box.appendChild(document.createTextNode('\n' + r.refs[keys[i]] + '\n'));
      body.appendChild(box);
    }
    body.appendChild(E('p', 'gt-legend',
      'Each of those files is 41 bytes on disk: forty characters of hex and a newline. ' +
      'Creating a branch writes one of them. That is the entire reason "branch freely" is not bravado.'));
  };

  GitUI.prototype.renderReflog = function () {
    var r = this.repo, self = this, body = this.elTabBody, i;

    body.appendChild(E('p', 'gt-legend',
      'Every move HEAD has made, newest first. Real git keeps this for about ninety days, ' +
      'including for commits nothing points at any more — which is why committed work is so hard to lose.'));

    if (!r.reflog.length) {
      body.appendChild(E('p', 'gt-empty', 'Nothing has moved HEAD yet.'));
    }
    for (i = 0; i < r.reflog.length && i < 40; i++) {
      var e = r.reflog[i];
      var row = E('div', 'gt-undo');
      var u = E('span', 'u');
      u.appendChild(E('b', null, short(e.after)));
      u.appendChild(document.createTextNode('  HEAD@{' + i + '}  ' + e.action));
      row.appendChild(u);
      body.appendChild(row);
    }

    body.appendChild(E('p', 'gt-legend',
      'Undo, below, is not a git command — it is this page keeping a snapshot of the refs, ' +
      'the index and the working tree before each command. Undoing rewinds to just before that ' +
      'command and everything after it. It never removes an object, because git never does either.'));

    if (!this.history.length) {
      body.appendChild(E('p', 'gt-empty', 'No command has changed the repository yet.'));
      return;
    }
    for (i = this.history.length - 1; i >= 0; i--) {
      (function (idx) {
        var h = self.history[idx];
        var row = E('div', 'gt-undo');
        var u = E('span', 'u');
        u.appendChild(E('b', null, h.cmd));
        if (h.destructive) u.appendChild(E('span', 'd', '  — destructive'));
        row.appendChild(u);
        var btn = E('button', 'gt-mini', 'Undo this');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Undo "' + h.cmd + '" and every command after it');
        btn.addEventListener('click', function () { self.undoTo(idx); });
        row.appendChild(btn);
        body.appendChild(row);
      })(i);
    }
  };

  /* ====================================================================== */
  /*  BOOT                                                                  */
  /* ====================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var root = document.getElementById('gitviz');
    if (!root) return;
    built = true;
    var mount = document.getElementById('viz-git-mount') || root;
    try {
      var ui = new GitUI(mount);
      if (ui && window.KSLab) window.KSLab.used('run');
    } catch (err) {
      while (mount.firstChild) mount.removeChild(mount.firstChild);
      var msg = document.createElement('p');
      msg.className = 'lab-viz-error';
      msg.textContent = 'This lab could not start in your browser: ' +
        ((err && err.message) || String(err)) +
        ' — the write-up below still explains what it would have shown.';
      mount.appendChild(msg);
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'gitviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

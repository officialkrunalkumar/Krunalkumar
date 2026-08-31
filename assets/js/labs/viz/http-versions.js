/* ==========================================================================
   http-versions.js — HTTP/1.1, HTTP/2 and HTTP/3 raced on one simulated link.
   --------------------------------------------------------------------------
   Every explanation of these three protocols I have read describes the
   differences. Almost none of them show the differences, and the difference
   between "HTTP/3 handles loss better" and watching HTTP/2 freeze solid while
   HTTP/3 keeps going is the whole distance between a claim and an
   understanding. So this lab runs the same page load over the same link three
   times at once and draws the waterfalls side by side.

   Four families over one small model:

     1. The race    — N resources over a link whose latency, bandwidth and
                      packet loss you set. Three waterfalls, one clock, one
                      playhead. The loss slider is the centrepiece.
     2. HTTP/1.1    — six connections per origin, head-of-line blocking inside
                      each of them, and what domain sharding bought before it
                      stopped being a good idea.
     3. HTTP/2      — one connection, multiplexed streams, HPACK with a real
                      running dynamic table, and the TCP-level head-of-line
                      blocking that HTTP/2 does NOT fix.
     4. HTTP/3      — QUIC: one fewer round trip to set up, 0-RTT resumption,
                      streams that fail independently, and a connection that
                      survives changing networks.

   Decisions worth spelling out, because they are where a simulation earns or
   loses its right to be believed:

   1. THE LOSS MODEL IS THE POINT, SO IT IS THE SAME EVERYWHERE. Loss is drawn
      per packet, from one seeded generator, at the rate the slider says. When
      a packet is lost, all three protocols halve the connection's congestion
      window — QUIC has congestion control too, and pretending otherwise would
      be the exact marketing lie this lab exists to avoid. What differs is who
      has to wait for the retransmit: HTTP/1.1 stalls one of six connections,
      HTTP/2 stalls every stream on its single TCP connection, and HTTP/3
      stalls only the QUIC stream that lost the packet. That single difference
      is drawn as a red band across the rows it actually blocks.

   2. A STALL HERE STOPS THE AFFECTED SCOPE DEAD FOR ONE RTT. Real TCP keeps
      the sender going until the receive window fills, so on a fast link a
      short stall costs less than this model charges. Real loss also arrives
      in bursts, and a retransmission timeout costs far more than one RTT, so
      the model is generous in the other direction too. It is calibrated to
      show the mechanism, not to predict your numbers. The page says so out
      loud rather than hiding it in a comment.

   3. THE HPACK NUMBERS ARE EXACT, NOT ESTIMATED. The encoder here does real
      RFC 7541 work: the static table by index, a dynamic table with real
      entry sizing (name + value + 32) and real eviction at the table limit,
      and RFC 7541 section 5.1 integer prefix encoding for every field. What
      it does NOT do is Huffman-code the literals — and that is not a fudge,
      it is a legal HPACK choice (the H bit is simply 0). Huffman would shave
      a further fifth or so off the literal bytes and nothing at all off the
      indexed ones, and the indexed ones are the story. An exact number with a
      stated limitation beats an approximate one dressed up as exact.

   4. FRAMES ARE PRECOMPUTED, so stepping backwards is free and the compare
      table can be built once. Same contract as every other lab on this shell.

   Nothing here opens a network connection. The only HTTP involved is the
   request that delivered this file, and you can check that in your Network
   tab — which, if you have the HAR analyser open in another tab, you can then
   drop straight into it.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  CORE 1 — THE LINK AND THE THREE PROTOCOLS                               */
  /* ======================================================================== */

  var MSS = 1460;          // bytes of payload in one packet
  var DT = 4;              // simulation tick, ms
  var CAP = 30000;         // give up after this much simulated time

  /* xorshift32. Pure bitwise, so it is exact in ES5 without Math.imul, and it
     is seeded so the same sliders always produce the same run — a race whose
     winner changed on every redraw would be useless for comparing settings. */
  function lcg(seed) {
    var s = (seed >>> 0) || 2463534242;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* A plausible page. Sizes are the kind of thing a real site ships, and the
     order is discovery order: the document first, then what it references. */
  var CATALOGUE = [
    { name: 'index.html', bytes: 24576, kind: 'doc' },
    { name: 'app.css', bytes: 47104, kind: 'css' },
    { name: 'inter-var.woff2', bytes: 59392, kind: 'font' },
    { name: 'app.js', bytes: 172032, kind: 'js' },
    { name: 'vendor.js', bytes: 317440, kind: 'js' },
    { name: 'hero.jpg', bytes: 219136, kind: 'img' },
    { name: 'logo.svg', bytes: 8192, kind: 'img' },
    { name: 'analytics.js', bytes: 43008, kind: 'js' },
    { name: 'photo-a.jpg', bytes: 98304, kind: 'img' },
    { name: 'photo-b.jpg', bytes: 76800, kind: 'img' },
    { name: 'icons.svg', bytes: 12288, kind: 'img' },
    { name: 'photo-c.jpg', bytes: 132096, kind: 'img' },
    { name: 'widget.js', bytes: 61440, kind: 'js' },
    { name: 'photo-d.jpg', bytes: 88064, kind: 'img' },
    { name: 'print.css', bytes: 9216, kind: 'css' },
    { name: 'photo-e.jpg', bytes: 114688, kind: 'img' },
    { name: 'photo-f.jpg', bytes: 70656, kind: 'img' },
    { name: 'tile-1.png', bytes: 34816, kind: 'img' },
    { name: 'tile-2.png', bytes: 33792, kind: 'img' },
    { name: 'tile-3.png', bytes: 35840, kind: 'img' },
    { name: 'avatar-1.jpg', bytes: 18432, kind: 'img' },
    { name: 'avatar-2.jpg', bytes: 17408, kind: 'img' },
    { name: 'sprite.png', bytes: 52224, kind: 'img' },
    { name: 'poly.js', bytes: 27648, kind: 'js' }
  ];

  /* Roughly the weights Chrome hands HTTP/2 streams. They are approximate and
     labelled as such on the page; the ordering is the part that matters. */
  var WEIGHT = { doc: 256, css: 220, font: 180, js: 147, img: 110 };

  function weightFor(kind) { return WEIGHT[kind] || 110; }

  function buildResources(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var src = CATALOGUE[i % CATALOGUE.length];
      out.push({
        name: i < CATALOGUE.length ? src.name : src.name + '?v=' + (i + 1),
        bytes: src.bytes, kind: src.kind
      });
    }
    return out;
  }

  /* Round trips burned before the first request byte can leave.
     TCP is one, TLS 1.3 is one more. QUIC folds the transport and the crypto
     handshake into a single flight, and 0-RTT puts the request in that flight. */
  function setupRtts(proto, zeroRtt) {
    if (proto === 'h1' || proto === 'h2') return 2;
    return zeroRtt ? 0 : 1;
  }

  var PROTO_LABEL = { h1: 'HTTP/1.1', h2: 'HTTP/2', h3: 'HTTP/3' };

  function simulate(o) {
    var proto = o.proto;
    var rtt = Math.max(10, o.rtt || 80);
    var think = o.think == null ? 20 : Math.max(0, o.think);
    var linkBps = Math.max(1, o.bw || 10) * 125;      // Mbps -> bytes per ms
    var loss = Math.max(0, o.loss || 0) / 100;
    var shards = proto === 'h1' ? Math.max(1, o.shards || 1) : 1;
    var priorities = o.priorities !== false;
    var rng = lcg(o.seed || 20260831);

    var res = [];
    var totalBytes = 0;
    var i, k, ci;
    for (i = 0; i < o.resources.length; i++) {
      var src = o.resources[i];
      res.push({
        i: i, name: src.name, kind: src.kind, bytes: src.bytes, remaining: src.bytes,
        conn: -1, eligibleAt: 0, requestedAt: -1, firstByteAt: -1, doneAt: -1,
        stallUntil: -1, stallMs: 0, stalls: 0, pktAcc: 0
      });
      totalBytes += src.bytes;
    }

    var rtts = setupRtts(proto, o.zeroRtt);
    var maxConns = proto === 'h1' ? 6 * shards : 1;
    /* SETTINGS_MAX_CONCURRENT_STREAMS is 100 on most servers. With the page
       sizes here it never binds, but leaving it in keeps the model honest
       about the fact that the limit exists. */
    var slots = proto === 'h1' ? 1 : 100;
    var bdpPkts = Math.max(4, linkBps * rtt / MSS);

    var conns = [];
    function openConn(at) {
      /* A sharded origin is a different host name, so DNS, TCP and TLS all
         happen again. That extra round trip is a large part of why sharding
         stopped paying for itself. */
      var extra = (shards > 1 && conns.length > 0 && conns.length % 6 === 0) ? rtt : 0;
      var ready = at + rtts * rtt + extra;
      var c = {
        id: conns.length, shard: Math.floor(conns.length / 6) + 1,
        openAt: at, readyAt: ready,
        cwnd: 10, ssthresh: Math.max(16, Math.round(bdpPkts * 2)),
        nextGrow: ready + rtt, stallUntil: -1, recoverUntil: -1, cuts: 0,
        stalls: 0, stallMs: 0, active: [], took: [], bytes: 0, recv: null
      };
      conns.push(c);
      return c;
    }
    openConn(0);

    var queue = [0];
    var released = false;
    var events = [];
    var done = 0;
    var t = 0;

    function releaseQueue(at) {
      var rest = [];
      for (var q = 1; q < res.length; q++) rest.push(res[q]);
      if (priorities) {
        rest.sort(function (a, b) {
          var d = weightFor(b.kind) - weightFor(a.kind);
          return d !== 0 ? d : a.i - b.i;
        });
      }
      for (q = 0; q < rest.length; q++) {
        rest[q].eligibleAt = at;
        queue.push(rest[q].i);
      }
    }

    function applyLoss(c, r, at) {
      /* Congestion response is identical for all three, because it is: QUIC
         runs congestion control at the connection level exactly as TCP does.
         What is NOT identical is who has to wait for the retransmit before
         anything can be handed to the application.

         The window comes down once per congestion event, not once per lost
         packet. Every loss inside the recovery period that the first one
         opened is part of the same event. Charging per packet instead was
         wrong and it was not a small error: at 2% loss it collapsed the
         window faster than it could ever recover, both HTTP/2 and HTTP/3 went
         congestion-bound, and the head-of-line difference this lab exists to
         show disappeared underneath an artefact of my own arithmetic. */
      if (at >= c.recoverUntil) {
        c.ssthresh = Math.max(2, Math.floor(c.cwnd / 2));
        c.cwnd = c.ssthresh;
        c.nextGrow = at + rtt;
        c.recoverUntil = at + rtt;
        c.cuts += 1;
      }
      var until = at + rtt;
      if (proto === 'h3') {
        r.stallUntil = Math.max(r.stallUntil, until);
        r.stalls += 1;
        events.push({ t: at, kind: 'loss', scope: 'stream', res: r.i, conn: c.id, until: until });
      } else {
        c.stallUntil = Math.max(c.stallUntil, until);
        c.stalls += 1;
        events.push({ t: at, kind: 'loss', scope: 'conn', res: r.i, conn: c.id, until: until });
      }
    }

    while (t <= CAP && done < res.length) {
      /* 1. Completion sweep. A stream whose bytes have all arrived is only
            finished once its scope is delivering again — a retransmit still
            outstanding is precisely what head-of-line blocking is. */
      for (ci = 0; ci < conns.length; ci++) {
        var cc = conns[ci];
        for (k = cc.active.length - 1; k >= 0; k--) {
          var a = cc.active[k];
          if (a.remaining > 0.5) continue;
          if (t < cc.stallUntil || t < a.stallUntil) continue;
          a.remaining = 0;
          a.doneAt = t;
          done += 1;
          cc.active.splice(k, 1);
          events.push({ t: t, kind: 'done', res: a.i, conn: cc.id });
          if (a.i === 0 && !released) { released = true; releaseQueue(t); }
        }
      }

      /* 2. Hand queued requests to any connection with a free slot. */
      for (ci = 0; ci < conns.length; ci++) {
        var c1 = conns[ci];
        if (t < c1.readyAt) continue;
        while (c1.active.length < slots && queue.length) {
          var r1 = res[queue.shift()];
          r1.conn = c1.id;
          r1.requestedAt = t;
          r1.firstByteAt = t + rtt + think;
          c1.active.push(r1);
          c1.took.push(r1.i);
        }
      }

      /* 3. Open more connections only for work nothing else will pick up. */
      if (proto === 'h1' && queue.length && conns.length < maxConns) {
        var idle = 0;
        for (ci = 0; ci < conns.length; ci++) idle += slots - conns[ci].active.length;
        var need = queue.length - idle;
        while (need > 0 && conns.length < maxConns) { openConn(t); need -= slots; }
      }

      /* 4. Who can actually receive on this tick. */
      var live = [];
      for (ci = 0; ci < conns.length; ci++) {
        var c2 = conns[ci];
        if (t >= c2.readyAt && t >= c2.stallUntil && t >= c2.nextGrow) {
          c2.cwnd = c2.cwnd < c2.ssthresh ? c2.cwnd * 2 : c2.cwnd + 1;
          c2.nextGrow = t + rtt;
        }
        if (t < c2.stallUntil) {
          c2.stallMs += DT;
          /* Charge the stall to every stream it actually stops, which is the
             only number that compares fairly across the three: one connection
             frozen for 80 ms with sixteen streams on it has cost sixteen
             stream-times as much as one QUIC stream frozen for 80 ms. */
          for (k = 0; k < c2.active.length; k++) {
            var held = c2.active[k];
            if (held.remaining > 0.5 && t >= held.firstByteAt) held.stallMs += DT;
          }
          c2.recv = null;
          continue;
        }
        var recv = [];
        for (k = 0; k < c2.active.length; k++) {
          var a2 = c2.active[k];
          if (a2.remaining <= 0.5) continue;
          if (t < a2.firstByteAt) continue;
          if (t < a2.stallUntil) { a2.stallMs += DT; continue; }
          recv.push(a2);
        }
        c2.recv = recv;
        if (recv.length) live.push(c2);
      }

      if (!live.length) { t += DT; continue; }

      /* 5. Share the link between connections, then each connection between
            its own streams. Six HTTP/1.1 connections get six shares and six
            congestion windows — which is the whole reason sharding ever
            looked like a good idea. */
      var share = linkBps / live.length;
      for (var li = 0; li < live.length; li++) {
        var c3 = live[li];
        var rate = Math.min(c3.cwnd * MSS / rtt, share);
        var wsum = 0;
        for (k = 0; k < c3.recv.length; k++) wsum += priorities ? weightFor(c3.recv[k].kind) : 1;
        for (k = 0; k < c3.recv.length; k++) {
          var r3 = c3.recv[k];
          var w = priorities ? weightFor(r3.kind) : 1;
          var got = rate * (w / wsum) * DT;
          if (got > r3.remaining) got = r3.remaining;
          r3.remaining -= got;
          c3.bytes += got;
          r3.pktAcc += got / MSS;
          while (r3.pktAcc >= 1) {
            r3.pktAcc -= 1;
            if (loss > 0 && rng() < loss) applyLoss(c3, r3, t);
          }
        }
      }
      t += DT;
    }

    var finished = done === res.length;
    var totalMs = 0, cssMs = 0, cssOk = true, connStall = 0, losses = 0;
    for (i = 0; i < res.length; i++) {
      if (res[i].doneAt > totalMs) totalMs = res[i].doneAt;
      if (res[i].kind === 'doc' || res[i].kind === 'css') {
        if (res[i].doneAt < 0) cssOk = false;
        else if (res[i].doneAt > cssMs) cssMs = res[i].doneAt;
      }
    }
    for (ci = 0; ci < conns.length; ci++) connStall += conns[ci].stallMs;
    for (i = 0; i < events.length; i++) if (events[i].kind === 'loss') losses += 1;
    var streamStall = 0;
    for (i = 0; i < res.length; i++) streamStall += res[i].stallMs;

    return {
      proto: proto, label: PROTO_LABEL[proto], resources: res, conns: conns,
      events: events, finished: finished, ranFor: t,
      totalMs: finished ? totalMs : null,
      cssMs: cssOk ? cssMs : null,
      setupMs: rtts * rtt, setupRtts: rtts, connCount: conns.length,
      maxConns: maxConns, totalBytes: totalBytes,
      packets: Math.round(totalBytes / MSS), losses: losses,
      connStallMs: connStall, streamStallMs: streamStall,
      rtt: rtt, bw: o.bw, loss: o.loss, shards: shards, cap: CAP
    };
  }

  /* How many resources have arrived by a given moment, and whether anything is
     frozen right now. Both are read straight off the recorded run, so the note
     under the picture never disagrees with the picture. */
  function doneBy(sim, t) {
    var n = 0;
    for (var i = 0; i < sim.resources.length; i++) {
      if (sim.resources[i].doneAt >= 0 && sim.resources[i].doneAt <= t) n += 1;
    }
    return n;
  }

  function stallAt(sim, t) {
    var conn = 0, stream = 0;
    for (var i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.kind !== 'loss' || e.t > t || e.until <= t) continue;
      if (e.scope === 'conn') conn += 1; else stream += 1;
    }
    return { conn: conn, stream: stream };
  }

  /* The one number every "time blocked" column must use, in one place because
     four separate tables were each choosing for themselves and all four chose
     wrong the same way: connStallMs for HTTP/1.1 and HTTP/2, streamStallMs for
     HTTP/3.

     Those are different units. connStallMs is wall time a connection spent
     frozen. streamStallMs is that time multiplied by the streams it actually
     stopped, which is the count the stall accounting in simulate() calls "the
     only number that compares fairly across the three". HTTP/3 has no
     connection-level stall to report, so it was forced onto stream time while
     HTTP/2 — one frozen connection holding up twenty streams — reported the
     wall time of that single connection and came out looking cheaper.

     On the default page at 1% loss the mixture printed HTTP/2 1748 ms against
     HTTP/3 1748 ms: a dead heat, in the tables built to show head-of-line
     blocking. In stream time the same run is 29,640 against 1,748, or 1,289 ms
     blocked per lost packet against 76 ms — 76 being exactly one round trip on
     exactly one stream, which is the whole point of QUIC. */
  function blockedMs(sim) { return sim.streamStallMs; }

  /* ======================================================================== */
  /*  CORE 2 — HPACK (RFC 7541)                                               */
  /* ------------------------------------------------------------------------ */
  /*  Only the parts of the static table these requests actually reach. The    */
  /*  indices are the real ones from RFC 7541 Appendix A, because a made-up    */
  /*  index would make every byte count downstream of it a fiction.            */
  /* ======================================================================== */

  var STATIC_PAIR = {};
  var STATIC_NAME = {};
  (function () {
    var pairs = [
      [2, ':method', 'GET'], [3, ':method', 'POST'], [4, ':path', '/'],
      [5, ':path', '/index.html'], [6, ':scheme', 'http'], [7, ':scheme', 'https'],
      [16, 'accept-encoding', 'gzip, deflate']
    ];
    var names = [
      [1, ':authority'], [2, ':method'], [4, ':path'], [6, ':scheme'],
      [15, 'accept-charset'], [16, 'accept-encoding'], [17, 'accept-language'],
      [19, 'accept'], [24, 'cache-control'], [28, 'content-length'],
      [31, 'content-type'], [32, 'cookie'], [33, 'date'], [38, 'host'],
      [51, 'referer'], [58, 'user-agent']
    ];
    var i;
    for (i = 0; i < pairs.length; i++) STATIC_PAIR[pairs[i][1] + '\u0000' + pairs[i][2]] = pairs[i][0];
    for (i = 0; i < names.length; i++) STATIC_NAME[names[i][1]] = names[i][0];
  })();

  /* RFC 7541 section 5.1. A value below the prefix maximum is one byte; above
     it, the remainder goes out seven bits at a time with a continuation bit. */
  function hpackIntLen(value, prefixBits) {
    var max = (1 << prefixBits) - 1;
    if (value < max) return 1;
    var n = 1;
    var rest = value - max;
    while (rest >= 128) { n += 1; rest = Math.floor(rest / 128); }
    return n + 1;
  }

  function Hpack(limit) {
    this.limit = limit == null ? 4096 : limit;
    this.dyn = [];      // newest first, which is how the index runs
    this.size = 0;
    this.evicted = 0;
  }
  Hpack.prototype.findPair = function (n, v) {
    var s = STATIC_PAIR[n + '\u0000' + v];
    if (s) return s;
    for (var i = 0; i < this.dyn.length; i++) {
      if (this.dyn[i].n === n && this.dyn[i].v === v) return 62 + i;
    }
    return 0;
  };
  Hpack.prototype.findName = function (n) {
    var s = STATIC_NAME[n];
    if (s) return s;
    for (var i = 0; i < this.dyn.length; i++) if (this.dyn[i].n === n) return 62 + i;
    return 0;
  };
  Hpack.prototype.add = function (n, v) {
    var sz = n.length + v.length + 32;    // RFC 7541 section 4.1
    if (sz > this.limit) { this.size = 0; this.dyn = []; return; }
    this.dyn.unshift({ n: n, v: v, size: sz });
    this.size += sz;
    while (this.size > this.limit && this.dyn.length) {
      var ev = this.dyn.pop();
      this.size -= ev.size;
      this.evicted += 1;
    }
  };
  Hpack.prototype.encode = function (n, v) {
    var idx = this.findPair(n, v);
    if (idx) return { bytes: hpackIntLen(idx, 7), how: 'indexed', ref: idx, added: false };
    /* :path changes on every single request. Indexing it would churn the
       dynamic table and evict the entries that are actually paying for
       themselves, so it goes out as a literal that is not added. Real
       encoders make the same call for high-cardinality fields. */
    var never = (n === ':path');
    var nameIdx = this.findName(n);
    if (nameIdx) {
      var b = hpackIntLen(nameIdx, never ? 4 : 6) + hpackIntLen(v.length, 7) + v.length;
      if (!never) this.add(n, v);
      return {
        bytes: b, ref: nameIdx, added: !never,
        how: never ? 'literal, name from table, not indexed' : 'literal, name from table, indexed'
      };
    }
    var b2 = 1 + hpackIntLen(n.length, 7) + n.length + hpackIntLen(v.length, 7) + v.length;
    this.add(n, v);
    return { bytes: b2, ref: 0, how: 'literal, new name, indexed', added: true };
  };

  var UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
           'Chrome/126.0.0.0 Safari/537.36';

  function headersFor(r, host) {
    var dir = r.kind === 'doc' ? '' : (r.kind === 'img' ? 'img/' : 'assets/');
    var accept = r.kind === 'css' ? 'text/css,*/*;q=0.1'
      : r.kind === 'js' ? '*/*'
      : r.kind === 'img' ? 'image/avif,image/webp,image/apng,*/*;q=0.8'
      : r.kind === 'font' ? '*/*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    var dest = r.kind === 'css' ? 'style' : r.kind === 'js' ? 'script'
      : r.kind === 'img' ? 'image' : r.kind === 'font' ? 'font' : 'document';
    return [
      { n: ':method', v: 'GET' },
      { n: ':scheme', v: 'https' },
      { n: ':authority', v: host },
      { n: ':path', v: '/' + dir + r.name },
      { n: 'user-agent', v: UA },
      { n: 'accept', v: accept },
      { n: 'accept-encoding', v: 'gzip, deflate, br, zstd' },
      { n: 'accept-language', v: 'en-GB,en;q=0.9' },
      { n: 'referer', v: 'https://' + host + '/' },
      { n: 'cookie', v: 'sid=7f3a9c1e40b2d5; theme=dark; consent=1' },
      { n: 'sec-fetch-dest', v: dest },
      { n: 'sec-fetch-mode', v: 'no-cors' },
      { n: 'sec-fetch-site', v: 'same-origin' }
    ];
  }

  /* The HTTP/1.1 wire form of the same request, for an honest comparison:
     request line, Host, one CRLF-terminated field per header, blank line. */
  function h1HeaderBytes(list) {
    var method = '', path = '', host = '';
    var total = 0, i;
    for (i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.n === ':method') method = h.v;
      else if (h.n === ':path') path = h.v;
      else if (h.n === ':authority') host = h.v;
      else if (h.n !== ':scheme') total += h.n.length + 2 + h.v.length + 2;
    }
    total += method.length + 1 + path.length + 1 + 8 + 2;   // "GET /x HTTP/1.1\r\n"
    total += 4 + 2 + host.length + 2;                       // "Host: example.com\r\n"
    total += 2;                                             // the blank line
    return total;
  }

  function hpackRun(resources, host, limit) {
    var tab = new Hpack(limit);
    var out = [];
    var cumH1 = 0, cumH2 = 0;
    for (var i = 0; i < resources.length; i++) {
      var list = headersFor(resources[i], host);
      var rows = [];
      var bytes = 0;
      for (var k = 0; k < list.length; k++) {
        var enc = tab.encode(list[k].n, list[k].v);
        bytes += enc.bytes;
        rows.push({ n: list[k].n, v: list[k].v, bytes: enc.bytes, how: enc.how, ref: enc.ref });
      }
      var plain = h1HeaderBytes(list);
      cumH1 += plain;
      cumH2 += bytes;
      out.push({
        i: i, name: resources[i].name, rows: rows, hpack: bytes, plain: plain,
        cumH1: cumH1, cumH2: cumH2,
        table: tab.dyn.slice(0), tableSize: tab.size, limit: tab.limit, evicted: tab.evicted
      });
    }
    return out;
  }

  /* ======================================================================== */
  /*  CORE 3 — HANDSHAKE LADDERS AND CONNECTION MIGRATION                     */
  /* ======================================================================== */

  var SETUP_MODES = [
    { key: 'tls12', label: 'TCP + TLS 1.2', rtts: 3.5 },
    { key: 'tls13', label: 'TCP + TLS 1.3', rtts: 2.5 },
    { key: 'quic', label: 'QUIC, 1-RTT', rtts: 1.5 },
    { key: 'quic0', label: 'QUIC, 0-RTT resumption', rtts: 0.5 }
  ];

  function setupLadder(mode, rtt) {
    function s(at, dir, title, detail) {
      return { at: at * rtt, dir: dir, title: title, detail: detail };
    }
    if (mode === 'tls12') {
      return [
        s(0, 'c2s', 'SYN', 'TCP opens. Nothing about the request has been sent yet, and nothing is encrypted.'),
        s(0.5, 's2c', 'SYN-ACK', 'The server agrees on sequence numbers. Half a round trip gone.'),
        s(1, 'c2s', 'ACK + ClientHello', 'The TCP handshake completes and TLS starts in the same flight: cipher suites, the client random, the SNI host name in clear text.'),
        s(1.5, 's2c', 'ServerHello, Certificate, ServerHelloDone', 'The certificate chain arrives. This is usually the largest flight of the handshake.'),
        s(2, 'c2s', 'ClientKeyExchange, ChangeCipherSpec, Finished', 'The client sends its key share and switches to encrypted records.'),
        s(2.5, 's2c', 'ChangeCipherSpec, Finished', 'The server switches too. TLS 1.2 needs two full round trips of its own on top of TCP.'),
        s(3, 'c2s', 'GET /', 'Only now can the first HTTP request leave.'),
        s(3.5, 's2c', 'First response byte', 'Three and a half round trips before a single byte of the page arrives.')
      ];
    }
    if (mode === 'tls13') {
      return [
        s(0, 'c2s', 'SYN', 'TCP opens. TLS 1.3 cannot start until this completes, because TLS runs on top of TCP.'),
        s(0.5, 's2c', 'SYN-ACK', 'The server agrees on sequence numbers.'),
        s(1, 'c2s', 'ACK + ClientHello + key_share', 'TLS 1.3 guesses the group and sends a key share immediately, which is what saves it a round trip over TLS 1.2.'),
        s(1.5, 's2c', 'ServerHello, EncryptedExtensions, Certificate, Finished', 'Everything after ServerHello is already encrypted. The server can send application data now.'),
        s(2, 'c2s', 'Finished + GET /', 'The client Finished and the first request travel together.'),
        s(2.5, 's2c', 'First response byte', 'Two and a half round trips. This is what HTTP/2 pays on a cold connection.')
      ];
    }
    if (mode === 'quic') {
      return [
        s(0, 'c2s', 'Initial: ClientHello + transport parameters', 'QUIC has no separate TCP handshake to wait for. The transport parameters and the TLS ClientHello are in the same first flight.'),
        s(0.5, 's2c', 'Initial + Handshake: ServerHello, Certificate, Finished', 'One flight back, and the keys are established. There was never a SYN to spend a round trip on.'),
        s(1, 'c2s', 'Handshake Finished + GET / on stream 0', 'The first request goes out in a 1-RTT packet.'),
        s(1.5, 's2c', 'First response byte', 'One and a half round trips: a full round trip saved against TCP + TLS 1.3, because the transport and the crypto handshake are the same handshake.')
      ];
    }
    return [
      s(0, 'c2s', 'Initial with PSK + 0-RTT: GET /', 'The client has talked to this server before and kept a resumption ticket. The request rides out in the very first packet, encrypted with a key derived from the earlier session.'),
      s(0.5, 's2c', 'Handshake + first response byte', 'Half a round trip to the first byte. The catch: 0-RTT data has no forward secrecy and can be replayed by anyone who captured it, so it is only safe for requests that do not change anything.'),
      s(1, 'c2s', 'Finished', 'The handshake completes behind the data that has already flowed. Everything after this point is 1-RTT protected as normal.')
    ];
  }

  function migrationWalk(rtt) {
    function ms(n) { return Math.round(n * rtt); }
    return [
      { side: 'both', title: 'Downloading on Wi-Fi', detail: 'A page is half loaded over the home Wi-Fi. Both protocols are happy: TCP has a connection identified by the four-tuple of source IP, source port, destination IP and destination port, and QUIC has a connection identified by a connection ID that both ends chose.' },
      { side: 'both', title: 'You walk out of the door', detail: 'The phone drops Wi-Fi and switches to the cellular network. The source IP address changes. Nothing about the server changed, and nothing about what you asked for changed.' },
      { side: 'tcp', title: 'TCP: the four-tuple no longer exists', detail: 'The connection was defined by that source IP. With a new one, the packets arriving at the server do not belong to any connection it knows, and the ones the server sends go to an address you no longer hold. The connection is not migrated, it is dead.' },
      { side: 'tcp', title: 'TCP: everything starts over', detail: 'New SYN, new TLS handshake, ' + ms(2) + ' ms of round trips before a byte can move again, and every request that was in flight has to be reissued. Anything partially downloaded is downloaded again unless range requests save it.' },
      { side: 'quic', title: 'QUIC: the connection ID does not depend on your address', detail: 'The client keeps sending on the same connection ID from its new address. The server looks up the connection by ID, not by address, and finds it immediately, with all its keys and stream state intact.' },
      { side: 'quic', title: 'QUIC: path validation, and that is all', detail: 'The server sends a PATH_CHALLENGE to the new address and the client echoes it back in a PATH_RESPONSE — one round trip, ' + ms(1) + ' ms, to prove that the address is really yours and that nobody is using your connection to flood a stranger. The congestion controller resets, because this is a different path with different capacity. The transfer continues.' },
      { side: 'both', title: 'What it costs, honestly', detail: 'QUIC pays one round trip and a congestion-window reset. TCP pays a full reconnect plus a fresh TLS handshake plus lost work. Migration is real and it works, but it is not free, and it only helps if the client actually implements it — several do not migrate at all and simply open a new connection.' }
    ];
  }

  var CORE = {
    simulate: simulate, buildResources: buildResources, setupRtts: setupRtts,
    hpackIntLen: hpackIntLen, Hpack: Hpack, hpackRun: hpackRun,
    headersFor: headersFor, h1HeaderBytes: h1HeaderBytes,
    setupLadder: setupLadder, migrationWalk: migrationWalk,
    doneBy: doneBy, stallAt: stallAt, CATALOGUE: CATALOGUE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;
  if (!root.LabVizMulti) return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  var E = MV.el, clear = MV.clear, table = MV.table, button = MV.button;
  var group = MV.group, numBox = MV.numBox, field = MV.field, selectBox = MV.selectBox;
  var CC = MV.C, FONT = MV.FONT;

  var KIND_COLOUR = {
    doc: '#f472b6', css: '#38bdf8', font: '#a78bfa', js: '#fbbf24', img: '#34d399'
  };
  var PROTO_COLOUR = { h1: '#fbbf24', h2: '#38bdf8', h3: '#34d399' };
  var BW_STEPS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 75, 100, 150, 200];

  var EXTRA_CSS = [
    '.hv-canvas{display:block;width:100%;height:520px;border:1px solid ' + CC.line + ';border-radius:10px;background:' + CC.bg0 + ';}',
    '.hv-field{margin:0 0 12px;}',
    '.hv-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}',
    '.hv-field-val{font-size:12px;font-weight:700;color:' + CC.cyan + ';white-space:nowrap;}',
    '.hv-range{width:100%;margin:4px 0 0;accent-color:' + CC.blue + ';}',
    /* The shell paints a focus ring on its fields but not on its buttons, and
       this lab leans on buttons for the loss presets. A control a keyboard
       visitor cannot see themselves land on is a control they do not have. */
    '.hv-range:focus-visible,.oa-btn:focus-visible,.oa-tab:focus-visible{outline:2px solid ' +
      CC.blue + ';outline-offset:2px;}',
    '.hv-verdict{display:flex;flex-wrap:wrap;gap:7px;align-items:center;}',
    '.hv-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid transparent;white-space:nowrap;}',
    '.hv-pill-h1{color:' + PROTO_COLOUR.h1 + ';border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.09);}',
    '.hv-pill-h2{color:' + PROTO_COLOUR.h2 + ';border-color:rgba(56,189,248,.45);background:rgba(56,189,248,.09);}',
    '.hv-pill-h3{color:' + PROTO_COLOUR.h3 + ';border-color:rgba(52,211,153,.45);background:rgba(52,211,153,.09);}',
    '.hv-pill-stall{color:' + CC.red + ';border-color:rgba(252,165,165,.5);background:rgba(252,165,165,.1);}',
    '.hv-clock{font-size:12px;color:' + CC.dim + ';white-space:nowrap;}',
    '.hv-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:' + CC.faint + ';margin:2px 0 0;}',
    '.hv-key{display:inline-flex;align-items:center;gap:5px;}',
    '.hv-sw{width:10px;height:10px;border-radius:2px;flex:0 0 auto;}',
    '.hv-ladder{margin:0;padding:0;list-style:none;}',
    '.hv-step{display:grid;grid-template-columns:5.2rem minmax(0,1fr);gap:10px;padding:7px 9px;border-left:2px solid #24344f;margin:0 0 3px;}',
    '.hv-step.now{border-left-color:' + CC.amber + ';background:rgba(251,191,36,.07);}',
    '.hv-step.future{opacity:.28;}',
    '.hv-step-t{font-size:11px;color:' + CC.faint + ';text-align:right;font-variant-numeric:tabular-nums;}',
    '.hv-step-title{margin:0;font-size:12.5px;font-weight:700;color:' + CC.ink + ';}',
    '.hv-step-detail{margin:3px 0 0;font-size:12px;line-height:1.6;color:#cbd5e1;}',
    '.hv-step-dir{display:inline-block;margin:0 0 2px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.hv-step.c2s .hv-step-dir{color:' + CC.blue + ';}',
    '.hv-step.s2c .hv-step-dir{color:' + CC.green + ';}',
    '.hv-step.tcp{border-left-color:rgba(251,191,36,.6);}',
    '.hv-step.quic{border-left-color:rgba(52,211,153,.6);}',
    '.hv-panehead{margin:10px 0 5px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.hv-hdrname{color:' + CC.cyan + ';}',
    '.hv-hdrval{color:' + CC.dim + ';}',
    '.hv-how{font-size:11px;color:' + CC.faint + ';}',
    '.hv-how-idx{color:' + CC.green + ';}',
    '.hv-bar{position:relative;height:10px;border-radius:3px;background:#131f36;overflow:hidden;min-width:5rem;}',
    '.hv-bar span{position:absolute;left:0;top:0;bottom:0;border-radius:3px;}',
    '.hv-empty{padding:10px 12px;font-size:12px;line-height:1.6;color:' + CC.faint + ';border:1px dashed ' + CC.line + ';border-radius:9px;}'
  ].join('');

  var rangeSeq = 0;

  /* A labelled range with a live readout. The label carries an explicit `for`
     rather than wrapping the input, so the readout beside it does not end up
     inside the accessible name a screen reader announces. */
  function rangeField(labelText, value, min, max, step, fmt, onChange) {
    rangeSeq += 1;
    var id = 'hv-range-' + rangeSeq;
    var wrap = E('div', 'hv-field');
    var head = E('div', 'hv-field-head');
    var lab = E('label', 'oa-field-label', labelText);
    lab.setAttribute('for', id);
    var out = E('span', 'hv-field-val', fmt(value));
    head.appendChild(lab);
    head.appendChild(out);
    var input = E('input', 'hv-range');
    input.type = 'range';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      out.textContent = fmt(v);
      onChange(v);
    });
    wrap.appendChild(head);
    wrap.appendChild(input);
    return wrap;
  }

  function fmtMs(v) {
    if (v == null) return '—';
    if (v < 1000) return Math.round(v) + ' ms';
    return (v / 1000).toFixed(2) + ' s';
  }
  function fmtKb(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1048576).toFixed(2) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }
  function trunc(s, n) { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

  function fitCanvas(canvas, cssHeight) {
    if (cssHeight) canvas.style.height = Math.round(cssHeight) + 'px';
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (!w || !h) return null;
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var g = canvas.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = CC.bg0;
    g.fillRect(0, 0, w, h);
    return { g: g, w: w, h: h };
  }

  function legendRow(items) {
    var wrap = E('div', 'hv-legend');
    for (var i = 0; i < items.length; i++) {
      var key = E('span', 'hv-key');
      var sw = E('span', 'hv-sw');
      sw.style.background = items[i][1];
      key.appendChild(sw);
      key.appendChild(E('span', null, items[i][0]));
      wrap.appendChild(key);
    }
    return wrap;
  }

  var KIND_LEGEND = [
    ['document', KIND_COLOUR.doc], ['stylesheet', KIND_COLOUR.css],
    ['font', KIND_COLOUR.font], ['script', KIND_COLOUR.js], ['image', KIND_COLOUR.img],
    ['waiting for the first byte', 'rgba(56,189,248,0.30)'],
    ['queued, nothing sent yet', 'rgba(148,163,184,0.35)'],
    ['blocked by a retransmit', 'rgba(252,165,165,0.35)']
  ];

  /* ------------------------------------------------------------------------ */
  /*  The waterfall. One row per resource, x is simulated time, and nothing     */
  /*  past the playhead is drawn — the whole point is watching three runs fill  */
  /*  in at different speeds, and painting the finished picture would give the  */
  /*  ending away on the very first frame.                                      */
  /* ------------------------------------------------------------------------ */

  function drawWaterfall(g, sim, box, opt) {
    var tMax = opt.tMax, pt = opt.pt, rowH = opt.rowH, gutter = opt.gutter;
    var res = sim.resources;
    var plotX = box.x + gutter;
    var plotW = Math.max(24, box.w - gutter - 6);
    function X(ms) { return plotX + (Math.max(0, Math.min(tMax, ms)) / tMax) * plotW; }
    var top = box.y + 16;
    var i, k;

    // the handshake this protocol has to pay before anything can be requested
    if (sim.setupMs > 0) {
      g.fillStyle = 'rgba(251,191,36,0.12)';
      g.fillRect(plotX, top, Math.max(1, X(Math.min(sim.setupMs, pt)) - plotX), res.length * rowH);
    }

    // loss bands, drawn across exactly the rows each stall really blocks
    for (i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.kind !== 'loss' || e.t > pt) continue;
      var x0 = X(e.t);
      var x1 = X(Math.min(e.until, pt));
      if (x1 - x0 < 1.5) x1 = x0 + 1.5;
      g.fillStyle = 'rgba(252,165,165,0.22)';
      if (e.scope === 'stream') {
        g.fillRect(x0, top + e.res * rowH, x1 - x0, rowH - 1);
      } else {
        for (k = 0; k < res.length; k++) {
          if (res[k].conn !== e.conn) continue;
          if (res[k].requestedAt < 0 || res[k].requestedAt > e.until) continue;
          if (res[k].doneAt >= 0 && res[k].doneAt < e.t) continue;
          g.fillRect(x0, top + k * rowH, x1 - x0, rowH - 1);
        }
      }
    }

    var barH = Math.max(3, rowH - 3);
    g.textBaseline = 'alphabetic';
    for (i = 0; i < res.length; i++) {
      var r = res[i];
      var y = top + i * rowH;

      if (opt.showNames) {
        g.font = (rowH < 9 ? '8px ' : '9px ') + FONT;
        g.textAlign = 'left';
        g.fillStyle = r.doneAt >= 0 && r.doneAt <= pt ? CC.dim : CC.faint;
        g.fillText(trunc(r.name, gutter < 80 ? 9 : 15), box.x, y + barH);
      }

      // queued: eligible, but no connection was free to carry it
      if (r.requestedAt >= 0 && r.requestedAt > r.eligibleAt) {
        var qa = X(r.eligibleAt), qb = X(Math.min(r.requestedAt, pt));
        if (qb > qa) {
          g.fillStyle = 'rgba(148,163,184,0.35)';
          g.fillRect(qa, y + barH / 2 - 0.5, qb - qa, 1.5);
        }
      }
      // request sent, waiting on the server and the round trip
      if (r.requestedAt >= 0 && pt > r.requestedAt) {
        var wa = X(r.requestedAt), wb = X(Math.min(r.firstByteAt, pt));
        if (wb > wa) {
          g.fillStyle = 'rgba(56,189,248,0.30)';
          g.fillRect(wa, y, wb - wa, barH);
        }
      }
      // body arriving
      if (r.firstByteAt >= 0 && pt > r.firstByteAt) {
        var end = r.doneAt >= 0 ? Math.min(r.doneAt, pt) : pt;
        var da = X(r.firstByteAt), db = X(end);
        if (db > da) {
          g.fillStyle = KIND_COLOUR[r.kind] || '#94a3b8';
          g.fillRect(da, y, db - da, barH);
        }
      }
      // a small cap on the end of a finished transfer
      if (r.doneAt >= 0 && r.doneAt <= pt) {
        g.fillStyle = '#e2e8f0';
        g.fillRect(X(r.doneAt) - 1, y, 1.5, barH);
      }
    }
    return { plotX: plotX, plotW: plotW, bottom: top + res.length * rowH };
  }

  function drawHead(g, box, sim, pt, gutter) {
    var stall = stallAt(sim, pt);
    var done = doneBy(sim, pt);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.font = '700 11.5px ' + FONT;
    g.fillStyle = PROTO_COLOUR[sim.proto];
    g.fillText(sim.label, box.x, box.y + 10);
    g.font = '10px ' + FONT;
    g.fillStyle = CC.faint;
    var line = done + ' of ' + sim.resources.length + ' done';
    if (sim.finished && pt >= sim.totalMs) line += ' · finished in ' + fmtMs(sim.totalMs);
    g.fillText(line, box.x + gutter + 4, box.y + 10);
    if (stall.conn) {
      g.fillStyle = CC.red;
      g.textAlign = 'right';
      g.fillText('every stream blocked by a retransmit', box.x + box.w, box.y + 10);
      g.textAlign = 'left';
    } else if (stall.stream) {
      g.fillStyle = CC.amber;
      g.textAlign = 'right';
      g.fillText(stall.stream + (stall.stream === 1 ? ' stream' : ' streams') + ' waiting on a retransmit',
        box.x + box.w, box.y + 10);
      g.textAlign = 'left';
    }
  }

  function drawAxis(g, plotX, plotW, tMax, w, h, pt) {
    var i;
    g.font = '10px ' + FONT;
    g.textBaseline = 'alphabetic';
    for (i = 0; i <= 6; i++) {
      var x = plotX + (i / 6) * plotW;
      g.strokeStyle = 'rgba(125,211,252,0.07)';
      g.beginPath();
      g.moveTo(x, 4);
      g.lineTo(x, h - 18);
      g.stroke();
      g.fillStyle = CC.faint;
      g.textAlign = i === 0 ? 'left' : (i === 6 ? 'right' : 'center');
      g.fillText(fmtMs(tMax * i / 6), x, h - 5);
    }
    g.strokeStyle = 'rgba(226,232,240,0.75)';
    g.lineWidth = 1;
    var px = plotX + (Math.min(pt, tMax) / tMax) * plotW;
    g.beginPath();
    g.moveTo(px, 2);
    g.lineTo(px, h - 18);
    g.stroke();
  }

  function rowHeightFor(n) {
    if (n <= 8) return 15;
    if (n <= 12) return 12;
    if (n <= 18) return 10;
    return 8;
  }

  /* ======================================================================== */
  /*  FAMILY 1 — THE RACE                                                     */
  /* ======================================================================== */

  var FRAMES = 120;

  var LOSS_PRESETS = [
    { label: 'Perfect link', loss: 0 },
    { label: 'Home fibre', loss: 0.1 },
    { label: 'Office wi-fi', loss: 0.5 },
    { label: 'Train, 4G', loss: 2 },
    { label: 'Bad hotel', loss: 5 }
  ];

  function RaceFamily() {
    this.key = 'race';
    this.label = 'The race';
    this.algoKey = 'race';
    this.n = 16;
    this.rtt = 80;
    this.bwIdx = 5;          // 10 Mbps
    this.loss = 0;
    this.think = 20;
    this.lastIdx = 0;
  }
  RaceFamily.prototype.algoOptions = function () {
    return [{ key: 'race', label: 'All three, one link' }];
  };
  RaceFamily.prototype.bw = function () { return BW_STEPS[this.bwIdx]; };
  RaceFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.onChange = onChange;

    var g = group('The link');
    g.appendChild(rangeField('Round-trip time', this.rtt, 10, 400, 5,
      function (v) { return Math.round(v) + ' ms'; },
      function (v) { self.rtt = v; onChange(); }));
    g.appendChild(rangeField('Bandwidth', this.bwIdx, 0, BW_STEPS.length - 1, 1,
      function (v) { return BW_STEPS[v] + ' Mbps'; },
      function (v) { self.bwIdx = v; onChange(); }));
    this.lossField = rangeField('Packet loss', this.loss, 0, 8, 0.1,
      function (v) { return v.toFixed(1) + '%'; },
      function (v) { self.loss = v; onChange(); });
    g.appendChild(this.lossField);
    g.appendChild(E('p', 'oa-hint',
      'Loss is the control worth playing with. At zero, HTTP/2 and HTTP/3 finish within a few ' +
      'milliseconds of each other. Push it up and HTTP/2 falls apart while HTTP/3 barely notices, ' +
      'because a lost TCP packet stops every HTTP/2 stream and a lost QUIC packet stops one.'));
    var row = E('div', 'oa-btnrow');
    LOSS_PRESETS.forEach(function (p) {
      row.appendChild(button(p.label, function () { self.setLoss(p.loss); }));
    });
    g.appendChild(row);
    host.appendChild(g);

    var g2 = group('The page');
    g2.appendChild(field('Resources', numBox(this.n, 4, 24, function (v) { self.n = v; onChange(); })));
    g2.appendChild(field('Server think time (ms)', numBox(this.think, 0, 500,
      function (v) { self.think = v; onChange(); })));
    g2.appendChild(E('p', 'oa-hint',
      'The document is fetched first and everything else is only discovered once it arrives, which ' +
      'is what really happens and is why the first round trips matter so much.'));
    host.appendChild(g2);
  };
  /* The preset buttons have to move the slider they are a shortcut for, or the
     readout and the thumb both end up lying about what is being simulated. */
  RaceFamily.prototype.setLoss = function (v) {
    this.loss = v;
    var input = this.lossField ? this.lossField.getElementsByTagName('input')[0] : null;
    var out = this.lossField ? this.lossField.getElementsByTagName('span')[0] : null;
    if (input) input.value = String(v);
    if (out) out.textContent = v.toFixed(1) + '%';
    if (this.onChange) this.onChange();
  };
  RaceFamily.prototype.buildStage = function (host) {
    var self = this;
    this.topHost = E('div', 'hv-verdict');
    this.canvas = E('canvas', 'hv-canvas');
    this.canvas.setAttribute('role', 'img');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.canvas);
    host.appendChild(legendRow(KIND_LEGEND));
    host.appendChild(this.tableHost);
    window.addEventListener('resize', function () { self.render(self.lastIdx); });
  };
  RaceFamily.prototype.compute = function () {
    var resources = buildResources(this.n);
    var rtt = this.rtt, bw = this.bw(), loss = this.loss, think = this.think;
    this.sims = ['h1', 'h2', 'h3'].map(function (p) {
      return simulate({ proto: p, resources: resources, rtt: rtt, bw: bw,
        loss: loss, think: think, seed: 20260831 });
    });
    var tMax = 0, unfinished = 0, i;
    for (i = 0; i < this.sims.length; i++) {
      var s = this.sims[i];
      if (!s.finished) { unfinished += 1; tMax = Math.max(tMax, s.ranFor); }
      else tMax = Math.max(tMax, s.totalMs);
    }
    this.tMax = Math.max(200, tMax * 1.02);
    this.error = unfinished
      ? (unfinished + ' of the three did not finish inside the ' + (CAP / 1000) +
         ' second limit, so their rows run off the end of the chart. Lower the loss, raise the ' +
         'bandwidth, or ask for fewer resources. It is a real outcome, not a fault.')
      : null;
    return FRAMES;
  };
  RaceFamily.prototype.frameTime = function (idx) {
    return (Math.max(0, Math.min(FRAMES - 1, idx)) / (FRAMES - 1)) * this.tMax;
  };
  RaceFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var sims = this.sims;
    if (!sims) return;
    var pt = this.frameTime(idx);

    clear(this.topHost);
    this.topHost.appendChild(E('span', 'hv-clock', 'clock: ' + fmtMs(pt)));
    this.topHost.appendChild(E('span', 'hv-clock',
      sims[0].resources.length + ' resources, ' + fmtKb(sims[0].totalBytes) +
      ', about ' + sims[0].packets + ' packets'));
    var bestMs = null, bestProto = null;
    sims.forEach(function (s) {
      if (s.finished && (bestMs === null || s.totalMs < bestMs)) {
        bestMs = s.totalMs; bestProto = s.proto;
      }
    });
    var top = this.topHost;
    sims.forEach(function (s) {
      var won = s.finished && s.proto === bestProto && pt >= s.totalMs;
      top.appendChild(E('span', 'hv-pill hv-pill-' + s.proto + (won ? ' hv-pill-win' : ''),
        s.label + ' · ' + doneBy(s, pt) + '/' + s.resources.length +
        (s.finished && pt >= s.totalMs ? ' · ' + fmtMs(s.totalMs) : '')));
    });
    if (stallAt(sims[1], pt).conn) {
      top.appendChild(E('span', 'hv-pill hv-pill-stall', 'HTTP/2 frozen'));
    }

    this.draw(pt);
    this.canvas.setAttribute('aria-label', this.summary(pt));

    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Protocol', 'Arrived by ' + fmtMs(pt), 'Everything done', 'Document and CSS in hand'],
      sims.map(function (s) {
        return {
          key: s.proto,
          cells: [s.label, doneBy(s, pt) + ' of ' + s.resources.length,
            s.finished ? fmtMs(s.totalMs) : 'did not finish',
            s.cssMs == null ? '—' : fmtMs(s.cssMs)]
        };
      })));
  };
  RaceFamily.prototype.summary = function (pt) {
    var bits = [];
    for (var i = 0; i < this.sims.length; i++) {
      bits.push(this.sims[i].label + ' ' + doneBy(this.sims[i], pt) + ' of ' +
        this.sims[i].resources.length);
    }
    return 'Three waterfalls at ' + fmtMs(pt) + ': ' + bits.join(', ') + '.';
  };
  RaceFamily.prototype.draw = function (pt) {
    var sims = this.sims;
    if (!sims) return;
    var n = sims[0].resources.length;
    var narrow = this.canvas.clientWidth > 0 && this.canvas.clientWidth < 560;
    var rowH = rowHeightFor(n) - (narrow ? 2 : 0);
    var gutter = narrow ? 62 : 104;
    var panelH = 16 + n * rowH + 12;
    var fit = fitCanvas(this.canvas, 3 * panelH + 26);
    if (!fit) return;
    var g = fit.g, w = fit.w, h = fit.h;
    var plotX = 4 + gutter;
    var plotW = Math.max(24, w - 8 - gutter - 6);
    drawAxis(g, plotX, plotW, this.tMax, w, h, pt);
    for (var i = 0; i < sims.length; i++) {
      var box = { x: 4, y: 8 + i * panelH, w: w - 8, h: panelH };
      if (i) {
        g.strokeStyle = 'rgba(28,43,68,0.9)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(4, box.y - 5);
        g.lineTo(w - 4, box.y - 5);
        g.stroke();
      }
      drawHead(g, box, sims[i], pt, gutter);
      drawWaterfall(g, sims[i], box, {
        tMax: this.tMax, pt: pt, rowH: rowH, gutter: gutter, showNames: true
      });
    }
  };
  RaceFamily.prototype.note = function (idx) {
    var sims = this.sims;
    if (!sims) return '';
    var pt = this.frameTime(idx);
    var bits = [];
    for (var i = 0; i < sims.length; i++) {
      var s = sims[i];
      var st = stallAt(s, pt);
      var piece = s.label + ' has ' + doneBy(s, pt) + ' of ' + s.resources.length;
      if (pt < s.setupMs) piece += ' and is still shaking hands';
      else if (st.conn) {
        piece += ' and is frozen: a lost packet is holding back every stream on its one connection';
      } else if (st.stream) {
        piece += ', with ' + st.stream + ' of its streams waiting on a retransmit and the rest ' +
          'still running';
      }
      bits.push(piece);
    }
    var out = 'At ' + fmtMs(pt) + ': ' + bits.join('; ') + '.';
    if (idx === 0) {
      out += ' Nothing has been requested yet. HTTP/1.1 and HTTP/2 owe two round trips of handshake ' +
        'before a request can leave; HTTP/3 owes one, because QUIC does the transport and the ' +
        'crypto handshake at the same time.';
    } else if (idx >= FRAMES - 1) {
      var order = sims.slice(0).sort(function (a, b) {
        if (!a.finished) return 1;
        if (!b.finished) return -1;
        return a.totalMs - b.totalMs;
      });
      if (order[0].finished) {
        out += ' ' + order[0].label + ' finished first, at ' + fmtMs(order[0].totalMs) + '.';
        if (this.loss < 0.05) {
          out += ' At zero loss the gaps are handshake round trips and queueing rather than the ' +
            'transport itself, which is exactly why the loss slider is the interesting experiment.';
        }
      }
    }
    return out;
  };
  RaceFamily.prototype.compare = function () {
    var sims = this.sims;
    if (!sims) return null;
    return {
      title: 'The same page, the same link, three protocols',
      head: ['Protocol', 'Connections', 'Handshake', 'Everything done (ms)',
        'Lost packets', 'Stream-time blocked (ms)'],
      best: 3,
      lower: true,
      rows: sims.map(function (s) {
        var blocked = blockedMs(s);
        return {
          key: s.proto,
          cells: [s.label, s.connCount, s.setupRtts + ' RTT (' + Math.round(s.setupMs) + ' ms)',
            s.finished ? Math.round(s.totalMs) : '—', s.losses, Math.round(blocked)]
        };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — HTTP/1.1                                                     */
  /* ------------------------------------------------------------------------ */
  /*  Drawn by connection rather than by resource, because the lane is the      */
  /*  unit that blocks. A gap in a lane is a request that could have been sent  */
  /*  and was not, and six lanes of gaps is the whole argument for HTTP/2.      */
  /* ======================================================================== */

  var H1_FRAMES = 90;

  function OneFamily() {
    this.key = 'h1';
    this.label = 'HTTP/1.1';
    this.algoKey = 'six';
    /* Deliberately not the race defaults. Sharding only ever helped when the
       connection count was the bottleneck rather than the bandwidth: plenty of
       link, a long round trip, and more resources than six connections can
       carry. On a slow link it does nothing at all, and starting the visitor
       somewhere it does nothing would teach the wrong lesson twice over. */
    this.n = 24;
    this.rtt = 150;
    this.bwIdx = 9;          // 50 Mbps
    this.loss = 0;
    this.shards = 2;
    this.lastIdx = 0;
  }
  OneFamily.prototype.algoOptions = function () {
    return [
      { key: 'six', label: 'Six connections per origin' },
      { key: 'shard', label: 'Domain sharding' }
    ];
  };
  OneFamily.prototype.bw = function () { return BW_STEPS[this.bwIdx]; };
  OneFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The link');
    g.appendChild(rangeField('Round-trip time', this.rtt, 10, 400, 5,
      function (v) { return Math.round(v) + ' ms'; },
      function (v) { self.rtt = v; onChange(); }));
    g.appendChild(rangeField('Bandwidth', this.bwIdx, 0, BW_STEPS.length - 1, 1,
      function (v) { return BW_STEPS[v] + ' Mbps'; },
      function (v) { self.bwIdx = v; onChange(); }));
    g.appendChild(rangeField('Packet loss', this.loss, 0, 8, 0.1,
      function (v) { return v.toFixed(1) + '%'; },
      function (v) { self.loss = v; onChange(); }));
    host.appendChild(g);

    var g2 = group('The page');
    g2.appendChild(field('Resources', numBox(this.n, 4, 24, function (v) { self.n = v; onChange(); })));
    g2.appendChild(field('Origins (sharding)', numBox(this.shards, 1, 4,
      function (v) { self.shards = v; onChange(); })));
    g2.appendChild(E('p', 'oa-hint',
      'Sharding means serving the same assets from img1.example.com, img2.example.com and so on, ' +
      'purely to get past the six-connections-per-origin limit. Each new host costs another DNS ' +
      'lookup, another TCP handshake and another TLS handshake, and the sharing setting only ' +
      'applies to the sharding view.'));
    host.appendChild(g2);
  };
  OneFamily.prototype.buildStage = function (host) {
    var self = this;
    this.topHost = E('div', 'hv-verdict');
    this.canvas = E('canvas', 'hv-canvas');
    this.canvas.setAttribute('role', 'img');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.canvas);
    host.appendChild(legendRow(KIND_LEGEND));
    host.appendChild(this.tableHost);
    window.addEventListener('resize', function () { self.render(self.lastIdx); });
  };
  OneFamily.prototype.compute = function () {
    var resources = buildResources(this.n);
    var rtt = this.rtt, bw = this.bw(), loss = this.loss;
    function run(shards, proto) {
      return simulate({ proto: proto || 'h1', resources: resources, rtt: rtt, bw: bw,
        loss: loss, think: 20, shards: shards, seed: 20260831 });
    }
    this.shardRuns = [run(1), run(2), run(3), run(4)];
    this.h2 = run(1, 'h2');
    this.sim = this.algoKey === 'shard' ? this.shardRuns[this.shards - 1] : this.shardRuns[0];
    var tMax = this.sim.finished ? this.sim.totalMs : this.sim.ranFor;
    this.tMax = Math.max(200, tMax * 1.02);
    this.error = this.sim.finished ? null
      : 'This run did not finish inside the ' + (CAP / 1000) + ' second limit. Lower the loss or ' +
        'raise the bandwidth.';
    return H1_FRAMES;
  };
  OneFamily.prototype.frameTime = function (idx) {
    return (Math.max(0, Math.min(H1_FRAMES - 1, idx)) / (H1_FRAMES - 1)) * this.tMax;
  };
  OneFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var sim = this.sim;
    if (!sim) return;
    var pt = this.frameTime(idx);

    clear(this.topHost);
    this.topHost.appendChild(E('span', 'hv-clock', 'clock: ' + fmtMs(pt)));
    this.topHost.appendChild(E('span', 'hv-pill hv-pill-h1',
      sim.connCount + ' connections · ' + doneBy(sim, pt) + '/' + sim.resources.length +
      (sim.finished && pt >= sim.totalMs ? ' · ' + fmtMs(sim.totalMs) : '')));
    var busy = 0;
    for (var c = 0; c < sim.conns.length; c++) {
      for (var k = 0; k < sim.resources.length; k++) {
        var r = sim.resources[k];
        if (r.conn === c && r.requestedAt >= 0 && r.requestedAt <= pt &&
            (r.doneAt < 0 || r.doneAt > pt)) { busy += 1; break; }
      }
    }
    this.topHost.appendChild(E('span', 'hv-clock',
      busy + ' of ' + sim.connCount + ' connections carrying a request'));

    this.drawLanes(pt);
    this.canvas.setAttribute('aria-label',
      'HTTP/1.1 connection lanes at ' + fmtMs(pt) + ': ' + doneBy(sim, pt) + ' of ' +
      sim.resources.length + ' resources delivered over ' + sim.connCount + ' connections.');

    clear(this.tableHost);
    var rows = [];
    for (c = 0; c < sim.conns.length; c++) {
      var conn = sim.conns[c];
      var names = [];
      for (k = 0; k < conn.took.length; k++) names.push(sim.resources[conn.took[k]].name);
      rows.push({
        key: 'c' + c,
        cells: ['connection ' + (c + 1), 'origin ' + conn.shard, conn.took.length,
          Math.round(conn.readyAt) + ' ms', trunc(names.join(', ') || 'nothing', 46)]
      });
    }
    this.tableHost.appendChild(table(
      ['Connection', 'Origin', 'Requests carried', 'Ready at', 'In this order'], rows));
  };
  OneFamily.prototype.drawLanes = function (pt) {
    var sim = this.sim;
    var lanes = sim.conns.length;
    var narrow = this.canvas.clientWidth > 0 && this.canvas.clientWidth < 560;
    var rowH = lanes <= 6 ? 26 : (lanes <= 12 ? 20 : 15);
    var gutter = narrow ? 56 : 96;
    var fit = fitCanvas(this.canvas, 34 + lanes * rowH + 26);
    if (!fit) return;
    var g = fit.g, w = fit.w, h = fit.h;
    var plotX = 4 + gutter;
    var plotW = Math.max(24, w - 8 - gutter - 6);
    var tMax = this.tMax;
    function X(ms) { return plotX + (Math.max(0, Math.min(tMax, ms)) / tMax) * plotW; }
    drawAxis(g, plotX, plotW, tMax, w, h, pt);

    var top = 22;
    g.textBaseline = 'alphabetic';
    g.font = '700 11px ' + FONT;
    g.textAlign = 'left';
    g.fillStyle = PROTO_COLOUR.h1;
    g.fillText('One lane per connection. A gap is a request waiting for the one in front of it.',
      4, 12);

    var i, k;
    for (i = 0; i < lanes; i++) {
      var y = top + i * rowH;
      var conn = sim.conns[i];
      g.font = '9px ' + FONT;
      g.textAlign = 'left';
      g.fillStyle = CC.faint;
      g.fillText((narrow ? 'c' : 'conn ') + (i + 1) +
        (sim.shards > 1 ? ' · o' + conn.shard : ''), 4, y + rowH - 8);

      g.fillStyle = 'rgba(15,23,42,0.75)';
      g.fillRect(plotX, y, plotW, rowH - 5);

      // the handshake this connection had to pay before it could carry anything
      var ha = X(conn.openAt), hb = X(Math.min(conn.readyAt, pt));
      if (hb > ha) {
        g.fillStyle = 'rgba(251,191,36,0.20)';
        g.fillRect(ha, y, hb - ha, rowH - 5);
      }

      for (k = 0; k < sim.resources.length; k++) {
        var r = sim.resources[k];
        if (r.conn !== i || r.requestedAt < 0 || r.requestedAt > pt) continue;
        var wa = X(r.requestedAt), wb = X(Math.min(r.firstByteAt, pt));
        if (wb > wa) {
          g.fillStyle = 'rgba(56,189,248,0.30)';
          g.fillRect(wa, y + 1, wb - wa, rowH - 7);
        }
        if (pt > r.firstByteAt) {
          var end = r.doneAt >= 0 ? Math.min(r.doneAt, pt) : pt;
          var da = X(r.firstByteAt), db = X(end);
          if (db > da) {
            g.fillStyle = KIND_COLOUR[r.kind] || '#94a3b8';
            g.fillRect(da, y + 1, db - da, rowH - 7);
            if (db - da > 46 && rowH >= 20) {
              g.font = '9px ' + FONT;
              g.fillStyle = '#06121f';
              g.textAlign = 'left';
              g.fillText(trunc(r.name, Math.floor((db - da) / 6)), da + 3, y + rowH / 2 + 1);
            }
          }
        }
      }

      for (k = 0; k < sim.events.length; k++) {
        var e = sim.events[k];
        if (e.kind !== 'loss' || e.conn !== i || e.t > pt) continue;
        var x0 = X(e.t), x1 = X(Math.min(e.until, pt));
        if (x1 - x0 < 1.5) x1 = x0 + 1.5;
        g.fillStyle = 'rgba(252,165,165,0.30)';
        g.fillRect(x0, y, x1 - x0, rowH - 5);
      }
    }
  };
  OneFamily.prototype.note = function (idx) {
    var sim = this.sim;
    if (!sim) return '';
    if (this.algoKey === 'shard') {
      var one = this.shardRuns[0], here = this.sim;
      var gain = (one.finished && here.finished)
        ? Math.round(one.totalMs - here.totalMs) : null;
      return 'Sharding across ' + sim.shards + (sim.shards === 1 ? ' origin' : ' origins') +
        ' gives the browser ' + sim.maxConns + ' parallel connections instead of six' +
        (gain === null ? '. ' : ', and here that is worth ' + gain + ' ms against a single origin. ') +
        'Each extra origin costs another DNS lookup and another TCP and TLS handshake, and every ' +
        'connection starts its congestion window from scratch, so the gain flattens fast. Then ' +
        'HTTP/2 arrived and sharding became actively harmful: it splits one multiplexed connection ' +
        'into several, throws away the shared HPACK table, and makes the browser compete with ' +
        'itself for the same bandwidth. On this same page HTTP/2 on one connection finishes in ' +
        (this.h2.finished ? fmtMs(this.h2.totalMs) : 'more time than the limit allows') + '.';
    }
    var pt = this.frameTime(idx);
    var st = stallAt(sim, pt);
    var waiting = 0;
    for (var i = 0; i < sim.resources.length; i++) {
      var r = sim.resources[i];
      if (r.requestedAt < 0 || r.requestedAt > pt) waiting += 1;
    }
    var out = 'At ' + fmtMs(pt) + ': ' + doneBy(sim, pt) + ' of ' + sim.resources.length +
      ' delivered, ' + waiting + ' not yet even requested.';
    if (waiting > 0 && pt > sim.setupMs) {
      out += ' Those are not slow, they are queued — HTTP/1.1 can have exactly one request in ' +
        'flight per connection, so the seventh resource waits for a lane to free up. That is ' +
        'head-of-line blocking at the protocol level, and it is what pipelining tried and failed ' +
        'to fix, because a proxy in the middle could reorder or mangle the responses.';
    }
    if (st.conn) {
      out += ' One connection is stalled on a retransmit right now; the other ' +
        (sim.connCount - 1) + ' carry on. Structurally that is HTTP/1.1 doing better under loss ' +
        'than HTTP/2, which is worth knowing before anyone tells you the newer protocol is ' +
        'always the faster one.';
    }
    return out;
  };
  OneFamily.prototype.compare = function () {
    var runs = this.shardRuns, h2 = this.h2;
    if (!runs) return null;
    var rows = runs.map(function (s, i) {
      return {
        key: 'shard' + (i + 1),
        cells: [(i + 1) + (i ? ' origins' : ' origin'), s.maxConns, s.connCount,
          Math.round((s.connCount * (s.setupRtts * s.rtt)) / 1000 * 100) / 100,
          s.finished ? Math.round(s.totalMs) : '—']
      };
    });
    rows.push({
      key: 'h2',
      cells: ['HTTP/2, one origin', 1, 1, Math.round(h2.setupMs / 1000 * 100) / 100,
        h2.finished ? Math.round(h2.totalMs) : '—']
    });
    return {
      title: 'What another origin buys, and what it costs',
      head: ['Setup', 'Connection limit', 'Connections opened', 'Handshake time spent (s)',
        'Everything done (ms)'],
      best: 4,
      lower: true,
      rows: rows
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — HTTP/2                                                       */
  /* ------------------------------------------------------------------------ */
  /*  Three views, because HTTP/2 is really three separate ideas: multiplexing  */
  /*  (what it fixed), HPACK (what it added), and TCP head-of-line blocking     */
  /*  (what it could not fix, and the whole reason HTTP/3 exists).              */
  /* ======================================================================== */

  var H2_FRAMES = 90;
  var TABLE_LIMITS = [
    { key: '0', label: 'no dynamic table' },
    { key: '512', label: '512 bytes' },
    { key: '4096', label: '4096 bytes (the default)' },
    { key: '16384', label: '16384 bytes' }
  ];

  function TwoFamily() {
    this.key = 'h2';
    this.label = 'HTTP/2';
    this.algoKey = 'mux';
    this.n = 16;
    this.rtt = 80;
    this.bwIdx = 5;
    this.loss = 1;
    this.priorities = true;
    this.limit = 4096;
    this.host = 'example.com';
    this.lastIdx = 0;
  }
  TwoFamily.prototype.algoOptions = function () {
    return [
      { key: 'mux', label: 'Multiplexed streams' },
      { key: 'hpack', label: 'HPACK header compression' },
      { key: 'hol', label: 'TCP head-of-line blocking' }
    ];
  };
  TwoFamily.prototype.bw = function () { return BW_STEPS[this.bwIdx]; };
  TwoFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The link');
    g.appendChild(rangeField('Round-trip time', this.rtt, 10, 400, 5,
      function (v) { return Math.round(v) + ' ms'; },
      function (v) { self.rtt = v; onChange(); }));
    g.appendChild(rangeField('Bandwidth', this.bwIdx, 0, BW_STEPS.length - 1, 1,
      function (v) { return BW_STEPS[v] + ' Mbps'; },
      function (v) { self.bwIdx = v; onChange(); }));
    g.appendChild(rangeField('Packet loss', this.loss, 0, 8, 0.1,
      function (v) { return v.toFixed(1) + '%'; },
      function (v) { self.loss = v; onChange(); }));
    host.appendChild(g);

    var g2 = group('The page');
    g2.appendChild(field('Resources', numBox(this.n, 4, 24, function (v) { self.n = v; onChange(); })));
    g2.appendChild(field('Stream priorities', selectBox(
      [{ key: 'on', label: 'browser weights' }, { key: 'off', label: 'plain round robin' }],
      'on', function (v) { self.priorities = v === 'on'; onChange(); })));
    g2.appendChild(E('p', 'oa-hint',
      'With plain round robin every stream gets an equal slice and everything finishes at roughly ' +
      'the same late moment, including the stylesheet the page cannot render without. Weights are ' +
      'why real browsers do not do that.'));
    host.appendChild(g2);

    var g3 = group('HPACK');
    g3.appendChild(field('Dynamic table size', selectBox(TABLE_LIMITS, '4096',
      function (v) { self.limit = parseInt(v, 10); onChange(); })));
    g3.appendChild(E('p', 'oa-hint',
      'Set it to zero and every request pays full price for its headers, which is what HTTP/1.1 ' +
      'does on every request forever.'));
    host.appendChild(g3);
  };
  TwoFamily.prototype.buildStage = function (host) {
    var self = this;
    this.topHost = E('div', 'hv-verdict');
    host.appendChild(this.topHost);

    this.subMux = E('div');
    this.canvas = E('canvas', 'hv-canvas');
    this.canvas.setAttribute('role', 'img');
    this.subMux.appendChild(this.canvas);
    this.subMux.appendChild(legendRow(KIND_LEGEND));
    host.appendChild(this.subMux);

    this.subHpack = E('div', 'oa-hidden');
    this.hpackHost = E('div', 'oa-tableout');
    this.tableViewHost = E('div', 'oa-tableout');
    this.subHpack.appendChild(E('p', 'hv-panehead', 'This request on the wire'));
    this.subHpack.appendChild(this.hpackHost);
    this.subHpack.appendChild(E('p', 'hv-panehead', 'The dynamic table after it'));
    this.subHpack.appendChild(this.tableViewHost);
    host.appendChild(this.subHpack);

    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.tableHost);
    window.addEventListener('resize', function () { self.render(self.lastIdx); });
  };
  TwoFamily.prototype.compute = function () {
    var resources = buildResources(this.n);
    this.resources = resources;
    var rtt = this.rtt, bw = this.bw(), loss = this.loss, prio = this.priorities;
    function run(proto, useLoss, usePrio) {
      return simulate({ proto: proto, resources: resources, rtt: rtt, bw: bw,
        loss: useLoss, think: 20, priorities: usePrio, seed: 20260831 });
    }
    this.error = null;
    if (this.algoKey === 'hpack') {
      this.hp = hpackRun(resources, this.host, this.limit);
      return this.hp.length;
    }
    this.sim = run('h2', loss, prio);
    this.other = this.algoKey === 'hol' ? run('h3', loss, prio) : run('h1', loss, prio);
    var tMax = 0;
    [this.sim, this.other].forEach(function (s) {
      tMax = Math.max(tMax, s.finished ? s.totalMs : s.ranFor);
    });
    this.tMax = Math.max(200, tMax * 1.02);
    if (!this.sim.finished || !this.other.finished) {
      this.error = 'At least one of these runs did not finish inside the ' + (CAP / 1000) +
        ' second limit, so its rows run off the end. Lower the loss or raise the bandwidth.';
    }
    if (this.algoKey === 'hol' && this.loss === 0) {
      this.error = 'Loss is at zero, so there is nothing to block on and the two pictures are ' +
        'nearly identical. That is the honest answer to "is HTTP/3 faster": on a clean link, ' +
        'barely. Raise the loss slider to see the difference this view exists to show.';
    }
    return H2_FRAMES;
  };
  TwoFamily.prototype.frameTime = function (idx) {
    return (Math.max(0, Math.min(H2_FRAMES - 1, idx)) / (H2_FRAMES - 1)) * this.tMax;
  };
  TwoFamily.prototype.showSub = function (which) {
    this.subMux.className = which === 'hpack' ? 'oa-hidden' : '';
    this.subHpack.className = which === 'hpack' ? '' : 'oa-hidden';
  };
  TwoFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    this.showSub(this.algoKey);
    clear(this.topHost);
    if (this.algoKey === 'hpack') this.renderHpack(idx);
    else this.renderRuns(idx);
  };
  TwoFamily.prototype.renderRuns = function (idx) {
    var pt = this.frameTime(idx);
    var pair = [this.sim, this.other];
    var top = this.topHost;
    top.appendChild(E('span', 'hv-clock', 'clock: ' + fmtMs(pt)));
    pair.forEach(function (s) {
      top.appendChild(E('span', 'hv-pill hv-pill-' + s.proto,
        s.label + ' · ' + doneBy(s, pt) + '/' + s.resources.length +
        (s.finished && pt >= s.totalMs ? ' · ' + fmtMs(s.totalMs) : '')));
    });
    if (stallAt(this.sim, pt).conn) {
      top.appendChild(E('span', 'hv-pill hv-pill-stall', 'every stream blocked'));
    }

    var n = this.sim.resources.length;
    var narrow = this.canvas.clientWidth > 0 && this.canvas.clientWidth < 560;
    var rowH = rowHeightFor(n) - (narrow ? 2 : 0);
    var gutter = narrow ? 62 : 104;
    var panelH = 16 + n * rowH + 12;
    var fit = fitCanvas(this.canvas, 2 * panelH + 26);
    if (fit) {
      var g = fit.g, w = fit.w, h = fit.h;
      var plotX = 4 + gutter;
      var plotW = Math.max(24, w - 8 - gutter - 6);
      drawAxis(g, plotX, plotW, this.tMax, w, h, pt);
      var self = this;
      pair.forEach(function (s, i) {
        var box = { x: 4, y: 8 + i * panelH, w: w - 8, h: panelH };
        if (i) {
          g.strokeStyle = 'rgba(28,43,68,0.9)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(4, box.y - 5);
          g.lineTo(w - 4, box.y - 5);
          g.stroke();
        }
        drawHead(g, box, s, pt, gutter);
        drawWaterfall(g, s, box, {
          tMax: self.tMax, pt: pt, rowH: rowH, gutter: gutter, showNames: true
        });
      });
    }
    this.canvas.setAttribute('aria-label',
      pair[0].label + ' has ' + doneBy(pair[0], pt) + ' of ' + n + ' resources at ' + fmtMs(pt) +
      '; ' + pair[1].label + ' has ' + doneBy(pair[1], pt) + '.');

    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Protocol', 'Connections', 'Everything done', 'Lost packets', 'Stream-time blocked'],
      pair.map(function (s) {
        return {
          key: s.proto,
          cells: [s.label, s.connCount, s.finished ? fmtMs(s.totalMs) : 'did not finish',
            s.losses, fmtMs(blockedMs(s))]
        };
      })));
  };
  TwoFamily.prototype.renderHpack = function (idx) {
    var cur = Math.min(idx, this.hp.length - 1);
    var f = this.hp[cur];
    var saved = f.plain > 0 ? Math.round((1 - f.hpack / f.plain) * 100) : 0;
    this.topHost.appendChild(E('span', 'hv-pill hv-pill-h2',
      'request ' + (cur + 1) + ' of ' + this.hp.length + ' · ' + trunc(f.name, 22)));
    this.topHost.appendChild(E('span', 'hv-clock',
      f.plain + ' bytes as HTTP/1.1 headers · ' + f.hpack + ' bytes as HPACK · ' +
      saved + '% smaller'));
    this.topHost.appendChild(E('span', 'hv-clock',
      'table ' + f.tableSize + ' / ' + f.limit + ' bytes, ' + f.table.length +
      (f.table.length === 1 ? ' entry' : ' entries')));

    clear(this.hpackHost);
    var rows = f.rows.map(function (r, i) {
      var how = E('span', 'hv-how' + (r.how === 'indexed' ? ' hv-how-idx' : ''),
        r.how === 'indexed' ? 'index ' + r.ref + ', one byte' : r.how);
      return {
        key: 'h' + i,
        cells: [r.n, trunc(r.v, 40), r.bytes, how]
      };
    });
    this.hpackHost.appendChild(table(['Header', 'Value', 'Wire bytes', 'How it was encoded'], rows));

    clear(this.tableViewHost);
    if (!f.table.length) {
      this.tableViewHost.appendChild(E('p', 'hv-empty',
        f.limit === 0
          ? 'The dynamic table is switched off, so nothing is ever remembered and every request ' +
            'pays full price for every header. This is what HTTP/1.1 does, on every request, forever.'
          : 'Nothing has been added yet.'));
    } else {
      this.tableViewHost.appendChild(table(
        ['Index', 'Name', 'Value', 'Entry size'],
        f.table.map(function (e, i) {
          return { key: 'd' + i, cells: [62 + i, e.n, trunc(e.v, 34), e.size + ' B'] };
        })));
    }

    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Request', 'Resource', 'HTTP/1.1 headers (B)', 'HPACK (B)', 'Saved'],
      this.hp.map(function (h, i) {
        return {
          key: 'r' + i,
          cells: [i + 1, trunc(h.name, 20), h.plain, h.hpack,
            (h.plain ? Math.round((1 - h.hpack / h.plain) * 100) : 0) + '%']
        };
      })));
  };
  TwoFamily.prototype.note = function (idx) {
    if (this.algoKey === 'hpack') {
      var cur = Math.min(idx, this.hp.length - 1);
      var f = this.hp[cur];
      if (cur === 0) {
        return 'The first request pays for everything. The user agent string alone is ' + UA.length +
          ' bytes and nothing has been seen before, so almost every field goes out as a literal — ' +
          f.hpack + ' bytes against ' + f.plain + ' as HTTP/1.1 headers. Every literal that goes ' +
          'out with indexing set is also written into the dynamic table, which is the investment ' +
          'the next request collects on.';
      }
      var indexed = 0;
      for (var i = 0; i < f.rows.length; i++) if (f.rows[i].how === 'indexed') indexed += 1;
      var out = 'Request ' + (cur + 1) + ' costs ' + f.hpack + ' bytes instead of ' + f.plain +
        ', because ' + indexed + ' of its ' + f.rows.length + ' headers are now a single byte ' +
        'each: an index into a table both ends have built identically. Only :path is still a ' +
        'literal, because it changes every time and indexing it would evict entries that are ' +
        'earning their keep.';
      out += ' Across ' + (cur + 1) + ' requests that is ' + f.cumH2 + ' bytes instead of ' +
        f.cumH1 + '.';
      if (f.evicted) {
        out += ' ' + f.evicted + (f.evicted === 1 ? ' entry has' : ' entries have') +
          ' been evicted to stay inside ' + f.limit + ' bytes; entry size is the name plus the ' +
          'value plus 32 bytes of overhead, which RFC 7541 defines so both ends agree on when to ' +
          'evict.';
      }
      return out;
    }
    var pt = this.frameTime(idx);
    var st = stallAt(this.sim, pt);
    if (this.algoKey === 'hol') {
      var head = 'At ' + fmtMs(pt) + ': HTTP/2 has ' + doneBy(this.sim, pt) + ' of ' +
        this.sim.resources.length + ', HTTP/3 has ' + doneBy(this.other, pt) + '.';
      if (st.conn) {
        return head + ' HTTP/2 is stopped dead. One TCP segment went missing, and TCP will not ' +
          'hand the application a single byte that comes after the hole — not for the stream that ' +
          'lost the packet, and not for the fifteen that did not. The red band is every stream ' +
          'waiting on one retransmit. HTTP/2 multiplexed the streams but left them sharing one ' +
          'ordered byte stream underneath, and this is the bill for that.';
      }
      return head + ' QUIC gives every stream its own delivery order, so a lost packet blocks only ' +
        'the stream it belonged to. That single change is the reason HTTP/3 exists, and it is why ' +
        'it had to leave TCP to get it — you cannot fix this above the transport.';
    }
    var waitingH1 = 0;
    for (var k = 0; k < this.other.resources.length; k++) {
      var r = this.other.resources[k];
      if (r.requestedAt < 0 || r.requestedAt > pt) waitingH1 += 1;
    }
    var msg = 'At ' + fmtMs(pt) + ': HTTP/2 has ' + doneBy(this.sim, pt) + ' of ' +
      this.sim.resources.length + ' on one connection, HTTP/1.1 has ' + doneBy(this.other, pt) +
      ' on ' + this.other.connCount + '.';
    if (waitingH1) {
      msg += ' HTTP/1.1 still has ' + waitingH1 + ' resources it has not asked for yet, because it ' +
        'has nowhere to put the request. HTTP/2 asked for all of them in the first flight — that ' +
        'is multiplexing, and it is most of what HTTP/2 was for.';
    }
    if (!this.priorities) {
      msg += ' With priorities off, every stream gets an equal share and the stylesheet lands with ' +
        'the last photograph rather than first. Multiplexing without prioritisation can be worse ' +
        'than queueing.';
    }
    return msg;
  };
  TwoFamily.prototype.compare = function () {
    if (this.algoKey === 'hpack') {
      var last = this.hp[this.hp.length - 1];
      return {
        title: 'What the header table is worth over the whole page',
        head: ['Encoding', 'Header bytes for ' + this.hp.length + ' requests', 'Per request (avg)'],
        best: 1,
        lower: true,
        rows: [
          { key: 'h1', cells: ['HTTP/1.1, plain text every time', last.cumH1,
            Math.round(last.cumH1 / this.hp.length)] },
          { key: 'h2', cells: ['HPACK, table limit ' + last.limit + ' B', last.cumH2,
            Math.round(last.cumH2 / this.hp.length)] }
        ]
      };
    }
    var pair = [this.sim, this.other];
    return {
      title: this.algoKey === 'hol'
        ? 'The same losses, on one ordered byte stream and on independent ones'
        : 'One multiplexed connection against six sequential ones',
      head: ['Protocol', 'Connections', 'Everything done (ms)', 'Lost packets', 'Stream-time blocked (ms)'],
      best: 2,
      lower: true,
      rows: pair.map(function (s) {
        return {
          key: s.proto,
          cells: [s.label, s.connCount, s.finished ? Math.round(s.totalMs) : '—', s.losses,
            Math.round(blockedMs(s))]
        };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 4 — HTTP/3 OVER QUIC                                             */
  /* ======================================================================== */

  var H3_FRAMES = 90;

  function ThreeFamily() {
    this.key = 'h3';
    this.label = 'HTTP/3';
    this.algoKey = 'setup';
    this.n = 16;
    this.rtt = 80;
    this.bwIdx = 5;
    this.loss = 2;
    this.mode = 'quic';
    this.lastIdx = 0;
  }
  ThreeFamily.prototype.algoOptions = function () {
    return [
      { key: 'setup', label: 'Handshake and 0-RTT' },
      { key: 'streams', label: 'Independent streams under loss' },
      { key: 'migrate', label: 'Connection migration' }
    ];
  };
  ThreeFamily.prototype.bw = function () { return BW_STEPS[this.bwIdx]; };
  ThreeFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The link');
    g.appendChild(rangeField('Round-trip time', this.rtt, 10, 400, 5,
      function (v) { return Math.round(v) + ' ms'; },
      function (v) { self.rtt = v; onChange(); }));
    g.appendChild(rangeField('Bandwidth', this.bwIdx, 0, BW_STEPS.length - 1, 1,
      function (v) { return BW_STEPS[v] + ' Mbps'; },
      function (v) { self.bwIdx = v; onChange(); }));
    g.appendChild(rangeField('Packet loss', this.loss, 0, 8, 0.1,
      function (v) { return v.toFixed(1) + '%'; },
      function (v) { self.loss = v; onChange(); }));
    host.appendChild(g);

    var g2 = group('Handshake');
    g2.appendChild(field('Compare', selectBox(
      SETUP_MODES.map(function (m) { return { key: m.key, label: m.label }; }),
      'quic', function (v) { self.mode = v; onChange(); })));
    g2.appendChild(E('p', 'oa-hint',
      'Only the handshake view uses this. The round trips are counted from the first packet the ' +
      'client sends to the first byte of the response body.'));
    host.appendChild(g2);

    var g3 = group('The page');
    g3.appendChild(field('Resources', numBox(this.n, 4, 24, function (v) { self.n = v; onChange(); })));
    host.appendChild(g3);
  };
  ThreeFamily.prototype.buildStage = function (host) {
    var self = this;
    this.topHost = E('div', 'hv-verdict');
    host.appendChild(this.topHost);

    this.subSteps = E('div');
    this.stepsHost = E('div', 'hv-ladder');
    this.subSteps.appendChild(this.stepsHost);
    host.appendChild(this.subSteps);

    this.subCanvas = E('div', 'oa-hidden');
    this.canvas = E('canvas', 'hv-canvas');
    this.canvas.setAttribute('role', 'img');
    this.subCanvas.appendChild(this.canvas);
    this.subCanvas.appendChild(legendRow(KIND_LEGEND));
    host.appendChild(this.subCanvas);

    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.tableHost);
    window.addEventListener('resize', function () { self.render(self.lastIdx); });
  };
  ThreeFamily.prototype.compute = function () {
    this.error = null;
    if (this.algoKey === 'setup') {
      this.ladder = setupLadder(this.mode, this.rtt);
      return this.ladder.length;
    }
    if (this.algoKey === 'migrate') {
      this.walk = migrationWalk(this.rtt);
      return this.walk.length;
    }
    var resources = buildResources(this.n);
    var rtt = this.rtt, bw = this.bw(), loss = this.loss;
    function run(proto) {
      return simulate({ proto: proto, resources: resources, rtt: rtt, bw: bw,
        loss: loss, think: 20, seed: 20260831 });
    }
    this.sim = run('h3');
    this.other = run('h2');
    var tMax = Math.max(this.sim.finished ? this.sim.totalMs : this.sim.ranFor,
      this.other.finished ? this.other.totalMs : this.other.ranFor);
    this.tMax = Math.max(200, tMax * 1.02);
    if (this.loss === 0) {
      this.error = 'Loss is at zero, so no stream is ever blocked and there is nothing here to ' +
        'see. Raise the loss slider — this view only says anything when packets go missing.';
    }
    return H3_FRAMES;
  };
  ThreeFamily.prototype.frameTime = function (idx) {
    return (Math.max(0, Math.min(H3_FRAMES - 1, idx)) / (H3_FRAMES - 1)) * this.tMax;
  };
  ThreeFamily.prototype.showSub = function (canvasView) {
    this.subSteps.className = canvasView ? 'oa-hidden' : '';
    this.subCanvas.className = canvasView ? '' : 'oa-hidden';
  };
  ThreeFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var canvasView = this.algoKey === 'streams';
    this.showSub(canvasView);
    clear(this.topHost);
    clear(this.stepsHost);
    clear(this.tableHost);
    if (this.algoKey === 'setup') this.renderSetup(idx);
    else if (this.algoKey === 'migrate') this.renderMigrate(idx);
    else this.renderStreams(idx);
  };
  ThreeFamily.prototype.renderSetup = function (idx) {
    var ladder = this.ladder;
    var cur = Math.min(idx, ladder.length - 1);
    var mode = null;
    for (var m = 0; m < SETUP_MODES.length; m++) if (SETUP_MODES[m].key === this.mode) mode = SETUP_MODES[m];
    this.topHost.appendChild(E('span', 'hv-pill hv-pill-h3', mode.label));
    this.topHost.appendChild(E('span', 'hv-clock',
      'first response byte at ' + fmtMs(mode.rtts * this.rtt) + ' · ' + mode.rtts + ' round trips'));

    for (var i = 0; i < ladder.length; i++) {
      var s = ladder[i];
      var row = E('div', 'hv-step ' + s.dir +
        (i === cur ? ' now' : (i > cur ? ' future' : '')));
      row.appendChild(E('div', 'hv-step-t', Math.round(s.at) + ' ms'));
      var body = E('div');
      body.appendChild(E('span', 'hv-step-dir', s.dir === 'c2s' ? 'client → server' : 'server → client'));
      body.appendChild(E('p', 'hv-step-title', s.title));
      body.appendChild(E('p', 'hv-step-detail', s.detail));
      row.appendChild(body);
      this.stepsHost.appendChild(row);
    }

    var rtt = this.rtt;
    this.tableHost.appendChild(table(
      ['Setup', 'Round trips to the first byte', 'At ' + rtt + ' ms RTT', 'Against TCP + TLS 1.3'],
      SETUP_MODES.map(function (mm) {
        var diff = (2.5 - mm.rtts) * rtt;
        return {
          key: mm.key,
          cells: [mm.label, mm.rtts, Math.round(mm.rtts * rtt) + ' ms',
            diff === 0 ? 'the baseline' : (diff > 0 ? Math.round(diff) + ' ms saved'
              : Math.round(-diff) + ' ms slower')]
        };
      })));
  };
  ThreeFamily.prototype.renderMigrate = function (idx) {
    var walk = this.walk;
    var cur = Math.min(idx, walk.length - 1);
    this.topHost.appendChild(E('span', 'hv-pill hv-pill-h3', 'step ' + (cur + 1) + ' of ' + walk.length));
    this.topHost.appendChild(E('span', 'hv-clock', 'wi-fi to cellular, mid-download'));
    for (var i = 0; i < walk.length; i++) {
      var s = walk[i];
      var row = E('div', 'hv-step ' + s.side + (i === cur ? ' now' : (i > cur ? ' future' : '')));
      row.appendChild(E('div', 'hv-step-t',
        s.side === 'tcp' ? 'TCP' : (s.side === 'quic' ? 'QUIC' : 'both')));
      var body = E('div');
      body.appendChild(E('p', 'hv-step-title', s.title));
      body.appendChild(E('p', 'hv-step-detail', s.detail));
      row.appendChild(body);
      this.stepsHost.appendChild(row);
    }
    this.tableHost.appendChild(table(
      ['', 'What identifies the connection', 'When your IP address changes', 'Cost'],
      [
        { key: 'tcp', cells: ['TCP', 'source IP, source port, destination IP, destination port',
          'the connection no longer exists', 'full reconnect plus a new TLS handshake'] },
        { key: 'quic', cells: ['QUIC', 'a connection ID chosen by the endpoints',
          'the connection is found by ID and continues',
          'one round trip of path validation, and a congestion window reset'] }
      ]));
  };
  ThreeFamily.prototype.renderStreams = function (idx) {
    var pt = this.frameTime(idx);
    var pair = [this.sim, this.other];
    var top = this.topHost;
    top.appendChild(E('span', 'hv-clock', 'clock: ' + fmtMs(pt)));
    pair.forEach(function (s) {
      top.appendChild(E('span', 'hv-pill hv-pill-' + s.proto,
        s.label + ' · ' + doneBy(s, pt) + '/' + s.resources.length +
        (s.finished && pt >= s.totalMs ? ' · ' + fmtMs(s.totalMs) : '')));
    });

    var n = this.sim.resources.length;
    var narrow = this.canvas.clientWidth > 0 && this.canvas.clientWidth < 560;
    var rowH = rowHeightFor(n) - (narrow ? 2 : 0);
    var gutter = narrow ? 62 : 104;
    var panelH = 16 + n * rowH + 12;
    var fit = fitCanvas(this.canvas, 2 * panelH + 26);
    if (fit) {
      var g = fit.g, w = fit.w, h = fit.h;
      var plotX = 4 + gutter;
      var plotW = Math.max(24, w - 8 - gutter - 6);
      drawAxis(g, plotX, plotW, this.tMax, w, h, pt);
      var self = this;
      pair.forEach(function (s, i) {
        var box = { x: 4, y: 8 + i * panelH, w: w - 8, h: panelH };
        if (i) {
          g.strokeStyle = 'rgba(28,43,68,0.9)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(4, box.y - 5);
          g.lineTo(w - 4, box.y - 5);
          g.stroke();
        }
        drawHead(g, box, s, pt, gutter);
        drawWaterfall(g, s, box, {
          tMax: self.tMax, pt: pt, rowH: rowH, gutter: gutter, showNames: true
        });
      });
    }
    this.canvas.setAttribute('aria-label',
      'HTTP/3 has ' + doneBy(this.sim, pt) + ' of ' + n + ' resources at ' + fmtMs(pt) +
      '; HTTP/2 over the same losses has ' + doneBy(this.other, pt) + '.');

    this.tableHost.appendChild(table(
      ['Protocol', 'Lost packets', 'What a loss blocks', 'Stream-time blocked', 'Everything done'],
      pair.map(function (s) {
        return {
          key: s.proto,
          cells: [s.label, s.losses,
            s.proto === 'h3' ? 'one stream' : 'every stream on the connection',
            fmtMs(blockedMs(s)),
            s.finished ? fmtMs(s.totalMs) : 'did not finish']
        };
      })));
  };
  ThreeFamily.prototype.note = function (idx) {
    if (this.algoKey === 'setup') {
      var cur = Math.min(idx, this.ladder.length - 1);
      var base = this.ladder[cur].title + ' — ' + this.ladder[cur].detail;
      if (this.mode === 'quic0' && cur === 0) {
        base += ' This is the trade the industry argued about for years: half a round trip against ' +
          'a request an attacker who recorded the packet can send again later. Browsers only use ' +
          '0-RTT for requests the server has said are safe to repeat.';
      }
      return base;
    }
    if (this.algoKey === 'migrate') {
      var s = this.walk[Math.min(idx, this.walk.length - 1)];
      return s.title + ' — ' + s.detail;
    }
    var pt = this.frameTime(idx);
    var st3 = stallAt(this.sim, pt);
    var st2 = stallAt(this.other, pt);
    var out = 'At ' + fmtMs(pt) + ': HTTP/3 has ' + doneBy(this.sim, pt) + ' of ' +
      this.sim.resources.length + ', HTTP/2 has ' + doneBy(this.other, pt) + '.';
    if (st3.stream && !st2.conn) {
      out += ' HTTP/3 has ' + st3.stream + (st3.stream === 1 ? ' stream' : ' streams') +
        ' waiting on a retransmit and the rest are still receiving — the bandwidth that stream ' +
        'was using goes to its neighbours rather than being wasted.';
    } else if (st2.conn) {
      out += ' HTTP/2 is blocked on every stream; HTTP/3 is losing at most the streams that ' +
        'actually lost a packet. Same link, same losses, same congestion response — the only ' +
        'difference is that QUIC gives each stream its own delivery order.';
    } else {
      out += ' Both are running clean at this instant. Step forward to the next loss.';
    }
    return out;
  };
  ThreeFamily.prototype.compare = function () {
    if (this.algoKey === 'setup') return null;
    if (this.algoKey === 'migrate') return null;
    var pair = [this.sim, this.other];
    return {
      title: 'Independent streams against one ordered byte stream',
      head: ['Protocol', 'Everything done (ms)', 'Lost packets', 'Stream-time blocked (ms)',
        'Stream-time blocked per loss (ms)'],
      best: 1,
      lower: true,
      rows: pair.map(function (s) {
        /* The last column divides by the loss count, so this is where the
           units mattered most: it now reads about 1,300 ms of stream time per
           lost packet for HTTP/2 against 76 ms for HTTP/3 — one round trip on
           one stream. See blockedMs. */
        var blocked = blockedMs(s);
        return {
          key: s.proto,
          cells: [s.label, s.finished ? Math.round(s.totalMs) : '—', s.losses,
            Math.round(blocked), s.losses ? Math.round(blocked / s.losses) : 0]
        };
      })
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'httpviz',
    mountId: 'viz-http-mount',
    name: 'The HTTP version race',
    css: EXTRA_CSS,
    families: function () {
      return [new RaceFamily(), new OneFamily(), new TwoFamily(), new ThreeFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

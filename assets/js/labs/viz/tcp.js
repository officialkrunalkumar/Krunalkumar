/* ==========================================================================
   tcp.js — TCP made watchable: the handshake, the state machine, and the
   congestion-control sawtooth that shapes almost all internet traffic.
   --------------------------------------------------------------------------
   The pcap analyser elsewhere in Labs shows you TCP packets after the fact.
   This lab runs the protocol. Three families over one small, honest model:

     1. Handshake  — SYN, SYN-ACK, ACK and the four-way close, with the real
                     sequence and acknowledgement numbers moving between two
                     endpoints. Watch a connection open and shut.
     2. State      — the TCP state machine both ends walk through, from CLOSED
                     to ESTABLISHED to TIME_WAIT, so the handshake stops being
                     magic and becomes a path through named states.
     3. Congestion — Reno-style congestion control: slow start, congestion
                     avoidance, fast retransmit and the sawtooth that emerges.
                     This is the algorithm that decides how fast every download
                     you have ever run was allowed to go.

   Design decisions worth spelling out:

   1. A real simulation, not a scripted animation. The congestion family
      actually runs the Reno control loop round trip by round trip: cwnd
      doubles in slow start, grows by one MSS per RTT in avoidance, halves on a
      triple-duplicate ACK and collapses to one on a timeout. The sawtooth you
      see is emitted by the algorithm, not drawn by hand — which is why you can
      change the loss point and watch the shape respond.

   2. Sequence numbers that actually add up. The handshake tracks real seq/ack
      arithmetic: a SYN consumes one sequence number, data advances it by its
      length, and the ACK is always "the next byte I expect". Getting this
      right is the difference between a diagram and a lie, and it is checked by
      the test harness against the numbers in the RFC 793 examples.

   3. Frames precomputed, stepping reversible — the same contract as every
      other lab on this shell, so the transport, the compare table and the
      keyboard controls come for free.

   Nothing here opens a network connection. The only irony worth noting is
   that a page explaining TCP does not itself use a single TCP feature beyond
   the one that delivered it.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  CORE 1 — HANDSHAKE + DATA + CLOSE                                       */
  /* ------------------------------------------------------------------------ */
  /*  A segment carries flags, a sequence number, an acknowledgement number    */
  /*  and an optional length. The two endpoints each track snd_nxt (next seq   */
  /*  to send) and rcv_nxt (next seq expected). A SYN or FIN consumes one      */
  /*  sequence number; data consumes its length. The ACK a side sends is       */
  /*  always its rcv_nxt — "the next byte I expect from you".                   */
  /* ======================================================================== */

  function handshake(opts) {
    opts = opts || {};
    var clientISN = opts.clientISN != null ? opts.clientISN : 1000;
    var serverISN = opts.serverISN != null ? opts.serverISN : 5000;
    var dataLen = opts.dataLen != null ? opts.dataLen : 100;

    var segments = [];
    var client = { seq: clientISN, ack: 0, state: 'CLOSED' };
    var server = { seq: serverISN, ack: 0, state: 'LISTEN' };

    function send(from, dir, flags, seq, ack, len, note, cState, sState) {
      segments.push({
        dir: dir, flags: flags, seq: seq, ack: ack, len: len || 0, note: note,
        clientState: cState, serverState: sState
      });
    }

    // --- three-way handshake ---
    // 1. client -> server: SYN, seq = client ISN
    client.state = 'SYN_SENT';
    send('client', 'c2s', ['SYN'], client.seq, 0, 0,
      'The client opens with a SYN carrying its initial sequence number. A SYN consumes one ' +
      'sequence number even though it carries no data.', 'SYN_SENT', 'LISTEN');
    var clientSynSeq = client.seq;
    client.seq += 1;                 // SYN consumes one seq

    // 2. server -> client: SYN-ACK, seq = server ISN, ack = client ISN + 1
    server.ack = clientSynSeq + 1;
    server.state = 'SYN_RCVD';
    send('server', 's2c', ['SYN', 'ACK'], server.seq, server.ack, 0,
      'The server replies with its own SYN and acknowledges the client — ack = client ISN + 1, the ' +
      'next byte it expects. This single segment does the server’s half of the handshake.',
      'SYN_SENT', 'SYN_RCVD');
    var serverSynSeq = server.seq;
    server.seq += 1;

    // 3. client -> server: ACK, seq = client ISN + 1, ack = server ISN + 1
    client.ack = serverSynSeq + 1;
    client.state = 'ESTABLISHED';
    send('client', 'c2s', ['ACK'], client.seq, client.ack, 0,
      'The client acknowledges the server’s SYN. The connection is now open on the client side; ' +
      'when the server receives this it opens too. Three segments, one round trip and a half.',
      'ESTABLISHED', 'SYN_RCVD');
    server.state = 'ESTABLISHED';

    // --- one data segment + its ACK (if requested) ---
    if (dataLen > 0) {
      send('client', 'c2s', ['PSH', 'ACK'], client.seq, client.ack, dataLen,
        'With the connection open, the client sends ' + dataLen + ' bytes of data. Its sequence ' +
        'number advances by the length of the data, not by one.', 'ESTABLISHED', 'ESTABLISHED');
      server.ack = client.seq + dataLen;
      client.seq += dataLen;
      send('server', 's2c', ['ACK'], server.seq, server.ack, 0,
        'The server acknowledges the data: ack = ' + server.ack + ', the next byte it expects. ' +
        'Pure ACKs carry no data and do not consume a sequence number.', 'ESTABLISHED', 'ESTABLISHED');
    }

    // --- four-way close, initiated by the client ---
    client.state = 'FIN_WAIT_1';
    send('client', 'c2s', ['FIN', 'ACK'], client.seq, client.ack, 0,
      'The client is done and sends FIN. Like SYN, a FIN consumes one sequence number. The client ' +
      'enters FIN_WAIT_1 — it can still receive, but will send no more data.', 'FIN_WAIT_1', 'ESTABLISHED');
    var clientFinSeq = client.seq;
    client.seq += 1;

    server.ack = clientFinSeq + 1;
    server.state = 'CLOSE_WAIT';
    send('server', 's2c', ['ACK'], server.seq, server.ack, 0,
      'The server acknowledges the FIN and enters CLOSE_WAIT. The client moves to FIN_WAIT_2. The ' +
      'connection is now half-closed: the server may still send.', 'FIN_WAIT_2', 'CLOSE_WAIT');

    server.state = 'LAST_ACK';
    send('server', 's2c', ['FIN', 'ACK'], server.seq, server.ack, 0,
      'The server sends its own FIN. Both directions are now closing. The server waits for one last ' +
      'acknowledgement.', 'FIN_WAIT_2', 'LAST_ACK');
    var serverFinSeq = server.seq;
    server.seq += 1;

    client.ack = serverFinSeq + 1;
    client.state = 'TIME_WAIT';
    send('client', 'c2s', ['ACK'], client.seq, client.ack, 0,
      'The client acknowledges the server’s FIN and enters TIME_WAIT — it lingers for twice the ' +
      'maximum segment lifetime so a delayed segment cannot corrupt a future connection on the same ' +
      'ports. The server, on receiving this, is fully CLOSED.', 'TIME_WAIT', 'CLOSED');

    return {
      segments: segments, clientISN: clientISN, serverISN: serverISN, dataLen: dataLen,
      finalClient: 'TIME_WAIT', finalServer: 'CLOSED'
    };
  }

  /* ======================================================================== */
  /*  CORE 2 — STATE MACHINE                                                  */
  /* ------------------------------------------------------------------------ */
  /*  The canonical TCP state diagram, as the transitions each endpoint makes  */
  /*  driven by the handshake above. Rather than hardcode a path, the states   */
  /*  are read straight off the handshake segments, so the two stay in step.   */
  /* ======================================================================== */

  var TCP_STATES = ['CLOSED', 'LISTEN', 'SYN_SENT', 'SYN_RCVD', 'ESTABLISHED',
    'FIN_WAIT_1', 'FIN_WAIT_2', 'CLOSE_WAIT', 'CLOSING', 'LAST_ACK', 'TIME_WAIT'];

  function stateWalk(hs) {
    // Build the ordered list of (client, server) state pairs the connection
    // passes through, de-duplicating consecutive repeats so each frame is a
    // real transition.
    var frames = [{ client: 'CLOSED', server: 'LISTEN', event: 'Passive open: the server is LISTENing; the client is CLOSED.' }];
    hs.segments.forEach(function (seg) {
      var last = frames[frames.length - 1];
      if (seg.clientState !== last.client || seg.serverState !== last.server) {
        frames.push({
          client: seg.clientState, server: seg.serverState,
          event: describeTransition(last, seg)
        });
      }
    });
    return frames;
  }

  function describeTransition(last, seg) {
    var f = seg.flags.join('-');
    var mover = seg.clientState !== last.client ? 'client' : 'server';
    return 'On ' + f + ' (' + seg.dir + '), the ' + mover + ' moves to ' +
      (mover === 'client' ? seg.clientState : seg.serverState) + '.';
  }

  /* ======================================================================== */
  /*  CORE 3 — CONGESTION CONTROL (TCP Reno)                                  */
  /* ------------------------------------------------------------------------ */
  /*  The real control loop, one round trip per step:                          */
  /*    slow start:        cwnd += 1 MSS per ACK -> doubles per RTT, until      */
  /*                        cwnd >= ssthresh                                    */
  /*    congestion avoid:  cwnd += 1 MSS per RTT (additive increase)           */
  /*    triple-dup ACK:    ssthresh = cwnd/2; cwnd = ssthresh (fast recovery)  */
  /*    timeout:           ssthresh = cwnd/2; cwnd = 1 (back to slow start)    */
  /*  Loss events are scheduled by RTT so a run is deterministic and the        */
  /*  sawtooth is reproducible.                                                 */
  /* ======================================================================== */

  function congestion(opts) {
    opts = opts || {};
    var rtts = opts.rtts || 40;
    var initialSsthresh = opts.ssthresh || 16;
    var capacity = opts.capacity || 24;          // the link's ceiling, in MSS
    // loss events: {at: rtt, kind: 'triple'|'timeout'}
    var losses = opts.losses || [
      { at: 8, kind: 'triple' },
      { at: 20, kind: 'timeout' },
      { at: 30, kind: 'triple' }
    ];

    var cwnd = 1;
    var ssthresh = initialSsthresh;
    var phase = 'slow start';
    var frames = [];
    var delivered = 0;

    for (var rtt = 0; rtt <= rtts; rtt++) {
      var loss = null;
      for (var i = 0; i < losses.length; i++) if (losses[i].at === rtt) loss = losses[i];

      var event = null;
      if (rtt === 0) {
        event = 'Connection opens with cwnd = 1 MSS. TCP has no idea how fast the path is, so it ' +
          'starts slow and probes upward.';
      } else if (loss && loss.kind === 'triple') {
        ssthresh = Math.max(2, Math.floor(cwnd / 2));
        cwnd = ssthresh;                    // fast recovery: halve, don't reset
        phase = 'congestion avoidance';
        event = 'Three duplicate ACKs — a single segment was lost but packets are still flowing. ' +
          'Fast retransmit: ssthresh drops to ' + ssthresh + ' and cwnd halves to ' + cwnd +
          ' rather than collapsing. This is the top of a sawtooth tooth.';
      } else if (loss && loss.kind === 'timeout') {
        ssthresh = Math.max(2, Math.floor(cwnd / 2));
        cwnd = 1;                           // timeout: back to square one
        phase = 'slow start';
        event = 'A retransmission timeout — the pipe may have emptied. This is the severe signal: ' +
          'ssthresh drops to ' + ssthresh + ' and cwnd resets all the way to 1. Slow start begins again.';
      } else if (phase === 'slow start') {
        cwnd = Math.min(capacity, cwnd * 2);       // exponential per RTT
        if (cwnd >= ssthresh) {
          cwnd = ssthresh;
          phase = 'congestion avoidance';
          event = 'cwnd has reached ssthresh (' + ssthresh + '). Slow start ends and congestion ' +
            'avoidance begins — from here cwnd grows by just one MSS per round trip.';
        } else {
          event = 'Slow start: every ACK bumps cwnd, so it doubles each round trip. Exponential ' +
            'growth, but from a tiny base — this is TCP feeling for the ceiling.';
        }
      } else {
        cwnd = Math.min(capacity, cwnd + 1);       // additive increase
        event = 'Congestion avoidance: cwnd creeps up by one MSS per round trip, probing gently ' +
          'for more bandwidth without provoking loss.';
      }

      delivered += cwnd;
      frames.push({
        rtt: rtt, cwnd: cwnd, ssthresh: ssthresh, phase: phase,
        loss: loss ? loss.kind : null, event: event, delivered: delivered,
        capacity: capacity
      });
    }

    var peak = 0;
    frames.forEach(function (f) { if (f.cwnd > peak) peak = f.cwnd; });
    return {
      frames: frames, peak: peak, ssthreshFinal: ssthresh,
      losses: losses, capacity: capacity, delivered: delivered
    };
  }

  var CORE = {
    handshake: handshake, stateWalk: stateWalk, congestion: congestion,
    TCP_STATES: TCP_STATES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  var E = MV.el, clear = MV.clear, table = MV.table, button = MV.button;
  var group = MV.group, numBox = MV.numBox, field = MV.field, selectBox = MV.selectBox;
  var CC = MV.C, FONT = MV.FONT;

  var EXTRA_CSS = [
    /* handshake ladder */
    '.tc-ladder{position:relative;padding:8px 0;}',
    '.tc-heads{display:flex;justify-content:space-between;font-weight:700;font-size:12px;color:' + CC.ink + ';padding:0 8px 8px;}',
    '.tc-head-c{color:' + CC.blue + ';}',
    '.tc-head-s{color:' + CC.green + ';}',
    '.tc-seg{position:relative;height:38px;margin:2px 0;}',
    '.tc-seg .tc-line{position:absolute;top:50%;height:0;border-top:2px solid #2c496f;left:8%;right:8%;}',
    '.tc-seg.c2s .tc-line{border-top-style:solid;}',
    '.tc-seg .tc-arrow{position:absolute;top:calc(50% - 5px);width:0;height:0;border:5px solid transparent;}',
    '.tc-seg.c2s .tc-arrow{right:8%;border-left-color:' + CC.blue + ';}',
    '.tc-seg.s2c .tc-arrow{left:8%;border-right-color:' + CC.green + ';}',
    '.tc-seg .tc-flags{position:absolute;top:2px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;padding:1px 8px;border-radius:5px;background:#131f36;border:1px solid #2c496f;white-space:nowrap;}',
    '.tc-seg .tc-nums{position:absolute;bottom:0;left:50%;transform:translateX(-50%);font-size:10px;color:' + CC.faint + ';white-space:nowrap;}',
    '.tc-seg.done{opacity:1;}',
    '.tc-seg.future{opacity:.2;}',
    '.tc-seg.now .tc-flags{border-color:' + CC.amber + ';color:#fff;}',
    '.tc-seg.now .tc-line{border-top-color:' + CC.amber + ';}',
    '.tc-syn{color:' + CC.amber + ';}',
    '.tc-fin{color:' + CC.red + ';}',
    /* state boxes */
    '.tc-states{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;}',
    '.tc-endpoint{flex:1;min-width:9rem;padding:9px 11px;border-radius:9px;border:1px solid ' + CC.line + ';background:rgba(15,23,42,.5);}',
    '.tc-endpoint h4{margin:0 0 5px;font-size:12px;}',
    '.tc-endpoint.client{border-color:rgba(56,189,248,.4);}',
    '.tc-endpoint.server{border-color:rgba(52,211,153,.4);}',
    '.tc-statebadge{display:inline-block;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:700;font-family:' + FONT + ';background:#0d1729;border:1px solid #2c496f;color:' + CC.ink + ';}',
    '.tc-statelist{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;}',
    '.tc-stpill{font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid #24344f;color:' + CC.faint + ';}',
    '.tc-stpill.c{color:' + CC.blue + ';border-color:' + CC.blue + ';}',
    '.tc-stpill.s{color:' + CC.green + ';border-color:' + CC.green + ';}',
    /* congestion canvas */
    '.tc-canvas{display:block;width:100%;height:320px;border:1px solid ' + CC.line + ';border-radius:10px;background:' + CC.bg0 + ';}',
    '@media (max-width:640px){.tc-canvas{height:260px;}}',
    '.tc-phase{display:inline-block;padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;}',
    '.tc-phase-ss{background:rgba(56,189,248,.18);color:' + CC.blue + ';}',
    '.tc-phase-ca{background:rgba(52,211,153,.16);color:' + CC.green + ';}',
    '.tc-phase-loss{background:rgba(252,165,165,.16);color:' + CC.red + ';}'
  ].join('');

  function flagSpan(flags) {
    var wrap = E('span');
    flags.forEach(function (fl, i) {
      var cls = fl === 'SYN' ? 'tc-syn' : (fl === 'FIN' ? 'tc-fin' : '');
      if (i) wrap.appendChild(document.createTextNode('-'));
      wrap.appendChild(E('span', cls, fl));
    });
    return wrap;
  }

  /* ======================================================================== */
  /*  FAMILY 1 — HANDSHAKE                                                    */
  /* ======================================================================== */

  function HandshakeFamily() {
    this.key = 'handshake';
    this.label = 'Handshake';
    this.algoKey = 'full';
    this.dataLen = 100;
  }
  HandshakeFamily.prototype.algoOptions = function () {
    return [{ key: 'full', label: 'Open, transfer, close' }];
  };
  HandshakeFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('Connection');
    g.appendChild(field('Data to send (bytes)', numBox(this.dataLen, 0, 1460, function (v) {
      self.dataLen = v; onChange();
    })));
    g.appendChild(E('p', 'oa-hint',
      'Set this to 0 to see a bare open-and-close. The sequence numbers are real: a SYN or FIN ' +
      'consumes one, and data advances the sequence by its length.'));
    host.appendChild(g);
    var g2 = group('Initial sequence numbers');
    g2.appendChild(field('Client ISN', numBox(1000, 0, 99999, function (v) { self.clientISN = v; onChange(); })));
    g2.appendChild(field('Server ISN', numBox(5000, 0, 99999, function (v) { self.serverISN = v; onChange(); })));
    host.appendChild(g2);
  };
  HandshakeFamily.prototype.buildStage = function (host) {
    this.ladderHost = E('div');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.ladderHost);
    host.appendChild(this.tableHost);
  };
  HandshakeFamily.prototype.compute = function () {
    this.result = handshake({ clientISN: this.clientISN != null ? this.clientISN : 1000,
      serverISN: this.serverISN != null ? this.serverISN : 5000, dataLen: this.dataLen });
    this.error = null;
    return this.result.segments.length;
  };
  HandshakeFamily.prototype.render = function (idx) {
    var res = this.result;
    var cur = Math.min(idx, res.segments.length - 1);
    clear(this.ladderHost);

    var ladder = E('div', 'tc-ladder');
    var heads = E('div', 'tc-heads');
    heads.appendChild(E('span', 'tc-head-c', 'Client'));
    heads.appendChild(E('span', 'tc-head-s', 'Server'));
    ladder.appendChild(heads);

    res.segments.forEach(function (seg, i) {
      var row = E('div', 'tc-seg ' + seg.dir + (i === cur ? ' now' : (i < cur ? ' done' : ' future')));
      row.appendChild(E('div', 'tc-line'));
      row.appendChild(E('div', 'tc-arrow'));
      var flags = E('div', 'tc-flags');
      flags.appendChild(flagSpan(seg.flags));
      row.appendChild(flags);
      var nums = E('div', 'tc-nums',
        'seq=' + seg.seq + (seg.ack ? ' ack=' + seg.ack : '') + (seg.len ? ' len=' + seg.len : ''));
      row.appendChild(nums);
      ladder.appendChild(row);
    });
    this.ladderHost.appendChild(ladder);

    var seg = res.segments[cur];
    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Segment', 'Direction', 'Flags', 'seq', 'ack', 'Client state', 'Server state'],
      [[(cur + 1) + ' of ' + res.segments.length, seg.dir === 'c2s' ? 'client → server' : 'server → client',
        seg.flags.join('-'), seg.seq, seg.ack || '—', seg.clientState, seg.serverState]]));
  };
  HandshakeFamily.prototype.note = function (idx) {
    return this.result.segments[Math.min(idx, this.result.segments.length - 1)].note;
  };
  HandshakeFamily.prototype.compare = function () {
    return {
      title: 'Why a handshake at all',
      head: ['Segment', 'Purpose', 'Consumes a sequence number?'],
      rows: [
        { key: 'syn', cells: ['SYN', 'Client proposes a starting sequence number', 'yes'] },
        { key: 'synack', cells: ['SYN-ACK', 'Server agrees and proposes its own', 'yes'] },
        { key: 'ack', cells: ['ACK', 'Client confirms — both sides now synchronised', 'no'] },
        { key: 'fin', cells: ['FIN', 'One side signals it has no more data', 'yes'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — STATE MACHINE                                                */
  /* ======================================================================== */

  function StateFamily() {
    this.key = 'state';
    this.label = 'State machine';
    this.algoKey = 'walk';
    this.dataLen = 100;
  }
  StateFamily.prototype.algoOptions = function () { return [{ key: 'walk', label: 'Walk both endpoints' }]; };
  StateFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('Connection');
    g.appendChild(field('Data to send (bytes)', numBox(this.dataLen, 0, 1460, function (v) {
      self.dataLen = v; onChange();
    })));
    g.appendChild(E('p', 'oa-hint',
      'Each endpoint walks its own path through the TCP state machine. The client actively opens ' +
      'and closes; the server passively responds. TIME_WAIT is the one that surprises people.'));
    host.appendChild(g);
  };
  StateFamily.prototype.buildStage = function (host) {
    this.stateHost = E('div');
    this.pathHost = E('div');
    host.appendChild(this.stateHost);
    host.appendChild(this.pathHost);
  };
  StateFamily.prototype.compute = function () {
    this.hs = handshake({ clientISN: 1000, serverISN: 5000, dataLen: this.dataLen });
    this.walk = stateWalk(this.hs);
    this.error = null;
    return this.walk.length;
  };
  StateFamily.prototype.render = function (idx) {
    var walk = this.walk;
    var cur = Math.min(idx, walk.length - 1);
    var frame = walk[cur];
    clear(this.stateHost);
    clear(this.pathHost);

    var states = E('div', 'tc-states');
    var c = E('div', 'tc-endpoint client');
    c.appendChild(E('h4', 'tc-head-c', 'Client'));
    c.appendChild(E('span', 'tc-statebadge', frame.client));
    var s = E('div', 'tc-endpoint server');
    s.appendChild(E('h4', 'tc-head-s', 'Server'));
    s.appendChild(E('span', 'tc-statebadge', frame.server));
    states.appendChild(c);
    states.appendChild(s);
    this.stateHost.appendChild(states);

    // the two paths taken so far, as pill trails
    var cPath = E('div', 'tc-statelist');
    var sPath = E('div', 'tc-statelist');
    for (var i = 0; i <= cur; i++) {
      cPath.appendChild(E('span', 'tc-stpill c', walk[i].client));
      sPath.appendChild(E('span', 'tc-stpill s', walk[i].server));
    }
    this.pathHost.appendChild(E('p', 'cy-pane-title', 'Client path'));
    this.pathHost.appendChild(cPath);
    this.pathHost.appendChild(E('p', 'cy-pane-title', 'Server path'));
    this.pathHost.appendChild(sPath);
  };
  StateFamily.prototype.note = function (idx) {
    var frame = this.walk[Math.min(idx, this.walk.length - 1)];
    var extra = '';
    if (frame.client === 'TIME_WAIT') {
      extra = ' TIME_WAIT lasts twice the maximum segment lifetime so a stray old segment cannot be ' +
        'mistaken for part of a new connection reusing the same ports.';
    } else if (frame.client === 'ESTABLISHED' && frame.server === 'ESTABLISHED') {
      extra = ' Both ends are open; data can flow in either direction.';
    }
    return frame.event + extra;
  };
  StateFamily.prototype.compare = function () {
    return {
      title: 'The states each end passes through',
      head: ['Step', 'Client', 'Server'],
      rows: this.walk.map(function (f, i) {
        return { key: 'w' + i, cells: [i + 1, f.client, f.server] };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — CONGESTION CONTROL                                           */
  /* ======================================================================== */

  var CONGESTION_PRESETS = [
    { label: 'Classic sawtooth', losses: [{ at: 8, kind: 'triple' }, { at: 20, kind: 'timeout' }, { at: 30, kind: 'triple' }] },
    { label: 'Only fast recovery', losses: [{ at: 8, kind: 'triple' }, { at: 16, kind: 'triple' }, { at: 24, kind: 'triple' }, { at: 32, kind: 'triple' }] },
    { label: 'A brutal timeout', losses: [{ at: 12, kind: 'timeout' }, { at: 28, kind: 'timeout' }] },
    { label: 'No loss', losses: [] }
  ];

  function CongestionFamily() {
    this.key = 'congestion';
    this.label = 'Congestion control';
    this.algoKey = 'reno';
    this.ssthresh = 16;
    this.capacity = 24;
    this.presetIdx = 0;
    this.lastIdx = 0;
  }
  CongestionFamily.prototype.algoOptions = function () { return [{ key: 'reno', label: 'TCP Reno' }]; };
  CongestionFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The link');
    g.appendChild(field('Initial ssthresh', numBox(this.ssthresh, 2, 40, function (v) { self.ssthresh = v; onChange(); })));
    g.appendChild(field('Capacity (MSS)', numBox(this.capacity, 6, 48, function (v) { self.capacity = v; onChange(); })));
    host.appendChild(g);
    var g2 = group('Loss pattern');
    g2.appendChild(selectBox(CONGESTION_PRESETS.map(function (p, i) { return { key: String(i), label: p.label }; }),
      '0', function (v) { self.presetIdx = parseInt(v, 10); onChange(); }));
    g2.appendChild(E('p', 'oa-hint',
      'A triple-duplicate ACK means one packet was lost but the pipe is flowing: cwnd halves. A ' +
      'timeout means the pipe may have emptied: cwnd collapses to 1. That difference is the whole ' +
      'shape of the sawtooth.'));
    host.appendChild(g2);
  };
  CongestionFamily.prototype.buildStage = function (host) {
    var self = this;
    this.topHost = E('div', 'ms-verdict');
    this.canvas = E('canvas', 'tc-canvas');
    this.canvas.id = 'viz-tcp-canvas';
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.canvas);
    host.appendChild(this.tableHost);
    window.addEventListener('resize', function () { self.draw(self.lastIdx); });
  };
  CongestionFamily.prototype.compute = function () {
    this.result = congestion({ rtts: 40, ssthresh: this.ssthresh, capacity: this.capacity,
      losses: CONGESTION_PRESETS[this.presetIdx].losses });
    this.error = null;
    return this.result.frames.length;
  };
  CongestionFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var res = this.result;
    var cur = Math.min(idx, res.frames.length - 1);
    var frame = res.frames[cur];
    clear(this.topHost);
    var phaseCls = frame.loss ? 'tc-phase-loss' : (frame.phase === 'slow start' ? 'tc-phase-ss' : 'tc-phase-ca');
    this.topHost.appendChild(E('span', 'tc-phase ' + phaseCls,
      frame.loss ? (frame.loss === 'triple' ? 'fast recovery' : 'timeout — reset') : frame.phase));
    this.topHost.appendChild(E('span', 'ms-ip', 'RTT ' + frame.rtt + ' · cwnd = ' + frame.cwnd +
      ' MSS · ssthresh = ' + frame.ssthresh));
    this.draw(idx);
    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Round trip', 'cwnd (MSS)', 'ssthresh', 'Phase', 'Segments delivered'],
      [[frame.rtt, frame.cwnd, frame.ssthresh, frame.phase, frame.delivered]]));
  };
  CongestionFamily.prototype.draw = function (idx) {
    var canvas = this.canvas, res = this.result;
    if (!canvas || !res || !canvas.clientWidth) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight || 320;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = CC.bg0;
    g.fillRect(0, 0, w, h);

    var padL = 34, padR = 14, padT = 16, padB = 24;
    var pw = w - padL - padR, ph = h - padT - padB;
    var frames = res.frames;
    var maxCwnd = res.capacity;
    frames.forEach(function (f) { if (f.cwnd > maxCwnd) maxCwnd = f.cwnd; });
    maxCwnd = Math.ceil(maxCwnd * 1.1);
    var n = frames.length - 1;
    function X(rtt) { return padL + (rtt / Math.max(1, n)) * pw; }
    function Y(cwnd) { return padT + ph - (cwnd / maxCwnd) * ph; }

    // gridlines + y axis
    g.font = '10px ' + FONT;
    g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(125,211,252,0.08)';
    g.fillStyle = CC.faint;
    for (var yv = 0; yv <= maxCwnd; yv += Math.ceil(maxCwnd / 6)) {
      g.beginPath(); g.moveTo(padL, Y(yv)); g.lineTo(w - padR, Y(yv)); g.stroke();
      g.textAlign = 'right';
      g.fillText(String(yv), padL - 5, Y(yv));
    }

    // capacity line
    g.strokeStyle = 'rgba(52,211,153,0.4)';
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(padL, Y(res.capacity)); g.lineTo(w - padR, Y(res.capacity)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = CC.green;
    g.textAlign = 'left';
    g.fillText('capacity', padL + 4, Y(res.capacity) - 8);

    var cur = Math.min(idx, frames.length - 1);

    // ssthresh trail
    g.strokeStyle = 'rgba(251,191,36,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    for (var i = 0; i <= cur; i++) {
      var x = X(frames[i].rtt), y = Y(frames[i].ssthresh);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();

    // cwnd curve, coloured by phase, up to the current frame
    g.lineWidth = 2;
    for (var j = 1; j <= cur; j++) {
      g.beginPath();
      g.strokeStyle = frames[j].loss ? CC.red : (frames[j].phase === 'slow start' ? CC.blue : CC.green);
      g.moveTo(X(frames[j - 1].rtt), Y(frames[j - 1].cwnd));
      g.lineTo(X(frames[j].rtt), Y(frames[j].cwnd));
      g.stroke();
    }
    // loss markers
    frames.forEach(function (f, i) {
      if (!f.loss || i > cur) return;
      g.beginPath();
      g.arc(X(f.rtt), Y(f.cwnd), 4, 0, Math.PI * 2);
      g.fillStyle = f.loss === 'timeout' ? CC.red : CC.amber;
      g.fill();
    });
    // current point
    var fc = frames[cur];
    g.beginPath();
    g.arc(X(fc.rtt), Y(fc.cwnd), 5, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();

    g.fillStyle = CC.faint;
    g.textAlign = 'center';
    g.fillText('round trips →', padL + pw / 2, h - 6);
    g.save();
    g.translate(11, padT + ph / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillText('cwnd (MSS)', 0, 0);
    g.restore();
  };
  CongestionFamily.prototype.note = function (idx) {
    return this.result.frames[Math.min(idx, this.result.frames.length - 1)].event;
  };
  CongestionFamily.prototype.compare = function () {
    var res = this.result;
    var firstCA = null, firstTriple = null, firstTimeout = null;
    res.frames.forEach(function (f) {
      if (firstCA === null && f.phase === 'congestion avoidance') firstCA = f.rtt;
      if (firstTriple === null && f.loss === 'triple') firstTriple = f;
      if (firstTimeout === null && f.loss === 'timeout') firstTimeout = f;
    });
    return {
      title: 'How each event changes the window',
      head: ['Event', 'Effect on cwnd', 'Effect on ssthresh', 'Phase after'],
      rows: [
        { key: 'ss', cells: ['Slow start (per RTT)', 'doubles', 'unchanged', 'slow start'] },
        { key: 'ca', cells: ['Congestion avoidance (per RTT)', '+1 MSS', 'unchanged', 'avoidance'] },
        { key: 'triple', cells: ['Triple-duplicate ACK', 'halves', 'set to cwnd/2', 'avoidance'] },
        { key: 'timeout', cells: ['Timeout', 'resets to 1', 'set to cwnd/2', 'slow start'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'tcpviz',
    mountId: 'viz-tcp-mount',
    name: 'The TCP visualiser',
    css: EXTRA_CSS,
    families: function () {
      return [new HandshakeFamily(), new StateFamily(), new CongestionFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

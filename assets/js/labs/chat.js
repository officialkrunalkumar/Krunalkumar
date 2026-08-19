/* ==========================================================================
   chat.js — a direct browser-to-browser channel, and a lesson about why it
   cannot work the way netcat does.
   --------------------------------------------------------------------------
   THE ONE LAB THAT TALKS TO THE NETWORK. Every other tool in /labs is built on
   tool-shell.js, whose promise is that nothing it touches opens a connection.
   This one obviously cannot live under that promise, so it does not use that
   shell and it says so on the page. The claim stays true everywhere else.

   Why there is no "listen on a port" here
   ---------------------------------------
   A browser cannot accept an incoming connection. There is no API for it —
   fetch, WebSocket, EventSource and RTCPeerConnection all dial out, and
   nothing accepts. That is deliberate: a page that could listen would turn
   every open tab into a reachable server, and any site you visited could
   scan or address it. So `nc -l -p 1234` has no browser equivalent, and both
   sides here are the dialling side.

   What replaces it
   ----------------
   WebRTC gives two browsers a real peer-to-peer pipe once they have somehow
   exchanged a description of themselves. Since neither can listen, that first
   exchange has to travel by some channel the two people already share — chat
   app, email, a QR code, reading it aloud. Two pastes, once, and after that
   the messages go straight from one machine to the other with nothing in
   between.

   Why the code is the length it is
   --------------------------------
   A full SDP offer runs to about 990 characters, but 14 of its 21 lines are
   byte-identical on every connection ever made, so they are never sent — see
   the codec below. What travels is the 74 bytes that actually vary, which
   comes out near 100 characters. That is still a paste rather than a code you
   read aloud: 56 of those bytes are cryptographic randomness, and no encoding
   gets below the entropy. Anything shorter would need a lookup service, and
   there is no server behind this site.

   STUN, and what it does not see
   ------------------------------
   On the same network this connects with no outside help at all. Across the
   internet each side has to discover its own public address, which is what a
   STUN server answers — a single question, not a relay. No message ever
   passes through it. Without a TURN server (which costs money to run) a
   minority of network pairs cannot be connected at all; when that happens the
   page says so plainly rather than spinning forever.
   ========================================================================== */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun.cloudflare.com:3478'] }
  ];

  /* A host holds one entry per guest; a guest holds exactly one, pointing at
     the host. Everything below is written against the list so the two roles
     share the same code path. */
  var peers = [];
  var role = null;          // 'host' | 'guest'
  var t0 = 0;
  var myName = '';
  var seen = {};            // message ids already shown, so a relay cannot loop

  function me() { return (el.nick.value || '').trim().slice(0, 24) || 'anonymous'; }
  function live() {
    for (var i = 0; i < peers.length; i++) {
      if (peers[i].chan && peers[i].chan.readyState === 'open') return true;
    }
    return false;
  }
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  var el = {
    pick: $('#chat-pick'), host: $('#chat-host'), guest: $('#chat-guest'),
    beHost: $('#chat-be-host'), beGuest: $('#chat-be-guest'),
    offerOut: $('#chat-offer-out'), answerIn: $('#chat-answer-in'),
    offerIn: $('#chat-offer-in'), answerOut: $('#chat-answer-out'),
    makeOffer: $('#chat-make-offer'), takeAnswer: $('#chat-take-answer'),
    makeAnswer: $('#chat-make-answer'),
    log: $('#chat-log'), form: $('#chat-form'), input: $('#chat-input'),
    send: $('#chat-send'), room: $('#chat-room'), status: $('#chat-status'),
    trace: $('#chat-trace'), cands: $('#chat-cands'),
    reset: $('#chat-reset'), nick: $('#chat-nick'),
    invite: $('#chat-invite'), roster: $('#chat-roster'),
    fileBtn: $('#chat-file-btn'), fileInput: $('#chat-file'),
    xferWrap: $('#chat-xfer'), xferBar: $('#chat-xfer-bar'), xferText: $('#chat-xfer-text'),
    avWrap: $('#chat-av'), localVid: $('#chat-local'), remoteVid: $('#chat-remote'),
    avVoice: $('#chat-voice'), avVideo: $('#chat-video'), avStop: $('#chat-av-stop')
  };

  if (!el.pick) return;

  /* ---------------------------------------------------------------------
     The connection inspector. This is the actual teaching surface: without
     it the page is a chat box, and with it you can watch the handshake.
     ------------------------------------------------------------------ */

  function trace(text, kind) {
    if (!el.trace) return;
    var line = document.createElement('div');
    line.className = 'chat-trace-line' + (kind ? ' is-' + kind : '');
    var t = ((performance.now() - t0) / 1000).toFixed(2);
    line.innerHTML = '<span class="chat-trace-t">' + t + 's</span> ' +
                     escapeHtml(text);
    el.trace.appendChild(line);
    el.trace.scrollTop = el.trace.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(text, cls) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.className = 'chat-status' + (cls ? ' is-' + cls : '');
  }

  var candCount = { host: 0, srflx: 0, relay: 0 };

  function noteCandidate(c) {
    // host      = an address on this machine's own network
    // srflx     = this machine's public address, as seen by the STUN server
    // relay     = a TURN server volunteering to forward traffic (none here)
    var m = /(^| )typ (\w+)/.exec(c.candidate || '');
    var typ = m ? m[2] : '?';
    if (candCount[typ] === undefined) candCount[typ] = 0;
    candCount[typ]++;
    if (el.cands) {
      el.cands.textContent = 'host ' + (candCount.host || 0) +
        ' · server-reflexive ' + (candCount.srflx || 0) +
        ' · relay ' + (candCount.relay || 0);
    }
    if (candCount[typ] === 1) {
      trace('first ' + typ + ' candidate — ' + ({
        host: 'an address on your own network',
        srflx: 'your public address, learned from STUN',
        relay: 'a TURN relay offered to forward traffic'
      }[typ] || 'unknown type'), 'cand');
    }
  }

  /* ---------------------------------------------------------------------
     The codec
     ---------------------------------------------------------------------
     An SDP offer for a data channel is ~990 characters, and 14 of its 21
     lines are identical on every connection anyone has ever made: the
     protocol version, the media line, the SCTP port, the bundle group. They
     carry no information, so they are not sent — they are rebuilt from the
     template below.

     What actually varies is 74 bytes: a 4-byte ICE ufrag, a 24-byte ICE
     password, the 32-byte SHA-256 fingerprint of the DTLS certificate, and
     one address and port per candidate. Those go on the wire and nothing
     else does.

     Gzipping the full SDP only saved 19%, because 60 of those 74 bytes are
     cryptographic randomness. You cannot compress random data — that is what
     random means. The saving has to come from not sending the boilerplate,
     and that is what this does: 805 characters becomes about 100.

     Layout, all big-endian:
       u8   version (1) with bit 7 set when this is an answer
       u8   len, then the ICE ufrag
       u8   len, then the ICE password
       32B  DTLS fingerprint, raw
       u8   candidate count, then for each:
              u8  kind — 0 IPv4 host, 1 IPv4 srflx, 2 IPv6 host,
                         3 IPv6 srflx, 4 hostname (mDNS, LAN only)
              address — 4 bytes, 16 bytes, or u8 length + UTF-8
              u16 port
     ------------------------------------------------------------------ */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function toB64(bytes) {
    var out = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      var run = bytes.length - i;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (run > 1) out += B64[(n >> 6) & 63];
      if (run > 2) out += B64[n & 63];
    }
    return out;
  }

  function fromB64(str) {
    str = String(str).replace(/[^A-Za-z0-9\-_]/g, '');
    var out = [], i;
    for (i = 0; i < str.length; i += 4) {
      var a = B64.indexOf(str[i]), b = B64.indexOf(str[i + 1]);
      var c = B64.indexOf(str[i + 2]), d = B64.indexOf(str[i + 3]);
      var n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
      out.push((n >> 16) & 255);
      if (c >= 0) out.push((n >> 8) & 255);
      if (d >= 0) out.push(n & 255);
    }
    return new Uint8Array(out);
  }

  function ipv4Bytes(ip) {
    var p = ip.split('.');
    if (p.length !== 4) return null;
    var out = [], i;
    for (i = 0; i < 4; i++) {
      var n = parseInt(p[i], 10);
      if (!(n >= 0 && n <= 255)) return null;
      out.push(n);
    }
    return out;
  }

  function ipv6Bytes(ip) {
    if (ip.indexOf(':') < 0) return null;
    var halves = ip.split('::');
    var head = halves[0] ? halves[0].split(':') : [];
    var tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
    var fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    var groups = head.concat(new Array(halves.length > 1 ? fill : 0).fill('0')).concat(tail);
    if (groups.length !== 8) return null;
    var out = [], i;
    for (i = 0; i < 8; i++) {
      var v = parseInt(groups[i] || '0', 16);
      if (isNaN(v)) return null;
      out.push((v >> 8) & 255, v & 255);
    }
    return out;
  }

  /* Pull the handful of fields worth sending out of a full SDP. */
  function distil(sdp, isAnswer) {
    var ufrag = (sdp.match(/a=ice-ufrag:(\S+)/) || [])[1] || '';
    var pwd = (sdp.match(/a=ice-pwd:(\S+)/) || [])[1] || '';
    var fpHex = ((sdp.match(/a=fingerprint:sha-256 (\S+)/i) || [])[1] || '').replace(/:/g, '');
    if (!ufrag || !pwd || fpHex.length !== 64) throw new Error('Unexpected SDP shape.');

    var bytes = [];
    bytes.push(1 | (isAnswer ? 128 : 0));
    bytes.push(ufrag.length);
    for (var i = 0; i < ufrag.length; i++) bytes.push(ufrag.charCodeAt(i));
    bytes.push(pwd.length);
    for (i = 0; i < pwd.length; i++) bytes.push(pwd.charCodeAt(i));
    for (i = 0; i < 64; i += 2) bytes.push(parseInt(fpHex.substr(i, 2), 16));

    var cands = [];
    var re = /a=candidate:\S+ \d+ (udp|UDP) \d+ (\S+) (\d+) typ (host|srflx)/g, m;
    while ((m = re.exec(sdp))) {
      var addr = m[2], port = parseInt(m[3], 10), typ = m[4];
      var v4 = ipv4Bytes(addr);
      if (v4) { cands.push({ kind: typ === 'host' ? 0 : 1, a: v4, port: port }); continue; }
      var v6 = ipv6Bytes(addr);
      if (v6) { cands.push({ kind: typ === 'host' ? 2 : 3, a: v6, port: port }); continue; }
      // an mDNS name: only meaningful on the same LAN, but that is exactly
      // where two people testing this together usually are
      var name = [];
      for (i = 0; i < addr.length && i < 255; i++) name.push(addr.charCodeAt(i));
      cands.push({ kind: 4, a: name, port: port, named: true });
    }
    if (cands.length > 8) cands = cands.slice(0, 8);

    bytes.push(cands.length);
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      bytes.push(c.kind);
      if (c.named) bytes.push(c.a.length);
      for (var j = 0; j < c.a.length; j++) bytes.push(c.a[j]);
      bytes.push((c.port >> 8) & 255, c.port & 255);
    }
    return new Uint8Array(bytes);
  }

  /* Rebuild a complete, valid SDP from those fields. */
  function rebuild(bytes) {
    var i = 0;
    var ver = bytes[i++];
    if ((ver & 127) !== 1) throw new Error('That code is from a different version of this page.');
    var isAnswer = !!(ver & 128);

    var n = bytes[i++], ufrag = '';
    while (n--) ufrag += String.fromCharCode(bytes[i++]);
    n = bytes[i++];
    var pwd = '';
    while (n--) pwd += String.fromCharCode(bytes[i++]);

    var fp = [];
    for (n = 0; n < 32; n++) {
      var h = bytes[i++].toString(16);
      fp.push(h.length === 1 ? '0' + h : h);
    }

    var count = bytes[i++], lines = [], k;
    for (k = 0; k < count; k++) {
      var kind = bytes[i++], addr;
      if (kind === 0 || kind === 1) {
        addr = bytes[i] + '.' + bytes[i + 1] + '.' + bytes[i + 2] + '.' + bytes[i + 3];
        i += 4;
      } else if (kind === 2 || kind === 3) {
        var parts = [];
        for (var g = 0; g < 8; g++) { parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16)); i += 2; }
        addr = parts.join(':');
      } else {
        var len = bytes[i++]; addr = '';
        while (len--) addr += String.fromCharCode(bytes[i++]);
      }
      var port = (bytes[i] << 8) | bytes[i + 1]; i += 2;
      var typ = (kind === 1 || kind === 3) ? 'srflx' : 'host';
      var proto = (kind === 2 || kind === 3) ? 'IP6' : 'IP4';
      // Priority only orders the attempts; any sane value connects.
      var prio = typ === 'host' ? 2130706431 : 1694498815;
      lines.push('a=candidate:' + (k + 1) + ' 1 udp ' + prio + ' ' + addr + ' ' + port +
                 ' typ ' + typ + (typ === 'srflx' ? ' raddr 0.0.0.0 rport 0' : '') +
                 ' generation 0 network-cost 999');
      if (proto === 'IP6') { /* the a= line carries the family implicitly */ }
    }

    // The 14 lines that never change, plus the four that do.
    var sdp = [
      'v=0',
      'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=extmap-allow-mixed',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:' + ufrag,
      'a=ice-pwd:' + pwd,
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 ' + fp.join(':').toUpperCase(),
      'a=setup:' + (isAnswer ? 'active' : 'actpass'),
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144'
    ].concat(lines).concat(['a=end-of-candidates']);

    return { sdp: sdp.join('\r\n') + '\r\n', t: isAnswer ? 'answer' : 'offer' };
  }

  function pack(sdp, isAnswer) {
    return Promise.resolve(toB64(distil(sdp, isAnswer)));
  }

  function unpack(code) {
    try {
      return Promise.resolve(rebuild(fromB64(code)));
    } catch (e) {
      return Promise.reject(new Error(
        'That does not look like a channel code from this page. ' +
        (e.message || '')));
    }
  }

  /* ---------------------------------------------------------------------
     Peer setup
     ------------------------------------------------------------------ */

  function build() {
    if (!t0) t0 = performance.now();
    var peer = { id: uid(), pc: null, chan: null, name: null };
    var pc = peer.pc = new RTCPeerConnection({ iceServers: ICE });
    peers.push(peer);

    pc.onicecandidate = function (e) {
      if (e.candidate) noteCandidate(e.candidate);
    };

    pc.ontrack = function (e) {
      // One remote stream; the far side sends audio and video on the same one.
      if (el.remoteVid && e.streams && e.streams[0]) {
        el.remoteVid.srcObject = e.streams[0];
        if (el.avWrap) el.avWrap.hidden = false;
        trace('receiving a ' + e.track.kind + ' track', 'good');
      }
    };

    pc.onnegotiationneeded = function () {
      // Adding a track after the channel is open means a second offer/answer.
      // With no signalling server there is nobody to carry it, so it has to
      // go down the data channel that is already open.
      if (!peer.chan || peer.chan.readyState !== 'open') return;
      if (peer.renegotiating) return;
      peer.renegotiating = true;
      pc.createOffer().then(function (o) {
        return pc.setLocalDescription(o);
      }).then(function () {
        send(peer, { k: 're-offer', sdp: pc.localDescription.sdp });
        trace('renegotiating over the open channel to add media');
      }).catch(function (err) {
        peer.renegotiating = false;
        trace('renegotiation failed: ' + err.message, 'bad');
      });
    };

    pc.onicegatheringstatechange = function () {
      trace('ICE gathering: ' + pc.iceGatheringState);
    };

    pc.oniceconnectionstatechange = function () {
      var s = pc.iceConnectionState;
      trace('ICE connection: ' + s, s === 'failed' ? 'bad' : '');
      if (s === 'failed') {
        setStatus('Could not connect', 'bad');
        // Honest about the limit rather than spinning forever.
        trace('Both sides gathered candidates but none of them could reach ' +
              'each other. This usually means one or both networks use a ' +
              'strict NAT that needs a TURN relay, which this lab does not ' +
              'have. Try it on a different network, or both on the same wifi.', 'bad');
      }
    };

    pc.onconnectionstatechange = function () {
      trace('connection: ' + pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        dropPeer(peer);
      }
      if (pc.connectionState === 'connected') {
        var pair = 'unknown';
        pc.getStats().then(function (stats) {
          stats.forEach(function (r) {
            if (r.type === 'candidate-pair' && r.state === 'succeeded') {
              stats.forEach(function (c) {
                if (c.id === r.localCandidateId) pair = c.candidateType;
              });
            }
          });
          if (pair !== 'unknown') {
            trace('carrying traffic over the "' + pair + '" path — ' +
                  (pair === 'host' ? 'straight across the local network'
                                   : 'directly between the two public addresses'), 'good');
          }
        });
      }
    };

    return peer;
  }

  function dropPeer(peer) {
    var i = peers.indexOf(peer);
    if (i >= 0) peers.splice(i, 1);
    if (peer.name) say('system', peer.name + ' left.');
    renderRoster();
    if (!live()) {
      setStatus('Nobody connected', 'bad');
      el.input.disabled = true;
      el.send.disabled = true;
    }
  }

  function wireChannel(peer, dc) {
    peer.chan = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;

    dc.onopen = function () {
      trace('data channel open — everything from here is peer to peer', 'good');
      setStatus('Connected', 'good');
      // That a connection succeeded, nothing about it. No names, no message
      // content, no addresses — none of that leaves the pair of browsers.
      if (typeof window.gtag === 'function') window.gtag('event', 'chat_peer_connected');
      el.input.disabled = false;
      el.send.disabled = false;
      if (el.fileBtn) el.fileBtn.disabled = false;
      if (el.avVoice) el.avVoice.disabled = false;
      if (el.avVideo) el.avVideo.disabled = false;
      // Names are exchanged over the channel itself; there is nowhere else to
      // put them, and it means a late joiner learns everyone's name too.
      send(peer, { k: 'hi', n: me() });
      if (role === 'host') {
        rosterBroadcast();
        if (el.invite) el.invite.hidden = false;
      }
      renderRoster();
    };

    dc.onclose = function () { dropPeer(peer); };

    dc.onmessage = function (e) {
      if (typeof e.data !== 'string') { onChunk(peer, e.data); return; }
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }

      if (msg.k === 're-offer') {
        peer.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
          .then(function () { return peer.pc.createAnswer(); })
          .then(function (a) { return peer.pc.setLocalDescription(a); })
          .then(function () {
            send(peer, { k: 're-answer', sdp: peer.pc.localDescription.sdp });
            trace('accepted the media renegotiation');
          }).catch(function (e2) { trace('re-offer failed: ' + e2.message, 'bad'); });
        return;
      }
      if (msg.k === 're-answer') {
        peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
          .then(function () {
            peer.renegotiating = false;
            trace('media negotiated', 'good');
          }).catch(function (e2) { trace('re-answer failed: ' + e2.message, 'bad'); });
        return;
      }
      if (msg.k === 'av-stop') {
        if (el.remoteVid) el.remoteVid.srcObject = null;
        say('system', (peer.name || 'They') + ' stopped their camera.');
        return;
      }

      if (msg.k === 'file-start') { fileStart(peer, msg); return; }
      if (msg.k === 'file-end') { fileEnd(peer); return; }
      if (msg.k === 'file-abort') { fileAbort(peer, msg.why); return; }

      if (msg.k === 'hi') {
        peer.name = String(msg.n || 'anonymous').slice(0, 24);
        say('system', peer.name + ' joined.');
        renderRoster();
        if (role === 'host') rosterBroadcast();
        return;
      }

      if (msg.k === 'roster') {
        peer.roster = msg.r || [];
        renderRoster();
        return;
      }

      if (msg.k === 'msg') {
        if (seen[msg.id]) return;      // already shown; do not echo it back out
        seen[msg.id] = 1;
        say('them', msg.t, msg.n);
        // The host is the only one that repeats anything. A guest never
        // forwards, so there is no way for a message to circle the room.
        if (role === 'host') relay(msg, peer);
      }
    };
  }

  function send(peer, obj) {
    if (peer.chan && peer.chan.readyState === 'open') {
      try { peer.chan.send(JSON.stringify(obj)); } catch (e) {}
    }
  }

  function relay(msg, from) {
    for (var i = 0; i < peers.length; i++) {
      if (peers[i] !== from) send(peers[i], msg);
    }
  }

  function rosterBroadcast() {
    if (role !== 'host') return;
    var names = [me()];
    for (var i = 0; i < peers.length; i++) {
      if (peers[i].name) names.push(peers[i].name);
    }
    for (var j = 0; j < peers.length; j++) send(peers[j], { k: 'roster', r: names });
  }

  function renderRoster() {
    if (!el.roster) return;
    var names;
    if (role === 'host') {
      names = [me() + ' (host)'];
      for (var i = 0; i < peers.length; i++) {
        if (peers[i].name) names.push(peers[i].name);
      }
    } else {
      names = (peers[0] && peers[0].roster) ? peers[0].roster.slice() : [me()];
    }
    el.roster.textContent = names.length > 1
      ? 'In the room: ' + names.join(', ')
      : 'Waiting for someone to join…';
  }

  function say(who, text, nick) {
    var row = document.createElement('div');
    row.className = 'chat-msg is-' + who;
    if (who === 'system') {
      row.textContent = text;
    } else {
      var name = document.createElement('span');
      name.className = 'chat-msg-who';
      name.textContent = who === 'me' ? me() : (nick || 'someone');
      var body = document.createElement('span');
      body.className = 'chat-msg-text';
      body.textContent = text;      // textContent, never innerHTML — this is
                                    // a stranger's input arriving over a wire
      row.appendChild(name);
      row.appendChild(body);
    }
    el.log.appendChild(row);
    el.log.scrollTop = el.log.scrollHeight;
  }

  /* Wait until every candidate is in, so one paste is genuinely complete. */
  function gathered(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') finish();
      });
      // Some networks never report complete; 4s of candidates is plenty.
      setTimeout(finish, 4000);
    });
  }

  /* ---------------------------------------------------------------------
     Host: the nearest thing to `nc -l -p 1234`
     ------------------------------------------------------------------ */

  var pendingHost = null;      // the guest whose answer we are waiting for

  function newInvite() {
    var peer = build();
    pendingHost = peer;
    el.offerOut.value = '';
    el.answerIn.value = '';
    setStatus('Making an invitation…', 'busy');
    wireChannel(peer, peer.pc.createDataChannel('chat', { ordered: true }));
    trace('created a data channel for this guest before the offer, so it is described in it');

    peer.pc.createOffer().then(function (offer) {
      return peer.pc.setLocalDescription(offer);
    }).then(function () { return gathered(peer.pc); }).then(function () {
      return pack(peer.pc.localDescription.sdp, false);
    }).then(function (code) {
      el.offerOut.value = code;
      trace('invitation ready: ' + code.length + ' characters', 'good');
      setStatus('Send this code, then paste their reply', 'busy');
    }).catch(fail);
  }

  el.beHost.addEventListener('click', function () {
    if (!requireName()) return;
    role = 'host';
    el.pick.hidden = true;
    el.host.hidden = false;
    trace('you are the side that opens the channel — the closest this gets to `nc -l -p 1234`');
    trace('everyone else will connect to you, and you will pass their messages on');
    newInvite();
    renderRoster();
  });

  if (el.invite) el.invite.addEventListener('click', newInvite);

  el.takeAnswer.addEventListener('click', function () {
    var code = el.answerIn.value.trim();
    if (!code || !pendingHost) return;
    var peer = pendingHost;
    setStatus('Connecting…', 'busy');
    unpack(code).then(function (obj) {
      if (obj.t !== 'answer') throw new Error('That is an invitation, not a reply.');
      trace('got their reply, ' + code.length + ' characters');
      return peer.pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp });
    }).then(function () {
      trace('remote description set — ICE will now try every pair of addresses');
    }).catch(fail);
  });

  /* ---------------------------------------------------------------------
     Guest: the nearest thing to `nc <host> 1234`
     ------------------------------------------------------------------ */

  var guestPeer = null;

  el.beGuest.addEventListener('click', function () {
    if (!requireName()) return;
    role = 'guest';
    el.pick.hidden = true;
    el.guest.hidden = false;
    setStatus('Paste the code you were sent', 'busy');
    guestPeer = build();
    trace('you are the side that joins — the closest this gets to `nc <host> 1234`');
    guestPeer.pc.ondatachannel = function (e) {
      trace('the host offered a data channel');
      wireChannel(guestPeer, e.channel);
    };
  });

  el.makeAnswer.addEventListener('click', function () {
    var code = el.offerIn.value.trim();
    if (!code || !guestPeer) return;
    var peer = guestPeer;
    setStatus('Answering…', 'busy');
    unpack(code).then(function (obj) {
      if (obj.t !== 'offer') throw new Error('That is a reply, not an invitation.');
      trace('read their invitation, ' + code.length + ' characters');
      return peer.pc.setRemoteDescription({ type: 'offer', sdp: obj.sdp });
    }).then(function () {
      return peer.pc.createAnswer();
    }).then(function (ans) {
      return peer.pc.setLocalDescription(ans);
    }).then(function () { return gathered(peer.pc); }).then(function () {
      return pack(peer.pc.localDescription.sdp, true);
    }).then(function (out) {
      el.answerOut.value = out;
      trace('reply ready: ' + out.length + ' characters — send it back', 'good');
      setStatus('Send your reply back', 'busy');
    }).catch(fail);
  });

  function requireName() {
    if (me() !== 'anonymous') { myName = me(); return true; }
    el.nick.focus();
    el.nick.classList.add('is-wanted');
    setStatus('Enter your name first', 'bad');
    window.setTimeout(function () { el.nick.classList.remove('is-wanted'); }, 1600);
    return false;
  }

  function fail(err) {
    trace('error: ' + (err && err.message ? err.message : err), 'bad');
    setStatus('Something went wrong', 'bad');
  }

  /* ---------------------------------------------------------------------
     Voice and video
     ---------------------------------------------------------------------
     One to one only, and the page says so rather than letting people find
     out. Relaying text costs the host nothing — it repeats a string. Relaying
     video is a different job: a browser cannot forward someone else's stream
     without decoding and re-encoding it, which is precisely what an SFU
     server exists to do. Without one, group video needs a full mesh, so three
     people is six code exchanges and four is twelve.

     Adding a track to a live connection triggers renegotiation — a second
     offer and answer. There is no signalling server to carry those, so they
     go down the data channel that is already open. That is the neat part: the
     channel bootstraps its own upgrade.
     ------------------------------------------------------------------ */

  var localStream = null;

  /* Chromium exposes document.featurePolicy; the renamed document.permissionsPolicy
     is not widely shipped yet. Where neither exists we cannot tell in advance and
     fall through to getUserMedia, which is the correct conservative answer. */
  function policyWithholds(feature) {
    var fp = document.featurePolicy || document.permissionsPolicy;
    try {
      return !!(fp && typeof fp.allowsFeature === 'function' && !fp.allowsFeature(feature));
    } catch (e) {
      return false;
    }
  }

  function startMedia(withVideo) {
    if (peers.length !== 1) {
      say('system', 'Voice and video are one-to-one only. Relaying video needs a ' +
                    'media server; relaying text does not.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('system', 'This browser will not give a page access to the camera or microphone. ' +
                    'getUserMedia also needs a secure context, so http:// pages other than ' +
                    'localhost are refused outright.');
      return;
    }

    // A Permissions-Policy header can withhold the camera from the page itself,
    // in which case the browser refuses before it ever asks the visitor — and
    // reports it as NotAllowedError, indistinguishable from "you clicked Block".
    // This site shipped `camera=(), microphone=()` for a while, an EMPTY
    // allowlist, which denies the feature to every origin including its own.
    // Worth naming precisely, because no amount of clicking Allow can fix it.
    var withheld = [];
    if (policyWithholds('microphone')) withheld.push('microphone');
    if (withVideo && policyWithholds('camera')) withheld.push('camera');
    if (withheld.length) {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'media_blocked', { reason: 'permissions_policy' });
      }
      say('system', 'This page is not permitted to use the ' + withheld.join(' or ') +
                    '. That is a Permissions-Policy header on the site, not a choice you ' +
                    'made — the browser refuses before asking, and granting permission ' +
                    'cannot override it.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false
    }).then(function (stream) {
      localStream = stream;
      if (el.localVid) el.localVid.srcObject = stream;
      if (el.avWrap) el.avWrap.hidden = false;
      var pc = peers[0].pc;
      stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
      trace('added ' + stream.getTracks().length + ' local track(s) — renegotiating', 'good');
      if (el.avStop) el.avStop.hidden = false;
      if (el.avVoice) el.avVoice.disabled = true;
      if (el.avVideo) el.avVideo.disabled = true;
      say('system', withVideo ? 'Camera and microphone on.' : 'Microphone on.');
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'media_start', { media: withVideo ? 'video' : 'voice' });
      }
    }).catch(function (err) {
      var name = err && err.name;
      var why =
        name === 'NotAllowedError'  ? 'permission was refused — either you or your browser ' +
                                      'blocked it, or a Permissions-Policy header withheld it' :
        name === 'NotFoundError'    ? 'no such device is attached' :
        name === 'NotReadableError' ? 'the device is attached but another application is holding it' :
        name === 'OverconstrainedError' ? 'no attached device matches the requested resolution' :
        (err && err.message) || name || 'unknown error';
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'media_blocked', { reason: name || 'unknown' });
      }
      say('system', 'Could not open the ' + (withVideo ? 'camera' : 'microphone') + ': ' + why + '.');
    });
  }

  function stopMedia() {
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    if (el.localVid) el.localVid.srcObject = null;
    for (var i = 0; i < peers.length; i++) send(peers[i], { k: 'av-stop' });
    if (el.avStop) el.avStop.hidden = true;
    if (el.avVoice) el.avVoice.disabled = false;
    if (el.avVideo) el.avVideo.disabled = false;
    say('system', 'Camera and microphone off.');
  }

  if (el.avVoice) el.avVoice.addEventListener('click', function () { startMedia(false); });
  if (el.avVideo) el.avVideo.addEventListener('click', function () { startMedia(true); });
  if (el.avStop) el.avStop.addEventListener('click', stopMedia);

  // Tracks keep the camera light on; releasing them on unload matters.
  window.addEventListener('pagehide', function () {
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
  });

  /* ---------------------------------------------------------------------
     Files
     ---------------------------------------------------------------------
     A DataChannel message caps at 256 KB, so a file goes across as a run of
     16 KB chunks between a JSON header and a JSON footer. 16 KB rather than
     the maximum because smaller chunks keep the progress bar honest and stay
     well inside every browser's SCTP limits.

     Two things decide whether a gigabyte is possible.

     Backpressure: the channel accepts writes far faster than it can send
     them, and the excess is queued in memory. Pushing a 1 GB file in a loop
     is a reliable way to kill the tab. So the sender pauses whenever the
     buffer passes LOW_WATER and waits for bufferedamountlow.

     Where it lands: assembling a gigabyte of chunks into a Blob needs a
     gigabyte of RAM. Chrome and Edge can hand out a writable file handle up
     front, and then each chunk goes straight to disk and memory never grows.
     Without that API the transfer is capped at 512 MB and held in memory,
     which is honest about what the browser can actually survive.
     ------------------------------------------------------------------ */

  var CHUNK = 16 * 1024;
  var LOW_WATER = 256 * 1024;
  var MAX_STREAMED = Infinity;                   // streaming to disk: no ceiling
  var MAX_BUFFERED = 512 * 1024 * 1024;          // what a Blob can survive

  function canStream() {
    return typeof window.showSaveFilePicker === 'function';
  }

  function fmtBytes(n) {
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = Math.min(u.length - 1, Math.floor(Math.log(n || 1) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function setProgress(label, done, total, started) {
    if (!el.xferWrap) return;
    el.xferWrap.hidden = false;
    var pct = total ? Math.min(100, done / total * 100) : 0;
    el.xferBar.style.width = pct.toFixed(1) + '%';
    var secs = (performance.now() - started) / 1000;
    var rate = secs > 0.4 ? done / secs : 0;
    var eta = rate > 0 && total > done ? Math.round((total - done) / rate) : null;
    el.xferText.textContent = label + ' — ' + fmtBytes(done) + ' of ' + fmtBytes(total) +
      ' (' + pct.toFixed(0) + '%)' +
      (rate ? ' · ' + fmtBytes(rate) + '/s' : '') +
      (eta !== null ? ' · ' + eta + 's left' : '');
  }

  /* ---- sending ---- */

  var sending = false;

  function sendFile(file) {
    if (sending) return;
    var targets = [];
    for (var i = 0; i < peers.length; i++) {
      if (peers[i].chan && peers[i].chan.readyState === 'open') targets.push(peers[i]);
    }
    if (!targets.length) return;

    var cap = canStream() ? MAX_STREAMED : MAX_BUFFERED;
    if (file.size > cap) {
      say('system', 'That file is ' + fmtBytes(file.size) + '. The limit here is ' +
        fmtBytes(cap) + (canStream() ? '.' :
        ' because this browser cannot stream to disk — Chrome or Edge can go far higher.'));
      return;
    }

    sending = true;
    var id = uid();
    var started = performance.now();
    trace('sending ' + file.name + ' (' + fmtBytes(file.size) + ') to ' +
          targets.length + ' peer' + (targets.length > 1 ? 's' : ''), 'good');

    for (i = 0; i < targets.length; i++) {
      send(targets[i], { k: 'file-start', id: id, name: file.name.slice(0, 120), size: file.size });
    }

    var offset = 0;
    var reader = new FileReader();

    function pump() {
      if (offset >= file.size) {
        for (var j = 0; j < targets.length; j++) send(targets[j], { k: 'file-end', id: id });
        setProgress('Sent ' + file.name, file.size, file.size, started);
        say('system', 'Sent ' + file.name + ' (' + fmtBytes(file.size) + ').');
        sending = false;
        window.setTimeout(function () { if (el.xferWrap) el.xferWrap.hidden = true; }, 4000);
        return;
      }
      // Wait for the queue to drain rather than piling a gigabyte into it.
      var busy = false;
      for (var t = 0; t < targets.length; t++) {
        if (targets[t].chan.bufferedAmount > LOW_WATER) busy = true;
      }
      if (busy) {
        targets[0].chan.addEventListener('bufferedamountlow', pump, { once: true });
        return;
      }
      reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK));
    }

    reader.onload = function (e) {
      var buf = e.target.result;
      for (var t = 0; t < targets.length; t++) {
        try { targets[t].chan.send(buf); } catch (err) {
          say('system', 'Transfer stopped: ' + (err.message || err));
          sending = false;
          return;
        }
      }
      offset += buf.byteLength;
      setProgress('Sending ' + file.name, offset, file.size, started);
      pump();
    };
    reader.onerror = function () {
      say('system', 'Could not read that file.');
      sending = false;
    };

    pump();
  }

  /* ---- receiving ---- */

  function fileStart(peer, msg) {
    var cap = canStream() ? MAX_STREAMED : MAX_BUFFERED;
    if (msg.size > cap) {
      send(peer, { k: 'file-abort', why: 'too large for the receiving browser' });
      say('system', 'Refused ' + msg.name + ': ' + fmtBytes(msg.size) + ' is over this browser\'s limit.');
      return;
    }
    peer.rx = {
      name: msg.name, size: msg.size, got: 0,
      started: performance.now(), parts: [], writer: null
    };
    say('system', (peer.name || 'They') + ' is sending ' + msg.name +
        ' (' + fmtBytes(msg.size) + ').');

    if (canStream()) {
      // Asking now means every chunk can go straight to disk.
      window.showSaveFilePicker({ suggestedName: msg.name })
        .then(function (handle) { return handle.createWritable(); })
        .then(function (w) {
          peer.rx.writer = w;
          for (var i = 0; i < peer.rx.parts.length; i++) w.write(peer.rx.parts[i]);
          peer.rx.parts = [];
        })
        .catch(function () {
          // Declined the dialog: fall back to memory, within the safe cap.
          if (msg.size > MAX_BUFFERED) {
            send(peer, { k: 'file-abort', why: 'no destination chosen' });
            fileAbort(peer, 'no destination chosen');
          }
        });
    }
  }

  function onChunk(peer, buf) {
    if (!peer.rx) return;
    peer.rx.got += buf.byteLength;
    if (peer.rx.writer) peer.rx.writer.write(buf);
    else peer.rx.parts.push(buf);
    setProgress('Receiving ' + peer.rx.name, peer.rx.got, peer.rx.size, peer.rx.started);
  }

  function fileEnd(peer) {
    var rx = peer.rx;
    if (!rx) return;
    peer.rx = null;

    var finish = function () {
      say('system', 'Received ' + rx.name + ' (' + fmtBytes(rx.got) + ').');
      window.setTimeout(function () { if (el.xferWrap) el.xferWrap.hidden = true; }, 4000);
    };

    if (rx.writer) {
      rx.writer.close().then(finish);
      return;
    }
    // Memory path: hand it over as a download link.
    var blob = new Blob(rx.parts);
    rx.parts = [];
    var url = URL.createObjectURL(blob);
    var row = document.createElement('div');
    row.className = 'chat-msg is-system';
    var a = document.createElement('a');
    a.href = url;
    a.download = rx.name;
    a.textContent = 'Download ' + rx.name + ' (' + fmtBytes(blob.size) + ')';
    a.className = 'chat-file-link';
    row.appendChild(a);
    el.log.appendChild(row);
    el.log.scrollTop = el.log.scrollHeight;
    finish();
  }

  function fileAbort(peer, why) {
    if (peer.rx && peer.rx.writer) { try { peer.rx.writer.abort(); } catch (e) {} }
    peer.rx = null;
    say('system', 'Transfer cancelled — ' + (why || 'the other side stopped'));
    if (el.xferWrap) el.xferWrap.hidden = true;
  }

  if (el.fileBtn && el.fileInput) {
    el.fileBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files && el.fileInput.files[0]) sendFile(el.fileInput.files[0]);
      el.fileInput.value = '';
    });
  }

  /* ---------------------------------------------------------------------
     Sending
     ------------------------------------------------------------------ */

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = el.input.value.trim();
    if (!text || !live()) return;
    if (text.length > 2000) text = text.slice(0, 2000);
    var msg = { k: 'msg', id: uid(), t: text, n: me() };
    seen[msg.id] = 1;
    for (var i = 0; i < peers.length; i++) send(peers[i], msg);
    say('me', text);
    el.input.value = '';
  });

  function closeAll() {
    for (var i = 0; i < peers.length; i++) {
      try { if (peers[i].chan) peers[i].chan.close(); } catch (e) {}
      try { peers[i].pc.close(); } catch (e) {}
    }
    peers = [];
  }

  el.reset.addEventListener('click', function () {
    closeAll();
    window.location.reload();
  });

  // Half-open peer connections should not outlive the page.
  window.addEventListener('pagehide', closeAll);

  /* ---------------------------------------------------------------------
     Copy buttons
     ---------------------------------------------------------------------
     lab-copy.js only decorates pre.lab-example blocks, which these are not —
     they are textareas holding a code to hand over. So they are wired here.
     ------------------------------------------------------------------ */

  function flashBtn(btn, text) {
    var was = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    window.setTimeout(function () {
      btn.textContent = was;
      btn.disabled = false;
    }, 1400);
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('[data-copy-target]'),
    function (btn) {
      btn.addEventListener('click', function () {
        var ta = document.getElementById(btn.getAttribute('data-copy-target'));
        if (!ta || !ta.value) { flashBtn(btn, 'Nothing yet'); return; }
        var done = function () { flashBtn(btn, 'Copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(done, function () {
            legacy(ta) ? done() : flashBtn(btn, 'Select and copy');
          });
        } else {
          legacy(ta) ? done() : flashBtn(btn, 'Select and copy');
        }
      });
    }
  );

  function legacy(ta) {
    // Clipboard API needs a secure context; this is the fallback on http.
    var ro = ta.readOnly;
    ta.readOnly = false;
    ta.select();
    ta.setSelectionRange(0, 999999);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.readOnly = ro;
    return ok;
  }

  /* ---------------------------------------------------------------------
     QR
     ---------------------------------------------------------------------
     Offered next to Copy rather than instead of it: on a laptop the clipboard
     is faster, and between two phones the camera is the only sane option.
     A ~240 character code lands at QR version 10, which is a 57x57 grid and
     scans comfortably from arm's length.
     ------------------------------------------------------------------ */

  Array.prototype.forEach.call(
    document.querySelectorAll('[data-qr-for]'),
    function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-qr-for');
        var ta = document.getElementById(id);
        var holder = document.querySelector('[data-qr-holder="' + id + '"]');
        if (!ta || !holder) return;
        if (!ta.value) { flashBtn(btn, 'Nothing yet'); return; }

        if (!holder.hidden) {
          holder.hidden = true;
          btn.textContent = 'Show QR';
          return;
        }
        if (!window.LabQR) { flashBtn(btn, 'QR unavailable'); return; }
        try {
          var info = window.LabQR.draw(holder.querySelector('canvas'), ta.value, {
            size: 300,
            dark: '#0b1120',
            light: '#f8fafc'
          });
          holder.hidden = false;
          btn.textContent = 'Hide QR';
          trace('QR drawn: version ' + info.version + ', ' +
                info.size + 'x' + info.size + ' modules, mask ' + info.mask);
        } catch (e) {
          flashBtn(btn, 'Too long for a QR');
        }
      });
    }
  );

  if (!window.RTCPeerConnection) {
    setStatus('This browser has no WebRTC', 'bad');
    el.pick.innerHTML = '<p class="chat-note">This browser does not support ' +
      'WebRTC, so there is no way to open a direct connection from it.</p>';
  }
}());

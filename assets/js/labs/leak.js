/* ==========================================================================
   leak.js — what this page can find out about you without asking.
   --------------------------------------------------------------------------
   Every number on this page is one any website can read. Nothing here is a
   trick or an exploit; it is ordinary web API output, which is the point. The
   value is in seeing it laid out at once rather than described.

   The WebRTC part is the one that surprises people. A page can open a peer
   connection to nobody at all, gather ICE candidates, and read your addresses
   out of them — your address on your own network, and the public address your
   router presents. That is how the "VPN leak" checkers work, and it needs no
   permission prompt because the API was designed for calling, not for asking.

   Browsers have pushed back: Chrome and Firefox now hide the local address
   behind a random .local mDNS name unless a site already has camera or
   microphone permission. Where you see one of those here, that defence is
   working. The public address is not hidden, and cannot be.

   Nothing is sent anywhere. Everything below is computed in the tab and
   thrown away when it closes — with the single exception of the STUN lookup,
   which is a question asked of a public server and is exactly what is being
   demonstrated.
   ========================================================================== */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  if (!$('#leak')) return;

  function row(table, label, value, note, flag) {
    var tr = document.createElement('tr');
    if (flag) tr.className = 'is-' + flag;
    var th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    var td = document.createElement('td');
    td.className = 'leak-value';
    td.textContent = value;
    var td2 = document.createElement('td');
    td2.className = 'leak-note';
    td2.textContent = note || '';
    tr.appendChild(th); tr.appendChild(td); tr.appendChild(td2);
    table.appendChild(tr);
  }

  /* ---------------------------------------------------------------------
     1. Addresses, via a peer connection that connects to nobody
     ------------------------------------------------------------------ */

  var addrTable = $('#leak-addr');
  var found = { local: [], public: [], mdns: [] };

  function renderAddresses(done) {
    addrTable.innerHTML = '';
    if (found.public.length) {
      found.public.forEach(function (a) {
        row(addrTable, 'Public address', a,
            'What every server you visit sees. If you are on a VPN and this is not the VPN’s address, the VPN is leaking.',
            'bad');
      });
    } else if (done) {
      row(addrTable, 'Public address', 'not discovered',
          'No STUN reply came back — a firewall may be blocking UDP.');
    }

    found.local.forEach(function (a) {
      row(addrTable, 'Address on your network', a,
          'Your machine’s address behind the router. A page has no business knowing this.',
          'bad');
    });

    found.mdns.forEach(function (a) {
      row(addrTable, 'Local address (hidden)', a,
          'Your browser replaced the real address with a random name. This defence is working.',
          'good');
    });

    if (done && !found.public.length && !found.local.length && !found.mdns.length) {
      row(addrTable, 'Nothing gathered', '—', 'WebRTC appears to be disabled or blocked here.', 'good');
    }
  }

  function probe() {
    if (!window.RTCPeerConnection) {
      row(addrTable, 'WebRTC', 'unavailable', 'This browser cannot be probed this way.', 'good');
      return;
    }
    var pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
    });
    // A data channel is needed only to make the browser bother gathering.
    pc.createDataChannel('probe');

    pc.onicecandidate = function (e) {
      if (!e.candidate) { renderAddresses(true); pc.close(); return; }
      var c = e.candidate.candidate || '';
      var m = /candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/.exec(c);
      if (!m) return;
      var addr = m[1], typ = m[2];
      var bucket = typ === 'srflx' || typ === 'relay' ? 'public'
                 : /\.local$/i.test(addr) ? 'mdns' : 'local';
      if (found[bucket].indexOf(addr) < 0) {
        found[bucket].push(addr);
        renderAddresses(false);
      }
    };

    pc.createOffer().then(function (o) { return pc.setLocalDescription(o); });
    window.setTimeout(function () { renderAddresses(true); try { pc.close(); } catch (e) {} }, 5000);
  }

  /* ---------------------------------------------------------------------
     2. The rest of it — all plain, permissionless reads
     ------------------------------------------------------------------ */

  function fingerprint() {
    var t = $('#leak-fp');
    var n = navigator;

    row(t, 'Browser', n.userAgent, 'Sent with every single request you make.');
    row(t, 'Platform', n.platform || n.userAgentData && n.userAgentData.platform || 'unknown',
        'Which operating system you are on.');
    row(t, 'Languages', (n.languages || [n.language]).join(', '),
        'Often enough on its own to narrow down where you are.');
    row(t, 'Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        'Your rough location, without any location permission.', 'bad');
    row(t, 'Screen', screen.width + ' × ' + screen.height + ' at ' +
        (window.devicePixelRatio || 1) + '×', 'Part of what makes a browser identifiable.');
    row(t, 'Window', window.innerWidth + ' × ' + window.innerHeight,
        'Changes as you resize, so it is weak on its own.');
    row(t, 'CPU cores', String(n.hardwareConcurrency || 'not exposed'),
        'How many threads your machine reports.');
    if (n.deviceMemory) {
      row(t, 'Memory', n.deviceMemory + ' GB or more', 'Rounded, but still a distinguishing number.');
    }
    row(t, 'Touch points', String(n.maxTouchPoints || 0), 'Phone, tablet or desktop.');
    row(t, 'Do Not Track', n.doNotTrack === '1' ? 'on' : 'off or unset',
        'Advisory only. Nothing is obliged to honour it, and most things do not.');
    row(t, 'Cookies', n.cookieEnabled ? 'enabled' : 'blocked', '');
    row(t, 'Colour scheme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        'A preference you never told this page.');
    row(t, 'Reduced motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'requested' : 'not requested',
        'An accessibility setting, readable by any page.');

    // Canvas fingerprint: the same drawing produces subtly different pixels on
    // different GPUs and drivers, and the hash of those pixels is stable.
    try {
      var cv = document.createElement('canvas');
      cv.width = 240; cv.height = 60;
      var ctx = cv.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 120, 30);
      ctx.fillStyle = '#069';
      ctx.fillText('Krunalkumar — fingerprint 🔒', 4, 8);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(0,120,255,0.6)';
      ctx.beginPath(); ctx.arc(60, 30, 24, 0, Math.PI * 2); ctx.fill();
      var data = cv.toDataURL();
      var h = 5381;
      for (var i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) >>> 0;
      row(t, 'Canvas fingerprint', h.toString(16),
          'The same drawing renders slightly differently on different hardware. This number is stable across visits and survives clearing cookies.', 'bad');
    } catch (e) { /* blocked, which is the good outcome */ }

    // WebGL says which GPU you have.
    try {
      var gl = document.createElement('canvas').getContext('webgl');
      var dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        row(t, 'Graphics card', gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
            'Your actual GPU model, readable without any permission.', 'bad');
      }
    } catch (e) {}

    // Storage estimate hints at how much of your disk the browser may use.
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        if (!est.quota) return;
        row(t, 'Storage available', (est.quota / 1073741824).toFixed(1) + ' GB',
            'How much this origin could store on your machine.');
      });
    }
  }

  probe();
  fingerprint();
}());

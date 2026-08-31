/* ==========================================================================
   web-layers.js — surface web, deep web, dark web: the three layers people
   name constantly and almost never define the same way twice.
   --------------------------------------------------------------------------
   The companion blog post is the narrative. This is the part you can poke.
   Three families over one small model:

     1. Where it lives  — type any address and the tool sorts it into surface,
                          deep or dark, and shows the specific signal that
                          decided it. String analysis only; see below.
     2. Onion routing   — a request through a three-relay circuit, one hop at
                          a time, with the layered encryption peeling off and
                          a per-relay panel of exactly what that relay knows.
                          Plus the onion-service variant, where neither end
                          learns the other's address.
     3. What is there   — a proportional read of what studies of onion sites
                          have actually found, next to what the phrase "dark
                          web" makes people picture.

   Decisions worth spelling out:

   1. The classifier makes no request. It cannot: a robots.txt, a noindex
      header and a login redirect are all things you learn by asking the
      server, and this page never asks anything. So it reads the string, and
      where the string cannot settle the question it says so instead of
      guessing. The one place it is authoritative is this site's own
      robots.txt, which is baked in below because I wrote it.

   2. Every onion and I2P address in here is deliberately impossible. Real
      v3 onion addresses are 56 base32 characters; the illustrative strings
      below contain hyphens and ordinary words, which are not valid in that
      label at all, so none of them can ever resolve. This lab explains the
      architecture. It is not a way in, and nothing here is a route.

   3. The third family shows ranges, not figures. Counts of onion sites
      disagree with each other by tens of percentage points depending on how
      the crawl was seeded, how long it ran and whether dead addresses were
      counted — so a single number would be a nicer picture and a worse
      answer. Anyone quoting you one decimal place is overstating what is
      measurable.

   Nothing here opens a network connection.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  CORE 1 — WHERE DOES THIS URL LIVE?                                      */
  /* ------------------------------------------------------------------------ */
  /*  A URL is sorted by running an ordered list of checks over the string     */
  /*  alone. The first check that settles the question wins; everything after  */
  /*  it is still listed, marked as not reached, because seeing which checks   */
  /*  never ran is half of understanding why the verdict came out as it did.   */
  /* ======================================================================== */

  /* This site's robots.txt, as it actually stands. Three prefixes are
     disallowed to every crawler, which makes them deep web on a site with no
     login anywhere in it — the cleanest demonstration I have of "deep" not
     meaning "sinister". */
  var OWN_HOSTS = ['krunalkumar.dpdns.org', 'www.krunalkumar.dpdns.org'];
  var OWN_DISALLOW = ['/partials/', '/assets/data/', '/scripts/'];

  var AUTH_PATHS = [
    '/login', '/signin', '/sign-in', '/log-in', '/account', '/accounts/',
    '/dashboard', '/admin', '/wp-admin', '/settings', '/portal', '/netbanking',
    '/internetbanking', '/inbox', '/my/', '/myaccount', '/billing', '/checkout',
    '/orders', '/profile/edit', '/manage/'
  ];
  var PAYWALL_PATHS = ['/subscriber', '/premium', '/members', '/member/', '/paywall'];
  var DOCKEY_PATHS = ['/document/d/', '/spreadsheets/d/', '/presentation/d/',
    '/file/d/', '/folders/', '/drive/'];
  var KEY_PARAMS = ['token', 'share', 'key', 'sig', 'signature', 'auth',
    'sessionid', 'session', 'access_token', 'invite'];
  var SEARCH_PARAMS = ['q', 'query', 'search', 's', 'keyword'];

  function lower(s) { return String(s || '').toLowerCase(); }

  /* Split a URL without new URL()'s insistence on a scheme, because people
     paste bare hosts and half-addresses and being pedantic at them is not
     teaching anything. A missing scheme is assumed to be https, and said so. */
  function parseUrl(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: false, reason: 'Nothing to read yet — type or pick an address.' };

    /* A colon alone is not enough to call something a scheme: "localhost:8080"
       and "example.com:443/x" both look exactly like one, and treating the host
       as the scheme sent them down the "not a web address" branch. So either the
       colon is followed by // or the word before it has to be a scheme that
       genuinely omits them. */
    var SCHEMELESS = ['mailto', 'magnet', 'tel', 'data', 'urn', 'sms', 'bitcoin'];
    var assumedScheme = false;
    var m = text.match(/^([a-z][a-z0-9+.-]*):(\/\/)?/i);
    if (m && !m[2] && SCHEMELESS.indexOf(lower(m[1])) < 0) m = null;
    var scheme;
    var rest;
    if (m) {
      scheme = lower(m[1]);
      rest = text.slice(m[0].length);
    } else {
      scheme = 'https';
      assumedScheme = true;
      rest = text.replace(/^\/\//, '');
    }

    var hash = '';
    var hi = rest.indexOf('#');
    if (hi >= 0) { hash = rest.slice(hi + 1); rest = rest.slice(0, hi); }
    var query = '';
    var qi = rest.indexOf('?');
    if (qi >= 0) { query = rest.slice(qi + 1); rest = rest.slice(0, qi); }

    var authority = rest;
    var path = '';
    var pi = rest.indexOf('/');
    if (pi >= 0) { authority = rest.slice(0, pi); path = rest.slice(pi); }
    if (!path) path = '/';

    var userinfo = '';
    var ai = authority.indexOf('@');
    if (ai >= 0) { userinfo = authority.slice(0, ai); authority = authority.slice(ai + 1); }

    var port = '';
    var host = authority;
    var pm = authority.match(/^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/);
    if (pm) { host = pm[1]; port = pm[2] || ''; }
    host = lower(host);

    if (!host) return { ok: false, reason: 'I cannot find a host in that. A URL needs one.' };

    /* A host is letters, digits, dots and hyphens — plus the bracketed form for
       IPv6 and non-ASCII for an internationalised name. Without this test a
       sentence typed into the box ("not a url") became a host, sailed through
       every check and came out labelled surface web with full confidence,
       which is exactly the guessing the rest of this file refuses to do. */
    if (!/^\[[^\]]*\]$/.test(host) && !/^[a-z0-9._\-¡-￿]+$/.test(host)) {
      return { ok: false, reason: 'That does not read as a host name — a host cannot contain spaces or ' +
        'punctuation like that, so there is nothing here to sort.' };
    }

    return {
      ok: true, scheme: scheme, assumedScheme: assumedScheme, host: host,
      port: port, path: path, query: query, hash: hash, userinfo: userinfo,
      raw: text
    };
  }

  function params(query) {
    var out = {};
    String(query || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      var k = lower(eq >= 0 ? pair.slice(0, eq) : pair);
      out[k] = eq >= 0 ? pair.slice(eq + 1) : '';
    });
    return out;
  }

  function isPrivateHost(host) {
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
        host === '[::1]') return 'a loopback address — it means "this machine"';
    if (/^10\./.test(host)) return 'inside 10.0.0.0/8, a private range';
    if (/^192\.168\./.test(host)) return 'inside 192.168.0.0/16, a private range';
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'inside 172.16.0.0/12, a private range';
    if (/^169\.254\./.test(host)) return 'a link-local address';
    if (/\.local$/.test(host)) return 'a .local name, resolved only on the local network';
    if (/\.(internal|intranet|corp|lan|home\.arpa)$/.test(host)) return 'a private-network suffix';
    return null;
  }

  function looksLikeKey(segment) {
    if (segment.length < 16) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) return false;
    var hasUpper = /[A-Z]/.test(segment);
    var hasDigit = /\d/.test(segment);
    // A long lowercase word ("documentation") is a slug; a long mixed-case,
    // digit-bearing run is an identifier somebody generated.
    return (hasUpper && hasDigit) || segment.length >= 28;
  }

  function classify(raw) {
    var url = parseUrl(raw);
    var checks = [];
    var verdict = null;
    var why = null;

    function add(spec) {
      if (verdict && !spec.always) {
        checks.push({ key: spec.key, label: spec.label, status: 'skipped',
          detail: 'Not reached — the address was already settled above.' });
        return;
      }
      checks.push(spec);
      if (spec.verdict) { verdict = spec.verdict; why = spec.why; }
    }

    if (!url.ok) {
      return {
        ok: false, url: null, checks: [{
          key: 'parse', label: 'Read the address', status: 'fail', detail: url.reason
        }], verdict: null, why: url.reason
      };
    }

    var q = params(url.query);
    var path = url.path;
    var lpath = lower(path);
    var segments = path.split('/').filter(function (s) { return s; });

    /* 1 — parse */
    add({
      key: 'parse', label: 'Read the address', status: 'info', always: true,
      detail: url.scheme + ':// · host ' + url.host + (url.port ? ':' + url.port : '') +
        ' · path ' + path + (url.query ? ' · query ?' + url.query : '') +
        (url.assumedScheme ? ' (no scheme given, so https was assumed)' : '')
    });

    /* 2 — special-use names. This is the only thing that makes something dark
       web, and it is a property of the name, not of the content. */
    if (/\.onion$/.test(url.host)) {
      add({
        key: 'special', label: 'Is the host a special-use name?', status: 'hit',
        verdict: 'dark',
        why: 'the host ends in .onion, a name that exists only inside Tor and that no ordinary DNS resolver will answer for',
        detail: '.onion is a special-use top-level domain reserved by RFC 7686. It is not in DNS, ' +
          'so no browser or crawler outside Tor can resolve it. The name is also the public key: ' +
          'reaching it and verifying it are the same act.'
      });
    } else if (/\.i2p$/.test(url.host)) {
      add({
        key: 'special', label: 'Is the host a special-use name?', status: 'hit',
        verdict: 'dark',
        why: 'the host ends in .i2p, an address that only resolves inside the I2P network',
        detail: 'I2P is a separate overlay network with its own naming. Like .onion it is invisible ' +
          'to DNS, so nothing on the ordinary web can follow a link to it.'
      });
    } else {
      add({
        key: 'special', label: 'Is the host a special-use name?', status: 'pass',
        detail: 'No .onion or .i2p suffix, so this is a name the ordinary DNS system can answer for. ' +
          'Whatever else it is, it is not dark web.'
      });
    }

    /* 3 — reachable at all? */
    var priv = isPrivateHost(url.host);
    if (priv) {
      add({
        key: 'reach', label: 'Is the host reachable from the public internet?', status: 'hit',
        verdict: 'deep',
        why: 'the host is ' + priv + ', so nothing outside that network can reach it, let alone index it',
        detail: 'A crawler on the public internet cannot open this at all. Your router’s admin page ' +
          'is the everyday example: deep web, sitting on your desk.'
      });
    } else {
      add({
        key: 'reach', label: 'Is the host reachable from the public internet?', status: 'pass',
        detail: 'A public name, so a crawler could at least try. Whether it gets anything back is the ' +
          'rest of these checks.'
      });
    }

    /* 4 — is it even a web address? */
    if (url.scheme !== 'http' && url.scheme !== 'https') {
      add({
        key: 'scheme', label: 'Is this a web address at all?', status: 'hit',
        verdict: 'deep',
        why: 'the scheme is ' + url.scheme + ':, which no web crawler follows',
        detail: 'Search engines index http and https. Anything else — ftp, magnet, ssh, a custom app ' +
          'scheme — is outside the web they crawl, so its contents are not in any index.'
      });
    } else {
      add({
        key: 'scheme', label: 'Is this a web address at all?', status: 'pass',
        detail: url.scheme + ' is a scheme crawlers follow.'
      });
    }

    /* 5 — this site's own robots.txt, which I can answer for honestly. */
    var isOwn = OWN_HOSTS.indexOf(url.host) >= 0;
    var blocked = null;
    if (isOwn) {
      OWN_DISALLOW.forEach(function (prefix) {
        if (lpath.indexOf(prefix) === 0) blocked = prefix;
      });
    }
    if (blocked) {
      add({
        key: 'robots', label: 'Does robots.txt disallow it?', status: 'hit',
        verdict: 'deep',
        why: 'this site’s robots.txt carries "Disallow: ' + blocked + '", so no well-behaved crawler will fetch it',
        detail: 'No login, no paywall, no secret — just a line in a text file. The page is served to ' +
          'you the moment you ask for it and will never appear in a search result. That is the deep ' +
          'web, on a personal site, with nothing hidden about it.'
      });
    } else if (isOwn) {
      add({
        key: 'robots', label: 'Does robots.txt disallow it?', status: 'pass',
        detail: 'This site disallows only /partials/, /assets/data/ and /scripts/. This path is not ' +
          'one of them, so crawlers are welcome to it.'
      });
    } else {
      add({
        key: 'robots', label: 'Does robots.txt disallow it?', status: 'unknown',
        detail: 'Cannot be decided from the string. robots.txt lives on the server and this page makes ' +
          'no requests, so for any host but my own the honest answer is that I do not know.'
      });
    }

    /* 6 — does the path only exist after a sign-in? */
    var authHit = null;
    AUTH_PATHS.forEach(function (p) { if (!authHit && lpath.indexOf(p) >= 0) authHit = p; });
    if (!authHit && /\/u\/\d+(\/|$)/.test(lpath)) authHit = '/u/<number>/';
    if (authHit) {
      add({
        key: 'auth', label: 'Does this path only exist after a sign-in?', status: 'hit',
        verdict: 'deep',
        why: 'the path contains "' + authHit + '", which is the shape of a page that is generated for one signed-in account',
        detail: 'A crawler arriving here has no session, so it is redirected to a login form or handed ' +
          'a 401. The page behind it is real and enormous — every statement, every message, every ' +
          'order — and none of it is in any index.'
      });
    } else {
      add({
        key: 'auth', label: 'Does this path only exist after a sign-in?', status: 'pass',
        detail: 'Nothing in the path reads as an account area. This is a heuristic on the string, not ' +
          'a check of the server.'
      });
    }

    /* 7 — paywall */
    var payHit = null;
    PAYWALL_PATHS.forEach(function (p) { if (!payHit && lpath.indexOf(p) >= 0) payHit = p; });
    if (payHit) {
      add({
        key: 'paywall', label: 'Is it behind a paywall?', status: 'hit',
        verdict: 'deep',
        why: 'the path contains "' + payHit + '", the shape of subscriber-only content',
        detail: 'Paywalls are the interesting edge. Many publishers let crawlers read the whole article ' +
          'so it can be indexed, then show you a wall — the page is in the index and still not readable. ' +
          'Others block the crawler too. From the address alone you cannot tell which, so this is a ' +
          'lean rather than a fact.'
      });
    } else {
      add({
        key: 'paywall', label: 'Is it behind a paywall?', status: 'pass',
        detail: 'No subscriber or members path segment.'
      });
    }

    /* 8 — an unguessable per-item key */
    var keyHit = null;
    DOCKEY_PATHS.forEach(function (p) { if (!keyHit && lpath.indexOf(p) >= 0) keyHit = 'the path segment "' + p + '"'; });
    if (!keyHit) {
      KEY_PARAMS.forEach(function (p) {
        if (!keyHit && Object.prototype.hasOwnProperty.call(q, p)) keyHit = 'the "' + p + '" parameter';
      });
    }
    if (!keyHit) {
      segments.forEach(function (s) {
        if (!keyHit && looksLikeKey(s)) keyHit = 'a generated-looking identifier in the path';
      });
    }
    if (keyHit) {
      add({
        key: 'key', label: 'Does the address carry a key you could not guess?', status: 'hit',
        verdict: 'deep',
        why: keyHit + ' is a per-item identifier, so the page exists only for whoever holds the link',
        detail: 'A document key is not a password, but it works like one: nothing links to it, nobody ' +
          'can enumerate it, and a crawler has no way to arrive. This is most of what people actually ' +
          'store in the deep web without ever calling it that.'
      });
    } else {
      add({
        key: 'key', label: 'Does the address carry a key you could not guess?', status: 'pass',
        detail: 'No document key, share token or session identifier in the address.'
      });
    }

    /* 9 — the output of a form */
    var searchHit = null;
    SEARCH_PARAMS.forEach(function (p) {
      if (!searchHit && Object.prototype.hasOwnProperty.call(q, p) && q[p] !== '') searchHit = p;
    });
    if (!searchHit && /\/search(\/|$)/.test(lpath) && url.query) searchHit = 'the /search path';
    if (searchHit) {
      add({
        key: 'form', label: 'Is this page the output of a form?', status: 'hit',
        verdict: 'deep',
        why: 'the address carries a search term (' + searchHit + '), so the page is generated on demand rather than sitting there to be found',
        detail: 'This is the original meaning of "deep web": pages that only exist once somebody fills ' +
          'in a form. A crawler follows links; it does not invent queries. Catalogues, timetables, ' +
          'court records and library indexes are all reachable only this way, and they dwarf the ' +
          'surface web.'
      });
    } else {
      add({
        key: 'form', label: 'Is this page the output of a form?', status: 'pass',
        detail: 'No query string that reads as a search.'
      });
    }

    /* 10 — the thing a string can never tell you */
    add({
      key: 'headers', label: 'Is there a noindex header or tag?', status: 'unknown', always: true,
      detail: 'Invisible from here, always. X-Robots-Tag and <meta name="robots" content="noindex"> ' +
        'both live in the response, and getting the response means making a request. A page can look ' +
        'entirely ordinary and still be excluded from every index by one header.'
    });

    if (!verdict) {
      verdict = 'surface';
      why = 'nothing in the address suggests a login, a key, a form or a special-use name, so a crawler ' +
        'that finds a link to it can fetch and index it';
    }

    return { ok: true, url: url, checks: checks, verdict: verdict, why: why };
  }

  /* ======================================================================== */
  /*  CORE 2 — ONION ROUTING                                                  */
  /* ------------------------------------------------------------------------ */
  /*  A circuit is a list of nodes; a walk is a list of legs between them.     */
  /*  `layers` on each frame is how many circuit layers are still wrapped      */
  /*  around the payload at that moment, which is the whole idea drawn as a    */
  /*  number.                                                                  */
  /* ======================================================================== */

  function standardCircuit(opts) {
    var https = opts.https !== false;
    var loggedIn = !!opts.loggedIn;

    var nodes = [
      { id: 'you', label: 'You', role: 'Your Tor client', kind: 'you' },
      { id: 'guard', label: 'Guard', role: 'Entry relay', kind: 'relay' },
      { id: 'middle', label: 'Middle', role: 'Middle relay', kind: 'relay' },
      { id: 'exit', label: 'Exit', role: 'Exit relay', kind: 'relay' },
      { id: 'site', label: 'The site', role: 'An ordinary website', kind: 'dest' }
    ];

    var knows = {
      you: {
        knows: ['Which site you asked for', 'What you sent', 'All three relays in your circuit'],
        blind: ['Nothing — you are the one party who sees the whole picture']
      },
      guard: {
        knows: ['Your real IP address', 'That you are using Tor', 'The middle relay it hands the cell to'],
        blind: ['Which site you are visiting', 'What you sent', 'Anything inside the two remaining layers']
      },
      middle: {
        knows: ['The guard it received from', 'The exit it forwards to'],
        blind: ['Your IP address', 'The destination', 'The content — it holds a cell it cannot open']
      },
      exit: {
        knows: ['The site you are visiting', 'The middle relay it received from',
          https ? 'That there is a TLS session to that site — but not what is inside it'
                : 'Everything you sent and everything that comes back, in the clear'],
        blind: ['Your IP address', 'Who you are', https ? 'The content, because HTTPS is still wrapped around it' : 'Nothing about the content — plain HTTP hides none of it']
      },
      site: {
        knows: ['The exit relay’s IP address, which it may recognise as Tor', 'What you sent',
          loggedIn ? 'Exactly who you are — you signed in' : 'Nothing that identifies you, unless something in the request does'],
        blind: loggedIn ? ['Your IP address — and it no longer matters, because you gave it your name']
                        : ['Your IP address', 'Your location']
      }
    };

    /* Each frame carries the exact stack of layers on the cell at that moment,
       outermost first. A layer is named for the relay whose key it is, which is
       the only labelling that stays true in both directions: on the way out you
       add the guard's layer and the guard removes it, and on the way back the
       guard adds it and you remove it. Deriving the stack at draw time from a
       single global list looked tidier and silently mislabelled the whole
       return path. */
    var G = 'the guard', M = 'the middle relay', X = 'the exit';

    var frames = [];
    frames.push({
      at: 'you', to: null, layers: 3, endToEnd: false, phase: 'build', layerNames: [G, M, X],
      event: 'Your client picks three relays and negotiates a separate key with each one, one hop at a ' +
        'time. Then it wraps the request in three layers — outermost for the guard, innermost for the ' +
        'exit. No relay ever learns more than one key.'
    });
    frames.push({
      at: 'you', to: 'guard', layers: 2, phase: 'forward', layerNames: [M, X],
      event: 'The guard receives the cell and removes the outer layer with its own key. It sees your IP ' +
        'address, because it is talking to you directly — and it sees an instruction to forward to the ' +
        'middle relay. That is all it can read.'
    });
    frames.push({
      at: 'guard', to: 'middle', layers: 1, phase: 'forward', layerNames: [X],
      event: 'The middle relay removes the next layer. It knows only the relay it received from and the ' +
        'relay it sends to. It has never seen your address and will never see the destination. This is ' +
        'the hop that makes the other two safe to run.'
    });
    frames.push({
      at: 'middle', to: 'exit', layers: 0, phase: 'forward', layerNames: [],
      event: 'The exit removes the last layer and finds a plain request for a website. It now knows ' +
        'where you are going. It does not know who asked — as far as it can tell, the middle relay did.'
    });
    frames.push({
      at: 'exit', to: 'site', layers: 0, phase: 'deliver', layerNames: [],
      event: https
        ? 'The exit opens the connection to the site. Because the site uses HTTPS, the exit is carrying a ' +
          'TLS session it cannot read — it knows the hostname and nothing else. The site sees a request ' +
          'from the exit relay’s IP address.'
        : 'The exit opens the connection to the site. There is no HTTPS, so the exit relay reads every ' +
          'byte in both directions and could rewrite any of it. Tor moved the risk from your ISP to a ' +
          'stranger volunteering bandwidth; it did not remove it.'
    });
    frames.push({
      at: 'site', to: 'exit', layers: 0, phase: 'return', layerNames: [],
      event: 'The site replies to the exit relay, because that is the only address it has. If you signed ' +
        'into an account, none of the relaying matters any more — you handed it your name yourself.'
    });
    frames.push({
      at: 'exit', to: 'middle', layers: 1, phase: 'return', layerNames: [X],
      event: 'On the way back each relay adds a layer instead of removing one. The exit encrypts the ' +
        'response with its key and passes it to the middle relay.'
    });
    frames.push({
      at: 'middle', to: 'guard', layers: 2, phase: 'return', layerNames: [M, X],
      event: 'The middle relay adds its layer. It still knows nothing about either end.'
    });
    frames.push({
      at: 'guard', to: 'you', layers: 3, phase: 'return', layerNames: [G, M, X],
      event: 'The guard adds the last layer and hands the cell to you. Your client holds all three keys, ' +
        'so it peels all three and reads the response. Only you ever had every key.'
    });

    return { mode: 'standard', nodes: nodes, knows: knows, frames: frames, https: https, loggedIn: loggedIn };
  }

  function onionServiceCircuit() {
    var nodes = [
      { id: 'you', label: 'You', role: 'Your Tor client', kind: 'you' },
      { id: 'g1', label: 'Guard', role: 'Your entry relay', kind: 'relay' },
      { id: 'm1', label: 'Middle', role: 'Your middle relay', kind: 'relay' },
      { id: 'rp', label: 'Rendezvous', role: 'A relay you both agreed on', kind: 'rendezvous' },
      { id: 'm2', label: 'Middle', role: 'The service’s middle relay', kind: 'relay' },
      { id: 'g2', label: 'Guard', role: 'The service’s entry relay', kind: 'relay' },
      { id: 'svc', label: 'The service', role: 'An onion service', kind: 'dest' }
    ];

    var knows = {
      you: {
        knows: ['The onion address you are visiting', 'Your own three relays', 'The content'],
        blind: ['Where the service is', 'What IP address it runs on', 'What country it is in']
      },
      g1: {
        knows: ['Your real IP address', 'That you are using Tor'],
        blind: ['The onion address', 'The content', 'That an onion service is involved at all']
      },
      m1: {
        knows: ['The two relays either side of it'],
        blind: ['Your address', 'The service', 'The content']
      },
      rp: {
        knows: ['That two circuits it cannot see into are being joined here'],
        blind: ['Your IP address', 'The service’s IP address', 'The onion address', 'The content']
      },
      m2: {
        knows: ['The two relays either side of it'],
        blind: ['Your address', 'The service’s address', 'The content']
      },
      g2: {
        knows: ['The service’s real IP address', 'That the service is speaking Tor'],
        blind: ['Your address', 'The onion address it fronts for', 'The content']
      },
      svc: {
        knows: ['The content of your request'],
        blind: ['Your IP address', 'Your location', 'Anything about you it did not ask you for directly']
      }
    };

    /* Two circuits, two sets of relays, one shared meeting point. See the note
       on layer naming in standardCircuit(). */
    var G1 = 'your guard', M1 = 'your middle relay', RP = 'the rendezvous point';
    var M2 = 'the service’s middle relay';

    var frames = [];
    frames.push({
      at: 'you', to: null, layers: 3, endToEnd: true, phase: 'build', layerNames: [G1, M1, RP],
      event: 'This is the case where neither end knows the other. You build a three-hop circuit to a ' +
        'relay you picked as a rendezvous point. The service, quite separately, builds its own three-hop ' +
        'circuit to the same relay. Six relays, two circuits, and one meeting place that knows neither ' +
        'of you.'
    });
    frames.push({
      at: 'you', to: 'g1', layers: 2, endToEnd: true, phase: 'forward', layerNames: [M1, RP],
      event: 'Your guard peels its layer. It sees your IP address and an instruction to forward. It does ' +
        'not know an onion service is involved.'
    });
    frames.push({
      at: 'g1', to: 'm1', layers: 1, endToEnd: true, phase: 'forward', layerNames: [RP],
      event: 'Your middle relay peels the next layer. Neither end, no content, as before.'
    });
    frames.push({
      at: 'm1', to: 'rp', layers: 0, endToEnd: true, phase: 'forward', layerNames: [],
      event: 'Your circuit ends here. The rendezvous point removes the last of your layers and finds — ' +
        'another encrypted blob. The innermost layer is keyed end to end between you and the service, ' +
        'and the rendezvous point does not have that key and never will.'
    });
    frames.push({
      at: 'rp', to: 'm2', layers: 1, endToEnd: true, phase: 'forward', layerNames: [RP],
      event: 'Now the cell travels backwards along the service’s own circuit, so each relay adds a ' +
        'layer rather than removing one. The service’s middle relay wraps it.'
    });
    frames.push({
      at: 'm2', to: 'g2', layers: 2, endToEnd: true, phase: 'forward', layerNames: [M2, RP],
      event: 'The service’s guard wraps it again. This relay knows the service’s real IP address — ' +
        'it is the one machine on the path that does — but not which onion address it fronts for, and ' +
        'not a byte of the content.'
    });
    frames.push({
      at: 'g2', to: 'svc', layers: 0, endToEnd: false, phase: 'deliver', layerNames: [],
      event: 'The service holds its own three keys, peels all three, then opens the end-to-end layer and ' +
        'reads your request. It has no idea where you are. You have no idea where it is. That symmetry ' +
        'is the entire architecture, and it is why the address is a public key rather than a name.'
    });
    frames.push({
      at: 'svc', to: 'you', layers: 3, endToEnd: true, phase: 'return', layerNames: [G1, M1, RP],
      event: 'The reply goes back the way it came, layer by layer, and arrives at you as the only party ' +
        'holding every key on your side.'
    });

    return { mode: 'onion', nodes: nodes, knows: knows, frames: frames, https: true, loggedIn: false };
  }

  var CAVEATS = [
    {
      title: 'Traffic correlation by somebody who can see both ends',
      body: 'Tor hides the link between you and the destination inside the network. It does not hide ' +
        'that you are sending, or that the destination is receiving. An adversary watching the traffic ' +
        'entering your guard and leaving the exit can line the two up on timing and volume alone. The ' +
        'Tor Project says plainly that it does not defend against this.'
    },
    {
      title: 'A malicious exit on unencrypted HTTP',
      body: 'The exit relay is the point where the traffic becomes ordinary internet traffic again. On ' +
        'plain HTTP it can read everything and change anything — inject, strip, redirect. Anyone can run ' +
        'an exit relay. HTTPS is what stops this, and Tor is not a substitute for it.'
    },
    {
      title: 'Browser fingerprinting',
      body: 'The circuit hides your address; it does nothing about your browser announcing its window ' +
        'size, fonts, language, timezone and extension list. Tor Browser exists precisely to make every ' +
        'user look like every other user. Pointing an ordinary browser at Tor keeps the fingerprint and ' +
        'throws away most of the benefit.'
    },
    {
      title: 'Logging in',
      body: 'Sign into an account and you have identified yourself directly, over the circuit, in the ' +
        'clear as far as the destination is concerned. No amount of relaying undoes that. The same goes ' +
        'for anything you type that only you would know.'
    }
  ];

  /* ======================================================================== */
  /*  CORE 3 — WHAT IS ACTUALLY DOWN THERE                                    */
  /* ------------------------------------------------------------------------ */
  /*  Ranges, not figures, and the ranges deliberately do not sum to 100.      */
  /*  Published counts of onion sites disagree with each other enormously      */
  /*  depending on how the crawl was seeded, how long it ran, whether dead     */
  /*  addresses were counted and who was doing the categorising. Drawing a     */
  /*  single number would look better and say less.                           */
  /* ======================================================================== */

  var VIEWS = {
    sites: {
      label: 'Onion sites, by what they host',
      unit: 'Measured as a share of the reachable onion addresses a crawl found.',
      caption: 'Counts of onion sites. Every published study disagrees with the others, which is the ' +
        'finding, not a flaw in the studies.',
      rows: [
        { name: 'Dead, empty, parked or unreachable', lo: 25, hi: 60, tone: 'grey',
          note: 'The largest single category in most crawls, and the one nobody expects. Onion services ' +
            'go offline constantly and the address lists that circulate are mostly stale.' },
        { name: 'Markets, drugs, fraud and stolen data', lo: 20, hi: 55, tone: 'red',
          note: 'Real, and the reason the phrase carries what it carries. The range is this wide because ' +
            'crawls seeded from index sites find far more of it than crawls seeded another way.' },
        { name: 'Scams and clones of other onion sites', lo: 10, hi: 40, tone: 'amber',
          note: 'Phishing copies of other onion services, built to intercept payments. A substantial ' +
            'slice of what looks like a criminal economy is criminals robbing each other.' },
        { name: 'Privacy, news, mirrors, forums, personal sites', lo: 5, hi: 25, tone: 'green',
          note: 'Whistleblowing drop boxes, censorship-resistant mirrors of ordinary news sites, ' +
            'technical forums, chat, and a long tail of people who simply wanted a server nobody could ' +
            'trivially locate.' },
        { name: 'Infrastructure nobody browses', lo: 5, hi: 20, tone: 'blue',
          note: 'Command-and-control for botnets, file drops, machine-to-machine endpoints. Not "sites" ' +
            'in any sense a person would recognise, but they are counted as such.' }
      ]
    },
    traffic: {
      label: 'Tor traffic, by where it goes',
      unit: 'Measured as a share of the traffic the Tor network itself carries.',
      caption: 'A different question with a much less contested answer — and the one that changes the ' +
        'picture most.',
      rows: [
        { name: 'Ordinary public websites, reached through an exit relay', lo: 93, hi: 99, tone: 'green',
          note: 'The overwhelming majority of what Tor carries is people reading the ordinary web: from ' +
            'countries that filter it, on networks that log it, or simply not wanting to be followed ' +
            'around. None of this is the dark web at all.' },
        { name: 'Onion services — the dark web proper', lo: 1, hi: 7, tone: 'red',
          note: 'By the Tor Project’s own published metrics this has sat in the low single digits for ' +
            'years. The layer that the entire phrase refers to is a rounding error in the traffic of the ' +
            'network it lives on.' }
      ]
    },
    assumed: {
      label: 'The picture the phrase carries',
      unit: 'Not a measurement of anything. It is a reference point, and nothing more.',
      caption: 'This panel is not data. It is what "dark web" tends to mean when it is used in a ' +
        'headline, drawn at the same scale so the gap is visible.',
      rows: [
        { name: 'Crime, and worse than crime', lo: 90, hi: 100, tone: 'red',
          note: 'The image is of a vast hidden marketplace, many times the size of the visible web, ' +
            'consisting of almost nothing else. Two of those three claims are wrong and the third is ' +
            'unmeasurable.' },
        { name: 'Anything else', lo: 0, hi: 10, tone: 'grey',
          note: 'In the popular framing there is nothing else, which is how a journalist’s secure drop ' +
            'box and a stolen-card market end up described with the same word.' }
      ]
    }
  };

  var LEGITIMATE = [
    ['SecureDrop', 'Whistleblower submission systems run as onion services by newspapers including ' +
      'The Guardian, The New York Times and The Washington Post', 'So a source can contact a newsroom ' +
      'without the newsroom — or anyone watching it — learning who they are'],
    ['BBC News', 'An official onion mirror of the news site, launched in 2019', 'To stay reachable from ' +
      'countries that block the ordinary domain'],
    ['ProPublica', 'The first major newsroom to publish a full onion version of its site, in 2016',
      'Same reason, plus not leaking which investigations a reader is following'],
    ['Debian and other software projects', 'Onion mirrors of package archives and websites',
      'So installing software does not require trusting the network you are on'],
    ['Ordinary Tor use', 'Reaching the normal web from a censored or monitored network',
      'This is what most Tor users are doing, and it involves no onion service at all']
  ];

  var CORE = {
    parseUrl: parseUrl, classify: classify,
    standardCircuit: standardCircuit, onionServiceCircuit: onionServiceCircuit,
    VIEWS: VIEWS, CAVEATS: CAVEATS, LEGITIMATE: LEGITIMATE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  var E = MV.el, clear = MV.clear, table = MV.table, button = MV.button;
  var group = MV.group, field = MV.field, selectBox = MV.selectBox, textBox = MV.textBox;
  var CC = MV.C, FONT = MV.FONT;

  var EXTRA_CSS = [
    /* --- family 1: the classifier --- */
    '.wl-verdict{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px;}',
    '.wl-badge{display:inline-block;padding:4px 13px;border-radius:7px;font-size:13px;font-weight:700;letter-spacing:.03em;}',
    '.wl-badge-surface{background:rgba(52,211,153,.16);color:' + CC.green + ';border:1px solid rgba(52,211,153,.5);}',
    '.wl-badge-deep{background:rgba(56,189,248,.16);color:' + CC.blue + ';border:1px solid rgba(56,189,248,.5);}',
    '.wl-badge-dark{background:rgba(167,139,250,.16);color:' + CC.violet + ';border:1px solid rgba(167,139,250,.5);}',
    '.wl-badge-none{background:rgba(252,165,165,.12);color:' + CC.red + ';border:1px solid rgba(252,165,165,.4);}',
    '.wl-why{flex:1 1 14rem;min-width:0;font-size:12px;line-height:1.6;color:#cbd5e1;}',
    '.wl-parts{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;}',
    '.wl-part{font-size:11px;padding:2px 8px;border-radius:6px;background:#0d1729;border:1px solid #24344f;color:' + CC.dim + ';word-break:break-all;}',
    '.wl-part b{color:' + CC.cyan + ';font-weight:700;}',
    '.wl-checks{list-style:none;margin:0;padding:0;}',
    '.wl-check{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid rgba(28,43,68,.7);}',
    '.wl-check:last-child{border-bottom:0;}',
    '.wl-check.future{opacity:.28;}',
    '.wl-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;margin-top:5px;background:' + CC.faint + ';}',
    '.wl-dot.info{background:' + CC.cyan + ';}',
    '.wl-dot.hit{background:' + CC.amber + ';}',
    '.wl-dot.pass{background:' + CC.green + ';}',
    '.wl-dot.unknown{background:' + CC.violet + ';}',
    '.wl-dot.fail{background:' + CC.red + ';}',
    '.wl-dot.skipped{background:#243450;}',
    '.wl-check-body{min-width:0;}',
    '.wl-check-label{margin:0;font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.wl-check-detail{margin:2px 0 0;font-size:11.5px;line-height:1.6;color:' + CC.dim + ';word-break:break-word;}',
    '.wl-examples{display:flex;flex-direction:column;gap:5px;margin-top:4px;}',
    '.wl-ex{text-align:left;font:inherit;font-size:11px;line-height:1.45;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 9px;cursor:pointer;}',
    '.wl-ex:hover{background:#213152;border-color:#40608f;}',
    '.wl-ex b{display:block;color:' + CC.cyan + ';font-weight:700;}',
    '.wl-ex span{color:' + CC.faint + ';word-break:break-all;}',

    /* --- family 2: the circuit --- */
    '.wl-circuit{display:flex;flex-wrap:wrap;align-items:stretch;gap:4px;margin-bottom:10px;}',
    '.wl-node{flex:1 1 5.6rem;min-width:5.2rem;font:inherit;text-align:center;cursor:pointer;padding:8px 5px;border-radius:9px;border:1px solid #24344f;background:#0d1729;color:' + CC.dim + ';}',
    '.wl-node:hover{border-color:#3b5b80;color:' + CC.ink + ';}',
    '.wl-node.sel{border-color:' + CC.cyan + ';background:rgba(125,211,252,.1);color:' + CC.ink + ';}',
    '.wl-node.active{border-color:' + CC.amber + ';box-shadow:inset 0 0 0 1px rgba(251,191,36,.35);}',
    '.wl-node-name{display:block;font-size:12px;font-weight:700;}',
    '.wl-node-role{display:block;font-size:10px;color:' + CC.faint + ';margin-top:2px;line-height:1.35;}',
    '.wl-node-you .wl-node-name{color:' + CC.blue + ';}',
    '.wl-node-dest .wl-node-name{color:' + CC.green + ';}',
    '.wl-node-rendezvous .wl-node-name{color:' + CC.violet + ';}',
    '.wl-onion{padding:9px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(2,6,23,.55);margin-bottom:10px;}',
    '.wl-onion-title{margin:0 0 7px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.wl-layer{padding:7px 9px;border-radius:9px;border:1px dashed rgba(125,211,252,.45);}',
    '.wl-layer + .wl-layer{margin-top:0;}',
    '.wl-layer-tag{display:block;font-size:10px;color:' + CC.cyan + ';margin-bottom:5px;}',
    '.wl-layer-e2e{border-style:solid;border-color:rgba(167,139,250,.6);}',
    '.wl-layer-e2e > .wl-layer-tag{color:' + CC.violet + ';}',
    '.wl-payload{padding:6px 9px;border-radius:7px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);font-size:11px;color:' + CC.green + ';}',
    '.wl-know{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:9px;padding:10px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(15,23,42,.5);margin-bottom:10px;}',
    '.wl-know h4{margin:0 0 5px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;}',
    '.wl-know-yes h4{color:' + CC.amber + ';}',
    '.wl-know-no h4{color:' + CC.green + ';}',
    '.wl-know ul{margin:0;padding-left:16px;font-size:11.5px;line-height:1.65;color:' + CC.dim + ';}',
    '.wl-know-head{grid-column:1/-1;margin:0;font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.wl-caveats{padding:10px 12px;border-left:3px solid ' + CC.amber + ';background:rgba(251,191,36,.06);border-radius:0 9px 9px 0;}',
    '.wl-caveats h4{margin:0 0 7px;font-size:12px;color:' + CC.amber + ';}',
    '.wl-caveats dl{margin:0;}',
    '.wl-caveats dt{font-size:11.5px;font-weight:700;color:#e8d5a8;margin-top:7px;}',
    '.wl-caveats dt:first-child{margin-top:0;}',
    '.wl-caveats dd{margin:2px 0 0;font-size:11px;line-height:1.65;color:#cbd5e1;}',

    /* --- family 3: the breakdown --- */
    '.wl-bars{display:flex;flex-direction:column;gap:9px;margin-bottom:10px;}',
    '.wl-bar{padding:8px 10px;border:1px solid ' + CC.line + ';border-radius:9px;background:rgba(15,23,42,.5);}',
    '.wl-bar.future{opacity:.22;}',
    '.wl-bar.cur{border-color:' + CC.cyan + ';}',
    '.wl-bar-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:12px;}',
    '.wl-bar-name{font-weight:700;color:' + CC.ink + ';}',
    '.wl-bar-range{color:' + CC.faint + ';white-space:nowrap;font-size:11px;}',
    '.wl-track{position:relative;height:12px;margin-top:6px;border-radius:6px;background:#0d1729;border:1px solid #1e2d47;overflow:hidden;}',
    '.wl-span{position:absolute;top:0;bottom:0;border-radius:5px;}',
    '.wl-span-red{background:rgba(252,165,165,.55);}',
    '.wl-span-amber{background:rgba(251,191,36,.5);}',
    '.wl-span-green{background:rgba(52,211,153,.5);}',
    '.wl-span-blue{background:rgba(56,189,248,.5);}',
    '.wl-span-grey{background:rgba(148,163,184,.4);}',
    '.wl-bar-note{margin:6px 0 0;font-size:11px;line-height:1.65;color:' + CC.dim + ';}',
    '.wl-scale{display:flex;justify-content:space-between;font-size:10px;color:' + CC.faint + ';margin-top:4px;}',
    '.wl-caption{margin:0 0 10px;font-size:11.5px;line-height:1.65;color:' + CC.faint + ';}'
  ].join('');

  /* ======================================================================== */
  /*  FAMILY 1 — WHERE DOES THIS URL LIVE?                                    */
  /* ======================================================================== */

  /* Every one of these is here to break an assumption, and between them they
     cover all three layers. The .onion and .i2p entries are impossible strings:
     hyphens and dictionary words are not valid in those labels, so neither can
     ever resolve anywhere. They are here to be classified, not visited. */
  var EXAMPLES = [
    { title: 'This site’s Labs page', url: 'https://krunalkumar.dpdns.org/labs' },
    { title: 'A partial on this very site', url: 'https://krunalkumar.dpdns.org/partials/header' },
    { title: 'A Google Docs link somebody sent you', url: 'https://docs.google.com/document/d/1QaZxSw2EdC3rFv4TgB5yHn6/edit' },
    { title: 'A bank dashboard, after signing in', url: 'https://secure.examplebank.com/netbanking/dashboard/accounts' },
    { title: 'Your own webmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
    { title: 'A search results page', url: 'https://example.com/search?q=stack+canary' },
    { title: 'Your router’s admin panel', url: 'http://192.168.1.1/setup' },
    { title: 'A subscriber-only article', url: 'https://news.example.com/2026/04/subscriber/the-story' },
    { title: 'An ordinary encyclopaedia article', url: 'https://en.wikipedia.org/wiki/Onion_routing' },
    { title: 'An onion address (fabricated — it cannot resolve)', url: 'http://this-is-not-a-real-address.onion/index' },
    { title: 'An I2P address (fabricated — it cannot resolve)', url: 'http://not-a-real-destination.i2p/' }
  ];

  var VERDICT_TEXT = {
    surface: 'Surface web',
    deep: 'Deep web',
    dark: 'Dark web'
  };

  function ClassifyFamily() {
    this.key = 'classify';
    this.label = 'Where does it live?';
    this.algoKey = 'string';
    this.value = EXAMPLES[0].url;
  }
  ClassifyFamily.prototype.algoOptions = function () {
    return [{ key: 'string', label: 'Classify from the address alone' }];
  };
  ClassifyFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The address');
    this.input = textBox(this.value, function (v) { self.value = v; onChange(); }, 'https://example.com/page');
    g.appendChild(this.input);
    g.appendChild(E('p', 'oa-hint',
      'Nothing is fetched. This reads the string on your own machine and makes no request of any kind — ' +
      'which is also its main limitation, and the checks say so where it bites.'));
    host.appendChild(g);

    var g2 = group('Try one of these');
    var list = E('div', 'wl-examples');
    EXAMPLES.forEach(function (ex) {
      var b = E('button', 'wl-ex');
      b.type = 'button';
      b.appendChild(E('b', null, ex.title));
      b.appendChild(E('span', null, ex.url));
      b.addEventListener('click', function () {
        self.value = ex.url;
        if (self.input) self.input.value = ex.url;
        onChange();
      });
      list.appendChild(b);
    });
    g2.appendChild(list);
    host.appendChild(g2);
  };
  ClassifyFamily.prototype.buildStage = function (host) {
    this.verdictHost = E('div');
    this.partsHost = E('div');
    this.checksHost = E('div');
    host.appendChild(this.verdictHost);
    host.appendChild(this.partsHost);
    host.appendChild(this.checksHost);
  };
  ClassifyFamily.prototype.compute = function () {
    this.result = classify(this.value);
    this.error = null;
    return this.result.checks.length;
  };
  ClassifyFamily.prototype.render = function (idx) {
    var res = this.result;
    var cur = Math.min(idx, res.checks.length - 1);
    var settled = res.ok && cur >= res.checks.length - 1;
    // The verdict is shown as soon as a check has actually decided it, not from
    // the first frame — the point of stepping is to watch it get decided.
    var decidedAt = -1;
    res.checks.forEach(function (c, i) { if (decidedAt < 0 && c.verdict) decidedAt = i; });
    var showVerdict = res.ok && ((decidedAt >= 0 && cur >= decidedAt) || settled);

    clear(this.verdictHost);
    var vwrap = E('div', 'wl-verdict');
    if (!res.ok) {
      vwrap.appendChild(E('span', 'wl-badge wl-badge-none', 'Cannot read that'));
      vwrap.appendChild(E('p', 'wl-why', res.why));
    } else if (showVerdict) {
      vwrap.appendChild(E('span', 'wl-badge wl-badge-' + res.verdict, VERDICT_TEXT[res.verdict]));
      vwrap.appendChild(E('p', 'wl-why', 'Because ' + res.why + '.'));
    } else {
      vwrap.appendChild(E('span', 'wl-badge wl-badge-none', 'Not decided yet'));
      vwrap.appendChild(E('p', 'wl-why',
        'Step forward, or press play, and watch which check settles it.'));
    }
    this.verdictHost.appendChild(vwrap);

    clear(this.partsHost);
    if (res.url) {
      var parts = E('div', 'wl-parts');
      [['scheme', res.url.scheme], ['host', res.url.host],
       ['port', res.url.port || '(default)'], ['path', res.url.path],
       ['query', res.url.query ? '?' + res.url.query : '(none)'],
       ['fragment', res.url.hash ? '#' + res.url.hash : '(none)']].forEach(function (p) {
        var chip = E('span', 'wl-part');
        chip.appendChild(E('b', null, p[0] + ' '));
        chip.appendChild(document.createTextNode(p[1]));
        parts.appendChild(chip);
      });
      this.partsHost.appendChild(parts);
    }

    clear(this.checksHost);
    var ul = E('ul', 'wl-checks');
    res.checks.forEach(function (c, i) {
      var li = E('li', 'wl-check' + (i > cur ? ' future' : ''));
      li.appendChild(E('span', 'wl-dot ' + c.status));
      var body = E('div', 'wl-check-body');
      body.appendChild(E('p', 'wl-check-label', c.label));
      body.appendChild(E('p', 'wl-check-detail', c.detail));
      li.appendChild(body);
      ul.appendChild(li);
    });
    this.checksHost.appendChild(ul);
  };
  ClassifyFamily.prototype.note = function (idx) {
    var res = this.result;
    var c = res.checks[Math.min(idx, res.checks.length - 1)];
    if (c.status === 'hit' && c.verdict) {
      return 'Settled: ' + VERDICT_TEXT[c.verdict] + '. ' + c.detail;
    }
    if (c.status === 'unknown') {
      return 'Undecidable from a string. ' + c.detail;
    }
    if (c.status === 'skipped') {
      return 'Skipped. Once a check settles the answer the rest do not run — but they are listed so you ' +
        'can see what was never asked.';
    }
    return c.detail;
  };
  ClassifyFamily.prototype.compare = function () {
    return {
      title: 'The three layers, defined by how you get in',
      head: ['Layer', 'What it means', 'How a crawler reaches it', 'Roughly how much'],
      rows: [
        { key: 'surface', cells: ['Surface web', 'Fetchable by anyone, linked to, indexable',
          'Follows a link and stores what it gets', 'The smallest of the three'] },
        { key: 'deep', cells: ['Deep web', 'Reachable, but not by a crawler — a login, a key, a form, a robots rule',
          'It does not; it has no session and no query to submit', 'Far larger than the surface web'] },
        { key: 'dark', cells: ['Dark web', 'A different network entirely, with its own naming',
          'It cannot resolve the name at all', 'A very small fraction of the deep web'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — ONION ROUTING                                                */
  /* ======================================================================== */

  function CircuitFamily() {
    this.key = 'circuit';
    this.label = 'Onion routing';
    this.algoKey = 'standard';
    this.https = true;
    this.loggedIn = false;
    this.selected = null;
    this.lastIdx = 0;
  }
  CircuitFamily.prototype.algoOptions = function () {
    return [
      { key: 'standard', label: 'Three relays to an ordinary site' },
      { key: 'onion', label: 'An onion service — neither end knows the other' }
    ];
  };
  CircuitFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The destination');
    g.appendChild(field('Site uses HTTPS', selectBox(
      [{ key: 'yes', label: 'yes' }, { key: 'no', label: 'no — plain HTTP' }],
      'yes', function (v) { self.https = (v === 'yes'); onChange(); })));
    g.appendChild(field('You signed into an account', selectBox(
      [{ key: 'no', label: 'no' }, { key: 'yes', label: 'yes' }],
      'no', function (v) { self.loggedIn = (v === 'yes'); onChange(); })));
    g.appendChild(E('p', 'oa-hint',
      'Both of these change what somebody learns, and neither of them is anything Tor controls. Flip ' +
      'them and watch the exit relay and the destination change what they know. In the onion-service ' +
      'mode there is no exit relay for them to affect.'));
    host.appendChild(g);

    var g2 = group('Reading the diagram');
    g2.appendChild(E('p', 'oa-hint',
      'Click any node to see exactly what that machine knows and what it does not. The dashed boxes are ' +
      'the layers of encryption; each relay can open exactly one of them.'));
    host.appendChild(g2);
  };
  CircuitFamily.prototype.buildStage = function (host) {
    this.circuitHost = E('div');
    this.onionHost = E('div');
    this.knowHost = E('div');
    host.appendChild(this.circuitHost);
    host.appendChild(this.onionHost);
    host.appendChild(this.knowHost);

    var cav = E('div', 'wl-caveats');
    cav.appendChild(E('h4', null, 'What this does not protect against'));
    var dl = E('dl');
    CAVEATS.forEach(function (c) {
      dl.appendChild(E('dt', null, c.title));
      dl.appendChild(E('dd', null, c.body));
    });
    cav.appendChild(dl);
    host.appendChild(cav);
  };
  CircuitFamily.prototype.compute = function () {
    this.circuit = this.algoKey === 'onion'
      ? onionServiceCircuit()
      : standardCircuit({ https: this.https, loggedIn: this.loggedIn });
    // A selection from the other mode does not exist in this one.
    var ids = this.circuit.nodes.map(function (n) { return n.id; });
    if (this.selected && ids.indexOf(this.selected) < 0) this.selected = null;
    this.error = null;
    return this.circuit.frames.length;
  };
  CircuitFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var self = this;
    var cir = this.circuit;
    var cur = Math.min(idx, cir.frames.length - 1);
    var frame = cir.frames[cur];
    // With nothing clicked, the panel follows the hop: whoever is receiving is
    // the machine you are being asked to think about.
    var focus = this.selected || frame.to || frame.at;

    clear(this.circuitHost);
    var row = E('div', 'wl-circuit');
    cir.nodes.forEach(function (n) {
      var b = E('button', 'wl-node wl-node-' + n.kind +
        (n.id === focus ? ' sel' : '') +
        (n.id === frame.at || n.id === frame.to ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', n.id === focus ? 'true' : 'false');
      b.appendChild(E('span', 'wl-node-name', n.label));
      b.appendChild(E('span', 'wl-node-role', n.role));
      b.addEventListener('click', function () {
        self.selected = (self.selected === n.id) ? null : n.id;
        self.render(self.lastIdx);
      });
      row.appendChild(b);
    });
    this.circuitHost.appendChild(row);

    /* The onion itself, drawn as nested boxes. Layers remaining is the number
       the model already tracks, so the picture cannot drift from the walk. */
    clear(this.onionHost);
    var box = E('div', 'wl-onion');
    box.appendChild(E('p', 'wl-onion-title',
      frame.layers === 0 && !frame.endToEnd
        ? 'No circuit layers left — this is the plain request'
        : frame.layers + (frame.layers === 1 ? ' circuit layer' : ' circuit layers') + ' still wrapped'));
    var inner = E('div', 'wl-payload', cir.mode === 'onion'
      ? 'Your request to the onion service'
      : (cir.https ? 'Your request, inside its own TLS session to the site'
                   : 'Your request, in the clear — the site does not use HTTPS'));
    if (frame.endToEnd) {
      var e2e = E('div', 'wl-layer wl-layer-e2e');
      e2e.appendChild(E('span', 'wl-layer-tag',
        'end-to-end, client ↔ service — no relay holds this key'));
      e2e.appendChild(inner);
      inner = e2e;
    }
    var names = frame.layerNames || [];
    // Built innermost first, so the last one wrapped ends up outermost — which
    // is the order the names arrive in.
    for (var i = names.length - 1; i >= 0; i--) {
      var wrapBox = E('div', 'wl-layer');
      wrapBox.appendChild(E('span', 'wl-layer-tag', 'sealed with ' + names[i] + '’s key'));
      wrapBox.appendChild(inner);
      inner = wrapBox;
    }
    box.appendChild(inner);
    this.onionHost.appendChild(box);

    clear(this.knowHost);
    var node = null;
    cir.nodes.forEach(function (n) { if (n.id === focus) node = n; });
    var k = cir.knows[focus];
    if (node && k) {
      var grid = E('div', 'wl-know');
      grid.appendChild(E('p', 'wl-know-head', node.label + ' — ' + node.role));
      var yes = E('div', 'wl-know-yes');
      yes.appendChild(E('h4', null, 'Knows'));
      var yesList = E('ul');
      k.knows.forEach(function (t) { yesList.appendChild(E('li', null, t)); });
      yes.appendChild(yesList);
      var no = E('div', 'wl-know-no');
      no.appendChild(E('h4', null, 'Does not know'));
      var noList = E('ul');
      k.blind.forEach(function (t) { noList.appendChild(E('li', null, t)); });
      no.appendChild(noList);
      grid.appendChild(yes);
      grid.appendChild(no);
      this.knowHost.appendChild(grid);
    }
  };
  CircuitFamily.prototype.note = function (idx) {
    var frame = this.circuit.frames[Math.min(idx, this.circuit.frames.length - 1)];
    return frame.event;
  };
  CircuitFamily.prototype.compare = function () {
    var cir = this.circuit;
    return {
      title: 'Who learns what, along the whole path',
      head: ['Machine', 'Knows your address?', 'Knows the destination?', 'Can read the content?'],
      rows: cir.nodes.map(function (n) {
        var k = cir.knows[n.id];
        var joined = k.knows.join(' | ').toLowerCase();
        var yourAddr = n.id === 'you' ? 'it is you'
          : (joined.indexOf('your real ip') >= 0 ? 'yes' : 'no');
        var dest;
        if (n.id === 'you') dest = 'yes';
        else if (n.kind === 'dest') dest = 'it is the destination';
        else if (n.id === 'exit') dest = 'yes';
        else dest = 'no';
        var content;
        if (n.id === 'you' || n.kind === 'dest') content = 'yes';
        else if (n.id === 'exit') content = cir.https ? 'no — HTTPS' : 'yes — plain HTTP';
        else content = 'no';
        return { key: n.id, cells: [n.label + ' (' + n.role + ')', yourAddr, dest, content] };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — WHAT IS ACTUALLY DOWN THERE                                  */
  /* ======================================================================== */

  function BreakdownFamily() {
    this.key = 'breakdown';
    this.label = 'What is actually there';
    this.algoKey = 'sites';
  }
  BreakdownFamily.prototype.algoOptions = function () {
    return [
      { key: 'sites', label: VIEWS.sites.label },
      { key: 'traffic', label: VIEWS.traffic.label },
      { key: 'assumed', label: VIEWS.assumed.label }
    ];
  };
  BreakdownFamily.prototype.buildPanel = function (host) {
    var g = group('About these numbers');
    g.appendChild(E('p', 'oa-hint',
      'Every bar is a range, and the ranges do not add up to a hundred. That is deliberate. Published ' +
      'counts of onion sites disagree with each other by tens of percentage points depending on how the ' +
      'crawl was seeded, how long it ran, whether dead addresses were counted and who did the ' +
      'categorising. A single figure would look better and tell you less.'));
    g.appendChild(E('p', 'oa-hint',
      'Switch to the traffic view. It asks a different question, has a much less contested answer, and ' +
      'changes the picture more than anything else on this page.'));
    host.appendChild(g);
  };
  BreakdownFamily.prototype.buildStage = function (host) {
    this.captionHost = E('div');
    this.barsHost = E('div', 'wl-bars');
    host.appendChild(this.captionHost);
    host.appendChild(this.barsHost);
  };
  BreakdownFamily.prototype.compute = function () {
    this.view = VIEWS[this.algoKey] || VIEWS.sites;
    this.error = null;
    return this.view.rows.length;
  };
  BreakdownFamily.prototype.render = function (idx) {
    var view = this.view;
    var cur = Math.min(idx, view.rows.length - 1);

    clear(this.captionHost);
    this.captionHost.appendChild(E('p', 'wl-caption', view.caption));
    this.captionHost.appendChild(E('p', 'wl-caption', view.unit));

    clear(this.barsHost);
    view.rows.forEach(function (r, i) {
      var bar = E('div', 'wl-bar' + (i > cur ? ' future' : (i === cur ? ' cur' : '')));
      var head = E('div', 'wl-bar-head');
      head.appendChild(E('span', 'wl-bar-name', r.name));
      head.appendChild(E('span', 'wl-bar-range', r.lo + '–' + r.hi + '%'));
      bar.appendChild(head);
      var track = E('div', 'wl-track');
      var span = E('div', 'wl-span wl-span-' + r.tone);
      span.style.left = r.lo + '%';
      span.style.width = Math.max(1, r.hi - r.lo) + '%';
      track.appendChild(span);
      bar.appendChild(track);
      var scale = E('div', 'wl-scale');
      scale.appendChild(E('span', null, '0%'));
      scale.appendChild(E('span', null, '100%'));
      bar.appendChild(scale);
      bar.appendChild(E('p', 'wl-bar-note', r.note));
      this.barsHost.appendChild(bar);
    }, this);
  };
  BreakdownFamily.prototype.note = function (idx) {
    var view = this.view;
    var r = view.rows[Math.min(idx, view.rows.length - 1)];
    var tail = ' The bar is drawn from ' + r.lo + '% to ' + r.hi + '% because that is the spread across ' +
      'published estimates, not because the answer sits anywhere in particular inside it.';
    if (this.algoKey === 'assumed') {
      tail = ' This panel is not a measurement and is drawn only so the gap against the other two views ' +
        'is visible at the same scale.';
    }
    return r.name + ': ' + r.note + tail;
  };
  BreakdownFamily.prototype.compare = function () {
    return {
      title: 'Named things that live there, and why',
      head: ['What', 'Who runs it', 'Why an onion address rather than a normal one'],
      rows: LEGITIMATE.map(function (l, i) {
        return { key: 'l' + i, cells: [l[0], l[1], l[2]] };
      })
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'weblayersviz',
    mountId: 'viz-weblayers-mount',
    name: 'The web layers explainer',
    css: EXTRA_CSS,
    families: function () {
      return [new ClassifyFamily(), new CircuitFamily(), new BreakdownFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

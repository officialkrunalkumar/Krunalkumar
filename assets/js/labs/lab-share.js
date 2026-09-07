/* ==========================================================================
   lab-share.js — hands one editor to another person, as a link.
   --------------------------------------------------------------------------
   The gap this fills: two people looking at the same problem, one of whom has
   the program. There is no account here, no saved workspace and no server to
   post a snippet to, so the only way to get code from one machine to the other
   was to select it by hand and paste it into a chat window — which mangles
   indentation, and is miserable on a phone.

   THE CODE TRAVELS IN THE FRAGMENT, never in the query string. Everything
   after the '#' is stripped by the browser before the request goes out: it is
   not in the URL Vercel receives, not in an access log, not in a CDN cache
   key, and not in a Referer header. A '?c=...' would be in all four. That
   distinction is the whole reason this feature can exist on these pages at
   all — the consent gate promises that nothing is uploaded, logged or stored
   by us, and a fragment keeps that promise literally true. Every link is made
   and read entirely inside the two browsers.

   The cost is length, so the payload is deflated before it is base64'd:
   CompressionStream is native in every browser that can run these labs (and
   needs no CSP change, unlike a compression library from a CDN). Measured on
   60 lines of real source: 3,951 characters of URL as plain base64, 1,835
   deflated first.

     s1=<base64url>   deflate-raw, then base64url   — what this writes
     s0=<base64url>   base64url of the plain JSON   — no CompressionStream

   A reader accepts both. The number is the encoding, not a version of the
   tool, so an old link stays readable when a new encoding is added.

   WHAT AN EXPIRY IS AND IS NOT. A link can carry a "stop working after" time,
   and the page that opens it refuses to load the program once that time has
   passed. Be clear about what that can mean with no server in the picture:
   the code is IN the link, so an expiry is this page declining to open it,
   not the code being deleted or recalled. It cannot reach into a group chat
   and unsend the message; anyone who opened the link in time already has what
   they read; and a determined reader could decode the fragment by hand or set
   their own clock back. It is hygiene — a link pasted into a chat stops being
   a live handout — and the panel says so in those words rather than promising
   a security property it cannot deliver. Real enforcement needs a server, and
   a server would mean the code genuinely leaves the machine.

   IT DOES NOT RUN THE INCOMING PROGRAM. Someone else's code arrives in the
   editor, where it can be read, and the Run button stays exactly where it was
   — one deliberate press away. Nor is any of this live collaboration: two
   people cannot type into the same editor, because that needs a relay server
   too. A link is a snapshot, passed by hand.
   ========================================================================== */

/* global LAB_RUNTIMES, LabApp */
(function () {
  'use strict';

  var lab = document.getElementById('lab');
  if (!lab) return;

  var DEFLATED = 's1';
  var PLAIN = 's0';

  // Encoded characters we are willing to hand out. Nothing in the pipe needs
  // this bound: browsers take URLs tens of thousands of characters long, and
  // the server never sees the fragment at all. It exists for the chat app in
  // the middle — some truncate or linkify only the first couple of thousand
  // characters, and a link cut in half decodes to nothing at the far end,
  // which is a worse outcome than a refusal with a reason.
  //
  // Measured at 8,000: 265 to 371 lines of real code, about 15 KB of source,
  // and still 119 lines of text that will not compress at all. WhatsApp,
  // Slack, Telegram and Discord all carry that comfortably.
  var MAX_LINK = 8000;
  // Twice what we write, so a link made by an older or hand-edited build still
  // opens rather than being refused on length alone.
  var MAX_READ = 16000;
  // Ceiling on the DECOMPRESSED bytes. Deflate is happy to turn 30 bytes into
  // a gigabyte of zeros, and a link is attacker-supplied by definition, so the
  // stream is read in chunks and abandoned the moment it passes this.
  var MAX_BYTES = 256 * 1024;

  var CAN_ZIP = typeof CompressionStream === 'function' &&
                typeof DecompressionStream === 'function';

  var el = {
    btn: document.getElementById('lab-share'),
    panel: document.getElementById('lab-share-panel'),
    mins: document.getElementById('lab-share-mins'),
    custom: document.getElementById('lab-share-custom')
  };

  /* ------------------------------------------------------------------ bytes */

  function toB64url(bytes) {
    // String.fromCharCode.apply blows the argument limit somewhere around a
    // hundred thousand, so feed it in blocks.
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64url(text) {
    var b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var raw = atob(b64);            // throws on anything that is not base64
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  /* Read a whole stream, refusing to hold more than `cap` bytes. */
  function readAll(stream, cap) {
    var reader = stream.getReader();
    var parts = [];
    var total = 0;

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          var out = new Uint8Array(total);
          var at = 0;
          parts.forEach(function (part) { out.set(part, at); at += part.length; });
          return out;
        }
        total += chunk.value.length;
        if (total > cap) {
          reader.cancel();
          throw new Error('payload too large');
        }
        parts.push(chunk.value);
        return pump();
      });
    }

    return pump();
  }

  function through(mode, bytes) {
    var ts = mode === 'in' ? new DecompressionStream('deflate-raw')
                           : new CompressionStream('deflate-raw');
    var writer = ts.writable.getWriter();
    // The reader below is what reports failure; these two would otherwise
    // reject a second time with nobody listening.
    writer.write(bytes).catch(function () {});
    writer.close().catch(function () {});
    return readAll(ts.readable, MAX_BYTES);
  }

  /* --------------------------------------------------------------- envelope */

  function encode(payload) {
    var bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (!CAN_ZIP) return Promise.resolve({ key: PLAIN, text: toB64url(bytes) });
    return through('out', bytes).then(function (zipped) {
      return { key: DEFLATED, text: toB64url(zipped) };
    });
  }

  function decode(link) {
    return Promise.resolve().then(function () {
      var bytes = fromB64url(link.text);
      if (link.key !== DEFLATED) return bytes;
      if (!CAN_ZIP) throw new Error('this browser cannot read a compressed link');
      return through('in', bytes);
    }).then(function (bytes) {
      return JSON.parse(new TextDecoder().decode(bytes));
    });
  }

  /* ------------------------------------------------------------------- hash */

  /* Runs while the script is parsed, BEFORE lab-app.js — see the LabShare
     export at the bottom of this file for why the answer has to be ready that
     early. Deliberately strict: a page anchor such as #faq, or any fragment
     that is not one of our two keys, is left alone rather than treated as a
     broken link. */
  function readHash() {
    var raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    // Some chat clients percent-encode a URL before sending it. base64url
    // itself never needs encoding, so this only ever undoes their work.
    try { raw = decodeURIComponent(raw); } catch (err) { /* leave it as it came */ }
    var m = /^(s[01])=([A-Za-z0-9_-]+)$/.exec(raw);
    if (!m || m[2].length > MAX_READ) return null;
    return { key: m[1], text: m[2] };
  }

  var incoming = readHash();

  /* ------------------------------------------------------------------- time */

  function plural(n, unit) {
    return n + ' ' + unit + (n === 1 ? '' : 's');
  }

  /* Whole units, largest that still reads honestly. Two rules, both learned
     from reading the output:

     A whole number of hours or days is named as such. Pressing the button
     marked "1 hour" and being told "60 minutes" reads as though the page had
     rounded something, or had not understood.

     Everything else keeps the unit that does not lose anything to rounding:
     75 minutes stays 75 minutes, because "1 hour" is a quarter of an hour
     short of the truth and this sentence is a promise about when a link
     stops working. Only past 90 does the rounding become small enough
     relative to the number to be worth the shorter unit. */
  function spell(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 1) return 'less than a minute';
    if (mins % 1440 === 0) return plural(mins / 1440, 'day');
    if (mins % 60 === 0 && mins < 2880) return plural(mins / 60, 'hour');
    if (mins < 90) return plural(mins, 'minute');
    var hours = Math.round(mins / 60);
    if (hours < 48) return plural(hours, 'hour');
    return plural(Math.round(hours / 24), 'day');
  }

  /* ------------------------------------------------------------- clipboard */

  function legacyCopy(text) {
    var scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    document.body.appendChild(scratch);
    scratch.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(scratch);
    return ok;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        if (legacyCopy(text)) return;
        throw new Error('clipboard refused');
      });
    }
    return legacyCopy(text) ? Promise.resolve()
                            : Promise.reject(new Error('clipboard refused'));
  }

  /* ---------------------------------------------------------------- notices */

  /* The status line is the panel's running commentary and a polite live
     region, so it is where both outcomes belong — except mid-run, when it is
     saying "Running…" and must not be contradicted. */
  function say(text, cls) {
    if (LabApp.busy()) LabApp.note('\n[' + text + ']\n');
    else LabApp.status(text, cls);
  }

  function flash(btn, cls) {
    if (!btn) return;
    btn.classList.add(cls);
    setTimeout(function () { btn.classList.remove(cls); }, 1600);
  }

  /* Browsers end a stream error with their own full stop ("The compressed data
     was not valid: invalid block type."), and these read inside a sentence. */
  function reason(err) {
    return String((err && err.message) || err || 'unknown').replace(/\.\s*$/, '');
  }

  /* ------------------------------------------------------------------ panel */

  function closePanel() {
    if (!el.panel) return;
    el.panel.hidden = true;
    el.btn.setAttribute('aria-expanded', 'false');
  }

  function initPanel() {
    if (!el.btn) return;

    // No panel in the markup: then the button is the whole feature and copies
    // a link with no expiry, which is what it did before this panel existed.
    if (!el.panel) {
      el.btn.addEventListener('click', function () { share(0); });
      return;
    }

    el.btn.addEventListener('click', function () {
      var open = el.panel.hidden;
      el.panel.hidden = !open;
      el.btn.setAttribute('aria-expanded', String(open));
      if (open && el.mins) el.mins.value = '';
    });

    // Same outside-click dismissal as the storage panel beside it.
    document.addEventListener('click', function (event) {
      if (el.panel.hidden) return;
      if (el.panel.contains(event.target) || el.btn.contains(event.target)) return;
      closePanel();
    });

    // Escape as well, because this panel holds a focusable text field and the
    // storage panel next door has nothing to trap a keyboard in.
    el.panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closePanel(); el.btn.focus(); }
    });

    var presets = el.panel.querySelectorAll('[data-share-mins]');
    Array.prototype.forEach.call(presets, function (button) {
      button.addEventListener('click', function () {
        share(parseInt(button.getAttribute('data-share-mins'), 10) || 0);
      });
    });

    if (el.custom) el.custom.addEventListener('click', customShare);
    if (el.mins) {
      el.mins.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); customShare(); }
      });
    }
  }

  /* One minute is the floor and there is no ceiling, deliberately. An earlier
     version capped this at a week, which made no sense sitting next to a "No
     limit" button: either a long life is allowed or it is not, and refusing
     eight days while offering forever is a rule with nothing behind it. A
     number far in the future simply behaves like no limit, which is exactly
     what it says. */
  function customShare() {
    var mins = parseInt(el.mins ? el.mins.value : '', 10);
    if (!mins || mins < 1) {
      flash(el.custom, 'is-err');
      say('Give the link at least one minute, or press No limit', 'is-err');
      if (el.mins) el.mins.focus();
      return;
    }
    share(mins);
  }

  /* ------------------------------------------------------------------ share */

  /* mins === 0 means no expiry at all: nothing is written into the payload, so
     the link stays as short as it can be and the reader has nothing to check. */
  function share(mins) {
    var code = LabApp.getCode();
    if (!code.replace(/\s/g, '')) {
      flash(el.btn, 'is-err');
      say('Nothing to share yet — the editor is empty', 'is-err');
      closePanel();
      return;
    }

    var meta = LAB_RUNTIMES[LabApp.lang()];
    var payload = { l: LabApp.lang(), c: code, i: LabApp.getStdin() };
    if (mins > 0) payload.e = Math.round(Date.now() / 1000) + mins * 60;

    encode(payload).then(function (enc) {
      if (enc.text.length > MAX_LINK) {
        flash(el.btn, 'is-err');
        say('Too long to fit in a link', 'is-err');
        LabApp.note('\n[this program packs down to about ' + enc.text.length +
                    ' characters and links are capped at ' + MAX_LINK + ', so that one ' +
                    'would risk being cut short by whatever you sent it through. Share a ' +
                    'shorter excerpt, or send the file itself.]\n');
        closePanel();
        return;
      }

      // Built from the canonical path rather than location.pathname, so a link
      // copied from /labs/python.html still comes out as /labs/python.
      var url = location.origin + '/labs/' + meta.slug + '#' + enc.key + '=' + enc.text;
      return copy(url).then(function () {
        flash(el.btn, 'is-ok');
        say(mins > 0 ? 'Link copied — it stops working in ' + spell(mins * 60000)
                     : 'Link copied — it carries the code itself, nothing was uploaded',
            'is-ok');
        closePanel();
      }, function () {
        // Clipboard refusals are real (an unfocused tab, an older Safari, a
        // locked-down browser). The link still exists, so put it somewhere it
        // can be selected by hand rather than losing it.
        flash(el.btn, 'is-err');
        say('Could not reach the clipboard — the link is in the output pane', 'is-err');
        LabApp.note('\n' + url + '\n');
        closePanel();
      });
    }).catch(function (err) {
      flash(el.btn, 'is-err');
      say('Could not build a link', 'is-err');
      LabApp.note('\n[' + reason(err) + ']\n');
      closePanel();
    });
  }

  /* ----------------------------------------------------------------- arrive */

  function arrive(link) {
    decode(link).then(function (payload) {
      if (!payload || typeof payload.c !== 'string') throw new Error('nothing readable in this link');

      // A link is self-describing, so one written for another language opens
      // that language's page instead of dropping Ruby into a C editor. Cannot
      // loop: the target page sees payload.l === its own language.
      if (payload.l && payload.l !== LabApp.lang() && LAB_RUNTIMES[payload.l]) {
        location.replace('/labs/' + LAB_RUNTIMES[payload.l].slug + location.hash);
        return;
      }

      /* Expired. The program is sitting right there in the fragment and this
         refuses to open it, which is the whole of what the sender was
         promised — so say what happened rather than pretend the link was
         malformed. The fragment stays in the address bar on purpose here: a
         reload then repeats this message, instead of silently showing the
         reader their own program with no explanation of where the shared one
         went. */
      if (typeof payload.e === 'number' && Date.now() > payload.e * 1000) {
        LabApp.loadOwnCode();
        LabApp.status('That shared link has expired', 'is-err');
        LabApp.note('[the person who sent this link set it to stop working after a time, ' +
                    'and that time passed ' + spell(Date.now() - payload.e * 1000) +
                    ' ago. Nothing has been loaded. Ask them for a fresh link.]\n');
        return;
      }

      var hadOwn = LabApp.hasOwnCode();
      LabApp.setCode(payload.c);
      if (typeof payload.i === 'string') LabApp.setStdin(payload.i);
      /* Also done in applyLanguage for a link that was in the URL at load —
         but a link can arrive at a page that booted without one (the
         hashchange listener at the bottom), and that path never goes near
         applyLanguage. Each entry point releases the pin itself; the first
         version of this only did it at boot, and a link pasted into an
         already-open tab left the pin pressed over somebody else's code. */
      LabApp.unpin();

      /* The fragment goes, for the same reason the wish maker drops its query
         once the card is rendered: it has done its job, it is long, and left
         in the address bar it becomes the thing that gets screenshotted, put
         in history, or reloaded — and a reload would throw away whatever the
         reader had typed since, silently, in favour of the link again. */
      if (history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search);
      }

      LabApp.status('Loaded from a shared link — press Run when you have read it', 'is-ok');
      LabApp.note('[this program came from the link you opened, not from this device. ' +
                  'It has not been run.' +
                  (typeof payload.e === 'number'
                     ? ' The link itself stops working in ' +
                       spell(payload.e * 1000 - Date.now()) + '.'
                     : '') +
                  (hadOwn ? ' Your own saved program is untouched — reload this page ' +
                            'without the link to get it back.'
                          : ' Press the pin to keep it on this device.') + ']\n');
    }).catch(function (err) {
      // Whatever was in the fragment is not a program. Put the panel back the
      // way it would have been with no link at all — the editor is sitting
      // empty precisely because this might happen.
      LabApp.loadOwnCode();
      LabApp.status('That shared link could not be read', 'is-err');
      LabApp.note('[the link you opened does not carry a readable program: ' +
                  reason(err) +
                  '. It may have been cut short in transit. The editor has been left as ' +
                  'you had it.]\n');
    });
  }

  /* ------------------------------------------------------------------- boot */

  /* Two different clocks, which is why this is not a single ready() call.

     The BUTTON only needs LabApp when it is pressed, so it is wired straight
     away: a deferred script runs after the parser has finished, so the button
     is certainly in the DOM, and nothing about the wiring can race.

     READING A LINK needs LabApp immediately — and lab-app.js is the next
     deferred script, so at this point in the page it does not exist yet. That
     wait has to be DOMContentLoaded, which fires only once every deferred
     script has run. Note what CANNOT be used to decide it: the familiar
     `readyState === 'loading'` guard, because a deferred script always runs at
     'interactive'. Written that way — it was, first time round — the wait was
     skipped, LabApp was undefined, and a shared link quietly did nothing at
     all while every other part of the page looked perfectly healthy. */

  initPanel();

  var arrived = false;
  function arriveOnce() {
    if (arrived || typeof LabApp === 'undefined') return;   // lab-app.js never got going
    arrived = true;
    arrive(incoming);
  }

  if (incoming) {
    // 'complete' means DOMContentLoaded is already past, so the listener would
    // never fire; 'load' is the net for a copy of this file injected by hand
    // into a page that had finished parsing.
    if (document.readyState === 'complete') arriveOnce();
    else {
      document.addEventListener('DOMContentLoaded', arriveOnce);
      window.addEventListener('load', arriveOnce);
    }
  }

  /* A link that arrives while this exact page is already open never reloads
     the document — the browser sees one URL, two fragments, and fires this
     instead. Which is the likeliest way of all to open one: the reader is
     looking at /labs/python, pastes what they were sent into the address bar,
     presses Enter, and without this the editor sits there unchanged and the
     link looks broken. Same for a second link after a first.

     Cleaning the fragment in arrive() cannot re-enter here: replaceState does
     not fire hashchange. */
  window.addEventListener('hashchange', function () {
    var link = readHash();
    if (link && typeof LabApp !== 'undefined') arrive(link);
  });

  /* The one thing lab-app.js needs from here, and it needs it synchronously.
     A link's payload is deflated, so reading it is asynchronous — but the
     editor is built during lab-app.js's boot, several milliseconds earlier.
     Without a flag it would paint the starter sample (or, worse, the reader's
     own pinned program) and then swap in a stranger's code, which reads as a
     glitch on a fast machine and as a bug on a slow one. Knowing only that a
     link IS present is enough to open the editor empty and wait, and that much
     can be answered from location.hash alone. */
  window.LabShare = { hasIncoming: !!incoming };
})();

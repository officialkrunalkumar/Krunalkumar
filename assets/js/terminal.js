// The hidden terminal easter egg (/terminal) — command handling, the fork
// bomb demo, and its gtag events. Externalized from an inline block so the
// page carries no executable inline scripts (CSP prep); loaded with defer.
(function () {
  var output = document.getElementById('output');
  var cmd = document.getElementById('cmd');
  var promptRow = document.querySelector('.prompt-row');
  // scrollIntoView({block:'nearest'}) aligns the row's border-box exactly to
  // the viewport edge, which left its last few pixels clipped under the fold.
  // scroll-margin is the designed knob for that: 'nearest' now stops 28px
  // early and the whole row plus a breath of space is visible.
  if (promptRow) promptRow.style.scrollMarginBottom = '28px';
  var busy = false;
  var history = [];
  var historyIndex = -1;

  function esc(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Sticky-scroll rule, the same one real terminals use: follow the newest
  // output only while the reader is already at (or near) the bottom. Someone
  // who has scrolled up to reread the head of a long listing must be able to
  // stay there while more lines arrive below.
  function nearBottom() {
    /* Distance to the LIVE EDGE — the prompt, or the newest line — not to the
       document bottom. The old check measured against scrollHeight, and body
       carries 40vh of bottom padding: the moment output first outgrew the
       viewport, the reader was suddenly "40vh from the bottom", the 160px
       stickiness threshold tripped, and following disarmed for the rest of
       the session. Measuring where the newest content actually IS relative to
       the viewport is immune to padding: within 160px below the fold (or on
       screen) means the reader is riding the output; far below means they
       scrolled up on purpose and must be left alone. */
    var target = promptRow && promptRow.style.display !== 'none'
      ? promptRow
      : output.lastElementChild;
    if (!target) return true;
    return target.getBoundingClientRect().top < window.innerHeight + 160;
  }

  function print(html, cls) {
    var follow = nearBottom();
    var line = document.createElement('div');
    line.className = 'line' + (cls ? ' ' + cls : '');
    line.innerHTML = html;
    output.appendChild(line);
    if (!follow) return line;
    // Scroll the minimum needed to keep the newest output in view. The old
    // scrollTo(0, body.scrollHeight) jumped to the bottom of the *document*,
    // and body carries 40vh of bottom padding — so the moment output grew
    // enough to make the page scrollable, it was shoved 40vh up the screen,
    // stranding its first lines above the fold with dead space underneath.
    //
    // The prompt sits after #output, so it is the right anchor while it is
    // showing. During a command it is display:none and cannot be scrolled to,
    // so the new line stands in; the cmd.focus() in run()'s done callback then
    // brings the restored prompt back into view on its own.
    var anchor = promptRow && promptRow.style.display !== 'none' ? promptRow : line;
    anchor.scrollIntoView({ block: 'nearest' });
    return line;
  }

  function printEcho(raw) {
    print('<span class="ps1">visitor@krunalkumar:~$</span> <span class="white">' + esc(raw) + '</span>');
  }

  function track(name) {
    if (typeof window.gtag === 'function') window.gtag('event', name);
  }

  // This page prints real conversion links (contact, the fork-bomb coffee
  // offer) but does not load particle-bg.js, whose delegation reports them
  // everywhere else — mirror the same event names here for parity.
  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    var href = link.href || '';
    if (href.indexOf('calendar.app.google') !== -1) track('book_call_click');
    else if (href.indexOf('mailto:') === 0) track('email_click');
    else if (href.indexOf('wa.me') !== -1) track('whatsapp_link_click');
  });

  var files = {
    'about.txt': [
      'Krunalkumar Shah — researcher, engineer, cybersecurity professional.',
      'Published a defense against fork bomb attacks in Linux (IJRAT, 2019).',
      'Former Assistant Professor. Builds AI & automation workflows for real teams.',
      'Registered cyber expert volunteer supporting law enforcement since 2020.',
      '',
      'The visible site: <a href="/">krunalkumar.dpdns.org</a>'
    ],
    'research.txt': [
      '“Security Against Fork Bomb Attack in Linux Based Systems” (IJRAT, 2019).',
      'Detection in as little as 44 ms at a 500-fork threshold; repeat offenders',
      'run in resource quarantine instead of being permanently banned.',
      'Full paper: <a href="/research">/research</a>',
      '',
      'Fun fact: this terminal has a live demo. You just have to be brave enough',
      'to type the forbidden three-character incantation. <span class="dim">(hint: man forkbomb)</span>'
    ],
    'todo.txt': [
      '[x] publish security research',
      '[x] teach computer science',
      '[x] automate everything at work',
      '[x] hide a terminal in the portfolio',
      '[ ] see who actually finds it  <span class="dim">&larr; you are here</span>'
    ]
  };

  function cmdHelp() {
    print('Available commands:', 'white');
    print('  <span class="cyan">help</span>          this list');
    print('  <span class="cyan">whoami</span>        who are you?');
    print('  <span class="cyan">ls</span>            list files');
    print('  <span class="cyan">cat</span> &lt;file&gt;    read a file');
    print('  <span class="cyan">man forkbomb</span>  a warning label');
    print('  <span class="cyan">hack</span>          do the Hollywood thing');
    print('  <span class="cyan">mayuri</span>        call the assistant over');
    print('  <span class="cyan">magic</span>         the hidden touches, documented');
    print('  <span class="cyan">sudo</span> ...       try your luck');
    print('  <span class="cyan">clear</span>         wipe the screen');
    print('  <span class="cyan">exit</span>          back to the normal site');
    print('<span class="dim">Some commands are not listed. This is a security site, after all.</span>');
  }

  function cmdLs() {
    print('about.txt    research.txt    todo.txt    <span class="dim">.secrets/ (permission denied)</span>');
  }

  function cmdCat(arg) {
    if (!arg) { print('cat: missing file. Try: cat about.txt', 'dim'); return; }
    // Own-property check: a plain object lookup resolves inherited names
    // like "constructor"/"__proto__" to Object.prototype members.
    var key = arg.toLowerCase();
    var f = Object.prototype.hasOwnProperty.call(files, key) ? files[key] : undefined;
    if (f) { f.forEach(function (l) { print(l); }); }
    else if (arg.indexOf('.secrets') === 0) { print('cat: .secrets/: Permission denied. <span class="dim">Nice try though — I respect it.</span>'); }
    else { print('cat: ' + esc(arg) + ': No such file'); }
  }

  function cmdManForkbomb() {
    print('FORKBOMB(1)                    Dangerous Things                    FORKBOMB(1)', 'dim');
    print('');
    print('<span class="white">NAME</span>');
    print('     :(){ :|:& };:  — a shell function that summons every process at once');
    print('');
    print('<span class="white">DESCRIPTION</span>');
    print('     Defines a function named <span class="cyan">:</span> that calls itself twice, forever.');
    print('     Each copy spawns two more. The process table fills. The system dies.');
    print('');
    print('<span class="white">WARNING</span>');
    print('     Never run this on a real machine. <span class="warn">This terminal, however,</span>');
    print('     <span class="warn">is protected by published research. Feel free to try.</span>');
  }

  // Documents the background controls that live on every other page. Unlisted
  // in help, like forkbomb — the console hint on those pages points here, and
  // finding it is the point.
  /* Unlisted (magic graduated to the help list at the owner's request; this
     one stays hidden). The page it points at is noindex and
     appears in no menu, so this command is the only door to it. */
  function cmdEinstein() {
    print('EINSTEIN(1)                    Unlisted Pages                   EINSTEIN(1)', 'dim');
    print('');
    print('<span class="white">NAME</span>');
    print('     a laboratory, a blackboard, and a man who did say some of it');
    print('');
    print('<span class="white">LOCATION</span>');
    print('     <a href="/einstein">/einstein</a>');
    print('');
    print('<span class="white">DESCRIPTION</span>');
    print('     Fourteen quotations, one at a time, each tied to the letter,');
    print('     interview or essay it came from. Tap him for another.');
    print('');
    print('     The citations are the point. Einstein is the most misattributed');
    print('     person on the internet, and the page names four famous lines he');
    print('     never said &mdash; including the fish that cannot climb a tree.');
    print('');
    print('<span class="white">SEE ALSO</span>');
    print('     <a href="/buddha">/buddha</a>, which cites every verse for the same reason.');
    print('     <span class="cyan">magic</span>, for the rest of what is hiding.');
  }

  function cmdMagic() {
    print('MAGIC(1)                    Background Controls                    MAGIC(1)', 'dim');
    print('');
    print('<span class="white">NAME</span>');
    print('     the drifting dots — the starfield behind every page takes requests');
    print('');
    print('<span class="white">KEYS</span>');
    print('     <span class="cyan">.</span>    show or hide the controls <span class="dim">(hidden until you reveal them; the choice lasts the tab session)</span>');
    print('     <span class="cyan">k</span>    more dots            <span class="cyan">s</span>    fewer dots');
    print('     <span class="cyan">l</span>    faster drift         <span class="cyan">a</span>    slower drift');
    print('     <span class="cyan">p</span>    pause or resume the drift');
    print('     <span class="cyan">b</span>    hide or show the WhatsApp bubble <span class="dim">(this was w until the theme keys took it)</span>');
    print('');
    print('<span class="white">THEME</span>');
    print('     <span class="cyan">w</span>    white            <span class="cyan">d</span>    dark');
    print('     Works on every page, so you can switch without scrolling back up');
    print('     to the header and losing your place. The choice is remembered, and');
    print('     pressing the key you are already on does nothing rather than');
    print('     toggling — <span class="cyan">w</span> always means light, never &ldquo;the other one&rdquo;.');
    print('');
    print('<span class="white">ELSEWHERE</span>');
    print('     Tap the portrait on <a href="/">the home page</a> six times, quickly.');
    print('     The name in the navbar becomes a dance floor — fire crackers');
    print('     included — and Mayuri, bottom right, dances along. She works');
    print('     here; staff dance at parties. Six more taps end it. Nothing is');
    print('     saved; the morning after is only ever a reload away.');
    print('     She also answers to her name &mdash; typing <span class="cyan">mayuri</span> here summons her.');
    print('');
    print('     On <a href="/buddha">the still page</a>, press <span class="cyan">m</span>. The breath words —');
    print('     breathe in, breathe out — come out from under the figure and keep');
    print('     time with him. Press it again and they withdraw. Nothing is saved,');
    print('     and a reload puts them away.');
    print('');
    print('     Press <span class="cyan">t</span> there too: the raga changes. Bhairavi at dawn,');
    print('     Yaman at dusk, Bhupali, and a sustained Om with no flute at all —');
    print('     four settings, each a real raga with an hour attached to it. The');
    print('     drone slides to the new tonic rather than cutting.');
    print('');
    print('     On <a href="/party">the loud page</a>, press <span class="cyan">t</span>. The record');
    print('     changes &mdash; four of them, each with its own tempo, key and drum');
    print('     pattern, all built in the browser rather than downloaded. Nothing');
    print('     is saved, and the room re-times itself to whatever is playing.');
    print('');
    print('     Also: the kitchen keeps a kettle. <span class="dim">(try: teapot)</span>');
    print('');
    print('<span class="white">WISHES</span>');
    print('     Two pages exist only when you name somebody in the link. Without');
    print('     the query parameter there is nothing to say, so they send you to');
    print('     the generator instead of showing an empty card:');
    print('');
    print('     <span class="cyan">/birthday?name=[name]</span>');
    print('     <span class="cyan">/festival?name=[festival]</span>');
    print('');
    print('     Birthday takes an optional <span class="cyan">&amp;theme=</span> — candlelight, confetti,');
    print('     balloons, starlit, blossom or neon — and both take an optional');
    print('     <span class="cyan">&amp;from=</span> so a forwarded card still says who sent it.');
    print('');
    print('     <span class="dim">/birthday?name=Riya&amp;theme=starlit&amp;from=Krunal</span>');
    print('     <span class="dim">/festival?name=Diwali&amp;from=Krunal</span>');
    print('');
    // Read the count off the dataset when the page has it, so this line can
    // never drift from festival-data.js the way "91" did. /terminal does not
    // load that file today — it is a text page with no cards to draw — hence
    // the literal, which is the same number the data holds.
    var known = (window.KSFestivals && window.KSFestivals.all.length) || 92;
    print('     The festival name does not have to be spelled correctly. ' + known + ' of them');
    print('     are known, English names work as well as the real ones, and anything');
    print('     unrecognised still gets a warm generic card rather than an error.');
    print('     <span class="dim">bestu varsh, diwaly, crismas and gujarati new year all land right.</span>');
    print('');
    print('     Once the card has loaded the query parameter disappears from the');
    print('     address bar, so it reads as a page made for them rather than a form');
    print('     somebody filled in. The Copy link button on the card keeps the whole');
    print('     link, which is the one worth forwarding.');
    print('');
    print('     Build one at <a href="/labs/wish-generator">/labs/wish-generator</a> — name, look, preview, link.');
    print('');
    print('<span class="white">NOTES</span>');
    print('     The keys go quiet the moment you click into a form, so the');
    print('     contact page still spells your name the way you typed it.');
    print('     Dots and speed reset on every page load; pause, the chat bubble,');
    print('     and the revealed controls last until the tab is closed.');
    print('');
    print('<span class="white">BUGS</span>');
    print('     Does not work here; no starfield to bother. Try <a href="/">the home page</a>.');
  }

  // --- mayuri, summoned -----------------------------------------------------
  // Typing her name puts the site's assistant centre-stage, BIG. No chat —
  // just her, a close ×, and a few behaviours: eyes that follow the pointer,
  // a smile on tap, a glow on double tap, a dance on triple tap (or `d`).
  //
  // The artwork is deliberately NOT duplicated here. particle-bg.js owns the
  // one canonical SVG and builds it into the corner dock; the stage clones
  // that node, so any redraw of her face lands here for free. When there is
  // no dock to clone — a page that never ran particle-bg.js, or partials that
  // failed before the corner was built — she is simply "away": one graceful
  // line instead of a broken overlay. (Dismissing her with the × does not
  // remove the dock, only hides it, so a dismissed corner still clones fine.)
  var mayuriStage = null;  // the open stage element, or null
  var mayuriCleanups = []; // listener/timer removers, run on close

  function closeMayuriStage() {
    if (!mayuriStage) return;
    // The terminal page is long-lived and she can be summoned again and
    // again: every listener the stage added is removed with it, or a
    // summon-close-summon loop would stack document-level handlers forever.
    for (var i = 0; i < mayuriCleanups.length; i += 1) mayuriCleanups[i]();
    mayuriCleanups = [];
    if (mayuriStage.parentNode) mayuriStage.parentNode.removeChild(mayuriStage);
    mayuriStage = null;
  }

  // Her styling lives in its own on-demand stylesheet, because this page
  // deliberately never loads main.css. Injected once; the id is the guard.
  function ensureMayuriCss() {
    if (document.getElementById('mayuri-stage-css')) return;
    var link = document.createElement('link');
    link.id = 'mayuri-stage-css';
    link.rel = 'stylesheet';
    link.href = '/assets/css/mayuri-stage.css';
    document.head.appendChild(link);
  }

  function cmdMayuri() {
    if (mayuriStage) {
      print('She is already here. <span class="dim">(Escape or the &times; sends her back.)</span>');
      return;
    }
    ensureMayuriCss();
    // This page loads neither main.css nor particle-bg.js, so there is no
    // corner dock to clone from. Her artwork is borrowed from /offline
    // instead, which inlines her fully and is precached by the service
    // worker — she is reachable even with the network gone, which is the
    // right property for an assistant who claims to always be around.
    var dockSvg = document.querySelector('.mayuri-dock .mayuri-avatar svg');
    if (dockSvg) { buildMayuriStage(dockSvg); return; }
    fetch('/offline').then(function (r) {
      if (!r.ok) throw new Error('offline page unavailable');
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var svg = doc.querySelector('svg.mayuri-face');
      if (!svg) throw new Error('no avatar in offline page');
      if (mayuriStage) return; // summoned twice while the fetch was in flight
      buildMayuriStage(document.importNode(svg, true));
    })['catch'](function () {
      print('She seems to be away from her desk.', 'dim');
    });
  }

  function buildMayuriStage(dockSvg) {
    track('easter_egg_mayuri_summoned');
    print('Calling her over&hellip; <span class="dim">tap her, tap her twice, tap her thrice. Escape sends her back;</span>');
    print('<span class="dim">the prompt keeps working underneath her.</span>');

    // The stage: a full-viewport fixed layer whose ROOT ignores the pointer
    // (main.css) so the terminal keeps taking commands underneath; only her
    // figure and the × accept clicks. She arrives waving (is-waving).
    var stage = document.createElement('div');
    stage.className = 'mayuri-stage is-waving';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mayuri-stage-close';
    closeBtn.setAttribute('aria-label', 'Send Mayuri back');
    closeBtn.innerHTML = '&times;';

    var figure = document.createElement('div');
    figure.className = 'mayuri-stage-figure';
    var svg = dockSvg.ownerDocument === document && dockSvg.parentNode
      ? dockSvg.cloneNode(true)   // the live dock stays where it is
      : dockSvg;                  // an imported/orphan node is ours already
    // Tag the pupil parts of the RESTING eyes — the dark ellipses and their
    // white catchlights — so the gaze can move just them. The brows and
    // lashes are <path>s and deliberately not matched: eyes that follow are
    // pupils travelling inside a still eye, not the whole feature sliding.
    var pupilParts = svg.querySelectorAll('.mayuri-eyes ellipse, .mayuri-eyes circle');
    for (var pi = 0; pi < pupilParts.length; pi += 1) {
      pupilParts[pi].setAttribute('class', (pupilParts[pi].getAttribute('class') || '') + ' mayuri-pupil');
    }
    figure.appendChild(svg);

    // Hover shows love: hearts drift up around her while the pointer rests
    // on the figure. Class-driven so reduced-motion can still show a single
    // still heart instead of the float.
    // Hover makes her smile; the hearts moved to the single tap. The class
    // holds while the pointer rests on her and lifts when it leaves.
    var onEnter = function () { stage.classList.add('is-smiling'); };
    var onLeave = function () { stage.classList.remove('is-smiling'); };
    figure.addEventListener('mouseenter', onEnter);
    figure.addEventListener('mouseleave', onLeave);
    mayuriCleanups.push(function () {
      figure.removeEventListener('mouseenter', onEnter);
      figure.removeEventListener('mouseleave', onLeave);
    });

    stage.appendChild(closeBtn);
    stage.appendChild(figure);
    document.body.appendChild(stage);
    mayuriStage = stage;

    // The arrival wave is one-shot: the class rides out on animationend
    // rather than a timer, so it ends exactly when the keyframes do (and a
    // reduced-motion visitor, whose wave never runs, just keeps a class that
    // styles nothing).
    function onWaveEnd(event) {
      if (event.animationName === 'mayuri-wave') stage.classList.remove('is-waving');
    }
    svg.addEventListener('animationend', onWaveEnd);
    mayuriCleanups.push(function () { svg.removeEventListener('animationend', onWaveEnd); });

    // EYES FOLLOW THE MOUSE. The offset is written as custom properties, not
    // an inline transform: the blink animation owns the transform property
    // while it plays and would flatten any inline value, so main.css gives
    // the gaze lands on the PUPILS (children of the eyes group), so the
    // blink's transform on the group and the pupils' own translate compose
    // in the tree instead of fighting over one property. It is the same
    // trick .mayuri-head plays with --look-x/--look-y. Cheap per move: one
    // rect read on an already-throttled event, two var writes.
    function onMove(event) {
      var rect = svg.getBoundingClientRect();
      var dx = event.clientX - (rect.left + rect.width / 2);
      var dy = event.clientY - (rect.top + rect.height / 2);
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Clamped to a 2.5px radius — pupils barely travel — and eased in over
      // the first ~100px so a cursor crossing her face does not snap them.
      var r = Math.min(1.3, dist / 60);
      svg.style.setProperty('--gaze-x', (dx / dist * r).toFixed(2) + 'px');
      svg.style.setProperty('--gaze-y', (dy / dist * r).toFixed(2) + 'px');
    }
    // Back to centre when the pointer leaves the page — eyes pinned at a
    // corner with nobody there read as her staring at the door.
    function onLeave() {
      svg.style.setProperty('--gaze-x', '0px');
      svg.style.setProperty('--gaze-y', '0px');
    }
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    mayuriCleanups.push(function () {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    });

    // TAPS. One timer collects a burst (each click within ~350ms of the last)
    // and dispatches on the count when the burst ends: 1 → smile, 2 → glow
    // toggle, 3+ → dance. Deferring the single-tap smile by that ~360ms
    // window is exactly what keeps it out of the double-tap's way — a second
    // click lands inside the window and grows the burst instead of smiling
    // first and glowing after.
    var tapCount = 0;
    var tapTimer = null;
    var smileTimer = null;
    function onTap(event) {
      // Do not let the click bubble to the body handler that refocuses the
      // prompt: after playing with her, focus stays off the input, which is
      // what makes the `d` shortcut below reachable at all.
      event.stopPropagation();
      // A double-click also runs the browser's text selection, and the SVG
      // carries real <text> (the KS_ shirt mark) — she lit up blue like a
      // paragraph. user-select:none in the CSS is the main guard; killing the
      // multi-click default here is the belt for browsers that select anyway.
      if (event.detail > 1 && event.preventDefault) event.preventDefault();
      if (stage.classList.contains('is-dancing')) {
        // A tap mid-dance stops the dance, immediately — making her wait out
        // the burst window before obeying reads as being ignored.
        stage.classList.remove('is-dancing');
        tapCount = 0;
        if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
        return;
      }
      tapCount += 1;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(function () {
        var n = tapCount;
        tapCount = 0;
        tapTimer = null;
        if (n === 1) {
          // A burst of hearts for ~1.8s (the CSS float), then back to calm.
          // Deferred by the burst window above so a double-tap never shows a
          // stray heart before the glow.
          stage.classList.add('is-loved');
          if (smileTimer) clearTimeout(smileTimer);
          smileTimer = setTimeout(function () { stage.classList.remove('is-loved'); }, 1800);
        } else if (n === 2) {
          // Persistent until double-tapped off.
          stage.classList.toggle('is-glowing');
        } else {
          stage.classList.add('is-dancing');
        }
      }, 360);
    }
    figure.addEventListener('click', onTap);
    mayuriCleanups.push(function () {
      figure.removeEventListener('click', onTap);
      if (tapTimer) clearTimeout(tapTimer);
      if (smileTimer) clearTimeout(smileTimer);
    });

    // Escape closes from anywhere, even mid-command. `d` toggles the dance,
    // but only when the key is NOT headed into the prompt — otherwise typing
    // `date` would choreograph her on the first letter.
    function onKey(event) {
      if (event.key === 'Escape') { closeMayuriStage(); return; }
      if ((event.key === 'd' || event.key === 'D') && event.target !== cmd) {
        stage.classList.toggle('is-dancing');
      }
    }
    document.addEventListener('keydown', onKey);
    mayuriCleanups.push(function () { document.removeEventListener('keydown', onKey); });

    function onClose(event) { event.stopPropagation(); closeMayuriStage(); }
    closeBtn.addEventListener('click', onClose);
    mayuriCleanups.push(function () { closeBtn.removeEventListener('click', onClose); });
  }

  function cmdHack(done) {
    var chars = '0123456789ABCDEF';
    var count = 0;
    var timer = setInterval(function () {
      var row = '';
      for (var i = 0; i < 8; i += 1) {
        row += '0x';
        for (var j = 0; j < 6; j += 1) row += chars[Math.floor(Math.random() * 16)];
        row += ' ';
      }
      print(row, 'dim');
      count += 1;
      if (count > 14) {
        clearInterval(timer);
        print('ACCESS GRANTED', 'ok');
        print('&hellip;to the publicly available portfolio you were already on. <a href="/projects">/projects</a>', 'dim');
        done();
      }
    }, 90);
  }

  function forkBomb(done) {
    track('fork_bomb_triggered');
    var pid = 1337;
    var procs = 1;
    var start = null;
    document.body.classList.add('shake');
    print('');
    var timer = setInterval(function () {
      for (var i = 0; i < Math.min(procs, 6); i += 1) {
        pid += Math.floor(Math.random() * 7) + 1;
        print('[' + pid + '] -bash: fork: spawning <span class="cyan">:</span> &rarr; <span class="cyan">:|:&amp;</span>', 'dim');
      }
      procs *= 2;
      if (!start) start = Date.now();
      if (procs >= 512) {
        clearInterval(timer);
        document.body.classList.remove('shake');
        print('');
        // #output is a live region — glyphs stay aria-hidden so screen
        // readers speak only the words.
        print('<span aria-hidden="true">⚠</span> FORK RATE THRESHOLD EXCEEDED — 500 forks', 'alert');
        setTimeout(function () {
          print('<span aria-hidden="true">✓</span> Attack identified in 44 ms', 'ok');
          print('<span aria-hidden="true">✓</span> Offending process name recorded: <span class="cyan">:</span>', 'ok');
          print('<span aria-hidden="true">✓</span> Resource quarantine engaged — system responsive', 'ok');
          print('');
          print('<span class="white">That was a live demo of my published research:</span>');
          print('“Security Against Fork Bomb Attack in Linux Based Systems” (IJRAT, 2019)');
          print('Nominated for a best paper award &middot; <a href="/research">read how the defense works &rarr;</a>');
          print('');
          print('<span class="dim">You found the best easter egg on this site. Tell me on WhatsApp and</span>');
          print('<span class="dim">the first coffee is on me: <a href="https://wa.me/918200713617?text=I%20detonated%20the%20fork%20bomb%20on%20your%20site">claim coffee</a></span>');
          done();
        }, 700);
      }
    }, 260);
  }

  var commands = {
    help: function (a, done) { cmdHelp(); done(); },
    whoami: function (a, done) {
      print('visitor <span class="dim">(uid=1000, curiosity=high)</span>');
      print('The more interesting question: <span class="cyan">cat about.txt</span>');
      done();
    },
    ls: function (a, done) { cmdLs(); done(); },
    pwd: function (a, done) { print('/home/visitor/easter-egg'); done(); },
    date: function (a, done) { print(new Date().toString()); done(); },
    echo: function (a, done) { print(esc(a) || ''); done(); },
    cat: function (a, done) { cmdCat(a); done(); },
    man: function (a, done) {
      if (a === 'forkbomb') cmdManForkbomb();
      else print('No manual entry for ' + esc(a || '(nothing)') + '. Try: man forkbomb', 'dim');
      done();
    },
    magic: function (a, done) { cmdMagic(); done(); },
    einstein: function (a, done) { cmdEinstein(); done(); },
    mayuri: function (a, done) { cmdMayuri(); done(); },
    forkbomb: function (a, done) { forkBomb(done); },
    hack: function (a, done) { cmdHack(done); },
    sudo: function (a, done) {
      print('visitor is not in the sudoers file. This incident will be reported.', 'warn');
      print('<span class="dim">(It will not. But it felt right to say.)</span>');
      done();
    },
    clear: function (a, done) { output.innerHTML = ''; done(); },
    exit: function (a, done) { print('logout'); setTimeout(function () { window.location.href = '/'; }, 500); done(); },
    // Unlisted, like forkbomb and magic. RFC 2324 is honored in this house.
    teapot: function (a, done) {
      print('HTTP/1.1 <span class="warn">418 I\'m a teapot</span>');
      print('This server refuses to brew coffee. <span class="dim">(RFC 2324, very serious)</span>');
      print('');
      print('Putting the kettle on…');
      track('easter_egg_teapot_cmd');
      setTimeout(function () { window.location.href = '/teapot'; }, 1200);
      done();
    },
    contact: function (a, done) {
      print('email:    <a href="mailto:krunalkumar@krunalkumar.dpdns.org">krunalkumar@krunalkumar.dpdns.org</a>');
      print('whatsapp: <a href="https://wa.me/918200713617?text=Hello">wa.me/918200713617</a>');
      print('call:     <a href="https://calendar.app.google/x3SFLgyDeeLL7WjA8" target="_blank" rel="noopener">book a slot</a>');
      done();
    },
    rm: function (a, done) {
      if (/-rf?\s+\/|\/\s*$/.test(a || '')) {
        print('rm: cannot remove \'/\': the 404-page rockets live there. Request denied.', 'warn');
      } else {
        print('rm: read-only filesystem. Your curiosity is noted and appreciated.', 'dim');
      }
      done();
    }
  };

  function run(raw) {
    var input = raw.trim();
    printEcho(raw);
    if (!input) return;
    history.push(raw);
    historyIndex = history.length;

    // The classic fork bomb, in any spacing.
    if (input.replace(/\s+/g, '').indexOf(':(){:|:&};:') !== -1) {
      busy = true;
      promptRow.style.display = 'none';
      forkBomb(function () { busy = false; promptRow.style.display = ''; if (nearBottom()) promptRow.scrollIntoView({ block: 'nearest' }); cmd.focus({ preventScroll: true }); });
      return;
    }

    var parts = input.split(/\s+/);
    var name = parts[0].toLowerCase();
    var arg = parts.slice(1).join(' ');
    // Own-property check: without it, typing "constructor" resolved the
    // inherited Object constructor, ran it as a command, and its done()
    // callback never fired — leaving busy=true and the prompt hidden
    // until reload.
    var handler = Object.prototype.hasOwnProperty.call(commands, name) ? commands[name] : undefined;
    if (!handler) {
      print('bash: ' + esc(name) + ': command not found <span class="dim">(try: help)</span>');
      return;
    }
    busy = true;
    promptRow.style.display = 'none';
    // No command may leave the terminal wedged: if a handler throws, put
    // the prompt back instead of stranding the hidden-busy state.
    try {
      handler(arg, function () { busy = false; promptRow.style.display = ''; if (nearBottom()) promptRow.scrollIntoView({ block: 'nearest' }); cmd.focus({ preventScroll: true }); });
    } catch (error) {
      busy = false;
      promptRow.style.display = '';
      // focus() alone is a no-op here - the input never lost focus, the
      // visitor just pressed Enter in it - so the restored prompt must be
      // scrolled to explicitly, and focus told not to compete.
      if (nearBottom()) promptRow.scrollIntoView({ block: 'nearest' });
      cmd.focus({ preventScroll: true });
    }
  }

  cmd.addEventListener('keydown', function (event) {
    // Swallow input while an animation runs, but never trap Tab or
    // browser shortcuts (Ctrl/Cmd+R and friends) — keyboard users must
    // be able to leave or refresh at any time.
    if (busy) {
      if (event.key !== 'Tab' && !event.ctrlKey && !event.metaKey) event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      var value = cmd.value;
      cmd.value = '';
      run(value);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (historyIndex > 0) { historyIndex -= 1; cmd.value = history[historyIndex]; }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex < history.length - 1) { historyIndex += 1; cmd.value = history[historyIndex]; }
      else { historyIndex = history.length; cmd.value = ''; }
    }
  });

  document.body.addEventListener('click', function () {
    // preventScroll: a click while scrolled up (rereading long output) must
    // not yank the viewport down to the prompt; typing Enter later brings it
    // back naturally via print()'s sticky follow.
    if (!busy && !window.getSelection().toString()) cmd.focus({ preventScroll: true });
  });

  // Boot banner
  print('Last login: never — nobody was supposed to find this.', 'dim');
  print('');
  print('<span class="white">Welcome to the hidden terminal.</span> You are officially the curious type.');
  print('This machine belongs to <span class="cyan">Krunalkumar Shah</span> — cybersecurity researcher.');
  print('Type <span class="cyan">help</span> to look around. And whatever you do&hellip;');
  print('do <span class="alert">NOT</span> type <span class="white">:(){ :|:& };:</span>');
  print('');
  track('easter_egg_terminal');
})();

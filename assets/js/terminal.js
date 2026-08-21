// The hidden terminal easter egg (/terminal) — command handling, the fork
// bomb demo, and its gtag events. Externalized from an inline block so the
// page carries no executable inline scripts (CSP prep); loaded with defer.
(function () {
  var output = document.getElementById('output');
  var cmd = document.getElementById('cmd');
  var promptRow = document.querySelector('.prompt-row');
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
    return document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
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
    print('     <span class="cyan">w</span>    hide or show the WhatsApp bubble');
    print('');
    print('<span class="white">ELSEWHERE</span>');
    print('     Tap the portrait on <a href="/">the home page</a> six times, quickly.');
    print('     The name in the navbar becomes a dance floor — fire crackers');
    print('     included. Six more taps end the party. Nothing is saved; the');
    print('     morning after is only ever a reload away.');
    print('');
    print('     On <a href="/buddha">the still page</a>, press <span class="cyan">m</span>. The breath words —');
    print('     breathe in, breathe out — come out from under the figure and keep');
    print('     time with him. Press it again and they withdraw. Nothing is saved,');
    print('     and a reload puts them away.');
    print('');
    print('     Also: the kitchen keeps a kettle. <span class="dim">(try: teapot)</span>');
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
      forkBomb(function () { busy = false; promptRow.style.display = ''; cmd.focus({ preventScroll: !nearBottom() }); });
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
      handler(arg, function () { busy = false; promptRow.style.display = ''; cmd.focus({ preventScroll: !nearBottom() }); });
    } catch (error) {
      busy = false;
      promptRow.style.display = '';
      print('bash: ' + esc(name) + ': unexpected error', 'warn');
      cmd.focus();
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

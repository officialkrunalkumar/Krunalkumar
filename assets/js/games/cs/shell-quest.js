/* ==========================================================================
   shell-quest.js — eight puzzles whose only interface is a shell.
   --------------------------------------------------------------------------
   THE ANSWERS ARE READ BACK OUT OF THE FILESYSTEM, NOT WRITTEN BESIDE IT.
   The logs here are generated from a fixed seed, and every quest answer is
   then computed from the generated text by the same functions the player's
   own grep and wc call. So the accepted address in auth.log, the failed unit
   at the end of boot.log and the length of the longest line in notes.txt
   cannot drift away from what the files actually say. A quest with its
   answer typed in by hand next to a 200-line log is a quest that is wrong
   the first time somebody edits the log.

   TAB COMPLETES ONLY WHEN THERE IS A WORD TO COMPLETE. A terminal that
   swallows Tab unconditionally is a keyboard trap: a visitor who tabbed into
   the input can never tab out of it again. On an empty line Tab is left
   alone and does what Tab always does, which gives everyone a guaranteed way
   out; Escape clears the line, so that exit is one keystroke away at worst.
   ========================================================================== */

(function () {
  'use strict';

  /* Strict mode forbids 0755 literals, so octal is spelled out. */
  function o(str) { return parseInt(str, 8); }

  var SEED = 20260828;
  var PASSPHRASE = 'tungsten-lattice-77';
  var HOME = '/home/player';
  var HOST = 'forge';
  var MAX_LINES = 500;

  var rnd = null;

  function ri(n) { return Math.floor(rnd() * n); }
  function pick(list) { return list[ri(list.length)]; }

  function padLeft(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
  /* The magic numbers that file sniffs for. Built with fromCharCode rather
     than escapes so that no unprintable byte is ever sitting invisibly in
     this source, where nobody could see it to check it. */
  function chr() {
    var s = '';
    for (var i = 0; i < arguments.length; i++) s += String.fromCharCode(arguments[i]);
    return s;
  }

  var MAGIC_PNG = chr(0x89) + 'PNG' + chr(0x0d, 0x0a, 0x1a, 0x0a);
  var MAGIC_GZIP = chr(0x1f, 0x8b, 0x08);
  var MAGIC_ELF = chr(0x7f) + 'ELF' + chr(0x02, 0x01, 0x01, 0x00);

  /* ------------------------------------------------------------------
     Filesystem nodes. One shape for both kinds: dirs carry kids, files
     carry text. Binary files are ordinary strings containing control and
     high bytes, which is what lets one implementation of cat, wc, strings
     and file cover both without a second code path.
     ------------------------------------------------------------------ */
  function mk(parent, name, type, modeStr, text, date) {
    var node = {
      name: name,
      type: type,
      mode: o(modeStr),
      parent: parent || null,
      date: date || 'Feb 14 09:12'
    };
    if (type === 'dir') node.kids = [];
    else node.text = text || '';
    if (parent) parent.kids.push(node);
    return node;
  }

  function junk(n) {
    /* Only codes below 32 and above 127, so a run of junk can never look
       like a string to strings() and leak an answer by accident. */
    var s = '';
    for (var i = 0; i < n; i++) {
      s += String.fromCharCode(ri(2) ? ri(31) + 1 : 128 + ri(120));
    }
    return s;
  }

  function stamp(t) {
    var whole = Math.floor(t);
    var frac = Math.floor((t - whole) * 1000000);
    var f = String(frac);
    while (f.length < 6) f = '0' + f;
    return padLeft(whole + '.' + f, 12);
  }

  /* ---- boot.log -------------------------------------------------- */
  var BOOT_SUBSYSTEMS = [
    ['ACPI', ['Core revision 20210730', 'PM: Registering ACPI NVS region', 'bus type PCI registered', 'Enabled 3 GPEs in block 00 to 3F']],
    ['pci 0000:00:1f.2', ['reg 0x24: [mem 0xdf240000-0xdf2407ff]', 'PME# supported from D3hot', 'BAR 6: assigned [mem 0xdf200000-0xdf20ffff pref]']],
    ['usb 1-2', ['new high-speed USB device number 3 using xhci_hcd', 'New USB device found, idVendor=8087', 'Product: Integrated Hub']],
    ['ahci 0000:00:17.0', ['AHCI 0001.0301 32 slots 6 ports 6 Gbps', 'flags: 64bit ncq led clo pio slum part', 'port 3 is not ready']],
    ['nvme nvme0', ['pci function 0000:02:00.0', '4/0/0 default/read/poll queues', 'missing or invalid SUBNQN field']],
    ['e1000e 0000:00:1f.6', ['eth0: (PCI Express:2.5GT/s:Width x1) 00:1c:42:8a:11:04', 'eth0: NIC Link is Up 1000 Mbps Full Duplex', 'eth0: MDI-X mode set to auto']],
    ['EXT4-fs (nvme0n1p2)', ['mounted filesystem with ordered data mode', 're-mounted. Opts: errors=remount-ro', 'recovery complete']],
    ['systemd[1]', ['Starting Journal Service...', 'Reached target Local File Systems.', 'Started Daily apt download activities.', 'Listening on D-Bus System Message Bus Socket.']],
    ['audit', ['type=1400 audit(1707900122.441:12): apparmor="STATUS"', 'initializing netlink subsys (disabled)', 'type=1327 audit(1707900131.902:19): proctitle=2F7573722F']],
    ['random', ['crng init done', '7 urandom warning(s) missed due to ratelimiting']]
  ];

  var FAILED_UNITS = ['nginx', 'postfix', 'chronyd', 'docker'];
  var FAILED_DESC = {
    nginx: 'A high performance web server and a reverse proxy server',
    postfix: 'Postfix Mail Transport Agent',
    chronyd: 'NTP client/server',
    docker: 'Docker Application Container Engine'
  };

  function buildBootLog() {
    var lines = ['[' + stamp(0) + '] Linux version 5.15.0-92-generic (build@' + HOST + ') (gcc 11.4.0) #102-Ubuntu SMP'];
    var t = 0.08;
    for (var i = 0; i < 236; i++) {
      t += rnd() * 0.42 + 0.015;
      var entry = pick(BOOT_SUBSYSTEMS);
      lines.push('[' + stamp(t) + '] ' + entry[0] + ': ' + pick(entry[1]));
    }
    var unit = pick(FAILED_UNITS);
    lines.push('[' + stamp(t + 0.61) + '] systemd[1]: Failed to start ' + unit +
      '.service - ' + FAILED_DESC[unit] + '.');
    return lines.join('\n') + '\n';
  }

  /* ---- auth.log --------------------------------------------------- */
  var BAD_USERS = ['admin', 'root', 'test', 'oracle', 'ubuntu', 'postgres', 'git', 'user', 'ftp', 'pi'];
  var HOSTILE_NETS = ['45.83', '103.94', '91.240', '185.220', '212.70', '61.177'];

  function buildAuthLog() {
    var lines = [];
    var minute = 2;
    var second = 4;
    var pid = 2100;
    var accepted = '10.4.' + (ri(200) + 12) + '.' + (ri(200) + 12);
    var acceptedAt = 40 + ri(120);

    for (var i = 0; i < 196; i++) {
      second += ri(24) + 1;
      while (second >= 60) { second -= 60; minute++; }
      pid += ri(9) + 1;
      var when = 'Feb 14 03:' + padLeft(minute, 2).replace(/ /g, '0') +
        ':' + padLeft(second, 2).replace(/ /g, '0');
      var head = when + ' ' + HOST + ' sshd[' + pid + ']: ';

      if (i === acceptedAt) {
        lines.push(head + 'Accepted publickey for deploy from ' + accepted +
          ' port ' + (49152 + ri(16000)) + ' ssh2: RSA SHA256:kPq2xR9vNc');
        continue;
      }

      var ip = pick(HOSTILE_NETS) + '.' + ri(256) + '.' + (ri(254) + 1);
      var port = 30000 + ri(30000);
      var user = pick(BAD_USERS);
      var kind = ri(4);
      if (kind === 0) {
        lines.push(head + 'Invalid user ' + user + ' from ' + ip + ' port ' + port);
      } else if (kind === 1) {
        lines.push(head + 'Connection closed by invalid user ' + user + ' ' + ip +
          ' port ' + port + ' [preauth]');
      } else if (kind === 2) {
        lines.push(head + 'error: maximum authentication attempts exceeded for ' +
          user + ' from ' + ip + ' port ' + port + ' ssh2 [preauth]');
      } else {
        lines.push(head + 'Failed password for invalid user ' + user + ' from ' +
          ip + ' port ' + port + ' ssh2');
      }
    }
    return { text: lines.join('\n') + '\n', ip: accepted };
  }

  /* ---- the rest of the content ------------------------------------ */
  var NOTES = [
    'rack 4 shelf 2 - one spare PSU, never bench tested',
    'rack 1 shelf 5 - two 8TB drives, one of them clicks, do not deploy it',
    'ups battery replaced on 2024-03-11, next capacity check due 2026-03',
    'the cage key lives on the hook behind the desk in the corner and not in the drawer by the door, whatever the label on that drawer says, because the label was printed before the desk moved',
    'switch in rack 2 has one dead SFP cage, port 47, taped over',
    'cold aisle runs about four degrees warmer than the sensor claims',
    'the loud fan is the old backup box, it is meant to sound like that',
    'do not power cycle rack 3 without telling the storage team first',
    'spare fibre patch leads are in the blue crate under the bench',
    'label printer needs 24mm tape, the 12mm rolls are for the desk one',
    'front door badge reader fails open after a power cut, raise it again',
    'nvme sled 7 was RMAd in January, the empty bay is deliberate',
    'coffee is not allowed past the second door and this is enforced'
  ];

  var UPLOAD_TEXT =
    'Site survey, north building.\n' +
    'Two racks free in row C. Power is 32A per rack, single feed only.\n' +
    'No structured cabling above the suspended ceiling on that side.\n' +
    'Recommend the south building for anything that needs redundancy.\n';

  var VAULT_FLAG = 'flag{brass-tumbler}';
  var HOME_FLAG = 'flag{cold-start}';
  var KEYRING_FLAG = 'flag{dot-and-dash}';

  function buildFs() {
    rnd = GameShell.seeded(SEED);

    var root = mk(null, '', 'dir', '755');

    var bin = mk(root, 'bin', 'dir', '755');
    var tools = ['cat', 'chmod', 'echo', 'file', 'find', 'grep', 'head', 'ls', 'sh', 'strings', 'tail', 'wc'];
    for (var b = 0; b < tools.length; b++) {
      mk(bin, tools[b], 'file', '755', MAGIC_ELF + junk(40) + '/lib64/ld-linux-x86-64.so.2' + junk(30));
    }

    var etc = mk(root, 'etc', 'dir', '755');
    mk(etc, 'hostname', 'file', '644', HOST + '\n');
    mk(etc, 'shells', 'file', '644', '# /etc/shells: valid login shells\n/bin/sh\n/bin/dash\n/bin/bash\n');
    mk(etc, 'motd', 'file', '644',
      'Welcome to ' + HOST + '.\n\n' +
      'This is a reimplementation of a shell, not a shell. Thirteen commands\n' +
      'work; everything else does not exist. Type help to see the list.\n');

    var home = mk(root, 'home', 'dir', '755');
    var player = mk(home, 'player', 'dir', '755');
    mk(player, 'readme.txt', 'file', '644',
      'You have a shell and eight things to find.\n\n' +
      'Nothing here is a real machine. Files live in memory, the commands are\n' +
      'reimplementations, and closing the tab throws all of it away.\n\n' +
      'First flag, since you are already here: ' + HOME_FLAG + '\n\n' +
      'Answer with:  answer ' + HOME_FLAG + '\n');
    var notesDir = mk(player, 'notes', 'dir', '755');
    mk(notesDir, 'todo.txt', 'file', '644',
      '- chase the vault keycard, permissions are wrong again\n' +
      '- rev3 firmware still in /usr/share somewhere, needs unlocking\n' +
      '- somebody dumped four files in /srv/uploads with the wrong names\n');
    var conf = mk(player, '.config', 'dir', '755');
    mk(conf, 'prefs.ini', 'file', '644', '[editor]\nwrap=off\ntabs=4\n');
    mk(conf, '.keyring', 'file', '600',
      '# not a real keyring, and a real one would not be a text file\n' +
      KEYRING_FLAG + '\n');
    mk(player, '.profile', 'file', '644', '# no variables in this shell, so this file does nothing\numask 022\n');

    var varDir = mk(root, 'var', 'dir', '755');
    var log = mk(varDir, 'log', 'dir', '755');
    var boot = buildBootLog();
    var auth = buildAuthLog();
    mk(log, 'boot.log', 'file', '644', boot, 'Feb 14 03:01');
    mk(log, 'auth.log', 'file', '644', auth.text, 'Feb 14 03:44');

    var srv = mk(root, 'srv', 'dir', '755');
    var data = mk(srv, 'data', 'dir', '755');
    mk(data, 'notes.txt', 'file', '644', NOTES.join('\n') + '\n');
    var uploads = mk(srv, 'uploads', 'dir', '755');
    mk(uploads, 'photo.txt', 'file', '644',
      MAGIC_PNG + junk(8) + 'IHDR' + junk(180) + 'IDAT' + junk(220) + 'IEND' + junk(4));
    mk(uploads, 'notes.png', 'file', '644', UPLOAD_TEXT);
    mk(uploads, 'archive.jpg', 'file', '644', MAGIC_GZIP + junk(160));
    mk(uploads, 'run.dat', 'file', '755',
      '#!/bin/sh\n# rotates the survey exports, cron runs it at 04:00\nfind /srv/data -name "*.csv" -type f\n');

    var opt = mk(root, 'opt', 'dir', '755');
    var vault = mk(opt, 'vault', 'dir', '755');
    mk(vault, 'README', 'file', '644',
      'The keycard file in here has had its permission bits stripped.\n' +
      'ls -l will show you the mode. chmod puts the read bit back.\n');
    mk(vault, 'keycard', 'file', '000',
      'keycard 0x4417, issued to the night shift\n' + VAULT_FLAG + '\n');

    var usr = mk(root, 'usr', 'dir', '755');
    var share = mk(usr, 'share', 'dir', '755');
    var firmware = mk(share, 'firmware', 'dir', '755');
    var rev3 = mk(firmware, 'rev3', 'dir', '755');
    mk(rev3, 'notes.md', 'file', '644',
      '# rev3\n\nBlob is stripped. The unlock string is still compiled into it,\nwhich is exactly why you should never do this.\n');
    mk(rev3, 'core.bin', 'file', '644',
      MAGIC_ELF + junk(26) +
      '/lib64/ld-linux-x86-64.so.2' + junk(18) +
      'libc.so.6' + junk(22) +
      'GCC: (GNU) 12.2.0' + junk(30) +
      'firmware rev3 build 2024-11-08' + junk(24) +
      'unlock_passphrase=' + PASSPHRASE + junk(28) +
      '.shstrtab' + junk(14) + '.text' + junk(20) + '.rodata' + junk(18));

    return { root: root, auth: auth, boot: boot };
  }

  /* ------------------------------------------------------------------
     Reading the answers back out of what was just generated.
     ------------------------------------------------------------------ */
  function longestLine(text) {
    var lines = text.split('\n');
    var max = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length > max) max = lines[i].length;
    }
    return max;
  }

  var BUILT = buildFs();

  var ACCEPTED_IP = BUILT.auth.ip;
  var LONGEST = longestLine(NOTES.join('\n') + '\n');
  var BOOT_LINES = BUILT.boot.replace(/\n$/, '').split('\n');
  var FAILED_UNIT = (function () {
    var last = BOOT_LINES[BOOT_LINES.length - 1];
    var m = last.match(/Failed to start ([a-z]+)\.service/);
    return m ? m[1] : 'nginx';
  })();

  var QUESTS = [
    {
      title: 'Look around',
      brief: 'Your home directory has a readme in it. Read the file and answer with the flag it contains.',
      hint: 'pwd prints where you are. ls lists what is here. cat readme.txt prints it.',
      accepts: [HOME_FLAG, 'cold-start']
    },
    {
      title: 'The dot files',
      brief: 'Something in your home directory is hidden. Find the keyring and answer with the flag inside it.',
      hint: 'A name starting with a dot is left out of a plain ls. Try ls -a — and note there is a dot-directory as well as a dot-file.',
      accepts: [KEYRING_FLAG, 'dot-and-dash']
    },
    {
      title: 'The end of the log',
      brief: '/var/log/boot.log is 238 lines and only the last one matters: one unit failed to start. Name the unit.',
      hint: 'tail -n 1 /var/log/boot.log prints the final line without printing the other 237.',
      accepts: [FAILED_UNIT, FAILED_UNIT + '.service']
    },
    {
      title: 'One success in a wall of failure',
      brief: '/var/log/auth.log is nearly two hundred failed logins with exactly one success buried in it. What address did the successful login come from?',
      hint: 'grep prints the lines that match. Every failure says Failed, Invalid or error; the one that worked says Accepted.',
      accepts: [ACCEPTED_IP]
    },
    {
      title: 'The long line',
      brief: 'One line in /srv/data/notes.txt is much longer than the others. How many characters long is it?',
      hint: 'wc -L prints the length of the longest line in a file. Plain wc gives you lines, words and characters instead.',
      accepts: [String(LONGEST)]
    },
    {
      title: 'Names lie, bytes do not',
      brief: 'Four files were dumped in /srv/uploads and one of them is a PNG image wearing the wrong extension. Give the filename.',
      hint: 'file ignores the name and reads the first few bytes. file /srv/uploads/* does all four at once.',
      accepts: ['photo.txt', '/srv/uploads/photo.txt']
    },
    {
      title: 'Locked out of your own file',
      brief: '/opt/vault/keycard is there but cat will not read it. Put the read bit back and answer with the flag inside.',
      hint: 'ls -l shows the mode as ---------. chmod +r keycard adds read for everyone; chmod 644 keycard sets the whole mode at once.',
      accepts: [VAULT_FLAG, 'brass-tumbler']
    },
    {
      title: 'Words inside a blob',
      brief: 'Exactly one file under / has a name ending in .bin. Find it, then get the unlock passphrase out of it without a hex editor.',
      hint: 'find / -name "*.bin" walks the whole tree. strings pulls the runs of readable characters out of a binary.',
      accepts: [PASSPHRASE, 'unlock_passphrase=' + PASSPHRASE]
    }
  ];

  /* ------------------------------------------------------------------
     Tokenising. Quoted tokens are marked so that grep '*' searches for a
     star rather than being handed the contents of the directory.
     ------------------------------------------------------------------ */
  function tokenise(input) {
    var tokens = [];
    var cur = '';
    var quote = '';
    var quoted = false;
    var i;
    for (i = 0; i < input.length; i++) {
      var ch = input.charAt(i);
      if (quote) {
        if (ch === quote) { quote = ''; }
        else cur += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        quoted = true;
      } else if (ch === ' ' || ch === '\t') {
        if (cur.length || quoted) { tokens.push({ text: cur, quoted: quoted }); cur = ''; quoted = false; }
      } else {
        cur += ch;
      }
    }
    if (cur.length || quoted) tokens.push({ text: cur, quoted: quoted });
    return tokens;
  }

  function globToRe(pattern) {
    var out = '';
    for (var i = 0; i < pattern.length; i++) {
      var ch = pattern.charAt(i);
      if (ch === '*') out += '[^/]*';
      else if (ch === '?') out += '[^/]';
      else if ('\\^$.|+()[]{}'.indexOf(ch) >= 0) out += '\\' + ch;
      else out += ch;
    }
    return new RegExp('^' + out + '$');
  }

  GameShell.define({
    id: 'game-shell-quest',
    slug: 'shell-quest',
    title: 'Shell quest',
    bestKey: 'shell-quest',
    bestOrder: 'low',
    formatBest: function (n) { return n + ' commands'; },
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var screen = null;
      var briefEl = null;
      var typedEl = null;
      var afterEl = null;
      var promptEl = null;
      var input = null;

      var fs = null;
      var cwd = null;
      var quest = 0;
      var commands = 0;
      var history = [];
      var histAt = 0;

      /* ---------------- output ---------------- */
      function newLine(cls) {
        var d = document.createElement('div');
        d.className = 'shq-line' + (cls ? ' ' + cls : '');
        screen.appendChild(d);
        while (screen.children.length > MAX_LINES) screen.removeChild(screen.firstChild);
        return d;
      }

      function scrollDown() { screen.scrollTop = screen.scrollHeight; }

      function out(text, cls) {
        newLine(cls).textContent = text == null ? '' : String(text);
      }

      function outBlock(text, cls) {
        var lines = String(text).replace(/\n$/, '').split('\n');
        for (var i = 0; i < lines.length; i++) out(lines[i], cls);
      }

      function err(text) { out(text, 'is-err'); }

      /* ---------------- paths ---------------- */
      function pathOf(node) {
        var parts = [];
        var n = node;
        while (n && n.parent) { parts.unshift(n.name); n = n.parent; }
        return '/' + parts.join('/');
      }

      function shortPath(node) {
        var p = pathOf(node);
        if (p === HOME) return '~';
        if (p.indexOf(HOME + '/') === 0) return '~' + p.slice(HOME.length);
        return p;
      }

      function childNamed(node, name) {
        if (node.type !== 'dir') return null;
        for (var i = 0; i < node.kids.length; i++) {
          if (node.kids[i].name === name) return node.kids[i];
        }
        return null;
      }

      function resolve(pathStr) {
        if (pathStr == null || pathStr === '') return cwd;
        var node = pathStr.charAt(0) === '/' ? fs : cwd;
        if (pathStr.charAt(0) === '~') {
          node = resolve(HOME);
          pathStr = pathStr.slice(1);
        }
        var parts = pathStr.split('/');
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          if (part === '' || part === '.') continue;
          if (part === '..') { node = node.parent || node; continue; }
          if (node.type !== 'dir') return null;
          node = childNamed(node, part);
          if (!node) return null;
        }
        return node;
      }

      /* One user owns everything here, so only the owner read bit is ever
         consulted. Modelling groups would add a second thing to explain
         and not one extra puzzle. */
      function readable(node) { return (node.mode & o('400')) !== 0; }

      function modeString(node) {
        var s = node.type === 'dir' ? 'd' : '-';
        var bits = 'rwxrwxrwx';
        for (var i = 0; i < 9; i++) {
          s += (node.mode & (1 << (8 - i))) ? bits.charAt(i) : '-';
        }
        return s;
      }

      function sizeOf(node) { return node.type === 'dir' ? 4096 : node.text.length; }

      function sortKids(list) {
        var copy = list.slice(0);
        copy.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
        return copy;
      }

      /* ---------------- globbing ---------------- */
      function expand(tokens) {
        var args = [];
        for (var i = 0; i < tokens.length; i++) {
          var t = tokens[i];
          if (t.quoted || (t.text.indexOf('*') < 0 && t.text.indexOf('?') < 0)) {
            args.push(t.text);
            continue;
          }
          var cut = t.text.lastIndexOf('/');
          var dirPart = cut < 0 ? '' : t.text.slice(0, cut + 1);
          var base = cut < 0 ? t.text : t.text.slice(cut + 1);
          var dirNode = resolve(dirPart === '' ? '.' : dirPart);
          if (!dirNode || dirNode.type !== 'dir') { args.push(t.text); continue; }
          var re = globToRe(base);
          var kids = sortKids(dirNode.kids);
          var hits = [];
          for (var k = 0; k < kids.length; k++) {
            var name = kids[k].name;
            if (name.charAt(0) === '.' && base.charAt(0) !== '.') continue;
            if (re.test(name)) hits.push(dirPart + name);
          }
          /* No match means the pattern is passed through untouched, which is
             what a real shell does and why unmatched globs produce those
             confusing "no such file: *.bin" errors. */
          if (hits.length) args = args.concat(hits);
          else args.push(t.text);
        }
        return args;
      }

      function parseFlags(args, allowed) {
        var flags = {};
        var rest = [];
        for (var i = 0; i < args.length; i++) {
          var a = args[i];
          if (a.length > 1 && a.charAt(0) === '-' && a !== '--') {
            for (var j = 1; j < a.length; j++) {
              var ch = a.charAt(j);
              if (allowed.indexOf(ch) < 0) flags.bad = ch;
              else flags[ch] = true;
            }
          } else rest.push(a);
        }
        return { flags: flags, rest: rest };
      }

      /* ---------------- file inspection ---------------- */
      function stringsOf(text, min) {
        var found = [];
        var run = '';
        for (var i = 0; i < text.length; i++) {
          var c = text.charCodeAt(i);
          if (c >= 32 && c <= 126) run += text.charAt(i);
          else { if (run.length >= min) found.push(run); run = ''; }
        }
        if (run.length >= min) found.push(run);
        return found;
      }

      function isTextual(text) {
        for (var i = 0; i < text.length; i++) {
          var c = text.charCodeAt(i);
          if (c === 9 || c === 10 || c === 13) continue;
          if (c < 32 || c > 126) return false;
        }
        return true;
      }

      function describe(node) {
        if (node.type === 'dir') return 'directory';
        var t = node.text;
        if (!t.length) return 'empty';
        if (t.charCodeAt(0) === 0x89 && t.slice(1, 4) === 'PNG') return 'PNG image data';
        if (t.charCodeAt(0) === 0xff && t.charCodeAt(1) === 0xd8) return 'JPEG image data';
        if (t.slice(0, 5) === '%PDF-') return 'PDF document, version ' + t.slice(5, 8);
        if (t.charCodeAt(0) === 0x1f && t.charCodeAt(1) === 0x8b) return 'gzip compressed data';
        if (t.slice(0, 2) === 'PK') return 'Zip archive data';
        if (t.charCodeAt(0) === 0x7f && t.slice(1, 4) === 'ELF') return 'ELF 64-bit LSB executable, x86-64, stripped';
        if (t.slice(0, 2) === '#!') {
          var first = t.split('\n')[0];
          return (first.indexOf('sh') >= 0 ? 'POSIX shell script' : 'script') + ', ASCII text executable';
        }
        if (isTextual(t)) return 'ASCII text';
        return 'data';
      }

      /* cat on a binary really does spray the terminal; the control bytes
         are shown as a middle dot rather than actually emitted, because a
         raw 0x07 in innerText is a bell nobody asked for. */
      function visible(text) {
        var s = '';
        for (var i = 0; i < text.length; i++) {
          var c = text.charCodeAt(i);
          if (c === 10 || c === 9) s += text.charAt(i);
          else if (c < 32 || c > 126) s += '·';
          else s += text.charAt(i);
        }
        return s;
      }

      /* ---------------- commands ---------------- */
      function cmdPwd() { out(pathOf(cwd)); }

      function cmdCd(args) {
        var target = args.length ? args[0] : HOME;
        var node = resolve(target);
        if (!node) { err('cd: ' + target + ': No such file or directory'); return; }
        if (node.type !== 'dir') { err('cd: ' + target + ': Not a directory'); return; }
        cwd = node;
        paintPrompt();
      }

      function longRow(node) {
        return modeString(node) + ' 1 player player ' +
          padLeft(sizeOf(node), 6) + ' ' + node.date + ' ' + node.name;
      }

      function cmdLs(args) {
        var p = parseFlags(args, 'al1');
        if (p.flags.bad) { err('ls: invalid option -- ' + p.flags.bad); return; }
        var targets = p.rest.length ? p.rest : ['.'];
        for (var i = 0; i < targets.length; i++) {
          var node = resolve(targets[i]);
          if (!node) { err('ls: cannot access ' + targets[i] + ': No such file or directory'); continue; }
          if (targets.length > 1) out(targets[i] + ':');
          if (node.type === 'file') {
            out(p.flags.l ? longRow(node) : node.name);
          } else {
            var kids = sortKids(node.kids);
            var names = [];
            var rows = [];
            if (p.flags.a) {
              names.push('.');
              names.push('..');
              rows.push(modeString(node) + ' 1 player player   4096 ' + node.date + ' .');
              rows.push(modeString(node.parent || node) + ' 1 player player   4096 ' + node.date + ' ..');
            }
            for (var k = 0; k < kids.length; k++) {
              if (kids[k].name.charAt(0) === '.' && !p.flags.a) continue;
              names.push(kids[k].name);
              rows.push(longRow(kids[k]));
            }
            if (p.flags.l) {
              out('total ' + rows.length);
              for (var r = 0; r < rows.length; r++) out(rows[r]);
            } else if (p.flags['1']) {
              for (var n = 0; n < names.length; n++) out(names[n]);
            } else if (names.length) {
              out(names.join('  '));
            }
          }
          if (targets.length > 1 && i < targets.length - 1) out('');
        }
      }

      function readFile(node, label, cmd) {
        if (!node) { err(cmd + ': ' + label + ': No such file or directory'); return null; }
        if (node.type === 'dir') { err(cmd + ': ' + label + ': Is a directory'); return null; }
        if (!readable(node)) { err(cmd + ': ' + label + ': Permission denied'); return null; }
        return node.text;
      }

      function cmdCat(args) {
        if (!args.length) { err('cat: no file given'); return; }
        for (var i = 0; i < args.length; i++) {
          var node = resolve(args[i]);
          var text = readFile(node, args[i], 'cat');
          if (text === null) continue;
          outBlock(visible(text));
        }
      }

      function countArg(args, dflt) {
        var n = dflt;
        var rest = [];
        for (var i = 0; i < args.length; i++) {
          var a = args[i];
          if (a === '-n' && i + 1 < args.length) { n = parseInt(args[i + 1], 10); i++; }
          else if (/^-n\d+$/.test(a)) n = parseInt(a.slice(2), 10);
          else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10);
          else rest.push(a);
        }
        if (isNaN(n) || n < 0) n = dflt;
        return { n: n, rest: rest };
      }

      function cmdHead(args) { headTail(args, 'head'); }
      function cmdTail(args) { headTail(args, 'tail'); }

      function headTail(args, which) {
        var parsed = countArg(args, 10);
        if (!parsed.rest.length) { err(which + ': no file given'); return; }
        for (var i = 0; i < parsed.rest.length; i++) {
          var node = resolve(parsed.rest[i]);
          var text = readFile(node, parsed.rest[i], which);
          if (text === null) continue;
          if (parsed.rest.length > 1) out('==> ' + parsed.rest[i] + ' <==');
          var lines = text.replace(/\n$/, '').split('\n');
          var slice = which === 'head'
            ? lines.slice(0, parsed.n)
            : lines.slice(Math.max(0, lines.length - parsed.n));
          for (var s = 0; s < slice.length; s++) out(visible(slice[s]));
        }
      }

      function cmdWc(args) {
        var p = parseFlags(args, 'lwcL');
        if (p.flags.bad) { err('wc: invalid option -- ' + p.flags.bad); return; }
        if (!p.rest.length) { err('wc: no file given'); return; }
        var any = p.flags.l || p.flags.w || p.flags.c || p.flags.L;
        for (var i = 0; i < p.rest.length; i++) {
          var node = resolve(p.rest[i]);
          var text = readFile(node, p.rest[i], 'wc');
          if (text === null) continue;
          var body = text.replace(/\n$/, '');
          var lines = text.length ? text.split('\n').length - (text.charAt(text.length - 1) === '\n' ? 1 : 0) : 0;
          var words = body.length ? body.split(/\s+/).filter(function (w) { return w.length > 0; }).length : 0;
          var row = '';
          if (!any || p.flags.l) row += padLeft(lines, 7);
          if (!any || p.flags.w) row += padLeft(words, 8);
          if (!any || p.flags.c) row += padLeft(text.length, 9);
          if (p.flags.L) row += padLeft(longestLine(body), 7);
          out(row + ' ' + p.rest[i]);
        }
      }

      function cmdGrep(args) {
        var p = parseFlags(args, 'invc');
        if (p.flags.bad) { err('grep: invalid option -- ' + p.flags.bad); return; }
        if (p.rest.length < 2) { err('grep: usage is grep [-inv] PATTERN FILE...'); return; }
        var pattern = p.rest[0];
        var files = p.rest.slice(1);
        var re;
        try { re = new RegExp(pattern, p.flags.i ? 'i' : ''); }
        catch (e) { err('grep: ' + pattern + ': invalid expression'); return; }

        for (var f = 0; f < files.length; f++) {
          var node = resolve(files[f]);
          var text = readFile(node, files[f], 'grep');
          if (text === null) continue;
          if (!isTextual(text)) {
            if (re.test(text)) out('Binary file ' + files[f] + ' matches');
            continue;
          }
          var lines = text.replace(/\n$/, '').split('\n');
          var hits = 0;
          for (var i = 0; i < lines.length; i++) {
            var match = re.test(lines[i]);
            if (p.flags.v ? match : !match) continue;
            hits++;
            if (p.flags.c) continue;
            var prefix = files.length > 1 ? files[f] + ':' : '';
            if (p.flags.n) prefix += (i + 1) + ':';
            out(prefix + lines[i], 'is-hit');
          }
          if (p.flags.c) out((files.length > 1 ? files[f] + ':' : '') + hits);
        }
      }

      function cmdFind(args) {
        var start = '.';
        var namePat = null;
        var typeWant = null;
        var i;
        for (i = 0; i < args.length; i++) {
          if (args[i] === '-name' && i + 1 < args.length) { namePat = args[i + 1]; i++; }
          else if (args[i] === '-type' && i + 1 < args.length) { typeWant = args[i + 1]; i++; }
          else if (args[i].charAt(0) === '-') { err('find: unknown predicate ' + args[i]); return; }
          else start = args[i];
        }
        var node = resolve(start);
        if (!node) { err('find: ' + start + ': No such file or directory'); return; }
        var re = namePat ? globToRe(namePat) : null;
        var base = start.replace(/\/$/, '');
        if (base === '') base = '';

        var found = 0;
        var walk = function (n, prefix) {
          var wantType = !typeWant ||
            (typeWant === 'f' && n.type === 'file') ||
            (typeWant === 'd' && n.type === 'dir');
          if ((!re || re.test(n.name || '/')) && wantType) {
            out(prefix === '' ? '/' : prefix);
            found++;
          }
          if (n.type !== 'dir') return;
          var kids = sortKids(n.kids);
          for (var k = 0; k < kids.length; k++) {
            walk(kids[k], prefix === '/' ? '/' + kids[k].name : prefix + '/' + kids[k].name);
          }
        };
        walk(node, base);
        if (!found) out('find: nothing matched');
      }

      function cmdChmod(args) {
        if (args.length < 2) { err('chmod: usage is chmod MODE FILE...'); return; }
        var spec = args[0];
        var files = args.slice(1);
        var octal = /^[0-7]{3,4}$/.test(spec);
        var sym = spec.match(/^([ugoa]*)([+\-=])([rwx]+)$/);
        if (!octal && !sym) { err('chmod: invalid mode: ' + spec); return; }

        for (var i = 0; i < files.length; i++) {
          var node = resolve(files[i]);
          if (!node) { err('chmod: cannot access ' + files[i] + ': No such file or directory'); continue; }
          if (octal) {
            node.mode = o(spec) & o('7777');
            continue;
          }
          var who = sym[1] || 'a';
          var op = sym[2];
          var bits = 0;
          if (sym[3].indexOf('r') >= 0) bits |= 4;
          if (sym[3].indexOf('w') >= 0) bits |= 2;
          if (sym[3].indexOf('x') >= 0) bits |= 1;
          var mask = 0;
          if (who.indexOf('a') >= 0 || who.indexOf('u') >= 0) mask |= bits << 6;
          if (who.indexOf('a') >= 0 || who.indexOf('g') >= 0) mask |= bits << 3;
          if (who.indexOf('a') >= 0 || who.indexOf('o') >= 0) mask |= bits;
          if (op === '+') node.mode |= mask;
          else if (op === '-') node.mode &= ~mask;
          else node.mode = mask;
        }
      }

      function cmdEcho(args) { out(args.join(' ')); }

      function cmdFile(args) {
        if (!args.length) { err('file: no file given'); return; }
        for (var i = 0; i < args.length; i++) {
          var node = resolve(args[i]);
          if (!node) { err(args[i] + ': cannot open (No such file or directory)'); continue; }
          out(args[i] + ': ' + describe(node));
        }
      }

      function cmdStrings(args) {
        var parsed = countArg(args, 4);
        if (!parsed.rest.length) { err('strings: no file given'); return; }
        var min = parsed.n < 1 ? 4 : parsed.n;
        for (var i = 0; i < parsed.rest.length; i++) {
          var node = resolve(parsed.rest[i]);
          var text = readFile(node, parsed.rest[i], 'strings');
          if (text === null) continue;
          var found = stringsOf(text, min);
          for (var s = 0; s < found.length; s++) out(found[s]);
        }
      }

      function cmdHelp() {
        out('Thirteen commands exist. Everything else does not.', 'is-note');
        out('');
        out('  pwd                    print the current directory');
        out('  ls [-a] [-l] [path]    list; -a includes dotfiles, -l shows modes');
        out('  cd [path]              change directory; .. goes up, no argument goes home');
        out('  cat FILE...            print a file');
        out('  head [-n N] FILE       first N lines, ten by default');
        out('  tail [-n N] FILE       last N lines, ten by default');
        out('  grep [-invc] PAT FILE  print matching lines; PAT is a regular expression');
        out('  wc [-lwcL] FILE        lines, words, characters, longest line');
        out('  find [path] [-name P] [-type f|d]');
        out('  file FILE...           identify by content, not by extension');
        out('  strings [-n N] FILE    printable runs inside a binary');
        out('  chmod MODE FILE        644 or +r or go-rwx');
        out('  echo TEXT              print the arguments back');
        out('');
        out('  quest                  restate the current quest');
        out('  hint                   a nudge for it');
        out('  answer TEXT            submit an answer');
        out('  clear                  wipe the screen');
        out('');
        out('Tab completes a half-typed name. Up and Down walk the history.', 'is-note');
        out('There are no pipes, no redirection and no variables.', 'is-note');
      }

      function showQuest() {
        var q = QUESTS[quest];
        if (!q) { out('All eight are done. Restart for another run.', 'is-ok'); return; }
        out('Quest ' + (quest + 1) + ' of ' + QUESTS.length + ' — ' + q.title, 'is-quest');
        outBlock(q.brief, 'is-quest');
      }

      function cmdHint() {
        var q = QUESTS[quest];
        if (!q) { out('Nothing left to hint at.', 'is-note'); return; }
        out(q.hint, 'is-note');
      }

      function cmdAnswer(args) {
        var q = QUESTS[quest];
        if (!q) { out('All eight are already answered.', 'is-ok'); return; }
        if (!args.length) { err('answer: give an answer, for example: answer flag{example}'); return; }
        var given = args.join(' ').toLowerCase().replace(/^\s+|\s+$/g, '');
        var ok = false;
        for (var i = 0; i < q.accepts.length; i++) {
          if (given === String(q.accepts[i]).toLowerCase()) { ok = true; break; }
        }
        if (!ok) {
          err('Not that. Type hint if you want a nudge.');
          g.beep(200, 0.08, 'square');
          return;
        }
        out('Correct — quest ' + (quest + 1) + ' solved.', 'is-ok');
        g.beep(760, 0.06, 'sine');
        quest++;
        g.stat('quest', Math.min(quest + 1, QUESTS.length) + '/' + QUESTS.length);
        if (quest >= QUESTS.length) {
          paintBrief();
          out('');
          out('Eight for eight, in ' + commands + ' commands.', 'is-ok');
          g.over({
            won: true,
            score: commands,
            title: 'All eight solved',
            message: 'Finished in ' + commands + ' commands. Fewer is better, and the ' +
              'filesystem is identical every run, so a second pass is a fair comparison.'
          });
          return;
        }
        out('');
        showQuest();
        paintBrief();
      }

      var TABLE = {
        pwd: cmdPwd, ls: cmdLs, cd: cmdCd, cat: cmdCat, head: cmdHead, tail: cmdTail,
        grep: cmdGrep, wc: cmdWc, find: cmdFind, file: cmdFile, strings: cmdStrings,
        chmod: cmdChmod, echo: cmdEcho, help: cmdHelp, hint: cmdHint, answer: cmdAnswer,
        quest: showQuest,
        clear: function () { screen.innerHTML = ''; }
      };

      var NOT_HERE = {
        vi: 1, vim: 1, nano: 1, emacs: 1, man: 1, sudo: 1, rm: 1, mv: 1, cp: 1,
        touch: 1, mkdir: 1, ps: 1, top: 1, sed: 1, awk: 1, less: 1, more: 1,
        which: 1, sort: 1, uniq: 1, curl: 1, wget: 1, ssh: 1, python: 1, exit: 1
      };

      /* ---------------- the line ---------------- */
      function run(text) {
        var trimmed = text.replace(/^\s+|\s+$/g, '');
        outCmd(trimmed);
        if (!trimmed.length) { scrollDown(); return; }

        history.push(trimmed);
        histAt = history.length;

        var tokens = tokenise(trimmed);
        var name = tokens[0].text;
        var args = expand(tokens.slice(1));

        /* answer takes its text raw: a flag containing a brace must not be
           glob-expanded or unquoted out of recognition. */
        if (name === 'answer') {
          args = [];
          for (var t = 1; t < tokens.length; t++) args.push(tokens[t].text);
        }

        commands++;
        g.stat('cmds', commands);

        if (Object.prototype.hasOwnProperty.call(TABLE, name)) {
          TABLE[name](args);
        } else if (Object.prototype.hasOwnProperty.call(NOT_HERE, name)) {
          err(name + ': not implemented here. This is thirteen commands in a page, ' +
            'not a machine. /labs/linux runs a real kernel if you want the rest.');
        } else {
          err(name + ': command not found. Type help for the list.');
        }
        scrollDown();
      }

      function outCmd(text) {
        var d = newLine('is-echo');
        var span = document.createElement('span');
        span.className = 'shq-prompt';
        span.textContent = promptText();
        d.appendChild(span);
        d.appendChild(document.createTextNode(' ' + text));
      }

      function promptText() { return 'player@' + HOST + ':' + shortPath(cwd) + '$'; }

      function paintPrompt() {
        if (promptEl) promptEl.textContent = promptText();
      }

      function paintLine() {
        if (!input) return;
        var value = input.value;
        clampCaret();
        lastLen = value.length;
        typedEl.textContent = value.slice(0, caretAt);
        afterEl.textContent = value.slice(caretAt);
      }

      /* ------------------------------------------------------------------
         THE CARET, AND WHY IT IS WRITTEN BACK AFTER EVERY KEYSTROKE.

         The line is edited in an off-screen <input> and drawn as two spans
         either side of a caret block, so all of this rests on knowing where
         the caret is. On a phone the field will not reliably say: after a
         soft keyboard inserts a character, selectionStart reads 0. A caret at
         0 means the next character goes in FRONT of the last one, so typing
         g, i, t produced "tig".

         THE ONE MOMENT THAT MATTERS is the end of a keystroke. Whatever the
         browser has done to the caret by then, the next keystroke inserts
         wherever the field's caret is sitting, and nothing done later can
         move it — setting a selection during beforeinput does NOT retarget an
         insertion that has already been aimed, which is measurable and was
         measured. So the caret has to be correct in the field before the next
         key arrives, which means writing it back on every input event. That
         is the whole fix, and it is what b196d34 was doing when it pinned the
         caret to the end there.

         The attempt between the two remembered the caret instead of pinning
         it, and read it back out of selectionStart. On a keyboard that was
         right. On a phone it read the 0, believed it, and wrote nothing back
         — so the field kept its caret at 0, and "tig" came back.

         So: believe the field while it earns it, and stop when it does not.
         Inserting text can never leave a caret at 0 — whatever you type, the
         caret ends up after it. A field that reports 0 immediately after the
         line got longer has told us it cannot be believed, and from there the
         caret lives at the end of the line: b196d34's behaviour exactly, and
         exactly what a phone needs. It is a one-way trip, so a device is
         never asked to prove itself twice.

         The length is tracked here rather than taken from beforeinput,
         because beforeinput is not guaranteed to arrive — execCommand drives
         an input event without one, and so do some engines. Anything that
         changes the line calls paintLine, so recording it there is the one
         place that cannot be missed.

         The trade is honest: a keyboard, where the field is truthful, keeps
         mid-line editing and mid-line completion. A phone, where it is not,
         gets the version that works.
         ------------------------------------------------------------------ */
      var caretAt = 0;
      var caretTrusted = true;
      var lastLen = 0;

      function clampCaret() {
        var end = input ? input.value.length : 0;
        if (caretAt == null || caretAt < 0) caretAt = 0;
        if (caretAt > end) caretAt = end;
      }

      /* Tell the field where the caret is. Guarded, because setting a
         selection that is already right is what upsets an IME
         mid-composition, and this runs on the way out of every keystroke. */
      function syncCaret() {
        if (!input) return;
        clampCaret();
        if (input.selectionStart !== caretAt || input.selectionEnd !== caretAt) {
          input.setSelectionRange(caretAt, caretAt);
        }
      }

      function onInput() {
        if (!input) return;
        var len = input.value.length;
        if (caretTrusted && len > lastLen && input.selectionStart === 0) {
          caretTrusted = false;
        }
        if (caretTrusted) {
          var at = input.selectionStart;
          caretAt = at == null ? len : at;
        } else {
          caretAt = len;
        }
        syncCaret();
        paintLine();
      }

      /* Keys that move the caret without changing the line. Read back only
         while the field is worth believing; a phone sends none of these. */
      var CARET_KEYS = { ArrowLeft: 1, ArrowRight: 1, Home: 1, End: 1 };

      function onKeyUp(event) {
        if (caretTrusted && input && event && event.key && CARET_KEYS[event.key]) {
          var at = input.selectionStart;
          if (at != null) caretAt = at;
        }
        paintLine();
      }

      function paintBrief() {
        var q = QUESTS[quest];
        if (!briefEl) return;
        if (!q) {
          briefEl.textContent = 'All eight solved. Restart for another run.';
          return;
        }
        briefEl.textContent = 'Quest ' + (quest + 1) + '/' + QUESTS.length + ' — ' +
          q.title + ': ' + q.brief;
      }

      /* Completion is deliberately narrow: the command word, or a path
         fragment against one directory. Anything cleverer would need a
         shell grammar, and this is not one. */
      function complete() {
        var value = input.value;
        clampCaret();
        var caret = caretAt;
        var before = value.slice(0, caret);
        var start = before.lastIndexOf(' ') + 1;
        var frag = before.slice(start);
        if (!frag.length) return false;

        var names = [];
        var replaceFrom = start;
        var prefix = frag;

        if (start === 0 && frag.indexOf('/') < 0) {
          for (var key in TABLE) {
            if (Object.prototype.hasOwnProperty.call(TABLE, key) && key.indexOf(frag) === 0) names.push(key);
          }
        } else {
          var cut = frag.lastIndexOf('/');
          var dirPart = cut < 0 ? '' : frag.slice(0, cut + 1);
          var base = cut < 0 ? frag : frag.slice(cut + 1);
          var dirNode = resolve(dirPart === '' ? '.' : dirPart);
          if (!dirNode || dirNode.type !== 'dir') return true;
          var kids = sortKids(dirNode.kids);
          for (var k = 0; k < kids.length; k++) {
            var nm = kids[k].name;
            if (nm.charAt(0) === '.' && base.charAt(0) !== '.') continue;
            if (nm.indexOf(base) === 0) names.push(dirPart + nm + (kids[k].type === 'dir' ? '/' : ''));
          }
        }

        if (!names.length) return true;

        var common = names[0];
        for (var i = 1; i < names.length; i++) {
          var j = 0;
          while (j < common.length && j < names[i].length && common.charAt(j) === names[i].charAt(j)) j++;
          common = common.slice(0, j);
        }
        if (names.length > 1 && common === prefix) {
          outCmd(value);
          out(names.join('  '));
          scrollDown();
          return true;
        }
        var insert = common;
        if (names.length === 1 && insert.charAt(insert.length - 1) !== '/') insert += ' ';
        input.value = value.slice(0, replaceFrom) + insert + value.slice(caret);
        var pos = replaceFrom + insert.length;
        caretAt = pos;
        syncCaret();
        paintLine();
        return true;
      }

      function onKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        /* Paused or finished, the overlay is over the terminal and the only
           useful thing Enter can mean is "start again". */
        if (g.state !== 'playing') {
          if (event.key === 'Enter') { event.preventDefault(); g.start(); }
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          var value = input.value;
          input.value = '';
          caretAt = 0;
          paintLine();
          run(value);
          paintLine();
          return;
        }
        if (event.key === 'Tab') {
          if (complete()) event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          input.value = '';
          caretAt = 0;
          paintLine();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (!history.length) return;
          histAt = Math.max(0, histAt - 1);
          input.value = history[histAt];
          caretAt = input.value.length;
          syncCaret();
          paintLine();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (!history.length) return;
          histAt = Math.min(history.length, histAt + 1);
          input.value = histAt >= history.length ? '' : history[histAt];
          caretAt = input.value.length;
          syncCaret();
          paintLine();
        }
      }

      function focusInput() {
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        syncCaret();
      }

      function build() {
        host.className = 'game-board board-shell-quest';
        host.innerHTML =
          '<p class="shq-brief" id="shq-brief" role="status" aria-live="polite"></p>' +
          '<div class="shq-term" id="shq-term">' +
          '  <div class="shq-screen" id="shq-screen" role="log" aria-live="polite" aria-label="Terminal output"></div>' +
          '  <div class="shq-entry"><span class="shq-prompt" id="shq-prompt"></span>' +
          '<span class="shq-typed" id="shq-typed"></span><span class="shq-caret"></span>' +
          '<span class="shq-after" id="shq-after"></span></div>' +
          '</div>';

        screen = host.querySelector('#shq-screen');
        briefEl = host.querySelector('#shq-brief');
        promptEl = host.querySelector('#shq-prompt');
        typedEl = host.querySelector('#shq-typed');
        afterEl = host.querySelector('#shq-after');

        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Shell command line');
        host.appendChild(input);

        input.addEventListener('keydown', onKey);
        input.addEventListener('input', onInput);
        input.addEventListener('keyup', onKeyUp);
        input.addEventListener('click', onKeyUp);

        /* ----------------------------------------------------------------
           The safety net. Everything above rests on one hidden <input>
           keeping focus, and focus is the least reliable thing on a page —
           a click on the sound toggle, on the fullscreen button beside it,
           or anywhere in the article below the board takes it away. And
           rawInput switches OFF the shell's own fall-through listener, the
           thing that answers keys for every other game once focus has
           dropped to <body>, so after one stray click nothing here was
           listening at all. The run carried on regardless.

           The typing trainer has carried this net for a while and its
           comment says why: a game played by typing must not be one click
           away from ignoring what is typed at it.

           The insertion below is what this one needs and the buffer games do
           not: here the field's own value is the command line, so ordinary
           characters are left to the browser to put in. It will not put in
           one that was delivered to another element — and giving the field
           focus first risks it deciding it will after all, and typing the
           character twice. preventDefault settles the question, and exactly
           one character goes in by hand. Everything after it reaches the
           field normally.

           Narrow enough that it cannot take anyone else's keys: only during
           a run, never out of a form field or the site search, and Space and
           Enter are left to a focused button, so one press cannot both
           activate that button and land here as well.
           ---------------------------------------------------------------- */
        document.addEventListener('keydown', function (event) {
          if (g.state !== 'playing') return;
          if (event.target === input) return;
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          var t = event.target;
          var tag = (t && t.tagName ? t.tagName : '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (t && t.isContentEditable) return;
          if (tag === 'button' && (event.key === ' ' || event.key === 'Enter')) return;
          if (event.key !== 'Backspace' && (!event.key || event.key.length !== 1)) return;
          focusInput();
          event.preventDefault();
          clampCaret();
          var at = caretAt;
          if (event.key === 'Backspace') {
            if (!at) return;
            input.value = input.value.slice(0, at - 1) + input.value.slice(at);
            at--;
          } else {
            input.value = input.value.slice(0, at) + event.key + input.value.slice(at);
            at++;
          }
          /* At the caret rather than on the end, because this terminal lets
             the caret sit mid-line and paintLine draws the line either side
             of it. Appending would throw the character past the tail. */
          caretAt = at;
          syncCaret();
          paintLine();
        });
        /* A CLICK HANDS THE KEYBOARD BACK; A DRAG IS LEFT TO SELECT.

           Focus used to be taken on pointerdown, which is earlier than it
           sounds: the deferred focus() runs while the button is still held,
           and focusing the hidden input moves the document selection into
           that input, so a drag was collapsed before it had travelled two
           pixels. The terminal is styled with a text cursor and quest four
           prints a generated address the player then has to type back, so a
           selection that dies on contact is a promise the box makes and
           cannot keep.

           Deferring the decision to pointerup is what makes it decidable at
           all: only there are the distance travelled and the resulting
           selection both known. A press that went nowhere, or one that
           selected nothing, is a plain click and takes the keyboard back —
           which is also how a stale highlight gets cleared, since focusing
           the input collapses it. A drag that did select keeps both the
           selection and whatever focus the browser gave it, so the copy
           shortcut works and the next click resumes typing. Handing focus
           back after the drag as well would look tidier and undo the whole
           thing, because that focus() is itself what wipes the selection;
           the caret and the highlight are offered one at a time because
           the platform genuinely will not give you both.

           Four pixels of slack rather than none, because a mouse jitters
           under a click and one character caught by accident must not be
           read as somebody wanting to copy it. pointercancel clears the
           anchor because a touch that becomes a scroll never delivers
           pointerup, and a stale anchor would make the next stray release
           read as a click on the terminal. */
        var term = host.querySelector('#shq-term');
        var pressedAt = null;
        term.addEventListener('pointerdown', function (event) {
          if (event.target.closest && event.target.closest('button, a')) { pressedAt = null; return; }
          pressedAt = { x: event.clientX, y: event.clientY };
        });
        term.addEventListener('pointerup', function (event) {
          if (!pressedAt) return;
          var moved = Math.abs(event.clientX - pressedAt.x) + Math.abs(event.clientY - pressedAt.y);
          pressedAt = null;
          var sel = window.getSelection ? window.getSelection() : null;
          if (moved > 4 && sel && String(sel).length) return;
          setTimeout(focusInput, 0);
        });
        term.addEventListener('pointercancel', function () { pressedAt = null; });

        var helpBtn = g.el.querySelector('#game-help');
        if (helpBtn) {
          helpBtn.addEventListener('click', function () {
            outCmd('help');
            cmdHelp();
            scrollDown();
            focusInput();
          });
        }
        var hintBtn = g.el.querySelector('#game-hint');
        if (hintBtn) {
          hintBtn.addEventListener('click', function () {
            outCmd('hint');
            cmdHint();
            scrollDown();
            focusInput();
          });
        }
      }

      build();

      return {
        reset: function () {
          fs = buildFs().root;
          cwd = resolve(HOME) || fs;
          quest = 0;
          commands = 0;
          history = [];
          histAt = 0;
          screen.innerHTML = '';
          input.value = '';

          out('Shell quest — a small filesystem and thirteen commands.', 'is-note');
          out('These are reimplementations, not a shell. Nothing here touches your', 'is-note');
          out('machine and nothing leaves the page. For a real kernel, /labs/linux.', 'is-note');
          out('Type help for the command list.', 'is-note');
          out('');
          showQuest();

          g.stat('quest', '1/' + QUESTS.length);
          g.stat('cmds', 0);
          paintPrompt();
          paintBrief();
          paintLine();
          scrollDown();
          focusInput();
        }
      };
    }
  });
})();

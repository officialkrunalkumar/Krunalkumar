/* Git quest — a simulated repository and the commands that move it.
   --------------------------------------------------------------------------
   Thirteen missions, each a small self-contained scenario: the scene builds
   the repository state, the brief says where to get to, and the player types
   real git commands to get there. Nothing here is git: every command is a
   reimplementation over an in-memory object store, which is the point — the
   store IS the lesson. Three places (working tree, index, history), commits
   as snapshots, branches as labels, and a reflog underneath as the safety
   net. The companion article is /blog/git-explained-from-the-object-up.

   THE SCENE IS REBUILT PER MISSION, NOT CARRIED ACROSS. Early drafts kept
   one repository alive through all thirteen missions; by mission nine every
   goal predicate had to reason about whatever mess the player made in
   mission four, and a player who explored freely could wedge a later
   mission entirely. A scene per mission means exploring cannot break
   anything a `retry` will not fix, and every goal checks a state the scene
   controls.

   THE GRAPH PANEL REDRAWS AFTER EVERY COMMAND. A branch is a sticky note on
   a commit is an easy sentence to read and a hard one to believe; watching
   the label slide while the dots stay put is what makes it land. The
   renderer handles the small graphs the missions produce (a lane per
   concurrent branch, merges joining lanes); it is not gitk, and does not
   need to be.

   THE ONLY SOUNDS ARE THE ONES A TERMINAL MAKES. A run through the whole
   quest is a long time to hear nothing, and this file used to be silent
   from the first keystroke until the shell’s end-of-run sweep. What it has
   now is not a soundtrack: a click under the keys, a two-note rise on the
   green line, a low square on the red one, and a small rising triad when a
   mission falls. The rise and the buzz hang off good() and err() rather
   than off a list of commands, and that is the part worth keeping — every
   command that changed the repository already prints green and every
   refusal already prints red, so wiring the sound to the colour means the
   two cannot drift apart as commands are added. Looking around stays
   silent, because looking around changes nothing. There is no ambient
   layer at all: a terminal between keystrokes makes no noise, and
   inventing a hum for one would be a lie about the instrument.

   Same input contract as shell-quest: rawInput, an off-screen .typing-catch
   input, Tab completing only when there is a word to complete, and the
   click-vs-drag focus rule so printed hashes can be selected and copied —
   the reflog mission depends on that. */
(function () {
  'use strict';

  var MAX_LINES = 500;
  var SEED = 20260829;

  GameShell.define({
    id: 'game-git-quest',
    slug: 'git-quest',
    title: 'Git quest',
    bestKey: 'git-quest',
    bestOrder: 'low',
    formatBest: function (n) { return n + ' commands'; },
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var screen = null;
      var kickEl = null;
      var briefEl = null;
      var noteEl = null;
      var typedEl = null;
      var afterEl = null;
      var promptEl = null;
      var graphEl = null;
      var placesEl = null;
      var input = null;

      var rnd = GameShell.seeded(SEED);

      /* ---------------- repository model ---------------- */
      var repo = null;      /* { commits, branches, head, order } or null   */
      var files = {};       /* working tree: path -> content                */
      var index = null;     /* staging area: path -> content, null pre-init */
      var stash = [];
      var reflog = [];
      var conflict = null;  /* { file, from } while a merge is stopped      */
      var usedIds = {};

      var mission = 0;
      var commands = 0;
      var history = [];
      var histAt = 0;
      var flags = {};       /* per-mission scratch the goals read           */
      var over = false;

      function copyMap(m) {
        var out = {};
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out[k] = m[k];
        return out;
      }

      function sameMap(a, b) {
        var k;
        for (k in a) if (Object.prototype.hasOwnProperty.call(a, k) && a[k] !== b[k]) return false;
        for (k in b) if (Object.prototype.hasOwnProperty.call(b, k) && !(k in a)) return false;
        return true;
      }

      function newId() {
        var id = '';
        do {
          id = '';
          for (var i = 0; i < 7; i++) id += '0123456789abcdef'.charAt(Math.floor(rnd() * 16));
        } while (usedIds[id]);
        usedIds[id] = true;
        return id;
      }

      function headId() {
        if (!repo) return null;
        if (repo.head.detached) return repo.head.id;
        return repo.branches[repo.head.ref] || null;
      }

      function headTree() {
        var id = headId();
        return id ? repo.commits[id].tree : {};
      }

      function makeCommit(parents, tree, msg) {
        var id = newId();
        repo.order++;
        repo.commits[id] = { parents: parents, tree: copyMap(tree), msg: msg, n: repo.order };
        return id;
      }

      function logHead(desc) {
        reflog.unshift({ id: headId(), d: desc });
        if (reflog.length > 40) reflog.pop();
      }

      function moveHead(id, desc) {
        if (repo.head.detached) repo.head.id = id;
        else repo.branches[repo.head.ref] = id;
        logHead(desc);
      }

      function resolveRef(name) {
        if (!repo || !name) return null;
        var tilde = name.match(/^(.+?)(~+|~\d+)$/);
        var back = 0;
        if (tilde) {
          name = tilde[1];
          back = tilde[2].charAt(0) === '~' && tilde[2].length > 1 && tilde[2].charAt(1) !== '~'
            ? parseInt(tilde[2].slice(1), 10)
            : tilde[2].length;
          if (tilde[2] === '~') back = 1;
        }
        var id = null;
        if (name === 'HEAD') id = headId();
        else if (Object.prototype.hasOwnProperty.call(repo.branches, name)) id = repo.branches[name];
        else if (repo.tags && Object.prototype.hasOwnProperty.call(repo.tags, name)) id = repo.tags[name];
        else {
          for (var c in repo.commits) {
            if (Object.prototype.hasOwnProperty.call(repo.commits, c) && c.indexOf(name) === 0) { id = c; break; }
          }
        }
        while (id && back > 0) {
          id = repo.commits[id].parents[0] || null;
          back--;
        }
        return id;
      }

      function isAncestor(a, b) {
        /* is a an ancestor of (or equal to) b */
        if (!a || !b) return false;
        var seen = {};
        var queue = [b];
        while (queue.length) {
          var id = queue.pop();
          if (id === a) return true;
          if (seen[id]) continue;
          seen[id] = true;
          var ps = repo.commits[id].parents;
          for (var i = 0; i < ps.length; i++) queue.push(ps[i]);
        }
        return false;
      }

      function mergeBase(a, b) {
        var anc = {};
        var queue = [a];
        while (queue.length) {
          var id = queue.pop();
          if (anc[id]) continue;
          anc[id] = true;
          var ps = repo.commits[id].parents;
          for (var i = 0; i < ps.length; i++) queue.push(ps[i]);
        }
        var best = null;
        var q2 = [b];
        var seen = {};
        while (q2.length) {
          var id2 = q2.shift();
          if (seen[id2]) continue;
          seen[id2] = true;
          if (anc[id2]) {
            if (!best || repo.commits[id2].n > repo.commits[best].n) best = id2;
            continue;
          }
          var ps2 = repo.commits[id2].parents;
          for (var j = 0; j < ps2.length; j++) q2.push(ps2[j]);
        }
        return best;
      }

      function changesBetween(base, tree) {
        /* paths whose content differs, including adds and deletes */
        var out = {};
        var k;
        for (k in tree) if (Object.prototype.hasOwnProperty.call(tree, k) && tree[k] !== base[k]) out[k] = tree[k];
        for (k in base) if (Object.prototype.hasOwnProperty.call(base, k) && !(k in tree)) out[k] = null;
        return out;
      }

      function dirtyWork() { return !sameMap(files, index); }
      function dirtyIndex() { return !sameMap(index, headTree()); }

      /* ---------------- sound ---------------- */

      /* A figure needs its second note offset from its first, and every
         one-shot the shell offers starts at the context’s current time and
         takes no offset, so the offset has to live here. This is that and
         nothing else: no callback below reads game state, so a note still in
         flight when a scene is rebuilt can only ever make a sound. */
      function after(ms, fn) { setTimeout(fn, ms); }

      /* One key going down. This fires more often than everything else in
         the file put together, so it is the quietest thing on the page:
         0.02, which is what the typing trainer spends on a keystroke, over a
         burst too short to be heard as a pitch.

         Noise rather than a tone, and that is the whole character of it. A
         key is a click; a pitched blip played four hundred times in a run
         stops being feedback and starts being a note the ear tries to make a
         tune out of. The shell reads the shared noise buffer from a random
         point every time, so no two clicks are the same twenty milliseconds,
         and the filter centre wanders a little on top of that because the
         keys of a real keyboard do not all sound alike.

         That wander uses Math.random on purpose. rnd is the seeded stream
         that names commits, and drawing from it here would change every hash
         the player sees for the sake of a click.

         Gated at 50 ms, which is a shorter gap than even a 240 wpm typist
         leaves between keys, so nothing anybody actually types is thinned.
         What the gate catches is the operating system repeating a held
         backspace at thirty a second into a fourteen-voice budget. */
      function tick() {
        if (!g.gate('key', 0.05)) return;
        g.noise(0.022, {
          type: 'bandpass',
          freq: 1700 + Math.random() * 700,
          q: 1.6,
          level: 0.02
        });
      }

      /* Accepted — two notes a fifth apart, rising. Two rather than one
         because a single blip says only “heard you” and this has to say that
         something moved; a fifth rather than a third because it fires several
         times a minute for a whole run and has to stay tellable apart from
         the mission triad, which is built of thirds.

         The upper note is the quieter of the two: at equal amplitude the ear
         hears the higher of a pair as the louder, and the figure is meant to
         read as one gesture rather than as a note and then a brighter one. */
      function accept() {
        g.beep(523, 0.05, 'triangle', 0.04);
        after(60, function () { g.beep(784, 0.07, 'triangle', 0.035); });
      }

      /* Refused — one low square, the oldest “no” a terminal has, and the
         same instrument shell-quest answers a wrong answer with; two
         terminals on the same site should not disagree about what no sounds
         like. Short and low so it cannot be mistaken for the rise, and no
         louder than it either: two of the missions teach their lesson BY
         being refused — the switch that will not switch until the work is
         parked, and the merge that stops rather than guess — and a refusal
         that felt like a punishment would be teaching the wrong thing. */
      function reject() {
        g.beep(150, 0.13, 'square', 0.05);
      }

      /* A mission fell. A rising major triad that STARTS on the note the
         accept rise ended on and keeps climbing: the command that finished
         the mission has usually just played that rise, and continuing from
         its top note is heard as one gesture carrying on rather than as a
         second sound landing on the first. That is also why it waits 130 ms
         — the rise owns the first eighth of a second.

         Plucked, and the only long tail in the file. Eighteen of these in a
         full run is rare enough to be the loudest thing here, and the levels
         fall as the pitch climbs so the figure keeps one loudness on the way
         up.

         The nineteenth mission does not get one. Finishing the last one ends
         the run, and the shell answers that with its own rising sweep; both
         at once is two endings played over each other. */
      function missionChord() {
        after(130, function () { g.pluck(784, 0.16, 0.05, 'triangle'); });
        after(215, function () { g.pluck(988, 0.16, 0.045, 'triangle'); });
        after(300, function () { g.pluck(1175, 0.3, 0.04, 'triangle'); });
      }

      /* ---------------- output ---------------- */
      function newLine(cls) {
        var d = document.createElement('div');
        d.className = 'gq-line' + (cls ? ' ' + cls : '');
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

      /* The two lines that carry a verdict also carry the sound for it. See
         the header: every command that changed the repository prints a green
         line, every refusal prints a red one, and note() — which is the game
         explaining rather than git answering — stays silent. */
      function err(text) { out(text, 'is-err'); reject(); }
      function good(text) { out(text, 'is-ok'); accept(); }
      function note(text) { out(text, 'is-note'); }

      function promptText() { return 'you@repo:~/project' + (repo && conflict ? ' (merging)' : '') + '$'; }

      function outCmd(text) {
        var d = newLine('is-echo');
        var span = document.createElement('span');
        span.className = 'gq-prompt';
        span.textContent = promptText();
        d.appendChild(span);
        d.appendChild(document.createTextNode(' ' + text));
      }

      function paintPrompt() { if (promptEl) promptEl.textContent = promptText(); }

      function paintLine() {
        if (!input) return;
        var value = input.value;
        var caret = input.selectionStart;
        if (caret == null || caret > value.length) caret = value.length;
        caretAt = caret;
        typedEl.textContent = value.slice(0, caret);
        afterEl.textContent = value.slice(caret);
      }

      /* ------------------------------------------------------------------
         WHERE THE CARET WAS, REMEMBERED.

         The line lives in an off-screen <input> and is drawn as two spans
         with a block between them, so the caret a player sees is wherever
         input.selectionStart happens to be. That makes FOCUS the weak point.
         A browser is entitled to drop the caret at position 0 when an input
         is focused programmatically, and mobile Safari reliably does — while
         this terminal focuses the input from a tap on the screen, from the
         Commands and Hint buttons, and again after every command it runs.
         The caret jumped to the front of the line, and the next character
         typed went in front of everything already there.

         Git quest met this first and answered it by pinning the caret to the
         end and never letting it move again (b196d34). That did stop the
         jump. It also cost the thing a command line is for — going back into
         the middle of a line to repair a typo — and it fought the game's own
         code: complete() inserts at the caret and sets the selection to
         match, and the pin threw that away on the very next keystroke.

         Remembering the position stops the same jump and leaves left, right,
         home and end doing what they do in a shell.

         paintLine is where the reading happens, because paintLine already
         reads the caret and is already called after every edit — typing,
         Enter, Escape, history recall, completion. One line there keeps the
         memory current everywhere, with no second bookkeeping path to forget
         to update.
         ------------------------------------------------------------------ */
      var caretAt = 0;

      function restoreCaret() {
        if (!input) return;
        var end = input.value.length;
        var at = caretAt > end ? end : caretAt;   // the line may have shrunk
        if (input.selectionStart !== at || input.selectionEnd !== at) {
          input.setSelectionRange(at, at);
        }
      }

      /* A second chance, for the browsers that move the caret a beat AFTER
         focus rather than during it — which is why the original fix reached
         for beforeinput as well as focus. Only while the selection is
         collapsed, though: a player who has selected the line and started
         typing over it means to replace it, and putting a caret back would
         throw that selection away. */
      function restoreCaretOnInput() {
        if (!input) return;
        if (input.selectionStart !== input.selectionEnd) return;
        restoreCaret();
      }

      function paintMission() {
        var m = MISSIONS[mission];
        if (!kickEl) return;
        if (m) {
          kickEl.textContent = 'Mission ' + (mission + 1) + '/' + MISSIONS.length + ' — ' + m.title;
          briefEl.textContent = m.brief;
        } else {
          kickEl.textContent = 'All ' + MISSIONS.length + ' missions done';
          briefEl.textContent = 'Restart for a fresh run, or keep playing — the sandbox stays open and every command still works.';
        }
      }

      function sayNote(text, cls) {
        if (!noteEl) return;
        noteEl.className = 'gq-mission-note' + (cls ? ' ' + cls : '');
        noteEl.textContent = text == null ? '' : String(text);
      }

      /* ---------------- the three places + graph ---------------- */
      function paintPlaces() {
        if (!placesEl) return;
        if (!repo) {
          placesEl.textContent = 'working tree: ' + countKeys(files) + ' file(s) · no repository yet';
          return;
        }
        var un = 0, st = 0, k;
        for (k in files) if (Object.prototype.hasOwnProperty.call(files, k) && files[k] !== index[k]) un++;
        for (k in index) if (Object.prototype.hasOwnProperty.call(index, k) && !(k in files)) un++;
        var ht = headTree();
        for (k in index) if (Object.prototype.hasOwnProperty.call(index, k) && index[k] !== ht[k]) st++;
        for (k in ht) if (Object.prototype.hasOwnProperty.call(ht, k) && !(k in index)) st++;
        var where = repo.head.detached
          ? 'HEAD detached at ' + (headId() || '?')
          : 'HEAD -> ' + repo.head.ref + (headId() ? ' @ ' + headId() : ' (no commits)');
        placesEl.textContent =
          'working tree: ' + un + ' unstaged · index: ' + st + ' staged · ' + where;
      }

      function countKeys(m) {
        var n = 0;
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) n++;
        return n;
      }

      function decorations(id) {
        var names = [];
        if (repo.head.detached && id === repo.head.id) names.push('HEAD');
        for (var b in repo.branches) {
          if (!Object.prototype.hasOwnProperty.call(repo.branches, b)) continue;
          if (repo.branches[b] === id) {
            names.push(!repo.head.detached && repo.head.ref === b ? 'HEAD -> ' + b : b);
          }
        }
        for (var t in repo.tags) {
          if (Object.prototype.hasOwnProperty.call(repo.tags, t) && repo.tags[t] === id) names.push('tag: ' + t);
        }
        return names.length ? ' (' + names.join(', ') + ')' : '';
      }

      /* A lane per concurrent line of history. Commits arrive newest first;
         each occupies the lane that was waiting for it, first parents keep
         the lane, second parents open one, and a parent two lanes were both
         waiting for closes one. Small graphs only, which is all the scenes
         make. */
      function paintGraph() {
        if (!graphEl) return;
        if (!repo || !headId()) {
          graphEl.textContent = repo
            ? '(no commits yet — the graph starts at the first one)'
            : '(git init creates the object store)';
          return;
        }
        var tips = [];
        var seenTip = {};
        var hid = headId();
        if (hid && !seenTip[hid]) { tips.push(hid); seenTip[hid] = true; }
        for (var b in repo.branches) {
          if (!Object.prototype.hasOwnProperty.call(repo.branches, b)) continue;
          var t = repo.branches[b];
          if (t && !seenTip[t]) { tips.push(t); seenTip[t] = true; }
        }
        for (var tg in repo.tags) {
          if (!Object.prototype.hasOwnProperty.call(repo.tags, tg)) continue;
          var tt = repo.tags[tg];
          if (tt && !seenTip[tt]) { tips.push(tt); seenTip[tt] = true; }
        }
        var ids = [];
        var seen = {};
        var queue = tips.slice();
        while (queue.length) {
          var id = queue.pop();
          if (seen[id]) continue;
          seen[id] = true;
          ids.push(id);
          var ps = repo.commits[id].parents;
          for (var i = 0; i < ps.length; i++) queue.push(ps[i]);
        }
        ids.sort(function (a, c) { return repo.commits[c].n - repo.commits[a].n; });

        var lanes = tips.slice();
        var rows = [];
        for (var r = 0; r < ids.length; r++) {
          var cid = ids[r];
          var col = -1;
          for (var l = 0; l < lanes.length; l++) if (lanes[l] === cid) { col = l; break; }
          if (col < 0) { lanes.push(cid); col = lanes.length - 1; }
          /* every lane waiting on this commit beyond the first collapses */
          for (var l2 = lanes.length - 1; l2 >= 0; l2--) {
            if (l2 !== col && lanes[l2] === cid) lanes.splice(l2, 1);
          }
          var mark = '';
          for (var l3 = 0; l3 < lanes.length; l3++) mark += (l3 === col ? '*' : '|') + ' ';
          var c = repo.commits[cid];
          rows.push(mark + cid + decorations(cid) + ' ' + c.msg);
          lanes[col] = c.parents[0] || null;
          for (var p = 1; p < c.parents.length; p++) lanes.splice(col + 1, 0, c.parents[p]);
          for (var l4 = lanes.length - 1; l4 >= 0; l4--) if (lanes[l4] === null) lanes.splice(l4, 1);
        }
        graphEl.textContent = rows.join('\n');
      }

      function repaint() {
        paintPrompt();
        paintPlaces();
        paintGraph();
      }

      /* ---------------- git commands ---------------- */
      function needRepo() {
        if (repo) return true;
        err('fatal: not a git repository (or any parent up to /): .git missing. git init makes one.');
        return false;
      }

      function gitInit() {
        if (repo) { note('Reinitialised existing repository. Nothing was lost.'); return; }
        repo = { commits: {}, branches: { main: null }, tags: {}, head: { detached: false, ref: 'main' }, order: 0 };
        index = {};
        good('Initialised empty Git repository in ~/project/.git/');
        note('A hidden folder now holds the object store. Your files are untracked until you add them.');
        flags.inited = true;
      }

      function gitStatus() {
        if (!needRepo()) return;
        out('On branch ' + (repo.head.detached ? '(detached HEAD)' : repo.head.ref));
        if (conflict) {
          err('You have unmerged paths: both modified ' + conflict.file);
          note('Fix it (git checkout --ours ' + conflict.file + ' or --theirs), then git add, then git commit.');
        }
        var ht = headTree();
        var staged = [], unstaged = [], untracked = [], k;
        for (k in index) {
          if (!Object.prototype.hasOwnProperty.call(index, k)) continue;
          if (index[k] !== ht[k]) staged.push((k in ht ? 'modified' : 'new file') + ':  ' + k);
        }
        for (k in ht) if (Object.prototype.hasOwnProperty.call(ht, k) && !(k in index)) staged.push('deleted:   ' + k);
        for (k in files) {
          if (!Object.prototype.hasOwnProperty.call(files, k)) continue;
          if (!(k in index)) untracked.push(k);
          else if (files[k] !== index[k]) unstaged.push('modified:  ' + k);
        }
        for (k in index) if (Object.prototype.hasOwnProperty.call(index, k) && !(k in files)) unstaged.push('deleted:   ' + k);
        if (staged.length) { out('Changes to be committed:'); outAll(staged, 'is-ok'); }
        if (unstaged.length) { out('Changes not staged for commit:'); outAll(unstaged, 'is-err'); }
        if (untracked.length) { out('Untracked files:'); outAll(untracked, 'is-err'); }
        if (!staged.length && !unstaged.length && !untracked.length && !conflict) {
          out('nothing to commit, working tree clean');
        }
      }

      function outAll(list, cls) {
        for (var i = 0; i < list.length; i++) out('        ' + list[i], cls);
      }

      function gitAdd(args) {
        if (!needRepo()) return;
        if (!args.length) { err('Nothing specified, nothing added. Try git add . or a file name.'); return; }
        var added = 0;
        if (args[0] === '.' || args[0] === '-A' || args[0] === '--all') {
          for (var k in files) if (Object.prototype.hasOwnProperty.call(files, k)) { index[k] = files[k]; added++; }
          for (var d in index) if (Object.prototype.hasOwnProperty.call(index, d) && !(d in files)) { delete index[d]; }
        } else {
          for (var i = 0; i < args.length; i++) {
            var f = args[i];
            if (Object.prototype.hasOwnProperty.call(files, f)) { index[f] = files[f]; added++; }
            else if (Object.prototype.hasOwnProperty.call(index, f)) { delete index[f]; added++; }
            else { err("fatal: pathspec '" + f + "' did not match any files"); return; }
          }
        }
        if (conflict && (args[0] === '.' || indexOfStr(args, conflict.file) >= 0)) {
          if (String(files[conflict.file]).indexOf('<<<<<<<') >= 0) {
            err('error: ' + conflict.file + ' still has conflict markers. Decide first, then add.');
            index[conflict.file] = headTree()[conflict.file];
            return;
          }
          conflict.resolved = true;
          good('Conflict marked resolved. Commit to finish the merge.');
        }
        note('Staged ' + added + ' path(s). The index now holds the exact bytes you added — later edits stay unstaged.');
        flags.added = true;
      }

      function indexOfStr(arr, s) {
        for (var i = 0; i < arr.length; i++) if (arr[i] === s) return i;
        return -1;
      }

      function gitCommit(args) {
        if (!needRepo()) return;
        var amend = indexOfStr(args, '--amend') >= 0;
        var mi = indexOfStr(args, '-m');
        var msg = mi >= 0 && args[mi + 1] ? args[mi + 1] : null;
        if (!msg) { err('error: this game needs the message inline: git commit ' + (amend ? '--amend ' : '') + '-m "what changed"'); return; }
        if (conflict && !conflict.resolved) {
          err('error: committing is not possible because you have unmerged files.');
          return;
        }
        if (amend) {
          var tip = headId();
          if (!tip) { err('error: nothing to amend — there is no commit yet.'); return; }
          var nid = makeCommit(repo.commits[tip].parents.slice(), index, msg);
          moveHead(nid, 'commit (amend): ' + msg);
          good('[' + (repo.head.detached ? 'detached' : repo.head.ref) + ' ' + nid + '] ' + msg);
          note('Amend wrote a NEW commit with the same parent and moved the label — the old hash is now unlabelled. Never amend what others already have.');
          flags.amended = true;
          return;
        }
        if (!dirtyIndex() && !conflict) {
          err('nothing to commit' + (dirtyWork() ? ' (changes exist but are not staged — git add first)' : ', working tree clean'));
          return;
        }
        var parents = headId() ? [headId()] : [];
        if (conflict && conflict.resolved) parents.push(conflict.from);
        var parentTree = parents.length ? repo.commits[parents[0]].tree : {};
        if (countKeys(changesBetween(parentTree, index)) === 1) flags.selective = true;
        var id = makeCommit(parents, index, msg);
        var wasConflict = !!conflict;
        conflict = null;
        moveHead(id, 'commit: ' + msg);
        good('[' + (repo.head.detached ? 'detached' : repo.head.ref) + ' ' + id + '] ' + msg);
        if (parents.length === 2) note('A merge commit — two parents, one tree. The graph joins here.');
        if (wasConflict) flags.mergedConflict = true;
        flags.committed = (flags.committed || 0) + 1;
      }

      function gitLog(args) {
        if (!needRepo()) return;
        if (!headId()) { err('fatal: your current branch does not have any commits yet'); return; }
        var all = indexOfStr(args, '--all') >= 0;
        var start = [headId()];
        if (all) {
          for (var b in repo.branches) {
            if (Object.prototype.hasOwnProperty.call(repo.branches, b) && repo.branches[b]) start.push(repo.branches[b]);
          }
        }
        var seen = {};
        var ids = [];
        var queue = start.slice();
        while (queue.length) {
          var id = queue.pop();
          if (!id || seen[id]) continue;
          seen[id] = true;
          ids.push(id);
          var ps = repo.commits[id].parents;
          for (var i = 0; i < ps.length; i++) queue.push(ps[i]);
        }
        ids.sort(function (a, c) { return repo.commits[c].n - repo.commits[a].n; });
        for (var r = 0; r < ids.length; r++) {
          out(ids[r] + decorations(ids[r]) + ' ' + repo.commits[ids[r]].msg);
        }
        flags.logged = true;
      }

      function diffLines(oldText, newText, name) {
        out('--- a/' + name);
        out('+++ b/' + name);
        var a = String(oldText == null ? '' : oldText).split('\n');
        var c = String(newText == null ? '' : newText).split('\n');
        for (var i = 0; i < a.length; i++) if (indexOfStr(c, a[i]) < 0) out('- ' + a[i], 'is-err');
        for (var j = 0; j < c.length; j++) if (indexOfStr(a, c[j]) < 0) out('+ ' + c[j], 'is-ok');
      }

      function gitDiff(args) {
        if (!needRepo()) return;
        var staged = indexOfStr(args, '--staged') >= 0 || indexOfStr(args, '--cached') >= 0;
        var from = staged ? headTree() : index;
        var to = staged ? index : files;
        var any = false;
        var k;
        for (k in to) {
          if (!Object.prototype.hasOwnProperty.call(to, k)) continue;
          if (!staged && !(k in index)) continue; /* untracked stays out of diff, like git */
          if (to[k] !== from[k]) { diffLines(from[k], to[k], k); any = true; }
        }
        for (k in from) {
          if (Object.prototype.hasOwnProperty.call(from, k) && !(k in to)) { diffLines(from[k], null, k); any = true; }
        }
        if (!any) note(staged ? 'Index and HEAD agree — nothing staged.' : 'Working tree and index agree' + (dirtyIndex() ? ' — the change you are looking for is staged; try git diff --staged.' : '.'));
        if (any && !staged) flags.diffed = true;
        if (any && staged) flags.diffedStaged = true;
      }

      function gitBranch(args) {
        if (!needRepo()) return;
        if (!args.length) {
          for (var b in repo.branches) {
            if (Object.prototype.hasOwnProperty.call(repo.branches, b)) {
              out((!repo.head.detached && repo.head.ref === b ? '* ' : '  ') + b);
            }
          }
          return;
        }
        if (args[0] === '-d' || args[0] === '-D') {
          var dead = args[1];
          if (!Object.prototype.hasOwnProperty.call(repo.branches, dead)) { err("error: branch '" + dead + "' not found."); return; }
          if (!repo.head.detached && repo.head.ref === dead) { err('error: cannot delete the branch you are on.'); return; }
          delete repo.branches[dead];
          good('Deleted branch ' + dead + '. The commits are untouched — only the label is gone.');
          return;
        }
        if (Object.prototype.hasOwnProperty.call(repo.branches, args[0])) { err("fatal: a branch named '" + args[0] + "' already exists"); return; }
        repo.branches[args[0]] = headId();
        good('Branch ' + args[0] + ' now points at ' + (headId() || 'nothing') + '. Creating it moved no files at all.');
      }

      function guardSwitch() {
        if (conflict) { err('error: finish the merge first (or git merge --abort).'); return false; }
        if (dirtyWork() || dirtyIndex()) {
          err('error: your local changes would be overwritten by checkout.');
          note('Commit them or stash them, then switch. (This refusal is the stash mission’s whole plot.)');
          return false;
        }
        return true;
      }

      function switchTo(name, create) {
        if (create) {
          if (Object.prototype.hasOwnProperty.call(repo.branches, name)) { err("fatal: a branch named '" + name + "' already exists"); return; }
          repo.branches[name] = headId();
        }
        if (Object.prototype.hasOwnProperty.call(repo.branches, name)) {
          if (!guardSwitch()) return;
          repo.head = { detached: false, ref: name };
          var tree = headTree();
          files = copyMap(tree);
          index = copyMap(tree);
          logHead('checkout: moving to ' + name);
          good("Switched to branch '" + name + "'");
          flags.switched = (flags.switched || 0) + 1;
          return;
        }
        var id = resolveRef(name);
        if (!id) { err("fatal: invalid reference: " + name); return; }
        if (!guardSwitch()) return;
        repo.head = { detached: true, id: id };
        files = copyMap(repo.commits[id].tree);
        index = copyMap(repo.commits[id].tree);
        logHead('checkout: detached at ' + id);
        note('HEAD is now detached at ' + id + '. Look around freely; switch back with git switch main.');
      }

      function gitSwitch(args) {
        if (!needRepo()) return;
        if (!args.length) { err('usage: git switch <branch>   or   git switch -c <new-branch>'); return; }
        if (args[0] === '-c') {
          if (!args[1]) { err('error: switch -c needs a name'); return; }
          switchTo(args[1], true);
        } else switchTo(args[0], false);
      }

      function gitCheckout(args) {
        if (!needRepo()) return;
        if (!args.length) { err('usage: git checkout <branch|commit>, -b <new>, or --ours/--theirs <file>'); return; }
        if (args[0] === '-b') { if (!args[1]) { err('error: checkout -b needs a name'); return; } switchTo(args[1], true); return; }
        if (args[0] === '--ours' || args[0] === '--theirs') {
          if (!conflict) { err('error: no merge in progress.'); return; }
          var f = args[1] || conflict.file;
          if (f !== conflict.file) { err("error: '" + f + "' is not conflicted."); return; }
          files[f] = args[0] === '--ours' ? conflict.ours : conflict.theirs;
          good('Took ' + (args[0] === '--ours' ? 'your side' : 'their side') + ' of ' + f + '. Now git add it to mark it resolved.');
          return;
        }
        switchTo(args[0], false);
      }

      function gitMerge(args) {
        if (!needRepo()) return;
        if (conflict) {
          if (args[0] === '--abort') {
            files = copyMap(headTree());
            index = copyMap(headTree());
            conflict = null;
            note('Merge aborted; back to where you were.');
            return;
          }
          err('error: you are mid-merge already. Resolve it or git merge --abort.');
          return;
        }
        var name = args[0];
        if (!name) { err('usage: git merge <branch>'); return; }
        var target = resolveRef(name);
        if (!target) { err('merge: ' + name + ' - not something we can merge'); return; }
        if (dirtyWork() || dirtyIndex()) { err('error: your local changes would be overwritten by merge. Commit or stash first.'); return; }
        var ours = headId();
        if (target === ours || isAncestor(target, ours)) { note('Already up to date.'); return; }
        if (isAncestor(ours, target)) {
          moveHead(target, 'merge ' + name + ': fast-forward');
          files = copyMap(repo.commits[target].tree);
          index = copyMap(repo.commits[target].tree);
          good('Fast-forward. No new commit — your branch simply continued the same line, so the label slid.');
          flags.fastForwarded = true;
          return;
        }
        var base = mergeBase(ours, target) || ours;
        var baseTree = repo.commits[base] ? repo.commits[base].tree : {};
        var oursChanges = changesBetween(baseTree, repo.commits[ours].tree);
        var theirChanges = changesBetween(baseTree, repo.commits[target].tree);
        var merged = copyMap(repo.commits[ours].tree);
        for (var k in theirChanges) {
          if (!Object.prototype.hasOwnProperty.call(theirChanges, k)) continue;
          if (Object.prototype.hasOwnProperty.call(oursChanges, k) && oursChanges[k] !== theirChanges[k]) {
            /* both sides moved the same path differently: stop and ask */
            conflict = {
              file: k,
              ours: repo.commits[ours].tree[k] || '',
              theirs: repo.commits[target].tree[k] || '',
              from: target,
              resolved: false
            };
            files[k] = '<<<<<<< HEAD (ours)\n' + conflict.ours + '\n=======\n' + conflict.theirs + '\n>>>>>>> ' + name + ' (theirs)';
            err('CONFLICT (content): merge conflict in ' + k);
            note('Both branches changed the same lines and git refuses to guess. The file now holds both versions between markers.');
            note('Pick a side: git checkout --ours ' + k + '   or   git checkout --theirs ' + k + ' — then git add ' + k + ' and git commit.');
            flags.conflicted = true;
            return;
          }
          if (theirChanges[k] === null) delete merged[k];
          else merged[k] = theirChanges[k];
        }
        files = copyMap(merged);
        index = copyMap(merged);
        var id = makeCommit([ours, target], merged, 'Merge branch \'' + name + '\'');
        moveHead(id, 'merge ' + name);
        good('Merge made. Commit ' + id + ' has two parents — the graph records where the lines joined.');
        flags.mergeCommitted = true;
      }

      function gitReset(args) {
        if (!needRepo()) return;
        var mode = '--mixed';
        var rest = [];
        for (var i = 0; i < args.length; i++) {
          if (args[i] === '--soft' || args[i] === '--mixed' || args[i] === '--hard') mode = args[i];
          else rest.push(args[i]);
        }
        var id = rest.length ? resolveRef(rest[0]) : headId();
        if (!id) { err("fatal: ambiguous argument '" + (rest[0] || '') + "': unknown revision"); return; }
        if (conflict) { conflict = null; note('Reset also abandoned the in-progress merge.'); }
        moveHead(id, 'reset ' + mode + ' ' + (rest[0] || 'HEAD'));
        if (mode !== '--soft') index = copyMap(repo.commits[id].tree);
        if (mode === '--hard') files = copyMap(repo.commits[id].tree);
        good('HEAD is now at ' + id + ' ' + repo.commits[id].msg);
        if (mode === '--soft') note('--soft moved only the label: the undone work is still staged, ready to recommit.');
        else if (mode === '--mixed') note('--mixed moved the label and reset the index: the work survives only in your files, unstaged.');
        else note('--hard moved all three places. If that was a mistake, git reflog remembers where you were.');
        flags.reset = mode;
      }

      function gitRevert(args) {
        if (!needRepo()) return;
        var id = resolveRef(args[0] || 'HEAD');
        if (!id) { err("fatal: bad revision '" + (args[0] || '') + "'"); return; }
        if (dirtyWork() || dirtyIndex()) { err('error: commit or stash your changes first, then revert.'); return; }
        var c = repo.commits[id];
        var parent = c.parents[0];
        var parentTree = parent ? repo.commits[parent].tree : {};
        var undo = changesBetween(c.tree, parentTree); /* how to get from c back to its parent */
        var tree = copyMap(headTree());
        for (var k in undo) {
          if (!Object.prototype.hasOwnProperty.call(undo, k)) continue;
          if (undo[k] === null) delete tree[k];
          else tree[k] = undo[k];
        }
        files = copyMap(tree);
        index = copyMap(tree);
        var rid = makeCommit([headId()], tree, 'Revert "' + c.msg + '"');
        moveHead(rid, 'revert ' + id);
        good('[' + (repo.head.detached ? 'detached' : repo.head.ref) + ' ' + rid + '] Revert "' + c.msg + '"');
        note('History moved forwards, not back: the mistake and its undoing are both on record. That is why revert is safe on shared work.');
        flags.reverted = true;
      }

      function gitStash(args) {
        if (!needRepo()) return;
        if (args[0] === 'pop') {
          if (!stash.length) { err('No stash entries found.'); return; }
          var top = stash.pop();
          files = top.files;
          index = top.index;
          good('Stash popped — your parked changes are back in the working tree.');
          flags.stashPopped = true;
          return;
        }
        if (args[0] === 'list') {
          if (!stash.length) { note('The shelf is empty.'); return; }
          for (var i = stash.length - 1; i >= 0; i--) out('stash@{' + (stash.length - 1 - i) + '}: WIP on ' + stash[i].ref);
          return;
        }
        if (!dirtyWork() && !dirtyIndex()) { err('No local changes to save.'); return; }
        stash.push({ files: copyMap(files), index: copyMap(index), ref: repo.head.detached ? 'detached' : repo.head.ref });
        files = copyMap(headTree());
        index = copyMap(headTree());
        good('Saved working directory and index state on the shelf. The tree is clean; switch freely.');
        flags.stashed = true;
      }

      function gitRebase(args) {
        if (!needRepo()) return;
        var name = args[0];
        if (!name) { err('usage: git rebase <branch>'); return; }
        if (repo.head.detached) { err('error: rebase from a branch, not a detached HEAD.'); return; }
        if (dirtyWork() || dirtyIndex()) { err('error: commit or stash your changes first.'); return; }
        var onto = resolveRef(name);
        if (!onto) { err("fatal: invalid upstream '" + name + "'"); return; }
        var ours = headId();
        if (isAncestor(ours, onto)) {
          moveHead(onto, 'rebase: fast-forward to ' + name);
          files = copyMap(repo.commits[onto].tree);
          index = copyMap(repo.commits[onto].tree);
          good('Fast-forwarded to ' + name + '.');
          return;
        }
        if (isAncestor(onto, ours)) { note('Current branch is already based on ' + name + '.'); return; }
        var base = mergeBase(ours, onto);
        var chain = [];
        var id = ours;
        while (id && id !== base) {
          chain.unshift(id);
          id = repo.commits[id].parents[0];
        }
        var newTip = onto;
        for (var i = 0; i < chain.length; i++) {
          var c = repo.commits[chain[i]];
          var pTree = repo.commits[c.parents[0]] ? repo.commits[c.parents[0]].tree : {};
          var delta = changesBetween(pTree, c.tree);
          var tree = copyMap(repo.commits[newTip].tree);
          for (var k in delta) {
            if (!Object.prototype.hasOwnProperty.call(delta, k)) continue;
            if (delta[k] === null) delete tree[k];
            else tree[k] = delta[k];
          }
          newTip = makeCommit([newTip], tree, c.msg);
          out('Applied: ' + c.msg);
        }
        moveHead(newTip, 'rebase onto ' + name);
        files = copyMap(repo.commits[newTip].tree);
        index = copyMap(repo.commits[newTip].tree);
        good('Rebased ' + chain.length + ' commit(s) onto ' + name + '. Same changes, new hashes — the old line is unlabelled now, not gone.');
        note('This is why you never rebase commits other people already have: their labels still point at the old line.');
        flags.rebased = true;
      }

      function gitCherry(args) {
        if (!needRepo()) return;
        var id = resolveRef(args[0]);
        if (!id) { err('usage: git cherry-pick <commit> (find the hash with git log --all)'); return; }
        if (dirtyWork() || dirtyIndex()) { err('error: commit or stash your changes first.'); return; }
        var c = repo.commits[id];
        var pTree = repo.commits[c.parents[0]] ? repo.commits[c.parents[0]].tree : {};
        var delta = changesBetween(pTree, c.tree);
        var tree = copyMap(headTree());
        for (var k in delta) {
          if (!Object.prototype.hasOwnProperty.call(delta, k)) continue;
          if (delta[k] === null) delete tree[k];
          else tree[k] = delta[k];
        }
        files = copyMap(tree);
        index = copyMap(tree);
        var nid = makeCommit([headId()], tree, c.msg);
        moveHead(nid, 'cherry-pick ' + id);
        good('[' + repo.head.ref + ' ' + nid + '] ' + c.msg + ' — one commit’s change, copied here. The original stays where it was.');
        flags.cherryPicked = true;
      }

      function gitReflog() {
        if (!needRepo()) return;
        if (!reflog.length) { note('Nothing yet — the diary fills as HEAD moves.'); return; }
        for (var i = 0; i < reflog.length; i++) {
          out((reflog[i].id || '-------') + ' HEAD@{' + i + '}: ' + reflog[i].d);
        }
        note('Every place HEAD has been, including commits nothing points at any more. This is the safety net.');
        flags.reflogged = true;
      }

      function gitTag(args) {
        if (!needRepo()) return;
        if (!args.length) {
          var any = false;
          for (var t in repo.tags) {
            if (Object.prototype.hasOwnProperty.call(repo.tags, t)) { out(t + ' -> ' + repo.tags[t]); any = true; }
          }
          if (!any) note('No tags yet. git tag <name> pins the current commit.');
          return;
        }
        if (!headId()) { err('fatal: nothing to tag — no commits yet.'); return; }
        if (Object.prototype.hasOwnProperty.call(repo.tags, args[0])) { err("fatal: tag '" + args[0] + "' already exists"); return; }
        repo.tags[args[0]] = headId();
        good('Tag ' + args[0] + ' pinned at ' + headId() + '. Like a branch, but it never moves.');
        flags.tagged = true;
      }

      function gitRestore(args) {
        if (!needRepo()) return;
        var staged = args[0] === '--staged';
        var targets = staged ? args.slice(1) : args.slice();
        if (!targets.length) { err('usage: git restore [--staged] <file|.>'); return; }
        var paths = [];
        if (targets[0] === '.') {
          var src = staged ? index : files;
          for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) paths.push(k);
        } else paths = targets;
        var ht = headTree();
        for (var i = 0; i < paths.length; i++) {
          var p = paths[i];
          if (staged) {
            if (Object.prototype.hasOwnProperty.call(ht, p)) index[p] = ht[p];
            else if (Object.prototype.hasOwnProperty.call(index, p)) delete index[p];
            else { err("error: pathspec '" + p + "' did not match any staged file"); return; }
          } else {
            if (!Object.prototype.hasOwnProperty.call(index, p)) { err("error: '" + p + "' is untracked — restore copies from the index, and the index has never seen it."); return; }
            files[p] = index[p];
          }
        }
        if (staged) {
          note('Unstaged ' + paths.length + ' path(s): the index entries were copied back from HEAD. Your files were not touched.');
          flags.restoredStaged = true;
        } else {
          note('Restored ' + paths.length + ' path(s) from the index. The edit is gone — this is the one everyday command that discards work.');
          flags.restoredWork = true;
        }
      }

      var GIT_ELSEWHERE = {
        push: 'push: this repository has no remote — the game is about the local three places. The collaboration half (fetch, pull, push, --force-with-lease) is in the article: /blog/git-explained-from-the-object-up.',
        pull: 'pull: no remote here. pull is just fetch + merge, and the merge half you are already learning.',
        fetch: 'fetch: no remote here. See the article for the remote model.',
        clone: 'clone: you are already inside the only repository this page has.',
        blame: 'blame: not implemented here. /labs/linux has a fuller machine.',
        bisect: 'bisect: not in this game — but the idea (binary-search the history for the bad commit) needs no simulator.'
      };

      function gitDispatch(args) {
        if (!args.length) { err('usage: git <command>. Type help for the ones this game knows.'); return; }
        var sub = args[0];
        var rest = args.slice(1);
        var table = {
          init: gitInit, status: gitStatus, add: gitAdd, commit: gitCommit, log: gitLog,
          diff: gitDiff, branch: gitBranch, 'switch': gitSwitch, checkout: gitCheckout,
          merge: gitMerge, reset: gitReset, revert: gitRevert, stash: gitStash,
          rebase: gitRebase, 'cherry-pick': gitCherry, reflog: gitReflog, tag: gitTag,
          restore: gitRestore
        };
        if (Object.prototype.hasOwnProperty.call(table, sub)) { table[sub](rest); return; }
        if (Object.prototype.hasOwnProperty.call(GIT_ELSEWHERE, sub)) { note('git ' + GIT_ELSEWHERE[sub]); return; }
        err("git: '" + sub + "' is not a git command this game knows. Type help.");
      }

      /* ---------------- non-git commands ---------------- */
      function cmdLs() {
        var names = [];
        for (var k in files) if (Object.prototype.hasOwnProperty.call(files, k)) names.push(k);
        names.sort();
        out(names.length ? names.join('  ') : '(empty)');
      }

      function cmdCat(args) {
        if (!args.length) { err('cat: which file?'); return; }
        var f = args[0];
        if (!Object.prototype.hasOwnProperty.call(files, f)) { err('cat: ' + f + ': No such file'); return; }
        outBlock(files[f]);
      }

      function cmdWork() {
        var m = MISSIONS[mission];
        var edit = m && m.work ? m.work() : null;
        if (!edit) {
          var base = Object.prototype.hasOwnProperty.call(files, 'app.js') ? files['app.js'] : 'function app() {}';
          edit = { path: 'app.js', content: base + '\nconsole.log("tick ' + (++flags.ticks || (flags.ticks = 1)) + '");' };
        }
        files[edit.path] = edit.content;
        note('Your editor changed ' + edit.path + '. (In this game, "work" is a stand-in for you writing code.)');
        if (edit.say) note(edit.say);
      }

      function cmdHelp() {
        out('Game commands:', 'is-note');
        out('  work            do some coding (the game edits a file for you)');
        out('  ls, cat FILE    look at the working tree');
        out('  mission         reprint the current brief   ·  hint    a nudge');
        out('  retry           rebuild this mission’s scene   ·  clear   wipe the screen');
        out('Git, as this game knows it:', 'is-note');
        out('  git init | status | add | commit [-m "..."|--amend -m "..."] | log [--all]');
        out('  git diff [--staged] | restore [--staged] FILE | branch [NAME|-d NAME]');
        out('  git switch [-c] NAME | checkout [-b|--ours|--theirs] | merge NAME [--abort]');
        out('  git rebase NAME | cherry-pick ID | tag [NAME] | reflog');
        out('  git reset [--soft|--mixed|--hard] REF | revert REF | stash [pop|list]');
        out('Every command is a reimplementation over a toy object store — nothing touches your machine.', 'is-note');
      }

      function cmdHint() {
        var m = MISSIONS[mission];
        if (!m) { sayNote('No mission left — free play. Restart for another scored run.'); return; }
        sayNote('Hint: ' + m.hint, 'is-hint');
        note('(hint shown beside the mission)');
      }

      function cmdMission() {
        paintMission();
        sayNote('');
        note('(the mission brief is in the panel above)');
      }

      function cmdRetry() {
        buildScene();
        note('Scene rebuilt. Same mission, clean slate.');
      }

      /* ---------------- missions ---------------- */
      function baseFiles() {
        return {
          'README.md': '# tiny-project\nA very small program.',
          'app.js': 'function app() {\n  return "hello";\n}'
        };
      }

      /* Build a scene without the player: quiet plumbing that fabricates
         commits directly. The reflog is seeded too, so the rescue mission
         has something honest to read. */
      function scene(builder) {
        repo = null;
        files = baseFiles();
        index = null;
        stash = [];
        reflog = [];
        conflict = null;
        flags = {};
        if (builder) builder();
      }

      function quietInit() {
        repo = { commits: {}, branches: { main: null }, tags: {}, head: { detached: false, ref: 'main' }, order: 0 };
        index = copyMap(files);
      }

      function quietCommit(msg) {
        var id = makeCommit(headId() ? [headId()] : [], index, msg);
        if (repo.head.detached) repo.head.id = id;
        else repo.branches[repo.head.ref] = id;
        reflog.unshift({ id: id, d: 'commit: ' + msg });
        return id;
      }

      function quietEdit(path, content) {
        files[path] = content;
        index = copyMap(files);
      }

      function quietSwitch(name, create) {
        if (create) repo.branches[name] = headId();
        repo.head = { detached: false, ref: name };
        files = copyMap(headTree());
        index = copyMap(headTree());
        reflog.unshift({ id: headId(), d: 'checkout: moving to ' + name });
      }

      var MISSIONS = [
        {
          key: 'init',
          title: 'In the beginning',
          brief: 'Two files, no history. Make this folder a repository, then see what git thinks of it: git init, then git status.',
          hint: 'git init — then git status to meet "untracked".',
          why: 'init created the object store. Nothing is tracked until you say so: git watches nothing by default.',
          done: function () { return !!repo && flags.inited && flags.statusAfterInit; }
        },
        {
          key: 'snapshot',
          title: 'The first snapshot',
          brief: 'Stage both files and seal them into the first commit: git add ., then git commit -m "..." (any message).',
          hint: 'git add .   then   git commit -m "first commit"',
          why: 'add copied the bytes into the index; commit turned the index into a permanent snapshot and pointed main at it. That two-step is the whole engine.',
          /* The repo exists but nothing is staged: add is the lesson. */
          scene: function () { quietInit(); index = {}; },
          done: function () {
            var id = headId();
            return !!id && 'README.md' in repo.commits[id].tree && 'app.js' in repo.commits[id].tree;
          }
        },
        {
          key: 'inspect',
          title: 'Change, inspect, commit',
          brief: 'Do some coding (type: work), see exactly what changed with git diff, then stage and commit it.',
          hint: 'work · git diff · git add app.js (or .) · git commit -m "..."',
          why: 'Bare diff compares working tree against index. After you add, bare diff goes quiet and git diff --staged shows the same change — nothing vanished, you just asked a different pair.',
          scene: function () { quietInit(); quietCommit('first commit'); },
          done: function () { return flags.diffed && (flags.committed || 0) >= 1; }
        },
        {
          key: 'selective',
          title: 'Half of it, please',
          brief: 'Two files changed, but they are two different jobs. Commit ONLY app.js first (git add app.js, commit), then commit README.md separately. Two honest commits.',
          hint: 'git add app.js · git commit -m "..." · git add README.md · git commit -m "..." — git status between steps shows the split.',
          why: 'The index exists exactly for this: a commit is what you STAGED, not what you touched. Being able to carve one honest commit out of a messy worktree is the index earning its keep.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            files['app.js'] = 'function app() {\n  return "hello";\n}\nfunction retry() {\n  return 3;\n}';
            files['README.md'] = '# tiny-project\nA very small program.\nNow documented.';
          },
          done: function () {
            return flags.selective && countCommits() >= (flags.baseCommits || 0) + 2 &&
              !dirtyWork() && !dirtyIndex();
          }
        },
        {
          key: 'unstage',
          title: 'Unstage, un-edit',
          brief: 'Change your mind twice. Type work, stage it (git add .) — then pull it back out of the index with git restore --staged app.js, then discard the edit entirely with git restore app.js.',
          hint: 'work · git add . · git restore --staged app.js · git restore app.js · git status should end clean.',
          why: 'restore --staged copies the index entry back from HEAD; plain restore copies the file back from the index. Two directions, one command — and history never moved.',
          scene: function () { quietInit(); quietCommit('first commit'); },
          done: function () {
            return flags.restoredStaged && flags.restoredWork && !dirtyWork() && !dirtyIndex();
          }
        },
        {
          key: 'branch',
          title: 'A sticky note called feature',
          brief: 'Create a branch and commit on it: git switch -c feature, then work, add, commit. Watch the graph — main does not move.',
          hint: 'git switch -c feature · work · git add . · git commit -m "..."',
          why: 'The branch cost one label. Your commit advanced feature; main stayed behind, which is the entire meaning of "branch".',
          scene: function () { quietInit(); quietCommit('first commit'); },
          done: function () {
            var f = repo && repo.branches.feature;
            return !!f && f !== repo.branches.main && isAncestor(repo.branches.main, f);
          }
        },
        {
          key: 'ff',
          title: 'The label slides',
          brief: 'feature is ahead and main never moved. Go to main and merge: git switch main, git merge feature — then tidy up with git branch -d feature. Watch what does NOT get created.',
          hint: 'git switch main · git merge feature · git branch -d feature',
          why: 'A fast-forward: your branch simply continued the line, so git slid the main label forward — no merge commit, nothing to reconcile. And deleting the merged label deleted no commits; a branch is only a sticky note.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietSwitch('feature', true);
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction greet(n) {\n  return "hi " + n;\n}');
            quietCommit('add greet()');
          },
          done: function () {
            return !repo.head.detached && repo.head.ref === 'main' &&
              flags.fastForwarded && !repo.branches.feature;
          }
        },
        {
          key: 'merge',
          title: 'Two lines, one join',
          brief: 'This time both branches moved. Commit work on feature (switch, work, add, commit), come back to main, and merge. A real merge commit this time.',
          hint: 'git switch feature · work · git add . · git commit -m "..." · git switch main · git merge feature',
          why: 'Both sides had commits the other lacked, so the merge made a commit with two parents. The graph records where the lines joined — honestly.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietSwitch('feature', true);
            quietSwitch('main', false);
            quietEdit('README.md', '# tiny-project\nA very small program.\nNow with docs.');
            quietCommit('expand the README');
          },
          work: function () {
            if (!repo.head.detached && repo.head.ref === 'feature') {
              return { path: 'app.js', content: 'function app() {\n  return "hello";\n}\nfunction bye() {\n  return "bye";\n}' };
            }
            return null;
          },
          done: function () {
            var id = repo.branches.main;
            return !!id && repo.commits[id].parents.length === 2;
          }
        },
        {
          key: 'conflict',
          title: 'The markers',
          brief: 'Both branches changed the SAME line of config.js. Commit yours (work, add, commit), then merge feature and face the conflict. Pick a side with git checkout --ours config.js or --theirs, then add and commit.',
          hint: 'work · git add . · git commit -m "..." · git merge feature · git checkout --theirs config.js · git add config.js · git commit -m "merge"',
          why: 'A conflict is git refusing to guess between two edits to the same lines. You picked, declared it with add, and the merge commit sealed it. That is all a conflict ever is.',
          scene: function () {
            files['config.js'] = 'var retries = 3;';
            quietInit(); quietCommit('first commit');
            quietSwitch('feature', true);
            quietEdit('config.js', 'var retries = 10;');
            quietCommit('raise retries to 10');
            quietSwitch('main', false);
          },
          work: function () {
            return { path: 'config.js', content: 'var retries = 1;', say: 'You set retries to 1 on main. feature set it to 10. Someone has to decide.' };
          },
          done: function () { return flags.mergedConflict; }
        },
        {
          key: 'amend',
          title: 'Rewrite the envelope',
          brief: 'The work in the last commit is fine; the message ("asdfjkl") is not. Rewrite it: git commit --amend -m "add validate()". Read the log before and after — watch the hash.',
          hint: 'git log · git commit --amend -m "add validate()" · git log again — same tree, new hash.',
          why: 'Amend did not edit the commit; nothing in the store is editable. It wrote a NEW commit with the same parent and moved the label — which is why the hash changed, and why you never amend commits other people already have.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction validate(x) {\n  return x != null;\n}');
            quietCommit('asdfjkl');
          },
          done: function () {
            var id = headId();
            return flags.amended && id && repo.commits[id].msg !== 'asdfjkl';
          }
        },
        {
          key: 'reset',
          title: 'Take it back quietly',
          brief: 'The last commit ("break everything") is bad and NOBODY else has it. Erase it: git reset --hard HEAD~1. Check the log after.',
          hint: 'git log first if you like · git reset --hard HEAD~1 · git log again.',
          why: '--hard moved the label, the index and your files back one commit. The bad commit still exists unlabelled for a while — reflog can see it — but the branch has disowned it.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\n// half-finished experiment, do not ship\nthrow new Error("boom");');
            quietCommit('break everything');
          },
          done: function () {
            return flags.reset === '--hard' && headId() && repo.commits[headId()].msg === 'first commit' && !dirtyWork();
          }
        },
        {
          key: 'revert',
          title: 'Undo, on the record',
          brief: 'Same bad commit — but this time pretend it is already shared, so rewriting is off the table. Undo it forwards: git revert HEAD.',
          hint: 'git revert HEAD — then read the log.',
          why: 'Revert wrote a NEW commit applying the inverse. Both the mistake and the correction are on record, nobody’s copy of history was invalidated. On shared branches this is the only polite undo.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nthrow new Error("boom");');
            quietCommit('break everything');
          },
          done: function () {
            var id = headId();
            return flags.reverted && id && repo.commits[id].msg.indexOf('Revert') === 0;
          }
        },
        {
          key: 'stash',
          title: 'The shelf',
          brief: 'You are mid-edit (type work) and suddenly need to be on feature. Try git switch feature and watch git refuse. Park the work: git stash, switch there and back, then git stash pop.',
          hint: 'work · git switch feature (refused!) · git stash · git switch feature · git switch main · git stash pop',
          why: 'The refusal protects your uncommitted edit — switching would overwrite it. The stash is a shelf: park, move freely, take it back down. Nothing was committed and nothing was lost.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietSwitch('feature', true);
            quietSwitch('main', false);
          },
          done: function () {
            return flags.stashed && flags.stashPopped && (flags.switched || 0) >= 2 &&
              !repo.head.detached && repo.head.ref === 'main' && dirtyWork();
          }
        },
        {
          key: 'detached',
          title: 'Detached, not broken',
          brief: 'Visit the past. Find the FIRST commit hash (git log), check it out (git checkout <hash>), look around (cat app.js). Then make the visit permanent — git switch -c archaeology — and come home: git switch main.',
          hint: 'git log · copy the bottom hash · git checkout <hash> · cat app.js · git switch -c archaeology · git switch main',
          why: '"Detached HEAD" only means HEAD points at a commit instead of a branch. Nothing is broken; commits made there just need a label before you leave — which switch -c gave you.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction two() {}');
            quietCommit('second commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction two() {}\nfunction three() {}');
            quietCommit('third commit');
          },
          done: function () {
            var a = repo.branches.archaeology;
            return !!a && repo.commits[a].msg === 'first commit' &&
              !repo.head.detached && repo.head.ref === 'main';
          }
        },
        {
          key: 'rebase',
          title: 'Replay, do not tangle',
          brief: 'main moved on while feature grew one commit. You are on feature. Put your work on top of the new main: git rebase main. Read the hashes before and after.',
          hint: 'git log --all first · git rebase main · git log --all again — same message, new hash.',
          why: 'Rebase replayed your change onto the new base and wrote a NEW commit — the old one is unlabelled, not edited. Clean line, new hashes: which is exactly why you never rebase what others already have.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietSwitch('feature', true);
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction feature() {\n  return "new";\n}');
            quietCommit('add feature()');
            quietSwitch('main', false);
            quietEdit('README.md', '# tiny-project\nA very small program.\nRestructured while you were away.');
            quietCommit('restructure docs');
            quietEdit('README.md', '# tiny-project\nA very small program.\nRestructured while you were away.\nTwice.');
            quietCommit('more restructuring');
            quietSwitch('feature', false);
          },
          done: function () {
            return flags.rebased && isAncestor(repo.branches.main, repo.branches.feature);
          }
        },
        {
          key: 'cherry',
          title: 'Just that one',
          brief: 'The hotfix branch holds one commit you need on main ("fix the crash") — but also work you do not want. Find its hash (git log --all) and copy just it: git cherry-pick <hash>.',
          hint: 'git log --all · read the hash next to "fix the crash" · git cherry-pick <hash>',
          why: 'Cherry-pick copied one commit’s change onto main as a new commit. The hotfix branch is untouched — you took the change, not the branch.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietSwitch('hotfix', true);
            quietEdit('app.js', 'function app() {\n  return "hello";  // crash fixed\n}');
            quietCommit('fix the crash');
            quietEdit('app.js', 'function app() {\n  return "hello";  // crash fixed\n}\n// experimental rewrite, unfinished');
            quietCommit('experimental rewrite');
            quietSwitch('main', false);
          },
          done: function () {
            var id = repo.branches.main;
            return flags.cherryPicked && id && repo.commits[id].msg === 'fix the crash';
          }
        },
        {
          key: 'tag',
          title: 'Pin the release',
          brief: 'Ship it: git tag v1.0. Then keep working (work, add, commit) and run git log — the branch moved on, the tag did not.',
          hint: 'git tag v1.0 · work · git add . · git commit -m "..." · git log',
          why: 'A tag is a label that never moves — a branch that retired on the spot. Releases get tags precisely because branches wander.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction ship() {}');
            quietCommit('ready to release');
          },
          done: function () {
            var v = repo.tags && repo.tags['v1.0'];
            return !!v && headId() !== v && isAncestor(v, headId());
          }
        },
        {
          key: 'rescue',
          title: 'The safety net',
          brief: 'Three commits stand. Destroy two on purpose — git reset --hard HEAD~2 — then get them back: git reflog, find where you were, git reset --hard <hash>.',
          hint: 'git reset --hard HEAD~2 · git reflog · the top entries name the commit you left · git reset --hard <that hash>',
          why: 'The reflog is HEAD’s private diary — every place it has been, even commits nothing points at. In a committed repository it is genuinely hard to lose work; only uncommitted work is ever truly at risk.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction two() {}');
            quietCommit('second commit');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction two() {}\nfunction three() {}');
            quietCommit('third commit');
          },
          onScene: function () { flags.rescueTarget = headId(); },
          done: function () {
            return flags.reflogged && flags.rescueTarget && headId() === flags.rescueTarget &&
              flags.reset === '--hard' && flags.wentBack;
          }
        },
        {
          key: 'capstone',
          title: 'The whole toolbox',
          brief: 'Everything at once. Your worktree holds a half-edit; main’s tip commit is bad AND shared; feature is behind. Do: git stash · git revert HEAD · git switch feature · git rebase main · git switch main · git merge feature · git stash pop.',
          hint: 'The brief IS the route: stash first (revert needs a clean tree), revert the bad tip, rebase feature onto main, come home, fast-forward merge, pop the shelf.',
          why: 'That was the whole toolbox in one sitting: the shelf, the polite undo, the replay, the sliding label, and your half-edit back exactly where it was. There is no situation on this page you have not now handled.',
          scene: function () {
            quietInit(); quietCommit('first commit');
            quietSwitch('feature', true);
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nfunction feature() {\n  return "new";\n}');
            quietCommit('add feature()');
            quietSwitch('main', false);
            quietEdit('README.md', '# tiny-project\nA very small program.\nBetter docs.');
            quietCommit('update docs');
            quietEdit('app.js', 'function app() {\n  return "hello";\n}\nthrow new Error("shipped on a Friday");');
            quietCommit('break main');
            files['README.md'] = '# tiny-project\nA very small program.\nBetter docs.\n(half-written sentence';
          },
          done: function () {
            return flags.stashed && flags.reverted && flags.rebased && flags.stashPopped &&
              !repo.head.detached && repo.head.ref === 'main' &&
              repo.branches.main === repo.branches.feature && dirtyWork();
          }
        }
      ];

      function countCommits() {
        return repo ? countKeys(repo.commits) : 0;
      }

      function buildScene() {
        var m = MISSIONS[mission];
        scene(m ? m.scene : null);
        if (m && m.onScene) m.onScene();
        flags.baseCommits = countCommits();
        repaint();
      }

      function showMission() {
        paintMission();
        g.stat('mission', Math.min(mission + 1, MISSIONS.length) + '/' + MISSIONS.length);
      }

      function checkMission() {
        var m = MISSIONS[mission];
        if (!m || over) return;
        /* goal fragments that need command context, kept out of done() */
        if (m.key === 'init' && flags.inited && flags.lastCmd === 'git status') flags.statusAfterInit = true;
        if (m.key === 'rescue' && flags.reflogged && flags.lastCmd &&
            flags.lastCmd.indexOf('git reset --hard') === 0 &&
            flags.lastCmd.indexOf('HEAD~') < 0) flags.wentBack = true;
        if (!m.done()) return;
        var doneTitle = m.title;
        var doneWhy = m.why;
        mission++;
        if (mission >= MISSIONS.length) {
          over = true;
          g.stat('mission', MISSIONS.length + '/' + MISSIONS.length);
          sayNote('Done: ' + doneTitle + ' — ' + doneWhy, 'is-done');
          paintMission();
          g.over({
            won: true,
            score: commands,
            title: commands + ' commands',
            message: 'All ' + MISSIONS.length + ' missions, from init to the whole-toolbox capstone, in ' + commands +
              ' commands. The terminal stays open below — the sandbox is yours. The theory is in the article: git, explained from the object up.'
          });
          return;
        }
        buildScene();
        showMission();
        sayNote('Done: ' + doneTitle + ' — ' + doneWhy, 'is-done');
        missionChord();
      }

      /* ---------------- parsing and the line ---------------- */
      function tokenise(text) {
        var tokens = [];
        var i = 0;
        while (i < text.length) {
          while (i < text.length && text.charAt(i) === ' ') i++;
          if (i >= text.length) break;
          var quote = null;
          var word = '';
          if (text.charAt(i) === '"' || text.charAt(i) === "'") { quote = text.charAt(i); i++; }
          while (i < text.length) {
            var ch = text.charAt(i);
            if (quote) {
              if (ch === quote) { i++; break; }
              word += ch; i++;
            } else {
              if (ch === ' ') break;
              if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
              word += ch; i++;
            }
          }
          tokens.push(word);
        }
        return tokens;
      }

      var TABLE = {
        git: gitDispatch,
        work: cmdWork,
        ls: cmdLs,
        cat: cmdCat,
        help: cmdHelp,
        hint: cmdHint,
        mission: cmdMission,
        retry: cmdRetry,
        clear: function () { screen.innerHTML = ''; }
      };

      var NOT_HERE = {
        cd: 1, pwd: 1, vi: 1, vim: 1, nano: 1, sudo: 1, rm: 1, mv: 1, cp: 1, touch: 1,
        mkdir: 1, echo: 1, man: 1, ssh: 1, exit: 1, node: 1, npm: 1
      };

      function run(text) {
        var trimmed = text.replace(/^\s+|\s+$/g, '');
        outCmd(trimmed);
        if (!trimmed.length) { scrollDown(); return; }

        history.push(trimmed);
        histAt = history.length;

        var tokens = tokenise(trimmed);
        var name = tokens[0];
        var args = tokens.slice(1);

        commands++;
        g.stat('cmds', commands);
        flags.lastCmd = trimmed.replace(/\s+/g, ' ');

        if (Object.prototype.hasOwnProperty.call(TABLE, name)) {
          TABLE[name](args);
        } else if (Object.prototype.hasOwnProperty.call(NOT_HERE, name)) {
          err(name + ': not here — this terminal only knows git and a few looking-around commands. Type help.');
        } else {
          err(name + ': command not found. Type help for the list.');
        }
        checkMission();
        repaint();
        scrollDown();
      }

      /* ---------------- completion ---------------- */
      var GIT_WORDS = ['init', 'status', 'add', 'commit', 'log', 'diff', 'restore', 'branch',
        'switch', 'checkout', 'merge', 'reset', 'revert', 'stash', 'rebase', 'cherry-pick', 'reflog', 'tag'];

      function complete() {
        var value = input.value;
        var caret = input.selectionStart;
        if (caret == null) caret = value.length;
        var before = value.slice(0, caret);
        var start = before.lastIndexOf(' ') + 1;
        var frag = before.slice(start);
        if (!frag.length) return false;

        var pool = [];
        var head = before.slice(0, start).replace(/\s+$/, '');
        if (start === 0) {
          for (var k in TABLE) if (Object.prototype.hasOwnProperty.call(TABLE, k)) pool.push(k);
        } else if (head === 'git') {
          pool = GIT_WORDS.slice();
        } else {
          for (var f in files) if (Object.prototype.hasOwnProperty.call(files, f)) pool.push(f);
          if (repo) for (var b in repo.branches) if (Object.prototype.hasOwnProperty.call(repo.branches, b)) pool.push(b);
        }
        var names = [];
        for (var i = 0; i < pool.length; i++) if (pool[i].indexOf(frag) === 0) names.push(pool[i]);
        if (!names.length) return true;
        var common = names[0];
        for (var j = 1; j < names.length; j++) {
          var c = 0;
          while (c < common.length && c < names[j].length && common.charAt(c) === names[j].charAt(c)) c++;
          common = common.slice(0, c);
        }
        if (names.length > 1 && common === frag) {
          outCmd(value);
          out(names.join('  '));
          scrollDown();
          return true;
        }
        var insert = common + (names.length === 1 ? ' ' : '');
        input.value = value.slice(0, start) + insert + value.slice(caret);
        var pos = start + insert.length;
        input.setSelectionRange(pos, pos);
        paintLine();
        return true;
      }

      function onKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (g.state !== 'playing') {
          if (event.key === 'Enter') { event.preventDefault(); g.start(); }
          return;
        }
        /* One test, up here, because every branch below returns: spread
           across the bottom of the function the click would have to be
           repeated in the printable path and the backspace path and would
           still catch ArrowDown, which falls out of the end. Enter, Tab,
           Escape and the arrows are all longer than one character and so drop
           out of the test on their own — Enter has the rise or the buzz to
           announce it a moment later, and recalling history is not typing. */
        if (event.key === 'Backspace' || event.key === 'Delete' ||
            (event.key && event.key.length === 1)) tick();
        if (event.key === 'Enter') {
          event.preventDefault();
          var value = input.value;
          input.value = '';
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
          paintLine();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (!history.length) return;
          histAt = Math.max(0, histAt - 1);
          input.value = history[histAt];
          input.setSelectionRange(input.value.length, input.value.length);
          paintLine();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (!history.length) return;
          histAt = Math.min(history.length, histAt + 1);
          input.value = histAt >= history.length ? '' : history[histAt];
          input.setSelectionRange(input.value.length, input.value.length);
          paintLine();
        }
      }

      function focusInput() {
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        restoreCaret();
      }

      /* ---------------- DOM ---------------- */
      function build() {
        host.className = 'game-board board-git-quest';
        host.innerHTML =
          /* The mission lives OUTSIDE the terminal. Early drafts printed the
             brief and the mission-complete text into the scrollback, and it
             read as output nobody had typed. The terminal now carries only
             echoes and git's answers; everything the GAME says goes here. */
          '<div class="gq-mission" id="gq-mission">' +
          '  <p class="gq-mission-kicker" id="gq-mkick"></p>' +
          '  <p class="gq-mission-brief" id="gq-mbrief"></p>' +
          '  <p class="gq-mission-note" id="gq-mnote" role="status" aria-live="polite"></p>' +
          '</div>' +
          '<div class="gq-split">' +
          '  <div class="gq-term" id="gq-term">' +
          '    <div class="gq-screen" id="gq-screen" role="log" aria-live="polite" aria-label="Terminal output"></div>' +
          '    <div class="gq-entry"><span class="gq-prompt" id="gq-prompt"></span>' +
          '<span class="gq-typed" id="gq-typed"></span><span class="gq-caret"></span>' +
          '<span class="gq-after" id="gq-after"></span></div>' +
          '  </div>' +
          '  <div class="gq-side">' +
          '    <p class="gq-places" id="gq-places" aria-live="polite"></p>' +
          '    <pre class="gq-graph" id="gq-graph" aria-label="Commit graph"></pre>' +
          '  </div>' +
          '</div>';

        screen = host.querySelector('#gq-screen');
        kickEl = host.querySelector('#gq-mkick');
        briefEl = host.querySelector('#gq-mbrief');
        noteEl = host.querySelector('#gq-mnote');
        promptEl = host.querySelector('#gq-prompt');
        typedEl = host.querySelector('#gq-typed');
        afterEl = host.querySelector('#gq-after');
        graphEl = host.querySelector('#gq-graph');
        placesEl = host.querySelector('#gq-places');

        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Git command line');
        host.appendChild(input);

        input.addEventListener('keydown', onKey);
        input.addEventListener('beforeinput', restoreCaretOnInput);
        input.addEventListener('input', paintLine);
        input.addEventListener('keyup', paintLine);
        input.addEventListener('click', paintLine);

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
          var at = input.selectionStart;
          if (at == null || at > input.value.length) at = input.value.length;
          if (event.key === 'Backspace') {
            if (!at) return;
            input.value = input.value.slice(0, at - 1) + input.value.slice(at);
            at--;
          } else {
            input.value = input.value.slice(0, at) + event.key + input.value.slice(at);
            at++;
          }
          /* At the caret, not on the end — same as shell quest, and the same
             reason: this terminal draws the line either side of the caret. */
          input.setSelectionRange(at, at);
          paintLine();
          tick();
        });

        /* Click refocuses; a drag that selected something keeps its
           selection — hashes printed by log and reflog get copied and
           typed back, so selection is load-bearing here. Same rule and
           the same reasoning as shell-quest. */
        var term = host.querySelector('#gq-term');
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
            outCmd('help'); cmdHelp(); scrollDown(); focusInput();
          });
        }
        var hintBtn = g.el.querySelector('#game-hint');
        if (hintBtn) {
          hintBtn.addEventListener('click', function () {
            outCmd('hint'); cmdHint(); scrollDown(); focusInput();
          });
        }
      }

      build();

      return {
        reset: function () {
          mission = 0;
          commands = 0;
          history = [];
          histAt = 0;
          over = false;
          usedIds = {};
          rnd = GameShell.seeded(SEED);
          screen.innerHTML = '';
          input.value = '';

          buildScene();
          showMission();
          sayNote('Nothing here is git and nothing touches your machine — every command is a ' +
            'reimplementation over an in-memory object store. Type help in the terminal for the ' +
            'command list; the theory in prose is the article "Git, explained from the object up".');

          g.stat('mission', '1/' + MISSIONS.length);
          g.stat('cmds', 0);
          paintPrompt();
          paintLine();
          repaint();
          scrollDown();
          focusInput();
        }
      };
    }
  });
})();

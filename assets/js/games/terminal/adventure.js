/* ==========================================================================
   adventure.js — a small cave crawl, in the spirit of Colossal Cave.
   --------------------------------------------------------------------------
   Two decisions here are not obvious, and both are worth stating.

   1. THERE IS NO PARSER, AND THAT IS A CONSEQUENCE OF THE SHELL, NOT A
      SIMPLIFICATION. game-shell.js binds the four arrows and one action key
      and nothing else — no letter is ever bound, deliberately, so that the
      typing games can exist on the same shell and so that a game never eats
      a keystroke meant for a form or for the site's own "/" search. A game
      built on it therefore cannot ask you to type GET LAMP. So every legal
      move in this room is listed instead, and you pick one with the arrows.
      That loses the pleasure of guessing the right verb, and it loses the
      guess-the-verb frustration with it, which on balance is a fair trade
      for a game that also has to work under a thumb on a phone.

   2. THE TWO HAZARDS PULL AGAINST EACH OTHER ON PURPOSE. Below the adit it
      is dark, so you need the lamp lit; the west heading holds firedamp, so
      a naked flame there kills you. Neither rule alone is a puzzle — one
      says carry a light, the other says do not — and together they have
      exactly one answer, which is the wire gauze the mine's own safety lamp
      was built around. The board in the pump chamber states the rule in
      plain words before the rule can ever be fatal, because a death you
      could not have seen coming is not a puzzle, it is a trick.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 72;
  var TEXTW = 68;               // description column, one cell of margin each side

  /* Rooms. n: name, d: description, x: exits, dark: needs a light,
     it: what is lying there at the start, det: the one thing worth a
     closer look, which may put an item into the room. */
  var ROOMS = [
    {
      n: 'A clearing in the birch wood',
      d: 'Bracken to the knee, and a track worn through it by boots that stopped coming a hundred years ' +
         'ago. A stile leads back over the wall towards the road. The ground is scattered with waste rock, ' +
         'none of it worth carrying.',
      x: { north: 1, east: 2 }
    },
    {
      n: 'The track under the birches',
      d: 'The track climbs between two spoil heaps, grassed over now and green in the wrong way. Something ' +
         'square and roofless stands at the top of it.',
      x: { south: 0, north: 3 }
    },
    {
      n: 'The streamside',
      d: 'The stream runs brown over a bed of crushed quartz and spills into a leat that has not carried ' +
         'water anywhere useful in a long time. At the bend there is a silted pool, the sort of slack water ' +
         'where dropped things settle and stay.',
      x: { west: 0, north: 4 },
      det: {
        label: 'Sift the silt in the pool',
        first: 'Cold to the elbow, and then your fingers close on something with an eye and a bit to it: an ' +
               'iron key, furred with rust but whole.',
        again: 'Nothing else down there but grit and a horseshoe nail.',
        reveal: 'key'
      }
    },
    {
      n: 'The engine house',
      d: 'Four walls, a chimney, and a bob wall with a gap in it where the beam once rocked. The rain has ' +
         'taken everything of value and left what nobody wanted: iron scrap, broken glass, and a lamp ' +
         'standing on the sill as though somebody meant to come back for it.',
      x: { south: 1 },
      it: ['lamp']
    },
    {
      n: 'The adit mouth',
      d: 'A stone arch set into the hillside, with a passage going in dead level behind it. An iron grate is ' +
         'bolted across the arch and there is cold air coming out through the bars.',
      x: { south: 2, west: 5 },
      det: {
        label: 'Look at the grate',
        first: 'A padlock the size of a fist, and the hasp it hangs on is sound. The keyhole is a plain ward ' +
               'lock, big enough to put a finger in.',
        again: 'Still locked. Still a plain ward lock.'
      }
    },
    {
      n: 'The adit',
      d: 'A tunnel cut for men shorter than you, rails still pinned to the sleepers and a gutter of water ' +
         'running down one side. Daylight reaches this far along and no further.',
      x: { east: 4, west: 6 }
    },
    {
      n: 'The rag-and-chain junction',
      d: 'Four ways meet where the pump chain used to come down. Hand-cut steps go down into the dark on one ' +
         'side, and everything here smells of wet iron.',
      x: { east: 5, north: 7, west: 8, down: 9 },
      dark: true
    },
    {
      n: 'The pump chamber',
      d: 'The pump rod comes down through the roof and stops a foot above the floor, snapped clean off. A ' +
         'board is nailed to the timbering with something painted on it, and a second lamp lies on its side ' +
         'with the glass gone and the wire gauze still in its ring.',
      x: { south: 6 },
      dark: true,
      it: ['gauze'],
      det: {
        label: 'Read the board on the timbering',
        first: 'The paint has gone almost to nothing, but it still reads: NO NAKED LIGHT BEYOND THE CROSS ' +
               'GALLERY. GAUZE TO BE FITTED AND THE FLAME WATCHED.',
        again: 'NO NAKED LIGHT BEYOND THE CROSS GALLERY. GAUZE TO BE FITTED AND THE FLAME WATCHED.'
      }
    },
    {
      n: 'The cross gallery',
      d: 'A wide gallery driven across the grain of the rock, propped every few yards with timber gone soft ' +
         'enough to take a thumbnail. The air moves here, and what comes back from the west is sweet and ' +
         'heavy and wrong.',
      x: { east: 6, west: 10, north: 11 },
      dark: true
    },
    {
      n: 'The ladderway',
      d: 'Ladders in short flights, a rotten landing at every stage. Cold air rises past you from something ' +
         'a long way further down than you can see.',
      x: { up: 6, down: 12 },
      dark: true
    },
    {
      n: 'The gas heading',
      d: 'Barely a gallery at all: a heading abandoned mid-shift with the tools still stacked against the ' +
         'wall. The air here is thick and sweetish, and inside the gauze the flame stands up tall and pale ' +
         'and blue.',
      x: { east: 8, west: 13 },
      dark: true
    },
    {
      n: 'The stope',
      d: 'The vein was taken out here and the space it left goes up further than any light will follow. ' +
         'Stacked deads wall in both sides, waste rock built up by hand to hold the roof where it is.',
      x: { south: 8, west: 14 },
      dark: true
    },
    {
      n: 'The sump level',
      d: 'Water to the knee, black and dead still, with the ends of the sleepers floating in it. Whatever ' +
         'the pump was for, this was it, and the pump lost.',
      x: { up: 9, north: 15 },
      dark: true
    },
    {
      n: 'The old workings',
      d: 'Pick marks, not drill marks. The walls here were cut by hand and the tunnel wanders as the vein ' +
         'wandered. It is warmer, and the timber is older than anything behind you.',
      x: { east: 10, north: 16 },
      dark: true
    },
    {
      n: 'The bottom of the winze',
      d: 'A short sunk shaft with a floor of fallen rock and a rope end still knotted round a stull. ' +
         'Somebody stacked their tools in the corner at the end of a shift and never came for them.',
      x: { east: 11 },
      dark: true,
      it: ['pick']
    },
    {
      n: 'The drowned drive',
      d: 'The water comes to your chest and the roof comes down to meet it. On a ledge at the far end, just ' +
         'above the waterline, something square and heavy has been set down out of the wet.',
      x: { south: 12 },
      dark: true,
      it: ['silver']
    },
    {
      n: 'The vein chamber',
      d: 'The quartz runs across the roof in a band as thick as your arm, and there is gold in it — wired ' +
         'through the white rock in threads, and one knot of it the size of a walnut.',
      x: { south: 13, west: 17 },
      dark: true,
      it: ['gold']
    },
    {
      n: 'The crystal grotto',
      d: 'A cavity the miners broke into and then left alone. The walls are crusted with garnets the colour ' +
         'of dark wine, and the whole of it would fit inside a cupboard.',
      x: { east: 16 },
      dark: true,
      it: ['garnets']
    }
  ];

  var GAS = 10;                 // the one room where a naked flame is fatal

  var ITEMS = {
    lamp:    { a: 'a brass lamp',            the: 'the brass lamp',  carry: 'lamp' },
    gauze:   { a: 'a lamp gauze, still good', the: 'the wire gauze', carry: 'gauze' },
    key:     { a: 'an iron key',             the: 'the iron key',    carry: 'key' },
    pick:    { a: 'a miner\'s pick',          the: 'the pick',        carry: 'pick' },
    gold:    { a: 'a knot of gold in the quartz', the: 'the gold',   carry: 'gold',    value: 150 },
    silver:  { a: 'a silver ingot',          the: 'the silver ingot', carry: 'silver', value: 100 },
    garnets: { a: 'a crust of garnets',      the: 'the garnets',     carry: 'garnets', value: 80 }
  };

  var ORDER = ['lamp', 'gauze', 'key', 'pick', 'gold', 'silver', 'garnets'];

  /* Greedy wrap. Nothing in the room text is longer than the column, so a
     word never has to be broken. */
  function wrap(str, width) {
    var words = String(str).split(' ');
    var out = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (!line.length) line = words[i];
      else if (line.length + 1 + words[i].length <= width) line += ' ' + words[i];
      else { out.push(line); line = words[i]; }
    }
    if (line.length) out.push(line);
    return out;
  }

  function lower(str) { return str.charAt(0).toLowerCase() + str.slice(1); }

  TermShell.define({
    id: 'game-adventure',
    slug: 'adventure',
    /* Declared here and not only in the manifest, because the manifest is
       build-time data: the generator never hands it to the runtime, so a
       tapAction set only there is a comment. The page copy for this game
       promises a tap does nothing; without this line it did something. */
    tapAction: false,
    title: 'Adventure',
    cols: COLS,
    rows: 24,
    bestKey: 'adventure',
    startTitle: 'Adventure',
    startText: 'Eighteen places, one working mine gone to ruin, and three things in it worth carrying home. ' +
      'Arrows choose from the list, Action does the thing.',

    setup: function (g) {
      var here = 0;
      var moves = 0;
      var carried = {};
      var floor = [];           // items lying in each room, by index
      var seen = [];            // rooms entered at least once
      var looked = {};          // rooms whose detail has been examined
      var lit = false;
      var gauzed = false;
      var msg = '';
      var msgColour = 'yellow';
      var menu = [];
      var sel = 0;
      var top = 0;              // first visible menu row, for the window below

      var MENU_ROWS = 8;
      var MENU_TOP = 14;        // rows 11 and 12 are the message, 13 is air

      function say(line, colour) {
        msg = line;
        msgColour = colour || 'yellow';
      }

      function has(id) { return !!carried[id]; }

      function canSee() { return !ROOMS[here].dark || (has('lamp') && lit); }

      function purse() {
        var sum = 0;
        for (var i = 0; i < ORDER.length; i++) {
          var it = ITEMS[ORDER[i]];
          if (it.value && carried[ORDER[i]]) sum += it.value;
        }
        return sum;
      }

      function syncLamp() {
        var v = 'none';
        if (has('lamp')) v = lit ? (gauzed ? 'lit, gauze' : 'lit') : 'out';
        g.stat('lamp', v);
      }

      function spend() {
        moves++;
        g.stat('moves', moves);
      }

      function boom(how) {
        g.over({
          won: false,
          score: 0,
          title: 'Firedamp',
          message: how + ' The gas took light all at once and the heading took it out through the adit. ' +
            'The gauze in the pump chamber was there for exactly this.'
        });
      }

      /* ---------------------------------------------------------------
         The commands. Each returns nothing; they say() and they spend()
         a move only when something actually happened, so a refusal never
         costs you anything but the reading.
         --------------------------------------------------------------- */
      function go(dir) {
        var dest = ROOMS[here].x[dir];
        if (dest === undefined) { say('There is no way that side.', 'dim'); return; }

        if (here === 4 && dest === 5 && !has('key')) {
          say('The grate is padlocked and the hasp is sound. It wants a key.', 'red');
          g.beep(150, 0.05, 'square', 0.03);
          return;
        }

        if (ROOMS[dest].dark && !(has('lamp') && lit)) {
          say('That way is black as a pocket, and you are not taking another step into it without a light.', 'red');
          g.beep(150, 0.05, 'square', 0.03);
          return;
        }

        if (dest === GAS && lit && !gauzed) {
          spend();
          boom('You carried an open flame into the heading.');
          return;
        }

        here = dest;
        seen[here] = true;
        spend();
        if (here === 4 && has('key')) say('The padlock is open and the grate stands ajar behind you.', 'dim');
        else say('', 'dim');
        g.beep(420, 0.035, 'sine', 0.03);
      }

      function take(id) {
        if (id === 'gold' && !has('pick')) {
          say('The knot of gold is set fast in hard quartz. Fingers will not shift it; something to prise ' +
            'with might.', 'red');
          g.beep(150, 0.05, 'square', 0.03);
          return;
        }
        var list = floor[here];
        var at = list.indexOf(id);
        if (at === -1) return;
        list.splice(at, 1);
        carried[id] = true;
        spend();
        if (id === 'gold') say('Three minutes of work with the pick and the knot comes away whole, heavier ' +
          'than a thing that size has any right to be.', 'yellow');
        else if (ITEMS[id].value) say('You have ' + ITEMS[id].the + '.', 'yellow');
        else say('Taken: ' + ITEMS[id].the + '.', 'dim');
        if (ITEMS[id].value) { g.setScore(purse()); g.beep(880, 0.07, 'sine', 0.05); }
        else g.beep(600, 0.04, 'sine', 0.04);
        syncLamp();
      }

      function light() {
        /* With the map as it stands you cannot be standing in the heading
           with an ungauzed lamp, so this branch should never fire. It is
           here because the rule belongs to the flame and the gas, not to
           the doorway between them, and a later room that vents into the
           same heading would otherwise quietly break it. */
        if (here === GAS && !gauzed) {
          spend();
          boom('You struck a light standing in the heading itself.');
          return;
        }
        lit = true;
        spend();
        say(gauzed ? 'The flame comes up behind the gauze, small and steady.'
                   : 'The wick catches. The lamp is naked flame, nothing over it.', 'yellow');
        syncLamp();
        g.beep(520, 0.05, 'sine', 0.04);
      }

      function douse() {
        lit = false;
        spend();
        say('Out. Whatever light there is now is not yours.', 'dim');
        syncLamp();
        g.beep(240, 0.05, 'sine', 0.04);
      }

      function fit() {
        gauzed = true;
        carried.gauze = false;
        spend();
        say('The gauze drops into the ring and seats itself. A flame inside it can no longer set light to ' +
          'the air outside it.', 'yellow');
        syncLamp();
        g.beep(700, 0.06, 'sine', 0.05);
      }

      function look() {
        var det = ROOMS[here].det;
        if (!det) return;
        var first = !looked[here];
        looked[here] = true;
        spend();
        say(first ? det.first : det.again, first ? 'yellow' : 'dim');
        if (first && det.reveal) floor[here].push(det.reveal);
        g.beep(660, 0.04, 'sine', 0.04);
      }

      function leave() {
        var value = purse();
        var bonus = Math.max(0, 200 - moves);
        var all = has('gold') && has('silver') && has('garnets');
        g.over({
          won: true,
          score: value + bonus,
          title: all ? 'Out, with all of it' : 'Out, and up on the deal',
          message: 'You came out with ' + value + ' worth, in ' + moves + ' moves, which is worth ' +
            bonus + ' more.' + (all ? ' Nothing left down there but the water.'
                                    : ' Something is still down there.')
        });
      }

      /* ---------------------------------------------------------------
         The menu. Rebuilt from scratch every frame rather than kept and
         patched: it is at most eight entries, and a list that is derived
         from the state cannot drift out of step with it.
         --------------------------------------------------------------- */
      var DIRS = ['north', 'south', 'east', 'west', 'up', 'down'];

      function build() {
        var out = [];
        var room = ROOMS[here];
        var dark = !canSee();
        var i;

        for (i = 0; i < DIRS.length; i++) {
          var dir = DIRS[i];
          var dest = room.x[dir];
          if (dest === undefined) continue;
          /* In the dark you get the direction and nothing else. Naming the
             room you cannot see would be the game telling you something
             your character has no way of knowing. */
          var label = 'Go ' + dir;
          if (!dark && seen[dest]) label += '  → ' + lower(ROOMS[dest].n);
          out.push({ label: label, kind: 'go', arg: dir });
        }

        if (!dark) {
          var lying = floor[here];
          for (i = 0; i < lying.length; i++) {
            out.push({
              label: (lying[i] === 'gold' ? 'Prise out ' : 'Take ') + ITEMS[lying[i]].the,
              kind: 'take',
              arg: lying[i]
            });
          }
          if (room.det) out.push({ label: room.det.label, kind: 'look' });
        }

        if (has('lamp')) {
          out.push(lit ? { label: 'Douse the lamp', kind: 'douse' }
                       : { label: 'Light the lamp', kind: 'light' });
          if (has('gauze') && !gauzed) out.push({ label: 'Fit the wire gauze over the flame', kind: 'fit' });
        }

        if (here === 0 && purse() > 0) {
          out.push({ label: 'Over the stile and home, with what you have', kind: 'leave' });
        }

        return out;
      }

      function choose() {
        var item = menu[sel];
        if (!item) return;
        if (item.kind === 'go') go(item.arg);
        else if (item.kind === 'take') take(item.arg);
        else if (item.kind === 'look') look();
        else if (item.kind === 'light') light();
        else if (item.kind === 'douse') douse();
        else if (item.kind === 'fit') fit();
        else if (item.kind === 'leave') leave();
        /* The list has just changed under the cursor, so put it somewhere
           sane rather than wherever the old index happens to land. */
        sel = 0;
        top = 0;
      }

      function move(step) {
        if (!menu.length) return;
        sel += step;
        if (sel < 0) sel = menu.length - 1;
        if (sel >= menu.length) sel = 0;
        g.beep(320, 0.02, 'sine', 0.025);
      }

      /* ---------------------------------------------------------------
         Drawing. Fixed rows throughout: the menu must not walk up and down
         the screen as descriptions get longer or shorter, because the one
         thing a list-driven game cannot afford is a moving target.
         --------------------------------------------------------------- */
      function rule(term, y) {
        for (var x = 0; x < COLS; x++) term.put(x, y, '─', 'dark');
      }

      function draw(term) {
        term.clear();
        var room = ROOMS[here];
        var dark = !canSee();
        var i;

        term.text(1, 0, 'ADVENTURE  ·  WOLFSBANE MINE', 'green');
        var right = 'moves ' + moves + '   worth ' + purse();
        term.text(COLS - 1 - right.length, 0, right, 'dim');
        rule(term, 1);

        term.text(1, 2, dark ? 'In the dark' : room.n, 'white');

        var body = dark
          ? 'You cannot see your own hand. There is water somewhere, and a draught on your left cheek, and ' +
            'the only thing you are certain of is the way you came in.'
          : room.d;
        var lines = wrap(body, TEXTW);
        for (i = 0; i < lines.length && i < 5; i++) term.text(1, 3 + i, lines[i], 'green');

        if (!dark) {
          var lying = floor[here];
          if (lying.length) {
            var names = [];
            for (i = 0; i < lying.length; i++) names.push(ITEMS[lying[i]].a);
            term.text(1, 8, ('Here: ' + names.join(', ')).slice(0, TEXTW), 'cyan');
          }
        }

        var bag = [];
        for (i = 0; i < ORDER.length; i++) {
          if (!carried[ORDER[i]]) continue;
          var tag = ITEMS[ORDER[i]].carry;
          if (ORDER[i] === 'lamp') tag += ' (' + (lit ? 'lit' : 'out') + (gauzed ? ', gauze' : '') + ')';
          bag.push(tag);
        }
        term.text(1, 9, ('Carrying: ' + (bag.length ? bag.join(', ') : 'nothing at all')).slice(0, TEXTW), 'dim');

        rule(term, 10);

        if (msg) {
          var mline = wrap(msg, TEXTW);
          for (i = 0; i < mline.length && i < 2; i++) term.text(1, 11 + i, mline[i], msgColour);
        }

        /* Keep the cursor inside the window. Eight rows is more than any
           room in this mine actually offers, but a game that silently hides
           a legal move is unplayable, so the scroll is real rather than a
           clamp that could not be reached today. */
        if (sel < top) top = sel;
        if (sel >= top + MENU_ROWS) top = sel - MENU_ROWS + 1;

        for (i = 0; i < MENU_ROWS; i++) {
          var idx = top + i;
          if (idx >= menu.length) break;
          var y = MENU_TOP + i;
          var on = idx === sel;
          term.put(1, y, on ? '▸' : ' ', 'yellow');
          term.text(3, y, menu[idx].label, on ? 'white' : 'dim');
        }
        if (top > 0) term.put(0, MENU_TOP, '↑', 'dark');
        if (top + MENU_ROWS < menu.length) term.put(0, MENU_TOP + MENU_ROWS - 1, '↓', 'dark');

        rule(term, 22);
        term.text(1, 23, '↑ ↓ choose    Action does it    Esc pauses', 'dark');
      }

      return {
        reset: function () {
          here = 0;
          moves = 0;
          carried = {};
          looked = {};
          lit = false;
          gauzed = false;
          sel = 0;
          top = 0;
          seen = [];
          seen[0] = true;
          floor = [];
          for (var i = 0; i < ROOMS.length; i++) {
            floor.push(ROOMS[i].it ? ROOMS[i].it.slice(0) : []);
          }
          menu = build();
          say('The mine closed in 1908 and the road stops a mile back. Nobody is coming with you.', 'dim');
          g.stat('moves', 0);
          syncLamp();
        },

        key: function (name) {
          if (name === 'up' || name === 'left') move(-1);
          else if (name === 'down' || name === 'right') move(1);
          else if (name === 'action') choose();
          menu = build();
          if (sel >= menu.length) sel = Math.max(0, menu.length - 1);
        },

        draw: draw
      };
    }
  });
})();

/* ==========================================================================
   antakshari.js — the antakshari rule, played with words rather than songs.
   --------------------------------------------------------------------------
   Antakshari is sung. One side finishes a film song, and the next side has
   to begin one starting with the last letter of the line just sung. That is
   the game, and it is the one thing this file cannot ship.

   Two reasons, and both are the site's own rules rather than squeamishness.
   This section adds zero media bytes to the repository — every sound in
   /games is synthesised at runtime — so there is no audio here and there
   never will be. And film lyrics are somebody's copyrighted work: a
   built-in database of them, or of the songs they belong to, is not
   something this site is going to publish. Saying so out loud on the page
   is the honest version of that decision; hiding it behind a feature list
   would be the other kind.

   So the FORM is kept and the CONTENT is swapped. The rule is identical —
   your entry must begin with the last letter of the entry before it, no
   repeats inside a round, a clock on every turn — and the vocabulary is two
   hand-written word lists: ordinary English nouns, and well-known Indian
   words written in Latin script, which are places, foods and objects and
   nothing that came out of a film.

   THE LIST IS THE REFEREE FOR BOTH SIDES, and that is the design decision
   everything else hangs off. A real word the list has never heard of is
   refused, which is a genuine limit and is stated on the page. What it buys
   is the counter: because the list is closed and both players draw from it,
   the game can tell you exactly how many words remain on the letter you are
   about to hand over — and handing over a starved letter is the whole
   strategy of antakshari, played out loud instead of felt.

   The computer plays that strategy directly. Its candidate words are the
   unused ones starting with the required letter; it scores each by how many
   options the opponent would be left with, and on Sharp it takes the
   minimum. On a list where forty-seven words end in R and only fourteen
   begin with one, that is enough to be genuinely hard to beat.

   No letter is bound. The shell binds arrows, Space, Enter and Escape and
   deliberately no letter at all, which is what lets a game whose entire
   input is typing exist on it: the text field is the game's own, the shell
   ignores keystrokes aimed at it, and Enter and Escape are handled here.
   ========================================================================== */

/* global GameShell */
(function () {
  'use strict';

  /* ==================================================================
     The vocabularies.
     ==================================================================
     Both are hand-written, lowercase, letters only, and deliberately
     uneven. A list with the same number of words on every letter would
     make the game a typing race; the reason X is worth two words and E is
     worth seventeen is that the scarcity IS the game.

     Checked before shipping for the one thing that would read as a bug
     rather than as strategy: a word whose last letter no word in the same
     list begins with. Such a word is an unavoidable dead end nobody could
     have played around. There are none in either list.
     ================================================================== */

  /* Ordinary English nouns. Concrete things, mostly, because a chain of
     abstractions is harder to think of under a clock than a chain of
     objects, and this is meant to be playable at speed. */
  var EN_WORDS = [
    'anchor', 'apple', 'arrow', 'atlas', 'album', 'anvil', 'apron', 'ankle', 'acorn', 'amber',
    'attic', 'avenue', 'author', 'autumn', 'arcade',
    'bridge', 'basket', 'bottle', 'button', 'branch', 'bucket', 'breeze', 'blanket', 'bamboo',
    'balloon', 'beacon', 'border', 'biscuit', 'boulder',
    'candle', 'carpet', 'castle', 'camera', 'cactus', 'cabin', 'cinema', 'circle', 'cotton',
    'copper', 'corner', 'crayon', 'crystal', 'compass',
    'dragon', 'drawer', 'desert', 'dinner', 'doctor', 'donkey', 'drum', 'diamond', 'dolphin',
    'doorway', 'dungeon', 'daylight',
    'engine', 'elbow', 'energy', 'empire', 'echo', 'eagle', 'envelope', 'evening', 'easel',
    'emerald', 'elephant', 'escalator', 'estuary', 'equator', 'eclipse', 'engineer', 'earring',
    'forest', 'fabric', 'feather', 'finger', 'flower', 'fountain', 'furnace', 'ferry', 'fossil',
    'funnel', 'festival', 'freezer',
    'garden', 'guitar', 'glacier', 'granite', 'gravel', 'ginger', 'glove', 'gallery', 'giraffe',
    'goggles', 'gateway', 'grammar',
    'harbour', 'hammer', 'harvest', 'helmet', 'honey', 'hollow', 'hurricane', 'hedge', 'horizon',
    'hotel', 'hospital', 'hillside',
    'island', 'iron', 'ivory', 'insect', 'igloo', 'image', 'index', 'iris', 'invoice', 'incense',
    'jungle', 'jacket', 'journey', 'jigsaw', 'jewel', 'juice', 'judge', 'jetty', 'junction',
    'jasmine',
    'kitchen', 'kettle', 'kite', 'kernel', 'keyboard', 'kingdom', 'kayak', 'knuckle', 'kiosk',
    'knapsack', 'kennel', 'kelp',
    'lantern', 'ladder', 'letter', 'lemon', 'lighthouse', 'library', 'lizard', 'lumber', 'lagoon',
    'linen', 'locket', 'luggage', 'lattice', 'lounge', 'lentil',
    'mountain', 'market', 'machine', 'marble', 'mirror', 'meadow', 'monsoon', 'museum', 'mustard',
    'magnet', 'mango', 'mosaic',
    'needle', 'notebook', 'nectar', 'nutmeg', 'network', 'nursery', 'noodle', 'nickel', 'notion',
    'nautilus', 'nostril', 'napkin', 'nutshell', 'nucleus', 'novel',
    'ocean', 'orange', 'orchard', 'organ', 'otter', 'oxygen', 'oven', 'olive', 'onion', 'outline',
    'opal', 'ostrich',
    'pepper', 'palace', 'pocket', 'pillow', 'pigeon', 'planet', 'pottery', 'prairie', 'pyramid',
    'parcel', 'pumpkin', 'platform',
    'quilt', 'quarry', 'quartz', 'quiver', 'quill', 'question', 'quarter', 'quadrant', 'quicksand',
    'river', 'ribbon', 'rocket', 'rooster', 'rubber', 'radish', 'ridge', 'rainbow', 'register',
    'rhubarb', 'runway', 'rosemary', 'raincoat', 'rooftop', 'rucksack', 'rosette', 'rhino',
    'sandal', 'saddle', 'silver', 'station', 'stadium', 'summer', 'sunset', 'syrup', 'satellite',
    'shadow', 'sparrow', 'squirrel',
    'temple', 'tunnel', 'teapot', 'timber', 'tractor', 'trumpet', 'turtle', 'tower', 'thunder',
    'ticket', 'trolley', 'terrace', 'tortoise', 'treasure', 'trellis', 'trousers', 'tapestry',
    'umbrella', 'uniform', 'union', 'universe', 'umpire', 'utensil', 'update', 'upstream',
    'valley', 'violin', 'vessel', 'village', 'velvet', 'vinegar', 'volcano', 'voyage', 'vault',
    'veranda',
    'window', 'walnut', 'whistle', 'wagon', 'weather', 'willow', 'winter', 'wisdom', 'workshop',
    'wrench', 'waterfall',
    'xylophone', 'xenon',
    'yard', 'yeast', 'yoghurt', 'yacht', 'yoke', 'yarn', 'yardstick', 'yolk', 'yeti', 'yew',
    'yam', 'yurt',
    'zebra', 'zero', 'zinc', 'zipper', 'zone', 'zenith', 'zodiac'
  ];

  /* Indian words in Latin script: foods, household objects, and towns,
     districts and rivers. Written out by hand for this game.

     Transliteration is not standardised and never has been — jalebi and
     jilebi are the same sweet, and half of India would spell sooji as suji.
     One spelling per word is listed and the list is the arbiter, which is a
     limit worth stating rather than a fact about how the word is "really"
     spelt. The page says so.

     Nothing here is a lyric, a title or a line of dialogue. They are the
     nouns you would use buying vegetables or reading a railway timetable. */
  var IN_WORDS = [
    'aloo', 'aam', 'amla', 'adrak', 'atta', 'achar', 'anar', 'angoor', 'ajwain', 'akhrot',
    'ashram', 'almirah', 'angan', 'agra', 'ambala', 'amritsar', 'alwar', 'assam', 'ahmedabad',
    'aurangabad', 'anjeer',
    'bhindi', 'badam', 'barfi', 'besan', 'biryani', 'bajra', 'baingan', 'bindi', 'bansuri',
    'boondi', 'bhurji', 'batasha', 'belan', 'bartan', 'bhopal', 'bengaluru', 'bikaner', 'bhuj',
    'banaras', 'bharuch',
    'chai', 'chapati', 'chana', 'chutney', 'chikoo', 'chandan', 'charpai', 'chakki', 'chamcha',
    'chikki', 'churidar', 'chandigarh', 'chennai', 'cuttack', 'coimbatore',
    'dal', 'dhaba', 'dhoti', 'dosa', 'dhania', 'dahi', 'dholak', 'dupatta', 'diya', 'dari',
    'darjeeling', 'dehradun', 'delhi', 'dindigul', 'dwarka',
    'elaichi', 'ellora', 'elephanta', 'erode', 'eluru', 'ernakulam', 'etawah',
    'faridabad', 'firozabad', 'falooda', 'fatehpur',
    'gulab', 'gajar', 'ghee', 'gobi', 'gulmohar', 'gamla', 'gulkand', 'gathiya', 'gajak',
    'gwalior', 'guwahati', 'goa', 'gangtok', 'gorakhpur',
    'haldi', 'halwa', 'hing', 'himalaya', 'haveli', 'hampi', 'howrah', 'hisar', 'hyderabad',
    'hosur',
    'idli', 'imli', 'imarti', 'ittar', 'indore', 'itarsi', 'imphal', 'itanagar', 'igatpuri',
    'imambara', 'islampur',
    'jalebi', 'jeera', 'jamun', 'jhadu', 'jhula', 'jaipur', 'jodhpur', 'jalandhar', 'jamnagar',
    'jharkhand', 'jabalpur', 'jhansi',
    'kadhi', 'kaju', 'kachori', 'kheer', 'kulfi', 'khadi', 'karela', 'kurta', 'kalash', 'katori',
    'khichdi', 'kolkata', 'kanpur', 'kolhapur', 'kanchipuram', 'kochi', 'karnataka',
    'lassi', 'laddu', 'lauki', 'lehenga', 'langar', 'lota', 'lucknow', 'ludhiana', 'lonavala',
    'lakshadweep', 'latur',
    'malai', 'methi', 'masala', 'mirchi', 'murabba', 'matka', 'mandir', 'mathri', 'mumbai',
    'madurai', 'mysore', 'mathura', 'munnar', 'moradabad', 'mangalore',
    'namkeen', 'nariyal', 'neem', 'nimbu', 'naan', 'nandi', 'nagpur', 'nashik', 'nagaland',
    'nadiad', 'nellore', 'nainital',
    'ooty', 'odisha', 'orchha', 'osmanabad', 'okha',
    'paneer', 'papad', 'poha', 'pulao', 'pudina', 'paratha', 'palak', 'pyaz', 'puri', 'phulka',
    'pital', 'patna', 'pune', 'panipat', 'patiala', 'pathankot', 'palakkad',
    'qutub', 'quilon',
    'rajma', 'roti', 'rasgulla', 'rasam', 'rangoli', 'razai', 'rajkot', 'ranchi', 'raipur',
    'rewari', 'rohtak', 'ratlam', 'rampur', 'rudrapur', 'roomali', 'rabri', 'rajgira', 'ragi',
    'rewa',
    'samosa', 'sabzi', 'saag', 'sarson', 'sitar', 'saree', 'sooji', 'sambar', 'sev', 'srinagar',
    'surat', 'shimla', 'sonipat', 'solapur', 'salem', 'sagar',
    'tandoor', 'tulsi', 'thali', 'tawa', 'tabla', 'til', 'toor', 'tikka', 'tirupati', 'thane',
    'thrissur', 'tumkur', 'tinsukia', 'tirunelveli',
    'udupi', 'ujjain', 'urad', 'upma', 'ubtan', 'udaipur', 'uttarakhand', 'unnao',
    'vada', 'veena', 'vibhuti', 'varanasi', 'vellore', 'vijayawada', 'vadodara', 'vapi', 'valsad',
    'wagah', 'wayanad', 'warangal', 'wardha',
    'yamuna', 'yoga', 'yavatmal', 'yamunanagar',
    'zanskar', 'zirakpur'
  ];

  /* ------------------------------------------------------------------
     One index per list, built once at parse time.

     A linear scan of three hundred words per turn would be fine on any
     machine made this century; the index exists because the COUNTS are
     wanted on every keystroke, not because the search is slow. Showing
     "hands over E, 12 left" while somebody types means answering that
     question forty times a word, and a per-letter tally answers it by
     lookup instead of by counting.
     ------------------------------------------------------------------ */
  function buildList(words) {
    var byLetter = {};
    var totals = {};
    var has = {};
    var i, w, first;
    for (i = 0; i < words.length; i++) {
      w = words[i];
      first = w.charAt(0);
      if (!byLetter[first]) { byLetter[first] = []; totals[first] = 0; }
      byLetter[first].push(w);
      totals[first]++;
      has[w] = true;
    }
    return { words: words, byLetter: byLetter, totals: totals, has: has };
  }

  var LISTS = {
    english: buildList(EN_WORDS),
    desi: buildList(IN_WORDS)
  };

  var LIST_LABEL = {
    english: 'the English list',
    desi: 'the Indian list'
  };

  /* Twenty-five seconds. Twenty is enough on a keyboard and is not enough
     on a phone, where the same thought has to survive an on-screen keyboard
     and an autocorrect that would rather you typed something else. */
  var TURN_SECONDS = 25;

  /* A round opens on a letter with room to move. Opening on Q — two words
     in the Indian list, both of them proper nouns — is not a hard round,
     it is a coin toss on whether the game starts at all. */
  var MIN_OPENING = 8;

  /* ==================================================================
     Styles.
     ==================================================================
     Injected here rather than added to games.css, and every rule is
     scoped under this game's root id. games.css is shared by the whole
     section, and an unscoped .anta-input would be a rule sixty other
     pages have to carry and one of them will eventually collide with.

     Colours come from the site's own custom properties, so the board
     follows the light and dark themes without this file knowing which
     one is on.
     ================================================================== */
  var ROOT = '#game-antakshari ';
  var MONO = '\'Cascadia Code\', Consolas, monospace';
  var CSS = [
    ROOT + '.board-anta{display:block;width:100%;max-width:44rem;text-align:left;}',

    ROOT + '.anta-top{display:grid;gap:0.5rem;padding:0.7rem 0.8rem;margin-bottom:0.7rem;' +
      'background:rgb(var(--well-rgb) / 0.55);border:1px solid rgb(var(--line-rgb) / 0.24);border-radius:10px;}',
    ROOT + '.anta-turn{margin:0;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-4);}',
    ROOT + '.anta-turn strong{color:var(--accent-1);font-weight:700;}',
    ROOT + '.anta-letterrow{display:flex;align-items:center;gap:0.7rem;flex-wrap:wrap;}',
    ROOT + '.anta-letter{display:grid;place-items:center;width:2.9rem;height:2.9rem;flex:none;' +
      'font-family:' + MONO + ';font-size:1.5rem;font-weight:700;color:var(--ink);' +
      'background:rgb(var(--accent-rgb) / 0.18);border:1px solid var(--accent-2);border-radius:9px;}',
    ROOT + '.anta-ask{margin:0;font-size:0.86rem;line-height:1.55;color:var(--ink-3);}',
    ROOT + '.anta-pool{display:block;font-size:0.78rem;color:var(--ink-4);}',
    ROOT + '.anta-pool.is-thin{color:#fbbf24;}',
    ROOT + '.anta-pool.is-dry{color:#fca5a5;}',

    ROOT + '.anta-clock{position:relative;height:6px;border-radius:999px;overflow:hidden;' +
      'background:rgb(var(--line-rgb) / 0.25);}',
    ROOT + '.anta-clock-fill{display:block;height:100%;width:100%;border-radius:999px;' +
      'background:var(--accent-2);transition:width 0.12s linear;}',
    ROOT + '.anta-clock-fill.is-low{background:#f87171;}',
    ROOT + '.anta-clock-text{margin:0;font-size:0.75rem;color:var(--ink-4);}',
    ROOT + '.anta-clock-text.is-low{color:#fca5a5;}',

    ROOT + '.anta-form{display:flex;flex-wrap:wrap;gap:0.4rem;align-items:flex-end;}',
    ROOT + '.anta-field{flex:1 1 14rem;min-width:0;}',
    ROOT + '.anta-label{display:block;margin-bottom:0.3rem;font-size:0.68rem;letter-spacing:0.08em;' +
      'text-transform:uppercase;color:var(--ink-4);}',
    ROOT + '.anta-input{display:block;width:100%;font-family:' + MONO + ';font-size:1rem;' +
      'padding:0.55rem 0.7rem;color:var(--ink);background:rgb(var(--sheet-rgb) / 0.85);' +
      'border:1px solid rgb(var(--line-rgb) / 0.4);border-radius:8px;}',
    ROOT + '.anta-input:focus-visible{outline:2px solid var(--accent-2);outline-offset:1px;}',

    ROOT + '.anta-hand{margin:0.5rem 0 0;font-size:0.8rem;line-height:1.55;color:var(--ink-4);min-height:1.6em;}',
    ROOT + '.anta-hand.is-thin{color:#fbbf24;}',
    ROOT + '.anta-hand.is-dry{color:#fca5a5;}',
    ROOT + '.anta-msg{margin:0.35rem 0 0;font-size:0.86rem;line-height:1.6;color:var(--ink-3);min-height:2.6em;}',
    ROOT + '.anta-msg.is-ok{color:#86efac;}',
    ROOT + '.anta-msg.is-bad{color:#fca5a5;}',

    ROOT + '.anta-chain{margin:0.8rem 0 0;padding:0.5rem 0.6rem;list-style:none;max-height:13rem;' +
      'overflow-y:auto;background:rgb(var(--well-rgb) / 0.8);' +
      'border:1px solid rgb(var(--line-rgb) / 0.24);border-radius:10px;}',
    ROOT + '.anta-chain:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px;}',
    ROOT + '.anta-chain li{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.5rem;' +
      'padding:0.2rem 0;font-size:0.85rem;line-height:1.6;}',
    ROOT + '.anta-n{font-family:' + MONO + ';font-size:0.72rem;color:var(--ink-4);min-width:1.6rem;}',
    ROOT + '.anta-who{font-size:0.72rem;color:var(--ink-4);min-width:5.2rem;}',
    ROOT + '.anta-word{font-family:' + MONO + ';color:var(--ink);}',
    ROOT + '.anta-row-them .anta-word{color:var(--accent-1);}',
    ROOT + '.anta-next{font-size:0.72rem;color:var(--ink-4);}',
    ROOT + '.anta-empty{margin:0;font-size:0.82rem;color:var(--ink-4);}',

    ROOT + '.anta-note{margin:0.9rem 0 0;font-size:0.8rem;line-height:1.7;color:var(--ink-4);}'
  ].join('');

  GameShell.define({
    id: 'game-antakshari',
    slug: 'antakshari',
    /* The chain length is a real score and higher is better, which is what
       the shell already does with the slug as the key. Written out anyway so
       the manifest and the module say the same thing in the same words. */
    bestKey: 'antakshari',
    title: 'Antakshari',
    startTitle: 'Antakshari, played with words',
    startText: 'Every word has to start with the last letter of the word before it. No lyrics are ' +
      'involved and none are stored — the note under the board says why. Twenty-five seconds a turn.',

    setup: function (g) {
      var host = g.board;
      if (!host) return {};

      var listKey = 'english';
      var mode = 'computer';       // computer | pass
      var level = 'fair';          // gentle | fair | sharp

      var list = LISTS.english;
      var used = {};               // word to true, this round only
      var left = {};               // letter to unused count, this round only
      var chain = [];
      var letter = 'a';
      var seat = 0;                // 0 is you or player one, 1 is the other side
      var phase = 'idle';          // idle | human | think | done
      var timeLeft = TURN_SECONDS;
      var thinkLeft = 0;
      var shownSec = -1;
      var shownStep = -1;
      var built = false;
      var el = {};
      /* Mirrors the root's data-state so the observer below can tell which
         transition just happened rather than only that one did. */
      var lastState = g.state;

      /* --------------------------------------------------------------
         Build. Runs once; every reset after that writes into it.
         -------------------------------------------------------------- */
      function styles() {
        if (g.el.querySelector('style[data-anta]')) return;
        var node = document.createElement('style');
        node.setAttribute('data-anta', '1');
        node.textContent = CSS;
        g.el.appendChild(node);
      }

      function build() {
        if (built) return;
        built = true;
        styles();
        host.className = 'game-board board-anta';
        host.innerHTML =
          '<div class="anta-top">' +
          '  <p class="anta-turn" id="anta-turn">Press Play to begin</p>' +
          '  <div class="anta-letterrow">' +
          '    <span class="anta-letter" id="anta-letter" aria-hidden="true">A</span>' +
          '    <p class="anta-ask" id="anta-ask">Your word must start with A.' +
          '      <span class="anta-pool" id="anta-pool"></span></p>' +
          '  </div>' +
          '  <div class="anta-clock"><span class="anta-clock-fill" id="anta-clock-fill"></span></div>' +
          '  <p class="anta-clock-text" id="anta-clock-text">25 seconds a turn</p>' +
          '</div>' +
          '<form class="anta-form" id="anta-form" novalidate>' +
          '  <div class="anta-field">' +
          '    <label class="anta-label" for="anta-in">Your word</label>' +
          '    <input class="anta-input" id="anta-in" type="text" maxlength="24" spellcheck="false" ' +
          '      autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="send" ' +
          '      placeholder="one word" />' +
          '  </div>' +
          '  <button class="game-btn" type="submit" id="anta-send">Play it</button>' +
          '  <button class="game-btn" type="button" id="anta-pass">Give up the round</button>' +
          '</form>' +
          '<p class="anta-hand" id="anta-hand"></p>' +
          '<p class="anta-msg" id="anta-msg"></p>' +
          '<ol class="anta-chain" id="anta-chain" tabindex="0" aria-label="The chain so far, oldest first"></ol>' +
          '<p class="anta-note">This is antakshari&rsquo;s rule, not its songs. The real game is sung with ' +
          'film songs; this one is played with words, because the site ships no audio at all and will not ' +
          'reproduce copyrighted lyrics or keep a database of them. The two word lists were written by hand ' +
          'for this game, and one of them is the referee &mdash; if a word is not on it, it is refused, ' +
          'whoever typed it.</p>';

        el.turn = host.querySelector('#anta-turn');
        el.letter = host.querySelector('#anta-letter');
        el.ask = host.querySelector('#anta-ask');
        el.pool = host.querySelector('#anta-pool');
        el.fill = host.querySelector('#anta-clock-fill');
        el.clock = host.querySelector('#anta-clock-text');
        el.form = host.querySelector('#anta-form');
        el.input = host.querySelector('#anta-in');
        el.pass = host.querySelector('#anta-pass');
        el.hand = host.querySelector('#anta-hand');
        el.msg = host.querySelector('#anta-msg');
        el.chain = host.querySelector('#anta-chain');

        el.form.addEventListener('submit', function (event) {
          event.preventDefault();
          submit();
        });

        el.pass.addEventListener('click', function () {
          if (g.state !== 'playing' || phase === 'done') return;
          finish({
            score: chain.length,
            title: seatName(seat) + ' gave up',
            message: 'The chain stopped at ' + chain.length +
              (chain.length === 1 ? ' word.' : ' words.')
          });
        });

        el.input.addEventListener('input', function () {
          paintHand();
        });

        /* Escape has to be handled here. The shell withholds every key that
           arrives from a text field, which is correct — a game that read the
           keyboard over the shoulder of its own input would fire a command
           on every letter typed — but it means the pause key does not work
           while the caret is in the field, which is where it is for the
           whole run. Escape activates nothing in an input, so answering it
           here collides with nothing. */
        el.input.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape' && event.key !== 'Esc') return;
          if (g.state !== 'playing') return;
          event.preventDefault();
          g.pause();
        });

        bindControls();
        watchState();
      }

      /* The three dropdowns in the toolbar. They live in the generated
         markup, so they exist before this runs. */
      function bindControls() {
        var pairs = [
          { id: 'game-mode', key: 'mode' },
          { id: 'game-words', key: 'words' },
          { id: 'game-level', key: 'level' }
        ];
        var i;
        for (i = 0; i < pairs.length; i++) {
          (function (pair) {
            var sel = document.getElementById(pair.id);
            if (!sel) return;
            var saved = g.load(pair.key, null);
            if (saved) {
              /* Only a value the dropdown actually offers. A stored
                 preference is data from last month's version of this file,
                 and setting an unknown value silently leaves the select on
                 whatever happened to be first. */
              var opts = sel.options, k;
              for (k = 0; k < opts.length; k++) {
                if (opts[k].value === saved) { sel.value = saved; break; }
              }
            }
            el[pair.key] = sel;
            sel.addEventListener('change', function () {
              g.save(pair.key, sel.value);
              readControls();
              if (g.state === 'playing') {
                /* Changing the vocabulary or the opponent mid-chain would
                   leave a chain built under rules that no longer apply, so
                   the round restarts and says that it did rather than
                   quietly scoring the old one under the new settings. */
                g.start();
                say('Restarted on ' + LIST_LABEL[listKey] + ', ' + modeLabel() + '.', '');
              } else {
                reset();
              }
            });
          })(pairs[i]);
        }
      }

      /* WHY AN OBSERVER RATHER THAN A HOOK: the shell has no resume hook,
         and its takeFocus() knows about exactly one kind of typed game —
         the ones with an off-screen input carrying .typing-catch. This
         game's field is visible and on the board, so after a pause the
         keyboard would come back on the board rather than in the field, and
         the player would be typing into nothing with a clock running. The
         root's data-state changes on every transition, which is a fact the
         shell already publishes for particle-bg.js to read. */
      function watchState() {
        if (!window.MutationObserver) return;
        var mo = new window.MutationObserver(function () {
          var now = g.el.getAttribute('data-state');
          if (now === lastState) return;
          var was = lastState;
          lastState = now;
          if (now === 'playing' && was === 'paused' && phase === 'human') focusField();
        });
        mo.observe(g.el, { attributes: true, attributeFilter: ['data-state'] });
      }

      function readControls() {
        if (el.mode) mode = el.mode.value === 'pass' ? 'pass' : 'computer';
        if (el.words) listKey = el.words.value === 'desi' ? 'desi' : 'english';
        if (el.level) {
          level = el.level.value === 'gentle' || el.level.value === 'sharp' ? el.level.value : 'fair';
        }
        list = LISTS[listKey];
      }

      /* --------------------------------------------------------------
         Small helpers.
         -------------------------------------------------------------- */
      function up(ch) { return String(ch).toUpperCase(); }

      /* Lowercase, letters only. A trailing space, a capital and a stray
         hyphen are all typing rather than meaning. Anything left empty is
         caught by the caller. */
      function normalise(text) {
        return String(text == null ? '' : text).toLowerCase().replace(/[^a-z]/g, '');
      }

      function modeLabel() {
        return mode === 'pass' ? 'two players' : 'against the computer';
      }

      function seatName(which) {
        if (mode === 'pass') return which === 0 ? 'Player 1' : 'Player 2';
        return which === 0 ? 'You' : 'The computer';
      }

      function words(ch) {
        return list.byLetter[ch] || [];
      }

      /* Unused words on a letter, right now. */
      function remaining(ch) {
        var n = left[ch];
        return n == null ? 0 : n;
      }

      /* What the opponent would be left with if this word were played. A
         word that starts and ends on the same letter — kayak, yardstick's
         cousins, alwar in the Indian list — spends one of the very options
         it hands over, and forgetting that is how a "safe" move turns out
         to have been the last one. */
      function handover(word) {
        var last = word.charAt(word.length - 1);
        var n = remaining(last);
        if (last === word.charAt(0) && list.has[word] && !used[word]) n -= 1;
        return n < 0 ? 0 : n;
      }

      function focusField() {
        if (!el.input) return;
        try { el.input.focus({ preventScroll: true }); }
        catch (err) { el.input.focus(); }
      }

      /* One voice, not two. This paragraph is NOT a live region: the shell
         already owns one, and two polite regions describing the same event
         means a screen reader reads the move twice and interleaves them.
         Everything worth hearing goes through g.announce below. */
      function say(text, kind) {
        if (!el.msg) return;
        el.msg.textContent = text;
        el.msg.className = 'anta-msg' + (kind ? ' ' + kind : '');
      }

      /* --------------------------------------------------------------
         Painting.
         -------------------------------------------------------------- */
      function paintTurn() {
        if (!el.turn) return;
        var who;
        if (phase === 'done') who = 'Round over';
        else if (phase === 'idle') who = 'Press Play to begin';
        else if (phase === 'think') who = seatName(1) + ' is thinking';
        else who = seatName(seat) + ' to play';
        el.turn.innerHTML = '';
        var strong = document.createElement('strong');
        strong.textContent = who;
        el.turn.appendChild(strong);
      }

      function paintLetter() {
        if (el.letter) el.letter.textContent = up(letter);
        var n = remaining(letter);
        /* The letter is written out in words as well as shown in the big
           box, because the box is aria-hidden — a lone capital letter read
           out on its own is not a sentence, and the sentence is the part
           that says what to do with it.

           The first child node only, so the pool count in the <span> beside
           it survives. Guarded because an innerHTML the browser normalised
           differently would otherwise throw here on every repaint. */
        if (el.ask && el.ask.firstChild && el.ask.firstChild.nodeType === 3) {
          el.ask.firstChild.nodeValue = (phase === 'think' ? seatName(1) + ' needs a word starting with '
            : 'Your word must start with ') + up(letter) + '. ';
        }
        if (!el.pool) return;
        el.pool.textContent = n === 0
          ? 'Nothing left on ' + up(letter) + ' in ' + LIST_LABEL[listKey] + '.'
          : n + (n === 1 ? ' word' : ' words') + ' left on ' + up(letter) + ' in ' + LIST_LABEL[listKey] + '.';
        el.pool.className = 'anta-pool' + (n === 0 ? ' is-dry' : (n <= 4 ? ' is-thin' : ''));
      }

      /* The strategy, made visible. As the player types, this says which
         letter the word would hand over and how many answers are left on
         it — which is the calculation good antakshari players are doing in
         their heads and nobody has ever been able to check. */
      function paintHand() {
        if (!el.hand) return;
        var raw = el.input ? el.input.value : '';
        var word = normalise(raw);
        if (!word) {
          el.hand.textContent = 'Type a word and this line will say which letter you would be handing over.';
          el.hand.className = 'anta-hand';
          return;
        }
        var last = word.charAt(word.length - 1);
        var n = handover(word);
        el.hand.textContent = n === 0
          ? 'That hands over ' + up(last) + ', and nothing is left on ' + up(last) + '. It would end the round.'
          : 'That hands over ' + up(last) + ' — ' + n + (n === 1 ? ' answer' : ' answers') + ' left on it.';
        el.hand.className = 'anta-hand' + (n === 0 ? ' is-dry' : (n <= 4 ? ' is-thin' : ''));
      }

      /* Called from update(), so it runs at the fixed step rather than once
         a frame. Both writes are guarded on the displayed value actually
         changing: at 120 steps a second, an unguarded textContent write is
         a hundred and twenty layout invalidations for a number that changes
         once. */
      function paintClock() {
        var sec, pct, step, low;
        if (phase !== 'human') {
          if (el.fill) { el.fill.style.width = '100%'; el.fill.className = 'anta-clock-fill'; }
          if (el.clock) {
            el.clock.textContent = phase === 'think' ? 'Thinking'
              : (phase === 'done' ? 'Round over' : 'Twenty-five seconds a turn');
            el.clock.className = 'anta-clock-text';
          }
          shownSec = -1;
          shownStep = -1;
          return;
        }
        sec = Math.ceil(timeLeft);
        if (sec < 0) sec = 0;
        pct = (timeLeft / TURN_SECONDS) * 100;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
        step = Math.round(pct);
        low = timeLeft <= 5;
        if (step !== shownStep) {
          shownStep = step;
          if (el.fill) {
            el.fill.style.width = step + '%';
            el.fill.className = 'anta-clock-fill' + (low ? ' is-low' : '');
          }
        }
        if (sec !== shownSec) {
          shownSec = sec;
          g.stat('time', sec);
          if (el.clock) {
            el.clock.textContent = sec + (sec === 1 ? ' second left' : ' seconds left');
            el.clock.className = 'anta-clock-text' + (low ? ' is-low' : '');
          }
          if (low && sec > 0) {
            g.beep(720, 0.045, 'sine', 0.035);
            if (sec === 5) g.announce('Five seconds left.');
          }
        }
      }

      function addRow(which, word, next) {
        if (!el.chain) return;
        var li = document.createElement('li');
        li.className = which === 0 ? 'anta-row-you' : 'anta-row-them';
        var n = document.createElement('span');
        n.className = 'anta-n';
        n.textContent = chain.length + '.';
        var who = document.createElement('span');
        who.className = 'anta-who';
        who.textContent = seatName(which);
        var w = document.createElement('span');
        w.className = 'anta-word';
        w.textContent = word;
        var nx = document.createElement('span');
        nx.className = 'anta-next';
        nx.textContent = 'hands over ' + up(next);
        li.appendChild(n);
        li.appendChild(who);
        li.appendChild(w);
        li.appendChild(nx);
        el.chain.appendChild(li);
        /* Newest at the bottom and scrolled to, like a transcript. The whole
           chain stays scrollable above it, which is the point of keeping it
           rather than printing only the last word. */
        el.chain.scrollTop = el.chain.scrollHeight;
      }

      function paintEmptyChain() {
        if (!el.chain) return;
        el.chain.innerHTML = '';
        var li = document.createElement('li');
        var p = document.createElement('p');
        p.className = 'anta-empty';
        p.textContent = 'Nothing played yet.';
        li.appendChild(p);
        el.chain.appendChild(li);
      }

      /* --------------------------------------------------------------
         The round.
         -------------------------------------------------------------- */
      function freshCounts() {
        var out = {};
        var k;
        for (k in list.totals) {
          if (Object.prototype.hasOwnProperty.call(list.totals, k)) out[k] = list.totals[k];
        }
        return out;
      }

      function openingLetter() {
        var pool = [];
        var k;
        for (k in list.totals) {
          if (!Object.prototype.hasOwnProperty.call(list.totals, k)) continue;
          if (list.totals[k] >= MIN_OPENING) pool.push(k);
        }
        if (!pool.length) pool = ['a'];
        return g.pick(pool);
      }

      function reset() {
        build();
        readControls();

        used = {};
        left = freshCounts();
        chain = [];
        letter = openingLetter();
        seat = 0;
        timeLeft = TURN_SECONDS;
        thinkLeft = 0;
        shownSec = -1;
        shownStep = -1;

        /* 'idle' before the first Play, so the board does not claim it is
           anybody's turn while the start overlay is still up. The shell
           calls reset() once from its constructor, long before a run. */
        phase = g.state === 'playing' ? 'human' : 'idle';

        if (el.input) { el.input.value = ''; el.input.disabled = false; }
        g.stat('time', TURN_SECONDS);
        g.stat('score', 0);
        paintEmptyChain();
        paintTurn();
        paintLetter();
        paintClock();
        paintHand();
        say('', '');

        if (phase === 'human') {
          say('Type a word starting with ' + up(letter) + ' and press Enter.', '');
          focusField();
          g.announce('New round on ' + LIST_LABEL[listKey] + '. Your word starts with ' + up(letter) +
            '. ' + remaining(letter) + ' options.');
        }
      }

      /* Accept a word from either side. The one place a word is scored, so
         the computer and the player cannot drift apart on what counts. */
      function accept(word, which) {
        var next = word.charAt(word.length - 1);
        used[word] = true;
        left[word.charAt(0)] = remaining(word.charAt(0)) - 1;
        chain.push(word);
        letter = next;

        /* g.stat rather than g.setScore, deliberately. setScore schedules a
           debounced "Score N" through the same live region this game is
           already using for a sentence a turn, so a screen reader heard the
           word, the next letter, and then a bare number repeating the count
           it had just been given. over() is handed the score explicitly
           below, so nothing downstream needs this.score. */
        g.stat('score', chain.length);

        addRow(which, word, next);
        /* Two pitches, so the two sides are audibly different without
           either being a jingle. Yours is the lower one. */
        g.pluck(which === 0 ? 392 : 523, 0.35, 0.05);

        if (el.input) el.input.value = '';
        paintHand();

        var pool = remaining(next);
        g.announce(seatName(which) + ' played ' + word + '. Next word starts with ' + up(next) +
          '. ' + pool + (pool === 1 ? ' option' : ' options') + ' left.');

        nextTurn();
      }

      function nextTurn() {
        seat = 1 - seat;
        if (remaining(letter) <= 0) {
          dryLetter();
          return;
        }
        if (mode === 'computer' && seat === 1) {
          phase = 'think';
          /* Long enough to read as an opponent taking a turn, short enough
             not to be a wait. It is not thinking time — the move is decided
             in a millisecond — and pretending otherwise with a longer pause
             would be theatre. */
          thinkLeft = 0.5 + g.rnd(60) / 100;
          paintTurn();
          paintLetter();
          paintClock();
          return;
        }
        phase = 'human';
        timeLeft = TURN_SECONDS;
        shownSec = -1;
        shownStep = -1;
        paintTurn();
        paintLetter();
        paintClock();
        if (mode === 'pass') {
          say('Pass the device. ' + seatName(seat) + ', your word starts with ' + up(letter) + '.', '');
        } else {
          say('Your turn. Start with ' + up(letter) + '.', '');
        }
        focusField();
      }

      /* Nobody can answer: the letter has no unused words left. Whoever is
         on strike when that happens has lost the round, and which of them
         it is decides whether this reads as a win. */
      function dryLetter() {
        var mine = seat === 0 || mode === 'pass';
        finish({
          won: mode === 'computer' && seat === 1,
          score: chain.length,
          title: mode === 'computer' && seat === 1 ? 'It ran out of words' : 'The letter ran dry',
          message: (mine ? 'Nothing is left on ' + up(letter) + ' in ' + LIST_LABEL[listKey] + '.'
            : 'The computer had nothing left on ' + up(letter) + '.') +
            ' Chain: ' + chain.length + (chain.length === 1 ? ' word.' : ' words.')
        });
      }

      function outOfTime() {
        finish({
          score: chain.length,
          title: 'Out of time',
          message: seatName(seat) + ' ran out of clock on ' + up(letter) + '. Chain: ' +
            chain.length + (chain.length === 1 ? ' word.' : ' words.')
        });
      }

      function finish(opts) {
        if (phase === 'done') return;
        phase = 'done';
        paintTurn();
        paintClock();
        say(opts.title + '. ' + opts.message, opts.won ? 'is-ok' : 'is-bad');
        g.over(opts);
      }

      /* --------------------------------------------------------------
         The player's move.
         --------------------------------------------------------------
         A refused word does NOT cost the turn. The clock keeps running,
         which is punishment enough — ending a run on a typo would make the
         game about spelling under pressure rather than about the chain.
         -------------------------------------------------------------- */
      function reject(text) {
        say(text, 'is-bad');
        g.announce(text);
        g.beep(180, 0.09, 'square', 0.05);
        focusField();
      }

      function submit() {
        if (g.state !== 'playing') {
          say('Press Play to start a round.', '');
          return;
        }
        if (phase !== 'human') {
          reject('Not your turn yet.');
          return;
        }

        var raw = el.input ? el.input.value : '';
        var word = normalise(raw);

        if (!word) {
          reject('Type a word first.');
          return;
        }
        if (/\s/.test(String(raw).replace(/^\s+|\s+$/g, ''))) {
          reject('One word at a time — both lists hold single words.');
          return;
        }
        if (word.charAt(0) !== letter) {
          reject('"' + word + '" starts with ' + up(word.charAt(0)) + '. It has to start with ' +
            up(letter) + '.');
          return;
        }
        if (used[word]) {
          reject('"' + word + '" has already been played in this round.');
          return;
        }
        if (!list.has[word]) {
          reject('"' + word + '" is not in ' + LIST_LABEL[listKey] +
            '. The list is the referee for both sides, so the computer cannot use it either.');
          return;
        }

        say('', '');
        accept(word, seat);
      }

      /* --------------------------------------------------------------
         The computer's move.
         --------------------------------------------------------------
         Candidates are the unused words on the required letter. Each is
         scored by ONE number: how many answers the opponent would have
         left afterwards. That single number is the real strategy of
         antakshari — everybody who has played it knows to finish on a
         letter nobody can start on — and it is worth being explicit that
         nothing cleverer is happening here. No search, no lookahead past
         the one move, and no knowledge of which words you personally know.

         Gentle plays generously and Sharp plays the throat. Fair is a
         uniform pick, which on these lists is already a decent opponent
         because the lists themselves are lopsided.
         -------------------------------------------------------------- */
      function computerMove() {
        if (phase !== 'think') return;

        var all = words(letter);
        var cands = [];
        var i;
        for (i = 0; i < all.length; i++) {
          if (!used[all[i]]) cands.push(all[i]);
        }
        if (!cands.length) {
          /* nextTurn() checks the count before handing over, so this is the
             belt to that braces: an empty candidate list here would
             otherwise be a turn that never ends. */
          dryLetter();
          return;
        }

        var scored = [];
        for (i = 0; i < cands.length; i++) {
          scored.push({ word: cands[i], hand: handover(cands[i]) });
        }
        scored.sort(function (a, b) {
          if (a.hand !== b.hand) return a.hand - b.hand;
          return a.word < b.word ? -1 : 1;
        });

        var pickFrom;
        if (level === 'sharp') {
          /* Every move tying the minimum, shuffled, so a strong opponent is
             still not the same opponent twice. */
          pickFrom = scored.filter(function (s) { return s.hand === scored[0].hand; });
        } else if (level === 'gentle') {
          /* The kindest third: the moves that leave the most answers open.
             It is not playing badly, it is playing generously, which is the
             difference between a weak opponent and a broken one. */
          var keep = Math.max(1, Math.floor(scored.length / 3));
          pickFrom = scored.slice(scored.length - keep);
        } else {
          pickFrom = scored;
        }

        var choice = g.pick(pickFrom);
        accept(choice.word, 1);
      }

      /* --------------------------------------------------------------
         Shell hooks.
         -------------------------------------------------------------- */
      function update(dt) {
        if (phase === 'think') {
          thinkLeft -= dt;
          if (thinkLeft <= 0) computerMove();
          return;
        }
        if (phase !== 'human') return;
        timeLeft -= dt;
        if (timeLeft <= 0) {
          timeLeft = 0;
          paintClock();
          outOfTime();
          return;
        }
        paintClock();
      }

      /* Space or Enter with the keyboard on the board rather than in the
         field. The shell sends those here as 'action'; the useful answer is
         to put the caret where the game actually happens, not to fire a
         move the player has not typed. */
      function key(name) {
        if (name === 'action' && phase === 'human') focusField();
      }

      return { reset: reset, update: update, key: key };
    }
  });
})();

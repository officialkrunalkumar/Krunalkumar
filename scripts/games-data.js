/* ==========================================================================
   scripts/games-data.js — every game in /games, as data.
   --------------------------------------------------------------------------
   scripts/games.js turns this into games/index.html and one page per entry.
   The prose here is hand-written; the generator only decides where it goes.
   Same split glossary.js and glossary-terms.js already use.

   ADDING A GAME
     1. Write the module at assets/js/games/<cat>/<slug>.js.
     2. Add an entry below.
     3. node scripts/games.js
     4. Add the page's <url> to sitemap.xml (build.js fails the deploy if you
        forget, which is the point of that gate).

   FIELD NOTES
     slug      the URL: /games/<slug>. Never change one after it ships.
     cat       must match a CATEGORIES key.
     glyph     the fallback tile shown when the thumbnail canvas has not
               painted, and the only tile a no-JS visitor sees. Keep it to
               one or two characters.
     width /
     height    LOGICAL units the module draws in. The shell scales them to
               the real canvas; nothing here is a pixel measurement.
     board     true for the games that render DOM tiles instead of a canvas
               (2048, Minesweeper). The shell picks up whichever exists.
     pad       which on-screen control set to ship: dpad | lr | rotate |
               action | none. Shown only on coarse pointers — see games.css.
     bestKey   set null for a game with no meaningful score (the love
               calculator, the personality test), and no Best cell will be
               written or stored.
     related   other slugs. The generator throws on an unknown one, so a
               renamed game cannot leave a dead card behind.

   THE SECTION IS NOT FINISHED, and the count is deliberately not written down
   here or anywhere a visitor can read it: games are still being added, so any
   figure would be a snapshot rather than a fact. Anything new goes
   in as one module under assets/js/games/<cat>/ plus one entry below, and
   then: node scripts/games.js, add the <url> to sitemap.xml, and rebuild the
   search index. build.js fails the deploy if the sitemap entry is missing,
   which is the point of that gate.

   NO ONLINE PLAY. Ludo briefly carried a play-by-link mode that packed the
   board into a URL fragment. It worked, but it meant sending a link after
   every single move, which is too much ceremony for these games. Anything
   multiplayer here is same-device: pass and play, or against the computer.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   Categories, in the order they appear on the hub.
   -------------------------------------------------------------------------- */
const CATEGORIES = [
  {
    key: 'arcade',
    chip: 'Arcade',
    eyebrow: 'The arcade',
    title: 'Games you already know how to play',
    blurb: 'The classics, rebuilt properly rather than embedded from somewhere else. Arrow keys on a keyboard, ' +
      'a real thumb pad on a phone, and your best score kept on your own device because there is nowhere else ' +
      'for it to go.',
  },
  {
    key: 'puzzle',
    chip: 'Puzzles',
    eyebrow: 'Take your time',
    title: 'Puzzles with no clock on them',
    blurb: 'Nothing here chases you. Think as long as you like, undo where it makes sense, and come back to the ' +
      'board tomorrow &mdash; the ones worth resuming save themselves in your browser.',
  },
  {
    key: 'terminal',
    chip: 'Terminal',
    eyebrow: 'From the command line',
    title: 'The games that came with Linux',
    blurb: 'Eighty columns, twenty-four rows, one character per cell &mdash; rebuilt in a browser rather than ' +
      'emulated, and drawn in the same phosphor green as the <a href="/labs/linux">Linux terminal</a> next door. ' +
      'These are the games people actually played on a machine with no graphics card, and most of them are ' +
      'better than that description suggests.',
  },
  {
    key: 'board',
    chip: 'Board games',
    eyebrow: 'Play with someone',
    title: 'Board games for one device',
    blurb: 'The games you play with other people, or against the machine when there is nobody about. Pass one ' +
      'phone round the table, or take on the computer &mdash; no account, no app, and nothing that needs a ' +
      'connection once the page has loaded.',
  },
  {
    key: 'cs',
    chip: 'Security & CS',
    eyebrow: 'The ones that teach something',
    title: 'Security and computer science, with a score attached',
    blurb: 'These are the <a href="/labs">labs</a> next door with a timer on them. Same subject matter, played ' +
      'rather than read &mdash; and each one links back to the tool that does the same job without anybody ' +
      'keeping score.',
  },
  {
    key: 'toy',
    chip: 'Toys',
    eyebrow: 'Nothing to win',
    title: 'Toys, not games',
    blurb: 'No score, no clock, no way to lose. These are the simulations worth staring at &mdash; a handful of ' +
      'rules per particle, and behaviour nobody put there on purpose. Drag on any of them and see what happens.',
  },
  {
    key: 'fun',
    chip: 'For fun',
    eyebrow: 'Just for fun',
    title: 'Quizzes, calculators and the odd bit of nonsense',
    blurb: 'The share-with-a-friend end of the arcade. Some of it is genuinely useful, some of it is a joke with ' +
      'a straight face &mdash; and where a thing is nonsense, the page says so rather than letting you wonder.',
  },
];

/* --------------------------------------------------------------------------
   The hub page
   -------------------------------------------------------------------------- */
const HUB = {
  title: 'Games — Free Browser Games With No Ads Or Sign-Up',
  ogTitle: 'Games that run on your machine, not mine',
  h1: 'Games that run on your machine, not mine',
  description: 'Free browser games — arcade classics, puzzles, a typing trainer and a few quizzes. No ads, ' +
    'no account, no tracking — everything runs in your own tab.',
  hero: 'The same rule as the labs next door: it all happens inside your browser tab. No account, no ads, no ' +
    'timer counting down to a paywall, and no server anywhere that knows you played. Your best scores live in ' +
    'your own browser storage, which means clearing your site data clears them &mdash; and that is the honest ' +
    'trade for never being asked to sign in.',
  facts: [
    'No ads, ever',
    'No sign-up',
    'Nothing is uploaded',
    'Works offline once cached',
    'Free forever',
  ],
  aboutHeading: 'Why an arcade on a cybersecurity site',
  about: [
    {
      h: 'Because the same claim is being tested',
      p: 'Every lab on this site says the same thing: the work happens on your machine and nothing is sent ' +
        'anywhere. A game is a harder version of that promise, not an easier one &mdash; free games are the most ' +
        'reliably ad-infested corner of the web, and the usual price is a tracker on every click. The games ' +
        'themselves are first-party and self-contained; the only third-party request is the same analytics ' +
        'script every page on this site loads, and your own network tab will show you that and nothing else.',
    },
    {
      h: 'Because a browser is a real machine',
      p: 'The labs make the point with a WebAssembly compiler; this makes it with sixty frames a second. Same ' +
        'engine, same tab, no plugin, no install. If your browser can run a game like this, the argument that ' +
        'a real tool needs to phone a server gets much harder to make.',
    },
    {
      h: 'Because some of them teach something',
      p: 'A few of these are the security and computer-science labs with a score attached &mdash; the same idea, ' +
        'played rather than read. Those are the ones I would point an intern at, and they link back to the lab ' +
        'that does the same job without the timer.',
    },
    {
      h: 'And some are just fun',
      p: 'Not everything needs a justification. A typing trainer that gets you to eighty words a minute is worth ' +
        'having, a love calculator is worth exactly one laugh, and the page will tell you which of the two you ' +
        'are looking at.',
    },
  ],
  faq: [
    {
      q: 'Are these really free, with no ads?',
      a: 'Yes. There is no advertising, no analytics on the games themselves beyond the same page-view counter ' +
        'the rest of the site uses, and nothing to buy. They cost nothing to run because there is no server ' +
        'behind them.',
    },
    {
      q: 'Do I need an account?',
      a: 'No, and there is no way to make one. Your best scores are written to your own browser storage on your ' +
        'own device.',
    },
    {
      q: 'Where are my high scores kept?',
      a: 'In localStorage in the browser you played in. They do not follow you to another device or another ' +
        'browser, and clearing your site data removes them. There is no leaderboard, because a leaderboard ' +
        'would need a server and this has none.',
    },
    {
      q: 'Do they work on a phone?',
      a: 'Yes. Every game that needs directions ships an on-screen pad, which appears automatically on a ' +
        'touchscreen and stays hidden on a machine with a keyboard.',
    },
    {
      q: 'Do they work offline?',
      a: 'Once a game page has been visited, the service worker keeps it, so it will open again with no ' +
        'connection. The first visit needs the network like any other page.',
    },
    {
      q: 'Is anything uploaded when I play?',
      a: 'No. Nothing you do in a game leaves your browser. There is no score submission and no telemetry from ' +
        'the games; the only third-party script on the page is the same analytics tag the rest of the site ' +
        'loads, and it runs whether you play or not. Your network tab will show you exactly that.',
    },
  ],
};

/* --------------------------------------------------------------------------
   The games
   -------------------------------------------------------------------------- */
const GAMES = [
  /* ---------------------------------------------------------------- arcade */
  {
    slug: 'asteroids',
    cat: 'arcade',
    name: 'Asteroids',
    glyph: '△',
    script: 'arcade/asteroids.js',
    width: 640, height: 480, pad: 'dpad',
    bestKey: 'asteroids',
    engine: 'Canvas &middot; vector outlines &middot; toroidal collision',
    title: 'Asteroids — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'Asteroids, and the momentum you cannot put down',
    description: 'Free browser Asteroids drawn as vector outlines. The ship keeps its speed when you stop ' +
      'thrusting, which is the whole difficulty of the game.',
    short: 'Momentum, rocks, and one aiming saucer.',
    h1: 'Asteroids',
    hero: 'Turn, thrust, fire. Thrust adds to the speed you already had rather than replacing it, so the ship ' +
      'carries on drifting long after you let go &mdash; and that one fact is the entire difficulty of the game. ' +
      'Every rock breaks into two smaller rocks twice before it is gone, so a full board gets busier before it ' +
      'gets quieter.',
    facts: ['Thrust adds, never steers', 'Everything wraps', 'Rocks split twice', 'A saucer that aims'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'lives', label: 'Lives', init: '3' },
      { key: 'wave', label: 'Wave', init: '1' },
    ],
    keys: [
      { k: '← →', d: 'Turn' },
      { k: '↑', d: 'Thrust' },
      { k: '↓', d: 'Hyperspace' },
      { k: 'Space', d: 'Fire' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'The D-pad turns and thrusts, down jumps to hyperspace, and Action fires. A tap anywhere on the playfield fires as well.',
    infoHeading: 'Why the ship is hard to fly',
    info: [
      {
        h: 'Thrust adds to your velocity, it does not set it',
        p: 'Holding up does not point the ship where it is going &mdash; it adds a push in the direction you ' +
          'are facing to the speed you already had. Let go and nothing stops you; there is only a light drag ' +
          'that bleeds a little off each second. So the direction you are aiming and the direction you are ' +
          'travelling are two separate things, and every burn has to be paid back with an opposite one later. ' +
          'That is the whole game, and it is why turning to face a rock is easy and getting away from it is not.',
      },
      {
        h: 'The board is a torus, not a box',
        p: 'Everything wraps, which makes a rock at the left edge and a shot at the right edge eighteen units ' +
          'apart rather than six hundred. Every distance in the file folds each axis into the nearer half of ' +
          'the board before measuring, so shots do not pass through rocks sitting on the seam. Anything close ' +
          'to an edge is also painted a second time on the far side, so a rock is visibly half on each edge ' +
          'while it crosses instead of appearing to teleport.',
      },
      {
        h: 'Four shots on screen, and a range limit',
        p: 'You can only have four of your own shots alive at once, and each one expires after about three ' +
          'quarters of a board width. Both limits are from the original and both are load-bearing: without ' +
          'them you can hold the fire button and clear a wave without aiming, and the small saucer stops ' +
          'being a threat worth a thousand points.',
      },
    ],
    faq: [
      { q: 'Why does the ship keep moving after I stop thrusting?', a: 'Because that is the game. There are no brakes. The only way to slow down is to turn around and thrust the other way, and the drag is deliberately light so that most of the speed you build is still yours to deal with a few seconds later.' },
      { q: 'How many times does a rock split?', a: 'Twice. A large one becomes two mediums, each medium becomes two smalls, and a small is destroyed outright. One large rock is therefore seven rocks in total, worth 20, 50 and 100 points as they get smaller.' },
      { q: 'What is the saucer worth?', a: 'The large one is 200 points and fires in random directions. The small one is 1000 and aims at you, with an error that narrows as your score climbs. It turns up more often the better you are doing. Either can be destroyed by a rock, and its shots break rocks too, though you are not paid for those.' },
      { q: 'What does hyperspace do?', a: 'Down drops you at a random point on the board with your speed reset to zero. It does not check what is already there, so it can put you inside a rock. It is an escape from a situation you cannot fly out of, not a safe one.' },
      { q: 'Do I get extra lives?', a: 'One every 10,000 points, on top of the three you start with. Your best score is kept in this browser only; there is no server and no leaderboard.' },
    ],
    related: ['ninvaders', 'breakout', 'moon-buggy'],
  },

  {
    slug: 'flappy',
    cat: 'arcade',
    name: 'Flappy',
    glyph: '🐦',
    script: 'arcade/flappy.js',
    width: 420, height: 560, pad: 'action',
    bestKey: 'flappy',
    engine: 'Canvas &middot; one button, fixed step',
    title: 'Flappy — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'One button, and a bird that is always falling',
    description: 'A one-button flap-through-gaps game where gravity, the flap impulse and the pipe spacing are ' +
      'tuned against each other. No ads, no sign-up, nothing uploaded.',
    short: 'One button, gravity, and a gap.',
    h1: 'Flappy',
    hero: 'One button, and a bird that is always falling. The whole game is the relationship between four ' +
      'numbers &mdash; how hard gravity pulls, how much a flap gives back, how fast the pipes arrive and how ' +
      'far apart the gaps sit &mdash; and this one is tuned so that ten gaps is a matter of rhythm rather ' +
      'than luck.',
    facts: ['One button, nothing else', 'Tuned so ten gaps is rhythm', 'The gap narrows as you score', 'Your best kept on this device'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'gap', label: 'Gap', init: '168' },
    ],
    keys: [
      { k: 'Space', d: 'Flap' },
      { k: '↑', d: 'Flap' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'Tap anywhere on the playfield to flap, or use the Action button on the pad.',
    infoHeading: 'The tuning is the game',
    info: [
      {
        h: 'Four numbers that are really one',
        p: 'A flap sets your upward speed rather than adding to it, so every flap draws the same 60-unit arc ' +
          'and takes about a third of a second to reach the top of it. Flap again as it comes back down and ' +
          'you hover; flap faster and you climb at roughly 190 units a second. Pipes arrive every 1.43 ' +
          'seconds, so you can climb about 270 units between one gap and the next &mdash; and that number is ' +
          'what decides how far apart consecutive gaps are allowed to be.',
      },
      {
        h: 'Gap centres step, they do not jump',
        p: 'Each gap centre is drawn as a step from the previous one, capped at 110 units. Picking every ' +
          'centre independently is the usual shortcut, and it produces the pair nobody can make: one gap near ' +
          'the ground, the next near the roof, with a second and a half to cross the lot. Capping the step ' +
          'well under what the flap arc can reach keeps every pair reachable without perfect timing.',
      },
      {
        h: 'The ceiling does not kill you',
        p: 'Hitting the roof takes your climb away and drops you; only the ground and the pipes end a run. A ' +
          'high gap has to be taken with a flap near the top of the screen, and a lethal ceiling would punish ' +
          'the correct move. There is nothing above the roof worth punishing.',
      },
    ],
    faq: [
      { q: 'How do I flap?', a: 'Space, the up arrow, or a tap anywhere on the playfield. That is the whole control scheme — nothing else does anything.' },
      { q: 'Does it get harder?', a: 'Slightly. The gap opens at 168 units and loses one and a half for every gap you clear, down to a floor of 132. At ten gaps it has shrunk by about nine per cent, which you feel rather than see. The scroll speed never changes.' },
      { q: 'Why does nothing move until I flap?', a: 'The pipes hold still until your first flap, so a run never starts while you are still reading the screen. The score starts with that flap.' },
      { q: 'Can it generate a gap I cannot reach?', a: 'No. Each gap centre is at most 110 units from the last, and a good flap cadence climbs around 270 units in the time between two pipes, so there is always slack.' },
      { q: 'Is my score sent anywhere?', a: 'No. It is written to this browser and stays there. Clearing site data clears it, and there is no leaderboard to compare it against.' },
    ],
    related: ['moon-buggy', 'tux-racer', 'snake'],
  },

  {
    slug: 'platformer',
    touch: 'Tap anywhere on the playfield to jump. The pad gives you left, right, and two jump buttons so either thumb can do it.',
    cat: 'arcade',
    name: 'Platformer',
    glyph: '🏃',
    script: 'arcade/platformer.js',
    width: 480, height: 320, pixel: true, pad: 'runjump',
    bestKey: 'platformer',
    engine: 'Canvas &middot; tile collision',
    title: 'Platformer — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'A platformer with the jump done properly',
    description: 'A small side-scrolling platformer with run acceleration, a variable-height jump, coins, two kinds of enemy and three levels. No ads and no sign-up.',
    short: 'Run, jump, stomp, reach the flag.',
    h1: 'Platformer',
    hero: 'Three levels of running and jumping, in the spirit of the ones everybody grew up on. Tap the button and you hop; hold it ' +
      'and you clear a gap. Everything under your feet is a tile in a grid you could read out loud &mdash; the levels are written ' +
      'in the source as rows of text, one character per tile.',
    facts: ['Three hand-built levels', 'Variable-height jump', 'Coins, walkers and hoppers', 'Your best kept on this device'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'level', label: 'Level', init: '1/3' },
      { key: 'lives', label: 'Lives', init: '3' },
    ],
    keys: [
      { k: '← →', d: 'Run' },
      { k: '↑ or Space', d: 'Jump &mdash; hold it for height' },
      { k: 'Esc', d: 'Pause' },
    ],
    infoHeading: 'Three things that decide whether a platformer feels right',
    info: [
      {
        h: 'One axis at a time',
        p: 'The player is moved along x and pushed out of anything it hit, and only then moved along y and pushed out again. ' +
          'Do both at once and resolve along whichever axis overlaps least, and a runner catches on the seams between floor ' +
          'tiles: gravity has already sunk it a fraction of a unit into the ground, so the shallowest way out of the next tile ' +
          'is sideways rather than upward, and it stops dead in the middle of a floor that is visibly flat.',
      },
      {
        h: 'Standing on the ground is harder to detect than it looks',
        p: 'Landing sets vertical speed to zero, and the next step of gravity lifts you off the floor again by a fraction of a ' +
          'unit, so a check that waits to be caught inside a tile finds you airborne four frames in five while you are plainly ' +
          'running along flat ground &mdash; and those frames get air control instead of friction and grip. This one looks one ' +
          'unit under your feet instead.',
      },
      {
        h: 'The jump forgives two kinds of near miss',
        p: 'Walking off a ledge leaves the jump legal for another 90 ms, and a jump pressed up to 120 ms before you land is held ' +
          'and fired on touchdown. Both cover presses that were real and simply fell in the frames either side of contact. ' +
          'Neither makes a jump longer; they only stop the game from throwing away an input it received.',
      },
    ],
    faq: [
      { q: 'Why does holding the button jump higher?', a: 'Letting go part-way up clips your upward speed rather than ignoring you, so a tap is a short hop and a held press is the full 109 units. Every gap in the three levels can be crossed with a full jump, and a few of the coins need one.' },
      { q: 'How am I supposed to deal with the enemies?', a: 'Land on top of one and it is flattened, worth a hundred points, and you bounce off it. Touch one from the side and you lose a life. Both kinds move a good deal slower than you run, so backing off and coming again is always an option.' },
      { q: 'Do I keep my score when I lose a life?', a: 'Yes. A life costs you the level you are on, not your points. You get three across all three levels, and the run ends when they are gone.' },
      { q: 'Does it work on a phone?', a: 'Yes. Tapping anywhere on the playfield jumps, and the pad gives you left, right and two jump buttons. Tapping is a full jump, since a tap has no length to read.' },
    ],
    related: ['moon-buggy', 'ninvaders', 'breakout'],
  },


  {
    slug: 'snake',
    touch: "Swipe anywhere on the board to turn, or use the pad. Tap to start.",
    cat: 'arcade',
    name: 'Snake',
    glyph: '#',
    script: 'arcade/snake.js',
    width: 320, height: 320, pixel: true, pad: 'dpad',
    engine: 'Canvas &middot; 0 KB to download',
    title: 'Snake — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'Snake, the way it was on the phone',
    description: 'The classic Snake game, free and in your browser. Arrow keys or a thumb pad, three speeds, ' +
      'wrap-around walls if you want them, and no ads or sign-up.',
    short: 'Eat, grow, do not bite yourself.',
    h1: 'Snake',
    hero: 'The one everybody played on a Nokia. Eat, grow, and try very hard not to turn into your own tail &mdash; ' +
      'which stops being a joke somewhere around length forty, when the board is mostly snake and every turn is ' +
      'a decision you have to have made two moves ago.',
    facts: ['Three speeds', 'Optional wrap-around walls', 'Your best kept on this device', 'Plays on a phone'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'length', label: 'Length', init: '3' },
    ],
    controls: [
      '<label class="sr-only" for="game-speed">Speed</label>',
      '<select class="game-select" autocomplete="off" id="game-speed"><option value="8">Slow</option><option value="12" selected>Normal</option><option value="18">Fast</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-wrap" aria-pressed="false" title="Walls kill (click for wrap-around)" aria-label="Toggle wrap-around walls">&#8646;</button>',
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Turn' },
      { k: 'Esc', d: 'Pause' },
      { k: 'Space', d: 'Start, or start again' },
    ],
    infoHeading: 'Two things that make it harder than you remember',
    info: [
      {
        h: 'You cannot reverse',
        p: 'Turning back along your own neck is instant death, so the game ignores it &mdash; but only for the ' +
          'move you are currently committed to. Press left then up faster than one tick and the second press is ' +
          'queued, not dropped, which is why quick double-turns feel right here and feel broken in most copies.',
      },
      {
        h: 'The food never spawns inside you',
        p: 'It is placed by picking from the free cells rather than by guessing a spot and retrying, so a nearly ' +
          'full board still places food instantly instead of hanging while the random number generator hunts ' +
          'for the last gap. At length 200 that difference is the game freezing or not.',
      },
    ],
    faq: [
      { q: 'Can I play with the walls off?', a: 'Yes. The arrows button in the toolbar switches between walls that kill you and edges that wrap around to the other side. It changes the game a lot — wrap-around is easier to survive and much harder to score well on.' },
      { q: 'Does the speed setting change my score?', a: 'No. A point is a point at any speed. The speed only changes how much time you get to think, and your best score is kept as a single number across all three.' },
      { q: 'Where is my high score stored?', a: 'In your own browser, on this device. There is no server and no leaderboard. Clearing your site data clears it.' },
      { q: 'Does it work on a phone?', a: 'Yes. A thumb pad appears automatically on a touchscreen, and swiping on the board works too.' },
    ],
    related: ['tetris', 'breakout', '2048'],
  },

  {
    slug: 'tetris',
    touch: "Pad to move and rotate, Drop to slam the piece down. Tap the board to hard-drop.",
    cat: 'arcade',
    name: 'Tetris',
    /* See pacman: structured data names the fan remake, not the mark. */
    jsonldName: 'Tetris (fan remake)',
    glyph: '⬛',
    script: 'arcade/tetris.js',
    /* 320 wide, not 200: the well is 10 cells of 20 units, and the strip to
       its right holds the next queue and the hold slot. */
    width: 320, height: 400, pixel: false, pad: 'rotate',
    engine: 'Canvas &middot; 7-bag randomiser',
    title: 'Tetris — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'Tetris, with the randomiser done properly',
    description: 'Free online Tetris with a proper 7-bag randomiser, hold, ghost piece and hard drop. No ads, ' +
      'no sign-up, runs entirely in your browser.',
    short: 'Stack the falling pieces, clear the lines.',
    h1: 'Tetris',
    hero: 'Seven shapes, one well, and the growing certainty that the piece you need is not coming. It is coming ' +
      '&mdash; this uses a real 7-bag randomiser, so you can never go more than twelve pieces without a long bar. ' +
      'Knowing that changes how you stack.',
    facts: ['7-bag randomiser', 'Hold, ghost piece and hard drop', 'Wall kicks on rotation', 'Plays on a phone'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'lines', label: 'Lines' },
      { key: 'level', label: 'Level', init: '1' },
    ],
    /* Hold used to be the C key. Every letter binding came out of the shell
       so the typing trainer could exist, so the ones that mattered became
       real buttons — which is where a discoverable control belongs anyway. */
    controls: [
      '<button class="game-btn" type="button" id="game-hold">Hold</button>',
    ],
    keys: [
      { k: '← →', d: 'Move' },
      { k: '↑', d: 'Rotate' },
      { k: '↓', d: 'Soft drop' },
      { k: 'Space', d: 'Hard drop' },
      { k: 'Esc', d: 'Pause' },
    ],
    infoHeading: 'Why this one feels fair',
    info: [
      {
        h: 'A bag, not a dice roll',
        p: 'A naive Tetris picks each piece at random, which means a genuine possibility of never seeing a long ' +
          'bar for thirty pieces. Real Tetris shuffles all seven shapes into a bag and deals them out, then ' +
          'refills. The longest possible drought is twelve pieces, and that guarantee is what makes planning ' +
          'two shapes ahead worth doing.',
      },
      {
        h: 'Rotation that gets out of tight spots',
        p: 'Rotating against a wall or an overhang would normally just fail. This tries a short list of nudges ' +
          'first &mdash; left, right, up &mdash; and takes the first one that fits. It is the difference between ' +
          'a piece that clicks into a gap and one that stubbornly will not.',
      },
    ],
    faq: [
      { q: 'How does scoring work?', a: 'One line is 100 points times the level, two is 300, three is 500, and four at once is 800. Soft dropping adds one point a row and hard dropping adds two, so pushing pieces down quickly is worth a little on its own.' },
      { q: 'What does hold do?', a: 'It parks the current piece and gives you the one you held before, or the next one if the hold is empty. You can only do it once per piece, which is what stops it being an undo button.' },
      { q: 'Does it get faster?', a: 'Yes. Every ten lines raises the level and shortens the drop interval. The top level is reached at a hundred and forty lines, at which point the pieces are falling faster than you can read them.' },
      { q: 'Can I play it on my phone?', a: 'Yes. The pad gives you left, right, rotate, soft drop and a hard-drop button.' },
    ],
    related: ['snake', '2048', 'breakout'],
  },

  {
    slug: 'breakout',
    touch: "Drag your finger across the board to move the bat. Tap to launch.",
    cat: 'arcade',
    name: 'Breakout',
    glyph: '▬',
    script: 'arcade/breakout.js',
    width: 400, height: 300, pixel: false, pad: 'lr',
    engine: 'Canvas &middot; swept collision',
    title: 'Breakout — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'Breakout, without the ball falling through a brick',
    description: 'Free browser Breakout with proper swept collision, so the ball never tunnels through a brick. ' +
      'Mouse, keyboard or touch, no ads, no sign-up.',
    short: 'Bat, ball, and a wall that has to go.',
    h1: 'Breakout',
    hero: 'A bat, a ball and a wall with a grudge. The angle the ball leaves your bat depends on where it hits &mdash; ' +
      'catch it near the edge to send it steep, near the middle to keep it flat &mdash; which is the whole game ' +
      'once you stop chasing it and start aiming it.',
    facts: ['Aim with the bat', 'Mouse, keys or touch', 'Six levels', 'No tunnelling through bricks'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'lives', label: 'Lives', init: '3' },
      { key: 'level', label: 'Level', init: '1' },
    ],
    keys: [
      { k: '← →', d: 'Move the bat' },
      { k: 'Space', d: 'Launch' },
      { k: 'Esc', d: 'Pause' },
    ],
    infoHeading: 'The bug this one does not have',
    info: [
      {
        h: 'A fast ball skipping a brick',
        p: 'The usual way to write this moves the ball, then asks what it is touching. At speed the ball can move ' +
          'further in one step than a brick is thick, so it arrives on the far side having touched nothing and ' +
          'flies straight through the wall. This sweeps the path between the old position and the new one and ' +
          'takes the earliest hit along it, so speed never breaks the collision.',
      },
      {
        h: 'The bat is a mirror, not a wall',
        p: 'Bouncing the ball off the bat by simply flipping its vertical speed would make the game unplayable ' +
          'the moment the ball settled into a flat rally. Where the ball lands on the bat sets the outgoing ' +
          'angle instead, so you always have a way to break the pattern.',
      },
    ],
    faq: [
      { q: 'How do I control the bat?', a: 'Any of three ways: the arrow keys, moving your mouse across the playfield, or the on-screen pad on a touchscreen. The mouse is the most precise.' },
      { q: 'Do the bricks all take one hit?', a: 'Not after the first level. The darker bricks take two hits, and from level four there are bricks that take three. Their colour tells you how much is left in them.' },
      { q: 'Does the ball speed up?', a: 'Yes, slightly, each time you clear a row and again on each new level. It is capped, so it never reaches a speed you cannot react to.' },
      { q: 'What happens when I clear a level?', a: 'The next layout loads and you keep your score and remaining lives. There are six layouts; clearing the sixth wins the run.' },
    ],
    related: ['snake', 'tetris', 'minesweeper'],
  },

  {
    slug: 'air-hockey',
    cat: 'arcade',
    name: 'Air hockey',
    glyph: '⬤',
    script: 'arcade/air-hockey.js',
    width: 420, height: 620, pad: 'none',
    bestKey: null,
    tapAction: false,
    engine: 'Mallet velocity &middot; swept goals',
    title: 'Air Hockey — Play Free Online Against The Computer',
    ogTitle: 'Air hockey where a flick actually flicks',
    description: 'Shufflepuck-style air hockey against the computer. Your mallet carries its speed into the ' +
      'puck — a flick hits far harder than standing still. First to seven.',
    short: 'Flick the puck past them. First to seven.',
    h1: 'Air hockey',
    hero: 'Drag your mallet around your own half. The puck picks up the speed you were moving at, not just the ' +
      'angle you were sitting at &mdash; so a flick sends it away hard and a block merely returns it. First to ' +
      'seven wins.',
    facts: ['Your mallet carries its speed', 'Three difficulties', 'First to seven', 'Mouse or finger'],
    hud: [
      { key: 'you', label: 'You', accent: true, init: '0' },
      { key: 'them', label: 'Them', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-level">Difficulty</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="50">Gentle</option><option value="72" selected>Fair</option><option value="94">Brutal</option></select>',
    ],
    keys: [{ k: 'Move', d: 'Your mallet follows the pointer' }],
    touch: 'Drag your mallet around your own half. Quick flicks hit hardest.',
    infoHeading: 'Why a flick works',
    info: [
      {
        h: 'The mallet has velocity, not just position',
        p: 'Its speed is measured between frames and added to the puck along the contact normal. Reflect alone ' +
          'and the puck can never leave faster than it arrived, which means no shots &mdash; only returns. That ' +
          'one addition is the difference between a game and a rally.',
      },
      {
        h: 'The goal is swept, not sampled',
        p: 'At full speed the puck covers more ground in a frame than the goal mouth is deep, so checking only ' +
          'where it ended up misses the hardest shot of the match. The goal line is tested against the path ' +
          'rather than the position.',
      },
    ],
    faq: [
      { q: 'Can I cross the halfway line?', a: 'No. Your mallet is confined to your own half, which is the one rule air hockey really has.' },
      { q: 'Why did my puck barely move?', a: 'You blocked it rather than hitting it. Standing still returns the puck at the speed it arrived; moving into it adds yours on top.' },
      { q: 'Does the computer cheat?', a: 'No. It moves at a fixed speed toward an aim point and cannot exceed it, so on Brutal it is fast but it is not teleporting.' },
    ],
    related: ['carrom', 'breakout', 'tux-racer'],
  },

  {
    slug: 'tux-racer',
    cat: 'arcade',
    name: 'Downhill',
    glyph: '⛷',
    script: 'arcade/tux-racer.js',
    width: 480, height: 400, pad: 'dpad',
    bestOrder: 'low',
    formatBest: function (n) { return (n / 10).toFixed(1) + 's'; },
    engine: 'A 1,200 m course &middot; one divide per object',
    title: 'Downhill Racer — Free Browser Sledding Game, No Sign-Up',
    ogTitle: 'Downhill, in the spirit of Tux Racer',
    description: 'A downhill run in the spirit of Extreme Tux Racer. Steer between the trees, collect the fish, ' +
      'tuck for speed you cannot quite steer out of.',
    short: 'Steer, tuck, collect fish, miss trees.',
    h1: 'Downhill',
    hero: 'Point yourself down the mountain and try to keep it there. Tucking makes you faster and much harder to ' +
      'turn, which is the entire negotiation of a downhill run &mdash; and the fish are worth going out of your ' +
      'way for right up until they are not.',
    facts: ['A 1,200 metre course with a finish', 'Tuck for speed, lose the steering', 'Fish are points, trees are not', 'A crash costs momentum, not the run'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'speed', label: 'km/h', init: '0' },
      { key: 'togo', label: 'To go', init: '1200' },
      { key: 'fish', label: 'Fish', init: '0' },
      { key: 'time', label: 'Time', init: '0.0' },
    ],
    keys: [
      { k: '← →', d: 'Steer' },
      { k: '↓', d: 'Tuck' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'Pad left and right to steer, down to tuck. Tucking is faster and much harder to turn.',
    infoHeading: 'How the mountain is drawn',
    info: [
      {
        h: 'One divide per object',
        p: 'There is no 3D here. Every tree, rock and fish is placed by dividing its sideways offset by its ' +
          'distance and scaling &mdash; the same trick every road racer used before anyone had a graphics card. ' +
          'The stripes on the snow take their phase from how far you have travelled, which is why speed is ' +
          'legible before you read the number.',
      },
      {
        h: 'Tucking is a real trade',
        p: 'Holding down cuts your drag, so you keep accelerating &mdash; and it also cuts your steering ' +
          'authority by about half. Going fast is easy; going fast where the trees are not is the game.',
      },
    ],
    faq: [
      { q: 'What happens when I hit a tree?', a: 'You lose most of your speed and the screen flashes, but the run carries on. A downhill you can lose four seconds in is not one anybody plays twice.' },
      { q: 'How do I win?', a: 'Get to the finish. The course is 1,200 metres and the banner appears across the piste as you approach it. Your score is the TIME, so a faster run is a better one — and your best is a lap record rather than a high score.' },
      { q: 'Why can I barely steer sometimes?', a: 'You are tucked. Let go of down and the steering comes back immediately.' },
    ],
    related: ['air-hockey', 'moon-buggy', 'snake'],
  },

  /* ---------------------------------------------------------------- puzzle */
  {
    slug: 'memory',
    cat: 'puzzle',
    name: 'Memory',
    glyph: '&#10070;',
    board: true,
    script: 'puzzle/memory.js',
    pad: 'none',
    bestKey: 'memory',
    engine: 'DOM grid &middot; pairs are shapes, not colours',
    title: 'Memory — The Card Matching Game, Free Online',
    ogTitle: 'Memory, where the pairs are shapes and not colours',
    description: 'Turn over two cards and keep them if they match. Three board sizes, scored on moves and ' +
      'time, and pairs you can tell apart if you are colour-blind.',
    short: 'Flip two cards, keep the pairs.',
    h1: 'Memory',
    hero: 'The card game everyone played on paper first, with a clock that starts when you turn the first ' +
      'card rather than when you press Play. Three sizes, from six pairs to fifteen. The pairs are shapes ' +
      'rather than colours, so it plays the same whether or not you can tell amber from green.',
    facts: ['Six to fifteen pairs', 'Shape first, colour second', 'Scored on moves and time', 'A best per size'],
    hud: [
      { key: 'pairs', label: 'Pairs', init: '0/8' },
      { key: 'moves', label: 'Moves' },
      { key: 'time', label: 'Time', init: '0:00' },
      { key: 'best', label: 'Best', accent: true },
    ],
    controls: [
      '<label class="sr-only" for="game-size">Board size</label>',
      '<select class="game-select" autocomplete="off" id="game-size"><option value="small">Small 4&times;3</option><option value="medium" selected>Medium 4&times;4</option><option value="large">Large 6&times;5</option></select>',
      '<button class="game-btn" type="button" id="game-new">New board</button>',
    ],
    keys: [
      { k: 'Click', d: 'Turn a card over' },
      { k: 'Tab', d: 'Step to the next card' },
      { k: 'Arrows', d: 'Move across the grid' },
      { k: 'Enter', d: 'Turn over the focused card' },
    ],
    touch: 'Tap a card to turn it over. A matched pair stays up; a miss turns back after about a second, or straight away if you tap a third card.',
    infoHeading: 'Why the pairs are shapes',
    info: [
      {
        h: 'Colour is reinforcement, never the answer',
        p: 'Around one man in twelve has some form of red-green colour blindness, and there is no set of ' +
          'fifteen colours that all of them can tell apart. So a pair here is two cards with the same ' +
          'silhouette &mdash; a crescent and a crescent &mdash; and the colour is only there to make ' +
          'scanning quicker for the people who can use it.',
      },
      {
        h: 'Small boards never repeat a colour; the big one does',
        p: 'Each shape owns one of eight colours. On the six and eight-pair boards the deal takes one shape ' +
          'per colour, so every card on the table is a different colour as well as a different shape. The ' +
          'fifteen-pair board uses every shape and therefore reuses seven colours &mdash; deliberately, ' +
          'because if colour were ever sufficient you would stop reading the shape. The shapes that share a ' +
          'colour are picked to look nothing alike.',
      },
      {
        h: 'The score adds moves and time together',
        p: 'One point per move, one point per five seconds. The exchange rate is arbitrary and there is no ' +
          'defending the exact number; it exists so that being careless and being slow cost something on ' +
          'the same scale, instead of being two records nobody can compare. Lower is better, and the ' +
          'lowest possible move count is one per pair.',
      },
      {
        h: 'A mismatch turns back on the game clock',
        p: 'The 0.9 seconds a wrong pair stays visible is counted by the same clock the game runs on, which ' +
          'stops when you switch tabs. Cards cannot flip themselves back while you are not looking. Turn ' +
          'over a third card and the pair closes immediately rather than making you wait it out.',
      },
    ],
    faq: [
      { q: 'How do I know which cards make a pair?', a: 'By shape. Two cards match when they carry the same symbol &mdash; two stars, two hexagons. Colour follows the shape around and is there to help you scan, but it is never what decides a match.' },
      { q: 'Why do two different shapes sometimes share a colour?', a: 'Only on the 6&times;5 board, which has fifteen pairs and eight colours. There is no honest way to make fifteen colours distinguishable to everyone, so the shapes carry the identity and the colours are allowed to repeat.' },
      { q: 'How is the score worked out?', a: 'Your moves, plus one point for every five seconds. Lower is better. A perfect 4&times;4 run is eight moves, so eight points plus whatever the clock added.' },
      { q: 'Are best scores kept for each size?', a: 'Yes. Each of the three boards keeps its own record, in this browser only. Clearing site data clears them, and nothing is ever sent anywhere.' },
      { q: 'Can I play it with a keyboard?', a: 'Yes. Every card is a real button: Tab or the arrow keys move between them and Enter or Space turns one over. Matched cards drop out of the tab order so you are not stepping through dead ones.' },
    ],
    related: ['memory-span', 'minesweeper', '2048'],
  },

  {
    slug: 'snakes-ladders',
    /* A board game, not a puzzle — its own hero says "not one decision to
       make", and it sits with chess, ludo and carrom on the shelf. */
    cat: 'board',
    name: 'Snakes and Ladders',
    glyph: '🐍',
    script: 'puzzle/snakes-ladders.js',
    /* Seats up to four, and one of them can be the computer. */
    players: 4,
    soloAI: true,
    width: 560, height: 620, pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Fixed classic layout &middot; nine ladders, ten snakes',
    title: 'Snakes and Ladders — Play Free In Your Browser, No Sign-Up',
    ogTitle: 'Snakes and Ladders, one square at a time',
    description: 'Snakes and ladders on the classic ten-by-ten board, for two to four players. Exact roll to ' +
      'finish, a six rolls again, and the token walks every square.',
    short: 'The classic board, walked square by square.',
    h1: 'Snakes and Ladders',
    hero: 'Nine ladders, ten snakes and not one decision to make. Roll the die, watch your token walk up the ' +
      'board a square at a time, and find out whether the ladder on 80 or the snake on 98 finds you first. Play ' +
      'the computer on your own, or hand the device round for two to four people.',
    facts: [
      'The classic ten-by-ten board',
      'Two to four players',
      'Exact roll to finish',
      'Nothing is uploaded',
    ],
    hud: [
      { key: 'turn', label: 'Turn', accent: true, init: 'Red' },
      { key: 'dice', label: 'Die', init: '—' },
      { key: 'square', label: 'Square', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Pass &amp; play</option></select>',
      '<label class="sr-only" for="game-players">Players</label>',
      '<select class="game-select" autocomplete="off" id="game-players"><option value="2" selected>2 players</option><option value="3">3 players</option><option value="4">4 players</option></select>',
      '<button class="game-btn game-btn-primary" type="button" id="game-roll">Roll</button>',
    ],
    keys: [
      { k: 'Space', d: 'Roll the die' },
      { k: 'Enter', d: 'Roll the die' },
    ],
    touch: 'Tap Roll and watch &mdash; there is nothing else to press, because there is nothing else to decide.',
    infoHeading: 'The board, the rules and the one honest admission',
    info: [
      {
        h: 'Boustrophedon, which is a real word for a real layout',
        p: 'The numbers do not run left to right on every row. The bottom row runs left to right, the next runs ' +
          'right to left, and they alternate all the way up &mdash; the way an ox turns at the end of a furrow, ' +
          'which is what the Greek word means. It is also why the board needs no table of coordinates: the row ' +
          'is (n minus 1) divided by ten, the column is the remainder, and odd rows mirror the column.',
      },
      {
        h: 'You need the exact roll to finish',
        p: 'On 97 a roll of four does nothing at all. The move is not legal, so the token stays where it is and ' +
          'the turn passes &mdash; the board tells you the number you are still waiting for. Some sets play the ' +
          'bounce instead, where you go up to 100 and back down the difference. Both are common; this one uses ' +
          'the first.',
      },
      {
        h: 'The token walks, it never teleports',
        p: 'Every move is animated square by square, and the turn does not pass until the token has landed. It ' +
          'costs about a second a move, and it is the entire reason to play: climbing 28 to 84 and then sliding ' +
          'off 87 all the way back to 24 is the only thing that actually happens in this game.',
      },
      {
        h: 'There is nothing to decide, and that is the point',
        p: 'You never choose anything. The die decides everything from the first roll to the last, which is why ' +
          'the computer opponent here is a timer that presses Roll rather than an engine &mdash; there is no ' +
          'move to be better at. The Indian ancestor of the game, Gyan Chaupar or Moksha Patam, made that its ' +
          'subject: ladders stood for virtues, snakes for vices, and where you ended up was not meant to be up ' +
          'to you.',
      },
    ],
    faq: [
      { q: 'Is there any skill in snakes and ladders?', a: 'None. Every outcome is decided by the dice, and no choice you make changes anything, because there is no choice to make. That is not a shortcoming of this version — it is the game.' },
      { q: 'Do I need a six to start?', a: 'Not here. You enter the board on your first roll, whatever it is. Requiring a six is a common house rule and it mostly adds waiting.' },
      { q: 'What happens if I roll more than I need at the end?', a: 'You stay where you are and the turn passes, because an over-roll is not a legal move. The board shows the number you still need.' },
      { q: 'Does a six do anything?', a: 'It earns you another roll, even when the six itself could not be used. There is no three-sixes forfeit here, though plenty of households play one.' },
      { q: 'Is the board different every game?', a: 'No. It is the same fixed layout every time — nine ladders and ten snakes in the positions most printed boards use — so a square you have learned stays learned.' },
      { q: 'Can two of us play on one device?', a: 'Yes. Choose pass and play, and set two, three or four players. There is no online play: that would need a server to hold the game, and this site has none.' },
    ],
    related: ['ludo', 'connect-four', '2048'],
  },

  {
    slug: 'word-of-the-day',
    cat: 'puzzle',
    name: 'Word of the day',
    glyph: '▤',
    board: true,
    script: 'puzzle/word-of-the-day.js',
    pad: 'none',
    bestKey: null,
    tapAction: false,
    engine: 'DOM grid &middot; word index from the local date',
    title: 'Word of the Day — Free Five-Letter Word Puzzle, No Sign-Up',
    ogTitle: 'Five letters, six guesses, and a dictionary of shop talk',
    description: 'A five-letter word puzzle built from developer and security vocabulary. One word a day, ' +
      'six guesses, and an unlimited practice mode. No ads, no sign-up.',
    short: 'Five letters of developer shop talk.',
    h1: 'Word of the day',
    hero: 'The five-letter guessing game, with a dictionary that only holds words you would meet in a code ' +
      'review or an incident report &mdash; NONCE, PROXY, MUTEX, SHARD. One word a day, the same one for ' +
      'everybody, and it turns over at your midnight rather than at some server’s. When you have had ' +
      'today’s, practice mode will deal you as many more as you like.',
    facts: ['232 words, all shop talk', 'Six guesses, one word a day', 'Turns over at your local midnight', 'Practice mode is unlimited'],
    hud: [
      { key: 'mode', label: 'Mode', init: 'Daily' },
      { key: 'guess', label: 'Guess', init: '1/6' },
      { key: 'streak', label: 'Streak', accent: true, init: '0' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-daily">Today&rsquo;s word</button>',
      '<button class="game-btn" type="button" id="game-practice">Practice word</button>',
    ],
    keys: [
      { k: 'A&ndash;Z', d: 'Type a letter' },
      { k: 'Enter', d: 'Submit the guess' },
      { k: 'Backspace', d: 'Delete a letter' },
      { k: 'Click', d: 'The on-screen keyboard does the same' },
    ],
    touch: 'The on-screen keyboard is the whole interface on a phone &mdash; tap the letters, then Enter. The system keyboard is never raised over the board.',
    infoHeading: 'Four things worth knowing',
    info: [
      {
        h: 'The word turns over at your midnight, not at midnight in London',
        p: 'The obvious way to pick a daily word is to divide the current timestamp by the length of a day, ' +
          'but that rolls over at UTC midnight &mdash; half past five in the morning in India, the previous ' +
          'afternoon in California. So the year, month and date are read in local time and turned into a day ' +
          'number from those three integers alone, which also means a daylight-saving change cannot shift it. ' +
          'Two people in different timezones get the same word on the same calendar date, rather than at the ' +
          'same instant, which is what a word of the day means to a person.',
      },
      {
        h: 'The answer list and the guess list are the same 232 words',
        p: 'Most games of this shape accept a huge dictionary of guesses and draw answers from a small one. ' +
          'Here there is one list, so a rejected guess is real information: whatever you typed was never going ' +
          'to be the answer. The cost is honest and worth stating &mdash; perfectly good English like MOUSE or ' +
          'CRANE is refused, because this list is vocabulary from development and security rather than the ' +
          'language at large.',
      },
      {
        h: 'Repeated letters are the part that trips people up',
        p: 'A letter is only marked amber as many times as it is still unaccounted for in the answer. Guess ' +
          'ERROR against ROUTE and you get one amber R and two grey ones, not three ambers, because ROUTE has ' +
          'exactly one R and the first unmatched position claims it. The keyboard follows the same rule and ' +
          'only ever improves: once a letter has gone green it never drops back to amber.',
      },
      {
        h: 'The streak is a number in your browser and nothing else',
        p: 'It lives in localStorage on this device, alongside the guesses you have made today so that ' +
          'reloading or switching tabs does not cost you the puzzle. There is no account, no server and no ' +
          'leaderboard to compare it against. Clearing site data clears it, and practice words never touch it.',
      },
    ],
    faq: [
      { q: 'Is this Wordle?', a: 'It is the same rules, which are not anybody’s to own, with a different dictionary and no connection to the New York Times. The word list here is development and security vocabulary rather than general English.' },
      { q: 'Does everybody get the same word?', a: 'Yes, on the same calendar date. It is picked from your local year, month and day, so somebody in Sydney gets it before somebody in London does &mdash; but they get the same word, on the date they both call today.' },
      { q: 'Why was my guess rejected?', a: 'Only the 232 words on the list are accepted, and they are the same 232 the answer is drawn from. If it was refused it could not have been the answer, which is worth knowing.' },
      { q: 'Can I play more than once a day?', a: 'Yes. The practice button deals a random word from the same list, as often as you like. Practice rounds do not count towards the streak, which is the point of keeping them separate.' },
      { q: 'What happens if I close the tab halfway through?', a: 'The guesses you have already submitted are saved on this device and come back when you return, as long as it is still the same day where you are.' },
      { q: 'I am colour-blind. Can I tell the tiles apart?', a: 'Amber tiles carry a diagonal stripe as well as the colour, and every tile is announced with its state &mdash; "T, wrong place" &mdash; so a screen reader gives the full result without any colour at all.' },
    ],
    related: ['sudoku', 'minesweeper', 'typing-trainer'],
  },


  {
    slug: '2048',
    touch: "Swipe the board in any direction, or use the pad.",
    cat: 'puzzle',
    name: '2048',
    glyph: '2⁴',
    script: 'puzzle/2048.js',
    board: true, pad: 'dpad',
    engine: 'DOM tiles &middot; saves your board',
    title: '2048 — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: '2048, and it remembers where you were',
    description: 'The 2048 sliding tile puzzle, free in your browser. Arrow keys or swipe, one undo, and your ' +
      'board is saved so you can come back to it. No ads, no sign-up.',
    short: 'Slide, merge, and get to 2048.',
    h1: '2048',
    hero: 'Slide everything one way, matching numbers merge, a new tile appears. That is the whole rule set, and ' +
      'it is enough to keep people up past midnight. The board saves itself, so the run you abandon at 1024 is ' +
      'still there tomorrow.',
    facts: ['Arrow keys or swipe', 'One undo', 'Your board is saved', 'Keep playing past 2048'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'moves', label: 'Moves' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-undo" disabled>Undo</button>',
      '<button class="game-btn" type="button" id="game-new">New board</button>',
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Slide' },
      { k: 'Swipe', d: 'Slide, on a touchscreen' },
    ],
    infoHeading: 'Two details most copies get wrong',
    info: [
      {
        h: 'A tile only merges once per move',
        p: 'Slide four 2s left and you get two 4s, never a single 8. Getting this wrong makes the game far too ' +
          'easy and is the commonest bug in a hand-rolled 2048. Each row is collapsed with a flag per tile ' +
          'marking it as already-merged for that move.',
      },
      {
        h: 'A new tile only appears if something moved',
        p: 'Pressing left against a wall where nothing can shift must be a no-op, not a free spawn. Otherwise you ' +
          'can fill the board by pressing a direction that does nothing, which is a way to lose that has nothing ' +
          'to do with the puzzle.',
      },
    ],
    faq: [
      { q: 'Is my board saved?', a: 'Yes, after every move, in your own browser storage. Close the tab and come back and the board, the score and the move count are where you left them.' },
      { q: 'How much can I undo?', a: 'One move. Enough to take back a misfire, not enough to play the board backwards.' },
      { q: 'Can I keep going after reaching 2048?', a: 'Yes. Reaching 2048 is announced but the run carries on, so 4096 and 8192 are both on the table if the board holds together.' },
      { q: 'Does it work on a phone?', a: 'Yes — swipe in any direction on the board, or use the pad.' },
    ],
    related: ['minesweeper', 'tetris', 'snake'],
  },

  {
    slug: 'minesweeper',
    touch: "Tap a cell to open it. Long-press to flag, or turn on flag mode and tap. Tap a revealed number to chord.",
    cat: 'puzzle',
    name: 'Minesweeper',
    glyph: '⚑',
    script: 'puzzle/minesweeper.js',
    board: true, pad: 'none',
    engine: 'DOM grid &middot; never a first-click loss',
    title: 'Minesweeper — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'Minesweeper, where the first click is always safe',
    description: 'Classic Minesweeper in your browser — beginner, intermediate and expert, a guaranteed safe ' +
      'first click, and chording. No ads, no sign-up, nothing uploaded.',
    short: 'Numbers, flags, and no first-click deaths.',
    h1: 'Minesweeper',
    hero: 'The one that shipped with Windows and quietly taught a generation to reason under uncertainty. Three ' +
      'sizes, a timer, and one rule the original got wrong for years: your first click can never be a mine, ' +
      'because losing before you have any information is not a puzzle.',
    facts: ['Safe first click, always', 'Beginner to expert', 'Chording on a revealed number', 'Best time per size'],
    hud: [
      { key: 'mines', label: 'Mines', init: '10' },
      { key: 'time', label: 'Time', init: '0' },
      { key: 'best', label: 'Best', accent: true },
    ],
    controls: [
      '<label class="sr-only" for="game-level">Difficulty</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="beginner" selected>Beginner 9&times;9</option><option value="intermediate">Intermediate 16&times;16</option><option value="expert">Expert 30&times;16</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-flag" aria-pressed="false" title="Flag mode (or long-press a cell)" aria-label="Toggle flag mode">&#9873;</button>',
      '<button class="game-btn" type="button" id="game-new">New board</button>',
    ],
    keys: [
      { k: 'Click', d: 'Reveal' },
      { k: 'Right-click', d: 'Flag' },
      { k: 'Both', d: 'Chord a revealed number' },
      { k: 'Long-press', d: 'Flag, on a touchscreen' },
    ],
    /* Three records, one per difficulty, so the shell's single best slot is
       not used and minesweeper.js owns them instead. */
    bestKey: null,
    infoHeading: 'Two rules worth knowing',
    info: [
      {
        h: 'The mines are placed after your first click',
        p: 'The board is empty until you open it. Only then are the mines scattered, avoiding the cell you ' +
          'clicked and its eight neighbours &mdash; so the first click always opens a region rather than ending ' +
          'the game. This is how every modern implementation does it, and it costs nothing.',
      },
      {
        h: 'Chording is the whole skill',
        p: 'Click a revealed number that already has exactly that many flags around it and every remaining ' +
          'neighbour opens at once. It is how good players clear a board in a fraction of the clicks &mdash; and ' +
          'it will happily blow you up if one of those flags is wrong.',
      },
    ],
    faq: [
      { q: 'Can I lose on the first click?', a: 'No. The mines are laid out after you click, avoiding that cell and everything touching it, so your opening move always reveals an area.' },
      { q: 'How do I flag on a phone?', a: 'Long-press a cell, or switch on flag mode with the flag button in the toolbar and tap normally.' },
      { q: 'What is chording?', a: 'Clicking a number that already has the right count of flags next to it opens all its unflagged neighbours in one go. On a mouse it is both buttons together; on a touchscreen, tap an already-revealed number.' },
      { q: 'Are best times kept per difficulty?', a: 'Yes. Beginner, intermediate and expert each keep their own best time on this device.' },
    ],
    related: ['2048', 'breakout', 'snake'],
  },

  {
    slug: 'connect-four',
    cat: 'puzzle',
    name: 'Connect Four',
    glyph: '●',
    script: 'puzzle/connect-four.js',
    players: 2,
    soloAI: true,
    width: 518, height: 498, pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Minimax with alpha-beta &middot; six ply',
    title: 'Connect Four — Play The Computer Free, No Sign-Up',
    ogTitle: 'Connect Four that never misses a block',
    description: 'Connect Four against a six-ply minimax opponent, or pass and play. It always takes a win it ' +
      'can see and always blocks yours, straight out of the search.',
    short: 'Four in a row, against a real search.',
    h1: 'Connect Four',
    hero: 'Drop a disc, get four in a row. The opponent searches six moves ahead with alpha-beta pruning, which ' +
      'means it will never miss a win and never miss a block &mdash; not because those are coded as rules, but ' +
      'because a search that deep finds them anyway.',
    facts: ['Six-ply search', 'Against the computer or pass and play', 'Three strengths', 'Nothing is uploaded'],
    hud: [
      { key: 'you', label: 'You', accent: true, init: '0' },
      { key: 'them', label: 'Them', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Pass &amp; play</option></select>',
      '<label class="sr-only" for="game-level">Strength</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="3">Casual</option><option value="6" selected>Sharp</option><option value="8">Strong</option></select>',
    ],
    keys: [{ k: 'Click', d: 'Drop a disc in that column' }],
    touch: 'Tap a column to drop your disc into it.',
    infoHeading: 'What makes it play sensibly',
    info: [
      {
        h: 'A window with both colours is worth nothing',
        p: 'The evaluation looks at every run of four cells on the board. If a run already contains one of each ' +
          'colour, nobody can ever complete it, so it scores zero. Scoring it anyway &mdash; which is the ' +
          'obvious first implementation &mdash; sends the engine chasing lines that are already dead.',
      },
      {
        h: 'The centre column really is worth more',
        p: 'A disc in the middle takes part in far more possible fours than one on the edge. The bonus for it ' +
          'is not a heuristic somebody invented, it is just counting &mdash; and it is why good players open in ' +
          'the centre.',
      },
      {
        h: 'Move ordering does the pruning',
        p: 'Columns are searched centre-outward, because alpha-beta prunes hardest when the best move is tried ' +
          'first. Same search, same answer, a fraction of the work &mdash; which is what lets it go eight ply ' +
          'deep on Strong without you noticing a pause.',
      },
    ],
    faq: [
      { q: 'Is Connect Four solved?', a: 'Yes — with perfect play the first player wins, and it has been proven since 1988. This opponent is not perfect at six ply, so you can beat it; it is perfect at spotting immediate wins and blocks.' },
      { q: 'Why does it always go in the middle first?', a: 'Because the centre column is genuinely the strongest opening square, for the reason above. It is not being predictable, it is being right.' },
      { q: 'Can two of us play?', a: 'Yes — pass and play on one device.' },
    ],
    related: ['chess', 'ludo', '2048'],
  },

  {
    slug: 'sudoku',
    cat: 'puzzle',
    name: 'Sudoku',
    glyph: '9',
    script: 'puzzle/sudoku.js',
    width: 522, height: 522, pad: 'none',
    bestKey: 'sudoku', bestOrder: 'low',
    tapAction: false,
    engine: 'Generated &middot; exactly one solution, checked',
    title: 'Sudoku — Free Online, Generated With One Solution',
    ogTitle: 'Sudoku that is provably not ambiguous',
    description: 'Sudoku generated fresh every time, the solution count checked after every clue removed — ' +
      'every puzzle has exactly one answer. Four difficulties, pencil marks.',
    short: 'Generated fresh, one answer guaranteed.',
    h1: 'Sudoku',
    hero: 'Every puzzle here is generated when you press play, and every clue removed is checked to make sure the ' +
      'grid still has exactly one answer. That check is the difference between a real sudoku and a grid that ' +
      'tells you your correct solution is wrong.',
    facts: ['Exactly one solution, verified', 'Four difficulties', 'Pencil marks', 'Your best time per device'],
    hud: [
      { key: 'time', label: 'Time', accent: true, init: '0:00' },
      { key: 'mistakes', label: 'Wrong', init: '0' },
      { key: 'best', label: 'Best' },
    ],
    controls: [
      '<label class="sr-only" for="game-level">Difficulty</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option><option value="expert">Expert</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-notes" aria-pressed="false" title="Pencil marks" aria-label="Toggle pencil marks">✎</button>',
      '<button class="game-btn" type="button" id="game-check">Check</button>',
    ],
    extra: '<div class="sudoku-pad"><button type="button" data-num="1">1</button><button type="button" data-num="2">2</button><button type="button" data-num="3">3</button><button type="button" data-num="4">4</button><button type="button" data-num="5">5</button><button type="button" data-num="6">6</button><button type="button" data-num="7">7</button><button type="button" data-num="8">8</button><button type="button" data-num="9">9</button><button type="button" data-num="0" class="sudoku-erase">Erase</button></div>',
    keys: [
      { k: '1–9', d: 'Enter a number' },
      { k: '↑ ↓ ← →', d: 'Move the selection' },
      { k: 'Backspace', d: 'Clear the cell' },
    ],
    touch: 'Tap a cell, then a number on the pad below. The pencil button switches to notes.',
    infoHeading: 'Why the generator is slow on purpose',
    info: [
      {
        h: 'Every removal is verified',
        p: 'Clues are taken out one at a time, and after each one the grid is solved again to count how many ' +
          'answers it now has. If the count is not exactly one, the clue goes straight back. Skipping that step ' +
          'is how you get a puzzle with two valid solutions, which feels broken in a way players cannot ' +
          'articulate: they fill it in correctly and are told they are wrong.',
      },
      {
        h: 'The counter stops at two',
        p: '"More than one" is the only thing the generator needs to know, and counting every solution of a ' +
          'sparse grid is orders of magnitude slower. Stopping at two makes generation take tens of ' +
          'milliseconds rather than seconds.',
      },
    ],
    faq: [
      { q: 'Are the puzzles always solvable by logic?', a: 'They always have exactly one answer, which is the guarantee that matters. On Expert some positions may need a fairly advanced technique, but no puzzle here requires guessing between two valid grids, because no puzzle here has two.' },
      { q: 'What are pencil marks?', a: 'Small candidate numbers you jot into an empty cell. Press the pencil button, then tap numbers — they toggle rather than replace.' },
      { q: 'Does Check tell me the answers?', a: 'No. It highlights entries that are wrong, in red, for a couple of seconds. It will not fill anything in.' },
      { q: 'Is my progress saved?', a: 'No — each run generates a fresh puzzle. Your best completion time per device is kept.' },
    ],
    related: ['minesweeper', '2048', 'connect-four'],
  },

  /* -------------------------------------------------------------- terminal */
  {
    slug: 'arithmetic',
    touch: 'Tap the panel to bring up the number pad, then type the answer and press enter.',
    wide: true,
    cols: 60,
    cat: 'terminal',
    name: 'Arithmetic',
    glyph: '×',
    term: true,
    script: 'terminal/arithmetic.js',
    pad: 'none',
    bestKey: 'arithmetic',
    engine: 'Character grid &middot; adapts to your mistakes',
    title: 'Arithmetic — The BSD Drill, Ninety Seconds Of Mental Sums',
    ogTitle: 'Arithmetic: the numbers you miss come back',
    description: 'Ninety seconds of mental sums, from the BSD games drill. Four operations to pick from, and ' +
      'the numbers you get wrong keep coming back until you can do them.',
    short: 'Ninety seconds of sums that adapt.',
    h1: 'Arithmetic',
    hero: 'The drill that shipped with BSD, with a ninety-second clock on it. Add, subtract, multiply and ' +
      'divide &mdash; pick which of those you want &mdash; and answer as many as you can. The interesting part ' +
      'is what happens when you get one wrong: both numbers go back into the bag, so the sums that beat you are ' +
      'the ones you see most.',
    facts: ['Ninety seconds', 'Four operations, selectable', 'Wrong numbers come back', 'Six levels, it picks one'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'right', label: 'Right' },
      { key: 'wrong', label: 'Wrong' },
      { key: 'avg', label: 'Avg', init: '—' },
    ],
    controls: [
      '<label class="sr-only" for="game-ops">Operations</label>',
      '<select class="game-select" autocomplete="off" id="game-ops"><option value="+">Addition</option><option value="+-">Add &amp; subtract</option><option value="+-*">Add, subtract, multiply</option><option value="+-*/" selected>All four</option></select>',
    ],
    keys: [
      { k: '0-9', d: 'Type the answer' },
      { k: 'Enter', d: 'Submit it' },
      { k: 'Backspace', d: 'Fix a digit' },
      { k: 'Esc', d: 'End the run early' },
    ],
    infoHeading: 'How it decides what to ask you',
    info: [
      {
        h: 'The numbers you miss go back in the bag',
        p: 'Get a sum wrong and both of its operands are pushed onto a small pool that later questions draw ' +
          'from, roughly two times in five. That is the original\'s adaptation and it is the only part of the ' +
          'game that teaches anything &mdash; if you cannot do seven eights, you will be asked about sevens ' +
          'and eights until you can.',
      },
      {
        h: 'The level moves on speed, not just accuracy',
        p: 'Three right in a row, each answered inside eight seconds, raises the ceiling on how big the numbers ' +
          'get; two wrong in a row lowers it. Correct but slow holds it where it is, which is deliberate ' +
          '&mdash; getting there eventually is not the same as knowing it.',
      },
      {
        h: 'Every division comes out whole',
        p: 'The divisor and the answer are drawn first and multiplied to get the dividend, so there is never a ' +
          'remainder to argue about. Drawing two numbers at random and asking for one over the other is the ' +
          'usual shortcut, and it either needs a rounding rule or throws most of what it generates away.',
      },
    ],
    faq: [
      { q: 'Can I turn off division?', a: 'Yes. The dropdown picks addition only, addition and subtraction, those plus multiplication, or all four. It takes effect on the next question rather than the next run.' },
      { q: 'Are the answers ever negative?', a: 'No. Subtraction swaps the operands if it needs to, so the answer is always zero or more and you only ever type digits.' },
      { q: 'What is the score made of?', a: 'Each sum is worth its level plus a weight for the operation &mdash; one for addition, four for division. So a hard division late in a good run is worth about ten times an easy addition at the start.' },
      { q: 'Does it work on a phone?', a: 'Yes. Tapping the panel opens a numeric keypad rather than a full keyboard, which is the only thing this game needs.' },
    ],
    related: ['subnet-sprint', 'typespeed', 'reaction-time'],
  },

  {
    slug: 'hangman',
    cat: 'terminal',
    name: 'Hangman',
    glyph: '_',
    term: true,
    script: 'terminal/hangman.js',
    pad: 'dpad',
    bestKey: 'hangman',
    tapAction: false,
    engine: 'Character grid &middot; a sixty-word deck',
    title: 'Hangman &mdash; Sixty Security Words, Six Wrong Guesses',
    ogTitle: 'Hangman, with a vocabulary worth learning',
    description: 'Hangman played against sixty security and computing words. Six wrong guesses a word, and a ' +
      'one-line definition every time you solve one.',
    short: 'Guess the word before the gallows fills.',
    h1: 'Hangman',
    hero: 'The same six wrong guesses everybody grew up with, but the words are the ones worth knowing: sixty ' +
      'terms from security and computing, from salt and nonce to traversal and idempotent. Solve one and you ' +
      'get its definition, which is the point &mdash; a word you had to work out and then read the meaning of ' +
      'is a word you keep.',
    facts: ['Sixty words with definitions', 'Six wrong guesses each word', 'A definition on every solve', 'Type it, or use the grid'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'misses', label: 'Misses', init: '0/6' },
      { key: 'solved', label: 'Solved', init: '0' },
    ],
    keys: [
      { k: 'A-Z', d: 'Guess that letter' },
      { k: '↑ ↓ ← →', d: 'Move around the A-Z grid' },
      { k: 'Space', d: 'Guess the highlighted letter' },
    ],
    touch: "Pad moves the highlight around the A-Z grid and Action guesses it. A tap on the screen does nothing, so a stray thumb cannot cost you a guess.",
    infoHeading: 'How a guessing game works on a shell that binds no letters',
    info: [
      {
        h: 'Two ways in, one function',
        p: 'The shell binds the arrows, Space and Escape, and deliberately binds no letter at all &mdash; that ' +
          'is what lets the typing games exist on the same code. A guessing game obviously wants A to mean A, ' +
          'so this one draws an A-Z grid into the character buffer for the arrows and adds its own keydown ' +
          'listener for a real keyboard. Both routes call the same guess function, so there is exactly one ' +
          'place a letter is scored.',
      },
      {
        h: 'The misses reset, the run does not',
        p: 'Six wrong guesses is per word, so the gallows always means the same thing. What carries across ' +
          'words is the score and the count of words solved, and losing a single word ends the run. Pooling ' +
          'six misses over a whole run instead would make the drawing meaningless after the first word.',
      },
      {
        h: 'A shuffled deck, not a random pick',
        p: 'Words come off a deck that is shuffled once and then dealt through to the end. A random pick hands ' +
          'you the same word twice in five minutes often enough to be noticed, and being asked to guess nonce ' +
          'again straight away is the fastest way to make a word game feel broken.',
      },
    ],
    faq: [
      { q: 'Where do the words come from?', a: 'A hand-written list of sixty terms from security and computing, each with a one-line definition. The definitions are why the list is not pulled from a dictionary: you see one every time you solve a word.' },
      { q: 'Can I just type?', a: 'Yes. Click the board once so it has focus and then type letters normally. The on-screen grid is there because a touchscreen has no other way in, not as a fallback.' },
      { q: 'Do the misses carry over to the next word?', a: 'No. Each word starts with a fresh gallows. The run ends the first time a word beats you.' },
      { q: 'How is the score worked out?', a: 'Five points per letter in the word plus ten for every guess you had left, so a long word solved cleanly is worth a great deal more than a short one scraped through.' },
      { q: 'Is there a hint?', a: 'Only the two you would get on paper: how many letters the word has, and the list of letters you have already missed. Nothing else is revealed until you solve it.' },
    ],
    related: ['typespeed', 'typing-trainer', 'wumpus'],
  },

  {
    slug: 'gomoku',
    cat: 'terminal',
    name: 'Gomoku',
    glyph: 'XO',
    term: true,
    players: 2,
    soloAI: true,
    script: 'terminal/gomoku.js',
    pad: 'dpad',
    bestKey: null,
    engine: 'Character grid &middot; threat scoring, one ply',
    title: 'Gomoku — Five In A Row Against The Computer, Free',
    ogTitle: 'Gomoku that knows an open three from a closed one',
    description: 'Five in a row on a 15&times;15 board against an opponent that scores every line for threats ' +
      'instead of searching ahead. Or pass and play on one device.',
    short: 'Five in a row, against a real opponent.',
    h1: 'Gomoku',
    hero: 'Five stones in a row on a fifteen by fifteen board, against the computer or against whoever is ' +
      'sitting next to you. The opponent does not search ahead. It scores every line running through every ' +
      'candidate point, for both colours, which is enough to know that a four has to be answered now and an ' +
      'open three has to be answered next &mdash; and that is most of what winning at gomoku is.',
    facts: ['15&times;15, free-style rules', 'Threat scoring, no search', 'Three strengths', 'Or pass and play'],
    hud: [
      { key: 'black', label: 'X wins', accent: true, init: '0' },
      { key: 'white', label: 'O wins', init: '0' },
      { key: 'moves', label: 'Moves', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Pass &amp; play</option></select>',
      '<label class="sr-only" for="game-level">Strength</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="1">Casual</option><option value="2" selected>Sharp</option><option value="3">Ruthless</option></select>',
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Move the cursor' },
      { k: 'Space', d: 'Place a stone' },
    ],
    touch: 'The pad moves the cursor, or tap a point on the board to put a stone there.',
    infoHeading: 'How the opponent decides',
    info: [
      {
        h: 'One move of lookahead, and why that is enough',
        p: 'Connect Four on this site gets a six-ply search, because seven columns is a branching factor you ' +
          'can afford. Gomoku offers two hundred-odd legal moves in the middlegame, so the same search would ' +
          'not reach three ply. It does not need to: gomoku is decided by forcing moves, and a forcing move ' +
          'is already visible in the position. Scoring every line through a candidate point, for both ' +
          'colours, sees the four that must be blocked and the open three that must be blocked next.',
      },
      {
        h: 'Open or closed is counted, not matched against a table',
        p: 'The usual implementation keeps a list of pattern strings &mdash; dot-X-X-X-dot, O-X-X-X-dot &mdash; ' +
          'and that list is always missing a case. Here every run of five cells through the point is checked ' +
          'instead, a run holding an enemy stone is thrown away because nobody can ever complete it, and what ' +
          'settles the verdict is how many different empty squares would finish the best of them. Two ways to ' +
          'finish is an open four; one way is a plain four. It is why the broken three X-dot-X-X is spotted ' +
          'here without a rule written for it.',
      },
      {
        h: 'A double threat wins without being told to',
        p: 'The score for a point is the sum of what it does in all four directions. So a square that makes ' +
          'two open threes at once outscores a square that makes one four, purely by addition. Nothing in ' +
          'the code knows what a double threat is; the arithmetic finds it, which is the same reason the ' +
          'Connect Four engine blocks without a rule that says block.',
      },
    ],
    faq: [
      { q: 'Do I always go first?', a: 'Yes, you play X and open. That is a real advantage — free-style gomoku is a first-player win with perfect play. Nothing here plays perfectly, so it is an advantage rather than a result.' },
      { q: 'Does six in a row count?', a: 'Yes. These are free-style rules: five or more wins, and there are no forbidden openings. That is the version people play away from a tournament table.' },
      { q: 'What actually changes between the three strengths?', a: 'How heavily it weighs your threats against its own, and how much noise goes into the choice. Casual under-defends and wanders; Sharp defends almost as hard as it attacks; Ruthless defends fully and checks your best reply to its six best moves before committing.' },
      { q: 'Can two of us play on one device?', a: 'Yes — switch the first dropdown to pass and play. The cursor is shared and the side panel says whose turn it is.' },
      { q: 'Does it work on a phone?', a: 'Yes. Tap the point you want and the stone goes there, or use the pad if you would rather nudge the cursor a square at a time. It is turn-based, so a touchscreen costs you nothing.' },
    ],
    related: ['connect-four', 'chess', 'greed'],
  },

  {
    slug: 'pacman',
    cat: 'terminal',
    name: 'Pac-Man',
    /* Structured data presents this as what it is — an original fan
       remake — rather than claiming authorship of somebody's registered
       mark. The page keeps its plain name. */
    jsonldName: 'Pac-Man (fan remake)',
    glyph: 'C',
    term: true,
    /* Not wide: the maze is 30 columns and taller than it is broad, so
       the turn-your-phone-sideways hint (which claimed eighty columns)
       was advice for a different game. */
    script: 'terminal/pacman.js',
    pad: 'dpad',
    bestKey: 'pacman',
    engine: 'Character grid &middot; four ghost rules',
    title: 'Pac-Man — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'Four ghosts, four different rules',
    description: 'A hand-drawn maze on a character grid, 192 dots, wrapping side tunnels, and four ghosts ' +
      'that each hunt by a different rule. Pellets make them edible.',
    short: 'Four ghosts, four different hunting rules.',
    h1: 'Pac-Man',
    hero: 'Twenty-eight columns by twenty-one rows of hand-drawn maze, 188 dots and four power pellets. ' +
      'The maze is the easy part. What makes this game work is that each of the four ghosts steers by a ' +
      'different rule, so they close on you from four sides without ever once talking to each other.',
    facts: ['Hand-drawn 28 by 21 maze', 'Four ghosts, four rules', 'Side tunnels wrap around', '192 dots to clear'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'lives', label: 'Lives', init: '3' },
      { key: 'dots', label: 'Dots', init: '192' },
    ],
    controls: [
      '<label class="sr-only" for="game-speed">Ghost speed</label>',
      '<select class="game-select" autocomplete="off" id="game-speed"><option value="5.5">Calm</option><option value="6.6" selected>Standard</option><option value="7.8">Relentless</option></select>',
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Turn at the next junction' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'Swipe anywhere on the board to turn, or use the pad. Tap the board to start.',
    infoHeading: 'Why four ghosts and not one ghost four times',
    info: [
      {
        h: 'Four rules, deliberately',
        p: 'Give every ghost the same &ldquo;walk towards Pac-Man&rdquo; rule and they stack onto one tile ' +
          'and move as a single body, which you can outrun forever by going round a block. Here red walks at ' +
          'your tile, magenta walks at the tile four ahead of your nose so it cuts you off rather than ' +
          'follows, cyan alternates every six seconds between hunting you and retreating to its own corner, ' +
          'and orange mostly wanders at random. Each one alone is beatable. Together they surround you.',
      },
      {
        h: 'The turn you asked for is remembered for half a second',
        p: 'Movement is one whole tile at a time, so a turn pressed just before a junction would otherwise be ' +
          'thrown away and you would sail past the corner. The requested direction is held and applied on the ' +
          'first tick it becomes legal. It expires after 0.55 seconds on purpose &mdash; hold it forever and a ' +
          'turn you pressed and forgot about fires at a junction three corridors later.',
      },
      {
        h: 'The house door is a role, not a wall',
        p: 'The two door tiles are walkable for a ghost that is still penned or is returning to the house as a ' +
          'pair of eyes, and solid for everyone else, including a ghost that has already left. That single test ' +
          'is the whole ghost-house lifecycle: released ghosts head for the tile above the door and can never ' +
          'get back in, eaten ones head for the middle of the house and are re-penned when they arrive.',
      },
      {
        h: 'Catching you needs two checks, not one',
        p: 'You and the ghosts move a whole tile at a time and at different speeds, so two bodies walking ' +
          'straight at each other can swap tiles in one step and never share one. Testing only for &ldquo;same ' +
          'tile&rdquo; lets a ghost walk clean through you. Every contact test also compares the tile each of ' +
          'you has just left.',
      },
    ],
    faq: [
      { q: 'Is this the arcade maze?', a: 'No. The arcade board is 28 by 31, which will not fit a 30 by 24 character grid with room left for a status line, so this maze is hand-drawn at 28 by 21. It keeps what matters: four corner pellets, wrapping side tunnels, a central ghost house with one door, and no dead ends.' },
      { q: 'Why do the ghosts suddenly all turn round?', a: 'Eating a power pellet reverses every ghost on the spot. Without that, a ghost already sitting on top of you simply eats you during the frightened window, which reads as a bug rather than a rule. The cyan one also turns round on its own every six seconds, when it switches between hunting and retreating.' },
      { q: 'How long are they edible, and what are they worth?', a: 'Six and a half seconds, and they flash white for the last two. The first ghost in a chain is 200 points, then 400, 800 and 1,600. Clearing all four on one pellet is worth 3,000, which is more than three hundred dots.' },
      { q: 'What happens when I clear the board?', a: 'You win the run and the score is final. There are no faster repeat levels &mdash; if you want more pressure, the ghost speed dropdown above the board changes it mid-run, and it takes effect on the next tick rather than the next game.' },
      { q: 'Can I go inside the ghost house?', a: 'No, the door is solid for you. The corridor that loops around the outside of the house is open, though, and it is one of the few stretches of the board with no dots in it at all.' },
    ],
    related: ['robots', 'snake', 'greed'],
  },

  {
    slug: 'tty-solitaire',
    touch: 'Tap a card to pick it up, then tap where it should go. The pad moves the cursor if you would rather aim with a thumb.',
    wide: true,
    cols: 72,
    cat: 'terminal',
    name: 'TTY Solitaire',
    glyph: '♠',
    term: true,
    script: 'terminal/tty-solitaire.js',
    pad: 'dpad',
    bestKey: 'tty-solitaire',
    engine: 'Character grid &middot; draw one, unlimited redeals',
    title: 'TTY Solitaire — Klondike In A Terminal, Free And No Sign-Up',
    ogTitle: 'Klondike, dealt in characters',
    description: 'Klondike solitaire on a character grid. Draw one, four foundations, seven columns, and a cursor you drive with the arrow keys. Nothing is uploaded.',
    short: 'Klondike patience on a character grid.',
    h1: 'TTY Solitaire',
    hero: 'The patience game everyone already knows, dealt as text: seven columns, four foundations, and a deck you turn one card at a time. The cursor is the whole interface &mdash; arrows to point at a card, action to pick it up, action again to put it down. The rules are the strict ones, including the one people forget: a gap in the tableau takes a king and nothing else.',
    facts: ['Draw one, unlimited redeals', 'Whole runs move at once', 'Only a king fills a gap', 'Auto-play sends safe cards only'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'moves', label: 'Moves', init: '0' },
      { key: 'home', label: 'Home', init: '0/52' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-deal">Deal</button>',
      '<button class="game-btn" type="button" id="game-auto">Send safe cards home</button>',
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Move the cursor &mdash; up walks down a column to take a longer run' },
      { k: 'Space', d: 'Pick a card up, and put it down' },
    ],
    infoHeading: 'Fitting a card game into four arrows and one key',
    info: [
      {
        h: 'Up does two jobs',
        p: 'A card game has to know which column you mean and how far down it you are reaching, but the shell only ever sends up, down, left, right and action &mdash; no letter key is bound anywhere in /games. So inside a column, up steps the cursor down through the face-up cards, taking one more into the run each time, and only leaves for the deck and the foundations once the whole face-up run is in hand.',
      },
      {
        h: 'Long columns fold their face-down cards into one row',
        p: 'A column can reach nineteen cards &mdash; six face down under a full king-to-ace run &mdash; and there are seventeen rows under the foundations. When a pile will not fit, the face-down cards collapse to a single [##6]. Only they are ever folded: a face-down card tells you nothing except that it is there, whereas hiding a face-up one would hide a legal move.',
      },
      {
        h: 'Auto-play only sends cards it cannot need back',
        p: 'The button uses the standard safety rule: a card can go home once both opposite-colour foundations have reached one rank below it and the other foundation of its own colour is within two. Nothing it sends could still be wanted to take a lower card in the tableau, so it can never lose you a game you would have won. Sending everything that merely fits is the easy version, and it quietly costs you runs.',
      },
    ],
    faq: [
      { q: 'Is this draw one or draw three?', a: 'Draw one, and you can turn the deck over as often as you like. It is the kinder version, and it is the one that makes a deal winnable often enough to be worth starting.' },
      { q: 'Can I take a card back off a foundation?', a: 'Yes. Point at the foundation, press action, and the top card comes back into your hand for a tableau column. It costs fifteen points, which is roughly what it costs you in the paper game too.' },
      { q: 'Is every deal winnable?', a: 'No, and nothing checks the deal before it hands it to you. Most draw-one deals can be solved by somebody who can see every card; rather fewer by somebody who cannot, which is the game.' },
      { q: 'Is there an undo?', a: 'No. Restart deals a fresh game, but a move you have made is made. That is the same bargain the physical game makes, and it is what makes the choice of which card to turn matter.' },
      { q: 'What is the score counting?', a: 'Ten for a card sent home, five for turning a face-down card, five for a card played out of the waste, and fifteen off for taking one back down from a foundation. It measures progress rather than speed; the move counter beside it is there if you would rather judge yourself on that.' },
    ],
    related: ['greed', 'minesweeper', 'sudoku'],
  },

  {
    slug: 'atc',
    cat: 'terminal',
    name: 'ATC',
    glyph: '✈',
    term: true,
    wide: true,
    cols: 66,
    script: 'terminal/atc.js',
    pad: 'dpad',
    bestKey: 'atc',
    engine: 'Character grid &middot; eight headings, ten altitudes',
    title: 'ATC — The BSD Air Traffic Controller, In Your Browser',
    ogTitle: 'ATC: eight headings, ten altitudes, three minutes',
    description: 'The BSD air traffic controller. Aircraft arrive with a heading and an altitude. Get each one ' +
      'out through its own exit at nine, or down on a runway.',
    short: 'Keep them apart, get them home.',
    h1: 'ATC',
    hero: 'Aircraft appear at the edge of the scope with a heading, an altitude and somewhere they have to be ' +
      '&mdash; out through a numbered exit at altitude nine, or down on a runway pointing the way the runway ' +
      'points. You have four arrows and three minutes. Two of them in touching squares at the same altitude ' +
      'and the shift is over.',
    facts: ['Eight headings, ten altitudes', 'Eight exits, two runways', 'One square apart is a collision', 'Three minutes a shift'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'time', label: 'Time', init: '3:00' },
      { key: 'planes', label: 'On scope', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-level">Traffic</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="1" selected>Light traffic</option><option value="2">Busy</option><option value="3">Heavy</option></select>',
    ],
    keys: [
      { k: '← →', d: 'Turn the selected aircraft 45 degrees' },
      { k: '↑ ↓', d: 'Raise or lower its cleared altitude' },
      { k: 'Space', d: 'Move to the next aircraft' },
    ],
    touch: 'Tap an aircraft on the scope to select it, then use the pad &mdash; left and right turn, up and down change altitude.',
    infoHeading: 'What four arrows have to cover',
    info: [
      {
        h: 'Left and right turn, they do not steer',
        p: 'The shell binds four arrows and one action key, and altitude needs two of them. So a heading is ' +
          'state the aircraft keeps, and the side arrows rotate it forty-five degrees at a time &mdash; which ' +
          'is roughly how the instruction sounds on the radio anyway: turn left, climb. Spending the arrows on ' +
          'compass points instead would have left nothing for altitude, and altitude is half the game.',
      },
      {
        h: 'Separation is judged after everyone has moved',
        p: 'The collision test runs once, when every aircraft has taken its step for that sweep. Run it inside ' +
          'the movement loop instead and the aircraft early in the list are measured against positions the ' +
          'rest have not taken yet, so the same two either crash or do not depending on the order they ' +
          'happened to arrive in. That is the kind of bug a player experiences as the game cheating.',
      },
      {
        h: 'Landing is a timing problem, not a button',
        p: 'Altitude changes one level per sweep and the aircraft moves one square in the same sweep, so a ' +
          'descent has to be started exactly as many squares out as the altitude you are at. Reach zero ' +
          'anywhere except the airport square, on the runway heading, and it is a crash. None of the landing ' +
          'is a keypress at the right instant; all of it is arithmetic done three or four sweeps early.',
      },
    ],
    faq: [
      { q: 'How do I get an aircraft off the radar?', a: 'Point it at its own numbered exit and climb it to altitude nine. It leaves the moment it reaches that exit at that altitude. At any other altitude it flies straight over the exit and off the edge, and that loses the shift.' },
      { q: 'How do I land one?', a: 'Match the runway heading printed beside the airport, then time the descent so the aircraft reaches altitude zero on the airport square itself. One level a sweep, so from altitude three you commit three squares out.' },
      { q: 'What exactly counts as a collision?', a: 'Two aircraft in touching squares at the same altitude. One level of separation is enough, which is why altitude rather than heading is the tool that gets you out of trouble.' },
      { q: 'Why is an aircraft sitting on a runway doing nothing?', a: 'It is a departure waiting for clearance. It will not move until you give it an altitude, and it costs you nothing while it waits &mdash; which makes it the one thing on the screen you are allowed to ignore.' },
      { q: 'Does it work on a phone?', a: 'Yes. Tap an aircraft to pick it, then use the pad. It is a sixty-six column screen, so turn the phone sideways.' },
    ],
    related: ['greed', 'robots', 'wumpus'],
  },

  {
    slug: 'trek',
    cat: 'terminal',
    name: 'Star Trek',
    glyph: '🖖',
    term: true,
    wide: true,
    cols: 70,
    script: 'terminal/trek.js',
    pad: 'dpad',
    bestKey: 'trek',
    tapAction: false,
    engine: 'The 1971 game, driven by arrows',
    title: 'Star Trek — The 1971 Terminal Game, In Your Browser',
    ogTitle: 'Star Trek, the 1971 one',
    description: 'Mike Mayfield\'s 1971 Star Trek: an 8x8 galaxy, a klingon fleet and forty stardates. Warp, ' +
      'scan, phasers and photon torpedoes, all from the arrow keys.',
    short: 'Hunt a klingon fleet across sixty-four quadrants.',
    h1: 'Star Trek',
    hero: 'Mike Mayfield wrote this in 1971 and it spread to every machine that could print eighty columns. ' +
      'Sixty-four quadrants, a klingon fleet somewhere in them, and just enough energy to make every warp a ' +
      'decision. The stardate is the only clock, and it moves only when you do.',
    facts: ['The 1971 original', 'An 8x8 galaxy of 8x8 sectors', 'Forty stardates to finish', 'Arrow keys only, no typing'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'stardate', label: 'Stardate', init: '2250.0' },
      { key: 'klingons', label: 'Klingons' },
      { key: 'energy', label: 'Energy', init: '3000' },
      { key: 'torps', label: 'Torpedoes', init: '10' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-cancel">Back to orders</button>',
    ],
    keys: [
      { k: '← →', d: 'Choose an order' },
      { k: '↑ ↓ ← →', d: 'Steer, aim, or set an amount' },
      { k: 'Space', d: 'Give the order' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'The pad does all of it: left and right walk along the orders, all four arrows steer or aim inside ' +
      'one, and Action gives it. Back to orders leaves an order without carrying it out.',
    infoHeading: 'Three things that had to change',
    info: [
      {
        h: 'The command line became a row of orders',
        p: 'The original prompts COMMAND? and reads NAV, SRS, PHA and the rest. The shell every game here runs ' +
          'inside binds no letter keys at all &mdash; deliberately, so that the typing games can exist on it &mdash; ' +
          'so there was nothing left to type a command with. The orders sit in a row instead: left and right walk ' +
          'along them, Space gives one, and inside each order the arrows mean something specific. Every order also ' +
          'has a way to back out doing nothing: warp to the quadrant you are already in, fire no units, transfer no ' +
          'energy.',
      },
      {
        h: 'The galaxy stores counts, not ships',
        p: 'Each of the sixty-four quadrants holds three numbers &mdash; klingons, starbases, stars &mdash; and ' +
          'nothing else. Positions and klingon energy are generated when you arrive and thrown away when you leave, ' +
          'exactly as the 1971 listing did. A klingon you wound and then warp away from is whole again when you ' +
          'come back, which sounds like a bug and is the rule that makes running away expensive.',
      },
      {
        h: 'Phaser energy thins with range',
        p: 'What you fire is split evenly between every klingon in the quadrant and then scaled down by how far ' +
          'each one is, so the same thousand units kills at two sectors and merely annoys at seven. That is the ' +
          'whole reason impulse power exists: closing the distance costs twenty units a square and a couple of ' +
          'hits on the way in, and it is almost always the cheaper trade.',
      },
    ],
    faq: [
      { q: 'What do the three digits in a galaxy chart cell mean?', a: 'Klingons, starbases and stars in that quadrant, in that order. Three dots mean you have not scanned it yet. A long range scan reads the eight quadrants around you onto the chart, and it costs neither energy nor time.' },
      { q: 'How do I refuel?', a: 'Move next to a starbase under impulse power. Docking happens by itself once you are in one of the eight squares around it, and it fills both the energy and the torpedo racks. It also drops your shields to zero, so leave carefully.' },
      { q: 'Can I run out of energy?', a: 'Yes, and it ends the run there and then. Below twenty units you cannot move a single sector, which means you cannot reach a starbase, so the game says so rather than leaving you to press buttons at a ship that can no longer do anything.' },
      { q: 'Is the stardate a real clock?', a: 'No. It moves only when you do: roughly one stardate for each quadrant of warp, a twentieth for a sector of impulse, a tenth for firing. Sitting and reading the chart is free.' },
    ],
    related: ['wumpus', 'robots', 'greed'],
  },

  {
    slug: 'asciijump',
    cat: 'terminal',
    name: 'asciijump',
    glyph: '⛷',
    term: true,
    wide: true,
    cols: 72,
    script: 'terminal/asciijump.js',
    pad: 'lr',
    bestKey: 'asciijump',
    engine: 'Character grid &middot; 72 columns',
    title: 'asciijump — Play Free Online, No Ads | Krunalkumar Shah',
    ogTitle: 'One instant at the lip decides the jump',
    description: 'The Linux terminal game asciijump, rebuilt for the browser. Tuck down the in-run, hit the takeoff window, and hold the lean in the air. No install, no ads.',
    short: 'Time the lip, then hold the lean.',
    h1: 'asciijump',
    hero: "Peter Marschall wrote asciijump for a terminal in 2003 and its whole trick is one instant. You tuck the in-run, you leave the lip, and the tenth of a second around that edge decides whether you land at forty metres or ninety. Everything after it is you trying not to spoil it.",
    facts: ['One instant decides it', 'Three jumps a run', 'Real ski-jump scoring', 'Runs at 72 columns'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'speed', label: 'km/h', init: '0' },
      { key: 'metres', label: 'Metres', init: '0.0' },
      { key: 'jump', label: 'Jump', init: '1/3' },
    ],
    keys: [
      { k: 'Space', d: 'Hold to tuck, let go at the lip' },
      { k: '← →', d: 'Hold the lean steady in the air' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'Hold the Action button all the way down the in-run and lift your thumb at the lip. Left and right hold the lean while you are in the air.',
    infoHeading: 'Why the takeoff is the whole thing',
    info: [
      {
        h: 'The window is time, not distance',
        p: 'The game keeps a running estimate of how long until the lip &mdash; the metres of ramp left, divided by your speed &mdash; and grades your press against it. A window measured in columns instead would be wider at 70 km/h than at 100, which quietly pays you for a slow in-run. It also runs both sides of the edge, because pressing late has to be possible: otherwise holding until the ramp simply ends is free, and everybody does that instead of playing.',
      },
      {
        h: 'It tells you how wrong you were',
        p: 'Every jump ends with the miss in seconds &mdash; 0.14 s early, 0.03 s late. That number is the whole teaching mechanism. A timing game that reports only the outcome is a slot machine; one that reports the error is something you are visibly better at after ten jumps.',
      },
      {
        h: 'Pressing early does not launch you early',
        p: 'You leave the ramp when the ramp ends, not when you press. Firing early only means your legs finished extending before the edge arrived, so there is nothing left to spring with &mdash; which is why the takeoff is a multiplier on the launch rather than an event of its own. Mashing the button near the lip commits you to the first press that lands inside the window, usually about a second too soon.',
      },
      {
        h: 'Distance is only half the score',
        p: 'The scoring is the real one: sixty points at the K-point, two points a metre either side of it, and three judges marking out of twenty for how still you held the flight. A fall caps every judge at ten, so a long jump you cannot stand up is worth less than a shorter one you can.',
      },
    ],
    faq: [
      { q: 'Is this the real asciijump?', a: 'It is a rebuild, not the original binary. Same three phases, same screenful of characters, written in JavaScript so it runs in a browser tab instead of needing a terminal and a package manager.' },
      { q: 'When exactly should I let go?', a: 'At the red lip post, and about a twentieth of a second either side of it still counts as perfect. The results panel tells you which way you missed, which is faster to learn from than any advice here.' },
      { q: 'What are the arrow keys for?', a: 'The air is unstable. Your lean drifts, and drifting further makes it drift faster, so left and right are a constant small correction rather than a steering wheel. The bar along the bottom shows where you are against where the judges want you.' },
      { q: 'Does the wind matter?', a: 'A headwind is airspeed and airspeed is lift, so it is worth a few metres either way. It is deliberately small: something you notice, not something that decides a jump your takeoff already decided.' },
      { q: 'Does it work on a phone?', a: 'Yes, in landscape. Hold the Action button down the in-run and lift your thumb at the lip; left and right hold the lean once you are in the air.' },
    ],
    related: ['moon-buggy', 'tux-racer', 'reaction-time'],
  },

  {
    slug: 'adventure',
    cat: 'terminal',
    name: 'Adventure',
    glyph: '>',
    term: true,
    wide: true,
    cols: 72,
    script: 'terminal/adventure.js',
    pad: 'dpad',
    bestKey: 'adventure',
    tapAction: false,
    engine: 'Character grid &middot; eighteen rooms',
    title: 'Adventure — A Small Text Adventure, Free In Your Browser',
    ogTitle: 'Adventure: a lamp, a locked grate, and gas',
    description: 'A ruined mine in eighteen rooms. Find the key, light the lamp, work out what the gas will do ' +
      'to a naked flame, and carry the gold back out.',
    short: 'Eighteen rooms, one lamp, some gas.',
    h1: 'Adventure',
    hero: 'A worked-out mine in eighteen rooms, with an iron key in the silt, a lamp in the engine house and ' +
      'firedamp in the west heading. There is gold down there, and the only way to reach it is to work out ' +
      'why the mine\'s own safety lamp had a wire gauze in it.',
    facts: ['Eighteen hand-written rooms', 'Three puzzles, one of them fatal', 'No verbs to guess', 'Nothing typed, nothing stored'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'moves', label: 'Moves', init: '0' },
      { key: 'lamp', label: 'Lamp', init: 'none' },
    ],
    keys: [
      { k: '↑ ↓', d: 'Move through the list' },
      { k: '← →', d: 'The same, if your thumb is already there' },
      { k: 'Space', d: 'Do the highlighted thing' },
    ],
    touch: 'Pad up and down to move through the list, Action to choose. Tapping the screen does nothing, on purpose: one of the choices in that list will kill you.',
    infoHeading: 'A cave crawl with no parser in it',
    info: [
      {
        h: 'Every move is a list, because there is no letter key to type on',
        p: 'The games shell binds the four arrows and one action key and nothing else &mdash; no letter is ever ' +
          'bound, so that the typing games can live on the same shell and so that a game never swallows a ' +
          'keystroke meant for a form. A parser you cannot type into is not a parser, so instead the room ' +
          'lists what you can do and you pick one with the arrows. Guess-the-verb goes out with it, which is ' +
          'no great loss.',
      },
      {
        h: 'Two rules that point in opposite directions',
        p: 'Below the adit it is too dark to take a step, so the lamp has to be lit. The west heading holds ' +
          'firedamp, so a naked flame in it kills you. Neither is a puzzle on its own; together they have ' +
          'exactly one answer, and it is the same answer Humphry Davy found in 1815. The board in the pump ' +
          'chamber states the rule in plain words well before the rule can be fatal, because a death you ' +
          'could not have seen coming is a trick rather than a puzzle.',
      },
      {
        h: 'The score is the haul, minus the wandering',
        p: 'Each treasure is worth a fixed amount and you keep only what you are carrying when you climb the ' +
          'stile at the end. On top of that you get whatever is left of two hundred moves, so a run that ' +
          'finds the short way round beats one that finds everything the long way. Blowing yourself up ' +
          'scores nothing at all.',
      },
    ],
    faq: [
      { q: 'Is this Colossal Cave?', a: 'No. It is the same kind of game &mdash; rooms, a lamp, a locked way, treasure to carry home &mdash; but the map, the puzzles and the prose are written for this page. Eighteen rooms against the original\'s hundreds.' },
      { q: 'I am stuck at the gas. What now?', a: 'Read the board nailed to the timbering in the pump chamber, then look at what is lying on the floor of that same room. The mine tells you the answer before it kills you for not having it.' },
      { q: 'Do I need to draw a map?', a: 'Not really. Once you have been somewhere, the exit that leads back to it is labelled with its name, so the list does most of the mapping for you. A pen still helps below the ladderway.' },
      { q: 'What happens when I die?', a: 'The run ends and scores nothing, and you start again at the stile. There is exactly one way to die in this mine and it is signposted twice, so it is a decision rather than an accident.' },
      { q: 'Can I put things down?', a: 'No, and nothing needs it. There is no carrying limit and no puzzle that turns on leaving something behind, so a drop command would only be one more line in the list to scroll past.' },
    ],
    related: ['wumpus', 'greed', 'minesweeper'],
  },

  {
    slug: 'rogue',
    cat: 'terminal',
    name: 'Rogue',
    glyph: '@',
    term: true,
    wide: true,
    cols: 70,
    script: 'terminal/rogue.js',
    pad: 'dpad',
    bestKey: 'rogue',
    engine: 'Nine rooms a level, dug fresh every run',
    title: 'Rogue — The Original Roguelike, Free In Your Browser',
    ogTitle: 'Rogue: one life, and a dark dungeon',
    description: 'A small roguelike. Rooms dug fresh every run, a lamp that only reaches so far, monsters that ' +
      'follow you once they have seen you, and exactly one life.',
    short: 'One life, in the dark, downwards.',
    h1: 'Rogue',
    hero: 'Nine rooms a level, joined by corridors, and none of it drawn until your lamp reaches it. Monsters ' +
      'follow you once they have seen you, the stairs only ever go down, and there is no save file &mdash; when ' +
      'you die you start again on level one with sixteen hit points and a dagger.',
    facts: ['A new dungeon every run', 'Line-of-sight lamp', 'Permadeath, no saves', 'Ten levels to the amulet'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'depth', label: 'Depth', init: '1' },
      { key: 'hp', label: 'Hit points', init: '16/16' },
    ],
    keys: [
      { k: '← ↑ → ↓', d: 'Move, and attack by walking into a monster' },
      { k: 'Space', d: 'Rest a turn, or go down when you are standing on the stairs' },
    ],
    touch: 'The pad moves you, and walking into a monster attacks it. Action rests a turn, or takes the stairs.',
    infoHeading: 'How the dungeon is dug, and how much of it you get to see',
    info: [
      {
        h: 'Nine cells, nine rooms, and no retries',
        p: 'The map is split into a three-by-three grid and one room is dug in each cell, then room centres are ' +
          'joined. Because every room is linked to its neighbour by construction, there is no generate-and-check ' +
          'loop and no possibility of a level with the stairs walled off &mdash; which is the failure mode of ' +
          'every dungeon generator that scatters rooms at random and hopes.',
      },
      {
        h: 'Corridors turn in the rock, not against a wall',
        p: 'A corridor is three segments and the bend is always taken in the gap between two cells. Drawn as a ' +
          'simple L instead, the long leg eventually runs the length of a room\'s outer wall and turns the whole ' +
          'run into doorways, leaving a room with one open side and no way to tell where you are meant to go in. ' +
          'Turning in the gap means each leg meets a room square on its centre line, so every corridor end is ' +
          'exactly one door.',
      },
      {
        h: 'The lamp is ray-cast; the room is not',
        p: 'Sight is a line traced to every square within five, which is what gives a corridor its one-square-' +
          'at-a-time crawl. Standing inside a room lights the whole room regardless of that radius, because ' +
          'without the override a long chamber is explored in fragments and you never see the thing walking ' +
          'across it. Doors block sight but not movement, so a room stays dark until you are in its doorway.',
      },
      {
        h: 'There is no pack, and that is forced',
        p: 'The shell binds four arrows and one action key and no letters at all, on purpose &mdash; the typing ' +
          'games share it. So a pack you open with i and drink from with q has nowhere to live. Potions are drunk ' +
          'where they are found and a better weapon is picked up and wielded on the spot. It loses a real layer ' +
          'of the original, and it is the only version of this that works with a thumb pad.',
      },
    ],
    faq: [
      { q: 'Can I save a run?', a: 'No, and there is no undo either. That is what permadeath means: the run ends when you die, and the only thing that survives it is the score.' },
      { q: 'How is the score worked out?', a: 'Twenty-five for every level you reached, plus every piece of gold you picked up. Going deeper is worth more than clearing a level, which is the right way round.' },
      { q: 'How do I go down a level?', a: 'Find the % and press Space while you are standing on it. On a phone, the Action button does the same thing.' },
      { q: 'Is there a way to win?', a: 'Yes. The Amulet of Yendor lies on level ten and on every level below it, so it cannot be permanently missed. Pick it up and the run ends there, which is a good deal shorter than the original\'s twenty-six floors and a climb back out.' },
      { q: 'What do the letters mean?', a: 'Each one is a monster, roughly in order of how much trouble it is: r for a rat, k for a kobold, o for an orc, T for a troll, D for a dragon. ! is a potion, ) a weapon, * gold and % the stairs down.' },
    ],
    related: ['wumpus', 'robots', 'greed'],
  },


  {
    slug: 'moon-buggy',
    touch: "Tap anywhere on the screen to jump &mdash; or use the big green Jump button. Fire shoots the rocks ahead of you.",
    wide: true,
    cat: 'terminal',
    name: 'Moon buggy',
    glyph: '🌙',
    term: true,
    script: 'terminal/moon-buggy.js',
    pad: 'jumpfire',
    engine: 'Character grid &middot; endless',
    title: 'Moon Buggy — The Linux Terminal Game, In Your Browser',
    ogTitle: 'Moon buggy, jumped craters and all',
    description: 'The classic Linux terminal game moon-buggy, rebuilt for the browser. Drive across the moon, ' +
      'jump the craters, shoot the rocks. No install, no ads, no sign-up.',
    short: 'Drive, jump the craters, shoot the rocks.',
    h1: 'Moon buggy',
    hero: 'Jochen Voss wrote this for a terminal in 1999 and it has been on Linux machines ever since. One buggy, ' +
      'one ground line, and holes in it. You will be surprised how long you keep pressing up.',
    facts: ['The original terminal game', 'Endless, procedurally generated', 'Jump craters, shoot rocks', 'Runs at 80 columns'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'distance', label: 'Metres' },
      { key: 'lives', label: 'Buggies', init: '3' },
    ],
    keys: [
      { k: '↑', d: 'Jump' },
      { k: 'Space', d: 'Fire the laser' },
      { k: 'Esc', d: 'Pause' },
    ],
    infoHeading: 'Two things worth knowing',
    info: [
      {
        h: 'The ground is a function, not a map',
        p: 'Terrain is generated from the absolute distance through a seeded hash, so metre 40,000 is the same ' +
          'crater every time and nothing has to be stored. An endless runner that keeps its terrain in an array ' +
          'grows without limit; this one holds a distance counter and nothing else.',
      },
      {
        h: 'A cut road is a fall, not an obstacle',
        p: 'The buggy is five cells wide and the narrowest crater is three, so there is no bridging: if any part ' +
          'of the buggy is over the gap while it is on the ground, it goes down. That is the only rule you have ' +
          'to respect, and everything else &mdash; the rocks, the speed &mdash; is decoration on top of it.',
      },
    ],
    faq: [
      { q: 'Is this the real moon-buggy?', a: 'It is a faithful rebuild, not the original binary. Same idea, same shape, same eighty-column screen — written in JavaScript so it runs in a browser tab instead of needing a terminal and a package manager.' },
      { q: 'Why does it get faster?', a: 'Speed climbs slowly with distance and caps out, so an expert run stays playable rather than becoming a reaction-time lottery.' },
      { q: 'Can I shoot the craters?', a: 'No — craters are holes, and a laser does not fill a hole. Rocks can be shot or jumped; craters can only be jumped.' },
      { q: 'Does it work on a phone?', a: 'Yes. The pad gives you an action button, and tapping the screen jumps.' },
    ],
    related: ['bastet', 'greed', 'snake'],
  },

  {
    slug: 'bastet',
    touch: "Pad to move and rotate. Tap the board to hard-drop.",
    cat: 'terminal',
    name: 'Bastet',
    glyph: '☠',
    tag: 'Evil',
    term: true,
    script: 'terminal/bastet.js',
    pad: 'rotate',
    engine: 'Character grid &middot; adversarial',
    title: 'Bastet — Bastard Tetris, The Evil Tetris | Krunalkumar Shah',
    ogTitle: 'Tetris, if the game were actively against you',
    description: 'Bastet — "bastard Tetris" — replaces the random piece bag with a solver that hands you the ' +
      'worst piece every single time. Free, in your browser.',
    short: 'Tetris where the game picks your worst piece.',
    h1: 'Bastet',
    hero: 'Federico Poloni&rsquo;s bastet does one thing differently from Tetris, and it is enough to change the ' +
      'game entirely: instead of dealing pieces at random, it works out which of the seven shapes would hurt you ' +
      'most, and gives you that one. Every time. There is no bad luck here, only intent.',
    facts: ['The generator is a solver', 'Every piece is your worst', 'Same rules as Tetris otherwise', '280 drops simulated per piece'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'lines', label: 'Lines' },
      { key: 'level', label: 'Level', init: '1' },
    ],
    keys: [
      { k: '← →', d: 'Move' },
      { k: '↑', d: 'Rotate' },
      { k: '↓', d: 'Soft drop' },
      { k: 'Space', d: 'Hard drop' },
    ],
    infoHeading: 'How it decides what to give you',
    info: [
      {
        h: 'It plays your move for you first',
        p: 'For each of the seven shapes it drops every rotation into every column, scores the board that ' +
          'results, and keeps the BEST outcome &mdash; because that is what a competent player would find. Then ' +
          'it serves whichever shape&rsquo;s best outcome is worst. That is 280 simulated drops per piece, which ' +
          'costs nothing and is genuinely adversarial rather than merely unlucky.',
      },
      {
        h: 'Play it next to the fair one',
        p: 'The <a href="/games/tetris">Tetris here</a> uses a proper 7-bag: all seven shapes shuffled and dealt, ' +
          'so your worst drought is capped at twelve pieces. Same rules, opposite generators. Playing both is ' +
          'the fastest way to understand that &ldquo;random&rdquo; is a design decision rather than a default, ' +
          'and how much of a game lives in it.',
      },
    ],
    faq: [
      { q: 'Is it actually impossible?', a: 'No. It is very hard. The solver models a decent player rather than a perfect one, and a shape with nowhere at all to go is skipped rather than served — an instant unavoidable loss reads as a broken game, not a cruel one.' },
      { q: 'How is this different from just bad luck?', a: 'Bad luck is a distribution. This is a search: it evaluates your actual board before choosing. Twenty S-pieces in a row from a random generator is a story; here it is a plan.' },
      { q: 'What is a good score?', a: 'Far lower than your Tetris score, and that is the point. Clearing thirty lines against this is a genuinely good run.' },
      { q: 'Why is it called that?', a: 'Short for "bastard Tetris", which is what its author called it, and which is fair.' },
    ],
    related: ['tetris', 'moon-buggy', 'greed'],
  },

  {
    slug: 'greed',
    touch: "Pad to move. Each direction shows how far it would take you.",
    wide: true,
    cols: 62,
    cat: 'terminal',
    name: 'Greed',
    glyph: '9',
    term: true,
    script: 'terminal/greed.js',
    pad: 'dpad',
    engine: 'Character grid &middot; pure strategy',
    title: 'Greed — The Terminal Puzzle Almost Nobody Has Played',
    ogTitle: 'Greed: one rule, and it is enough',
    description: 'A grid of digits. Move in a direction and you travel that many squares, eating everything ' +
      'you cross. No clock, no randomness after the deal.',
    short: 'Eat digits, and try not to box yourself in.',
    h1: 'Greed',
    hero: 'A board full of the digits one to nine. You stand on one. Pick a direction and you move that many ' +
      'squares, eating everything you cross &mdash; and those squares are gone for good. That is the whole game, ' +
      'and it is one of the best puzzles ever written for a terminal, because the only thing standing in your ' +
      'way at the end is the path you already took.',
    facts: ['One rule, no clock', 'No randomness after the deal', '1,200 squares to clear', 'Every dead end is your own'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'cleared', label: 'Cleared', init: '0%' },
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Move that many squares' },
    ],
    infoHeading: 'The rule that makes it a puzzle',
    info: [
      {
        h: 'Every square on the path must still be there',
        p: 'A move is legal only if the whole run is intact &mdash; you cannot jump a gap you have already eaten. ' +
          'Allowing that makes the game trivial and is the usual mistake in a rewrite. It is also the rule that ' +
          'turns your own earlier greed into the obstacle.',
      },
      {
        h: 'The legal moves are shown, on purpose',
        p: 'The four numbers under the board tell you how far each direction would take you. Hiding that does ' +
          'not make the game harder, only more tedious &mdash; the difficulty is in choosing, not in counting.',
      },
    ],
    faq: [
      { q: 'How do I win?', a: 'You do not, exactly. You clear as much of the board as you can before no legal move remains. Ninety per cent is an excellent result; nobody clears it all.' },
      { q: 'Is there any luck involved?', a: 'Only the deal. After that the board is fixed and fully visible, so every outcome is a consequence of your choices. That is unusual and it is why the game holds up.' },
      { q: 'Why does a direction sometimes show a dot?', a: 'Because that move is illegal: either it runs off the board or it crosses a square you have already eaten.' },
      { q: 'Does it work on a phone?', a: 'Yes, with the pad. It is a turn-based game, so a touchscreen costs you nothing.' },
    ],
    related: ['moon-buggy', 'bastet', 'minesweeper'],
  },

  {
    slug: 'robots',
    touch: "Pad to move one square. Tap the board to teleport.",
    wide: true,
    cols: 60,
    cat: 'terminal',
    name: 'Robots',
    glyph: '+',
    term: true,
    script: 'terminal/robots.js',
    pad: 'dpad',
    engine: 'Character grid &middot; BSD games',
    title: 'Robots — The BSD Terminal Game, Free In Your Browser',
    ogTitle: 'Robots: they chase you, and they cannot steer',
    description: 'The BSD games classic. Robots move one square towards you every turn and cannot avoid ' +
      'anything — the game is arranging collisions, not running away.',
    short: 'Make them crash into each other.',
    h1: 'Robots',
    hero: 'You move one square; every robot moves one square straight at you. They have no pathfinding at all, ' +
      'which means they will happily walk into each other and into the wrecks they leave behind. You are not ' +
      'escaping &mdash; you are herding.',
    facts: ['From the BSD games collection', 'No pathfinding, on purpose', 'Safe and risky teleports', 'Levels get crowded fast'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'level', label: 'Level', init: '1' },
      { key: 'robots', label: 'Left', init: '8' },
      { key: 'teleports', label: 'Safe', init: '2' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-teleport">Teleport</button>',
      '<button class="game-btn" type="button" id="game-wait">Wait it out</button>',
    ],
    keys: [
      { k: '↑ ↓ ← →', d: 'Move one square' },
      { k: 'Space', d: 'Teleport (safe if you have one left)' },
    ],
    infoHeading: 'Why they are beatable',
    info: [
      {
        h: 'They only know one move',
        p: 'Each robot steps one square towards you on each axis. That is the entire AI. It cannot go round a ' +
          'wreck, it cannot wait, and it cannot coordinate &mdash; so a robot lined up behind another is already ' +
          'dead, and your job is to keep arranging that.',
      },
      {
        h: 'Waiting is a move',
        p: 'Once every survivor is on a collision course, &ldquo;wait it out&rdquo; runs the turns for you and ' +
          'banks the level. Using it early is how you lose; using it at the right moment is how you score.',
      },
    ],
    faq: [
      { q: 'What is the difference between the two teleports?', a: 'A safe teleport puts you somewhere no robot can reach next turn, and you only get a few. A risky one drops you anywhere at all, including next to something. Space uses a safe one if you have any and a risky one otherwise.' },
      { q: 'Do wrecks kill me too?', a: 'Yes. Walking into a wreck ends the run just as surely as being caught, so the piles you build are obstacles for you as well.' },
      { q: 'How many levels are there?', a: 'It keeps going, adding four robots a level up to sixty. Nobody clears it; the score is how far you got.' },
      { q: 'Where does this come from?', a: 'The BSD games collection, where it has been shipping since the 1980s. It is still one of the best small games ever written.' },
    ],
    related: ['greed', 'moon-buggy', 'minesweeper'],
  },

  {
    slug: 'typespeed',
    touch: "Tap the board to bring up your keyboard, then type the words.",
    wide: true,
    cols: 76,
    cat: 'terminal',
    name: 'Typespeed',
    glyph: '»',
    term: true,
    script: 'terminal/typespeed.js',
    pad: 'none',
    engine: 'Character grid &middot; prefix matching',
    title: 'Typespeed — Type The Flying Words Before They Land',
    ogTitle: 'Typespeed: words fly, you type, they die',
    description: 'The Linux terminal typing game. Words fly across the screen; type them before they reach ' +
      'the wall. Shell commands and security vocabulary, in your browser.',
    short: 'Type the flying words before they land.',
    h1: 'Typespeed',
    hero: 'The opposite of a typing test. Words fly in from the left and you kill them by typing them &mdash; no ' +
      'Enter, no selecting, the word dies the moment it is complete. It measures recognition speed rather than ' +
      'endurance, which is a genuinely different skill from the one the ' +
      '<a href="/games/typing-trainer">trainer</a> works on.',
    facts: ['Shell commands and security words', 'Prefix matching, no Enter needed', 'Speeds up as you survive', 'Five lives'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'words', label: 'Caught' },
      { key: 'lives', label: 'Lives', init: '5' },
    ],
    keys: [
      { k: 'Type', d: 'A word dies as soon as it is complete' },
      { k: 'Backspace', d: 'Fix the buffer' },
      { k: 'Esc', d: 'End the run' },
    ],
    infoHeading: 'How the matching works',
    info: [
      {
        h: 'Prefix, not selection',
        p: 'What you type is compared against every word on screen. As soon as it exactly equals one, that word ' +
          'dies &mdash; the closest one if two match. Type something no word starts with and the buffer clears ' +
          'itself, so a slip costs you a moment rather than a life.',
      },
      {
        h: 'The vocabulary is deliberate',
        p: 'Shell commands, security terms and the short common words that carry most of English. Practising on ' +
          '<code>iptables</code> and <code>idempotent</code> is more use to the people who read this site than ' +
          'practising on random dictionary nouns.',
      },
    ],
    faq: [
      { q: 'Do I press Enter?', a: 'No. The word dies the instant what you have typed matches it. Space and Enter both just clear the buffer if you want to start a different word.' },
      { q: 'What happens when a word reaches the wall?', a: 'You lose a life. Five lives, then the run ends and you get your words-per-minute for the session.' },
      { q: 'How is this different from the typing trainer?', a: 'The trainer gives you long passages and measures sustained accuracy. This is a panic: short words, rising speed, and it measures how fast you recognise and fire.' },
      { q: 'Can I play it on a phone?', a: 'Tapping the playfield opens the keyboard, so yes — though this is one of the few here that genuinely wants a real keyboard.' },
    ],
    related: ['typing-trainer', 'robots', 'moon-buggy'],
  },

  {
    slug: 'ninvaders',
    cat: 'terminal',
    name: 'nInvaders',
    glyph: 'W',
    term: true,
    wide: true,
    cols: 60,
    script: 'terminal/ninvaders.js',
    pad: 'lr',
    engine: 'Character grid &middot; they speed up',
    title: 'nInvaders — Terminal Space Invaders, Free In Your Browser',
    ogTitle: 'Space Invaders, in sixty columns',
    description: 'The terminal Space Invaders. The swarm moves as one body, drops a row at each edge, and gets ' +
      'faster the fewer of them are left. No ads, no sign-up.',
    short: 'The swarm gets faster as you thin it.',
    h1: 'nInvaders',
    hero: 'Four rows of them, moving as a single body, dropping a row every time the block touches an edge. The ' +
      'last one alive is always the fastest, which the original arcade machine managed entirely by accident.',
    facts: ['The formation moves as one', 'Faster the fewer remain', 'Bunkers that erode', 'Two shots on screen'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'wave', label: 'Wave', init: '1' },
      { key: 'lives', label: 'Lives', init: '3' },
    ],
    keys: [
      { k: '← →', d: 'Move' },
      { k: 'Space', d: 'Fire' },
      { k: 'Esc', d: 'Pause' },
    ],
    touch: 'Pad to move left and right, Action to fire. Tapping the screen fires too.',
    infoHeading: 'Two rules that make it a game',
    info: [
      {
        h: 'Killing the edges changes the timing',
        p: 'The block only turns when a SURVIVING alien touches a wall, so clearing the outer columns lets it ' +
          'range wider and drop less often. That is a real tactic, and it falls out of the movement rule rather ' +
          'than being written in as one.',
      },
      {
        h: 'The speed is the body count',
        p: 'The step interval is worked out from how many are still alive, so the last invader crosses the ' +
          'screen at a sprint. The 1978 machine did this because fewer sprites meant a shorter draw loop; here ' +
          'it is on purpose, because it turned out to be the best thing about the game.',
      },
    ],
    faq: [
      { q: 'Why can I only have two shots on screen?', a: 'That is the original limit and it is what stops the game becoming a hold-to-win. Missing costs you the time until the shot leaves the top of the screen.' },
      { q: 'Do the bunkers come back?', a: 'No. They erode from both sides — your own shots damage them too — so by wave three you are usually out in the open.' },
      { q: 'What happens if they reach the bottom?', a: 'The run ends immediately, regardless of how many lives you have left. Letting them land is not survivable.' },
    ],
    related: ['moon-buggy', 'bastet', 'breakout'],
  },

  {
    slug: 'wumpus',
    cat: 'terminal',
    name: 'Hunt the Wumpus',
    glyph: '?',
    term: true,
    wide: true,
    cols: 64,
    script: 'terminal/wumpus.js',
    pad: 'dpad',
    engine: 'The 1973 cave, unchanged',
    title: 'Hunt the Wumpus — The 1973 Cave Game, In Your Browser',
    ogTitle: 'Hunt the Wumpus: deduce, then shoot',
    description: 'Gregory Yob\'s 1973 classic. Twenty rooms in a dodecahedron, three tunnels each, warnings ' +
      'from next door. Work out where it sleeps, then shoot a crooked arrow.',
    short: 'Twenty rooms, three tunnels, one wumpus.',
    h1: 'Hunt the Wumpus',
    hero: 'You never see the cave. You get a smell, a draught, the sound of wings &mdash; and from those you have ' +
      'to work out which of twenty rooms it is sleeping in. Fifty years old, and still one of the purest ' +
      'deduction games ever written.',
    facts: ['The original 1973 map', 'Twenty rooms, three tunnels each', 'Warnings only from next door', 'Five crooked arrows'],
    hud: [
      { key: 'score', label: 'Score' },
      { key: 'best', label: 'Best', accent: true },
      { key: 'room', label: 'Room', init: '1' },
      { key: 'arrows', label: 'Arrows', init: '5' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-shoot">Shoot an arrow</button>',
    ],
    keys: [
      { k: '← →', d: 'Choose a tunnel' },
      { k: '↑', d: 'Ready an arrow, or put it away' },
      { k: 'Space', d: 'Go, or shoot' },
    ],
    touch: 'Pad left and right to pick a tunnel, up to ready an arrow, Action to go or shoot.',
    infoHeading: 'Why the map matters',
    info: [
      {
        h: 'A dodecahedron, not a grid',
        p: 'Every room has exactly three tunnels and the layout is the one Gregory Yob used in 1973. It is ' +
          'regular enough to reason about and irregular enough that you cannot hold a picture of it in your ' +
          'head, which is exactly the property that makes deduction the only way through.',
      },
      {
        h: 'The arrow is crooked on purpose',
        p: 'It travels up to five rooms, following the tunnel you chose and then wandering. It can come back ' +
          'round and hit you, which is the original\'s cruellest rule and the reason a wild guess is genuinely ' +
          'dangerous rather than merely wasteful.',
      },
    ],
    faq: [
      { q: 'What do the warnings mean?', a: 'A smell means the wumpus is in one of the three rooms next to you. A draught means a bottomless pit. Wings mean giant bats, which will pick you up and drop you somewhere random.' },
      { q: 'Can I map the cave?', a: 'Yes, and that is how the game is meant to be played — with a pen. The room numbers are stable for the whole run.' },
      { q: 'What happens if I miss?', a: 'The noise usually wakes the wumpus and it moves to a neighbouring room, so a miss does not just cost an arrow, it invalidates your map.' },
    ],
    related: ['greed', 'robots', 'minesweeper'],
  },

  /* ----------------------------------------------------------------- board */
  {
    slug: 'ludo',
    cat: 'board',
    name: 'Ludo',
    glyph: '⚄',
    script: 'board/ludo.js',
    players: 4,
    soloAI: true,
    width: 600, height: 600, pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Against the computer, or pass and play',
    title: 'Ludo — Play Free Online Against The Computer, No Sign-Up',
    ogTitle: 'Ludo, on your own or around one phone',
    description: 'Ludo for one to four players. Play the computer on your own, or pass one device around the ' +
      'table. Two, three or four seats — no ads, nothing uploaded.',
    short: 'Play the computer, or pass the phone round.',
    h1: 'Ludo',
    hero: 'Four tokens each, a six to get out, and the long-running argument about whose turn it was. Play it ' +
      'against the computer on your own, or hand the device round the table for two, three or four people.',
    facts: [
      'Against the computer, or pass and play',
      'Two, three or four players',
      'No account and no app',
      'Nothing is uploaded',
    ],
    hud: [
      { key: 'turn', label: 'Turn', accent: true, init: 'Red' },
      { key: 'dice', label: 'Dice', init: '—' },
      { key: 'home', label: 'Home', init: '0/4' },
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Pass &amp; play</option></select>',
      '<label class="sr-only" for="game-players">Players</label>',
      '<select class="game-select" autocomplete="off" id="game-players"><option value="2">2 players</option><option value="3">3 players</option><option value="4" selected>4 players</option></select>',
      '<button class="game-btn game-btn-primary" type="button" id="game-roll">Roll</button>',
    ],
    keys: [
      { k: 'Space', d: 'Roll the dice, or move the ringed token' },
      { k: 'Arrows', d: 'Cycle which legal token is ringed' },
      { k: 'Click', d: 'Tap a highlighted token to move it' },
    ],
    touch: 'Tap Roll, then tap the token you want to move &mdash; the ones you may legally move are ringed in white.',
    infoHeading: 'Two details worth knowing',
    info: [
      {
        h: 'Two players sit opposite, not side by side',
        p: 'With two, the game seats red and yellow across the board from each other, which is how it is played ' +
          'on a real set. Seating them in adjacent corners quietly gives one player a much shorter run to their ' +
          'home column, and the empty corners are not drawn at all &mdash; an unused yard on the board just ' +
          'looks like somebody walked off mid-game.',
      },
      {
        h: 'A single legal move plays itself',
        p: 'If a roll leaves you exactly one thing you are allowed to do, the game does it rather than asking ' +
          'you to click your only option. It also tells you whose turn it is on the button itself, so a Roll ' +
          'that is not yours reads as &ldquo;Green is thinking&rdquo; instead of silently doing nothing.',
      },
    ],
    faq: [
      { q: 'Can I play against another person?', a: 'Yes, on the same device — choose Pass &amp; play and hand it round. There is no online play: it would need a server to hold the game, and this site has none.' },
      { q: 'How good is the computer?', a: 'Decent, not brilliant. It prefers leaving the yard, then capturing, then getting a token home, then advancing whichever token is furthest along. It will beat you if you play carelessly and it will not out-think you.' },
      { q: 'What are the star squares?', a: 'Safe squares. A token standing on one cannot be captured, which makes them worth racing for when somebody is closing in behind you.' },
      { q: 'Do I need an exact roll to get home?', a: 'Yes. A token has to land exactly on the final home square, so an over-roll simply is not a legal move for it. That is the standard rule and it is what makes the last few squares tense.' },
      { q: 'What happens on three sixes?', a: 'The turn is forfeited. A six normally earns another roll, so without that rule a lucky streak could run indefinitely.' },
      { q: 'Does it work on a phone?', a: 'Yes. Tap Roll, then tap the token you want to move — the legal ones are ringed in white.' },
    ],
    related: ['snake', '2048', 'minesweeper'],
  },
  {
    slug: 'chess',
    cat: 'board',
    name: 'Chess',
    glyph: '♞',
    script: 'board/chess.js',
    players: 2,
    soloAI: true,
    /* 592, not 560: the bottom 32px is the status strip. Drawn INSIDE the
       board's height it covered the bottom rank exactly when a message was
       explaining what had just happened there. */
    width: 560, height: 592, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Full rules &middot; minimax with alpha-beta',
    title: 'Chess — Play The Computer Free In Your Browser, No Sign-Up',
    ogTitle: 'Chess with all the awkward rules in it',
    description: 'Chess against a real engine: castling, en passant, promotion, stalemate, threefold ' +
      'repetition and the fifty-move rule. Three strengths, take-backs, no account.',
    short: 'A real engine, and all the awkward rules.',
    h1: 'Chess',
    hero: 'Not a chessboard with a random-move generator behind it. This searches, prunes, and looks past the ' +
      'obvious recapture &mdash; and it plays every rule the game actually has, including the three that most ' +
      'browser chess quietly leaves out.',
    facts: [
      'Against the computer, or pass and play',
      'Castling, en passant, promotion',
      'Stalemate, fifty-move, repetition, insufficient material',
      'Three strengths',
      'Take back a move',
      'Legal moves shown as you pick a piece',
    ],
    hud: [
      { key: 'turn', label: 'Turn', accent: true, init: 'White' },
      { key: 'move', label: 'Move', init: '1' },
      { key: 'material', label: 'Material', init: '0.0' },
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Pass &amp; play</option></select>',
      '<label class="sr-only" for="game-level">Strength</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="2">Casual</option><option value="3" selected>Club</option><option value="4">Strong</option></select>',
      '<button class="game-btn" type="button" id="game-undo">Take back</button>',
      '<button class="game-btn game-btn-icon" type="button" id="game-flip" aria-pressed="false" title="Flip the board" aria-label="Flip the board">⇅</button>',
    ],
    keys: [
      { k: 'Click', d: 'Pick a piece, then a highlighted square' },
    ],
    touch: 'Tap a piece to see where it can go, then tap the square. Dots are quiet moves, rings are captures.',
    infoHeading: 'What is actually under it',
    info: [
      {
        h: 'A 0x88 board',
        p: 'The squares live in a 16&times;8 array, so testing whether a square is on the board is one bitwise ' +
          'AND rather than four comparisons. That single trick is why sliding a queen along eight directions ' +
          'is cheap enough to do millions of times a second, and it is how chess programs did it for decades.',
      },
      {
        h: 'Legality by making the move',
        p: 'Every candidate move is played, the king is checked for attack, and the move is taken back. It is ' +
          'slower than working out pins directly and about a tenth of the code &mdash; and at these depths ' +
          'being right matters much more than being fast.',
      },
      {
        h: 'It looks past the obvious recapture',
        p: 'After the main search runs out of depth, a second search continues on captures alone until the ' +
          'position is quiet. Without that the engine hangs a bishop on the last ply and scores it as winning, ' +
          'because the recapture is one move beyond where it stopped looking.',
      },
      {
        h: 'The rules people leave out',
        p: 'En passant, castling rights that expire when a rook is captured on its home square, promotion, ' +
          'stalemate as a draw rather than a loss, the fifty-move counter, and king-versus-king-and-bishop ' +
          'being drawn. Every one of them is here, because a chess game that gets them wrong is not chess.',
      },
    ],
    faq: [
      { q: 'Can two people play?', a: 'Yes — switch to Pass &amp; play and the engine steps out entirely. Both sides are yours to move, which is what a chessboard on a table already is. Take back then undoes one move rather than a pair.' },
      { q: 'How strong is it?', a: 'Club level at the default setting — it searches three ply plus captures, so it will punish a hanging piece and a one-move tactic every time, and it will not see a deep combination coming. Strong searches four and takes a second or two to reply.' },
      { q: 'Can I take a move back?', a: 'Yes, and it takes back the pair, so it is your turn again. Useful for exploring rather than for cheating, though nothing stops you.' },
      { q: 'Does it do under-promotion?', a: 'No — a promoted pawn always becomes a queen. Under-promotion matters in perhaps one game in a thousand and the dialogue it needs is miserable on a phone.' },
      { q: 'Is there an opening book?', a: 'No. It works everything out from the position, which is why its first few moves are sensible but not fashionable.' },
      { q: 'Is anything sent anywhere?', a: 'No. The engine runs in your tab. There is no server, no analysis upload, and no account.' },
    ],
    related: ['ludo', 'carrom', 'minesweeper'],
  },

  {
    slug: 'carrom',
    cat: 'board',
    name: 'Carrom',
    glyph: '⊙',
    script: 'board/carrom.js',
    players: 2,
    soloAI: true,
    width: 560, height: 560, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Elastic collisions &middot; sub-stepped',
    title: 'Carrom — Play Free Online Against The Computer, No Sign-Up',
    ogTitle: 'Carrom, with the physics done properly',
    /* "Drag back FROM the striker" was geometrically impossible — pressing
       on the striker slides it, since it sits on the baseline. The shot is
       a slingshot ANCHORED at the striker: press anywhere clear of it,
       pull back behind it, release. The copy now describes the game that
       ships. */
    description: 'The carrom board in your browser. Pull back behind the striker and let go — real elastic ' +
      'collisions, pockets, the queen, and fouls for sinking the striker.',
    short: 'Flick the striker, sink the coins.',
    h1: 'Carrom',
    hero: 'Press anywhere open, pull back behind the striker &mdash; a slingshot anchored at it &mdash; and let ' +
      'go. The coins behave: every impact is resolved along the line between the two centres, so a thin cut ' +
      'sends a coin sideways exactly the way it does on a real board, and a full-face hit drives it straight.',
    facts: ['Against the computer or pass and play', 'The queen is worth three', 'Fouls for sinking the striker', 'Real collision physics'],
    hud: [
      { key: 'you', label: 'You', accent: true, init: '0' },
      { key: 'them', label: 'Them', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Pass &amp; play</option></select>',
    ],
    keys: [
      { k: 'Click', d: 'Tap the baseline to slide the striker' },
      { k: 'Drag', d: 'Press off the baseline, pull back behind the striker, release' },
    ],
    touch: 'Tap the baseline to slide the striker along it, then press anywhere clear of it, pull back behind the striker, and let go to shoot.',
    infoHeading: 'The two things that make it feel right',
    info: [
      {
        h: 'Overlap is undone before the bounce',
        p: 'Resolving only the velocities leaves two coins slightly inside each other; next frame they collide ' +
          'again, and again, and the pair looks glued together and buzzing. Pushing them apart along the ' +
          'contact normal first is a three-line fix and the difference between coins and jelly.',
      },
      {
        h: 'The physics runs in small steps',
        p: 'A hard shot moves the striker further in one frame than a coin is wide, so it would pass straight ' +
          'through. The simulation takes six small steps per frame instead of one big one, which keeps every ' +
          'contact on the near side of the coin it is supposed to hit.',
      },
    ],
    faq: [
      { q: 'How do I aim?', a: 'Tap along your baseline to slide the striker sideways, then put your finger down anywhere clear of the baseline and pull back behind the striker — the catapult is anchored at the striker, not at your finger. The dashed line shows where the shot is actually going.' },
      { q: 'What is the queen worth?', a: 'Three points, against one for an ordinary coin. The computer will go for it when the line is there.' },
      { q: 'What happens if I pocket the striker?', a: 'A foul: everything you sank on that stroke comes back to the centre — the queen included — plus one of your own pocketed coins. If you have none pocketed yet, you owe one, and it is paid out of the first coin you do sink.' },
      { q: 'Do I keep the board if I score?', a: 'Yes. Sink a coin cleanly and you shoot again. Miss, or foul, and it passes over.' },
    ],
    related: ['chess', 'ludo', 'air-hockey'],
  },

  /* -------------------------------------------------------------------- cs */
  {
    slug: 'guess-the-algorithm',
    cat: 'cs',
    name: 'Guess the algorithm',
    glyph: '⇅',
    script: 'cs/guess-the-algorithm.js',
    width: 640, height: 400, pad: 'none',
    bestKey: 'guess-the-algorithm',
    tapAction: false,
    engine: 'Six sorts &middot; recorded, then replayed',
    title: 'Guess The Algorithm — Name The Sort From Its Animation',
    ogTitle: 'Six sorts. One bar chart. Name it before it finishes.',
    description: 'Six sorting algorithms animated on a bar chart. Name the one running before it finishes — the earlier you call it, the more it is worth.',
    short: 'Name the sort from its animation.',
    h1: 'Guess the algorithm',
    hero: 'A sort starts running on twenty-four bars and you have twelve seconds to say which one it is. ' +
      'Every run takes the same twelve seconds whatever it costs, so the clock cannot give it away &mdash; the ' +
      'giveaway has to be the movement. After each round you get the tell that separates that sort from the ones ' +
      'it is most often confused with.',
    facts: ['Six sorts, properly implemented', 'Every run is the same length', 'The tell explained each round', 'Nothing is uploaded'],
    hud: [
      { key: 'round', label: 'Round', init: '1/5' },
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'worth', label: 'Worth now', init: '—' },
      { key: 'best', label: 'Best' },
    ],
    extra: '<div class="algo-panel">' +
      '<div class="algo-options" role="group" aria-label="Name the algorithm">' +
      '<button class="game-btn algo-opt" type="button" id="algo-opt-0" disabled>&hellip;</button>' +
      '<button class="game-btn algo-opt" type="button" id="algo-opt-1" disabled>&hellip;</button>' +
      '<button class="game-btn algo-opt" type="button" id="algo-opt-2" disabled>&hellip;</button>' +
      '<button class="game-btn algo-opt" type="button" id="algo-opt-3" disabled>&hellip;</button>' +
      '</div>' +
      '<p class="algo-verdict" id="algo-verdict" role="status" aria-live="polite">Press Play, then name the sort before the bars finish.</p>' +
      '<button class="btn btn-primary algo-next" type="button" id="algo-next" hidden>Next round</button>' +
      '</div>',
    keys: [
      { k: 'Click', d: 'Name the sort' },
      { k: '← →', d: 'Move between the four names' },
      { k: 'Enter', d: 'Lock in the highlighted name' },
    ],
    touch: 'Tap one of the four names under the chart, then Next round to carry on.',
    infoHeading: 'How to tell six sorts apart',
    info: [
      {
        h: 'Swapped, or overwritten?',
        p: 'This is the first question, and it halves the field immediately. Bubble, selection, quicksort and ' +
          'heapsort trade two bars at a time, so heights move around the chart. Insertion and merge sort ' +
          'overwrite positions instead, so bars change height where they stand. Once you can see which of the two ' +
          'is happening you are choosing between three, not six.',
      },
      {
        h: 'Which end is filling up',
        p: 'Bubble sort and heapsort both build their answer from the right, and people mix them up constantly. ' +
          'The difference is what the left looks like while they do it: bubble sort leaves the unsorted part ' +
          'getting gradually tidier, because every pass nudges everything a little; heapsort leaves it in heap ' +
          'order, which looks like nothing at all. Selection and insertion sort both fill from the left, and ' +
          'there the difference is noise &mdash; selection sort scans in silence and swaps once, insertion sort ' +
          'shifts a whole run of neighbours for every element.',
      },
      {
        h: 'Recorded first, then replayed',
        p: 'ES5 has no generators, and a recursive sort cannot be paused halfway down its own call stack. So each ' +
          'sort here runs to completion the moment the round starts, logging every comparison, swap and write, ' +
          'and the animation replays that log. The algorithms stay textbook rather than being rewritten as ' +
          'state machines to make them pausable.',
      },
      {
        h: 'Where to go next',
        p: 'This is a recognition drill, not a tutorial. The <a href="/labs/algorithm-visualizer">algorithm ' +
          'visualiser</a> in Labs runs twenty-one of them with live comparison counts and lets you put any two ' +
          'side by side at the same speed, which is the honest way to see why one is faster than another.',
      },
    ],
    faq: [
      { q: 'Are these real implementations?', a: 'Yes. Bubble, selection, insertion, merge, quicksort and heapsort are written as they are normally written, and every run is checked to produce a sorted array. Nothing is faked for the animation.' },
      { q: 'Does the speed give it away?', a: 'The duration does not — every run is stretched or squeezed to the same twelve seconds. The number of steps still differs, so quicksort changes the picture less often than bubble sort does, and you are welcome to use that. It is real information about the cost.' },
      { q: 'Why only twenty-four bars?', a: 'Enough for the patterns to be distinguishable, few enough that individual bars are visible on a phone. At two hundred bars everything looks like static and the only thing you can read is the overall shape.' },
      { q: 'How is the score worked out?', a: 'A correct answer is worth a hundred points at the start of a run, falling to five as it finishes. A wrong answer or running out of time scores nothing, and you get one guess per round. Five rounds, so five hundred is the maximum.' },
    ],
    related: ['game-of-life', 'subnet-sprint', 'phishing-or-not'],
  },

  {
    slug: 'ctf-arcade',
    cat: 'cs',
    name: 'CTF arcade',
    glyph: '{}',
    script: 'cs/ctf-arcade.js',
    board: true, pad: 'none',
    bestKey: 'ctf-arcade',
    engine: 'Twelve artefacts &middot; nothing to install',
    title: 'CTF Arcade — Beginner Capture-The-Flag Challenges In Your Browser',
    ogTitle: 'Twelve artefacts. Twelve flags.',
    description: 'Twelve small capture-the-flag challenges: base64, hex, ROT13, Vigenere, cookies and an EXIF dump. ' +
      'Decode the artefact, type the flag, read why it worked.',
    short: 'Decode the artefact. Type the flag.',
    h1: 'CTF arcade',
    hero: 'Twelve artefacts, each with a flag hidden in it in the form <code>CTF{...}</code>. They start at a base64 ' +
      'blob and end at two-layer chains, and every one finishes with a plain explanation of what the encoding actually ' +
      'was and a link to the lab that does that job properly. Hints cost points, but never more than giving up costs ' +
      'you anyway.',
    facts: ['Twelve challenges', 'Base64 through to Vigenere', '1000 points with no hints', 'Best kept on this device'],
    hud: [
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'solved', label: 'Solved', init: '0/12' },
      { key: 'best', label: 'Best' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-hint">Hint</button>',
      '<button class="game-btn" type="button" id="game-skip">Show the answer</button>',
    ],
    keys: [
      { k: 'Type', d: 'The flag, braces and all' },
      { k: 'Enter', d: 'Check it, then move on' },
    ],
    touch: 'Tap the panel to raise the keyboard, type the flag and press enter; the artefact keeps its own scrollbar, so you can still select it and copy it out.',
    infoHeading: 'What twelve small challenges are actually for',
    info: [
      {
        h: 'Encoding is not encryption',
        p: 'Half the ladder is base64, hex, binary and percent-encoding, and none of them have a key. They exist to ' +
          'carry bytes through something that only accepts text, the tables are public, and anyone who recognises one ' +
          'can undo it. Treating base64 as though it hides anything is a real mistake made in real systems, usually ' +
          'in a cookie or a URL parameter.',
      },
      {
        h: 'Identify the layer before you touch it',
        p: 'The chains at the end are the point of the whole thing. Hex is always an even count of characters from a ' +
          'set of sixteen; base64 is a set of sixty-four in blocks of four, usually with padding; a Caesar or a ' +
          'Vigenere leaves the punctuation exactly where it was and moves only the letters. Three checks, done in ' +
          'that order, take apart most layered puzzles without guessing.',
      },
      {
        h: 'Hints cost points and cannot cost you more than quitting',
        p: 'A hint is worth forty per cent of the challenge, and the cost is only subtracted if you then solve it. ' +
          'Giving up scores zero whether you read the hint or not, so reading one is at worst free. The alternative ' +
          '— charging for the hint the moment it is shown — teaches people to sit and stare rather than ask, which ' +
          'is the opposite of useful.',
      },
      {
        h: 'This is the recon end of a CTF, and only that end',
        p: 'A real competition has web exploitation, binary exploitation, reversing and forensics in it, and those ' +
          'need tooling and a machine you are allowed to break. What this ladder covers is the part every category ' +
          'starts with: looking at an artefact and working out what it is. The <a href="/labs/encoding">encoder</a>, ' +
          'the <a href="/labs/cipher">cipher playground</a>, the <a href="/labs/exif">EXIF viewer</a> and the ' +
          '<a href="/labs/url-inspector">URL inspector</a> in Labs are the same jobs without a scoreboard.',
      },
    ],
    faq: [
      { q: 'What format should the answer be in?', a: 'The whole flag, from CTF{ to the closing brace. Spaces around it and the wrong case are both forgiven; leaving the braces off is not, because the wrapper is part of the flag in every competition you will enter.' },
      { q: 'Do I need any tools to solve these?', a: 'No. Every challenge can be done by hand, and each explanation links to the lab that does the same job if you would rather not. Nothing is timed, so take as long as you like over one.' },
      { q: 'Are the answers hidden from me?', a: 'Not really — the flags are in the page\'s JavaScript, and anyone determined can open the file and read them. This is a practice ladder rather than a competition, so there is nothing to protect and no reason to pretend otherwise.' },
      { q: 'Is this a real capture the flag?', a: 'It is one slice of one. Real events add exploitation, reversing and forensics, which need a target you have permission to attack. This covers recognising and undoing encodings, which is where almost every challenge begins.' },
      { q: 'Does anything I type leave the browser?', a: 'No. There are no network calls in the game at all, and the only thing stored is your best score, in this browser on this device.' },
    ],
    related: ['phishing-or-not', 'subnet-sprint', 'password-duel'],
  },

  {
    slug: 'guess-the-output',
    cat: 'cs',
    name: 'Guess the output',
    glyph: '⏎',
    board: true,
    script: 'cs/guess-the-output.js',
    pad: 'none',
    bestKey: 'guess-the-output',
    engine: 'Eighteen snippets &middot; JavaScript, Python and C',
    title: 'Guess The Output — Code Snippet Quiz, Free In Your Browser',
    ogTitle: 'It does not print what you think it prints.',
    description: 'Eighteen short snippets in JavaScript, Python and C that do not print what they look like. ' +
      'Pick the output, then read exactly why it does that.',
    short: 'Eighteen snippets that surprise everyone.',
    h1: 'Guess the output',
    hero: 'Eighteen short snippets in JavaScript, Python and C, every one of them doing something the code ' +
      'does not look like it does. Pick what it prints from four options, then read why. The explanation is ' +
      'the point here &mdash; it appears whether you were right or wrong.',
    facts: ['Eighteen snippets', 'JavaScript, Python and C', 'The reason after every answer', 'Nothing is uploaded'],
    hud: [
      { key: 'seen', label: 'Seen', accent: true, init: '0/18' },
      { key: 'right', label: 'Right', init: '0' },
      { key: 'best', label: 'Best' },
    ],
    controls: [
      '<label class="sr-only" for="game-lang">Language</label>',
      '<select class="game-select" autocomplete="off" id="game-lang"><option value="all" selected>All three languages</option><option value="JavaScript">JavaScript only</option><option value="Python">Python only</option><option value="C">C only</option></select>',
    ],
    keys: [
      { k: 'Click', d: 'Pick an answer, then read why' },
      { k: 'Tab', d: 'Move between the four options' },
      { k: 'Enter', d: 'Choose the focused option' },
    ],
    touch: 'Tap one of the four answers, read the reason, then tap Next.',
    infoHeading: 'Why these eighteen',
    info: [
      {
        h: 'The explanation is the product',
        p: 'Getting one of these wrong tells you nothing by itself, so every answer &mdash; right or wrong ' +
          '&mdash; opens the reason: which rule produced that output, and what to write instead. Most of them ' +
          'end in a habit worth keeping, like passing a comparator to <code>sort</code> or using ' +
          '<code>bag=None</code> instead of a mutable default.',
      },
      {
        h: 'Undefined behaviour is not a synonym for wrap-around',
        p: 'The C question about adding one to <code>INT_MAX</code> has "undefined behaviour" as its correct ' +
          'answer rather than -2147483648, because that is the true answer and the difference costs people ' +
          'real bugs. A compiler entitled to assume signed overflow never happens is entitled to delete the ' +
          'overflow check you wrote, and it does.',
      },
      {
        h: 'Two answers depend on the machine, and say so',
        p: '<code>sizeof</code> on an array parameter gives the size of a pointer &mdash; eight bytes on the ' +
          '64-bit builds nearly everyone uses, four on a 32-bit one &mdash; so the option carries that ' +
          'condition rather than asserting a bare number. The Python identity question is the same case: ' +
          'small-integer caching is a CPython implementation detail, not a rule of the language.',
      },
      {
        h: 'The same bug twice, in two languages',
        p: 'The JavaScript <code>var</code> loop and the Python comprehension full of lambdas are one ' +
          'mistake &mdash; a closure capturing a variable rather than its value &mdash; printing 3 3 3 and ' +
          '[2, 2, 2] for exactly the same reason. Meeting them side by side is worth more than meeting ' +
          'either on its own.',
      },
    ],
    faq: [
      { q: 'Are these real outputs?', a: 'Yes. Every JavaScript and Python snippet was run before it went in, and the C claims about sizes and conversions were checked with static assertions on an x86-64 build. Where the output depends on the compiler or the implementation, the option says so.' },
      { q: 'Do I need to know all three languages?', a: 'No. Each snippet is short enough to read cold, and the filter in the toolbar narrows the run to one language if you would rather. The C questions are the ones people who do not write C find hardest, and also the ones the explanations do the most work on.' },
      { q: 'Is the order the same every time?', a: 'No. The questions shuffle, and so do the four options under each one, so a second run is not a test of where the buttons were last time.' },
      { q: 'What does Best mean?', a: 'The most you have got right in a single run on this device, kept in local storage and nowhere else. Filtering to one language leaves fewer questions in the run, so those scores will not usually beat a full one.' },
    ],
    related: ['subnet-sprint', 'phishing-or-not', 'game-of-life'],
  },

  {
    slug: 'assembly-puzzles',
    cat: 'cs',
    name: 'Assembly puzzles',
    glyph: 'MOV',
    board: true,
    script: 'cs/assembly-puzzles.js',
    pad: 'none',
    bestKey: 'assembly-puzzles', bestOrder: 'low',
    tapAction: false,
    engine: 'Fifteen instructions, four registers, 32 cells',
    title: 'Assembly Puzzles &mdash; Write Assembly In Your Browser, Free',
    ogTitle: 'Eight problems, fifteen instructions',
    description: 'Write programs for a tiny virtual machine with four registers and fifteen instructions. ' +
      'Eight problems, each checked against every test case and scored on size.',
    short: 'Eight problems on a tiny machine.',
    h1: 'Assembly puzzles',
    hero: 'A machine with four registers, thirty-two memory cells and fifteen instructions, and eight ' +
      'problems to solve on it &mdash; from copying a number to reversing a list. Your program is run ' +
      'against every test case, not just the one on screen, and the score is the instructions you wrote ' +
      'plus every cycle the machine spent. Shorter programs and tighter loops both count.',
    facts: ['Fifteen instructions', 'Four registers, 32 cells', 'Eight levels', 'Every test case checked'],
    hud: [
      { key: 'level', label: 'Level', init: '1/8' },
      { key: 'cost', label: 'Cost', accent: true, init: '0' },
      { key: 'best', label: 'Best', init: '&mdash;' },
    ],
    controls: [
      '<label class="sr-only" for="game-level">Level</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="0" selected>1. Copy a value</option><option value="1">2. Add two numbers</option><option value="2">3. The larger of two</option><option value="3">4. Sum a list</option><option value="4">5. Count down</option><option value="5">6. Multiply without MUL</option><option value="6">7. Largest in a list</option><option value="7">8. Reverse a list</option></select>',
      '<button class="game-btn" type="button" id="game-run">Run</button>',
      '<button class="game-btn" type="button" id="game-step">Step</button>',
      '<button class="game-btn" type="button" id="game-check">Check</button>',
    ],
    keys: [
      { k: 'Type', d: 'Write the program' },
      { k: 'Step', d: 'One instruction at a time' },
      { k: 'Run', d: 'Watch the chosen test case' },
      { k: 'Check', d: 'Run every test case' },
    ],
    touch: 'Tap the program box to bring up the keyboard; Run, Step and Check are in the toolbar above it.',
    infoHeading: 'What the machine will and will not do',
    info: [
      {
        h: 'The score counts two different things',
        p: 'Cost is the number of instructions you wrote plus every cycle the machine executed across all ' +
          'the test cases. Counting only length would reward a clever one-liner that loops ten thousand ' +
          'times; counting only cycles would reward unrolling the whole thing by hand. Counting both is ' +
          'roughly the trade every real compiler is making. Par is shown against each level, and it is ' +
          'measured by running a reference solution in this same machine rather than written down.',
      },
      {
        h: 'The flag behaves the way real flags do',
        p: '<code>CMP a, b</code> sets the flag to a minus b, but so do ADD, SUB, MUL, INC and DEC, from ' +
          'their own result. That is why <code>DEC R0</code> followed by <code>JNE loop</code> is a ' +
          'complete countdown with no compare in it &mdash; the same reason the equivalent pair is the ' +
          'commonest loop on x86. MOV, IN and OUT leave the flag alone.',
      },
      {
        h: 'Why level six takes MUL away',
        p: 'Early processors had no multiplier at all, and multiplying meant a loop of additions &mdash; ' +
          'which is why multiplication cost tens of cycles when addition cost one. Doing it by hand once ' +
          'makes the cost model of a CPU much less abstract. Real hardware does better than repeated ' +
          'addition by shifting and adding, roughly one step per bit rather than one per unit.',
      },
      {
        h: 'This is not a real instruction set',
        p: 'There is no stack, no CALL or RET, no addressing beyond a register holding an address, and no ' +
          'overflow behaviour to speak of &mdash; a value too large for the machine is treated as your ' +
          'mistake rather than silently wrapped. It teaches the shape of the thing: registers are few, ' +
          'memory is separate, branches are conditional jumps on a flag somebody else set. Anything you ' +
          'learn here transfers as intuition, not as syntax.',
      },
    ],
    faq: [
      { q: 'Is this x86, ARM or MIPS?', a: 'None of them. It is invented, and deliberately small, so the whole instruction set fits on one screen. The register-and-flag model is closest to x86 in spirit.' },
      { q: 'Why does it say "still running after 20000 instructions"?', a: 'A loop with no way out. Usually the counter is being tested before it is decremented, or the jump goes back above the instruction that changes it.' },
      { q: 'Can I have more than four registers?', a: 'No, and that is most of the difficulty from level seven onwards. Memory is the answer: 32 cells, addressed as [6] or as [R1] when the address is in a register.' },
      { q: 'Are my programs saved?', a: 'They are kept in this browser only, per level, and nothing is sent anywhere. Restart clears your progress but leaves the code; clearing site data removes both.' },
      { q: 'Is a lower score better?', a: 'Yes. Cost is the one number where less is better, so your best is the lowest total you have posted on this device.' },
    ],
    related: ['subnet-sprint', 'phishing-or-not', 'game-of-life'],
  },

  {
    slug: 'regex-golf',
    cat: 'cs',
    name: 'Regex golf',
    glyph: '.*',
    board: true,
    script: 'cs/regex-golf.js',
    pad: 'none',
    bestKey: 'regex-golf',
    tapAction: false,
    engine: 'new RegExp in a try/catch, with a stopwatch on every test',
    title: 'Regex Golf — Write The Shortest Pattern, Free In Your Browser',
    ogTitle: 'Twelve regexes, as short as you can',
    description: 'Write the shortest regular expression that matches every string in one list and none in the ' +
      'other. Twelve levels, with live ticks and crosses as you type.',
    short: 'Shortest pattern that separates two lists.',
    h1: 'Regex golf',
    hero: 'Two lists of strings. Write one regular expression that matches everything on the left and nothing ' +
      'on the right &mdash; then write a shorter one. Your score is the number of characters you spend across ' +
      'the twelve levels, so this is the rare game here where a low number is the good one.',
    facts: ['Twelve levels', 'Shortest pattern wins', 'Live ticks and crosses', 'Refuses a ReDoS'],
    hud: [
      { key: 'level', label: 'Level', init: '1/12' },
      { key: 'score', label: 'Characters' },
      { key: 'best', label: 'Best', accent: true },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-hint" aria-pressed="false">Hint</button>',
    ],
    keys: [
      { k: 'Type', d: 'Your pattern' },
      { k: 'Enter', d: 'Next level, once it passes' },
    ],
    touch: 'Tap the field and type; the ticks and crosses update as you go, and the next level is a button.',
    infoHeading: 'What this teaches, and what it does not',
    info: [
      {
        h: 'Par is a target, not a proof',
        p: 'Each level shows the shortest answer this game was built around. It is the shortest one found, ' +
          'not the shortest one possible, and several levels have answers that ignore the technique the level ' +
          'is named after entirely. Beating par is the interesting part, and nothing here believes you cannot.',
      },
      {
        h: 'A golfed pattern is not a validator',
        p: 'The email level falls to <code>\\w@\\w</code>, five characters, and that pattern would be useless ' +
          'against a real address. That is the honest lesson of the whole game: a pattern tuned to eight ' +
          'strings tells you about those eight strings. Regular expressions that have to survive input you ' +
          'have not seen are a different job, and usually a longer one.',
      },
      {
        h: 'Why a pattern can be refused',
        p: 'Two guards. The first reads your pattern for one unbounded repeat inside another &mdash; ' +
          '<code>(a+)+</code> and its relatives &mdash; and refuses it before running it. The second times ' +
          'the tests and blacklists anything that ran long. The second one only fires after the damage: ' +
          'JavaScript cannot cancel a regular expression once the engine is inside it, which is precisely ' +
          'what makes a ReDoS a denial of service rather than a slow query.',
      },
      {
        h: 'Where the backtracking actually happens',
        p: 'The engine tries one way of splitting the input, fails, comes back and tries the next. With ' +
          'nested repeats there are exponentially many splittings, and it will try all of them before it ' +
          'admits there is no match. The <a href="/labs/regex-engine">regex engine lab</a> steps through ' +
          'that one move at a time, which is a good deal more convincing than a paragraph about it.',
      },
    ],
    faq: [
      { q: 'Which flavour of regular expression is this?', a: 'Your browser\'s own. Patterns are built with <code>new RegExp</code> and no flags, so matching is case sensitive and a pattern with no anchors can match anywhere in the string.' },
      { q: 'Can I use lookahead, backreferences or named groups?', a: 'Yes. Anything your browser\'s engine accepts, it will accept here. Whether it is shorter than the boring answer is another matter.' },
      { q: 'Why was my pattern refused?', a: 'Either it has an unbounded repeat nested inside another one, which is the shape that causes catastrophic backtracking, or it took longer than 40 milliseconds against eight short strings, which means it was already doing it.' },
      { q: 'Is par really the shortest possible?', a: 'No, and no claim is made that it is. It is the shortest the author found. Several of these lists almost certainly have shorter answers.' },
      { q: 'Does anything leave the browser?', a: 'No. There is no network call in the game at all. The only thing stored is your best total, in this browser, under a key you can clear with your site data.' },
    ],
    related: ['git-quest', 'subnet-sprint', 'phishing-or-not'],
  },
  {
    slug: 'git-quest',
    cat: 'cs',
    name: 'Git quest',
    glyph: '⎇',
    script: 'cs/git-quest.js',
    board: true, pad: 'none',
    bestKey: 'git-quest',
    engine: 'Eighteen git commands over an in-memory object store',
    title: 'Git Quest — Learn Git By Fixing Repositories',
    ogTitle: 'Nineteen missions, one toy repository',
    description: 'Nineteen missions solved by typing real git commands: init, commit, branch, merge, rebase, reset, revert and a reflog rescue, against a toy repository.',
    short: 'Nineteen missions, one toy repository.',
    h1: 'Git quest',
    hero: 'Reading about git is the weaker half of learning it. Here is the stronger half: a repository ' +
      'that exists only in this page, eighteen git commands reimplemented over it, and nineteen missions ' +
      'that walk from <code>git init</code> to a capstone that uses the whole toolbox. The commit graph redraws beside the ' +
      'terminal as you type, because <em>a branch is a sticky note on a commit</em> is a sentence you ' +
      'believe only after watching the label slide while the dots stay put.',
    facts: ['Eighteen git commands', 'Nineteen missions', 'The graph drawn as you type', 'Break it freely — retry rebuilds'],
    hud: [
      { key: 'mission', label: 'Mission', accent: true, init: '1/19' },
      { key: 'cmds', label: 'Commands', init: '0' },
      { key: 'best', label: 'Best' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-help">Commands</button>',
      '<button class="game-btn" type="button" id="game-hint">Hint</button>',
    ],
    keys: [
      { k: 'Type', d: 'A command' },
      { k: 'Enter', d: 'Run it' },
      { k: '↑ ↓', d: 'Command history' },
      { k: 'Tab', d: 'Complete a word' },
      { k: 'Esc', d: 'Clear the line' },
    ],
    touch: 'Tap the terminal to raise the keyboard; the Commands and Hint buttons above do the same as typing help and hint.',
    infoHeading: 'What this teaches, and how honestly',
    info: [
      {
        h: 'A reimplementation, not git',
        p: 'Every command here is JavaScript over an in-memory object store: commits are snapshots with ' +
          'parents, branches are labels holding one id, HEAD is a pointer, and the hashes are pretend. ' +
          'Nothing executes on your machine and nothing is stored beyond your best score. The real thing ' +
          'is one <code>git init</code> away in any terminal, and it works exactly like the toy &mdash; ' +
          'that is the point of the toy.',
      },
      {
        h: 'A scene per mission, so exploring cannot break anything',
        p: 'Each mission rebuilds the repository into a curated starting state. Wander off the brief as far ' +
          'as you like &mdash; make branches, reset things, detach HEAD &mdash; and <code>retry</code> puts ' +
          'the scene back without touching your progress. The goals check repository state, not the order ' +
          'you typed things in, so any route that gets there counts.',
      },
      {
        h: 'The graph is the lesson',
        p: 'The panel beside the terminal redraws the commit graph and the three places &mdash; working ' +
          'tree, index, HEAD &mdash; after every command. Watching <code>reset --soft</code> move one of ' +
          'the three while <code>--hard</code> moves all of them teaches more than any table. The prose ' +
          'half of this game is the article <a href="/blog/git-explained-from-the-object-up">Git, ' +
          'explained from the object up</a>, written alongside it.',
      },
      {
        h: 'What is deliberately missing',
        p: 'There are no remotes: no push, pull, fetch or clone, because this page makes no network calls ' +
          'by design and a pretend server would hand out pretend lessons. Conflict resolution is ' +
          '<code>--ours</code>/<code>--theirs</code> rather than an editor, and there is no interactive ' +
          'rebase. The companion article covers the collaboration half properly.',
      },
    ],
    faq: [
      { q: 'Is this real git?', a: 'No. Eighteen commands are reimplemented in JavaScript over an in-memory object store, and the hashes are pretend. The model — snapshots, parents, labels, the index, the reflog — matches the real thing, which is what the game is for.' },
      { q: 'Do I need to know git already?', a: 'No. The first mission is git init and each one introduces the next idea. If you want the theory in prose first, read Git, explained from the object up on the blog — the game and the article were written together.' },
      { q: 'Why is there no push or pull?', a: 'This page makes no network calls, by design, and a simulated server would hand out simulated lessons. Remotes, force-with-lease and the collaboration model are covered in the companion article instead.' },
      { q: 'Can I get stuck?', a: 'Not permanently. retry rebuilds the current mission&rsquo;s scene from scratch, hint nudges, and Restart begins a fresh run. Exploring beyond the brief cannot wedge a later mission, because every mission builds its own scene.' },
      { q: 'What counts towards the best score?', a: 'Every command you run, including help, hint and the ones git refuses. Lower is better, and somewhere around seventy on a first pass is a respectable showing.' },
      { q: 'Does anything I type leave the page?', a: 'No. There are no network calls anywhere in this game. The only thing stored is the command count of your best run, in this browser.' },
    ],
    related: ['shell-quest', 'ctf-arcade', 'password-duel'],
  },

  {
    slug: 'shell-quest',
    cat: 'cs',
    name: 'Shell quest',
    glyph: '$_',
    script: 'cs/shell-quest.js',
    board: true, pad: 'none',
    bestKey: 'shell-quest',
    engine: 'Thirteen commands over an in-memory filesystem',
    title: 'Shell Quest — Learn The Command Line By Using It',
    ogTitle: 'Eight puzzles, one pretend shell',
    description: 'Eight puzzles solved by typing real commands. ls, grep, find, chmod, wc, file and strings, ' +
      'against a small filesystem that lives in the page and nowhere else.',
    short: 'Eight puzzles, one pretend shell.',
    h1: 'Shell quest',
    hero: 'Eight things to find, and the only way to look is by typing. Thirteen Unix commands are ' +
      'implemented here &mdash; <code>ls</code>, <code>cd</code>, <code>cat</code>, <code>grep</code>, ' +
      '<code>find</code>, <code>chmod</code>, <code>head</code>, <code>tail</code>, <code>wc</code>, ' +
      '<code>file</code>, <code>strings</code>, <code>echo</code> and <code>pwd</code> &mdash; over a ' +
      'filesystem that exists only in this page. They are reimplementations, not a shell, and the puzzles ' +
      'get harder as the commands you need get less obvious.',
    facts: ['Thirteen commands', 'Eight quests', 'Not a real shell', 'Your best kept on this device'],
    hud: [
      { key: 'quest', label: 'Quest', accent: true, init: '1/8' },
      { key: 'cmds', label: 'Commands', init: '0' },
      { key: 'best', label: 'Best' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-help">Commands</button>',
      '<button class="game-btn" type="button" id="game-hint">Hint</button>',
    ],
    keys: [
      { k: 'Type', d: 'A command' },
      { k: 'Enter', d: 'Run it' },
      { k: '↑ ↓', d: 'Command history' },
      { k: 'Tab', d: 'Complete a name' },
      { k: 'Esc', d: 'Clear the line' },
    ],
    touch: 'Tap the terminal to raise the keyboard; the Commands and Hint buttons above do the same as typing help and hint.',
    infoHeading: 'What this is, and what it is not',
    info: [
      {
        h: 'Thirteen reimplementations, not a shell',
        p: 'Every command here is a few dozen lines of JavaScript walking an object tree. There is no ' +
          'process, no kernel, no job control, and deliberately no pipes, no redirection and no variables, ' +
          'because each of those needs a parser and none of them makes a puzzle better. If you want the ' +
          'real thing &mdash; a kernel, a package manager, a shell that can be broken &mdash; ' +
          '<a href="/labs/linux">/labs/linux</a> boots one in the browser.',
      },
      {
        h: 'The answers are read back out of the files',
        p: 'The logs are generated from one fixed seed, and the accepted address in <code>auth.log</code>, ' +
          'the unit that failed at the end of <code>boot.log</code> and the length of the longest line in ' +
          '<code>notes.txt</code> are then computed from that generated text by the same functions your ' +
          '<code>grep</code> and <code>wc</code> call. Writing an answer down next to a 200-line log is how ' +
          'it comes to disagree with the log a year later.',
      },
      {
        h: 'file reads bytes, and names are not evidence',
        p: 'One of the uploads is a PNG called <code>photo.txt</code> and one is plain text called ' +
          '<code>notes.png</code>. <code>file</code> ignores both names and looks at the first few bytes: ' +
          'a PNG starts with <code>89 50 4E 47</code>, a gzip stream with <code>1F 8B</code>, an ELF ' +
          'binary with <code>7F 45 4C 46</code>. That is the whole trick, and it is why an extension is a ' +
          'suggestion rather than a fact.',
      },
      {
        h: 'The permission model is simpler than the real one',
        p: 'Real Unix modes are three sets of three bits for user, group and others, plus setuid, setgid ' +
          'and the sticky bit, and on a directory the execute bit means something different again. ' +
          '<code>chmod</code> here sets all nine bits correctly and <code>ls -l</code> prints them ' +
          'correctly, but only the owner read bit is ever consulted when deciding whether you may read a ' +
          'file, because there is exactly one user and modelling the rest would add explaining without ' +
          'adding a puzzle.',
      },
    ],
    faq: [
      { q: 'Is this a real Linux shell?', a: 'No. Thirteen commands are reimplemented in JavaScript over a filesystem held in memory. For a real kernel and a real shell, both running in the browser, use the Linux terminal in Labs.' },
      { q: 'Are there pipes and redirection?', a: 'No. No |, no >, no variables and no command substitution. Every quest is solvable with one command at a time, and several are easier that way.' },
      { q: 'Why does wc -c disagree with a real machine?', a: 'Files here are JavaScript strings, so wc counts characters. A real wc counts bytes, and any character outside ASCII is more than one byte. Everything in this filesystem is ASCII, so for these files the two happen to agree.' },
      { q: 'Is the filesystem the same every time?', a: 'Yes. One fixed seed builds it, so the logs, the addresses and the answers are identical on every run and on every device. Restarting resets the permissions you changed.' },
      { q: 'What counts towards the best score?', a: 'Every command you run, including help, hint, clear and wrong answers. Lower is better, and a first pass of around thirty is a reasonable showing.' },
      { q: 'Does anything I type leave the page?', a: 'No. There are no network calls anywhere in this game. The only thing stored is the number of commands your best run took, in this browser.' },
    ],
    related: ['subnet-sprint', 'phishing-or-not', 'typespeed'],
  },


  {
    slug: 'phishing-or-not',
    cat: 'cs',
    name: 'Phishing or not',
    glyph: '✉',
    script: 'cs/phishing-or-not.js',
    board: true, pad: 'none',
    bestKey: 'phishing-or-not',
    engine: 'Twenty specimens &middot; half of them real',
    title: 'Phishing Or Not — Can You Spot The Fake? Free Quiz',
    ogTitle: 'Half of these are real. That is the hard part.',
    description: 'Twenty emails and texts, half genuine. Call each one and get the reason immediately — ' +
      'including why several of the alarming ones are perfectly real.',
    short: 'Twenty specimens. Half are genuine.',
    h1: 'Phishing or not',
    hero: 'The hard part of this is not the fakes. It is that half the specimens are <em>real</em> messages ' +
      'containing everything you have been told to fear &mdash; urgency, a link, a demand to act &mdash; and ' +
      'several of the attacks contain none of it. Suspicion alone will fail you here, which is the point.',
    facts: ['Half of them are genuine', 'The reason shown after every answer', 'Attacks with no link at all', 'Nothing is uploaded'],
    hud: [
      { key: 'seen', label: 'Seen', accent: true, init: '0/20' },
      { key: 'right', label: 'Right', init: '0' },
      { key: 'best', label: 'Best' },
    ],
    keys: [{ k: 'Click', d: 'Call it, then read why' }],
    touch: 'Tap Legitimate or Phishing, then read the reason before moving on.',
    infoHeading: 'Why the real ones matter more',
    info: [
      {
        h: 'A quiz of obvious fakes teaches nothing',
        p: 'If every genuine message in a test is calm and every attack is frantic, the lesson people take away ' +
          'is "be suspicious of anything urgent" &mdash; which makes them ignore real security alerts and does ' +
          'nothing about a well-written attack. Several specimens here are genuine warnings that look alarming ' +
          'because they are alarming.',
      },
      {
        h: 'The domain is the only reliable tell',
        p: 'Read a domain right to left: the part immediately before the final <code>.com</code> is the bit ' +
          'somebody owns. <code>company.com.mailquota-support.net</code> belongs to whoever owns ' +
          '<code>mailquota-support.net</code>. That single habit catches most of what is here &mdash; and the ' +
          '<a href="/labs/url-inspector">URL inspector</a> in Labs does it for you on a real link.',
      },
      {
        h: 'Some attacks have no link to inspect',
        p: 'The invoice with a phone number, the "hi mum" text, the message from a chief executive asking for a ' +
          'quiet transfer &mdash; none of them contains anything to hover over. Advice built entirely around ' +
          'checking links has nothing to say about the attacks that cost the most money.',
      },
      {
        h: 'It shuffles',
        p: 'The order changes every run, so a second attempt is a second attempt rather than a memory test.',
      },
    ],
    faq: [
      { q: 'Are these real messages?', a: 'They are faithful reconstructions of both real attacks and real service emails, with names and numbers changed. Nothing here links anywhere.' },
      { q: 'I got the genuine ones wrong. Is that bad?', a: 'It is the most common result and the most useful one. Calling everything phishing is not security — it means ignoring the alerts that matter, which is its own risk.' },
      { q: 'What should I actually do with a suspicious message?', a: 'Do not click, and do not use any phone number it gives you. Open the site or app yourself and check from there. It reaches the same place and cannot be faked.' },
    ],
    related: ['password-duel', 'subnet-sprint', 'cyber-hygiene'],
  },

  {
    slug: 'password-duel',
    cat: 'cs',
    name: 'Password duel',
    glyph: '🔓',
    script: 'cs/password-duel.js',
    board: true, pad: 'none', bestKey: null,
    engine: 'A real search, in a Web Worker',
    title: 'Password Duel — Watch Your Password Get Cracked, Live',
    ogTitle: 'Type a password. Watch it fall.',
    description: 'Type a password and watch a real cracking run go after it — wordlist, then mangling rules, ' +
      'then brute force. Nothing uploaded; it runs in a worker in your tab.',
    short: 'Type one. Watch it fall.',
    h1: 'Password duel',
    hero: 'Type a password &mdash; ideally one you have actually used &mdash; and watch a genuine cracking run ' +
      'go after it: the common list first, then the same list mangled the way people mangle it, then brute ' +
      'force. Nothing leaves the tab, and the number at the end is scaled to real hardware rather than to your ' +
      'laptop.',
    facts: ['Wordlist, then rules, then brute force', 'Runs in a Web Worker', 'Nothing is uploaded', 'The estimate uses real cracking hardware'],
    hud: [{ key: 'state', label: 'Status', accent: true, init: 'waiting' }],
    keys: [{ k: 'Enter', d: 'Attack the password' }],
    touch: 'Type a password and tap Attack it.',
    infoHeading: 'Why the numbers here are different',
    info: [
      {
        h: 'Your browser is a terrible cracker, and that would flatter you',
        p: 'A tab manages perhaps a hundred thousand guesses a second. A rented eight-GPU machine does tens of ' +
          'billions against a fast unsalted hash. Quoting the browser figure would make almost anything look ' +
          'safe, so the estimate is scaled to the real thing &mdash; and the page says which hash it is assuming.',
      },
      {
        h: 'The rules phase is the one that hurts',
        p: 'Real cracking does not go straight to brute force. It takes a wordlist and applies the substitutions ' +
          'people actually make: a capital at the front, @ for a, 0 for o, a year on the end. ' +
          '<code>P@ssw0rd2024</code> is not a long password to a cracker, it is a short one with decoration.',
      },
      {
        h: 'Length beats cleverness',
        p: 'Every character you add multiplies the search space by the size of your character set. Every clever ' +
          'substitution adds nothing, because the rule engine already knows it. Four ordinary words beat any ' +
          'amount of punctuation, and the arithmetic under the result shows why.',
      },
      {
        h: 'It genuinely does not leave the tab',
        p: 'The worker is built from a Blob URL inside the page, which is the only way to run off-thread code ' +
          'under this site\'s content security policy. There is no network call in this file at all &mdash; ' +
          'check the network tab while it runs.',
      },
    ],
    faq: [
      { q: 'Is it safe to type my real password?', a: 'It never leaves your browser and is not stored, so technically yes — but as a habit, typing a live password into any web page is a bad one. Type something structurally identical instead.' },
      { q: 'It said "not cracked" — am I safe?', a: 'Not necessarily. The browser gives up after a few seconds; real hardware does not. The estimate below the result is the number that matters.' },
      { q: 'Why does adding ! at the end barely help?', a: 'Because the rule engine tries it. Suffixes and substitutions are the first thing a cracker applies to a wordlist, so they cost an attacker almost nothing.' },
      { q: 'Is there a tool version of this?', a: 'Yes — the <a href="/labs/password">password lab</a> and the <a href="/labs/hash-cracker">live hash cracker</a> in Labs do the same work without a score attached.' },
    ],
    related: ['phishing-or-not', 'cyber-hygiene', 'subnet-sprint'],
  },

  {
    slug: 'subnet-sprint',
    cat: 'cs',
    name: 'Subnet sprint',
    glyph: '/24',
    script: 'cs/subnet-sprint.js',
    board: true, pad: 'none',
    bestKey: 'subnet-sprint',
    engine: 'Generated and solved, never stored',
    title: 'Subnet Sprint — Timed CIDR Practice, Free In Your Browser',
    ogTitle: 'Two minutes of subnetting',
    description: 'Timed CIDR questions: usable hosts, network and broadcast addresses, masks, which prefix ' +
      'fits a host count. Generated fresh, so the bank never runs out.',
    short: 'Two minutes of CIDR, generated fresh.',
    h1: 'Subnet sprint',
    hero: 'Two minutes, as many CIDR questions as you can get through. Every question is generated from a random ' +
      'address and solved with the same bitwise arithmetic a router uses &mdash; so there is no question bank ' +
      'to memorise and no chance of a wrong answer sitting in a table nobody checked.',
    facts: ['Six question types', 'Generated and solved, never stored', 'Two minutes', 'Your best kept on this device'],
    hud: [
      { key: 'right', label: 'Right', accent: true, init: '0' },
      { key: 'wrong', label: 'Wrong', init: '0' },
      { key: 'best', label: 'Best' },
    ],
    keys: [{ k: 'Type', d: 'Your answer' }, { k: 'Enter', d: 'Submit' }],
    touch: 'Tap the panel to bring up the keyboard, type the answer and press enter.',
    infoHeading: 'One arithmetic detail worth knowing',
    info: [
      {
        h: 'Masks are negative numbers in JavaScript',
        p: 'A /24 mask is <code>0xFFFFFF00</code>, and JavaScript\'s bitwise operators treat that as a signed ' +
          '32-bit value &mdash; so it is negative, and printing it without an unsigned shift gives nonsense. ' +
          'Every calculation here ends in <code>&gt;&gt;&gt; 0</code>. It is the classic bug in hand-written ' +
          'subnet code and it only shows up at the extremes.',
      },
      {
        h: 'Nothing is memorisable',
        p: 'Because the questions are generated rather than drawn from a list, the only way to get faster is to ' +
          'get better at the arithmetic. There is a <a href="/labs/subnet">subnet calculator</a> in Labs that ' +
          'does the same sums without a clock.',
      },
    ],
    faq: [
      { q: 'What format should answers be in?', a: 'Dotted decimal for addresses and masks, a plain number for host counts, yes or no for the same-subnet questions, and either /26 or 26 for a prefix.' },
      { q: 'Why is a /31 not two usable hosts?', a: 'It is, by RFC 3021, for point-to-point links — but the question uses the classic formula everywhere else, so the range here stops at /29 to avoid teaching an edge case as a rule.' },
      { q: 'Is there a calculator version?', a: 'Yes, in Labs. This is the same maths with a timer on it.' },
    ],
    related: ['phishing-or-not', 'password-duel', 'greed'],
  },

  /* ------------------------------------------------------------------- toy */
  {
    slug: 'rain',
    cat: 'toy',
    name: 'Rain',
    glyph: '◌',
    term: true,
    wide: true,
    cols: 78,
    script: 'toy/rain.js',
    pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Character grid &middot; rings computed from a radius',
    title: 'Rain — The BSD Screensaver, With Ripples That Spread',
    ogTitle: 'Rain, with the ripples the original never had',
    description: 'The BSD rain screensaver rebuilt in a terminal grid. Drops fall, land, and throw out ' +
      'concentric rings that widen and fade. Density and speed controls.',
    short: 'Drops land and the rings spread.',
    h1: 'Rain',
    hero: 'The screensaver that shipped with BSD games drew a dot, then an o, then an O, all in one spot, and ' +
      'called it a raindrop. This one lets the drop land and spread: rings in box-drawing and punctuation that ' +
      'widen, thin out and dissolve. Nothing about a ring is stored anywhere &mdash; every cell of it is worked ' +
      'out from the radius, every frame.',
    facts: ['Rings computed, not stored', 'Four densities', 'Round on 2:1 cells', 'No score, no clock'],
    hud: [
      { key: 'drops', label: 'Falling', init: '0' },
      { key: 'ripples', label: 'Ripples', accent: true, init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-density">Density</label>',
      '<select class="game-select" autocomplete="off" id="game-density"><option value="2">Drizzle</option><option value="6" selected>Steady</option><option value="16">Heavy</option><option value="40">Downpour</option></select>',
      '<label class="sr-only" for="game-speed">Speed</label>',
      '<select class="game-select" autocomplete="off" id="game-speed"><option value="0.5">Slow</option><option value="1" selected>Normal</option><option value="2">Fast</option></select>',
    ],
    touch: 'Nothing to do. Watch it, or change the density and watch it harder.',
    infoHeading: 'How the ripples are drawn',
    info: [
      {
        h: 'A ripple is a centre and a number',
        p: 'The obvious way to animate a spreading ring is to keep the cells it has lit and age them. That ' +
          'costs memory per ripple and per cell, and where two ripples overlap you then have to decide which ' +
          'one owns the cell as they fade. Here a ripple is a position and a radius, the radius grows with ' +
          'time, and the cells are derived from it fresh on every frame by walking the angle. A ripple is one ' +
          'small object; drawing one costs about one write per cell it actually touches. That is why Downpour ' +
          'can put two hundred of them on screen and the frame rate does not notice.',
      },
      {
        h: 'A round ring is an ellipse in cells',
        p: 'A character cell here is 8 units wide and 16 tall. Plot an honest circle in cell coordinates and it ' +
          'arrives on screen as a tall oval. Every vertical offset is halved, so the ring is an ellipse in the ' +
          'grid and a circle to look at.',
      },
      {
        h: 'The glyph comes from the tangent',
        p: 'At the left and right edges of a ring the curve runs vertically, so those cells get │. At the top ' +
          'and bottom it runs flat, so they get ─. The diagonals lean, and get / or \\. Choosing the character ' +
          'from the direction out of the centre rather than from the direction the curve travels is an easy ' +
          'mistake and turns every ring inside out.',
      },
      {
        h: 'Fading in four steps',
        p: 'A terminal has no alpha channel, so the fade is four colour bands &mdash; white, cyan, blue, then ' +
          'dim &mdash; with the leading edge always one band brighter than the two rings trailing it. The dim ' +
          'band is also drawn at half density, in a fixed alternating pattern rather than a random one: random ' +
          'dropout would make a ring flicker every frame instead of dissolving.',
      },
    ],
    faq: [
      { q: 'Is this the same rain that comes with Linux?', a: 'It is the same idea. The BSD games version animates three characters in place; this adds the spreading rings, a landing drop, and controls for how hard it rains.' },
      { q: 'Why is it silent?', a: 'At the Downpour setting there are forty landings a second. A plink on each one stops being rain and starts being a fault alarm.' },
      { q: 'Is there anything to do?', a: 'No. It is a screensaver, which is why it sits under toys rather than games. There is no score and nothing is saved.' },
      { q: 'Why 78 columns and not 80?', a: 'Ripples near the edge get clipped, and two columns of margin means the widest of them still reads as a ring rather than as a stray bracket.' },
    ],
    related: ['cmatrix', 'pipes', 'cbonsai'],
  },

  {
    slug: 'aafire',
    cat: 'toy',
    name: 'aafire',
    glyph: '*',
    term: true,
    wide: true,
    cols: 78,
    script: 'toy/aafire.js',
    pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Character grid &middot; one averaging pass per frame',
    title: 'aafire — The ASCII Fire Effect, Free In Your Browser',
    ogTitle: 'ASCII fire, and the one pass that makes it',
    description: 'The aalib fire demo in a terminal grid. A heat buffer, one averaging pass a frame, ' +
      'and a ramp of characters. Wind and intensity controls, no score.',
    short: 'Averaged numbers that look like fire.',
    h1: 'aafire',
    hero: 'The fire demo from aalib, the library that draws pictures out of characters. Worth knowing: ' +
      'nothing in it rises. Every cell is the average of the cells below it minus a small decay, run once ' +
      'a frame, and the flame is that arithmetic plus ten characters put in the right order.',
    facts: ['One averaging pass per frame', 'Ten characters, ordered by ink', 'Wind is a weight, not a shift', 'No score, no clock'],
    hud: [
      { key: 'flame', label: 'Flame height', accent: true, init: '0 rows' },
      { key: 'alight', label: 'Screen alight', init: '0%' },
    ],
    controls: [
      '<label class="sr-only" for="game-wind">Wind</label>',
      '<select class="game-select" autocomplete="off" id="game-wind"><option value="-1">Strong left</option><option value="-0.5">Left</option><option value="0" selected>Still</option><option value="0.5">Right</option><option value="1">Strong right</option></select>',
      '<label class="sr-only" for="game-intensity">Intensity</label>',
      '<select class="game-select" autocomplete="off" id="game-intensity"><option value="low">Embers</option><option value="normal" selected>Fire</option><option value="high">Inferno</option></select>',
    ],
    touch: 'Nothing to do. The two dropdowns are the whole of the controls.',
    infoHeading: 'How the fire is made',
    info: [
      {
        h: 'One pass, upward',
        p: 'Two rows of random heat sit below the bottom of the screen. Every frame each cell takes the ' +
          'average of the three cells below it and the one below those, then loses a small random amount. ' +
          'Heat climbs exactly one row per pass and thins as it goes, and that is the whole simulation ' +
          '&mdash; no particles, no velocities, no flames as objects.',
      },
      {
        h: 'The ramp does the rest',
        p: 'The buffer is a field of numbers between nought and one. What makes it read as fire is the ten ' +
          'characters it is mapped onto, ordered by how much of a cell they fill: a full stop, a colon, up ' +
          'through x and S to a hash and a dollar sign. Shuffle that list and the same numbers stop looking ' +
          'like anything at all.',
      },
      {
        h: 'Wind is a weight',
        p: 'Leaning the fire by sampling an offset column snaps to whole cells, so a light breeze and a gale ' +
          'come out the same. Here the three samples from the row below are weighted 1+w, 1 and 1-w instead. ' +
          'They still sum to four, so the pass stays a true average and the wind moves heat sideways without ' +
          'creating or destroying any.',
      },
      {
        h: 'The bed is not re-rolled',
        p: 'The source rows keep their values, and only about a quarter of their cells get a new one each ' +
          'frame. Randomise all of them every frame and the averaging smooths the result into a flat orange ' +
          'band; letting hot spots persist for a few frames is what gives them time to climb into tongues.',
      },
    ],
    faq: [
      { q: 'Is this the real aafire?', a: 'No. It is the same effect written from scratch for a browser. The original is a C program driving aalib, but the arithmetic is the same idea and the character ramp is chosen the same way.' },
      { q: 'Why does the flame stop short of the top?', a: 'The decay. Each row up costs a fixed slice of heat, so the fire runs out at a predictable height. Inferno lowers the decay far enough that it reaches the ceiling.' },
      { q: 'Is there anything to do?', a: 'Change the wind and watch it lean. That is it, which is why this is filed under toys rather than games.' },
    ],
    related: ['cmatrix', 'pipes', 'falling-sand'],
  },


  {
    slug: 'cmatrix',
    cat: 'toy',
    name: 'cmatrix',
    glyph: 'ｱ',
    term: true,
    wide: true,
    script: 'toy/cmatrix.js',
    pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Character grid &middot; the glyphs do not fall',
    title: 'cmatrix — The Falling Green Glyphs, In Your Browser',
    ogTitle: 'The green rain, and how it actually works',
    description: 'The cmatrix screensaver, rebuilt for the browser. Green glyph rain in eighty columns, with a ' +
      'speed control. Nothing to install.',
    short: 'The green rain. Nothing to win.',
    h1: 'cmatrix',
    hero: 'The screensaver every Linux machine has had since 1999. Worth knowing: the characters do not actually ' +
      'fall &mdash; each cell holds a glyph that rarely changes, and what moves is a bright head with a fading ' +
      'trail sweeping over letters that were already sitting there.',
    facts: ['The glyphs do not fall', 'Three speeds', 'No score, no clock', 'Runs at 80 columns'],
    hud: [{ key: 'drops', label: 'Columns raining', accent: true, init: '0' }],
    controls: [
      '<label class="sr-only" for="game-speed">Speed</label>',
      '<select class="game-select" autocomplete="off" id="game-speed"><option value="0.5">Slow</option><option value="1" selected>Normal</option><option value="2.2">Fast</option></select>',
    ],
    touch: 'Nothing to do. Watch it.',
    infoHeading: 'The trick in it',
    info: [
      {
        h: 'Nothing scrolls',
        p: 'A scrolling text buffer would need a history and would tear at the edges. Instead every cell holds ' +
          'a character that only occasionally mutates, and each column has a falling <em>brightness</em> &mdash; ' +
          'a white head, a bright tail, then dim. The rain is a lighting effect over a static field.',
      },
      {
        h: 'Not every column at once',
        p: 'About two in three columns carry a drop at any moment. Fill them all and it stops reading as rain ' +
          'and starts reading as a solid green wall, which is the commonest mistake in a clone.',
      },
    ],
    faq: [
      { q: 'What are the characters?', a: 'Half-width katakana plus digits and punctuation, which is what the original used — chosen because they are visually dense and unfamiliar enough not to read as words.' },
      { q: 'Is there anything to do?', a: 'No. It is a screensaver. That is why it is filed under toys.' },
    ],
    related: ['pipes', 'cbonsai', 'game-of-life'],
  },

  {
    slug: 'pipes',
    cat: 'toy',
    name: 'Pipes',
    glyph: '┼',
    term: true,
    wide: true,
    script: 'toy/pipes.js',
    pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'Character grid &middot; box-drawing corners',
    title: 'Pipes — The Terminal Screensaver, Free In Your Browser',
    ogTitle: 'Pipes, with the corners the right way round',
    description: 'The pipes screensaver in a terminal grid. Pipes wander, turn and wrap, filling the screen ' +
      'until it is too dense to read, then start again.',
    short: 'Pipes wander until the screen fills.',
    h1: 'Pipes',
    hero: 'Pipes walk, turn, wrap around the edges and paint over each other until the screen is full. The only ' +
      'genuinely fiddly part is the corners, and it is the part most clones get half wrong.',
    facts: ['Corners keyed on both directions', 'Wraps at every edge', 'Clears when it fills', 'No score, no clock'],
    hud: [{ key: 'filled', label: 'Screen filled', accent: true, init: '0%' }],
    controls: [
      '<label class="sr-only" for="game-speed">Speed</label>',
      '<select class="game-select" autocomplete="off" id="game-speed"><option value="12">Slow</option><option value="26" selected>Normal</option><option value="60">Fast</option></select>',
      '<label class="sr-only" for="game-count">Pipes</label>',
      '<select class="game-select" autocomplete="off" id="game-count"><option value="2">2 pipes</option><option value="4" selected>4 pipes</option><option value="8">8 pipes</option></select>',
    ],
    touch: 'Nothing to do. Watch it.',
    infoHeading: 'The corners',
    info: [
      {
        h: 'A corner needs both directions',
        p: 'Which of ┌ ┐ └ ┘ belongs at a bend depends on where the pipe came FROM as well as where it is ' +
          'going. Choosing from the new direction alone gets exactly half of them backwards, and the result ' +
          'looks subtly broken in a way that is hard to point at.',
      },
      {
        h: 'It clears on coverage, not on a timer',
        p: 'The original restarts after a fixed number of frames, which cuts a slow run short and lets a fast ' +
          'one turn to mush. This one waits until about seventy per cent of the screen is covered.',
      },
    ],
    faq: [
      { q: 'Why do pipes change colour at the edges?', a: 'A pipe that wraps takes a new colour, so its reappearance on the far side reads as a new pipe rather than as a rendering glitch.' },
      { q: 'What are the bright dots?', a: 'The head of each pipe, so you can follow one if you want to.' },
    ],
    related: ['cmatrix', 'cbonsai', 'boids'],
  },

  {
    slug: 'cbonsai',
    cat: 'toy',
    name: 'cbonsai',
    glyph: '⌘',
    term: true,
    script: 'toy/cbonsai.js',
    pad: 'action', bestKey: null,
    engine: 'Recursive branching &middot; seeded',
    title: 'cbonsai — Grow An ASCII Bonsai In Your Browser',
    ogTitle: 'Grow a bonsai out of one number',
    description: 'A bonsai grown from a recursive branch with a life counter. Same seed, same tree — so the one ' +
      'you liked can be grown again.',
    short: 'Grow a tree. Keep the seed.',
    h1: 'cbonsai',
    hero: 'A branch that walks upward, leans, and sometimes splits &mdash; each child inheriting less life than ' +
      'its parent. That one counter is the whole tree: thick at the base because the trunk still has budget, ' +
      'sparse and leafy at the tips because its children did not.',
    facts: ['Seeded — the same number grows the same tree', 'Grows in front of you', 'No score, no clock', 'A new one every press'],
    hud: [
      { key: 'seed', label: 'Seed', accent: true, init: '—' },
      { key: 'parts', label: 'Parts', init: '0' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-grow">Grow another</button>',
      '<button class="game-btn game-btn-icon" type="button" id="game-live" aria-pressed="true" title="Growing slowly" aria-label="Toggle slow growth">≈</button>',
    ],
    keys: [{ k: 'Space', d: 'Grow another' }],
    touch: 'Tap Grow another, or tap the tree.',
    infoHeading: 'One counter makes the shape',
    info: [
      {
        h: 'Life, inherited and reduced',
        p: 'Every branch carries a budget that drains as it grows, and a split hands its child about sixty per ' +
          'cent of what is left. When a branch runs out it turns into a cluster of leaves. Nothing else decides ' +
          'the silhouette &mdash; no rules about trunk thickness or crown shape, just that one number going down.',
      },
      {
        h: 'The seed is shown so you can keep it',
        p: 'Every tree comes from a seeded generator and the seed is printed underneath. Without that, the ' +
          'good one you grew is gone the moment you press again, which makes the only interaction it has ' +
          'faintly sad.',
      },
    ],
    faq: [
      { q: 'Can I grow the same tree twice?', a: 'Yes — that is what the seed under the pot is for. The same seed always produces the same tree.' },
      { q: 'Why does it grow slowly?', a: 'Because watching it is the point. The button next to Grow another switches to instant if you would rather.' },
    ],
    related: ['cmatrix', 'pipes', 'falling-sand'],
  },

  {
    slug: 'game-of-life',
    cat: 'toy',
    name: 'Game of Life',
    glyph: '▦',
    script: 'toy/game-of-life.js',
    width: 576, height: 384, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Conway &middot; a wrapping torus',
    title: "Conway's Game of Life — Draw On It, Free In Your Browser",
    ogTitle: 'Four rules, and nobody can predict them',
    description: "Conway's Game of Life with a glider gun, a pulsar and the R-pentomino built in. Draw your " +
      'own cells, change the speed, watch it go. Nothing uploaded.',
    short: 'Four rules, endlessly unpredictable.',
    h1: 'Game of Life',
    hero: 'A live cell with two or three neighbours survives; a dead one with exactly three comes alive. That is ' +
      'the entire rule set, and it is enough to build a pattern that fires gliders forever. Draw on the grid and ' +
      'see what your own shapes do.',
    facts: ['Draw on it while it runs', 'Glider gun, pulsar, R-pentomino', 'The grid wraps', 'No score, no clock'],
    hud: [
      { key: 'gen', label: 'Generation', accent: true, init: '0' },
      { key: 'alive', label: 'Alive', init: '0' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-run">Stop</button>',
      '<label class="sr-only" for="game-pattern">Pattern</label>',
      '<select class="game-select" autocomplete="off" id="game-pattern"><option value="gun" selected>Glider gun</option><option value="pulsar">Pulsar</option><option value="glider">Glider</option><option value="rpentomino">R-pentomino</option></select>',
      '<label class="sr-only" for="game-speed">Speed</label>',
      '<select class="game-select" autocomplete="off" id="game-speed"><option value="4">Slow</option><option value="12" selected>Normal</option><option value="30">Fast</option></select>',
      '<button class="game-btn" type="button" id="game-random">Random</button>',
      '<button class="game-btn" type="button" id="game-clear">Clear</button>',
    ],
    keys: [{ k: 'Space', d: 'Run or pause' }, { k: 'Click', d: 'Draw and erase cells' }],
    touch: 'Drag on the grid to draw cells. Dragging from a live cell erases instead.',
    infoHeading: 'Two decisions worth stating',
    info: [
      {
        h: 'The grid wraps around',
        p: 'An infinite plane is not on offer and a bounded one quietly changes the rules at the edges &mdash; ' +
          'gliders die there, which makes the most famous pattern in the subject look broken. A torus gives ' +
          'every cell exactly eight neighbours, everywhere.',
      },
      {
        h: 'Drawing has no mode switch',
        p: 'Start a drag on a dead cell and you are drawing; start it on a live one and you are erasing. One ' +
          'gesture does both, which matters when you are trying to poke a hole in something already running.',
      },
    ],
    faq: [
      { q: 'What is the glider gun?', a: "Bill Gosper's pattern from 1970 — the first arrangement found that grows without limit, firing a glider every thirty generations. It won a fifty-dollar prize." },
      { q: 'Is there a way to win?', a: 'No. It is a zero-player automaton: you set the starting cells and the rules do the rest. That is why it is filed under toys rather than games.' },
      { q: 'Why does my random soup settle down?', a: 'Almost all random starts collapse into a mixture of still lifes and small oscillators within a few hundred generations. The interesting patterns are the rare ones that do not.' },
    ],
    related: ['falling-sand', 'boids', 'greed'],
  },

  {
    slug: 'falling-sand',
    cat: 'toy',
    name: 'Falling sand',
    glyph: '░',
    script: 'toy/falling-sand.js',
    width: 640, height: 440, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Cellular physics &middot; six materials',
    title: 'Falling Sand — A Powder Toy In Your Browser, Free',
    ogTitle: 'Sand, water, wood and fire',
    description: 'A falling-sand powder toy. Sand piles, water levels itself, fire eats wood and is put out by ' +
      'water. Draw with any of them. No sign-up, nothing uploaded.',
    short: 'Sand piles, water levels, fire spreads.',
    h1: 'Falling sand',
    hero: 'One rule per material and nothing else. Sand only slips diagonally, so it makes slopes. Water also ' +
      'moves sideways, so it finds its level. Fire spreads into wood and dies in water. Everything that looks ' +
      'like physics here is those few lines arguing with each other.',
    facts: ['Six materials', 'Draw with any of them', 'Fire spreads and is quenched', 'No score, no clock'],
    hud: [
      { key: 'tool', label: 'Drawing', accent: true, init: 'Sand' },
    ],
    controls: [
      '<label class="sr-only" for="game-tool">Material</label>',
      '<select class="game-select" autocomplete="off" id="game-tool"><option value="sand" selected>Sand</option><option value="water">Water</option><option value="wall">Stone</option><option value="wood">Wood</option><option value="fire">Fire</option><option value="eraser">Eraser</option></select>',
      '<label class="sr-only" for="game-brush">Brush</label>',
      '<select class="game-select" autocomplete="off" id="game-brush"><option value="2">Small</option><option value="3" selected>Medium</option><option value="6">Large</option></select>',
      '<button class="game-btn" type="button" id="game-clear">Clear</button>',
    ],
    keys: [{ k: 'Click', d: 'Draw with the chosen material' }],
    touch: 'Drag anywhere to draw. Pick the material and brush size from the toolbar.',
    infoHeading: 'The one non-obvious detail',
    info: [
      {
        h: 'The grid is scanned bottom-up',
        p: 'Scan downward and you move a grain, then meet it again a row lower and move it again &mdash; sand ' +
          'teleports to the floor in a single frame rather than falling. Going upward means every cell is ' +
          'considered exactly once per frame, which is the whole difference between gravity and a glitch.',
      },
      {
        h: 'Water levels itself for free',
        p: 'Sand can only move down or diagonally down, so it piles. Water gets one extra rule &mdash; it may ' +
          'also move sideways &mdash; and that single line is why it spreads out flat instead of forming ' +
          'heaps. No fluid simulation, no pressure, just one more allowed direction.',
      },
    ],
    faq: [
      { q: 'Can I put the fire out?', a: 'Yes. Draw water on it, or over the wood in front of it. Fire that runs out of fuel burns down on its own and leaves smoke.' },
      { q: 'Does it save what I draw?', a: 'No. It is a toy, and reloading gives you a fresh scene.' },
      { q: 'Why is stone different from wood?', a: 'Stone does nothing at all — it just blocks. Wood also blocks, but it burns, so it is what you build things out of when you want to set fire to them later.' },
    ],
    related: ['game-of-life', 'boids', '2048'],
  },

  {
    slug: 'boids',
    cat: 'toy',
    name: 'Boids',
    glyph: '▸',
    script: 'toy/boids.js',
    width: 640, height: 420, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Reynolds 1986 &middot; spatial hash',
    title: 'Boids — Flocking Simulation You Can Break, Free In Your Browser',
    ogTitle: 'Three rules, and a flock appears',
    description: "Craig Reynolds's flocking model. Separation, alignment and cohesion — three rules per bird, no " +
      'leader, no plan. Move the sliders and watch the flock fall apart.',
    short: 'Three rules per bird. No leader.',
    h1: 'Boids',
    hero: 'Every bird looks only at its neighbours and follows three rules: do not crowd them, head roughly the ' +
      'way they are heading, and drift toward the middle of them. Nothing knows about the flock &mdash; and yet ' +
      'there it is. Turn one rule down and watch what it was holding together.',
    facts: ['Three rules, no leader', 'Sliders that break it', 'Your cursor is a hawk', 'Hundreds of birds at sixty frames'],
    hud: [
      { key: 'birds', label: 'Birds', accent: true, init: '220' },
    ],
    controls: [
      '<label class="game-range"><span>Separation</span><input type="range" id="game-sep" min="0" max="300" value="150" /></label>',
      '<label class="game-range"><span>Alignment</span><input type="range" id="game-ali" min="0" max="300" value="100" /></label>',
      '<label class="game-range"><span>Cohesion</span><input type="range" id="game-coh" min="0" max="300" value="90" /></label>',
      '<label class="sr-only" for="game-count">Flock size</label>',
      '<select class="game-select" autocomplete="off" id="game-count"><option value="80">80 birds</option><option value="220" selected>220 birds</option><option value="450">450 birds</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-trails" aria-pressed="false" title="Leave trails" aria-label="Leave trails">∿</button>',
    ],
    keys: [{ k: 'Space', d: 'Scatter them and start again' }, { k: 'Move', d: 'Your cursor scares them' }],
    touch: 'Drag on the flock to scare it. The sliders change the three rules.',
    infoHeading: 'How it stays fast',
    info: [
      {
        h: 'Neighbours by bucket, not by brute force',
        p: 'Comparing every bird with every other is 200,000 distance checks a frame at 450 birds. Instead each ' +
          'bird is filed into a grid cell the size of its view radius, so it only ever looks at nine cells. ' +
          'That is the difference between sixty frames a second and nine.',
      },
      {
        h: 'The colour is the heading',
        p: 'Each bird is tinted by the direction it is flying, so the structure of the flock reads as colour as ' +
          'well as position. A flock rotating around a common centre becomes obvious instantly, which it is ' +
          'not when everything is one colour.',
      },
    ],
    faq: [
      { q: 'What happens if I turn separation off?', a: 'They collapse into a single point and stay there. Separation is the only rule pushing outward, so without it cohesion wins completely.' },
      { q: 'And alignment?', a: 'You get a milling swarm rather than a flock — they stay together but never agree on a direction. It looks like insects instead of birds.' },
      { q: 'Is this how real flocks work?', a: 'Broadly, yes. Reynolds proposed it in 1986 as a model rather than a measurement, and later studies of actual starlings found birds do track a small fixed number of neighbours rather than everything they can see.' },
    ],
    related: ['game-of-life', 'falling-sand', 'moon-buggy'],
  },

  {
    slug: 'fountain',
    cat: 'toy',
    name: 'Fountain',
    glyph: '≈',
    script: 'toy/fountain.js',
    width: 640, height: 420, bestKey: null, pad: 'none',
    tapAction: true,
    engine: 'Ballistic droplets &middot; flight-time cueing',
    title: 'Dancing Fountain — Water On A Beat, In Your Browser',
    ogTitle: 'The jets fire before the beat, so the water lands on it',
    description: 'A musical fountain: a ring of nozzles and a centre jet throwing real ballistic water, lit from under the surface, choreographed to a piece the page generates itself.',
    short: 'Water on a beat, lit from below.',
    h1: 'Dancing fountain',
    hero: 'A ring of nozzles around a centre jet, throwing droplets that arc, break into spray at the top and splash when they land. The show is cut to a piece generated in the tab &mdash; and every jet fires slightly <em>before</em> the beat it is meant to hit, because water takes time to get where it is going. That offset is the difference between a fountain dancing and a fountain reacting.',
    facts: [
      'Droplets under real gravity',
      'Jets cued for flight time',
      'Lit from under the water',
      'Adapts to a slow machine',
    ],
    hud: [
      { key: 'bpm', label: 'BPM', accent: true, init: '100' },
      { key: 'figure', label: 'Figure', init: 'Ring' },
      { key: 'nozzles', label: 'Jets', init: '10 + core' },
    ],
    controls: [
      '<label class="sr-only" for="game-tempo">Show speed</label>',
      '<select class="game-select" autocomplete="off" id="game-tempo"><option value="76">Slow</option><option value="100" selected>Steady</option><option value="132">Brisk</option></select>',
      '<label class="game-range"><span>Pressure</span><input type="range" id="game-pressure" min="40" max="160" value="100" /></label>',
      '<label class="sr-only" for="game-nozzles">Nozzles</label>',
      '<select class="game-select" autocomplete="off" id="game-nozzles"><option value="6">6 nozzles</option><option value="10" selected>10 nozzles</option><option value="16">16 nozzles</option></select>',
      '<label class="sr-only" for="game-palette">Colour</label>',
      '<select class="game-select" autocomplete="off" id="game-palette"><option value="ice" selected>Ice</option><option value="sunset">Sunset</option><option value="spectrum">Spectrum</option><option value="moon">Moon</option></select>',
      '<label class="game-range"><span>Wind</span><input type="range" id="game-wind" min="-100" max="100" value="0" /></label>',
      '<button class="game-btn game-btn-icon" type="button" id="game-freeze" aria-pressed="false" title="Hold the show" aria-label="Hold the show">⏸</button>',
    ],
    keys: [
      { k: 'Space', d: 'Fire the centre jet' },
      { k: 'P', d: 'Hold the show' },
    ],
    touch: 'Tap the water to fire the centre jet. Drag the wind slider to blow the spray sideways.',
    infoHeading: 'How the water works',
    info: [
      {
        h: 'The jets fire early on purpose',
        p: 'A droplet leaving a nozzle takes a measurable time to reach the top of its arc. Cue the nozzle on the beat and the water peaks a third of a second late, which reads as sloppy. So the programme works backwards from the flight time and opens the valve early &mdash; the same thing a real show controller does.',
      },
      {
        h: 'Droplets, not sprites',
        p: 'Every droplet carries a position and a velocity and is integrated under gravity and drag, so pressure, wind and nozzle angle all compose without any special cases. Spray breaks off near the top of an arc, where a real jet loses coherence.',
      },
      {
        h: 'It gives up droplets before it gives up frames',
        p: 'Frame time is measured over a short rolling window, and the droplet budget is trimmed when it slips. A dropped frame is visible as a stutter; a hundred fewer droplets is not.',
      },
    ],
    faq: [
      { q: 'Is the music real?', a: 'It is generated in the tab with the Web Audio API rather than streamed, so there is nothing to download and nothing to license.' },
      { q: 'Why does the spray blow one way?', a: 'The wind slider adds a horizontal acceleration to every droplet in flight. Heavier droplets are pushed less than fine spray, which is why the top of each arc bends further than its base.' },
      { q: 'Can I make it bigger?', a: 'Use the full-screen control. The canvas is drawn in logical units and scaled, so nothing pixelates.' },
    ],
    related: ['disco', 'rain', 'falling-sand'],
  },

  {
    slug: 'disco',
    cat: 'toy',
    name: 'Disco',
    glyph: '◆',
    script: 'toy/disco.js',
    width: 640, height: 440, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Additive beams &middot; one transport clock',
    title: 'Disco Lights — A Beat-Synced Light Rig, Free In Your Browser',
    ogTitle: 'The lights are on the same clock as the music',
    description: 'A rig of moving beams, mirror-ball scatter and haze, cut to a beat the page generates itself. Lights and music read the same clock, so they hit together.',
    short: 'Beams, haze and a beat that they follow.',
    h1: 'Disco',
    hero: 'Sweeping spots, colour washes, a mirror ball and a strobe, in a room with enough haze in the air to see the beams rather than just the spots they land on. Everything is struck from one transport &mdash; the same fractional sixteenth that fires the kick also aims the movers &mdash; because two clocks drift and a light that lands a frame after the beat stops reading as a light show.',
    facts: [
      'Beams you can see in the air',
      'One clock for sound and light',
      'Strobe is off until you ask',
      'Nothing is streamed or downloaded',
    ],
    hud: [
      { key: 'bpm', label: 'BPM', accent: true, init: '124' },
      { key: 'bar', label: 'Bar', init: '1' },
      { key: 'lights', label: 'Lights', init: '8' },
    ],
    controls: [
      '<label class="sr-only" for="game-tempo">Tempo</label>',
      '<select class="game-select" autocomplete="off" id="game-tempo"><option value="96">96 BPM</option><option value="124" selected>124 BPM</option><option value="140">140 BPM</option></select>',
      '<label class="sr-only" for="game-fixtures">Moving lights</label>',
      '<select class="game-select" autocomplete="off" id="game-fixtures"><option value="4">4 movers</option><option value="8" selected>8 movers</option><option value="12">12 movers</option></select>',
      '<label class="sr-only" for="game-palette">Colour</label>',
      '<select class="game-select" autocomplete="off" id="game-palette"><option value="club" selected>Club</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="white">White</option></select>',
      '<label class="game-range"><span>Haze</span><input type="range" id="game-haze" min="0" max="100" value="55" /></label>',
      '<button class="game-btn game-btn-icon" type="button" id="game-strobe" aria-pressed="false" title="Strobe: flashing light, off by default" aria-label="Strobe">⚡</button>',
      '<button class="game-btn game-btn-icon" type="button" id="game-blackout" aria-pressed="false" title="Blackout: kill every light at once" aria-label="Blackout">●</button>',
    ],
    keys: [
      { k: 'Space', d: 'Blackout, and back' },
      { k: 'S', d: 'Strobe on or off' },
      { k: 'Move', d: 'A follow spot tracks your cursor' },
    ],
    touch: 'Drag across the room to move the follow spot. The strobe stays off until you turn it on.',
    infoHeading: 'How it holds together',
    info: [
      {
        h: 'One clock, not two',
        p: 'The audio scheduler and the lighting cues read the same fractional sixteenth. A separate <code>setInterval</code> for the lights would drift against the audio context within a minute, and a beam that arrives a frame late reads as a fault rather than as a light show.',
      },
      {
        h: 'A beam is a cone, not a circle',
        p: 'Each fixture draws a gradient-filled wedge with a bright core and a soft edge, composited with <code>lighter</code> so crossing beams add rather than paint over one another. That additive pass is what makes two lights meeting look brighter than either alone, which is the whole reason haze is worth drawing.',
      },
      {
        h: 'The strobe is opt-in on purpose',
        p: 'Flashing light between roughly 3 and 60 Hz can trigger a seizure in photosensitive epilepsy. So the strobe starts off, is capped well under the general threshold, announces itself before the first flash, and stays off entirely when the browser reports <code>prefers-reduced-motion</code>. A toy is not worth a hospital visit.',
      },
    ],
    faq: [
      { q: 'Is there a seizure risk?', a: 'The strobe is the only part that flashes, it is off until you turn it on, it warns you first, and it is rate-capped. If your system asks for reduced motion the strobe is disabled outright. If you are photosensitive, leave it off &mdash; the rest of the rig does not flash.' },
      { q: 'Where does the music come from?', a: 'It is generated in the tab with the Web Audio API &mdash; a kick, hats, a bass line and a pad, sequenced live. Nothing is streamed, nothing is downloaded, and there is no copyright on it.' },
      { q: 'Why does the haze slider change the frame rate?', a: 'Haze is drawn as stacked translucent wedges, so it is the most expensive thing on the canvas. Turn it down on a weak machine and everything else keeps its timing.' },
    ],
    related: ['fountain', 'rain', 'cmatrix'],
  },

  /* ------------------------------------------------------------------- fun */
  {
    slug: 'career-quiz',
    cat: 'fun',
    name: 'Tech career quiz',
    glyph: '⋔',
    quiz: true,
    board: true,
    script: 'fun/career-quiz.js',
    pad: 'none',
    bestKey: null,
    engine: 'QuizKit &middot; 18 items, six tracks, nine questions each',
    title: 'Tech Career Quiz — Which Side Of Technology Suits How You Work',
    ogTitle: 'Six tech tracks, and what each one is like on a dull Tuesday',
    description: 'Eighteen questions about how you like to work, scored across security, backend, frontend, data, infrastructure and product. Honest about the dull parts.',
    short: 'Which side of technology suits you.',
    h1: 'Tech career quiz',
    hero: 'Eighteen questions about the way you like to work and what you find satisfying &mdash; never about what you already know, because knowing a thing and wanting to do it all day are unrelated. ' +
      'It scores six tracks: security, backend, frontend, data, infrastructure and product. The result names your top two, describes what the work is actually like, and includes the tedious parts, ' +
      'because those are the bit that decides whether you last.',
    facts: ['Eighteen questions', 'Six tracks, nine questions each', 'The dull parts are listed too', 'Nothing is uploaded'],
    hud: [{ key: 'question', label: 'Progress', accent: true, init: '1/18' }],
    keys: [{ k: '↑ ↓', d: 'Move between answers' }, { k: 'Space', d: 'Choose' }],
    touch: 'Tap an answer to move to the next question, and Back to return to the previous one.',
    infoHeading: 'What this can and cannot tell you',
    info: [
      {
        h: 'It asks about style, not about knowledge',
        p: 'Not one question checks whether you know something. A careers quiz that tests knowledge only tells you what you happen to have studied already, which is mostly an accident of your syllabus. ' +
          'These ask what you would chase for two days, what irritates you, and which tedious job you would mind least.',
      },
      {
        h: 'Every track appears in exactly nine questions',
        p: 'Eighteen questions, three options each, and each of the six tracks is on offer nine times. That balance is the reason the bars can say something specific: your percentage is how often you ' +
          'picked a track when it was actually available. Without it, whichever track was listed most often would win most quizzes, and the result would be measuring the author.',
      },
      {
        h: 'Two tracks, because one is not enough to name a job',
        p: '"Security" on its own covers a penetration tester and a compliance lead, who share almost nothing day to day. The result blends your top two and names the kind of role that sits between them ' +
          '&mdash; data plus infrastructure is a platform job, frontend plus product is design engineering, and so on.',
      },
      {
        h: 'The tedium is in the write-up on purpose',
        p: 'Every track description carries a line about the dull part: the alerts that are nothing, the migrations that must not lose a row, the cleaning that eats most of a data week, the on-call. ' +
          'On a good day these six jobs look fairly similar. On an ordinary one they are miles apart, and that is the difference worth knowing before you pick.',
      },
    ],
    faq: [
      { q: 'Will this tell me which job to apply for?', a: 'No. It can say which kind of work you find appealing to think about, which is not the same as what you are good at, what is hiring near you, or what you will still want in ten years. The result says so under the bars rather than in small print.' },
      { q: 'Why only six tracks?', a: 'Because six is what could be balanced properly across eighteen questions. There is no option here for QA, technical writing, support engineering, research, or the other jobs that keep software running, and their absence is not a judgement on them.' },
      { q: 'What if all six come out about level?', a: 'Then the result says that outright instead of picking a winner from noise. A flat spread is common and is usually a sign you have not done enough of any of it yet to have preferences &mdash; which is a fine place to be.' },
      { q: 'Is anything sent anywhere?', a: 'No. The scoring runs in the page, nothing is uploaded, and nothing is stored, not even locally. Reloading loses your answers.' },
    ],
    related: ['personality-test', 'cyber-hygiene', 'phishing-or-not'],
  },

  {
    slug: 'dev-personality',
    cat: 'fun',
    name: 'What kind of developer are you',
    glyph: '⌥',
    quiz: true,
    script: 'fun/dev-personality.js',
    board: true, pad: 'none', bestKey: null,
    engine: 'Sixteen questions &middot; six archetypes',
    title: 'What Kind Of Developer Are You — A 16-Question Quiz',
    ogTitle: 'Archaeologist, firefighter, gardener, architect, shipper or toolmaker',
    description: 'Sixteen questions about how you actually work, and one of six developer archetypes at the ' +
      'end — with the failure mode that comes with it. Nothing uploaded.',
    short: 'Sixteen questions about how you work.',
    h1: 'What kind of developer are you',
    hero: 'Not what language you like &mdash; what you do when you meet code you did not write, how you feel ' +
      'about a rewrite, and what happens to the test that fails one run in thirty. Sixteen questions, six ' +
      'archetypes, and a result that names the thing your type is bad at as well as the thing it is good at.',
    facts: ['Sixteen questions', 'Six developer archetypes', 'Names the failure mode too', 'Nothing is uploaded'],
    hud: [{ key: 'question', label: 'Progress', accent: true, init: '1/16' }],
    keys: [{ k: '↑ ↓', d: 'Move between answers' }, { k: 'Space', d: 'Choose' }],
    touch: 'Tap an answer to move on. Back returns to the previous question.',
    infoHeading: 'How the six archetypes were picked',
    info: [
      {
        h: 'They are habits, not skills',
        p: 'Every question asks what you do rather than what you know: the first hour on an unfamiliar service, ' +
          'the flaky test, the unmaintained dependency, the pull request that is three hundred lines and works. ' +
          'Two developers with identical CVs answer these differently, which is the only reason a quiz like ' +
          'this has anything to say at all.',
      },
      {
        h: 'Every result names a failure mode',
        p: 'The archaeologist who can explain the bad code but never changes it. The firefighter a team quietly ' +
          'comes to depend on instead of fixing causes. The toolmaker whose automation took longer than the ' +
          'task and now has a maintainer. A type with only upside is flattery, and flattery is why most of ' +
          'these quizzes are worthless.',
      },
      {
        h: 'Your second reading matters as much as your first',
        p: 'The bars are each type\'s share of the points you awarded, so the shape of the whole answer is ' +
          'visible rather than just the winner. Where the top two are within two points, the result says so ' +
          'outright instead of crowning one of them &mdash; two points over sixteen questions is noise.',
      },
      {
        h: 'The lowest one is the interesting one',
        p: 'The write-up ends with the archetype you showed least of and what that costs you, because the type ' +
          'you are is usually already obvious to you and the one you skip is usually not.',
      },
    ],
    faq: [
      { q: 'Is this based on anything?', a: 'No. The six archetypes are made up — they are patterns you can recognise in a team, not categories anybody has measured. The Big Five test elsewhere on this site is the one with actual research behind it.' },
      { q: 'I got a different result the second time. Which is right?', a: 'Neither, particularly. Most people are three of these depending on the week and the codebase, which is why the result also shows your second reading and says when the top two are too close to separate.' },
      { q: 'Can I use this to hire people?', a: 'Please do not. It asks how somebody would like to describe their habits, which is a long way from how they work under a deadline with a codebase they did not choose.' },
      { q: 'Are my answers stored?', a: 'No. Everything is computed in the page, nothing is sent anywhere, and reloading loses it.' },
    ],
    related: ['personality-test', 'cyber-hygiene', 'typing-trainer'],
  },

  {
    slug: 'name-in-binary',
    cat: 'fun',
    name: 'Your name in binary',
    glyph: '01',
    script: 'fun/name-in-binary.js',
    board: true, pad: 'none', bestKey: null,
    engine: 'Hand-rolled UTF-8 &middot; seven encodings at once',
    title: 'Your Name In Binary — Text To Binary, Hex, Base64 And Morse',
    ogTitle: 'What your name looks like as bytes',
    description: 'Type anything and watch it become binary, hex, code points, Base64, Morse, ROT13 and leetspeak ' +
      'at once. None of it is encryption, and nothing is uploaded.',
    short: 'Seven encodings of whatever you type.',
    h1: 'Your name in binary',
    hero: 'Type your name and it appears seven ways at once: the actual UTF-8 bits, the same bytes in hex, the ' +
      'Unicode numbers behind them, Base64, Morse, ROT13 and leetspeak. Each row says in one line what that ' +
      'encoding is and where you would really meet it. None of them is encryption, and the page says so before ' +
      'it says anything else.',
    facts: ['Seven encodings, live', 'Correct for accents and emoji', 'A copy button per row', 'Nothing leaves your browser'],
    hud: [
      { key: 'chars', label: 'Characters', init: '12' },
      { key: 'bytes', label: 'UTF-8 bytes', accent: true, init: '12' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-sample">Sample</button>',
      '<button class="game-btn" type="button" id="game-clear">Clear</button>',
    ],
    keys: [
      { k: 'Type', d: 'Every row updates as you go' },
      { k: 'Tab', d: 'Reach each Copy button' },
    ],
    touch: 'Tap the box and type; tap Copy on any row you want to keep.',
    infoHeading: 'What these seven things actually are',
    info: [
      {
        h: 'Encoding is not encryption, and that is the useful part',
        p: 'Encryption needs a key, and without the key the output is no use to anybody. An encoding has no key at ' +
          'all &mdash; it is only a different way of writing the same characters, and reversing it is a one-click ' +
          'operation that the encoder in the Labs section will happily do for you. Binary, Base64 and ROT13 get ' +
          'mistaken for security constantly, usually by somebody who has just Base64-ed a password into a config ' +
          'file. All that hides it from is a casual glance.',
      },
      {
        h: 'Characters and bytes are different counts',
        p: 'The two numbers in the bar disagree the moment you leave ASCII. A plain Latin letter is one byte in ' +
          'UTF-8, an accented one is two, most Devanagari characters are three and an emoji is four. That is why a ' +
          'form with a 20-character limit sometimes rejects a name that is plainly shorter than twenty letters: ' +
          'somebody counted bytes and called them characters.',
      },
      {
        h: 'Every row is somewhere real',
        p: 'Hex is what a memory dump or a hex editor shows you. Base64 is how an image gets into an email or a ' +
          'data: URL. Morse is a telegraph code with no lower case, so anything it cannot carry is dropped and the ' +
          'line under it says how many. ROT13 was a Usenet convention for hiding spoilers. Leetspeak matters ' +
          'because password crackers have known the letter-to-digit swaps for thirty years &mdash; changing e to 3 ' +
          'buys you nothing.',
      },
    ],
    faq: [
      { q: 'Is what I type sent anywhere?', a: 'No. The conversion happens in the page and there is no request of any kind. Close the tab and it is gone; nothing is stored either.' },
      { q: 'Can I turn the binary back into text?', a: 'Yes, and so can anyone else &mdash; that is the point being made. Paste any row into the encoder and decoder at /labs/encoding and it comes straight back.' },
      { q: 'Why does one emoji count as four bytes?', a: 'UTF-8 uses one byte for ASCII and up to four for everything else. An emoji sits far outside ASCII, so it needs all four, even though it is a single character and a single code point.' },
      { q: 'Why are some characters missing from the Morse row?', a: 'Morse only defines codes for A to Z, the digits and a handful of punctuation marks. There is no Morse for an emoji, an accented letter or a non-Latin script, so those characters are left out and counted underneath rather than quietly mangled.' },
      { q: 'Is ROT13 or leetspeak any use in a password?', a: 'No. Both are fixed, public substitutions, and every cracking tool applies them automatically to its wordlists. Substituting digits for letters in a dictionary word leaves you with a dictionary word.' },
    ],
    related: ['password-duel', 'typing-trainer', 'cyber-hygiene'],
  },

  {
    slug: 'which-attack',
    cat: 'fun',
    name: 'Which cyberattack are you',
    glyph: '☣',
    quiz: true,
    script: 'fun/which-attack.js',
    board: true, pad: 'none', bestKey: null,
    engine: 'Fourteen questions &middot; eight attacks',
    title: 'Which Cyberattack Are You — A Joke Quiz With Real Answers',
    ogTitle: 'Which cyberattack are you, then',
    description: 'Fourteen daft questions and eight possible results, each one carrying an accurate note on ' +
      'how that attack really works and what actually stops it.',
    short: 'Fourteen daft questions, eight real attacks.',
    h1: 'Which cyberattack are you',
    hero: 'A joke quiz delivered with a straight face. Fourteen questions about parties, locked rooms and ' +
      'comments boxes, and one of eight attacks at the end &mdash; and underneath the joke, two or three true ' +
      'sentences about how that attack actually works and what actually defends against it. The questions ' +
      'measure nothing. The paragraph is the point.',
    facts: ['Fourteen questions', 'Eight possible attacks', 'The result text is accurate', 'Nothing is uploaded'],
    hud: [{ key: 'question', label: 'Progress', accent: true, init: '1/14' }],
    keys: [{ k: '↑ ↓', d: 'Move between answers' }, { k: 'Space', d: 'Choose' }],
    touch: 'Tap an answer to move on.',
    infoHeading: 'A joke with homework attached',
    info: [
      {
        h: 'The quiz is the wrapper',
        p: 'Nothing you answer here says anything about you, and the questions are not pretending otherwise. ' +
          'What the result carries is a short, accurate account of the attack you landed on: the mechanism ' +
          'that makes it work, and the specific thing that stops it &mdash; parameterised queries for SQL ' +
          'injection, validated TLS for a man-in-the-middle, tested offline backups for ransomware.',
      },
      {
        h: 'Phishing and social engineering deliberately share points',
        p: 'Every other pair of results here is separate, but phishing is social engineering &mdash; the ' +
          'subset that arrives in writing. Four answers score both, because a quiz that treats them as ' +
          'rivals teaches a taxonomy that falls apart the first time you read a real incident report.',
      },
      {
        h: 'The same answers always give the same attack',
        p: 'Ties are broken by a fixed order rather than at random, so two people who answer identically get ' +
          'the same result, and so do you on a second run. A joke that changes its mind on reload just looks ' +
          'broken.',
      },
    ],
    faq: [
      { q: 'Does this tell me anything about myself?', a: 'No. Not a thing. Fourteen questions about imaginary parties cannot measure a person, and there is no sense in which somebody resembles a denial-of-service attack. It is a way of reading eight attack summaries without noticing you are doing it.' },
      { q: 'Are the descriptions in the results accurate?', a: 'Yes. Each one says how the attack works and what actually defends against it, and none of them recommend the folk remedies — filtering rude words does not stop SQL injection, and antivirus does not stop credential stuffing. There is a fuller map in the post on types of cyberattacks.' },
      { q: 'Why is brute force described as credential stuffing?', a: 'Because most of what gets logged as a brute-force attack is a replay of username and password pairs leaked from some other breach. Genuinely guessing a long password is impractical; reusing one you have already had leaked is not.' },
      { q: 'Do you store my answers?', a: 'No. Nothing is sent anywhere and nothing is saved — reloading the page loses the lot.' },
    ],
    related: ['phishing-or-not', 'cyber-hygiene', 'personality-test'],
  },

  {
    slug: 'birthday-facts',
    cat: 'fun',
    name: 'Birthday facts',
    glyph: '31',
    script: 'fun/birthday-facts.js',
    board: true, pad: 'none',
    bestKey: null,
    engine: 'Zeller&rsquo;s congruence &middot; no date library',
    title: 'Birthday Facts &mdash; The Day You Were Born, And Every Day Since',
    ogTitle: 'Which day of the week were you born on?',
    description: 'Enter a date of birth and get the weekday it fell on, your exact age, days alive, ' +
      'your next birthday and your age on seven planets. Nothing is uploaded.',
    short: 'The weekday you were born, computed.',
    h1: 'Birthday facts',
    hero: 'Type in a date of birth and this works out the day of the week it fell on, how old you are ' +
      'to the day, and how many days that adds up to. The weekday comes from Zeller&rsquo;s congruence ' +
      'rather than a table somebody typed up, and every other figure is arithmetic you could check by ' +
      'hand. The date stays in this tab and is not saved anywhere.',
    facts: [
      'Weekday from Zeller&rsquo;s congruence',
      'Leap years handled properly',
      'Seven planets, real orbital periods',
      'Nothing uploaded, nothing saved',
    ],
    hud: [
      { key: 'weekday', label: 'Born on', accent: true, init: '&mdash;' },
      { key: 'days', label: 'Days alive', init: '&mdash;' },
    ],
    keys: [
      { k: 'Enter', d: 'Work it out' },
    ],
    touch: 'Tap the field to open your phone&rsquo;s own date picker, then tap Work it out.',
    infoHeading: 'The arithmetic, since that is the whole page',
    info: [
      {
        h: 'The weekday is calculated, not looked up',
        p: 'Zeller&rsquo;s congruence turns a date into a day of the week with a few lines of integer ' +
          'arithmetic. It works by treating January and February as months 13 and 14 of the previous ' +
          'year, which moves the leap day to the end of the year and out of the middle of the sum. The ' +
          'same formula produces the weekday for your next birthday and for the 1,000-day marks, so all ' +
          'the dates on the page agree with each other by construction.',
      },
      {
        h: 'Days are counted between UTC midnights',
        p: 'Ask a browser for the gap between two local dates and you are asking about a lifetime that ' +
          'may contain a hundred clock changes, each an hour that has to land somewhere. Counting from ' +
          'UTC midnight to UTC midnight avoids the question entirely: those are exactly 86,400 seconds ' +
          'apart, always, so the day count is a subtraction rather than an estimate.',
      },
      {
        h: '&ldquo;Years, months and days&rdquo; has to pick a convention',
        p: 'Whole months are counted first and the leftover days measured from there, with the month ' +
          'step clamped to the end of a short month &mdash; so one month after 31 January is 28 ' +
          'February and the day count restarts on the 28th. Other calculators borrow days from the ' +
          'previous month instead and can differ from this by a day or two around month ends. Neither ' +
          'is wrong; they are answering slightly different questions.',
      },
      {
        h: 'The heartbeat figure is a multiplication',
        p: 'Days alive, times 24, times 60, times 70. Seventy is the middle of the resting range for an ' +
          'adult and it is the only assumption in the sum. Your real rate ran far higher through ' +
          'childhood and changes every minute of every day, so the number is worth an order of ' +
          'magnitude and nothing more precise than that.',
      },
      {
        h: 'Ages on other planets are just division',
        p: 'A year is one orbit. Divide the days you have been alive by a planet&rsquo;s orbital period ' +
          'in Earth days and you have your age in that planet&rsquo;s years. The periods are the ' +
          'sidereal ones from the NASA fact sheets &mdash; 87.97 days at Mercury, 60,189 at Neptune. ' +
          'Which means nobody has ever had a Neptune birthday: one of its years is about 165 of ours.',
      },
    ],
    faq: [
      { q: 'Is the day of the week right for old dates?', a: 'Back to 1583 it is, on the Gregorian calendar. Earlier than that the form refuses, because the Gregorian calendar arrived in 1582 in some countries, 1752 in Britain and its colonies and 1918 in Russia &mdash; so the weekday for a date in 1650 depends on where you are asking about, and one answer would be a guess dressed as a fact.' },
      { q: 'What if I was born on 29 February?', a: 'Your age and day counts are exact either way, since they never need an anniversary. For the next birthday in an ordinary year this page uses 1 March; some places use 28 February instead. The result says which it used.' },
      { q: 'Another calculator gives a different age. Which is right?', a: 'Both, probably. The disagreement will be in the months-and-days part, near the end of a short month, and it comes from how each one adds a month to the 29th, 30th or 31st. Total days alive is not a matter of opinion and should match exactly.' },
      { q: 'Is my date of birth sent anywhere?', a: 'No. It is typed into a field, used for arithmetic in the same tab, and never leaves it. It is not stored either &mdash; no localStorage, no cookie. Reload the page and the field is empty.' },
      { q: 'How accurate is the heartbeat number?', a: 'It is arithmetic, not measurement: days alive times 1,440 minutes times 70 beats. Treat it as the right size rather than the right number.' },
      { q: 'Why is Pluto not in the table?', a: 'It has not been a planet since 2006. If you want the figure anyway, its orbit is about 90,560 Earth days, so divide your days alive by that.' },
    ],
    related: ['love-calculator', 'personality-test', 'reaction-time'],
  },

  {
    slug: 'are-you-a-robot',
    cat: 'fun',
    name: 'Are you a robot?',
    glyph: '☑',
    tag: 'Joke',
    board: true,
    script: 'fun/are-you-a-robot.js',
    pad: 'none',
    bestKey: null,
    tapAction: false,
    engine: 'Eight DOM screens, no images, no verification',
    title: 'Are You A Robot? — A Joke CAPTCHA That Always Lets You In',
    ogTitle: 'A CAPTCHA that eventually admits what it is',
    description: 'A joke CAPTCHA that gets less reasonable with every screen and lets you through anyway, ' +
      'then explains what the real ones actually measure.',
    short: 'A CAPTCHA that gives up honestly.',
    h1: 'Are you a robot?',
    hero: 'Tick the box, pick out the traffic lights, and carry on until the instructions stop making sense. ' +
      'Every screen lets you through, including the ones you get wrong, which is the joke and also roughly how ' +
      'the real thing works now. The last screen drops the act and says what a modern check is really reading.',
    facts: [
      'Eight screens, all of which you pass',
      'No images load &mdash; nothing is fetched',
      'Nothing is stored, scored or sent',
      'Works with a keyboard and a screen reader',
    ],
    hud: [
      { key: 'stage', label: 'Stage', init: '1/8' },
      { key: 'verdict', label: 'Verdict', accent: true, init: 'Pending' },
    ],
    controls: [
      '<button class="game-btn" type="button" id="robot-skip">Skip to the point</button>',
    ],
    keys: [
      { k: 'Tab', d: 'Move to the squares and between them' },
      { k: 'Enter', d: 'Select a square, or verify' },
      { k: 'Click', d: 'Choose a square' },
    ],
    touch: 'Tap the squares, then tap Verify. Nothing here needs a keyboard.',
    infoHeading: 'What the squares are actually for',
    info: [
      {
        h: 'The puzzles lost the arms race',
        p: 'Distorted text died because software got better at reading it than people were &mdash; Google said ' +
          'in 2014, when it introduced the tick box, that its own recogniser handled the hardest variants with ' +
          'better than 99% accuracy. Traffic lights and crossings were the replacement, and machine vision has ' +
          'caught up with those too. The hard ones now stop tired humans more reliably than they stop scripts.',
      },
      {
        h: 'The modern ones score you, not your answer',
        p: 'reCAPTCHA v3 shows no puzzle at all. It returns a number between 0.0 and 1.0 and leaves the site to ' +
          'decide what to do with it; Cloudflare Turnstile works much the same way. What they weigh is how the ' +
          'pointer moved, how the typing was timed, what the browser looks like, which cookies you already had ' +
          'and what your address has been doing lately. A grid of squares appears mostly when that score is ' +
          'borderline, or because somebody wanted the visitor to see a check happening.',
      },
      {
        h: 'You were also doing unpaid work',
        p: 'The original reCAPTCHA showed you two words: one it knew, one that optical character recognition had ' +
          'failed on while digitising scanned books and newspaper archives. Your answer to the second was the ' +
          'product. Later it moved to Street View house numbers, then to labelling images. The test was training ' +
          'the very thing it was meant to be testing for.',
      },
      {
        h: 'And the cost lands on the wrong people',
        p: 'Image grids are hard or impossible with a screen reader, the audio alternative is worse, and low ' +
          'vision, dyslexia and slow connections all make it harder again. So do shared addresses and VPNs, ' +
          'which draw more challenges. The people who get shown the most squares are usually the ones already ' +
          'having the worst time, and none of it is what stops a determined attacker.',
      },
    ],
    faq: [
      { q: 'Can I fail it?', a: 'No. Every screen accepts every answer, including no answer at all. That is the point being made rather than a shortcut &mdash; a fail state would teach the opposite of what the last screen says.' },
      { q: 'Does it record anything about me?', a: 'It counts your pointer moves, your clicks and the seconds you spent, in variables in your own tab, so the last screen can show you the one signal a real check would care about. The numbers are shown once and are gone when you reload. Nothing is stored and nothing is sent.' },
      { q: 'Are the pictures real photographs?', a: 'No, they are labelled boxes. Nothing loads over the network on this page. It also means a screen reader can read the challenge out, which real image grids manage badly if at all.' },
      { q: 'Could this be used as a real CAPTCHA?', a: 'No, and it would stop nothing. A script would clear all eight screens in milliseconds, which is roughly the situation genuine puzzle-based checks are in as well.' },
      { q: 'Why do real ones keep getting harder?', a: 'Because it is an arms race with a scoreboard only one side reads. Each time recognition software catches up, the puzzle gets more awkward, and the awkwardness is felt by people rather than by the software. That is why the newest systems gave up on puzzles and went to scoring behaviour instead.' },
    ],
    related: ['phishing-or-not', 'password-duel', 'love-calculator'],
  },


  {
    slug: 'personality-test',
    cat: 'fun',
    name: 'Personality test',
    glyph: '◑',
    quiz: true,
    script: 'fun/personality-test.js',
    board: true, pad: 'none', bestKey: null,
    engine: 'Big Five &middot; 30 items, half reversed',
    title: 'Personality Test — A Short Big Five Inventory, Free',
    ogTitle: 'The personality test companies actually use',
    description: 'A thirty-item Big Five personality inventory — the five-factor model real assessments are ' +
      'built on, not a four-letter type. Results as bars, nothing uploaded.',
    short: 'The five-factor model, in thirty questions.',
    h1: 'Personality test',
    hero: 'The one companies put in front of you at interview is almost always a five-factor inventory, not a ' +
      'four-letter type. This is a short version of the real thing: thirty statements, five traits, and a ' +
      'result that tells you where you sit rather than which fictional box you belong in.',
    facts: ['Big Five, not sixteen types', 'Thirty items, half reverse-keyed', 'Results as bars', 'Nothing is uploaded'],
    hud: [{ key: 'question', label: 'Progress', accent: true, init: '1/30' }],
    keys: [{ k: '↑ ↓', d: 'Move between answers' }, { k: 'Space', d: 'Choose' }],
    touch: 'Tap an answer to move on. Back returns to the previous question.',
    infoHeading: 'Why this and not the four letters',
    info: [
      {
        h: 'The type indicators do not hold up',
        p: 'The famous four-letter one is enormously fun and has very little predictive validity: a large share ' +
          'of people get a different type on a retest a few weeks later, and its dichotomies are not actually ' +
          'bimodal in the data &mdash; most people sit in the middle, which is the one answer it cannot give.',
      },
      {
        h: 'Half the questions are backwards',
        p: 'Fifteen of the thirty are worded the opposite way and scored in reverse. Without them, anybody who ' +
          'agrees with everything produces the same profile as somebody thinking hard, and what you would be ' +
          'measuring is politeness rather than personality.',
      },
      {
        h: 'Two traits, not one, decide your description',
        p: 'The write-up blends your highest and second-highest readings, because a person who is organised and ' +
          'curious is nothing like a person who is organised and conventional, and a result keyed only to the ' +
          'top trait cannot tell them apart.',
      },
      {
        h: 'It says what it is not',
        p: 'Thirty items is short. Scores move with mood, with how recently you slept, and with whether you are ' +
          'answering as you are or as you would like to be. Good for reflection, not for deciding anything ' +
          'about anybody &mdash; and the page says so under the result rather than in the small print.',
      },
    ],
    faq: [
      { q: 'Is this scientifically valid?', a: 'The model is — the five-factor structure is the most replicated finding in personality psychology. This particular thirty-item questionnaire is a short informal version, not a validated instrument, and the result page says so.' },
      { q: 'Why are some questions the opposite of others?', a: 'To catch acquiescence — the tendency to agree with whatever is put in front of you. Reverse-keyed items score backwards, so agreeing with everything cancels out instead of producing a profile.' },
      { q: 'What is "emotional volatility"?', a: 'It is the trait usually called neuroticism, renamed because the clinical word carries baggage it does not deserve. High is not bad: it tends to come with noticing things other people miss.' },
      { q: 'Is my data sent anywhere?', a: 'No. Everything is computed in the page and nothing is stored, not even locally. Reloading loses it.' },
    ],
    related: ['cyber-hygiene', 'love-calculator', 'memory-span'],
  },

  {
    slug: 'cyber-hygiene',
    cat: 'fun',
    name: 'How hackable are you',
    glyph: '⚠',
    quiz: true,
    script: 'fun/cyber-hygiene.js',
    board: true, pad: 'none', bestKey: null,
    engine: 'Fifteen questions &middot; weighted by what matters',
    title: 'How Hackable Are You — A 15-Question Security Check',
    ogTitle: 'How hackable are you, honestly',
    description: 'Fifteen questions about what you actually do, weighted by what actually protects people — ' +
      'and a prioritised list of what to fix first. Nothing uploaded.',
    short: 'Fifteen questions, then what to fix first.',
    h1: 'How hackable are you',
    hero: 'Not a scan and not a lecture. Fifteen questions about habits, weighted the way the incident data ' +
      'weights them &mdash; which is not the way popular advice does &mdash; and then a list of what would ' +
      'move your number most, in order.',
    facts: ['Weighted by what actually matters', 'A prioritised list of fixes', 'Takes two minutes', 'Nothing is uploaded'],
    hud: [{ key: 'question', label: 'Progress', accent: true, init: '1/15' }],
    keys: [{ k: '↑ ↓', d: 'Move between answers' }, { k: 'Space', d: 'Choose' }],
    touch: 'Tap an answer to move on.',
    infoHeading: 'Why the weights are lopsided',
    info: [
      {
        h: 'Two answers are worth more than the rest combined',
        p: 'Unique passwords and multi-factor on your email account carry several times the weight of antivirus ' +
          'or a VPN, because that is what the breach data supports. Most people have it the other way round, ' +
          'which is how somebody with a paid security suite loses everything to one reused password.',
      },
      {
        h: 'Every answer produces an instruction',
        p: 'A percentage with nothing attached to it is a horoscope. Each answer that is not the best one comes ' +
          'with the specific thing that would fix it, and they are sorted by how much they are costing you.',
      },
    ],
    faq: [
      { q: 'Is this an audit?', a: 'No. It asks what you do, not what your systems are. A real assessment looks at your actual accounts and devices; this is a two-minute prompt to notice the obvious gaps.' },
      { q: 'Why is a VPN barely worth anything here?', a: 'Because HTTPS already encrypts what a VPN was sold to protect. A VPN moves who can see your traffic; it does nothing about reused passwords, which is what actually gets people.' },
      { q: 'Do you store my answers?', a: 'No. Nothing is sent and nothing is saved — reloading the page loses the lot.' },
    ],
    related: ['personality-test', 'love-calculator', 'typing-trainer'],
  },

  {
    slug: 'reaction-time',
    cat: 'fun',
    name: 'Reaction time',
    glyph: '⚡',
    script: 'fun/reaction-time.js',
    width: 520, height: 340, pad: 'action',
    bestKey: 'reaction-time', bestOrder: 'low',
    engine: 'Five goes &middot; randomised waits',
    title: 'Reaction Time Test — Five Goes, An Honest Average',
    ogTitle: 'How fast are you, really',
    description: 'A reaction time test with randomised waits so you cannot learn the rhythm, and early clicks ' +
      'voided rather than scored. Five goes and an average.',
    short: 'Wait for green. Five goes, one average.',
    h1: 'Reaction time',
    hero: 'Wait for green, then hit it. The wait is different every time, so you cannot fall into a rhythm and ' +
      'measure your timing instead of your reaction &mdash; and clicking early voids the go rather than scoring ' +
      'you two hundred milliseconds for a guess.',
    facts: ['Randomised waits', 'Early clicks are voided', 'Five goes, averaged', 'Your best kept on this device'],
    hud: [
      { key: 'round', label: 'Round', accent: true, init: '0/5' },
      { key: 'last', label: 'Last', init: '—' },
      { key: 'avg', label: 'Average', init: '—' },
      { key: 'best', label: 'Best' },
    ],
    keys: [{ k: 'Space', d: 'React' }, { k: 'Click', d: 'React' }],
    touch: 'Tap the panel the moment it turns green.',
    infoHeading: 'Two things most of these get wrong',
    info: [
      {
        h: 'The wait has to be unpredictable',
        p: 'A fixed delay is learnable within three goes, and after that you are measuring anticipation. The ' +
          'wait here is between 1.4 and 5 seconds, drawn fresh each time.',
      },
      {
        h: 'Some of your score is not you',
        p: 'A 60 Hz screen adds up to 16 ms before you see anything, and the input path adds more. Somewhere ' +
          'between twenty and fifty milliseconds of your result belongs to the hardware, which is why comparing ' +
          'across devices is not worth much.',
      },
    ],
    faq: [
      { q: 'What is a good time?', a: 'Around 250 ms is typical for an adult on a normal setup. Under 200 is genuinely quick. Under 150 usually means the click landed early and got lucky.' },
      { q: 'Why did my early click not count?', a: 'Because otherwise guessing beats reacting. An early click voids that attempt and you get another go at the same round.' },
      { q: 'Does my phone score worse?', a: 'Usually slightly, yes — touch panels add latency that a wired mouse does not. Compare yourself against yourself.' },
    ],
    related: ['aim-trainer', 'memory-span', 'typing-trainer'],
  },

  {
    slug: 'rock-paper-scissors',
    cat: 'fun',
    name: 'Rock paper scissors',
    glyph: '✊',
    script: 'fun/rock-paper-scissors.js',
    width: 520, height: 380, pad: 'none', bestKey: null,
    tapAction: false,
    engine: 'It learns your last two throws',
    title: 'Rock Paper Scissors — Against An Opponent That Learns You',
    ogTitle: 'You cannot be random, and this proves it',
    description: 'Rock paper scissors against a frequency model of your habits. After twenty rounds it is ' +
      'usually beating you — people cannot generate random sequences.',
    short: 'It learns your habits. You will lose.',
    h1: 'Rock paper scissors',
    hero: 'The game is not the point. The point is that you cannot be random &mdash; and after twenty rounds a ' +
      'table of what you tend to throw after what will be quietly ahead of you. It tells you when it has ' +
      'spotted a pattern, and admits when it has not.',
    facts: ['A frequency model of your last two throws', 'It says when it is guessing', 'No neural anything', 'Nothing is uploaded'],
    hud: [
      { key: 'you', label: 'You', accent: true, init: '0' },
      { key: 'them', label: 'It', init: '0' },
      { key: 'rounds', label: 'Rounds', init: '0' },
    ],
    keys: [
      { k: '←', d: 'Rock' },
      { k: '↑', d: 'Paper' },
      { k: '→', d: 'Scissors' },
    ],
    touch: 'Tap one of the three buttons along the bottom.',
    infoHeading: 'How it beats you',
    info: [
      {
        h: 'A table, not a model',
        p: 'For every pair of throws you have made, it counts what you played next. Then it plays whatever ' +
          'beats your most likely follow-up. That is the whole algorithm &mdash; and it is enough, because ' +
          'human sequences are full of structure nobody can feel: alternating, avoiding a repeat after losing, ' +
          'copying whatever just beat you.',
      },
      {
        h: 'It refuses to pretend',
        p: 'Below four observations of your current context it plays uniformly at random and says so on screen. ' +
          'An opponent that claims to have learned something from three rounds is lying, and watching the ' +
          'message change from "playing at random" to "it expected you to play paper" is the interesting part.',
      },
    ],
    faq: [
      { q: 'Can I beat it?', a: 'Yes, but only by being genuinely unpredictable, which is much harder than it sounds. Most people drift back to a pattern within a dozen rounds.' },
      { q: 'Is it cheating — does it see my move first?', a: 'No. It commits to a throw from the table before your click is scored. That is the whole reason it is beatable at all.' },
      { q: 'How could I actually be random?', a: 'Use something outside your head: the second hand on a clock, digits of a phone number, a coin. Any external source beats intuition.' },
    ],
    related: ['reaction-time', 'aim-trainer', 'greed'],
  },

  {
    slug: 'aim-trainer',
    cat: 'fun',
    name: 'Aim trainer',
    glyph: '◎',
    script: 'fun/aim-trainer.js',
    width: 560, height: 400, pad: 'none',
    bestKey: 'aim-trainer', bestOrder: 'low',
    tapAction: false,
    engine: 'Thirty targets &middot; misses penalised',
    title: 'Aim Trainer — Thirty Targets, Misses Count Against You',
    ogTitle: 'Aim trainer that does not reward spraying',
    description: 'Thirty targets as fast as you can, with misses penalised so spraying at the middle is not a ' +
      'strategy. Targets never spawn under your cursor.',
    short: 'Thirty targets. Misses cost you.',
    h1: 'Aim trainer',
    hero: 'Thirty targets, one at a time. Speed alone is easy to fake &mdash; so misses are charged against ' +
      'your average, and a target never appears where your hand already is, which is the trick that makes most ' +
      'aim trainers flatter you.',
    facts: ['Misses penalised', 'Targets never spawn under the cursor', 'Three target sizes', 'Your best kept on this device'],
    hud: [
      { key: 'hits', label: 'Hits', accent: true, init: '0/30' },
      { key: 'misses', label: 'Misses', init: '0' },
      { key: 'time', label: 'Time', init: '0.0' },
      { key: 'best', label: 'Best' },
    ],
    controls: [
      '<label class="sr-only" for="game-size">Target size</label>',
      '<select class="game-select" autocomplete="off" id="game-size"><option value="34">Large</option><option value="26" selected>Medium</option><option value="17">Small</option></select>',
    ],
    keys: [{ k: 'Click', d: 'Hit the target' }],
    touch: 'Tap each target as it appears.',
    infoHeading: 'Why the number is not just speed',
    info: [
      {
        h: 'Misses are charged, not ignored',
        p: 'You can halve a raw time by clicking wildly near the middle and getting lucky. Each miss adds a ' +
          'notional 120 ms to the average, so accuracy and speed collapse into one figure &mdash; which is the ' +
          'one that actually improves with practice.',
      },
      {
        h: 'Nothing spawns under your hand',
        p: 'A target that appears where the cursor already is costs nothing to hit and quietly inflates the ' +
          'score. Each new one is placed at least a hundred pixels from your last click.',
      },
    ],
    faq: [
      { q: 'What is a good average?', a: 'Around 600 ms per target on medium is respectable, and under 450 is quick. Small targets add roughly 150 ms for most people — that gap is Fitts\'s law, and it is remarkably consistent.' },
      { q: 'Does the mouse matter?', a: 'Some. Polling rate and sensitivity change the number more than most people expect, so compare yourself against yourself rather than against anyone else.' },
      { q: 'Why does the raw time differ from my score?', a: 'The result shows both: raw speed, and the adjusted figure after the misses are charged. The gap between them is what accuracy is costing you.' },
    ],
    related: ['reaction-time', 'rock-paper-scissors', 'memory-span'],
  },

  {
    slug: 'memory-span',
    cat: 'fun',
    name: 'Memory span',
    glyph: '7',
    script: 'fun/memory-span.js',
    width: 480, height: 320, pad: 'none',
    bestKey: 'memory-span',
    engine: 'Digit span &middot; two attempts per length',
    title: 'Memory Span Test — How Many Digits Can You Hold?',
    ogTitle: 'Seven, plus or minus two',
    description: 'The digit span task: watch a sequence, type it back, and it gets one longer each time. Two ' +
      'attempts per length, exactly as the real instrument works.',
    short: 'Watch the digits. Type them back.',
    h1: 'Memory span',
    hero: 'Digits appear one at a time; you type them back in order; the sequence gets one longer each time you ' +
      'manage it. Seven plus or minus two is the famous figure, and finding out which side of it you are on ' +
      'takes about ninety seconds.',
    facts: ['A real cognitive task', 'Two attempts per length', 'One digit at a time, fixed pace', 'Ninety seconds'],
    hud: [
      { key: 'length', label: 'Length', accent: true, init: '3' },
      { key: 'attempt', label: 'Attempt', init: '1/2' },
      { key: 'best', label: 'Best span' },
    ],
    keys: [{ k: '0–9', d: 'Type the digits back' }, { k: 'Backspace', d: 'Fix a slip' }],
    touch: 'Tap the panel to bring up the number pad, then type the digits back.',
    infoHeading: 'Two details taken from the real task',
    info: [
      {
        h: 'Two attempts at each length',
        p: 'A single slip at length eight should not end a run that would have reached ten. The instrument this ' +
          'copies gives two goes per length and stops after both fail, because it is measuring capacity rather ' +
          'than luck.',
      },
      {
        h: 'One digit at a time, at a fixed pace',
        p: 'Showing the whole sequence at once turns it into a reading-speed test, and letting the pace vary ' +
          'rewards fast readers. Each digit is shown for the same 900 milliseconds whoever you are.',
      },
    ],
    faq: [
      { q: 'What is a normal score?', a: 'Most adults land between six and eight. Nine or more is well above the usual range, and it is very sensitive to distraction — a noisy room costs most people a full digit.' },
      { q: 'Is chunking cheating?', a: 'No, it is the skill. Reading 4 7 1 9 as "forty-seven, nineteen" is how people get past seven, and it is exactly what memory training teaches.' },
      { q: 'Why does it feel harder than remembering a phone number?', a: 'Because a phone number has structure and rhythm you already know. These are random, which is the point.' },
    ],
    related: ['reaction-time', 'aim-trainer', 'personality-test'],
  },

  {
    slug: 'typing-trainer',
    touch: "Tap the passage to bring up your keyboard, then start typing.",
    cat: 'fun',
    name: 'Typing trainer',
    glyph: '⌨',
    script: 'fun/typing-trainer.js',
    board: true, pad: 'none',
    engine: 'Real paragraphs &middot; per-key accuracy',
    title: 'Typing Speed Trainer — Long Paragraphs, Free, No Sign-Up',
    ogTitle: 'A typing trainer that uses real paragraphs',
    description: 'Improve your typing speed on real paragraphs, not three-word snippets. Live WPM and ' +
      'accuracy, a per-key error breakdown, and progress kept on your own device.',
    short: 'Real paragraphs, live WPM, per-key accuracy.',
    h1: 'Typing trainer',
    hero: 'Most typing tests hand you a sentence and a stopwatch. That measures your sprint, not your typing. ' +
      'This gives you full paragraphs &mdash; a minute, three minutes, or five &mdash; because speed over a page ' +
      'is a different skill from speed over a line, and it is the one that matters when you are actually writing ' +
      'something.',
    facts: [
      'One, three or five minutes',
      'Real paragraphs, prose and code',
      'Live WPM and accuracy',
      'Per-key error breakdown',
      'Your history kept on this device',
    ],
    hud: [
      { key: 'wpm', label: 'WPM', accent: true, init: '0' },
      { key: 'acc', label: 'Accuracy', init: '100%' },
      { key: 'time', label: 'Left', init: '1:00' },
      { key: 'best', label: 'Best WPM' },
    ],
    controls: [
      '<label class="sr-only" for="game-duration">Duration</label>',
      '<select class="game-select" autocomplete="off" id="game-duration"><option value="60" selected>1 minute</option><option value="180">3 minutes</option><option value="300">5 minutes</option></select>',
      '<label class="sr-only" for="game-text">Text</label>',
      '<select class="game-select" autocomplete="off" id="game-text"><option value="prose" selected>Prose</option><option value="tech">Technical writing</option><option value="code">Code</option><option value="punct">Punctuation drill</option><option value="numbers">Numbers and symbols</option></select>',
    ],
    keys: [
      { k: 'Type', d: 'Just start typing to begin' },
      { k: 'Backspace', d: 'Fix the current word' },
      { k: 'Tab', d: 'Skip to the next paragraph' },
      { k: 'Esc', d: 'Stop' },
    ],
    bestKey: 'typing-trainer',
    infoHeading: 'How the numbers are worked out',
    info: [
      {
        h: 'A word is five characters',
        p: 'Words per minute has meant "characters typed, divided by five, per minute" since the typewriter, and ' +
          'that is what is used here &mdash; counting actual words would reward you for typing "a a a a a" and ' +
          'punish you for writing about infrastructure. Net WPM subtracts uncorrected mistakes, which is the ' +
          'figure worth quoting.',
      },
      {
        h: 'The per-key breakdown is the useful part',
        p: 'Everyone is slow somewhere specific. After a run this shows which characters you actually missed, ' +
          'ordered by how often &mdash; and it is almost never the letters. Semicolons, brackets, capitals ' +
          'reached with the wrong shift key: those are where the seconds go, and they are trainable once you can ' +
          'see them.',
      },
      {
        h: 'Long texts, on purpose',
        p: 'The prose passages run to several hundred words and the code samples are real functions with real ' +
          'punctuation. A test short enough to memorise stops measuring anything after the third attempt.',
      },
      {
        h: 'Nothing is uploaded',
        p: 'Your keystrokes never leave the tab. The history chart is drawn from results kept in your own browser ' +
          'storage, which is also why it does not follow you to another device.',
      },
    ],
    faq: [
      { q: 'How is WPM calculated?', a: 'Characters typed divided by five, scaled to a minute. The headline figure is net WPM, which subtracts characters left wrong at the end, so accuracy and speed are one number rather than two.' },
      { q: 'What counts as an error?', a: 'Any character that does not match the target at the moment you type it. Fixing it with backspace removes it from the net score but it is still counted in the per-key breakdown, because it is still a key you struggle with.' },
      { q: 'Can I practise code and symbols specifically?', a: 'Yes. The text picker has real code, a punctuation drill and a numbers-and-symbols mode. Those are the three that actually slow programmers down.' },
      { q: 'Is my typing sent anywhere?', a: 'No. Everything is computed in the page, and your results are stored in your own browser. There is no server involved at any point.' },
      { q: 'How is this different from the typing test in Labs?', a: 'The lab is a quick benchmark — one short passage, a number at the end. This is for practice: longer texts, several durations, a per-key breakdown and a history you can watch improve.' },
    ],
    related: ['love-calculator', 'snake', '2048'],
  },

  {
    slug: 'love-calculator',
    touch: "Type two names and tap Calculate.",
    cat: 'fun',
    name: 'Love calculator',
    glyph: '♥',
    tag: 'Joke',
    script: 'fun/love-calculator.js',
    board: true, pad: 'none',
    bestKey: null,
    engine: 'A hash function wearing a disguise',
    title: 'Love Calculator — Two Names, One Number, Zero Science',
    ogTitle: 'A love calculator that admits what it is',
    description: 'Type two names, get a percentage. It is a hash function, not a compatibility model — and ' +
      'then this page shows what actually predicts whether couples last.',
    short: 'Two names, one number, no science whatsoever.',
    h1: 'Love calculator',
    hero: 'Type two names and get a number. Every love calculator on the internet does this, and every single one ' +
      'of them is doing what this one does: hashing the letters. The difference is that this page will tell you ' +
      'so, show you the working, and then link you to the only piece of writing here that has anything true to ' +
      'say about the question.',
    facts: [
      'Deterministic &mdash; the same names always give the same number',
      'Nothing is stored or sent',
      'The maths is shown',
      'Zero predictive value, stated plainly',
    ],
    hud: [
      { key: 'result', label: 'Score', accent: true, init: '—' },
    ],
    keys: [
      { k: 'Enter', d: 'Calculate' },
    ],
    infoHeading: 'How it actually works, since somebody should say',
    info: [
      {
        h: 'It is FNV-1a, and that is all it is',
        p: 'Both names are lowercased, stripped of spaces, sorted so the order does not matter, and run through a ' +
          'small well-known hash function. The result is taken modulo 101. That is the entire algorithm, it is ' +
          'printed on the page after every calculation, and it is exactly as romantic as it sounds.',
      },
      {
        h: 'Which is why it never changes its mind',
        p: 'Put the same two names in tomorrow and you get the same number, because a hash is a pure function of ' +
          'its input. Every site that promises a "fresh reading" is either lying or using a random number, and ' +
          'a random number would at least be honest about knowing nothing.',
      },
      {
        h: 'The trick these sites actually run',
        p: 'The number is not the product. Your two names are, and on most of these sites they go straight to a ' +
          'server. It is the same pattern as the resume builders that hold your work history hostage behind a ' +
          'download button. Here the calculation happens in your tab and nothing is transmitted, which you can ' +
          'verify in your own network tab &mdash; there is nothing to see.',
      },
      {
        h: 'And if you wanted the real answer',
        p: 'There is a piece here on the kinds of love and on choosing a life partner, which is about values, ' +
          'timing, how someone treats people who can do nothing for them, and what you both do when it is hard. ' +
          'None of it fits in a percentage. <a href="/blog/types-of-love-and-choosing-a-life-partner">Read that ' +
          'instead &rarr;</a>',
      },
    ],
    faq: [
      { q: 'Is this real?', a: 'No, and it is not pretending to be. It is a hash function: a deterministic way of turning text into a number. It knows nothing about either person and could not, since two names are not information about a relationship.' },
      { q: 'Why do I get the same number every time?', a: 'Because a hash always maps the same input to the same output. That is the point of one. A calculator that gave a different answer each time would be using randomness and calling it insight.' },
      { q: 'Does the order of the names matter?', a: 'No. The two names are sorted before hashing, so "Asha and Ravi" and "Ravi and Asha" give the same result. It seemed the least defensible asymmetry to leave in.' },
      { q: 'Are the names sent anywhere?', a: 'No. Everything happens in your browser and nothing is stored, not even locally. Close the tab and it is gone.' },
      { q: 'So what does predict whether a relationship works?', a: 'Not letters in a name. Shared values, how you argue, whether you are both willing to change, and what each of you does under stress. There is a long piece about it on the blog, linked above.' },
    ],
    related: ['typing-trainer', '2048', 'minesweeper'],
  },
  {
    slug: 'aquarium',
    cat: 'toy',
    name: 'Aquarium',
    glyph: '≋',
    script: 'toy/aquarium.js',
    width: 640, height: 440, bestKey: null, pad: 'none',
    tapAction: true,
    engine: 'Per-species flocking &middot; caustic buffer',
    title: 'Reef Aquarium — Schooling Fish, Free In Your Browser',
    ogTitle: 'Each species schools only with its own',
    description: 'A reef tank with real flocking: every species schools only with its own kind, two loners ignore the shoal, and the light runs a day and night cycle.',
    short: 'Five species, and none of them mix.',
    h1: 'Reef aquarium',
    hero: 'Ninety fish, and not one of them can see the tank. Each takes its heading from the neighbours it can see and only from the ones that look like it &mdash; so a shoal of tetras parts around an angelfish instead of recruiting it, and five species share one box without ever becoming one flock. The light moves too. Leave it running and the lamp goes out, the caustics go with it, and every fish slows down and sinks toward the sand.',
    facts: [
      'Each species schools alone',
      'Two loners ignore everyone',
      'A whole night in three minutes',
      'Tap the water to feed them',
    ],
    hud: [
      { key: 'fish', label: 'Fish', accent: true, init: '90' },
      { key: 'species', label: 'Stock', init: '3 schooling + 2 loners' },
      { key: 'light', label: 'Light', init: 'Daylight' },
    ],
    controls: [
      '<label class="sr-only" for="game-fish">Fish</label>',
      '<select class="game-select" autocomplete="off" id="game-fish"><option value="40">40 fish</option><option value="90" selected>90 fish</option><option value="160">160 fish</option></select>',
      '<label class="sr-only" for="game-species">Species mix</label>',
      '<select class="game-select" autocomplete="off" id="game-species"><option value="shoal">One shoal</option><option value="mixed" selected>Three species</option><option value="reef">Full reef</option></select>',
      '<label class="game-range"><span>Current</span><input type="range" id="game-current" min="0" max="150" value="60" /></label>',
      '<label class="sr-only" for="game-light">Lighting</label>',
      '<select class="game-select" autocomplete="off" id="game-light"><option value="day">Daylight</option><option value="night">Night</option><option value="auto" selected>Day and night</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-bubbles" aria-pressed="true" title="Air stones on or off" aria-label="Air stones on or off">◦</button>',
    ],
    keys: [
      { k: 'Space', d: 'Drop a pinch of food' },
      { k: 'Click', d: 'Feed at that spot in the water' },
    ],
    touch: 'Tap the water to drop a pinch of food where you tapped. The current slider changes the flow; the dropdowns change the stock and the lighting.',
    infoHeading: 'How the tank works',
    info: [
      {
        h: 'A neighbour has to be the same fish',
        p: 'Reynolds\'s three rules are here unchanged, with one extra test on top: alignment and cohesion are read only from a fish of the same species, and a neighbour of any other species contributes separation and nothing else. That single comparison is the whole difference between five species in a tank and one enormous flock wearing five colours. The angelfish and the wrasse take no alignment or cohesion at all, from anything &mdash; they wander, and the shoals get out of their way.',
      },
      {
        h: 'The tank has a back, and everything follows from it',
        p: 'Every fish carries a depth as well as a position, so the flocking runs in three dimensions and a school has a shape going away from you rather than being a pattern painted on glass. The depth then pays for itself several times over: a fish at the back is drawn smaller and mixed toward the colour of the water in front of it, the sand it can swim down to is higher because the floor slopes away, and the rockwork at the far end ripples because it is seen through a tank\'s worth of moving water while the front of the tank is not.',
      },
      {
        h: 'The light on the sand is eighty pixels wide',
        p: 'The caustic net is computed into a buffer a twentieth of the size of the tank and stretched over the sand, where the browser\'s own smoothing does the blurring for nothing &mdash; light through moving water is never sharp, so the cheap version is also the correct one. The field is three sine waves summed, with the bright filaments taken where they cancel, and it is evaluated through the angle-addition identity so the cost is about four hundred sines a frame instead of six thousand.',
      },
    ],
    faq: [
      { q: 'Can I stop it going dark?', a: 'Yes. The lighting dropdown offers Daylight and Night as fixed settings as well as the automatic cycle, and it eases between them rather than switching, so choosing one halfway through a dusk is not a light switch being thrown.' },
      { q: 'Why do two of the fish ignore the shoal?', a: 'Because two of them are meant to. The angelfish and the wrasse have their schooling weight set to zero, so they take no heading and no company from anything in the tank and simply wander it. A tank where every fish shoals reads as a screensaver; the loners are what make it read as a tank somebody keeps.' },
      { q: 'What does the food do?', a: 'Fish within about a hundred units of a flake break off whatever they were doing and go for it, and the flake is gone the moment one reaches it. Anything nobody finds settles on the sand and dissolves after a few seconds. They are a good deal less interested at night.' },
    ],
    related: ['boids', 'rain', 'fountain'],
  },

  {
    slug: 'fireworks',
    cat: 'toy',
    name: 'Fireworks',
    glyph: '✺',
    script: 'toy/fireworks.js',
    width: 640, height: 460, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Ballistic stars &middot; reports at distance over c',
    title: 'Fireworks — The Bang Arrives After The Flash',
    ogTitle: 'You have already seen it. The bang is still on its way.',
    description: 'Peonies, willows and crossettes under real gravity, and the report reaches you late by the distance over the speed of sound. Click to launch a shell.',
    short: 'Real bursts, and a bang that lands late.',
    h1: 'Fireworks',
    hero: 'Shells climb on a trail, slow to nothing at the top, and break into a peony, a chrysanthemum trailing sparks, a willow that droops, a crossette that splits again, a ring, or a shell that breaks four times over. Every star is under gravity and drag and burns down from white-hot to a dull ember, and the smoke hangs about afterwards and drifts. The detail the whole thing rests on is the one you cannot see: each report is booked at the distance of its own burst divided by the speed of sound, so the bang lands about half a second <em>after</em> the flash &mdash; which is most of the difference between fireworks and moving dots.',
    facts: [
      'The bang lands after the flash',
      'Six real shell types',
      'Smoke that lingers and drifts',
      'No flashing under reduced motion',
    ],
    hud: [
      { key: 'shells', label: 'Shells', accent: true, init: '0' },
      { key: 'delay', label: 'Report lag', init: '—' },
      { key: 'sparks', label: 'Sparks', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-type">Shell type</label>',
      '<select class="game-select" autocomplete="off" id="game-type"><option value="random" selected>Random shells</option><option value="peony">Peony</option><option value="chrysanthemum">Chrysanthemum</option><option value="willow">Willow</option><option value="crossette">Crossette</option><option value="ring">Ring</option><option value="multi">Multi-break</option></select>',
      '<label class="game-range"><span>Rate</span><input type="range" id="game-rate" min="5" max="100" value="45" /></label>',
      '<label class="game-range"><span>Size</span><input type="range" id="game-size" min="60" max="140" value="100" /></label>',
      '<label class="sr-only" for="game-palette">Colour</label>',
      '<select class="game-select" autocomplete="off" id="game-palette"><option value="classic" selected>Classic</option><option value="gold">Gold</option><option value="ember">Ember</option><option value="cool">Cool</option><option value="chrome">Chrome</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-finale" aria-pressed="false" title="Finale: empty the rack" aria-label="Finale">✹</button>',
    ],
    keys: [
      { k: 'Space', d: 'Put one up' },
      { k: 'Click', d: 'Launch a shell toward that point' },
      { k: 'F', d: 'Finale' },
    ],
    touch: 'Tap anywhere in the sky and the nearest mortar throws a shell at it. The finale button empties the rack for about fourteen seconds.',
    infoHeading: 'Why the bang is late',
    info: [
      {
        h: 'The bang is late, and by how much',
        p: 'A break 170 m up, seen from 120 m back, is 208 m away, so its report takes 0.61 s to arrive. Every sound here is booked into the audio clock at its own distance divided by 343 m/s &mdash; the launch thump too, because the mortar is 120 m away as well. The HUD prints the last figure, and across the frame it runs from about 380 ms on a low break to 830 ms on a high one out at the edge.',
      },
      {
        h: 'Six shells, and the difference between them is four numbers',
        p: 'A peony and a willow are both a sphere of stars. What separates them is drag and burn time: a peony stops about 105 px out because 100 px/s against a drag of 0.95 goes nowhere further, while a willow is barely slowed at all and burns for three and a half seconds, so gravity has time to pull it into fronds. Nothing in the code bends a willow downward. It simply stops being thrown outward before it stops falling.',
      },
      {
        h: 'Nothing here flashes fast',
        p: 'A burst lifts the whole frame for a moment, and a full-field luminance change repeated fast enough is a seizure risk. So the lift is rate-capped at two a second against the WCAG 2.3.1 general threshold of three, peaks at roughly a tenth of full luminance over a near-black sky, and is not drawn at all when the browser reports <code>prefers-reduced-motion</code> &mdash; where the whole display also runs at six tenths speed, propagation delays stretched to match.',
      },
    ],
    faq: [
      { q: 'Why does a shell take so long to go up?', a: 'Because it does. A six-inch shell leaves the tube at about 72 m/s and needs five and a quarter seconds to reach 170 m. An earlier version used a brisker gravity to make the rise snappier and it had to come out: with time compressed and distance not, the report arrived a quarter of the way through the burst, and the one detail this toy exists for looked like audio latency.' },
      { q: 'Why does a high burst sound duller than a low one?', a: 'Air absorbs high frequencies far faster than low ones &mdash; roughly 0.005 dB per metre at 1 kHz against about 0.09 at 8 kHz. Over 200 m that is a decibel lost down low and eighteen up top, so the sharp crack of a close break has gone by the time a high one reaches you and only the roar is left. The report rolls its own top end off with distance for exactly that reason.' },
      { q: 'Is the sound recorded?', a: 'No. Every thump, report and crackle is built in the tab with the Web Audio API, so there is nothing to download and nothing to license. The crackle is one noise source through a gain following a curve of random spikes, which is all a crackle is, and costs four nodes instead of the forty separate grains the first version fired per shell.' },
    ],
    related: ['disco', 'rain', 'aafire'],
  },

  {
    slug: 'kaleidoscope',
    cat: 'toy',
    name: 'Kaleidoscope',
    glyph: '❋',
    script: 'toy/kaleidoscope.js',
    width: 640, height: 460, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Dihedral stamping &middot; steered flow field',
    title: 'Kaleidoscope — Draw Into A Mirror Barrel, Free In Your Browser',
    ogTitle: 'Draw one line and get twenty-four',
    description: 'Draw one line and a mirror barrel turns it into a figure. Three to twenty-four segments, true reflection or pure rotation, and a PNG you can keep.',
    short: 'Draw once. It comes back mirrored.',
    h1: 'Kaleidoscope',
    hero: 'A pointer, and a barrel of mirrors around it. Every stroke is copied into as many wedges as there are segments, and reflected as well if the mirror is on &mdash; so a scribble comes back as a figure. Your hand does the rest: the palette advances with how fast you draw, and the brush thins as you accelerate. Leave it alone and a pen of its own takes over, steered by a slowly drifting flow field, and it will not draw you the same figure twice.',
    facts: [
      'Three to twenty-four segments',
      'Mirror on, or pure rotation',
      'Draws itself if you leave it',
      'Save the figure as a PNG',
    ],
    hud: [
      { key: 'fold', label: 'Symmetry', accent: true, init: '24-fold' },
      { key: 'pen', label: 'Pen', init: 'Auto' },
      { key: 'spin', label: 'Spin', init: '5°/s' },
    ],
    controls: [
      '<label class="game-range"><span>Segments</span><input type="range" id="game-segments" min="3" max="24" value="12" /></label>',
      '<button class="game-btn game-btn-icon" type="button" id="game-mirror" aria-pressed="true" title="Mirror is on &mdash; every wedge is reflected as well as turned" aria-label="Mirror the wedges">◫</button>',
      '<label class="game-range"><span>Rotation</span><input type="range" id="game-spin" min="-100" max="100" value="22" /></label>',
      '<label class="game-range"><span>Brush</span><input type="range" id="game-brush" min="6" max="100" value="40" /></label>',
      '<label class="sr-only" for="game-palette">Colour</label>',
      '<select class="game-select" autocomplete="off" id="game-palette"><option value="spectrum" selected>Spectrum</option><option value="ember">Ember</option><option value="ice">Ice</option><option value="mono">Mono</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-auto" aria-pressed="true" title="Auto-draw is on &mdash; click to take the pen" aria-label="Auto-draw">∞</button>',
      '<button class="game-btn game-btn-icon" type="button" id="game-clear" title="Clear the figure" aria-label="Clear the figure">⌫</button>',
      '<button class="game-btn game-btn-icon" type="button" id="game-save" title="Save the figure as a PNG" aria-label="Save the figure as a PNG">⤓</button>',
    ],
    keys: [
      { k: 'Drag', d: 'Draw &mdash; your speed sets the colour and the width' },
      { k: 'Space', d: 'Hand the pen to the machine, or take it back' },
      { k: '←/→', d: 'Fewer or more segments' },
      { k: '↑/↓', d: 'Turn the whole figure faster, slower, or the other way' },
    ],
    touch: 'Drag anywhere in the disc to draw. Move fast for a thin line that races through the palette, slowly for a thick one that stays in the same family of colours &mdash; and tap auto-draw to hand the pen back.',
    infoHeading: 'How it works',
    info: [
      {
        h: 'Turning is one symmetry, mirroring is another',
        p: 'With the mirror off, your stroke is copied by rotation alone &mdash; the cyclic group &mdash; and the figure keeps its handedness, so a spiral comes out as a pinwheel that leans one way. Switch the mirror on and each copy is reflected as well, which doubles the count and takes the handedness away. That is the dihedral group, and it is what the two mirrors in a real barrel actually do to the light. A real barrel cannot turn it off.',
      },
      {
        h: 'The ink is not on the canvas',
        p: 'The shell clears the playfield before every frame, so the figure is kept in an off-screen buffer that nothing ever clears, and each frame turns it a little and blits it once. That is why the slow rotation of the whole figure costs one transform instead of redrawing every stroke, and why ten thousand marks draw exactly as fast as one. Every copy of a stroke also goes into a single path with a precomputed table of sines and cosines, so twenty-four segments cost the same two <code>stroke</code> calls as three.',
      },
      {
        h: 'The pen that draws when you do not',
        p: 'Auto-draw is a pen steered by a flow field whose coefficients drift on four slow sines. It carries a heading rather than sitting wherever the field points, which matters more than it sounds: a pen placed by a planar field can only ever settle into a closed orbit, and the first version did exactly that &mdash; the same twelve-pointed star, redrawn for as long as you watched. Each mark it lays also strikes one soft note, pitched by how far from the middle it fell.',
      },
    ],
    faq: [
      { q: 'Where does the picture go when I save it?', a: 'Into your downloads, built in the tab. The page composes the ground, the current rotation and the ink onto one 1280-pixel canvas and hands the browser a PNG. Nothing is uploaded, and no server ever sees the figure.' },
      { q: 'Why does my line change colour as I draw?', a: 'The palette advances with the pen rather than being picked per stroke. A slow base drift keeps it moving even when you hold still, and a term in your speed means a fast stroke sweeps a third of the wheel while a slow one stays in one family of colours.' },
      { q: 'Does it flash?', a: 'No. Ink accumulates gradually, the auto-mode fade removes about one per cent of it twice a second, and the only instantaneous change to the whole disc is the Clear button, which is a thing you pressed. If your system asks for reduced motion the rotation slider starts at zero, so nothing turns until you ask it to.' },
    ],
    related: ['falling-sand', 'boids', 'cbonsai'],
  },

  {
    slug: 'traffic',
    cat: 'cs',
    name: 'Traffic',
    glyph: '╬',
    script: 'cs/traffic.js',
    width: 640, height: 440, bestKey: null, pad: 'none',
    tapAction: false,
    engine: 'Wait-for graph &middot; four quadrant locks',
    title: 'Traffic — Cause A Deadlock At A Junction',
    ogTitle: 'Four cars, four quadrants, nobody moves',
    description: 'Four cars, four quadrant locks, and the Coffman conditions named as they happen. Try lights, a four-way stop and a roundabout, and watch a lane starve.',
    short: 'Cause a deadlock. Then prevent it.',
    h1: 'Traffic',
    hero: 'Four cars reach a crossroads at the same moment. Each edges in, takes the quarter of the box directly ahead of it, and then finds the next quarter already held by the car on its right &mdash; who is waiting on the car in front of <em>them</em>. Nobody can reverse, so nobody moves again. That is not bad driving. It is a deadlock, with all four textbook conditions satisfied at once, drawn to scale in tarmac.',
    facts: [
      'Four quadrants, four locks',
      'The wait-for graph, drawn on the road',
      'All four Coffman conditions, live',
      'One rule makes deadlock impossible',
    ],
    hud: [
      { key: 'thru', label: 'Throughput', accent: true, init: '0/min' },
      { key: 'wait', label: 'Mean wait', init: '—' },
      { key: 'max', label: 'Max wait', init: '0.0s' },
      { key: 'dead', label: 'Deadlocks', init: '0' },
      { key: 'state', label: 'Status', init: 'Running' },
    ],
    controls: [
      '<label class="sr-only" for="game-scheme">Control strategy</label>',
      '<select class="game-select" autocomplete="off" id="game-scheme"><option value="none" selected>Uncontrolled</option><option value="lights">Traffic lights</option><option value="stop">Four-way stop</option><option value="circle">Roundabout</option></select>',
      '<label class="game-range"><span>North</span><input type="range" id="game-north" min="0" max="40" value="22" /></label>',
      '<label class="game-range"><span>East</span><input type="range" id="game-east" min="0" max="40" value="22" /></label>',
      '<label class="game-range"><span>South</span><input type="range" id="game-south" min="0" max="40" value="22" /></label>',
      '<label class="game-range"><span>West</span><input type="range" id="game-west" min="0" max="40" value="22" /></label>',
      '<label class="game-range"><span>Green</span><input type="range" id="game-green" min="3" max="20" value="9" /></label>',
      '<button class="game-btn" type="button" id="game-holdwait" aria-pressed="false" title="Deny hold-and-wait: make a car take both quadrants at once">Deny hold-and-wait</button>',
      '<button class="game-btn" type="button" id="game-preempt" title="Preemption: reverse the longest-blocked car out of the box">Clear the jam</button>',
    ],
    keys: [
      { k: 'Space', d: 'Deny or allow hold-and-wait' },
      { k: 'Click', d: 'Send a car down that approach' },
    ],
    touch: 'Tap an arm of the junction to send a car down it &mdash; four taps, one per arm, and an uncontrolled junction locks on demand. The four sliders set how many cars a minute arrive on each approach; the dropdown picks the rule.',
    infoHeading: 'What the junction is standing in for',
    info: [
      {
        h: 'The box is four locks, not one',
        p: 'Split the junction into quadrants and drive on the right, and every straight-through movement needs exactly two of them in sequence: north takes the north-east then the south-east, east takes the south-east then the south-west, and so on round. Approach <code>a</code> wants quadrant <code>a</code> and then quadrant <code>a+1</code> &mdash; four drivers, four resources, each holding one and waiting on the next, in a ring. That shape was not invented to make a nice demo. It falls out of which side of the road people drive on.',
      },
      {
        h: 'Why the lights cannot deadlock',
        p: 'Not because they detect anything &mdash; a fixed cycle has no idea what is in the box. Green only ever goes to two opposite movements, and those two use quadrant sets with nothing in common: north and south between them need all four, and never the same one. A phase that cannot produce a conflict cannot produce a cycle. What it costs is that green arrives on a timer rather than on demand, so push one arrival slider to the top and drag the green time down, and that arm starves while the light is busy serving an empty one. Its max wait is the number that says so.',
      },
      {
        h: 'Detected, not guessed &mdash; and livelock is a different failure',
        p: 'The deadlock counter is not watching for a junction that merely looks jammed. Every frame the four quadrant holders are walked as a wait-for graph &mdash; this car waits on that one, which waits on the next &mdash; and a cycle in that graph is a deadlock by definition, which is the same test an operating system runs on its own. The roundabout cannot produce one, because a car there rolls back out rather than sitting on what it holds. What it can produce is livelock: a car takes a quadrant, loses the next, reverses out, and does it again five and six times over. Nothing is stuck; nothing is progressing either. Push all four sliders to the top on the roundabout and one arm will do exactly that for half a minute at a time.',
      },
    ],
    faq: [
      { q: 'What are the four Coffman conditions?', a: 'Mutual exclusion, hold and wait, no preemption, and circular wait. All four have to hold at the same instant for a deadlock, which is why the panel shows them as four separate lights rather than as one warning — deny any single one and the entire failure becomes impossible. The Deny hold-and-wait button does that to the second one, and Clear the jam does it to the third.' },
      { q: 'How do I make it deadlock on purpose?', a: 'Leave it on Uncontrolled and tap each of the four arms in turn, which sends a car down all four at once. Otherwise just wait: at the default arrival rates the junction locks itself somewhere inside the first minute, every time, and each jam is counted.' },
      { q: 'Which strategy is actually best?', a: 'None of them, which is the point. The four-way stop is perfectly fair and pushes about half the traffic of the others, because it serialises the whole box to one car. The lights and the roundabout are close at an even load; the lights lose when the load is uneven, because they keep giving green to an empty arm, and the roundabout loses when contention is heavy, because a rolled-back car did work that produced nothing. Uncontrolled looks quickest for about a minute and then spends a third to a half of its time gridlocked — deny hold-and-wait and it becomes as fast as anything here, which is the real lesson.' },
    ],
    related: ['game-of-life', 'boids', 'guess-the-algorithm'],
  },

  {
    slug: 'phishing-inbox',
    cat: 'cs',
    name: 'Phishing inbox',
    glyph: '@',
    script: 'cs/phishing-inbox.js',
    width: 720, height: 520, bestKey: 'phishing-inbox', pad: 'lr',
    tapAction: false,
    engine: 'Thirty-four messages &middot; eighteen a run',
    title: 'Phishing Inbox — Triage The Mail Against A Clock',
    ogTitle: 'The genuine ones are the hard part.',
    description: 'Thirty-four invented messages, and several legitimate ones that look alarming. Sort each as safe or phishing, then see the signal you missed highlighted.',
    short: 'Sort the inbox before the clock does.',
    h1: 'Phishing inbox',
    hero: 'Messages arrive one at a time and you call each one safe or phishing before the bar runs out. The link in each shows a brand\'s own address; where it <em>actually</em> goes appears only when you hover it, which costs you seconds you do not have &mdash; that trade is the entire game. Twelve of the thirty-four are genuine, and several of those are the most alarming things in the deck, because a player who learns to flag everything has learned to ignore the alerts that matter.',
    facts: [
      'Thirty-four messages, eighteen a run',
      'Twelve of them are genuine',
      'Every signal boxed where it sits',
      'Every brand and domain invented',
    ],
    hud: [
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'streak', label: 'Streak', init: '0' },
      { key: 'seen', label: 'Sorted', init: '0/18' },
      { key: 'best', label: 'Best', init: '—' },
    ],
    controls: [
      '<label class="sr-only" for="game-clock">Time per message</label>',
      '<select class="game-select" autocomplete="off" id="game-clock"><option value="20" selected>Steady &mdash; 20s a message</option><option value="12">Pressed &mdash; 12s a message</option><option value="0">No clock</option></select>',
      '<button class="game-btn" type="button" id="game-reveal" aria-pressed="false" title="Show every link destination without hovering">Pin link targets</button>',
    ],
    keys: [
      { k: '← or S', d: 'Sort it as safe' },
      { k: '→ or P', d: 'Sort it as phishing' },
      { k: '↑ ↓', d: 'Reveal where the link really goes' },
      { k: 'Space', d: 'Next message, once you have been told why' },
    ],
    touch: 'Tap the link itself to see where it really goes, then use the ◀ and ▶ pad buttons to sort &mdash; left is safe, right is phishing. Once the verdict is up, tap anywhere on the message or press Action for the next one.',
    infoHeading: 'Why a clock changes what this teaches',
    info: [
      {
        h: 'The genuine messages are the exam',
        p: 'If every real message in a drill is calm and every attack is frantic, what people take away is "be suspicious of anything urgent" &mdash; which is a habit of ignoring real security alerts, and does nothing at all about a well-written attack. So a third of this deck is genuine, and it includes a password expiring in four hours, VPN access revoked overnight and a season ticket about to charge itself. A false alarm costs exactly what a miss costs, and the panel beside the message tracks <em>Genuine</em> as a lure type of its own, because for most players it is the one that keeps winning.',
      },
      {
        h: 'The link is two claims, and only one is checkable',
        p: 'Every message renders like a mail client: display name, the address behind it, subject, body, and a link whose visible text is the brand\'s own address. Where it goes is shown only when you hover it, press up, or tap it &mdash; the bargain a browser\'s status bar makes. That is where the deck hides most of itself: an open redirect that really does start at the right domain and does not stay there, a punycode spelling that renders as the brand, a hyphen standing where a dot would have meant something completely different. Reading a domain right to left, the last two labels are the only part that says who owns it, and everything in front of them is the attacker\'s to choose.',
      },
      {
        h: 'You are shown the signal, not told the reason',
        p: 'On calling a message, every tell is boxed where it sits &mdash; the doubled label in the address, the sentence about a bank account that has moved, the phone number that steers you off the one printed on your card &mdash; and numbered against a one-line note beside it. A paragraph underneath teaches you the paragraph; a box drawn around four characters in the middle of a domain teaches you where to look next time. The eighteen are drawn five from the obvious tier, six from the middle and seven from the subtle one, so the run ends on a compromised colleague replying into a thread you were already in.',
      },
    ],
    faq: [
      { q: 'Are any of these real companies?', a: 'None of them. Every brand, person, domain, address and phone number in the deck is invented: the domains all sit under .example, which is reserved and can never be registered by anyone, and the IP addresses come from the ranges set aside for documentation. Nothing here links anywhere, and no real campaign or company\'s mail is reproduced &mdash; the lesson is in the shape of the thing, and the shape is what has been kept.' },
      { q: 'I keep failing the genuine ones. Is that bad?', a: 'It is the most common result and the most useful thing the game can tell you. Calling everything phishing is not caution: it means the real password expiry, the real revoked access and the real fraud alert all get treated as noise. The panel names it explicitly at the end of a run, and it names it far more often than any of the attack types.' },
      { q: 'Can I turn the clock off?', a: 'Yes &mdash; the dropdown has a no-clock setting, and it applies from the next message rather than the one you are halfway through reading. Speed points go with it; the base score and the streak bonus stay, so a slow careful run still scores and simply will not top a fast one.' },
    ],
    related: ['phishing-or-not', 'password-duel', 'ctf-arcade'],
  },

  {
    slug: 'incident-response',
    cat: 'cs',
    name: 'Incident response',
    glyph: '◷',
    script: 'cs/incident-response.js',
    board: true,
    bestKey: 'incident-response', pad: 'none',
    tapAction: false,
    engine: 'Two scenarios &middot; four meters that trade against each other',
    title: 'Incident Response Tabletop — A Breach On A Clock',
    ogTitle: 'Isolate it fast and you destroy the evidence',
    description: 'Ransomware and a wire fraud, played over simulated hours. Isolate fast and the evidence goes with it; wait and the attacker moves. Ends in an after-action report.',
    short: 'A breach, a clock, and no good options.',
    h1: 'Incident response',
    hero: 'An alert fires at two in the morning and there are four things you could do, none of them free. Isolate the host and the volatile evidence goes with it; wait for more data and the attacker gets another twenty minutes; rebuild before imaging and you can never answer what left the building. Two scenarios &mdash; a ransomware outbreak and a wire fraud through a compromised mailbox &mdash; each with several branch points, and an after-action report at the end that names what your choices actually cost. Deciding under incomplete information <em>is</em> the skill; the meters are there to show you what you traded for what.',
    facts: [
      'Two scenarios, several branch points',
      'Four meters that fight each other',
      'The clock runs while you deliberate',
      'An after-action report, not just a score',
    ],
    hud: [
      { key: 'clock', label: 'Clock', accent: true, init: '02:14' },
      { key: 'phase', label: 'Decision', init: '1 of 7' },
      { key: 'score', label: 'Score', init: '0' },
      { key: 'best', label: 'Best', init: '0' },
    ],
    controls: [
      '<label class="sr-only" for="game-scenario">Scenario</label>',
      '<select class="game-select" autocomplete="off" id="game-scenario"><option value="ransomware" selected>Ransomware</option><option value="bec">Wire fraud</option><option value="surprise">Surprise me</option></select>',
      '<label class="sr-only" for="game-pressure">Pressure</label>',
      '<select class="game-select" autocomplete="off" id="game-pressure"><option value="measured">Measured</option><option value="standard" selected>Standard</option><option value="aggressive">Aggressive</option></select>',
      '<button class="game-btn game-btn-icon" type="button" id="game-log" aria-pressed="false" title="Timeline: showing the last three" aria-label="Timeline">&#9776;</button>',
    ],
    keys: [
      { k: '↑ ↓', d: 'Move between the options' },
      { k: 'Enter', d: 'Take that decision' },
      { k: 'Esc', d: 'Pause, and the clock stops with it' },
    ],
    touch: 'Tap an option to take it, read what it cost, then Carry on. The Timeline button opens the full log of the incident so far.',
    infoHeading: 'Why there is no right answer',
    info: [
      {
        h: 'Every choice costs minutes, and so does thinking',
        p: 'Each option carries its real cost &mdash; a disk image and memory capture is fifty-five minutes, a rebuild from the golden image is eight &mdash; and deliberation adds a quarter of a simulated minute for every real second, capped so that reading carefully can never cost more than a quarter of an hour on any one decision. The attacker&rsquo;s own schedule runs off the same clock, which is why an event can land while you are still reading the options rather than politely between two of them. The <strong>Measured</strong> pressure setting turns the deliberation clock off entirely and widens the attacker&rsquo;s timings, for anyone who wants to read at their own pace.',
      },
      {
        h: 'Four meters, and they pull against each other',
        p: 'Containment and evidence preserved want to be high; business impact and regulatory exposure want to be low. Almost nothing moves one without moving another the wrong way. Pull the power on a host and containment jumps while everything in memory goes with it. Watch it for twenty minutes and you learn the C2 address and the accounts in use, at the cost of twenty more minutes of encryption and one more server. Drop the whole server VLAN and nothing spreads, including payroll. There is no line through either scenario that maxes all four, and that is the lesson rather than a limitation of the model.',
      },
      {
        h: 'The mistakes are the ones people actually make',
        p: 'Working the loudest alert instead of the highest-confidence one. Rebuilding a host before imaging it, so that in four days nobody can say whether data left. Restoring from a backup nobody verified, onto files that were still clean. Telling four hundred people before legal has seen a word, in a mailbox the attacker is still reading. Warning a supplier by replying inside the thread the attacker controls. Each is offered as a reasonable-sounding option with a plausible case for it, and each is named in the after-action report if you take it &mdash; along with what a written plan would have decided in advance, by daylight, with more than one person in the room.',
      },
    ],
    faq: [
      { q: 'Is any of this legal advice?', a: 'No. It is a training exercise. Two real obligations are referenced as context: CERT-In&rsquo;s April 2022 direction under section 70B(6) of the IT Act asks for certain cyber incidents to be reported within six hours of noticing them, and GDPR Article 33 gives 72 hours from becoming aware of a personal-data breach to notify the supervisory authority. Which duties apply to a real organisation depends on where it operates and what data it holds.' },
      { q: 'Does a replay actually differ?', a: 'Yes. There are two scenarios, and inside each one your earlier choices remove and add later options — ask the bank for a wire recall in the first five minutes and the beat that offers it later never appears at all; keep watching the encrypting host and a chance to isolate it opens up that a contained run never sees. Surprise me picks a scenario for you.' },
      { q: 'Why does the clock move while I am reading?', a: 'Because it does on a real incident, and a tabletop where time only passes when you click teaches the opposite of the thing worth teaching. It is capped at fifteen simulated minutes per decision so careful reading is never punished for long, and the Measured setting switches it off completely.' },
    ],
    related: ['phishing-or-not', 'password-duel', 'ctf-arcade'],
  },

  /* ---- added in the labs/games/posts batch ---- */
  {
    slug: 'assembly-golf',
    cat: 'cs',
    name: 'Assembly golf',
    glyph: 'RET',
    script: 'cs/assembly-golf.js',
    board: true,
    pad: 'none',
    bestKey: 'assembly-golf',
    bestOrder: 'low',
    tapAction: false,
    engine: 'Twenty instructions, four registers, 24 cells with the stack in them',
    title: 'Assembly Golf — Shortest Program Wins',
    ogTitle: 'Eight functions, as few instructions as you can',
    description: 'Write the shortest program that passes the hidden tests. Eight functions on an invented twenty instruction machine, scored on length and not on speed.',
    short: 'Eight functions, shortest program wins.',
    h1: 'Assembly golf',
    hero: 'Eight functions to write &mdash; absolute value, a greatest common divisor, a string reversed in memory &mdash; on a machine with four registers, twenty-four cells and twenty instructions. Being right is only half of it: the score is how many instructions you wrote, and the lower number is the better one. The cycles your program spent are printed beside it and never added in, because on at least one of these levels the shortest answer and the quickest answer are not the same program, and folding the two figures together would hide the only trade worth learning.',
    facts: [
      'Twenty instructions',
      'Eight functions to write',
      'Test cases are hidden',
      'Par is measured, not typed'
    ],
    hud: [
      { key: 'level', label: 'Level', init: '1/8' },
      { key: 'score', label: 'Instructions', accent: true, init: '0' },
      { key: 'cycles', label: 'Cycles', init: '0' },
      { key: 'best', label: 'Best', init: '&mdash;' }
    ],
    controls: [
      '<label class="sr-only" for="game-level">Level</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="0" selected>1. Absolute value</option><option value="1">2. The smaller of two</option><option value="2">3. Sum 1 to n</option><option value="3">4. Count the set bits</option><option value="4">5. Reverse a string in memory</option><option value="5">6. Greatest common divisor</option><option value="6">7. Is it prime</option><option value="7">8. Fizzbuzz codes</option></select>',
      '<button class="game-btn" type="button" id="game-run">Run</button>',
      '<button class="game-btn" type="button" id="game-step">Step</button>',
      '<button class="game-btn" type="button" id="game-submit">Submit</button>'
    ],
    keys: [
      { k: 'Type', d: 'Write the program' },
      { k: 'Step', d: 'One instruction at a time' },
      { k: 'Run', d: 'Watch one case go past' },
      { k: 'Submit', d: 'Run every hidden case' }
    ],
    touch: 'Tap the program box to raise the keyboard; Run, Step and Submit are buttons in the toolbar, with the level menu beside them. Tapping the board itself does nothing, so a stray thumb cannot disturb a run.',
    infoHeading: 'What the two numbers mean, and what this machine is not',
    info: [
      {
        h: 'Length is the score. Cycles are the price',
        p: 'Your score is the number of instructions you wrote, summed over the eight levels, and nothing else goes into it &mdash; comments and labels are free. Beside it sits the cycle count: what your program actually cost to run across every hidden case, on a price list where <code>ADD</code> is one cycle, <code>MUL</code> is three and <code>DIV</code> is six. The two numbers pull against each other. Level seven is built to prove it: the shortest primality test divides by everything below n, and stopping at the square root instead costs two more instructions and a small fraction of the work. Every optimiser in a real <a href="/labs/compiler">compiler</a> is making some version of that choice, which is why <code>-Os</code> and <code>-O2</code> are different flags.'
      },
      {
        h: 'Par is measured, and it is only the shortest I found',
        p: 'Each level ships the shortest program I could write for it, as source text. Par is not typed into a table &mdash; the page assembles that program and runs it against the hidden cases when it opens, and prints what it actually cost. So par cannot drift out of date, and a reference program that stopped working would announce itself on the first visit rather than being believed for a year. What it is not is a proof: it is the shortest I found on the afternoon I wrote it, not the shortest that exists, and beating it is the interesting part. Several of these almost certainly go shorter.'
      },
      {
        h: 'Why the test cases are hidden',
        p: 'Golf against a printed list of cases is golf against the list: the shortest program that satisfies eight visible examples is a table of eight answers, and it teaches nothing. So the battery is hidden and two cases are shown, which is enough to make the signature unambiguous and not enough to cheat with. When a hidden case catches you it is revealed on the spot, with what it wanted and what your program actually left behind, and the machine panel is pointed at it so you can step through the exact run that failed. A case that has already done its job is no longer worth hiding.'
      },
      {
        h: 'The runaway guard is a cap, not a diagnosis',
        p: 'A program that has not finished after forty thousand cycles is stopped, and the message says it did not terminate within forty thousand cycles. It never says your program loops forever, because deciding that in general is the halting problem &mdash; there is no analysis that could be added here to answer it for every program, and the ones that look easiest are often the ones that are not. The commonest way to hit the cap is <code>DJNZ</code> on a counter that started at zero: it takes one off, misses zero going past, and counts down for a very long time.'
      },
      {
        h: 'This machine is invented, and it is not the one next door',
        p: 'Twenty instructions, four registers, twenty-four memory cells with the stack growing down through the top of them, and one signed flag standing in for the several a real processor keeps apart. It is a load/store design, so arithmetic happens between registers and memory is reached only through <code>LD</code> and <code>ST</code> &mdash; the same shape as any RISC, and the reason one line of C becomes three instructions. The cycle prices are invented but proportioned after real hardware. There is no pipeline, no cache, no interrupt and no penalty for a mispredicted branch, all of which matter enormously on a real chip. The <a href="/labs/cpu-simulator">CPU simulator</a> next door runs a fetch-decode-execute cycle a step at a time if you want to see where those go. The other assembly game here, <a href="/games/assembly-puzzles">assembly puzzles</a>, is a different machine with an input tape and a different scoring rule: it teaches what the instructions do, and this one assumes you already know.'
      }
    ],
    faq: [
      {
        q: 'How is this different from the assembly puzzles game?',
        a: 'Different machine and a different rule. That one hands you an input tape, asks for an output tape, and scores instructions plus cycles added together, so a working program is most of the win. Here the arguments arrive in registers and memory, there is a stack with CALL and RET, and the score is the length of your program on its own.'
      },
      {
        q: 'Why does it say my program did not terminate?',
        a: 'It ran past forty thousand cycles and was stopped. That usually means a loop whose exit test can never be true &mdash; a counter tested before it is changed, a DJNZ that started at zero, or a jump that lands above the instruction doing the work. The cap is a cap, not a diagnosis: no checker can decide in general whether a program will stop.'
      },
      {
        q: 'Is par really the shortest possible?',
        a: 'No, and nothing here claims it is. Par is the shortest program I found for that level, measured by running it rather than by writing a number down. If you beat it, the page says so, and you are right and it is wrong.'
      },
      {
        q: 'Why is my shorter program slower than par?',
        a: 'Because those are two different competitions and this game only scores one of them. Level seven is the clearest case: the ten instruction answer does far more work than the twelve instruction one. Both figures are shown so you can see what the length cost you.'
      },
      {
        q: 'Can I see the test cases?',
        a: 'Two of them, from the start. The rest stay hidden until one of them fails your program, at which point that case is shown with the value it wanted and the value it got, and loaded into the machine panel so you can step through it.'
      },
      {
        q: 'Are my programs saved anywhere?',
        a: 'They are kept in this browser, per level, and nothing is sent anywhere &mdash; there is no network call in the game at all. Restart clears your scores but leaves the code; clearing your site data removes both, along with your best.'
      }
    ],
    related: ['assembly-puzzles', 'regex-golf', 'guess-the-output'],
  },
  {
    slug: 'binary-search-duel',
    cat: 'cs',
    name: 'Binary search duel',
    glyph: '½',
    script: 'cs/binary-search-duel.js',
    board: true,
    pad: 'none',
    bestKey: 'binary-search-duel',
    bestOrder: 'low',
    tapAction: false,
    engine: 'Both halves &middot; an exact cheat detector',
    title: 'Binary Search Duel — Search, Then Answer',
    ogTitle: 'You cannot beat log n. Try it from both ends.',
    description: 'Narrow down my number and see the bits each guess wasted, then think of one while I search — and watch the first answer that contradicts an earlier one.',
    short: 'Narrow it down, then get narrowed down.',
    h1: 'Binary search duel',
    hero: 'Four rounds, alternating. In two of them I have written a number down and you hunt for it, with the interval still alive drawn as a bar, the candidates counted, and the cost of every off-centre guess worked out in bits. In the other two the roles swap: you think of a number and answer higher or lower, and I keep the interval your answers imply &mdash; so the moment two of them cannot both be true, I can name which two and show you the range they left empty. There is a third mode with no score in it at all, which is the one that reproduces the overflow bug that sat in java.util.Arrays.binarySearch for nine years.',
    facts: [
      'Two halves, roles reversed',
      'The bits you wasted, per guess',
      'An exact cheat detector',
      'The 2006 overflow bug, reproduced'
    ],
    hud: [
      { key: 'round', label: 'Round', init: '1 of 4' },
      { key: 'probes', label: 'Probes', init: '0 of 7' },
      { key: 'alive', label: 'Still alive', init: '100' },
      { key: 'over', label: 'Over par', accent: true, init: '0' },
      { key: 'best', label: 'Best', init: '&mdash;' }
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Mode</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="duel" selected>The duel &mdash; four rounds</option><option value="trap">The off-by-one trap</option></select>',
      '<label class="sr-only" for="game-range">Range</label>',
      '<select class="game-select" autocomplete="off" id="game-range"><option value="50">1 to 50</option><option value="100" selected>1 to 100</option><option value="1000">1 to 1,000</option><option value="10000">1 to 10,000</option></select>',
      '<button class="game-btn" type="button" id="game-hint" aria-pressed="true" title="The best next guess is shown under the bar">Show the midpoint</button>'
    ],
    keys: [
      { k: '← →', d: 'Move your guess by one, or answer lower and higher' },
      { k: '↑ ↓', d: 'Move your guess in bigger steps' },
      { k: 'Enter', d: 'Commit the guess, or say that is the one' },
      { k: 'Type', d: 'A guess straight into the field, if you would rather' },
      { k: 'Esc', d: 'Pause' }
    ],
    touch: 'Drag along the bar to place your guess &mdash; it clamps to the part still alive, so you cannot spend a guess on a number already ruled out &mdash; then tap the button underneath, which carries the number you set. In the answering half the three buttons are the whole interface. In the trap, the array cells are tappable and everything reruns the moment you change a setting.',
    infoHeading: 'Why log n is a floor and not a habit',
    info: [
      {
        h: 'One answer is one bit',
        p: 'A yes-or-no answer separates the candidates into two groups, so it can at best halve the survivors, and a guess that splits them unevenly halves them by less than that. The exact floor is slightly kinder than the usual <code>log2(n)</code>, because a correct guess ends the round rather than answering it: with <em>k</em> guesses you can separate at most <code>2^k &minus; 1</code> values, so par is the smallest <em>k</em> where that reaches <em>n</em>. For 64 candidates that is seven and not six &mdash; the sort of off-by-one this game is otherwise about, so it is computed by doubling rather than by rounding a logarithm. None of the four ranges offered is a power of two, so here the two formulas agree.'
      },
      {
        h: 'What an off-centre guess actually costs',
        p: 'After each guess the page prints two numbers: what the answer was worth, and what the guess could have guaranteed. Those differ, and the difference is the lesson. Guess 40 in a live interval of 1 to 61 and you might get lucky and knock out 39 of them &mdash; but before the answer arrived, that guess risked leaving 39 alive where the midpoint risks at most 30. The shortfall, <code>log2(39/30)</code>, is a third of a bit thrown away whichever way the answer fell, and luck cannot buy it back. That is what the score counts, and why a lucky first-guess hit does not make you good at this.'
      },
      {
        h: 'The half where you answer, and the two ways to bend it',
        p: 'When I am searching, every answer you give is a constraint, and I keep the interval all of them imply. If an answer makes that interval empty there is nothing to guess at &mdash; the panel names the two answers involved and the range between them that has nothing in it. The other tactic is not cheating at all: answer to keep the larger half every time and you are playing the adversary from the lower-bound proof, deciding as late as possible, and the search then takes exactly par rather than less. The page says which of the two it is watching, and says plainly that it cannot tell an adversary from somebody with an awkward number.'
      },
      {
        h: 'The off-by-one trap, and where to read more',
        p: 'The third mode has no score. It runs the same search with a midpoint you choose &mdash; <code>lo + (hi &minus; lo) / 2</code> or the natural-looking <code>(lo + hi) / 2</code> &mdash; and a loop you choose, and shows what that combination does to all sixteen elements of a small array: one loop finds every value, one misses eight of them, and one hangs on exactly one. On sixteen elements the two midpoints are identical, which is precisely why the overflow hid for nine years; switch to the two-billion-element array and the naive one goes negative on the second probe. Why log n is the floor rather than a convention is in the <a href="/labs/big-o">big-O playground</a>, and searches and sorts run step by step in the <a href="/labs/algorithm-visualizer">algorithm visualiser</a>.'
      }
    ],
    faq: [
      {
        q: 'Is the number chosen before I start guessing?',
        a: 'Yes. In the rounds where you search, the number is drawn when the round begins and does not move afterwards. Nothing here adapts to your guesses to keep the game going longer &mdash; which is exactly the trick the second half invites you to try on me, and the reason the second half has a checker in it.'
      },
      {
        q: 'Can I beat par?',
        a: 'Yes, by luck. Par is the worst case: it is the number of guesses that is always enough and sometimes necessary. Guess 50 in a range of 1 to 100 and hit it, and you have used one guess for a job that needs seven. The page says so rather than congratulating you, and the score treats any round at or under par as clean, so luck cannot improve your record either.'
      },
      {
        q: 'What counts as cheating in the half where I answer?',
        a: 'Only an answer that contradicts one you have already given &mdash; and it is detected rather than suspected, because the interval your answers imply becomes empty, and an empty interval means no number of any kind would have produced that sequence. Answering to keep the search working as long as possible is not cheating and is not penalised: it is the adversary argument, and the game names it and then finishes in exactly par.'
      },
      {
        q: 'How is the score worked out, and why is lower better?',
        a: 'It is the guesses you spent over par in the two rounds where you searched, plus two for each contradiction caught in the rounds where you answered. A flawless duel is worth nothing over par, so it shows as "par". The number written to your browser is actually one higher, because the shell reads a zero as "no run happened"; that offset never reaches the page, and it only matters if you go looking in local storage.'
      },
      {
        q: 'Does the overflow really happen in JavaScript?',
        a: 'No, and the page says so where it shows it. JavaScript numbers are doubles, so <code>lo + hi</code> stays exact well past two billion. To reproduce what a Java or C <code>int</code> does, the sum is pushed through a bitwise OR with zero, which truncates it to 32 signed bits. The wraparound is simulated; the arithmetic and the negative index that comes out of it are real, and are the bug Joshua Bloch wrote up in 2006.'
      },
      {
        q: 'Is anything uploaded, or kept?',
        a: 'Nothing is uploaded. Your best score, your chosen range and whether you want the midpoint shown are kept in this browser on this device, and the reset strip under the game clears exactly those and nothing else.'
      }
    ],
    related: ['guess-the-algorithm', 'assembly-puzzles', 'regex-golf'],
  },
  {
    slug: 'cache-game',
    cat: 'cs',
    name: 'Cache game',
    glyph: 'L1',
    script: 'cs/cache-game.js',
    board: true,
    pad: 'none',
    bestKey: 'cache-game',
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',
    engine: 'Set-associative simulator &middot; LRU, FIFO, MRU, random and Belady',
    title: 'Cache Game — A Cache Simulator You Play',
    ogTitle: 'You are the replacement policy',
    description: 'A real cache simulator. See the tag, index and offset split for every access, pick the evictions yourself, then optimise a loop against Belady optimal.',
    short: 'Be the cache, then beat it.',
    h1: 'Cache game',
    hero: 'Cache size, block size, associativity and a replacement policy, simulated properly &mdash; and the address cut into a tag, an index and an offset in front of you on every single access, because that decomposition is the part nobody quite internalises. On the first four levels you <em>are</em> the cache: the stream comes at you one access at a time and you say which line to throw out. On the last three the cache is fixed and the access pattern is yours to fix instead. Your misses are set beside the policy you chose and beside Belady optimal, which is computed for real by reading the rest of the stream and is therefore the one thing no cache can ever do.',
    facts: [
      'Tag, index and offset, every access',
      'Belady optimal, computed for real',
      'The three Cs counted separately',
      'Seven levels, three of them yours to optimise'
    ],
    hud: [
      { key: 'level', label: 'Level', init: '1/7' },
      { key: 'rate', label: 'Hit rate', init: '&mdash;' },
      { key: 'misses', label: 'Misses', init: '0' },
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'best', label: 'Best', init: '&mdash;' }
    ],
    controls: [
      '<label class="sr-only" for="game-level">Level</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="0" selected>1. Two ways, one choice</option><option value="1">2. Where LRU has nothing left</option><option value="2">3. Dirty lines cost more</option><option value="3">4. Ten blocks, eight lines</option><option value="4">5. Row-major or column-major</option><option value="5">6. One stride, one set</option><option value="6">7. Block the multiply</option></select>',
      '<label class="sr-only" for="game-policy">Replacement policy</label>',
      '<select class="game-select" autocomplete="off" id="game-policy"><option value="lru" selected>LRU</option><option value="fifo">FIFO</option><option value="mru">MRU</option><option value="random">Random</option></select>',
      '<button class="game-btn" type="button" id="game-write" aria-pressed="true" title="Write-back: a store marks the line dirty and memory is written when the line is evicted">Write-back</button>',
      '<button class="game-btn" type="button" id="game-step">Step</button>',
      '<button class="game-btn" type="button" id="game-bits" aria-pressed="true" title="The address is shown split into binary fields — click to show hex only">Binary</button>'
    ],
    keys: [
      { k: 'Space', d: 'Issue the next access, or take the eviction' },
      { k: '&larr; &rarr;', d: 'Move between the lines you may evict' },
      { k: '&uarr; &darr;', d: 'Move between the patterns you may try' },
      { k: 'Esc', d: 'Pause' }
    ],
    touch: 'Everything is a real button, so nothing needs a drag or a swipe. Tap <strong>Step</strong> in the toolbar to issue the next access; when a set fills up its lines become buttons and you tap the one to evict. On the last three levels you tap an access pattern to run it, and Step becomes <strong>Next level</strong> once the target is met. A tap on the board itself does nothing.',
    infoHeading: 'What it simulates, and what it leaves out',
    info: [
      {
        h: 'The three fields are arithmetic, not a heuristic',
        p: 'A block of <em>B</em> bytes needs log&#8322;<em>B</em> offset bits to pick a byte inside it. A cache of <em>S</em> sets needs log&#8322;<em>S</em> index bits to pick the set, and the set is not a suggestion &mdash; a block whose index is 2 may live in set 2 or nowhere. Everything above those two fields is the tag, stored beside the data so a line can say which of the many blocks that share its set it is currently holding. Change the associativity and the number of sets changes, so the boundary between tag and index moves. That is what the toolbar is doing when the split on screen redraws. The <a href="/labs/processor-explorer">processor explorer</a> reports the real cache sizes of the machine you are reading this on.'
      },
      {
        h: 'Belady is a bound, and it is unbuildable',
        p: 'The optimal policy is to evict the line whose next use is furthest away. It is computed here exactly, by reading the rest of the access stream, and that is precisely why no processor has ever implemented it: it needs the future. It is on the board for one reason. &ldquo;LRU took fifteen&rdquo; is a number with nothing to mean until you also know that seven was possible on the same stream with the same cache. Everything real is a guess at Belady using only the past, and LRU is the guess that recency is a decent predictor of reuse &mdash; which it usually is, and on level two it is not.'
      },
      {
        h: 'Conflict misses are the ones worth learning',
        p: 'Every miss is counted as compulsory, capacity or conflict, and the split is derived rather than guessed: a block never referenced before is compulsory, and otherwise a fully associative cache of the same capacity is run alongside on the same stream to see whether the miss was avoidable. Level six is the payload. A row stride that is an exact multiple of the cache size sends every row to the same set, a direct-mapped set holds one line, and the loop misses on all sixty-four accesses with a working set that would have fitted eight times over. Fifty-six of those are conflict misses. Thirty-two bytes of padding per row, or eight-way associativity, both take it to eight. This is a bug that ships.'
      },
      {
        h: 'One core, one level, no prefetcher, no TLB',
        p: 'Stated plainly because the gaps matter more than the model. There is no second or third level of cache, so nothing here shows an L1 miss that an L2 catches cheaply. There is no hardware prefetcher, which on a real machine would have spotted the column walk on level five and hidden a good deal of it. There is no TLB, so address translation is free and invisible. And there is exactly ONE CORE, which means false sharing cannot be demonstrated here at all: two cores writing different bytes of the same line pass that line back and forth on a coherence protocol and slow each other down while sharing no data whatever, and the fix is padding the two variables onto separate lines. That paragraph is explanation, not simulation, and it is the only thing on this page that is. Real silicon has all four of these, and the <a href="/labs/cpu-simulator">CPU simulator</a> next door is the same kind of honest simplification one level further down.'
      }
    ],
    faq: [
      {
        q: 'Is this a real cache from a real processor?',
        a: 'No. The parameters are invented and deliberately tiny &mdash; sixty-four to five hundred and twelve bytes, sixteen-bit addresses &mdash; so that the whole cache fits on screen and the binary split of an address is short enough to read. The <em>arithmetic</em> is the real thing: an L1 data cache on a current desktop is typically 32 or 48 KB, 64-byte lines and eight to twelve ways, and it computes its index and tag exactly the way this does. Nothing is measured from your machine here; the <a href="/labs/processor-explorer">processor explorer</a> is the page that does that.'
      },
      {
        q: 'How am I allowed to beat LRU? Is Belady cheating?',
        a: 'You are shown the whole access stream, including the part that has not happened yet, and you are allowed to read it. That is the only advantage you have, and it is the same advantage Belady has. A cache has neither. So beating LRU here proves nothing about LRU and everything about how much information a replacement policy is missing &mdash; which is the point of putting the two numbers side by side.'
      },
      {
        q: 'What is the difference between a capacity miss and a conflict miss?',
        a: 'A capacity miss would have happened even in a perfect cache of that size: the working set is simply bigger than the cache. A conflict miss would not have: the block was thrown out only because the index bits sent it to a set that was already busy, while lines elsewhere sat idle. The game separates them by running a fully associative LRU cache of the same capacity alongside yours and asking whether it would have hit. That reference model is the conventional one, and it is a choice &mdash; use a different policy for the shadow and a few misses change category.'
      },
      {
        q: 'Does write-back change the hit rate?',
        a: 'No, and that is why the counter for it is separate. Write-back and write-through place identical demands on the cache and produce identical hits and misses; what changes is memory traffic. Write-back marks the line dirty and defers the write until eviction, so repeated stores to one line cost one write instead of many, at the price of one dirty bit per line and a slower eviction. Level three is the one with stores in its stream, and level four turns its second pass into a read-modify-write.'
      },
      {
        q: 'What happens if I change the policy or the level halfway through?',
        a: 'Changing the replacement policy or the write mode restarts the current level, because your misses are scored against a reference run of the same stream and the two have to have been made under the same rules. Points already banked from earlier levels are kept. Changing the level restarts the whole run at that level, which is there for practice: starting at level seven can earn a hundred points and starting at level one can earn seven hundred, so there is nothing to gain by skipping.'
      },
      {
        q: 'Is anything stored or sent anywhere?',
        a: 'Nothing is sent. There is no network call in the game at all. The only things kept are your best total, your chosen level and the three toolbar settings, all in this browser under keys the reset button below the board will clear for you.'
      }
    ],
    related: ['assembly-puzzles', 'guess-the-algorithm', 'traffic'],
  },
  {
    slug: 'cipher-escape',
    cat: 'cs',
    name: 'Cipher escape',
    glyph: '⊕',
    script: 'cs/cipher-escape.js',
    board: true,
    pad: 'none',
    bestKey: 'cipher-escape',
    engine: 'Five chained rooms &middot; every tool computed live',
    title: 'Cipher Escape — Five Rooms, Five Ciphers',
    ogTitle: 'Break one room to get into the next',
    description: 'Five chained rooms: Caesar, Vigenere, rail fence, substitution and XOR. Real tools — a frequency histogram, Kasiski, an IC readout and a crib dragger.',
    short: 'Five ciphers, chained. Each key is next door.',
    h1: 'Cipher escape',
    hero: 'Five locked rooms, and the note inside each one tells you what the next lock needs. The first is a Caesar shift with twenty-five possible keys, so you find it by looking at all of them at once; the last is a repeating-key XOR that you break by dragging a guessed phrase along the bytes until the key falls out of them. Nothing is gated. The frequency histogram, the Kasiski counter, the index of coincidence, the shift slider and the crib dragger are open in every room from the first second, all of them computed live on whatever ciphertext is in front of you. They are not decoration and they are not hints &mdash; they are the game.',
    facts: [
      'Five ciphers, chained end to end',
      'Every tool computed live, nothing faked',
      'Any room can be opened for you',
      'Nothing is uploaded'
    ],
    hud: [
      { key: 'room', label: 'Room', init: '1/5' },
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'hints', label: 'Hints', init: '0' },
      { key: 'best', label: 'Best' }
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-hint">Hint</button>',
      '<button class="game-btn" type="button" id="game-unlock" title="Sets this room to its answer and scores it zero, so the chain can carry on">Open this room for me</button>'
    ],
    keys: [
      { k: '← →', d: 'Move the shift, the rail count or the crib offset' },
      { k: '↑ ↓', d: 'Move between the five tools' },
      { k: 'Enter', d: 'Go through a door once it has opened' },
      { k: 'Esc', d: 'Pause &mdash; there is no clock, so nothing is lost either way' }
    ],
    touch: 'Drag a slider, or tap the &minus; and + buttons beside it if the drag fights the page. Type into the key fields and into the substitution table, which is one box per cipher letter. The five tool buttons swap the panel underneath them, and in the last room every offset the crib dragger likes is a tappable chip that moves the slider for you.',
    infoHeading: 'Five broken ciphers, and how each one is broken',
    info: [
      {
        h: 'A chain, not a workbench',
        p: 'The <a href="/labs/cipher">classical cipher playground</a> next door is the workbench: one box, every cipher, run it forwards and backwards as long as you like. That is the right shape for a tool and the wrong shape for learning the order things happen in. Nobody sits down to &ldquo;do a Vigenere&rdquo; &mdash; they sit down with a blob, work out what kind of thing it is, reach for the measurement that narrows it, and only then turn a key. So here each plaintext is the next room&rsquo;s briefing: room one says the second lock takes a six-letter keyword and that it was never written down, room two names the rail count, room three hands over twelve letters of crib, room four names the crib for the XOR. The chain is the reason to actually read a plaintext instead of glancing at it and moving on.'
      },
      {
        h: 'What each tool really does',
        p: 'The histogram counts this ciphertext&rsquo;s letters against English and lists the pairs and triples that repeat, which is what separates a substitution from a transposition before you have decided anything: move letters about and the counts do not change, swap them and the counts move but the patterns stay. The shift slider prints all twenty-six Caesar decryptions at once, because a keyspace of 25 is not something you attack, it is something you read. Kasiski finds the real repeated trigrams, measures the gaps and tallies their factors; the index of coincidence slices the message into columns and asks which slicing makes each column look like English again; chi-squared then names the key letter for every column and prints the runners-up beside it, because a short column gets it wrong and pretending otherwise is the dishonest bit. The crib dragger does something different in each room, since the technique is different: implied key letters for a Caesar or a Vigenere, an implied partial alphabet with a contradiction test for the substitution, implied key bytes for the XOR.'
      },
      {
        h: 'None of this is encryption',
        p: 'Said plainly, because the pages that skip this are the reason people put base64 in a cookie and call it secure. A Caesar has twenty-five keys. A rail fence has about ten shapes worth trying. A substitution has 403 septillion alphabets and falls over in ten minutes anyway, because the shuffle does not hide how often each letter is used. The XOR key at the end is five lowercase letters, which is about twelve million possibilities &mdash; a laptop tries all of them and checks each result while you are still reading this sentence. Every one of these was state of the art once and every one is now a puzzle. What actually replaced them is in the labs: <a href="/labs/cryptography">AES, RSA and the elliptic curves</a>, and <a href="/labs/hash">the hash functions</a> that do the other half of the job.'
      },
      {
        h: 'The attacks outlived the ciphers',
        p: 'The ciphers are museum pieces; the three techniques are not. A crib is a known-plaintext attack, and knowing what part of a message says is still how real systems are broken &mdash; it is why a modern cipher is designed to stay secure against an attacker who already has matching plaintext and ciphertext. Frequency analysis is what deterministic encryption leaks: encrypt a database column so that the same value always produces the same ciphertext and you have rebuilt room four at scale, whatever the algorithm underneath. And the XOR room is the many-time pad: a one-time pad is unbreakable exactly once, and reusing the key is the failure the crib dragger walks straight through. That failure has shipped in production, more than once.'
      }
    ],
    faq: [
      {
        q: 'Do I need to know any cryptography to start?',
        a: 'No. Room one is a slider you drag until the text turns into English, and each room explains the measurement it wants before it asks for it. The two rooms that are genuinely work &mdash; the Vigenere and the substitution &mdash; both have tools that do the arithmetic and leave you the judgement, which is the part worth having.'
      },
      {
        q: 'Are the answers hidden from me?',
        a: 'Not really. The ciphertexts and the right settings are in the page\'s JavaScript, and anyone determined can open the file and read them. This is a teaching chain rather than a competition, so there is nothing to protect. The plaintexts themselves are not stored anywhere &mdash; each one is produced by running that room\'s own decoder over its own ciphertext with the right key, which is the same code path your slider is using.'
      },
      {
        q: 'Is the Kasiski analysis real, or a picture of one?',
        a: 'Real, and computed from the ciphertext every time the panel opens. The repeated trigrams, their spacings, the factor tallies, the per-column index of coincidence and the chi-squared scores are all measured on the message in front of you rather than looked up. Paste any of these ciphertexts into the cipher playground in Labs and you will get the same numbers.'
      },
      {
        q: 'What if I get stuck in one room?',
        a: 'Every room has up to two hints, each costing a quarter of that room, and the cost is only taken off if you then solve it &mdash; reading a hint and still failing can never leave you worse off than not reading it. Beyond that there is "Open this room for me", which sets the room to its answer so the note behind the door is readable and the chain carries on. That room scores nothing and the rest of the run is unaffected.'
      },
      {
        q: 'How is the score worked out?',
        a: 'A thousand points across the five rooms: 150, 250, 150, 250 and 200, in that order. Each hint takes a quarter of the room it was taken in, and a room opened for you scores zero. There is no clock and no penalty for a wrong setting, because trying settings and looking at what comes out is the entire method.'
      }
    ],
    related: ['ctf-arcade', 'password-duel', 'guess-the-algorithm'],
  },
  {
    slug: 'firewall-defence',
    cat: 'cs',
    name: 'Firewall defence',
    glyph: '▦',
    script: 'cs/firewall-defence.js',
    width: 720,
    height: 480,
    pad: 'none',
    bestKey: 'firewall-defence',
    tapAction: false,
    engine: 'Seven rules in order &middot; first match wins',
    title: 'Firewall Defence — Rules Are The Towers',
    ogTitle: 'Block everything and you lose the game',
    description: 'Tower defence where the towers are firewall rules and the creeps are packets. Score is attacks blocked minus legitimate traffic dropped, so a wall loses.',
    short: 'The towers are rules. The creeps are packets.',
    h1: 'Firewall defence',
    hero: 'Packets walk down a wire from the internet to your server, each one carrying the only four things a packet filter gets to see: protocol, source address, destination port, and whether it belongs to a connection you already had. You place rules along the wire, they are read in order, and the first one that matches decides. Some of that traffic is an attack and most of it is the business trying to work &mdash; and the score is attacks blocked <em>minus</em> legitimate traffic you dropped, so a wall that stops everything finishes several hundred points down. That is the entire point of the game.',
    facts: [
      'Seven rule slots, read in order',
      'The first match decides, so position matters',
      'Shadowed rules are marked dead',
      'Blocking everything scores minus 264'
    ],
    hud: [
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'blocked', label: 'Attacks blocked', init: '0' },
      { key: 'lost', label: 'Legit dropped', init: '0' },
      { key: 'wave', label: 'Wave', init: '1/6' },
      { key: 'best', label: 'Best' }
    ],
    controls: [
      '<label class="sr-only" for="game-match">Match on</label>',
      '<select class="game-select" autocomplete="off" id="game-match"><option value="port" selected>Destination port</option><option value="src">Source network</option><option value="proto">Protocol</option><option value="state">Connection state</option></select>',
      '<label class="sr-only" for="game-value">Value to match</label>',
      '<select class="game-select" autocomplete="off" id="game-value"><option value="22" selected>22 (SSH)</option><option value="25">25 (SMTP)</option><option value="53">53 (DNS)</option><option value="80">80 (HTTP)</option><option value="123">123 (NTP)</option><option value="443">443 (HTTPS)</option><option value="3306">3306 (MySQL)</option><option value="3389">3389 (RDP)</option><option value="8080">8080 (alt HTTP)</option><option value="high">1024 and above</option></select>',
      '<label class="sr-only" for="game-action">Action</label>',
      '<select class="game-select" autocomplete="off" id="game-action"><option value="DROP" selected>DROP</option><option value="REJECT">REJECT</option><option value="ACCEPT">ACCEPT</option></select>',
      '<button class="game-btn" type="button" id="game-add" title="Add this rule to the end of the chain">Add rule</button>',
      '<button class="game-btn" type="button" id="game-del" title="Remove the selected rule from the chain">Remove</button>',
      '<label class="sr-only" for="game-policy">Default policy</label>',
      '<select class="game-select" autocomplete="off" id="game-policy"><option value="ACCEPT" selected>Default policy: ACCEPT</option><option value="DROP">Default policy: DROP</option></select>',
      '<button class="game-btn" type="button" id="game-wave">Start wave 1</button>'
    ],
    keys: [
      { k: '← →', d: 'Select a rule in the chain' },
      { k: '↑ ↓', d: 'Move the selected rule earlier or later' },
      { k: 'Space', d: 'Release the wave, or add the rule you built' },
      { k: 'Esc', d: 'Pause' }
    ],
    touch: 'Build a rule with the three dropdowns, then tap an empty slot to drop it there. Tap a rule to select it and drag it left or right to move it up or down the chain; Remove takes the selected one out. The policy bar at the right-hand end is a control too &mdash; tap it to flip the default between ACCEPT and DROP.',
    infoHeading: 'Why blocking everything loses',
    info: [
      {
        h: 'The score is the whole design',
        p: 'Ten points for stopping something that was an attack, twelve off for stopping something that was a customer, and nothing at all for the packets you simply let past. Across the six waves there are sixty malicious packets and seventy-two legitimate ones, which is why a default-deny policy with no accept rules under it finishes on about minus 264 rather than on a comfortable 600. The opposite mistake is faster: leave everything open and the server takes twenty hits and stops answering, usually somewhere in wave three. Neither of the two policies anyone reaches for first survives this, and that is the argument the whole game is making.'
      },
      {
        h: 'First match wins, so where a rule sits is part of what it says',
        p: 'The chain is read left to right and the first rule that matches decides the packet\'s fate; everything after it never sees the packet at all. Wave three is built to make that expensive: the flood arrives on 443, the same port the shop needs, so the only thing that separates them is the source &mdash; and a rule dropping that source does nothing whatsoever if it sits below the rule that accepts 443. Same two rules, same two verdicts, opposite outcome, decided entirely by which one you placed first. Drag it left and watch the log change.'
      },
      {
        h: 'A rule nothing can reach is marked dead',
        p: 'When every packet a rule could ever match is already decided by something above it, the rule is shadowed &mdash; it is in the file, it looks like policy, and it can never fire. The game marks those struck through and labelled, which is the fastest way I know to make the idea stick. It is worked out over the space of possible headers rather than over the traffic you have actually seen: three protocols, ten ports plus the case of having no port at all, seven source addresses and two connection states, minus the impossible combinations. That is 294 headers, re-checked on every edit. Deciding it from observed traffic instead would mark a good rule dead during a quiet wave.'
      },
      {
        h: 'Only state can separate a reply from a knock',
        p: 'Wave four sends replies to connections your own server opened, arriving on high random ports, at the same moment the attacker starts knocking on high random ports. No list of port numbers separates those, and accepting everything above 1024 accepts the attack with the reply. What works is the shape almost every real inbound chain has: accept ESTABLISHED at the top, accept the handful of ports you actually publish, and refuse the rest by default. Four rules, in that order, and it holds for the three waves after it as well.'
      },
      {
        h: 'What this leaves out, and where to do it properly',
        p: 'Every rule here matches on exactly one field, which is the biggest simplification in the game: a real rule matches a tuple &mdash; source and destination and port and protocol together &mdash; so it says in one line what this needs two rules and an ordering to say. There is no NAT, no rate limiting, no logging target, no fragmentation and no IPv6. If you want the real syntax, <a href="/labs/firewall-rules">the firewall rule reader</a> in Labs parses and explains an actual rule set instead of scoring you on one, and <a href="/labs/subnet">the subnet calculator</a> does the prefix arithmetic that wave five is really about &mdash; a /24 out of 198.18.0.0/15 is one five-hundred-and-twelfth of it.'
      }
    ],
    faq: [
      {
        q: 'Why am I losing points for blocking traffic?',
        a: 'Because most of what walks down that wire is your own business. Blocking a customer costs twelve points and blocking an attack earns ten, so a firewall that refuses everything is scored as the outage it is. This is the one thing the game exists to say: a rule set is judged by what it lets through as much as by what it stops, and the second number is the one nobody puts on a dashboard.'
      },
      {
        q: 'What is the difference between DROP and REJECT?',
        a: 'Both stop the packet and both score the same here. DROP says nothing at all, so the sender waits for a timeout and learns nothing. REJECT returns an error immediately, which is kinder to a legitimate client that would otherwise hang, and which also confirms to whoever is scanning you that something is there. On screen a rejected packet turns round and goes back the way it came.'
      },
      {
        q: 'What does the SHADOWED label mean?',
        a: 'That every packet the rule could match is already matched by a rule above it, so it can never fire. It is the commonest way a rule set rots: somebody adds a broad accept near the top, and three carefully written rules underneath quietly stop existing. Nothing warns you in production, which is why it is drawn here.'
      },
      {
        q: 'Are these real IP addresses?',
        a: 'No, and none of them can ever belong to anybody. The public ranges are 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24, which RFC 5737 reserves for documentation, plus the benchmarking range 198.18.0.0/15 for the distributed flood. The office is RFC 1918 private space. No real company, network or campaign is being reproduced.'
      },
      {
        q: 'Can it actually be won?',
        a: 'Yes. Six hundred is the maximum &mdash; sixty attacks blocked, nothing legitimate dropped &mdash; and it fits inside the seven slots with a rule to spare. Your best is kept in this browser on this device and nowhere else, because there is no server behind any of this and so no leaderboard to put it on.'
      }
    ],
    related: ['subnet-sprint', 'traffic', 'incident-response'],
  },
  {
    slug: 'overflow-puzzle',
    cat: 'cs',
    name: 'Overflow puzzle',
    glyph: '↩',
    script: 'cs/overflow-puzzle.js',
    board: true,
    pad: 'none',
    bestKey: 'overflow-puzzle',
    engine: 'An invented machine &middot; four levels, four mitigations',
    title: 'Buffer Overflow Puzzle — Four Levels',
    ogTitle: 'Eleven bytes, and you never learn the address',
    description: 'Craft the input that takes the return address on a toy machine. Four levels: the plain overflow, a stack canary, a no-execute stack and a randomised base.',
    short: 'Take the return address, one byte at a time.',
    h1: 'Overflow puzzle',
    hero: 'A made-up machine with thirty-two cells of memory, a stack that grows down, and a note server with one bad line in it: a copy that has no idea how big the buffer is. Level one is the whole bug &mdash; walk your message off the end of an eight-cell buffer and put your own address into the two cells the return instruction reads, with every byte drawn as it lands. Then each level adds one mitigation, in roughly the order the industry added them, and asks you to get past it anyway: a stack canary, a no-execute stack, and a base address that moves every time the process starts. The machine is invented and none of this is a working technique. The picture is the part that transfers.',
    facts: [
      'Four levels, four mitigations',
      'Every byte drawn as it lands',
      'An invented machine, no real instruction set',
      'Nothing is uploaded'
    ],
    hud: [
      { key: 'level', label: 'Level', init: '1/4' },
      { key: 'mit', label: 'Mitigations', init: 'none' },
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'best', label: 'Best', init: '&mdash;' }
    ],
    controls: [
      '<label class="sr-only" for="game-level">Level</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="0" selected>1. Take the wheel</option><option value="1">2. The canary</option><option value="2">3. No-execute</option><option value="3">4. Randomised addresses</option></select>',
      '<button class="game-btn" type="button" id="game-hint">Hint</button>',
      '<button class="game-btn" type="button" id="game-answer">Show the answer</button>'
    ],
    keys: [
      { k: 'Type', d: 'The message, as bytes' },
      { k: 'Enter', d: 'Send it' },
      { k: 'Tab', d: 'Reach the listing lines and the buttons' },
      { k: 'Click', d: 'A labelled line appends its address' }
    ],
    touch: 'Tap the message box to raise the keyboard and type bytes into it; tap any labelled line in the program listing to append that address instead of typing it out. Send the note, Show the note and New process are three buttons underneath, and the stack panel redraws a byte at a time as the copy runs.',
    infoHeading: 'What the four levels are for',
    info: [
      {
        h: 'One mitigation per level, in the order they arrived',
        p: 'Level one is the bug on its own: an eight-cell buffer, a copy with no bound, and the saved return address two cells above it. Level two puts a random value between the two and checks it before returning, so the naive payload aborts &mdash; and then hands you an over-read that prints the value, because a canary you can read is a formality. Level three marks the stack no-execute, so returning into your own bytes faults before one of them runs, and the only targets left are routines already in the program: one to set a register, one to check it, threaded together by two addresses on the stack. Level four moves the code to a fresh base every run, so the address you have been typing since level one is a guess &mdash; and the answer is to write half of it and leave the half you cannot know alone.'
      },
      {
        h: 'The leak is the hinge, and it is the same leak twice',
        p: 'Both the canary level and the ASLR level turn on one function that prints the note back to you and stops at a zero byte rather than at the end of the buffer. Fill all eight cells with something non-zero and it keeps going into whatever is above them. That is not a contrivance for the puzzle; a print or a copy that trusts a terminator it was never given is one of the most productive real bug shapes there is, and an over-read that reveals a secret is what turns a defence that depends on a secret back into no defence at all. Level four is the counterpart: the saved frame pointer there is zero, the print stops on it, and one byte in the right place is the difference between leaking a value and leaking a pointer.'
      },
      {
        h: 'The machine is invented, and there is no payload here',
        p: 'The registers, the instruction names, the addresses, the calling convention and the sizes are all made up. It is not x86, not ARM, not any real instruction set, and it is deliberately not a general interpreter &mdash; what is simulated is the frame, the copy, the canary check and the return dispatch, because that is where the lesson is. There is no shellcode on this page and no way to write any, and pointing the return address at the buffer on the first two levels gets you a fault about an opcode that does not exist. Nothing here transfers as a technique. What transfers is knowing what is above a buffer and why the copy cannot tell.'
      },
      {
        h: 'What actually fixes it, said plainly',
        p: 'A copy that is told how big the destination is and honours it, or a language where the length travels with the array so the copy cannot run off the end in the first place. Every mitigation in this game raises the price of turning the bug into control of the machine and removes no bugs at all: the out-of-bounds write is sitting in all four programs, in the same line, untouched. The <a href="/labs/buffer-overflow">buffer overflow lab</a> next door is the same subject as a sandbox &mdash; sliders, a live stack, and a copy you push around to see what happens. This is the same subject as four problems that have answers.'
      }
    ],
    faq: [
      {
        q: 'Is this x86 or ARM?',
        a: 'Neither, and not any other real instruction set. The machine is invented so that the whole of it fits beside the stack it is scribbling on: thirty-two cells, a couple of registers, and about a dozen instruction names that exist nowhere else. The shape of the frame is the honest part; the syntax is not meant to be.'
      },
      {
        q: 'Will anything here work on a real program?',
        a: 'No, and it is not built so that it could. There is no shellcode in the game and no way to author any, the addresses are fictional, and the machine only ever enters a routine at its first instruction. What you take away is the mental model — where the return address sits, why a canary stops one case and not another, what NX changed about the shape of an exploit — and that model is worth having whichever side of it you are on.'
      },
      {
        q: 'Why can I not put a zero byte in the message?',
        a: 'Because the copy stops at one, the way a C string copy does. It is a real constraint rather than a rule invented for the puzzle: an address containing a zero byte cannot be carried through a copy that terminates on zero, and that single fact has decided real exploits. The stack here sits on page 0x0100 so that the addresses you need do not contain one.'
      },
      {
        q: 'Do I have to do the levels in order?',
        a: 'No. The dropdown opens any of the four whenever you like, and each is a self-contained program with its own listing. They are written to be read in order, because level two only makes sense once level one has worked and level four is level three with the address taken away.'
      },
      {
        q: 'Is anything stored or sent?',
        a: 'Nothing is sent anywhere — there is no network call in the game at all. The only thing kept is your best total, in local storage in this browser on this device, and the reset strip under the board clears it.'
      }
    ],
    related: ['assembly-puzzles', 'ctf-arcade', 'shell-quest'],
  },
  {
    slug: 'packet-routing',
    cat: 'cs',
    name: 'Packet routing',
    glyph: '⇄',
    script: 'cs/packet-routing.js',
    width: 720,
    height: 520,
    board: false,
    pad: 'none',
    bestKey: 'packet-routing',
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',
    engine: 'Bellman-Ford and Dijkstra &middot; a drop-tail queue on every link',
    title: 'Packet Routing — Route It, Then Break It',
    ogTitle: 'Cut one link and watch the metric climb',
    description: 'Seven routers whose tables are computed rather than drawn. Run Bellman-Ford or Dijkstra, cut a link, and watch count-to-infinity happen for real.',
    short: 'Route it. Then cut a link.',
    h1: 'Packet routing',
    hero: 'Seven routers, eight links, and packets that have to get across. Nothing about the path is drawn in advance: each router holds its own table, every table is produced by an algorithm that can only see what a real router would see, and each hop is decided by whatever the table at that hop happens to say at that instant &mdash; including when what it says is wrong. Cut one link with distance vector running and you can watch two routers point at each other and count to sixteen while the packets between them go round in a circle until their hop count runs out.',
    facts: [
      'Bellman-Ford and Dijkstra, both real',
      'Count-to-infinity, actually running',
      'A drop-tail queue on every link',
      'Six scenarios, four of them scored'
    ],
    hud: [
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'deliv', label: 'Delivered', init: '0' },
      { key: 'drop', label: 'Dropped', init: '0' },
      { key: 'lat', label: 'Mean latency', init: '—' },
      { key: 'best', label: 'Best', init: '—' }
    ],
    controls: [
      '<label class="sr-only" for="game-proto">Routing protocol</label>',
      '<select class="game-select" autocomplete="off" id="game-proto"><option value="dv" selected>Distance vector &mdash; Bellman-Ford</option><option value="ls">Link state &mdash; Dijkstra</option><option value="static">Static routes</option></select>',
      '<label class="sr-only" for="game-level">Scenario</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="sandbox" selected>Sandbox &mdash; no clock</option><option value="converge">1 &mdash; Converge</option><option value="infinity">2 &mdash; Count to infinity</option><option value="cut">3 &mdash; Survive a link cut</option><option value="fail">4 &mdash; Router failure</option><option value="spike">5 &mdash; Traffic spike</option></select>',
      '<label class="sr-only" for="game-watch">Destination shown on the map</label>',
      '<select class="game-select" autocomplete="off" id="game-watch"><option value="0">Watch A</option><option value="1">Watch B</option><option value="2">Watch C</option><option value="3" selected>Watch D</option><option value="4">Watch E</option><option value="5">Watch F</option><option value="6">Watch G</option></select>',
      '<button class="game-btn" type="button" id="game-split" aria-pressed="false" title="Do not advertise a route back to the neighbour it was learned from">Split horizon</button>',
      '<button class="game-btn" type="button" id="game-poison" aria-pressed="false" title="Advertise it back with the metric set to 16 instead of leaving it out">Poison reverse</button>',
      '<button class="game-btn" type="button" id="game-ecmp" aria-pressed="false" title="Use every next hop of equal cost rather than only the first">Multipath</button>',
      '<button class="game-btn" type="button" id="game-repair" title="Bring every link and router back up">Repair everything</button>'
    ],
    keys: [
      { k: '← →', d: 'Move the selection round the routers and the links' },
      { k: '↑ ↓', d: 'Change which destination the map is labelled for' },
      { k: 'Space', d: 'Cut a link, fail a router, or move a static next hop' },
      { k: 'Esc', d: 'Pause, and the scenario clock stops with it' }
    ],
    touch: 'Tap a router or a link to select it, then tap the same one again to act &mdash; the second tap cuts a link, fails a router, or on static routes moves that router&rsquo;s next hop along to its next neighbour. The three dropdowns pick the protocol, the scenario and which destination every router is labelled for; the panel on the right is the selected router&rsquo;s actual routing table.',
    infoHeading: 'What is real in here, and what is not',
    info: [
      {
        h: 'The tables are computed, not animated',
        p: 'The number under each router is that router&rsquo;s own table entry, and the packet on the wire is going wherever that entry points. <strong>Distance vector</strong> is Bellman-Ford the way RIP does it: a router knows its own links and whatever its neighbours claim, it sends its whole vector every two seconds, and a report from its current next hop is believed even when it is worse than what it had. <strong>Link state</strong> is Dijkstra the way OSPF does it: each router floods a description of its own neighbourhood, ends up holding the whole map, and runs shortest path first over its own copy &mdash; and an edge only counts when <em>both</em> ends claim it, which is how a dead router&rsquo;s last advertisement stops being believed without anybody having to delete it. <strong>Static</strong> is seeded from the shortest paths so you begin from something that works, and then never changes again on its own, which is the entire case against it in one gesture.'
      },
      {
        h: 'Count to infinity, and the tree it is shown on',
        p: 'G hangs off E and nothing else, so every route to G runs through E. Cut that link with split horizon off and A hears E withdraw the route, then in the same round hears B offer a route to G that B only has because A gave it to B a round earlier. A believes it, because it did not come from E. Now the two of them add the cost of the link between them to each other&rsquo;s stale figure &mdash; 7, 9, 11, 13, 15 &mdash; until they reach 16, which is the only reason it stops. Every packet for G ping-pongs between them for those twelve seconds and dies of hop count. Turn split horizon on and the same cut settles in two rounds with no climb at all. The scenario opens by taking two links out of service so the map is a <em>tree</em>, and that is deliberate rather than convenient: split horizon only ever fixes the loop between two routers. Press Repair everything to put the ring back, cut it again with the fix still on, and the metric climbs anyway, because the stale route goes the long way round a loop split horizon cannot see. That is a property of the technique, and it is why RIP still needs the ceiling of 16.'
      },
      {
        h: 'The queue is the other half, and the idle path is the point',
        p: 'Each direction of each link transmits ten packets a second with a drop-tail queue of ten in front of it, so an overflowing queue drops the next arrival exactly as a real one does. A and D are six apart through B and C and six apart through E and F, and a shortest-path table with a tie in it picks the same winner every time &mdash; so the traffic spike fills one first hop while an equally short path beside it carries nothing, which the panel names in words while it happens. On the run I measured here, that scenario delivered 358 packets and dropped 191; with multipath switched on, the same load delivered 541 and dropped 7. That gap is why equal-cost multipath and traffic engineering exist. It is also where this model is crudest: it alternates per <em>packet</em>, and a real router hashes the addresses and ports so that one connection keeps one path. Alternating per packet would reorder a real flow, and the receiver would read the gaps as loss.'
      },
      {
        h: 'What is deliberately missing',
        p: 'There is no wire format in here at all &mdash; no RIP or OSPF packet, no hello protocol, no adjacency state machine, no areas, no authentication. There is no BGP and no policy, so every path is chosen on a cost, where real inter-domain routing is chosen on business relationships that no shortest-path algorithm can express. And the omission that matters most: <strong>nothing here reacts to a drop.</strong> The senders are open-loop and indifferent, so they keep pouring the same rate into a queue that is already full. A real network throttles itself, which is the whole subject of <a href="/labs/tcp-congestion">the TCP lab</a> next door &mdash; the sawtooth there is the feedback loop this page does not have. For the addressing underneath all of it there is <a href="/labs/subnet">the subnet calculator</a>, for the names on top of it <a href="/labs/dns">the DNS lookup</a>, and for a different failure entirely &mdash; four cars, four locks, nobody moving &mdash; <a href="/games/traffic">Traffic</a>.'
      }
    ],
    faq: [
      {
        q: 'Which protocol should I pick to pass a scenario?',
        a: 'Link state, on every one of them, and the reason is worth watching rather than being told: it converges in a flood plus one computation, where distance vector has to pass a metric round the network a round at a time. Static routing passes the first scenario and fails the link cut outright, because it cannot heal &mdash; it will keep posting packets into the hole until you move the next hop yourself, which you can, one router at a time.'
      },
      {
        q: 'Why does the metric stop at 16?',
        a: 'Because the count has to terminate, and it terminates by arriving at a number both ends agree means unreachable. RIP picked 16, and the price of that choice is that no network more than fifteen hops across can be served by the protocol at all. It is a ceiling on the diameter bought to put a floor under the failure.'
      },
      {
        q: 'I turned split horizon on and it still counted. Why?',
        a: 'You repaired the ring. Split horizon stops a router advertising a route back to the neighbour it learned that route from, which removes the loop between two adjacent routers and nothing larger. With a ring in the map the stale route simply travels the long way round, and every router on the way adds a link cost to it. That is true of the real technique, not a shortcut here, and it is why the demonstration scenario starts by cutting the two links that close the ring.'
      },
      {
        q: 'Is this how RIP and OSPF actually work?',
        a: 'The algorithms are, the plumbing is not. Bellman-Ford with a periodic exchange, an infinity of 16, split horizon, poison reverse and a route expiry counter are all here and all doing the work. Flooding with sequence numbers, a two-way check on every edge and a per-router shortest path first computation are here too. What is missing is everything below that: packet formats, hello and adjacency, areas, authentication, triggered updates and holddown. This will teach you why a protocol behaves the way it does. It will not teach you to configure one.'
      },
      {
        q: 'How is the score worked out?',
        a: 'Delivered minus dropped, with a priority packet counted five times if you lose one, all multiplied by ten &mdash; then up to nine points for low mean latency on top. The multiplication is so that latency can only ever separate two runs that moved the same traffic, rather than quietly becoming the thing being measured. The panel also keeps a best for each scenario separately, because the six of them do not offer the same load and one number covering all of them would be a comparison nobody could act on.'
      },
      {
        q: 'Does anything leave my browser?',
        a: 'No. There is no network call in the game, which is a slightly funny thing to be able to say about a game named after routing. The only thing stored is your best score, in this browser, under keys the reset strip under the game will list and clear for you.'
      }
    ],
    related: ['traffic', 'subnet-sprint', 'guess-the-algorithm'],
  },
  {
    slug: 'plasma',
    cat: 'toy',
    name: 'Plasma',
    glyph: '≋',
    script: 'toy/plasma.js',
    width: 640,
    height: 440,
    board: false,
    pad: 'none',
    bestKey: null,
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',
    engine: 'Sine table &middot; 256-entry palette LUT',
    title: 'Plasma — The Demoscene Colour Field',
    ogTitle: 'It looks expensive. It costs one lookup a pixel.',
    description: 'A demoscene plasma built the old way: a sine table, a 256-colour palette LUT and cycling by index offset. Change the terms, the frequency and the resolution.',
    short: 'Sines added up, read through a turning palette.',
    h1: 'Plasma',
    hero: 'Sines added together and the sum read through a colour table &mdash; one across, one down, one along the diagonal, and two measured outward from a point you can drag. That is all of it. Nothing here is a gas or a fluid or a field being simulated; the name came from the look. Every value comes out of a 2048-entry table rather than <code>Math.sin</code>, and the colours move because an offset into the palette moves, which is exactly how it was done when the palette was hardware.',
    facts: [
      'A sine table, not Math.sin',
      'Two to five sine terms',
      'Palette cycling as an index offset',
      'Renders smaller, scales up'
    ],
    hud: [
      { key: 'res', label: 'Rendering at', accent: true, init: '640 × 440' },
      { key: 'terms', label: 'Sine terms', init: '4' },
      { key: 'cycle', label: 'Palette cycle', init: '0.60 turns/s' },
      { key: 'fps', label: 'Frames', init: '—' }
    ],
    controls: [
      '<label class="sr-only" for="game-terms">Sine terms</label>',
      '<select class="game-select" autocomplete="off" id="game-terms"><option value="2">2 sines</option><option value="3">3 sines</option><option value="4" selected>4 sines</option><option value="5">5 sines</option></select>',
      '<label class="game-range"><span>Frequency</span><input type="range" id="game-freq" min="40" max="260" value="100" /></label>',
      '<label class="game-range"><span>Cycle</span><input type="range" id="game-cycle" min="0" max="200" value="60" /></label>',
      '<label class="sr-only" for="game-palette">Palette</label>',
      '<select class="game-select" autocomplete="off" id="game-palette"><option value="fire" selected>Fire</option><option value="ice">Ice</option><option value="rainbow">Rainbow</option><option value="grey">Greyscale</option><option value="accent">Two-tone</option></select>',
      '<label class="sr-only" for="game-res">Resolution</label>',
      '<select class="game-select" autocomplete="off" id="game-res"><option value="1" selected>Full size</option><option value="0.5">Half size</option><option value="0.34">Third size</option><option value="0.25">Quarter size</option></select>'
    ],
    keys: [
      { k: '← → ↑ ↓', d: 'Move the field origin' },
      { k: 'Drag', d: 'Move the field origin' },
      { k: 'Space', d: 'Put the origin back in the middle' },
      { k: 'Esc', d: 'Pause' }
    ],
    touch: 'Drag anywhere on the field to move its origin &mdash; every term is measured from that point, so the whole picture follows your finger. A tap on its own does nothing, so a stray thumb cannot move anything. The toolbar holds the number of sine terms, their frequency, the palette, the cycling speed and the resolution, and the HUD prints the size actually being filled.',
    infoHeading: 'What a plasma actually is',
    info: [
      {
        h: 'Interference, not physics',
        p: 'A plasma is several periodic functions added together and the sum mapped through a colour table. There are five of them here: a sine across x, one down y, one along the diagonal, and two radial terms measured outward from the origin &mdash; the second from a centre orbiting it, which is what stops the rings looking like a target. Where crests agree you get a bright blob, where they disagree you get a dark one, and because each term drifts at its own rate the arrangement never quite repeats. Nothing about it models a gas or a fluid. The name is about the look, and the sliders are there so you can take it apart: drop to two terms and the crossed sines are plainly visible.'
      },
      {
        h: 'It looks expensive and costs one lookup',
        p: 'This is why the effect was everywhere in the demoscene. At full size the field is 640 by 440, so four terms is 1,126,400 sine evaluations a frame, or just under 68 million a second at sixty frames. <code>Math.sin</code> is a real transcendental call, and asking for it that often is where a browser plasma&rsquo;s frame rate goes before anybody thinks to blame the canvas. A 2048-entry table turns each one into an integer add, a mask and one typed-array read &mdash; and the Frames cell above is there so you can check that on your own machine rather than take it from me. There is a second gift in the table that is easy to miss: because it is indexed by an integer angle, adding angles is adding integers, so the diagonal term needs no angle-addition identity &mdash; its x half is precomputed per column and its y half per row.'
      },
      {
        h: 'The palette-cycling trick',
        p: 'On a VGA card the 256 colours on screen were indices into a hardware table, and you animated by rewriting that table between frames without touching a single pixel &mdash; 768 bytes of work for a whole screen of movement. That is where the waterfalls and the marching gradients of the era came from. There is no hardware palette any more, so here the offset is added when the index is computed instead: the same idea, done in software, one addition per pixel. It is also why every palette in this file is a closed loop whose last colour equals its first, because a palette with a seam shows the seam sweeping across the field once per cycle.'
      },
      {
        h: 'Rendering smaller, and saying so',
        p: 'The resolution control fills a smaller buffer and lets the browser scale it up, which is how a phone keeps sixty frames &mdash; quarter size is one sixteenth of the pixels. The HUD prints the buffer actually being filled and the frame rate measured in this tab, so both halves of the trade are on screen. A toy that quietly dropped its own resolution to flatter its frame counter would be lying about what it just did, which is the commonest form of a benchmark that means nothing.'
      }
    ],
    faq: [
      {
        q: 'Is this a real plasma?',
        a: 'No, and nothing here simulates one. It is interference between periodic functions — sines added up and read through a colour table. The name is inherited from the demoscene, where it described the look rather than the physics.'
      },
      {
        q: 'Why a sine table when Math.sin exists?',
        a: 'Because of how many times it is called. Four terms over 281,600 pixels is 1.1 million evaluations a frame, and a table lookup is an integer add, a mask and an array read where a trigonometric call is a great deal more than that. The frame counter in the HUD is there so you can watch the effect of the resolution control on your own machine rather than take my word for the arithmetic.'
      },
      {
        q: 'Why does it look soft at low resolution?',
        a: 'Because the small buffer is scaled up with the browser’s own smoothing rather than as hard squares. A plasma has no edges in it to preserve, so the blur costs nothing and is close to what a CRT did to a 320 by 200 mode anyway. The HUD says which size is really being filled.'
      },
      {
        q: 'Does it flash, and does it store anything?',
        a: 'The palette cycle is a continuous gradient rather than a switch between states, and if your system asks for reduced motion the toy opens on a still frame and starts the cycle slow, saying so on the screen. Nothing is stored for this page: there is no score to keep. The sound toggle is shared with the rest of the games and is the one setting that survives a reload.'
      }
    ],
    related: ['kaleidoscope', 'aafire', 'cmatrix'],
  },
  {
    slug: 'race-condition',
    cat: 'cs',
    name: 'Race condition',
    glyph: '⇄',
    script: 'cs/race-condition.js',
    board: true,
    pad: 'none',
    bestKey: 'race-condition',
    tapAction: false,
    engine: 'Ten levels &middot; every interleaving counted',
    title: 'Race Condition Puzzle — Break The Lock',
    ogTitle: 'Nine bugs to cause on purpose. One you cannot.',
    description: 'You are the scheduler. Interleave the threads by hand to force a lost update, a double charge, a deadlock — then meet the one lock you cannot break.',
    short: 'You are the scheduler. Cause the bug.',
    h1: 'Race condition',
    hero: 'Every level here asks you for a <em>wrong</em> answer. Make the counter read 1 after two increments. Take 150 out of an account holding 100. Charge one card three times for one order. The threads are drawn as columns of numbered steps and you click one to run a single step of it, so nothing is timed and nothing is random &mdash; because a race condition is not caused by speed, it is caused by an ordering being legal. Speed only decides how often you meet it. Four of the ten levels hand you a mutex and dare you to break it anyway, and the last one is a lock used correctly, which you cannot break at all.',
    facts: [
      'Ten levels, nine of them breakable',
      'Every ordering counted, not estimated',
      'One level you genuinely cannot beat',
      'Nothing is uploaded'
    ],
    hud: [
      { key: 'level', label: 'Level', init: '1/10' },
      { key: 'score', label: 'Score', accent: true, init: '0' },
      { key: 'runs', label: 'Runs', init: '0' },
      { key: 'best', label: 'Best' }
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-undo">Step back</button>',
      '<button class="game-btn" type="button" id="game-rerun">Run it again</button>',
      '<button class="game-btn" type="button" id="game-hint" title="Highlight a thread that still leads to the bug">Hint</button>'
    ],
    keys: [
      { k: 'Click', d: 'Run one step of that thread' },
      { k: '← →', d: 'Move between the threads' },
      { k: 'Enter', d: 'Run one step of the highlighted thread' },
      { k: 'Space', d: 'The same, and it moves the verdict on' },
      { k: 'Esc', d: 'Pause &mdash; there is no clock to stop' }
    ],
    touch: 'Tap a thread column to run its next step. A column marked blocked is waiting on a lock somebody else holds and will not move until they release it, so tapping it only tells you who is in the way. Step back undoes one step, Run it again resets the level from the top, and Hint points at a thread that still leads to the bug.',
    infoHeading: 'Why the bug is the objective',
    info: [
      {
        h: 'Because finding the interleaving is the skill',
        p: 'A demo that shows you a race condition teaches you what one looks like. Being made to hunt for the ordering yourself teaches the habit that actually catches them, which is reading a read-modify-write and asking what happens if the other thread runs <em>here</em>, at every line, including the ones between the lines you wrote. Every level names a specific wrong answer as the goal, so you cannot finish one by accident and you always know what you were looking for.'
      },
      {
        h: 'The orderings are counted for real, and the number is not a failure rate',
        p: 'Solve a level and the game walks its entire state space and tells you how many of the legal orderings produce the bug: 18 of 20 on the counter, 2 of 44 on the double-checked lock, 0 of 2 on the last one. That is an exhaustive search run in your tab, not a figure somebody typed in &mdash; the Hint button uses the same walk, which is how it can say whether the bug is still reachable from where you are standing. But 90 per cent of orderings is not a 90 per cent failure rate, and the game says so every time it prints one: a real scheduler hardly ever preempts inside a five-line function, so the two clean orderings are exactly the ones your tests keep drawing, ten thousand times, green every time. The bug is not improbable. It is unfairly sampled, until the machine gets busy.'
      },
      {
        h: 'Four locks that fail, each a mistake with a name',
        p: 'The mutex levels are not a victory lap. In one the critical section covers the write but not the read, so the check that decided the write happens outside it and the lock makes no difference at all. In another two locks are taken in opposite orders, and the goal is a genuine deadlock rather than a lost update. In a third somebody shortened the critical section and left the write outside it. The fourth is double-checked locking with the publish reordered above the field write &mdash; the standard Java singleton idiom, printed in books, and broken on every JVM until the memory model was rewritten for Java 5. Each is presented as what it is: a real mistake, made in shipped code, by people who knew what a mutex was.'
      },
      {
        h: 'And one level you cannot win',
        p: 'The last level is the first level with the lock used properly, and there is no interleaving that breaks it. Run both of the two orderings the program has &mdash; that is the whole state space, and it takes ten clicks &mdash; and the game offers you the claim that it cannot be done, then confirms it: 0 of 2. A level whose answer is "you cannot, and here is why" is worth as much as the nine before it, because without it the game would quietly teach that all locks are theatre. <a href="/labs/concurrency">The concurrency lab</a> next door runs the same machinery without a puzzle attached, and the <a href="/games/traffic">junction in Traffic</a> is the deadlock level drawn in tarmac.'
      }
    ],
    faq: [
      {
        q: 'Do I need to know threads to play this?',
        a: 'No. Every step is one line of ordinary-looking code and the shared state is drawn above the columns as it changes, so you can work out what a level does by pressing things. What you will need by level six is the idea that a lock is a period of time rather than a spell cast over a variable, and the levels teach that by breaking four of them.'
      },
      {
        q: 'Is the model a real CPU?',
        a: 'No, and the page would rather say so than pretend. One step here is atomic; on a real processor an increment is several instructions and a store can be torn. Memory reordering is not simulated either — it appears exactly once, in the double-checked locking level, drawn openly as the order the compiler emitted, because inventing a plausible-looking memory model would be making something up. What is real is the interleaving, which is where these bugs actually live.'
      },
      {
        q: 'Where do the ordering counts come from?',
        a: 'A depth-first walk of the whole state space, memoised on the state, run in your browser at the moment you solve the level. Nothing is stored in the page as a lookup table. The three-request level has 33,078 legal orderings and 32,100 of them charge the card three times; the last level has two orderings and neither one is wrong.'
      },
      {
        q: 'Can I get stuck?',
        a: 'A run can reach a point where the bug is no longer reachable — that is not a bug in the game, it is the same thing as a scheduler having already made the decision for you. Step back undoes one step at a time, Run it again resets the level, and Hint will tell you either which thread to run next or that this particular run is already lost. Using a hint costs the fifty-point first-try bonus and nothing else.'
      },
      {
        q: 'How is the score worked out?',
        a: 'A hundred points a level, plus fifty if you produce the bug on your first complete run without a hint. The last level pays a hundred and fifty for correctly claiming it is impossible, which you can only do after running both of its orderings. Fifteen hundred is the maximum, and your best is kept in this browser on this device — there is no server here to keep it anywhere else.'
      },
      {
        q: 'Does anything leave the browser?',
        a: 'No. There are no network calls in the game at all, and the only thing written to storage is your best score, which the reset strip under the board will clear.'
      }
    ],
    related: ['traffic', 'guess-the-output', 'assembly-puzzles'],
  },
  {
    slug: 'social-engineering',
    cat: 'cs',
    name: 'Social engineering',
    glyph: '☏',
    script: 'cs/social-engineering.js',
    width: 720,
    height: 520,
    board: true,
    pad: 'none',
    bestKey: 'social-engineering',
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',
    engine: 'Eight conversations &middot; two axes, scored apart',
    title: 'Social Engineering — Defend The Call',
    ogTitle: 'They did not break in. They rang up and asked.',
    description: 'Eight conversations under live pressure — a call, a walk-in, a chat, a vendor at the door. Choose a reply, then see the technique named and scored.',
    short: 'Pressure on the phone. Verify it politely.',
    h1: 'Social engineering',
    hero: 'The two phishing games here are about mail, which is a thing that sits still while you read it. This one is about a person: a voice that gets annoyed when you check, a courier at the goods door at ten to five on a Friday, a message saying somebody you trust has already approved it. You play the defender, never the attacker. Each reply is scored twice &mdash; did the asset stay protected, and was the answer professionally acceptable &mdash; because those two disagree constantly, and a defender who refuses everything is the same failure as a firewall that drops everything.',
    facts: [
      'Eight scenarios, four a run',
      'Three of them are genuine callers',
      'Scored on two axes, separately',
      'No clock, on purpose'
    ],
    hud: [
      { key: 'call', label: 'Conversation', init: '1/4' },
      { key: 'tech', label: 'Technique', init: '—' },
      { key: 'score', label: 'Score', accent: true, init: '—' },
      { key: 'best', label: 'Best' }
    ],
    controls: [
      '<label class="sr-only" for="game-length">How many conversations</label>',
      '<select class="game-select" autocomplete="off" id="game-length"><option value="4" selected>Four conversations</option><option value="6">Six conversations</option><option value="8">All eight</option></select>',
      '<button class="game-btn" type="button" id="game-coach" aria-pressed="false" title="The technique is named after you reply">Name the technique first</button>'
    ],
    keys: [
      { k: '↑ ↓', d: 'Move between the three replies' },
      { k: 'Enter', d: 'Give that reply, and carry on' },
      { k: 'Esc', d: 'Pause &mdash; nothing is timed anyway' }
    ],
    touch: 'Tap a reply to give it, read what it cost on each axis, then tap Carry on. Every conversation ends on a panel naming the control that would have removed the pressure, and the debrief at the end collects them.',
    infoHeading: 'Why this is scored on two axes',
    info: [
      {
        h: 'Because one number teaches the wrong lesson',
        p: 'Sending the payroll file to a director in a hurry is charming and a disaster. Slamming the door on a real fire-alarm engineer is safe and costs you the certification, the goodwill, and &mdash; three weeks later &mdash; the sign-in process itself, because somebody senior will quietly decide it is the problem. A single score averages those two failures into something that looks like the same mistake, and they are not. So every reply is rated out of ten on whether the asset stayed protected and out of ten on whether the answer was professionally acceptable, and both meters are the running mean rather than a drifting total &mdash; a mean of twelve ratings cannot hide the one turn where you read out an authenticator code.'
      },
      {
        h: 'The best answers are almost always the polite verification',
        p: 'Ring back on a number you looked up rather than one you were given. Ask for the ticket reference and open it yourself. Take the reference the caller offered before they withdraw it. Offer to put the file in the work drive instead of sending it to a personal address. Every one of those scores well on both axes, and none of them is a confrontation &mdash; the check is something you go and do, not something you demand from a person standing in front of you. &ldquo;Nobody is accusing anybody, the rule applies to every supplier including the ones we like&rdquo; is the single most useful sentence in the game, and it works because it is true.'
      },
      {
        h: 'The techniques, and why they work underneath the argument',
        p: 'Authority, so that seniority stands in for identity. Urgency, with a deadline chosen to make checking feel expensive. Reciprocity, which is why the person at the door is carrying two coffees and offering you one. Social proof &mdash; your colleague already approved it, and she is on a flight. Familiarity, which is what an hour of public reading buys: the rota, the outage, the form number, the nickname for the plant room. Tailgating, which runs entirely on how awful it feels to say something to somebody&rsquo;s face. And the helpdesk reversal, where the caller either claims to be IT or claims to be a user ringing IT. <a href="/blog/digital-arrest-scam-explained">The digital arrest scam</a> is authority and urgency run to their limit on a call designed never to end; <a href="/blog/how-sim-swap-works">a SIM swap</a> is the same conversation aimed at a support agent rather than at you; and <a href="/labs/osint-self-check">the OSINT self-check</a> in Labs shows what a stranger can read about you before they ring, which is where that uncomfortable familiarity comes from.'
      },
      {
        h: 'There is no clock, and that is deliberate',
        p: 'The <a href="/games/incident-response">incident response tabletop</a> next door charges you simulated minutes for deliberating, because a breach really does move while you read. This one must not, because the whole defence against a pretext is being allowed to take the time &mdash; a game that punished reading would be teaching the attacker&rsquo;s lesson with the attacker&rsquo;s own instrument. The pressure here lives inside the fiction, where it belongs: the caller escalates, the deadline tightens, the person at the door gets friendlier. You are never actually rushed.'
      },
      {
        h: 'The process, not the person',
        p: 'Every conversation ends on the one control that would have removed the pressure entirely &mdash; a callback rule, a named delegate, an out-of-band check, a visitor diary, a documented verification fallback &mdash; and not on what you should have spotted. Each of these attacks works by asking one individual to be clever, alone, at speed, against somebody who has rehearsed, and the answer to that is never a better individual. Which is also why blaming the person who was manipulated is both unkind and useless: unkind because the techniques are aimed squarely at ordinary decency, and useless because the next person shouted at for falling for one is the next person who quietly does not report one.'
      }
    ],
    faq: [
      {
        q: 'Is this teaching me to be suspicious of everybody?',
        a: 'The opposite, and the scoring enforces it. Three of the eight conversations are genuine callers and every run contains at least one, without saying which. Refusing them outright costs you on both meters, because it is not actually safe: turn a new starter away with no route and somebody lends them a login by Thursday, and now an account in the audit trail is two people. A defender who blocks everything has moved the risk somewhere nobody can see it rather than removing it.'
      },
      {
        q: 'Are any of these real companies, people or scripts?',
        a: 'None of them. Every name, company, building, purchase order and job reference is invented, and where a phone number is printed it comes from the block Ofcom reserves for drama and never allocates. No real campaign is reproduced. The attacker\'s side of each conversation is deliberately thin — a name, a hurry, a deadline, a reference you cannot reach — because the shape is the part worth recognising and nothing here should be liftable.'
      },
      {
        q: 'Why is there no attacker mode?',
        a: 'Because a game that had you writing the pretext would be publishing a working one, and there is no version of that which teaches a defender something they could not learn from the defender\'s chair. The depth in this game is all on your side of the conversation, which is where it is useful.'
      },
      {
        q: 'How is the score worked out?',
        a: 'Each reply is rated out of ten on two axes: whether the asset stayed protected, and whether the answer was professionally acceptable. Each meter is the mean of every reply so far, out of a hundred, and the score is the mean of the two. A run that is strong on one and weak on the other is the interesting result rather than a mistake, and the debrief says which.'
      },
      {
        q: 'Does it work on a phone?',
        a: 'Yes. Every reply is a full-width button you tap, there is no pad and no gesture to learn, and nothing is timed, so a slow read costs nothing. The two meters carry their figures as text and a word — strong, holding, slipping, poor — so colour is never the only signal.'
      },
      {
        q: 'Is anything uploaded?',
        a: 'No. There are no network calls in the game at all. The only things stored are your best score and the two toggles, in this browser on this device, and the reset strip under the game clears them.'
      }
    ],
    related: ['phishing-inbox', 'incident-response', 'cyber-hygiene'],
  },
  {
    slug: 'sqli-escape',
    cat: 'cs',
    name: 'SQL injection escape room',
    glyph: '\';',
    script: 'cs/sqli-escape.js',
    board: true,
    pad: 'none',
    bestKey: 'sqli-escape',
    bestOrder: 'low',
    engine: 'A real SQL parser over five toy tables',
    title: 'SQL Injection Escape Room',
    ogTitle: 'The database has a real parser. Break it.',
    description: 'Break into a toy database that runs a real SQL parser in your browser. Four rooms — login bypass, UNION, blind and time-based — each ending in the fix.',
    short: 'Four injection rooms, one real toy parser.',
    h1: 'SQL injection escape room',
    hero: 'Reading about SQL injection teaches you the diagram of the attack. This teaches you the attack, because there is a real little SQL engine in the page &mdash; a tokeniser, a parser and an evaluator over five in-memory tables &mdash; and it genuinely runs the query you build, injected part and all. Four rooms walk the real techniques in the real order: break a login, <code>UNION</code> a second table out, then pull a value one bit at a time through a page that says only <em>found</em>, and finally through nothing but a delay. Every room ends by showing the parameterised query that would have stopped it, with the value on its own line, because that one picture is the whole lesson.',
    facts: [
      'A real SQL parser, in the page',
      'Four rooms, four techniques',
      'Every payload hits only the toy database',
      'Each room ends in the parameterised fix'
    ],
    hud: [
      { key: 'room', label: 'Room', accent: true, init: '1/4' },
      { key: 'tries', label: 'Queries', init: '0' },
      { key: 'best', label: 'Best' }
    ],
    controls: [
      '<button class="game-btn" type="button" id="game-help">SQL &amp; schema</button>',
      '<button class="game-btn" type="button" id="game-hint">Hint</button>'
    ],
    keys: [
      { k: 'Type', d: 'Your injection into the field' },
      { k: 'Enter', d: 'Send the query' },
      { k: 'Tab', d: 'Move between the fields' }
    ],
    touch: 'Tap a field and the phone keyboard comes up; type your injection there, then tap the button to run the query. In the blind rooms, pick the comparison and a character and tap Send probe. The two buttons above show the schema and a hint.',
    infoHeading: 'What is real here, and what is deliberately a toy',
    info: [
      {
        h: 'The parser is real; the database is not',
        p: 'There is a genuine engine in this page &mdash; it tokenises the query, parses SELECT with WHERE, AND/OR, comparisons, LIKE, UNION SELECT, ORDER BY, LIMIT, both comment forms and a handful of string functions, and then executes it, including the part you injected. What it runs over is five arrays of plain objects that live in the tab and nowhere else. Nothing touches a real database and there is no network call to make one &mdash; the attack is safe precisely because the target is a toy. For the same ideas with a real query planner in front of you, <a href="/labs/sql">the SQL playground</a> and <a href="/labs/sqlite-browser">the SQLite browser</a> are next door.'
      },
      {
        h: 'The assembled query is the teaching device',
        p: 'The string the server would build is on screen the whole time. The template is drawn dim and the characters you typed are drawn bright, so the exact moment a stray quote closes the string and turns the rest of the line into code is something you watch happen rather than something explained afterwards. Once you have seen <code>WHERE user=\'admin\' --\'</code> assemble itself, the fix stops being a rule to remember and starts being obvious.'
      },
      {
        h: 'Why the tempting non-fixes do not work',
        p: 'Escaping quotes by hand loses because you have to get every context right &mdash; strings, numbers, identifiers, LIKE patterns each escape differently &mdash; every single time, and one miss is the whole hole. A blocklist of keywords loses because <code>UNION</code> and <code>OR</code> appear in ordinary data, comments and case tricks slip past, and the list is a promise to enumerate every attack forever. Stored procedures are not automatically safe: one that builds a string and runs <code>EXEC(@sql)</code> is just as injectable. And an ORM is safe only where it parameterises &mdash; its raw-SQL and string-interpolation escape hatches are where the same bug walks back in.'
      },
      {
        h: 'The fix is the same door in every room',
        p: 'A prepared statement sends the query text and the values on separate channels, so a quote or a <code>--</code> in a value arrives as characters to search for, never as SQL to run. That is why each room ends on the parameterised version with the placeholder and the bound value on their own lines: the login payload becomes a username no row has, the UNION becomes a search term nothing matches, and the blind and timing channels close because the database can no longer be talked into confusing data with code.'
      },
      {
        h: 'This is a defensive tool, and stays one',
        p: 'Every payload in here is aimed at the five toy tables and could not be aimed anywhere else. There is no real product named, no filter-evasion catalogue and no exfiltration tooling &mdash; the deliverable of the whole game is the prepared statement at the end of each room. The point is to recognise the shape of the bug so you can close it in your own code, which is the only place any of this should ever be pointed.'
      }
    ],
    faq: [
      {
        q: 'Is this real SQL?',
        a: 'No &mdash; it is a small SQL engine reimplemented in JavaScript over five tables held in memory. It understands SELECT, WHERE, AND/OR, comparisons, LIKE, UNION SELECT, ORDER BY, LIMIT, scalar subqueries, both comment forms and a few string functions. The model matches the real thing closely enough that the techniques transfer, which is the point of the toy.'
      },
      {
        q: 'Does anything I type reach a real database?',
        a: 'No. There are no network calls anywhere in this game, and the tables live in the page. The passwords you are trying to get around are sitting in that in-memory data, which is safe because a query cannot leave the tab it runs in.'
      },
      {
        q: 'Do I need to know SQL already?',
        a: 'It helps, but the Schema button shows every table and the SQL the engine understands, and each room has a hint that spells out the technique. If you want the theory in a tool rather than a game, the SQL playground and the SQLite browser in Labs cover it without a score attached.'
      },
      {
        q: 'The blind rooms are slow. Is that the point?',
        a: 'Yes. A blind injection leaks one bit at a time, so you extract a value character by character &mdash; and a binary search using the < and > comparisons gets there in a handful of queries where marching the alphabet takes dozens. In the time-based room the only signal is a delay, and that delay is simulated in your tab; nothing is holding a server open.'
      },
      {
        q: 'What counts towards the best score?',
        a: 'Every query you send, in every room, whether it works or errors &mdash; an attacker pays for each request. Lower is better, so a clean run is a small number of well-chosen queries, and a binary search on the two blind rooms is most of the difference between a tidy score and a slog.'
      },
      {
        q: 'Is this teaching me to attack websites?',
        a: 'It is teaching you to recognise and close the bug. Every payload targets only the toy tables in this page, there is nothing here aimed at a real product, and each room ends on the one thing that actually stops the attack: a parameterised query. That is the whole takeaway.'
      }
    ],
    related: ['ctf-arcade', 'shell-quest', 'password-duel'],
  },

  /* ---- added in the labs/games/posts batch ---- */
  {
    slug: 'antakshari',
    cat: 'fun',
    name: 'Antakshari',
    glyph: 'अ',
    script: 'fun/antakshari.js',
    board: true,
    pad: 'none',
    bestKey: 'antakshari',
    engine: 'Two closed word lists &middot; a minimax on letters',
    title: 'Antakshari — The Rule, Played With Words',
    ogTitle: 'The antakshari rule, without the lyrics',
    description: 'Every word must begin with the last letter of the one before it. Play the computer or pass the phone round, with a clock on every turn and no repeats.',
    short: 'Last letter starts the next word.',
    h1: 'Antakshari',
    hero: 'Antakshari is sung, and the singing is the one thing this cannot ship: film lyrics are somebody else&rsquo;s copyrighted work, and nothing in this section adds a single audio byte to the site. So the <em>rule</em> is kept and the <em>content</em> is swapped &mdash; your entry must start with the last letter of the entry before it, no repeats in a round, twenty-five seconds a turn. The page says that out loud rather than hiding it behind a feature list.',
    facts: [
      'The rule, not the songs',
      'No lyrics, stored or shown',
      'It tells you how starved a letter is',
      'Pass and play, or the computer'
    ],
    hud: [
      { key: 'score', label: 'Chain', accent: true, init: '0' },
      { key: 'time', label: 'Time', init: '25' },
      { key: 'best', label: 'Best' }
    ],
    controls: [
      '<label class="sr-only" for="game-mode">Opponent</label>',
      '<select class="game-select" autocomplete="off" id="game-mode"><option value="computer" selected>Against the computer</option><option value="pass">Two players, pass and play</option></select>',
      '<label class="sr-only" for="game-words">Word list</label>',
      '<select class="game-select" autocomplete="off" id="game-words"><option value="english" selected>English words</option><option value="desi">Indian words</option></select>',
      '<label class="sr-only" for="game-level">Difficulty</label>',
      '<select class="game-select" autocomplete="off" id="game-level"><option value="gentle">Gentle</option><option value="fair" selected>Fair</option><option value="sharp">Sharp</option></select>'
    ],
    keys: [{ k: 'Type', d: 'Your word' }, { k: 'Enter', d: 'Play it' }],
    touch: 'Tap the field to raise the keyboard and type your word; Play it and Give up the round are buttons above the chain.',
    infoHeading: 'How it plays, and what it refuses to do',
    info: [
      {
        h: 'The list is the referee for both sides',
        p: 'Every word comes from one of two hand-written lists &mdash; ordinary English nouns, or well-known Indian words written in Latin script, which are places, foods and objects and nothing out of a film. A real word the list has never heard of is refused, which is a genuine limit and is stated on the board rather than buried here. What the closed list buys is the counter below.'
      },
      {
        h: 'It shows you how starved a letter is',
        p: 'Because both sides draw from the same closed list, the game can tell you exactly how many unused words remain on the letter you are about to hand over. Handing somebody a starved letter is the entire strategy of antakshari, normally played by feel; here it is a number on the screen while you still have time to pick a different word.'
      },
      {
        h: 'The computer plays that same strategy',
        p: 'Its candidates are the unused words starting with the required letter, and it scores each by how few options you would be left with afterwards. On Sharp it takes the minimum every time. Where forty-seven words end in R and only fourteen begin with one, that is enough to be genuinely hard to beat &mdash; and Gentle exists because that is not always the game you want.'
      },
      {
        h: 'No lyrics, and no letter keys either',
        p: 'The shell that runs every game here binds arrows, Space, Enter and Escape and deliberately no letter at all, which is exactly what lets a game whose entire input is typing run on it: the text field is this game&rsquo;s own and nothing upstream is competing for your keystrokes.'
      }
    ],
    faq: [
      {
        q: 'Why are there no songs?',
        a: 'Film lyrics are copyrighted, and a database of them is not something this site will publish. Every sound in this section is also synthesised rather than stored, so there is no audio here at all. Keeping the rule and swapping the content was the honest way to build it.'
      },
      {
        q: 'My word is real but it was refused. Why?',
        a: 'The word list is closed and hand-written, so it does not know every real word. That is a genuine limitation. It is also what lets the game count the remaining words on a letter, which is the part worth having.'
      },
      {
        q: 'What is the difference between the two word lists?',
        a: 'One is ordinary English nouns. The other is well-known Indian words in Latin script — places, foods and everyday objects. Neither contains anything taken from a film or any other copyrighted work.'
      },
      {
        q: 'How is the score worked out?',
        a: 'It is the length of the chain you kept going. Higher is better, and your best is kept in this browser on this device, under a key you can clear with your site data.'
      },
      {
        q: 'Can two people play on one phone?',
        a: 'Yes. Choose pass and play, and the game names each side in turn. Nothing is sent anywhere and there is no online mode, here or in any game on this site.'
      }
    ],
    related: ['word-of-the-day', 'typing-trainer', 'hangman'],
  },
  {
    slug: 'chimes',
    cat: 'toy',
    name: 'Wind chimes',
    glyph: '♫',
    script: 'toy/chimes.js',
    width: 640,
    height: 480,
    pad: 'none',
    bestKey: null,
    tapAction: false,
    engine: 'Free-free tube modes &middot; spherical pendulums',
    title: 'Wind Chimes — Pitch From Tube Length',
    ogTitle: 'A chime you can retune by cutting it',
    description: 'A wind chime simulated rather than sampled: every note comes from its tube length, and the wind decides when it sounds. Six tubes, three metals, three tunings.',
    short: 'Pitch comes from length. Wind decides when.',
    h1: 'Wind chimes',
    hero: 'Nothing here schedules a note. Each tube, the clapper and the sail swing as pendulums against a wind that gusts, and a tube sounds when the clapper actually reaches it &mdash; struck as hard as the closing speed says. The pitch is not assigned either: it falls out of the tube&rsquo;s length, and because it goes as one over length <em>squared</em>, halving a tube raises it two octaves rather than one. Drag the size slider and hear that happen.',
    facts: [
      'Pitch derived from length',
      'Metal changes the length, not the note',
      'The wind decides the rhythm',
      'Sound is synthesised, never a file'
    ],
    hud: [
      { key: 'note', label: 'Last note', accent: true, init: '—' },
      { key: 'strikes', label: 'Strikes', init: '0' },
      { key: 'tuning', label: 'Tuning', init: 'Pentatonic' },
      { key: 'wind', label: 'Wind', init: 'Breeze' }
    ],
    controls: [
      '<label class="game-range"><span>Wind</span><input type="range" id="game-wind" min="0" max="100" value="35" /></label>',
      '<label class="game-range"><span>Gusts</span><input type="range" id="game-gust" min="0" max="100" value="45" /></label>',
      '<label class="game-range"><span>Size</span><input type="range" id="game-size" min="55" max="160" value="100" /></label>',
      '<label class="sr-only" for="game-tubes">Number of tubes</label>',
      '<select class="game-select" autocomplete="off" id="game-tubes"><option value="4">4 tubes</option><option value="5">5 tubes</option><option value="6" selected>6 tubes</option><option value="8">8 tubes</option></select>',
      '<label class="sr-only" for="game-tuning">Tuning</label>',
      '<select class="game-select" autocomplete="off" id="game-tuning"><option value="pentatonic" selected>Pentatonic</option><option value="major">Major</option><option value="raga">Raga Bhairav</option></select>',
      '<label class="sr-only" for="game-material">Material</label>',
      '<select class="game-select" autocomplete="off" id="game-material"><option value="aluminium" selected>Aluminium</option><option value="brass">Brass</option><option value="glass">Glass</option></select>'
    ],
    keys: [{ k: 'Drag', d: 'Blow on the tubes' }, { k: 'Tap', d: 'A puff at that spot' }],
    touch: 'Drag across the chime to blow on it, or tap for a puff at that spot. The sliders and the three dropdowns work the same as on a computer.',
    infoHeading: 'What is actually being modelled',
    info: [
      {
        h: 'The pitch is not a number I chose',
        p: 'For the fundamental bending mode of a thin free-free tube, frequency goes as the radius of gyration over length squared, times the bar speed of the metal. That formula is what decides every note here. It is the <em>ideal</em> thin-tube case and real chimes are not tuned with it &mdash; a real tube has a wall thick enough to matter, a suspension hole and often an end cap, so the formula lands a few per cent out and a maker cuts long and trims by ear. What it gets right is the shape of the relationship, which is the part you can hear.'
      },
      {
        h: 'Why brass and aluminium differ',
        p: 'Only through the square root of stiffness over density. Swap the metal at a fixed tuning and the tubes visibly change length to hold the same notes, which is the honest way round: the material does not change the note, it changes how long the tube has to be to make it.'
      },
      {
        h: 'Pentatonic, and why chimes use it',
        p: 'A chime is struck at random by the weather, so any two tubes can sound together at any moment. A pentatonic scale has no semitone in it, which means no pair of tubes can clash &mdash; that is the whole reason it is the traditional choice. Switch to Major and listen for the seventh against the octave; it is not unpleasant, but it is a decision somebody made.'
      },
      {
        h: 'The wind is a condition, not an event',
        p: 'So the wind is a held sound layer that the shell fades with the run, while each strike is a one-shot built from four partials that decay at different rates &mdash; which is what makes struck metal sound like metal. In a gale the strikes are thinned deliberately, because the honest event rate and the bearable sound rate are different numbers.'
      }
    ],
    faq: [
      {
        q: 'Is any of this a recording?',
        a: 'No. There is no audio file anywhere in this section of the site. Every partial of every strike, and the wind behind them, is generated in your browser as you listen.'
      },
      {
        q: 'Why does the size slider change the pitch so violently?',
        a: 'Because pitch goes as one over length squared, not one over length. Halving a tube raises it by two octaves. That is the single most surprising thing about tuned tubes and the slider exists to make it audible.'
      },
      {
        q: 'Are these real chime tunings?',
        a: 'The scales are real and the relationship between length and pitch is real. The absolute frequencies are the ideal thin-tube formula rather than a measured instrument, so treat it as the right shape rather than a tuning reference.'
      },
      {
        q: 'Is there a score?',
        a: 'No. Nothing here can be won or lost, so no best score is kept and none is stored. It is a toy, and the page says so rather than inventing a number to chase.'
      },
      {
        q: 'Why is the sound off when I arrive?',
        a: 'Every game and toy here starts muted, because a page that makes noise unasked is a page people close. This is the one in the section most worth turning on.'
      }
    ],
    related: ['fountain', 'rain', 'boids'],
  }
];

module.exports = { GAMES, CATEGORIES, HUB };

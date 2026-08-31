/* ==========================================================================
   packet-routing.js — a routing protocol you can break, running for real.
   --------------------------------------------------------------------------
   THE ROUTING IS NOT SCRIPTED. That is the whole point of the file, and it
   is worth saying first because a page about routing is very easy to fake:
   draw a network, animate a dot along a path somebody hard-coded, and call
   the path a protocol. Nothing here works that way. Seven routers each hold
   their own table, the tables are produced by an algorithm that only sees
   what a real router would see, and every packet is forwarded one hop at a
   time by whatever the table at that hop happens to say at that instant —
   including when what it says is wrong.

   Three protocol families, and the differences between them are the lesson:

     STATIC          the player writes the next hop, per router, per
                     destination. It is seeded from the shortest paths so
                     you start from something that works, and then it never
                     changes again on its own. Cut a link and static keeps
                     posting packets into the hole, which is the entire case
                     against it in one gesture.

     DISTANCE VECTOR Bellman-Ford, the way RIP does it. A router knows its
                     own links and whatever its neighbours claim, and
                     nothing else. Every round it sends its whole vector to
                     each neighbour and takes the best offer. Two rules do
                     all the damage: a route learned from your current next
                     hop is always believed, even when it gets worse, and 16
                     means unreachable.

     LINK STATE      Dijkstra, the way OSPF does it. Each router floods a
                     description of its own neighbourhood, every router ends
                     up holding the whole map, and each one runs shortest
                     path first over its own copy. Convergence is a flood
                     plus one computation rather than a metric crawling
                     round the network, and the price is that all seven
                     routers store all eight links.

   COUNT TO INFINITY HAPPENS HERE, IT IS NOT DESCRIBED. G hangs off E and
   nothing else, so every route to G in the network is a route through E.
   Cut E to G with distance vector running and split horizon off, and this
   is what the harness prints, round by round, with the metric read straight
   out of the tables the packets are using:

     t=12   A: via E, 1+2=3      B: via A, 5      the truth
     t=14   A: via B, 7          B: via A, 5      the loop has formed
     t=16   A: 7                 B: 9
     t=18   A: 11                B: 9
     t=20   A: 11                B: 13
     t=22   A: 15                B: 13
     t=24   A: 15                B: unreachable
     t=26   everything says unreachable

   E withdraws its route honestly. A hears the withdrawal and then, in the
   same round, hears B offer a route to G that B only has because A gave it
   to A round earlier. A believes it, because it did not come from E. Now A
   points at B, B points at A, and the pair add the cost of the link between
   them to each other's lie until they arrive at 16, which is the only
   reason the sequence terminates at all. Every packet for G ping-pongs
   between them for those twelve seconds and dies of hop count. The metrics
   above are real table entries, and the drops are real TTL expiries.

   Then turn split horizon on: B stops advertising back to A the route it
   learned from A, A's withdrawal is the only thing on offer, and the whole
   network says unreachable within two rounds with no climb at all. Poison
   reverse states that withdrawal (metric 16) rather than leaving it to be
   inferred from a message that is not there, which is what makes it robust
   against a lost update — and, with the expiry counter modelled here, three
   rounds faster in the case where both ends have gone quiet.

   SPLIT HORIZON FIXES THE TWO-ROUTER LOOP AND NOTHING LARGER, and this file
   is built to show that rather than to hide it. The demonstration opens by
   taking two links out of service so the map is a TREE, because on a tree
   the two-router case is the only case. Press Repair everything to put the
   ring back, cut E to G again with split horizon still on, and the metric
   climbs anyway — the stale route simply goes the long way round a loop
   split horizon cannot see. That is a property of the technique rather than
   a defect in this model, and it is why RIP still needs the ceiling of 16.
   Triggered updates and holddown are not modelled: the rounds are strictly
   periodic so the counting is legible, and a real implementation would fire
   an update the instant a route died and be finished before you had read
   the first line of it.

   CONGESTION IS THE SECOND HALF. Every link direction has a transmitter
   that accepts one packet every 1/CAP seconds and a drop-tail queue in
   front of it. Fill the queue and the next arrival is dropped, which is
   what a router actually does. Shortest-path routing sends everything down
   one path, so at the spike the queue on the first hop overflows while the
   equal-cost path beside it carries nothing at all. Turn multipath on and
   the same load fits, because A has two next hops of cost 6 for D and uses
   both. That gap between "shortest" and "best" is the reason equal-cost
   multipath and traffic engineering exist.

   WHAT IS SIMPLIFIED, said plainly here and on the page:

     - No wire format. There is no RIP or OSPF packet anywhere in this file,
       no hello protocol, no adjacency state machine, no areas, no
       authentication. Vectors and link-state advertisements are objects
       handed between routers on a timer.
     - No BGP and no policy. Every metric here is a cost. Real inter-domain
       routing picks paths on business relationships that no shortest-path
       algorithm can express.
     - Multipath here alternates per PACKET. Real equal-cost multipath
       hashes the flow's addresses and ports so that one connection keeps
       one path; alternating per packet would reorder a real TCP flow and
       the receiver would read the gaps as loss.
     - AND THE ONE THAT MATTERS MOST: there is no feedback from the drops
       back to the senders. Real congestion control watches for loss and
       reduces the offered load, so a real network under this spike would
       throttle itself rather than pouring the same rate into a full queue
       forever. The senders here are open-loop and indifferent. That makes
       the queue overflow easy to see and makes the model wrong in exactly
       the way /labs/tcp-congestion is about.

   SOUND. A network carrying traffic is a condition rather than a sequence
   of events, so the bulk of it is a bed with three layers: a hiss whose
   brightness follows how much is in flight, a pair of oscillators a fifth
   apart that sit up while the tables are still changing and fade as the
   network converges, and a low detuned pair that swells with the deepest
   queue. Converging is a thing you can hear stop. One-shots are kept for
   events that really are events — a link cut, a delivery, a drop, the tick
   of a distance vector round — and all but the cut are gated, because two
   hundred deliveries a minute is more ticks than an ear wants.
   ========================================================================== */

/* global GameShell */
(function () {
  'use strict';

  var W = 720;
  var H = 520;

  /* Everything left of this is the network, everything right of it is the
     panel. The map is clipped to it so a label on an edge router cannot
     scribble over the routing table. */
  var PANEL_X = 462;

  /* RIP's infinity, and the reason it is 16 rather than a large number: the
     count has to TERMINATE, and it terminates by arriving at a value both
     ends agree means unreachable. A ceiling of 16 also caps the diameter of
     any network the protocol can serve, which is the price. */
  var INF = 16;

  /* One distance vector exchange every two seconds. Real RIP is thirty,
     which would make the counting sequence take three and a half minutes.
     Two is slow enough to read a round and fast enough to sit through. */
  var ROUND = 2.0;

  /* Rounds a route may go unrefreshed by its own next hop before it is
     thrown away. RIP's expiry timer is 180 seconds, six missed updates.

     This is not decoration. Split horizon by OMISSION leaves a stale route
     with nothing to contradict it, so the only thing that can remove it is
     a timer — which is the entire argument for poison reverse, where the
     withdrawal is stated and lands in one round instead of three. Without
     an expiry timer in the model that difference does not exist and the two
     techniques look identical, which is the wrong lesson. */
  var MAXAGE = 3;

  /* One hop of link-state flooding, and the delay a router waits before
     recomputing after its database changes. Real OSPF holds SPF down for
     rather longer than this so a storm of advertisements produces one
     computation instead of forty. */
  var FLOOD_T = 0.30;
  var SPF_DELAY = 0.25;

  /* Packets a second one direction of a link will transmit, and how many
     may wait in front of it. Both are per DIRECTION: a link that is full
     one way is idle the other, which is true of real ones. */
  var CAP = 10;
  var QMAX = 10;

  /* Hops a packet may take before it is dropped. Eight is far more than the
     four-hop diameter of this map, so nothing hits it in normal operation
     and everything that hits it is in a loop. */
  var TTL0 = 8;

  /* How long the tables must sit still before the network is called
     converged. Longer than one round, so a distance vector network is not
     briefly declared converged in the gap between two exchanges. */
  var QUIET = ROUND * 1.4;

  /* Seven routers. Positions are logical units in the map half of the
     canvas and were chosen so no two links cross, because a crossing on a
     network diagram is read as a junction by everyone who has ever seen a
     circuit. */
  var NODES = [
    { name: 'A', x: 52, y: 246 },
    { name: 'B', x: 150, y: 118 },
    { name: 'C', x: 300, y: 96 },
    { name: 'D', x: 408, y: 200 },
    { name: 'E', x: 146, y: 366 },
    { name: 'F', x: 300, y: 372 },
    { name: 'G', x: 56, y: 452 }
  ];
  var N = NODES.length;

  /* Eight links, and two of the decisions in this list were made with the
     harness running rather than at the whiteboard.

     A to D is 6 through B and C and 6 through E and F, deliberately EQUAL,
     because equal-cost multipath is one of the things this page is for and
     a tie is the only condition under which it may do anything at all. The
     cross link C to F costs 4 so it is the detour rather than the route,
     and E to G costs 1 so a metric climbing away from 1 is easy to read.

     THERE IS NO B TO E LINK, and that absence is load bearing. With it in,
     A, B and E form a triangle, and a triangle defeats split horizon: when
     E withdraws its route to G, A and B have both learned G from E, they
     are adjacent, and neither of them learned it from the other — so
     neither suppresses it, they feed each other the stale route, and the
     metric counts up exactly as it does with split horizon off. That is
     genuine protocol behaviour and it is the reason split horizon is only
     ever claimed to fix the two-router case. It also meant the page's
     headline demonstration produced the same picture with the fix on and
     the fix off, which teaches the opposite of the intended thing. Take the
     link out and the failure and the fix separate cleanly, with the loop
     that does still form at B and C showing the difference between clearing
     by omission (four rounds, on the expiry counter) and clearing by poison
     reverse (one round). The triangle case is stated in the page copy
     rather than hidden. */
  var LINKS = [
    { a: 0, b: 1, cost: 2 },
    { a: 0, b: 4, cost: 2 },
    { a: 1, b: 2, cost: 2 },
    { a: 2, b: 3, cost: 2 },
    { a: 4, b: 5, cost: 2 },
    { a: 5, b: 3, cost: 2 },
    { a: 2, b: 5, cost: 4 },
    { a: 4, b: 6, cost: 1 }
  ];
  var L = LINKS.length;

  /* LINKOF[i][j] is the link index joining i and j, or -1. Built once,
     because it is asked for on every hop of every packet. */
  var LINKOF = [];
  var ADJ = [];
  (function () {
    var i, j;
    for (i = 0; i < N; i++) {
      LINKOF[i] = [];
      ADJ[i] = [];
      for (j = 0; j < N; j++) LINKOF[i][j] = -1;
    }
    for (i = 0; i < L; i++) {
      LINKOF[LINKS[i].a][LINKS[i].b] = i;
      LINKOF[LINKS[i].b][LINKS[i].a] = i;
      ADJ[LINKS[i].a].push(LINKS[i].b);
      ADJ[LINKS[i].b].push(LINKS[i].a);
    }
  })();

  function linkName(i) {
    return NODES[LINKS[i].a].name + ' to ' + NODES[LINKS[i].b].name;
  }

  /* --------------------------------------------------------------------
     The scenarios.

     Each one is a set of flows, a script of things that happen to the
     network on a timer, and a clock. The target is not a number somebody
     guessed: it is seven tenths of the packets the scenario will actually
     offer, worked out by walking the script at reset. A goal computed from
     the load cannot drift away from the load when a rate is edited.
     -------------------------------------------------------------------- */
  var LEVELS = [
    {
      id: 'sandbox',
      name: 'Sandbox',
      secs: 0,
      flows: [{ s: 0, d: 3, rate: 3, prio: false }, { s: 0, d: 6, rate: 1, prio: false }],
      script: [],
      note: 'No clock and nothing to win. Watch G, cut the E to G link and see what ' +
        'distance vector does with it.'
    },
    {
      id: 'converge',
      name: '1 Converge',
      secs: 40,
      flows: [{ s: 0, d: 3, rate: 5, prio: false }],
      script: [],
      note: 'Nothing breaks. Get the tables agreed and keep A to D running.'
    },
    {
      /* THE TREE IS DELIBERATE, and it is the honest way to show the fix
         working. Split horizon is only ever claimed to remove the loop
         between TWO routers, and on a map with a ring in it the stale route
         simply goes the long way round instead — which is why RIP still
         needs the ceiling of 16. So this scenario opens by taking the two
         links that close the ring out of service, leaving a tree, and says
         so out loud. Press Repair everything to put the ring back and the
         fix stops working, which is a property of split horizon rather than
         a bug in this page. */
      id: 'infinity',
      name: '2 Count to infinity',
      secs: 50,
      demo: true,
      flows: [{ s: 0, d: 6, rate: 2, prio: false }],
      script: [
        {
          t: 0, cuts: [LINKOF[2][3], LINKOF[2][5]],
          say: 'Two links are out of service to start with, so the map is a tree. ' +
            'Split horizon only ever claims to fix the loop between two routers, ' +
            'and a tree is where that claim holds.'
        },
        {
          t: 12, cut: LINKOF[4][6],
          say: 'The E to G link is cut. G is now unreachable and every router ought ' +
            'to say so. Watch the metric for G at A and at B.'
        }
      ],
      note: 'A demonstration, not a score. Run it with split horizon off, then run ' +
        'it again with split horizon and poison reverse on.'
    },
    {
      id: 'cut',
      name: '3 Survive a link cut',
      secs: 45,
      flows: [{ s: 0, d: 3, rate: 6, prio: false }],
      script: [
        { t: 14, cut: LINKOF[1][2], say: 'The B to C link is cut. D is still reachable through E and F.' },
        { t: 32, mend: LINKOF[1][2], say: 'The B to C link is back.' }
      ],
      note: 'The path in use fails halfway through. Keep delivering.'
    },
    {
      id: 'fail',
      name: '4 Router failure',
      secs: 45,
      flows: [{ s: 0, d: 3, rate: 6, prio: false }],
      script: [
        { t: 14, down: 2, say: 'Router C has failed. Everything through it is gone.' },
        { t: 32, up: 2, say: 'Router C is back, with an empty table to fill.' }
      ],
      note: 'A whole router goes, not a link. Two of its links go with it.'
    },
    {
      id: 'spike',
      name: '5 Traffic spike',
      secs: 45,
      flows: [{ s: 0, d: 3, rate: 5, prio: false }, { s: 0, d: 3, rate: 2, prio: true }],
      script: [
        { t: 12, rate: [16, 2], say: 'The spike has started. One path cannot carry it.' },
        { t: 34, rate: [5, 2], say: 'The spike is over.' }
      ],
      note: 'Eighteen packets a second into a link that takes ten. The priority ' +
        'flow costs five each if you drop it.'
    }
  ];

  function levelAt(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return LEVELS[0];
  }

  /* Seven tenths of what the scenario will offer, worked out by walking the
     rate changes in the script rather than by counting on a fixed rate. */
  function offeredBy(lv) {
    if (!lv.secs) return 0;
    var rates = lv.flows.map(function (f) { return f.rate; });
    var t = 0;
    var total = 0;
    var i, k, sum;
    for (i = 0; i < lv.script.length; i++) {
      if (!lv.script[i].rate) continue;
      sum = 0;
      for (k = 0; k < rates.length; k++) sum += rates[k];
      total += sum * (lv.script[i].t - t);
      rates = lv.script[i].rate.slice();
      t = lv.script[i].t;
    }
    sum = 0;
    for (k = 0; k < rates.length; k++) sum += rates[k];
    total += sum * (lv.secs - t);
    return total;
  }

  /* --------------------------------------------------------------------
     Small drawing helpers.
     -------------------------------------------------------------------- */
  function wrap(ctx, text, x, y, maxw, lh) {
    var words = String(text).split(' ');
    var line = '';
    var i;
    for (i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxw && line) {
        ctx.fillText(line, x, y);
        y += lh;
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var len = dx * dx + dy * dy;
    var t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var qx = ax + dx * t;
    var qy = ay + dy * t;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }

  GameShell.define({
    id: 'game-packet-routing',
    slug: 'packet-routing',
    title: 'Packet routing',
    width: W,
    height: H,

    /* Set here as well as in the manifest, and the build gate is right to
       insist: a behavioural field that lives only in the manifest is a
       comment that reads like code. */
    bestKey: 'packet-routing',
    bestOrder: 'high',
    /* A tap is how you select a router or a link on a phone, so the shell
       must not also read it as the Action key. tapKey is stated for the
       same parity reason even though nothing reads it while taps are off. */
    tapAction: false,
    tapKey: 'action',

    startTitle: 'Route it',
    startText: 'Seven routers, eight links, and tables that are computed rather than ' +
      'drawn. Pick a protocol, then break something.',

    setup: function (g) {
      /* Asked once. Reduced motion here removes the pulsing on the alert
         banner and the trails behind packets; it does not slow the network,
         because the packets moving ARE the explanation. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      /* ---------------- configuration, from the toolbar ---------------- */
      var proto = 'dv';            // dv | ls | static
      var splitH = false;
      var poison = false;
      var ecmp = false;
      var level = LEVELS[0];
      var watch = 3;               // the destination whose table is on show

      /* ---------------- topology state ---------------- */
      var nodeUp = [];
      var linkUp = [];

      /* ---------------- forwarding state ---------------- */
      /* dvT[r][d] is one table entry: a metric and the neighbour it points
         at. lastVec[r][n] is the vector neighbour n most recently sent r,
         kept because the equal-cost set cannot be recovered from the table
         alone — the table remembers the winner, not the ties. */
      var dvT = [];
      var lastVec = [];
      var prevM = [];
      var dvHops = [];
      var dvAge = [];

      var lsdb = [];               // lsdb[r][origin] = advertisement
      var lsSeq = [];
      var lsMsgs = [];             // advertisements in flight, with a due time
      var spfDue = [];
      var lsHops = [];
      var lsDist = [];

      var staticNext = [];
      var rrCount = [];            // round robin cursor, per router per dst

      /* ---------------- traffic ---------------- */
      var dirs = [];               // dirs[link][0|1] = { queue, flight, free }
      var flowAcc = [];
      var flowRate = [];
      var packetId = 0;

      /* ---------------- counters ---------------- */
      var clock = 0;
      var round = 0;
      var roundT = 0;
      var delivered = 0;
      var dropped = 0;
      var prioDropped = 0;
      var dropWhy = { noroute: 0, ttl: 0, queue: 0, down: 0 };
      var latList = [];
      var meanLat = 0;
      var offered = 0;
      var target = 0;
      var scriptAt = 0;
      /* Read once per run rather than once per frame. The best for each
         scenario is kept separately because the six of them do not offer
         the same load, and one number covering all of them would be a
         comparison nobody could act on. */
      var levelBest = 0;

      var lastChange = 0;          // when a table last moved
      var lastTopo = -1;           // when the topology last moved
      var convergeSecs = -1;
      var wasConverged = true;

      var countingDst = -1;        // a destination whose metric is climbing
      var countingSaid = false;
      var banner = '';
      var bannerAt = -1;

      var selIdx = 0;              // 0..N-1 routers, then N.. links
      var hudAcc = 0;
      var sndAcc = 0;
      var ended = false;

      var protoSel = document.getElementById('game-proto');
      var levelSel = document.getElementById('game-level');
      var watchSel = document.getElementById('game-watch');
      var splitBtn = document.getElementById('game-split');
      var poisonBtn = document.getElementById('game-poison');
      var ecmpBtn = document.getElementById('game-ecmp');
      var repairBtn = document.getElementById('game-repair');

      /* ================================================================
         The sound of a network.
         ================================================================
         Three held layers, because all three of the things worth hearing
         are conditions rather than events. WIRE is filtered noise steered
         by how much is actually in flight. CHURN is two sine tones a fifth
         apart that sit up while the tables are still moving and fade out
         as the network settles, so convergence is audible before you have
         read the panel that names it. JAM is a low detuned pair whose beat
         follows the deepest queue on the map. */
      var net = g.bed(function (a) {
        var ctx = a.ctx;

        var wire = ctx.createBufferSource();
        wire.buffer = a.noise();
        wire.loop = true;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        /* Low Q on purpose. Anything resonant stops being a room full of
           equipment and starts being a whistle. */
        bp.Q.value = 0.7;
        bp.frequency.value = 700;
        var wireG = ctx.createGain();
        wireG.gain.value = 0.004;
        wire.connect(bp);
        bp.connect(wireG);
        wireG.connect(a.out);
        wire.start();

        var churn = ctx.createGain();
        churn.gain.value = 0;
        churn.connect(a.out);

        var jam = ctx.createGain();
        jam.gain.value = 0;
        jam.connect(a.out);

        function tone(hz, type, into) {
          var o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = hz;
          o.connect(into);
          o.start();
          return o;
        }
        tone(294, 'sine', churn);
        tone(441, 'sine', churn);
        /* 71 and 75.5 Hz beat about four and a half times a second, which
           the ear takes as roughness rather than as a wobble. Roughness is
           the meaning wanted: something is wrong. */
        tone(71, 'triangle', jam);
        tone(75.5, 'triangle', jam);

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Longer than the gap between two recomputes, so consecutive
             ramps overlap and a fade reads as a fade rather than as five
             steps. */
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.32 : secs));
        }

        function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

        return {
          set: function (key, value) {
            var k = clamp01(value);
            if (key === 'load') {
              ramp(bp.frequency, 420 + k * 1500);
              ramp(wireG.gain, 0.003 + k * 0.022);
            } else if (key === 'churn') {
              ramp(churn.gain, k * 0.020);
            } else if (key === 'jam') {
              ramp(jam.gain, k * 0.030);
            }
          }
        };
      });

      function sndDeliver() {
        if (g.gate('deliver', 0.32)) g.pluck(720, 0.11, 0.035, 'triangle');
      }
      function sndDrop() {
        if (g.gate('drop', 0.28)) g.noise(0.07, { type: 'highpass', freq: 1900, level: 0.05 });
      }
      function sndRound() {
        if (g.gate('round', 0.4)) g.beep(1180, 0.02, 'sine', 0.02);
      }
      function sndCut() {
        g.noise(0.28, { type: 'lowpass', freq: 420, to: 110, q: 1.4, level: 0.09 });
      }

      /* ================================================================
         Topology.
         ================================================================ */
      function usable(i, j) {
        var l = LINKOF[i][j];
        return l >= 0 && linkUp[l] && nodeUp[i] && nodeUp[j];
      }

      function costOf(i, j) {
        var l = LINKOF[i][j];
        return l >= 0 ? LINKS[l].cost : -1;
      }

      function say(msg, holdFor) {
        banner = msg;
        bannerAt = clock + (holdFor == null ? 7 : holdFor);
        g.announce(msg);
      }

      /* Every change to the map comes through here, so there is exactly one
         place that restarts the convergence stopwatch and exactly one place
         that tells link state to re-originate. */
      function topologyChanged(incident) {
        lastTopo = clock;
        lastChange = clock;
        convergeSecs = -1;
        wasConverged = false;
        countingSaid = false;
        countingDst = -1;
        if (proto === 'ls') {
          for (var i = 0; i < incident.length; i++) originate(incident[i]);
        }
      }

      /* Packets sitting on or crossing a link that has just gone are lost.
         Anything else would be a queue that survives its own cable. */
      function flushLink(li) {
        var side, k;
        for (side = 0; side < 2; side++) {
          var d = dirs[li][side];
          for (k = 0; k < d.queue.length; k++) drop(d.queue[k], 'down');
          for (k = 0; k < d.flight.length; k++) drop(d.flight[k], 'down');
          d.queue = [];
          d.flight = [];
        }
      }

      function setLink(li, up, quiet) {
        if (linkUp[li] === up) return;
        linkUp[li] = up;
        if (!up) flushLink(li);
        topologyChanged([LINKS[li].a, LINKS[li].b]);
        if (!quiet) sndCut();
        say(linkName(li) + (up ? ' is back up, cost ' + LINKS[li].cost + '.'
          : ' is cut. Anything that was on it is lost.'));
      }

      function setNode(r, up, quiet) {
        if (nodeUp[r] === up) return;
        nodeUp[r] = up;
        var inc = [r];
        var i;
        for (i = 0; i < ADJ[r].length; i++) {
          inc.push(ADJ[r][i]);
          flushLink(LINKOF[r][ADJ[r][i]]);
        }
        /* A router that has failed forgets everything, and a router that
           has just come back has nothing to forget. Either way it starts
           from an empty table, which is what makes the recovery visible. */
        clearRouter(r);
        topologyChanged(inc);
        if (!quiet) sndCut();
        say('Router ' + NODES[r].name + (up
          ? ' is back, with an empty table to fill.'
          : ' has failed. Its links go with it.'));
      }

      /* ================================================================
         Shortest path over a graph, used three ways: to seed static
         routes, to compute a router's tree from its own link-state
         database, and to tell the panel what the ideal path would be.

         Returns distances and, for each destination, the SET of first hops
         that achieve it. The set is what makes equal-cost multipath
         possible; keeping only a winner throws the tie away.
         ================================================================ */
      function dijkstra(src, edge) {
        var dist = [];
        var hops = [];
        var done = [];
        var i, j, u, best;
        for (i = 0; i < N; i++) { dist[i] = Infinity; hops[i] = []; done[i] = false; }
        dist[src] = 0;
        for (i = 0; i < N; i++) {
          u = -1;
          best = Infinity;
          for (j = 0; j < N; j++) {
            if (!done[j] && dist[j] < best) { best = dist[j]; u = j; }
          }
          if (u < 0) break;
          done[u] = true;
          for (j = 0; j < N; j++) {
            var c = edge(u, j);
            if (c < 0) continue;
            var nd = dist[u] + c;
            if (nd > INF) continue;
            var fh = (u === src) ? [j] : hops[u];
            if (nd < dist[j]) {
              dist[j] = nd;
              hops[j] = fh.slice();
            } else if (nd === dist[j] && !done[j]) {
              /* An equal-cost arrival. Costs are all at least one, so
                 every predecessor at this distance has already been
                 finalised by the time j is popped, which is what makes
                 merging here safe rather than approximate. */
              var k;
              for (k = 0; k < fh.length; k++) {
                if (hops[j].indexOf(fh[k]) < 0) hops[j].push(fh[k]);
              }
            }
          }
        }
        return { dist: dist, hops: hops };
      }

      function trueEdge(i, j) {
        return usable(i, j) ? costOf(i, j) : -1;
      }

      /* ================================================================
         Static routes.
         ================================================================ */
      function seedStatic() {
        var r, d;
        for (r = 0; r < N; r++) {
          var sp = dijkstra(r, trueEdge);
          for (d = 0; d < N; d++) {
            staticNext[r][d] = (d === r || !sp.hops[d].length) ? -1 : sp.hops[d][0];
          }
        }
      }

      function cycleStatic(r) {
        var d = watch;
        if (d === r) {
          g.announce('Router ' + NODES[r].name + ' is the destination. A router does ' +
            'not forward to itself.');
          return;
        }
        var opts = ADJ[r].slice();
        opts.push(-1);
        var at = opts.indexOf(staticNext[r][d]);
        staticNext[r][d] = opts[(at + 1) % opts.length];
        lastChange = clock;
        var nx = staticNext[r][d];
        g.announce('Static route at ' + NODES[r].name + ' for ' + NODES[d].name +
          (nx < 0 ? ' removed. Packets for ' + NODES[d].name + ' will be dropped here.'
            : ' now points at ' + NODES[nx].name + '.'));
      }

      /* ================================================================
         Distance vector.
         ================================================================ */
      function clearDV(r) {
        var d;
        for (d = 0; d < N; d++) {
          dvT[r][d] = { m: INF, next: -1 };
          dvHops[r][d] = [];
          dvAge[r][d] = 0;
          lastVec[r][d] = null;
        }
        dvT[r][r] = { m: 0, next: -1 };
      }

      /* Before anything is exchanged: a route whose next hop is no longer
         reachable is worth nothing, and directly attached neighbours are
         re-learnt for free. This is the step that starts the count — E
         throws its route to G away here, and only then hears F offer the
         stale one back. */
      function dvInvalidate() {
        var r, d, i, n;
        for (r = 0; r < N; r++) {
          if (!nodeUp[r]) { clearDV(r); continue; }
          for (d = 0; d < N; d++) {
            var nx = dvT[r][d].next;
            if (nx >= 0 && !usable(r, nx)) { dvT[r][d].m = INF; dvT[r][d].next = -1; }
          }
          dvT[r][r] = { m: 0, next: -1 };
          for (i = 0; i < ADJ[r].length; i++) {
            n = ADJ[r][i];
            if (!usable(r, n)) continue;
            var c = costOf(r, n);
            if (c < dvT[r][n].m) { dvT[r][n] = { m: c, next: n }; }
          }
        }
      }

      function dvRound() {
        var r, d, i, n, msgs = [], changed = false;

        for (r = 0; r < N; r++) for (d = 0; d < N; d++) prevM[r][d] = dvT[r][d].m;

        dvInvalidate();

        /* Build one advertisement per neighbour, which is where split
           horizon lives: a route learned FROM this neighbour is either
           left out of the message entirely, or sent back with the metric
           set to infinity. The second is poison reverse, and it is the
           better of the two for exactly one reason — an omission cannot be
           distinguished from a message that never arrived. */
        for (r = 0; r < N; r++) {
          if (!nodeUp[r]) continue;
          for (i = 0; i < ADJ[r].length; i++) {
            n = ADJ[r][i];
            if (!usable(r, n)) continue;
            var vec = [];
            for (d = 0; d < N; d++) {
              var e = dvT[r][d];
              var m = e.m;
              if (splitH && e.next === n && m < INF) {
                if (poison) m = INF;
                else { vec[d] = -1; continue; }
              }
              vec[d] = m;
            }
            msgs.push({ from: r, to: n, cost: costOf(r, n), vec: vec });
          }
        }

        for (r = 0; r < N; r++) for (d = 0; d < N; d++) lastVec[r][d] = null;
        for (i = 0; i < msgs.length; i++) lastVec[msgs[i].to][msgs[i].from] = msgs[i].vec;

        /* PASS ONE — what the router you are already pointing at says.

           A report from your current next hop is believed whatever it says,
           including when it is worse than what you had. That is the rule
           that lets distance vector withdraw a route at all, and it is also
           the rule that lets it believe a lie.

           Saying NOTHING is the third case, and it is the one split horizon
           creates: the route is neither refreshed nor withdrawn, so all
           that can remove it is the expiry counter. Poison reverse turns
           that silence back into a statement. */
        var cand, ent, v, adv;
        for (r = 0; r < N; r++) {
          if (!nodeUp[r]) continue;
          for (d = 0; d < N; d++) {
            if (d === r) continue;
            ent = dvT[r][d];
            if (ent.next < 0) continue;
            v = lastVec[r][ent.next];
            adv = (v && v[d] >= 0) ? v[d] : -1;
            if (adv < 0) {
              dvAge[r][d]++;
              if (dvAge[r][d] > MAXAGE) {
                ent.m = INF;
                ent.next = -1;
                changed = true;
              }
              continue;
            }
            dvAge[r][d] = 0;
            cand = adv + costOf(r, ent.next);
            if (cand > INF) cand = INF;
            if (ent.m !== cand) { ent.m = cand; changed = true; }
            if (cand >= INF) ent.next = -1;
          }
        }

        /* PASS TWO — anybody with something better. Applied afterwards so a
           withdrawal arriving in the same round cannot bury a genuinely
           better path that arrived with it. */
        var msg;
        for (i = 0; i < msgs.length; i++) {
          msg = msgs[i];
          for (d = 0; d < N; d++) {
            if (d === msg.to) continue;
            if (msg.vec[d] < 0) continue;
            cand = msg.vec[d] + msg.cost;
            if (cand > INF) cand = INF;
            ent = dvT[msg.to][d];
            if (cand < ent.m) {
              ent.m = cand;
              ent.next = msg.from;
              dvAge[msg.to][d] = 0;
              changed = true;
            }
          }
        }

        /* The equal-cost set, recovered from what each neighbour actually
           advertised this round. A neighbour offering exactly the winning
           metric is a second next hop of the same cost, which is all
           equal-cost multipath ever means. */
        for (r = 0; r < N; r++) {
          for (d = 0; d < N; d++) {
            var hops = [];
            if (nodeUp[r] && dvT[r][d].m < INF && d !== r) {
              for (i = 0; i < ADJ[r].length; i++) {
                n = ADJ[r][i];
                if (!usable(r, n)) continue;
                var v = lastVec[r][n];
                if (!v || v[d] < 0) continue;
                if (v[d] + costOf(r, n) === dvT[r][d].m) hops.push(n);
              }
              if (!hops.length && dvT[r][d].next >= 0) hops.push(dvT[r][d].next);
            }
            dvHops[r][d] = hops;
          }
        }

        if (changed) lastChange = clock;
        detectCounting();
        round++;
        sndRound();
      }

      /* A real detector rather than a caption. A cycle in the next-hop graph
         for one destination is a routing loop; a metric that went UP this
         round on a router inside that cycle is the count. Anything meeting
         both is counting to infinity by definition, and it is the same test
         you would run against a real pair of table dumps.

         It walks the next hops rather than watching for the shape the
         textbook draws, because the loop this map produces is usually A and
         B rather than the two routers next to the failure — and a detector
         that only knew the drawing would have missed it. */
      function detectCounting() {
        var d, i, loop, rising, at;
        countingDst = -1;
        for (d = 0; d < N; d++) {
          loop = loopFor(d);
          if (!loop || loop.length < 3) continue;
          rising = false;
          for (i = 0; i < loop.length - 1; i++) {
            at = loop[i];
            if (dvT[at][d].m > prevM[at][d] && dvT[at][d].m < INF) rising = true;
          }
          if (!rising) continue;
          countingDst = d;
          if (!countingSaid) {
            countingSaid = true;
            var names = [];
            for (i = 0; i < loop.length; i++) names.push(NODES[loop[i]].name);
            say('Counting to infinity for ' + NODES[d].name + '. The next hops run ' +
              names.join(' to ') + ', so each router is adding the cost of a link to ' +
              'a metric it got from a router that got it from itself. It climbs every ' +
              'round until it reaches 16, and every packet for ' + NODES[d].name +
              ' goes round that ring until its hop count runs out.', 12);
          }
          return;
        }
      }

      /* ================================================================
         Link state.
         ================================================================ */
      function clearLS(r) {
        var i;
        lsdb[r] = [];
        for (i = 0; i < N; i++) lsdb[r][i] = null;
        for (i = 0; i < N; i++) { lsHops[r][i] = []; lsDist[r][i] = Infinity; }
        spfDue[r] = -1;
      }

      function originate(r) {
        if (!nodeUp[r]) return;
        var links = [];
        var i, n;
        for (i = 0; i < ADJ[r].length; i++) {
          n = ADJ[r][i];
          if (!usable(r, n)) continue;
          links.push({ to: n, cost: costOf(r, n) });
        }
        lsSeq[r]++;
        var lsa = { orig: r, seq: lsSeq[r], links: links };
        install(r, lsa, -1);
      }

      /* Install an advertisement in one router's database and pass it on to
         every neighbour except the one it arrived from. That last clause is
         the whole of flooding: no sequence of hops can send an
         advertisement back the way it came, and the sequence number stops
         it going round a cycle forever. */
      function install(at, lsa, from) {
        if (!nodeUp[at]) return;
        var have = lsdb[at][lsa.orig];
        if (have && have.seq >= lsa.seq) return;
        lsdb[at][lsa.orig] = lsa;
        if (spfDue[at] < 0) spfDue[at] = clock + SPF_DELAY;
        var i, n;
        for (i = 0; i < ADJ[at].length; i++) {
          n = ADJ[at][i];
          if (n === from || !usable(at, n)) continue;
          lsMsgs.push({
            lsa: lsa, to: n, from: at, link: LINKOF[at][n],
            due: clock + FLOOD_T, born: clock
          });
        }
      }

      /* The two-way check, and it is not a nicety. A router that has failed
         leaves its last advertisement behind in seven databases, still
         claiming two links. Its neighbours re-originate without it, so the
         claim is no longer mutual — and an edge only counts when BOTH ends
         say it exists. That is how real link-state routing survives a dead
         neighbour without needing anybody to delete anything. */
      function lsEdge(db) {
        return function (i, j) {
          var a = db[i];
          var b = db[j];
          if (!a || !b) return -1;
          var ci = -1, cj = -1, k;
          for (k = 0; k < a.links.length; k++) if (a.links[k].to === j) ci = a.links[k].cost;
          for (k = 0; k < b.links.length; k++) if (b.links[k].to === i) cj = b.links[k].cost;
          if (ci < 0 || cj < 0) return -1;
          return ci > cj ? ci : cj;
        };
      }

      function runSPF(r) {
        var sp = dijkstra(r, lsEdge(lsdb[r]));
        var d, moved = false;
        for (d = 0; d < N; d++) {
          if (lsDist[r][d] !== sp.dist[d] ||
              lsHops[r][d].join(',') !== sp.hops[d].join(',')) moved = true;
          lsDist[r][d] = sp.dist[d];
          lsHops[r][d] = sp.hops[d];
        }
        if (moved) lastChange = clock;
      }

      function stepLS(dt) {
        var i;
        for (i = lsMsgs.length - 1; i >= 0; i--) {
          if (clock < lsMsgs[i].due) continue;
          var m = lsMsgs[i];
          lsMsgs.splice(i, 1);
          if (!usable(m.from, m.to)) continue;
          install(m.to, m.lsa, m.from);
        }
        for (i = 0; i < N; i++) {
          if (spfDue[i] >= 0 && clock >= spfDue[i]) { spfDue[i] = -1; runSPF(i); }
        }
      }

      function lsdbSize(r) {
        var i, n = 0;
        for (i = 0; i < N; i++) if (lsdb[r][i]) n++;
        return n;
      }

      /* ================================================================
         Forwarding.
         ================================================================ */
      function clearRouter(r) {
        clearDV(r);
        clearLS(r);
        var d;
        for (d = 0; d < N; d++) staticNext[r][d] = -1;
      }

      function hopsFor(r, d) {
        if (proto === 'static') {
          return staticNext[r][d] >= 0 ? [staticNext[r][d]] : [];
        }
        if (proto === 'dv') return dvHops[r][d] || [];
        return lsHops[r][d] || [];
      }

      function metricFor(r, d) {
        if (proto === 'dv') return dvT[r][d].m;
        if (proto === 'ls') return lsDist[r][d];
        /* Static routing has no metric of its own. What it has is the cost
           of whatever path the player's next hops actually produce, walked
           here hop by hop, which is also how a loop is caught. */
        var seen = {};
        var at = r;
        var total = 0;
        var guard = 0;
        while (at !== d && guard < N + 2) {
          if (seen[at]) return Infinity;
          seen[at] = 1;
          var nx = staticNext[at][d];
          if (nx < 0 || !usable(at, nx)) return Infinity;
          total += costOf(at, nx);
          at = nx;
          guard++;
        }
        return at === d ? total : Infinity;
      }

      function routeOut(r, d) {
        var hops = hopsFor(r, d);
        if (!hops.length) return -1;
        if (!ecmp || hops.length === 1) return hops[0];
        var key = r * N + d;
        rrCount[key] = ((rrCount[key] || 0) + 1) % hops.length;
        return hops[rrCount[key]];
      }

      /* Walk the next hops for one destination and report a cycle. Works
         for all three protocols, because it reads the same tables the
         packets read rather than second-guessing the algorithm. */
      function loopFor(d) {
        var r, at, seen, guard, path;
        for (r = 0; r < N; r++) {
          if (!nodeUp[r] || r === d) continue;
          seen = {};
          path = [];
          at = r;
          guard = 0;
          while (at !== d && guard < N + 2) {
            if (seen[at]) {
              var cut = path.slice(path.indexOf(at));
              cut.push(at);
              return cut;
            }
            seen[at] = 1;
            path.push(at);
            var hops = hopsFor(at, d);
            if (!hops.length) break;
            at = hops[0];
            if (!nodeUp[at]) break;
            guard++;
          }
        }
        return null;
      }

      /* ================================================================
         Packets.
         ================================================================ */
      function drop(p, why) {
        dropped++;
        dropWhy[why] = (dropWhy[why] || 0) + 1;
        if (p.prio) prioDropped++;
        sndDrop();
      }

      function deliver(p) {
        delivered++;
        latList.push(clock - p.born);
        if (latList.length > 60) latList.shift();
        var i, s = 0;
        for (i = 0; i < latList.length; i++) s += latList[i];
        meanLat = s / latList.length;
        sndDeliver();
      }

      function enqueue(li, side, p) {
        var d = dirs[li][side];
        if (d.queue.length >= QMAX) {
          /* Drop tail, with one exception: a priority packet arriving at a
             full queue evicts the newest ordinary packet rather than being
             dropped itself. That is a crude stand-in for a real scheduler,
             and it is stated as crude on the page. */
          if (!p.prio) { drop(p, 'queue'); return; }
          var k;
          for (k = d.queue.length - 1; k >= 0; k--) {
            if (!d.queue[k].prio) { drop(d.queue[k], 'queue'); d.queue.splice(k, 1); break; }
          }
          if (d.queue.length >= QMAX) { drop(p, 'queue'); return; }
        }
        p.link = li;
        p.side = side;
        d.queue.push(p);
      }

      function arrive(p, at) {
        if (!nodeUp[at]) { drop(p, 'down'); return; }
        if (at === p.dst) { deliver(p); return; }
        p.ttl--;
        if (p.ttl <= 0) { drop(p, 'ttl'); return; }
        var nx = routeOut(at, p.dst);
        if (nx < 0) { drop(p, 'noroute'); return; }
        var li = LINKOF[at][nx];
        if (li < 0 || !linkUp[li] || !nodeUp[nx]) { drop(p, 'down'); return; }
        enqueue(li, LINKS[li].a === at ? 0 : 1, p);
      }

      function spawn(f) {
        var p = {
          id: packetId++, src: f.s, dst: f.d, prio: f.prio,
          born: clock, ttl: TTL0, link: -1, side: 0, prog: 0
        };
        arrive(p, f.s);
      }

      function stepFlows(dt) {
        var i;
        for (i = 0; i < level.flows.length; i++) {
          flowAcc[i] += flowRate[i] * dt;
          var guard = 0;
          while (flowAcc[i] >= 1 && guard < 40) {
            flowAcc[i] -= 1;
            spawn(level.flows[i]);
            guard++;
          }
        }
      }

      /* One transmitter per direction, accepting a packet every 1/CAP
         seconds. Time on the wire is a fixed setup plus the link's cost, so
         a longer link is a slower one and latency has something to do with
         the path chosen. */
      function flightTime(li) {
        return 0.22 + LINKS[li].cost * 0.05;
      }

      function stepLinks(dt) {
        var li, side, k;
        for (li = 0; li < L; li++) {
          for (side = 0; side < 2; side++) {
            var d = dirs[li][side];
            while (d.queue.length && clock >= d.free) {
              var p = d.queue.shift();
              p.prog = 0;
              d.flight.push(p);
              d.free = clock + 1 / CAP;
            }
            var ft = flightTime(li);
            for (k = d.flight.length - 1; k >= 0; k--) {
              var q = d.flight[k];
              q.prog += dt / ft;
              if (q.prog >= 1) {
                d.flight.splice(k, 1);
                arrive(q, side === 0 ? LINKS[li].b : LINKS[li].a);
              }
            }
          }
        }
      }

      function deepestQueue() {
        var li, side, worst = 0;
        for (li = 0; li < L; li++) {
          for (side = 0; side < 2; side++) {
            if (dirs[li][side].queue.length > worst) worst = dirs[li][side].queue.length;
          }
        }
        return worst;
      }

      function inFlight() {
        var li, side, n = 0;
        for (li = 0; li < L; li++) {
          for (side = 0; side < 2; side++) {
            n += dirs[li][side].flight.length + dirs[li][side].queue.length;
          }
        }
        return n;
      }

      /* ================================================================
         Score.
         ================================================================
         Delivered minus dropped, with a priority drop counted five times,
         all multiplied by ten so that up to nine points of latency bonus
         can only ever separate two runs that moved the same traffic. That
         is what "latency as a tiebreak" has to mean if it is not going to
         quietly become the thing being scored.
         ================================================================ */
      function netDelivered() {
        return delivered - dropped - prioDropped * 4;
      }

      function latPoints() {
        if (!latList.length) return 0;
        var pts = Math.round(9 - (meanLat - 0.8) * 6);
        if (pts < 0) pts = 0;
        if (pts > 9) pts = 9;
        return pts;
      }

      function scoreNow() {
        return netDelivered() * 10 + latPoints();
      }

      /* ================================================================
         Controls.
         ================================================================ */
      function setProto(p, quiet) {
        proto = p;
        var r;
        for (r = 0; r < N; r++) { clearDV(r); clearLS(r); }
        lsMsgs = [];
        round = 0;
        roundT = 0;
        lastChange = clock;
        lastTopo = clock;
        convergeSecs = -1;
        wasConverged = false;
        countingDst = -1;
        countingSaid = false;
        if (p === 'static') {
          seedStatic();
          lastTopo = -1;
        } else if (p === 'ls') {
          for (r = 0; r < N; r++) originate(r);
        } else {
          /* A router knows its own links the moment it boots, without
             asking anyone, so the direct entries are installed now rather
             than at the first exchange. The first exchange itself is
             brought forward to a quarter of a second, which is what a real
             implementation does too — RIP sends a triggered update when an
             interface comes up rather than waiting out the timer. */
          dvInvalidate();
          roundT = ROUND - 0.25;
        }
        syncButtons();
        if (quiet) return;
        if (p === 'dv') {
          g.announce('Distance vector. Every router starts knowing only itself and ' +
            'exchanges its whole table with its neighbours every two seconds.');
        } else if (p === 'ls') {
          g.announce('Link state. Every router floods a description of its own links, ' +
            'and each one runs shortest path first over the map it ends up with.');
        } else {
          g.announce('Static routes, seeded from the shortest paths so you start from ' +
            'something that works. Nothing will change them again but you.');
        }
      }

      function syncButtons() {
        if (splitBtn) {
          splitBtn.setAttribute('aria-pressed', String(splitH));
          splitBtn.disabled = proto !== 'dv';
        }
        if (poisonBtn) {
          poisonBtn.setAttribute('aria-pressed', String(poison));
          poisonBtn.disabled = proto !== 'dv' || !splitH;
        }
        if (ecmpBtn) ecmpBtn.setAttribute('aria-pressed', String(ecmp));
      }

      function actionText() {
        if (selIdx >= N) {
          var li = selIdx - N;
          return (linkUp[li] ? 'cut the ' : 'restore the ') + linkName(li) + ' link';
        }
        var r = selIdx;
        if (proto === 'static') {
          return 'change the next hop at ' + NODES[r].name + ' for ' + NODES[watch].name;
        }
        return (nodeUp[r] ? 'fail router ' : 'restart router ') + NODES[r].name;
      }

      function doAction() {
        if (selIdx >= N) {
          var li = selIdx - N;
          setLink(li, !linkUp[li]);
          return;
        }
        if (proto === 'static') { cycleStatic(selIdx); return; }
        setNode(selIdx, !nodeUp[selIdx]);
      }

      function announceSelection() {
        if (selIdx >= N) {
          var li = selIdx - N;
          g.announce('Link ' + linkName(li) + ', cost ' + LINKS[li].cost + ', ' +
            (linkUp[li] ? 'up' : 'cut') + '. Space to ' + actionText() + '.');
          return;
        }
        var r = selIdx;
        var m = metricFor(r, watch);
        var hops = hopsFor(r, watch);
        g.announce('Router ' + NODES[r].name + ', ' + (nodeUp[r] ? 'up' : 'down') +
          '. For ' + NODES[watch].name + ' it says ' +
          (hops.length ? 'next hop ' + NODES[hops[0]].name +
            (hops.length > 1 ? ' or ' + NODES[hops[1]].name : '') +
            ', metric ' + (m === Infinity || m >= INF ? 'unreachable' : m)
            : 'no route') +
          '. Space to ' + actionText() + '.');
      }

      function hitTest(x, y) {
        var i, best = -1, bestD = 1e9, d;
        for (i = 0; i < N; i++) {
          d = Math.sqrt((x - NODES[i].x) * (x - NODES[i].x) +
                        (y - NODES[i].y) * (y - NODES[i].y));
          if (d < 24 && d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) return best;
        for (i = 0; i < L; i++) {
          d = distToSeg(x, y, NODES[LINKS[i].a].x, NODES[LINKS[i].a].y,
                        NODES[LINKS[i].b].x, NODES[LINKS[i].b].y);
          if (d < 10 && d < bestD) { bestD = d; best = N + i; }
        }
        return best;
      }

      if (protoSel) protoSel.addEventListener('change', function () {
        setProto(protoSel.value);
      });

      if (levelSel) levelSel.addEventListener('change', function () {
        g.announce(levelSel.options[levelSel.selectedIndex].text +
          ' selected. It starts from the beginning.');
        g.start();
      });

      if (watchSel) watchSel.addEventListener('change', function () {
        watch = Number(watchSel.value) || 0;
        g.announce('Watching ' + NODES[watch].name +
          '. Every router now shows its next hop and metric for it.');
      });

      if (splitBtn) splitBtn.addEventListener('click', function () {
        splitH = !splitH;
        if (!splitH) poison = false;
        syncButtons();
        lastChange = clock;
        g.announce(splitH
          ? 'Split horizon on. A router no longer advertises a route back to the ' +
            'neighbour it learned that route from, which is what removes the ' +
            'two-router loop entirely.'
          : 'Split horizon off. Every router advertises everything to everyone, ' +
            'including back the way it came.');
      });

      if (poisonBtn) poisonBtn.addEventListener('click', function () {
        poison = !poison;
        syncButtons();
        g.announce(poison
          ? 'Poison reverse on. The route goes back to the neighbour it came from ' +
            'with the metric set to 16, so the withdrawal is stated rather than ' +
            'left to be inferred from a message that is not there.'
          : 'Poison reverse off. Split horizon now works by omission.');
      });

      if (ecmpBtn) ecmpBtn.addEventListener('click', function () {
        ecmp = !ecmp;
        syncButtons();
        g.announce(ecmp
          ? 'Multipath on. Where two next hops have the same cost, packets alternate ' +
            'between them. A real router would hash the flow so one connection keeps ' +
            'one path.'
          : 'Multipath off. A tie is broken the same way every time, so one path ' +
            'carries everything and the other sits idle.');
      });

      if (repairBtn) repairBtn.addEventListener('click', function () {
        var i, changed = false;
        for (i = 0; i < L; i++) if (!linkUp[i]) { linkUp[i] = true; changed = true; }
        for (i = 0; i < N; i++) if (!nodeUp[i]) { nodeUp[i] = true; clearRouter(i); changed = true; }
        if (!changed) { g.announce('Nothing is broken.'); return; }
        var all = [];
        for (i = 0; i < N; i++) all.push(i);
        topologyChanged(all);
        say('Everything is back up. Watch it reconverge.');
      });

      if (g.canvas) {
        /* First tap selects, second tap acts. The same two steps the arrow
           keys and Space give a keyboard, so nothing on this page can only
           be done with a pointer. */
        g.canvas.addEventListener('pointerdown', function (event) {
          var p = g.pointAt(event);
          if (p.x > PANEL_X) return;
          var hit = hitTest(p.x, p.y);
          if (hit < 0) return;
          if (hit === selIdx) doAction();
          else { selIdx = hit; announceSelection(); }
        });
      }

      /* ================================================================
         The script that breaks things on a timer.
         ================================================================ */
      function stepScript() {
        while (scriptAt < level.script.length && clock >= level.script[scriptAt].t) {
          var ev = level.script[scriptAt];
          scriptAt++;
          if (ev.cuts) {
            var c;
            for (c = 0; c < ev.cuts.length; c++) setLink(ev.cuts[c], false, true);
            sndCut();
          }
          if (ev.cut != null) { setLink(ev.cut, false, true); sndCut(); }
          if (ev.mend != null) { setLink(ev.mend, true, true); sndCut(); }
          if (ev.down != null) { setNode(ev.down, false, true); sndCut(); }
          if (ev.up != null) { setNode(ev.up, true, true); sndCut(); }
          if (ev.rate) {
            var i;
            for (i = 0; i < ev.rate.length && i < flowRate.length; i++) flowRate[i] = ev.rate[i];
          }
          if (ev.say) say(ev.say, 9);
        }
      }

      function finish() {
        if (ended) return;
        ended = true;
        if (level.demo) {
          g.over({
            won: true, score: 0, hideScore: true,
            title: 'Demonstration over',
            message: 'Nothing was scored. Turn split horizon on and run it again to ' +
              'watch the same cut converge in one round.'
          });
          return;
        }
        var sc = scoreNow();
        var won = sc >= target * 10;
        g.over({
          won: won,
          score: sc,
          title: won ? 'Scenario passed' : 'Scenario failed',
          message: (won ? 'Net delivered ' : 'Net delivered only ') + netDelivered() +
            ' against a target of ' + target + ', with ' + latPoints() +
            ' of a possible 9 points for latency. Dropped ' + dropped +
            (prioDropped ? ', of which ' + prioDropped + ' were priority packets' : '') + '.'
        });
      }

      /* ================================================================
         HUD.
         ================================================================ */
      function pushHud() {
        g.stat('deliv', delivered);
        g.stat('drop', dropped + (prioDropped ? ' (' + prioDropped + ' priority)' : ''));
        g.stat('lat', latList.length ? meanLat.toFixed(2) + ' s' : '—');
        /* A scenario with no target is not scored, and printing a zero in
           the score cell would be a claim about a run that is not being
           judged. The sandbox and the demonstration get a dash. */
        if (level.demo || !level.secs) g.stat('score', '—');
        else g.setScore(scoreNow());
      }

      /* ================================================================
         Drawing.
         ================================================================ */
      var COL_BG = '#020617';
      var COL_PANEL = '#0b1220';
      var COL_DIM = '#64748b';
      var COL_TEXT = '#e2e8f0';
      var COL_OK = '#4ade80';
      var COL_WARN = '#fbbf24';
      var COL_BAD = '#f87171';
      var COL_LINK = '#334155';
      var COL_ACCENT = '#38bdf8';

      function linkPos(li, t) {
        var a = NODES[LINKS[li].a];
        var b = NODES[LINKS[li].b];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }

      function utilisation(li) {
        var d0 = dirs[li][0];
        var d1 = dirs[li][1];
        var q = Math.max(d0.queue.length, d1.queue.length);
        return q / QMAX;
      }

      function drawLinks(ctx) {
        var i;
        for (i = 0; i < L; i++) {
          var a = NODES[LINKS[i].a];
          var b = NODES[LINKS[i].b];
          var sel = selIdx === N + i;
          var u = utilisation(i);

          ctx.save();
          if (!linkUp[i]) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#7f1d1d';
            ctx.lineWidth = 2;
          } else {
            ctx.strokeStyle = u > 0.7 ? COL_BAD : (u > 0.35 ? COL_WARN : COL_LINK);
            ctx.lineWidth = u > 0.35 ? 4 : 3;
          }
          if (sel) { ctx.lineWidth += 2; }
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();

          var mid = linkPos(i, 0.5);
          var dx = b.x - a.x;
          var dy = b.y - a.y;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var nx = -dy / len;
          var ny = dx / len;

          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (!linkUp[i]) {
            ctx.fillStyle = COL_BAD;
            ctx.fillText('cut', mid.x + nx * 11, mid.y + ny * 11);
          } else {
            ctx.fillStyle = sel ? COL_TEXT : COL_DIM;
            ctx.fillText(String(LINKS[i].cost), mid.x + nx * 11, mid.y + ny * 11);
          }

          /* Queue depth, drawn as a stack of ticks near the end that is
             doing the sending, and printed as a number as well — a bar on
             its own is a colour, and a colour on its own is not a fact. */
          var side;
          for (side = 0; side < 2; side++) {
            var q = dirs[i][side].queue.length;
            if (!q) continue;
            var at = linkPos(i, side === 0 ? 0.24 : 0.76);
            var k;
            for (k = 0; k < q && k < QMAX; k++) {
              ctx.fillStyle = q >= QMAX ? COL_BAD : (q > QMAX * 0.6 ? COL_WARN : COL_ACCENT);
              ctx.fillRect(at.x + nx * (4 + k * 2.2) - 1, at.y + ny * (4 + k * 2.2) - 1, 2.4, 2.4);
            }
            ctx.fillStyle = q >= QMAX ? COL_BAD : COL_DIM;
            ctx.font = '9px "Segoe UI", sans-serif';
            ctx.fillText(String(q), at.x - nx * 8, at.y - ny * 8);
          }
        }
      }

      function drawFloods(ctx) {
        if (proto !== 'ls') return;
        var i;
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 1.4;
        for (i = 0; i < lsMsgs.length; i++) {
          var m = lsMsgs[i];
          var t = 1 - (m.due - clock) / FLOOD_T;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          var fromA = LINKS[m.link].a === m.from;
          var p = linkPos(m.link, fromA ? t : 1 - t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      function drawPackets(ctx) {
        var li, side, k;
        for (li = 0; li < L; li++) {
          for (side = 0; side < 2; side++) {
            var d = dirs[li][side];
            for (k = 0; k < d.flight.length; k++) {
              var p = d.flight[k];
              var t = side === 0 ? p.prog : 1 - p.prog;
              var at = linkPos(li, t);
              var toWatch = p.dst === watch;
              if (p.prio) {
                /* A diamond with a ring. Priority is a shape here, not a
                   colour, so it survives being printed, being colour-blind
                   and being looked at on a bad screen. */
                ctx.save();
                ctx.translate(at.x, at.y);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = '#fde68a';
                ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
                ctx.restore();
                ctx.strokeStyle = '#fef3c7';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(at.x, at.y, 6, 0, Math.PI * 2);
                ctx.stroke();
              } else {
                ctx.fillStyle = toWatch ? COL_ACCENT : '#94a3b8';
                ctx.fillRect(at.x - 2.6, at.y - 2.6, 5.2, 5.2);
              }
            }
          }
        }
      }

      function drawNodes(ctx) {
        var i;
        for (i = 0; i < N; i++) {
          var n = NODES[i];
          var sel = selIdx === i;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 15, 0, Math.PI * 2);
          ctx.fillStyle = nodeUp[i] ? '#0f172a' : '#1c1917';
          ctx.fill();
          ctx.lineWidth = sel ? 3 : 2;
          ctx.strokeStyle = !nodeUp[i] ? COL_BAD : (sel ? COL_TEXT : COL_ACCENT);
          ctx.stroke();

          ctx.font = 'bold 13px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = nodeUp[i] ? COL_TEXT : COL_BAD;
          ctx.fillText(n.name, n.x, n.y);

          if (!nodeUp[i]) {
            ctx.strokeStyle = COL_BAD;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(n.x - 10, n.y - 10);
            ctx.lineTo(n.x + 10, n.y + 10);
            ctx.moveTo(n.x + 10, n.y - 10);
            ctx.lineTo(n.x - 10, n.y + 10);
            ctx.stroke();
            ctx.font = '9px "Segoe UI", sans-serif';
            ctx.fillStyle = COL_BAD;
            ctx.fillText('down', n.x, n.y + 26);
            continue;
          }

          /* What this router believes about the watched destination. The
             numbers on the map ARE the table entries; there is no second
             copy of the routing state anywhere in this file. */
          ctx.font = '9px "Segoe UI", sans-serif';
          var label;
          if (i === watch) {
            label = 'is ' + NODES[watch].name;
            ctx.fillStyle = COL_OK;
          } else {
            var m = metricFor(i, watch);
            var hops = hopsFor(i, watch);
            if (!hops.length || m === Infinity || m >= INF) {
              label = 'no route';
              ctx.fillStyle = COL_BAD;
            } else {
              label = NODES[hops[0]].name + (hops.length > 1 ? '+' + NODES[hops[1]].name : '') +
                ' · ' + m;
              ctx.fillStyle = countingDst === watch ? COL_WARN : COL_DIM;
            }
          }
          ctx.fillText(label, n.x, n.y + 26);

          if (proto === 'ls') {
            ctx.fillStyle = '#a78bfa';
            ctx.fillText(lsdbSize(i) + '/' + N, n.x, n.y - 25);
          }
        }
      }

      function drawBanner(ctx) {
        if (!banner || clock > bannerAt) return;
        ctx.save();
        var alpha = reduced ? 0.9 : 0.75 + 0.25 * Math.sin(clock * 4);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = countingDst >= 0 ? '#7c2d12' : '#0c4a6e';
        ctx.fillRect(8, 8, PANEL_X - 16, 40);
        ctx.globalAlpha = 1;
        ctx.fillStyle = COL_TEXT;
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        wrap(ctx, banner, 14, 13, PANEL_X - 28, 12);
        ctx.restore();
      }

      function drawLegend(ctx) {
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = COL_DIM;
        ctx.fillText('Under each router: its next hop for ' + NODES[watch].name +
          ' and the metric it believes.', 10, H - 22);
        ctx.fillText('Squares are packets, diamonds with a ring are priority. ' +
          'Ticks beside a link are its queue.', 10, H - 10);
      }

      function drawPanel(ctx) {
        var x = PANEL_X + 12;
        var maxw = W - x - 12;
        ctx.fillStyle = COL_PANEL;
        ctx.fillRect(PANEL_X, 0, W - PANEL_X, H);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(PANEL_X, 0, 1, H);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        var y = 24;
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillStyle = COL_TEXT;
        ctx.fillText(proto === 'dv' ? 'Distance vector'
          : (proto === 'ls' ? 'Link state' : 'Static routes'), x, y);

        y += 15;
        ctx.font = '10px "Segoe UI", sans-serif';
        var converged = (clock - lastChange) > QUIET;
        if (proto === 'static') {
          ctx.fillStyle = COL_DIM;
          ctx.fillText('No protocol running. Nothing updates itself.', x, y);
        } else {
          var tail = proto === 'dv'
            ? ' · round ' + round + ', next in ' + (ROUND - roundT).toFixed(1) + ' s'
            : ' · ' + lsMsgs.length + ' advertisements in flight';
          ctx.fillStyle = converged ? COL_OK : COL_WARN;
          ctx.fillText((converged ? 'Converged' : 'Converging') + tail, x, y);
        }

        y += 13;
        ctx.fillStyle = COL_DIM;
        if (convergeSecs >= 0) {
          ctx.fillText('Settled ' + convergeSecs.toFixed(1) + ' s after the change', x, y);
        } else if (lastTopo >= 0) {
          ctx.fillText('Unsettled for ' + (clock - lastTopo).toFixed(1) + ' s', x, y);
        } else {
          ctx.fillText('No change yet', x, y);
        }

        /* Scenario. */
        y += 20;
        ctx.fillStyle = COL_TEXT;
        ctx.font = 'bold 11px "Segoe UI", sans-serif';
        ctx.fillText(level.name, x, y);
        y += 13;
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillStyle = COL_DIM;
        if (level.secs) {
          var left = Math.max(0, level.secs - clock);
          ctx.fillText(left.toFixed(1) + ' s left' +
            (level.demo ? '' : ' · target ' + target), x, y);
        } else {
          ctx.fillText('No clock', x, y);
        }

        if (level.secs && !level.demo) {
          y += 8;
          var frac = target ? netDelivered() / target : 0;
          if (frac < 0) frac = 0;
          if (frac > 1) frac = 1;
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x, y, maxw, 5);
          ctx.fillStyle = frac >= 1 ? COL_OK : COL_ACCENT;
          ctx.fillRect(x, y, maxw * frac, 5);
          y += 5;
        }

        /* Counters. */
        y += 18;
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillStyle = COL_OK;
        ctx.fillText('Delivered ' + delivered, x, y);
        ctx.fillStyle = dropped ? COL_BAD : COL_DIM;
        ctx.fillText('Dropped ' + dropped, x + 106, y);
        y += 12;
        ctx.fillStyle = COL_DIM;
        ctx.fillText('no route ' + dropWhy.noroute + ' · loop ' + dropWhy.ttl +
          ' · full ' + dropWhy.queue + ' · down ' + dropWhy.down, x, y);
        y += 12;
        ctx.fillStyle = prioDropped ? COL_BAD : COL_DIM;
        ctx.fillText('priority dropped ' + prioDropped + ' · mean latency ' +
          (latList.length ? meanLat.toFixed(2) + ' s' : '—'), x, y);

        y += 12;
        ctx.fillStyle = COL_DIM;
        ctx.fillText('Net ' + netDelivered() + ' · best here ' +
          (levelBest ? levelBest : '—'), x, y);

        /* The selected router's table. */
        y += 20;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y - 8, maxw, 1);
        ctx.fillStyle = COL_TEXT;
        ctx.font = 'bold 11px "Segoe UI", sans-serif';
        if (selIdx < N) {
          ctx.fillText('Router ' + NODES[selIdx].name + ' — its table', x, y);
        } else {
          ctx.fillText('Link ' + linkName(selIdx - N), x, y);
        }

        y += 14;
        ctx.font = '10px "Segoe UI", sans-serif';
        if (selIdx < N) {
          var r = selIdx;
          ctx.fillStyle = COL_DIM;
          ctx.fillText('to', x, y);
          ctx.fillText('via', x + 32, y);
          ctx.fillText('metric', x + 92, y);
          y += 3;
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x, y, maxw, 1);
          y += 11;
          var d;
          for (d = 0; d < N; d++) {
            var hops = nodeUp[r] ? hopsFor(r, d) : [];
            var m = nodeUp[r] ? metricFor(r, d) : Infinity;
            ctx.fillStyle = d === watch ? COL_TEXT : COL_DIM;
            ctx.fillText(NODES[d].name, x, y);
            if (d === r) {
              ctx.fillStyle = COL_OK;
              ctx.fillText('direct', x + 32, y);
              ctx.fillText('0', x + 92, y);
            } else if (!hops.length || m === Infinity || m >= INF) {
              ctx.fillStyle = COL_BAD;
              ctx.fillText('none', x + 32, y);
              ctx.fillText(proto === 'dv' ? '16' : 'unreachable', x + 92, y);
            } else {
              ctx.fillStyle = hops.length > 1 && ecmp ? COL_ACCENT : COL_DIM;
              var via = NODES[hops[0]].name;
              if (hops.length > 1) via += ' + ' + NODES[hops[1]].name;
              ctx.fillText(via, x + 32, y);
              ctx.fillText(String(m), x + 92, y);
            }
            y += 12;
          }
        } else {
          var li = selIdx - N;
          ctx.fillStyle = linkUp[li] ? COL_DIM : COL_BAD;
          y += 4;
          ctx.fillText('cost ' + LINKS[li].cost + ' · ' +
            (linkUp[li] ? 'up' : 'cut'), x, y);
          y += 13;
          ctx.fillStyle = COL_DIM;
          ctx.fillText('queue ' + dirs[li][0].queue.length + ' one way, ' +
            dirs[li][1].queue.length + ' the other', x, y);
          y += 13;
          ctx.fillText('capacity ' + CAP + ' packets a second each way', x, y);
          y += 45;
        }

        /* WHERE THE TRAFFIC ACTUALLY IS, in words rather than in the width
           of a bar. The whole argument for equal-cost multipath is that a
           shortest-path table will happily fill one link while an equally
           short one beside it carries nothing, and that sentence is more
           use than the queue ticks on the map — those tell you a queue is
           deep, this tells you what is standing idle instead. Drawn from a
           fixed y so the block does not move about as the table above it
           changes height. */
        y = 300;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y - 10, maxw, 1);
        var worst = -1, worstQ = -1, ws = 0;
        var idle = [];
        var li2, side2;
        for (li2 = 0; li2 < L; li2++) {
          if (!linkUp[li2]) continue;
          var busy = false;
          for (side2 = 0; side2 < 2; side2++) {
            var dd = dirs[li2][side2];
            if (dd.queue.length > worstQ) { worstQ = dd.queue.length; worst = li2; ws = side2; }
            if (dd.queue.length || dd.flight.length) busy = true;
          }
          if (!busy) idle.push(linkName(li2));
        }
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillStyle = worstQ >= QMAX ? COL_BAD : COL_DIM;
        if (worst >= 0 && worstQ > 0) {
          var from = ws === 0 ? LINKS[worst].a : LINKS[worst].b;
          var to = ws === 0 ? LINKS[worst].b : LINKS[worst].a;
          ctx.fillText('Deepest queue ' + NODES[from].name + ' to ' + NODES[to].name +
            ': ' + worstQ + ' of ' + QMAX, x, y);
        } else {
          ctx.fillText('No queue anywhere', x, y);
        }
        y += 12;
        ctx.fillStyle = COL_DIM;
        y = wrap(ctx, idle.length
          ? 'Carrying nothing: ' + idle.slice(0, 3).join(', ') +
            (idle.length > 3 ? ' and ' + (idle.length - 3) + ' more' : '')
          : 'Every link is carrying something', x, y, maxw, 12);

        if (level.note) {
          y += 6;
          ctx.fillStyle = '#7c8da5';
          y = wrap(ctx, level.note, x, y, maxw, 12);
        }

        /* Loops, counting, and what Space would do. */
        y += 8;
        var loop = loopFor(watch);
        if (loop) {
          ctx.fillStyle = COL_BAD;
          var names = [];
          var q;
          for (q = 0; q < loop.length; q++) names.push(NODES[loop[q]].name);
          y = wrap(ctx, 'Loop for ' + NODES[watch].name + ': ' + names.join(' to ') +
            '. Packets go round until the hop count runs out.', x, y, maxw, 12);
        } else if (countingDst >= 0) {
          ctx.fillStyle = COL_WARN;
          y = wrap(ctx, 'The metric for ' + NODES[countingDst].name +
            ' is still climbing.', x, y, maxw, 12);
        }

        ctx.fillStyle = COL_DIM;
        ctx.font = '10px "Segoe UI", sans-serif';
        wrap(ctx, 'Space: ' + actionText() + '.', x, H - 40, maxw, 12);
      }

      /* ================================================================
         The shell hooks.
         ================================================================ */
      return {
        reset: function () {
          var i, r, d;

          if (levelSel) level = levelAt(levelSel.value);
          if (watchSel) watch = Number(watchSel.value) || 0;

          clock = 0;
          round = 0;
          roundT = 0;
          delivered = 0;
          dropped = 0;
          prioDropped = 0;
          dropWhy = { noroute: 0, ttl: 0, queue: 0, down: 0 };
          latList = [];
          meanLat = 0;
          packetId = 0;
          scriptAt = 0;
          ended = false;
          banner = '';
          bannerAt = -1;
          rrCount = [];

          for (i = 0; i < N; i++) nodeUp[i] = true;
          for (i = 0; i < L; i++) linkUp[i] = true;

          dirs = [];
          for (i = 0; i < L; i++) {
            dirs[i] = [
              { queue: [], flight: [], free: 0 },
              { queue: [], flight: [], free: 0 }
            ];
          }

          for (r = 0; r < N; r++) {
            dvT[r] = [];
            lastVec[r] = [];
            prevM[r] = [];
            dvHops[r] = [];
            dvAge[r] = [];
            lsHops[r] = [];
            lsDist[r] = [];
            staticNext[r] = [];
            lsSeq[r] = 0;
            for (d = 0; d < N; d++) prevM[r][d] = INF;
            clearRouter(r);
          }
          lsMsgs = [];

          flowAcc = [];
          flowRate = [];
          for (i = 0; i < level.flows.length; i++) {
            flowAcc[i] = 0;
            flowRate[i] = level.flows[i].rate;
          }

          offered = offeredBy(level);
          target = Math.round(offered * 0.7);
          levelBest = Number(g.load('best.' + level.id, 0)) || 0;

          setProto(protoSel ? protoSel.value : 'dv', true);
          lastChange = 0;
          lastTopo = 0;
          convergeSecs = -1;
          wasConverged = false;

          if (level.note) say(level.note, 10);
          pushHud();
          if (level.demo || !level.secs) g.stat('score', '—');
        },

        key: function (name) {
          if (name === 'left') {
            selIdx = (selIdx + N + L - 1) % (N + L);
            announceSelection();
          } else if (name === 'right') {
            selIdx = (selIdx + 1) % (N + L);
            announceSelection();
          } else if (name === 'up' || name === 'down') {
            watch = (watch + (name === 'up' ? N - 1 : 1)) % N;
            if (watchSel) watchSel.value = String(watch);
            g.announce('Watching ' + NODES[watch].name + '.');
          } else if (name === 'action') {
            doAction();
          }
        },

        update: function (dt) {
          clock += dt;

          if (proto === 'dv') {
            roundT += dt;
            if (roundT >= ROUND) { roundT -= ROUND; dvRound(); }
          } else if (proto === 'ls') {
            stepLS(dt);
          }

          /* Convergence is measured, not asserted: the stopwatch runs from
             the topology change to the last table that moved because of
             it. That is the number that makes link state look good and
             distance vector look slow, and it is the same number either
             way. */
          var converged = (clock - lastChange) > QUIET;
          if (converged && !wasConverged) {
            wasConverged = true;
            if (lastTopo >= 0) {
              convergeSecs = lastChange - lastTopo;
              if (convergeSecs > 0.05) {
                g.announce('Converged ' + convergeSecs.toFixed(1) +
                  ' seconds after the change.');
              }
            }
          } else if (!converged) {
            wasConverged = false;
          }

          stepScript();
          stepFlows(dt);
          stepLinks(dt);

          hudAcc += dt;
          if (hudAcc >= 0.25) { hudAcc = 0; pushHud(); }

          /* The bed five times a second. Every set() below ends in a ramp,
             and scheduling those at frame rate costs more than the network
             they describe while sounding identical. */
          sndAcc += dt;
          if (sndAcc >= 0.2) {
            sndAcc = 0;
            net.set('load', inFlight() / 26);
            net.set('churn', (clock - lastChange) > QUIET ? 0 : 1);
            net.set('jam', deepestQueue() / QMAX);
          }

          if (level.secs && clock >= level.secs && !ended) {
            if (!level.demo && scoreNow() > levelBest) {
              levelBest = scoreNow();
              g.save('best.' + level.id, levelBest);
            }
            finish();
          }
        },

        draw: function (ctx) {
          ctx.fillStyle = COL_BG;
          ctx.fillRect(0, 0, W, H);

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, PANEL_X, H);
          ctx.clip();
          drawLinks(ctx);
          drawFloods(ctx);
          drawPackets(ctx);
          drawNodes(ctx);
          drawLegend(ctx);
          drawBanner(ctx);
          ctx.restore();

          drawPanel(ctx);
        },

        ready: function () {
          if (g.canvas) {
            g.canvas.setAttribute('aria-label',
              'A network of seven routers and eight links. Select a router or a link ' +
              'with the left and right arrows, change the destination being watched ' +
              'with the up and down arrows, and press Space to cut, fail or reroute. ' +
              'The panel reads out every routing table.');
          }
          syncButtons();
        }
      };
    }
  });
})();

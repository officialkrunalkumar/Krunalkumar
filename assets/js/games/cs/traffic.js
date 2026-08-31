/* ==========================================================================
   traffic.js — a four-way junction as four locks, and what happens when
   nobody agrees on the order to take them in.
   --------------------------------------------------------------------------
   THE BOX IS FOUR LOCKS, NOT ONE. That is the entire model, and everything
   else in this file follows from it.

   Split the junction box into its four quadrants and number them clockwise
   from the north-east: NE=0, SE=1, SW=2, NW=3. Now drive on the right, the
   way most of the world does, and take the four straight-through movements
   one at a time:

     a car from the NORTH keeps to the east half going down    NE then SE
     a car from the EAST  keeps to the south half going west   SE then SW
     a car from the SOUTH keeps to the west half going up      SW then NW
     a car from the WEST  keeps to the north half going east   NW then NE

   Number the approaches the same way — North=0, East=1, South=2, West=3 —
   and every one of those reads as "quadrant a, then quadrant a+1 mod 4".
   That is not a convenience the file invented to make a nice demo. It falls
   out of the geometry, and it is why a real junction gridlocks: four
   drivers, four resources, each holding one and wanting the next, in a ring.
   Rename the cars P1..P4 and the quadrants R1..R4 and you have the deadlock
   diagram out of any operating-systems course, drawn to scale in tarmac.

   So the four control strategies here are four lock disciplines:

     UNCONTROLLED   incremental acquisition with no ordering. Take the first
                    quadrant, drive into it, then ask for the second while
                    still holding the first. Hold-and-wait, plus the ring
                    above, and deadlock is not a risk — it is a matter of
                    time. The panel names the four Coffman conditions as
                    they light up.

     TRAFFIC LIGHTS a fixed-cycle mutex, and the reason it is safe is worth
                    stating precisely because it is not the reason people
                    assume. The light does not detect anything. It gives
                    green only to opposite approaches — North with South, or
                    East with West — and those two movements use DISJOINT
                    quadrant sets ({0,1} against {2,3}, {1,2} against {3,0}).
                    A phase that cannot produce a conflict cannot produce a
                    deadlock. What it costs is that green arrives on a timer
                    rather than on demand, so an approach can starve behind
                    an empty one. Turn its arrival rate up and the green time
                    down and you can watch its max wait run away.

     FOUR-WAY STOP  a ticket lock. Every car stops, takes a number as it
                    reaches the line, and crosses when its number comes up.
                    Strict FCFS, bounded waiting, no starvation possible —
                    and the whole box serialised to one car at a time, which
                    is exactly the throughput you are paying for the
                    fairness with.

     ROUNDABOUT     optimistic, lock-free. A car takes a quadrant if it is
                    free and ROLLS BACK if the next one is not, rather than
                    sitting on what it holds. Nothing ever holds while
                    waiting, so deadlock is impossible. Livelock is not: four
                    cars can nose in, conflict, reverse out and retry in
                    lockstep forever, changing state the whole time and
                    getting nowhere. The backoff here is deliberately fixed
                    rather than randomised, because randomised exponential
                    backoff is the standard fix and a toy that shipped the
                    fix could never show the failure. The only thing that
                    breaks the lockstep is that no two drivers are quite the
                    same speed — see the jitter in spawn().

   DEADLOCK IS DETECTED, NOT GUESSED. Every frame the four quadrant owners
   are walked as a wait-for graph: car -> the car holding the quadrant it
   wants -> and so on. A cycle is a deadlock. That is the same algorithm an
   OS uses on its own wait-for graph, it costs four short walks over at most
   four nodes, and it means the counter cannot be fooled by a junction that
   merely looks jammed.

   BREAKING IT. Two ways, and they are the two the textbook offers:

     - PREVENTION, from the "Deny hold-and-wait" button: a car must take
       both of its quadrants in one atomic step or stay outside the box.
       Coffman condition two is denied, so no cycle can form at all.
     - RECOVERY, from "Clear the jam": pick the car that has been blocked
       longest, reverse it out, release its lock. That is victim selection
       and rollback, and it works by breaking condition three — the one the
       deadlock relied on being impossible.

   THE SOUND is a condition rather than a sequence, so it is a bed: filtered
   noise whose brightness and level follow how much of the traffic is
   actually moving, with a pair of detuned low oscillators underneath that
   are silent while things flow and swell when the junction locks. A jam you
   can hear coming is the point. One-shots are kept for events that really
   are events — a car clearing the box, the lights changing, a car aborting
   out of the roundabout — and every one of them is gated, because forty
   crossings a minute at four approaches is more ticks than an ear wants.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 440;

  /* Everything left of this is junction; everything right of it is the
     panel. The junction is clipped to it so a car driving off the map
     cannot scribble over the statistics. */
  var PANEL_X = 400;

  var CX = 196;                 // centre of the junction
  var CY = 220;
  var LANE = 30;                // one lane wide; the box is 2*LANE square

  var CARLEN = 22;
  var CARW = 13;
  var GAP = 27;                 // nose-to-nose spacing in a stationary queue

  /* How many cars an approach will hold before it starts turning them away.
     Twenty-four, not the six that fit on the visible run-in: the queue is
     allowed to back up off the map, which is what a queue that has reached
     the previous junction actually does, and the clip in draw() means those
     cars simply are not drawn. Capping it at what fits on screen was the
     first version and it was quietly dishonest — max wait is the starvation
     signal this page is selling, and a queue short enough to be drawn puts a
     ceiling on the wait that has nothing to do with the control strategy. */
  var MAXQ = 24;
  var V = 52;                   // free-running speed, pixels a second

  /* How far into the box each boundary is, measured along the car's own
     path from the stop line. A car needs its first quadrant to pass BOUND1
     and its second to pass BOUND2. */
  var BOUND1 = LANE;
  var BOUND2 = LANE * 2;

  /* North, East, South, West — and the whole trick of this file is that
     approach a needs quadrant a and then quadrant (a+1) % 4. */
  var NAMES = ['North', 'East', 'South', 'West'];
  var COLS = ['#38bdf8', '#fbbf24', '#34d399', '#f472b6'];
  var DIRX = [0, -1, 0, 1];
  var DIRY = [1, 0, -1, 0];

  /* Where s = 0 sits for each approach: the stop line, on the box edge, in
     the right-hand lane of that approach. */
  var OX = [CX + LANE / 2, CX + LANE, CX - LANE / 2, CX - LANE];
  var OY = [CY - LANE, CY + LANE / 2, CY + LANE, CY - LANE / 2];

  /* s at the edge of the canvas, so a new car drives in from off the map
     rather than appearing in mid-road. Different per approach because the
     panel makes the eastern run-in shorter than the northern one. */
  var SPAWN = [-CY + LANE, -(PANEL_X - CX - LANE), -(H - CY - LANE), -(CX - LANE)];

  /* Quadrant centres, clockwise from the north-east, and the labels drawn
     on them. Index matches the lock table. */
  var QX = [CX + LANE / 2, CX + LANE / 2, CX - LANE / 2, CX - LANE / 2];
  var QY = [CY - LANE / 2, CY + LANE / 2, CY + LANE / 2, CY - LANE / 2];
  var QNAME = ['NE', 'SE', 'SW', 'NW'];

  /* Seconds a car must be stationary at a four-way stop before it may go.
     Real stop signs ask for three; three seconds here would make the scheme
     look like a bug rather than like a trade-off, and the point being made
     is about serialisation, not about the dwell. */
  var STOP_DWELL = 0.6;

  /* Amber between phases. A clearance interval exists so the box empties
     before the conflicting phase is released — it is the memory barrier of
     a signal plan, and without it the lights would be no safer than no
     control at all for the first second of every change. */
  var AMBER = 1.6;

  /* How long a car sits reversed out of the roundabout before it tries
     again. FIXED, not randomised, and that is deliberate: see the header. */
  var BACKOFF = 0.5;

  /* A deadlock left alone clears itself after this long. The visitor is
     meant to clear it themselves — that button is half the lesson — but a
     page left open on a locked junction should not still be locked when
     somebody comes back to it. Long enough to read the whole panel twice. */
  var DEADLOCK_HOLD = 16;

  function fmt1(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  GameShell.define({
    id: 'game-traffic',
    slug: 'traffic',
    title: 'Traffic',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      /* Asked once. A visitor who has told their operating system they do
         not want movement has told every page on it. Here it slows the
         simulation and stills the pulse on the jam banner; it does not
         remove anything, because the moving cars ARE the explanation. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var scheme = 'none';
      var denyHW = false;
      var rates = [22, 22, 22, 22];   // cars a minute, per approach
      var greenTime = 9;

      /* THE LOCK TABLE. quads[q] is the car holding that quadrant, or null.
         Four slots, and every rule in this file is about who may write to
         one of them. */
      var quads = [null, null, null, null];

      var queues = [[], [], [], []];
      var clock = 0;

      /* STATISTICS OVER A ROLLING THIRTY SECONDS, not over the whole run.

         The first version averaged from the start, and it made the page
         almost unusable for the thing the page is for: drag the green time
         down, and the number you are watching is still mostly made of the
         two minutes before you touched it. Half a minute is long enough
         that the figure is not jittering on individual cars and short
         enough that a control change shows up while your hand is still on
         it. Max wait is windowed for the same reason and one more: a max
         over the whole run can only ever go up, so fixing a starving arm
         would leave the starvation signal stuck on, which is a worse lie
         than a slow one.

         One entry per car that has got through, holding when it crossed,
         which arm it came from and how long it waited. Per approach,
         because the aggregate is exactly what hides a fixed cycle doing
         something dreadful to one arm of the junction. */
      var WINDOW = 30;
      var log = [];
      var statN = [0, 0, 0, 0];
      var statSum = [0, 0, 0, 0];
      var statMax = [0, 0, 0, 0];
      var thruPerMin = 0;
      var turned = [0, 0, 0, 0];
      var crossed = 0;
      var deadlocks = 0;
      var livelocks = 0;
      var preempts = 0;

      var status = 'run';             // run | dead | live
      var deadSince = -1;
      var lastCross = 0;
      var retryRate = 0;              // roundabout aborts a second, smoothed
      var retries = 0;
      var preemptFlash = -1;          // clock time of the last rollback

      /* Signals. phase 0 = North/South green, 2 = East/West green; the odd
         numbers are the amber between them. */
      var phase = 0;
      var phaseT = 0;

      /* The ticket lock, used only by the four-way stop. `next` is the
         number handed out at the line, `serving` the number allowed to
         cross. Nothing else in the file may touch them. */
      var nextTicket = 1;
      var serving = 1;

      var hudAcc = 0;
      var sndAcc = 0;
      var speedSum = 0;
      var speedCars = 0;

      /* Frame cost, exponentially smoothed, measured around draw() only —
         the simulation is a few hundred arithmetic operations and has never
         been the expensive half. Past LITE_MS the car detailing and the
         quadrant gradients come off; under EASY_MS they go back on. The two
         thresholds are apart on purpose, because a single one makes a
         machine sitting on the boundary flicker between the two looks. */
      var LITE_MS = 7.5;
      var EASY_MS = 4.5;
      var frameMs = 0;
      var lite = false;

      var schemeSel = document.getElementById('game-scheme');
      var greenIn = document.getElementById('game-green');
      var hwBtn = document.getElementById('game-holdwait');
      var preemptBtn = document.getElementById('game-preempt');
      var rateIns = [
        document.getElementById('game-north'),
        document.getElementById('game-east'),
        document.getElementById('game-south'),
        document.getElementById('game-west')
      ];

      /* ---------------------------------------------------------------
         The sound of a road.

         A junction is a condition, not a sequence of events, so the bulk
         of it is a bed. Two layers, and the second one is the reason the
         bed exists at all: the ROAR is filtered noise steered by how much
         of the traffic is actually moving, and the JAM is a pair of low
         triangles a few hertz apart that sit at zero gain while things
         flow. When the junction locks, the roar closes down and the jam
         comes up, so a deadlock is audible before you have finished
         reading the panel that names it.

         The two oscillators are 78 and 82.5 Hz. That interval beats about
         four and a half times a second, which is fast enough to be heard
         as roughness rather than as a wobble — the sound of something
         wrong, which is what it is being asked to mean.
         --------------------------------------------------------------- */
      var road = g.bed(function (a) {
        var ctx = a.ctx;

        var tyres = ctx.createBufferSource();
        tyres.buffer = a.noise();
        tyres.loop = true;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        /* Low Q. Anything resonant here stops being tyres on tarmac and
           starts being wind in a pipe, and the ear places it outdoors
           either way — but only one of the two sounds like a road. */
        lp.Q.value = 0.7;
        lp.frequency.value = 420;
        var roar = ctx.createGain();
        roar.gain.value = 0.010;
        tyres.connect(lp);
        lp.connect(roar);
        roar.connect(a.out);
        tyres.start();

        var jam = ctx.createGain();
        jam.gain.value = 0;
        jam.connect(a.out);
        function low(hz) {
          var o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = hz;
          o.connect(jam);
          o.start();
          return o;
        }
        low(78);
        low(82.5);

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Longer than the gap between two recomputes so consecutive
             ramps overlap — the same reason boids does it. A ramp that
             lands early leaves the parameter sitting still, and traffic
             thinning out then reads as five steps rather than as a fade. */
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.35 : secs));
        }

        return {
          set: function (key, value) {
            if (key === 'flow') {
              /* 0 is a junction where nothing is moving, 1 is everything
                 at speed. Both ends of the roar follow it: moving traffic
                 is brighter as well as louder, and lifting the gain alone
                 gives a road that comes closer rather than one that runs. */
              var k = value < 0 ? 0 : (value > 1 ? 1 : value);
              ramp(lp.frequency, 300 + k * 1250);
              ramp(roar.gain, 0.005 + k * 0.026);
              return;
            }
            if (key === 'jam') {
              var j = value < 0 ? 0 : (value > 1 ? 1 : value);
              /* Slower than the roar. A jam settling in is not an event,
                 and a beat pattern brought up quickly is heard as a note
                 rather than as a mood. */
              ramp(jam.gain, j * 0.011, 0.9);
            }
          }
        };
      });

      /* ---------------------------------------------------------------
         One-shots, all gated. Four approaches at forty cars a minute is
         nearly three crossings a second, and a tick for each is a
         woodpecker rather than a road.
         --------------------------------------------------------------- */
      function sndCross() {
        if (!g.gate('cross', 0.14)) return;
        g.noise(0.10, { type: 'bandpass', freq: 900, to: 380, q: 0.9, level: 0.030 });
      }

      function sndHorn() {
        /* Two sawtooths a semitone apart, held. A car horn is not a beep,
           it is two reeds disagreeing, and the disagreement is the entire
           character — a single tone here reads as a UI error sound. */
        g.beep(392, 0.55, 'sawtooth', 0.045);
        g.beep(415, 0.55, 'sawtooth', 0.040);
      }

      function sndSignal() {
        g.beep(880, 0.05, 'sine', 0.030);
      }

      function sndAbort() {
        if (!g.gate('abort', 0.20)) return;
        g.beep(240, 0.06, 'square', 0.022);
      }

      /* ---------------------------------------------------------------
         Cars.
         --------------------------------------------------------------- */
      function spawn(a) {
        if (queues[a].length >= MAXQ) {
          /* A bounded queue, and the count is shown. An approach that is
             turning cars away has already failed, and hiding that behind
             an unbounded array would make the mean wait look better the
             worse the junction got. */
          turned[a]++;
          return;
        }
        var back = queues[a].length ? queues[a][queues[a].length - 1].s - GAP : 0;
        var s = SPAWN[a];
        if (s > back - GAP) s = back - GAP;
        queues[a].push({
          a: a,
          s: s,
          /* Three per cent either way. Not decoration: it is the only
             asymmetry in the model, and it is what eventually breaks a
             roundabout livelock. Real drivers differ by far more. */
          v: V * (0.97 + Math.random() * 0.06),
          born: clock,
          entered: -1,
          hold1: false,
          hold2: false,
          done: false,
          want: -1,
          blockedSince: -1,
          ticket: 0,
          dwell: 0,
          /* `retreat` is the abort, `backoff` is how long before it may try
             again. They are two facts and not one: the car is still rolling
             out of the box for most of a second after the abort, and reading
             the retreat off the backoff timer alone made a car re-request
             the quadrant it was halfway out of, once a frame. */
          retreat: false,
          backoff: 0,
          /* How many times this car has taken a quadrant, failed to get
             the next, and rolled back out. It is the livelock counter: a
             car with five of these is not stuck, it is working hard and
             getting nowhere, which is the distinction the whole roundabout
             section exists to draw. */
          aborts: 0
        });
      }

      function q1of(c) { return c.a; }
      function q2of(c) { return (c.a + 1) % 4; }

      function greenFor(a) {
        if (phase === 0) return a === 0 || a === 2;
        if (phase === 2) return a === 1 || a === 3;
        return false;                 // amber: the box is being cleared
      }

      /* Whether this car is allowed to begin taking locks at all. The lock
         protocol below is the same for every scheme; this is the only place
         the four of them differ about who may try. */
      function mayAttempt(c) {
        if (scheme === 'lights') return greenFor(c.a);
        if (scheme === 'stop') return c.dwell >= STOP_DWELL && c.ticket === serving;
        return true;
      }

      function free(q, c) {
        return quads[q] === null || quads[q] === c;
      }

      /* How far along its path this car is allowed to be, given the locks
         alone. The car ahead is a separate limit, applied by the caller.

         This is the heart of the file: acquisition is explicit and happens
         here, release is geometric and happens in releasePass(). A car that
         is not yet at the line may drive up to the line and no further —
         claiming the box from sixty pixels back would be a lock taken by a
         process that has not reached its critical section. */
      function lockLimit(c) {
        var qa = q1of(c);
        var qb = q2of(c);

        /* Already through and holding nothing. Without this the four-way
           stop asked whether a car that had finished was allowed to start,
           found that its ticket had been retired, and reversed it back to
           the line it had just left. */
        if (c.done) return 1e5;

        if (c.hold2) { c.want = -1; return 1e5; }

        if (c.hold1) {
          if (c.retreat) return -6;
          if (free(qb, c)) {
            quads[qb] = c;
            c.hold2 = true;
            c.want = -1;
            c.blockedSince = -1;
            return 1e5;
          }
          /* HOLD AND WAIT, drawn to scale. The car is inside the box on
             one quadrant and cannot leave without the next one, which
             somebody else has. Everything that goes wrong on this page
             goes wrong here. */
          if (c.want !== qb) { c.want = qb; c.blockedSince = clock; }
          if (scheme === 'circle' && !denyHW) {
            /* The lock-free answer: do not sit on it. Abort, reverse out,
               and try again. The quadrant is not released here — it is
               released by the geometry once the car is physically clear,
               which is both what a driver would do and what stops two
               cars occupying the same square while one of them backs up. */
            c.retreat = true;
            c.backoff = BACKOFF;
            c.aborts++;
            retries++;
            retryRate += 1;
            sndAbort();
            return -6;
          }
          return BOUND1;
        }

        /* Out of the box and serving its backoff. Reaching here means the
           geometry has already taken the quadrant back. */
        if (c.retreat) {
          if (c.backoff > 0) return -6;
          c.retreat = false;
        }

        /* Not at the line yet: drive up to it, take nothing. */
        if (c.s < -1.5) return 0;

        if (!mayAttempt(c)) { c.want = -1; return 0; }

        if (denyHW || scheme === 'stop') {
          /* PREVENTION. Both quadrants in one atomic step, or nothing at
             all — the car stays outside the box, holding no lock, so
             there is nothing for a cycle to be made of. The four-way stop
             takes the same path because a ticket lock that let two cars
             into the box at once would not be a ticket lock. */
          if (free(qa, c) && free(qb, c)) {
            quads[qa] = c;
            quads[qb] = c;
            c.hold1 = true;
            c.hold2 = true;
            c.want = -1;
            c.blockedSince = -1;
            return 1e5;
          }
          if (c.want < 0) { c.want = free(qa, c) ? qb : qa; c.blockedSince = clock; }
          return 0;
        }

        if (free(qa, c)) {
          quads[qa] = c;
          c.hold1 = true;
          c.want = -1;
          c.blockedSince = -1;
          /* Into the first quadrant and no further. The second one has to
             be asked for separately, from inside the box, which is the
             whole difference between this and the branch above. */
          return BOUND1;
        }
        if (c.want !== qa) { c.want = qa; c.blockedSince = clock; }
        return 0;
      }

      /* Locks come back by geometry rather than by a flag somebody has to
         remember to clear. A quadrant is held from the moment it was
         acquired until the car is physically out of it — forwards, having
         crossed, or backwards, having aborted. */
      function releasePass() {
        for (var a = 0; a < 4; a++) {
          var list = queues[a];
          for (var i = 0; i < list.length; i++) {
            var c = list[i];
            var nose = c.s;
            var tail = c.s - CARLEN;
            if (c.hold1 && (tail >= BOUND1 || nose <= 0)) {
              if (quads[q1of(c)] === c) quads[q1of(c)] = null;
              c.hold1 = false;
            }
            if (c.hold2 && tail >= BOUND2) {
              if (quads[q2of(c)] === c) quads[q2of(c)] = null;
              c.hold2 = false;
              c.done = true;
              crossed++;
              lastCross = clock;
              /* Logged on the way OUT, carrying the wait that was measured
                 on the way in. A car that spent forty seconds in a gridlock
                 belongs in the window at the moment it escapes it, not at
                 the moment it gave up hope. */
              log.push({ t: clock, a: c.a, w: c.entered >= 0 ? c.entered - c.born : 0 });
              sndCross();
              /* The ticket lock's release, and the only place serving is
                 advanced. A car that never took a ticket cannot be in the
                 box under this scheme, so no test is needed. */
              if (scheme === 'stop' && c.ticket === serving) serving++;
            }
          }
        }
      }

      /* THE WAIT-FOR GRAPH. Nodes are the cars holding a quadrant, and
         there are never more than four of them; an edge goes from a
         blocked car to whoever holds what it is waiting for. A cycle is a
         deadlock, by definition rather than by symptom, which is why this
         cannot be fooled by a junction that merely looks jammed.

         Walking from each of the four owners with a hop limit is enough
         at this size: there is no need for the colouring an OS uses on a
         graph with thousands of nodes in it. */
      function cycleFound() {
        for (var i = 0; i < 4; i++) {
          var start = quads[i];
          if (!start) continue;
          var cur = start;
          var hops = 0;
          while (hops < 5) {
            if (cur.want < 0 || cur.hold2) break;
            var owner = quads[cur.want];
            if (!owner || owner === cur) break;
            if (owner === start) return true;
            cur = owner;
            hops++;
          }
        }
        return false;
      }

      /* RECOVERY: pick a victim, roll it back, break the ring. The victim
         is whichever blocked car has been blocked longest, which is the
         same heuristic a database picks its deadlock victim with — the
         oldest waiter has already paid the most, so aborting it is the
         choice that wastes the least work of anyone else's. */
      function preempt() {
        var victim = null;
        for (var i = 0; i < 4; i++) {
          var c = quads[i];
          if (!c || c.blockedSince < 0 || c.hold2) continue;
          if (!victim || c.blockedSince < victim.blockedSince) victim = c;
        }
        if (!victim) {
          g.announce('Nothing is blocked. There is no jam to clear.');
          return;
        }
        victim.retreat = true;
        victim.backoff = BACKOFF * 2;
        victim.want = -1;
        victim.blockedSince = -1;
        preempts++;
        preemptFlash = clock;
        status = 'run';
        deadSince = -1;
        g.beep(523, 0.09, 'sine', 0.04);
        g.beep(784, 0.12, 'sine', 0.035);
        g.announce('Preemption: the ' + NAMES[victim.a].toLowerCase() +
          ' car is reversed out and its quadrant released. That breaks the third ' +
          'Coffman condition, and with it the cycle.');
      }

      function resetStats() {
        for (var i = 0; i < 4; i++) {
          statN[i] = 0; statSum[i] = 0; statMax[i] = 0; turned[i] = 0;
        }
        log = [];
        thruPerMin = 0;
        crossed = 0;
        deadlocks = 0;
        livelocks = 0;
        preempts = 0;
        retries = 0;
        retryRate = 0;
        clock = 0;
        lastCross = 0;
        status = 'run';
        deadSince = -1;
        /* Cleared with everything else because the clock goes back to zero
           here. A stamp of 80 left over from the previous scheme would sit
           two and a half MINUTES in the future of the new one, and the
           panel would claim a preemption had just happened for every one of
           them. Every timestamp in this file is relative to `clock`, so
           every timestamp has to be dropped when `clock` is. */
        preemptFlash = -1;
      }

      function syncHW() {
        if (!hwBtn) return;
        hwBtn.setAttribute('aria-pressed', String(denyHW));
        hwBtn.title = denyHW
          ? 'Hold-and-wait denied: a car takes both quadrants at once or waits outside'
          : 'Deny hold-and-wait: make cars take both quadrants at once';
      }

      function setScheme(value) {
        /* Anything that is not one of the four falls back rather than
           leaving `scheme` naming a strategy no branch implements — which
           would be a junction with no rules at all wearing a label. */
        scheme = SCHEME_NOTE[value] ? value : 'none';
        /* Every lock is dropped and every car is thrown away. Changing the
           discipline under a junction that is mid-crossing would leave
           cars holding quadrants under rules that never granted them, and
           the statistics either side of the change would be a mixture of
           two schemes reported as one number — which is exactly the
           comparison this page exists to make honestly. */
        for (var q = 0; q < 4; q++) quads[q] = null;
        for (var a = 0; a < 4; a++) queues[a] = [];
        nextTicket = 1;
        serving = 1;
        phase = 0;
        phaseT = 0;
        resetStats();
      }

      if (schemeSel) schemeSel.addEventListener('change', function () {
        setScheme(schemeSel.value);
        g.announce(schemeSel.options[schemeSel.selectedIndex].text +
          '. Counters reset, so the comparison is clean.');
      });

      if (greenIn) greenIn.addEventListener('input', function () {
        greenTime = Number(greenIn.value) || 9;
      });

      for (var ri = 0; ri < 4; ri++) {
        (function (idx, input) {
          if (!input) return;
          input.addEventListener('input', function () {
            var v = Number(input.value);
            rates[idx] = v >= 0 ? v : 0;
          });
        })(ri, rateIns[ri]);
      }

      if (hwBtn) hwBtn.addEventListener('click', function () {
        denyHW = !denyHW;
        syncHW();
        g.announce(denyHW
          ? 'Hold-and-wait denied. A car now takes both quadrants in one step or waits ' +
            'outside the box, so no cycle can form. Deadlock is impossible from here.'
          : 'Hold-and-wait allowed again. Cars take one quadrant, drive in, and ask for ' +
            'the second while holding the first.');
      });

      if (preemptBtn) preemptBtn.addEventListener('click', preempt);

      if (g.canvas) {
        /* Click an approach and a car arrives on it. The sliders build a
           load; this builds a SITUATION — four clicks, one per arm, and
           the uncontrolled junction locks on demand rather than whenever
           the arrival process gets around to it. */
        g.canvas.addEventListener('pointerdown', function (event) {
          var p = g.pointAt(event);
          if (p.x > PANEL_X) return;
          var dx = p.x - CX;
          var dy = p.y - CY;
          var a;
          if (Math.abs(dx) > Math.abs(dy)) a = dx > 0 ? 1 : 3;
          else a = dy > 0 ? 2 : 0;
          spawn(a);
        });
      }

      /* ---------------------------------------------------------------
         Update.
         --------------------------------------------------------------- */
      function stepLights(dt) {
        if (scheme !== 'lights') return;
        phaseT += dt;
        var span = (phase === 1 || phase === 3) ? AMBER : greenTime;
        if (phaseT >= span) {
          phaseT = 0;
          phase = (phase + 1) % 4;
          if (phase === 0 || phase === 2) sndSignal();
        }
      }

      function stepArrivals(dt) {
        for (var a = 0; a < 4; a++) {
          /* A Poisson process, one Bernoulli trial a step. At a 1/120 s
             step and forty cars a minute the per-step probability is
             0.0056, far enough below one that the thinning is honest
             rather than a rate quietly capped by the step size. */
          if (Math.random() < (rates[a] / 60) * dt) spawn(a);
        }
      }

      /* THE APPROACHES ARE SERVED IN A ROTATING ORDER, and this is the most
         important four lines in the file.

         The first version looped north, east, south, west every frame. Two
         cars asking for the same free quadrant on the same frame were
         therefore always resolved in favour of the lower approach index —
         north beat west to the north-east quadrant, and everywhere else the
         car already in the box beat the car at the line. That is a global
         ordering on lock acquisition that nobody in the model agreed to, and
         a global ordering on lock acquisition is one of the textbook
         deadlock PREVENTIONS. The simulation was quietly preventing the exact
         failure it exists to demonstrate: over fifty-six two-minute runs at
         saturation it produced three of the four conditions constantly and
         the fourth never once.

         Starting from a random approach each frame removes the standing
         priority without adding anything else. It is also the truthful
         model: four drivers arriving together have no agreed order, which is
         the whole reason a junction needs a rule in the first place. */
      function stepCars(dt) {
        speedSum = 0;
        speedCars = 0;

        var first = Math.floor(Math.random() * 4);
        for (var k = 0; k < 4; k++) {
          var a = (first + k) % 4;
          var list = queues[a];
          for (var i = 0; i < list.length; i++) {
            var c = list[i];

            if (c.backoff > 0) c.backoff -= dt;

            /* The four-way stop takes its number at the line, so tickets
               are handed out in true order of arrival at the junction
               rather than in order of spawning. That is what makes it
               FCFS over the junction rather than over four separate
               queues that happen to be interleaved. */
            if (scheme === 'stop' && !c.ticket && c.s >= -1.5) {
              c.ticket = nextTicket++;
            }

            var target = lockLimit(c);
            if (i > 0) {
              var ahead = list[i - 1].s - GAP;
              if (ahead < target) target = ahead;
            }

            /* Dwell only counts while genuinely stationary at the line. A
               car still rolling has not stopped, which is the entire
               complaint every driving examiner has about stop signs. */
            if (scheme === 'stop' && c.s >= -1.5 && c.s <= 0.5 && target <= 0.5) c.dwell += dt;

            var move = c.v * dt;
            if (c.s < target) {
              c.s += move;
              if (c.s > target) c.s = target;
              speedSum += c.v;
            } else if (c.s > target) {
              /* Reversing, at seventy per cent. Rolling back out of a
                 critical section is slower than entering it, in a car and
                 in a transaction. */
              c.s -= move * 0.7;
              if (c.s < target) c.s = target;
              speedSum += c.v * 0.7;
            }
            speedCars++;

            /* The wait ends when the car holds EVERY quadrant it needs, not
               when its nose first crosses the line. The two are the same
               under three of the four schemes and very different under the
               roundabout, where a car can nose in and roll back six times
               without having been served at all — measuring to the first
               nose-in credited those attempts as service and made the
               lock-free scheme look like the fastest thing here by counting
               its failures as successes. Not when it leaves the box either:
               what a control strategy costs you is the delay before you are
               served, not how long the crossing itself takes. */
            if (c.entered < 0 && c.hold2) c.entered = clock;
          }

          /* Off the map. Only ever the front of the queue, because nothing
             overtakes. */
          while (list.length && list[0].s > 300) list.shift();
        }
      }

      /* The most rolled-back car still waiting, and which arm it is on.
         Only cars that have not crossed count: a car that aborted twice and
         then got through was contended with, not livelocked. */
      var worstArm = -1;
      function worstAborts() {
        var most = 0;
        worstArm = -1;
        for (var a = 0; a < 4; a++) {
          var list = queues[a];
          for (var i = 0; i < list.length; i++) {
            if (list[i].done || list[i].entered >= 0) continue;
            if (list[i].aborts > most) { most = list[i].aborts; worstArm = a; }
          }
        }
        return most;
      }

      function stepDetect(dt) {
        /* Retry rate decays with a one-second time constant, so the
           livelock test reads "aborts a second, lately" rather than
           "aborts since the page loaded". */
        retryRate -= retryRate * Math.min(1, dt);

        var waiting = 0;
        for (var a = 0; a < 4; a++) waiting += queues[a].length;

        var locked = cycleFound();
        if (locked) {
          if (status !== 'dead') {
            status = 'dead';
            deadSince = clock;
            deadlocks++;
            sndHorn();
            g.announce('Deadlock. All four quadrants are held and each car is waiting for the ' +
              'one in front of it. Mutual exclusion, hold and wait, no preemption and a circular ' +
              'wait — all four conditions at once. Clear the jam, or deny hold-and-wait.');
          } else if (clock - deadSince > DEADLOCK_HOLD) {
            preempt();
          }
          return;
        }
        if (status === 'dead') { status = 'run'; deadSince = -1; }

        /* LIVELOCK, and the test is per car rather than per junction.

           The first version asked whether the whole junction had stopped
           crossing while the abort rate was high, which is the picture in
           the textbook and almost never happens here: exact four-way
           simultaneity is rare, and the speed jitter breaks it within a
           cycle or two. What DOES happen, constantly, under asymmetric
           load is one car aborting over and over while the junction around
           it flows — the north arm keeps NE occupied, so the west car takes
           NW, finds NE busy, rolls back, and does it again. That car is not
           blocked and it is not idle. It is doing work, repeatedly, and
           making no progress, which is exactly what livelock is.

           Five aborts is the threshold: one or two is ordinary contention
           on a busy junction, five is a car that has been beaten to the
           same quadrant five times running and has no reason to expect the
           sixth attempt to go differently. */
        var worst = worstAborts();
        var stuck = worst >= 5 ||
          (waiting > 0 && (clock - lastCross) > 4 && retryRate > 1.1);
        if (stuck) {
          if (status !== 'live') {
            status = 'live';
            livelocks++;
            g.announce('Livelock' + (worstArm >= 0 ? ' on the ' + NAMES[worstArm].toLowerCase() + ' arm' : '') +
              '. A car keeps taking a quadrant, losing the next one and reversing out. It is not ' +
              'blocked and it is not idle — it is busy, and getting nowhere. Randomised backoff ' +
              'is the usual fix.');
          }
          return;
        }
        if (status === 'live') status = 'run';
      }

      /* Fold the window down into the four per-approach figures the panel
         and the HUD both read. Called from pushHud four times a second
         rather than from draw(), so the panel is reading numbers rather
         than recomputing them sixty times a second for a display that
         changes four. */
      function recompute() {
        var cut = clock - WINDOW;
        while (log.length && log[0].t < cut) log.shift();

        var a, i;
        for (a = 0; a < 4; a++) { statN[a] = 0; statSum[a] = 0; statMax[a] = 0; }
        for (i = 0; i < log.length; i++) {
          var e = log[i];
          statN[e.a]++;
          statSum[e.a] += e.w;
          if (e.w > statMax[e.a]) statMax[e.a] = e.w;
        }

        /* Cars STILL waiting count toward the max. Without them a starved
           approach reports a max of zero for exactly as long as it is
           starved — nothing has crossed, so nothing is in the window, so
           the one number that is supposed to be shouting says nothing. */
        for (a = 0; a < 4; a++) {
          var list = queues[a];
          for (i = 0; i < list.length; i++) {
            if (list[i].entered < 0) {
              var live = clock - list[i].born;
              if (live > statMax[a]) statMax[a] = live;
            }
          }
        }

        var span = clock < WINDOW ? clock : WINDOW;
        thruPerMin = span > 2 ? (log.length / span) * 60 : 0;
      }

      function pushHud() {
        recompute();
        var n = 0, sum = 0, worst = 0;
        for (var a = 0; a < 4; a++) {
          n += statN[a];
          sum += statSum[a];
          if (statMax[a] > worst) worst = statMax[a];
        }
        g.stat('thru', Math.round(thruPerMin) + '/min');
        g.stat('wait', n ? fmt1(sum / n) + 's' : '—');
        g.stat('max', fmt1(worst) + 's');
        g.stat('dead', deadlocks);
        g.stat('state', status === 'dead' ? 'DEADLOCK' : (status === 'live' ? 'LIVELOCK' : 'Running'));
      }

      /* ---------------------------------------------------------------
         Drawing.
         --------------------------------------------------------------- */
      function carXY(c) {
        return {
          x: OX[c.a] + DIRX[c.a] * c.s,
          y: OY[c.a] + DIRY[c.a] * c.s
        };
      }

      function drawRoads(ctx) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(CX - LANE, 0, LANE * 2, H);
        ctx.fillRect(0, CY - LANE, PANEL_X, LANE * 2);

        /* Centre lines, broken outside the box and absent inside it, which
           is how they are painted on a real junction and also the clearest
           way to say that the box belongs to nobody. */
        ctx.strokeStyle = 'rgba(148,163,184,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        var t;
        for (t = 0; t < CY - LANE; t += 14) { ctx.moveTo(CX, t); ctx.lineTo(CX, t + 8); }
        for (t = CY + LANE; t < H; t += 14) { ctx.moveTo(CX, t); ctx.lineTo(CX, t + 8); }
        for (t = 0; t < CX - LANE; t += 14) { ctx.moveTo(t, CY); ctx.lineTo(t + 8, CY); }
        for (t = CX + LANE; t < PANEL_X; t += 14) { ctx.moveTo(t, CY); ctx.lineTo(t + 8, CY); }
        ctx.stroke();

        /* Stop lines, one per approach, across that approach's own lane. */
        ctx.strokeStyle = 'rgba(226,232,240,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(CX, CY - LANE - 1); ctx.lineTo(CX + LANE, CY - LANE - 1);
        ctx.moveTo(CX + LANE + 1, CY); ctx.lineTo(CX + LANE + 1, CY + LANE);
        ctx.moveTo(CX, CY + LANE + 1); ctx.lineTo(CX - LANE, CY + LANE + 1);
        ctx.moveTo(CX - LANE - 1, CY); ctx.lineTo(CX - LANE - 1, CY - LANE);
        ctx.stroke();
      }

      function drawQuads(ctx) {
        var i, holder, x, y;
        for (i = 0; i < 4; i++) {
          x = QX[i] - LANE / 2;
          y = QY[i] - LANE / 2;
          holder = quads[i];
          if (holder) {
            ctx.fillStyle = COLS[holder.a];
            ctx.globalAlpha = 0.22;
            ctx.fillRect(x, y, LANE, LANE);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = COLS[holder.a];
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, LANE - 1, LANE - 1);
          } else {
            ctx.strokeStyle = 'rgba(100,116,139,0.35)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, LANE - 1, LANE - 1);
          }
          ctx.fillStyle = holder ? 'rgba(226,232,240,0.75)' : 'rgba(148,163,184,0.45)';
          ctx.font = '9px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(QNAME[i], QX[i], QY[i] + 3);
        }
        ctx.textAlign = 'left';

        /* The label that makes the whole page make sense. Everything else
           on the canvas is a junction; this says what it is standing in
           for. */
        ctx.strokeStyle = 'rgba(226,232,240,0.28)';
        ctx.lineWidth = 1;
        if (ctx.setLineDash) ctx.setLineDash([4, 4]);
        ctx.strokeRect(CX - LANE - 6.5, CY - LANE - 6.5, LANE * 2 + 13, LANE * 2 + 13);
        if (ctx.setLineDash) ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(203,213,225,0.72)';
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('THE BOX — the shared resource', CX, CY - LANE - 14);
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(148,163,184,0.65)';
        ctx.fillText('four quadrants, four locks', CX, CY + LANE + 22);
        ctx.textAlign = 'left';
      }

      function drawFurniture(ctx) {
        var i, p;
        if (scheme === 'lights') {
          for (i = 0; i < 4; i++) {
            /* The head sits beside its own stop line, on the near side of
               the box, so which light governs which approach is never a
               question. */
            var lx = OX[i] - DIRX[i] * 16 - DIRY[i] * 15;
            var ly = OY[i] - DIRY[i] * 16 + DIRX[i] * 15;
            ctx.fillStyle = '#0b1120';
            ctx.fillRect(lx - 5, ly - 11, 10, 22);
            ctx.strokeStyle = 'rgba(148,163,184,0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(lx - 4.5, ly - 10.5, 9, 21);
            var on = greenFor(i);
            var amber = (phase === 1 && (i === 0 || i === 2)) || (phase === 3 && (i === 1 || i === 3));
            var lamps = [
              on ? 'transparent' : (amber ? 'transparent' : '#ef4444'),
              amber ? '#f59e0b' : 'transparent',
              on ? '#22c55e' : 'transparent'
            ];
            for (var k = 0; k < 3; k++) {
              if (lamps[k] === 'transparent') continue;
              ctx.fillStyle = lamps[k];
              ctx.beginPath();
              ctx.arc(lx, ly - 6 + k * 6, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          return;
        }

        if (scheme === 'stop') {
          for (i = 0; i < 4; i++) {
            var sx = OX[i] - DIRX[i] * 15 - DIRY[i] * 15;
            var sy = OY[i] - DIRY[i] * 15 + DIRX[i] * 15;
            ctx.fillStyle = '#b91c1c';
            ctx.beginPath();
            for (var v = 0; v < 8; v++) {
              var ang = (v / 8) * Math.PI * 2 + Math.PI / 8;
              p = v === 0 ? 'moveTo' : 'lineTo';
              ctx[p](sx + Math.cos(ang) * 8, sy + Math.sin(ang) * 8);
            }
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fee2e2';
            ctx.font = 'bold 6px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('STOP', sx, sy + 2);
          }
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(148,163,184,0.8)';
          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('now serving ticket ' + serving + '  ·  next ' + nextTicket, CX, CY + LANE + 40);
          ctx.textAlign = 'left';
          return;
        }

        if (scheme === 'circle') {
          /* The island. Radius seven: the lane centres are fifteen from
             the middle and a car is thirteen wide, so a car's inner edge
             passes eight and a half out. Anything larger would be drawn
             over by the traffic it is supposed to be directing. */
          ctx.fillStyle = 'rgba(52,211,153,0.18)';
          ctx.beginPath();
          ctx.arc(CX, CY, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(52,211,153,0.6)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(52,211,153,0.25)';
          ctx.lineWidth = 1;
          if (ctx.setLineDash) ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.arc(CX, CY, 21, 0, Math.PI * 2);
          ctx.stroke();
          if (ctx.setLineDash) ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(148,163,184,0.8)';
          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          var most = worstAborts();
          ctx.fillText('rollbacks: ' + retries + '  ·  worst car ' + most +
            (worstArm >= 0 && most ? ' (' + NAMES[worstArm].toLowerCase() + ')' : ''),
            CX, CY + LANE + 40);
          ctx.textAlign = 'left';
        }
      }

      /* p is the NOSE. The body extends CARLEN backwards along the path and
         CARW across it, so the rectangle's origin depends on which way the
         car is pointing — four cases, written as two expressions rather
         than as a switch because the arithmetic is the same one twice. */
      function drawCar(ctx, c) {
        var p = carXY(c);
        var ax = DIRX[c.a] !== 0;
        var w = ax ? CARLEN : CARW;
        var h = ax ? CARW : CARLEN;
        var bx = p.x - (DIRX[c.a] > 0 ? CARLEN : 0) - (ax ? 0 : CARW / 2);
        var by = p.y - (DIRY[c.a] > 0 ? CARLEN : 0) - (ax ? CARW / 2 : 0);

        var blocked = c.want >= 0;
        ctx.fillStyle = COLS[c.a];
        ctx.globalAlpha = blocked ? 0.75 : 1;
        ctx.fillRect(bx, by, w, h);
        ctx.globalAlpha = 1;

        if (!lite) {
          /* A windscreen, so which way a car is pointing is readable at
             thirteen pixels wide. Dropped first when the frame budget goes:
             it is the only thing on a car that is decoration. */
          ctx.fillStyle = 'rgba(2,6,23,0.55)';
          if (ax) ctx.fillRect(bx + (DIRX[c.a] > 0 ? w - 7 : 2), by + 2, 5, h - 4);
          else ctx.fillRect(bx + 2, by + (DIRY[c.a] > 0 ? h - 7 : 2), w - 4, 5);
        }

        if (blocked) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx - 0.5, by - 0.5, w + 1, h + 1);
        }
      }

      /* The wait-for graph, drawn on the tarmac. An arrow runs from the
         quadrant a car is holding to the quadrant it is waiting for, which
         means a deadlock is literally a ring of arrows around the box —
         the diagram out of the textbook, on the thing the textbook was
         describing. */
      function drawWaitFor(ctx) {
        ctx.lineWidth = 1.6;
        for (var i = 0; i < 4; i++) {
          var c = quads[i];
          if (!c || c.want < 0 || quads[i] !== c) continue;
          if (!c.hold1 || c.hold2) continue;
          var fx = QX[i], fy = QY[i];
          var tx = QX[c.want], ty = QY[c.want];
          var dx = tx - fx, dy = ty - fy;
          var len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1) continue;
          dx /= len; dy /= len;
          var x0 = fx + dx * 9, y0 = fy + dy * 9;
          var x1 = tx - dx * 11, y1 = ty - dy * 11;
          ctx.strokeStyle = status === 'dead' ? '#ef4444' : 'rgba(248,113,113,0.55)';
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1 + dx * 5, y1 + dy * 5);
          ctx.lineTo(x1 - dy * 3.2, y1 + dx * 3.2);
          ctx.lineTo(x1 + dy * 3.2, y1 - dx * 3.2);
          ctx.closePath();
          ctx.fill();
        }
      }

      function drawBanner(ctx) {
        if (status === 'run') return;
        var dead = status === 'dead';
        /* A slow breath, never a flash. Half a hertz on a small alpha over
           a small panel is a very long way under the three-flashes-a-second
           threshold, and under reduced motion it does not move at all. */
        var pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock * Math.PI);
        var bw = 240, bh = 46;
        var bx = CX - bw / 2, by = CY + LANE + 54;
        ctx.fillStyle = 'rgba(2,6,23,0.92)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = dead
          ? 'rgba(239,68,68,' + (0.55 + 0.35 * pulse).toFixed(2) + ')'
          : 'rgba(251,191,36,' + (0.55 + 0.35 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = dead ? '#fca5a5' : '#fcd34d';
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.fillText(dead ? 'DEADLOCK' : 'LIVELOCK', CX, by + 19);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillText(dead
          ? 'Four holders, four waiters, one ring. Nothing moves.'
          : 'Busy retrying. No progress. This is not a deadlock.', CX, by + 35);
        ctx.textAlign = 'left';
      }

      /* Word wrap, because the panel is 224 units wide and the sentences
         that belong in it are not. Measured with measureText rather than
         by character count: the panel mixes 10px and 11px text and a
         character budget would be wrong for one of them. */
      function wrap(ctx, text, x, y, maxw, lh) {
        var words = text.split(' ');
        var line = '';
        var out = y;
        for (var i = 0; i < words.length; i++) {
          var test = line ? line + ' ' + words[i] : words[i];
          if (ctx.measureText(test).width > maxw && line) {
            ctx.fillText(line, x, out);
            out += lh;
            line = words[i];
          } else {
            line = test;
          }
        }
        if (line) { ctx.fillText(line, x, out); out += lh; }
        return out;
      }

      /* Kept under about a hundred and forty characters each, which is
         three wrapped lines at nine pixels in a 222-unit column. The long
         version of every one of these is in the page copy below the
         board; the panel only has room for the claim. */
      var SCHEME_NOTE = {
        none: 'No discipline at all. A car takes one quadrant, drives in, then asks for the ' +
          'next while still holding the first.',
        lights: 'A fixed-cycle mutex. Green only goes to two movements whose quadrant sets are ' +
          'disjoint, so no conflict can arise. Green is on a timer.',
        stop: 'A ticket lock. Take a number at the line, cross when it is called. Bounded ' +
          'waiting, no starvation, one car in the box at a time.',
        circle: 'Optimistic and lock-free. Take a quadrant if it is free, roll back if the next ' +
          'is not. Deadlock impossible. Livelock is not.'
      };

      var SCHEME_HEAD = {
        none: 'UNCONTROLLED — incremental locking',
        lights: 'LIGHTS — a fixed-cycle mutex',
        stop: 'FOUR-WAY STOP — a ticket lock',
        circle: 'ROUNDABOUT — lock-free with rollback'
      };

      function drawPanel(ctx) {
        var x = PANEL_X + 8;
        var right = W - 10;
        var maxw = right - x;
        var y;

        ctx.fillStyle = '#060a15';
        ctx.fillRect(PANEL_X, 0, W - PANEL_X, H);
        ctx.strokeStyle = 'rgba(148,163,184,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PANEL_X + 0.5, 0);
        ctx.lineTo(PANEL_X + 0.5, H);
        ctx.stroke();

        /* ---- per approach ---- */
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.fillText('APPROACH', x, 18);
        ctx.textAlign = 'right';
        ctx.fillText('Q', x + 108, 18);
        ctx.fillText('MEAN', x + 158, 18);
        ctx.fillText('MAX', right, 18);
        ctx.textAlign = 'left';

        for (var a = 0; a < 4; a++) {
          y = 34 + a * 15;
          ctx.fillStyle = COLS[a];
          ctx.fillRect(x, y - 7, 6, 6);
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.fillText(NAMES[a], x + 11, y);

          /* Straight out of the window recompute() last folded down. The
             panel does not do arithmetic of its own: two places computing
             the same statistic is two places for it to be computed
             differently, and the HUD cell and the table row are supposed
             to be the same number. */
          var list = queues[a];
          ctx.textAlign = 'right';
          ctx.fillStyle = list.length >= MAXQ ? '#f87171' : '#94a3b8';
          ctx.fillText(String(list.length) + (turned[a] ? '+' + turned[a] : ''), x + 108, y);
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(statN[a] ? fmt1(statSum[a] / statN[a]) + 's' : '—', x + 158, y);
          /* The starvation signal, and the only figure on the panel that
             is coloured by its own value. Twenty seconds is about three
             times a healthy wait at these rates, which is where an arm of
             a junction has stopped being slow and started being ignored. */
          ctx.fillStyle = statMax[a] > 20 ? '#f87171' : '#94a3b8';
          ctx.fillText(fmt1(statMax[a]) + 's', right, y);
          ctx.textAlign = 'left';
        }

        ctx.fillStyle = '#64748b';
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillText('Q shows queued, +n turned away. ' + crossed + ' crossed.', x, 108);

        /* ---- Coffman ---- */
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.fillText('COFFMAN CONDITIONS', x, 132);
        ctx.fillStyle = '#64748b';
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillText('all four at once, or no deadlock', x, 144);

        /* Live evaluation, not a static list. Mutual exclusion and no
           preemption are properties of the model rather than of this
           instant, so they are shown as held unless something has just
           broken them; hold-and-wait and circular wait are read off the
           actual lock table every frame. */
        var holdWait = false;
        for (var q = 0; q < 4; q++) {
          var c = quads[q];
          if (c && c.hold1 && !c.hold2 && c.want >= 0) holdWait = true;
        }
        var ring = cycleFound();
        var justPreempted = preemptFlash >= 0 && clock - preemptFlash < 2.5;

        var conds = [
          { on: true, t: 'Mutual exclusion — one car per quadrant', note: '' },
          {
            on: holdWait && !denyHW,
            t: 'Hold and wait — holds one, wants the next',
            note: denyHW ? 'denied by your rule' : ''
          },
          {
            on: !justPreempted,
            t: 'No preemption — nobody reverses out',
            note: justPreempted ? 'broken: you reversed one out' : ''
          },
          { on: ring, t: 'Circular wait — N → E → S → W → N', note: '' }
        ];

        y = 160;
        for (var ci = 0; ci < 4; ci++) {
          var cond = conds[ci];
          ctx.font = 'bold 10px "Segoe UI", sans-serif';
          ctx.fillStyle = cond.on ? '#fca5a5' : '#475569';
          ctx.fillText(cond.on ? '●' : '○', x, y);
          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.fillStyle = cond.on ? '#cbd5e1' : '#64748b';
          y = wrap(ctx, cond.t, x + 12, y, maxw - 12, 12);
          if (cond.note) {
            ctx.font = 'italic 9px "Segoe UI", sans-serif';
            ctx.fillStyle = '#4ade80';
            ctx.fillText(cond.note, x + 12, y);
            y += 11;
          }
          y += 3;
        }

        /* ---- status ---- */
        var by = 292;
        var tone = status === 'dead' ? '#ef4444' : (status === 'live' ? '#f59e0b' : '#334155');
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, by + 0.5, maxw - 1, 52);
        ctx.font = 'bold 11px "Segoe UI", sans-serif';
        ctx.fillStyle = status === 'dead' ? '#fca5a5' : (status === 'live' ? '#fcd34d' : '#94a3b8');
        ctx.fillText(status === 'dead' ? 'DEADLOCKED'
          : (status === 'live' ? 'LIVELOCKED' : 'FLOWING'), x + 8, by + 17);
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = '#94a3b8';
        var line = status === 'dead'
          ? 'Clear the jam (preemption), or deny hold-and-wait (prevention).'
          : (status === 'live'
            ? 'A car is rolling back over and over. Busy, and getting nowhere.'
            : 'Deadlocks ' + deadlocks + ' · livelocks ' + livelocks + ' · preemptions ' + preempts);
        wrap(ctx, line, x + 8, by + 31, maxw - 16, 11);

        /* ---- what this scheme is ---- */
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(SCHEME_HEAD[scheme], x, 358);
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = '#64748b';
        y = wrap(ctx, SCHEME_NOTE[scheme], x, 371, maxw, 11);
        if (denyHW) {
          ctx.fillStyle = '#4ade80';
          wrap(ctx, 'Hold-and-wait denied: both quadrants at once, or wait outside.',
            x, y + 3, maxw, 11);
        }
      }

      return {
        reset: function () {
          if (schemeSel && SCHEME_NOTE[schemeSel.value]) scheme = schemeSel.value;
          else scheme = 'none';
          if (greenIn) greenTime = Number(greenIn.value) || 9;
          for (var i = 0; i < 4; i++) {
            if (rateIns[i]) {
              var v = Number(rateIns[i].value);
              rates[i] = v >= 0 ? v : 22;
            }
          }
          denyHW = false;
          syncHW();
          for (var q = 0; q < 4; q++) quads[q] = null;
          for (var a = 0; a < 4; a++) queues[a] = [];
          nextTicket = 1;
          serving = 1;
          phase = 0;
          phaseT = 0;
          preemptFlash = -1;
          resetStats();
          pushHud();
        },

        key: function (name) {
          /* Space is the rule. It is the one gesture this page is about —
             adding a constraint and watching a whole class of failure stop
             being possible — and the toolbar button says the same thing
             for anyone who never finds the key. */
          if (name === 'action' && hwBtn) hwBtn.click();
        },

        update: function (dt) {
          /* Reduced motion slows the traffic rather than stopping it. The
             cars moving IS the explanation here, so removing the movement
             would remove the page; running it at three fifths makes every
             acquisition legible without asking anyone to watch a strobe. */
          var step = reduced ? dt * 0.6 : dt;
          clock += step;

          stepLights(step);
          stepArrivals(step);
          stepCars(step);
          releasePass();
          stepDetect(step);

          /* The HUD four times a second, not a hundred and twenty. Five
             DOM writes a frame for numbers that change in the second
             decimal place is the most expensive thing this file could
             possibly do, and none of it would be readable anyway. */
          hudAcc += step;
          if (hudAcc >= 0.25) { hudAcc = 0; pushHud(); }

          /* The bed five times a second, for the reason boids gives: every
             set() below ends in a cancelScheduledValues and a ramp, and
             scheduling those at frame rate costs more than the simulation
             that feeds them while sounding identical. */
          sndAcc += step;
          if (sndAcc >= 0.2) {
            sndAcc = 0;
            var flow = speedCars ? (speedSum / speedCars) / V : 0.15;
            /* An empty junction is quiet rather than fast: with nothing on
               the road there is no flow to hear, and reporting the speed of
               zero cars as 1.0 gave a roaring bed over an empty crossroads. */
            if (!speedCars) flow = 0.1;
            road.set('flow', flow);
            road.set('jam', status === 'dead' ? 1 : (status === 'live' ? 0.6 : 0));
          }
        },

        draw: function (ctx) {
          var t0 = (window.performance && window.performance.now)
            ? window.performance.now() : 0;

          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, W, H);

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, PANEL_X, H);
          ctx.clip();

          drawRoads(ctx);
          drawQuads(ctx);
          drawFurniture(ctx);

          for (var a = 0; a < 4; a++) {
            var list = queues[a];
            for (var i = 0; i < list.length; i++) drawCar(ctx, list[i]);
          }

          drawWaitFor(ctx);
          drawBanner(ctx);
          ctx.restore();

          drawPanel(ctx);

          if (t0) {
            var ms = window.performance.now() - t0;
            /* Exponential, a tenth weight, so one slow frame behind a
               garbage collection cannot toggle the whole look. */
            frameMs += (ms - frameMs) * 0.1;
            if (!lite && frameMs > LITE_MS) lite = true;
            else if (lite && frameMs < EASY_MS) lite = false;
          }
        }
      };
    }
  });
})();

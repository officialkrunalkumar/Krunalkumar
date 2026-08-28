/* ==========================================================================
   rock-paper-scissors.js — against an opponent that learns your habits.
   --------------------------------------------------------------------------
   The point of this one is not the game. It is that you cannot be random,
   and after twenty rounds the machine will be beating you.

   HOW IT PREDICTS: a frequency table over your last two throws. For every
   pair you have played, it counts what you threw next, then plays whatever
   beats your most likely follow-up. That is all — no neural anything — and
   it is enough, because human sequences are full of structure people cannot
   feel: alternating, avoiding a repeat after losing, copying what just beat
   you.

   Below a handful of observations it plays uniformly at random, and it says
   so on screen. An opponent that pretends to have learned something from
   three rounds is lying, and the honesty is the lesson.
   ========================================================================== */

(function () {
  'use strict';

  var W = 520;
  var H = 380;
  var MOVES = ['rock', 'paper', 'scissors'];
  var GLYPH = { rock: '✊', paper: '✋', scissors: '✌' };
  var BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  var BEATEN_BY = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

  GameShell.define({
    id: 'game-rock-paper-scissors',
    slug: 'rock-paper-scissors',
    title: 'Rock paper scissors',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var table = {};              // "prev,prev2" -> { rock: n, paper: n, scissors: n }
      var history = [];
      var wins = 0, losses = 0, draws = 0;
      var lastYou = null, lastThem = null, lastOutcome = '';
      var predicted = null;
      var confident = false;
      var reveal = 0;

      function keyFor() {
        if (history.length < 2) return null;
        return history[history.length - 2] + ',' + history[history.length - 1];
      }

      function predict() {
        var k = keyFor();
        if (!k || !table[k]) { confident = false; return null; }
        var row = table[k];
        var total = row.rock + row.paper + row.scissors;
        /* Fewer than four observations of this exact context is not a
           pattern, it is noise. Say so rather than pretending. */
        if (total < 4) { confident = false; return null; }
        var best = 'rock', bestN = -1;
        for (var i = 0; i < MOVES.length; i++) {
          if (row[MOVES[i]] > bestN) { bestN = row[MOVES[i]]; best = MOVES[i]; }
        }
        confident = bestN / total > 0.4;
        return confident ? best : null;
      }

      function play(you) {
        predicted = predict();
        var them = predicted ? BEATEN_BY[predicted] : MOVES[Math.floor(Math.random() * 3)];

        /* Record the transition BEFORE appending, so the table maps
           "the two before" to "what came next". */
        var k = keyFor();
        if (k) {
          if (!table[k]) table[k] = { rock: 0, paper: 0, scissors: 0 };
          table[k][you]++;
        }
        history.push(you);
        if (history.length > 400) history.shift();

        lastYou = you;
        lastThem = them;
        reveal = 0.9;

        if (you === them) { draws++; lastOutcome = 'draw'; g.beep(400, 0.05, 'sine'); }
        else if (BEATS[you] === them) { wins++; lastOutcome = 'win'; g.beep(760, 0.06, 'sine'); }
        else { losses++; lastOutcome = 'lose'; g.beep(220, 0.07, 'square'); }

        g.stat('you', wins);
        g.stat('them', losses);
        g.stat('rounds', wins + losses + draws);
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing') return;
          var p = g.pointAt(event);
          if (p.y < H - 120 || p.y > H - 30) return;
          var idx = Math.floor((p.x - 60) / 134);
          if (idx >= 0 && idx < 3) play(MOVES[idx]);
        });
      }

      return {
        reset: function () {
          table = {}; history = [];
          wins = 0; losses = 0; draws = 0;
          lastYou = null; lastThem = null; lastOutcome = '';
          predicted = null; confident = false;
          g.stat('you', 0); g.stat('them', 0); g.stat('rounds', 0);
        },

        key: function (name) {
          if (name === 'left') play('rock');
          else if (name === 'up') play('paper');
          else if (name === 'right') play('scissors');
        },

        update: function (dt) { if (reveal > 0) reveal -= dt; },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // The two throws
          ctx.font = '56px "Segoe UI Symbol", "Segoe UI Emoji", sans-serif';
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(lastYou ? GLYPH[lastYou] : '·', W / 2 - 90, 96);
          ctx.fillText(lastThem ? GLYPH[lastThem] : '·', W / 2 + 90, 96);

          ctx.font = '13px "Segoe UI", sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('you', W / 2 - 90, 142);
          ctx.fillText('it', W / 2 + 90, 142);

          ctx.font = 'bold 22px "Segoe UI", sans-serif';
          ctx.fillStyle = lastOutcome === 'win' ? '#86efac' : lastOutcome === 'lose' ? '#f87171' : '#cbd5e1';
          ctx.fillText(lastOutcome === 'win' ? 'you win' : lastOutcome === 'lose' ? 'it wins'
                       : lastOutcome === 'draw' ? 'draw' : 'pick one', W / 2, 96);

          // What it is doing, said plainly
          ctx.font = '13px "Segoe UI", sans-serif';
          var total = wins + losses + draws;
          var line;
          if (total < 6) line = 'Playing at random until it has seen enough of you.';
          else if (!confident) line = 'No clear pattern in your last two throws — playing at random.';
          else line = 'It expected you to play ' + predicted + '.';
          ctx.fillStyle = confident ? '#fde047' : '#64748b';
          ctx.fillText(line, W / 2, 178);

          if (total >= 12) {
            var rate = Math.round((wins / Math.max(1, wins + losses)) * 100);
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('You are winning ' + rate + '% of the decided rounds. Chance would be 50%.', W / 2, 202);
          }

          // Buttons
          for (var i = 0; i < 3; i++) {
            var x = 60 + i * 134;
            ctx.fillStyle = '#1f2c3f';
            ctx.strokeStyle = 'rgba(125,211,252,0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (ctx.roundRect) { ctx.roundRect(x, H - 120, 120, 90, 12); }
            else { ctx.rect(x, H - 120, 120, 90); }
            ctx.fill(); ctx.stroke();
            ctx.font = '34px "Segoe UI Symbol", "Segoe UI Emoji", sans-serif';
            ctx.fillStyle = '#f8fafc';
            ctx.fillText(GLYPH[MOVES[i]], x + 60, H - 82);
            ctx.font = '12px "Segoe UI", sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(MOVES[i], x + 60, H - 46);
          }
        }
      };
    }
  });
})();

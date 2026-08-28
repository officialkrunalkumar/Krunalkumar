/* ==========================================================================
   game-storage.js — everything /games keeps on your device, and the
   controls for removing it.
   ==========================================================================
   Split out of game-shell.js rather than living inside it, because two very
   different pages need it: every game page (to save a best score and to offer
   the reset button under the board) and the hub at /games (to list what is
   held, clear it, and switch storage off).

   The hub does not load the game engine — it has no canvas, no loop and no
   input to run — so the alternative to this file was either shipping fifty
   kilobytes of engine to draw a three-column table, or writing the key
   prefix and the opt-out logic a second time in hub.js. The second option is
   the worse one: two copies of "which keys does this section own" is exactly
   the kind of thing that drifts, and the failure mode is a Clear button that
   silently misses keys, on the one feature whose entire job is to be
   trustworthy.

   Load order: this file must come BEFORE game-shell.js and before hub.js.
   Both read window.GameStorage at definition time.

   ES5 house rules, same as the rest of assets/js: no const/let, no arrow
   functions, no template literals.
   ========================================================================== */

(function (root) {
  'use strict';

  var PREFIX = 'game.';

  /* ==================================================================
     Storage
     ==================================================================
     WHY localStorage AND NOT SOMETHING ELSE. Everything under this
     prefix is a convenience the player asked for by playing: a best
     score, a difficulty they picked, a half-finished 2048 board. For
     anything that has to survive a reload there is no option that is
     more private:

       cookies       are strictly worse — they are transmitted to the
                     server on every single request, so a high score
                     would travel over the network on every page load.
                     localStorage never leaves the device.
       IndexedDB     is the same privacy category with more machinery.
       sessionStorage dies with the tab, so a "best score" would not be
                     one.
       a server      would mean collecting it, which is the opposite of
                     what this site is for.

     So localStorage is the choice, and the honest thing is not to
     avoid it but to make it visible and reversible. Hence the three
     things below: a per-game reset, a clear-everything, and a real
     opt-out that stops all writing.

     THE OPT-OUT KEY IS ITSELF STORED, and there is no way round that —
     a preference to store nothing has to be remembered somewhere or it
     is forgotten on reload. One key remains, holding the word 'off',
     and /games says so plainly rather than pretending otherwise.

     Every read and write is wrapped: Safari in private mode throws on
     setItem rather than failing quietly, and a thrown quota error
     inside a score save would take the whole run down with it.
     ------------------------------------------------------------------ */
  var OPT_OUT_KEY = PREFIX + 'storage';

  function storageAllowed() {
    try { return localStorage.getItem(OPT_OUT_KEY) !== 'off'; }
    catch (err) { return false; }
  }

  function read(key, fallback) {
    if (!storageAllowed()) return fallback;
    try {
      var v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : v;
    } catch (err) { return fallback; }
  }

  function write(key, value) {
    /* The single exception: the opt-out flag itself must still be
       writable, or turning storage back on would be impossible. */
    if (!storageAllowed()) return false;
    try { localStorage.setItem(PREFIX + key, String(value)); return true; }
    catch (err) { return false; }
  }

  /* Every key this section owns. Scoped to the 'game.' prefix on
     purpose: clearing scores must never touch the theme the visitor
     chose (site.theme) or anything the labs keep (lab.*). */
  function ownedKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0 && k !== OPT_OUT_KEY) out.push(k);
      }
    } catch (err) { /* private mode: nothing is stored, so nothing to list */ }
    return out;
  }

  function drop(key) {
    try { localStorage.removeItem(key); return true; } catch (err) { return false; }
  }

  var Storage = {
    enabled: storageAllowed,

    /* Turning it OFF also deletes what is already there. A switch that
       stops future writes but leaves the existing scores behind is not
       an opt-out, it is a pause. */
    setEnabled: function (on) {
      try {
        if (on) localStorage.removeItem(OPT_OUT_KEY);
        else {
          var keys = ownedKeys();
          for (var i = 0; i < keys.length; i++) drop(keys[i]);
          localStorage.setItem(OPT_OUT_KEY, 'off');
        }
        return true;
      } catch (err) { return false; }
    },

    /* What is actually stored, for the panel on /games — so the claim
       can be checked rather than believed. */
    list: function () {
      var keys = ownedKeys();
      var out = [];
      for (var i = 0; i < keys.length; i++) {
        var short = keys[i].slice(PREFIX.length);
        var val = '';
        try { val = localStorage.getItem(keys[i]) || ''; } catch (err) { val = ''; }
        out.push({
          key: keys[i],
          slug: short.indexOf('.') === -1 ? '' : short.slice(0, short.indexOf('.')),
          what: short.indexOf('.') === -1 ? short : short.slice(short.indexOf('.') + 1),
          /* A saved 2048 board is a few hundred characters of JSON and
             is not worth printing in full. */
          value: val.length > 40 ? val.slice(0, 40) + '…' : val,
          bytes: keys[i].length + val.length
        });
      }
      return out;
    },

    clearAll: function () {
      var keys = ownedKeys();
      for (var i = 0; i < keys.length; i++) drop(keys[i]);
      return keys.length;
    },

    /* Everything one game owns: its best, and any preference or saved
       board it keeps. */
    clearGame: function (slug) {
      var keys = ownedKeys();
      var n = 0;
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(PREFIX + slug + '.') === 0) { drop(keys[i]); n++; }
      }
      return n;
    }
  };
  Storage.PREFIX = PREFIX;
  Storage.read = read;
  Storage.write = write;

  root.GameStorage = Storage;
})(typeof self !== 'undefined' ? self : this);

/* ==========================================================================
   sqlite-browser.js — open a SQLite database here, instead of uploading it.
   --------------------------------------------------------------------------
   Chrome's History and Cookies, Firefox's places.sqlite, Android's mmssms.db
   and contacts2.db, WhatsApp's msgstore.db, iOS sms.db and the Manifest.db
   inside every iOS backup are all the same thing underneath: a SQLite file.
   The normal way to read one is to upload it to some website, which for any
   file on that list is an unacceptable thing to do. So this opens it in the
   tab — real SQLite, compiled to WebAssembly, running over bytes that never
   leave the machine. That property is the entire value of the tool; the
   browsing UI is the easy part.

   Decisions worth explaining, because a reader will question them:

   - sql.js is loaded by the PAGE, in a plain <script> before this module, and
     this file fetches nothing at all. The only network read in the whole flow
     is sql.js pulling its own .wasm from this origin, which is why
     locateFile() points at /assets/vendor/sqljs/ and nowhere else. Same
     arrangement as lab-worker.js, for the same reason.

   - The 100-byte file header is parsed here, from the raw bytes, before
     SQLite is involved at all. That is deliberate. The freelist page count,
     the WAL flag, the reserved-bytes field and the version number of the
     library that last wrote the file are the forensically interesting parts,
     and SQLite either normalises them away or refuses to open a damaged file
     that a header read handles perfectly well. A carved or truncated
     database still tells you a lot through its first 100 bytes.

   - Timestamp conversion is the single most useful thing in here, so it gets
     the most care. Chrome stores microseconds since 1601-01-01 (WebKit
     time). Firefox stores microseconds since 1970. Android SMS stores
     milliseconds since 1970 — except the MMS `pdu` table in the same file,
     which stores seconds. Firefox's cookies store creationTime in
     microseconds and expiry in seconds, in the same row. Chrome's own Web
     Data autofill table uses plain Unix seconds while every other Chrome
     database uses WebKit time. iOS Messages used seconds since 2001 up to
     iOS 10 and switched to NANOSECONDS since 2001 in iOS 11, in the same
     column of the same table. Read one with the wrong epoch and the event
     lands in 1601 or in the year 56000, and that is how a timeline gets
     built wrong. Recognised databases get an explicit per-column epoch map;
     everything else gets a per-column guess that states its assumption in
     the column header rather than pretending to know.

   - A trap found the hard way: Chrome's WebKit microsecond values sit around
     1.3e16, which is past Number.MAX_SAFE_INTEGER (9.007e15). sql.js hands
     INTEGER columns back as JavaScript numbers, so the low digits of such a
     value are not exact. It does not matter for a date — the error is under
     a microsecond — but the raw integer printed in a cell should not be
     treated as byte-exact, and this is said in the output rather than
     quietly hoped about.

   - Free queries are stepped one row at a time with a hard cap, not exec()'d
     whole. `SELECT * FROM visits` against a real History file is millions of
     rows and exec() materialises every one of them into JavaScript arrays
     before it returns anything, which takes the tab down. Stepping means a
     careless query costs a second and a truncation notice instead.

   - Writes are allowed, with a warning. It is the visitor's own file, and
     refusing UPDATE in a tool people also use to learn SQL would be theatre.
     What actually matters is that a write only ever touches the copy living
     in this tab's WebAssembly memory: there is no handle back to the file on
     disk, nothing is saved, and closing the tab discards it.

   - Nothing here uses innerHTML. Every value that reaches the DOM goes in as
     textContent, because half the strings on screen come out of a database
     that was chosen precisely because it is not trusted.
   ========================================================================== */

/* global LabTool, initSqlJs */
(function () {
  'use strict';

  var MAX_BYTES = 256 * 1024 * 1024;
  var HEAVY_BYTES = 128 * 1024 * 1024;  // above this, warn about the memory copy
  var PAGE_ROWS = 100;                  // rows per page in the table browser
  var QUERY_ROWS = 1000;                // hard cap on rows one free query renders
  var QUERY_MS = 10000;                 // and on the time it may spend stepping
  var COUNT_MS = 2500;                  // total budget for the COUNT(*) sweep
  var MAX_COLUMNS = 30;
  var FREE_PAGES_SCANNED = 64;          // freelist pages searched for readable text
  var FREE_STRINGS = 24;
  var SAMPLE_MIN = 3;                   // values needed before guessing an epoch

  var out = LabTool.out('tool-out');

  var SQL = null;        // the sql.js module object, once initialised
  var sqlReady = null;   // the in-flight init Promise, so it only happens once

  var state = {
    file: null, bytes: null, header: null, free: null,
    db: null, schema: null, counts: Object.create(null), countedTo: 0,
    profile: null, table: null, offset: 0,
    lastResult: null      // { columns, rows, name } for the CSV button
  };

  /* Every entry point — a dropped file, a button, the query box — goes
     through this. The files this tool is pointed at are hostile or damaged by
     definition, and the worst possible failure mode is a blank pane with a
     stack trace hidden in a console nobody has open. Anything unexpected
     becomes a line of output that says what happened. */
  function guard(what, fn) {
    return function () {
      try {
        return fn.apply(null, arguments);
      } catch (err) {
        out.line('');
        out.err(what + ' failed: ' + String((err && err.message) || err));
        out.dim('That is a fault in this tool rather than proof of anything about');
        out.dim('your file. If you can say what kind of database it is, I will fix it.');
      }
    };
  }

  /* ======================================================================
     Small formatting helpers
     ====================================================================== */

  /* Deliberately not toLocaleString(): a forensic report should not change
     shape because the examiner's machine is set to a different locale. */
  function num(n) {
    var s = String(n);
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    return (neg ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function quoteName(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function u16be(b, off) { return (b[off] << 8) | b[off + 1]; }

  function u32be(b, off) {
    // >>> 0 because a page number with the top bit set would otherwise come
    // back negative, and freelist pointers are unsigned.
    return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
  }

  function i32be(b, off) {
    return (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
  }

  /* ======================================================================
     Epochs
     ----------------------------------------------------------------------
     toMs() converts a stored value to Unix milliseconds. sql() builds the
     equivalent expression in SQL, so a preset query can hand back readable
     dates from SQLite itself rather than making the reader trust JavaScript.
     ====================================================================== */

  var WEBKIT_OFFSET = 11644473600;   // seconds between 1601-01-01 and 1970-01-01
  var COCOA_OFFSET = 978307200;      // seconds between 1970-01-01 and 2001-01-01

  var EPOCHS = {
    unix: {
      label: 'Unix seconds since 1970',
      toMs: function (v) { return v * 1000; },
      sql: function (c) { return "datetime(" + c + ", 'unixepoch')"; }
    },
    unixms: {
      label: 'Unix milliseconds since 1970',
      toMs: function (v) { return v; },
      sql: function (c) { return "datetime(" + c + "/1000, 'unixepoch')"; }
    },
    unixus: {
      label: 'Unix microseconds since 1970',
      toMs: function (v) { return v / 1000; },
      sql: function (c) { return "datetime(" + c + "/1000000, 'unixepoch')"; }
    },
    webkit: {
      label: 'WebKit microseconds since 1601',
      toMs: function (v) { return v / 1000 - WEBKIT_OFFSET * 1000; },
      sql: function (c) {
        return "datetime(" + c + "/1000000 - " + WEBKIT_OFFSET + ", 'unixepoch')";
      }
    },
    filetime: {
      label: 'Windows FILETIME, 100ns ticks since 1601',
      toMs: function (v) { return v / 10000 - WEBKIT_OFFSET * 1000; },
      sql: function (c) {
        return "datetime(" + c + "/10000000 - " + WEBKIT_OFFSET + ", 'unixepoch')";
      }
    },
    cocoa: {
      label: 'Apple seconds since 2001',
      toMs: function (v) { return v * 1000 + COCOA_OFFSET * 1000; },
      sql: function (c) { return "datetime(" + c + " + " + COCOA_OFFSET + ", 'unixepoch')"; }
    },
    cocoans: {
      label: 'Apple nanoseconds since 2001',
      // Nanosecond timestamps in this unit only exist from iOS 11 (Sept 2017 ≈
      // 5.26e17 ns since 2001). Without a raw-magnitude floor the guesser
      // decodes every small positive integer to a plausible 2001 date, because
      // this epoch's origin sits inside the plausibility window; a 4e17 floor
      // (≈ 2013) keeps genuine iOS 11+ values and rejects byte counts and
      // row counters. Other epochs get this floor implicitly from the range
      // test, their origins lying outside the window.
      minRaw: 4e17,
      toMs: function (v) { return v / 1e6 + COCOA_OFFSET * 1000; },
      sql: function (c) {
        return "datetime(" + c + "/1000000000 + " + COCOA_OFFSET + ", 'unixepoch')";
      }
    },
    /* iOS Messages changed units mid-column: seconds since 2001 up to iOS 10,
       nanoseconds since 2001 from iOS 11. Both live in the same `date` column
       of the same sms.db, so a backup that spans the upgrade contains both.
       Switching on magnitude is the only honest way to read it — 1e11 sits
       far above any plausible second count and far below any nanosecond one. */
    cocoaauto: {
      label: 'Apple seconds or nanoseconds since 2001 (switched per value)',
      toMs: function (v) {
        return v > 1e11 ? v / 1e6 + COCOA_OFFSET * 1000 : v * 1000 + COCOA_OFFSET * 1000;
      },
      sql: function (c) {
        return "datetime(CASE WHEN " + c + " > 100000000000 THEN " + c +
               "/1000000000 + " + COCOA_OFFSET + " ELSE " + c + " + " + COCOA_OFFSET +
               " END, 'unixepoch')";
      }
    }
  };

  /* Anything a real artefact could plausibly hold. Used only by the guesser;
     an explicit per-column mapping is never second-guessed against it. */
  var PLAUSIBLE_LOW = Date.UTC(1995, 0, 1);
  var PLAUSIBLE_HIGH = Date.UTC(2040, 0, 1);
  /* Wider bounds for actually rendering a value once an epoch is settled: a
     zeroed or garbage row should still print something rather than vanish. */
  var RENDER_LOW = Date.UTC(1900, 0, 1);
  var RENDER_HIGH = Date.UTC(2200, 0, 1);

  /* Preference order for the guesser. Ties go to the earlier entry, which is
     why Unix seconds beats Apple seconds: they overlap almost completely for
     modern dates, and a bare integer around 1.7e9 is a Unix timestamp far
     more often than it is a Cocoa one. Apple epochs are still listed because
     a recognised Apple database maps to them explicitly. */
  var GUESS_ORDER = ['unix', 'unixms', 'webkit', 'unixus', 'filetime', 'cocoans'];

  /* A column is only considered for decoding if its NAME suggests a time.
     Without that check, row ids and byte counts get "decoded" into dates,
     which is worse than showing nothing. */
  var TIME_NAME = /(^|_)(time|date|stamp|utc|created|modified|expires|expiry|added|used|seen|sent|received|accessed|visit)/i;

  function isoFrom(ms) {
    if (!isFinite(ms)) return '';
    var d = new Date(ms);
    var t = d.getTime();
    if (isNaN(t) || t < RENDER_LOW || t > RENDER_HIGH) return '(out of range)';
    return d.toISOString().replace('T', ' ').replace('.000Z', 'Z');
  }

  function decodeTime(value, key) {
    var epoch = EPOCHS[key];
    if (!epoch || value === null || value === undefined) return '';
    if (value instanceof Uint8Array) return '';
    var n = typeof value === 'number' ? value : Number(value);
    if (!isFinite(n)) return '';
    // Zero is meaningful and common: a Chrome session cookie has expires_utc
    // of 0, and "1601-01-01" for that would be actively misleading.
    if (n === 0) return '(zero)';
    return isoFrom(epoch.toMs(n));
  }

  function guessEpoch(values) {
    var usable = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === null || v === undefined || v instanceof Uint8Array) continue;
      if (typeof v !== 'number') continue;
      if (!isFinite(v) || v === 0) continue;
      usable.push(v);
    }
    if (usable.length < SAMPLE_MIN) return null;

    var best = null;
    for (var g = 0; g < GUESS_ORDER.length; g++) {
      var key = GUESS_ORDER[g];
      var epoch = EPOCHS[key];
      var hits = 0;
      for (var j = 0; j < usable.length; j++) {
        // A raw-magnitude floor where the epoch defines one (cocoans): a value
        // below it cannot be a real timestamp in that unit and must not count
        // as a hit, or a column of counters scores 100% on it.
        if (epoch.minRaw && usable[j] < epoch.minRaw) continue;
        var ms = epoch.toMs(usable[j]);
        if (isFinite(ms) && ms >= PLAUSIBLE_LOW && ms <= PLAUSIBLE_HIGH) hits++;
      }
      // Four in five have to land in a believable range before this claims a
      // reading. Strictly-greater keeps ties with the preferred epoch.
      if (hits >= usable.length * 0.8 && (!best || hits > best.hits)) {
        best = { key: key, hits: hits };
      }
    }
    return best ? best.key : null;
  }

  /* ======================================================================
     Forensic database recognition
     ----------------------------------------------------------------------
     Matched on table names only, never on the filename — a History file is
     still a History file after someone renames it to evidence_01.bin, and
     that is exactly the case where naming it matters most.

     `need` must all be present. Score is need.length * 2 + matched bonus
     names, so a file carrying the full Chrome schema outranks a stub that
     happens to share two table names.

     `times` maps 'table.column' (lower case) to an epoch key. Those are the
     mappings this tool exists for; they are stated per column because the
     epoch genuinely varies per column inside a single file.
     ====================================================================== */

  var PROFILES = [
    {
      name: 'Chromium browsing history — Chrome, Edge, Brave, Opera, Vivaldi',
      need: ['urls', 'visits'],
      bonus: ['downloads', 'keyword_search_terms', 'segments', 'visit_source', 'meta'],
      notes: [
        'Lives at User Data/Default/History. `urls` is one row per address,',
        '`visits` is one row per time it was opened — the join between them is',
        'the actual browsing timeline.',
        'visits.transition matters: the low byte says HOW the page was reached.',
        '1 means the user typed it, 0 means they clicked a link, 7 is a form',
        'submission. That distinction decides a lot of arguments.',
        'visits.visit_duration is microseconds of dwell time, not a timestamp.'
      ],
      times: {
        'urls.last_visit_time': 'webkit',
        'visits.visit_time': 'webkit',
        'downloads.start_time': 'webkit',
        'downloads.end_time': 'webkit',
        'downloads.last_access_time': 'webkit',
        'segment_usage.time_slot': 'webkit',
        // Microseconds of dwell time. It reads like a timestamp and is not one.
        'visits.visit_duration': null
      },
      query: [
        "SELECT datetime(v.visit_time/1000000 - 11644473600, 'unixepoch') AS visited_utc,",
        "       u.url,",
        "       u.title,",
        "       u.visit_count,",
        "       CASE v.transition & 0xff",
        "            WHEN 0 THEN 'link'            WHEN 1 THEN 'typed'",
        "            WHEN 2 THEN 'bookmark'        WHEN 3 THEN 'auto subframe'",
        "            WHEN 4 THEN 'manual subframe' WHEN 5 THEN 'generated'",
        "            WHEN 6 THEN 'start page'      WHEN 7 THEN 'form submit'",
        "            WHEN 8 THEN 'reload'          WHEN 9 THEN 'keyword'",
        "            WHEN 10 THEN 'keyword generated'",
        "            ELSE 'other' END AS how",
        "FROM visits v JOIN urls u ON u.id = v.url",
        "ORDER BY v.visit_time DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Chromium cookie store',
      need: ['cookies'],
      bonus: ['meta'],
      notes: [
        'User Data/Default/Network/Cookies on current builds.',
        'The `value` column is empty on any modern build and the real content',
        'is in `encrypted_value` — AES-GCM under DPAPI on Windows, the login',
        'Keychain on macOS, kwallet or gnome-keyring on Linux. That key is not',
        'in this file and cannot be, so nothing here decrypts it. What you can',
        'still prove from this file is which hosts set cookies and when.',
        'expires_utc of 0 means a session cookie, not 1601.'
      ],
      times: {
        'cookies.creation_utc': 'webkit',
        'cookies.expires_utc': 'webkit',
        'cookies.last_access_utc': 'webkit',
        'cookies.last_update_utc': 'webkit'
      },
      query: [
        "SELECT host_key, name, path,",
        "       datetime(creation_utc/1000000 - 11644473600, 'unixepoch')    AS created_utc,",
        "       datetime(last_access_utc/1000000 - 11644473600, 'unixepoch') AS last_access_utc,",
        "       CASE WHEN expires_utc = 0 THEN 'session'",
        "            ELSE datetime(expires_utc/1000000 - 11644473600, 'unixepoch')",
        "       END AS expires_utc,",
        "       length(encrypted_value) AS encrypted_bytes",
        "FROM cookies",
        "ORDER BY last_access_utc DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Chromium saved passwords — Login Data',
      need: ['logins'],
      bonus: ['stats', 'insecure_credentials', 'meta', 'sync_entities_metadata'],
      notes: [
        'password_value is encrypted with the same OS-held key as the cookie',
        'store, so it stays a blob here. Usernames, the sites they belong to',
        'and the dates are all plaintext, which is usually the part that',
        'matters for an account-takeover timeline.'
      ],
      times: {
        'logins.date_created': 'webkit',
        'logins.date_last_used': 'webkit',
        'logins.date_password_modified': 'webkit',
        'logins.date_synced': 'webkit'
      },
      query: [
        "SELECT origin_url,",
        "       username_value,",
        "       length(password_value) AS encrypted_bytes,",
        "       datetime(date_created/1000000 - 11644473600, 'unixepoch')   AS created_utc,",
        "       datetime(date_last_used/1000000 - 11644473600, 'unixepoch') AS last_used_utc,",
        "       times_used",
        "FROM logins",
        "ORDER BY date_created DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Chromium autofill — Web Data',
      need: ['autofill'],
      bonus: ['credit_cards', 'autofill_profiles', 'masked_credit_cards', 'token_service'],
      notes: [
        'Note the epoch change. Every other Chromium database on this list',
        'uses WebKit microseconds; the autofill tables in Web Data use plain',
        'Unix SECONDS. Applying the WebKit conversion here throws the dates',
        'roughly 350 years out, and it is a mistake that gets made constantly.'
      ],
      times: {
        'autofill.date_created': 'unix',
        'autofill.date_last_used': 'unix',
        'credit_cards.date_modified': 'unix',
        'credit_cards.use_date': 'unix',
        'autofill_profiles.date_modified': 'unix',
        'autofill_profiles.use_date': 'unix'
      },
      query: [
        "SELECT name, value, count AS times_used,",
        "       datetime(date_created,   'unixepoch') AS created_utc,",
        "       datetime(date_last_used, 'unixepoch') AS last_used_utc",
        "FROM autofill",
        "ORDER BY date_last_used DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Firefox history and bookmarks — places.sqlite',
      need: ['moz_places', 'moz_historyvisits'],
      bonus: ['moz_bookmarks', 'moz_origins', 'moz_annos', 'moz_keywords', 'moz_inputhistory'],
      notes: [
        'moz_places is one row per address, moz_historyvisits one row per',
        'visit, joined on place_id — the same shape as Chrome, different',
        'epoch. Firefox counts microseconds from 1970, not 1601.',
        'moz_inputhistory holds what was typed into the address bar, which',
        'survives even when the page was never actually loaded.',
        'PRAGMA user_version on this file is the places schema version.'
      ],
      times: {
        'moz_places.last_visit_date': 'unixus',
        'moz_historyvisits.visit_date': 'unixus',
        'moz_bookmarks.dateadded': 'unixus',
        'moz_bookmarks.lastmodified': 'unixus',
        'moz_annos.dateadded': 'unixus',
        'moz_annos.lastmodified': 'unixus'
      },
      query: [
        "SELECT datetime(h.visit_date/1000000, 'unixepoch') AS visited_utc,",
        "       p.url,",
        "       p.title,",
        "       p.visit_count,",
        "       CASE h.visit_type",
        "            WHEN 1 THEN 'link'   WHEN 2 THEN 'typed'",
        "            WHEN 3 THEN 'bookmark' WHEN 4 THEN 'embed'",
        "            WHEN 5 THEN 'permanent redirect'",
        "            WHEN 6 THEN 'temporary redirect'",
        "            WHEN 7 THEN 'download' WHEN 8 THEN 'framed link'",
        "            WHEN 9 THEN 'reload' ELSE h.visit_type END AS how",
        "FROM moz_historyvisits h JOIN moz_places p ON p.id = h.place_id",
        "ORDER BY h.visit_date DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Firefox cookie store — cookies.sqlite',
      need: ['moz_cookies'],
      bonus: [],
      notes: [
        'Two different units in one row, and this is not a mistake in the',
        'tool: creationTime and lastAccessed are microseconds since 1970,',
        'while expiry is SECONDS since 1970. Firefox has always stored them',
        'that way.'
      ],
      times: {
        'moz_cookies.creationtime': 'unixus',
        'moz_cookies.lastaccessed': 'unixus',
        'moz_cookies.expiry': 'unix'
      },
      query: [
        "SELECT host, name, path,",
        "       datetime(creationTime/1000000, 'unixepoch') AS created_utc,",
        "       datetime(lastAccessed/1000000, 'unixepoch') AS last_access_utc,",
        "       datetime(expiry, 'unixepoch')               AS expires_utc",
        "FROM moz_cookies",
        "ORDER BY lastAccessed DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Firefox form history — formhistory.sqlite',
      need: ['moz_formhistory'],
      bonus: [],
      notes: [
        'Everything typed into a form field and remembered: search terms,',
        'email addresses, names. firstUsed and lastUsed are microseconds.'
      ],
      times: {
        'moz_formhistory.firstused': 'unixus',
        'moz_formhistory.lastused': 'unixus'
      },
      query: [
        "SELECT fieldname, value, timesUsed,",
        "       datetime(firstUsed/1000000, 'unixepoch') AS first_used_utc,",
        "       datetime(lastUsed/1000000,  'unixepoch') AS last_used_utc",
        "FROM moz_formhistory",
        "ORDER BY lastUsed DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Android SMS and MMS — mmssms.db',
      need: ['sms', 'threads'],
      bonus: ['pdu', 'canonical_addresses', 'part', 'addr', 'words'],
      notes: [
        'sms.type: 1 inbox, 2 sent, 3 draft, 4 outbox, 5 failed, 6 queued.',
        'sms.date is milliseconds. The MMS side of the same file — the `pdu`',
        'table — stores its date in SECONDS. One file, two units, and reading',
        'pdu.date as milliseconds puts every MMS in January 1970.',
        'MMS bodies live in `part`, not in `pdu`.'
      ],
      times: {
        'sms.date': 'unixms',
        'sms.date_sent': 'unixms',
        'threads.date': 'unixms',
        'pdu.date': 'unix',
        'pdu.date_sent': 'unix'
      },
      query: [
        "SELECT datetime(date/1000, 'unixepoch') AS sent_utc,",
        "       address,",
        "       CASE type WHEN 1 THEN 'inbox' WHEN 2 THEN 'sent' WHEN 3 THEN 'draft'",
        "                 WHEN 4 THEN 'outbox' WHEN 5 THEN 'failed' WHEN 6 THEN 'queued'",
        "                 ELSE type END AS box,",
        "       read,",
        "       body",
        "FROM sms",
        "ORDER BY date DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Android contacts — contacts2.db',
      need: ['raw_contacts', 'mimetypes'],
      bonus: ['data', 'contacts', 'calls', 'accounts', 'groups', 'phone_lookup'],
      notes: [
        'The contact values are all in `data`, one row per field, with the',
        'field type held by reference in `mimetypes`. That three-way join is',
        'why a contacts export looks harder than it should.',
        'Older Android keeps the call log in this same file, in `calls`.'
      ],
      times: {
        'contacts.last_time_contacted': 'unixms',
        'raw_contacts.last_time_contacted': 'unixms',
        'raw_contacts.contact_last_updated_timestamp': 'unixms',
        'calls.date': 'unixms'
      },
      query: [
        "SELECT rc.display_name, m.mimetype, d.data1 AS value",
        "FROM data d",
        "  JOIN raw_contacts rc ON rc._id = d.raw_contact_id",
        "  JOIN mimetypes   m  ON m._id  = d.mimetype_id",
        "ORDER BY rc.display_name",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Android call log',
      need: ['calls'],
      bonus: ['voicemail_status'],
      notes: [
        'calls.type: 1 incoming, 2 outgoing, 3 missed, 4 voicemail,',
        '5 rejected, 6 blocked. `date` is milliseconds, `duration` is plain',
        'seconds and is not a timestamp at all.'
      ],
      times: { 'calls.date': 'unixms' },
      query: [
        "SELECT datetime(date/1000, 'unixepoch') AS call_utc,",
        "       number, name,",
        "       CASE type WHEN 1 THEN 'incoming' WHEN 2 THEN 'outgoing'",
        "                 WHEN 3 THEN 'missed'   WHEN 4 THEN 'voicemail'",
        "                 WHEN 5 THEN 'rejected' WHEN 6 THEN 'blocked'",
        "                 ELSE type END AS kind,",
        "       duration AS seconds",
        "FROM calls",
        "ORDER BY date DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'WhatsApp messages — msgstore.db, 2021 schema onwards',
      need: ['message', 'chat', 'jid'],
      bonus: ['message_media', 'receipt_user', 'message_quoted', 'call_log', 'message_thumbnail'],
      notes: [
        'The modern schema normalised everything: `message` points at `chat`,',
        'which points at `jid`, which holds the actual phone number. Reading',
        '`message` on its own tells you nothing about who was talking.',
        'from_me is 1 for outbound. Timestamps are milliseconds.',
        'A msgstore.db.crypt14 or .crypt15 straight off a phone is encrypted',
        'and will not open here — it has to be decrypted with the key file',
        'from /data/data/com.whatsapp/files/key first.'
      ],
      times: {
        'message.timestamp': 'unixms',
        'message.received_timestamp': 'unixms',
        'chat.created_timestamp': 'unixms',
        'call_log.timestamp': 'unixms',
        'receipt_user.receipt_timestamp': 'unixms',
        'receipt_user.read_timestamp': 'unixms',
        'receipt_user.played_timestamp': 'unixms'
      },
      query: [
        "SELECT datetime(m.timestamp/1000, 'unixepoch') AS sent_utc,",
        "       j.raw_string AS chat,",
        "       CASE m.from_me WHEN 1 THEN 'me' ELSE 'them' END AS direction,",
        "       m.text_data AS body",
        "FROM message m",
        "  JOIN chat c ON c._id = m.chat_row_id",
        "  JOIN jid  j ON j._id = c.jid_row_id",
        "ORDER BY m.timestamp DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'WhatsApp messages — msgstore.db, legacy schema',
      need: ['messages', 'chat_list'],
      bonus: ['media_refs', 'messages_quotes', 'props', 'message_thumbnails'],
      notes: [
        'The pre-2021 layout: one flat `messages` table, with the counterpart',
        'in key_remote_jid and the body in `data`. key_from_me is 1 for',
        'outbound. Timestamps are milliseconds.',
        'Rows where `data` is null are usually media or system events rather',
        'than empty messages.'
      ],
      times: {
        'messages.timestamp': 'unixms',
        'messages.received_timestamp': 'unixms',
        'messages.send_timestamp': 'unixms'
      },
      query: [
        "SELECT datetime(timestamp/1000, 'unixepoch') AS sent_utc,",
        "       key_remote_jid AS chat,",
        "       CASE key_from_me WHEN 1 THEN 'me' ELSE 'them' END AS direction,",
        "       data AS body",
        "FROM messages",
        "WHERE data IS NOT NULL",
        "ORDER BY timestamp DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'WhatsApp contacts — wa.db',
      need: ['wa_contacts'],
      bonus: ['wa_group_participants', 'wa_props'],
      notes: [
        'The companion file to msgstore.db. Maps a jid to the display name,',
        'the saved contact name and the status text.'
      ],
      times: {},
      query: [
        "SELECT jid, display_name, wa_name, number, status",
        "FROM wa_contacts",
        "WHERE is_whatsapp_user = 1",
        "ORDER BY display_name",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'iOS Messages — sms.db',
      need: ['message', 'handle', 'chat'],
      bonus: ['attachment', 'chat_message_join', 'message_attachment_join', 'chat_handle_join'],
      notes: [
        'From HomeDomain/Library/SMS/sms.db in a backup.',
        'message.date changed units at iOS 11: seconds since 2001 before it,',
        'nanoseconds since 2001 after. A device that has been upgraded holds',
        'both in the same column, so the preset query switches per row rather',
        'than assuming one.',
        'is_from_me is 1 for outbound. handle.id is the phone number or Apple',
        'ID of the other party; group chats resolve through chat_message_join.'
      ],
      times: {
        'message.date': 'cocoaauto',
        'message.date_read': 'cocoaauto',
        'message.date_delivered': 'cocoaauto',
        'chat.last_read_message_timestamp': 'cocoaauto',
        'attachment.created_date': 'cocoa'
      },
      query: [
        "SELECT datetime(CASE WHEN m.date > 100000000000",
        "                     THEN m.date/1000000000 + 978307200",
        "                     ELSE m.date + 978307200 END, 'unixepoch') AS sent_utc,",
        "       h.id AS counterpart,",
        "       CASE m.is_from_me WHEN 1 THEN 'me' ELSE 'them' END AS direction,",
        "       m.service,",
        "       m.text",
        "FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id",
        "ORDER BY m.date DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'iOS backup index — Manifest.db',
      need: ['files'],
      bonus: ['properties'],
      notes: [
        'The map of an iTunes/Finder backup. Every file in the backup is a',
        'row: `domain` plus `relativePath` is the real path on the device,',
        'and `fileID` is the 40-hex name it was stored under, in a folder',
        'named after its first two characters.',
        'The `file` column is a binary plist holding the size, mode and the',
        'real timestamps. SQL cannot open it — extract that column and parse',
        'it as a bplist.',
        'This is the file to start from when you have a backup and no idea',
        'where anything is.'
      ],
      times: {},
      query: [
        "SELECT domain, relativePath, fileID, flags",
        "FROM Files",
        "WHERE relativePath <> ''",
        "ORDER BY domain, relativePath",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'iOS call history — CallHistory.storedata',
      need: ['zcallrecord'],
      bonus: ['z_primarykey', 'z_metadata', 'z_modelcache'],
      notes: [
        'A Core Data store, which is why every table and column is prefixed',
        'with Z. ZDATE is seconds since 2001. ZORIGINATED is 1 for an',
        'outgoing call. ZADDRESS is stored as a blob holding the number as',
        'text, so it needs a CAST to read.'
      ],
      times: { 'zcallrecord.zdate': 'cocoa' },
      query: [
        "SELECT datetime(ZDATE + 978307200, 'unixepoch') AS call_utc,",
        "       CAST(ZADDRESS AS TEXT) AS number,",
        "       ZDURATION AS seconds,",
        "       CASE ZORIGINATED WHEN 1 THEN 'outgoing' ELSE 'incoming' END AS direction,",
        "       ZANSWERED",
        "FROM ZCALLRECORD",
        "ORDER BY ZDATE DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Safari history — History.db',
      need: ['history_items', 'history_visits'],
      bonus: ['history_tombstones', 'history_client_versions'],
      notes: [
        'Safari counts seconds from 2001, like the rest of Apple.',
        'history_tombstones records deletions, which is occasionally more',
        'interesting than the history itself.'
      ],
      times: {
        'history_visits.visit_time': 'cocoa',
        'history_tombstones.end_time': 'cocoa'
      },
      query: [
        "SELECT datetime(v.visit_time + 978307200, 'unixepoch') AS visited_utc,",
        "       i.url, v.title, i.visit_count",
        "FROM history_visits v JOIN history_items i ON i.id = v.history_item",
        "ORDER BY v.visit_time DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Signal (Android), already decrypted — legacy schema',
      need: ['recipient', 'thread', 'sms'],
      bonus: ['mms', 'identities', 'groups', 'part'],
      notes: [
        'Signal ships its database under SQLCipher, so a file straight off a',
        'device has no readable header at all and will not open here. Seeing',
        'this schema means someone already decrypted it with the key from the',
        'Android keystore.',
        'Dates are milliseconds. date_sent is the sender’s clock;',
        'date_received is the receiving device’s, and they disagree more',
        'often than people expect.'
      ],
      times: {
        'sms.date': 'unixms',
        'sms.date_sent': 'unixms',
        'sms.date_received': 'unixms',
        'mms.date': 'unixms',
        'mms.date_received': 'unixms',
        'thread.date': 'unixms'
      },
      query: [
        "SELECT datetime(date_sent/1000, 'unixepoch') AS sent_utc,",
        "       thread_id, body",
        "FROM sms",
        "ORDER BY date_sent DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Signal (Android), already decrypted — unified schema',
      need: ['recipient', 'thread', 'message'],
      bonus: ['identities', 'groups', 'attachment', 'call'],
      notes: [
        'Newer Signal merged sms and mms into one `message` table. Same',
        'caveat as the legacy layout: this file is SQLCipher-encrypted on a',
        'live device, so a readable copy came from somewhere.'
      ],
      times: {
        'message.date_sent': 'unixms',
        'message.date_received': 'unixms',
        'message.date_server': 'unixms',
        'thread.date': 'unixms'
      },
      query: [
        "SELECT datetime(date_sent/1000, 'unixepoch') AS sent_utc,",
        "       thread_id, body",
        "FROM message",
        "ORDER BY date_sent DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Skype — main.db',
      need: ['messages', 'conversations'],
      bonus: ['contacts', 'calls', 'accounts', 'transfers', 'participants'],
      notes: [
        'Plain Unix seconds throughout. Message bodies are in body_xml and',
        'carry markup. `chatname` identifies the conversation.'
      ],
      times: {
        'messages.timestamp': 'unix',
        'conversations.last_activity_timestamp': 'unix',
        'calls.begin_timestamp': 'unix',
        'transfers.starttime': 'unix',
        'transfers.finishtime': 'unix'
      },
      query: [
        "SELECT datetime(timestamp, 'unixepoch') AS sent_utc,",
        "       author, dialog_partner, chatname, body_xml",
        "FROM Messages",
        "ORDER BY timestamp DESC",
        "LIMIT 200;"
      ].join('\n')
    },
    {
      name: 'Windows Timeline — ActivitiesCache.db',
      need: ['activity'],
      bonus: ['activity_packageid', 'activityoperation', 'appsettings', 'manualsequence'],
      notes: [
        'Windows 10 activity history: which application was in use, over',
        'which window of time, and often which document. Times are Unix',
        'seconds. AppId and Payload are JSON held as text or blob, so the',
        'useful detail needs a second parse after you pull it out.'
      ],
      times: {
        'activity.starttime': 'unix',
        'activity.endtime': 'unix',
        'activity.lastmodifiedtime': 'unix',
        'activity.expirationtime': 'unix',
        'activity.createdintcloud': 'unix'
      },
      query: [
        "SELECT datetime(StartTime, 'unixepoch') AS start_utc,",
        "       datetime(EndTime,   'unixepoch') AS end_utc,",
        "       ActivityType, AppId, Payload",
        "FROM Activity",
        "ORDER BY StartTime DESC",
        "LIMIT 200;"
      ].join('\n')
    }
  ];

  function recognise(tableNames) {
    // Null-prototype: table names come from the untrusted file, and a table
    // named for an Object.prototype member would otherwise test present even
    // when the file does not contain it.
    var present = Object.create(null);
    for (var i = 0; i < tableNames.length; i++) {
      present[String(tableNames[i]).toLowerCase()] = true;
    }
    var best = null;
    for (var p = 0; p < PROFILES.length; p++) {
      var profile = PROFILES[p];
      var ok = true;
      for (var n = 0; n < profile.need.length; n++) {
        if (!present[profile.need[n]]) { ok = false; break; }
      }
      if (!ok) continue;
      var score = profile.need.length * 2;
      for (var b = 0; b < profile.bonus.length; b++) {
        if (present[profile.bonus[b]]) score++;
      }
      if (!best || score > best.score) best = { profile: profile, score: score };
    }
    return best ? best.profile : null;
  }

  /* ======================================================================
     The 100-byte file header, read straight from the bytes
     ----------------------------------------------------------------------
     Every multi-byte field in a SQLite header is big-endian, which is the
     opposite of almost every other format on a PC and the usual reason a
     hand-rolled parser reports a page size of 4096 as 16.
     ====================================================================== */

  /* Fifteen characters and then a NUL terminator. The terminator is checked
     as a byte rather than written into a string literal: a real NUL in a
     source file is invisible in every editor, makes the file look binary to
     grep and diff, and is exactly the sort of thing a later reformat eats. */
  var MAGIC = 'SQLite format 3';

  function readHeader(bytes) {
    if (bytes.length < 100) {
      return { error: 'The file is ' + bytes.length + ' bytes. A SQLite header alone is 100.' };
    }
    var magic = '';
    for (var i = 0; i < 16; i++) magic += String.fromCharCode(bytes[i]);
    if (magic.slice(0, 15) !== MAGIC || bytes[15] !== 0) {
      return { error: 'not-sqlite', magic: magic };
    }

    // Page size is a 16-bit big-endian value, and the value 1 is a special
    // case meaning 65536 — it does not fit in the field, so SQLite encodes it
    // this way. Miss that and a 64 KB-page database looks corrupt.
    var pageSize = u16be(bytes, 16);
    if (pageSize === 1) pageSize = 65536;

    var h = {
      pageSize: pageSize,
      writeVersion: bytes[18],
      readVersion: bytes[19],
      reserved: bytes[20],
      changeCounter: u32be(bytes, 24),
      headerPages: u32be(bytes, 28),
      freelistTrunk: u32be(bytes, 32),
      freelistCount: u32be(bytes, 36),
      schemaCookie: u32be(bytes, 40),
      schemaFormat: u32be(bytes, 44),
      largestRoot: u32be(bytes, 52),
      textEncoding: u32be(bytes, 56),
      userVersion: i32be(bytes, 60),
      incrementalVacuum: u32be(bytes, 64),
      applicationId: u32be(bytes, 68),
      versionValidFor: u32be(bytes, 92),
      writeLibrary: u32be(bytes, 96)
    };

    if (h.pageSize < 512 || (h.pageSize & (h.pageSize - 1)) !== 0) {
      h.pageSizeSuspect = true;
    }
    h.pagesFromSize = h.pageSize ? Math.floor(bytes.length / h.pageSize) : 0;
    h.tailBytes = h.pageSize ? bytes.length % h.pageSize : 0;

    /* The in-header page count is only trustworthy when the change counter
       and the version-valid-for field agree. If they differ, the file was
       last written by a pre-3.7.0 library that did not maintain the size
       field, and the value in it is stale — the file length is the truth. */
    h.headerPagesValid = (h.changeCounter === h.versionValidFor) && h.headerPages > 0;
    h.wal = h.writeVersion === 2 || h.readVersion === 2;
    return h;
  }

  function libVersion(n) {
    if (!n) return 'not recorded';
    return Math.floor(n / 1000000) + '.' + (Math.floor(n / 1000) % 1000) + '.' + (n % 1000) +
           '  (' + n + ')';
  }

  function encodingName(n) {
    if (n === 1) return 'UTF-8';
    if (n === 2) return 'UTF-16 little-endian';
    if (n === 3) return 'UTF-16 big-endian';
    return 'unknown (' + n + ')';
  }

  /* Walk the freelist trunk chain. A trunk page is: 4-byte next-trunk page
     number, 4-byte leaf count, then that many 4-byte leaf page numbers. Page
     numbers are 1-based, so page N starts at (N-1) * pageSize.

     Walking it rather than trusting the header count is worth the code: a
     mismatch between the two means the file is internally inconsistent,
     which on a carved or partially recovered database is exactly the sort of
     thing you want to know before quoting a number in a report. */
  function walkFreelist(bytes, h) {
    var result = { pages: [], trunks: 0, broken: null, capped: false, beyondEof: 0 };
    if (!h.pageSize || !h.freelistTrunk) return result;

    var usable = h.pageSize - h.reserved;
    var maxLeaves = Math.floor(usable / 4) - 2;
    var seen = {};
    var next = h.freelistTrunk;
    var guard = 0;

    while (next > 0) {
      if (guard++ > 100000) { result.capped = true; break; }
      if (seen[next]) {
        result.broken = 'the chain loops back to page ' + next;
        break;
      }
      seen[next] = true;
      var off = (next - 1) * h.pageSize;
      if (off < 0 || off + 8 > bytes.length) {
        result.broken = 'trunk page ' + next + ' lies past the end of the file';
        break;
      }
      result.trunks++;
      result.pages.push(next);
      var following = u32be(bytes, off);
      var leaves = u32be(bytes, off + 4);
      if (leaves > maxLeaves) {
        result.broken = 'trunk page ' + next + ' claims ' + leaves +
                        ' leaves, more than a ' + h.pageSize + '-byte page can hold';
        break;
      }
      for (var i = 0; i < leaves; i++) {
        var leafOff = off + 8 + i * 4;
        if (leafOff + 4 > bytes.length) { result.broken = 'a leaf list runs past the end of the file'; break; }
        var leaf = u32be(bytes, leafOff);
        // The trunk is validated above but its leaves are not. On a truncated
        // or carved file the trunk often survives while the pages it names are
        // gone, so a leaf whose page start lies past EOF is counted separately
        // rather than pushed as if it were present — otherwise the walked count
        // matches the header count and the truncation goes unreported.
        if (leaf > 0) {
          if ((leaf - 1) * h.pageSize >= bytes.length) {
            result.beyondEof++;
          } else {
            result.pages.push(leaf);
          }
        }
      }
      if (result.broken) break;
      next = following;
    }
    return result;
  }

  /* Printable runs inside freed pages. This is not carving — it does not
     rebuild records, and a hit could equally be part of a live row that was
     copied when the page was reused. It answers one question only, and it is
     usually the first question: is there anything left in there at all. */
  function freePageStrings(bytes, h, pages) {
    var found = [];
    // Null-prototype: the keys are text recovered from the file, and a bare
    // object would silently drop any run that collides with an Object.prototype
    // member name ('constructor', 'toString', '__proto__', …) on first sight.
    var seen = Object.create(null);
    var scanned = 0;
    for (var p = 0; p < pages.length && scanned < FREE_PAGES_SCANNED; p++) {
      var start = (pages[p] - 1) * h.pageSize;
      if (start < 0 || start >= bytes.length) continue;
      scanned++;
      var end = Math.min(start + h.pageSize, bytes.length);
      var current = '';
      for (var i = start; i < end; i++) {
        var b = bytes[i];
        if (b >= 0x20 && b < 0x7f) { current += String.fromCharCode(b); continue; }
        if (current.length >= 8 && !seen[current]) {
          seen[current] = true;
          found.push({ page: pages[p], text: current });
        }
        current = '';
        if (found.length >= FREE_STRINGS) break;
      }
      if (current.length >= 8 && !seen[current] && found.length < FREE_STRINGS) {
        seen[current] = true;
        found.push({ page: pages[p], text: current });
      }
      if (found.length >= FREE_STRINGS) break;
    }
    return { found: found, scanned: scanned, more: pages.length > scanned };
  }

  /* When the SQLite magic is absent, say what the file probably is instead of
     shrugging. All four of these turn up constantly next to a real database. */
  function identifyNonDatabase(bytes) {
    var hex = LabTool.toHex(bytes.subarray(0, 8));
    if (hex.indexOf('377f0682') === 0 || hex.indexOf('377f0683') === 0) {
      return 'a SQLite write-ahead log (a -wal file). It holds pages not yet ' +
             'folded into the database, so it is worth keeping — but it cannot ' +
             'be opened on its own. Drop the .db that goes with it, in the same ' +
             'folder, and SQLite will merge them when it is opened properly.';
    }
    if (hex.indexOf('d9d505f920a163d7') === 0) {
      return 'a SQLite rollback journal (a -journal file). It holds the ' +
             'pre-change copies of pages from an interrupted transaction, which ' +
             'makes it one of the better sources of superseded data — but it is ' +
             'not a database and cannot be queried.';
    }
    if (hex.indexOf('53514c69746520') === 0) {
      return 'almost a SQLite header — the text matches but the terminator does ' +
             'not, which suggests the first bytes have been overwritten.';
    }
    var head = LabTool.entropy(bytes.subarray(0, Math.min(bytes.length, 65536)));
    if (head > 7.5) {
      return 'high-entropy data with no readable header (' + head.toFixed(2) +
             ' bits/byte). That is what an encrypted database looks like: ' +
             'SQLCipher, which Signal uses, encrypts the header along with ' +
             'everything else, and a WhatsApp msgstore.db.crypt14 or .crypt15 ' +
             'is AES-encrypted the same way. Neither can be opened without the ' +
             'key, and the key is never in the file.';
    }
    return null;
  }

  /* ======================================================================
     Rendering
     ====================================================================== */

  var BLOB_SIGS = [
    { hex: '62706c69737430', what: 'bplist' },       // "bplist0"
    { hex: '89504e470d0a1a0a', what: 'PNG' },
    { hex: 'ffd8ff', what: 'JPEG' },
    { hex: '474946383', what: 'GIF' },
    { hex: '504b0304', what: 'ZIP' },
    { hex: '1f8b08', what: 'gzip' },
    { hex: '25504446', what: 'PDF' }
  ];

  /* sql.js hands BLOB columns back as Uint8Array. Printing that raw would
     dump thousands of comma-separated bytes into a table cell, so blobs get a
     one-line summary instead: what it looks like, how big it is, and the
     first bytes both ways. A surprising number of forensic blobs are text in
     disguise — bplists, protobufs with readable field values, JSON — and the
     ASCII half is often the whole answer. */
  function blobSummary(v) {
    var hex = LabTool.toHex(v.subarray(0, 10));
    var kind = '';
    for (var i = 0; i < BLOB_SIGS.length; i++) {
      if (hex.indexOf(BLOB_SIGS[i].hex) === 0) { kind = ' ' + BLOB_SIGS[i].what; break; }
    }
    var ascii = '';
    var upto = Math.min(v.length, 24);
    for (var j = 0; j < upto; j++) {
      ascii += (v[j] >= 0x20 && v[j] < 0x7f) ? String.fromCharCode(v[j]) : '.';
    }
    return '[blob' + kind + ' ' + num(v.length) + 'B ' + hex +
           (v.length > 10 ? '…' : '') + ' |' + ascii + '|]';
  }

  function cellText(v, cap) {
    var s;
    if (v === null || v === undefined) s = 'NULL';
    else if (v instanceof Uint8Array) s = blobSummary(v);
    else s = String(v);
    // Newlines and tabs would tear the column alignment apart, and message
    // bodies are full of both.
    s = s.replace(/[\r\n]+/g, ' ⏎ ').replace(/\t/g, ' ');
    if (s.length > cap) s = s.slice(0, cap - 1) + '…';
    return s;
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + new Array(n - s.length + 1).join(' ');
  }

  /* Column-aligned table in the terminal pane. One span per line rather than
     one per cell: a 100-row result with a dozen columns would otherwise be
     twelve hundred DOM nodes for no visual gain. */
  function renderTable(columns, rows) {
    if (!columns || !columns.length) { out.dim('(no columns)'); return; }

    var shown = columns.slice(0, MAX_COLUMNS);
    var dropped = columns.length - shown.length;

    /* Per-cell width shrinks as columns multiply, so a wide table stays
       roughly one screen of horizontal scrolling instead of ten. */
    var cap = Math.floor(720 / shown.length);
    if (cap < 20) cap = 20;
    if (cap > 160) cap = 160;

    var body = [];
    for (var r = 0; r < rows.length; r++) {
      var line = [];
      for (var c = 0; c < shown.length; c++) line.push(cellText(rows[r][c], cap));
      body.push(line);
    }

    var widths = [];
    for (var i = 0; i < shown.length; i++) {
      var w = Math.min(String(shown[i]).length, cap);
      for (var b = 0; b < body.length; b++) w = Math.max(w, body[b][i].length);
      widths.push(w);
    }

    function border(l, m, rr) {
      var parts = [];
      for (var k = 0; k < widths.length; k++) parts.push(new Array(widths[k] + 3).join('─'));
      return l + parts.join(m) + rr;
    }
    function rowLine(cells) {
      var parts = [];
      for (var k = 0; k < widths.length; k++) parts.push(pad(cells[k], widths[k]));
      return '│ ' + parts.join(' │ ') + ' │';
    }

    var headings = [];
    for (var hh = 0; hh < shown.length; hh++) {
      headings.push(cellText(shown[hh], cap));
    }

    out.line(border('┌', '┬', '┐'), 't-dim');
    out.line(rowLine(headings), 't-info');
    out.line(border('├', '┼', '┤'), 't-dim');
    if (!body.length) {
      out.line(rowLine(headings.map(function () { return ''; })), 't-dim');
    } else {
      for (var y = 0; y < body.length; y++) out.line(rowLine(body[y]));
    }
    out.line(border('└', '┴', '┘'), 't-dim');
    if (!body.length) out.dim('(no rows)');
    if (dropped > 0) {
      out.warn(dropped + ' further column' + (dropped === 1 ? '' : 's') +
               ' not shown — query them by name to see them.');
    }
  }

  /* Buttons inside the <pre>. Adding markup to the page is out of scope for a
     tool module, and .lab-btn already exists in the stylesheet, so pagination
     and the preset-query action are built here and appended to the output
     pane. out.clear() removes them along with everything else. */
  function actionButton(label, handler, disabled) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lab-btn';
    b.textContent = label;
    b.style.margin = '0.2rem 0.4rem 0.2rem 0';
    if (disabled) b.disabled = true;
    else b.addEventListener('click', guard('That', handler));
    out.node.appendChild(b);
    return b;
  }

  /* ======================================================================
     Opening the file
     ====================================================================== */

  function ensureSql() {
    if (sqlReady) return sqlReady;
    if (typeof initSqlJs !== 'function') {
      sqlReady = Promise.reject(new Error(
        'sql.js is not loaded. The page includes it with a <script> tag before ' +
        'this module; without it there is no SQLite engine to open the file with.'));
      return sqlReady;
    }
    /* The one and only path to /assets/vendor/sqljs/. sql.js fetches its own
       .wasm through this callback; nothing in this module fetches anything,
       and nothing here points anywhere but this origin. */
    sqlReady = initSqlJs({
      locateFile: function (f) { return '/assets/vendor/sqljs/' + f; }
    }).then(function (mod) { SQL = mod; return mod; });
    return sqlReady;
  }

  function closeDb() {
    if (state.db) {
      try { state.db.close(); } catch (err) { /* already gone */ }
      state.db = null;
    }
  }

  function accept(bytes, file) {
    var nameEl = document.getElementById('tool-dropname');
    if (nameEl) nameEl.textContent = file.name;

    closeDb();
    state.file = { name: file.name, size: bytes.length, lastModified: file.lastModified };
    state.bytes = bytes;
    state.schema = null;
    state.counts = Object.create(null);
    state.countedTo = 0;
    state.profile = null;
    state.table = null;
    state.offset = 0;
    state.lastResult = null;
    clearTableSelect();

    state.header = readHeader(bytes);
    out.clear();

    if (state.header.error) {
      reportNotADatabase(bytes, file);
      return;
    }
    state.free = walkFreelist(bytes, state.header);

    printFileSection();
    printHeaderSection();
    printFreelistSection();
    out.dim('Starting SQLite…');

    /* Guarded rather than bare: this runs after the promise resolves, so an
       exception here would become an unhandled rejection and leave the pane
       showing a header report that never grew a schema, with no explanation. */
    ensureSql().then(guard('Opening the database', openDatabase), function (err) {
      out.err(String((err && err.message) || err));
    });
  }

  function reportNotADatabase(bytes, file) {
    out.heading(file.name);
    out.row('size', LabTool.humanBytes(bytes.length) + '  (' + num(bytes.length) + ' bytes)');
    out.rule();
    if (state.header.error !== 'not-sqlite') {
      out.err(state.header.error);
      return;
    }
    out.err('This is not a SQLite database. The first 16 bytes of one always');
    out.err('read "SQLite format 3" followed by a zero byte, and these do not.');
    out.rule();
    out.row('first 16 bytes', LabTool.toHex(bytes.subarray(0, 16)));
    var guess = identifyNonDatabase(bytes);
    if (guess) {
      out.line('');
      out.warn('It looks like ' + guess);
    } else {
      out.line('');
      out.dim('Nothing here identifies it. The file inspector tool will check it');
      out.dim('against a list of file signatures and show you the bytes.');
    }
  }

  function printFileSection() {
    var f = state.file;
    out.heading(f.name);
    out.row('size', LabTool.humanBytes(f.size) + '  (' + num(f.size) + ' bytes)');
    out.row('last modified', f.lastModified ? new Date(f.lastModified).toISOString() : 'unknown');
    if (f.size > HEAVY_BYTES) {
      out.warn('Large file. SQLite works on a copy in WebAssembly memory, so the');
      out.warn('tab needs roughly twice this in RAM while it is open.');
    }
    out.rule();
  }

  function printHeaderSection() {
    var h = state.header;
    out.heading('File header');
    out.dim('read from the first 100 bytes, before SQLite is involved at all');
    out.line('');
    out.row('page size', num(h.pageSize) + ' bytes', h.pageSizeSuspect ? 't-err' : '');
    if (h.pageSizeSuspect) {
      out.err('That is not a power of two between 512 and 65536, so the header is');
      out.err('damaged. Everything below it is unreliable.');
    }
    out.row('pages in file', num(h.pagesFromSize) +
            (h.tailBytes ? '  (+ ' + num(h.tailBytes) + ' trailing bytes — the file is not a whole number of pages)' : ''));
    out.row('pages in header', h.headerPagesValid ? num(h.headerPages)
            : num(h.headerPages) + '  — stale, ignore it');
    if (!h.headerPagesValid) {
      out.dim('    the change counter and version-valid-for field disagree, which');
      out.dim('    means an old library wrote this and never updated the size');
    }
    if (h.headerPagesValid && h.headerPages !== h.pagesFromSize) {
      out.warn('The header says ' + num(h.headerPages) + ' pages but the file holds ' +
               num(h.pagesFromSize) + '. That is a truncated or extended file.');
    }
    out.row('journal mode', h.wal ? 'WAL (write-ahead log)' : 'rollback journal',
            h.wal ? 't-warn' : '');
    out.row('reserved per page', h.reserved + ' bytes' +
            (h.reserved ? '  — an extension is using page tail space' : ''));
    out.row('text encoding', encodingName(h.textEncoding));
    out.row('schema format', h.schemaFormat);
    out.row('schema cookie', h.schemaCookie + '  (changes on every schema edit)');
    out.row('change counter', num(h.changeCounter));
    out.row('user_version', h.userVersion);
    out.row('application_id', h.applicationId ?
            ('0x' + ('00000000' + h.applicationId.toString(16)).slice(-8)) : '0 (not set)');
    out.row('auto-vacuum', h.largestRoot ?
            (h.incrementalVacuum ? 'incremental' : 'full') : 'off');
    out.row('written by SQLite', libVersion(h.writeLibrary));

    if (h.largestRoot) {
      out.line('');
      out.warn('Auto-vacuum is on. Free pages get moved to the end of the file and');
      out.warn('truncated away, so deleted content is destroyed far more');
      out.warn('aggressively here than in a default database.');
    }
    if (h.wal) {
      out.line('');
      out.warn('This database is in WAL mode, and that matters for what you are');
      out.warn('about to read. Recent transactions may still be sitting in the');
      out.warn('companion -wal file rather than in this one. If you copied only');
      out.warn('the .db, the most recent activity — the part usually of most');
      out.warn('interest — may be missing entirely. Collect the -wal and -shm');
      out.warn('files alongside it and open the set with a real sqlite3 binary.');
    }
    out.rule();
  }

  function printFreelistSection() {
    var h = state.header;
    var free = state.free;
    out.heading('Deleted-row potential');

    var bytesFree = h.freelistCount * h.pageSize;
    out.row('free pages (header)', num(h.freelistCount) + ' of ' + num(h.pagesFromSize) +
            '  (' + LabTool.humanBytes(bytesFree) + ')',
            h.freelistCount ? 't-warn' : 't-dim');
    out.row('free pages (walked)', num(free.pages.length) + ' reached, ' +
            num(free.trunks) + ' trunk page' + (free.trunks === 1 ? '' : 's'));

    if (free.capped) {
      out.warn('The freelist walk stopped after 100,000 trunk pages. The counts');
      out.warn('below are a floor, not a total, and the header count is not');
      out.warn('contradicted by this.');
    }
    if (h.freelistCount > h.pagesFromSize && h.pagesFromSize) {
      out.err('The header claims ' + num(h.freelistCount) + ' free pages but the file holds');
      out.err(num(h.pagesFromSize) + ' pages in all. The free-page count cannot be trusted.');
    }

    if (free.broken) {
      out.err('The freelist is inconsistent: ' + free.broken + '.');
      out.dim('On a carved or partially recovered file that is expected. It also');
      out.dim('means the header count above cannot be taken at face value.');
    } else if (free.beyondEof) {
      out.err('The freelist names ' + num(free.beyondEof) + ' page' +
              (free.beyondEof === 1 ? '' : 's') + ' that lie past the end of this file.');
      out.dim('It is truncated or carved; the free-page count cannot be taken at');
      out.dim('face value.');
    } else if (!free.capped && free.pages.length !== h.freelistCount && h.freelistCount) {
      out.warn('The walk found ' + num(free.pages.length) + ' pages but the header claims ' +
               num(h.freelistCount) + '. The two should agree.');
    }

    out.line('');
    if (!h.freelistCount && !free.pages.length) {
      out.dim('Nothing on the freelist. That is not the same as "nothing was');
      out.dim('deleted" — a VACUUM empties it, and deleted records also leave');
      out.dim('bytes in the unallocated middle of live pages and in the slack');
      out.dim('after the last cell on a page. This tool does not carve those.');
    } else {
      out.dim('Pages on the freelist are not wiped. SQLite unlinks them and');
      out.dim('reuses them later, so unless the database was built with');
      out.dim('secure_delete on, or has been VACUUMed since, the old record');
      out.dim('bytes are usually still sitting there. A DELETE is a bookkeeping');
      out.dim('change, not an erasure.');
      out.line('');
      var strings = freePageStrings(state.bytes, h, free.pages);
      if (!strings.found.length) {
        out.dim('No printable runs of 8 or more characters found in the ' +
                strings.scanned + ' free page' + (strings.scanned === 1 ? '' : 's') + ' scanned.');
      } else {
        out.dim('readable text still in free pages — first ' + strings.found.length +
                ' from ' + strings.scanned + ' page' + (strings.scanned === 1 ? '' : 's') + ':');
        for (var i = 0; i < strings.found.length; i++) {
          var s = strings.found[i];
          var text = s.text.length > 110 ? s.text.slice(0, 109) + '…' : s.text;
          out.line('  page ' + pad(s.page, 7) + ' ' + text);
        }
        if (strings.more) {
          out.dim('  … stopped there. ' + num(free.pages.length - strings.scanned) +
                  ' further free page' + (free.pages.length - strings.scanned === 1 ? '' : 's') +
                  ' were not scanned.');
        }
        out.line('');
        out.dim('This is not carving. It does not rebuild records, and a hit may');
        out.dim('be a fragment of a live row copied when the page was reused.');
        out.dim('It answers one question: is there anything left in there.');
      }
    }
    out.rule();
  }

  /* ======================================================================
     Schema
     ====================================================================== */

  function execFirst(sql) {
    var res = state.db.exec(sql);
    return res.length ? res[0] : { columns: [], values: [] };
  }

  function openDatabase() {
    try {
      /* new Database() does not read anything yet — SQLite opens lazily, so a
         file that is not a database, or one whose pages are shredded, throws
         on the first real query rather than here. The probe below is what
         actually decides whether this file can be read. */
      state.db = new SQL.Database(state.bytes);
    } catch (err) {
      out.err('SQLite could not take the file: ' + String((err && err.message) || err));
      out.dim('At this size that is usually the tab running out of memory for the');
      out.dim('copy SQLite needs in WebAssembly.');
      return;
    }

    var master;
    try {
      master = execFirst("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name");
    } catch (err) {
      out.err('The file has a valid header but SQLite will not read it:');
      out.err('  ' + String((err && err.message) || err));
      out.line('');
      out.dim('"file is not a database" after a good header usually means an');
      out.dim('encrypted body — SQLCipher leaves the first 16 bytes alone in some');
      out.dim('configurations. "malformed" means the page structure is damaged,');
      out.dim('which is normal for a carved file. The header section above was');
      out.dim('read from the raw bytes and still stands.');
      closeDb();
      return;
    }

    state.schema = { tables: [], views: [], indexes: [], triggers: [] };
    var rows = master.values;
    for (var i = 0; i < rows.length; i++) {
      var item = { type: rows[i][0], name: rows[i][1], tbl: rows[i][2], sql: rows[i][3] };
      if (item.type === 'table') state.schema.tables.push(item);
      else if (item.type === 'view') state.schema.views.push(item);
      else if (item.type === 'index') state.schema.indexes.push(item);
      else if (item.type === 'trigger') state.schema.triggers.push(item);
    }

    var names = state.schema.tables.map(function (t) { return t.name; });
    state.profile = recognise(names);
    countTables();
    fillTableSelect();
    printSchemaSection();
  }

  function countRows(name) {
    try {
      var res = state.db.exec('SELECT COUNT(*) FROM ' + quoteName(name));
      if (!res.length || !res[0].values.length) return { ok: false, msg: 'no result' };
      return { ok: true, n: res[0].values[0][0] };
    } catch (err) {
      // A virtual table with a missing module, or a corrupt b-tree, throws
      // here. One unreadable table must not stop the other forty being listed.
      return { ok: false, msg: String((err && err.message) || err) };
    }
  }

  /* COUNT(*) is a full scan on every table without a usable index, and a real
     History file has millions of rows in `visits`. The sweep therefore runs
     against a clock and stops when it has spent long enough; the rest are
     counted lazily, one at a time, when they are opened. */
  function countTables() {
    var started = Date.now();
    var list = state.schema.tables;
    state.counts = Object.create(null);
    state.countedTo = 0;
    for (var i = 0; i < list.length; i++) {
      if (Date.now() - started > COUNT_MS) break;
      state.counts[list[i].name] = countRows(list[i].name);
      state.countedTo = i + 1;
    }
  }

  function countFor(name) {
    if (!state.counts[name]) state.counts[name] = countRows(name);
    return state.counts[name];
  }

  function clearTableSelect() {
    var sel = document.getElementById('tool-tables');
    if (!sel) return;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No database open';
    sel.appendChild(opt);
    sel.disabled = true;
  }

  function fillTableSelect() {
    var sel = document.getElementById('tool-tables');
    if (!sel) return;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    sel.disabled = false;

    var first = document.createElement('option');
    first.value = '';
    first.textContent = '— overview —';
    sel.appendChild(first);

    function group(label, items) {
      if (!items.length) return;
      var g = document.createElement('optgroup');
      g.label = label;
      for (var i = 0; i < items.length; i++) {
        var o = document.createElement('option');
        o.value = items[i].name;
        var count = state.counts[items[i].name];
        // textContent, never innerHTML: these names come out of the dropped file.
        o.textContent = items[i].name +
          (count && count.ok ? '   (' + num(count.n) + ' rows)' : '');
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    group('Tables', state.schema.tables);
    group('Views', state.schema.views);
  }

  function printSchemaSection() {
    var s = state.schema;
    out.heading('Schema');
    out.row('tables', num(s.tables.length));
    out.row('views', num(s.views.length));
    out.row('indexes', num(s.indexes.length));
    out.row('triggers', num(s.triggers.length));
    out.line('');

    if (!s.tables.length) {
      out.warn('No tables. An empty database, or one whose schema page is gone.');
    } else {
      var rows = [];
      for (var i = 0; i < s.tables.length; i++) {
        var t = s.tables[i];
        var c = state.counts[t.name];
        var count;
        if (!c) count = 'not counted';
        else if (c.ok) count = num(c.n);
        else count = 'unreadable';
        var kind = 'table';
        if (/^\s*CREATE\s+VIRTUAL/i.test(t.sql || '')) kind = 'virtual';
        else if (/WITHOUT\s+ROWID/i.test(t.sql || '')) kind = 'without rowid';
        else if (t.name.indexOf('sqlite_') === 0) kind = 'internal';
        rows.push([t.name, count, kind]);
      }
      renderTable(['table', 'rows', 'kind'], rows);
      if (state.countedTo < s.tables.length) {
        out.warn('Row counting stopped after ' + state.countedTo + ' tables to keep the');
        out.warn('page responsive. The rest are counted when you open them.');
      }
      var unreadable = [];
      for (var u = 0; u < s.tables.length; u++) {
        var cc = state.counts[s.tables[u].name];
        if (cc && !cc.ok) unreadable.push(s.tables[u].name + ' — ' + cc.msg);
      }
      if (unreadable.length) {
        out.line('');
        out.err('Tables that would not read:');
        for (var e = 0; e < unreadable.length; e++) out.err('  ' + unreadable[e]);
      }
    }

    if (s.views.length) {
      out.line('');
      out.dim('views:  ' + s.views.map(function (v) { return v.name; }).join(', '));
    }
    if (s.triggers.length) {
      out.line('');
      out.dim('triggers:');
      for (var g = 0; g < s.triggers.length; g++) {
        out.line('  ' + s.triggers[g].name + '  on ' + s.triggers[g].tbl);
      }
    }
    if (s.indexes.length) {
      out.line('');
      var auto = 0;
      var named = [];
      for (var x = 0; x < s.indexes.length; x++) {
        if (s.indexes[x].sql === null) auto++;
        else named.push(s.indexes[x].name);
      }
      out.dim('indexes: ' + num(named.length) + ' declared' +
              (auto ? ', ' + num(auto) + ' created automatically for UNIQUE and PRIMARY KEY' : ''));
      if (named.length) out.dim('  ' + named.join(', '));
    }

    out.rule();
    printProfileSection();

    out.heading('Next');
    out.dim('Pick a table from the dropdown to page through it, or write SQL in');
    out.dim('the query box and run it.');
    out.line('');
    actionButton('Check integrity (quick_check)', integrityCheck);
    out.line('');
  }

  function printProfileSection() {
    if (!state.profile) {
      out.heading('Not a database this tool recognises');
      out.dim('No preset then, and no column-by-column epoch map. Columns whose');
      out.dim('names look like times still get a guessed conversion when you');
      out.dim('browse a table, and the guess is labelled in the column header.');
      out.rule();
      return;
    }
    var p = state.profile;
    out.heading('Recognised: ' + p.name);
    out.dim('matched on the table names in this file, not on its filename');
    out.line('');
    for (var i = 0; i < p.notes.length; i++) out.line('  ' + p.notes[i]);

    var mapped = [];
    var excluded = [];
    for (var key in p.times) {
      if (!Object.prototype.hasOwnProperty.call(p.times, key)) continue;
      if (!p.times[key]) { excluded.push(key); continue; }
      mapped.push(pad(key, 34) + ' → ' + EPOCHS[p.times[key]].label);
    }
    if (mapped.length) {
      out.line('');
      out.dim('timestamp columns, converted automatically when you browse:');
      for (var m = 0; m < mapped.length; m++) out.line('  ' + mapped[m], 't-ok');
    }
    if (excluded.length) {
      out.line('');
      out.dim('columns that read like times and are not:');
      for (var x = 0; x < excluded.length; x++) {
        out.line('  ' + excluded[x], 't-warn');
      }
    }

    if (p.query) {
      out.line('');
      out.dim('a query worth starting from:');
      out.line(p.query, 't-ok');
      out.line('');
      actionButton('Load this query and run it', function () {
        var box = document.getElementById('tool-sql');
        if (box) box.value = p.query;
        runQuery();
      });
      out.line('');
    }
    out.rule();
  }

  function integrityCheck() {
    if (!state.db) return;
    out.clear();
    out.heading('PRAGMA quick_check');
    out.dim('a structural check of every page and index. On a large file this');
    out.dim('takes a moment; on a carved one it is the fastest way to find out');
    out.dim('how much of it survived.');
    out.line('');
    var started = Date.now();
    try {
      var res = execFirst('PRAGMA quick_check(20)');
      var lines = res.values.map(function (r) { return String(r[0]); });
      if (lines.length === 1 && lines[0] === 'ok') {
        out.ok('ok — no structural damage found.');
      } else {
        out.err(lines.length + ' problem' + (lines.length === 1 ? '' : 's') + ' reported:');
        for (var i = 0; i < lines.length; i++) out.line('  ' + lines[i], 't-err');
        out.line('');
        out.dim('Rows in the damaged parts may still be readable; SQLite only');
        out.dim('refuses the pages it cannot parse.');
      }
    } catch (err) {
      out.err('The check itself failed: ' + String((err && err.message) || err));
    }
    out.dim('(' + (Date.now() - started) + ' ms)');
    out.line('');
    actionButton('Back to the overview', renderOverview);
  }

  function renderOverview() {
    if (!state.file) {
      out.clear().warn('Drop a database file first.');
      return;
    }
    state.table = null;
    var sel = document.getElementById('tool-tables');
    if (sel) sel.value = '';
    out.clear();
    printFileSection();
    printHeaderSection();
    printFreelistSection();
    if (state.schema) printSchemaSection();
  }

  /* ======================================================================
     Browsing one table
     ====================================================================== */

  function columnInfo(name) {
    try {
      var res = execFirst('PRAGMA table_info(' + quoteName(name) + ')');
      return res.values;
    } catch (err) {
      return [];
    }
  }

  /* Decide which columns get a decoded-date companion. A recognised profile
     wins outright; otherwise the name has to look like a time AND the values
     in this page have to decode sensibly. The chosen epoch is printed in the
     column header, because a converted timestamp with an unstated assumption
     behind it is worse than no conversion at all. */
  function timeColumns(table, columns, rows) {
    var extras = [];
    var lowerTable = String(table || '').toLowerCase();
    for (var i = 0; i < columns.length; i++) {
      var col = String(columns[i]);
      var key = null;
      var excluded = false;
      if (state.profile && lowerTable) {
        var full = lowerTable + '.' + col.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(state.profile.times, full)) {
          /* An explicit null in the map means "this reads like a time and is
             not one" — visits.visit_duration is microseconds of dwell, not an
             instant. Those columns are skipped outright rather than handed to
             the guesser, which would otherwise be free to invent a date. */
          if (!state.profile.times[full]) continue;
          key = state.profile.times[full];
        }
      } else if (state.profile && !lowerTable) {
        /* The query box has no table qualifier, so the fully-qualified lookup
           above cannot run. Resolve the bare column name against the matched
           profile instead: if exactly one mapping ends in '.<col>' use it
           (honouring an explicit null as an exclusion); if two or more map it
           to different epochs, stay ambiguous and let the guesser decide from
           the values, exactly as an unrecognised file would. */
        var suffix = '.' + col.toLowerCase();
        var pt = state.profile.times;
        var resolved;
        var resolvedSet = false;
        var conflict = false;
        for (var tk in pt) {
          if (!Object.prototype.hasOwnProperty.call(pt, tk)) continue;
          if (tk.length <= suffix.length) continue;
          if (tk.slice(tk.length - suffix.length) !== suffix) continue;
          if (!resolvedSet) { resolved = pt[tk]; resolvedSet = true; }
          else if (pt[tk] !== resolved) { conflict = true; break; }
        }
        if (resolvedSet && !conflict) {
          if (!resolved) { excluded = true; }
          else { key = resolved; }
        }
      }
      if (excluded) continue;
      if (!key) {
        if (!TIME_NAME.test(col)) continue;
        var sample = [];
        for (var r = 0; r < rows.length; r++) sample.push(rows[r][i]);
        key = guessEpoch(sample);
        if (!key) continue;
        extras.push({ index: i, key: key, label: col + ' ⇒ UTC?', guessed: true, column: col });
        continue;
      }
      extras.push({ index: i, key: key, label: col + ' ⇒ UTC', guessed: false, column: col });
    }
    return extras;
  }

  function appendTimeColumns(columns, rows, extras) {
    if (!extras.length) return { columns: columns, rows: rows };
    var newColumns = columns.slice();
    for (var e = 0; e < extras.length; e++) newColumns.push(extras[e].label);
    var newRows = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r].slice();
      for (var x = 0; x < extras.length; x++) {
        row.push(decodeTime(rows[r][extras[x].index], extras[x].key));
      }
      newRows.push(row);
    }
    return { columns: newColumns, rows: newRows };
  }

  function printTimeLegend(extras) {
    if (!extras.length) return;
    out.line('');
    for (var i = 0; i < extras.length; i++) {
      var e = extras[i];
      out.line('  ' + e.label + '  —  ' + e.column + ' read as ' + EPOCHS[e.key].label,
               e.guessed ? 't-warn' : 't-ok');
    }
    var anyGuessed = false;
    for (var g = 0; g < extras.length; g++) if (extras[g].guessed) anyGuessed = true;
    if (anyGuessed) {
      out.dim('  Columns marked ⇒ UTC? are a guess from the values on this page,');
      out.dim('  not from a known schema. Check one against a date you can');
      out.dim('  verify before you put it in a report.');
    }
  }

  function browse(name, offset) {
    if (!state.db) return;
    state.table = name;
    state.offset = offset;

    var meta = null;
    for (var i = 0; i < state.schema.tables.length; i++) {
      if (state.schema.tables[i].name === name) meta = state.schema.tables[i];
    }
    if (!meta) {
      for (var v = 0; v < state.schema.views.length; v++) {
        if (state.schema.views[v].name === name) meta = state.schema.views[v];
      }
    }

    var count = countFor(name);
    var total = count && count.ok ? count.n : null;

    out.clear();
    out.heading(name + (meta && meta.type === 'view' ? '   (view)' : ''));

    if (meta && meta.sql) {
      out.dim('CREATE statement');
      var sqlLines = String(meta.sql).split('\n');
      for (var s = 0; s < sqlLines.length && s < 60; s++) out.line('  ' + sqlLines[s]);
      if (sqlLines.length > 60) out.dim('  … ' + (sqlLines.length - 60) + ' more lines');
      out.line('');
    }

    var info = columnInfo(name);
    if (info.length) {
      out.dim('columns');
      for (var c = 0; c < info.length; c++) {
        var declared = info[c][2] ? String(info[c][2]) : '(no declared type)';
        var flags = [];
        if (info[c][5]) flags.push('PRIMARY KEY');
        if (info[c][3]) flags.push('NOT NULL');
        if (info[c][4] !== null && info[c][4] !== undefined) flags.push('DEFAULT ' + info[c][4]);
        out.line('  ' + pad(c + 1, 4) + pad(String(info[c][1]), 28) +
                 pad(declared, 18) + flags.join('  '));
      }
      out.dim('  SQLite types are advisory. A column declared INTEGER can hold a');
      out.dim('  string, and in real-world app databases it often does.');
      out.line('');
    }

    var rows = [];
    var columns = [];
    var failed = null;
    var stmt = null;
    try {
      stmt = state.db.prepare('SELECT * FROM ' + quoteName(name) + ' LIMIT ? OFFSET ?');
      stmt.bind([PAGE_ROWS, offset]);
      columns = stmt.getColumnNames();
      while (stmt.step()) rows.push(stmt.get());
    } catch (err) {
      failed = String((err && err.message) || err);
    } finally {
      // stmt.step() throws on a damaged b-tree — exactly the case the catch
      // above handles — so the statement must be freed here rather than after
      // the loop, or every retry of a broken table leaks a WASM statement.
      if (stmt) { try { stmt.free(); } catch (e) { /* already gone */ } }
    }

    if (failed) {
      out.err('That table would not read: ' + failed);
      out.dim('A damaged b-tree, or a virtual table whose module is not compiled');
      out.dim('into this build of SQLite. Other tables are unaffected.');
      return;
    }

    var extras = timeColumns(name, columns, rows);
    var shown = appendTimeColumns(columns, rows, extras);

    var last = offset + rows.length;
    out.dim('rows ' + (rows.length ? num(offset + 1) : num(offset)) + '–' + num(last) +
            (total !== null ? ' of ' + num(total) : ' (total unknown)'));
    renderTable(shown.columns, shown.rows);
    printTimeLegend(extras);
    out.line('');

    state.lastResult = { columns: shown.columns, rows: shown.rows, name: name };

    var atStart = offset <= 0;
    var atEnd = total !== null ? last >= total : rows.length < PAGE_ROWS;
    actionButton('|◀ first', function () { browse(name, 0); }, atStart);
    actionButton('◀ previous', function () {
      browse(name, Math.max(0, offset - PAGE_ROWS));
    }, atStart);
    actionButton('next ▶', function () { browse(name, offset + PAGE_ROWS); }, atEnd);
    if (total !== null) {
      actionButton('last ▶|', function () {
        var lastOffset = Math.max(0, Math.floor((total - 1) / PAGE_ROWS) * PAGE_ROWS);
        browse(name, lastOffset);
      }, atEnd);
    }
    actionButton('Save this page as CSV', function () { saveCsv(); });
    actionButton('Overview', renderOverview);
    out.line('');
    out.line('');
  }

  /* ======================================================================
     The free query box
     ====================================================================== */

  /* Crude on purpose. It looks for a write keyword at the start of a
     statement and does not try to parse SQL properly — a keyword inside a
     string literal will produce a false warning, which costs the reader one
     line of text, whereas missing a real UPDATE would cost them a wrong
     mental model of what just happened to their evidence. */
  var WRITES = /(^|;)\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|REINDEX|ATTACH|DETACH|TRUNCATE)\b/i;

  function renderResultBlock(columns, rows, label) {
    var extras = timeColumns(null, columns, rows);
    var shown = appendTimeColumns(columns, rows, extras);
    if (label) out.dim(label);
    renderTable(shown.columns, shown.rows);
    printTimeLegend(extras);
    state.lastResult = { columns: shown.columns, rows: shown.rows, name: 'query' };
  }

  function runQuery() {
    var box = document.getElementById('tool-sql');
    var text = box ? box.value : '';

    if (!state.db) {
      out.clear().warn('Open a database first — drop a .db, .sqlite or .sqlite3 file above.');
      return;
    }
    if (!text || !text.trim()) {
      out.clear().warn('Write a query first. "SELECT name FROM sqlite_master;" lists');
      out.warn('everything in the file.');
      return;
    }

    out.clear();
    out.heading('Query');
    var writes = WRITES.test(text);
    if (writes) {
      out.warn('This statement modifies the database.');
      out.dim('It is allowed — it is your file. But be clear about what it');
      out.dim('touches: SQLite is working on a copy held in this tab’s memory.');
      out.dim('The file on your disk is not opened for writing, cannot be, and is');
      out.dim('unchanged. Reload the page and the modification is gone.');
      out.dim('If this file is evidence, work on a copy and note what you ran.');
      out.line('');
    }

    var started = Date.now();
    var blocks = 0;
    var rowsTotal = 0;
    var truncated = false;
    var statements = 0;
    var it = null;

    try {
      if (typeof state.db.iterateStatements === 'function') {
        /* Stepped one row at a time so a bare `SELECT * FROM visits` costs a
           truncation notice instead of the tab. exec() would build every row
           of the result in JavaScript before returning anything. */
        it = state.db.iterateStatements(text);
        while (true) {
          var step = it.next();
          if (step.done) break;
          statements++;
          var stmt = step.value;
          var columns = stmt.getColumnNames();
          var rows = [];
          while (stmt.step()) {
            rows.push(stmt.get());
            rowsTotal++;
            if (rows.length >= QUERY_ROWS || rowsTotal >= QUERY_ROWS ||
                Date.now() - started > QUERY_MS) {
              truncated = true;
              break;
            }
          }
          if (columns.length) {
            blocks++;
            renderResultBlock(columns, rows, rows.length + (rows.length === 1 ? ' row' : ' rows'));
            out.line('');
          }
          // The iterator frees the previous statement on the next call, so
          // nothing is freed here; draining it to done releases the last one.
        }
      } else {
        // Older sql.js builds without iterateStatements. exec() has no row
        // cap, so this path says so rather than pretending otherwise.
        out.warn('This build of sql.js has no statement iterator, so the row cap');
        out.warn('cannot be applied. Add a LIMIT to large queries.');
        var res = state.db.exec(text);
        for (var i = 0; i < res.length; i++) {
          blocks++;
          rowsTotal += res[i].values.length;
          renderResultBlock(res[i].columns, res[i].values,
                            res[i].values.length + ' rows');
          out.line('');
        }
      }
    } catch (err) {
      out.err('SQLite refused it: ' + String((err && err.message) || err));
      out.line('');
      out.dim('The message is SQLite’s own. "no such table" means the name is');
      out.dim('wrong or the preset assumed a newer schema than this file has —');
      out.dim('check the table list. "no such column" is the same story one level');
      out.dim('down; PRAGMA table_info(name) prints the real column names.');
      return;
    } finally {
      // A throw inside the loop abandons the generator with a statement still
      // prepared; return() runs its cleanup and frees it. Harmless on the
      // normal path, where the generator is already drained to done.
      if (it && typeof it.return === 'function') {
        try { it.return(); } catch (e) { /* nothing more to release */ }
      }
    }

    if (!blocks) {
      out.dim(statements + ' statement' + (statements === 1 ? '' : 's') +
              ' executed. No rows returned.');
      if (writes) {
        var modified = 0;
        try { modified = state.db.getRowsModified(); } catch (e) { modified = 0; }
        out.warn(num(modified) + ' row' + (modified === 1 ? '' : 's') +
                 ' changed in the in-memory copy.');
      }
    }
    if (truncated) {
      out.warn('Stopped at ' + num(QUERY_ROWS) + ' rows or ' + (QUERY_MS / 1000) +
               ' seconds. Add a LIMIT, or narrow the query — the rest of the');
      out.warn('result was not fetched.');
    }
    out.dim('(' + (Date.now() - started) + ' ms)');

    if (writes) {
      // The schema may have changed under us. A stale dropdown pointing at a
      // dropped table is a confusing way to find that out.
      try {
        var master = execFirst("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name");
        state.schema = { tables: [], views: [], indexes: [], triggers: [] };
        for (var m = 0; m < master.values.length; m++) {
          var row = master.values[m];
          var item = { type: row[0], name: row[1], tbl: row[2], sql: row[3] };
          if (item.type === 'table') state.schema.tables.push(item);
          else if (item.type === 'view') state.schema.views.push(item);
          else if (item.type === 'index') state.schema.indexes.push(item);
          else if (item.type === 'trigger') state.schema.triggers.push(item);
        }
        state.counts = Object.create(null);
        countTables();
        fillTableSelect();
      } catch (e) { /* the schema read failing here is not worth a second error */ }
    }

    if (state.lastResult && state.lastResult.rows.length) {
      out.line('');
      actionButton('Save these rows as CSV', function () { saveCsv(); });
      actionButton('Overview', renderOverview);
      out.line('');
    }
  }

  /* ======================================================================
     CSV export
     ----------------------------------------------------------------------
     Values go out exactly as they came back, with blobs as hex. No
     sanitising of cells that begin with = + - @: a spreadsheet may treat
     those as formulas, but silently rewriting a value would mean the export
     no longer matches the database, and for evidence that is the worse of
     the two problems. Open it in something that does not evaluate formulas.
     ====================================================================== */
  function csvCell(v) {
    var s;
    if (v === null || v === undefined) s = '';
    else if (v instanceof Uint8Array) s = '0x' + LabTool.toHex(v);
    else s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function saveCsv() {
    var r = state.lastResult;
    if (!r || !r.rows.length) { out.warn('Nothing to save.'); return; }
    var lines = [r.columns.map(csvCell).join(',')];
    for (var i = 0; i < r.rows.length; i++) {
      lines.push(r.rows[i].map(csvCell).join(','));
    }
    var name = String(r.name).replace(/[^A-Za-z0-9._-]+/g, '_') + '.csv';
    LabTool.download(new TextEncoder().encode(lines.join('\r\n')), name, 'text/csv');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  var runQuerySafe = guard('The query', runQuery);
  var browseSafe = guard('Browsing that table', browse);

  LabTool.define({
    id: 'sqlitebrowsertool',
    run: runQuerySafe,
    onReady: function () {
      /* The stylesheet gives .lab-terminal `white-space: pre-wrap`, which is
         right for prose and wrong for a column-aligned table: a wrapped line
         drops half a row underneath itself and the box drawing falls apart.
         The pane is already `overflow: auto`, so switching this one pane to
         `pre` turns wrapping into horizontal scrolling. Set inline because
         the stylesheet is shared with every other tool and must not change. */
      if (out.node) out.node.style.whiteSpace = 'pre';

      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX_BYTES,
        onFile: guard('Reading that file', accept),
        onError: function (msg) { out.clear().err(msg); }
      });

      var queryBtn = document.getElementById('tool-query');
      if (queryBtn) queryBtn.addEventListener('click', runQuerySafe);

      var sel = document.getElementById('tool-tables');
      if (sel) {
        clearTableSelect();
        sel.addEventListener('change', function () {
          if (!sel.value) { guard('The overview', renderOverview)(); return; }
          browseSafe(sel.value, 0);
        });
      }

      out.dim('Drop a SQLite file above — .db, .sqlite, .sqlite3, or no extension');
      out.dim('at all. It is read and opened in this tab. There is no upload,');
      out.dim('which is the only reason it is reasonable to point this at a');
      out.dim('Chrome History file or a phone extraction.');
      out.dim('');
      out.dim('It will tell you what the database is if it recognises the schema,');
      out.dim('convert the timestamps to readable dates using the right epoch for');
      out.dim('that application, and report how many freed pages the file still');
      out.dim('carries — which is where deleted rows tend to survive.');
      out.dim('');
      out.dim('Encrypted databases will not open, and cannot: a Signal database');
      out.dim('or a WhatsApp .crypt14 has no readable header without its key.');
    }
  });
})();

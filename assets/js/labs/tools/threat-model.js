/* ==========================================================================
   threat-model.js — STRIDE, worked through properly, in a page.
   --------------------------------------------------------------------------
   Threat modelling is a conversation with a structure, and the structure is
   the only part a tool can help with. So this one does exactly that and no
   more: you describe the system as elements and trust boundaries, it proposes
   the STRIDE categories that the classic element-to-threat mapping says apply
   to each element type, and you accept, reject or rewrite every one of them.
   The thinking stays yours. What comes out is a one-page model you can print
   and a JSON file you can bring back next quarter.

   Why the proposals are a mapping and not a model of your system: STRIDE per
   element is a checklist with six rows, published by Microsoft in the early
   2000s and unchanged since, because the point of it is coverage rather than
   cleverness. An external entity can be spoofed and can repudiate. A process
   can suffer all six. A store can be tampered with, read, destroyed and — when
   it is a log — repudiated against. A flow can be tampered with, read and
   blocked. That table is the whole of the automation here, and saying so
   plainly is more useful than implying the page understood your architecture.

   Nothing is scored automatically. Likelihood and impact are three-point
   judgements a human makes, and the risk band is their product, which is
   arithmetic and not insight. A tool that produced a number on its own would
   be inventing a calibration it does not have.

   Everything lives in this tab. The model is kept in localStorage under
   'lab.threat-model' so a half-finished session survives a reload, and the
   export is a plain JSON file written by the browser. No network request is
   made from this file at any point.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var STORE_KEY = 'lab.threat-model';
  var FORMAT = 'ks-threat-model';
  var VERSION = 1;

  /* Ceilings. A threat model that needs more than sixty elements is really
     several models, and the page would stop being usable long before it
     stopped being correct. Every one of these is announced when it bites. */
  var MAX_ELEMENTS = 60;
  var MAX_BOUNDARIES = 12;
  var MAX_TEXT = 4000;
  var MAX_IMPORT = 1024 * 1024;

  /* ------------------------------------------------------------------
     1. The vocabulary
     ------------------------------------------------------------------ */

  var TYPES = [
    { k: 'entity', name: 'External entity', short: 'Entity',
      hint: 'A person or a system outside your control that talks to yours.' },
    { k: 'process', name: 'Process', short: 'Process',
      hint: 'Code you run: a service, a worker, a workflow, a scheduled script.' },
    { k: 'store', name: 'Data store', short: 'Store',
      hint: 'Anywhere data rests: a database, a bucket, a queue, a log, a mailbox.' },
    { k: 'flow', name: 'Data flow', short: 'Flow',
      hint: 'Data moving between two of the things above.' }
  ];

  var CATS = [
    { k: 'S', name: 'Spoofing', prop: 'Authentication' },
    { k: 'T', name: 'Tampering', prop: 'Integrity' },
    { k: 'R', name: 'Repudiation', prop: 'Non-repudiation' },
    { k: 'I', name: 'Information disclosure', prop: 'Confidentiality' },
    { k: 'D', name: 'Denial of service', prop: 'Availability' },
    { k: 'E', name: 'Elevation of privilege', prop: 'Authorisation' }
  ];

  /* The classic STRIDE-per-element table, and the only thing on this page that
     is applied automatically. Data-store repudiation is in the list because a
     store that is a record of events is exactly where repudiation lives; the
     proposal text says so, so it is easy to reject on a store that is not. */
  var APPLIES = {
    entity: ['S', 'R'],
    process: ['S', 'T', 'R', 'I', 'D', 'E'],
    store: ['T', 'R', 'I', 'D'],
    flow: ['T', 'I', 'D']
  };

  /* Proposal library. '%s' is the element's name. The question is the useful
     part — a threat you cannot ask a concrete question about is a category
     heading, not a threat. */
  var LIB = {
    entity: {
      S: { t: 'Someone impersonates %s',
           w: 'An attacker presents themselves as this actor. Ask what proves identity here, whether that proof can be stolen or replayed, and what happens the first time it is wrong.' },
      R: { t: '%s denies having done it',
           w: 'This actor can later say the action was not theirs. Ask what record exists, who controls that record, and whether this actor could have edited it.' }
    },
    process: {
      S: { t: 'Something impersonates %s',
           w: 'Another service, or an attacker on the path, claims to be this process to its callers or to its dependencies. Ask what a caller checks before it trusts the answer.' },
      T: { t: 'Input to %s is tampered with',
           w: 'Bodies, query strings, headers, file names and message payloads all arrive from somewhere less trusted. Ask which of them are validated, and which are passed straight into a query, a shell, a template or a deserialiser.' },
      R: { t: 'What %s did leaves no reliable record',
           w: 'Ask whether this process records who asked, what it did and when — and whether the party who might be blamed also has write access to that record.' },
      I: { t: '%s returns more than the caller should see',
           w: 'Over-broad responses, verbose errors, debug endpoints, and object ids that can be walked. Ask whether the check is on the object as well as on the route.' },
      D: { t: '%s can be exhausted or stopped',
           w: 'Unbounded work per request, no rate limit, a dependency with no timeout, or one expensive endpoint. Ask what happens when it is called a thousand times a second.' },
      E: { t: 'A caller gains privileges inside %s it should not have',
           w: 'Ask where the authorisation decision is made. If it is made in the interface rather than in this process, anyone who skips the interface skips the check.' }
    },
    store: {
      T: { t: 'Data in %s is modified without authorisation',
           w: 'Ask who and what can write here, whether that list is shorter than the read list, and whether an unauthorised change would ever be noticed.' },
      R: { t: 'Changes to %s cannot be attributed',
           w: 'This matters most when the store is, or ought to be, a record of what happened. Ask whether entries carry an actor and a time, and whether they can be edited or deleted afterwards. Reject this one if the store is not a record.' },
      I: { t: 'Data in %s is read by somebody who should not',
           w: 'Ask what is actually in here, whether it is encrypted at rest, who holds the keys, who holds the backups, and how long any of it is kept.' },
      D: { t: '%s becomes unavailable, or fills up',
           w: 'Deletion, corruption, ransomware, a full disk, an expired credential, a vendor outage. Ask when the restore was last tested, not whether a backup exists.' }
    },
    flow: {
      T: { t: 'Data on %s is modified in transit',
           w: 'Ask what protects it end to end, whether certificates are actually validated, and whether the receiver would detect a modified message.' },
      I: { t: 'Data on %s is read in transit',
           w: 'Ask what is in the payload, whether it is encrypted, and who legitimately sits in the middle — a proxy, a load balancer, a logging appliance, a vendor.' },
      D: { t: '%s is blocked or flooded',
           w: 'Ask what the sender does when this flow fails: retries forever, drops the data silently, or queues it somewhere that then fills up.' }
    }
  };

  /* Suggested mitigations, grouped by the security property the category
     attacks. These fill the text box; they do not replace writing your own,
     and a mitigation that has not been edited to fit your system is usually a
     sign the threat was accepted without being thought about. */
  var MITIGATIONS = {
    S: [
      'Require authentication on this interface — a session token, mutual TLS, or a signed request — and make the failure path loud.',
      'Use a managed identity provider rather than a local password store, so account recovery and lockout are somebody’s full-time job.',
      'Add a second factor, and bind the session to a device or a key so a stolen cookie on its own is not enough.',
      'Verify the request out of band before acting on it, for the small number of actions where being wrong is expensive.'
    ],
    T: [
      'Validate and canonicalise everything crossing this boundary against an allow-list, and reject rather than repair.',
      'Sign or MAC the data so that modification is detectable by the receiver rather than merely unlikely.',
      'Use parameterised queries and typed deserialisation; never build a query, a command or a path by joining strings.',
      'Make the store append-only, or restrict writes to a single service identity that nothing else shares.',
      'Carry the flow over TLS with certificate validation switched on, and check that it is actually on rather than assuming.'
    ],
    R: [
      'Write an append-only audit record carrying the actor, the action, the time and the source.',
      'Ship those records off the host, to storage the actor being audited cannot rewrite.',
      'Carry a request id end to end so one action can be followed across every component that touched it.',
      'Require a signed or separately approved authorisation for the handful of actions that are worth disputing.'
    ],
    I: [
      'Encrypt in transit and at rest, and be specific about who holds the keys.',
      'Return only the fields the caller needs; no wildcard reads, no debug shapes in production.',
      'Redact secrets and personal data at the logging call itself, not in a pipeline further down.',
      'Scope every credential to the smallest set of objects that will do the job.',
      'Set an explicit retention period and delete on schedule — data you no longer hold cannot be disclosed.'
    ],
    D: [
      'Rate limit per identity and per source, and return a clear error rather than falling over.',
      'Set timeouts, a retry budget and a circuit breaker on every outbound dependency.',
      'Cap request sizes, payload sizes and the work any single request can cause.',
      'Alert on quota and capacity before they are reached, and write down what degraded mode looks like.',
      'Back it up, and test the restore on a schedule — an untested backup is a plan, not a control.'
    ],
    E: [
      'Authorise every action server-side against the caller’s identity and the specific object, not against the route.',
      'Run with the least privilege the task needs, and separate the roles that do different jobs.',
      'Replace shared admin tokens with one scoped token per integration.',
      'Review permissions on a schedule and remove the ones nothing has used.'
    ]
  };

  var LEVELS = [
    { v: 1, label: 'Low' },
    { v: 2, label: 'Medium' },
    { v: 3, label: 'High' }
  ];

  var STATUSES = [
    { v: 'open', label: 'Not started' },
    { v: 'planned', label: 'Planned' },
    { v: 'mitigated', label: 'Mitigated' },
    { v: 'risk', label: 'Accepted as a risk' }
  ];

  /* ------------------------------------------------------------------
     2. Small helpers
     ------------------------------------------------------------------ */

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* Every string that reaches the model goes through here. It is the only
     length control in the file, so an imported file and a very determined
     typist are limited by the same rule. */
  function text(value) {
    var s = value == null ? '' : String(value);
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
  }

  function find(list, test) {
    for (var i = 0; i < list.length; i++) if (test(list[i])) return list[i];
    return null;
  }

  function typeInfo(k) { return find(TYPES, function (t) { return t.k === k; }) || TYPES[1]; }
  function catInfo(k) { return find(CATS, function (c) { return c.k === k; }) || CATS[0]; }

  function labelFor(e) {
    if (e && e.name && e.name.replace(/\s+/g, '')) return e.name;
    return '(unnamed ' + typeInfo(e ? e.type : 'process').short.toLowerCase() + ')';
  }

  function statusLabel(v) {
    var s = find(STATUSES, function (x) { return x.v === v; });
    return s ? s.label : STATUSES[0].label;
  }

  function riskBand(l, i) {
    var p = (l || 0) * (i || 0);
    if (!p) return { key: 'none', label: 'Not rated', score: 0 };
    if (p >= 6) return { key: 'high', label: 'High', score: p };
    if (p >= 3) return { key: 'med', label: 'Medium', score: p };
    return { key: 'low', label: 'Low', score: p };
  }

  function today() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ------------------------------------------------------------------
     3. The model
     ------------------------------------------------------------------ */

  var model = null;
  var seq = 0;
  var saveTimer = null;
  var pendingFocus = null;

  function nextId(prefix) {
    seq++;
    return prefix + seq;
  }

  /* Ids only have to be unique inside one model, so after any load the counter
     is pushed past whatever the loaded ids used. Without this an imported file
     and a newly added element could collide, and a threat would silently
     attach itself to the wrong box. */
  function reseed() {
    var max = 0;
    function look(id) {
      var m = /^[a-z](\d+)$/.exec(String(id || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    model.elements.forEach(function (e) { look(e.id); });
    model.boundaries.forEach(function (b) { look(b.id); });
    model.threats.forEach(function (t) { look(t.id); });
    seq = max;
  }

  function emptyModel() {
    return {
      name: '',
      scope: '',
      created: today(),
      boundaries: [],
      elements: [],
      threats: []
    };
  }

  function newBoundary(name) {
    return { id: nextId('b'), name: text(name || '') };
  }

  function newElement(type, name) {
    return {
      id: nextId('e'),
      type: type,
      name: text(name || ''),
      note: '',
      boundary: '',
      from: '',
      to: ''
    };
  }

  function newThreat(elementId, cat, auto) {
    return {
      id: nextId('t'),
      el: elementId,
      cat: cat,
      auto: !!auto,
      title: '',
      why: '',
      edited: false,
      decision: 'proposed',
      reason: '',
      likelihood: 0,
      impact: 0,
      mitigation: '',
      status: 'open'
    };
  }

  function elementById(id) {
    return find(model.elements, function (e) { return e.id === id; });
  }

  function threatsFor(id) {
    return model.threats.filter(function (t) { return t.el === id; });
  }

  /* Fill in the proposal text for an auto threat, unless the analyst has
     rewritten it. Titles carry the element's name, so renaming a box keeps
     every untouched proposal in step with it. */
  function fillProposal(t) {
    var e = elementById(t.el);
    if (!e) return;
    var entry = (LIB[e.type] || {})[t.cat];
    if (!entry) return;
    if (!t.edited) {
      t.title = entry.t.replace('%s', labelFor(e));
      t.why = entry.w;
    }
  }

  /* Generate the proposals the STRIDE-per-element table calls for, without
     destroying anything already decided.

     Two rules, and both matter. A proposal that already exists is left exactly
     as it is, so re-running this never overwrites a judgement. A proposal that
     no longer applies — because the element's type changed — is removed only
     while it is still undecided; once accepted or rejected it is the analyst's
     work and stays, because a decision recorded against the old shape of the
     system is still a decision somebody made and may want to revisit. */
  function syncProposals() {
    var added = 0;
    model.elements.forEach(function (e) {
      var want = APPLIES[e.type] || [];
      want.forEach(function (cat) {
        var existing = find(model.threats, function (t) {
          return t.el === e.id && t.cat === cat && t.auto;
        });
        if (!existing) {
          var t = newThreat(e.id, cat, true);
          fillProposal(t);
          model.threats.push(t);
          added++;
          return;
        }
        fillProposal(existing);
      });
    });

    model.threats = model.threats.filter(function (t) {
      var e = elementById(t.el);
      if (!e) return false;                       // element deleted
      if (!t.auto) return true;                   // added by hand, always kept
      var want = APPLIES[e.type] || [];
      if (want.indexOf(t.cat) !== -1) return true;
      return t.decision !== 'proposed';           // decided, so kept on purpose
    });

    return added;
  }

  function counts() {
    var c = { proposed: 0, accepted: 0, rejected: 0, high: 0, unrated: 0 };
    model.threats.forEach(function (t) {
      if (t.decision === 'accepted') {
        c.accepted++;
        var b = riskBand(t.likelihood, t.impact);
        if (b.key === 'high') c.high++;
        if (b.key === 'none') c.unrated++;
      } else if (t.decision === 'rejected') {
        c.rejected++;
      } else {
        c.proposed++;
      }
    });
    return c;
  }

  /* ------------------------------------------------------------------
     4. Storage — this browser, this device, nowhere else
     ------------------------------------------------------------------ */

  var storageBroken = false;

  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(exportShape()));
      } catch (err) {
        /* Private windows, a full quota, and browsers configured to refuse
           site storage all land here. The tool keeps working in memory; the
           visitor just needs to know the reload will be empty. */
        if (!storageBroken) {
          storageBroken = true;
          setStatus('This browser refuses site storage, so nothing can be saved here. The model is safe until you reload — use Export JSON.', 'err');
        }
      }
    }, 350);
  }

  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (err) { raw = null; }
    if (!raw) return false;
    try {
      var loaded = adopt(JSON.parse(raw));
      if (!loaded) return false;
      model = loaded;
      return true;
    } catch (err) {
      return false;
    }
  }

  function forget() {
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* nothing to remove, then */ }
  }

  /* ------------------------------------------------------------------
     5. Import and export
     ------------------------------------------------------------------ */

  function exportShape() {
    return {
      format: FORMAT,
      version: VERSION,
      framework: 'STRIDE per element',
      name: model.name,
      scope: model.scope,
      created: model.created,
      boundaries: model.boundaries.map(function (b) {
        return { id: b.id, name: b.name };
      }),
      elements: model.elements.map(function (e) {
        return {
          id: e.id, type: e.type, name: e.name, note: e.note,
          boundary: e.boundary, from: e.from, to: e.to
        };
      }),
      threats: model.threats.map(function (t) {
        return {
          id: t.id, element: t.el, category: t.cat, auto: t.auto,
          title: t.title, rationale: t.why, edited: t.edited,
          decision: t.decision, reason: t.reason,
          likelihood: t.likelihood, impact: t.impact,
          mitigation: t.mitigation, status: t.status
        };
      })
    };
  }

  /* Take an arbitrary parsed object and either return a model or return null.

     Everything here is defensive on purpose: the input is a file off somebody's
     disk, it may have been hand-edited, and half of a threat model is worse
     than none of one. Unknown types, dangling element references and
     out-of-range ratings are corrected rather than trusted, and the element and
     threat lists are capped at the same ceilings the editor enforces. */
  function adopt(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.format && data.format !== FORMAT) return null;

    var m = emptyModel();
    m.name = text(data.name);
    m.scope = text(data.scope);
    m.created = /^\d{4}-\d{2}-\d{2}$/.test(String(data.created || '')) ? data.created : today();

    var seen = {};
    var bList = Array.isArray(data.boundaries) ? data.boundaries : [];
    bList.slice(0, MAX_BOUNDARIES).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var id = String(b.id || '');
      if (!id || seen[id]) id = nextId('b');
      seen[id] = true;
      m.boundaries.push({ id: id, name: text(b.name) });
    });

    var eList = Array.isArray(data.elements) ? data.elements : [];
    eList.slice(0, MAX_ELEMENTS).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (!APPLIES[e.type]) return;
      var id = String(e.id || '');
      if (!id || seen[id]) id = nextId('e');
      seen[id] = true;
      m.elements.push({
        id: id, type: e.type, name: text(e.name), note: text(e.note),
        boundary: String(e.boundary || ''),
        from: String(e.from || ''), to: String(e.to || '')
      });
    });

    var haveElement = {};
    m.elements.forEach(function (e) { haveElement[e.id] = true; });
    var haveBoundary = {};
    m.boundaries.forEach(function (b) { haveBoundary[b.id] = true; });
    m.elements.forEach(function (e) {
      if (!haveBoundary[e.boundary]) e.boundary = '';
      if (!haveElement[e.from]) e.from = '';
      if (!haveElement[e.to]) e.to = '';
    });

    var tList = Array.isArray(data.threats) ? data.threats : [];
    tList.slice(0, MAX_ELEMENTS * 6).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      var owner = String(t.element || t.el || '');
      if (!haveElement[owner]) return;
      var cat = String(t.category || t.cat || '');
      if (!find(CATS, function (c) { return c.k === cat; })) return;
      var id = String(t.id || '');
      if (!id || seen[id]) id = nextId('t');
      seen[id] = true;
      var decision = t.decision;
      if (decision !== 'accepted' && decision !== 'rejected') decision = 'proposed';
      var status = find(STATUSES, function (s) { return s.v === t.status; }) ? t.status : 'open';
      m.threats.push({
        id: id, el: owner, cat: cat, auto: t.auto !== false,
        title: text(t.title), why: text(t.rationale || t.why),
        edited: !!t.edited, decision: decision, reason: text(t.reason),
        likelihood: clampLevel(t.likelihood), impact: clampLevel(t.impact),
        mitigation: text(t.mitigation), status: status
      });
    });

    return m;
  }

  function clampLevel(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 1 || n > 3) return 0;
    return n;
  }

  function slug(s) {
    var out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return out.slice(0, 48) || 'threat-model';
  }

  /* UTF-8 rather than one byte per code unit. A system name, a boundary or a
     mitigation can legitimately be written in a script that does not fit in a
     byte, and truncating it here would corrupt the file the visitor is told
     they can re-import. TextEncoder is the correct tool; the manual fallback
     exists so an engine without it produces a valid file rather than a
     mangled one. */
  function utf8(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    var esc = unescape(encodeURIComponent(str));
    var bytes = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) bytes[i] = esc.charCodeAt(i) & 0xff;
    return bytes;
  }

  function exportJson() {
    var json = JSON.stringify(exportShape(), null, 2);
    LabTool.download(utf8(json), slug(model.name) + '.threat-model.json', 'application/json');
    setStatus('Downloaded. Import it here later to carry on.', 'ok');
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT) {
      setStatus('That file is larger than 1 MB, which no threat model from this page can be.', 'err');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        setStatus('That is not valid JSON, so nothing was changed.', 'err');
        return;
      }
      var loaded = adopt(parsed);
      if (!loaded) {
        setStatus('That JSON is not a threat model exported from this page.', 'err');
        return;
      }
      model = loaded;
      reseed();
      syncProposals();
      save();
      renderAll();
      setStatus('Loaded ' + model.elements.length + ' elements and ' +
                model.threats.length + ' threats.', 'ok');
    };
    reader.onerror = function () {
      setStatus('That file could not be read.', 'err');
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------
     6. The two worked examples
     ------------------------------------------------------------------ */

  var EXAMPLES = {
    saas: {
      name: 'Small SaaS with a third-party payment provider',
      scope: 'In scope: the web application, the billing worker, the customer database, the application logs, and the calls we make to the payment provider.\n\nOut of scope: the payment provider’s own systems, the cloud provider’s infrastructure, and the devices our customers use. Out of scope does not mean safe. It means somebody else owns it, and we should be able to say what we are relying on them for.',
      boundaries: ['Public internet', 'Our cloud account', 'Payment provider'],
      elements: [
        { r: 'cust', t: 'entity', n: 'Customer', b: 0, note: 'Signs up, signs in, pays, asks for refunds.' },
        { r: 'pay', t: 'entity', n: 'Payment provider API', b: 2, note: 'Holds the card data so that we do not have to.' },
        { r: 'web', t: 'process', n: 'Web application', b: 1, note: 'Public HTTPS front end: sessions, checkout, account pages, webhook receiver.' },
        { r: 'bill', t: 'process', n: 'Billing worker', b: 1, note: 'Background jobs — charges, refunds, retries, dunning.' },
        { r: 'db', t: 'store', n: 'Customer database', b: 1, note: 'Names, emails, addresses, subscription state. Deliberately no card numbers.' },
        { r: 'log', t: 'store', n: 'Application logs', b: 1, note: 'Request logs and job history, kept for thirty days.' },
        { r: 'f1', t: 'flow', n: 'Sign-in and checkout requests', from: 'cust', to: 'web' },
        { r: 'f2', t: 'flow', n: 'Card entry, redirected to the provider', from: 'cust', to: 'pay' },
        { r: 'f3', t: 'flow', n: 'Charge and refund calls', from: 'bill', to: 'pay' },
        { r: 'f4', t: 'flow', n: 'Payment webhooks', from: 'pay', to: 'web' },
        { r: 'f5', t: 'flow', n: 'Customer reads and writes', from: 'web', to: 'db' },
        { r: 'f6', t: 'flow', n: 'Job and audit writes', from: 'bill', to: 'log' }
      ],
      decisions: [
        { r: 'f4', c: 'T', d: 'accepted', l: 3, i: 3, s: 'planned',
          m: 'Verify the provider’s webhook signature on every call and reject anything unsigned. Treat the webhook as a hint that something changed, then re-read the authoritative state from the provider API rather than trusting the body we were handed.' },
        { r: 'cust', c: 'S', d: 'accepted', l: 3, i: 2, s: 'mitigated',
          m: 'Password plus TOTP, rate limiting on sign-in per account and per source address, and a session cookie bound to the device so that a stolen cookie on its own is not enough.' },
        { r: 'db', c: 'I', d: 'accepted', l: 2, i: 3, s: 'mitigated',
          m: 'Encrypted at rest with keys held by the cloud KMS rather than in the application. Card numbers stay out entirely because the provider’s hosted fields collect them. The read role is granted to two services and nothing else, and closed accounts are deleted after ninety days.' },
        { r: 'web', c: 'E', d: 'accepted', l: 2, i: 3, s: 'planned',
          m: 'Authorise every action server-side against the session identity and the specific object, not against the route. Add a regression test that swapping a customer id in the URL returns 404 and not the other customer.' },
        { r: 'bill', c: 'R', d: 'accepted', l: 2, i: 2, s: 'open',
          m: 'Append-only record of every charge and refund carrying the actor, the amount, the provider reference and the time, shipped off the host within a minute so that the worker cannot rewrite its own history.' },
        { r: 'f3', c: 'D', d: 'accepted', l: 2, i: 2, s: 'planned',
          m: 'A timeout, bounded retries with backoff, and a dead-letter queue, so that a provider outage delays billing rather than losing it.' },
        { r: 'log', c: 'I', d: 'accepted', l: 3, i: 2, s: 'planned',
          m: 'Redact tokens, session ids and email addresses at the logging call itself rather than in a pipeline downstream, and read one day of logs by hand each quarter to check that the redaction still holds.' },
        { r: 'pay', c: 'R', d: 'rejected',
          why: 'The provider gives us a signed, immutable transaction record and we reconcile against it every day. If their records and ours disagree we find out within a day, which is the control that actually matters here.' },
        { r: 'f2', c: 'I', d: 'rejected',
          why: 'Card details never reach our servers: the field belongs to the provider, in an iframe, on their origin. This is the whole reason we chose a redirect flow, so recording that the decision was deliberate is worth more than the threat.' }
      ]
    },

    automation: {
      name: 'Internal automation workflow touching a CRM',
      scope: 'This is my own consulting work, modelled honestly rather than flatteringly. In scope: the automation host I run, the workflow on it, the credentials it holds, and every call it makes out to a client’s shared mailbox, their CRM, and a language-model API.\n\nOut of scope: the client’s own network, the vendors’ internals, and what the client does with the output afterwards.\n\nThe uncomfortable part of this model is that almost every asset in it belongs to somebody else, and I am the one holding the keys to all of them.',
      boundaries: ['Public internet', 'My laptop', 'Automation host', 'Client and vendor SaaS'],
      elements: [
        { r: 'prospect', t: 'entity', n: 'Person emailing the client', b: 0, note: 'Anyone who can send mail to the shared inbox. Entirely untrusted, by definition.' },
        { r: 'me', t: 'entity', n: 'Me, operating the workflow', b: 1, note: 'Edits workflows, holds the admin login, reads the run history.' },
        { r: 'llm', t: 'entity', n: 'Language model API', b: 3, note: 'Third party. Receives message text and returns a draft reply.' },
        { r: 'n8n', t: 'process', n: 'Workflow engine', b: 2, note: 'Self-hosted. Triggers on new mail, runs the steps, calls the CRM.' },
        { r: 'draft', t: 'process', n: 'Draft-reply step', b: 2, note: 'Builds a prompt from the message and the CRM record, calls the model, returns text for a human to approve.' },
        { r: 'creds', t: 'store', n: 'Workflow credential store', b: 2, note: 'Mailbox token, CRM API key, model API key. The crown jewels of this design.' },
        { r: 'mbox', t: 'store', n: 'Client shared mailbox', b: 3, note: 'Vendor-hosted. Not mine, and not on the client’s own server either.' },
        { r: 'crm', t: 'store', n: 'CRM contact records', b: 3, note: 'Names, phone numbers, deal notes. Client-owned personal data.' },
        { r: 'runs', t: 'store', n: 'Run history', b: 2, note: 'Every execution, storing the full input and output of each step by default.' },
        { r: 'g1', t: 'flow', n: 'Inbound email', from: 'prospect', to: 'mbox' },
        { r: 'g2', t: 'flow', n: 'Mailbox polling', from: 'mbox', to: 'n8n' },
        { r: 'g3', t: 'flow', n: 'Message text sent to the model', from: 'draft', to: 'llm' },
        { r: 'g4', t: 'flow', n: 'Contact create and update calls', from: 'n8n', to: 'crm' },
        { r: 'g5', t: 'flow', n: 'Admin access to the workflow editor', from: 'me', to: 'n8n' }
      ],
      decisions: [
        { r: 'creds', c: 'I', d: 'accepted', l: 2, i: 3, s: 'planned',
          m: 'Encryption key held on the host, outside the workflow database and out of the repository. A separate credential set per client, so that one leak is one client rather than all of them. A written revocation runbook, rehearsed once before the first client goes live.' },
        { r: 'me', c: 'S', d: 'accepted', l: 2, i: 3, s: 'mitigated',
          m: 'The editor is not reachable from the public internet; getting to it means the VPN first. Login is a passkey rather than a password. This single account can read every client’s credentials, so it gets the strongest control available and not the most convenient one.' },
        { r: 'runs', c: 'I', d: 'accepted', l: 3, i: 3, s: 'planned',
          m: 'Turn off full-payload run logging on production workflows, keep step names and outcomes only, and set a short retention. Left at the default, the run history quietly becomes a second copy of the client’s inbox on a machine the client has never heard of.' },
        { r: 'g3', c: 'I', d: 'accepted', l: 3, i: 2, s: 'planned',
          m: 'Strip signatures, phone numbers and account references before the prompt is built, and send the minimum the draft needs. Use an endpoint with a no-training commitment, and tell the client in writing which text leaves their tenancy and where it goes.' },
        { r: 'draft', c: 'T', d: 'accepted', l: 3, i: 2, s: 'mitigated',
          m: 'Treat the email body as hostile text and never as instructions. Model output goes to a human for approval and can never trigger a send or a CRM write on its own. Prompt injection is not hypothetical here — the input is literally mail from strangers.' },
        { r: 'n8n', c: 'E', d: 'accepted', l: 2, i: 3, s: 'open',
          m: 'One scoped API key per integration with the narrowest permission set the workflow actually uses, instead of one admin key reused everywhere because it was quicker. Review each quarter what every key can still do.' },
        { r: 'crm', c: 'T', d: 'accepted', l: 2, i: 2, s: 'planned',
          m: 'Writes limited to the fields the workflow owns, an idempotency key on every call so a retry cannot duplicate a contact, and a dry-run mode for the first week on any new client.' },
        { r: 'n8n', c: 'R', d: 'accepted', l: 2, i: 2, s: 'open',
          m: 'Ship execution records to storage the automation host cannot rewrite, so that when a client asks in six months why a contact changed, the answer does not depend on the same machine that changed it.' },
        { r: 'prospect', c: 'S', d: 'rejected',
          why: 'Anyone can send mail claiming to be anyone; that is email. The design already assumes the sender is unverified and nothing downstream acts on identity without a human in the way. Worth recording that this was considered and deliberately not defended against here.' },
        { r: 'g1', c: 'D', d: 'rejected',
          why: 'If the client’s mailbox is flooded, that is their mail provider’s problem and their existing filtering. The workflow degrades to doing nothing, which is the correct failure for it.' }
      ]
    }
  };

  function loadExample(key) {
    var spec = EXAMPLES[key];
    if (!spec) return;
    model = emptyModel();
    model.name = spec.name;
    model.scope = spec.scope;

    spec.boundaries.forEach(function (name) {
      model.boundaries.push(newBoundary(name));
    });

    var ref = {};
    spec.elements.forEach(function (row) {
      var e = newElement(row.t, row.n);
      e.note = text(row.note || '');
      if (typeof row.b === 'number' && model.boundaries[row.b]) {
        e.boundary = model.boundaries[row.b].id;
      }
      ref[row.r] = e;
      model.elements.push(e);
    });
    spec.elements.forEach(function (row) {
      if (row.t !== 'flow') return;
      var e = ref[row.r];
      e.from = ref[row.from] ? ref[row.from].id : '';
      e.to = ref[row.to] ? ref[row.to].id : '';
    });

    syncProposals();

    spec.decisions.forEach(function (d) {
      var owner = ref[d.r];
      if (!owner) return;
      var t = find(model.threats, function (x) {
        return x.el === owner.id && x.cat === d.c;
      });
      if (!t) return;
      t.decision = d.d;
      if (d.d === 'accepted') {
        t.likelihood = d.l || 0;
        t.impact = d.i || 0;
        t.mitigation = text(d.m || '');
        t.status = d.s || 'open';
      } else {
        t.reason = text(d.why || '');
      }
    });

    save();
    renderAll();
    var c = counts();
    setStatus('Loaded. ' + c.accepted + ' accepted and ' + c.rejected +
              ' rejected already, ' + c.proposed + ' still waiting on you.', 'ok');
    selectTab(0);
  }

  /* ------------------------------------------------------------------
     7. Rendering — the system panel
     ------------------------------------------------------------------ */

  var statusNode = null;

  function setStatus(message, kind) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.className = 'lab-status' + (kind ? ' is-' + kind : '');
  }

  function boundaryName(id) {
    var b = find(model.boundaries, function (x) { return x.id === id; });
    if (!b) return '';
    return b.name.replace(/\s+/g, '') ? b.name : 'Unnamed boundary';
  }

  function option(value, label, selected) {
    var o = el('option', null, label);
    o.value = value;
    if (selected) o.selected = true;
    return o;
  }

  function wrapField(labelText, control, cls) {
    var l = el('label', 'tm-lbl' + (cls ? ' ' + cls : ''));
    l.appendChild(el('span', null, labelText));
    l.appendChild(control);
    return l;
  }

  function renderBoundaries() {
    var host = byId('tm-boundaries');
    host.textContent = '';
    if (!model.boundaries.length) {
      host.appendChild(el('li', 'tm-empty',
        'No boundaries yet. Most systems have at least two: the outside world, and whatever you run.'));
      return;
    }
    model.boundaries.forEach(function (b) {
      var li = el('li', 'tm-brow');
      li.setAttribute('data-b', b.id);

      var input = el('input', 'lab-toolfield');
      input.type = 'text';
      input.value = b.name;
      input.placeholder = 'e.g. Public internet';
      input.setAttribute('data-role', 'bname');
      input.spellcheck = false;
      input.addEventListener('input', function () {
        b.name = text(input.value);
        // The element rows carry this boundary in a <select>; retarget just
        // those options rather than rebuilding the panel under the cursor.
        var opts = document.querySelectorAll('.tm-el option[value="' + b.id + '"]');
        Array.prototype.forEach.call(opts, function (o) {
          o.textContent = boundaryName(b.id);
        });
        save();
      });
      input.addEventListener('change', refreshDerived);
      li.appendChild(wrapField('Trust boundary', input, 'tm-lbl-grow'));

      var del = el('button', 'lab-btn tm-del', 'Remove');
      del.type = 'button';
      del.setAttribute('aria-label', 'Remove trust boundary ' + (b.name || 'unnamed'));
      del.addEventListener('click', function () {
        model.boundaries = model.boundaries.filter(function (x) { return x.id !== b.id; });
        model.elements.forEach(function (e) {
          if (e.boundary === b.id) e.boundary = '';
        });
        pendingFocus = '#tm-add-boundary';
        save();
        renderAll();
        setStatus('Boundary removed. Anything that was inside it now has no boundary set.', null);
      });
      li.appendChild(del);
      host.appendChild(li);
    });
  }

  function renderElementRow(e) {
    var li = el('li', 'tm-el tm-el--' + e.type);
    li.setAttribute('data-el', e.id);

    var head = el('div', 'tm-el-head');
    head.appendChild(el('span', 'tm-badge tm-badge--' + e.type, typeInfo(e.type).short));

    var del = el('button', 'lab-btn tm-del', 'Remove');
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove ' + typeInfo(e.type).name + ' ' + labelFor(e));
    del.addEventListener('click', function () {
      removeElement(e.id);
    });

    var name = el('input', 'lab-toolfield');
    name.type = 'text';
    name.value = e.name;
    name.spellcheck = false;
    name.setAttribute('data-role', 'name');
    name.placeholder = e.type === 'flow'
      ? 'What moves, e.g. Payment webhooks'
      : 'Name it as your team says it out loud';
    name.addEventListener('input', function () {
      e.name = text(name.value);
      del.setAttribute('aria-label', 'Remove ' + typeInfo(e.type).name + ' ' + labelFor(e));
      save();
    });
    name.addEventListener('change', function () {
      refreshDerived();
      renderThreats();
    });
    head.appendChild(wrapField(typeInfo(e.type).name + ' name', name, 'tm-lbl-grow'));
    head.appendChild(del);
    li.appendChild(head);

    var row = el('div', 'tm-el-row');

    var type = el('select', 'lab-select');
    type.setAttribute('data-role', 'type');
    TYPES.forEach(function (t) {
      type.appendChild(option(t.k, t.name, t.k === e.type));
    });
    type.addEventListener('change', function () {
      e.type = type.value;
      if (e.type === 'flow') e.boundary = '';
      else { e.from = ''; e.to = ''; }
      pendingFocus = '[data-el="' + e.id + '"] [data-role="type"]';
      syncProposals();
      save();
      renderAll();
    });
    row.appendChild(wrapField('Type', type));

    if (e.type === 'flow') {
      var nodes = model.elements.filter(function (x) { return x.type !== 'flow'; });
      ['from', 'to'].forEach(function (end) {
        var sel = el('select', 'lab-select');
        sel.setAttribute('data-role', end);
        sel.appendChild(option('', 'Not set yet', !e[end]));
        nodes.forEach(function (n) {
          sel.appendChild(option(n.id, labelFor(n), n.id === e[end]));
        });
        sel.addEventListener('change', function () {
          e[end] = sel.value;
          save();
          refreshDerived();
        });
        row.appendChild(wrapField(end === 'from' ? 'From' : 'To', sel));
      });
    } else {
      var bsel = el('select', 'lab-select');
      bsel.setAttribute('data-role', 'boundary');
      bsel.appendChild(option('', 'No boundary set', !e.boundary));
      model.boundaries.forEach(function (b) {
        bsel.appendChild(option(b.id, boundaryName(b.id), b.id === e.boundary));
      });
      bsel.addEventListener('change', function () {
        e.boundary = bsel.value;
        save();
        refreshDerived();
      });
      row.appendChild(wrapField('Sits inside', bsel));
    }
    li.appendChild(row);

    var note = el('input', 'lab-toolfield');
    note.type = 'text';
    note.value = e.note;
    note.spellcheck = false;
    note.placeholder = e.type === 'store'
      ? 'What is in it, and how long it is kept'
      : 'What it does, in one line';
    note.addEventListener('input', function () {
      e.note = text(note.value);
      save();
    });
    note.addEventListener('change', refreshDerived);
    li.appendChild(wrapField('Note', note, 'tm-lbl-grow tm-lbl-block'));

    return li;
  }

  function removeElement(id) {
    var e = elementById(id);
    if (!e) return;
    model.elements = model.elements.filter(function (x) { return x.id !== id; });
    model.elements.forEach(function (x) {
      if (x.from === id) x.from = '';
      if (x.to === id) x.to = '';
    });
    model.threats = model.threats.filter(function (t) { return t.el !== id; });
    pendingFocus = '#tm-add-process';
    save();
    renderAll();
    setStatus('Removed ' + labelFor(e) + ' and every threat recorded against it.', null);
  }

  function renderElements() {
    var host = byId('tm-elements');
    host.textContent = '';
    if (!model.elements.length) {
      host.appendChild(el('li', 'tm-empty',
        'Nothing yet. Start with the things that talk to each other, then add the flows between them.'));
      return;
    }
    var nodes = model.elements.filter(function (e) { return e.type !== 'flow'; });
    var flows = model.elements.filter(function (e) { return e.type === 'flow'; });
    nodes.forEach(function (e) { host.appendChild(renderElementRow(e)); });
    if (flows.length) {
      var head = el('li', 'tm-listhead', 'Data flows');
      host.appendChild(head);
      flows.forEach(function (e) { host.appendChild(renderElementRow(e)); });
    }
  }

  function addElement(type) {
    if (model.elements.length >= MAX_ELEMENTS) {
      setStatus('This page stops at ' + MAX_ELEMENTS + ' elements. A system that needs more is really several models.', 'err');
      return;
    }
    var e = newElement(type, '');
    model.elements.push(e);
    syncProposals();
    pendingFocus = '[data-el="' + e.id + '"] [data-role="name"]';
    save();
    renderAll();
    setStatus('Added a ' + typeInfo(type).name.toLowerCase() + '. Name it, then check the proposals in step 2.', null);
  }

  /* The boundary map is drawn from the model rather than positioned by hand.
     A diagram you have to lay out is a second job; a grouping you can read at
     a glance answers the question that matters here, which is what sits where
     and which flows cross a line. */
  function renderMap() {
    var host = byId('tm-map');
    host.textContent = '';
    var nodes = model.elements.filter(function (e) { return e.type !== 'flow'; });
    var flows = model.elements.filter(function (e) { return e.type === 'flow'; });

    if (!nodes.length) {
      host.appendChild(el('p', 'tm-empty', 'The map appears once there is something on it.'));
      return;
    }

    var groups = el('div', 'tm-map-groups');
    var buckets = model.boundaries.map(function (b) {
      return { id: b.id, name: boundaryName(b.id) };
    });
    buckets.push({ id: '', name: 'No boundary set' });

    buckets.forEach(function (bucket) {
      var inside = nodes.filter(function (n) { return n.boundary === bucket.id; });
      if (!inside.length && bucket.id === '') return;
      var group = el('div', 'tm-map-group');
      group.appendChild(el('p', 'tm-map-title', bucket.name));
      var ul = el('ul', 'tm-chips');
      if (!inside.length) {
        ul.appendChild(el('li', 'tm-chip tm-chip--empty', 'nothing in here yet'));
      }
      inside.forEach(function (n) {
        var li = el('li', 'tm-chip tm-chip--' + n.type);
        li.appendChild(el('span', 'tm-chip-k', typeInfo(n.type).short));
        li.appendChild(el('span', null, labelFor(n)));
        ul.appendChild(li);
      });
      group.appendChild(ul);
      groups.appendChild(group);
    });
    host.appendChild(groups);

    if (!flows.length) return;
    var list = el('ul', 'tm-flows');
    flows.forEach(function (f) {
      var a = elementById(f.from);
      var b = elementById(f.to);
      var li = el('li', 'tm-flow');
      var line = el('p', 'tm-flow-line');
      line.appendChild(el('span', 'tm-flow-name', labelFor(f)));
      line.appendChild(el('span', 'tm-flow-path',
        (a ? labelFor(a) : 'not set') + ' → ' + (b ? labelFor(b) : 'not set')));
      li.appendChild(line);
      if (a && b && a.boundary !== b.boundary) {
        li.appendChild(el('p', 'tm-flow-cross',
          'Crosses a trust boundary: ' + (boundaryName(a.boundary) || 'no boundary set') +
          ' → ' + (boundaryName(b.boundary) || 'no boundary set')));
      } else if (!a || !b) {
        li.appendChild(el('p', 'tm-flow-warn', 'Both ends need setting before this flow means anything.'));
      }
      list.appendChild(li);
    });
    host.appendChild(el('p', 'tm-map-title', 'Data flows'));
    host.appendChild(list);
  }

  /* ------------------------------------------------------------------
     8. Rendering — the threats panel
     ------------------------------------------------------------------ */

  function renderTally() {
    var c = counts();
    var host = byId('tm-tally');
    host.textContent = '';
    function stat(n, label, cls) {
      var d = el('span', 'tm-stat' + (cls ? ' ' + cls : ''));
      d.appendChild(el('b', null, String(n)));
      d.appendChild(el('span', null, ' ' + label));
      return d;
    }
    host.appendChild(stat(c.proposed, 'still undecided'));
    host.appendChild(stat(c.accepted, 'accepted', 'is-accepted'));
    host.appendChild(stat(c.rejected, 'rejected', 'is-rejected'));
    host.appendChild(stat(c.high, 'rated high risk', 'is-high'));
    if (c.unrated) host.appendChild(stat(c.unrated, 'accepted but unrated', 'is-warn'));

    var badge = byId('tm-tab-threats-n');
    if (badge) badge.textContent = c.proposed ? String(c.proposed) : '';
  }

  function replaceCard(t) {
    var old = document.querySelector('[data-threat="' + t.id + '"]');
    if (!old || !old.parentNode) { renderThreats(); return; }
    var fresh = renderThreatCard(t);
    old.parentNode.replaceChild(fresh, old);
    renderTally();
  }

  function renderThreatCard(t) {
    var li = el('li', 'tm-threat is-' + t.decision);
    li.setAttribute('data-threat', t.id);

    var head = el('div', 'tm-threat-head');
    var cat = catInfo(t.cat);
    var badge = el('span', 'tm-cat tm-cat--' + t.cat);
    badge.appendChild(el('b', null, t.cat));
    badge.appendChild(el('span', null, ' ' + cat.name));
    badge.title = cat.name + ' — attacks ' + cat.prop.toLowerCase();
    head.appendChild(badge);
    if (!t.auto) head.appendChild(el('span', 'tm-tag', 'added by hand'));
    if (t.decision === 'accepted') {
      var band = riskBand(t.likelihood, t.impact);
      var risk = el('span', 'tm-risk tm-risk--' + band.key,
        band.key === 'none' ? 'Not rated' : band.label + ' risk');
      head.appendChild(risk);
      head.appendChild(el('span', 'tm-tag', statusLabel(t.status)));
    }
    li.appendChild(head);

    var title = el('input', 'lab-toolfield tm-threat-title');
    title.type = 'text';
    title.value = t.title;
    title.placeholder = 'What could go wrong here';
    title.addEventListener('input', function () {
      t.title = text(title.value);
      t.edited = true;
      save();
    });
    title.addEventListener('change', renderReport);
    li.appendChild(wrapField('Threat', title, 'tm-lbl-grow tm-lbl-block'));

    if (t.why) li.appendChild(el('p', 'tm-why', t.why));

    var actions = el('div', 'tm-threat-actions');
    function decide(value, label) {
      var b = el('button', 'lab-btn tm-decide tm-decide--' + value, label);
      b.type = 'button';
      b.setAttribute('data-decide', value);
      b.setAttribute('aria-pressed', String(t.decision === value));
      b.addEventListener('click', function () {
        t.decision = t.decision === value ? 'proposed' : value;
        save();
        replaceCard(t);
        renderReport();
        var again = document.querySelector('[data-threat="' + t.id + '"] [data-decide="' + value + '"]');
        if (again) again.focus();
      });
      return b;
    }
    actions.appendChild(decide('accepted', 'Accept'));
    actions.appendChild(decide('rejected', 'Reject'));
    li.appendChild(actions);

    if (t.decision === 'rejected') {
      var reason = el('textarea', 'lab-toolfield tm-textarea');
      reason.rows = 2;
      reason.value = t.reason;
      reason.placeholder = 'Why it does not apply here. This is the most valuable line in the whole model six months from now.';
      reason.addEventListener('input', function () {
        t.reason = text(reason.value);
        save();
      });
      reason.addEventListener('change', renderReport);
      li.appendChild(wrapField('Why not', reason, 'tm-lbl-grow tm-lbl-block'));
    }

    if (t.decision === 'accepted') {
      var rate = el('div', 'tm-rate');

      function levelSelect(field, labelText) {
        var sel = el('select', 'lab-select');
        sel.appendChild(option('0', 'Not rated', !t[field]));
        LEVELS.forEach(function (lv) {
          sel.appendChild(option(String(lv.v), lv.label, t[field] === lv.v));
        });
        sel.addEventListener('change', function () {
          t[field] = clampLevel(sel.value);
          save();
          replaceCard(t);
          renderReport();
        });
        return wrapField(labelText, sel);
      }
      rate.appendChild(levelSelect('likelihood', 'Likelihood'));
      rate.appendChild(levelSelect('impact', 'Impact'));

      var st = el('select', 'lab-select');
      STATUSES.forEach(function (s) {
        st.appendChild(option(s.v, s.label, s.v === t.status));
      });
      st.addEventListener('change', function () {
        t.status = st.value;
        save();
        replaceCard(t);
        renderReport();
      });
      rate.appendChild(wrapField('Status', st));
      li.appendChild(rate);

      var suggest = el('select', 'lab-select tm-suggest');
      suggest.appendChild(option('', 'Suggest a mitigation…', true));
      (MITIGATIONS[t.cat] || []).forEach(function (m, i) {
        suggest.appendChild(option(String(i), m.length > 74 ? m.slice(0, 74) + '…' : m));
      });
      suggest.addEventListener('change', function () {
        var pick = MITIGATIONS[t.cat][parseInt(suggest.value, 10)];
        suggest.selectedIndex = 0;
        if (!pick) return;
        var box = li.querySelector('[data-role="mitigation"]');
        box.value = t.mitigation
          ? t.mitigation.replace(/\s*$/, '') + '\n' + pick
          : pick;
        t.mitigation = text(box.value);
        save();
        renderReport();
        box.focus();
      });
      li.appendChild(wrapField('Library', suggest, 'tm-lbl-block'));

      var mit = el('textarea', 'lab-toolfield tm-textarea');
      mit.rows = 3;
      mit.value = t.mitigation;
      mit.setAttribute('data-role', 'mitigation');
      mit.placeholder = 'What you will actually do about it. Pick from the library above and then edit it until it describes your system.';
      mit.addEventListener('input', function () {
        t.mitigation = text(mit.value);
        save();
      });
      mit.addEventListener('change', renderReport);
      li.appendChild(wrapField('Mitigation', mit, 'tm-lbl-grow tm-lbl-block'));
    }

    return li;
  }

  function renderThreats() {
    var host = byId('tm-threats');
    host.textContent = '';
    renderTally();

    if (!model.elements.length) {
      host.appendChild(el('p', 'tm-empty',
        'Add something in step 1 and the proposals appear here.'));
      return;
    }

    model.elements.forEach(function (e) {
      var group = el('section', 'tm-group');
      var h = el('h4', 'tm-group-h');
      h.appendChild(el('span', 'tm-badge tm-badge--' + e.type, typeInfo(e.type).short));
      h.appendChild(el('span', null, ' ' + labelFor(e)));
      group.appendChild(h);

      if (e.type === 'flow') {
        var a = elementById(e.from), b = elementById(e.to);
        group.appendChild(el('p', 'tm-group-sub',
          (a ? labelFor(a) : 'not set') + ' → ' + (b ? labelFor(b) : 'not set')));
      } else if (e.boundary) {
        group.appendChild(el('p', 'tm-group-sub', 'Inside ' + boundaryName(e.boundary)));
      }

      var list = el('ul', 'tm-threatlist');
      var mine = threatsFor(e.id);
      if (!mine.length) {
        list.appendChild(el('li', 'tm-empty', 'No proposals for this element.'));
      }
      mine.forEach(function (t) { list.appendChild(renderThreatCard(t)); });
      group.appendChild(list);

      var add = el('div', 'tm-addthreat');
      var pick = el('select', 'lab-select');
      pick.appendChild(option('', 'Add a threat of your own…', true));
      CATS.forEach(function (c) {
        pick.appendChild(option(c.k, c.k + ' — ' + c.name));
      });
      pick.addEventListener('change', function () {
        if (!pick.value) return;
        var t = newThreat(e.id, pick.value, false);
        t.decision = 'accepted';
        t.edited = true;
        model.threats.push(t);
        save();
        renderThreats();
        var box = document.querySelector('[data-threat="' + t.id + '"] .tm-threat-title');
        if (box) box.focus();
      });
      add.appendChild(wrapField('Something the table did not propose', pick, 'tm-lbl-block'));
      group.appendChild(add);

      host.appendChild(group);
    });
  }

  /* ------------------------------------------------------------------
     9. Rendering — the printable model
     ------------------------------------------------------------------ */

  function reportSection(title) {
    var s = el('section', 'tm-rsec');
    s.appendChild(el('h4', 'tm-rsec-h', title));
    return s;
  }

  function paragraphs(host, value) {
    String(value || '').split(/\n{2,}/).forEach(function (chunk) {
      var line = chunk.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (line) host.appendChild(el('p', 'tm-rtext', line));
    });
  }

  function cell(row, value, cls, header) {
    var c = el(header ? 'th' : 'td', cls || null, value);
    if (header) c.scope = 'col';
    row.appendChild(c);
    return c;
  }

  function renderReport() {
    var host = byId('tm-report');
    if (!host) return;
    host.textContent = '';
    var c = counts();

    var head = el('header', 'tm-rhead');
    head.appendChild(el('p', 'tm-rkicker', 'STRIDE threat model'));
    head.appendChild(el('h3', 'tm-rtitle', model.name || 'Untitled system'));
    head.appendChild(el('p', 'tm-rmeta',
      'Drafted ' + model.created + ' · ' + model.elements.length + ' elements · ' +
      model.boundaries.length + ' trust boundaries · ' + c.accepted + ' threats accepted · ' +
      c.rejected + ' rejected · ' + c.proposed + ' still undecided'));
    host.appendChild(head);

    if (model.scope) {
      var scope = reportSection('Scope');
      paragraphs(scope, model.scope);
      host.appendChild(scope);
    }

    var nodes = model.elements.filter(function (e) { return e.type !== 'flow'; });
    var flows = model.elements.filter(function (e) { return e.type === 'flow'; });

    if (nodes.length) {
      var sys = reportSection('The system');
      var wrap = el('div', 'tm-tablewrap');
      var table = el('table', 'tm-table');
      var thead = el('thead');
      var hr = el('tr');
      cell(hr, 'Element', null, true);
      cell(hr, 'Type', null, true);
      cell(hr, 'Trust boundary', null, true);
      cell(hr, 'Note', null, true);
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el('tbody');
      nodes.forEach(function (e) {
        var r = el('tr');
        cell(r, labelFor(e));
        cell(r, typeInfo(e.type).name);
        cell(r, boundaryName(e.boundary) || '—');
        cell(r, e.note || '—');
        tbody.appendChild(r);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      sys.appendChild(wrap);
      host.appendChild(sys);
    }

    if (flows.length) {
      var fs = reportSection('Data flows');
      var fwrap = el('div', 'tm-tablewrap');
      var ftable = el('table', 'tm-table');
      var fhead = el('thead');
      var fhr = el('tr');
      cell(fhr, 'Flow', null, true);
      cell(fhr, 'From', null, true);
      cell(fhr, 'To', null, true);
      cell(fhr, 'Crosses a boundary', null, true);
      fhead.appendChild(fhr);
      ftable.appendChild(fhead);
      var fbody = el('tbody');
      flows.forEach(function (f) {
        var a = elementById(f.from), b = elementById(f.to);
        var r = el('tr');
        cell(r, labelFor(f));
        cell(r, a ? labelFor(a) : '—');
        cell(r, b ? labelFor(b) : '—');
        cell(r, a && b && a.boundary !== b.boundary ? 'Yes' : (a && b ? 'No' : 'Incomplete'));
        fbody.appendChild(r);
      });
      ftable.appendChild(fbody);
      fwrap.appendChild(ftable);
      fs.appendChild(fwrap);
      host.appendChild(fs);
    }

    var accepted = model.threats.filter(function (t) { return t.decision === 'accepted'; });
    /* Highest risk first, because the point of the page is what to do next.
       Ties keep model order, which is the order the analyst built the system
       in and therefore the order they think about it in. */
    accepted.sort(function (a, b) {
      return riskBand(b.likelihood, b.impact).score - riskBand(a.likelihood, a.impact).score;
    });

    var th = reportSection('Threats accepted, and what happens about them');
    if (!accepted.length) {
      th.appendChild(el('p', 'tm-rtext',
        'Nothing accepted yet. Work through the proposals in step 2 — a model with no accepted threats is a model nobody has read.'));
    } else {
      var twrap = el('div', 'tm-tablewrap');
      var tt = el('table', 'tm-table');
      var tthead = el('thead');
      var ttr = el('tr');
      cell(ttr, 'Element', null, true);
      cell(ttr, 'STRIDE', null, true);
      cell(ttr, 'Threat', null, true);
      /* Spelled out rather than abbreviated to L and I. The two letters save a
         centimetre of paper and cost a screen-reader user the meaning of the
         column entirely. */
      cell(ttr, 'Likelihood', null, true);
      cell(ttr, 'Impact', null, true);
      cell(ttr, 'Risk', null, true);
      cell(ttr, 'Mitigation', null, true);
      cell(ttr, 'Status', null, true);
      tthead.appendChild(ttr);
      tt.appendChild(tthead);
      var ttbody = el('tbody');
      accepted.forEach(function (t) {
        var e = elementById(t.el);
        var band = riskBand(t.likelihood, t.impact);
        var r = el('tr');
        cell(r, e ? labelFor(e) : '—');
        cell(r, t.cat + ' — ' + catInfo(t.cat).name);
        cell(r, t.title || '—');
        cell(r, t.likelihood ? LEVELS[t.likelihood - 1].label : '—');
        cell(r, t.impact ? LEVELS[t.impact - 1].label : '—');
        cell(r, band.key === 'none' ? 'Not rated' : band.label, 'tm-cell-risk tm-risk--' + band.key);
        cell(r, t.mitigation || 'Not written down yet');
        cell(r, statusLabel(t.status));
        ttbody.appendChild(r);
      });
      tt.appendChild(ttbody);
      twrap.appendChild(tt);
      th.appendChild(twrap);
    }
    host.appendChild(th);

    var rejected = model.threats.filter(function (t) { return t.decision === 'rejected'; });
    if (rejected.length) {
      var rj = reportSection('Considered and ruled out');
      rj.appendChild(el('p', 'tm-rtext',
        'These were proposed and deliberately not carried forward. Recording why is the part that saves the next argument.'));
      var ul = el('ul', 'tm-rlist');
      rejected.forEach(function (t) {
        var e = elementById(t.el);
        var li = el('li');
        li.appendChild(el('b', null, (e ? labelFor(e) : '—') + ' · ' + t.cat + ' — ' + (t.title || catInfo(t.cat).name)));
        li.appendChild(el('span', null, ' — ' + (t.reason || 'No reason recorded, which is a gap.')));
        ul.appendChild(li);
      });
      rj.appendChild(ul);
      host.appendChild(rj);
    }

    if (c.proposed) {
      var open = reportSection('Not yet decided');
      open.appendChild(el('p', 'tm-rtext',
        c.proposed + ' proposed threat' + (c.proposed === 1 ? ' has' : 's have') +
        ' not been accepted or rejected. An undecided threat is not a safe one; it is one nobody has looked at.'));
      host.appendChild(open);
    }

    var foot = el('footer', 'tm-rfoot');
    foot.appendChild(el('p', null,
      'STRIDE is one framework among several. LINDDUN covers privacy properly, PASTA is risk-and-attacker centred, and attack trees suit a single question better than a whole system. Any of them would find things this one misses.'));
    foot.appendChild(el('p', null,
      'This document is a record of a conversation on ' + model.created +
      '. It is not a certification, an audit, a penetration test or evidence of compliance, and it says nothing about whether the mitigations above were implemented or work.'));
    foot.appendChild(el('p', null,
      'Built with the threat modelling tool at krunalkumar.dpdns.org/labs/threat-model, which runs entirely in the browser.'));
    host.appendChild(foot);
  }

  function refreshDerived() {
    renderMap();
    renderTally();
    renderReport();
  }

  function renderAll() {
    byId('tm-name').value = model.name;
    byId('tm-scope').value = model.scope;
    renderBoundaries();
    renderElements();
    renderMap();
    renderThreats();
    renderReport();
    if (pendingFocus) {
      var node = document.querySelector(pendingFocus);
      pendingFocus = null;
      if (node && node.focus) node.focus();
    }
  }

  /* ------------------------------------------------------------------
     10. Tabs
     ------------------------------------------------------------------ */

  var tabs = [];
  var panels = [];

  function selectTab(index) {
    tabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
  }

  function wireTabs() {
    tabs = [byId('tm-tab-system'), byId('tm-tab-threats'), byId('tm-tab-report')];
    panels = [byId('tm-panel-system'), byId('tm-panel-threats'), byId('tm-panel-report')];
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () {
        selectTab(i);
        tab.focus();
      });
      tab.addEventListener('keydown', function (event) {
        var next = -1;
        if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        event.preventDefault();
        selectTab(next);
        tabs[next].focus();
      });
    });
    selectTab(0);
  }

  /* ------------------------------------------------------------------
     11. Wiring
     ------------------------------------------------------------------ */

  function printModel() {
    renderReport();
    selectTab(2);
    /* The print stylesheet shows the report whichever tab is on screen, so
       this is only so that the visitor sees on screen what is about to come
       out of the printer. */
    window.print();
  }

  function startEmpty() {
    model = emptyModel();
    forget();
    renderAll();
    setStatus('Cleared. Nothing is left in this browser’s storage.', 'ok');
    selectTab(0);
    var name = byId('tm-name');
    if (name) name.focus();
  }

  LabTool.define({
    id: 'threatmodel',

    run: function () {
      var added = syncProposals();
      save();
      renderAll();
      setStatus(added
        ? 'Added ' + added + ' proposal' + (added === 1 ? '' : 's') + ' for elements that did not have them.'
        : 'Every element already has its proposals. Nothing to add.', 'ok');
    },

    onReady: function () {
      statusNode = byId('tm-status');
      wireTabs();

      if (!restore()) model = emptyModel();
      reseed();
      syncProposals();

      byId('tm-name').addEventListener('input', function () {
        model.name = text(this.value);
        save();
      });
      byId('tm-name').addEventListener('change', renderReport);
      byId('tm-scope').addEventListener('input', function () {
        model.scope = text(this.value);
        save();
      });
      byId('tm-scope').addEventListener('change', renderReport);

      byId('tm-add-boundary').addEventListener('click', function () {
        if (model.boundaries.length >= MAX_BOUNDARIES) {
          setStatus('Twelve boundaries is the ceiling here. More than that usually means the diagram, not the system, has got away from you.', 'err');
          return;
        }
        var b = newBoundary('');
        model.boundaries.push(b);
        pendingFocus = '[data-b="' + b.id + '"] [data-role="bname"]';
        save();
        renderAll();
      });

      Array.prototype.forEach.call(
        document.querySelectorAll('[data-add]'), function (btn) {
          btn.addEventListener('click', function () {
            addElement(btn.getAttribute('data-add'));
          });
        });

      byId('tm-ex-saas').addEventListener('click', function () { loadExample('saas'); });
      byId('tm-ex-auto').addEventListener('click', function () { loadExample('automation'); });

      Array.prototype.forEach.call(
        document.querySelectorAll('[data-act="export"]'), function (btn) {
          btn.addEventListener('click', exportJson);
        });
      Array.prototype.forEach.call(
        document.querySelectorAll('[data-act="print"]'), function (btn) {
          btn.addEventListener('click', printModel);
        });

      var file = byId('tm-import');
      byId('tm-import-btn').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        importFile(file.files && file.files[0]);
        // Cleared so that re-importing the same file fires 'change' again.
        file.value = '';
      });

      byId('tm-clear').addEventListener('click', startEmpty);

      /* Ctrl+P from any tab should produce the model rather than whichever
         panel happened to be open, so the report is rebuilt before the print
         layout is taken. */
      if (window.addEventListener) {
        window.addEventListener('beforeprint', renderReport);
      }

      renderAll();

      var c = counts();
      if (model.elements.length) {
        setStatus('Picked up where you left off: ' + model.elements.length +
                  ' elements, ' + c.proposed + ' proposals still undecided.', null);
      } else {
        setStatus('Empty. Describe a system below, or load one of the two worked examples.', null);
      }
    }
  });
})();

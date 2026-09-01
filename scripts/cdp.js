#!/usr/bin/env node
/* ==========================================================================
   cdp.js — just enough Chrome DevTools Protocol to drive a page, no deps.
   --------------------------------------------------------------------------
   check-labs.js needs a real browser: the labs run WebAssembly, canvas and Web
   Workers, and a DOM shim reproduces none of it. This repository ships no
   dependencies and has none to install, so the choice was Playwright or about
   two hundred lines. Node 24 gives `WebSocket` and `fetch` as globals, which
   is the whole of what talking to Chrome requires, and this is those lines.

   Deliberately small: launch a browser, open a tab, navigate, evaluate an
   expression, click something for real, and collect what the page threw. Any
   feature beyond that is another thing that can break inside a script whose
   only job is to tell you the truth about something else.
   ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
  ]
};

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const list = CANDIDATES[process.platform] || CANDIDATES.linux;
  for (const p of list) if (fs.existsSync(p)) return p;
  return null;
}

function launch() {
  const bin = findBrowser();
  if (!bin) {
    const err = new Error('No Chrome or Edge found. Set CHROME_PATH to a browser binary.');
    err.code = 'ENOBROWSER';
    throw err;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'labgate-'));
  const args = [
    /* Port 0 and read it back from stderr, rather than 9222, so this never
       collides with a browser the developer already has open for debugging. */
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    /* The lab shells pause work on a hidden tab, which is correct of them and
       would make this gate watch a frozen page. */
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--mute-audio',
    '--window-size=1280,900',
    'about:blank'
  ];
  /* LABGATE_HEADFUL=1 shows the browser. Keep it: watching the run is how you
     tell a real page bug from something only headless does. */
  if (!process.env.LABGATE_HEADFUL) args.unshift('--headless=new');

  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    const onErr = (d) => {
      buf += d.toString();
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) { child.stderr.removeListener('data', onErr); resolve({ ws: m[0], child, profile }); }
    };
    child.stderr.on('data', onErr);
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error('Browser exited before it was ready (code ' + code + ').\n' + buf.slice(-300))));
    setTimeout(() => reject(new Error('Browser gave no debugging endpoint within 30s.')), 30000);
  });
}

class Conn {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
        else resolve(msg.result);
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
  }
  /* Timeout is per call: a decoder answers in milliseconds, a page that has
     wedged never answers at all, and one global ceiling serves neither. */
  send(method, params, sessionId, waitMs) {
    const id = ++this.id;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout after ' + Math.round((waitMs || 60000) / 1000) + 's: ' + method));
        }
      }, waitMs || 60000);
    });
  }
  on(fn) {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); };
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

class Page {
  constructor(conn, sessionId, targetId) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.errors = [];
    this._off = conn.on((msg) => {
      if (msg.sessionId !== this.sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        const t = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception';
        this.errors.push('uncaught: ' + String(t).split('\n')[0].slice(0, 150));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const parts = (msg.params.args || [])
          .map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type)));
        this.errors.push('console.error: ' + parts.join(' ').slice(0, 150));
      }
    });
  }
  cmd(m, p, waitMs) { return this.conn.send(m, p, this.sessionId, waitMs); }

  async goto(url) {
    const loaded = new Promise((resolve) => {
      const off = this.conn.on((msg) => {
        if (msg.sessionId === this.sessionId && msg.method === 'Page.loadEventFired') { off(); resolve(); }
      });
      setTimeout(() => { off(); resolve(); }, 30000);
    });
    await this.cmd('Page.navigate', { url });
    await loaded;
  }

  async eval(expression, timeoutMs) {
    const budget = timeoutMs || 20000;
    const r = await this.cmd('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, timeout: budget
    }, budget + 15000);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const t = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      throw new Error('evaluate failed: ' + String(t).split('\n')[0].slice(0, 180));
    }
    return r.result ? r.result.value : undefined;
  }

  /* A REAL mouse press, not element.click().

     Two things learned the hard way here. First, element.click() is not a
     trusted user gesture, and anything gated behind one — audio, fullscreen,
     clipboard — behaves differently under it, so a harness that clicks the
     easy way reports bugs that no visitor can reproduce. Second,
     scrollIntoView does NOT finish synchronously: measuring the rectangle in
     the same turn returns the pre-scroll position and the click lands in
     empty space, which looks exactly like a button that does nothing. Hence
     scroll, wait a frame, then measure. */
  async click(selector) {
    const sel = JSON.stringify(selector);
    const found = await this.eval(
      '(function () { var e = document.querySelector(' + sel + ');' +
      ' if (!e || e.offsetParent === null) return 0;' +
      ' e.scrollIntoView({ block: "center", behavior: "instant" }); return 1; })()'
    );
    if (!found) return false;
    /* setTimeout, NOT requestAnimationFrame. Only one tab is foreground in a
       headless browser, and rAF does not fire in the others — so waiting on a
       frame here hung every backgrounded tab until the call timed out, and
       WHICH labs failed changed on every run. A plain timer is enough: all
       this needs is for the scroll above to have settled. */
    await this.eval('new Promise(function (z) { setTimeout(z, 80); })');
    const box = await this.eval(
      '(function () { var e = document.querySelector(' + sel + '); if (!e) return null;' +
      ' var r = e.getBoundingClientRect();' +
      ' if (r.width < 1 || r.height < 1 || r.top < 0 || r.bottom > innerHeight) return null;' +
      ' return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()'
    );
    if (!box) return false;
    const { x, y } = JSON.parse(box);
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return true;
  }

  clearErrors() { this.errors.length = 0; }
  async close() {
    this._off();
    try { await this.conn.send('Target.closeTarget', { targetId: this.targetId }); } catch (e) {}
  }
}

async function open() {
  const { ws, child, profile } = await launch();
  const conn = await new Promise((resolve, reject) => {
    const sock = new WebSocket(ws);
    sock.addEventListener('open', () => resolve(new Conn(sock)));
    sock.addEventListener('error', () => reject(new Error('Could not connect to ' + ws)));
  });
  return {
    async newPage() {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(conn, sessionId, targetId);
      await page.cmd('Page.enable', {});
      await page.cmd('Runtime.enable', {});
      return page;
    },
    async close() {
      conn.close();
      try { child.kill(); } catch (e) {}
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    }
  };
}

module.exports = { open, findBrowser };

'use strict';
/* The Android bridge content script with a fake native port (browser.runtime.connectNative). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'src', 'main', 'heartline-android', 'android-bridge.js'), 'utf8');
// jsdom's postMessage leaves event.source empty; a browser sets it to the window.
const fromPage = (w, data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w }));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function setup({ failFirst = 0 } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://open.spotify.com/', runScripts: 'outside-only' });
  const w = dom.window;
  const ports = [];
  let attempts = 0;
  w.browser = {
    runtime: {
      connectNative(name) {
        attempts++;
        if (attempts <= failFirst) throw new Error('not ready');
        const port = {
          name, sent: [], msgListeners: [], discListeners: [],
          postMessage(m) { this.sent.push(m); },
          onMessage: { addListener(fn) { port.msgListeners.push(fn); } },
          onDisconnect: { addListener(fn) { port.discListeners.push(fn); } },
        };
        ports.push(port);
        return port;
      },
    },
  };
  w.eval(BRIDGE);
  return { w, ports, attempts: () => attempts };
}

test('connects to the "heartline" native app and says hello', () => {
  const { ports } = setup();
  assert.equal(ports.length, 1);
  assert.equal(ports[0].name, 'heartline');
  assert.equal(ports[0].sent[0].type, 'hello');
});

test('page state goes to the app; other messages do not', async () => {
  const { w, ports } = setup();
  fromPage(w, { source: 'heartline-page', type: 'state', state: { title: 'Song', liked: true } });
  fromPage(w, { source: 'someone-else', type: 'state', state: { title: 'Nope' } });
  w.dispatchEvent(new w.MessageEvent('message', { data: { source: 'heartline-page', type: 'state', state: {} }, source: null }));
  await tick();
  const states = ports[0].sent.filter((m) => m.type === 'state');
  assert.equal(states.length, 1);
  assert.equal(JSON.stringify(states[0].state), JSON.stringify({ title: 'Song', liked: true }));
});

test('app commands reach the page', async () => {
  const { w, ports } = setup();
  const got = [];
  w.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'heartline-app') got.push(e.data.command);
  });
  ports[0].msgListeners.forEach((fn) => fn({ command: 'like' }));
  ports[0].msgListeners.forEach((fn) => fn({ command: 42 }));
  await tick();
  assert.deepEqual(got, ['like']);
});

test('reconnects after the app drops the port, and keeps the latest state meanwhile', async () => {
  const { w, ports } = setup();
  ports[0].discListeners.forEach((fn) => fn());
  fromPage(w, { source: 'heartline-page', type: 'state', state: { title: 'While away' } });
  await tick(700);
  assert.equal(ports.length, 2);
  assert.equal(JSON.stringify(ports[1].sent.find((m) => m.type === 'state').state), '{"title":"While away"}');
});

test('retries when the app is not ready yet', async () => {
  const { ports, attempts } = setup({ failFirst: 1 });
  assert.equal(ports.length, 0);
  await tick(700);
  assert.equal(attempts(), 2);
  assert.equal(ports.length, 1);
});

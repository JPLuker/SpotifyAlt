'use strict';
/* The page script against Spotify-like markup in jsdom, with a fake library API. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'heartline.js'), 'utf8');
const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';

const ROWS = `
  <div data-testid="tracklist-row" id="r1"><a href="/track/AAAAAAAAAAAAAAAAAAAAAA">A</a><span><button aria-label="Add to playlist"></button></span></div>
  <div data-testid="tracklist-row" id="r2"><a href="/track/BBBBBBBBBBBBBBBBBBBBBB">B</a><span><button aria-label="Add to Liked Songs"></button></span></div>`;

function setup({ library = { [A]: true, [B]: false }, fail = false, storage = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${ROWS}</body></html>`, {
    url: 'https://open.spotify.com/playlist/test',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  const lib = new Map(Object.entries(library));
  const calls = [];
  const failOps = new Set();
  w.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const uris = (body.variables && body.variables.uris) || [];
    calls.push({ url, op: body.operationName, hash: body.extensions?.persistedQuery?.sha256Hash, uris, headers: init.headers });
    if (fail || failOps.has(body.operationName)) return { ok: false, status: 500, json: async () => ({}) };
    let data = {};
    if (body.operationName === 'areEntitiesInLibrary') data = { lookup: uris.map((u) => ({ data: { saved: lib.get(u) === true } })) };
    else if (/^(add|remove)/.test(body.operationName || '')) uris.forEach((u) => lib.set(u, body.operationName === 'addToLibrary'));
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  w.eval(SCRIPT);
  return { dom, w, d: w.document, calls, lib, failOps };
}

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

// The page sends its own request first; that's where the token comes from.
async function pageSignsIn(w, headers = { authorization: 'Bearer T', 'client-token': 'C' }, body = '{}') {
  await w.fetch('https://api-partner.spotify.com/pathfinder/v2/query', { method: 'POST', headers, body });
  await tick();
}

test('no token yet: Spotify\'s own buttons stay', async () => {
  const { d, calls } = setup();
  await tick();
  assert.equal(d.querySelectorAll('.hl-heart').length, 0);
  assert.equal(d.querySelectorAll('.hl-native-hidden').length, 0);
  assert.equal(calls.length, 0);
});

test('hearts show real Liked Songs state and replace the + button', async () => {
  const { w, d, calls } = setup();
  await pageSignsIn(w);
  await tick();
  const h1 = d.querySelector('#r1 .hl-heart');
  const h2 = d.querySelector('#r2 .hl-heart');
  assert.equal(h1.getAttribute('aria-pressed'), 'true');
  assert.equal(h1.getAttribute('aria-label'), 'Remove from Liked Songs');
  assert.equal(h2.getAttribute('aria-pressed'), 'false');
  assert.equal(d.querySelectorAll('.hl-native-hidden').length, 2);
  const lookup = calls.find((c) => c.op === 'areEntitiesInLibrary');
  assert.deepEqual(lookup.uris, [A, B]);
  assert.equal(lookup.headers.authorization, 'Bearer T');
  assert.equal(lookup.headers['client-token'], 'C');
});

test('Headers objects and Request-style inputs are read too', async () => {
  const { w, d } = setup();
  const headers = new w.Headers({ Authorization: 'Bearer H' });
  await w.fetch('https://api-partner.spotify.com/pathfinder/v2/query', { method: 'POST', headers, body: '{}' });
  await tick(150);
  assert.equal(d.querySelectorAll('.hl-heart').length, 2);
});

test('clicking toggles Liked Songs and does not reach the row', async () => {
  const { w, d, lib, calls } = setup();
  await pageSignsIn(w);
  await tick();
  let rowClicks = 0;
  d.querySelector('#r2').addEventListener('click', () => rowClicks++);
  d.querySelector('#r2 .hl-heart').click();
  await tick();
  assert.equal(lib.get(B), true);
  assert.equal(d.querySelector('#r2 .hl-heart').getAttribute('aria-pressed'), 'true');
  assert.equal(rowClicks, 0);
  d.querySelector('#r1 .hl-heart').click();
  await tick();
  assert.equal(lib.get(A), false);
  assert.ok(calls.some((c) => c.op === 'removeFromLibrary' && c.uris[0] === A));
});

test('a failed save puts the heart back the way it was', async () => {
  const ctx = setup();
  await pageSignsIn(ctx.w);
  await tick();
  ctx.failOps.add('addToLibrary');
  ctx.d.querySelector('#r2 .hl-heart').click();
  await tick();
  assert.equal(ctx.lib.get(B), false);
  assert.equal(ctx.d.querySelector('#r2 .hl-heart').getAttribute('aria-pressed'), 'false');
  assert.equal(ctx.w.__heartline.status().lastError, 'http-500');
});

test('lookup failure: keeps Spotify\'s button and does not retry in a loop', async () => {
  const { w, d, calls } = setup({ fail: true });
  await pageSignsIn(w);
  await tick(300);
  assert.equal(d.querySelectorAll('.hl-heart').length, 0);
  assert.equal(d.querySelectorAll('.hl-native-hidden').length, 0);
  const lookups = calls.filter((c) => c.op === 'areEntitiesInLibrary');
  assert.equal(lookups.length, 1, `expected one lookup, got ${lookups.length}`);
  assert.match(w.__heartline.status().text, /lookup failed \(http-500\)/);
});

test('learns the query hash from the page\'s own request', async () => {
  const { w, calls } = setup();
  const hash = 'c'.repeat(64);
  await pageSignsIn(w, { authorization: 'Bearer T' }, JSON.stringify({
    operationName: 'areEntitiesInLibrary', extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
  }));
  await tick();
  const ours = calls.filter((c) => c.op === 'areEntitiesInLibrary' && c.uris && c.uris.length);
  assert.ok(ours.length && ours.every((c) => c.hash === hash));
  assert.equal(JSON.parse(w.localStorage.getItem('heartline.queryHashes')).areEntitiesInLibrary, hash);
});

test('stored hashes are validated', async () => {
  const { w, calls } = setup({ storage: { 'heartline.queryHashes': JSON.stringify({ areEntitiesInLibrary: 'not-a-hash' }) } });
  await pageSignsIn(w);
  await tick();
  const ours = calls.find((c) => c.op === 'areEntitiesInLibrary' && c.uris.length);
  assert.equal(ours.hash, '134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed');
});

test('saves made through Spotify\'s own menus update the heart', async () => {
  const { w, d } = setup();
  await pageSignsIn(w);
  await tick();
  await pageSignsIn(w, { authorization: 'Bearer T' }, JSON.stringify({ operationName: 'addToLibrary', variables: { uris: [B] } }));
  await tick();
  assert.equal(d.querySelector('#r2 .hl-heart').getAttribute('aria-pressed'), 'true');
});

test('a re-rendered row gets a fresh heart and no orphans stay', async () => {
  const { w, d } = setup();
  await pageSignsIn(w);
  await tick();
  const span = d.querySelector('#r1 span');
  span.innerHTML = '<button aria-label="Add to playlist"></button>';
  await tick(150);
  assert.equal(d.querySelectorAll('#r1 .hl-heart').length, 1);
  assert.equal(d.querySelectorAll('.hl-heart').length, 2);
});

test('a recycled row (new link) shows the new track\'s state', async () => {
  const { w, d } = setup();
  await pageSignsIn(w);
  await tick();
  d.querySelector('#r1 a').setAttribute('href', '/track/BBBBBBBBBBBBBBBBBBBBBB');
  await tick(150);
  assert.equal(d.querySelector('#r1 .hl-heart').dataset.hlUri, B);
  assert.equal(d.querySelector('#r1 .hl-heart').getAttribute('aria-pressed'), 'false');
});

test('settings: hearts off restores Spotify\'s buttons; keep + button', async () => {
  const { w, d } = setup();
  await pageSignsIn(w);
  await tick();
  w.__heartline.updateSettings({ hearts: false });
  await tick();
  assert.equal(d.querySelectorAll('.hl-heart').length, 0);
  assert.equal(d.querySelectorAll('.hl-native-hidden').length, 0);
  w.__heartline.updateSettings({ hearts: true, keepAddButton: true });
  await tick();
  assert.equal(d.querySelectorAll('.hl-heart').length, 2);
  assert.equal(d.querySelectorAll('.hl-native-hidden').length, 0);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('heartline.settings')).keepAddButton, true);
});

test('settings: bad stored values are ignored; custom CSS and upsell class apply', async () => {
  const { w, d } = setup({ storage: { 'heartline.settings': JSON.stringify({ hearts: 'no', hideUpsell: true, customCss: 'body{color:red}' }) } });
  await tick();
  assert.equal(w.__heartline.settings().hearts, true);
  assert.ok(d.documentElement.classList.contains('hl-hide-upsell'));
  assert.equal(d.getElementById('hl-custom-css').textContent, 'body{color:red}');
  w.__heartline.updateSettings({ customCss: '' });
  assert.equal(d.getElementById('hl-custom-css'), null);
});

test('unreadable settings JSON falls back to defaults', async () => {
  const { w } = setup({ storage: { 'heartline.settings': '{oops' } });
  assert.equal(w.__heartline.settings().hearts, true);
});

test('track links: only real track URIs', () => {
  const { w } = setup();
  const f = w.__heartline._trackUriFromHref;
  assert.equal(f('/track/AAAAAAAAAAAAAAAAAAAAAA'), A);
  assert.equal(f('/track/AAAAAAAAAAAAAAAAAAAAAA?si=1'), A);
  assert.equal(f('/album/x?uri=spotify%3Atrack%3AAAAAAAAAAAAAAAAAAAAAAA'), A);
  assert.equal(f('/album/x?uri=spotify%3Aepisode%3AAAAAAAAAAAAAAAAAAAAAAA'), null);
  assert.equal(f('/album/x?uri=%E0%A4%A'), null);
  assert.equal(f('/episode/AAAAAAAAAAAAAAAAAAAAAA'), null);
  assert.equal(f(null), null);
});

test('the dealer WebSocket sets the now-playing track', async () => {
  const dom = new JSDOM(`<!doctype html><body><div data-testid="now-playing-widget"><a data-testid="context-link" href="/album/x?uri=spotify%3Atrack%3AAAAAAAAAAAAAAAAAAAAAAA">x</a><div><button aria-label="Add to playlist"></button></div></div></body>`, {
    url: 'https://open.spotify.com/', runScripts: 'outside-only',
  });
  const w = dom.window;
  const listeners = [];
  w.WebSocket = function FakeWS() { this.addEventListener = (t, fn) => listeners.push(fn); };
  w.fetch = async (u, init) => {
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ data: { lookup: (body.variables.uris || []).map((uri) => ({ data: { saved: uri === A } })) } }) };
  };
  w.eval(SCRIPT);
  new w.WebSocket('wss://dealer');
  await w.fetch('https://api-partner.spotify.com/pathfinder/v2/query', { headers: { authorization: 'Bearer T' }, body: '{}' });
  await tick(150);
  const heart = () => w.document.querySelector('.hl-heart');
  assert.equal(heart().dataset.hlUri, A, 'falls back to the now-playing link');
  listeners.forEach((fn) => fn({ data: JSON.stringify({ payloads: [{ cluster: { player_state: { track: { uri: B } } } }] }) }));
  await tick(150);
  assert.equal(heart().dataset.hlUri, B);
  assert.equal(heart().getAttribute('aria-pressed'), 'false');
});

test('runs once even if injected twice', () => {
  const { w } = setup();
  const api = w.__heartline;
  w.eval(SCRIPT);
  assert.equal(w.__heartline, api);
});

test('now-playing heart finds the track from any link in the widget', async () => {
  const dom = new JSDOM(`<!doctype html><body><div data-testid="now-playing-widget"><a href="/album/x">Album</a><a data-testid="context-item-link" href="/track/AAAAAAAAAAAAAAAAAAAAAA">Song</a><div><button aria-label="Add to playlist"></button></div></div></body>`, {
    url: 'https://open.spotify.com/', runScripts: 'outside-only',
  });
  const w = dom.window;
  w.fetch = async (u, init) => {
    const body = JSON.parse(init.body || '{}');
    const uris = (body.variables && body.variables.uris) || [];
    return { ok: true, status: 200, json: async () => ({ data: { lookup: uris.map(() => ({ data: { saved: true } })) } }) };
  };
  w.eval(SCRIPT);
  await w.fetch('https://api-partner.spotify.com/pathfinder/v2/query', { headers: { authorization: 'Bearer T' }, body: '{}' });
  await tick(150);
  const heart = w.document.querySelector('.hl-heart');
  assert.ok(heart, 'heart in the now-playing bar');
  assert.equal(heart.dataset.hlUri, A);
  assert.equal(heart.getAttribute('aria-pressed'), 'true');
});

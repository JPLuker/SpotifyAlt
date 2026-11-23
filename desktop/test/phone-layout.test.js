'use strict';
/* The Android phone layout in heartline.js, against Spotify's live markup shape (2026-11-23). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'heartline.js'), 'utf8');
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html class="encore-dark-theme"><head></head><body><div id="main">
<div class="Root global-nav" data-testid="root"><div class="PbMBx95owTmQYYdfnp3j">
  <div class="rr3AwF0UoO45NOY__aIz"></div>
  <div id="global-nav-bar"><button data-testid="home-button" class="e-legacy-button">H</button></div>
  <div id="Desktop_LeftSidebar_Id"><nav>Library</nav></div>
  <div id="main-view">page</div>
  <aside data-testid="now-playing-bar"><div class="row">
    <div class="left"><div data-testid="now-playing-widget">song</div></div>
    <div class="center"><div data-testid="player-controls"><button data-testid="control-button-playpause">P</button></div></div>
    <div class="right">volume</div>
  </div></aside>
  <div id="lyrics-cinema"></div>
  <div class="d4YjdCUuq2sWZzXX_4i4"><div class="VTO__modal-slot"></div></div>
</div></div></div></body></html>`;

function setup(platform) {
  const dom = new JSDOM(PAGE, { url: 'https://open.spotify.com/', runScripts: 'outside-only' });
  const w = dom.window;
  if (platform) w.__HEARTLINE_PLATFORM__ = platform;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) });
  w.eval(SCRIPT);
  return { w, d: w.document };
}

test('Android: Spotify\'s grid becomes nav, page and player bar', async () => {
  const { d } = setup('android');
  await tick();
  assert.ok(d.documentElement.classList.contains('hl-phone'));
  const slot = (sel) => d.querySelector(sel).getAttribute('data-hl-slot');
  assert.equal(slot('#global-nav-bar'), 'nav');
  assert.equal(slot('#Desktop_LeftSidebar_Id'), 'library');
  assert.equal(slot('#main-view'), 'main');
  assert.equal(slot('[data-testid="now-playing-bar"]'), 'bar');
  assert.equal(slot('#lyrics-cinema'), 'overlay');
  assert.equal(slot('.rr3AwF0UoO45NOY__aIz'), 'overlay', 'empty wrapper');
  assert.equal(slot('.d4YjdCUuq2sWZzXX_4i4'), 'overlay', 'modal layers are never hidden');
  assert.ok(d.querySelector('[data-testid="root"] > div').hasAttribute('data-hl-shell'));
});

test('Android: player bar splits into track, controls and hidden extras', async () => {
  const { d } = setup('android');
  await tick();
  assert.ok(d.querySelector('.row').hasAttribute('data-hl-np-row'));
  assert.equal(d.querySelector('.left').getAttribute('data-hl-np'), 'track');
  assert.equal(d.querySelector('.center').getAttribute('data-hl-np'), 'controls');
  assert.equal(d.querySelector('.right').getAttribute('data-hl-np'), 'extra');
});

test('Android: the library button opens the library and navigation closes it', async () => {
  const { w, d } = setup('android');
  await tick();
  const btn = d.getElementById('hl-library-button');
  assert.ok(btn, 'library button in the nav');
  assert.equal(btn.previousElementSibling.getAttribute('data-testid'), 'home-button');
  assert.equal(btn.className, 'e-legacy-button', 'looks like Spotify\'s own nav buttons');
  assert.equal(btn.getAttribute('aria-label'), 'Your Library');
  btn.click();
  assert.ok(d.documentElement.classList.contains('hl-library-open'));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  w.history.pushState({}, '', '/playlist/abc');
  assert.ok(!d.documentElement.classList.contains('hl-library-open'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  await tick();
  assert.equal(d.querySelectorAll('#hl-library-button').length, 1, 'only one button after rescans');
});

test('Android: "Fit to phone width" off restores Spotify\'s layout', async () => {
  const { w, d } = setup('android');
  await tick();
  w.__heartline.updateSettings({ phoneLayout: false });
  await tick();
  assert.ok(!d.documentElement.classList.contains('hl-phone'));
});

test('Desktop and Chrome: no phone layout, no library button', async () => {
  const { d } = setup(null);
  await tick();
  assert.ok(!d.documentElement.classList.contains('hl-phone'));
  assert.equal(d.getElementById('hl-library-button'), null);
});

test('Spotify rewriting <html> classes does not drop the restyle', async () => {
  const { d } = setup('android');
  await tick();
  d.documentElement.className = 'encore-dark-theme';
  d.body.appendChild(d.createElement('div')); // any change triggers a rescan
  await tick();
  assert.ok(d.documentElement.classList.contains('hl-qp'));
  assert.ok(d.documentElement.classList.contains('hl-phone'));
});

test('diagnostics: errors are kept, tokens are not', async () => {
  const { w } = setup('android');
  w.console.error('boom Bearer abc.def.ghi', 'x'.repeat(60));
  const text = w.__heartline.diagnosticText();
  assert.match(text, /^Heartline \S+ android/);
  assert.match(text, /console\.error: boom Bearer \[redacted\] \[long value\]/);
  assert.doesNotMatch(text, /abc\.def\.ghi/);
  assert.match(text, /Layout: .*main:main-view/);
});

test('Android: a panel with content is hidden and stays hidden across rescans', async () => {
  const { w, d } = (() => {
    const dom = new JSDOM(PAGE.replace('<div class="rr3AwF0UoO45NOY__aIz"></div>', '<div class="panel"><p>Preview of Spotify</p></div>'), {
      url: 'https://open.spotify.com/', runScripts: 'outside-only',
    });
    dom.window.__HEARTLINE_PLATFORM__ = 'android';
    dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) });
    dom.window.eval(SCRIPT);
    return { w: dom.window, d: dom.window.document };
  })();
  await tick();
  assert.equal(d.querySelector('.panel').getAttribute('data-hl-slot'), 'side');
  for (let i = 0; i < 3; i++) {
    w.__heartline._layoutPhone();
    assert.equal(d.querySelector('.panel').getAttribute('data-hl-slot'), 'side');
  }
  assert.equal(d.querySelector('.d4YjdCUuq2sWZzXX_4i4').getAttribute('data-hl-slot'), 'overlay');
});

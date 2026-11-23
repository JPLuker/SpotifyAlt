'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const policy = require('../src/main/policy');
const { chromeUserAgent } = require('../src/main/ua');
const store = require('../src/main/store');
const { sanitizeState, windowTitle, COMMANDS } = require('../src/main/state');

test('policy: player and Spotify sign-in stay in the window', () => {
  assert.ok(policy.isInAppUrl('https://open.spotify.com/playlist/x'));
  assert.ok(policy.isInAppUrl('https://accounts.spotify.com/en/login'));
  assert.ok(!policy.isInAppUrl('http://open.spotify.com/'));
  assert.ok(!policy.isInAppUrl('https://open.spotify.com.evil.com/'));
  assert.ok(!policy.isInAppUrl('https://user:pw@open.spotify.com/'));
  assert.ok(!policy.isInAppUrl('https://www.spotify.com/us/premium/'));
  assert.ok(!policy.isInAppUrl('javascript:alert(1)'));
  assert.ok(!policy.isInAppUrl('not a url'));
});

test('policy: dev URL only matches by prefix when given', () => {
  assert.ok(policy.isPlayerUrl('http://127.0.0.1:5000/', 'http://127.0.0.1:5000/'));
  assert.ok(!policy.isPlayerUrl('http://127.0.0.1:5000/'));
});

test('policy: sign-in popups and external links', () => {
  assert.ok(policy.isAuthPopupUrl('https://accounts.google.com/o/oauth2'));
  assert.ok(policy.isAuthPopupUrl('https://appleid.apple.com/auth'));
  assert.ok(!policy.isAuthPopupUrl('https://example.com/'));
  assert.ok(policy.isExternalOk('https://www.spotify.com/premium'));
  assert.ok(!policy.isExternalOk('file:///etc/passwd'));
  assert.ok(!policy.isExternalOk('spotify:track:abc'));
});

test('policy: command-line links', () => {
  assert.equal(policy.argToPlayerUrl('spotify:track:4uLU6hMCjMI75M1A2tKUQC'), 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(policy.argToPlayerUrl('https://open.spotify.com/album/1?si=2'), 'https://open.spotify.com/album/1?si=2');
  assert.equal(policy.argToPlayerUrl('--flag'), null);
  assert.equal(policy.argToPlayerUrl('https://evil.com/'), null);
  assert.equal(policy.argToPlayerUrl('spotify:track:short'), null);
});

test('ua: plain Chrome UA from the Chromium version', () => {
  assert.equal(
    chromeUserAgent('linux', '146.0.7400.12'),
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  );
  assert.match(chromeUserAgent('win32', '146.1'), /Windows NT 10.0; Win64; x64/);
  assert.doesNotMatch(chromeUserAgent('linux', '146.1'), /Electron|Heartline/);
  assert.throws(() => chromeUserAgent('linux', ''));
});

test('store: round trip, sanitizing and unreadable files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-store-'));
  assert.deepEqual(store.load(dir), store.DEFAULTS);
  assert.ok(store.save(dir, { bounds: { x: 1, y: 2, width: 900, height: 700 }, maximized: true, closeToTray: true, junk: 1 }));
  const back = store.load(dir);
  assert.deepEqual(back, { bounds: { x: 1, y: 2, width: 900, height: 700 }, maximized: true, closeToTray: true });
  assert.equal(store.sanitize({ bounds: { x: 0, y: 0, width: 10, height: 10 } }).bounds, null);

  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  assert.deepEqual(store.load(dir), store.DEFAULTS);
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('settings.json.unreadable-'));
  assert.equal(kept.length, 1, 'unreadable file is kept aside, not overwritten');
  assert.equal(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), '{not json');
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp-')), 'no temp files left');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('state: page input is clamped and typed', () => {
  const s = sanitizeState({
    title: 'x'.repeat(1000), artist: 5, artwork: 'http://insecure', playing: 'yes',
    uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', liked: 'true',
  });
  assert.equal(s.title.length, 300);
  assert.equal(s.artist, '');
  assert.equal(s.artwork, '');
  assert.equal(s.playing, false);
  assert.equal(s.liked, null);
  assert.equal(sanitizeState({ uri: 'javascript:x' }).uri, '');
  assert.equal(sanitizeState(null), null);
  assert.equal(windowTitle({ title: 'Song', artist: 'Band' }), 'Song · Band');
  assert.equal(windowTitle({ title: '' }), 'Heartline');
  assert.ok(COMMANDS.has('like') && !COMMANDS.has('eval'));
});

test('extension manifest matches package version', () => {
  const pkg = require('../package.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'manifest.json'), 'utf8'));
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'heartline.js'), 'utf8');
  assert.equal(manifest.version, pkg.version);
  assert.match(js, new RegExp(`const VERSION = '${pkg.version.replace(/\./g, '\\.')}'`));
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
});

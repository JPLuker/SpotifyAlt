'use strict';
/*
 * Starts the real app (castLabs Electron, sandboxed renderer, real preload)
 * against a local copy of Spotify's player markup, then checks what happened.
 * Run: npm run smoke   (Linux needs a display; CI uses xvfb-run)
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const outDir = process.env.SMOKE_OUT || path.join(root, 'test-output');
fs.mkdirSync(outDir, { recursive: true });
const html = fs.readFileSync(path.join(root, 'test', 'fixtures', 'player.html'));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const electron = require('electron');
  const args = ['.', `--dev-url=${url}`, '--smoke', `--smoke-out=${outDir}`, `--user-data-dir=${path.join(outDir, 'profile')}`];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const child = spawn(electron, args, { cwd: root, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, 60000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    server.close();
    fs.writeFileSync(path.join(outDir, 'smoke.log'), out);
    const line = out.split('\n').find((l) => l.includes('SMOKE RESULT '));
    if (!line) {
      console.error(out);
      console.error(`No result from the app (exit ${code}). Log: ${path.join(outDir, 'smoke.log')}`);
      process.exit(1);
    }
    const r = JSON.parse(line.slice(line.indexOf('SMOKE RESULT ') + 13));
    try {
      check(r, out);
    } catch (err) {
      console.error(JSON.stringify(r, null, 2));
      throw err;
    }
    console.log('Smoke test passed. Screenshots and log in', outDir);
  });
});

function check(r, log) {
  assert.equal(r.error, undefined, r.error);
  const s0 = r.steps.initial;
  assert.ok(s0.hasApi, 'page script did not start');
  // Widevine downloads from Google on first run. Required in CI; offline sandboxes can't reach it.
  if (process.env.SMOKE_REQUIRE_WIDEVINE === '1') assert.match(log, /Widevine ready/, 'Widevine CDM did not load');
  else if (!/Widevine ready/.test(log)) console.warn('Note: Widevine did not load here (no network?). Set SMOKE_REQUIRE_WIDEVINE=1 to require it.');
  assert.equal(s0.status.auth, 'ready', 'token from the first page request was missed (script injected too late)');
  const byUri = (step, uri, kind = 'row') => step.hearts.find((h) => h.uri === uri && h.kind === kind);
  const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
  const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
  const C = 'spotify:track:CCCCCCCCCCCCCCCCCCCCCC';
  assert.equal(byUri(s0, A).pressed, 'true', 'liked row should show a full heart');
  assert.equal(byUri(s0, B).pressed, 'false');
  assert.equal(byUri(s0, C).pressed, 'false', 'a playlist-only song is not liked');
  assert.equal(byUri(s0, B, 'now').pressed, 'false', 'now-playing heart');
  assert.equal(s0.hearts.length, 4, 'three rows plus now playing; the episode row keeps Spotify\'s button');
  assert.ok(s0.episodeNativeVisible, 'episode row should keep the native button');
  assert.equal(s0.hiddenNatives, 4);
  assert.ok(s0.hearts.every((h) => h.w >= 24 && h.h >= 24), 'hit targets under 24px');
  // Restyle on by default: Quiet Precision dark neutrals, ink accent (DESIGN.md B3).
  assert.deepEqual(
    { main: r.steps.restyleOn.main, nav: r.steps.restyleOn.nav, root: r.steps.restyleOn.root, play: r.steps.restyleOn.play, heart: r.steps.restyleOn.savedHeart },
    { main: 'rgb(25, 25, 24)', nav: 'rgb(17, 17, 16)', root: 'rgb(17, 17, 16)', play: 'rgb(237, 237, 234)', heart: 'rgb(237, 237, 234)' },
  );
  assert.match(r.steps.restyleOn.font, /Geist|system-ui/);
  assert.equal(r.steps.restyleOff, 'rgb(18, 18, 18)', 'restyle off gives Spotify\'s own colors back');
  assert.equal(s0.savedColor, 'rgb(237, 237, 234)');

  const lookups = r.calls.filter((c) => c.op === 'areEntitiesInLibrary' && c.uris.length);
  assert.ok(lookups.length >= 1);
  assert.ok(lookups.every((c) => c.hash === 'b'.repeat(64)), 'should use the hash the page itself sent');
  assert.ok(lookups.every((c) => c.auth === 'Bearer TEST-TOKEN' && c.client === 'TEST-CLIENT'));

  assert.equal(byUri(r.steps.afterRowClick, C).pressed, 'true', 'row heart click');
  assert.equal(r.library[C], true);
  assert.equal(r.library[B], true, 'Like command should save the now-playing song');
  assert.equal(byUri(r.steps.afterLikeCommand, B, 'now').pressed, 'true');
  assert.deepEqual(r.steps.afterControls.clicks, { previous: 0, playpause: 1, next: 1 });

  assert.equal(r.steps.settings.open, true, 'settings panel opens from the app menu');
  assert.equal(r.steps.settings.status, 'Hearts: working');

  const last = r.states[r.states.length - 1];
  assert.equal(last.title, 'Not saved song');
  assert.equal(last.artist, 'Test Artist');
  assert.equal(last.playing, true);
  assert.equal(last.liked, true);
  assert.equal(r.windowTitle, 'Not saved song · Test Artist');
}

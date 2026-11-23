'use strict';
/*
 * Smoke-test hooks, loaded only by an unpackaged app started with --smoke.
 * Fakes Spotify's library API, drives the window and prints one result line.
 */
const fs = require('node:fs');
const path = require('node:path');

function install({ app, session, protocol, partition, getWindow, sendCommand, outDir }) {
  const library = new Map([
    ['spotify:track:AAAAAAAAAAAAAAAAAAAAAA', true],
    ['spotify:track:BBBBBBBBBBBBBBBBBBBBBB', false],
    ['spotify:track:CCCCCCCCCCCCCCCCCCCCCC', false],
  ]);
  const calls = [];
  const ses = session.fromPartition(partition);

  ses.protocol.handle('https', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'api-partner.spotify.com') return new Response('blocked in smoke test', { status: 403 });
    const origin = request.headers.get('origin') || '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, client-token, app-platform, spotify-app-version, content-type, accept-language',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let body;
    try {
      body = JSON.parse(await request.text());
    } catch (err) {
      return new Response('bad body', { status: 400, headers: cors });
    }
    calls.push({
      op: body.operationName,
      hash: body.extensions?.persistedQuery?.sha256Hash,
      auth: request.headers.get('authorization'),
      client: request.headers.get('client-token'),
      uris: body.variables?.uris || [],
    });
    const uris = body.variables?.uris || [];
    let data;
    if (body.operationName === 'areEntitiesInLibrary') {
      data = { lookup: uris.map((u) => ({ data: { __typename: 'Track', saved: library.get(u) === true } })) };
    } else if (body.operationName === 'addToLibrary' || body.operationName === 'removeFromLibrary') {
      uris.forEach((u) => library.set(u, body.operationName === 'addToLibrary'));
      data = {};
    } else {
      data = {};
    }
    return new Response(JSON.stringify({ data }), {
      headers: { 'content-type': 'application/json', ...cors },
    });
  });

  const states = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const page = (code) => getWindow().webContents.executeJavaScript(code);

  const inspect = () =>
    page(`(() => {
      const hearts = [...document.querySelectorAll('.hl-heart')].map((h) => ({
        uri: h.dataset.hlUri, kind: h.dataset.hlKind, pressed: h.getAttribute('aria-pressed'),
        label: h.getAttribute('aria-label'), w: h.getBoundingClientRect().width, h: h.getBoundingClientRect().height,
      }));
      const hiddenNatives = [...document.querySelectorAll('.hl-native-hidden')].length;
      const episodeNativeVisible = getComputedStyle(document.querySelector('#r4 .add')).display !== 'none';
      const style = getComputedStyle(document.querySelector('#r1 .hl-heart'));
      return { hearts, hiddenNatives, episodeNativeVisible, savedColor: style.color,
        status: window.__heartline && window.__heartline.status(), clicks: window.__clicks,
        hasApi: !!window.__heartline, title: document.title };
    })()`);

  getWindow().webContents.once('did-finish-load', async () => {
    const result = { steps: {} };
    try {
      await wait(1500);
      result.steps.initial = await inspect();
      const shot = await getWindow().webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'smoke-initial.png'), shot.toPNG());
      result.steps.restyleOn = await page(`(() => {
        const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        return { main: css('.Root__main-view', 'backgroundColor'), nav: css('.Root__nav-bar', 'backgroundColor'),
          root: css('.Root__top-container', 'backgroundColor'), play: css('.big-play', 'backgroundColor'),
          savedHeart: css('#r1 .hl-heart', 'color'), font: css('body', 'fontFamily') };
      })()`);
      await page(`window.__heartline.updateSettings({ restyle: false })`);
      await wait(200);
      fs.writeFileSync(path.join(outDir, 'smoke-restyle-off.png'), (await getWindow().webContents.capturePage()).toPNG());
      result.steps.restyleOff = await page(`getComputedStyle(document.querySelector('.Root__main-view')).backgroundColor`);
      await page(`window.__heartline.updateSettings({ restyle: true })`);
      await wait(200);

      // Click the heart on the playlist-only row (not liked yet).
      await page(`document.querySelector('#r3 .hl-heart').click()`);
      await wait(600);
      result.steps.afterRowClick = await inspect();

      // Tray / menu "Like" acts on the now-playing track (BBBB...).
      sendCommand('like');
      await wait(800);
      result.steps.afterLikeCommand = await inspect();

      sendCommand('next');
      sendCommand('playpause');
      await wait(400);
      result.steps.afterControls = await inspect();
      const shot2 = await getWindow().webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'smoke-after.png'), shot2.toPNG());

      sendCommand('open-settings');
      await wait(400);
      result.steps.settings = await page(`(() => {
        const d = document.querySelector('dialog.hl-panel');
        return d ? { open: d.open, status: d.querySelector('.hl-status').textContent,
          switches: [...d.querySelectorAll('input[type=checkbox]')].map((i) => [i.dataset.key, i.checked]) } : null;
      })()`);
      fs.writeFileSync(path.join(outDir, 'smoke-settings.png'), (await getWindow().webContents.capturePage()).toPNG());

      result.calls = calls;
      result.states = states;
      result.windowTitle = getWindow().getTitle();
      result.library = Object.fromEntries(library);
    } catch (err) {
      result.error = String(err && err.stack ? err.stack : err);
    }
    console.log(`SMOKE RESULT ${JSON.stringify(result)}`);
    app.exit(0);
  });

  return { onState: (s) => states.push(s) };
}

module.exports = { install };

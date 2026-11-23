'use strict';
/*
 * Sandboxed preload for the player window. Runs before the page's scripts.
 *  1. Injects the Heartline page script into the page's main world.
 *  2. Relays now-playing state up to the app and media commands down.
 * Exposes nothing to the page (no contextBridge API).
 */
const { ipcRenderer, webFrame } = require('electron');

const bundle = ipcRenderer.sendSync('heartline:bundle', window.location.href);

if (bundle && typeof bundle.js === 'string') {
  webFrame
    .executeJavaScript(`window.__HEARTLINE_APP__ = true;\n${bundle.js}\n//# sourceURL=heartline.js`)
    .catch((err) => console.error('[Heartline] Page script failed to start:', err));

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'heartline-page' || data.type !== 'state') return;
    ipcRenderer.send('heartline:state', data.state);
  });

  ipcRenderer.on('heartline:command', (_event, command) => {
    if (typeof command !== 'string') return;
    window.postMessage({ source: 'heartline-app', type: 'command', command }, window.location.origin);
  });
}

/*
 * Isolated-world content script. Carries messages between heartline.js (page main world,
 * window.postMessage) and the Android app (native messaging port "heartline").
 */
(() => {
  'use strict';
  const LOG = '[Heartline bridge]';
  let port = null;
  let retryMs = 500;
  let pending = null; // latest state while disconnected

  function connect() {
    try {
      port = browser.runtime.connectNative('heartline');
    } catch (err) {
      console.warn(LOG, 'connectNative failed, retrying:', err);
      port = null;
      retry();
      return;
    }
    port.onMessage.addListener((msg) => {
      if (msg && typeof msg.command === 'string') {
        window.postMessage({ source: 'heartline-app', type: 'command', command: msg.command }, window.location.origin);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      retry();
    });
    retryMs = 500;
    port.postMessage({ type: 'hello', url: window.location.href });
    if (pending) {
      port.postMessage({ type: 'state', state: pending });
      pending = null;
    }
  }

  function retry() {
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 10000);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'heartline-page' || data.type !== 'state') return;
    let state;
    try {
      state = JSON.parse(JSON.stringify(data.state));
    } catch (err) {
      console.warn(LOG, 'Unreadable state from page:', err);
      return;
    }
    if (port) port.postMessage({ type: 'state', state });
    else pending = state;
  });

  connect();
})();

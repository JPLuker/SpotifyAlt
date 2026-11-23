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
  let pendingDiag = null;

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      console.warn(LOG, 'Unreadable message from page:', err);
      return undefined;
    }
  }

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
    if (pendingDiag) {
      port.postMessage({ type: 'diag', diag: pendingDiag });
      pendingDiag = null;
    }
  }

  function retry() {
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 10000);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'heartline-page') return;
    if (data.type === 'diag') {
      if (port) port.postMessage({ type: 'diag', diag: clone(data.diag) });
      else pendingDiag = clone(data.diag);
      return;
    }
    if (data.type !== 'state') return;
    const state = clone(data.state);
    if (state === undefined) return;
    if (port) port.postMessage({ type: 'state', state });
    else pending = state;
  });

  connect();
})();

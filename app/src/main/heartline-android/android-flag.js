// Runs first in the page's main world: tells heartline.js it's inside the Android app.
window.__HEARTLINE_APP__ = true;
window.__HEARTLINE_PLATFORM__ = 'android';

// One check per page load: can this engine hand Spotify a Widevine key system?
// The answer goes to the app's log ("Heartline diag"), which the emulator test reads.
(() => {
  if (window.top !== window || !navigator.requestMediaKeySystemAccess) return;
  const report = (result) =>
    window.postMessage({ source: 'heartline-page', type: 'diag', diag: result }, window.location.origin);
  const config = [{
    initDataTypes: ['cenc'],
    audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
  }];
  navigator.requestMediaKeySystemAccess('com.widevine.alpha', config).then(
    (access) => report({ widevine: true, keySystem: access.keySystem }),
    (err) => report({ widevine: false, error: String((err && err.name) || err).slice(0, 120) }),
  );
})();

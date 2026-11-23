// Runs first in the page's main world: tells heartline.js it's inside the Android app.
window.__HEARTLINE_APP__ = true;
window.__HEARTLINE_PLATFORM__ = 'android';

// GeckoView's desktop mode changes the user agent only. Spotify's player can still see an
// Android touch phone (platform, touch points) and refuse to play or push its app. Make the
// rest of the browser match the desktop user agent. Touch input keeps working: these only
// change what feature checks report.
(() => {
  const pin = (proto, prop, value) => {
    try {
      Object.defineProperty(proto, prop, { get: () => value, configurable: true, enumerable: true });
    } catch (err) {
      console.warn('[Heartline] Could not set', prop, err);
    }
  };
  pin(Navigator.prototype, 'platform', 'Linux x86_64');
  pin(Navigator.prototype, 'oscpu', 'Linux x86_64');
  pin(Navigator.prototype, 'maxTouchPoints', 0);
  for (const proto of [Window.prototype, Document.prototype, HTMLElement.prototype]) {
    for (const prop of ['ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel']) {
      if (prop in proto) {
        try {
          delete proto[prop];
        } catch (err) {
          console.warn('[Heartline] Could not remove', prop, err);
        }
      }
    }
  }
})();

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

// Debug layout report, once, after the page settles: is our CSS in, is the restyle on, and
// what does Spotify's live markup look like. Used to keep the restyle and phone layout
// matched to the real site (desktop/docs/SELECTORS.md). Logged as "Heartline diag".
setTimeout(() => {
  if (window.top !== window || !document.body) return;
  const probe = document.createElement('div');
  probe.className = 'hl-native-hidden';
  document.body.appendChild(probe);
  const cssLoaded = getComputedStyle(probe).display === 'none';
  probe.remove();
  const bg = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).backgroundColor : null;
  };
  const outline = [];
  const walk = (el, depth) => {
    for (const child of el.children) {
      if (outline.length >= 160 || depth > 7) return;
      const id = child.id ? `#${child.id}` : '';
      const cls = [...child.classList].slice(0, 4).map((c) => c.slice(0, 32)).join('.');
      const tid = child.getAttribute('data-testid');
      outline.push(`${depth}:${child.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}${tid ? `[${tid}]` : ''}`);
      walk(child, depth + 1);
    }
  };
  walk(document.body, 0);
  const theme = document.querySelector('[class*="encore-"]');
  window.postMessage({
    source: 'heartline-page',
    type: 'diag',
    diag: {
      layout: {
        cssLoaded,
        platform: navigator.platform,
        touchPoints: navigator.maxTouchPoints,
        phoneClass: document.documentElement.classList.contains('hl-phone'),
        slots: [...document.querySelectorAll('[data-hl-shell] > *')].map((c) => `${c.getAttribute('data-hl-slot')}:${c.id || c.tagName.toLowerCase()}`).join(' '),
        restyleClass: document.documentElement.classList.contains('hl-qp'),
        innerWidth: window.innerWidth,
        viewport: (document.querySelector('meta[name=viewport]') || {}).content || null,
        encoreClass: theme ? [...theme.classList].filter((c) => c.startsWith('encore-')).join(' ') : null,
        bodyBg: bg('body'),
        rootBg: bg('.Root__top-container'),
        mainBg: bg('#main-view'),
        navBg: bg('#global-nav-bar'),
        mainWidth: (document.getElementById('main-view') || { offsetWidth: null }).offsetWidth,
        baseVar: theme ? getComputedStyle(theme).getPropertyValue('--background-base').trim() : null,
        outline,
      },
    },
  }, window.location.origin);
}, 12000);

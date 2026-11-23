/*
 * Heartline page script. Runs in the page's main world on open.spotify.com,
 * at document start, either from the Chrome extension (manifest "world": "MAIN")
 * or injected by the Heartline desktop app's preload.
 *
 * What it does:
 *  - Puts the heart back: one click saves to / removes from Liked Songs.
 *  - Optional UI tweaks and custom CSS.
 *  - In the desktop app, reports now-playing state and takes media commands.
 *
 * Tokens Spotify's own page uses are read from its outgoing requests and kept
 * in memory only. Nothing is stored except settings and learned query hashes.
 */
(() => {
  'use strict';
  if (window.__heartline) return;

  const VERSION = '0.2.5';
  const LOG = '[Heartline]';
  const SETTINGS_KEY = 'heartline.settings';
  const HASHES_KEY = 'heartline.queryHashes';
  const PATHFINDER_PREFIX = 'https://api-partner.spotify.com/pathfinder/';
  const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
  const IN_APP = window.__HEARTLINE_APP__ === true;
  const ANDROID = window.__HEARTLINE_PLATFORM__ === 'android';

  const DEFAULT_SETTINGS = Object.freeze({
    restyle: true,
    hearts: true,
    keepAddButton: false,
    hideUpsell: false,
    phoneLayout: true, // Android only: lay the desktop site out at the phone's width
    customCss: '',
  });

  // Persisted query hashes the web player used for these operations (Heartify 1.0.15).
  // The page's own requests replace these as soon as it sends one (learnHash).
  const DEFAULT_HASHES = Object.freeze({
    areEntitiesInLibrary: '134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed',
    addToLibrary: 'a3c1ff58e6a36fec5fe1e3a193dc95d9071d96b9ba53c5ba9c1494fb1ee73915',
    removeFromLibrary: 'a3c1ff58e6a36fec5fe1e3a193dc95d9071d96b9ba53c5ba9c1494fb1ee73915',
  });
  const LIBRARY_OPS = Object.keys(DEFAULT_HASHES);

  // Spotify's own "+" / check button. English labels; see docs/SELECTORS.md.
  const NATIVE_LABELS = ['Add to Liked Songs', 'Add to playlist'];
  const SEL = {
    native: NATIVE_LABELS.map((l) => `button[aria-label="${l}"]`).join(', '),
    row: '[data-testid="tracklist-row"]',
    rowTrackLink: 'a[href*="/track/"]',
    nowPlaying: '[data-testid="now-playing-widget"], [data-testid="NPV_Panel_OpenDiv"]',
    nowPlayingLink: '[data-testid="now-playing-widget"] a[data-testid="context-link"]',
    nowPlayingWidget: '[data-testid="now-playing-widget"]',
    playPause: '[data-testid="control-button-playpause"]',
    next: '[data-testid="control-button-skip-forward"]',
    previous: '[data-testid="control-button-skip-back"]',
    upsell: [
      '[data-testid="upgrade-button"]',
      'a[href*="/premium"]',
      'a[href="/download"]',
      'a[href*="/download?"]',
    ].join(', '),
  };

  const BATCH = 50;
  const CONFIRM_MS = 2500;
  const LOOKUP_TIMEOUT_MS = 10000;

  // ------------------------------------------------------------ diagnostics

  // Recent errors and playback problems, for "Copy diagnostic info". Tokens are redacted.
  const diagLog = [];
  function redact(text) {
    return String(text)
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_-]{40,}/g, '[long value]')
      .slice(0, 300);
  }
  function note(kind, ...parts) {
    diagLog.push(`${new Date().toISOString().slice(11, 19)} ${kind}: ${redact(parts.map((p) => (p && p.message) || p).join(' '))}`);
    if (diagLog.length > 40) diagLog.shift();
  }
  for (const level of ['error', 'warn']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      try {
        note(`console.${level}`, ...args);
      } catch (err) {
        // never let logging break the page's own logging
      }
      return original.apply(this, args);
    };
  }
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'AUDIO' || t.tagName === 'VIDEO')) note('media error', t.error && t.error.code, t.error && t.error.message);
    else note('error', e.message || (t && t.tagName));
  }, true);
  window.addEventListener('unhandledrejection', (e) => note('rejection', e.reason));
  let drmResult = 'not asked yet';
  if (navigator.requestMediaKeySystemAccess) {
    const ask = navigator.requestMediaKeySystemAccess.bind(navigator);
    navigator.requestMediaKeySystemAccess = function (keySystem, configs) {
      return ask(keySystem, configs).then(
        (access) => {
          drmResult = `${keySystem}: granted`;
          return access;
        },
        (err) => {
          drmResult = `${keySystem}: ${(err && err.name) || err}`;
          note('drm', drmResult);
          throw err;
        },
      );
    };
  }

  // ---------------------------------------------------------------- utilities

  const warned = new Set();
  function warnOnce(key, ...args) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(LOG, ...args);
  }

  function readJson(key, fallback) {
    let raw;
    try {
      raw = window.localStorage.getItem(key);
    } catch (err) {
      warnOnce('storage-read', 'localStorage unavailable, using defaults:', err);
      return fallback;
    }
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      warnOnce(`bad-json-${key}`, `Ignoring unreadable ${key}:`, err);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      warnOnce(`storage-write-${key}`, `Could not save ${key}:`, err);
      return false;
    }
  }

  /** Returns a spotify:track: URI from a link href, or null. */
  function trackUriFromHref(href) {
    if (typeof href !== 'string') return null;
    const direct = href.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/);
    if (direct) return `spotify:track:${direct[1]}`;
    const param = href.match(/[?&]uri=([^&#]+)/);
    if (param) {
      let uri;
      try {
        uri = decodeURIComponent(param[1]);
      } catch (err) {
        return null;
      }
      return isTrackUri(uri) ? uri : null;
    }
    return null;
  }

  function isTrackUri(uri) {
    return typeof uri === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(uri);
  }

  function readHeader(headers, name) {
    if (!headers) return null;
    const lower = name.toLowerCase();
    if (typeof headers.get === 'function') return headers.get(name);
    if (Array.isArray(headers)) {
      const hit = headers.find((pair) => String(pair[0]).toLowerCase() === lower);
      return hit ? hit[1] : null;
    }
    if (typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return headers[key];
      }
    }
    return null;
  }

  // ----------------------------------------------------------------- settings

  let settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(readJson(SETTINGS_KEY, {})) };

  function sanitizeSettings(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in raw)) continue;
      const want = typeof DEFAULT_SETTINGS[key];
      if (typeof raw[key] === want) out[key] = raw[key];
    }
    if (typeof out.customCss === 'string' && out.customCss.length > 100000) {
      out.customCss = out.customCss.slice(0, 100000);
    }
    return out;
  }

  function updateSettings(patch) {
    settings = { ...settings, ...sanitizeSettings(patch) };
    writeJson(SETTINGS_KEY, settings);
    applySettings();
    scheduleScan();
  }

  // ------------------------------------------------------------ auth + hashes

  const auth = { headers: {}, seenAt: 0 };
  const COPY_HEADERS = ['authorization', 'client-token', 'app-platform', 'spotify-app-version', 'accept-language'];
  let hashes = { ...DEFAULT_HASHES, ...sanitizeHashes(readJson(HASHES_KEY, {})) };

  function sanitizeHashes(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const op of LIBRARY_OPS) {
      if (typeof raw[op] === 'string' && /^[0-9a-f]{64}$/.test(raw[op])) out[op] = raw[op];
    }
    return out;
  }

  function learnHash(op, hash) {
    if (!LIBRARY_OPS.includes(op) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return;
    if (hashes[op] === hash) return;
    hashes = { ...hashes, [op]: hash };
    writeJson(HASHES_KEY, sanitizeHashes(hashes));
  }

  function captureHeaders(headers) {
    const auth0 = readHeader(headers, 'authorization');
    if (typeof auth0 !== 'string' || !auth0.startsWith('Bearer ')) return;
    const next = {};
    for (const name of COPY_HEADERS) {
      const value = readHeader(headers, name);
      if (typeof value === 'string' && value) next[name] = value;
    }
    const hadToken = !!auth.headers.authorization;
    auth.headers = next;
    auth.seenAt = Date.now();
    if (!hadToken) {
      status.auth = 'ready';
      scheduleScan();
    }
  }

  /** Looks at a request the page itself is sending. Never throws. */
  function inspectOutgoing(url, headers, body) {
    try {
      if (typeof url !== 'string' || !url.startsWith(PATHFINDER_PREFIX)) return;
      captureHeaders(headers);
      if (typeof body !== 'string' || body.length > 200000) return;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        return; // not JSON (GET-style query); nothing to learn
      }
      const op = parsed && parsed.operationName;
      learnHash(op, parsed?.extensions?.persistedQuery?.sha256Hash);
      if (op === 'addToLibrary' || op === 'removeFromLibrary') {
        const uris = parsed?.variables?.uris;
        if (Array.isArray(uris)) {
          const tracks = uris.filter(isTrackUri);
          tracks.forEach((uri) => setSaved(uri, op === 'addToLibrary'));
          // The page's request could still fail; confirm with Spotify shortly after.
          if (tracks.length) setTimeout(() => lookup(tracks, true), CONFIRM_MS);
        }
      }
    } catch (err) {
      warnOnce('inspect', 'Could not read an outgoing request:', err);
    }
  }

  // Wrap fetch and XHR so we see the page's own Spotify API calls.
  const pageFetch = window.fetch;
  if (typeof pageFetch === 'function') {
    const wrapped = function fetch(input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const headers = (init && init.headers) || (input && typeof input === 'object' && input.headers);
      const body = init && init.body;
      inspectOutgoing(url instanceof URL ? url.href : url, headers, typeof body === 'string' ? body : null);
      return pageFetch.apply(this, arguments);
    };
    window.fetch = wrapped;
  }

  if (window.XMLHttpRequest) {
    const proto = window.XMLHttpRequest.prototype;
    const open = proto.open;
    const setHeader = proto.setRequestHeader;
    const send = proto.send;
    const META = Symbol('heartline');
    proto.open = function (method, url) {
      this[META] = { url: String(url), headers: {} };
      return open.apply(this, arguments);
    };
    proto.setRequestHeader = function (name, value) {
      if (this[META]) this[META].headers[String(name).toLowerCase()] = String(value);
      return setHeader.apply(this, arguments);
    };
    proto.send = function (body) {
      const meta = this[META];
      if (meta) inspectOutgoing(meta.url, meta.headers, typeof body === 'string' ? body : null);
      return send.apply(this, arguments);
    };
  }

  // The player's live state arrives over the "dealer" WebSocket.
  let dealerTrackUri = null;
  if (typeof window.WebSocket === 'function') {
    const PageWebSocket = window.WebSocket;
    const HeartlineWebSocket = function WebSocket(...args) {
      const ws = new PageWebSocket(...args);
      ws.addEventListener('message', onDealerMessage);
      return ws;
    };
    HeartlineWebSocket.prototype = PageWebSocket.prototype;
    Object.setPrototypeOf(HeartlineWebSocket, PageWebSocket);
    window.WebSocket = HeartlineWebSocket;
  }

  function onDealerMessage(event) {
    if (typeof event.data !== 'string' || event.data.length > 2000000) return;
    if (!event.data.includes('player_state')) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    const payloads = Array.isArray(msg?.payloads) ? msg.payloads : [];
    for (const p of payloads) {
      const uri = p?.cluster?.player_state?.track?.uri;
      if (typeof uri === 'string') {
        const next = isTrackUri(uri) ? uri : null;
        if (next !== dealerTrackUri) {
          dealerTrackUri = next;
          scheduleScan();
          scheduleState();
        }
        return;
      }
    }
  }

  function currentTrackUri() {
    if (dealerTrackUri) return dealerTrackUri;
    const link = document.querySelector(SEL.nowPlayingLink);
    return link ? trackUriFromHref(link.getAttribute('href')) : null;
  }

  // ------------------------------------------------------------ library state

  const saved = new Map(); // uri -> boolean (known truth)
  const inFlight = new Set();
  const retryAfter = new Map(); // uri -> time a failed lookup may run again
  const toggling = new Set();
  const RETRY_MS = 60000;
  const status = { auth: 'waiting', lookup: 'idle', lastError: null };

  function setSaved(uri, value) {
    if (saved.get(uri) === value) return;
    saved.set(uri, value);
    scheduleScan();
    if (uri === currentTrackUri()) scheduleState();
  }

  async function pathfinder(op, uris) {
    if (!auth.headers.authorization) throw new Error('no-token');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS) : null;
    try {
      const res = await pageFetch.call(window, PATHFINDER_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        signal: controller ? controller.signal : undefined,
        headers: { ...auth.headers, 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          variables: { uris },
          operationName: op,
          extensions: { persistedQuery: { version: 1, sha256Hash: hashes[op] } },
        }),
      });
      if (!res.ok) throw new Error(`http-${res.status}`);
      const json = await res.json();
      if (Array.isArray(json?.errors) && json.errors.length) {
        throw new Error(`api-${String(json.errors[0]?.message || 'error').slice(0, 80)}`);
      }
      return json;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function lookup(uris, force = false) {
    const now = Date.now();
    const todo = [...new Set(uris)].filter(
      (u) => isTrackUri(u) && (force || !saved.has(u)) && !inFlight.has(u) && (force || !(retryAfter.get(u) > now)),
    );
    if (!todo.length || !auth.headers.authorization) return;
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      chunk.forEach((u) => inFlight.add(u));
      status.lookup = 'running';
      try {
        const json = await pathfinder('areEntitiesInLibrary', chunk);
        const items = json?.data?.lookup;
        if (!Array.isArray(items) || items.length !== chunk.length) throw new Error('unexpected-shape');
        chunk.forEach((uri, n) => {
          const value = items[n]?.data?.saved;
          if (typeof value === 'boolean') {
            saved.set(uri, value);
            retryAfter.delete(uri);
          }
        });
        status.lookup = 'ok';
        status.lastError = null;
      } catch (err) {
        // Leave Spotify's own button in place for these tracks (degrade, don't guess).
        status.lookup = 'failed';
        chunk.forEach((u) => retryAfter.set(u, Date.now() + RETRY_MS));
        status.lastError = String(err && err.message ? err.message : err);
        warnOnce(`lookup-${status.lastError}`, 'Liked Songs lookup failed, showing Spotify\'s button instead:', status.lastError);
      } finally {
        chunk.forEach((u) => inFlight.delete(u));
      }
    }
    scheduleScan();
    scheduleState();
  }

  async function toggle(uri) {
    if (!saved.has(uri) || toggling.has(uri)) return false;
    toggling.add(uri);
    const was = saved.get(uri);
    setSaved(uri, !was); // optimistic
    try {
      await pathfinder(was ? 'removeFromLibrary' : 'addToLibrary', [uri]);
      return true;
    } catch (err) {
      setSaved(uri, was);
      status.lastError = String(err && err.message ? err.message : err);
      warnOnce(`toggle-${status.lastError}`, 'Could not change Liked Songs:', status.lastError);
      return false;
    } finally {
      toggling.delete(uri);
    }
  }

  // ------------------------------------------------------------------- hearts

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HEART_PATH = 'M8 13.6C4.4 11.1 1.75 8.7 1.75 5.9A3.15 3.15 0 0 1 4.9 2.75c1.25 0 2.4.7 3.1 1.8.7-1.1 1.85-1.8 3.1-1.8a3.15 3.15 0 0 1 3.15 3.15c0 2.8-2.65 5.2-6.25 7.7z';

  function makeHeart() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hl-heart';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', HEART_PATH);
    svg.appendChild(path);
    btn.appendChild(svg);
    btn.addEventListener('click', onHeartClick, true);
    btn.addEventListener('dblclick', stop, true);
    btn.addEventListener('mousedown', stop, true);
    return btn;
  }

  function stop(event) {
    event.stopPropagation();
  }

  function onHeartClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const uri = event.currentTarget.dataset.hlUri;
    if (isTrackUri(uri)) toggle(uri);
  }

  function paintHeart(heart, uri, isSaved, kind) {
    heart.dataset.hlUri = uri;
    heart.dataset.hlKind = kind;
    heart.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
    const label = isSaved ? 'Remove from Liked Songs' : 'Save to Liked Songs';
    if (heart.getAttribute('aria-label') !== label) {
      heart.setAttribute('aria-label', label);
      heart.title = label;
    }
  }

  /** Works out which track a native "+" button belongs to. */
  function contextFor(btn) {
    const row = btn.closest(SEL.row);
    if (row) {
      const link = row.querySelector(SEL.rowTrackLink);
      return { kind: 'row', uri: link ? trackUriFromHref(link.getAttribute('href')) : null };
    }
    if (btn.closest(SEL.nowPlaying)) return { kind: 'now', uri: currentTrackUri() };
    return null;
  }

  function restoreNative(btn) {
    btn.classList.remove('hl-native-hidden');
    const prev = btn.previousElementSibling;
    if (prev && prev.classList.contains('hl-heart')) prev.remove();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 40);
  }

  function scan() {
    ensureRootClasses();
    if (PHONE()) layoutPhone();
    const natives = document.querySelectorAll(SEL.native);
    // Hearts whose Spotify button is gone (React re-rendered) go too.
    document.querySelectorAll('.hl-heart').forEach((heart) => {
      const next = heart.nextElementSibling;
      if (!next || !next.matches(SEL.native)) heart.remove();
    });
    if (!settings.hearts) {
      natives.forEach(restoreNative);
      return;
    }
    const wanted = [];
    natives.forEach((btn) => {
      const ctx = contextFor(btn);
      if (!ctx || !ctx.uri || !saved.has(ctx.uri)) {
        if (ctx && ctx.uri) wanted.push(ctx.uri);
        restoreNative(btn);
        return;
      }
      let heart = btn.previousElementSibling;
      if (!heart || !heart.classList.contains('hl-heart')) {
        heart = makeHeart();
        btn.parentElement.insertBefore(heart, btn);
      }
      paintHeart(heart, ctx.uri, saved.get(ctx.uri), ctx.kind);
      btn.classList.toggle('hl-native-hidden', !settings.keepAddButton);
    });
    if (wanted.length) lookup(wanted);
  }

  // ---------------------------------------------------------- settings panel

  let panel = null;

  function buildPanel() {
    const dialog = document.createElement('dialog');
    dialog.className = 'hl-panel';
    dialog.setAttribute('aria-labelledby', 'hl-panel-title');

    const head = document.createElement('div');
    head.className = 'hl-panel-head';
    const title = document.createElement('h2');
    title.id = 'hl-panel-title';
    title.textContent = 'Heartline';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hl-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    head.append(title, close);

    const toggles = [
      ['restyle', 'Restyle Spotify'],
      ['hearts', 'Heart buttons'],
      ['keepAddButton', 'Keep Spotify\'s + button too'],
      ['hideUpsell', 'Hide Premium and app download buttons'],
      ...(ANDROID ? [['phoneLayout', 'Fit to phone width']] : []),
    ];
    const list = document.createElement('div');
    list.className = 'hl-panel-list';
    for (const [key, text] of toggles) {
      const label = document.createElement('label');
      label.className = 'hl-row';
      const span = document.createElement('span');
      span.textContent = text;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.dataset.key = key;
      input.className = 'hl-switch';
      input.addEventListener('change', () => updateSettings({ [key]: input.checked }));
      label.append(span, input);
      list.append(label);
    }

    const cssLabel = document.createElement('label');
    cssLabel.className = 'hl-css';
    const cssText = document.createElement('span');
    cssText.textContent = 'Custom CSS';
    const css = document.createElement('textarea');
    css.spellcheck = false;
    css.rows = 8;
    css.dataset.key = 'customCss';
    let cssTimer = null;
    css.addEventListener('input', () => {
      clearTimeout(cssTimer);
      cssTimer = setTimeout(() => updateSettings({ customCss: css.value }), 300);
    });
    cssLabel.append(cssText, css);

    const state = document.createElement('p');
    state.className = 'hl-status';
    state.setAttribute('role', 'status');

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'hl-btn hl-copy';
    copy.textContent = 'Copy diagnostic info';
    const copyOut = document.createElement('textarea');
    copyOut.className = 'hl-diag';
    copyOut.readOnly = true;
    copyOut.hidden = true;
    copyOut.setAttribute('aria-label', 'Diagnostic info');
    copy.addEventListener('click', () => {
      const text = diagnosticText();
      const shown = () => {
        copyOut.hidden = false;
        copyOut.value = text;
        copyOut.select();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => {
            copy.textContent = 'Copied';
            setTimeout(() => (copy.textContent = 'Copy diagnostic info'), 2000);
          },
          shown,
        );
      } else {
        shown();
      }
    });

    const ver = document.createElement('p');
    ver.className = 'hl-version';
    ver.textContent = `v${VERSION}`;

    dialog.append(head, list, cssLabel, state, copy, copyOut, ver);
    dialog.addEventListener('keydown', (e) => e.stopPropagation()); // keep Spotify's shortcuts out of the panel
    return dialog;
  }

  function statusText() {
    if (!settings.hearts) return 'Hearts off';
    if (status.auth !== 'ready') return 'Hearts: waiting for Spotify to sign in';
    if (status.lookup === 'failed') return `Hearts: lookup failed (${status.lastError}). Showing Spotify's button instead.`;
    return 'Hearts: working';
  }

  function diagnosticText() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"]')]
      .filter((d) => !d.classList.contains('hl-panel') && d.offsetParent !== null)
      .map((d) => redact((d.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 200))
      .filter(Boolean);
    const shell = document.querySelector('[data-hl-shell]');
    const slots = shell ? [...shell.children].map((c) => `${c.getAttribute('data-hl-slot')}:${c.id || c.tagName.toLowerCase()}`).join(' ') : 'none';
    const audio = [...document.querySelectorAll('audio, video')].map((m) =>
      `${m.tagName.toLowerCase()} paused=${m.paused} ready=${m.readyState} err=${m.error ? m.error.code : 'none'}`);
    return [
      `Heartline ${VERSION} ${ANDROID ? 'android' : IN_APP ? 'desktop app' : 'browser'}`,
      `UA: ${navigator.userAgent}`,
      `Page: ${location.pathname}  width: ${window.innerWidth}px`,
      `Signed in: ${document.querySelector('[data-testid="login-button"]') ? 'no' : 'yes'}`,
      `DRM: ${drmResult}`,
      `Media: ${audio.join('; ') || 'none'}`,
      `Hearts: ${statusText()}`,
      `Layout: ${slots}`,
      `Dialogs: ${dialogs.join(' | ') || 'none'}`,
      'Recent problems:',
      ...(diagLog.length ? diagLog : ['none']),
    ].join('\n');
  }

  function openPanel() {
    if (!document.body) return;
    if (!panel) {
      panel = buildPanel();
      document.body.appendChild(panel);
    }
    panel.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key;
      if (el.type === 'checkbox') el.checked = !!settings[key];
      else el.value = settings[key];
    });
    panel.querySelector('.hl-status').textContent = statusText();
    if (!panel.open) panel.showModal();
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') {
        e.preventDefault();
        e.stopPropagation();
        openPanel();
      }
    },
    true,
  );

  // ----------------------------------------------------------- apply settings

  // ----------------------------------------------------------- phone layout

  // Spotify's desktop player won't go below ~810px wide. On a phone we turn its grid into
  // one column: nav on top, the page, the player bar at the bottom. The library opens as a
  // full-screen panel from a button in the nav. Hooks: docs/SELECTORS.md.
  const PHONE = () => ANDROID && settings.phoneLayout;
  const LIBRARY_PATH = 'M3 3h2v18H3zM8 3h2v18H8zM13.2 3.6l1.9-.6 5.7 17.4-1.9.6z';

  function slotFor(child) {
    if (child.id === 'global-nav-bar') return 'nav';
    if (child.id === 'Desktop_LeftSidebar_Id') return 'library';
    if (child.id === 'main-view') return 'main';
    if (child.id === 'lyrics-cinema') return 'overlay';
    if (child.matches('[data-testid="now-playing-bar"]') || child.querySelector(`[data-testid="now-playing-bar"], ${SEL.playPause}`)) return 'bar';
    // Decide by content, never by size: our own hiding makes hidden panels measure zero,
    // and a size test would flip them back and forth.
    if (child.querySelector('#floating-ui-popover-layer, [class*="modal"], [role="dialog"]')) return 'overlay';
    if (child.childElementCount === 0 && !child.textContent.trim()) return 'overlay';
    const pos = getComputedStyle(child).position;
    if (pos === 'absolute' || pos === 'fixed') return 'overlay';
    return 'side';
  }

  function commonAncestor(a, b) {
    for (let el = a; el; el = el.parentElement) if (el.contains(b)) return el;
    return null;
  }

  function layoutPhone() {
    const root = document.documentElement;
    const on = PHONE();
    root.classList.toggle('hl-phone', on);
    if (!on) {
      root.classList.remove('hl-library-open');
      return;
    }
    const shell = document.querySelector('[data-testid="root"] > div');
    if (shell) {
      if (!shell.hasAttribute('data-hl-shell')) shell.setAttribute('data-hl-shell', '');
      for (const child of shell.children) {
        const slot = slotFor(child);
        if (child.getAttribute('data-hl-slot') !== slot) child.setAttribute('data-hl-slot', slot);
      }
      const nav = shell.querySelector(':scope > [data-hl-slot="nav"]');
      const bar = shell.querySelector(':scope > [data-hl-slot="bar"]');
      root.style.setProperty('--hl-nav-h', `${nav ? nav.offsetHeight : 0}px`);
      root.style.setProperty('--hl-bar-h', `${bar ? bar.offsetHeight : 0}px`);
    }
    // Player bar: track on one row, controls on the next, extras (volume, devices) hidden.
    const widget = document.querySelector(SEL.nowPlayingWidget);
    const controls = document.querySelector('[data-testid="player-controls"]');
    if (widget && controls) {
      const row = commonAncestor(widget, controls);
      if (row && row !== document.body) {
        if (!row.hasAttribute('data-hl-np-row')) row.setAttribute('data-hl-np-row', '');
        for (const c of row.children) {
          const part = c.contains(widget) ? 'track' : c.contains(controls) ? 'controls' : 'extra';
          if (c.getAttribute('data-hl-np') !== part) c.setAttribute('data-hl-np', part);
        }
      }
    }
    ensureLibraryButton();
  }

  function ensureLibraryButton() {
    const home = document.querySelector('#global-nav-bar [data-testid="home-button"]');
    if (!home || document.getElementById('hl-library-button')) return;
    const btn = document.createElement('button');
    btn.id = 'hl-library-button';
    btn.type = 'button';
    btn.className = home.className; // look like Spotify's own nav buttons
    btn.setAttribute('aria-label', 'Your Library');
    btn.setAttribute('aria-expanded', 'false');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', LIBRARY_PATH);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    btn.appendChild(svg);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setLibraryOpen(!document.documentElement.classList.contains('hl-library-open'));
    });
    home.insertAdjacentElement('afterend', btn);
  }

  function setLibraryOpen(open) {
    document.documentElement.classList.toggle('hl-library-open', open);
    const btn = document.getElementById('hl-library-button');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Picking something in the library navigates; close the panel when that happens.
  for (const fn of ['pushState', 'replaceState']) {
    const original = history[fn];
    history[fn] = function (...args) {
      const result = original.apply(this, args);
      if (fn === 'pushState') setLibraryOpen(false);
      return result;
    };
  }
  window.addEventListener('popstate', () => setLibraryOpen(false));

  /** Spotify can rewrite <html>'s classes; put ours back. */
  function ensureRootClasses() {
    const root = document.documentElement;
    if (!root) return;
    if (root.classList.contains('hl-qp') !== !!settings.restyle) root.classList.toggle('hl-qp', !!settings.restyle);
    if (root.classList.contains('hl-android') !== ANDROID) root.classList.toggle('hl-android', ANDROID);
    if (root.classList.contains('hl-hide-upsell') !== !!settings.hideUpsell) root.classList.toggle('hl-hide-upsell', !!settings.hideUpsell);
  }

  function applyViewport() {
    if (!ANDROID) return;
    const head = document.head;
    if (!head) return;
    let meta = document.getElementById('hl-viewport');
    if (!settings.phoneLayout) {
      if (meta) meta.remove();
      return;
    }
    if (!meta) {
      meta = document.createElement('meta');
      meta.id = 'hl-viewport';
      meta.name = 'viewport';
      head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1';
  }

  function applySettings() {
    const root = document.documentElement;
    if (!root) return;
    applyViewport();
    root.classList.toggle('hl-android', ANDROID);
    layoutPhone();
    root.classList.toggle('hl-hide-upsell', !!settings.hideUpsell);
    root.classList.toggle('hl-qp', !!settings.restyle);
    let style = document.getElementById('hl-custom-css');
    if (!settings.customCss) {
      if (style) style.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = 'hl-custom-css';
      (document.head || root).appendChild(style);
    }
    if (style.textContent !== settings.customCss) style.textContent = settings.customCss;
  }

  // ------------------------------------------------------- desktop app bridge

  let lastStateJson = '';
  let stateTimer = null;
  function scheduleState() {
    if (!IN_APP || stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      postState();
    }, 100);
  }

  function readState() {
    const ms = navigator.mediaSession;
    const meta = ms && ms.metadata;
    const uri = currentTrackUri();
    const art = meta && Array.isArray(meta.artwork) && meta.artwork.length
      ? meta.artwork[meta.artwork.length - 1].src
      : '';
    return {
      title: meta ? String(meta.title || '') : '',
      artist: meta ? String(meta.artist || '') : '',
      album: meta ? String(meta.album || '') : '',
      artwork: typeof art === 'string' && art.startsWith('https://') ? art : '',
      playing: ms ? ms.playbackState === 'playing' : false,
      uri: uri || '',
      liked: uri && saved.has(uri) ? saved.get(uri) : null,
    };
  }

  function postState() {
    const state = readState();
    const json = JSON.stringify(state);
    if (json === lastStateJson) return;
    lastStateJson = json;
    window.postMessage({ source: 'heartline-page', type: 'state', state }, window.location.origin);
  }

  function clickControl(selector) {
    const el = document.querySelector(selector);
    if (el && !el.disabled) {
      el.click();
      return true;
    }
    return false;
  }

  async function runCommand(command) {
    switch (command) {
      case 'playpause':
        return clickControl(SEL.playPause);
      case 'next':
        return clickControl(SEL.next);
      case 'previous':
        return clickControl(SEL.previous);
      case 'like': {
        const uri = currentTrackUri();
        if (!uri) return false;
        if (!saved.has(uri)) await lookup([uri]);
        return saved.has(uri) ? toggle(uri) : false;
      }
      case 'open-settings':
        openPanel();
        return true;
      default:
        return false;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'heartline-app') return;
    if (e.data.type === 'command' && typeof e.data.command === 'string') runCommand(e.data.command);
  });

  // ------------------------------------------------------------------- start

  const observer = new MutationObserver(() => {
    scheduleScan();
    scheduleState();
  });

  function start() {
    applySettings();
    if (ANDROID && !document.head) document.addEventListener('DOMContentLoaded', applyViewport, { once: true });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'href'],
    });
    scheduleScan();
    if (IN_APP) setInterval(postState, 1000);
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  Object.defineProperty(window, '__heartline', {
    value: Object.freeze({
      version: VERSION,
      status: () => ({ ...status, text: statusText() }),
      settings: () => ({ ...settings }),
      updateSettings,
      openPanel,
      runCommand,
      diagnosticText,
      _layoutPhone: layoutPhone,
      isSaved: (uri) => (saved.has(uri) ? saved.get(uri) : null),
      _scanNow: scan,
      _trackUriFromHref: trackUriFromHref,
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

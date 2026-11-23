'use strict';
/*
 * Heartline: the Spotify web player in its own window.
 * Built on castLabs' Electron for Content Security (Widevine), which Spotify
 * needs for playback. Stock Electron opens the site but can't play music.
 */
const { app, BrowserWindow, Menu, Tray, components, ipcMain, nativeImage, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('./policy');
const store = require('./store');
const { chromeUserAgent } = require('./ua');
const { COMMANDS, sanitizeState, windowTitle } = require('./state');

const PARTITION = 'persist:spotify';
const START_URL = `https://${policy.APP_HOST}/`;
const ROOT = path.join(__dirname, '..', '..');
// The page script is shared with the Android app; it lives at the repo root and ships as a resource.
const EXTENSION_DIR = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(ROOT, '..', 'extension');
const ICON_DIR = path.join(ROOT, 'build', 'icons');

// Development only: point the window at a local test page (used by the smoke test).
const DEV_URL = !app.isPackaged ? argValue('--dev-url') : null;
const SMOKE = !app.isPackaged && process.argv.includes('--smoke');

app.setName('Heartline');
if (process.platform === 'win32') app.setAppUserModelId('com.jpluker.heartline');

let mainWindow = null;
let tray = null;
let quitting = false;
let nowPlaying = sanitizeState({});
let settings = null;
let bundle = null;
let smoke = null;

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

function readBundle() {
  return {
    js: fs.readFileSync(path.join(EXTENSION_DIR, 'heartline.js'), 'utf8'),
    css: fs.readFileSync(path.join(EXTENSION_DIR, 'heartline.css'), 'utf8'),
  };
}

function iconPath(name) {
  const file = path.join(ICON_DIR, name);
  return fs.existsSync(file) ? file : null;
}

// ------------------------------------------------------------ single instance

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const target = argv.map(policy.argToPlayerUrl).find(Boolean);
    showWindow();
    if (target && mainWindow) loadPlayer(target);
  });
  app.whenReady().then(start, (err) => {
    console.error('[Heartline] Startup failed:', err);
    app.exit(1);
  });
}

async function start() {
  if (components && typeof components.whenReady === 'function') {
    try {
      await components.whenReady();
      console.log('[Heartline] Widevine ready:', JSON.stringify(components.status()));
    } catch (err) {
      // Keep going: the site still loads, but Spotify will say playback isn't supported.
      console.error('[Heartline] Widevine did not load. Playback will not work:', err);
    }
  } else {
    console.warn('[Heartline] This Electron build has no Widevine (not castLabs ECS). Playback will not work.');
  }

  settings = store.load(app.getPath('userData'));
  bundle = readBundle();
  setupSession();
  setupIpc();
  setupMenu();
  createWindow();
  setupTray();
}

// ------------------------------------------------------------------- session

function setupSession() {
  const ses = session.fromPartition(PARTITION);
  const ua = chromeUserAgent(process.platform, process.versions.chrome);
  ses.setUserAgent(ua);
  app.userAgentFallback = ua;

  const allowed = new Set(['mediaKeySystem', 'fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details && (details.requestingUrl || details.securityOrigin);
    callback(allowed.has(permission) && policy.isInAppUrl(origin || wc.getURL(), DEV_URL));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    return allowed.has(permission) && policy.isInAppUrl(origin || (wc && wc.getURL()) || '', DEV_URL);
  });
  ses.on('will-download', (event) => event.preventDefault());
}

// ------------------------------------------------------------------- windows

function createWindow() {
  const b = settings.bounds;
  mainWindow = new BrowserWindow({
    title: 'Heartline',
    width: b ? b.width : 1280,
    height: b ? b.height : 820,
    x: b ? b.x : undefined,
    y: b ? b.y : undefined,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    ...(iconPath('256x256.png') ? { icon: iconPath('256x256.png') } : {}),
    show: false,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (settings.maximized) mainWindow.maximize();

  const wc = mainWindow.webContents;
  guardContents(wc);

  wc.on('dom-ready', () => {
    if (policy.isPlayerUrl(wc.getURL(), DEV_URL)) {
      wc.insertCSS(bundle.css).catch((err) => console.error('[Heartline] Could not add styles:', err));
    }
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 is an aborted load (a newer navigation replaced it), not a failure.
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    console.warn(`[Heartline] Could not load ${url}: ${description} (${code})`);
    mainWindow.loadFile(path.join(ROOT, 'src', 'offline.html')).catch((err) => console.error('[Heartline] Offline page failed:', err));
  });
  wc.on('render-process-gone', (_e, details) => {
    console.error('[Heartline] Page process ended:', details.reason);
    if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => wc.reload(), 1000);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(windowTitle(nowPlaying));
  });

  let saveTimer = null;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 500);
  };
  mainWindow.on('resize', remember);
  mainWindow.on('move', remember);
  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!quitting && tray && settings.closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (SMOKE) {
    smoke = require('../../test/smoke/hooks').install({
      app,
      session,
      partition: PARTITION,
      getWindow: () => mainWindow,
      sendCommand,
      outDir: argValue('--smoke-out') || app.getPath('temp'),
    });
  }

  const target = process.argv.map(policy.argToPlayerUrl).find(Boolean);
  loadPlayer(DEV_URL || target || START_URL);
}

function loadPlayer(url) {
  mainWindow.loadURL(url).catch((err) => {
    // did-fail-load shows the offline page; this only notes which load it was.
    if (err && err.code !== 'ERR_ABORTED') console.warn(`[Heartline] Load of ${url} ended: ${err.code || err.message}`);
  });
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  settings.maximized = mainWindow.isMaximized();
  if (!settings.maximized && !mainWindow.isMinimized()) settings.bounds = mainWindow.getBounds();
  store.save(app.getPath('userData'), settings);
}

/** Navigation and popup rules for any web contents we create. */
function guardContents(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (policy.isAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          parent: mainWindow || undefined,
          autoHideMenuBar: true,
          backgroundColor: '#121212',
          webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => guardPopup(child.webContents));
  wc.on('will-navigate', (event, url) => {
    if (!policy.isInAppUrl(url, DEV_URL)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  wc.on('will-redirect', (event, url) => {
    if (!policy.isInAppUrl(url, DEV_URL) && !policy.isAuthPopupUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

/** Sign-in popups may move between provider and Spotify pages, nothing else. */
function guardPopup(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  const check = (event, url) => {
    if (!policy.isAuthPopupUrl(url) && !policy.isInAppUrl(url, DEV_URL)) {
      event.preventDefault();
      openExternal(url);
    }
  };
  wc.on('will-navigate', check);
  wc.on('will-redirect', check);
}

function openExternal(url) {
  if (policy.isExternalOk(url)) {
    shell.openExternal(url).catch((err) => console.warn('[Heartline] Could not open link:', err.message));
  }
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ----------------------------------------------------------------------- IPC

function fromMainWindow(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

function setupIpc() {
  ipcMain.on('heartline:bundle', (event, href) => {
    // Only the player page in our own window gets the script.
    event.returnValue = fromMainWindow(event) && policy.isPlayerUrl(String(href), DEV_URL) ? { js: bundle.js } : null;
  });

  ipcMain.on('heartline:state', (event, raw) => {
    if (!fromMainWindow(event)) return;
    const next = sanitizeState(raw);
    if (!next) return;
    nowPlaying = next;
    mainWindow.setTitle(windowTitle(nowPlaying));
    updateTray();
    if (smoke) smoke.onState(nowPlaying);
  });
}

function sendCommand(command) {
  if (!COMMANDS.has(command) || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('heartline:command', command);
}

// ---------------------------------------------------------------------- menu

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Heartline',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            showWindow();
            sendCommand('open-settings');
          },
        },
        {
          label: 'Close to tray',
          type: 'checkbox',
          checked: !!(settings && settings.closeToTray),
          click: (item) => {
            settings.closeToTray = item.checked;
            store.save(app.getPath('userData'), settings);
          },
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play / Pause', click: () => sendCommand('playpause') },
        { label: 'Next', click: () => sendCommand('next') },
        { label: 'Previous', click: () => sendCommand('previous') },
        { label: 'Like / Unlike', accelerator: 'CmdOrCtrl+Shift+L', click: () => sendCommand('like') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------- tray

function setupTray() {
  // The tray needs Joseph's icon in build/icons/tray.png; without it there is no tray.
  const file = iconPath('tray.png');
  if (!file) return;
  try {
    tray = new Tray(nativeImage.createFromPath(file));
  } catch (err) {
    console.warn('[Heartline] No tray on this desktop:', err.message);
    tray = null;
    return;
  }
  tray.on('click', showWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const s = nowPlaying;
  tray.setToolTip(s.title ? windowTitle(s) : 'Heartline');
  const menu = Menu.buildFromTemplate([
    { label: s.title ? windowTitle(s) : 'Nothing playing', enabled: false },
    { type: 'separator' },
    { label: s.playing ? 'Pause' : 'Play', click: () => sendCommand('playpause') },
    { label: 'Next', click: () => sendCommand('next') },
    { label: 'Previous', click: () => sendCommand('previous') },
    {
      label: 'Liked',
      type: 'checkbox',
      checked: s.liked === true,
      enabled: s.liked !== null,
      click: () => sendCommand('like'),
    },
    { type: 'separator' },
    { label: 'Show Heartline', click: showWindow },
    { label: 'Quit', click: quit },
  ]);
  tray.setContextMenu(menu);
}

function quit() {
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (app.isReady()) showWindow();
});

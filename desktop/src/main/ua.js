'use strict';
/*
 * Spotify's web player checks the browser. Electron's default user agent names
 * Electron and the app, so we send a plain Chrome one built from the bundled
 * Chromium version (never a hard-coded number that goes stale).
 */

function chromeUserAgent(platform, chromeVersion) {
  const major = String(chromeVersion || '').split('.')[0];
  if (!/^\d+$/.test(major)) throw new Error(`Unexpected Chromium version: ${chromeVersion}`);
  const os =
    platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

module.exports = { chromeUserAgent };

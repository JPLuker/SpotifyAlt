'use strict';
/*
 * Which URLs the app opens itself and which go to the system browser.
 * Pure functions, unit tested in test/policy.test.js.
 */

const APP_HOST = 'open.spotify.com';

// Spotify's own sign-in pages load in the main window.
const SPOTIFY_AUTH_HOSTS = new Set(['accounts.spotify.com', 'challenge.spotify.com']);

// Third-party sign-in providers Spotify offers. They open in a small child window.
const PROVIDER_AUTH_HOSTS = new Set([
  'accounts.google.com',
  'www.facebook.com',
  'm.facebook.com',
  'appleid.apple.com',
]);

function parse(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isHttps(u) {
  return !!u && u.protocol === 'https:' && !u.username && !u.password;
}

/** URLs the main window may navigate to. */
function isInAppUrl(raw, devUrl = null) {
  if (devUrl && typeof raw === 'string' && raw.startsWith(devUrl)) return true;
  const u = parse(raw);
  if (!isHttps(u)) return false;
  return u.hostname === APP_HOST || SPOTIFY_AUTH_HOSTS.has(u.hostname);
}

/** True when the page is the player itself (where the extension runs). */
function isPlayerUrl(raw, devUrl = null) {
  if (devUrl && typeof raw === 'string' && raw.startsWith(devUrl)) return true;
  const u = parse(raw);
  return isHttps(u) && u.hostname === APP_HOST;
}

/** Popups that stay inside the app (sign-in flows). */
function isAuthPopupUrl(raw) {
  const u = parse(raw);
  if (!isHttps(u)) return false;
  return PROVIDER_AUTH_HOSTS.has(u.hostname) || SPOTIFY_AUTH_HOSTS.has(u.hostname);
}

/** Links that may be handed to the system browser. */
function isExternalOk(raw) {
  const u = parse(raw);
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
}

/**
 * Turns a command-line argument into a player URL, or null.
 * Accepts open.spotify.com links and spotify:<type>:<id> URIs.
 */
function argToPlayerUrl(arg) {
  if (typeof arg !== 'string' || arg.length > 500) return null;
  const m = arg.match(/^spotify:(track|album|artist|playlist|show|episode):([A-Za-z0-9]{22})$/);
  if (m) return `https://${APP_HOST}/${m[1]}/${m[2]}`;
  const u = parse(arg);
  if (isHttps(u) && u.hostname === APP_HOST) return u.href;
  return null;
}

module.exports = {
  APP_HOST,
  isInAppUrl,
  isPlayerUrl,
  isAuthPopupUrl,
  isExternalOk,
  argToPlayerUrl,
};

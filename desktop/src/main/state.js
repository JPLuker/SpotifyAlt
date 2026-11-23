'use strict';
/*
 * Now-playing state sent up from the page. Treated as untrusted input
 * (SECURITY-BASELINE 6): anything that doesn't fit the shape is dropped.
 */

const COMMANDS = new Set(['playpause', 'next', 'previous', 'like', 'open-settings']);

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const uri = str(raw.uri, 64);
  const artwork = str(raw.artwork, 1000);
  return {
    title: str(raw.title, 300),
    artist: str(raw.artist, 300),
    album: str(raw.album, 300),
    artwork: artwork.startsWith('https://') ? artwork : '',
    playing: raw.playing === true,
    uri: /^spotify:track:[A-Za-z0-9]{22}$/.test(uri) ? uri : '',
    liked: raw.liked === true ? true : raw.liked === false ? false : null,
  };
}

function windowTitle(state) {
  if (!state || !state.title) return 'Heartline';
  return state.artist ? `${state.title} · ${state.artist}` : state.title;
}

module.exports = { COMMANDS, sanitizeState, windowTitle };

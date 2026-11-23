'use strict';
/*
 * App settings in <userData>/settings.json.
 * Writes go to a temp file, are read back, then swapped in (CODING 5.1).
 * A file we can't read is kept aside, never overwritten (CODING 5.2).
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  bounds: null, // { x, y, width, height }
  maximized: false,
  closeToTray: false,
});

function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const b = raw.bounds;
  if (
    b &&
    typeof b === 'object' &&
    ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) &&
    b.width >= 400 &&
    b.height >= 300 &&
    b.width <= 20000 &&
    b.height <= 20000
  ) {
    out.bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  }
  if (typeof raw.maximized === 'boolean') out.maximized = raw.maximized;
  if (typeof raw.closeToTray === 'boolean') out.closeToTray = raw.closeToTray;
  return out;
}

function load(dir) {
  const file = path.join(dir, 'settings.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS };
    console.warn('[Heartline] Could not read settings, using defaults:', err.message);
    return { ...DEFAULTS, _readOnly: true };
  }
  try {
    return sanitize(JSON.parse(text));
  } catch (err) {
    const aside = `${file}.unreadable-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
      console.warn(`[Heartline] settings.json was unreadable; kept it as ${path.basename(aside)}.`);
    } catch (moveErr) {
      console.warn('[Heartline] settings.json is unreadable and could not be moved aside:', moveErr.message);
      return { ...DEFAULTS, _readOnly: true };
    }
    return { ...DEFAULTS };
  }
}

function save(dir, settings) {
  if (settings._readOnly) return false;
  const file = path.join(dir, 'settings.json');
  const tmp = `${file}.tmp-${process.pid}`;
  const clean = sanitize(settings);
  const text = `${JSON.stringify(clean, null, 2)}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const back = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    if (JSON.stringify(sanitize(back)) !== JSON.stringify(clean)) throw new Error('read-back mismatch');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.warn('[Heartline] Could not save settings:', err.message);
    try {
      fs.rmSync(tmp, { force: true });
    } catch (rmErr) {
      console.warn('[Heartline] Could not remove temp settings file:', rmErr.message);
    }
    return false;
  }
}

module.exports = { DEFAULTS, sanitize, load, save };

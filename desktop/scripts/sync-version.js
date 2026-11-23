'use strict';
// Copies the version from package.json (the one source) into the extension. Run after a bump.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const manifestPath = path.join(root, '..', 'extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const jsPath = path.join(root, '..', 'extension', 'heartline.js');
const js = fs.readFileSync(jsPath, 'utf8');
const next = js.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
if (next === js && !js.includes(`const VERSION = '${version}';`)) throw new Error('VERSION line not found in heartline.js');
fs.writeFileSync(jsPath, next);
console.log(`Extension set to ${version}`);

/**
 * Zip the Mako Clean add-on into an installable .mmip (a renamed ZIP with the
 * add-on's files at its root). Run after the Vite build; `npm run mm:package` does both.
 *
 * Output: mediamonkey/dist/mako-clean.mmip
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dirname, '..');
const addonDir = path.join(root, 'mediamonkey', 'mako-clean');
const outDir = path.join(root, 'mediamonkey', 'dist');
const outFile = path.join(outDir, 'mako-clean.mmip');

// [path in the package, source file]
const files = [
  ['info.json', path.join(addonDir, 'info.json')],
  ['config.html', path.join(addonDir, 'config.html')],
  ['config.js', path.join(addonDir, 'config.js')],
  ['actions_add.js', path.join(addonDir, 'dist', 'actions_add.js')],
  ...readdirSync(path.join(addonDir, 'dialogs')).map((name) => [
    `dialogs/${name}`,
    path.join(addonDir, 'dialogs', name),
  ]),
];

const entries = {};
for (const [name, source] of files) {
  if (!existsSync(source)) {
    console.error(`Missing ${source}. Run the Vite build first (npm run mm:package).`);
    process.exit(1);
  }
  const bytes = new Uint8Array(readFileSync(source));
  // MediaMonkey appends actions_add.js to its own actions.js, and how it decodes the
  // add-on's files isn't documented. Plain ASCII reads the same in any encoding.
  const offset = bytes.findIndex((b) => b > 0x7e || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d));
  if (offset !== -1) {
    console.error(`${name} has a non-ASCII byte at offset ${offset}. Use plain ASCII (write "->", or "\\uXXXX" in code).`);
    process.exit(1);
  }
  entries[name] = bytes;
}

const info = JSON.parse(readFileSync(path.join(addonDir, 'info.json'), 'utf8'));

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, zipSync(entries, { level: 9 }));

console.log(`Built ${path.relative(root, outFile)} (Mako Clean ${info.version})`);
for (const name of Object.keys(entries)) console.log(`  ${name}`);

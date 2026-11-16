/**
 * Transforme assets/chars/*.webp en src/chars.js (images en data:).
 * Pourquoi : la page du launcher tourne sous une CSP stricte, et des images
 * embarquees ne peuvent ni manquer ni etre bloquees par le schema file://.
 * A relancer apres chaque nouveau rendu : node tools/pack-chars.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets', 'chars');
const out = {};
for (const f of readdirSync(dir).filter(f => f.endsWith('.webp')).sort()) {
  out[path.basename(f, '.webp')] = 'data:image/webp;base64,' + readFileSync(path.join(dir, f)).toString('base64');
}
writeFileSync(path.join(root, 'src', 'chars.js'),
  '/* Genere par tools/pack-chars.mjs — ne pas editer a la main.\n'
  + '   Personnages rendus par le moteur du jeu (tools/render-chars.mjs). */\n'
  + 'window.CHARS = ' + JSON.stringify(out) + ';\n');
console.log(`src/chars.js : ${Object.keys(out).length} personnages, ${(JSON.stringify(out).length / 1024).toFixed(0)} Ko`);

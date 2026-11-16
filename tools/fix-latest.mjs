/**
 * Après la signature : l'installeur signé n'a plus la même empreinte que celle
 * qu'electron-builder a écrite dans latest.yml. La mise à jour automatique la
 * vérifie et refuserait le fichier. On remplace l'ancienne empreinte (SHA-512 en
 * base64) et l'ancienne taille par celles du fichier signé.
 *
 *   node tools/fix-latest.mjs <non-signé> <signé> <latest.yml>
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const [before, after, yml] = process.argv.slice(2);
if (!before || !after || !yml) { console.error('usage : fix-latest.mjs <non-signé> <signé> <latest.yml>'); process.exit(2); }

const info = f => { const b = fs.readFileSync(f); return { sha: crypto.createHash('sha512').update(b).digest('base64'), size: b.length }; };
const old = info(before), neu = info(after);
let text = fs.readFileSync(yml, 'utf8');
if (!text.includes(old.sha)) { console.error('empreinte de l’installeur absente de latest.yml : rien n’est modifié'); process.exit(1); }

// (la taille n'est remplacée que dans le bloc qui porte l'ancienne empreinte : le paquet .7z a sa propre taille)
const lines = text.split('\n');
lines.forEach((l, i) => {
  if (!l.includes(old.sha)) return;
  lines[i] = l.replace(old.sha, neu.sha);
  for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++)
    if (new RegExp(`^\\s*(- )?size: ${old.size}\\s*$`).test(lines[j])) lines[j] = lines[j].replace(String(old.size), String(neu.size));
});
text = lines.join('\n');
fs.writeFileSync(yml, text);
console.log(`latest.yml : ${old.size} → ${neu.size} octets, empreinte remplacée`);

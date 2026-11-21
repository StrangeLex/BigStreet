/**
 * Fabrique la copie embarquée des poignées de Three.js (TransformControls) : src/studio/tcontrols.js.
 *
 *     node tools/vendor-tcontrols.mjs <chemin de three/examples/jsm/controls/TransformControls.js>
 *
 * Le fichier d'origine fait « import { … } from 'three' » : dans le Studio, Three.js est celui du moteur du jeu (une seule
 * instance, donnée par /js/studio-play.js). La copie devient donc une fabrique sans import — makeTransformControls(THREE) —,
 * servie par le launcher lui-même : les poignées marchent hors ligne, sans dépendre du site.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage : node tools/vendor-tcontrols.mjs <TransformControls.js>'); process.exit(2); }
let s = readFileSync(src, 'utf8');
const imp = /import\s*\{([^}]+)\}\s*from\s*'three';/.exec(s);
if (!imp) throw new Error('import de three introuvable');
const names = imp[1].split(',').map(x => x.trim()).filter(Boolean);
s = s.replace(imp[0], '').replace(/export\s*\{[^}]+\};?\s*$/, '');
if (/\bimport\b[^(]/.test(s.replace(/@three_import[^\n]*/g, '')) || /^export /m.test(s)) throw new Error('import ou export restant');
const out = `// Poignées de déplacement et de rotation — copie de three.js r${process.argv[3] || '0.187'} (examples/jsm/controls/TransformControls.js,
// licence MIT, © les auteurs de three.js), transformée en fabrique par tools/vendor-tcontrols.mjs : ne pas modifier à la main.
export function makeTransformControls(THREE) {
const { ${names.join(', ')} } = THREE;
${s}
return { TransformControls, TransformControlsGizmo, TransformControlsPlane };
}
`;
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/studio/tcontrols.js');
writeFileSync(dest, out);
console.log('écrit', dest, `(${out.length} octets, ${names.length} noms de three)`);

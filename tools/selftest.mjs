/**
 * Contrôles automatiques du launcher. À lancer avant de poser un tag :
 *
 *     npx electron tools/selftest.mjs            (ou : npm run selftest)
 *
 * Ce qui est vérifié, dans l'ordre :
 *  1. identifiants référencés par launcher.js mais absents de launcher.html
 *     (c'est ce qui avait cassé le bouton « Lancer » en 1.4.0)
 *  2. aucun gestionnaire « on… » en dur dans le HTML (la CSP les refuse)
 *  3. chemins d'installation : pas de remontée de dossier possible
 *  4. installation complète, puis reprise (rien à retélécharger)
 *  5. réparation d'un fichier abîmé
 *  6. un lien « bigstreet:// » forgé sans jeton est ignoré
 *
 * Le test écrit dans un dossier temporaire et le supprime à la fin ; il ne
 * touche ni aux réglages du joueur, ni au dossier d'installation réel.
 */
import { readFileSync, writeFileSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.BIGSTREET_URL || 'https://playbigstreet.com').replace(/\/+$/, '');
let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

// ---------------------------------------------------------------- 1 et 2 : interface
function checkMarkup() {
  const html = readFileSync(path.join(root, 'src/launcher.html'), 'utf8');
  const js = readFileSync(path.join(root, 'src/launcher.js'), 'utf8');
  const inHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(i => !inHtml.has(i));
  ok('identifiants de l’interface', missing.length === 0, missing.join(', '));
  const inline = html.match(/\son[a-z]+="/g) || [];
  ok('aucun gestionnaire en dur (CSP)', inline.length === 0, inline.join(' '));
}

// ---------------------------------------------------------------- le reste : dans Electron
async function checkRuntime() {
  process.env.BS_SELFTEST = '1';     // (posé avant le chargement de main.js)
  const { app } = await import('electron');
  await app.whenReady();

  // On charge main.js dans ce processus : ses fonctions internes sont alors
  // disponibles pour les contrôles (il n'ouvre aucune fenêtre tant que
  // BS_SELFTEST est posé).
  const m = createRequire(import.meta.url)(path.join(root, 'src/main.js'));

  const dir = mkdtempSync(path.join(os.tmpdir(), 'bs-selftest-'));
  // Les réglages réels sont remis en place à la fin : lancer les contrôles ne
  // doit ni déconnecter le joueur ni déplacer son dossier d'installation.
  const avant = m.readSettings();
  try {
    ok('chemin normal accepté', !!m.safeDest(dir, '/models/a.bbmodel'));
    ok('remontée de dossier refusée', m.safeDest(dir, '/models/../../etc/passwd') === null);
    ok('chemin hors ressources refusé', m.safeDest(dir, '/etc/passwd') === null);
    ok('RNNoise accepté', !!m.safeDest(dir, '/js/vendor/rnnoise/rnnoise.wasm'));
    ok('autre script refusé', m.safeDest(dir, '/js/main.js') === null);

    m.writeSettings({ installDir: dir, token: '', authNonce: null });
    await m.runInstall(dir);
    ok('installation complète', m.state().state === 'done', `${m.state().files} fichiers`);

    await m.runInstall(dir);
    ok('reprise sans retéléchargement', m.state().files === 0 && m.state().skipped > 0,
      `${m.state().skipped} déjà présents`);

    const victim = path.join(dir, 'models', 'chaise.bbmodel');
    const vrai = statSync(victim).size;
    writeFileSync(victim, 'abîmé');
    await m.runInstall(dir);
    ok('réparation d’un fichier abîmé', m.state().files === 1 && statSync(victim).size === vrai);

    await m.handleAuthLink('bigstreet://auth#session=JETON_FORGE');
    ok('lien de connexion forgé ignoré', m.readSettings().token === '');
  } finally {
    m.writeSettings(avant);
    rmSync(dir, { recursive: true, force: true });
    console.log(failures ? `\n  ${failures} contrôle(s) en échec` : '\n  tout est vert');
    app.exit(failures ? 1 : 0);
  }
}

console.log(`Contrôles du launcher (site : ${SITE})\n`);
checkMarkup();
checkRuntime();

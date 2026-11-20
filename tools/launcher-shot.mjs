/**
 * Capture de l'écran de lancement du launcher (contrôle visuel du bouton « Studio ») :
 *     xvfb-run -a npx electron tools/launcher-shot.mjs --no-sandbox <fichier.png>
 * L'écran « connecté » est affiché de force : aucun compte n'est utilisé, aucun réglage n'est modifié.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv.slice(2).find(a => a.endsWith('.png')) || 'launcher.png';
process.env.BS_SELFTEST = '1';
async function main() {
  const { app, BrowserWindow } = await import('electron');
  await app.whenReady();
  createRequire(import.meta.url)(path.join(root, 'src/main.js'));
  const w = new BrowserWindow({ width: 880, height: 580, show: true, frame: false, webPreferences: { preload: path.join(root, 'src/launcher-preload.js'), contextIsolation: true, sandbox: true } });
  setTimeout(() => app.exit(2), 40000);
  await w.loadFile(path.join(root, 'src/launcher.html'));
  await new Promise(r => setTimeout(r, 2500));
  const info = await w.webContents.executeJavaScript(`(() => { for (const e of document.querySelectorAll('.hero')) e.style.display = 'none'; const p = document.querySelector('#playBox'); p.style.display = '';
    document.querySelector('#playHint').textContent = 'Connecté : exemple'; const b = document.querySelector('#studioBtn'), c = document.querySelector('#installCog'), r = b.getBoundingClientRect(), q = c.getBoundingClientRect();
    return { largeur: innerWidth, droiteDeLancer: Math.round(document.querySelector('#play').getBoundingClientRect().right), studio: b.textContent, gras: getComputedStyle(b.querySelector('b')).fontWeight, aGaucheDuDisque: r.right <= q.left, clic: typeof b.onclick }; })()`);
  console.log(JSON.stringify(info));
  await new Promise(r => setTimeout(r, 600));
  writeFileSync(out, (await w.webContents.capturePage()).toPNG());
  app.exit(0);
}
main();

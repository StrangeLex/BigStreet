/**
 * Rend des personnages Big Street en PNG transparents, avec le moteur du jeu
 * lui-meme (Preview.avatarShot) : les assets du launcher sont donc exactement
 * les personnages du jeu, pas des illustrations approchantes.
 * Chromium headless pilote la page locale du site ; aucun fichier n'est ajoute
 * au site.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from '/var/www/html/SProject/node_modules/ws/index.js';

const OUT = process.argv[2] || '/root/bigstreet-launcher/assets/chars';
const DBG = 9333, SITE = 'http://127.0.0.1:2021/';
mkdirSync(OUT, { recursive: true });

const chrome = spawn('chromium', [
  '--headless=new', `--remote-debugging-port=${DBG}`, '--no-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
  '--user-data-dir=/tmp/bs-shots-profile', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});

try {
  // --- attendre que DevTools reponde, puis ouvrir un onglet sur le site
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const r = await fetch(`http://127.0.0.1:${DBG}/json/new?${encodeURIComponent(SITE)}`, { method: 'PUT' });
      target = await r.json();
    } catch {}
  }
  if (!target) throw new Error('DevTools injoignable');

  ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.on('message', buf => {
    const m = JSON.parse(buf);
    if (!m.id || !pend.has(m.id)) return;
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  });

  await send('Page.enable');
  await sleep(6000);   // chargement des modules du jeu

  const script = `(async () => {
    const g = await import('/js/game.js');
    const s = await import('/js/shared.js');
    await g.loadAvatar();
    const PL = o => s.sanitizeLook({ ...s.DEFAULT_LOOK, ...o });
    const UP = { bras_d: [-2.75, 0, 0.12] };
    const HIP = { bras_g: [0, 0, 0.55], bras_d: [0, 0, -0.55] };
    const CHEER = { bras_g: [-2.6, 0, -0.35], bras_d: [-2.6, 0, 0.35] };
    const CAST = ${JSON.stringify(null)} || null;
    const cast = CAST_PLACEHOLDER;
    const c = document.createElement('canvas');
    c.width = 760; c.height = 760;
    document.body.append(c);
    const p = new g.Preview(c);
    const out = {};
    for (const it of cast) {
      out[it.id] = p.avatarShot(PL(it.look), it.focus || 'body', { yaw: it.yaw, rot: ({ UP, HIP, CHEER })[it.rot] || it.rot || null });
    }
    return JSON.stringify(out);
  })()`;

  const cast = JSON.parse(process.env.BS_CAST);
  const r = await send('Runtime.evaluate', {
    expression: script.replace('CAST_PLACEHOLDER', JSON.stringify(cast)),
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'echec du rendu');

  const shots = JSON.parse(r.result.value);
  for (const [name, url] of Object.entries(shots)) {
    const b = Buffer.from(String(url).split(',')[1] || '', 'base64');
    if (b.length < 1000) { console.log(`  ${name} : VIDE`); continue; }
    writeFileSync(`${OUT}/${name}.png`, b);
    console.log(`  ${name}.png  ${(b.length / 1024).toFixed(0)} Ko`);
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
}

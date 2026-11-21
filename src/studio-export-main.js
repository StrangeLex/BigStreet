/**
 * Studio — l'export vidéo, côté processus principal (21/11). La page « Exporter » du Studio (src/studio/export.js) calcule la vidéo
 * image par image et l'encode elle-même (WebM, MP4, AVI, GIF : aucun programme externe) ; elle n'a pas accès au disque : elle donne
 * ici un NOM de fichier (assaini : caractères interdits par Windows retirés, extension imposée par le format) et envoie les octets avec
 * leur position (les formats vidéo réécrivent leur en-tête à la fin). Le fichier va dans « Documents/Big Street/Studio/Vidéos », ou
 * là où le joueur l'a choisi par la boîte « Enregistrer sous » du système. Un export annulé ne laisse pas de fichier.
 */
const fs = require('node:fs');
const path = require('node:path');

const EXTS = new Set(['webm', 'mp4', 'avi', 'gif', 'png']);   // (png : capture d'image haute résolution — anim.js)
const MAX = 16e9;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Un nom de fichier sûr sur Windows comme ailleurs (sans dossier ni extension), ou '' */
function cleanName(v) {
  let s = String(v ?? '').normalize('NFC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\.(webm|mp4|avi|gif)$/i, '').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120).trim();
  if (RESERVED.test(s)) s = '_' + s;
  return s;
}

function setupExport({ ipcMain, guard, fromStudio, recordsDir, dialog, shell, log, win }) {
  let cur = null, picked = null;   // (cur : l'export en cours ; picked : chemin choisi par « Enregistrer sous », pour le prochain export)
  const videosDir = () => { const d = path.join(recordsDir(), 'Vidéos'); fs.mkdirSync(d, { recursive: true }); return d; };

  async function close(cancel) {
    const x = cur; cur = null; if (!x) return null;
    try { await x.chain; } catch { /* erreur d'écriture : signalée par ok:false */ }
    try { fs.closeSync(x.fd); } catch { /* déjà fermé */ }
    if (cancel || x.err) { try { fs.unlinkSync(x.file); } catch { /* rien */ } return x.err ? { ok: false, error: x.err } : { ok: false, cancelled: true }; }
    return { ok: true, file: x.file, name: path.basename(x.file), dir: path.dirname(x.file), size: x.size };
  }

  // « Enregistrer sous » : le joueur choisit le dossier et le nom (la page ne voit que le nom)
  ipcMain.handle('bs:studio-xport-pick', guard(async (name, ext) => {
    if (!EXTS.has(ext)) return { ok: false };
    const base = cleanName(name) || 'cinematique';
    const r = await dialog.showSaveDialog(win(), { title: 'Exporter la vidéo', defaultPath: path.join(picked ? path.dirname(picked) : videosDir(), `${base}.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    let f = r.filePath; if (path.extname(f).toLowerCase() !== '.' + ext) f += '.' + ext;
    picked = f;
    return { ok: true, name: path.basename(f, path.extname(f)), dir: path.dirname(f) };
  }));
  ipcMain.handle('bs:studio-xport-info', guard(() => ({ dir: picked ? path.dirname(picked) : videosDir() })));
  /** Ouvre le fichier de sortie : { name, ext, replace } → { ok, name, dir } */
  ipcMain.handle('bs:studio-xport-open', guard(async o => {
    await close(true);
    const ext = String(o?.ext || ''), base = cleanName(o?.name);
    if (!EXTS.has(ext) || !base) return { ok: false, error: 'Nom de fichier invalide.' };
    const dir = picked ? path.dirname(picked) : videosDir();
    let file = path.join(dir, `${base}.${ext}`);
    // (même nom qu'un fichier existant : « -2 », « -3 »… — sauf s'il a été choisi par « Enregistrer sous », qui a déjà demandé)
    if (!(picked && path.resolve(picked) === path.resolve(file))) for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.${ext}`);
    try { fs.mkdirSync(dir, { recursive: true }); cur = { file, fd: fs.openSync(file, 'w'), size: 0, chain: Promise.resolve(), err: null }; }
    catch (err) { log.warn('studio : export impossible : ' + err); return { ok: false, error: 'Impossible de créer le fichier vidéo.' }; }
    log.info('studio : export vers ' + file);
    return { ok: true, name: path.basename(file), dir };
  }));
  // (des octets à une position — null : à la suite ; les écritures se font dans l'ordre d'arrivée)
  ipcMain.on('bs:studio-xport-write', (e, pos, data) => {
    const x = cur; if (!x || !fromStudio(e) || !(data instanceof Uint8Array)) return;
    const at = pos == null ? null : Number(pos);
    if (at !== null && !(Number.isInteger(at) && at >= 0 && at + data.length <= MAX)) return;
    x.chain = x.chain.then(() => new Promise(res => {
      if (x.err) return res();
      const b = Buffer.from(data.buffer, data.byteOffset, data.length);
      fs.write(x.fd, b, 0, b.length, at === null ? x.size : at, err => {
        if (err) x.err = 'Écriture impossible (disque plein ?)';
        else { x.size = Math.max(x.size, (at === null ? x.size : at) + b.length); if (x.size > MAX) x.err = 'Fichier trop gros.'; }
        res();
      });
    }));
  });
  ipcMain.handle('bs:studio-xport-finish', guard(async (cancel, reveal = true) => {
    const r = await close(!!cancel);
    if (r?.ok && reveal) shell.showItemInFolder(r.file);
    return r ? { ok: r.ok, name: r.name, dir: r.dir, size: r.size, error: r.error, cancelled: r.cancelled } : { ok: false };
  }));
  ipcMain.handle('bs:studio-xport-reveal', guard(() => { shell.openPath(picked ? path.dirname(picked) : videosDir()); return { ok: true }; }));
  return { abort: () => close(true), cleanName };
}

module.exports = { setupExport, cleanName };

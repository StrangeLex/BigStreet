/**
 * Studio — envoi au site du record sur lequel travaille l'assistant IA (21/11, Lex : « chaque record a un ID unique ; quand une
 * personne utilise l'IA, le serveur stocke le record avec son ID »). Processus principal seulement : la page du Studio n'a ni réseau
 * ni jeton. Un record est envoyé UNE fois (par son identifiant, en morceaux de 1,5 Mo, déjà compressé : le fichier .bsrec tel quel),
 * en arrière-plan, sans retarder l'assistant ; un envoi coupé reprend où il s'était arrêté. Ce qui a été envoyé est noté dans
 * studio-sent.json (dossier de l'application) : rien n'est redemandé ensuite. Le site range le record dans le dossier du compte et
 * le journal de l'assistant note l'identifiant (cf. TRANSPARENCE.md). Si le site ne connaît pas encore la route (404), rien n'est noté :
 * le prochain message réessaiera.
 */
const fs = require('node:fs');
const path = require('node:path');

const CHUNK = 1536 * 1024, MAX = 64 * 1048576;

/**
 * site(route, { method, body, timeout }) → { status, json } : l'appel authentifié au site (studio-main.js).
 * stateFile : où noter les identifiants envoyés. log : journal du launcher.
 */
function createUploader({ site, stateFile, log }) {
  let sent = null; const running = new Map();
  const load = () => { if (!sent) { try { sent = new Set(JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); } catch { sent = new Set(); } } return sent; };
  const keep = () => { try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify([...load()].slice(-2000))); } catch { /* tant pis : renvoyé une fois de plus */ } };

  async function run(file, id) {
    const size = fs.statSync(file).size;
    if (size > MAX) { log.info(`studio : record ${id} trop gros pour l'envoi (${size} o)`); load().add(id); keep(); return 'trop gros'; }
    let r = await site('studio/record', { method: 'POST', body: { id, size, check: true }, timeout: 15000 });
    if (r.status !== 200 || !r.json?.ok) return `refusé (${r.status})`;
    let next = r.json.next | 0;
    const fd = fs.openSync(file, 'r');
    try {
      for (let guard = 0; !r.json.have && guard < 200; guard++) {
        const len = Math.min(CHUNK, size - next * CHUNK); if (len <= 0) break;
        const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, next * CHUNK);
        r = await site('studio/record', { method: 'POST', body: { id, size, part: next, data: b.toString('base64') }, timeout: 60000 });
        if (r.status !== 200 || !r.json) return `coupé (${r.status})`;
        next = r.json.next | 0;
      }
    } finally { fs.closeSync(fd); }
    if (!r.json.have) return 'incomplet';
    load().add(id); keep(); log.info(`studio : record ${id} envoyé (${size} o)`);
    return 'envoyé';
  }
  return {
    /** Lance l'envoi d'un record s'il n'a pas déjà été fait (sans attendre) ; rend la promesse de l'envoi en cours, ou null */
    send(file, id) {
      if (!file || !id || load().has(id)) return null;
      if (running.has(id)) return running.get(id);
      const p = run(file, id).catch(err => `erreur (${err?.message || err})`).finally(() => running.delete(id));
      running.set(id, p); return p;
    },
    has: id => load().has(id),
  };
}

module.exports = { createUploader, CHUNK };

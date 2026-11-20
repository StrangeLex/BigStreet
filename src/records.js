/**
 * Records du Studio : le format de fichier « .bsrec », propre à Big Street.
 *
 *   octets 0–7    « BIGSTREC » (signature)
 *   octets 8–9    version du format (entier 16 bits, petit-boutiste) — 1
 *   octets 10–11  drapeaux — bit 0 : record terminé proprement (en-tête définitif)
 *   octets 12–15  longueur, en octets, de la fiche JSON qui suit (entier 32 bits)
 *   octets 16–…   fiche JSON (UTF-8) : date, lieu, durée, rayon, version du jeu… ; le bloc d'en-tête fait
 *                 toujours 4096 octets (complété par des zéros) : il se réécrit à la fin sans toucher au reste
 *   octet 4096 →  flux gzip : une ligne JSON par trame (images-clés et événements horodatés, cf. le jeu,
 *                 public/js/studio-rec.js), vidé à chaque morceau — un record coupé net reste lisible
 *
 * Ce module ne dépend pas d'Electron : il sert au processus principal comme aux outils de test.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MAGIC = Buffer.from('BIGSTREC', 'ascii');
const VERSION = 1;
const HEADER_SIZE = 4096;
const EXT = '.bsrec';
const PROJECT_EXT = '.bsproj';
const MAX_RAW = 400 * 1048576;        // (texte brut d'un record, avant compression)
const MAX_CHUNK = 4 * 1048576;        // (un morceau envoyé par la page)
const MAX_MS = 30 * 60000;            // (durée d'un record)
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.bsrec$/;

const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const num = (v, lo, hi, d = 0) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };

/** La fiche d'un record, réduite à ce qu'on accepte d'une page : chaînes courtes et nombres bornés. */
function cleanMeta(m = {}) {
  return {
    room: str(m.room, 64), roomName: str(m.roomName, 80), player: str(m.player, 32),
    radius: Math.round(num(m.radius, 50, 1000, 200)), game: str(m.game, 40), launcher: str(m.launcher, 20),
    x: Math.round(num(m.x, -1e6, 1e6)), y: Math.round(num(m.y, -1e6, 1e6)),
    session: str(m.session, 16).replace(/[^A-Za-z0-9]/g, ''), part: Math.round(num(m.part, 0, 9999)),
    auto: !!m.auto, outdoor: !!m.outdoor,
  };
}

function headerBlock(meta, done) {
  let json = Buffer.from(JSON.stringify(meta), 'utf8');
  if (json.length > HEADER_SIZE - 16) json = Buffer.from(JSON.stringify({ ...meta, roomName: '', player: '' }), 'utf8');
  const b = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(b, 0); b.writeUInt16LE(VERSION, 8); b.writeUInt16LE(done ? 1 : 0, 10); b.writeUInt32LE(json.length, 12); json.copy(b, 16);
  return b;
}

/** Lit l'en-tête : { version, done, meta } ou null si ce n'est pas un record. */
function readHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(HEADER_SIZE);
    if (fs.readSync(fd, b, 0, HEADER_SIZE, 0) < 16 || !b.subarray(0, 8).equals(MAGIC)) return null;
    const len = b.readUInt32LE(12); if (len > HEADER_SIZE - 16) return null;
    return { version: b.readUInt16LE(8), done: !!(b.readUInt16LE(10) & 1), meta: JSON.parse(b.subarray(16, 16 + len).toString('utf8')) };
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* déjà fermé */ } }
}

/** Le texte des trames (une ligne JSON par trame). Un fichier coupé net rend tout ce qui a été vidé sur le disque. */
function readBody(file) {
  const buf = fs.readFileSync(file);
  if (buf.length <= HEADER_SIZE) return '';
  const text = zlib.gunzipSync(buf.subarray(HEADER_SIZE), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
  // (coupé au milieu d'une ligne : la dernière, incomplète, est écartée)
  return text.endsWith('\n') ? text : text.slice(0, text.lastIndexOf('\n') + 1);
}

/** Durée et nombre de trames d'un texte de record (dernière trame horodatée). */
function measure(text) {
  let lines = 0, dur = 0;
  for (let i = 0; i < text.length;) {
    let j = text.indexOf('\n', i); if (j < 0) j = text.length;
    if (j > i) { lines++; const m = /^\["[A-Z]+",(\d+)/.exec(text.slice(i, Math.min(j, i + 40))); if (m) dur = Math.max(dur, +m[1]); }
    i = j + 1;
  }
  return { lines, dur };
}

/**
 * Ouvre un record en écriture. write(texte) ajoute des trames ; close(fiche) termine le flux et réécrit l'en-tête
 * (durée, nombre de trames). Rend une promesse : le chemin du fichier, ou null s'il était trop court pour être gardé.
 */
function createWriter(file, meta, { minMs = 1500 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = { ...cleanMeta(meta), v: VERSION, date: new Date().toISOString(), dur: 0, lines: 0 };
  fs.writeFileSync(file, headerBlock(head, false));
  const out = fs.createWriteStream(file, { flags: 'r+', start: HEADER_SIZE });
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(out);
  let raw = 0, closed = null; const t0 = Date.now();
  out.on('error', () => {}); gz.on('error', () => {});
  return {
    file, t0, get raw() { return raw; }, get closed() { return !!closed; },
    /** false : refusé (trop gros, record fermé) */
    write(text) {
      if (closed || typeof text !== 'string' || !text.length || text.length > MAX_CHUNK) return false;
      if (raw + text.length > MAX_RAW || Date.now() - t0 > MAX_MS + 15000) return false;
      raw += text.length;
      gz.write(text.endsWith('\n') ? text : text + '\n');
      gz.flush(zlib.constants.Z_SYNC_FLUSH);
      return true;
    },
    close(patch = {}) {
      return closed ??= new Promise(resolve => {
        out.on('close', () => {
          try {
            const dur = Math.round(num(patch.dur, 0, MAX_MS + 60000, Date.now() - t0));
            if (dur < minMs || !raw) { fs.unlinkSync(file); return resolve(null); }
            const fd = fs.openSync(file, 'r+');
            fs.writeSync(fd, headerBlock({ ...head, dur, lines: Math.round(num(patch.lines, 0, 1e9)), end: str(patch.reason, 24) }, true), 0, HEADER_SIZE, 0);
            fs.closeSync(fd);
            resolve(file);
          } catch { resolve(null); }
        });
        gz.end();
      });
    },
  };
}

/** Un record resté sans en-tête définitif (jeu fermé net) : la durée est retrouvée dans les trames. */
function repair(file) {
  const h = readHeader(file); if (!h || h.done) return h;
  try {
    const { lines, dur } = measure(readBody(file));
    if (!lines) return h;
    const meta = { ...h.meta, dur, lines, end: 'coupé' };
    const fd = fs.openSync(file, 'r+');
    fs.writeSync(fd, headerBlock(meta, true), 0, HEADER_SIZE, 0); fs.closeSync(fd);
    return { ...h, done: true, meta };
  } catch { return h; }
}

/** Les records d'un dossier, du plus récent au plus ancien (skip : fichier en cours d'écriture). */
function list(dir, skip = null) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => NAME_RE.test(n)); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name); if (file === skip) continue;
    let st; try { st = fs.statSync(file); } catch { continue; }
    let h = readHeader(file); if (!h) continue;
    if (!h.done && Date.now() - st.mtimeMs > 5000) h = repair(file) || h;
    out.push({ name, size: st.size, mtime: st.mtimeMs, done: h.done, project: fs.existsSync(projectFile(file)), ...h.meta });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Chemin d'un record d'après son nom, ou null si le nom sort du dossier ou n'est pas un record. */
function safeFile(dir, name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..')) return null;
  const file = path.resolve(dir, name);
  return file.startsWith(path.resolve(dir) + path.sep) ? file : null;
}
const projectFile = file => file.slice(0, -EXT.length) + PROJECT_EXT;

/** Nom de fichier d'un nouveau record : la date, puis le lieu. */
function fileName(meta, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  const room = String(meta.room || 'salle').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'salle';
  return `${d}_${room}${EXT}`;
}

module.exports = { MAGIC, VERSION, HEADER_SIZE, EXT, PROJECT_EXT, MAX_RAW, MAX_CHUNK, MAX_MS, NAME_RE,
  cleanMeta, readHeader, readBody, measure, createWriter, repair, list, safeFile, projectFile, fileName };

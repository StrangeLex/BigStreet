/**
 * Contrôles de l'agent « export » (21/11), appelés par tools/selftest.mjs :
 *  - identifiant unique des records (UUID à la création, identifiant tiré du contenu pour les anciens, écrit puis stable) ;
 *  - monde du Studio (world.js) : heure réglée, vitesse du temps, clés qui passent par minuit, brume ;
 *  - conteneurs de l'export (encoders.js) : GIF et AVI écrits ici, WebM et MP4 encodés par WebCodecs dans une fenêtre du Studio ;
 *    chaque fichier relu par ffprobe s'il est installé (sinon : contrôle de structure seulement) ;
 *  - nom de fichier assaini par le processus principal ; envoi d'un record au site (uploader, faux site).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, openSync, writeSync, closeSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const req = createRequire(import.meta.url);
const dataUrl = src => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
/** Un module du Studio chargé seul : ses imports « /__studio/x.js » sont remplacés par le module x.js (lui-même chargé ainsi) */
function studioModule(root, f, seen = new Map()) {
  if (seen.has(f)) return seen.get(f);
  const src = readFileSync(path.join(root, 'src/studio', f), 'utf8').replace(/'\/__studio\/([A-Za-z0-9._-]+)'/g, (_, g) => `'${studioModule(root, g, seen)}'`);
  const u = dataUrl(src); seen.set(f, u); return u;
}
const ffprobe = file => { try { return execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return e.code === 'ENOENT' ? null : 'ERREUR ' + String(e.stderr || e.message).slice(0, 200); } };
const probeOk = (out, codec, w, h, n) => { if (out === null) return true; try { const s = JSON.parse(out).streams[0]; return s.codec_name === codec && s.width === w && s.height === h && +s.nb_read_frames === n; } catch { return false; } };

export async function checkExportNode(ok, root) {
  const REC = req(path.join(root, 'src/records.js')), dir = mkdtempSync(path.join(os.tmpdir(), 'bs-xp-'));
  try {
    // (records : un identifiant à la création ; un ancien record — sans identifiant — en reçoit un, tiré de son contenu, écrit et stable)
    const w = REC.createWriter(path.join(dir, 'a.bsrec'), { room: 'tabac' }, { minMs: 0 });
    w.write('["R",0,{"id":"tabac"},{}]\n["P",500,[1,0,0,null,0,0]]\n'); const f = await w.close({ dur: 600, lines: 2 });
    const h = REC.readHeader(f), L = REC.list(dir);
    ok('record : identifiant unique (UUID) à la création, affiché dans la liste', REC.ID_RE.test(h.meta.id) && w.id === h.meta.id && L[0]?.id === h.meta.id);
    const old = path.join(dir, 'b.bsrec'); writeFileSync(old, readFileSync(f)); const hb = REC.readHeader(old); delete hb.meta.id;
    const fd = openSync(old, 'r+'), j = Buffer.from(JSON.stringify(hb.meta)), b = Buffer.alloc(REC.HEADER_SIZE); REC.MAGIC.copy(b, 0); b.writeUInt16LE(1, 8); b.writeUInt16LE(1, 10); b.writeUInt32LE(j.length, 12); j.copy(b, 16); writeSync(fd, b, 0, b.length, 0); closeSync(fd);
    const id1 = REC.recordId(old), id2 = REC.recordId(old), again = REC.contentId(old);
    ok('record ancien : identifiant tiré du contenu, écrit dans l’en-tête, stable', REC.ID_RE.test(id1) && id1 === id2 && id1 === again && REC.readHeader(old).meta.id === id1);
    // (nom de fichier de l'export : caractères interdits par Windows, noms réservés, extension imposée)
    const { cleanName } = req(path.join(root, 'src/studio-export-main.js'));
    ok('export : nom de fichier assaini', cleanName('a/b\\c:*?"<>|.mp4') === 'a b c' && cleanName('CON') === '_CON' && cleanName('../..') === '' && cleanName('  Ma vidéo.  ') === 'Ma vidéo');
    // (envoi d'un record au site : par morceaux, une seule fois, rien de noté si le site ne connaît pas la route)
    const { createUploader, CHUNK } = req(path.join(root, 'src/studio-upload.js'));
    const big = path.join(dir, 'c.bsrec'); writeFileSync(big, Buffer.concat([readFileSync(f), Buffer.alloc(CHUNK + 1000, 7)]));
    const got = []; let have = false, known = true;
    const site = async (route, { body }) => { if (!known) return { status: 404, json: { error: 'Introuvable' } }; got.push(body.check ? 'check' : body.part); if (body.check) return { status: 200, json: { ok: true, have, next: 0 } }; const n = Math.ceil(body.size / CHUNK); if (body.part + 1 === n) have = true; return { status: 200, json: { ok: true, have, next: body.part + 1 } }; };
    const U = createUploader({ site, log: { info() {} }, stateFile: () => path.join(dir, 'sent.json') });
    known = false; const r0 = await U.send(big, 'x-1'); known = true;
    const r1 = await U.send(big, 'x-1'), r2 = U.send(big, 'x-1');
    ok('assistant : record envoyé au site une fois, par morceaux (404 : réessayé plus tard)', r0 !== 'envoyé' && r1 === 'envoyé' && r2 === null && got.join(',') === 'check,0,1' && U.has('x-1'));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // Monde (world.js) : fonctions de calcul
  const W = await import(studioModule(root, 'world.js'));
  const M = W.cleanMonde({ hour: 21, speed: 0, tracks: { hour: [{ t: 0, v: 23 }, { t: 4000, v: 1 }] } });
  const M2 = W.cleanMonde({ hour: 6, speed: 60 }), M3 = W.cleanMonde(null);
  ok('monde : clés d’heure par minuit (23 h → 1 h), heure fixe, temps accéléré, heure du record', [0, 24].some(x => Math.abs(W.hourAt(M, 2000) - x) < 0.05)
    && M.tracks.hour[1].v === 25 && W.hourAt(W.cleanMonde({ hour: 21, speed: 0 }), 99999) === 21 && Math.abs(W.hourAt(M2, 60000) - 12) < 0.01 && W.hourAt(M3, 1000, 14) === null && W.isDefault(M3));
  ok('monde : 24 h de jeu en 48 min, heure lue au format 21:30', Math.abs(W.gameHours(W.GAME_DAY_MS) - 24) < 1e-9 && W.parseHour('21:30') === 21.5 && W.parseHour('7h') === 7 && W.fmtHour(23.999) === '00:00');
  const MX = await import(studioModule(root, 'ai-tools-monde.js'));
  {   // (export par l'IA : refusé sans cinématique ; sinon la page s'ouvre préremplie et RIEN ne démarre — l'outil rend la main tout de suite)
    const C = await import(studioModule(root, 'cams.js')), seen = { open: 0, go: 0 };
    const X = { busy: false, open: () => (seen.open++, true), go: () => { seen.go++; }, options: { format: 'mp4', width: 1920, height: 1080, fps: 30, quality: 'haute', start: 0, end: 4000 } };
    const kit = { ok: (t, d = {}) => ({ ok: true, text: '✓ ' + t, data: d }), ko: t => ({ ok: false, text: '✗ ' + t, data: {} }), ms: (v, d = null) => (v == null ? d : Math.round(+v * 1000)) };
    const H = { C, cams: [], T: 0, xport: () => X }, run = MX.createMondeExt().create(H, kit).RUN;
    const r0 = run.export_cinematic({ format: 'mp4' }), c = C.newCam([], { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 50 }, 0); C.setKey(c, 'x', 3000, 4); H.cams.push(c);
    const r1 = run.export_cinematic({ format: 'mp4' });
    ok('assistant : export refusé sans cinématique ; sinon page préremplie, rendu jamais lancé par l’outil', !r0.ok && /pas encore de cinématique/.test(r0.text) && seen.open === 1 && r1.ok && seen.go === 0);
  }
  ok('assistant : outils du monde et de l’export (heure, clés, export réglé)', ['world_settings', 'set_world', 'set_world_keys', 'export_cinematic'].every(n => MX.MONDE_TOOLS.some(t => t.name === n)) && MX.hourOf('soir') === 19 && MX.hourOf('6h30') === 6.5);

  // Conteneurs écrits ici : GIF (palette optimisée) et AVI (Motion JPEG — images JPEG d'ffmpeg s'il est là)
  const E = await import(studioModule(root, 'encoders.js')), tmp = mkdtempSync(path.join(os.tmpdir(), 'bs-enc-'));
  try {
    const sinkTo = file => { const fd = openSync(file, 'w'); return { write(pos, b) { writeSync(fd, b, 0, b.length, pos); }, close() { closeSync(fd); } }; };
    const gw = 96, gh = 54, gf = path.join(tmp, 'a.gif'), s = sinkTo(gf), g = E.gifWriter(s, { width: gw, height: gh, fps: 10, dither: true });
    for (let k = 0; k < 6; k++) { const px = new Uint8ClampedArray(gw * gh * 4); for (let i = 0; i < gw * gh; i++) { px[i * 4] = (i % gw) * 2 + k * 30; px[i * 4 + 1] = (i / gw | 0) * 4; px[i * 4 + 2] = 200 - k * 20; px[i * 4 + 3] = 255; } g.add(px); }
    g.finish(); s.close();
    const Q = E.quantize(new Uint8ClampedArray(Array.from({ length: 4000 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256))), 256);
    let black = 0; for (let i = 0; i < Q.size; i++) if (!Q.pal[i * 3] && !Q.pal[i * 3 + 1] && !Q.pal[i * 3 + 2]) black++;
    const pg = ffprobe(gf);
    ok(`export GIF : palette sans case vide, fichier lisible${pg === null ? ' (ffprobe absent : structure seule)' : ' par ffprobe'}`, black <= 1 && readFileSync(gf).subarray(0, 6).toString() === 'GIF89a' && probeOk(pg, 'gif', gw, gh, 6), pg?.startsWith('ERREUR') ? pg : '');
    let jpgs = null; try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=96x54:rate=10', '-frames:v', '5', path.join(tmp, 'f%d.jpg')]); jpgs = [1, 2, 3, 4, 5].map(i => readFileSync(path.join(tmp, `f${i}.jpg`))); } catch { /* pas d'ffmpeg */ }
    if (jpgs) {
      const af = path.join(tmp, 'a.avi'), s2 = sinkTo(af), a = E.aviWriter(s2, { width: 96, height: 54, fps: 10 }); for (const b of jpgs) a.add(new Uint8Array(b)); a.finish(); s2.close();
      ok('export AVI (Motion JPEG) lisible par ffprobe', probeOk(ffprobe(af), 'mjpeg', 96, 54, 5));
      const X = await import(studioModule(root, 'export.js')), sine = new Float32Array(48000).map((_, i) => Math.sin(i / 48000 * 2 * Math.PI * 440) * 0.5), pcm = X.mapAudio({ rate: 48000, data: [sine, sine] }, 0, i => i * 100, 10, 24000);
      const af2 = path.join(tmp, 'b.avi'), s3 = sinkTo(af2), a2 = E.aviWriter(s3, { width: 96, height: 54, fps: 10, audio: { rate: 48000, channels: 2 } });
      jpgs.forEach((b, i) => { a2.add(new Uint8Array(b)); a2.addAudio(X.pcm16(pcm, i * 4800, (i + 1) * 4800)); }); a2.finish(); s3.close();
      let au = null; try { au = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels:stream=duration', '-of', 'json', af2]).toString()).streams.find(x => x.codec_type === 'audio'); } catch { /* ffprobe absent */ }
      ok('export AVI : piste son PCM (48 kHz, stéréo)', au && au.codec_name === 'pcm_s16le' && +au.sample_rate === 48000 && au.channels === 2, JSON.stringify(au));
    }
    ok('export : niveau H.264 selon la taille et la cadence', E.avcCodec(1920, 1080, 30) === 'avc1.640028' && E.avcCodec(3840, 2160, 60) === 'avc1.640034' && E.avcCodec(1280, 720, 30) === 'avc1.64001f');
    // (carte du temps : ralenti ×0,5 → son rééchantillonné ; image figée → silence)
    const X = await import(studioModule(root, 'export.js')), src = new Float32Array(48000).map((_, i) => i / 48000);
    const slow = X.mapAudio({ rate: 48000, data: [src, src] }, 0, i => i * 50, 10, 48000), hold = X.mapAudio({ rate: 48000, data: [src, src] }, 0, i => (i < 5 ? 0 : (i - 5) * 100), 10, 48000);
    ok('export : son suivi le long de la carte du temps (ralenti rééchantillonné, image figée muette)', Math.abs(slow[0][24000] - 0.25) < 0.01 && Math.abs(slow[0][47999] - 0.5) < 0.01 && hold[0][12000] === 0 && Math.abs(hold[0][36000] - 0.25) < 0.01);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** WebM et MP4 : encodés par WebCodecs dans une fenêtre du Studio (contexte sûr), écrits par encoders.js, relus par ffprobe */
export async function checkExportRuntime(ok, w) {
  const r = await w.webContents.executeJavaScript(`(async () => {
    const E = await import('/__studio/encoders.js'), X = await import('/__studio/export.js'), out = {};
    const sine = new Float32Array(48000).map((_, i) => Math.sin(i / 48000 * 2 * Math.PI * 440) * 0.4), pcm = X.mapAudio({ rate: 48000, data: [sine, sine] }, 0, i => i * 100, 10, 38400);
    for (const [fmt, codec] of [['webm', 'vp09.00.10.08'], ['mp4', E.avcCodec(160, 96, 10)]]) {
      const parts = []; let size = 0; const sink = { write(pos, b) { parts.push([pos, b.slice()]); size = Math.max(size, pos + b.length); } };
      const au = await X.encodeAudio(pcm, fmt === 'webm' ? ['opus'] : ['aac', 'opus']); out[fmt + 'Audio'] = au?.codec || null;
      const wr = fmt === 'webm' ? E.webmWriter(sink, { codec: 'V_VP9', width: 160, height: 96, fps: 10, audio: au ? { channels: 2, rate: 48000, priv: au.config } : null }) : E.mp4Writer(sink, { width: 160, height: 96, fps: 10, audio: au ? { codec: au.codec, rate: 48000, channels: 2, config: au.config } : null });
      if (au) for (const [b, ts, n] of au.packets) wr.addAudio(b, fmt === 'webm' ? ts : n);
      let err = null; const enc = new VideoEncoder({ output: (c, m) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); wr.add(b, c.timestamp, c.type === 'key', m?.decoderConfig?.description); }, error: e => { err = String(e); } });
      enc.configure({ codec, width: 160, height: 96, bitrate: 5e5, framerate: 10, ...(fmt === 'mp4' ? { avc: { format: 'avc' } } : {}) });
      for (let i = 0; i < 8; i++) { const px = new Uint8ClampedArray(160 * 96 * 4).map((_, k) => (k % 4 === 3 ? 255 : (k * 7 + i * 40) % 256)); const vf = new VideoFrame(px, { format: 'RGBX', codedWidth: 160, codedHeight: 96, timestamp: i * 100000 }); enc.encode(vf, { keyFrame: i === 0 }); vf.close(); }
      await enc.flush(); enc.close(); wr.finish();
      const all = new Uint8Array(size); for (const [p, b] of parts) all.set(b, p);
      out[fmt] = { err, b64: btoa(Array.from(all, c => String.fromCharCode(c)).join('')) };
    }
    return out; })()`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'bs-enc-'));
  try {
    for (const [fmt, codec] of [['webm', 'vp9'], ['mp4', 'h264']]) {
      const f = path.join(tmp, 'a.' + fmt); writeFileSync(f, Buffer.from(r[fmt].b64, 'base64'));
      const p = ffprobe(f);
      ok(`export ${fmt.toUpperCase()} (WebCodecs + conteneur du Studio)${p === null ? ' — ffprobe absent' : ' lisible par ffprobe'}`, !r[fmt].err && existsSync(f) && probeOk(p, codec, 160, 96, 8), r[fmt].err || (p?.startsWith('ERREUR') ? p : ''));
      let a = null; try { a = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels,duration:format=duration', '-of', 'json', f]).toString()); } catch { /* ffprobe absent */ }
      const as = a?.streams?.find(x => x.codec_type === 'audio');
      ok(`export ${fmt.toUpperCase()} : piste son (${r[fmt + 'Audio'] || 'aucun encodeur'})`, !a || (as && as.channels === 2 && ['opus', 'aac'].includes(as.codec_name) && Math.abs(+a.format.duration - 0.8) < 0.15), JSON.stringify(as || a?.format || null));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

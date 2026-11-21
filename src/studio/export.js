// Big Street Studio — la page « Exporter » (21/11, Lex : « quand j'appuie sur Exporter, une nouvelle page où je choisis la compression,
// le fichier webm/mp4/avi/gif, le nom du fichier, l'instant de début et de fin — la fin étant par défaut la dernière keyframe posée
// sur la timeline »).
//
// Le rendu est fait IMAGE PAR IMAGE, pas en temps réel : pour chaque image, la cinématique est placée à son instant exact, le moteur
// calcule l'image (à la résolution choisie), puis elle est encodée — la vidéo est fluide même si l'ordinateur ne l'est pas. L'horloge
// du moteur (gestes, foulées, effets) avance d'exactement une image à chaque fois. Encodage dans la page, sans programme externe :
// WebCodecs (VP9 / H.264) pour WebM et MP4, JPEG pour AVI, palette optimisée pour GIF — conteneurs écrits par encoders.js. Le fichier
// est écrit par le processus principal (studio-export-main.js), qui choisit le dossier et assainit le nom.
import { webmWriter, mp4Writer, aviWriter, gifWriter, FORMATS, QUALITY, RESOLUTIONS, bitrateFor, jpegQuality, estimateSize, avcCodec } from '/__studio/encoders.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtSize = n => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2).replace('.', ',')} Go` : n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const fmtT = ms => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
const fmtDur = s => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.max(0, Math.round(s))} s`);
/** « 1:23.5 », « 83.5 », « 83,5 s » → millisecondes, ou null */
export function parseTime(v) {
  const s = String(v ?? '').trim().replace(',', '.').replace(/\s*s$/, ''); if (!s) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d*)?)$/.exec(s); if (!m) return null;
  return Math.round(((+m[1] || 0) * 60 + +m[2]) * 1000);
}
const nextFrame = () => new Promise(r => setTimeout(r, 0));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Les choix d'un export, bornés : { format, res, width, height, fps, quality, bitrate, colors, dither, bars, start, end, name } */
export function cleanOptions(o, dur) {
  const format = FORMATS[o?.format] ? o.format : 'mp4', F = FORMATS[format];
  const res = F.res.includes(o?.res) ? o.res : F.res.includes('1080p') ? '1080p' : F.res[1];
  const [width, height] = Number.isInteger(o?.width) && Number.isInteger(o?.height) && o.width >= 16 && o.height >= 16 && o.width <= 7680 && o.height <= 4320 ? [o.width & ~1, o.height & ~1] : RESOLUTIONS[res];
  // (taille et cadence libres : seulement par programme — essais, assistant —, la page propose les valeurs du format)
  const fps = F.fps.includes(+o?.fps) || (o?.width && Number.isInteger(+o?.fps) && +o.fps >= 1 && +o.fps <= 120) ? +o.fps : F.fps[1];
  const quality = QUALITY.some(q => q[0] === o?.quality) ? o.quality : 'haute';
  const start = clamp(Math.round(+o?.start || 0), 0, dur), end = clamp(Math.round(Number.isFinite(+o?.end) ? +o.end : dur), 0, dur);
  return { format, res, width, height, fps, quality, bitrate: Number.isFinite(+o?.bitrate) && +o.bitrate > 0 ? clamp(Math.round(+o.bitrate), 2e5, 2e8) : null,
    colors: [256, 128, 64, 32].includes(+o?.colors) ? +o.colors : 256, dither: o?.dither !== false, bars: !!o?.bars, start: Math.min(start, end), end: Math.max(start, end), name: String(o?.name || ''), reveal: o?.reveal !== false };
}
export const frameCount = o => Math.max(1, Math.round((o.end - o.start) / 1000 / (o.rate || 1) * o.fps));

/**
 * host (studio.js) : { $, el, api, toast, world, rec, cur, T, rate, keyTimes(), clock, begin(), frame(T, jump), end(), bars() }
 */
export function createExport(host) {
  const { $, el, api } = host;
  let page = null, job = null, opts = null, support = new Map();
  try { opts = JSON.parse(localStorage.getItem('studio.export') || 'null'); } catch { opts = null; }
  const keep = () => { try { const { start, end, name, ...o } = opts; localStorage.setItem('studio.export', JSON.stringify(o)); } catch { /* tant pis */ } };

  /** Fin par défaut : la dernière image-clé posée sur la frise (caméras, monde, tout ce qui a des clés) — sinon la fin du record */
  const lastKey = () => { const K = host.keyTimes().filter(Number.isFinite); return K.length ? Math.min(host.rec.dur, Math.max(...K)) : host.rec.dur; };
  const defaultName = () => {
    const c = host.cur, d = new Date(c?.date || Date.now()), p = n => String(n).padStart(2, '0');
    const room = String(c?.roomName || c?.room || 'scene').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'scene';
    return `cinematique_${room}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
  };

  // ---------------------------------------------------------------- Encodeurs vidéo (WebCodecs)
  async function videoConfig(o) {
    if (typeof VideoEncoder === 'undefined') return null;
    const bitrate = o.bitrate || bitrateFor(o.quality, o.width, o.height, o.fps);
    const cands = o.format === 'webm' ? [['vp09.00.40.08', 'V_VP9'], ['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']]
      : ['6400', '4d00', '42e0'].map(p => [avcCodec(o.width, o.height, o.fps, p), 'avc']);
    // (encodeur logiciel d'abord : le même partout, celui qui est testé ; le matériel seulement s'il n'y en a pas)
    for (const [codec, kind] of cands) {
      for (const hw of ['prefer-software', 'no-preference']) {
        const cfg = { codec, width: o.width, height: o.height, bitrate, framerate: o.fps, bitrateMode: 'variable', latencyMode: 'quality', hardwareAcceleration: hw, ...(kind === 'avc' ? { avc: { format: 'avc' } } : {}) };
        try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return { cfg: s.config || cfg, kind }; } catch { /* suivant */ }
      }
    }
    return null;
  }
  async function supported(o) {
    if (o.format === 'avi' || o.format === 'gif') return true;
    const k = `${o.format}|${o.width}x${o.height}|${o.fps}`; if (!support.has(k)) support.set(k, videoConfig(o).then(c => !!c));
    return support.get(k);
  }

  // ---------------------------------------------------------------- Le rendu image par image
  /**
   * Exporte. o : les choix (cleanOptions) ; on(ev) : { type: 'progress', i, n, eta, size, img } | { type: 'done', … } | { type: 'error', text }.
   * Rend { ok, name, dir, size, frames, error }.
   */
  async function run(o, on = () => {}) {
    if (job) return { ok: false, error: 'Un export est déjà en cours.' };
    const W = host.world, rec = host.rec; if (!W || !rec) return { ok: false, error: 'Aucun record ouvert.' };
    o = cleanOptions(o, rec.dur); o.rate = host.rate || 1;
    const step = 1000 / o.fps * o.rate;
    // (ralenti, accéléré, images figées — anim.js — : l'instant du record de chaque image est donné par l'hôte ; sinon, pas réguliers)
    let TL = null; try { TL = host.times?.(o.start, o.end, step) || null; } catch (e) { console.warn('export : temps', e); }
    const n = TL ? TL.length : frameCount(o);
    let vc = null;
    if (o.format === 'webm' || o.format === 'mp4') { vc = await videoConfig(o); if (!vc) return { ok: false, error: `${FORMATS[o.format].name} ${o.width}×${o.height} à ${o.fps} images/s n’est pas pris en charge sur cet ordinateur : baisse la résolution ou la cadence, ou choisis un autre format.` }; }
    const file = await api.xport.open({ name: o.name || defaultName(), ext: o.format }).catch(() => null);
    if (!file?.ok) return { ok: false, error: file?.error || 'Impossible de créer le fichier vidéo.' };
    job = { cancel: false, err: null };
    const J = job, t0 = Date.now();
    // (le fichier : écrit par le processus principal, aux positions données par le conteneur)
    let written = 0; const sink = { write(pos, bytes) { api.xport.write(pos, bytes); written = Math.max(written, pos + bytes.length); } };
    const cv = host.$('#view'), saved = freeze(W, cv, o);
    // (la carte graphique lâche — mémoire pleine, pilote — : l'export s'arrête net au lieu d'écrire des images noires)
    const lost = () => { J.err = new Error('Le rendu 3D a été interrompu (mémoire graphique saturée ?) : réessaie, ou baisse la résolution.'); };
    cv.addEventListener('webglcontextlost', lost);
    // (la toile de copie est en mémoire vive — willReadFrequently — : les images partent à l'encodeur sans relecture du processeur graphique)
    const oc = new OffscreenCanvas(o.width, o.height), g = oc.getContext('2d', { willReadFrequently: true });
    let enc = null, writer = null, pending = 0;
    try {
      if (vc) {
        // (piste son — musiques et sons posés sur la frise : anim.js — : WebM seulement, à vitesse normale ; déjà encodée en Opus)
        let au = null; if (o.format === 'webm' && o.rate === 1) { try { au = await host.audio?.(o.start, o.end) || null; } catch (e) { console.warn('export : son', e); } }
        writer = o.format === 'webm' ? webmWriter(sink, { codec: vc.kind, width: o.width, height: o.height, fps: o.fps, audio: au ? { channels: 2, rate: 48000, priv: au.head } : null }) : mp4Writer(sink, { width: o.width, height: o.height, fps: o.fps });
        enc = new VideoEncoder({ output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); try { writer.add(b, chunk.timestamp, chunk.type === 'key', meta?.decoderConfig?.description); } catch (e) { J.err = e; } }, error: e => { J.err = e; } });
        enc.configure(vc.cfg);
        if (au) for (const [b, ts] of au.packets) writer.addAudio(b, ts);
      } else writer = o.format === 'avi' ? aviWriter(sink, { width: o.width, height: o.height, fps: o.fps }) : gifWriter(sink, { width: o.width, height: o.height, fps: o.fps, colors: o.colors, dither: o.dither });
      host.begin();
      // (avant la première image : la scène de l'instant de début est construite — quartiers de la ville, personnages, objets)
      host.frame(o.start, true);
      for (let k = 0, tw = Date.now(); k < 400; k++) {
        await sleep(k < 8 ? 60 : 120); host.frame(o.start, false);
        if (!(W.chunkQueue?.length) && k >= 8 && Date.now() - tw > 1200) break;
        if (J.cancel) break;
      }
      host.frame(o.start, true);
      for (let i = 0; i < n && !J.cancel && !J.err; i++) {
        const T = TL ? TL[i] : Math.min(o.end, o.start + i * step);
        if (i) advance(step);
        host.frame(T, false);
        // (l'image, telle que le moteur vient de la dessiner — copiée tout de suite, avant que le navigateur ne l'efface)
        g.fillStyle = '#05070c'; g.fillRect(0, 0, o.width, o.height);
        g.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, o.width, o.height);
        try { host.overlay?.(g, o.width, o.height, T); } catch (e) { console.warn('export : calque 2D', e); }   // (fondus, titres et sous-titres : anim.js)
        if (o.bars) { const h = Math.round(o.height * 0.11); g.fillStyle = '#000'; g.fillRect(0, 0, o.width, h); g.fillRect(0, o.height - h, o.width, h); }
        if (enc) {
          const px = g.getImageData(0, 0, o.width, o.height).data;
          const vf = new VideoFrame(px, { format: 'RGBX', codedWidth: o.width, codedHeight: o.height, timestamp: Math.round(i * 1e6 / o.fps), duration: Math.round(1e6 / o.fps) });
          enc.encode(vf, { keyFrame: i % (o.fps * 2) === 0 }); vf.close();
          while (enc.encodeQueueSize > 3 && !J.err) await sleep(4);
        } else if (o.format === 'avi') {
          const b = new Uint8Array(await (await oc.convertToBlob({ type: 'image/jpeg', quality: jpegQuality(o.quality) })).arrayBuffer());
          writer.add(b);
        } else writer.add(g.getImageData(0, 0, o.width, o.height).data);
        const spent = Date.now() - t0, eta = i ? spent / (i + 1) * (n - i - 1) : null;
        if (i % 2 === 0 || i === n - 1) on({ type: 'progress', i: i + 1, n, eta, size: written, T, img: oc });
        await nextFrame();   // (la page respire : barre de progression, bouton « Annuler »)
        pending = i + 1;
      }
      if (enc && !J.err && !J.cancel) await enc.flush();
      if (J.err) throw J.err;
      if (J.cancel) { await api.xport.finish(true); return { ok: false, cancelled: true }; }
      writer.finish();
      const r = await api.xport.finish(false, o.reveal !== false);
      if (!r?.ok) throw new Error(r?.error || 'écriture du fichier impossible');
      return { ok: true, name: r.name, dir: r.dir, size: r.size, frames: pending, secs: (Date.now() - t0) / 1000, width: o.width, height: o.height, fps: o.fps, format: o.format, codec: vc?.cfg.codec || (o.format === 'avi' ? 'mjpeg' : 'gif') };
    } catch (e) {
      console.error(e); try { await api.xport.finish(true); } catch { /* déjà fermé */ }
      return { ok: false, error: String(e?.message || e) };
    } finally {
      try { if (enc && enc.state !== 'closed') enc.close(); } catch { /* déjà fermé */ }
      cv.removeEventListener('webglcontextlost', lost); unfreeze(W, cv, saved); host.end(); job = null;
    }
  }
  // L'horloge du moteur : une image de plus (studio-play.js récent : clock.advance ; sinon, performance.now décalée le temps de l'export)
  let shift = 0, realNow = null;
  function advance(ms) {
    const c = host.clock; if (typeof c?.advance === 'function') { c.advance(ms); return; }
    if (!realNow) { realNow = performance.now; const f = realNow; performance.now = () => f() + shift; }
    shift += ms;
  }
  // Le rendu à la taille de la vidéo : la vue est agrandie hors de l'écran (sous la page d'export), à 1 pixel par pixel ;
  // la qualité automatique et le niveau « Ultra » ne bougent plus pendant l'export (ils se règlent sur la cadence — ici sans objet)
  function freeze(W, cv, o) {
    const s = { css: cv.style.cssText, pr: W.renderer.getPixelRatio(), q: W.quality ? W.quality.done : undefined, um: W.ultra && Object.prototype.hasOwnProperty.call(W.ultra, 'measure') ? W.ultra.measure : null };
    const k = Math.min(1, innerWidth / o.width, innerHeight / o.height);
    cv.style.cssText = `position:fixed;left:0;top:0;width:${o.width}px;height:${o.height}px;transform-origin:0 0;transform:scale(${k});z-index:0`;
    W.renderer.setPixelRatio(1); W.resize();
    if (W.quality) W.quality.done = true;
    if (W.ultra) W.ultra.measure = () => {};
    return s;
  }
  function unfreeze(W, cv, s) {
    cv.style.cssText = s.css; W.renderer.setPixelRatio(s.pr); W.resize();
    if (W.quality && s.q !== undefined) W.quality.done = s.q;
    if (W.ultra) { if (s.um) W.ultra.measure = s.um; else delete W.ultra.measure; }
    if (realNow) { performance.now = realNow; realNow = null; shift = 0; }
  }

  // ---------------------------------------------------------------- La page
  function css() {
    if (document.getElementById('xpStyle')) return;
    document.head.append(el('style', { id: 'xpStyle', text: `
#xpPage { position: fixed; inset: 0; z-index: 60; background: rgba(7, 10, 17, .97); display: flex; flex-direction: column; }
#xpPage header { display: flex; align-items: center; gap: 12px; padding: 16px 22px; border-bottom: 1px solid var(--line); }
#xpPage header h2 { margin: 0; font-size: 18px; font-weight: 600; } #xpPage header h2 b { color: var(--acc); }
#xpPage .xp-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(360px, 1fr); gap: 22px; padding: 20px 22px; overflow: auto; }
#xpPage .xp-prev { display: grid; gap: 12px; align-content: start; }
#xpPage .xp-prev canvas { width: 100%; aspect-ratio: 16 / 9; background: #05070c; border-radius: 12px; border: 1px solid var(--line); object-fit: contain; }
#xpPage .xp-sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
#xpPage .xp-sum div { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; } #xpPage .xp-sum small { display: block; color: var(--mut); font-size: 11px; } #xpPage .xp-sum b { font-size: 15px; }
#xpPage .xp-form { display: grid; gap: 14px; align-content: start; }
#xpPage fieldset { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px 12px; margin: 0; display: grid; gap: 8px; }
#xpPage legend { padding: 0 6px; color: var(--mut); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
#xpPage .seg { display: flex; flex-wrap: wrap; gap: 6px; } #xpPage .seg button { flex: 1; min-width: 64px; height: 34px; border-radius: 9px; border: 1px solid var(--line); background: var(--panel2); cursor: pointer; font-weight: 600; }
#xpPage .seg button.on { background: var(--acc2); border-color: var(--acc2); color: #fff; } #xpPage .seg button:disabled { opacity: .35; cursor: default; }
#xpPage .note { color: var(--mut); font-size: 12px; margin: 0; } #xpPage .warn { color: #ffb36b; font-size: 12px; margin: 0; }
#xpPage .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } #xpPage .row > input:not([type=checkbox]) { flex: 1; min-width: 0; }
#xpPage .ext { color: var(--mut); font-weight: 700; } #xpPage .times { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
#xpPage .times label { display: grid; gap: 4px; color: var(--mut); font-size: 12px; } #xpPage .times .row button { height: 24px; font-size: 11px; padding: 0 7px; }
#xpPage input[type=range] { width: 100%; accent-color: var(--acc2); }
#xpPage footer { display: flex; align-items: center; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--line); }
#xpPage .bar { flex: 1; height: 10px; border-radius: 6px; background: var(--panel2); overflow: hidden; border: 1px solid var(--line); } #xpPage .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--acc2), var(--acc)); }
#xpPage .busy .xp-form { opacity: .5; pointer-events: none; }
#xpPage .done { color: #7ee2a8; font-weight: 600; }` }));
  }
  const F = id => page.querySelector('#' + id);
  function seg(id, items, cur, pick) { const box = F(id); box.replaceChildren(...items.map(([v, label, title]) => el('button', { class: v === cur ? 'on' : '', text: label, title: title || '', 'data-v': String(v), onclick: () => pick(v) }))); }
  function build() {
    css();
    page = el('div', { id: 'xpPage', hidden: '' },
      el('header', {}, el('h2', {}, '⏺ Exporter la ', el('b', { text: 'cinématique' })), el('span', { class: 'grow' }), el('button', { class: 'btn', id: 'xpClose', text: '✕ Fermer', title: 'Revenir au Studio (Échap)' })),
      el('div', { class: 'xp-body' },
        el('div', { class: 'xp-prev' }, el('canvas', { id: 'xpCv', width: '640', height: '360' }),
          el('div', { class: 'xp-sum' }, ...[['xpSumDur', 'Durée de la vidéo'], ['xpSumN', 'Images'], ['xpSumSize', 'Taille estimée'], ['xpSumCodec', 'Codec']].map(([id, t]) => el('div', {}, el('small', { text: t }), el('b', { id })))),
          el('p', { class: 'note', id: 'xpRate' }), el('p', { class: 'note', text: 'Rendu image par image : chaque image est calculée puis encodée, la vidéo est fluide même si l’ordinateur rame (l’export prend alors plus de temps). Les pseudos, poignées et panneaux du Studio n’apparaissent pas dans la vidéo.' })),
        el('div', { class: 'xp-form' },
          el('fieldset', {}, el('legend', { text: 'Fichier' }),
            el('div', { class: 'row' }, el('input', { id: 'xpName', spellcheck: 'false', maxlength: '120', title: 'Nom du fichier (sans extension)' }), el('span', { class: 'ext', id: 'xpExt' })),
            el('div', { class: 'row' }, el('span', { class: 'note grow', id: 'xpDir' }), el('button', { class: 'btn small', id: 'xpPick', text: 'Enregistrer sous…', title: 'Choisir le dossier et le nom' }))),
          el('fieldset', {}, el('legend', { text: 'Format' }), el('div', { class: 'seg', id: 'xpFormat' }), el('p', { class: 'note', id: 'xpFmtNote' })),
          el('fieldset', {}, el('legend', { text: 'Image' }),
            el('div', { class: 'seg', id: 'xpRes' }), el('div', { class: 'seg', id: 'xpFps' }),
            el('label', { class: 'row' }, el('input', { type: 'checkbox', id: 'xpBars' }), 'Bandes de cinéma (noires, en haut et en bas)')),
          el('fieldset', {}, el('legend', { text: 'Compression' }),
            el('div', { class: 'seg', id: 'xpQual' }),
            el('div', { class: 'row', id: 'xpBrRow' }, el('span', { class: 'note', text: 'Débit' }), el('input', { type: 'number', id: 'xpBr', min: '0.2', max: '200', step: '0.5', title: 'Débit en mégabits par seconde (vide : celui de la qualité choisie)' }), el('span', { class: 'note', text: 'Mb/s' })),
            el('div', { class: 'row', id: 'xpGifRow' }, el('span', { class: 'note', text: 'Couleurs' }), el('div', { class: 'seg', id: 'xpColors' }), el('label', { class: 'row' }, el('input', { type: 'checkbox', id: 'xpDither' }), 'Tramage')),
            el('p', { class: 'note', id: 'xpQNote' })),
          el('fieldset', {}, el('legend', { text: 'Séquence' }),
            el('div', { class: 'times' },
              el('label', {}, 'Début', el('input', { id: 'xpStart', spellcheck: 'false', title: 'Instant du record où commence la vidéo (m:ss.cc ou secondes)' }),
                el('div', { class: 'row' }, el('button', { class: 'btn small', id: 'xpStart0', text: '⇤ 0' }), el('button', { class: 'btn small', id: 'xpStartHead', text: 'Tête de lecture' }))),
              el('label', {}, 'Fin', el('input', { id: 'xpEnd', spellcheck: 'false', title: 'Instant du record où finit la vidéo — par défaut, la dernière image-clé de la frise' }),
                el('div', { class: 'row' }, el('button', { class: 'btn small', id: 'xpEndKey', text: 'Dernière clé' }), el('button', { class: 'btn small', id: 'xpEndHead', text: 'Tête de lecture' }), el('button', { class: 'btn small', id: 'xpEndRec', text: 'Fin du record' })))),
            el('p', { class: 'note', id: 'xpSeqNote' })))),
      el('footer', {}, el('div', { class: 'bar', id: 'xpBar' }, el('i')), el('span', { class: 'note', id: 'xpProg' }), el('button', { class: 'btn', id: 'xpReveal', text: '📂 Ouvrir le dossier', hidden: '' }), el('button', { class: 'btn', id: 'xpCancel', text: 'Annuler' }), el('button', { class: 'btn accent', id: 'xpGo', text: '⏺ Exporter' })));
    document.body.append(page);
    F('xpClose').onclick = () => close(); F('xpCancel').onclick = () => { if (job) job.cancel = true; else close(); };
    F('xpGo').onclick = () => go();
    F('xpReveal').onclick = () => api.xport.reveal();
    F('xpPick').onclick = async () => { const r = await api.xport.pick(F('xpName').value, opts.format).catch(() => null); if (r?.ok) { F('xpName').value = r.name; F('xpDir').textContent = `Dossier : ${r.dir}`; } };
    F('xpName').oninput = () => { opts.name = F('xpName').value; };
    F('xpBars').onchange = e => { opts.bars = e.target.checked; render(); };
    F('xpDither').onchange = e => { opts.dither = e.target.checked; keep(); };
    F('xpBr').oninput = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); opts.bitrate = Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) : null; render(false); };
    const setT = (k, v) => { if (v == null) return; opts[k] = clamp(Math.round(v), 0, host.rec.dur); if (opts.start > opts.end) { if (k === 'start') opts.end = opts.start; else opts.start = opts.end; } render(); };
    F('xpStart').onchange = e => setT('start', parseTime(e.target.value)); F('xpEnd').onchange = e => setT('end', parseTime(e.target.value));
    F('xpStart0').onclick = () => setT('start', 0); F('xpStartHead').onclick = () => setT('start', host.T);
    F('xpEndKey').onclick = () => setT('end', lastKey()); F('xpEndHead').onclick = () => setT('end', host.T); F('xpEndRec').onclick = () => setT('end', host.rec.dur);
    for (const i of page.querySelectorAll('input')) i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur?.(); });
    page.addEventListener('keydown', e => { if (e.key === 'Escape' && !job) { e.stopPropagation(); close(); } });
  }
  function render(full = true) {
    const o = cleanOptions(opts, host.rec.dur); Object.assign(opts, { format: o.format, res: o.res, fps: o.fps, quality: o.quality });
    const Fm = FORMATS[o.format], video = o.format === 'webm' || o.format === 'mp4';
    if (full) {
      seg('xpFormat', Object.entries(FORMATS).map(([k, f]) => [k, f.name, f.note]), o.format, v => { opts.format = v; keep(); render(); });
      seg('xpRes', Fm.res.map(r => [r, r === '4k' ? '4K' : r, RESOLUTIONS[r].join(' × ')]), o.res, v => { opts.res = v; keep(); render(); });
      seg('xpFps', Fm.fps.map(f => [f, `${f} i/s`]), o.fps, v => { opts.fps = v; keep(); render(); });
      seg('xpQual', QUALITY.map(([k, n]) => [k, n]), o.quality, v => { opts.quality = v; opts.bitrate = null; F('xpBr').value = ''; keep(); render(); });
      seg('xpColors', [256, 128, 64].map(c => [c, String(c)]), o.colors, v => { opts.colors = v; keep(); render(); });
      F('xpExt').textContent = '.' + o.format; F('xpFmtNote').textContent = Fm.note;
      F('xpBars').checked = o.bars; F('xpDither').checked = o.dither;
      F('xpBrRow').hidden = !video; F('xpGifRow').hidden = o.format !== 'gif';
      if (document.activeElement !== F('xpStart')) F('xpStart').value = fmtT(o.start);
      if (document.activeElement !== F('xpEnd')) F('xpEnd').value = fmtT(o.end);
    }
    const n = frameCount({ ...o, rate: host.rate }), br = o.bitrate || bitrateFor(o.quality, o.width, o.height, o.fps);
    F('xpSumDur').textContent = fmtDur(n / o.fps); F('xpSumN').textContent = `${n} · ${o.width}×${o.height}`;
    F('xpSumSize').textContent = '≈ ' + fmtSize(estimateSize({ ...o, frames: n, bitrate: br }));
    F('xpSumCodec').textContent = { webm: 'VP9', mp4: 'H.264', avi: 'Motion JPEG', gif: `GIF ${o.colors} coul.` }[o.format];
    if (video && document.activeElement !== F('xpBr')) F('xpBr').placeholder = (br / 1e6).toFixed(1).replace('.', ',');
    F('xpQNote').textContent = video ? `Débit ${(br / 1e6).toFixed(1).replace('.', ',')} Mb/s (${o.bitrate ? 'choisi' : 'selon la qualité'}) — plus il est haut, plus l’image est nette et le fichier lourd.`
      : o.format === 'avi' ? `JPEG qualité ${Math.round(jpegQuality(o.quality) * 100)} % pour chaque image.` : 'Une palette optimisée par image ; le tramage adoucit les dégradés (ciel, ombres).';
    const lk = lastKey();
    F('xpSeqNote').textContent = `Record : ${fmtT(host.rec.dur)} · dernière clé de la frise : ${fmtT(lk)}${host.keyTimes().length ? '' : ' (aucune clé : la fin du record)'}${o.format === 'gif' && n / o.fps > 20 ? ' · un GIF de plus de 20 s est très lourd.' : ''}`;
    F('xpRate').textContent = (host.rate || 1) !== 1 ? `Vitesse de lecture ${String(host.rate).replace('.', ',')}× : la vidéo dure ${fmtDur(n / o.fps)} pour ${fmtDur((o.end - o.start) / 1000)} de record.` : '';
    F('xpGo').disabled = !!job || o.end - o.start < 50;
    supported(o).then(ok => { if (!page.hidden && !job) { F('xpGo').disabled = !ok || o.end - o.start < 50; F('xpQNote').classList.toggle('warn', !ok); if (!ok) F('xpQNote').textContent = `${Fm.name} ${o.width}×${o.height} à ${o.fps} i/s n’est pas pris en charge par cet ordinateur : baisse la résolution ou la cadence, ou choisis un autre format.`; } });
    keep();
  }
  function preview(src) {
    const c = F('xpCv'), g = c.getContext('2d'); g.fillStyle = '#05070c'; g.fillRect(0, 0, c.width, c.height);
    try { const sw = src.width, sh = src.height, k = Math.min(c.width / sw, c.height / sh), w = sw * k, h = sh * k; g.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h); } catch { /* pas d'image */ }
  }
  /** Ouvre la page (bouton « ⏺ Exporter ») ; o : choix imposés (assistant IA) */
  function open(o = {}) {
    if (!host.rec || job) return false;
    if (!page) build();
    opts = { ...(opts || {}), ...o };
    if (!('start' in o)) opts.start = 0;
    if (!('end' in o)) opts.end = lastKey();
    if (!('bars' in o)) opts.bars = host.bars();
    opts.name = o.name || defaultName();
    page.hidden = false; page.classList.remove('busy');
    F('xpName').value = opts.name; F('xpBar').firstChild.style.width = '0'; F('xpProg').textContent = ''; F('xpReveal').hidden = true;
    F('xpCancel').textContent = 'Annuler'; F('xpGo').hidden = false;
    api.xport.info().then(r => { if (r?.dir) F('xpDir').textContent = `Dossier : ${r.dir}`; }).catch(() => {});
    render(); requestAnimationFrame(() => preview(host.$('#view')));
    page.tabIndex = -1; page.focus();
    return true;
  }
  function close() { if (job || !page) return; page.hidden = true; }
  async function go(o = null) {
    if (job) return null;
    if (o) opts = { ...opts, ...o };
    const O = cleanOptions(opts, host.rec.dur);
    page.classList.add('busy'); F('xpGo').disabled = true; F('xpCancel').textContent = 'Annuler l’export'; F('xpReveal').hidden = true;
    F('xpProg').className = 'note'; F('xpProg').textContent = 'Préparation de la scène…';
    const r = await run({ ...O, name: F('xpName').value || opts.name, reveal: opts.reveal }, ev => {
      if (ev.type !== 'progress') return;
      F('xpBar').firstChild.style.width = `${ev.i / ev.n * 100}%`;
      F('xpProg').textContent = `Image ${ev.i} / ${ev.n} · ${fmtT(ev.T)} · ${fmtSize(ev.size)}${ev.eta != null ? ` · reste ≈ ${fmtDur(ev.eta / 1000)}` : ''}`;
      if (ev.i % 6 === 1 || ev.i === ev.n) preview(ev.img);
    });
    page.classList.remove('busy'); F('xpCancel').textContent = 'Fermer'; F('xpGo').disabled = false;
    if (r.ok) { F('xpProg').className = 'note done'; F('xpProg').textContent = `✓ ${r.name} — ${fmtSize(r.size)}, ${r.frames} images en ${fmtDur(r.secs)}`; F('xpReveal').hidden = false; F('xpBar').firstChild.style.width = '100%'; host.toast(`🎬 Vidéo exportée : ${r.name}`); }
    else { F('xpProg').className = 'note warn'; F('xpProg').textContent = r.cancelled ? 'Export annulé : aucun fichier n’a été gardé.' : `⚠ ${r.error}`; F('xpBar').firstChild.style.width = '0'; }
    return r;
  }
  return {
    open, close, go, run, cleanOptions, lastKey, defaultName,
    get busy() { return !!job; }, get visible() { return !!page && !page.hidden; }, get options() { return opts && cleanOptions(opts, host.rec?.dur || 0); },
    cancel() { if (job) job.cancel = true; },
  };
}

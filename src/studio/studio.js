// Big Street Studio — l'interface : liste des records, caméra libre, frise à une piste par caméra, caméras dans la scène
// (poignées de déplacement et de rotation), propriétés (coordonnées, focale, filtres, parent), cinématique et export.
// Le moteur 3D est celui du jeu (chargé par le relais local du launcher, cf. studio-main.js) ; la relecture d'un record est
// faite par /js/studio-play.js, qui vit avec le jeu. Les caméras : cams.js ; les filtres : fx.js ; les poignées : gizmo.js.
import { CH, FX_CH, PARAMS, EASES, FILTERS, newCam, loadProject, saveProject as packProject, keyAt, hasKey, keyTimes, setKey, delAt, moveAt, easeAt, easeOf, valAt, poseAt, fxAt, toLocal, worldPose, rebase as camRebase, wouldLoop, activeCam, cineRange } from '/__studio/cams.js';
import { createFX } from '/__studio/fx.js';
import { createGizmos } from '/__studio/gizmo.js';

const $ = s => document.querySelector(s);
const api = window.bsStudio, API = 1;   // (API : version du module /js/studio-play.js attendue — STUDIO_API)
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  e.append(...kids.filter(k => k != null)); return e;
};
function toast(text, err = false) { const t = el('div', { class: 'toast' + (err ? ' err' : ''), text }); $('#toasts').append(t); setTimeout(() => t.remove(), err ? 7000 : 4000); }
const fmt = ms => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const fmtDur = ms => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; };
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const realNow = performance.now.bind(performance);   // (l'heure vraie : le moteur, lui, suit la vitesse de lecture)

// ---------------------------------------------------------------- État
let lib = null, clock = null, world = null, pb = null, rec = null, cur = null, fx = null, giz = null;
let T = 0, playing = false, rate = 1, seekNext = true, opening = false;
let mode = 'free';   // free : caméra libre · cam : à travers la caméra sélectionnée · cine : cinématique · pov : yeux du joueur
const cam = { x: 0, y: 3, z: 0, yaw: 0, pitch: -0.1, roll: 0, fov: 60 };
const view = { dist: 160, real: realNow };
// (sélection : une caméra, et éventuellement une image-clé — selT son instant, selCh son paramètre, ou null pour la ligne résumé)
let speed = 12, cams = [], selId = null, selCh = null, selT = null, saveTimer = 0, exporting = null, onCineEnd = null, povHead = null, modal = null, lastMouse = [0, 0];
const held = new Set();
try { const s = JSON.parse(localStorage.getItem('studio.view') || '{}'); if (s.dist) view.dist = clamp(+s.dist, 60, 600); if (s.speed) speed = clamp(+s.speed, 1, 120); } catch { /* réglages par défaut */ }
const keepView = () => { try { localStorage.setItem('studio.view', JSON.stringify({ dist: view.dist, speed })); } catch { /* tant pis */ } };
const selCam = () => cams.find(c => c.id === selId) || null;

// ---------------------------------------------------------------- Liste des records
let records = [];
async function refresh() {
  const r = await api.list().catch(() => null);
  const box = $('#recList'); box.replaceChildren();
  if (!r) { box.append(el('div', { class: 'none', text: 'Dossier des records inaccessible.' })); return; }
  records = r.records; $('#sideFoot').textContent = r.dir;
  if (r.recording) box.append(el('div', { class: 'rec' }, el('div', { class: 'name', text: 'Record en cours…' }), el('div', { class: 'tags' }, el('span', { class: 'tag live', text: '● en jeu' }))));
  if (!records.length && !r.recording) box.append(el('div', { class: 'none' }, 'Aucun record pour le moment.', el('br'), el('br'), 'En jeu : Échap → Studio → « Start Record ».'));
  let day = '';
  for (const it of records) {
    const d = new Date(it.date), dk = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (dk !== day) { day = dk; box.append(el('div', { class: 'day', text: dk })); }
    const card = el('div', { class: 'rec' + (cur?.name === it.name ? ' on' : ''), title: it.name, onclick: () => openRecord(it) },
      el('div', { class: 'name', text: it.roomName || it.room || 'Lieu inconnu' }),
      el('div', { class: 'meta' }, el('span', { text: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }), el('span', { text: fmtDur(it.dur || 0) }), el('span', { text: fmtSize(it.size) }), el('span', { text: `rayon ${it.radius}` })),
      el('div', { class: 'tags' }, it.player ? el('span', { class: 'tag', text: it.player }) : null, it.auto ? el('span', { class: 'tag', text: 'auto' }) : null,
        it.project ? el('span', { class: 'tag cine', text: '🎬 cinématique' }) : null, it.done ? null : el('span', { class: 'tag live', text: 'interrompu' })),
      el('button', { class: 'del', title: 'Supprimer ce record', text: '🗑', onclick: async e => { e.stopPropagation(); const x = await api.remove(it.name); if (x?.ok) { if (cur?.name === it.name) closeRecord(); refresh(); } } }));
    box.append(card);
  }
}

// ---------------------------------------------------------------- Moteur
async function engine() {
  if (world) return;
  try { lib = await import('/js/studio-play.js'); }
  catch (e) { console.error(e); throw new Error('Le moteur du jeu n’est pas encore sur cet ordinateur : ouvre le Studio une première fois en étant connecté à Internet.'); }
  // (ce module vient du jeu, cette interface du launcher : ils doivent parler la même version)
  if (lib.STUDIO_API !== API) throw new Error(lib.STUDIO_API > API ? 'Le jeu a évolué : mets le launcher à jour pour utiliser le Studio.' : 'Le moteur du jeu gardé sur cet ordinateur est trop ancien : ouvre le Studio une fois en étant connecté à Internet.');
  clock = lib.installClock(); clock.setSpeed(0);
  world = await lib.createStudioWorld($('#view'), $('#overlay'));
  fx = createFX(lib.THREE, world);
  giz = await createGizmos(lib.THREE, world, $('#view'), $('#overlay'), {
    select: id => { if (!modal) selectCam(id); },
    change: (id, patch) => { const c = cams.find(x => x.id === id); if (c) { setWorld(c, patch); renderTracks(); } },
    drag: on => { if (!on) { touch(); renderTracks(); } },
  });
  $('#ultra').checked = world.gfx?.ultra ?? true;
  // (la vue change de taille — liste repliée, panneau — : image recalculée tout de suite, pas d'éclair noir)
  new ResizeObserver(() => { world.resize(); if (pb) { try { world.frame(); } catch { /* prochaine image */ } } }).observe($('#stage'));
}
function busy(text) { $('#loading').hidden = !text; if (text) { $('#loadingText').textContent = text; $('#empty').hidden = true; } }

function closeRecord() {
  pb = null; rec = null; cur = null; playing = false; mode = 'free'; cams = []; selId = null; selCh = null; selT = null; modalEnd(false);
  for (const id of ['#dock', '#topbar', '#settings', '#help', '#props']) $(id).hidden = true;
  giz?.clear(); if (world) world.post = null;
  $('#empty').hidden = false; $('#overlay').replaceChildren(); $('#view').style.visibility = 'hidden';
  if (document.pointerLockElement) document.exitPointerLock();
}
async function openRecord(it) {
  if (opening || exporting) return; opening = true;
  try {
    if (cur) await saveProject(true);
    busy('Chargement du moteur du jeu…'); await engine();
    busy(`Lecture du record — ${it.roomName || it.room}…`);
    const res = await fetch('/__studio/rec/' + encodeURIComponent(it.name)); if (!res.ok) throw new Error('Record introuvable.');
    const next = lib.parseRecord(await res.text());
    busy('Reconstruction du lieu…');
    pb = null; setPlaying(false); setMode('free'); giz.clear(); world.post = null;
    const p = new lib.Playback(world, next);
    await p.load(); lib.attachCamera(world, cam, view);
    rec = next; pb = p; cur = it; T = 0; seekNext = true;
    Object.assign(cam, { roll: 0, fov: 60 }); behindPlayer(0);
    cams = []; selId = null; selCh = null; selT = null;
    try { const pj = loadProject(JSON.parse(await api.loadProject(it.name) || 'null')); cams = pj.cams; setRate(pj.rate); } catch { /* pas de projet */ }
    for (const c of cams) for (const L of Object.values(c.tracks)) for (const k of L) k.t = clamp(k.t, 0, rec.dur);
    relinkParents();
    if (cams.length) selId = cams[0].id;
    $('#view').style.visibility = ''; for (const id of ['#dock', '#topbar']) $(id).hidden = false;
    $('#recTitle').textContent = `${it.roomName || it.room} — ${new Date(it.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
    fillParents(); syncSettings(); renderTicks(); renderTracks(); renderProps(); busy(''); refresh();
    hint('Clique sur la vue pour prendre la caméra · H : commandes', 6000);
  } catch (e) { console.error(e); busy(''); closeRecord(); $('#emptyText').textContent = String(e.message || e); toast(String(e.message || e), true); }
  opening = false;
}

// ---------------------------------------------------------------- Lecture
function setPlaying(on) {
  playing = !!on && !!pb; $('#play').textContent = playing ? '❚❚' : '▶';
  clock?.setSpeed(playing ? rate : 0);
}
function setRate(r) { rate = clamp(+r || 1, 0.05, 8); $('#rate').value = String(rate); if (playing) clock?.setSpeed(rate); }
function seek(t) { if (!rec) return; T = clamp(t, 0, rec.dur); seekNext = true; }
function hint(text, ms = 2500) { const h = $('#hint'); h.textContent = text; h.hidden = !text; clearTimeout(hint.t); if (text && ms) hint.t = setTimeout(() => { h.hidden = true; }, ms); }

// ---------------------------------------------------------------- Parents : personnages, véhicules, caméras
// Repère d'un personnage ou d'un véhicule du record à l'instant t : { x, y, z, yaw } (yaw : vers où il regarde ou roule)
function trackAt(K, t) {
  const n = K.t.length; if (!n) return null;
  let lo = 0, hi = n - 1; if (K.t[0] >= t) return [K.x[0], K.z[0], K.y[0], K.a[0]];
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (K.t[m] <= t) lo = m; else hi = m - 1; }
  if (lo + 1 >= n) return [K.x[lo], K.z[lo], K.y[lo], K.a[lo]];
  const t1 = K.t[lo + 1], t0 = Math.max(K.t[lo], t1 - 150); if (t <= t0) return [K.x[lo], K.z[lo], K.y[lo], K.a[lo]];
  const k = (t - t0) / (t1 - t0), da = Math.atan2(Math.sin(K.a[lo + 1] - K.a[lo]), Math.cos(K.a[lo + 1] - K.a[lo]));
  return [K.x[lo] + (K.x[lo + 1] - K.x[lo]) * k, K.z[lo] + (K.z[lo + 1] - K.z[lo]) * k, K.y[lo], K.a[lo] + da * k];
}
function frame(parent, t) {
  if (!rec || !world) return null;
  if (parent.kind === 'perso') {
    const q = pb?.where(t, parent.id); if (!q) return null;
    return { x: q[0], y: q[2] ?? world.heightAt(Math.round(q[0]), Math.round(q[1])), z: q[1], yaw: Math.PI / 2 - (q[3] || 0) };
  }
  if (parent.kind === 'vehicule') {
    const K = rec.vehs.get(parent.id), q = K && trackAt(K, t); if (!q) return null;
    return { x: q[0], y: world.heightAt(Math.round(q[0]), Math.round(q[1])), z: q[1], yaw: q[3] || 0 };
  }
  return null;
}
const wpose = (c, t = T) => worldPose(c, t, cams, frame);
/** Ce à quoi une caméra peut s'attacher : [{ kind, id, name }] — les personnages par leur nom, les véhicules, les autres caméras */
function parentChoices(forCam = null) {
  const out = [], seen = new Set();
  for (const [id, K] of rec.users) { const name = K.desc[0]?.[1]?.name; if (!name) continue; const n = seen.has(name.toLowerCase()) ? `${name} #${id}` : name; seen.add(name.toLowerCase()); out.push({ kind: 'perso', id, name: n }); }
  for (const [id, K] of rec.vehs) out.push({ kind: 'vehicule', id, name: `Véhicule ${K.desc[0]?.[1]?.model || ''} #${id}`.replace(/\s+/g, ' ') });
  for (const c of cams) if (c !== forCam) out.push({ kind: 'camera', id: c.id, name: c.name });
  return out;
}
function fillParents() { const L = $('#parentList'); L.replaceChildren(); if (!rec) return; for (const p of parentChoices(selCam())) L.append(el('option', { value: p.name })); }
// (projet rouvert : un parent est retrouvé par son identifiant, sinon par son nom — le même PNJ n'a pas forcément le même numéro)
function relinkParents() {
  for (const c of cams) { const P = c.parent; if (!P) continue;
    const L = parentChoices(c), hit = L.find(p => p.kind === P.kind && String(p.id) === String(P.id) && (P.kind === 'camera' || p.name === P.name)) || L.find(p => p.kind === P.kind && p.name.toLowerCase() === String(P.name).toLowerCase());
    if (hit) c.parent = { ...hit }; }
}
// (changer le parent, ou « tourner avec », sans que la caméra bouge : cf. cams.js)
const rebase = (c, change) => camRebase(c, cams, frame, change);
function setParent(c, text) {
  const s = String(text || '').trim(), info = $('#pParentInfo');
  if (!s) { if (c.parent) { rebase(c, () => { c.parent = null; c.look = false; }); touch(); } renderProps(); renderTracks(); return; }
  const L = parentChoices(c), low = s.toLowerCase();
  let hit = L.find(p => p.name.toLowerCase() === low); if (!hit) { const part = L.filter(p => p.name.toLowerCase().includes(low)); if (part.length === 1) hit = part[0]; else if (part.length > 1) { info.className = 'p-parent err'; info.textContent = `Plusieurs noms correspondent (${part.slice(0, 4).map(p => p.name).join(', ')}…) : précise.`; return; } }
  if (!hit) { info.className = 'p-parent err'; info.textContent = `« ${s} » : introuvable dans ce record.`; return; }
  if (hit.kind === 'camera' && wouldLoop(c, hit.id, cams)) { info.className = 'p-parent err'; info.textContent = 'Impossible : ces caméras se suivraient en boucle.'; return; }
  rebase(c, () => { c.parent = { ...hit }; if (hit.kind === 'vehicule') c.follow = true; });
  touch(); renderProps(); renderTracks(); hint(`${c.name} suit maintenant ${hit.name}.`, 3000);
}

// ---------------------------------------------------------------- Caméras et images-clés
function touch() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveProject(true), 1500); }
async function saveProject(quiet = false) {
  clearTimeout(saveTimer); if (!cur) return;
  if (!cams.length && !cur.project) return;
  const r = await api.saveProject(cur.name, packProject(cur.name, rate, cams)).catch(() => null);
  if (r?.ok) { cur.project = true; if (!quiet) toast('💾 Projet enregistré à côté du record.'); } else if (!quiet) toast('Enregistrement du projet impossible.', true);
}
function selectCam(id, ch = null, t = null, go = false) {
  if (modal) modalEnd(false);
  const c = cams.find(x => x.id === id) || null; selId = c ? c.id : null; selCh = c && t != null ? ch : null; selT = c ? t : null;
  if (c && go && t != null) { if (mode === 'cine') stopCine(); seek(t); }
  if (!c && mode === 'cam') setMode('free');
  fillParents(); renderTracks(); renderProps();
}
function addCam() {
  if (!pb) return;
  const c = newCam(cams, cam, Math.round(T)); cams.push(c);
  if (mode !== 'free') setMode('free');
  selectCam(c.id, null, Math.round(T)); touch();
  hint(`${c.name} posée. Clique-la dans la scène pour la déplacer ; « ◆ Clé » (K) à un autre instant pour l’animer.`, 5000);
}
/**
 * Donne une valeur à un paramètre d'une caméra, à l'instant courant. Une piste à une seule clé reste fixe (c'est cette clé qui
 * change) ; une piste animée reçoit une clé à cet instant ; un réglage de filtre sans clé reste une valeur fixe. force : poser la clé.
 */
function setParam(c, ch, v, force = false) {
  const L = c.tracks[ch], t = Math.round(T);
  if (!force && !L.length && FX_CH.includes(ch)) { c[ch] = clamp(v, 0, 1); return; }
  if (!force && L.length === 1 && keyAt(L, t) < 0) { setKey(c, ch, L[0].t, v); return; }
  setKey(c, ch, t, v);
}
/** Écrit une pose (monde) : seuls les paramètres qui changent reçoivent une clé, chacun sur sa piste */
function setWorld(c, patch, force = false) {
  const w = wpose(c) || { ...cam, P: null }, L0 = poseAt(c, T) || toLocal({ ...w }, w.P, c.follow), L = toLocal({ ...w, ...patch }, w.P, c.follow);
  for (const ch of CH) if (Number.isFinite(L[ch]) && (force || Math.abs(L[ch] - L0[ch]) > 1e-6)) setParam(c, ch, L[ch], force);
}
/** K : image-clé de la caméra sélectionnée à l'instant courant, sur tous les paramètres de pose, d'après la vue */
function addKey() {
  if (!pb) return; const c = selCam(); if (!c) return addCam();
  const pose = mode === 'free' || mode === 'pov' ? { ...cam } : (wpose(c) || { ...cam });
  setWorld(c, pose, true); selCh = null; selT = c.tracks.x[keyAt(c.tracks.x, T)]?.t ?? Math.round(T); renderTracks(); renderProps(); touch();
  hint(`Clé posée sur ${c.name} à ${fmt(T)}.`, 2500);
}
function delKey() {
  const c = selCam(); if (!c || selT == null) return;
  if (delAt(c, selCh, selT)) { selT = null; selCh = null; renderTracks(); renderProps(); touch(); }
}
/** Le losange d'un champ : pose une clé de ce paramètre à l'instant courant, ou retire celle qui s'y trouve */
function toggleKey(c, ch) {
  const L = c.tracks[ch], i = keyAt(L, T);
  if (i >= 0) delAt(c, ch, L[i].t); else setKey(c, ch, Math.round(T), CH.includes(ch) ? (poseAt(c, T) || toLocal({ ...cam }, null, false))[ch] : fxAt(c, T)[ch]);
  renderTracks(); renderProps(); touch();
}
function delCam(c) {
  for (const o of cams) if (o !== c && o.parent?.kind === 'camera' && o.parent.id === c.id) rebase(o, () => { o.parent = null; });
  cams = cams.filter(x => x !== c);
  if (selId === c.id) { selId = cams[0]?.id || null; selCh = null; selT = null; if (mode === 'cam') setMode('free'); }
  fillParents(); renderTracks(); renderProps(); touch();
}

// ---------------------------------------------------------------- Frise : une piste par caméra, dépliable en une ligne par paramètre
function renderTicks() {
  const box = $('#tlTicks'); box.replaceChildren(); if (!rec) return;
  const total = rec.dur / 1000, step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => total / s <= 12) || 600;
  for (let s = 0; s < total; s += step) { const t = el('span', { text: s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s` }); t.style.left = `${s / total * 100}%`; box.append(t); }
}
const fmtVal = (ch, v) => (['yaw', 'pitch', 'roll'].includes(ch) ? `${deg(v).toFixed(1)}°` : ch === 'fov' ? `${v.toFixed(1)}°` : FX_CH.includes(ch) ? `${Math.round(v * 100)} %` : v.toFixed(2));
// Une ligne de la frise. ch : le paramètre (null : la ligne résumé, où une clé = toutes celles de cet instant)
function laneOf(c, ch, dur) {
  const sel = c.id === selId, times = ch ? c.tracks[ch].map(k => k.t) : keyTimes(c);
  const lane = el('div', { class: 'lane' + (ch ? ' sub' : '') + (sel && !ch ? ' sel' : '') + (c.on ? '' : ' off'), title: ch ? 'Double-clic : poser une clé de ce paramètre à cet instant' : 'Double-clic : poser une clé (tous les paramètres) à cet instant' }); lane.style.setProperty('--c', c.color);
  for (let i = 0; i + 1 < times.length; i++) { const cut = ch ? c.tracks[ch][i].ease === 'fixe' : easeOf(c, null, times[i]) === 'fixe', b = el('div', { class: 'bar' + (cut ? ' cut' : '') }); b.style.left = `${times[i] / dur * 100}%`; b.style.width = `${(times[i + 1] - times[i]) / dur * 100}%`; lane.append(b); }
  times.forEach((t, i) => {
    const on = sel && selT === t && (!ch || !selCh || selCh === ch);
    const d = el('div', { class: 'kf' + (on ? ' sel' : ''), title: ch ? `${fmtVal(ch, c.tracks[ch][i].v)} à ${fmt(t)} (glisser pour déplacer)` : `${c.name} — clés de ${fmt(t)} (glisser pour les déplacer toutes)` });
    d.style.left = `${t / dur * 100}%`; d.addEventListener('pointerdown', e => dragKey(e, c, ch, t)); lane.append(d);
  });
  lane.addEventListener('pointerdown', e => { if (e.target.classList.contains('kf')) return; if (selId !== c.id) selectCam(c.id); scrub(e, $('#timeline')); });
  lane.addEventListener('dblclick', e => {
    if (e.target.classList.contains('kf')) return; const box = $('#timeline').getBoundingClientRect(), t = Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * rec.dur);
    const L = poseAt(c, t) || toLocal({ ...cam }, null, false), F = fxAt(c, t);
    for (const k of ch ? [ch] : CH) if (keyAt(c.tracks[k], t) < 0) setKey(c, k, t, CH.includes(k) ? L[k] : F[k]);
    selId = c.id; selCh = ch; selT = t; seek(t); renderTracks(); renderProps(); touch();
  });
  return lane;
}
function renderTracks() {
  const host = $('#trackRows'); if (!rec) { host.replaceChildren(); return; }
  const wrap = el('div', { class: 'tr-wrap' }), dur = Math.max(1, rec.dur), keepScroll = host.firstChild?.scrollTop || 0;
  if (!cams.length) wrap.append(el('div', { class: 'tr-empty', text: 'Aucune caméra : place la vue, puis « ＋ Caméra ». Chaque caméra a sa piste ; dépliée (▸), une ligne d’images-clés par paramètre.' }));
  for (const c of cams) {
    const sel = c.id === selId;
    const head = el('div', { class: 'tr-head' + (sel ? ' sel' : ''), title: c.name, onclick: () => selectCam(c.id) },
      el('button', { class: 'tw on', title: c.open ? 'Replier : une seule ligne, toutes les clés' : 'Déplier : une ligne d’images-clés par paramètre', text: c.open ? '▾' : '▸', onclick: e => { e.stopPropagation(); c.open = !c.open; renderTracks(); touch(); } }), el('i'),
      el('span', { class: 'nm' }, c.name, c.parent ? el('small', { text: ` ↳ ${c.parent.name}` }) : null),
      el('button', { class: c.on ? 'on' : 'off', title: c.on ? 'Active dans la cinématique (cliquer pour l’écarter)' : 'Écartée de la cinématique (cliquer pour l’activer)', text: c.on ? '●' : '○', onclick: e => { e.stopPropagation(); c.on = !c.on; renderTracks(); renderProps(); touch(); } }),
      el('button', { class: sel && mode === 'cam' ? 'on' : '', title: 'Regarder à travers cette caméra', text: '🎥', onclick: e => { e.stopPropagation(); const same = selId === c.id && mode === 'cam'; if (selId !== c.id) selectCam(c.id); setMode(same ? 'free' : 'cam'); renderTracks(); } }));
    head.style.setProperty('--c', c.color);
    wrap.append(head, laneOf(c, null, dur));
    if (c.open) for (const [ch, name] of PARAMS) {
      const n = c.tracks[ch].length, has = keyAt(c.tracks[ch], T) >= 0;
      const sh = el('div', { class: 'tr-head sub' + (sel && selCh === ch && selT != null ? ' sel' : ''), title: `${name} — ${n ? `${n} clé${n > 1 ? 's' : ''}` : 'pas de clé (valeur fixe)'}`, onclick: () => selectCam(c.id) },
        el('span', { class: 'nm', text: name }), el('small', { class: 'muted', text: n ? String(n) : '' }),
        el('button', { class: 'kd' + (has ? ' on' : ''), title: has ? 'Retirer la clé de cet instant' : 'Poser une clé de ce paramètre à cet instant', text: '◆', 'data-kd': `${c.id}|${ch}`, onclick: e => { e.stopPropagation(); selId = c.id; toggleKey(c, ch); } }));
      wrap.append(sh, laneOf(c, ch, dur));
    }
  }
  host.replaceChildren(wrap); wrap.scrollTop = keepScroll;
  $('#preview').disabled = $('#export').disabled = !cineRange(cams) && !exporting && mode !== 'cine';
  for (const id of ['#addKey', '#gMove', '#gRot', '#camView']) $(id).disabled = !selCam();
  $('#camView').classList.toggle('on', mode === 'cam'); $('#gMove').classList.toggle('on', giz?.mode === 'translate' && !!selCam()); $('#gRot').classList.toggle('on', giz?.mode === 'rotate' && !!selCam());
}
function scrub(e, box0) {
  if (!rec || exporting) return; const box = box0.getBoundingClientRect(), was = playing; setPlaying(false); if (mode === 'cine') stopCine();
  const go = ev => seek(clamp((ev.clientX - box.left) / box.width, 0, 1) * rec.dur); go(e);
  const up = () => { removeEventListener('pointermove', go); removeEventListener('pointerup', up); if (was) setPlaying(true); renderProps(); };
  addEventListener('pointermove', go); addEventListener('pointerup', up);
}
// Glisser une clé : elle change d'instant (sur la ligne résumé : toutes les clés de cet instant) ; simple clic : la sélectionner
function dragKey(e, c, ch, t) {
  e.stopPropagation(); e.preventDefault(); const box = $('#timeline').getBoundingClientRect(); let moved = false, at = t; const x0 = e.clientX;
  const mv = ev => { if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true; const nt = Math.round(clamp((ev.clientX - box.left) / box.width, 0, 1) * rec.dur); if (nt === at) return;
    moveAt(c, ch, at, nt); at = nt; selId = c.id; selCh = ch; selT = at; renderTracks(); renderProps(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) touch(); else selectCam(c.id, ch, t, true); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

// ---------------------------------------------------------------- Panneau de propriétés
const FIELDS = { pX: ['x', 1, 2], pY: ['y', 1, 2], pZ: ['z', 1, 2], pYaw: ['yaw', 180 / Math.PI, 1], pPitch: ['pitch', 180 / Math.PI, 1], pRoll: ['roll', 180 / Math.PI, 1], pFov: ['fov', 1, 1] };
const SLIDERS = { vignette: 'pVignette', grain: 'pGrain', dof: 'pDof' };
const pct = v => (v > 0.004 ? `${Math.round(v * 100)} %` : 'non');
function renderProps() {
  const c = selCam(), box = $('#props'); box.hidden = !c || !pb; if (!c || !pb) return;
  const A = document.activeElement;
  if (A !== $('#pName')) $('#pName').value = c.name;
  $('#pDot').style.background = c.color; $('#pColor').value = c.color; $('#pOn').checked = c.on;
  if (A !== $('#pParent')) $('#pParent').value = c.parent?.name || '';
  const info = $('#pParentInfo'); info.className = 'p-parent'; info.replaceChildren(...(c.parent ? ['Parent : ', el('b', { text: c.parent.name }), ` (${{ perso: 'personnage', vehicule: 'véhicule', camera: 'caméra' }[c.parent.kind]})`] : [el('span', { class: 'muted', text: 'Aucun parent : la caméra est libre dans la scène.' })]));
  $('#pFollow').checked = c.follow; $('#pLook').checked = c.look; $('#pFollow').disabled = $('#pLook').disabled = !c.parent;
  $('#pFilter').value = c.filter;
  const has = selT != null && hasKey(c, selCh, selT);
  if (A !== $('#pT')) $('#pT').value = has ? (selT / 1000).toFixed(2) : ''; $('#pT').disabled = $('#pEase').disabled = $('#pKeyDel').disabled = !has; $('#pT').max = String(rec.dur / 1000);
  $('#pEase').value = has ? easeOf(c, selCh, selT) : 'fluide';
  $('#pKeyWhat').textContent = !has ? 'aucune clé sélectionnée' : selCh ? `${PARAMS.find(p => p[0] === selCh)[1]} · ${fmt(selT)}` : `tous les paramètres · ${fmt(selT)}`;
  $('#pView').classList.toggle('on', mode === 'cam');
  propsLive(true);
}
// (valeurs à l'instant courant — coordonnées dans le monde —, rafraîchies à chaque image tant qu'on n'écrit pas dedans ; le losange
// de chaque champ est plein quand son paramètre a une clé à cet instant)
function propsLive(force = false) {
  const c = selCam(); if (!c || $('#props').hidden) return;
  const w = wpose(c), A = document.activeElement, F = fxAt(c, T);
  for (const [id, [ch, k, d]] of Object.entries(FIELDS)) { const f = document.getElementById(id); f.disabled = !w || !!(c.look && c.parent && (ch === 'yaw' || ch === 'pitch')); if (A === f && !force) continue; const v = w ? (w[ch] * k).toFixed(d) : ''; if (f.value !== v) f.value = v; }
  for (const [ch, id] of Object.entries(SLIDERS)) { const f = document.getElementById(id), v = String(Math.round(F[ch] * 20) / 20); if ((A !== f || force) && f.value !== v) f.value = v; const o = document.getElementById(id + 'V'), tx = pct(F[ch]); if (o.textContent !== tx) o.textContent = tx; }
  for (const b of document.querySelectorAll('#props .kd')) { const on = keyAt(c.tracks[b.dataset.ch], T) >= 0, anim = c.tracks[b.dataset.ch].length > 1; if (b.classList.contains('on') !== on) b.classList.toggle('on', on); if (b.classList.contains('anim') !== anim) b.classList.toggle('anim', anim); }
  for (const b of document.querySelectorAll('#trackRows .kd')) { const [id, ch] = b.dataset.kd.split('|'), o = cams.find(x => x.id === id), on = !!o && keyAt(o.tracks[ch], T) >= 0; if (b.classList.contains('on') !== on) b.classList.toggle('on', on); }
  const n = keyTimes(c).length, txt = !n ? 'aucune clé' : hasKey(c, null, T) ? `clé à ${fmt(T)}` : fmt(T);
  if ($('#pWhen').textContent !== txt) $('#pWhen').textContent = txt;
  const note = w?.lost ? `⚠ ${c.parent.name} n’est pas là à cet instant.` : c.parent ? `Coordonnées dans le monde ; la caméra suit ${c.parent.name}.` : 'Modifier une valeur animée pose une clé sur sa ligne ; ◆ : poser ou retirer la clé de cet instant.';
  if ($('#pNote').textContent !== note) $('#pNote').textContent = note;
}
function bindProps() {
  for (const [v, t] of Object.entries(EASES)) $('#pEase').append(el('option', { value: v, text: t }));
  for (const [v, t] of Object.entries(FILTERS)) $('#pFilter').append(el('option', { value: v, text: t }));
  const C = fn => (...a) => { const c = selCam(); if (!c) return; fn(c, ...a); renderTracks(); touch(); };
  // (le losange de chaque paramètre animable, à côté de son champ)
  for (const [id, ch] of [...Object.entries(FIELDS).map(([i, f]) => [i, f[0]]), ...Object.entries(SLIDERS).map(([k, i]) => [i, k])]) {
    const b = el('button', { class: 'kd', 'data-ch': ch, title: 'Image-clé de ce paramètre à l’instant courant : poser / retirer', text: '◆', onclick: e => { e.preventDefault(); const c = selCam(); if (c) toggleKey(c, ch); } });
    b.addEventListener('pointerdown', e => e.stopPropagation());
    const lab = document.getElementById(id).closest('label'), sp = lab.querySelector('span'); if (sp) sp.append(b); else lab.querySelector('b').before(b);
  }
  $('#pName').oninput = C(c => { c.name = $('#pName').value.slice(0, 40) || 'Caméra'; for (const o of cams) if (o.parent?.kind === 'camera' && o.parent.id === c.id) o.parent.name = c.name; });
  $('#pColor').oninput = C(c => { c.color = $('#pColor').value; $('#pDot').style.background = c.color; });
  $('#pOn').onchange = C(c => { c.on = $('#pOn').checked; });
  for (const [id, [ch, k]] of Object.entries(FIELDS)) document.getElementById(id).oninput = C(c => { const v = parseFloat(document.getElementById(id).value); if (!Number.isFinite(v)) return; setWorld(c, { [ch]: v / k }); });
  $('#pT').onchange = C(c => { if (selT == null) return; const nt = Math.round(clamp(+$('#pT').value || 0, 0, rec.dur / 1000) * 1000); moveAt(c, selCh, selT, nt); selT = nt; seek(nt); renderProps(); });
  $('#pEase').onchange = C(c => { if (selT != null) easeAt(c, selCh, selT, $('#pEase').value); });
  $('#pKey').onclick = addKey; $('#pKeyDel').onclick = delKey;
  $('#pParent').onchange = () => { const c = selCam(); if (c) setParent(c, $('#pParent').value); };
  $('#pFollow').onchange = C(c => { rebase(c, () => { c.follow = $('#pFollow').checked; }); renderProps(); });
  $('#pLook').onchange = C(c => { c.look = $('#pLook').checked; renderProps(); });
  $('#pFilter').onchange = C(c => { c.filter = $('#pFilter').value; if (c.filter && mode === 'free') hint('Le filtre se voit à travers la caméra : « 🎥 Vue caméra » (0).', 4000); });
  for (const [k, id] of Object.entries(SLIDERS)) document.getElementById(id).oninput = C(c => { setParam(c, k, +document.getElementById(id).value); });
  $('#pView').onclick = () => setMode(mode === 'cam' ? 'free' : 'cam');
  $('#pDup').onclick = () => { const c = selCam(); if (!c) return; const d = newCam(cams); Object.assign(d, JSON.parse(JSON.stringify({ ...c, id: d.id, name: d.name, color: d.color }))); cams.push(d); selectCam(d.id); touch(); };
  $('#pDelCam').onclick = () => { const c = selCam(); if (c) delCam(c); };
  // (glisser sur le nom d'un champ : la valeur suit la souris — Maj : dix fois plus fin)
  for (const s of document.querySelectorAll('#props .drag')) s.addEventListener('pointerdown', e => {
    const f = document.getElementById(s.dataset.f); if (f.disabled) return; e.preventDefault(); let x = e.clientX, v = parseFloat(f.value) || 0; const step = +s.dataset.s;
    const mv = ev => { v += (ev.clientX - x) * step * (ev.shiftKey ? 0.1 : 1); x = ev.clientX; f.value = v.toFixed(2); f.dispatchEvent(new Event(f.id === 'pT' ? 'change' : 'input')); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); renderProps(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  for (const f of document.querySelectorAll('#props input, #props select')) f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') f.blur(); });
}

// ---------------------------------------------------------------- Déplacer / tourner au clavier (G, R — puis X, Y, Z ; clic : valider ; Échap : annuler)
function modalStart(kind) {
  const c = selCam(), w = c && wpose(c); if (!w || mode !== 'free' || exporting) return;
  if (modal) modalEnd(false);
  giz.setMode(kind === 'R' ? 'rotate' : 'translate'); renderTracks();
  modal = { kind, cam: c, keys: JSON.stringify(c.tracks), w0: { ...w }, axis: null, m0: [...lastMouse], r0: giz.ray(...lastMouse) };
  modalText();
}
function modalText() { const m = $('#modal'); m.hidden = !modal; if (modal) m.textContent = `${modal.kind === 'G' ? 'Déplacer' : 'Tourner'} ${modal.cam.name}${modal.axis ? ` — axe ${modal.axis.toUpperCase()}` : ''} · X / Y / Z : contraindre · clic : valider · Échap : annuler`; }
function modalMove() {
  const M = modal; if (!M) return; const w = M.w0;
  M.cam.tracks = JSON.parse(M.keys);
  if (M.kind === 'R') {
    const d = (lastMouse[0] - M.m0[0]) * 0.008, ax = M.axis || 'y';
    setWorld(M.cam, ax === 'y' ? { yaw: w.yaw + d } : ax === 'x' ? { pitch: clamp(w.pitch - d, -1.55, 1.55) } : { roll: w.roll + d });
  } else {
    const r = giz.ray(...lastMouse), o = [w.x, w.y, w.z];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let p;
    if (M.axis) {   // (sur un axe : le point de l'axe le plus proche du rayon du pointeur)
      const a = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[M.axis], w0 = sub(o, r.o), b = dot(a, r.d), d0 = dot(a, w0), e = dot(r.d, w0), den = 1 - b * b;
      const s = Math.abs(den) < 1e-5 ? 0 : (b * e - d0) / den; p = [o[0] + a[0] * s, o[1] + a[1] * s, o[2] + a[2] * s];
    } else {        // (libre : dans le plan qui fait face à la vue, à la distance de la caméra déplacée)
      const cp = Math.cos(cam.pitch), n = [Math.cos(cam.yaw) * cp, Math.sin(cam.pitch), Math.sin(cam.yaw) * cp];
      const hit = rr => { const den = dot(n, rr.d); if (Math.abs(den) < 1e-5) return null; const s = dot(n, sub(o, rr.o)) / den; return [rr.o[0] + rr.d[0] * s, rr.o[1] + rr.d[1] * s, rr.o[2] + rr.d[2] * s]; };
      const a = hit(M.r0), b = hit(r); p = a && b ? [o[0] + b[0] - a[0], o[1] + b[1] - a[1], o[2] + b[2] - a[2]] : o;
    }
    if (p.every(v => Number.isFinite(v) && Math.abs(v) < 1e6)) setWorld(M.cam, { x: p[0], y: p[1], z: p[2] });
  }
  renderTracks();
}
function modalEnd(ok) {
  const M = modal; if (!M) return; modal = null; modalText();
  if (!ok) M.cam.tracks = JSON.parse(M.keys); else touch();
  renderTracks(); renderProps();
}

// ---------------------------------------------------------------- Modes de vue, cinématique
function setMode(m) {
  if (m === mode) return;
  if (mode === 'cine') { $('#preview').classList.remove('on'); const f = onCineEnd; onCineEnd = null; mode = 'free'; f?.(); }
  if (mode === 'pov') povRestore();
  if (m === 'cam' && !(selCam() && wpose(selCam()))) m = 'free';
  mode = m; if (modal) modalEnd(false);
  if (m === 'pov') $('#povBtn').classList.add('on');
  if (m !== 'free' && document.pointerLockElement) document.exitPointerLock();
  if (m === 'cam') hint(`Vue à travers ${selCam().name} — Échap ou un déplacement pour revenir en caméra libre`, 3500);
  if (pb) { renderTracks(); renderProps(); }
}
function startCine(done = null) {
  const R = cineRange(cams);
  if (!R) { toast('Il faut au moins deux images-clés sur les caméras actives pour faire une cinématique.', true); return false; }
  setMode('cine'); onCineEnd = done; seek(R[0]); setPlaying(true); $('#preview').classList.add('on');
  return true;
}
function stopCine() { if (mode === 'cine') setMode('free'); }
// Vue du joueur enregistré : la caméra à ses yeux, tournée comme il regardait
function povRestore() { if (povHead) { povHead.scale.setScalar(1); povHead = null; } $('#povBtn').classList.remove('on'); if (mode === 'pov') mode = 'free'; }
function povApply() {
  const q = pb.where(T); if (!q) return;
  const L = pb.lookAt(T), yaw = L ? L.yaw : Math.atan2(Math.cos(q[3]), Math.sin(q[3])), pitch = L ? L.pitch : -0.05;
  const a = world.avatars.get(pb.me), head = a?.rig?.bones?.tete;
  if (head && head !== povHead) { if (povHead) povHead.scale.setScalar(1); povHead = head; } if (povHead) povHead.scale.setScalar(0.001);
  Object.assign(cam, { x: q[0] + Math.cos(yaw) * 0.22, z: q[1] + Math.sin(yaw) * 0.22, y: (a ? a.group.position.y : q[2] || 0) + (a?.st === 'sit' ? 1.25 : 1.68), yaw, pitch, roll: 0 });
}
// (la caméra derrière le joueur enregistré, tournée vers lui ; dans un bâtiment, sans traverser le mur)
function behindPlayer(t) {
  const q = pb?.where(t); if (!q) return;
  const a = q[3] || 0, out = !!world.room?.outdoor; let d = out ? 5 : 3.2;
  const at = k => [q[0] - Math.sin(a) * k, q[1] - Math.cos(a) * k];
  while (d > 0.6 && !world.isFloor(Math.round(at(d)[0]), Math.round(at(d)[1]))) d -= 0.4;
  const [x, z] = at(d);
  Object.assign(cam, { x, z, y: (q[2] || 0) + (out ? 2.6 : 1.9), pitch: -0.2 }); cam.yaw = Math.atan2(q[1] - z, q[0] - x);
}
function goPlayer() { if (!pb) return; setMode('free'); behindPlayer(T); }

// ---------------------------------------------------------------- Export vidéo
async function exportVideo() {
  if (exporting) { stopCine(); return; }
  if (!cineRange(cams)) return toast('Il faut au moins deux images-clés sur les caméras actives pour faire une cinématique.', true);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => window.MediaRecorder?.isTypeSupported(m));
  if (!mime) return toast('L’export vidéo n’est pas disponible sur cet ordinateur.', true);
  const st = await api.exportStart(cur.name).catch(() => null); if (!st?.ok) return toast('Impossible de créer le fichier vidéo.', true);
  const stream = $('#view').captureStream(60), mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 24e6 });
  let chain = Promise.resolve();
  mr.ondataavailable = e => { if (e.data.size) chain = chain.then(async () => api.exportChunk(new Uint8Array(await e.data.arrayBuffer()))); };
  mr.onstop = async () => {
    await chain; stream.getTracks().forEach(t => t.stop());
    const r = await api.exportEnd().catch(() => null); exporting = null; $('#recDot').hidden = true; $('#export').textContent = '⏺ Exporter'; $('#export').classList.remove('on');
    toast(r?.ok ? `🎬 Vidéo exportée : ${r.file}` : 'Export interrompu.', !r?.ok); renderTracks();
  };
  exporting = mr; $('#recDot').hidden = false; $('#export').textContent = '⏹ Arrêter l’export'; $('#export').classList.add('on');
  if (!startCine(() => { setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, 250); })) { exporting = null; return; }
  mr.start(1000);
}

// ---------------------------------------------------------------- Caméra libre
const MOVE = { KeyW: [1, 0, 0], KeyS: [-1, 0, 0], KeyD: [0, 1, 0], KeyA: [0, -1, 0], Space: [0, 0, 1], KeyC: [0, 0, -1], ControlLeft: [0, 0, -1] };
function moveCamera(dt) {
  if (mode !== 'free' || modal) return;
  let f = 0, r = 0, u = 0; const locked = document.pointerLockElement === $('#view');
  for (const c of held) { const m = MOVE[c]; if (!m || (c === 'Space' && !locked)) continue; f += m[0]; r += m[1]; u += m[2]; }
  if (!f && !r && !u) return;
  const v = speed * (held.has('ShiftLeft') || held.has('ShiftRight') ? 3.5 : 1) * dt, cp = Math.cos(cam.pitch), fx0 = Math.cos(cam.yaw), fz = Math.sin(cam.yaw);
  cam.x += (fx0 * cp * f - fz * r) * v; cam.z += (fz * cp * f + fx0 * r) * v; cam.y += (Math.sin(cam.pitch) * f + u) * v;
}
function turn(dx, dy) {
  if (exporting || modal) return;
  if (mode !== 'free') setMode('free');
  cam.yaw += dx * 0.0022; cam.pitch = clamp(cam.pitch - dy * 0.0022, -1.55, 1.55);
}
function syncSettings() {
  $('#spd').value = String(speed); $('#spdV').textContent = `${speed} cases/s`;
  $('#fov').value = String(Math.round(cam.fov)); $('#fovV').textContent = `${Math.round(cam.fov)}°`;
  $('#roll').value = String(Math.round(deg(cam.roll))); $('#rollV').textContent = `${Math.round(deg(cam.roll))}°`;
  $('#dist').value = String(view.dist); $('#distV').textContent = `${view.dist} cases`;
}

// ---------------------------------------------------------------- Boucle d'image
let last = realNow();
function loop() {
  requestAnimationFrame(loop);
  const now = realNow(), dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (!pb || !world) return;
  if (playing) {
    T += dt * 1000 * rate;
    const end = mode === 'cine' ? (cineRange(cams)?.[1] ?? rec.dur) : rec.dur;
    if (T >= end) { T = end; setPlaying(false); if (mode === 'cine') { const a = activeCam(cams, T), w = a && wpose(a); if (w) for (const c of CH) cam[c] = w[c]; stopCine(); } }
  }
  moveCamera(dt);
  // La vue : libre, à travers une caméra (avec son filtre), ou celle de la cinématique (les caméras actives s'enchaînent)
  let shot = null;
  if (mode === 'cine') shot = activeCam(cams, T); else if (mode === 'cam') shot = selCam(); else if (mode === 'pov') povApply();
  const w = shot && wpose(shot);
  if (w) for (const c of CH) cam[c] = w[c]; else if (mode === 'cam') setMode('free');
  if (w) { fx.use(fxAt(shot, T), w.P ? Math.hypot(w.P.x - w.x, w.P.y + 1 - w.y, w.P.z - w.z) : 12); world.post = fx.active ? fx : null; } else if (world.post) world.post = null;
  pb.eye = { x: cam.x, z: cam.z, r: view.dist + 10 };
  try {
    pb.step(T, seekNext); seekNext = false;
    const show = (mode === 'free' || mode === 'pov') && !exporting, cv = $('#view');
    giz.sync(cams.map(c => { const p = show ? wpose(c) : null; return { id: c.id, name: c.name, color: c.color, parentName: c.parent?.name || '', pose: p, lost: !!p?.lost }; }), selId, show, (cv.clientWidth || 16) / (cv.clientHeight || 9));
    world.frame();
  } catch (e) { if (!loop.err) { loop.err = true; console.error(e); toast('Erreur d’affichage : ' + (e.message || e), true); } }
  loop.n = (loop.n || 0) + 1;
  $('#time').textContent = `${fmt(T)} / ${fmt(rec.dur)}`;
  const k = `${T / Math.max(1, rec.dur) * 100}%`; $('#tlFill').style.width = k; $('#tlHead').style.left = k; $('#tracks').style.setProperty('--head', k);
  propsLive();
}

// ---------------------------------------------------------------- Commandes
function bind() {
  const cv = $('#view');
  $('#refresh').onclick = refresh; $('#folder').onclick = () => api.openFolder();
  $('#toggleSide').onclick = () => $('#app').classList.toggle('no-side');
  $('#play').onclick = () => { if (!pb) return; if (!playing && T >= rec.dur - 1) seek(0); setPlaying(!playing); };
  $('#rate').onchange = e => { setRate(e.target.value); touch(); };
  $('#addCam').onclick = addCam; $('#addKey').onclick = addKey; $('#saveProj').onclick = () => saveProject(false); $('#export').onclick = exportVideo;
  $('#gMove').onclick = () => { giz?.setMode('translate'); if (mode !== 'free') setMode('free'); renderTracks(); };
  $('#gRot').onclick = () => { giz?.setMode('rotate'); if (mode !== 'free') setMode('free'); renderTracks(); };
  $('#camView').onclick = () => setMode(mode === 'cam' ? 'free' : 'cam');
  $('#preview').onclick = () => { if (mode === 'cine') { setPlaying(false); stopCine(); } else startCine(); };
  $('#goPlayer').onclick = goPlayer;
  $('#povBtn').onclick = () => { if (pb) setMode(mode === 'pov' ? 'free' : 'pov'); };
  $('#tagsBtn').onclick = () => $('#tagsBtn').classList.toggle('on', !$('#overlay').classList.toggle('hide-tags'));
  $('#tagsBtn').classList.add('on');
  $('#setBtn').onclick = () => { $('#help').hidden = true; $('#settings').hidden = !$('#settings').hidden; };
  $('#helpBtn').onclick = () => { $('#settings').hidden = true; $('#help').hidden = !$('#help').hidden; };
  $('#spd').oninput = e => { speed = +e.target.value; syncSettings(); keepView(); };
  $('#fov').oninput = e => { cam.fov = +e.target.value; syncSettings(); };
  $('#roll').oninput = e => { cam.roll = rad(+e.target.value); syncSettings(); };
  $('#dist').oninput = e => { view.dist = +e.target.value; syncSettings(); keepView(); };
  $('#ultra').onchange = e => world?.applyGfx({ ultra: e.target.checked });
  $('#bars').onchange = e => { $('#letterbox').hidden = !e.target.checked; };
  bindProps();
  $('#timeline').addEventListener('pointerdown', e => scrub(e, $('#timeline')));
  // Souris : clic sur une caméra = la sélectionner ; ailleurs = prendre la caméra libre ; clic droit maintenu = tourner ; molette = vitesse
  let rdrag = false;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    if (!pb) return; $('#settings').hidden = $('#help').hidden = true;
    if (modal) { e.stopPropagation(); modalEnd(e.button === 0); return; }
    if (e.button === 2) { rdrag = true; cv.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0 || exporting) return;
    if (mode === 'free' || mode === 'pov') { if (giz?.hover) return; const id = giz?.pick(e.clientX, e.clientY); if (id) { selectCam(id); return; } }
    cv.requestPointerLock?.();
  }, true);
  cv.addEventListener('pointerup', e => { if (e.button === 2) rdrag = false; });
  addEventListener('mousemove', e => { lastMouse = [e.clientX, e.clientY]; if (modal) return modalMove(); if ((document.pointerLockElement === cv || rdrag) && !giz?.dragging) turn(e.movementX, e.movementY); });
  cv.addEventListener('wheel', e => { e.preventDefault(); speed = clamp(Math.round(speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2)) || 1, 1, 120); syncSettings(); keepView(); hint(`Vitesse de la caméra : ${speed} cases/s`, 1200); }, { passive: false });
  document.addEventListener('pointerlockchange', () => { const on = document.pointerLockElement === cv; hint(on ? 'Caméra prise — Échap pour la lâcher' : '', 2500); if (!on) held.clear(); });
  addEventListener('blur', () => held.clear());
  addEventListener('keydown', e => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.code === 'Tab') { e.preventDefault(); $('#app').classList.toggle('no-side'); return; }
    if (!pb) return;
    const locked = document.pointerLockElement === cv;
    if (modal) {   // (déplacement ou rotation en cours : X / Y / Z contraignent, Entrée valide, Échap annule)
      e.preventDefault();
      if (e.code === 'Escape') modalEnd(false); else if (e.code === 'Enter' || e.code === 'NumpadEnter') modalEnd(true);
      else if (['KeyX', 'KeyY', 'KeyZ'].includes(e.code)) { const a = e.code.slice(3).toLowerCase(); modal.axis = modal.axis === a ? null : a; modalText(); modalMove(); }
      return;
    }
    if (MOVE[e.code] || e.code.startsWith('Shift')) { held.add(e.code); if (MOVE[e.code] && mode !== 'free' && !exporting && !(e.code === 'Space' && !locked)) setMode('free'); }
    if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!locked) $('#play').click(); }
    else if (e.code === 'Escape') { if ((mode === 'cam' || mode === 'cine') && !exporting) { setPlaying(false); setMode('free'); } }
    else if (e.code === 'ArrowLeft') seek(T - 2000); else if (e.code === 'ArrowRight') seek(T + 2000);
    else if (e.code === 'KeyK') { if (e.shiftKey) addCam(); else addKey(); }
    else if (e.code === 'KeyG' && !locked) modalStart('G'); else if (e.code === 'KeyR' && !locked) modalStart('R');
    else if (e.code === 'Digit0' || e.code === 'Numpad0') $('#camView').click();
    else if (e.code === 'Delete' || e.code === 'Backspace') delKey();
    else if (e.code === 'KeyP') $('#preview').click();
    else if (e.code === 'KeyJ') goPlayer(); else if (e.code === 'KeyV') $('#povBtn').click();
    else if (e.code === 'KeyN') $('#tagsBtn').click(); else if (e.code === 'KeyH') $('#helpBtn').click();
  });
  addEventListener('keyup', e => held.delete(e.code));
  addEventListener('beforeunload', () => { if (cur && cams.length) api.saveProject(cur.name, packProject(cur.name, rate, cams)); });
  api.onChanged(() => refresh());
}

bind(); closeRecord(); refresh(); requestAnimationFrame(loop);
// (outils de test du launcher : ouvrir un record par son nom, piloter les caméras, lire l'état)
window.__studio = { open: name => { const it = records.find(r => r.name === name); return it ? openRecord(it) : Promise.reject(new Error('record absent')); }, seek, addCam, addKey, startCine, setMode, selectCam, setParent: (i, s) => setParent(cams[i], s), modalStart,
  get cams() { return cams; }, setKey: (i, ch, sec, v) => { setKey(cams[i], ch, Math.round(sec * 1000), v); renderTracks(); renderProps(); }, valAt: (i, ch, sec) => valAt(cams[i].tracks[ch], sec * 1000), refreshUi() { fillParents(); renderTracks(); renderProps(); }, pose: (i, t = T) => wpose(cams[i], t),
  get state() { return { images: loop.n || 0, ready: !!pb, T, dur: rec?.dur || 0, avatars: world?.avatars.size || 0, cams: cams.length, keys: cams.reduce((n, c) => n + keyTimes(c).length, 0), sel: selId, selCh, selT, mode, filtre: !!world?.post, poignees: !!giz?.hasHandles, cam: { ...cam }, room: world?.room?.id || null, chunks: world?.chunkQueue?.length || 0 }; },
  set(o) { Object.assign(cam, o); }, play: setPlaying, get world() { return world; }, get me() { return pb?.me; }, where: t => pb?.where(t), parents: () => parentChoices().map(p => p.name) };

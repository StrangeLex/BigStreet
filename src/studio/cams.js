// Big Street Studio — les caméras d'un projet de cinématique (format « .bsproj », version 3).
//
//   { v: 3, record, rate, cams: [ {
//       id, name, color, on (prise en compte dans la cinématique), open (piste dépliée dans la frise),
//       filter ('' | 'nuit' | 'thermique' | 'nb' | 'sepia' | 'cine'), vignette, grain, dof (valeurs fixes, 0–1, quand leur piste est vide),
//       parent: null | { kind: 'perso' | 'vehicule' | 'camera', id, name }, follow (tourne avec le parent), look (regarde le parent),
//       tracks: { x: [...], y, z, yaw, pitch, roll, fov, vignette, grain, dof }   — UNE PISTE PAR PARAMÈTRE, chacune avec ses
//                 propres images-clés { t (ms du record), v (valeur), ease }, triées par t, indépendantes des autres pistes
//   } ] }
//
// Les positions et le lacet d'une caméra attachée à un parent sont RELATIFS à ce parent.
// Version 2 (jamais publiée telle quelle) : cams[].keys = [{ t, x, y, z, yaw, pitch, roll, fov, ease }] — une clé = tous les paramètres.
// Version 1 (launcher 1.6.0) : { v: 1, keys: [...] } — une seule suite de clés ; elle devient « Caméra 1 ».
// Ce module ne touche ni au DOM ni au moteur : il se teste seul (tools/selftest.mjs).
export const PROJECT_VERSION = 3;
export const CH = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov'];   // (la pose)
export const FX_CH = ['vignette', 'grain', 'dof'];                    // (les réglages de filtre animables)
export const PARAMS = [['x', 'Position X'], ['y', 'Position Y'], ['z', 'Position Z'], ['yaw', 'Lacet'], ['pitch', 'Tangage'], ['roll', 'Roulis'], ['fov', 'FOV'],
  ['vignette', 'Vignette'], ['grain', 'Grain'], ['dof', 'Flou de profondeur']];
const ALL = PARAMS.map(p => p[0]);
export const EASES = { fluide: 'travelling fluide', doux: 'départ et arrivée en douceur', accel: 'accélère', frein: 'ralentit', fixe: 'plan fixe (coupe)' };
export const FILTERS = { '': 'Aucun', nuit: 'Vision nocturne', thermique: 'Thermique (chaleur)', nb: 'Noir et blanc', sepia: 'Sépia', cine: 'Cinéma (teal & orange)' };
export const COLORS = ['#ff8a3d', '#4f8cff', '#3ddc84', '#ff5b8a', '#ffd23d', '#b07cff', '#3dd6d0', '#ff6b4a'];
const EASE = { fluide: u => u, doux: u => u * u * (3 - 2 * u), accel: u => u * u, frein: u => 1 - (1 - u) * (1 - u), fixe: () => 0 };
const LIM = { pitch: [-1.55, 1.55], fov: [5, 130], vignette: [0, 1], grain: [0, 1], dof: [0, 1] }, DEF = { fov: 60 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lim = (ch, v) => (LIM[ch] ? clamp(v, LIM[ch][0], LIM[ch][1]) : v);
const TOL = 45;   // (ms : deux clés plus proches que ça sont « au même instant »)

const cleanK = (ch, k) => ({ t: Math.max(0, Math.round(num(k.t))), v: lim(ch, num(k.v, DEF[ch] || 0)), ease: EASE[k.ease] ? k.ease : 'fluide' });
/** Une piste triée ; le lacet est déroulé d'une clé à la suivante (la caméra tourne par le plus court). */
export function sortTrack(L, ch) {
  L.sort((a, b) => a.t - b.t);
  if (ch === 'yaw') for (let i = 1; i < L.length; i++) L[i].v = L[i - 1].v + wrap(L[i].v - L[i - 1].v);
  return L;
}
const emptyTracks = () => Object.fromEntries(ALL.map(ch => [ch, []]));
let seq = 0;
/** Une caméra neuve ; pose : { x, y, z, yaw, pitch, roll, fov } → une clé par paramètre à l'instant t. */
export function newCam(list, pose = null, t = 0) {
  const n = list.length + 1; let name = `Caméra ${n}`; for (let i = n; list.some(c => c.name === name); i++) name = `Caméra ${i + 1}`;
  const cam = { id: `c${Date.now().toString(36)}${(seq++).toString(36)}`, name, color: COLORS[list.length % COLORS.length], on: true, open: false, filter: '', vignette: 0, grain: 0, dof: 0,
    parent: null, follow: false, look: false, tracks: emptyTracks() };
  if (pose) for (const ch of CH) cam.tracks[ch].push(cleanK(ch, { t, v: pose[ch] }));
  return cam;
}
function cleanCam(c, i) {
  const P = c.parent && ['perso', 'vehicule', 'camera'].includes(c.parent.kind) && c.parent.id != null ? { kind: c.parent.kind, id: c.parent.id, name: String(c.parent.name || '').slice(0, 60) } : null;
  const cam = { id: String(c.id || `c${i}`), name: String(c.name || `Caméra ${i + 1}`).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : COLORS[i % COLORS.length], on: c.on !== false, open: !!c.open,
    filter: c.filter in FILTERS ? c.filter : '', vignette: clamp(num(c.vignette), 0, 1), grain: clamp(num(c.grain), 0, 1), dof: clamp(num(c.dof), 0, 1),
    parent: P, follow: !!c.follow, look: !!c.look, tracks: emptyTracks() };
  if (c.tracks && typeof c.tracks === 'object') {
    for (const ch of ALL) if (Array.isArray(c.tracks[ch])) cam.tracks[ch] = c.tracks[ch].filter(k => k && Number.isFinite(+k.t) && Number.isFinite(+k.v)).map(k => cleanK(ch, k));
  } else if (Array.isArray(c.keys)) {   // (versions 1 et 2 : une clé portait tous les paramètres — elle devient une clé sur chaque piste)
    for (const k of c.keys) if (k && Number.isFinite(+k.t) && Number.isFinite(+k.x)) for (const ch of CH) cam.tracks[ch].push(cleanK(ch, { t: k.t, v: k[ch], ease: k.ease }));
  }
  for (const ch of ALL) { sortTrack(cam.tracks[ch], ch); cam.tracks[ch] = cam.tracks[ch].filter((k, j, L) => !j || k.t - L[j - 1].t > 0); }
  return cam;
}
/** Lit un projet enregistré (versions 1 à 3) : { rate, cams }. Tout ce qui est illisible est écarté, jamais d'exception. */
export function loadProject(pj) {
  if (!pj || typeof pj !== 'object') return { rate: 1, cams: [] };
  const rate = clamp(num(pj.rate, 1), 0.05, 8);
  if (Array.isArray(pj.cams)) { const ids = new Set(); return { rate, cams: pj.cams.filter(c => c && typeof c === 'object').map(cleanCam).filter(c => !ids.has(c.id) && ids.add(c.id)) }; }
  if (Array.isArray(pj.keys) && pj.keys.length) return { rate, cams: [cleanCam({ id: 'c1', name: 'Caméra 1', keys: pj.keys }, 0)] };   // (version 1)
  return { rate, cams: [] };
}
export const saveProject = (record, rate, cams) => JSON.stringify({ v: PROJECT_VERSION, record, rate, cams });

// ---------------------------------------------------------------- Images-clés
/** Indice de la clé d'une piste à l'instant t (à TOL près), ou −1. */
export const keyAt = (L, t, tol = TOL) => L.findIndex(k => Math.abs(k.t - t) <= tol);
/** La caméra a-t-elle une clé à cet instant ? ch : un paramètre, ou null = n'importe lequel. */
export const hasKey = (cam, ch, t) => (ch ? keyAt(cam.tracks[ch], t) >= 0 : ALL.some(c => keyAt(cam.tracks[c], t) >= 0));
/** Tous les instants où la caméra a au moins une clé (ligne résumé), triés. */
export function keyTimes(cam, chans = ALL) {
  const S = new Set(); for (const ch of chans) for (const k of cam.tracks[ch]) S.add(k.t);
  return [...S].sort((a, b) => a - b);
}
/** Pose (ou remplace) la clé d'un paramètre à l'instant t. */
export function setKey(cam, ch, t, v, ease = null) {
  const L = cam.tracks[ch], i = keyAt(L, t);
  if (i >= 0) { L[i].v = lim(ch, num(v, L[i].v)); if (ease && EASE[ease]) L[i].ease = ease; }
  else { const prev = L.filter(k => k.t < t).pop(); L.push(cleanK(ch, { t, v, ease: ease || (prev && prev.ease !== 'fixe' ? prev.ease : 'fluide') })); }
  sortTrack(L, ch);
}
/** Supprime les clés de l'instant t — d'un paramètre, ou de tous (ch = null). Rend le nombre de clés retirées. */
export function delAt(cam, ch, t) {
  let n = 0;
  for (const c of ch ? [ch] : ALL) { const L = cam.tracks[c]; for (let i = L.length - 1; i >= 0; i--) if (Math.abs(L[i].t - t) <= TOL) { L.splice(i, 1); n++; } sortTrack(L, c); }
  return n;
}
/** Déplace dans le temps les clés de l'instant t0 — d'un paramètre, ou de tous (ch = null) ; une clé déjà à l'arrivée est remplacée. */
export function moveAt(cam, ch, t0, t1) {
  t1 = Math.max(0, Math.round(t1)); if (t1 === t0) return;
  for (const c of ch ? [ch] : ALL) {
    const L = cam.tracks[c], mv = L.filter(k => k.t === t0); if (!mv.length) continue;
    cam.tracks[c] = sortTrack(L.filter(k => k.t === t0 || k.t !== t1).map(k => (k.t === t0 ? { ...k, t: t1 } : k)), c);
  }
}
/** Change l'easing des clés de l'instant t (d'un paramètre, ou de tous). */
export function easeAt(cam, ch, t, ease) { if (EASE[ease]) for (const c of ch ? [ch] : ALL) for (const k of cam.tracks[c]) if (Math.abs(k.t - t) <= TOL) k.ease = ease; }
export function easeOf(cam, ch, t) { for (const c of ch ? [ch] : ALL) { const k = cam.tracks[c][keyAt(cam.tracks[c], t)]; if (k) return k.ease; } return 'fluide'; }

/** La valeur d'une piste à l'instant t : courbe lisse passant par ses clés (tangentes de Catmull-Rom selon les durées). */
export function valAt(L, t, def = 0) {
  const n = L.length; if (!n) return def;
  if (t <= L[0].t) return L[0].v; if (t >= L[n - 1].t) return L[n - 1].v;
  let i = 0; while (i + 1 < n && L[i + 1].t <= t) i++;
  const a = L[i], b = L[i + 1]; if (a.ease === 'fixe' || b.t - a.t < 1) return a.v;
  const D = b.t - a.t, u = (EASE[a.ease] || EASE.fluide)((t - a.t) / D);
  const p = i > 0 && L[i - 1].ease !== 'fixe' ? L[i - 1] : null, q = i + 2 < n && b.ease !== 'fixe' ? L[i + 2] : null;
  const ma = p ? (b.v - p.v) / (b.t - p.t) * D : b.v - a.v, mb = q ? (q.v - a.v) / (q.t - a.t) * D : b.v - a.v;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * ma + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * mb;
}
/** La pose (locale) d'une caméra à l'instant t, chaque paramètre suivant sa propre piste ; null tant qu'elle n'a pas de position. */
export function poseAt(cam, t) {
  const T = cam.tracks; if (!T.x.length && !T.y.length && !T.z.length) return null;
  const o = {}; for (const ch of CH) o[ch] = lim(ch, valAt(T[ch], t, DEF[ch] || 0));
  return o;
}
/** Le filtre d'une caméra à l'instant t : { filter, vignette, grain, dof } (piste si elle a des clés, sinon la valeur fixe). */
export function fxAt(cam, t) {
  const o = { filter: cam.filter }; for (const ch of FX_CH) o[ch] = cam.tracks[ch].length ? clamp(valAt(cam.tracks[ch], t), 0, 1) : cam[ch];
  return o;
}
/** Première et dernière clé de pose d'une caméra, ou null. */
export function span(cam) { const K = keyTimes(cam, CH); return K.length ? [K[0], K[K.length - 1]] : null; }

// ---------------------------------------------------------------- Parent
// Repère d'un parent : { x, y, z, yaw } (yaw : même convention que la caméra — regard vers (cos, sin) dans le plan x, z)
/** Local → monde. P : repère du parent à cet instant (ou null), follow : le décalage tourne avec le parent. */
export function toWorld(L, P, follow) {
  if (!P) return { ...L };
  if (!follow) return { ...L, x: P.x + L.x, y: P.y + L.y, z: P.z + L.z };
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);   // (x local : vers l'avant du parent ; z local : vers sa droite)
  return { ...L, x: P.x + L.x * c - L.z * s, y: P.y + L.y, z: P.z + L.x * s + L.z * c, yaw: L.yaw + P.yaw };
}
/** Monde → local (l'inverse exact de toWorld). */
export function toLocal(Wd, P, follow) {
  if (!P) return { ...Wd };
  const dx = Wd.x - P.x, dz = Wd.z - P.z;
  if (!follow) return { ...Wd, x: dx, y: Wd.y - P.y, z: dz };
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  return { ...Wd, x: dx * c + dz * s, y: Wd.y - P.y, z: -dx * s + dz * c, yaw: Wd.yaw - P.yaw };
}
/** Tourne le regard vers une cible (lacet et tangage), sans toucher au reste. */
export function lookAt(Wd, T) {
  const dx = T.x - Wd.x, dy = T.y - Wd.y, dz = T.z - Wd.z, h = Math.hypot(dx, dz);
  if (h + Math.abs(dy) < 1e-4) return Wd;
  return { ...Wd, yaw: Math.atan2(dz, dx), pitch: clamp(Math.atan2(dy, h), -1.55, 1.55) };
}
/** Le repère du parent d'une caméra à l'instant t (null : pas de parent, ou parent absent). */
export function parentFrame(cam, t, cams, frame, depth = 0) {
  if (!cam.parent) return null;
  if (cam.parent.kind !== 'camera') return frame(cam.parent, t);
  const o = depth < 8 && cams.find(c => c.id === cam.parent.id && c !== cam), w = o && worldPose(o, t, cams, frame, depth + 1);
  return w ? { x: w.x, y: w.y, z: w.z, yaw: w.yaw } : null;
}
/**
 * La pose d'une caméra dans le monde à l'instant t. frame(parent, t) rend le repère d'un personnage ou d'un véhicule
 * (ou null s'il n'est pas là) ; une caméra parente est résolue de proche en proche (sans boucle).
 * Rend { x, y, z, yaw, pitch, roll, fov, P (repère du parent ou null), lost (parent introuvable à cet instant) }.
 */
export function worldPose(cam, t, cams, frame, depth = 0) {
  const L = poseAt(cam, t); if (!L) return null;
  const P = parentFrame(cam, t, cams, frame, depth), lost = !!cam.parent && !P;
  let Wd = toWorld(L, P, cam.follow);
  if (P && cam.look) Wd = lookAt(Wd, { x: P.x, y: P.y + (cam.parent.kind === 'perso' ? 1.35 : cam.parent.kind === 'vehicule' ? 0.9 : 0), z: P.z });
  return { x: Wd.x, y: Wd.y, z: Wd.z, yaw: Wd.yaw, pitch: Wd.pitch, roll: Wd.roll, fov: Wd.fov, P, lost };
}
/**
 * Changer le parent (ou « tourner avec ») sans que la caméra bouge : change() modifie la caméra ; chaque clé de position et de
 * lacet est recalculée dans le nouveau repère, à son instant.
 */
export function rebase(cam, cams, frame, change) {
  const W = {};
  for (const ch of ['x', 'y', 'z', 'yaw']) W[ch] = cam.tracks[ch].map(k => { const L = poseAt(cam, k.t); return L ? toWorld(L, parentFrame(cam, k.t, cams, frame), cam.follow) : null; });
  change();
  for (const ch of ['x', 'y', 'z', 'yaw']) { cam.tracks[ch].forEach((k, i) => { if (W[ch][i]) k.v = toLocal(W[ch][i], parentFrame(cam, k.t, cams, frame), cam.follow)[ch]; }); sortTrack(cam.tracks[ch], ch); }
}
/** Une caméra en parent d'une autre ferait-elle une boucle ? */
export function wouldLoop(cam, parentId, cams) {
  for (let c = cams.find(x => x.id === parentId), n = 0; c && n < 20; n++) { if (c === cam) return true; c = c.parent?.kind === 'camera' ? cams.find(x => x.id === c.parent.id) : null; }
  return false;
}

// ---------------------------------------------------------------- Cinématique
/**
 * La caméra à l'antenne à l'instant t : parmi les caméras actives, celle dont les clés encadrent t (la dernière commencée
 * si plusieurs) ; entre deux, la dernière terminée reste à l'image ; avant la première clé, la première à venir.
 */
export function activeCam(cams, t) {
  let inside = null, before = null, next = null, ia = 0, ba = 0, na = 0;
  for (const c of cams) {
    const S = c.on && span(c); if (!S) continue; const [a, b] = S;
    if (t >= a && t <= b && (!inside || a >= ia)) { inside = c; ia = a; }
    if (b < t && (!before || b >= ba)) { before = c; ba = b; }
    if (a > t && (!next || a < na)) { next = c; na = a; }
  }
  return inside || before || next;
}
/** Début et fin de la cinématique : de la première à la dernière clé des caméras actives (null s'il n'y a pas de quoi). */
export function cineRange(cams) {
  let a = Infinity, b = -Infinity;
  for (const c of cams) { const S = c.on && span(c); if (S) { a = Math.min(a, S[0]); b = Math.max(b, S[1]); } }
  return b > a ? [a, b] : null;
}

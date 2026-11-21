// Big Street Studio — les éléments animés d'un projet, façon Mine-Imator (format « .bsproj », clé « anim », version 1).
//
//   anim: { v: 1, seq, auto (clé automatique à chaque déplacement), loop: { on, a, b } (boucle de lecture, ms),
//     marks: [{ t, name, color }] (marqueurs de la frise),
//     objs: [ {
//       id, kind, name, color, open (piste dépliée), parent (id d'un autre élément, ou null), bone (os du parent où il est tenu, ou ''),
//       kind 'ref'     : une entité DU RECORD qu'on anime — ref: 'u:3' | 'v:7' | 'i:120' (personnage, véhicule, objet du décor)
//       kind 'perso'   : un personnage AJOUTÉ (PNJ ou faux joueur) — uid (son numéro dans la scène), npc, title, look, walk, face
//       kind 'modele'  : un modèle du jeu ajouté — model (type de meuble, de véhicule ou d'objet)
//       kind 'lumiere' : ltype ('point' | 'spot' | 'dir'), shadow, penumbra
//       kind 'miroir'  : w, h (m), tint (#rrggbb), q (qualité : côté de la texture en pixels)
//       kind 'texte'   : text, tcolor, size (m), face (toujours tourné vers la caméra)
//       kind 'groupe'  : un repère vide, parent d'autres éléments
//       kind 'particules' : ptype (fumee | feu | etincelles | pluie | neige | confettis), count, pcolor, psize, spread (m)
//       st: { canal: valeur fixe }   — la valeur d'un canal qui n'a pas de clé
//       tracks: { canal: [{ t (ms), v, ease }] }   — UNE PISTE PAR CANAL, comme les caméras
//       clips: [{ t, id }]   — personnages : animations du jeu (émotes) lancées à un instant ; id '' = arrêt
//     } ] }
//
// Canaux : x, y, z (m) · rx, ry, rz (radians, ordre lacet-tangage-roulis « YXZ » ; ry = cap) · sx, sy, sz (échelle) · vis (1 visible,
// 0 caché) · personnages : « os.axe » (tete.x … jambe_d.z, radians) · lumières : li (intensité), lr (portée), la (angle du cône, radians),
// cr, cg, cb (couleur 0–1). Pour une entité du record (« ref »), un canal sans clé ni valeur fixe n'est PAS surchargé : elle garde ce
// que dit le record (elle peut tomber — y animé — tout en continuant d'avancer).
// Ce module ne touche ni au DOM ni au moteur : il se teste seul (tools/selftest-anim.mjs).
export const ANIM_VERSION = 1;
export const TR = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz', 'vis'];
export const POS = ['x', 'y', 'z'], ROT = ['rx', 'ry', 'rz'], SCL = ['sx', 'sy', 'sz'];
export const BONES = [['tete', 'Tête'], ['corps', 'Buste'], ['bras_d', 'Bras droit'], ['bras_g', 'Bras gauche'], ['jambe_d', 'Jambe droite'], ['jambe_g', 'Jambe gauche']];
export const BONE_CH = BONES.flatMap(([b]) => ['x', 'y', 'z'].map(a => `${b}.${a}`));
export const LIGHT_CH = ['li', 'lr', 'la', 'cr', 'cg', 'cb'];
export const KINDS = { ref: 'Entité du record', perso: 'Personnage', modele: 'Objet', lumiere: 'Lumière', miroir: 'Miroir', texte: 'Texte', groupe: 'Groupe', particules: 'Particules', ambiance: 'Éclairage de la scène', lampe: 'Lumière de la scène', effets: 'Effets de caméra', titre: 'Titre / sous-titre', audio: 'Son' };
export const PTYPES = { fumee: 'Fumée', feu: 'Feu', etincelles: 'Étincelles', pluie: 'Pluie', neige: 'Neige', confettis: 'Confettis' };
export const AMB_CH = ['expo', 'amb', 'sun', 'lamps', 'cr', 'cg', 'cb'], LAMP_CH = ['lm', 'cr', 'cg', 'cb'];
export const FXC_CH = ['shake', 'shakef', 'fade', 'flash', 'speed'];   // (tremblement de la caméra à l'antenne : amplitude 0–1, fréquence en Hz ; fondu au noir et éclair blanc : 0–1)
export const TITLE_CH = ['op', 'tx', 'ty', 'tsz'];   // (titre à l'écran : opacité, décalage en % de l'image, grossissement)
export const TPOS = { bas: 'En bas (sous-titre)', centre: 'Au centre (titre)', haut: 'En haut', bas_gauche: 'En bas à gauche (générique)' };
export const noTR = o => o.kind === 'ambiance' || o.kind === 'lampe' || o.kind === 'effets' || o.kind === 'titre' || o.kind === 'audio';   // (ni position ni rotation : des réglages d'éclairage)
export const ICONS = { ref: '🎞', perso: '🧍', modele: '📦', lumiere: '💡', miroir: '🪞', texte: '🔤', groupe: '📁', particules: '✨', ambiance: '🌗', lampe: '🔆', effets: '🎥', titre: '💬', audio: '🎵' };
export const LTYPES = { point: 'Ponctuelle (ampoule)', spot: 'Projecteur (spot)', dir: 'Directionnelle (soleil)' };
export const POOL = { point: 4, spot: 3, dir: 1 };   // (réserve FIXE de lumières : en ajouter une ne recompile aucun shader)
export const MAX = { objs: 200, miroir: 2, perso: 40, keys: 4000 };
export const LABELS = { x: 'Position X', y: 'Position Y', z: 'Position Z', rx: 'Tangage', ry: 'Cap (lacet)', rz: 'Roulis', sx: 'Échelle X', sy: 'Échelle Y', sz: 'Échelle Z', vis: 'Visible',
  shake: 'Tremblement', shakef: 'Fréquence du tremblement', fade: 'Fondu au noir', flash: 'Éclair blanc', speed: 'Vitesse (ralenti / accéléré)', pmix: 'Mélange de la pose', prog: 'Avancée sur le chemin', vol: 'Volume', op: 'Opacité', tx: 'Décalage X', ty: 'Décalage Y', tsz: 'Grossissement',
  expo: 'Luminosité de la scène', amb: 'Lumière ambiante', sun: 'Lumière principale', lamps: 'Lampes du lieu', lm: 'Intensité (× d’origine)',
  li: 'Intensité', lr: 'Portée', la: 'Angle du cône', cr: 'Rouge', cg: 'Vert', cb: 'Bleu',
  ...Object.fromEntries(BONES.flatMap(([b, n]) => ['x', 'y', 'z'].map(a => [`${b}.${a}`, `${n} ${a.toUpperCase()}`]))) };
export const DEF = { sx: 1, sy: 1, sz: 1, vis: 1, li: 6, lr: 12, la: 0.6, cr: 1, cg: 1, cb: 1, expo: 1, amb: 1, sun: 1, lamps: 1, lm: 1, shake: 0, shakef: 8, fade: 0, flash: 0, speed: 1, op: 1, tx: 0, ty: 0, tsz: 1, vol: 1, pmix: 1, prog: 0 };
const LIM = { vis: [0, 1], sx: [0.01, 100], sy: [0.01, 100], sz: [0.01, 100], li: [0, 200], lr: [0.5, 200], la: [0.03, 1.5], cr: [0, 1], cg: [0, 1], cb: [0, 1], expo: [0, 4], amb: [0, 6], sun: [0, 6], lamps: [0, 8], lm: [0, 10], shake: [0, 1], shakef: [0.5, 40], fade: [0, 1], flash: [0, 1], speed: [0.05, 8], op: [0, 1], tx: [-100, 100], ty: [-100, 100], tsz: [0.05, 20], vol: [0, 2], pmix: [0, 1], prog: [0, 1] };
export const EASES = { fluide: 'lisse (courbe)', lineaire: 'linéaire', doux: 'départ et arrivée en douceur', accel: 'accélère', frein: 'ralentit', rebond: 'rebond (chute)', elastique: 'élastique', depasse: 'dépasse puis revient', fixe: 'constant (saut)' };
const bounce = u => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75; if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375; return n * (u -= 2.625 / d) * u + 0.984375; };
export const EASE = { fluide: u => u, lineaire: u => u, doux: u => u * u * (3 - 2 * u), accel: u => u * u, frein: u => 1 - (1 - u) * (1 - u), rebond: bounce,
  elastique: u => (u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * (2 * Math.PI) / 3) + 1), depasse: u => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2), fixe: () => 0 };
const DIRECT = new Set(['lineaire', 'rebond', 'elastique', 'depasse']);   // (ces courbes vont droit d'une clé à l'autre, sans tangentes)
export const COLORS = ['#3dd6d0', '#ffd23d', '#ff5b8a', '#b07cff', '#3ddc84', '#4f8cff', '#ff8a3d', '#ff6b4a'];
const TOL = 45;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
const lim = (ch, v) => (LIM[ch] ? clamp(v, LIM[ch][0], LIM[ch][1]) : v);
const def = ch => DEF[ch] ?? 0;
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
export const isChar = o => o.kind === 'perso' || (o.kind === 'ref' && String(o.ref).startsWith('u:'));
/** Les canaux d'un élément */
export const CHAR_CH = ['pmix'];   // (personnages : mélange 0–1 entre l'animation du jeu et la pose posée)
export function channelsOf(o) { if (o.kind === 'effets') return FXC_CH; if (o.kind === 'titre') return TITLE_CH; if (o.kind === 'audio') return ['vol']; if (o.kind === 'ambiance') return AMB_CH; if (o.kind === 'lampe') return LAMP_CH; return [...TR, ...(o.path ? ['prog'] : []), ...(isChar(o) ? [...BONE_CH, ...CHAR_CH] : []), ...(o.kind === 'lumiere' ? LIGHT_CH : [])]; }
export const entKey = o => (o.kind === 'ref' ? o.ref : o.kind === 'perso' ? `u:${o.uid}` : null);
export const UID0 = 9000000;   // (numéros des personnages ajoutés : loin de ceux du record)

// ---------------------------------------------------------------- Pistes (valables pour tout ce qui a « tracks » : éléments, caméras)
// Poignées de tangente (Bézier), par clé : hm = 'aligne' (les deux poignées restent alignées) ou 'libre' ; li = [dt ≤ 0 (ms), dv] vers la
// clé d'avant, ro = [dt ≥ 0, dv] vers la suivante. Sans hm : « auto » — la courbe choisie (ease) fait le segment.
export const HMODES = { auto: 'Automatique (courbe choisie)', aligne: 'Poignées alignées', libre: 'Poignées libres' };
export function cleanHandles(k) { if (k.hm !== 'aligne' && k.hm !== 'libre') return {}; const h = a => (Array.isArray(a) && Number.isFinite(+a[0]) && Number.isFinite(+a[1]) ? [+a[0], +a[1]] : null), li = h(k.li), ro = h(k.ro); if (!li && !ro) return {}; return { hm: k.hm, ...(li ? { li: [Math.min(0, li[0]), li[1]] } : {}), ...(ro ? { ro: [Math.max(0, ro[0]), ro[1]] } : {}) }; }
/** Valeur à l'instant t du segment a → b tracé par ses poignées (courbe de Bézier cubique dans le plan temps / valeur) */
export function bezAt(a, b, t) {
  const D = b.t - a.t, o = a.ro || [D / 3, (b.v - a.v) / 3], i = b.li || [-D / 3, -(b.v - a.v) / 3];
  const x1 = Math.min(D, Math.max(0, o[0])), x2 = D + Math.max(-D, Math.min(0, i[0])), X = u => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u * D;
  let lo = 0, hi = 1; const want = t - a.t; for (let n = 0; n < 24; n++) { const m = (lo + hi) / 2; if (X(m) < want) lo = m; else hi = m; } const u = (lo + hi) / 2, w = 1 - u;
  return w * w * w * a.v + 3 * w * w * u * (a.v + o[1]) + 3 * w * u * u * (b.v + i[1]) + u * u * u * b.v;
}
const cleanK = (ch, k) => ({ t: Math.max(0, Math.round(num(k.t))), v: ch === 'vis' ? (num(k.v, 1) >= 0.5 ? 1 : 0) : lim(ch, num(k.v, def(ch))), ease: EASE[k.ease] ? k.ease : ch === 'vis' ? 'fixe' : 'fluide', ...cleanHandles(k) });
export const sortTrack = L => L.sort((a, b) => a.t - b.t);
export const keyAt = (L, t, tol = TOL) => (L ? L.findIndex(k => Math.abs(k.t - t) <= tol) : -1);
export function valAt(L, t, d = 0) {
  const n = L ? L.length : 0; if (!n) return d;
  if (t <= L[0].t) return L[0].v; if (t >= L[n - 1].t) return L[n - 1].v;
  let i = 0; while (i + 1 < n && L[i + 1].t <= t) i++;
  const a = L[i], b = L[i + 1]; if (a.ease === 'fixe' || b.t - a.t < 1) return a.v;
  if (a.ro || b.li) return bezAt(a, b, t);
  const D = b.t - a.t, u0 = (t - a.t) / D;
  if (DIRECT.has(a.ease)) return a.v + (b.v - a.v) * EASE[a.ease](u0);
  const u = (EASE[a.ease] || EASE.fluide)(u0), smooth = k => k && !DIRECT.has(k.ease) && k.ease !== 'fixe';
  const p = i > 0 && smooth(L[i - 1]) ? L[i - 1] : null, q = i + 2 < n && smooth(b) ? L[i + 2] : null;
  const ma = p ? (b.v - p.v) / (b.t - p.t) * D : b.v - a.v, mb = q ? (q.v - a.v) / (q.t - a.t) * D : b.v - a.v, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * ma + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * mb;
}
/** Pose (ou remplace) la clé d'un canal à l'instant t */
export function setKey(o, ch, t, v, ease = null) {
  const L = o.tracks[ch] ||= [], i = keyAt(L, t);
  if (i >= 0) { L[i].v = cleanK(ch, { t, v }).v; if (ease && EASE[ease]) L[i].ease = ease; }
  else { const prev = L.filter(k => k.t < t).pop(); L.push(cleanK(ch, { t, v, ease: ease || (prev ? prev.ease : null) })); }
  sortTrack(L);
}
const chans = (o, ch) => (ch == null ? Object.keys(o.tracks) : Array.isArray(ch) ? ch : [ch]);
export const hasKey = (o, ch, t) => chans(o, ch).some(c => keyAt(o.tracks[c], t) >= 0);
export function keyTimes(o, ch = null) { const S = new Set(); for (const c of chans(o, ch)) for (const k of o.tracks[c] || []) S.add(k.t); return [...S].sort((a, b) => a - b); }
export function delAt(o, ch, t) { let n = 0; for (const c of chans(o, ch)) { const L = o.tracks[c]; if (!L) continue; for (let i = L.length - 1; i >= 0; i--) if (Math.abs(L[i].t - t) <= TOL) { L.splice(i, 1); n++; } if (!L.length) delete o.tracks[c]; } return n; }
export function moveAt(o, ch, t0, t1) {
  t1 = Math.max(0, Math.round(t1)); if (t1 === t0) return;
  for (const c of chans(o, ch)) { const L = o.tracks[c]; if (!L || !L.some(k => k.t === t0)) continue; o.tracks[c] = sortTrack(L.filter(k => k.t === t0 || k.t !== t1).map(k => (k.t === t0 ? { ...k, t: t1 } : k))); }
}
export function easeAt(o, ch, t, ease) { if (EASE[ease]) for (const c of chans(o, ch)) for (const k of o.tracks[c] || []) if (Math.abs(k.t - t) <= TOL) k.ease = ease; }
export function easeOf(o, ch, t) { for (const c of chans(o, ch)) { const L = o.tracks[c], k = L && L[keyAt(L, t)]; if (k) return k.ease; } return 'fluide'; }
export const keyCount = o => Object.values(o.tracks).reduce((n, L) => n + L.length, 0);
export const span = o => { const K = keyTimes(o); return K.length ? [K[0], K[K.length - 1]] : null; };
/** Dernière clé de tout le projet (ms) — la fin naturelle d'un export */
export const lastKey = A => Math.max(0, ...A.objs.map(o => span(o)?.[1] || 0));

// ---- Sélection multiple : des clés désignées par [{ ch, t }] sur un même porteur de pistes (élément ou caméra)
/** Copie des clés : { t0, keys: [{ ch, dt, v, ease }] } (les instants deviennent relatifs à la première) */
export function copyKeys(o, sel) {
  const keys = []; for (const s of sel) for (const c of chans(o, s.ch)) { const k = (o.tracks[c] || [])[keyAt(o.tracks[c], s.t, 0)]; if (k && !keys.some(x => x.ch === c && x.t === k.t)) keys.push({ ch: c, t: k.t, v: k.v, ease: k.ease, ...cleanHandles(k) }); }
  if (!keys.length) return null; const t0 = Math.min(...keys.map(k => k.t));
  return { t0, keys: keys.map(k => ({ ch: k.ch, dt: k.t - t0, v: k.v, ease: k.ease, ...cleanHandles(k) })) };
}
/** Colle des clés copiées à l'instant t (sur les canaux de même nom que porte la cible) ; rend [{ ch, t }] des clés posées */
export function pasteKeys(o, clip, t, dur = Infinity, ok = null) {
  const out = []; if (!clip) return out;
  for (const k of clip.keys) { const tt = Math.round(t + k.dt); if (tt > dur || !(k.ch in o.tracks || (ok && ok.includes(k.ch)))) continue; const L = o.tracks[k.ch] ||= []; const i = keyAt(L, tt, 0); if (i >= 0) L.splice(i, 1); L.push({ t: tt, v: k.v, ease: k.ease, ...cleanHandles(k) }); sortTrack(L); out.push({ ch: k.ch, t: tt }); }
  return out;
}
/** Décale des clés dans le temps (toutes ensemble, sans se croiser : bornées à [0, dur]) ; rend la nouvelle sélection */
export function shiftKeys(o, sel, dt, dur = Infinity) {
  const picked = []; for (const s of sel) for (const c of chans(o, s.ch)) { const k = (o.tracks[c] || [])[keyAt(o.tracks[c], s.t, 0)]; if (k && !picked.some(x => x.k === k)) picked.push({ c, k }); }
  if (!picked.length) return [];
  const lo = Math.min(...picked.map(p => p.k.t)), hi = Math.max(...picked.map(p => p.k.t)); dt = Math.round(clamp(dt, -lo, dur - hi));
  const set = new Set(picked.map(p => p.k));
  for (const { c, k } of picked) { const nt = k.t + dt; o.tracks[c] = o.tracks[c].filter(x => set.has(x) || x.t !== nt); k.t = nt; }
  for (const c of new Set(picked.map(p => p.c))) sortTrack(o.tracks[c]);
  return picked.map(p => ({ ch: p.c, t: p.k.t }));
}
/** Étire ou resserre des clés autour de la première (facteur k) */
export function scaleKeys(o, sel, k, dur = Infinity) {
  const c = copyKeys(o, sel); if (!c) return []; for (const s of sel) delAt(o, s.ch, s.t);
  return pasteKeys(o, { t0: c.t0, keys: c.keys.map(x => ({ ...x, dt: x.dt * Math.max(0.05, k) })) }, c.t0, dur);
}

// ---------------------------------------------------------------- Valeurs
/** La valeur d'un canal à l'instant t : sa piste, sinon sa valeur fixe, sinon null (pas surchargé — entité du record) ou le défaut */
export function chanAt(o, ch, t) {
  const L = o.tracks[ch]; if (L && L.length) return lim(ch, valAt(L, t, def(ch)));
  if (o.st && Number.isFinite(o.st[ch])) return o.st[ch];
  return (o.kind === 'ref' && ch !== 'pmix' && ch !== 'prog') || ch.includes('.') ? null : def(ch);
}
export const isSet = (o, ch) => !!(o.tracks[ch]?.length) || Number.isFinite(o.st?.[ch]);
export const isAnimated = (o, ch) => (o.tracks[ch]?.length || 0) > 1;
/**
 * Donne une valeur à un canal à l'instant t, comme pour les caméras : sans clé → valeur fixe ; une seule clé → c'est elle qui change
 * (l'élément reste fixe) ; piste animée → clé à cet instant. auto (« clé automatique ») ou force : toujours une clé à cet instant.
 */
export function setParam(o, ch, v, t, { auto = false, force = false } = {}) {
  const L = o.tracks[ch] || []; t = Math.round(t); v = cleanK(ch, { t, v }).v;
  if (force || (auto && (L.length || Number.isFinite(o.st?.[ch]) || o.kind !== 'ref'))) { if (!L.length && auto && !force && Number.isFinite(o.st?.[ch]) && Math.abs(o.st[ch] - v) > 1e-9 && t > 0) setKey(o, ch, 0, o.st[ch]); setKey(o, ch, t, v); return 'key'; }
  if (!L.length) { (o.st ||= {})[ch] = v; return 'fixe'; }
  if (L.length === 1 && keyAt(L, t) < 0) { L[0].v = v; return 'fixe'; }
  setKey(o, ch, t, v); return 'key';
}
/** Retire la surcharge d'un canal (clés et valeur fixe) : une entité du record retrouve ce que dit le record */
export function clearChan(o, ch) { delete o.tracks[ch]; if (o.st) delete o.st[ch]; }

// ---------------------------------------------------------------- Repères (matrices 4×4 en colonnes, comme three.js)
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
/** Matrice d'un repère { x, y, z, rx, ry, rz, sx, sy, sz } — rotation « YXZ » : cap, puis tangage, puis roulis */
export function compose(s) {
  const cx = Math.cos(s.rx || 0), sx = Math.sin(s.rx || 0), cy = Math.cos(s.ry || 0), sy = Math.sin(s.ry || 0), cz = Math.cos(s.rz || 0), sz = Math.sin(s.rz || 0);
  const X = s.sx ?? 1, Y = s.sy ?? 1, Z = s.sz ?? 1;
  return [(cy * cz + sy * sx * sz) * X, cx * sz * X, (-sy * cz + cy * sx * sz) * X, 0, (-cy * sz + sy * sx * cz) * Y, cx * cz * Y, (sy * sz + cy * sx * cz) * Y, 0, sy * cx * Z, -sx * Z, cy * cx * Z, 0, s.x || 0, s.y || 0, s.z || 0, 1];
}
/** L'inverse : { x, y, z, rx, ry, rz, sx, sy, sz } d'une matrice (near : angles voisins, pour ne pas sauter d'un tour) */
export function decompose(m, near = null) {
  const X = Math.hypot(m[0], m[1], m[2]) || 1e-9, Y = Math.hypot(m[4], m[5], m[6]) || 1e-9, Z = Math.hypot(m[8], m[9], m[10]) || 1e-9;
  const m23 = m[9] / Z, rx = Math.asin(-clamp(m23, -1, 1)); let ry, rz;
  if (Math.abs(m23) < 0.9999999) { ry = Math.atan2(m[8] / Z, m[10] / Z); rz = Math.atan2(m[1] / X, m[5] / Y); } else { ry = Math.atan2(-m[2] / X, m[0] / X); rz = 0; }
  const o = { x: m[12], y: m[13], z: m[14], rx, ry, rz, sx: X, sy: Y, sz: Z };
  if (near) for (const k of ROT) if (Number.isFinite(near[k])) o[k] = near[k] + Math.atan2(Math.sin(o[k] - near[k]), Math.cos(o[k] - near[k]));
  return o;
}
export function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!d) return compose({}); d = 1 / d;
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
}
export const matMul = mul;
/**
 * Le repère LOCAL d'un élément à l'instant t : { x … sz, vis }. base(o, t) rend ce que dit le record pour une entité (« ref ») :
 * { x, y, z, ry, … } ou null si elle n'est pas là ; chaque canal non surchargé en vient.
 */
export function localAt(o, t, base = null) {
  const B = o.kind === 'ref' && base ? base(o, t) : null, s = {};
  for (const ch of TR) { const v = chanAt(o, ch, t); s[ch] = v != null ? v : B && Number.isFinite(B[ch]) ? B[ch] : def(ch); }
  s.lost = o.kind === 'ref' && !!base && !B;
  // (contrainte « suivre un chemin » : la position vient du chemin, à l'avancée « prog » — 0 au premier point, 1 au dernier)
  if (o.path && o.path.pts.length >= 2) { const p = pathAt(o.path, chanAt(o, 'prog', t) ?? 0); s.x = p.x; s.y = p.y; s.z = p.z; if (o.path.orient !== false && (Math.abs(p.tx) + Math.abs(p.tz)) > 1e-6) s.ry = Math.atan2(p.tx, p.tz); }
  return s;
}
/**
 * Le repère d'un élément DANS LE MONDE à l'instant t (parents résolus de proche en proche, sans boucle) :
 * { m (matrice), vis (lui et tous ses parents visibles), x, y, z, rx, ry, rz, sx, sy, sz, local, parent (matrice du parent ou null) }
 */
export function worldAt(A, o, t, base = null, depth = 0) {
  const L = localAt(o, t, base), ml = compose(L);
  const p = o.parent && depth < 12 ? A.objs.find(x => x.id === o.parent && x !== o) : null, P = p ? worldAt(A, p, t, base, depth + 1) : null;
  const m = P ? mul(P.m, ml) : ml, w = P ? decompose(m, L) : L;
  return { ...w, m, vis: L.vis >= 0.5 && (!P || P.vis), local: L, parent: P ? P.m : null, lost: L.lost };
}
/** Monde → local : le repère local qui place l'élément à la matrice du monde voulue (near : ses angles actuels) */
export function toLocal(mWorld, mParent, near = null) { return decompose(mParent ? mul(invert(mParent), mWorld) : mWorld, near); }
/** Un élément en parent d'un autre ferait-il une boucle ? */
export function wouldLoop(A, o, parentId) { for (let c = A.objs.find(x => x.id === parentId), n = 0; c && n < 40; n++) { if (c === o) return true; c = c.parent ? A.objs.find(x => x.id === c.parent) : null; } return false; }
/** Les éléments dans l'ordre de l'arbre : [{ o, depth }] (parents avant enfants) */
export function tree(A) {
  const out = [], seen = new Set(), walk = (o, d) => { if (seen.has(o)) return; seen.add(o); out.push({ o, depth: d }); for (const c of A.objs) if (c.parent === o.id) walk(c, d + 1); };
  for (const o of A.objs) if (!o.parent || !A.objs.some(x => x.id === o.parent)) walk(o, 0);
  for (const o of A.objs) walk(o, 0);
  return out;
}

// ---------------------------------------------------------------- Personnages : poses et animations du jeu
/** Rotations des os à l'instant t : { 'tete.x': v, … } — seulement les canaux posés */
export function bonesAt(o, t) { const out = {}; for (const ch of BONE_CH) { const v = chanAt(o, ch, t); if (v != null) out[ch] = v; } return out; }
/** L'animation du jeu (émote) en cours à l'instant t : { id, at (ms depuis son lancement) } ou null */
export function clipAt(o, t) { let c = null; for (const k of o.clips || []) if (k.t <= t) c = k; return c && c.id ? { id: c.id, at: t - c.t, t: c.t } : null; }
export function setClip(o, t, id) { t = Math.max(0, Math.round(t)); o.clips = (o.clips || []).filter(k => Math.abs(k.t - t) > TOL); o.clips.push({ t, id: String(id || '').slice(0, 30) }); o.clips.sort((a, b) => a.t - b.t); }
export function delClip(o, t) { const n = (o.clips || []).length; o.clips = (o.clips || []).filter(k => Math.abs(k.t - t) > TOL); return n - o.clips.length; }
const D = Math.PI / 180, P = (label, b) => ({ label, bones: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map(x => x * D)])) });
// (degrés ; bras : x négatif = levé vers l'avant, z positif à droite / négatif à gauche = écarté du corps ; jambes : x négatif = vers l'avant)
export const POSES = {
  repos: P('Debout, bras le long du corps', {}),
  saluer: P('Saluer de la main', { bras_d: [0, 0, 155], tete: [0, 0, 6] }),
  pointer: P('Pointer du doigt devant', { bras_d: [-88, 0, 0], tete: [-4, 0, 0] }),
  pointer_haut: P('Pointer vers le ciel', { bras_d: [-150, 0, 10], tete: [-28, 0, 0] }),
  bras_en_l_air: P('Les deux bras en l’air', { bras_d: [0, 0, 165], bras_g: [0, 0, -165], tete: [-10, 0, 0] }),
  t: P('En croix (pose en T)', { bras_d: [0, 0, 90], bras_g: [0, 0, -90] }),
  bras_croises: P('Bras croisés', { bras_d: [-58, 0, -46], bras_g: [-58, 0, 46], tete: [3, 0, 0] }),
  mains_hanches: P('Mains sur les hanches', { bras_d: [12, 0, 38], bras_g: [12, 0, -38] }),
  bras_tendus: P('Bras tendus devant (somnambule)', { bras_d: [-90, 0, 0], bras_g: [-90, 0, 0] }),
  penser: P('Pensif, main au menton', { bras_d: [-128, 0, -18], bras_g: [-30, 0, 14], tete: [14, -10, 0] }),
  assis: P('Assis', { jambe_d: [-90, 0, 0], jambe_g: [-90, 0, 0], bras_d: [-20, 0, 0], bras_g: [-20, 0, 0] }),
  assis_sol: P('Assis par terre, jambes écartées', { jambe_d: [-90, -18, 0], jambe_g: [-90, 18, 0], bras_d: [22, 0, 14], bras_g: [22, 0, -14], corps: [-8, 0, 0] }),
  marche_1: P('Marche — pied droit devant', { jambe_d: [-36, 0, 0], jambe_g: [36, 0, 0], bras_d: [32, 0, 0], bras_g: [-32, 0, 0] }),
  marche_2: P('Marche — pied gauche devant', { jambe_d: [36, 0, 0], jambe_g: [-36, 0, 0], bras_d: [-32, 0, 0], bras_g: [32, 0, 0] }),
  course_1: P('Course — pied droit devant', { jambe_d: [-62, 0, 0], jambe_g: [52, 0, 0], bras_d: [38, 0, 0], bras_g: [-90, 0, 0], corps: [14, 0, 0], tete: [-12, 0, 0] }),
  course_2: P('Course — pied gauche devant', { jambe_d: [52, 0, 0], jambe_g: [-62, 0, 0], bras_d: [-90, 0, 0], bras_g: [38, 0, 0], corps: [14, 0, 0], tete: [-12, 0, 0] }),
  saut: P('Saut, bras levés', { bras_d: [-160, 0, 12], bras_g: [-160, 0, -12], jambe_d: [-40, 0, 0], jambe_g: [18, 0, 0], tete: [-8, 0, 0] }),
  chute: P('Chute, bras et jambes en étoile', { bras_d: [-30, 0, 130], bras_g: [-30, 0, -130], jambe_d: [-14, 0, 24], jambe_g: [-14, 0, -24], tete: [-20, 0, 0] }),
  victoire: P('Victoire, poing levé', { bras_d: [-170, 0, 6], bras_g: [10, 0, -30], tete: [-10, 0, 0] }),
  peur: P('Peur, mains devant le visage', { bras_d: [-120, 0, -24], bras_g: [-120, 0, 24], corps: [-10, 0, 0], tete: [8, 0, 0] }),
  triste: P('Triste, tête basse', { tete: [32, 0, 0], corps: [10, 0, 0], bras_d: [6, 0, 0], bras_g: [6, 0, 0] }),
  regard_gauche: P('Regarde à gauche', { tete: [0, 55, 0] }),
  regard_droite: P('Regarde à droite', { tete: [0, -55, 0] }),
  regard_haut: P('Regarde en l’air', { tete: [-38, 0, 0] }),
  coup_de_pied: P('Coup de pied', { jambe_d: [-95, 0, 0], jambe_g: [10, 0, 0], bras_d: [30, 0, 20], bras_g: [-50, 0, -20], corps: [-12, 0, 0] }),
  coup_de_poing: P('Coup de poing', { bras_d: [-92, 0, -8], bras_g: [-40, 0, -16], corps: [6, -22, 0], jambe_g: [-18, 0, 0], jambe_d: [14, 0, 0] }),
  porter: P('Porte quelque chose à deux mains', { bras_d: [-62, 0, -10], bras_g: [-62, 0, 10] }),
  dab: P('Dab', { bras_d: [-100, 0, 62], bras_g: [-120, 0, 38], tete: [26, 30, 0] }),
};
/** Applique une pose de la bibliothèque à l'instant t : clés (key = true) ou valeurs fixes sur les 18 canaux d'os ; rend le nombre de canaux écrits */
export function applyPose(o, name, t, key = true, ease = null) {
  const p = POSES[name]; if (!p) return 0; let n = 0;
  for (const [b] of BONES) { const r = p.bones[b] || [0, 0, 0]; ['x', 'y', 'z'].forEach((a, i) => { const ch = `${b}.${a}`; if (key) setKey(o, ch, t, r[i], ease); else setParam(o, ch, r[i], t); n++; }); }
  return n;
}
/** Retire toute pose des os (le personnage retrouve ses animations du jeu) */
export function clearPose(o) { for (const ch of BONE_CH) clearChan(o, ch); }

// ---------------------------------------------------------------- Création, lecture d'un projet
export const emptyAnim = () => ({ v: ANIM_VERSION, seq: 1, auto: false, loop: { on: false, a: 0, b: 0 }, marks: [], focus: {}, objs: [] });   // (focus : { id de caméra: { key (entité « u:3 » ou élément « o:<id> »), name } } — mise au point du flou de profondeur)
const uniq = (A, base) => { let name = base; for (let i = 2; A.objs.some(o => o.name === name); i++) name = `${base} ${i}`; return name; };
/** Un élément neuf, ajouté au projet. props : ses réglages ; pose : { x, y, z, ry… } de départ (valeurs fixes) */
export function newObj(A, kind, props = {}, pose = {}) {
  if (!KINDS[kind] || A.objs.length >= MAX.objs) return null;
  const n = A.seq++, o = { id: `o${n.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, kind, name: '', color: COLORS[n % COLORS.length], open: false, parent: null, bone: '', st: {}, tracks: {} };
  if (kind === 'ref') { o.ref = String(props.ref); o.name = String(props.name || props.ref).slice(0, 60); }
  else {
    const base = { perso: props.npc === false ? 'Joueur' : 'PNJ', modele: props.label || props.model || 'Objet', lumiere: { point: 'Lumière', spot: 'Projecteur', dir: 'Soleil' }[props.ltype] || 'Lumière', miroir: 'Miroir', texte: 'Texte', groupe: 'Groupe', particules: PTYPES[props.ptype] || 'Particules' }[kind];
    o.name = uniq(A, String(props.name || base).slice(0, 60));
    if (noTR({ kind })) { o.name = kind === 'ambiance' ? 'Éclairage de la scène' : kind === 'effets' ? 'Effets de caméra' : kind === 'audio' ? uniq(A, String(props.name || 'Son').slice(0, 40)) : kind === 'titre' ? uniq(A, String(props.name || String(props.text || 'Titre').split('\n')[0]).slice(0, 30) || 'Titre') : uniq(A, String(props.name || 'Lampe').slice(0, 60)); for (const ch of channelsOf({ kind })) o.st[ch] = def(ch); }
    else for (const ch of TR) o.st[ch] = Number.isFinite(pose[ch]) ? pose[ch] : def(ch);
  }
  if (kind === 'ambiance' || kind === 'effets') { const old = A.objs.find(x => x.kind === kind); if (old) return old; }
  if (kind === 'effets') { o.cutfade = 0; o.holds = []; }
  if (kind === 'audio') { o.hash = String(props.hash || ''); o.file = String(props.file || '').slice(0, 120); o.dur = Math.max(0, Math.round(num(props.dur, 0))); o.t0 = Math.max(0, Math.round(num(props.t0, 0))); o.off = Math.max(0, Math.round(num(props.off, 0))); }
  if (kind === 'titre') { o.text = String(props.text || 'Titre').slice(0, 300); o.tcolor = isHex(props.color) ? props.color : '#ffffff'; o.size = clamp(num(props.size, props.pos === 'centre' ? 9 : 4.5), 1, 40); o.pos = TPOS[props.pos] ? props.pos : 'bas'; o.t0 = Math.max(0, Math.round(num(props.t0, 0))); o.t1 = Math.max(0, Math.round(num(props.t1, 0))); o.fadeMs = Math.round(clamp(num(props.fade, 300), 0, 10000)); o.box = !!props.box; }
  if (kind === 'lampe') { o.lkey = String(props.lkey); const old = A.objs.find(x => x.kind === 'lampe' && x.lkey === o.lkey); if (old) return old; }
  if (kind === 'perso') { o.uid = UID0 + n; o.npc = props.npc !== false; o.title = String(props.title || '').slice(0, 40); o.look = props.look && typeof props.look === 'object' ? { ...props.look } : {}; o.walk = props.walk !== false; o.face = props.face !== false; o.clips = []; }
  if (kind === 'modele') o.model = String(props.model || 'chaise');
  if (kind === 'lumiere') { o.ltype = LTYPES[props.ltype] ? props.ltype : 'point'; o.shadow = false; o.penumbra = 0.4; const c = hexRgb(props.color || '#fff1d6'); Object.assign(o.st, { li: num(props.intensity, o.ltype === 'dir' ? 1.5 : o.ltype === 'spot' ? 14 : 6), lr: num(props.range, o.ltype === 'spot' ? 18 : 12), la: num(props.angle, 0.6), cr: c[0], cg: c[1], cb: c[2] }); }
  if (kind === 'miroir') { o.w = clamp(num(props.w, 2), 0.2, 30); o.h = clamp(num(props.h, 2.4), 0.2, 30); o.tint = isHex(props.tint) ? props.tint : '#ffffff'; o.q = [256, 512, 1024, 2048].includes(+props.q) ? +props.q : 512; }
  if (kind === 'texte') { o.text = String(props.text || 'Titre').slice(0, 200); o.tcolor = isHex(props.color) ? props.color : '#ffffff'; o.size = clamp(num(props.size, 1), 0.1, 30); o.face = !!props.face; }
  if (kind === 'particules') { o.ptype = PTYPES[props.ptype] ? props.ptype : 'fumee'; o.count = Math.round(clamp(num(props.count, 150), 10, 1500)); o.pcolor = isHex(props.color) ? props.color : ''; o.psize = clamp(num(props.size, 1), 0.1, 10); o.spread = clamp(num(props.spread, o.ptype === 'pluie' || o.ptype === 'neige' || o.ptype === 'confettis' ? 8 : 1), 0.05, 100); }
  if (kind === 'ref' && String(o.ref).startsWith('u:')) o.clips = [];
  A.objs.push(o); return o;
}
export const hexRgb = h => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
export const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
/** Retire un élément : ses enfants sont détachés là où ils sont (keep(o) recalcule leur repère) ; rend ceux qui ont été détachés */
export function removeObj(A, o, rebaseChild = null) {
  const kids = A.objs.filter(c => c.parent === o.id);
  for (const c of kids) { if (rebaseChild) rebaseChild(c, () => { c.parent = null; c.bone = ''; }); else { c.parent = null; c.bone = ''; } }
  A.objs = A.objs.filter(x => x !== o); return kids;
}
/** Copie d'un élément (avec toutes ses clés), décalée d'un mètre */
export function dupObj(A, o) {
  if (o.kind === 'ref' || noTR(o) || A.objs.length >= MAX.objs) return null;
  const n = A.seq++, c = JSON.parse(JSON.stringify(o)); c.id = `o${n.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; c.name = uniq(A, o.name.replace(/ \d+$/, ''));
  if (c.kind === 'perso') c.uid = UID0 + n;
  if (Number.isFinite(c.st.x)) c.st.x += 1; for (const k of c.tracks.x || []) k.v += 1;
  A.objs.push(c); return c;
}
/** Lit la partie « anim » d'un projet : tout l'illisible est écarté, jamais d'exception. Un projet sans « anim » (versions 1 à 4) en reçoit une vide. */
export function cleanAnim(a) {
  const A = emptyAnim(); if (!a || typeof a !== 'object') return A;
  A.seq = Math.max(1, Math.floor(num(a.seq, 1))); A.auto = !!a.auto;
  if (a.loop && typeof a.loop === 'object') A.loop = { on: !!a.loop.on, a: Math.max(0, Math.round(num(a.loop.a))), b: Math.max(0, Math.round(num(a.loop.b))) };
  if (Array.isArray(a.marks)) A.marks = a.marks.filter(m => m && Number.isFinite(+m.t)).slice(0, 200).map(m => ({ t: Math.max(0, Math.round(+m.t)), name: String(m.name || '').slice(0, 40), color: isHex(m.color) ? m.color : '#ffd23d' })).sort((x, y) => x.t - y.t);
  if (a.focus && typeof a.focus === 'object') for (const [k, f] of Object.entries(a.focus).slice(0, 100)) if (/^[A-Za-z0-9_-]{1,40}$/.test(k) && f && typeof f.key === 'string' && /^[uvio]:[A-Za-z0-9_.:-]{1,40}$/.test(f.key)) A.focus[k] = { key: f.key, name: String(f.name || '').slice(0, 60) };
  const ids = new Set(), uids = new Set(), refs = new Set(); let keys = 0;
  for (const r of Array.isArray(a.objs) ? a.objs.slice(0, MAX.objs) : []) {
    if (!r || typeof r !== 'object' || !KINDS[r.kind]) continue;
    const id = String(r.id || ''); if (!/^[A-Za-z0-9_-]{1,24}$/.test(id) || ids.has(id)) continue;
    const o = { id, kind: r.kind, name: String(r.name || KINDS[r.kind]).slice(0, 60), color: isHex(r.color) ? r.color : COLORS[ids.size % COLORS.length], open: !!r.open, parent: typeof r.parent === 'string' ? r.parent : null, bone: BONES.some(b => b[0] === r.bone) ? r.bone : '', st: {}, tracks: {} };
    if (o.kind === 'ref') { if (typeof r.ref !== 'string' || !/^[uvi]:[A-Za-z0-9_.:-]{1,40}$/.test(r.ref) || refs.has(r.ref)) continue; o.ref = r.ref; refs.add(r.ref); }
    if (o.kind === 'perso') { const uid = Math.floor(num(r.uid, 0)); if (uid < UID0 || uids.has(uid)) continue; uids.add(uid); o.uid = uid; o.npc = r.npc !== false; o.title = String(r.title || '').slice(0, 40);
      o.look = {}; if (r.look && typeof r.look === 'object') for (const [k, v] of Object.entries(r.look).slice(0, 40)) if (/^[A-Za-z]{1,16}$/.test(k) && Number.isInteger(v) && v >= 0 && v < 1000) o.look[k] = v;
      o.walk = r.walk !== false; o.face = r.face !== false; }
    if (o.kind === 'modele') { if (typeof r.model !== 'string' || !/^[A-Za-z0-9_:#-]{1,60}$/.test(r.model)) continue; o.model = r.model; }
    if (o.kind === 'lumiere') { o.ltype = LTYPES[r.ltype] ? r.ltype : 'point'; o.shadow = !!r.shadow; o.penumbra = clamp(num(r.penumbra, 0.4), 0, 1); }
    if (o.kind === 'miroir') { o.w = clamp(num(r.w, 2), 0.2, 30); o.h = clamp(num(r.h, 2.4), 0.2, 30); o.tint = isHex(r.tint) ? r.tint : '#ffffff'; o.q = [256, 512, 1024, 2048].includes(+r.q) ? +r.q : 512; }
    if (o.kind === 'texte') { o.text = String(r.text ?? '').slice(0, 200); o.tcolor = isHex(r.tcolor) ? r.tcolor : '#ffffff'; o.size = clamp(num(r.size, 1), 0.1, 30); o.face = !!r.face; }
    if (o.kind === 'particules') { o.ptype = PTYPES[r.ptype] ? r.ptype : 'fumee'; o.count = Math.round(clamp(num(r.count, 150), 10, 1500)); o.pcolor = isHex(r.pcolor) ? r.pcolor : ''; o.psize = clamp(num(r.psize, 1), 0.1, 10); o.spread = clamp(num(r.spread, 1), 0.05, 100); }
    if (r.path && Array.isArray(r.path.pts) && !noTR(o)) { const pts = r.path.pts.filter(q => Array.isArray(q) && q.length >= 3 && q.slice(0, 3).every(Number.isFinite)).slice(0, 200).map(q => [+q[0], +q[1], +q[2]]); if (pts.length >= 2) o.path = { pts, orient: r.path.orient !== false, closed: !!r.path.closed }; }
    if (r.look && typeof r.look === 'object' && ['obj', 'ent', 'cam'].includes(r.look.kind) && typeof r.look.id === 'string' && r.look.id.length < 60 && !noTR(o)) o.look = { kind: r.look.kind, id: r.look.id, name: String(r.look.name || '').slice(0, 60) };
    const CH = channelsOf(o);
    if (r.st && typeof r.st === 'object') for (const ch of CH) if (Number.isFinite(r.st[ch])) o.st[ch] = cleanK(ch, { t: 0, v: r.st[ch] }).v;
    if (o.kind === 'lampe') { if (typeof r.lkey !== 'string' || !/^-?\d+(\.\d)?,-?\d+(\.\d)?,-?\d+(\.\d)?$/.test(r.lkey) || A.objs.some(x => x.lkey === r.lkey)) continue; o.lkey = r.lkey; }
    if ((o.kind === 'ambiance' || o.kind === 'effets') && A.objs.some(x => x.kind === o.kind)) continue;
    if (o.kind === 'effets') { o.cutfade = Math.round(clamp(num(r.cutfade, 0), 0, 5000)); o.holds = (Array.isArray(r.holds) ? r.holds : []).filter(h => h && Number.isFinite(+h.t) && +h.ms > 0).slice(0, 100).map(h => ({ t: Math.max(0, Math.round(+h.t)), ms: Math.round(clamp(+h.ms, 20, 60000)) })).sort((a, b) => a.t - b.t); }
    if (o.kind === 'audio') { if (typeof r.hash !== 'string' || !/^[0-9a-f]{8,64}$/.test(r.hash)) continue; o.hash = r.hash; o.file = String(r.file || '').slice(0, 120); o.dur = Math.max(0, Math.round(num(r.dur, 0))); o.t0 = Math.max(0, Math.round(num(r.t0, 0))); o.off = Math.max(0, Math.round(num(r.off, 0))); }
    if (o.kind === 'titre') { o.text = String(r.text ?? '').slice(0, 300); o.tcolor = isHex(r.tcolor) ? r.tcolor : '#ffffff'; o.size = clamp(num(r.size, 4.5), 1, 40); o.pos = TPOS[r.pos] ? r.pos : 'bas'; o.t0 = Math.max(0, Math.round(num(r.t0, 0))); o.t1 = Math.max(0, Math.round(num(r.t1, 0))); o.fadeMs = Math.round(clamp(num(r.fadeMs, 300), 0, 10000)); o.box = !!r.box; }
    if (noTR(o)) { for (const ch of CH) if (!Number.isFinite(o.st[ch])) o.st[ch] = def(ch); o.parent = null; }
    else if (o.kind !== 'ref') for (const ch of TR) if (!Number.isFinite(o.st[ch])) o.st[ch] = def(ch);
    if (o.kind === 'lumiere') for (const ch of LIGHT_CH) if (!Number.isFinite(o.st[ch])) o.st[ch] = def(ch);
    if (r.tracks && typeof r.tracks === 'object') for (const ch of CH) if (Array.isArray(r.tracks[ch]) && keys < MAX.keys) {
      const L = sortTrack(r.tracks[ch].filter(k => k && Number.isFinite(+k.t) && Number.isFinite(+k.v)).slice(0, 1000).map(k => cleanK(ch, k))).filter((k, j, T) => !j || k.t - T[j - 1].t > 0);
      if (L.length) { o.tracks[ch] = L; keys += L.length; }
    }
    if (isChar(o)) o.clips = (Array.isArray(r.clips) ? r.clips : []).filter(k => k && Number.isFinite(+k.t)).slice(0, 200).map(k => ({ t: Math.max(0, Math.round(+k.t)), id: String(k.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) })).sort((x, y) => x.t - y.t);
    ids.add(id); A.objs.push(o);
  }
  for (const o of A.objs) { if (o.parent && (!ids.has(o.parent) || wouldLoop(A, o, o.parent))) { o.parent = null; o.bone = ''; } if (o.bone) { const p = A.objs.find(x => x.id === o.parent); if (!p || !isChar(p)) o.bone = ''; } }
  for (const o of A.objs) if (o.kind === 'perso') A.seq = Math.max(A.seq, o.uid - UID0 + 1);
  return A;
}
/** Ramène toutes les clés dans la durée du record */
export function clampAnim(A, dur) { for (const o of A.objs) { if (o.kind === 'titre') { o.t0 = clamp(o.t0, 0, Math.round(dur)); o.t1 = clamp(o.t1, 0, Math.round(dur)); } for (const L of Object.values(o.tracks)) for (const k of L) k.t = clamp(k.t, 0, Math.round(dur)); for (const k of o.clips || []) k.t = clamp(k.t, 0, Math.round(dur)); } for (const m of A.marks) m.t = clamp(m.t, 0, Math.round(dur)); A.loop.a = clamp(A.loop.a, 0, dur); A.loop.b = clamp(A.loop.b, 0, dur); return A; }
/** Le projet a-t-il quelque chose à enregistrer ? */
export const hasAnim = A => !!A && (A.objs.length > 0 || A.marks.length > 0 || A.loop.on || Object.keys(A.focus || {}).length > 0);
/** Résumé d'un élément (panneau, assistant) */
export function brief(A, o, t) {
  const w = worldAt(A, o, t), K = keyTimes(o), r = v => Math.round(v * 100) / 100, g = v => Math.round(v * 180 / Math.PI);
  if (noTR(o)) return { id: o.id, type: o.kind, nom: o.name, ...Object.fromEntries(channelsOf(o).map(c => [c, Math.round(chanAt(o, c, t) * 100) / 100])), cles: keyCount(o) };
  return { id: o.id, type: o.kind === 'ref' ? 'entite_du_record' : o.kind, nom: o.name, ...(o.kind === 'ref' ? { entite: o.ref } : {}), ...(o.kind === 'modele' ? { modele: o.model } : {}), ...(o.kind === 'lumiere' ? { lumiere: o.ltype, couleur: rgbHex(chanAt(o, 'cr', t), chanAt(o, 'cg', t), chanAt(o, 'cb', t)), intensite: r(chanAt(o, 'li', t)), portee: r(chanAt(o, 'lr', t)) } : {}),
    ...(o.kind === 'ref' ? {} : { x: r(w.x), y: r(w.y), z: r(w.z), cap: g(w.ry) }), visible: w.vis, ...(o.parent ? { parent: A.objs.find(x => x.id === o.parent)?.name } : {}), cles: keyCount(o), ...(K.length ? { debut: r(K[0] / 1000), fin: r(K[K.length - 1] / 1000) } : {}), canaux_animes: Object.keys(o.tracks).filter(c => o.tracks[c].length > 1) };
}
/** La clé d'une lumière de la scène : sa position arrondie (« 12.5,2.6,7 ») */
export const lightKey = (x, y, z) => [x, y, z].map(v => String(Math.round(v * 2) / 2)).join(',');
/** Les facteurs d'éclairage à l'instant t : { expo, amb, sun, lamps, tint: [r, g, b], lampes: Map(clé → { k, tint }) } ou null si rien n'est réglé */
export function lightingAt(A, t) {
  const a = A.objs.find(o => o.kind === 'ambiance'), L = A.objs.filter(o => o.kind === 'lampe'); if (!a && !L.length) return null;
  const g = (o, c) => chanAt(o, c, t), out = { expo: 1, amb: 1, sun: 1, lamps: 1, tint: [1, 1, 1], lampes: new Map() };
  if (a) Object.assign(out, { expo: g(a, 'expo'), amb: g(a, 'amb'), sun: g(a, 'sun'), lamps: g(a, 'lamps'), tint: [g(a, 'cr'), g(a, 'cg'), g(a, 'cb')] });
  for (const o of L) out.lampes.set(o.lkey, { k: g(o, 'lm'), tint: [g(o, 'cr'), g(o, 'cg'), g(o, 'cb')] });
  return out;
}

// ---------------------------------------------------------------- Particules : entièrement calculées d'après l'instant (aucune mémoire)
// (revenir en arrière, mettre en pause ou exporter image par image donne toujours la même image)
const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
export const PSPEC = { fumee: { life: 3.2, color: '#b9b9b9', size: 0.5, add: false }, feu: { life: 0.9, color: '#ff8a2a', size: 0.2, add: true }, etincelles: { life: 0.9, color: '#ffd27a', size: 0.09, add: true },
  pluie: { life: 0.75, color: '#a9c8ff', size: 0.07, add: false }, neige: { life: 6, color: '#ffffff', size: 0.1, add: false }, confettis: { life: 4.5, color: '', size: 0.07, add: false } };
const CONF = [[1, 0.25, 0.4], [1, 0.82, 0.24], [0.24, 0.86, 0.52], [0.31, 0.55, 1], [0.69, 0.49, 1], [1, 0.54, 0.24]];
/**
 * Remplit pos (x, y, z par particule, repère local de l'émetteur) et col (r, g, b, a) à l'instant t (ms). o : l'élément « particules ».
 * Rend le nombre de particules écrites.
 */
export function particlesAt(o, t, pos, col) {
  const S = PSPEC[o.ptype] || PSPEC.fumee, n = Math.min(o.count, pos.length / 3), T = t / 1000, sp = o.spread, base = hexRgb(o.pcolor || S.color || '#ffffff');
  for (let i = 0; i < n; i++) {
    const a = rnd(i, 1), b = rnd(i, 2), c = rnd(i, 3), d = rnd(i, 4), life = S.life * (0.7 + 0.6 * d), ph = ((T + a * life) % life + life) % life, u = ph / life, ang = b * Math.PI * 2;
    let x = 0, y = 0, z = 0, al = 1, r = base[0], g = base[1], bl = base[2];
    if (o.ptype === 'fumee') { const w = sp * 0.35 * (0.3 + u * 1.4); x = Math.cos(ang) * w * c + Math.sin(T * 0.7 + i) * 0.12 * u; z = Math.sin(ang) * w * c; y = ph * 0.9; al = Math.sin(u * Math.PI) * 0.55; }
    else if (o.ptype === 'feu') { const w = sp * 0.3 * (1 - u * 0.7); x = Math.cos(ang) * w * c; z = Math.sin(ang) * w * c; y = ph * 1.5; al = 1 - u; const k = 0.3 * (1 - u * 0.5); r *= k; g *= k * (1 - u * 0.75); bl *= k * (1 - u); }
    else if (o.ptype === 'etincelles') { const v = 1.5 + 3 * c, up = 2 + 3 * d; x = Math.cos(ang) * v * ph * sp; z = Math.sin(ang) * v * ph * sp; y = up * ph - 4.9 * ph * ph; al = 1 - u * u; }
    else if (o.ptype === 'pluie') { x = (b - 0.5) * sp; z = (c - 0.5) * sp; y = 6 * (1 - u); al = 0.7; }
    else if (o.ptype === 'neige') { x = (b - 0.5) * sp + Math.sin(T * 0.8 + i) * 0.25; z = (c - 0.5) * sp + Math.cos(T * 0.6 + i * 1.7) * 0.25; y = 6 * (1 - u); al = 0.9; }
    else { x = (b - 0.5) * sp + Math.sin(T * 2 + i) * 0.2; z = (c - 0.5) * sp + Math.cos(T * 1.6 + i * 1.3) * 0.2; y = 5 * (1 - u); al = u > 0.92 ? (1 - u) / 0.08 : 1; if (!o.pcolor) { const k = CONF[i % CONF.length]; r = k[0]; g = k[1]; bl = k[2]; } }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = bl; col[i * 4 + 3] = al;
  }
  return n;
}

// ---------------------------------------------------------------- Tremblement de caméra (caméra à l'épaule, explosion…)
/** Le décalage à ajouter à la pose de la caméra à l'antenne à l'instant t : { x, y, z, yaw, pitch, roll } ou null — calculé d'après t seul */
export function shakeAt(A, t) {
  const o = A.objs.find(x => x.kind === 'effets'); if (!o) return null; const a = chanAt(o, 'shake', t); if (!(a > 0.001)) return null;
  const w = t / 1000 * chanAt(o, 'shakef', t) * Math.PI * 2, n = (k, p) => Math.sin(w * k + p) * 0.6 + Math.sin(w * k * 2.31 + p * 1.7) * 0.3 + Math.sin(w * k * 0.37 + p * 0.3) * 0.1;
  return { x: n(1, 0.3) * a * 0.12, y: n(1.13, 1.9) * a * 0.12, z: n(0.91, 4.1) * a * 0.12, yaw: n(1.07, 2.2) * a * 0.035, pitch: n(0.97, 5.3) * a * 0.035, roll: n(0.83, 0.7) * a * 0.02 };
}

// ---------------------------------------------------------------- Calque 2D : fondus et titres (dessinés sur la vue ET sur chaque image exportée)
/**
 * Ce qu'il faut dessiner par-dessus l'image à l'instant t. cuts : les instants des changements de plan (pour le fondu automatique).
 * Rend { fade (noir 0–1), flash (blanc 0–1), titles: [{ text, color, size (% de la hauteur), pos, x, y (% de décalage), alpha, scale, box }] } ou null.
 */
export function overlayAt(A, t, cuts = []) {
  const fx = A.objs.find(o => o.kind === 'effets'); let fade = 0, flash = 0;
  if (fx) { fade = chanAt(fx, 'fade', t); flash = chanAt(fx, 'flash', t); if (fx.cutfade > 0) for (const c of cuts) fade = Math.max(fade, 1 - Math.abs(t - c) / (fx.cutfade / 2)); }
  const titles = [];
  for (const o of A.objs) { if (o.kind !== 'titre' || !o.text) continue; const end = o.t1 > o.t0 ? o.t1 : Infinity; if (t < o.t0 || t > end) continue;
    const f = o.fadeMs > 0 ? Math.min(1, (t - o.t0) / o.fadeMs, (end - t) / o.fadeMs) : 1, alpha = clamp(f, 0, 1) * chanAt(o, 'op', t); if (alpha <= 0.003) continue;
    titles.push({ text: o.text, color: o.tcolor, size: o.size, pos: o.pos, x: chanAt(o, 'tx', t), y: chanAt(o, 'ty', t), alpha, scale: chanAt(o, 'tsz', t), box: o.box }); }
  fade = clamp(fade, 0, 1); flash = clamp(flash, 0, 1);
  return fade > 0.003 || flash > 0.003 || titles.length ? { fade, flash, titles } : null;
}
/** Dessine ce calque dans un contexte 2D de w × h pixels (la vue du Studio, ou l'image d'un export) */
export function paintOverlay(g, w, h, ov) {
  if (!ov) return;
  if (ov.fade > 0) { g.globalAlpha = ov.fade; g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
  if (ov.flash > 0) { g.globalAlpha = ov.flash; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  for (const T of ov.titles) {
    const px = Math.max(6, h * T.size / 100 * T.scale), lines = String(T.text).split('\n').slice(0, 8), left = T.pos === 'bas_gauche';
    g.font = `${T.pos === 'centre' ? 800 : 700} ${px}px Poppins, "Segoe UI", Arial, sans-serif`; g.textAlign = left ? 'left' : 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const lh = px * 1.22, tot = lines.length * lh, cx = (left ? w * 0.06 : w / 2) + w * T.x / 100, cy = (T.pos === 'centre' ? h / 2 : T.pos === 'haut' ? h * 0.12 + tot / 2 : h * 0.9 - tot / 2) + h * T.y / 100;
    g.globalAlpha = T.alpha;
    if (T.box) { const wd = Math.max(...lines.map(l => g.measureText(l).width)) + px * 1.2; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(left ? cx - px * 0.6 : cx - wd / 2, cy - tot / 2 - px * 0.25, wd, tot + px * 0.5); }
    lines.forEach((l, i) => { const y = cy - tot / 2 + lh * (i + 0.5); g.lineWidth = Math.max(2, px * 0.14); g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(l, cx, y); g.fillStyle = T.color; g.fillText(l, cx, y); });
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- Piste audio
/** Les sons à jouer à l'instant t : [{ o, at (ms dans le fichier), vol }] — un son va de t0 à t0 + dur − off sur la frise */
export function audioAt(A, t) { const out = []; for (const o of A.objs) { if (o.kind !== 'audio' || !o.hash) continue; const at = t - o.t0 + o.off; if (t < o.t0 || at >= o.dur) continue; out.push({ o, at, vol: chanAt(o, 'vol', t) }); } return out; }
/** En-tête « OpusHead » d'une piste Opus (WebM) */
export function opusHead(channels = 2, rate = 48000, preskip = 312) { const b = new Uint8Array(19); b.set([79, 112, 117, 115, 72, 101, 97, 100, 1, channels, preskip & 255, preskip >> 8, rate & 255, (rate >> 8) & 255, (rate >> 16) & 255, (rate >> 24) & 255, 0, 0, 0]); return b; }

// ---------------------------------------------------------------- Ralenti, accéléré, image figée (le temps de la vidéo ≠ le temps du record)
// « speed » (canal de l'élément « effets », animable) : combien de temps du record passe par seconde de vidéo — 0,25 = ralenti, 2 = accéléré.
// « holds » : [{ t, ms }] — à l'instant t du record, l'image reste figée ms millisecondes de vidéo.
export const hasRemap = A => { const o = A.objs.find(x => x.kind === 'effets'); return !!o && ((o.holds && o.holds.length > 0) || isSet(o, 'speed') && (o.tracks.speed?.length ? o.tracks.speed.some(k => Math.abs(k.v - 1) > 1e-6) : Math.abs(o.st.speed - 1) > 1e-6)); };
/**
 * Avance le temps : st = { T (instant du record), used: { 'instant de l'arrêt': ms déjà tenus } }, dOut = millisecondes de vidéo (déjà
 * multipliées par la vitesse de lecture). Rend st, modifié. Sans élément « effets » : T += dOut.
 */
export function advanceTime(A, st, dOut) {
  const o = A.objs.find(x => x.kind === 'effets'); if (!o) { st.T += dOut; return st; }
  let left = dOut, guard = 0; st.used ||= {};
  while (left > 1e-6 && guard++ < 10000) {
    const h = (o.holds || []).find(x => Math.abs(x.t - st.T) < 0.5 && (st.used[x.t] || 0) < x.ms);
    if (h) { const use = Math.min(left, h.ms - (st.used[h.t] || 0)); st.used[h.t] = (st.used[h.t] || 0) + use; left -= use; continue; }
    const sp = Math.max(0.05, chanAt(o, 'speed', st.T)), nxt = (o.holds || []).find(x => x.t > st.T + 0.5), slice = Math.min(left, 20), dT = slice * sp;   // (par pas de 20 ms : la vitesse peut changer en route)
    if (nxt && st.T + dT >= nxt.t) { left -= (nxt.t - st.T) / sp; st.T = nxt.t; } else { st.T += dT; left -= slice; }
  }
  return st;
}
/** Les instants du record de chaque image d'une vidéo allant de start à end, une image tous les stepOut ms de vidéo (bornée à 200 000 images) */
export function frameTimes(A, start, end, stepOut) {
  const st = { T: start, used: {} }, out = [start]; if (!(stepOut > 0)) return out;
  while (out.length < 200000) { const before = st.T; advanceTime(A, st, stepOut); if (st.T >= end - 1e-6) { const o = A.objs.find(x => x.kind === 'effets'), h = o?.holds?.find(x => Math.abs(x.t - end) < 0.5 && (st.used[x.t] || 0) < x.ms); out.push(end); if (!h) break; st.T = end; continue; } if (st.T === before && !Object.keys(st.used).length) break; out.push(st.T); }
  return out;
}

// ---------------------------------------------------------------- Modèles de projets : un montage tout fait, à retoucher ensuite
export const TEMPLATES = { trailer: 'Bande-annonce (30 s au plus) : plan large, tour du sujet, gros plan, suivi, envol final, titre', lieu: 'Présentation d’un lieu : vue d’ensemble, travelling, tour complet, plan bas, nom du lieu', portrait: 'Portrait d’un personnage : approche, profil, gros plan, contre-plongée' };
/**
 * Applique un modèle. C : le module des caméras (cams.js) ; cams : la liste des caméras du projet (complétée ; les caméras déjà là sont
 * écartées de la cinématique, pas supprimées) ; A : la partie « anim » (titres, fondus). ctx : { dur (ms), start (ms), subject: { id, name,
 * at(t) → { x, y (sol), z, yaw } } | null, place (nom du lieu), title }. Rend { cams: [noms], end (ms), notes } ou { error }.
 */
export function applyTemplate(C, cams, A, name, ctx) {
  if (!TEMPLATES[name]) return { error: `modèle inconnu (${Object.keys(TEMPLATES).join(', ')})` };
  const S0 = ctx.subject, t0 = Math.max(0, Math.round(ctx.start || 0)), D = Math.min(ctx.dur - t0, name === 'portrait' ? 16000 : 30000); if (D < 3000) return { error: 'le record est trop court (3 s au moins après le début choisi)' };
  if (!S0 && name !== 'lieu') return { error: 'ce modèle a besoin d’un sujet (un personnage)' };
  for (const c of cams) c.on = false; const made = [], T = k => Math.round(t0 + D * k);
  const shot = (label, a, b, keys, o = {}) => {   // (keys : [[fraction du plan, { x, y, z, fov… }]] — relatif au sujet s'il y en a un, il est alors toujours regardé)
    const c = C.newCam(cams, null, 0); c.name = label; c.tracks = Object.fromEntries(Object.keys(c.tracks).map(k => [k, []]));
    if (o.parent !== false && S0) { c.parent = { kind: 'perso', id: S0.id, name: S0.name }; c.look = o.look !== false; c.follow = !!o.follow; }
    for (const [u, P0] of keys) { const t = Math.round(a + (b - a) * u), P = { ...P0 };
      // (dans un bâtiment : ni derrière un mur — distance bornée —, ni au-dessus du plafond)
      if (c.parent && !c.follow && ctx.maxR) { const h = Math.hypot(P.x, P.z); if (h > ctx.maxR) { P.x *= ctx.maxR / h; P.z *= ctx.maxR / h; } }
      if (c.parent && ctx.maxH != null && Number.isFinite(P.y)) P.y = Math.min(P.y, ctx.maxH - 1.5); for (const [ch, v] of Object.entries({ yaw: 0, pitch: 0, roll: 0, fov: 50, ...P })) C.setKey(c, ch, t, v, o.ease || 'doux'); }
    if (o.dof) c.dof = o.dof; if (o.vignette) c.vignette = o.vignette; cams.push(c); made.push(label); return c;
  };
  const ring = (r, h, a0, a1, n = 5) => Array.from({ length: n }, (_, i) => { const u = i / (n - 1), a = a0 + (a1 - a0) * u; return [u, { x: Math.cos(a) * r, z: Math.sin(a) * r, y: h }]; });
  const fx = newObj(A, 'effets'); setKey(fx, 'fade', t0, 1, 'doux'); setKey(fx, 'fade', Math.min(T(1), t0 + 900), 0); setKey(fx, 'fade', Math.max(t0 + 1000, T(1) - 900), 0, 'doux'); setKey(fx, 'fade', T(1), 1); fx.cutfade = 240;
  const yaw = S0 ? S0.at(t0)?.yaw || 0 : 0;
  if (name === 'trailer') {
    shot('1 · Plan large', T(0), T(0.2), [[0, { x: Math.cos(yaw + 0.5) * 9, z: Math.sin(yaw + 0.5) * 9, y: 3.6, fov: 58 }], [1, { x: Math.cos(yaw + 0.5) * 6.5, z: Math.sin(yaw + 0.5) * 6.5, y: 2.2, fov: 54 }]]);
    shot('2 · Tour du sujet', T(0.2), T(0.42), ring(4.2, 0.5, yaw + 0.9, yaw + 0.9 + 2.2).map(([u, P]) => [u, { ...P, fov: 45 }]), { ease: 'fluide' });
    shot('3 · Gros plan', T(0.42), T(0.56), [[0, { x: Math.cos(yaw + 0.25) * 1.5, z: Math.sin(yaw + 0.25) * 1.5, y: 0, fov: 36 }], [1, { x: Math.cos(yaw - 0.15) * 1.25, z: Math.sin(yaw - 0.15) * 1.25, y: 0.03, fov: 33 }]], { dof: 0.35 });
    shot('4 · Suivi de dos', T(0.56), T(0.78), [[0, { x: -3.2, z: 0.7, y: 0.5, fov: 55 }], [1, { x: -2.4, z: -0.5, y: 0.35, fov: 52 }]], { follow: true });
    shot('5 · Envol final', T(0.78), T(1), [[0, { x: Math.cos(yaw) * 3, z: Math.sin(yaw) * 3, y: 0.4, fov: 50 }], [1, { x: Math.cos(yaw) * 10, z: Math.sin(yaw) * 10, y: 7, fov: 62 }]], { ease: 'accel' });
    newObj(A, 'titre', { text: ctx.title || 'BIG STREET', pos: 'centre', size: 11, t0: T(0.8), t1: T(1), fade: 600 });
  } else if (name === 'portrait') {
    shot('1 · Approche', T(0), T(0.3), [[0, { x: Math.cos(yaw) * 5, z: Math.sin(yaw) * 5, y: 0.2, fov: 50 }], [1, { x: Math.cos(yaw) * 2.6, z: Math.sin(yaw) * 2.6, y: 0, fov: 45 }]]);
    shot('2 · Profil', T(0.3), T(0.55), [[0, { x: Math.cos(yaw + 1.57) * 2.2, z: Math.sin(yaw + 1.57) * 2.2, y: 0, fov: 40 }], [1, { x: Math.cos(yaw + 1.1) * 2, z: Math.sin(yaw + 1.1) * 2, y: 0, fov: 40 }]]);
    shot('3 · Gros plan', T(0.55), T(0.8), [[0, { x: Math.cos(yaw + 0.3) * 1.3, z: Math.sin(yaw + 0.3) * 1.3, y: 0, fov: 34 }], [1, { x: Math.cos(yaw - 0.1) * 1.2, z: Math.sin(yaw - 0.1) * 1.2, y: 0.02, fov: 32 }]], { dof: 0.4 });
    shot('4 · Contre-plongée', T(0.8), T(1), [[0, { x: Math.cos(yaw - 0.5) * 2.2, z: Math.sin(yaw - 0.5) * 2.2, y: -1.1, fov: 48 }], [1, { x: Math.cos(yaw - 0.2) * 2.8, z: Math.sin(yaw - 0.2) * 2.8, y: -1.2, fov: 50 }]]);
    newObj(A, 'titre', { text: ctx.title || S0.name, pos: 'bas_gauche', size: 6, t0: T(0.05), t1: T(0.3), fade: 500 });
  } else {
    // (un lieu : autour d'un centre — le sujet à l'instant de départ s'il y en a un —, à des coordonnées du monde, caméras libres)
    const c0 = ctx.center || (S0 ? S0.at(t0) : null) || { x: 0, y: 0, z: 0 }, cx = c0.x, cy = (c0.y || 0), cz = c0.z, R = Math.max(2.5, ctx.radius || 6);
    const aim = (p, h = 1) => { const w = C.lookAt({ ...p, yaw: 0, pitch: 0 }, { x: cx, y: cy + h, z: cz }); return { ...p, yaw: w.yaw, pitch: w.pitch }; };
    const abs = (u, a, r, h, fov, th = 1) => [u, { ...aim({ x: cx + Math.cos(a) * r, y: cy + (ctx.maxH != null ? Math.min(h, ctx.maxH) : h), z: cz + Math.sin(a) * r }, th), fov }];
    shot('1 · Vue d’ensemble', T(0), T(0.25), [abs(0, yaw + 0.6, R, Math.min(4.5, R * 0.75), 62), abs(1, yaw + 1.0, R * 0.9, Math.min(4, R * 0.65), 60)], { parent: false });
    shot('2 · Travelling', T(0.25), T(0.5), [abs(0, yaw + 2.2, R * 0.8, 1.6, 52), abs(1, yaw + 3.0, R * 0.8, 1.6, 52)], { parent: false, ease: 'fluide' });
    shot('3 · Tour complet', T(0.5), T(0.8), Array.from({ length: 7 }, (_, i) => abs(i / 6, yaw + 3.0 + i / 6 * 4.6, R * 0.7, 2.2, 55)), { parent: false, ease: 'fluide' });
    shot('4 · Plan bas', T(0.8), T(1), [abs(0, yaw - 0.4, R * 0.75, 0.45, 48, 1.4), abs(1, yaw - 0.2, R * 0.45, 0.4, 44, 1.6)], { parent: false });
    newObj(A, 'titre', { text: ctx.title || ctx.place || 'Big Street', pos: 'bas_gauche', size: 6.5, t0: T(0.03), t1: T(0.25), fade: 600 });
  }
  return { cams: made, start: t0, end: T(1), notes: 'Les caméras déjà présentes sont écartées de la cinématique (rond ○ de leur piste), pas supprimées. Chaque plan se retouche : clés, focale, durée.' };
}

// ---------------------------------------------------------------- Contrainte « suivre un chemin »
/** Le point d'un chemin { pts: [[x, y, z]…], closed } à l'avancée u (0–1) : { x, y, z, tx, ty, tz (direction) } — courbe lisse par ses points, à vitesse à peu près constante */
export function pathAt(path, u) {
  const P = path.pts, n = P.length; if (n < 2) return { x: P[0]?.[0] || 0, y: P[0]?.[1] || 0, z: P[0]?.[2] || 0, tx: 0, ty: 0, tz: 0 };
  const segs = path.closed ? n : n - 1, at = i => (path.closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  // (longueurs des segments : l'avancée est répartie selon la distance, pas selon le nombre de points)
  const len = []; let tot = 0; for (let i = 0; i < segs; i++) { const a = at(i), b = at(i + 1), d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); len.push(d); tot += d; }
  let d = Math.max(0, Math.min(1, u)) * tot, i = 0; while (i < segs - 1 && d > len[i]) { d -= len[i]; i++; } const k = len[i] > 1e-9 ? d / len[i] : 0;
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), k2 = k * k, k3 = k2 * k, out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
  ['x', 'y', 'z'].forEach((ax, j) => { const a = p0[j], b = p1[j], c = p2[j], e = p3[j]; out[ax] = 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - e) * k2 + (3 * b - a - 3 * c + e) * k3); out['t' + ax] = 0.5 * ((c - a) + 2 * (2 * a - 5 * b + 4 * c - e) * k + 3 * (3 * b - a - 3 * c + e) * k2); });
  return out;
}
/** Angles pour qu'un élément placé en from regarde to : { ry, rx } — down : c'est son axe −Y qui vise (projecteur), sinon son avant (+Z) */
export function aimAt(from, to, down = false) { const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, h = Math.hypot(dx, dz); if (h + Math.abs(dy) < 1e-6) return null; return { ry: Math.atan2(dx, dz), rx: down ? -Math.atan2(h, -dy) : -Math.atan2(dy, h) }; }

// ---------------------------------------------------------------- Bibliothèque de l'utilisateur : poses et morceaux d'animation (.bspose)
/** Une pose (rotations des os à l'instant t) à garder : { bspose: 1, kind: 'pose', name, bones: { canal: valeur } } ou null si rien n'est posé */
export function capturePose(o, t, name) { const b = bonesAt(o, t); return Object.keys(b).length ? { bspose: 1, kind: 'pose', name: String(name || 'Pose').slice(0, 40), bones: b } : null; }
/**
 * Un morceau d'animation à garder : toutes les clés de l'élément entre a et b (instants relatifs au début ; positions x / y / z en écarts par
 * rapport à la première clé, pour être rejouées ailleurs). { bspose: 1, kind: 'anim', name, dur, tracks: { canal: [{ dt, v, ease… }] } } ou null.
 */
export function captureAnim(o, a, b, name, only = null) {
  const tracks = {}; let t0 = Infinity, t1 = -Infinity;
  for (const [ch, L] of Object.entries(o.tracks)) { if (only && !only(ch)) continue; const K = L.filter(k => k.t >= a && k.t <= b); if (!K.length) continue; tracks[ch] = K; t0 = Math.min(t0, K[0].t); t1 = Math.max(t1, K[K.length - 1].t); }
  if (!Object.keys(tracks).length) return null;
  for (const ch of Object.keys(tracks)) { const rel = POS.includes(ch) ? tracks[ch][0].v : 0; tracks[ch] = tracks[ch].map(k => ({ dt: k.t - t0, v: k.v - rel, ease: k.ease, ...cleanHandles(k) })); }
  return { bspose: 1, kind: 'anim', name: String(name || 'Animation').slice(0, 40), dur: t1 - t0, rel: POS.filter(c => tracks[c]), tracks };
}
/** Lit une entrée de bibliothèque (ou un fichier .bspose) : tout l'illisible est écarté ; null si ce n'en est pas une */
export function cleanSaved(e) {
  if (!e || typeof e !== 'object' || (e.kind !== 'pose' && e.kind !== 'anim')) return null; const name = String(e.name || '').slice(0, 40) || 'Sans nom', okCh = ch => typeof ch === 'string' && (LABELS[ch] !== undefined);
  if (e.kind === 'pose') { const bones = {}; for (const [ch, v] of Object.entries(e.bones || {})) if (BONE_CH.includes(ch) && Number.isFinite(+v)) bones[ch] = +v; return Object.keys(bones).length ? { bspose: 1, kind: 'pose', name, bones } : null; }
  const tracks = {}; for (const [ch, L] of Object.entries(e.tracks || {})) { if (!okCh(ch) || !Array.isArray(L)) continue; const K = L.filter(k => k && Number.isFinite(+k.dt) && Number.isFinite(+k.v)).slice(0, 2000).map(k => ({ dt: Math.max(0, Math.round(+k.dt)), v: +k.v, ease: EASE[k.ease] ? k.ease : 'fluide', ...cleanHandles(k) })); if (K.length) tracks[ch] = K; }
  return Object.keys(tracks).length ? { bspose: 1, kind: 'anim', name, dur: Math.max(0, ...Object.values(tracks).flat().map(k => k.dt)), rel: POS.filter(c => tracks[c]), tracks } : null;
}
/** Applique une entrée gardée à un élément à l'instant t (sur les canaux qu'il porte) ; rend le nombre de clés posées */
export function applySaved(o, e, t, dur = Infinity) {
  const CH = channelsOf(o); let n = 0; t = Math.round(t);
  if (e.kind === 'pose') { for (const [ch, v] of Object.entries(e.bones)) if (CH.includes(ch)) { setKey(o, ch, t, v); n++; } return n; }
  for (const [ch, L] of Object.entries(e.tracks)) { if (!CH.includes(ch)) continue; const base = (e.rel || []).includes(ch) ? (chanAt(o, ch, t) ?? 0) : 0;
    for (const k of L) { const tt = t + k.dt; if (tt > dur) continue; const T0 = o.tracks[ch] ||= [], i = keyAt(T0, tt, 0); if (i >= 0) T0.splice(i, 1); T0.push(cleanK(ch, { t: tt, v: k.v + base, ease: k.ease, hm: k.hm, li: k.li, ro: k.ro })); n++; } sortTrack(o.tracks[ch]); }
  return n;
}

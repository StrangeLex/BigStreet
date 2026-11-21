// Big Street Studio — les paramètres du MONDE (21/11, Lex : « un paramètre du monde où je peux changer l'heure du monde à ma guise »).
// Bouton « 🌍 Monde » de la barre du haut : l'heure du jour (curseur 0–24 h), la vitesse du temps (figé, normal, accéléré), une brume
// (voile de brouillard réglable) — et une piste « 🌍 Monde » sur la frise : des images-clés d'heure et de brume, comme pour les caméras
// (lever de soleil en accéléré, nuit qui tombe pendant un plan, brume qui se lève…). Le moteur du jeu n'a pas de météo (ni pluie ni
// neige) : seule la brume est proposée.
// Rien n'est écrit dans le record : ces réglages vont dans le projet (.bsproj, champ « monde »).
//
// L'heure : le moteur la lit par world.gameHourNow() (lumière du jour, ciel, lune, brouillard, vitrines, voitures garées) — cette méthode
// est remplacée sur l'instance du monde, rien d'autre ne bouge (trains, feux, voitures de passage restent calés sur le record).
// À l'intérieur, seule la lumière des logements suit l'heure (le jeu éclaire les autres salles de la même façon jour et nuit).
//
//   monde: { hour: null | heure à l'instant 0 (0–24), speed: vitesse du temps (0 figé, 1 normal = celle du jeu, 10, 60…), haze: 0–1,
//            tracks: { hour: [{ t, v, ease }], haze: [...] } }   — une piste avec des clés l'emporte sur la valeur fixe
// Ce module ne dépend que de cams.js (courbes) : ses fonctions de calcul se testent seules (tools/selftest.mjs).
import { valAt, EASES } from '/__studio/cams.js';

export const GAME_DAY_MS = 48 * 60 * 1000;   // (une journée de jeu : 48 minutes — shared.js, DAY_MS)
export const SPEEDS = [[0, 'Figé'], [1, 'Normal (1 s = 30 s de jeu)'], [10, '×10'], [60, '×60 (1 s = 30 min)'], [360, '×360 (1 s = 3 h)']];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const mod24 = h => ((h % 24) + 24) % 24;
const TOL = 45;
const CH = { hour: 'Heure', haze: 'Brume' };

/** Un état « monde » propre (tout l'illisible est écarté) */
export function cleanMonde(o) {
  const out = { hour: null, speed: 1, haze: 0, tracks: { hour: [], haze: [] } };
  if (!o || typeof o !== 'object') return out;
  if (o.hour != null && Number.isFinite(+o.hour)) out.hour = mod24(+o.hour);
  out.speed = clamp(num(o.speed, 1), 0, 1440);
  out.haze = clamp(num(o.haze), 0, 1);
  for (const ch of Object.keys(CH)) if (Array.isArray(o.tracks?.[ch])) {
    out.tracks[ch] = o.tracks[ch].filter(k => k && Number.isFinite(+k.t) && Number.isFinite(+k.v)).slice(0, 500)
      .map(k => ({ t: Math.max(0, Math.round(+k.t)), v: ch === 'haze' ? clamp(+k.v, 0, 1) : +k.v, ease: EASES[k.ease] ? k.ease : 'doux' }));
    sortTrack(out.tracks[ch], ch);
  }
  return out;
}
/** Une piste triée ; l'heure est « déroulée » d'une clé à la suivante par le plus court (23 h → 1 h passe par minuit) */
export function sortTrack(L, ch) {
  L.sort((a, b) => a.t - b.t);
  for (let i = L.length - 1; i > 0; i--) if (L[i].t - L[i - 1].t < 1) L.splice(i, 1);
  if (ch === 'hour') for (let i = 0; i < L.length; i++) { const v = mod24(L[i].v); if (!i) { L[i].v = v; continue; } const p = L[i - 1].v; let d = v - mod24(p); if (d > 12) d -= 24; if (d < -12) d += 24; L[i].v = p + d; }
  return L;
}
export const isDefault = M => M.hour == null && M.speed === 1 && !M.haze && !M.tracks.hour.length && !M.tracks.haze.length;
/** Heures de jeu écoulées pendant ms de record, à la vitesse normale du jeu */
export const gameHours = ms => ms / GAME_DAY_MS * 24;
/**
 * L'heure du monde à l'instant T du record. base : l'heure du jeu telle que le record la donne à cet instant (ou null si inconnue).
 * Rend null quand rien n'est réglé (l'heure du record s'applique).
 */
export function hourAt(M, T, base = null) {
  if (M.tracks.hour.length) return mod24(valAt(M.tracks.hour, T));
  if (M.hour == null && M.speed === 1) return null;
  const start = M.hour != null ? M.hour : base == null ? 12 : base - gameHours(T);   // (sans heure réglée : celle du record au début)
  return mod24(start + gameHours(T) * M.speed);
}
export const hazeAt = (M, T) => (M.tracks.haze.length ? clamp(valAt(M.tracks.haze, T), 0, 1) : M.haze);
/** Pose (ou remplace) une clé d'un paramètre du monde à l'instant t */
export function setMondeKey(M, ch, t, v, ease = null) {
  const L = M.tracks[ch], i = L.findIndex(k => Math.abs(k.t - t) <= TOL);
  if (i >= 0) { L[i].v = v; if (ease && EASES[ease]) L[i].ease = ease; } else L.push({ t: Math.max(0, Math.round(t)), v, ease: EASES[ease] ? ease : 'doux' });
  sortTrack(L, ch);
}
export function delMondeKey(M, ch, t) { let n = 0; for (const c of ch ? [ch] : Object.keys(CH)) { const L = M.tracks[c]; for (let i = L.length - 1; i >= 0; i--) if (Math.abs(L[i].t - t) <= TOL) { L.splice(i, 1); n++; } sortTrack(L, c); } return n; }
export const fmtHour = h => { const m = Math.round(mod24(h) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** « 21:30 », « 21h30 », « 21 », « 21.5 » → heure décimale, ou null */
export function parseHour(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? mod24(v) : null;
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ''), m = /^(\d{1,2})(?:[:h](\d{1,2})?)?$/.exec(s);
  if (m) { const h = +m[1], mn = +(m[2] || 0); return h <= 24 && mn < 60 ? mod24(h + mn / 60) : null; }
  const x = Number(s.replace(',', '.')); return Number.isFinite(x) ? mod24(x) : null;
}

// ---------------------------------------------------------------- Dans le Studio
/**
 * host : { $, el, world (getter), T (getter), rec (getter), touch(), seek(ms), hint(t, ms), renderTracks(), fmt(ms), playing (getter) }
 */
export function createMonde(host) {
  const { $, el } = host;
  let M = cleanMonde(null), sel = null, panel = null, recBase = null;   // (sel : { ch, t } clé sélectionnée sur la piste Monde)
  const changed = () => { host.touch(); host.renderTracks(); render(); };

  // L'heure et la brume dans le moteur : gameHourNow remplacée sur l'instance ; brume appliquée après le réglage du brouillard
  function install(w) {
    if (!w || w.__monde) return; w.__monde = true;
    const proto = Object.getPrototypeOf(w), base = proto.gameHourNow;
    w.gameHourNow = function () { const b = base.call(this); recBase = b; const h = host.rec ? hourAt(M, host.T, b) : null; return h == null ? b : h; };
  }
  function wrapFog(w) {
    const f = w.fpWalkUpdate; if (!f || f.__monde) return;
    const g = function (...a) { const r = f.apply(this, a); applyHaze(this); return r; }; g.__monde = true; w.fpWalkUpdate = g;
  }
  const HAZE = { r: 0.74, g: 0.77, b: 0.8 };
  function applyHaze(w) {
    const k = host.rec ? hazeAt(M, host.T) : 0, F = w.fogObj; if (!k || !F) return;
    // (brouillard plus proche : à 100 %, on ne voit plus qu'à une quinzaine de mètres ; teinte grise, plus sombre la nuit)
    const far = F.far * (1 - k) + 14 * k; F.near = Math.min(F.near, far) * (1 - k) + 1 * k; F.far = Math.max(F.near + 1, far);
    const lit = 1 - 0.8 * clamp(w.night || 0, 0, 1);
    F.color.r += (HAZE.r * lit - F.color.r) * k; F.color.g += (HAZE.g * lit - F.color.g) * k; F.color.b += (HAZE.b * lit - F.color.b) * k;
    if (w.scene.background?.isColor && w.room?.outdoor) w.scene.background.lerp(F.color, k * 0.85);
  }
  /** À chaque image, avant world.frame() : le moteur est branché (le monde peut avoir été reconstruit, la caméra rattachée) */
  function tick() { const w = host.world; if (!w) return; install(w); wrapFog(w); }

  // ---- La piste « Monde » de la frise
  function renderTrack(wrap, dur) {
    if (!host.rec) return;
    const T = host.T, has = Object.keys(CH).some(ch => M.tracks[ch].some(k => Math.abs(k.t - T) <= TOL));
    const head = el('div', { class: 'tr-head monde-head' + (panel && !panel.hidden ? ' sel' : ''), title: 'Le monde : heure du jour et brume (clic : réglages)', onclick: () => toggle(true) },
      el('i'), el('span', { class: 'nm', text: '🌍 Monde' }),
      el('button', { class: 'kd' + (has ? ' on' : ''), title: has ? 'Retirer les clés du monde à cet instant' : 'Poser une clé d’heure (et de brume si elle est réglée) à cet instant', text: '◆', onclick: e => { e.stopPropagation(); toggleKey(); } }));
    head.style.setProperty('--c', '#7fd1ff');
    const lane = el('div', { class: 'lane monde-lane', title: 'Piste du monde — glisser une clé pour la déplacer, double-clic : la supprimer' }); lane.style.setProperty('--c', '#7fd1ff');
    const times = [...new Set(Object.values(M.tracks).flat().map(k => k.t))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < times.length; i++) { const b = el('div', { class: 'bar' }); b.style.left = `${times[i] / dur * 100}%`; b.style.width = `${(times[i + 1] - times[i]) / dur * 100}%`; lane.append(b); }
    for (const t of times) {
      const what = Object.keys(CH).filter(ch => M.tracks[ch].some(k => k.t === t)).map(ch => { const k = M.tracks[ch].find(x => x.t === t); return ch === 'hour' ? `heure ${fmtHour(k.v)}` : `brume ${Math.round(k.v * 100)} %`; });
      const d = el('div', { class: 'kf' + (sel?.t === t ? ' sel' : ''), title: `${what.join(', ')} à ${host.fmt(t)}` }); d.style.left = `${t / dur * 100}%`;
      d.addEventListener('pointerdown', e => dragKey(e, lane, t));
      d.addEventListener('dblclick', e => { e.stopPropagation(); delMondeKey(M, null, t); sel = null; changed(); });
      lane.append(d);
    }
    lane.addEventListener('pointerdown', e => { if (e.target !== lane && !e.target.classList.contains('bar')) return; const box = lane.getBoundingClientRect(); host.seek(clamp((e.clientX - box.left) / box.width, 0, 1) * host.rec.dur); });
    wrap.append(head, lane);
  }
  function dragKey(e, lane, t) {
    e.stopPropagation(); e.preventDefault();
    const box = lane.getBoundingClientRect(), x0 = e.clientX, keep = JSON.stringify(M.tracks); let moved = false, at = t;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true;
      let nt = clamp((ev.clientX - box.left) / box.width, 0, 1) * host.rec.dur; if (!ev.altKey) { const s = Math.round(nt / 1000) * 1000; if (Math.abs(s - nt) / host.rec.dur * box.width < 7) nt = s; }
      nt = Math.round(nt); if (nt === at) return; at = nt;
      M.tracks = JSON.parse(keep); for (const ch of Object.keys(CH)) { const L = M.tracks[ch].filter(k => Math.abs(k.t - nt) > TOL || k.t === t); for (const k of L) if (k.t === t) k.t = nt; M.tracks[ch] = sortTrack(L, ch); }
      sel = { t: nt }; host.renderTracks(); host.hint(host.fmt(nt), 1200);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) changed(); else { sel = { t }; host.seek(t); host.renderTracks(); toggle(true); } };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  /** ◆ de la piste : une clé d'heure (et de brume si elle est réglée) à l'instant courant — ou retire celles qui y sont */
  function toggleKey() {
    const T = Math.round(host.T);
    if (Object.keys(CH).some(ch => M.tracks[ch].some(k => Math.abs(k.t - T) <= TOL))) { delMondeKey(M, null, T); sel = null; }
    else { setMondeKey(M, 'hour', T, curHour()); if (hazeAt(M, T) > 0 || M.tracks.haze.length) setMondeKey(M, 'haze', T, hazeAt(M, T)); sel = { t: T }; }
    changed();
  }
  const curHour = () => hourAt(M, host.T, recBase) ?? recBase ?? 12;

  // ---- Le panneau « Monde »
  function build() {
    if (panel) return panel;
    const st = el('style', { text: `
#mondePanel { width: 320px; z-index: 6; }
#mondePanel .m-hour { display: flex; align-items: baseline; gap: 10px; } #mondePanel .m-hour b { font-size: 26px; color: var(--txt); float: none; font-variant-numeric: tabular-nums; }
#mondePanel .m-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; } #mondePanel select { width: 100%; }
#mondePanel .m-keys { display: grid; gap: 3px; max-height: 130px; overflow: auto; font-size: 12px; }
#mondePanel .m-key { display: flex; gap: 6px; align-items: center; padding: 2px 6px; border-radius: 6px; background: #0c111d; cursor: pointer; } #mondePanel .m-key.on { outline: 1px solid #7fd1ff; }
#mondePanel .m-key button { margin-left: auto; border: 0; background: none; color: var(--mut); cursor: pointer; }
#mondePanel .m-note { font-size: 11.5px; color: var(--mut); margin: 0; }
#mondePanel input[type=range].anim { accent-color: #7fd1ff; }
.monde-head i { background: #7fd1ff !important; border-radius: 2px !important; }` });
    document.head.append(st);
    panel = el('div', { id: 'mondePanel', class: 'panel', hidden: '' });
    panel.append(
      el('h3', { text: '🌍 Monde' }),
      el('div', { class: 'm-hour' }, el('span', { class: 'muted', text: 'Heure du monde' }), el('b', { id: 'mHourV' }), el('small', { id: 'mHourSrc', class: 'muted' })),
      el('label', {}, el('input', { type: 'range', id: 'mHour', min: '0', max: '24', step: '0.0833', title: 'L’heure du jour à cet instant (glisser) — avec des clés sur la piste Monde, la clé de cet instant est créée ou modifiée' })),
      el('div', { class: 'm-row' },
        el('button', { class: 'btn small', id: 'mRecHour', text: '↺ Heure du record', title: 'Revenir à l’heure enregistrée (retire l’heure réglée et les clés d’heure)' }),
        el('button', { class: 'btn small', id: 'mKeyHour', text: '◆ Clé d’heure', title: 'Poser une image-clé d’heure à cet instant (piste Monde de la frise)' })),
      el('label', {}, 'Vitesse du temps', el('select', { id: 'mSpeed', title: 'Sans clé d’heure : le temps avance à cette vitesse pendant la lecture (figé : la même heure tout du long)' }, ...SPEEDS.map(([v, n]) => el('option', { value: String(v), text: n })))),
      el('label', {}, el('span', {}, 'Brume ', el('b', { id: 'mHazeV' })), el('input', { type: 'range', id: 'mHaze', min: '0', max: '1', step: '0.01', title: 'Un voile de brouillard (dehors surtout) — animable par clés' })),
      el('div', { class: 'm-row' }, el('button', { class: 'btn small', id: 'mKeyHaze', text: '◆ Clé de brume' })),
      el('div', { class: 'm-keys', id: 'mKeys' }),
      el('p', { class: 'm-note', id: 'mNote' }));
    $('#stage').append(panel);
    const hourIn = $('#mHour');
    hourIn.addEventListener('input', () => { setHour(+hourIn.value); });
    hourIn.addEventListener('change', () => host.touch());
    $('#mRecHour').onclick = () => { M.hour = null; M.tracks.hour = []; if (M.speed !== 1) M.speed = 1; changed(); };
    $('#mKeyHour').onclick = () => { setMondeKey(M, 'hour', Math.round(host.T), curHour()); sel = { t: Math.round(host.T) }; changed(); };
    $('#mSpeed').onchange = e => { const h = curHour(); M.speed = +e.target.value; if (M.hour != null || M.speed !== 1) M.hour = mod24(h - gameHours(host.T) * M.speed); changed(); };
    const hz = $('#mHaze');
    hz.addEventListener('input', () => { const v = +hz.value, T = Math.round(host.T); if (M.tracks.haze.length) setMondeKey(M, 'haze', T, v); else M.haze = v; render(); });
    hz.addEventListener('change', () => changed());
    $('#mKeyHaze').onclick = () => { setMondeKey(M, 'haze', Math.round(host.T), hazeAt(M, host.T)); sel = { t: Math.round(host.T) }; changed(); };
    for (const e of [hourIn, hz]) e.addEventListener('keydown', ev => ev.stopPropagation());
    return panel;
  }
  /** Règle l'heure du monde à l'instant courant : la clé de cet instant s'il y a des clés, sinon l'heure de départ (le temps reprend de là) */
  function setHour(h, at = host.T) {
    h = mod24(h); const T = Math.round(at);
    if (M.tracks.hour.length) setMondeKey(M, 'hour', T, h);
    else M.hour = mod24(h - gameHours(T) * M.speed);
    render();
  }
  function render() {
    if (!panel || panel.hidden) return;
    const T = host.T, h = curHour(), A = document.activeElement;
    $('#mHourV').textContent = fmtHour(h);
    $('#mHourSrc').textContent = M.tracks.hour.length ? '· animée par clés' : M.hour != null ? '· réglée' : M.speed !== 1 ? '· accélérée' : '· celle du record';
    if (A !== $('#mHour')) $('#mHour').value = String(h);
    $('#mHour').classList.toggle('anim', !!M.tracks.hour.length);
    $('#mSpeed').value = String(SPEEDS.some(s => s[0] === M.speed) ? M.speed : 1); $('#mSpeed').disabled = !!M.tracks.hour.length;
    const hz = hazeAt(M, T); $('#mHazeV').textContent = hz > 0.004 ? `${Math.round(hz * 100)} %` : 'non'; if (A !== $('#mHaze')) $('#mHaze').value = String(hz);
    $('#mHaze').classList.toggle('anim', !!M.tracks.haze.length);
    const keys = []; for (const ch of Object.keys(CH)) for (const k of M.tracks[ch]) keys.push({ ch, ...k });
    keys.sort((a, b) => a.t - b.t);
    $('#mKeys').replaceChildren(...keys.map(k => el('div', { class: 'm-key' + (sel?.t === k.t ? ' on' : ''), title: 'Aller à cet instant', onclick: () => { sel = { t: k.t }; host.seek(k.t); host.renderTracks(); render(); } },
      el('span', { text: `◆ ${host.fmt(k.t)}` }), el('span', { class: 'muted', text: k.ch === 'hour' ? `heure ${fmtHour(k.v)}` : `brume ${Math.round(k.v * 100)} %` }),
      el('button', { text: '✕', title: 'Supprimer cette clé', onclick: e => { e.stopPropagation(); delMondeKey(M, k.ch, k.t); changed(); } }))));
    const out = !!host.world?.room?.outdoor;
    $('#mNote').textContent = (out ? '' : 'Ce lieu est en intérieur : le jeu l’éclaire de la même façon jour et nuit (sauf les logements). ') + 'Pas de pluie : le jeu n’a pas de météo. Clés : ◆ ou double-clic sur la piste 🌍 Monde.';
  }
  function toggle(show = null) {
    build(); const on = show ?? panel.hidden;
    panel.hidden = !on; if (on) { for (const id of ['#settings', '#help']) { const p = $(id); if (p) p.hidden = true; } render(); }
    const b = $('#mondeBtn'); if (b) b.classList.toggle('on', on);
  }
  // (le bouton de la barre du haut, à gauche de « ⚙ Vue »)
  function mount() {
    if ($('#mondeBtn')) return;
    const b = el('button', { class: 'tb', id: 'mondeBtn', title: 'Monde : heure du jour, vitesse du temps, brume (animables sur la frise)', text: '🌍 Monde', onclick: () => toggle() });
    const ref = $('#setBtn'); if (ref) ref.before(b); else $('#topbar')?.append(b);
  }
  mount();

  let lastRender = 0;
  return {
    tick, renderTrack, toggle, mount,
    /** Rafraîchit le panneau pendant la lecture (au plus 4 fois par seconde) */
    live(now) { if (panel && !panel.hidden && now - lastRender > 250) { lastRender = now; render(); } },
    // (le projet : enregistré, rechargé, annulé avec le reste — cf. studio.js, extras)
    save: () => (isDefault(M) ? undefined : JSON.parse(JSON.stringify(M))),
    load(o) { M = cleanMonde(o); sel = null; render(); },
    has: () => !isDefault(M),
    keyTimes: () => Object.values(M.tracks).flat().map(k => k.t),
    clampTimes(dur) { for (const ch of Object.keys(CH)) { for (const k of M.tracks[ch]) k.t = clamp(k.t, 0, dur); sortTrack(M.tracks[ch], ch); } },
    close() { M = cleanMonde(null); sel = null; if (panel) panel.hidden = true; $('#mondeBtn')?.classList.remove('on'); },
    // (l'assistant IA et les essais)
    get state() { return M; },
    hourNow: () => curHour(), hazeNow: () => hazeAt(M, host.T), recordHour: () => recBase,
    /** L'heure du monde à l'instant t (l'heure du record y est estimée d'après celle de l'instant courant) */
    hourAt: t => hourAt(M, t, recBase == null ? null : recBase + gameHours(t - host.T)) ?? (recBase == null ? 12 : mod24(recBase + gameHours(t - host.T))),
    hazeAt: t => hazeAt(M, t),
    setHour, setHourAt(h, t) { setHour(h, t); changed(); }, setSpeed(s) { const h = curHour(); M.speed = clamp(num(s, 1), 0, 1440); if (M.hour != null || M.speed !== 1) M.hour = mod24(h - gameHours(host.T) * M.speed); changed(); },
    setHaze(v) { if (M.tracks.haze.length) setMondeKey(M, 'haze', Math.round(host.T), clamp(v, 0, 1)); else M.haze = clamp(v, 0, 1); changed(); },
    setKey(ch, t, v, ease) { setMondeKey(M, ch, t, ch === 'haze' ? clamp(v, 0, 1) : v, ease); changed(); },
    delKeys(ch, t) { const n = t == null ? (ch ? (M.tracks[ch].length + (M.tracks[ch] = []).length) : Object.keys(CH).reduce((n, c) => n + M.tracks[c].splice(0).length, 0)) : delMondeKey(M, ch, t); changed(); return n; },
    reset() { M = cleanMonde(null); changed(); },
    changed,
  };
}

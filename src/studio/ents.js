// Big Street Studio — les entités d'un record (personnages, véhicules, objets) : leur liste pour le panneau « Scène », la recherche,
// ce qu'un compte a le droit de faire porter à un personnage, et le calcul d'une apparence changée. Ce module ne touche ni au DOM
// ni au moteur (il se teste seul : tools/selftest.mjs) ; les données du jeu (styles, couleurs, skins) lui sont passées.
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const present = K => { const t0 = K.desc[0]?.[0] ?? 0, last = K.desc[K.desc.length - 1]?.[0] ?? 0, g = K.gone.filter(x => x >= last).pop(); return [t0, g ?? Infinity]; };

/**
 * Tout ce que contient un record. rec : le record lu (parseRecord), me : l'identifiant du joueur enregistré, furni : noms des objets.
 * Rend [{ key ('u:3', 'v:7', 'i:120'), kind ('joueur' | 'pnj' | 'vehicule' | 'objet'), id, name, sub (précision), me, t0, t1 (ms de présence), type }].
 */
export function listEntities(rec, me = null, furni = {}) {
  const out = [], seen = new Map();
  for (const [id, K] of rec.users) {
    const u = K.desc[0]?.[1]; if (!u) continue;
    const base = u.name || `Personnage ${id}`, n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const [t0, t1] = present(K);
    out.push({ key: `u:${id}`, kind: u.npc ? 'pnj' : 'joueur', id, name: n > 1 ? `${base} #${id}` : base, sub: id === me ? 'le joueur' : u.title || '', me: id === me, t0, t1, moves: K.t.length > 2 });
  }
  for (const [id, K] of rec.vehs) { const v = K.desc[0]?.[1]; if (!v) continue; const [t0, t1] = present(K); out.push({ key: `v:${id}`, kind: 'vehicule', id, name: `${v.model || 'Véhicule'} #${id}`, sub: v.owner || '', t0, t1, type: v.model || '' }); }
  const items = new Map();
  for (const it of rec.room?.items || []) if (it && it.id != null) items.set(it.id, it);
  for (const [id, L] of rec.items || []) { const it = L.map(x => x[1]).find(Boolean); if (it && !items.has(id)) items.set(id, it); }
  for (const [id, it] of items) out.push({ key: `i:${id}`, kind: 'objet', id, name: furni[it.type]?.name || it.type || 'Objet', sub: `${it.x ?? '?'}, ${it.y ?? '?'}`, type: it.type || '', x: it.x, y: it.y, t0: 0, t1: Infinity });
  // (le joueur enregistré d'abord, puis par nom)
  return out.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0) || a.name.localeCompare(b.name, 'fr') || String(a.id).localeCompare(String(b.id), 'fr', { numeric: true }));
}

export const GROUPS = [['camera', '🎥', 'Caméras'], ['joueur', '🧍', 'Joueurs'], ['pnj', '🤖', 'PNJ'], ['vehicule', '🚗', 'Véhicules'], ['objet', '📦', 'Objets et décor']];
/**
 * L'arbre du panneau « Scène » : [{ kind, icon, title, total, rows: [entités], more (non montrées) }], filtré par la recherche
 * (nom, précision, type, identifiant ; sans accents ni majuscules). Les objets sont rangés par modèle.
 */
export function buildTree(cams, ents, query = '', cap = 150) {
  const q = norm(query), hit = e => !q || norm(`${e.name} ${e.sub || ''} ${e.type || ''} ${e.id}`).includes(q);
  const all = [...cams.map(c => ({ key: `c:${c.id}`, kind: 'camera', id: c.id, name: c.name, sub: c.parent ? `↳ ${c.parent.name}` : '', color: c.color, off: !c.on })), ...ents];
  return GROUPS.map(([kind, icon, title]) => {
    let rows = all.filter(e => e.kind === kind), total = rows.length; rows = rows.filter(hit);
    if (kind === 'objet') rows.sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id - b.id);
    return { kind, icon, title, total, found: rows.length, rows: rows.slice(0, cap), more: Math.max(0, rows.length - cap) };
  });
}

// ---------------------------------------------------------------- Apparence : ce que le compte peut faire porter
export const WEAR = [['hat', 'acc', 'Chapeau'], ['glasses', 'glassesCol', 'Lunettes / masque'], ['top', 'shirt', 'Haut'], ['bottom', 'pants', 'Bas'], ['feet', 'shoes', 'Chaussures']];
/**
 * Les droits d'un compte. account : { admin, owned: [clés] } ou null (personne de connecté) ; SH : { isPremium, SKINS }.
 *  - look(k, v) : ce style ou cette couleur est-il permis ? (les articles payants de la boutique : seulement s'ils sont possédés)
 *  - skin(item, key) : ce skin (clé de boutique « skin:objet:skin ») est-il possédé ? Un administrateur a tout.
 */
export function rights(account, SH) {
  const admin = !!account?.admin, owned = new Set(account?.owned || []);
  return {
    admin,
    look: (k, v) => admin || !SH.isPremium?.(k, v) || owned.has(`${k}:${v}`),
    skin: (item, key) => !!SH.SKINS?.[item]?.[key] && (admin || owned.has(`skin:${item}:${key}`)),
  };
}
/** Un skin de vêtement va-t-il sur ce modèle ? (un skin ne va que sur certaines coupes : SKINS.vet_top.x.s = [5]) */
export const skinFits = (SH, slot, key, style) => { const S = SH.SKINS?.[`vet_${slot}`]?.[key]; return !!S && (!S.s || S.s.includes(style)); };
/**
 * L'apparence d'un personnage après surcharge. base : sa fiche du record ({ look, wd, hold, bag }), over : la surcharge du projet.
 * Rend { look, wd, hold, bag } — les skins qui ne vont plus sur la coupe choisie sont retirés.
 */
export function applyOver(base, over, SH) {
  const look = { ...(base.look || {}), ...(over?.look || {}) }, wd = { ...(base.wd || {}) };
  for (const [k, v] of Object.entries(over?.wd || {})) { if (v == null) delete wd[k]; else wd[k] = v; }
  for (const [slot] of WEAR) { const k = `sk:${slot}`; if (wd[k] && !skinFits(SH, slot, wd[k], look[slot])) delete wd[k]; }
  if (look.gender === 0) look.chest = 0; else if (look.gender === 1) look.beard = 0;
  return { look, wd: Object.keys(wd).length ? wd : undefined, hold: over && 'hold' in over ? over.hold || undefined : base.hold, bag: over && 'bag' in over ? over.bag || undefined : base.bag };
}
/**
 * Demande de changement d'apparence, contrôlée : patch = { look: { top: 5, shirt: 3… }, skins: { top: 'hope' | null }, hold: 'glock17' |
 * 'glock17__or' | null, bag: 'sac_a_dos' | 'sac_a_dos__pirate' | 'sacoche:3' | null }. Rend { over (nouvelle surcharge), done: [textes],
 * refused: [textes] } — ce qui n'est pas possédé par le compte, ou n'existe pas, est refusé et laissé tel quel.
 */
export function changeLook(base, over, patch, R, SH) {
  const o = { name: over?.name || base.name || '', look: { ...(over?.look || {}) }, wd: { ...(over?.wd || {}) } }; if (over && 'hold' in over) o.hold = over.hold; if (over && 'bag' in over) o.bag = over.bag;
  const done = [], refused = [], lists = { ...(SH.LOOK_COLORS || {}), ...(SH.LOOK_STYLES || {}) };
  for (const [k, v] of Object.entries(patch.look || {})) {
    const L = lists[k]; if (!L || !Number.isInteger(v) || v < 0 || v >= L.length) { refused.push(`${k} = ${v} : inconnu`); continue; }
    if (!R.look(k, v) && base.look?.[k] !== v) { refused.push(`${k} « ${SH.LOOK_STYLES?.[k]?.[v] ?? v} » : pas dans les skins du compte`); continue; }
    o.look[k] = v; done.push(`${k} → ${SH.LOOK_STYLES?.[k]?.[v] ?? `couleur ${v}`}`);
  }
  const eff = applyOver(base, o, SH).look;
  for (const [slot, key] of Object.entries(patch.skins || {})) {
    const id = `sk:${slot}`; if (!WEAR.some(w => w[0] === slot)) { refused.push(`skin ${slot} : emplacement inconnu`); continue; }
    if (key == null || key === '') { o.wd[id] = null; done.push(`skin ${slot} retiré`); continue; }
    if (!SH.SKINS?.[`vet_${slot}`]?.[key]) { refused.push(`skin ${slot} « ${key} » : inconnu`); continue; }
    if (!skinFits(SH, slot, key, eff[slot])) { refused.push(`skin « ${SH.SKINS[`vet_${slot}`][key].name} » : ne va pas sur cette coupe`); continue; }
    if (!R.skin(`vet_${slot}`, key) && base.wd?.[id] !== key) { refused.push(`skin « ${SH.SKINS[`vet_${slot}`][key].name} » : pas dans les skins du compte`); continue; }
    o.wd[id] = key; done.push(`skin ${slot} → ${SH.SKINS[`vet_${slot}`][key].name}`);
  }
  for (const f of ['hold', 'bag']) {
    if (!(f in patch)) continue; const v = patch[f];
    if (v == null || v === '') { o[f] = null; done.push(f === 'hold' ? 'plus rien en main' : 'plus de sac'); continue; }
    const [model] = String(v).split(':'), [item, skin] = model.split('__');
    if (f === 'bag' ? !['sac_a_dos', 'sacoche'].includes(item) : !SH.ITEMS?.[item === 'ophone_coque' ? 'ophone' : item]) { refused.push(`${f === 'hold' ? 'objet' : 'sac'} « ${v} » : inconnu`); continue; }
    const sItem = item === 'ophone_coque' ? 'ophone' : item;
    if (skin && !SH.SKINS?.[sItem]?.[skin]) { refused.push(`skin « ${skin} » de ${sItem} : inconnu`); continue; }
    if (skin && !R.skin(sItem, skin) && base[f] !== v) { refused.push(`skin « ${SH.SKINS[sItem][skin].name} » : pas dans les skins du compte`); continue; }
    o[f] = String(v); done.push(`${f === 'hold' ? 'en main' : 'sac'} → ${skin ? SH.SKINS[sItem][skin].name : SH.ITEMS?.[sItem]?.name || item}`);
  }
  if (!Object.keys(o.wd).length) delete o.wd; if (!Object.keys(o.look).length) delete o.look;
  return { over: o.look || o.wd || 'hold' in o || 'bag' in o ? o : null, done, refused };
}
/** Description courte d'une tenue (pour l'assistant et l'en-tête du panneau) */
export function describeLook(d, SH) {
  const L = d.look || {}, S = SH.LOOK_STYLES || {}, parts = [];
  parts.push(S.gender?.[L.gender] || 'Personnage');
  if (S.hairStyle?.[L.hairStyle]) parts.push(`cheveux ${S.hairStyle[L.hairStyle].toLowerCase()}`);
  for (const [slot, , label] of WEAR) { const n = S[slot]?.[L[slot]]; if (!n || /^Aucun/.test(n)) continue; const sk = d.wd?.[`sk:${slot}`], N = sk && SH.SKINS?.[`vet_${slot}`]?.[sk]?.name; parts.push(`${label.toLowerCase()} : ${N || n}`); }
  if (d.hold) parts.push(`en main : ${d.hold}`); if (d.bag) parts.push(`sac : ${d.bag}`);
  return parts.join(' · ');
}

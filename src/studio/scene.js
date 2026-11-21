// Big Street Studio — le panneau « Scène », comme dans un logiciel 3D : l'arbre de tout ce que contient le record (caméras, joueurs,
// PNJ, véhicules, objets du décor), avec recherche, sélection, cadrage (F ou double-clic) et visibilité (œil) ; et le panneau
// d'apparence d'un personnage : corps, coiffure, couleurs, chaque vêtement et son skin, objet tenu, sac — dans la limite des skins
// du compte connecté au launcher (un administrateur a tout). Rien n'est écrit dans le record : les changements vont dans le projet
// (.bsproj, « ents »), et sont rejoués sur les fiches du record à chaque ouverture.
import { listEntities, buildTree, rights, applyOver, changeLook, describeLook, skinFits, WEAR, norm } from '/__studio/ents.js';

export function createScene(S) {
  const { $, el } = S;
  let list = [], sel = null, query = '', folded = new Set(['objet']), lastTree = '', lastLive = 0, mark = null;
  const orig = new WeakMap();        // (fiche du record → son apparence d'origine, gardée dès qu'on la change)
  const mine = new Set();            // (ce que CE module a masqué — on ne rallume jamais ce que le moteur a caché lui-même)
  const byKey = k => list.find(e => e.key === k) || null;
  const SH = () => S.shared() || {};
  const R = () => rights(S.account(), SH());
  const descAt = (id, t) => { const K = S.rec?.users.get(id); if (!K) return null; let d = K.desc[0]; for (const x of K.desc) if (x[0] <= t) d = x; return d?.[1] || null; };
  const baseOf = u => orig.get(u) || { name: u.name, look: u.look, wd: u.wd, hold: u.hold, bag: u.bag };

  // ---------------------------------------------------------------- Surcharges : apparence et visibilité
  /** Rejoue les surcharges du projet sur les fiches du record (force : tout réappliquer — projet rouvert, annulation) */
  function applyEnts(force = false) {
    const rec = S.rec, pb = S.pb; if (!rec || !pb) return;
    for (const [id, K] of rec.users) {
      const over = S.ents.over[`u:${id}`] || null; let changed = false;
      for (const [, u] of K.desc) {
        if (!over && !orig.has(u)) continue;
        if (!orig.has(u)) orig.set(u, { name: u.name, look: u.look, wd: u.wd, hold: u.hold, bag: u.bag });
        const b = orig.get(u), n = over ? applyOver(b, over, SH()) : b, was = JSON.stringify([u.look, u.wd, u.hold, u.bag]);
        u.look = n.look; if (n.wd) u.wd = n.wd; else delete u.wd; if (n.hold) u.hold = n.hold; else delete u.hold; if (n.bag) u.bag = n.bag; else delete u.bag;
        if (was !== JSON.stringify([u.look, u.wd, u.hold, u.bag])) changed = true;
      }
      if (changed || (force && over)) pb.users?.delete(id);   // (la relecture réapplique la fiche au personnage à l'image suivante)
    }
  }
  function setOver(id, over) {
    if (over) S.ents.over[`u:${id}`] = over; else delete S.ents.over[`u:${id}`];
    applyEnts(); S.touch(); renderPanel(); renderTree(true);
  }
  /** Change l'apparence d'un personnage (contrôlée par les droits du compte) : rend { ok, done, refused } */
  function setLook(id, patch) {
    const u = descAt(id, S.T); if (!u) return { ok: false, done: [], refused: ['personnage introuvable'] };
    const r = changeLook(baseOf(u), S.ents.over[`u:${id}`] || null, patch, R(), SH());
    if (r.done.length) setOver(id, r.over);
    return { ok: r.done.length > 0, done: r.done, refused: r.refused };
  }
  function resetLook(id) { if (S.ents.over[`u:${id}`]) setOver(id, null); }
  function setHidden(key, on) {
    const H = new Set(S.ents.hidden); if (on) H.add(key); else H.delete(key);
    S.ents.hidden = [...H]; if (!on) show(key); S.touch(); renderTree(true); renderPanel();
  }
  const isHidden = key => S.ents.hidden.includes(key);
  // (rallumer ce qu'on avait éteint)
  function show(key) {
    const w = S.world; if (!w || !mine.delete(key)) return; const [k, raw] = key.split(':'), id = +raw;
    if (k === 'u') { const a = w.avatars.get(id); if (a) { a.zoneHidden = false; a.group.visible = true; a._tagVis = null; } }
    else if (k === 'v') { const V = w.pvs?.get(id); if (V?.mesh) V.mesh.visible = true; }
    else if (k === 'i') { const m = w.itemMeshes?.get(id); if (m) m.visible = true; }
  }
  /** À chaque image, avant le dessin : ce qui est masqué le reste (le moteur rallume certaines choses de lui-même) */
  function tick(now) {
    const w = S.world; if (!w || !S.pb) return;
    for (const key of S.ents.hidden) {
      const [k, raw] = key.split(':'), id = +raw;
      if (k === 'u') { const a = w.avatars.get(id); if (a) { a.zoneHidden = true; if (a.group.visible) a.group.visible = false; mine.add(key); } }
      else if (k === 'v') { const V = w.pvs?.get(id); if (V?.mesh?.visible) { V.mesh.visible = false; mine.add(key); } }
      else if (k === 'i') { const m = w.itemMeshes?.get(id); if (m?.visible) { m.visible = false; w.fogCulled?.delete(m); mine.add(key); } }
    }
    for (const key of [...mine]) if (!S.ents.hidden.includes(key)) show(key);
    // (le repère de l'entité sélectionnée, et les valeurs vivantes du panneau)
    if (sel && mark) { const p = posOf(sel.key, S.T), q = p && S.giz?.screen(p.x, p.y + (sel.kind === 'u' ? 2.05 : 1.2), p.z), st = $('#stage').getBoundingClientRect(); const on = !!q && q.front && S.mode !== 'cam' && S.mode !== 'cine'; mark.style.display = on ? '' : 'none'; if (on) mark.style.transform = `translate(${(q.x - st.left) | 0}px, ${(q.y - st.top) | 0}px) translate(-50%, -100%)`; }
    if (now - lastLive > 400) { lastLive = now; live(); }
  }

  // ---------------------------------------------------------------- Où est une entité
  /** { x, y (sol), z, yaw (vers où il regarde, convention des caméras), present } à l'instant t (ms) */
  function posOf(key, t) {
    const e = byKey(key), w = S.world; if (!w || !S.rec) return null; const [k, raw] = key.split(':'), id = +raw;
    if (k === 'u' || k === 'v') { const p = S.entPos(k === 'u' ? 'perso' : 'vehicule', id, t); return p ? { ...p, present: !e || (t >= e.t0 && t <= e.t1) } : null; }
    if (k === 'i') { const m = w.itemMeshes?.get(id); if (m) return { x: m.position.x, y: m.position.y, z: m.position.z, yaw: 0, present: true }; if (e && Number.isFinite(e.x)) { let y = 0; try { y = w.heightAt(e.x, e.y) || 0; } catch { y = 0; } return { x: e.x, y, z: e.y, yaw: 0, present: true }; } }
    return null;
  }
  /** Cadre une entité : la vue libre vient se placer devant elle (ou derrière si un mur gêne) */
  function frame(s = sel) {
    const p = s && posOf(s.key, S.T); if (!p) return S.hint('Cette entité n’est pas là à cet instant.', 2500);
    if (S.mode !== 'free') S.setMode('free');
    const big = s.kind === 'v' ? 6.5 : s.kind === 'i' ? 4 : 3.4, hy = s.kind === 'u' ? 1.3 : 0.7, w = S.world;
    let best = null;
    for (const da of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) { const a = p.yaw + da; let d = big; const at = k => [p.x + Math.cos(a) * k, p.z + Math.sin(a) * k];
      while (d > 1.2 && w.room && !w.room.outdoor && !w.isFloor(Math.round(at(d)[0]), Math.round(at(d)[1]))) d -= 0.4;
      if (!best || d > best.d + 0.3) best = { d, x: at(d)[0], z: at(d)[1] }; if (best.d >= big - 0.1) break; }
    const y = p.y + hy + best.d * 0.22;
    Object.assign(S.cam, { x: best.x, z: best.z, y, yaw: Math.atan2(p.z - best.z, p.x - best.x), pitch: Math.atan2(p.y + hy - y, Math.hypot(p.x - best.x, p.z - best.z)), roll: 0 });
  }
  /** Le personnage ou le véhicule sous le pointeur (clic dans la vue) */
  function pick(x, y) {
    const w = S.world; if (!w || !S.giz) return null; let best = null;
    for (const e of list) {
      if (e.kind === 'objet' || isHidden(e.key)) continue; const p = posOf(e.key, S.T); if (!p?.present) continue;
      const h = e.kind === 'vehicule' ? 0.8 : 0.95, a = S.giz.screen(p.x, p.y + h, p.z), b = S.giz.screen(p.x, p.y + h * 2, p.z); if (!a.front) continue;
      const r = Math.max(10, Math.abs(a.y - b.y) * (e.kind === 'vehicule' ? 1.3 : 0.75)), d = Math.hypot(x - a.x, (y - a.y) * 0.6);
      if (d < r && (!best || r > best.r)) best = { r, e };   // (le plus gros à l'écran = le plus proche)
    }
    return best ? { kind: best.e.key[0], id: best.e.id, key: best.e.key } : null;
  }
  function select(s, fromUi = true) {
    sel = s ? { kind: s.key[0], id: s.id ?? +s.key.slice(2), key: s.key } : null;
    if (sel && fromUi) { S.selectCam(null); const e = byKey(sel.key); S.hint(`${e?.name || 'Entité'} sélectionné${e?.kind === 'pnj' || e?.kind === 'joueur' ? '' : 'e'} — F : cadrer`, 2500); }
    if (mark) mark.style.display = 'none';
    renderTree(true); renderPanel();
  }

  // ---------------------------------------------------------------- L'arbre
  function renderTree(force = false) {
    const host = $('#sceneTree'); if (!S.rec) { host.replaceChildren(); return; }
    const tree = buildTree(S.cams, list, query), T = S.T, selCam = S.selCam();
    const sig = JSON.stringify([tree.map(g => [g.found, g.rows.map(r => r.key + r.name + (r.sub || ''))]), sel?.key, selCam?.id, S.ents.hidden, [...folded], Object.keys(S.ents.over)]);
    if (!force && sig === lastTree) return; lastTree = sig;
    const kids = [];
    for (const g of tree) {
      if (!g.total) continue; const open = !folded.has(g.kind) || !!query;
      kids.push(el('div', { class: 'sc-group', onclick: () => { if (folded.has(g.kind)) folded.delete(g.kind); else folded.add(g.kind); renderTree(true); } },
        el('span', { class: 'tw', text: open ? '▾' : '▸' }), el('span', { text: `${g.icon} ${g.title}` }), el('small', { text: query ? `${g.found} / ${g.total}` : String(g.total) })));
      if (!open) continue;
      for (const e of g.rows) {
        const cam = e.kind === 'camera', on = cam ? selCam?.id === e.id : sel?.key === e.key, hid = !cam && isHidden(e.key), away = !cam && (T < e.t0 || T > e.t1);
        const row = el('div', { class: 'sc-row' + (on ? ' sel' : '') + (hid ? ' hid' : '') + (away ? ' away' : ''), 'data-key': e.key, title: cam ? 'Clic : sélectionner · double-clic ou F : la montrer' : `${e.name}${e.sub ? ` — ${e.sub}` : ''} (n° ${e.id})${away ? ' — absent à cet instant' : ''}\nClic : sélectionner · double-clic ou F : cadrer`,
          onclick: () => { if (cam) { S.selectCam(e.id); S.showCam(e.id); } else select(e); }, ondblclick: () => { if (cam) S.showCam(e.id, true); else frame({ kind: e.key[0], id: e.id, key: e.key }); } },
          cam ? el('i', { class: 'dot', style: `background:${e.color}` }) : null,
          el('span', { class: 'nm' }, e.name, e.me ? el('b', { class: 'me', text: ' ★ le joueur' }) : null, e.sub && !e.me ? el('small', { text: ` ${e.sub}` }) : null, S.ents.over[e.key] ? el('small', { class: 'chg', text: ' ✎ modifié' }) : null),
          cam ? null : el('button', { class: 'eye', title: hid ? 'Masqué : cliquer pour le montrer' : 'Visible : cliquer pour le masquer', text: hid ? '🚫' : '👁', onclick: ev => { ev.stopPropagation(); setHidden(e.key, !hid); } }));
        kids.push(row);
      }
      if (g.more) kids.push(el('div', { class: 'sc-more', text: `… et ${g.more} autres : affine la recherche.` }));
    }
    if (!kids.length) kids.push(el('div', { class: 'none', text: 'Rien ne correspond.' }));
    const keep = host.scrollTop; host.replaceChildren(...kids); host.scrollTop = keep;
  }

  // ---------------------------------------------------------------- Le panneau d'une entité
  const sw = (colors, cur, pick, ok) => el('div', { class: 'swatches' }, ...colors.map((c, i) => { const allowed = ok(i); return el('button', { class: 'sw' + (i === cur ? ' on' : '') + (allowed ? '' : ' lock'), style: `background:${c}`, title: allowed ? '' : '🔒 pas dans les skins de ton compte', ...(allowed ? { onclick: () => pick(i) } : { disabled: '' }) }); }));
  const selBox = (opts, cur, pick, title = '') => { const s = el('select', { title, onchange: e => pick(e.target.value) }, ...opts.map(([v, text, ok]) => el('option', { value: String(v), text: ok === false ? `🔒 ${text}` : text, ...(ok === false ? { disabled: '' } : {}), ...(String(v) === String(cur) ? { selected: '' } : {}) }))); s.addEventListener('keydown', e => e.stopPropagation()); return s; };
  function live() {
    if (!sel || $('#entPanel').hidden) return; const p = posOf(sel.key, S.T), o = $('.ent-pos'); if (!o) return;
    const tx = p ? `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} · z ${p.z.toFixed(2)}${sel.kind !== 'i' ? ` · cap ${Math.round(p.yaw * 180 / Math.PI)}°` : ''}${p.present ? '' : ' — absent à cet instant'}` : 'absent à cet instant';
    if (o.textContent !== tx) o.textContent = tx;
  }
  function renderPanel() {
    const box = $('#entPanel'), e = sel && byKey(sel.key); box.hidden = !e || !S.pb; if (box.hidden) { box.replaceChildren(); return; }
    const hid = isHidden(e.key), kindName = { joueur: 'Joueur', pnj: 'PNJ', vehicule: 'Véhicule', objet: 'Objet' }[e.kind];
    const kids = [el('div', { class: 'p-title' }, el('b', { class: 'e-name', text: e.name }), el('span', { class: 'e-kind', text: e.me ? '★ le joueur enregistré' : kindName })),
      el('small', { class: 'muted ent-pos' }),
      el('div', { class: 'p-btns' }, el('button', { class: 'btn small', text: '🎯 Cadrer (F)', onclick: () => frame() }), el('button', { class: 'btn small', text: hid ? '👁 Montrer' : '🚫 Masquer', onclick: () => setHidden(e.key, !hid) }),
        e.kind !== 'objet' && S.selCamLast() ? el('button', { class: 'btn small', title: 'Attacher la dernière caméra sélectionnée à cette entité (elle la suivra)', text: `📎 Parent de ${S.selCamLast().name}`, onclick: () => S.setParentOf(S.selCamLast(), e) }) : null)];
    if (sel.kind === 'u') kids.push(...lookEditor(e));
    else kids.push(el('small', { class: 'muted', text: e.kind === 'vehicule' ? 'Un véhicule peut être masqué, cadré, ou servir de parent à une caméra.' : 'Un objet du décor peut être masqué ou cadré.' }));
    box.replaceChildren(...kids); live();
  }
  // (l'apparence : chaque liste montre tout ; ce que le compte ne possède pas est verrouillé 🔒 — sauf ce que le personnage porte déjà)
  function lookEditor(e) {
    const sh = SH(), u = descAt(e.id, S.T); if (!u || !sh.LOOK_STYLES) return [el('small', { class: 'muted', text: 'Apparence indisponible (données du jeu absentes de la copie locale).' })];
    const base = baseOf(u), over = S.ents.over[e.key] || null, d = applyOver(base, over, sh), L = d.look, r = R(), acc = S.account();
    const set = patch => { const res = setLook(e.id, patch); if (res.refused.length) S.toast(`🔒 ${res.refused[0]}`, true); };
    const okL = (k, v) => r.look(k, v) || base.look?.[k] === v;
    const style = (k, title) => selBox(sh.LOOK_STYLES[k].map((n, i) => [i, n, okL(k, i)]), L[k], v => set({ look: { [k]: +v } }), title);
    const colors = k => sw(sh.LOOK_COLORS[k], L[k], i => set({ look: { [k]: i } }), i => okL(k, i));
    const sec = (title, ...rows) => [el('h4', { text: title }), ...rows.filter(Boolean)];
    const out = [el('div', { class: 'e-acc' + (acc?.admin ? ' adm' : '') }, acc ? (acc.admin ? `Compte ${acc.name} — administrateur : tous les skins.` : `Compte ${acc.name} : ${acc.owned.length} article${acc.owned.length > 1 ? 's' : ''} possédé${acc.owned.length > 1 ? 's' : ''}${acc.online ? '' : ' (copie hors ligne)'}.`) : 'Personne n’est connecté dans le launcher : seuls les styles de base sont disponibles.'),
      el('small', { class: 'muted', text: describeLook(d, sh) })];
    out.push(...sec('Corps', el('label', {}, 'Morphologie', style('gender')), L.gender === 1 ? el('label', {}, 'Poitrine', style('chest')) : el('label', {}, 'Barbe', style('beard')), el('label', {}, 'Peau', colors('skin')), el('label', {}, 'Yeux', colors('eyes'))));
    out.push(...sec('Cheveux', el('label', {}, 'Coiffure', style('hairStyle')), el('label', {}, 'Couleur', colors('hair'))));
    for (const [slot, col, label] of WEAR) {
      const skins = Object.entries(sh.SKINS?.[`vet_${slot}`] || {}).filter(([k]) => skinFits(sh, slot, k, L[slot])), cur = d.wd?.[`sk:${slot}`] || '';
      out.push(...sec(label, el('label', {}, 'Modèle', style(slot)), el('label', {}, 'Couleur', colors(col)),
        skins.length ? el('label', {}, 'Skin', selBox([['', 'Aucun skin'], ...skins.map(([k, v]) => [k, v.name, r.skin(`vet_${slot}`, k) || base.wd?.[`sk:${slot}`] === k])], cur, v => set({ skins: { [slot]: v || null } }))) : null));
    }
    // Objet tenu : les objets à skin du jeu (armes, canne, lampe, téléphone…) ; sac : à dos ou sacoche, teinte ou skin
    const [hItem, hSkin] = String(d.hold || '').split('__'), hBase = hItem === 'ophone_coque' ? 'ophone' : hItem;
    const holdable = Object.keys(sh.SKINS || {}).filter(k => !k.startsWith('vet_') && !['sac_a_dos', 'sacoche', 'ordinateur', 'imprimante_3d', 'coque_ophone'].includes(k) && sh.ITEMS?.[k]);
    if (hBase && !holdable.includes(hBase)) holdable.unshift(hBase);
    const hSkins = Object.entries(sh.SKINS?.[hBase] || {});
    out.push(...sec('Objet tenu', el('label', {}, 'Objet', selBox([['', 'Rien'], ...holdable.map(k => [k, sh.ITEMS?.[k]?.name || k])], hBase || '', v => set({ hold: v || null }))),
      hBase && hSkins.length ? el('label', {}, 'Skin', selBox([['', 'Sans skin'], ...hSkins.map(([k, v]) => [k, v.name, r.skin(hBase, k) || base.hold === sh.skinModel?.(hBase, k)])], hSkin || '', v => set({ hold: v ? sh.skinModel(hBase, v) : hBase }))) : null));
    const [bModel, bCol] = String(d.bag || '').split(':'), [bItem, bSkin] = bModel.split('__'), bSkins = Object.entries(sh.SKINS?.[bItem] || {});
    out.push(...sec('Sac', el('label', {}, 'Sac', selBox([['', 'Aucun'], ['sac_a_dos', 'Sac à dos'], ['sacoche', 'Sacoche']], bItem || '', v => set({ bag: v || null }))),
      bItem ? el('label', {}, 'Skin', selBox([['', 'Sans skin (teinte)'], ...bSkins.map(([k, v]) => [k, v.name, r.skin(bItem, k) || base.bag === `${bItem}__${k}`])], bSkin || '', v => set({ bag: v ? `${bItem}__${v}` : bItem }))) : null,
      bItem && !bSkin && sh.BAG_COLORS ? el('label', {}, 'Teinte', sw(sh.BAG_COLORS, +bCol || 0, i => set({ bag: `${bItem}:${i}` }), () => true)) : null));
    out.push(el('div', { class: 'p-btns' }, el('button', { class: 'btn small danger', text: '↺ Apparence d’origine', ...(over ? {} : { disabled: '' }), onclick: () => resetLook(e.id) })));
    return out;
  }

  $('#sceneSearch').addEventListener('input', e => { query = e.target.value; renderTree(true); });
  $('#sceneSearch').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.target.value = ''; query = ''; renderTree(true); e.target.blur(); } });
  return {
    get sel() { return sel; }, get list() { return list; }, byKey, posOf, frame, pick, select, applyEnts, tick, setLook, resetLook, setHidden, isHidden, descAt,
    /** l'apparence actuelle d'un personnage : { look, wd, hold, bag } et sa description */
    lookOf(id, t = S.T) { const u = descAt(id, t); if (!u) return null; const d = applyOver(baseOf(u), S.ents.over[`u:${id}`] || null, SH()); return { ...d, text: describeLook(d, SH()) }; },
    /** Ce que le compte peut faire porter à ce personnage (pour l'assistant) : numéros permis par attribut, skins possédés, objets, sacs */
    lookOptions(id, attr = null) {
      const sh = SH(), u = descAt(id, S.T); if (!u || !sh.LOOK_STYLES) return null; const r = R(), base = baseOf(u), d = applyOver(base, S.ents.over[`u:${id}`] || null, sh), out = { actuel: d.look, attributs: {}, skins: {} };
      const lists = { ...sh.LOOK_STYLES, ...sh.LOOK_COLORS };
      for (const [k, L] of Object.entries(lists)) { if (attr && attr !== k) continue; const okI = L.map((n, i) => i).filter(i => r.look(k, i) || base.look?.[k] === i);
        out.attributs[k] = k in sh.LOOK_STYLES ? okI.map(i => `${i}: ${L[i]}`) : attr ? okI.map(i => `${i}: ${L[i]}`) : `couleurs ${okI.length === L.length ? `0 à ${L.length - 1}` : okI.join(', ')} (détail : attribute:"${k}")`; }
      if (!attr) { for (const [slot] of WEAR) { const L = Object.entries(sh.SKINS?.[`vet_${slot}`] || {}).filter(([k]) => r.skin(`vet_${slot}`, k)).map(([k, v]) => ({ cle: k, nom: v.name, va_sur_les_modeles: v.s || 'tous' })); if (L.length) out.skins[slot] = L.slice(0, 60); }
        out.objets_en_main = Object.keys(sh.SKINS || {}).filter(k => !k.startsWith('vet_') && !['sac_a_dos', 'sacoche', 'ordinateur', 'imprimante_3d', 'coque_ophone'].includes(k) && sh.ITEMS?.[k]).map(k => ({ objet: k, nom: sh.ITEMS[k].name, skins: Object.entries(sh.SKINS[k]).filter(([x]) => r.skin(k, x)).map(([x]) => sh.skinModel(k, x)).slice(0, 30) }));
        out.sacs = ['sac_a_dos', 'sacoche'].map(k => ({ sac: k, teintes: '":0" à ":9"', skins: Object.entries(sh.SKINS?.[k] || {}).filter(([x]) => r.skin(k, x)).map(([x]) => `${k}__${x}`) })); }
      return out;
    },
    find(q) { const n = norm(q); if (!n) return null; if (['joueur', 'le joueur', 'moi', 'player', 'me'].includes(n)) return list.find(e => e.me) || null; return list.find(e => e.key === q || String(e.id) === String(q) && e.kind !== 'objet') || list.find(e => norm(e.name) === n) || list.find(e => e.kind !== 'objet' && norm(e.name).includes(n)) || null; },
    open() {
      list = listEntities(S.rec, S.pb?.me, SH().FURNI || {}); sel = null; lastTree = ''; mine.clear();
      if (!mark) { mark = el('div', { class: 'sel-mark', text: '▼' }); $('#overlay').append(mark); } mark.style.display = 'none';
      applyEnts(true); renderTree(true); renderPanel();
    },
    close() { list = []; sel = null; mine.clear(); mark?.remove(); mark = null; renderTree(true); renderPanel(); },
    render() { renderTree(); if (sel) renderPanel(); },
  };
}

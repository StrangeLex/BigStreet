// Big Street Studio — l'animation façon Mine-Imator, côté scène : tout ce qu'on peut ajouter à un record (PNJ, faux joueurs, modèles du
// jeu, lumières, miroirs, textes, groupes) et tout ce qu'on peut animer par images-clés — y compris les entités DU record (un meuble
// qui tombe, une voiture déplacée, un personnage qui lève le bras) et l'éclairage du lieu. Le modèle et ses calculs sont dans
// objets.js (sans DOM ni moteur) ; ici : les objets 3D, la réserve fixe de lumières, les poignées, la section « Éléments » de l'onglet
// Scène, le panneau de réglages, les lignes de la frise (sélection multiple, copier / coller), et ce que l'assistant IA peut faire.
// Rien n'est écrit dans le record : tout va dans le projet (.bsproj, clé « anim »).
import * as O from '/__studio/objets.js';
import { makeMirror } from '/__studio/miroir.js';
import { snapTime, activeCam, span as camSpan } from '/__studio/cams.js';
import * as CAMS from '/__studio/cams.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = ms => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

export function createAnim(S) {
  const { $, el } = S;
  let A = O.emptyAnim(), THREE = null, G = null, sel = null, selKeys = [], clip = null, lastTarget = '?', ghost = null, show = true, veiled = false;
  let pool = null, lampList = [], lampAt = 0, LF = null, depth = 0, liveAt = 0, lampsOpen = false, catalog = null, catOpen = false, tplOpen = false, catQuery = '', vehNames = null;
  const nodes = new Map(), cache = new Map(), touched = new Set(), touchedItems = new Map(), saved = [], live = [];
  let e3 = null, q3 = null, v3 = null, ray = null;
  const SH = () => S.shared() || {};
  const idOf = key => { const r = String(key).slice(2); return /^-?\d+$/.test(r) ? +r : r; };   // (les objets du décor ont parfois un identifiant en lettres : « p7 »)
  const byId = id => A.objs.find(o => o.id === id) || null;
  const byEnt = key => A.objs.find(o => O.entKey(o) === key) || null;
  const changed = (rows = true) => { S.touch(); if (rows) S.renderTracks(); renderTree(); liveAt = 0; };

  // ---------------------------------------------------------------- Ce que dit le record (repère d'une entité non surchargée)
  // Un objet du décor est soit un maillage à lui (itemMeshes), soit une INSTANCE d'un maillage commun à tous les objets du même modèle
  // (world.instanced, userData.ids) : { m, i } — i : son rang dans le maillage commun (undefined : maillage à lui)
  const handles = new Map(); let m4 = null;
  function itemOf(id) {
    const w = S.world; if (!w) return null; const h = handles.get(id);
    if (h && h.m.parent && (h.i === undefined ? w.itemMeshes.get(id) === h.m : h.m.userData.ids?.[h.i] === id)) return h;
    handles.delete(id); const m = w.itemMeshes?.get(id); let r = m ? { m } : null;
    if (!r) for (const im of w.instanced || []) { const i = im.userData.ids ? im.userData.ids.indexOf(id) : -1; if (i >= 0) { r = { m: im, i }; break; } }
    if (r) handles.set(id, r); return r;
  }
  function itemBase(h) {
    const m = h.m;
    if (h.i !== undefined) { const B = m.userData.stBase ||= {}; if (!B[h.i]) { m.getMatrixAt(h.i, m4); B[h.i] = O.decompose(m4.elements); } return B[h.i]; }
    if (!m.userData.stBase) { e3.setFromQuaternion(m.quaternion, 'YXZ'); m.userData.stBase = { x: m.position.x, y: m.position.y, z: m.position.z, rx: e3.x, ry: e3.y, rz: e3.z, sx: m.scale.x, sy: m.scale.y, sz: m.scale.z }; }
    return m.userData.stBase;
  }
  function base(o, t) {
    const k = o.ref[0], id = idOf(o.ref);
    if (k === 'u') { const p = S.rawPos('perso', id, t); return p ? { x: p.x, y: p.y, z: p.z, ry: Math.PI / 2 - p.yaw } : null; }
    if (k === 'v') { const p = S.rawPos('vehicule', id, t); return p ? { x: p.x, y: p.y, z: p.z, ry: p.yaw } : null; }
    const h = THREE ? itemOf(id) : null; if (h) return itemBase(h);
    const e = S.scene?.byKey(o.ref); return e && Number.isFinite(e.x) ? { x: e.x, y: 0, z: e.y } : null;
  }
  const ws = (o, t = S.T) => O.worldAt(A, o, t, base);
  const wsT = o => cache.get(o.id) || ws(o);

  // ---------------------------------------------------------------- Sélection : un élément ajouté (sel) ou une entité du record (panneau Scène)
  /** La cible des poignées et du panneau : { o (l'élément — provisoire tant que rien n'est changé sur une entité du record), key } */
  function target() {
    if (sel) { const o = byId(sel); if (o) return { o, key: O.entKey(o) }; sel = null; }
    const s = S.scene?.sel; if (!s) return null;
    const o = byEnt(s.key); if (o) { if (ghost?.ref === s.key) ghost = null; return { o, key: s.key }; }
    if (!ghost || ghost.ref !== s.key) ghost = { id: '~', kind: 'ref', ref: s.key, name: S.scene.byKey(s.key)?.name || s.key, color: '#9aa7c7', open: false, parent: null, bone: '', st: {}, tracks: {}, clips: [], ghost: true };
    return { o: ghost, key: s.key };
  }
  /** L'élément réel d'une cible : une entité du record reçoit le sien au premier changement */
  function real(o) {
    if (!o?.ghost) return o; const ex = byEnt(o.ref); if (ex) return ex;
    const r = O.newObj(A, 'ref', { ref: o.ref, name: o.name }); lastTarget = `${r.id}|${o.ref}`; return r;
  }
  function select(o, say = true) {
    if (!o) { sel = null; }
    else if (O.entKey(o) && S.scene?.byKey(O.entKey(o))) { sel = null; const key = O.entKey(o); S.scene.select({ key, id: idOf(key) }, false); S.selectCam(null); }
    else { sel = o.id; S.selectCam(null); S.scene?.select(null, false); if (say) S.hint(`${o.name} sélectionné — poignées : L déplacer, R tourner, T taille · K : image-clé`, 3500); }
    selKeys = selKeys.filter(k => k.id === o?.id); lastTarget = '?'; renderTree(); renderPanel(); S.renderTracks();
  }
  /** Retire les surcharges vides (entité du record sélectionnée puis laissée telle quelle) */
  function prune() { const n = A.objs.length; A.objs = A.objs.filter(o => o.kind !== 'ref' || O.keyCount(o) || Object.keys(o.st).length || o.clips?.length || o.parent || A.objs.some(c => c.parent === o.id)); return n !== A.objs.length; }

  // ---------------------------------------------------------------- Personnages ajoutés : de vrais personnages du moteur, glissés dans la relecture
  function defaultLook(npc) {
    const sh = SH(), me = S.rec?.users.get(S.pb?.me)?.desc[0]?.[1]?.look;
    if (!npc && me) return { ...me };
    const look = { ...(sh.DEFAULT_LOOK || {}) }, lists = { ...(sh.LOOK_COLORS || {}), ...(sh.LOOK_STYLES || {}) };
    for (const k of ['gender', 'skin', 'hair', 'hairStyle', 'eyes', 'top', 'shirt', 'bottom', 'pants', 'feet', 'shoes']) { const L = lists[k]; if (!L) continue; const ok = L.map((_, i) => i).filter(i => !sh.isPremium?.(k, i)); if (ok.length) look[k] = ok[Math.floor(Math.random() * ok.length)]; }
    if (look.gender === 0) look.chest = 0; else look.beard = 0;
    return look;
  }
  function syncPersos() {
    const rec = S.rec, pb = S.pb, w = S.world; if (!rec) return false; let ch = false;
    const want = new Map(A.objs.filter(o => o.kind === 'perso').map(o => [o.uid, o]));
    for (const [id] of [...rec.users]) if (id >= O.UID0 && !want.has(id)) { rec.users.delete(id); pb?.users.delete(id); try { w?.removeUser(id); } catch { /* déjà parti */ } ch = true; }
    for (const [uid, o] of want) {
      const K = rec.users.get(uid), sig = JSON.stringify([o.name, o.npc, o.title, o.look]);
      if (K && K.sig === sig) continue;
      const u = { id: uid, name: o.name, npc: o.npc || undefined, title: o.title || undefined, look: { ...(SH().DEFAULT_LOOK || {}), ...o.look }, x: Math.round(o.st.x || 0), y: Math.round(o.st.z || 0), fx: o.st.x || 0, fy: o.st.z || 0, st: 'stand', rot: 0, ang: 0, quiet: true };
      rec.users.set(uid, { desc: [[0, u]], gone: [], t: [0], x: [o.st.x || 0], z: [o.st.z || 0], y: [o.st.y || 0], a: [0], f: [0], i: 0, sig, added: true });
      if (K) { pb?.users.delete(uid); try { w?.removeUser(uid); } catch { /* reconstruit à l'image suivante */ } }
      ch = true;
    }
    return ch;
  }

  // ---------------------------------------------------------------- Objets 3D des éléments ajoutés
  function drop(id) {
    const n = nodes.get(id); if (!n) return; n.dead = true; nodes.delete(id);
    n.node.parent?.remove(n.node); n.mirror?.dispose(); for (const d of n.own || []) { d.geometry?.dispose(); if (d.material) { d.material.map?.dispose(); d.material.dispose(); } }
  }
  const invisible = () => new THREE.MeshBasicMaterial({ visible: false });
  function build(o, n) {
    for (const c of [...n.node.children]) n.node.remove(c); n.mirror?.dispose(); n.mirror = null; n.own = []; n.pick = []; n.help = [];
    const tag = m => { m.userData.stObj = o.id; n.pick.push(m); return m; };
    if (o.kind === 'modele') {
      const want = n.sig;
      G.furniAsset(o.model).then(a => { if (n.dead || n.sig !== want) return; const m = new THREE.Mesh(a.geometry, a.material); m.castShadow = m.receiveShadow = true; n.node.add(tag(m)); })
        .catch(() => { if (n.dead || n.sig !== want) return; const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0xff3d7f })); m.position.y = 0.4; n.own.push(m); n.node.add(tag(m)); if (!n.warned) { n.warned = true; S.toast(`Modèle « ${o.model} » introuvable : un cube le remplace.`, true); } });
    } else if (o.kind === 'miroir') {
      n.mirror = makeMirror(THREE, { w: o.w, h: o.h, q: o.q, tint: o.tint }); n.node.add(tag(n.mirror.mesh));
      const fr = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(o.w + 0.08, o.h + 0.08, 0.05)), new THREE.LineBasicMaterial({ color: 0x1b1b22 })); fr.position.set(0, o.h / 2, -0.03); fr.raycast = () => {}; n.own.push(fr); n.node.add(fr);
      const back = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.08, o.h + 0.08, 0.04), new THREE.MeshLambertMaterial({ color: 0x2a2a33 })); back.position.set(0, o.h / 2, -0.035); n.own.push(back); n.node.add(tag(back));
    } else if (o.kind === 'texte') {
      const cv = document.createElement('canvas'), g = cv.getContext('2d'), lines = String(o.text || ' ').split('\n').slice(0, 6), F = 'bold 110px Poppins, "Segoe UI", Arial, sans-serif';
      g.font = F; const wd = Math.max(40, ...lines.map(l => g.measureText(l).width)); cv.width = Math.min(4096, Math.ceil(wd + 60)); cv.height = lines.length * 132 + 40;
      g.font = F; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = 'rgba(0,0,0,.85)'; g.fillStyle = o.tcolor;
      lines.forEach((l, i) => { const y = 20 + 66 + i * 132; g.strokeText(l, cv.width / 2, y); g.fillText(l, cv.width / 2, y); });
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
      const hgt = o.size * lines.length, m = new THREE.Mesh(new THREE.PlaneGeometry(hgt * cv.width / cv.height, hgt), new THREE.MeshBasicMaterial({ map: tx, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, fog: false }));
      m.position.y = hgt / 2; n.own.push(m); n.node.add(tag(m));
    } else if (o.kind === 'particules') {
      const SP = O.PSPEC[o.ptype], geo = new THREE.BufferGeometry(), pos = new Float32Array(o.count * 3), col = new Float32Array(o.count * 4);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: SP.size * o.psize, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: SP.add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false }));
      pts.frustumCulled = false; pts.raycast = () => {}; n.own.push(pts); n.node.add(pts); n.pts = pts;
      const ico = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.TetrahedronGeometry(0.2)), new THREE.LineBasicMaterial({ color: 0xffd27a, fog: false })); ico.raycast = () => {}; n.own.push(ico); n.help.push(ico); n.node.add(ico);
      const pk = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), invisible()); n.own.push(pk); n.help.push(pk); n.node.add(tag(pk));
    } else if (o.kind === 'lumiere' || o.kind === 'groupe') {
      const col = o.kind === 'groupe' ? 0x9aa7c7 : 0xffe9a8, mat = new THREE.LineBasicMaterial({ color: col, fog: false });
      const ico = new THREE.LineSegments(new THREE.EdgesGeometry(o.kind === 'groupe' ? new THREE.BoxGeometry(0.5, 0.5, 0.5) : new THREE.OctahedronGeometry(0.22)), mat); ico.raycast = () => {};
      n.own.push(ico); n.help.push(ico); n.node.add(ico); n.mat = mat;
      if (o.kind === 'lumiere' && o.ltype !== 'point') { const ln = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.4, 0, 0, -1.4, 0, 0.12, -1.15, 0, 0, -1.4, 0, -0.12, -1.15, 0], 3)), mat); ln.raycast = () => {}; n.own.push(ln); n.help.push(ln); n.node.add(ln); }
      const pk = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), invisible()); n.own.push(pk); n.help.push(pk); n.node.add(tag(pk));
    }
  }
  const sigOf = o => JSON.stringify(o.kind === 'modele' ? [o.model] : o.kind === 'miroir' ? [o.w, o.h, o.q] : o.kind === 'texte' ? [o.text, o.tcolor, o.size] : o.kind === 'lumiere' ? [o.ltype] : o.kind === 'particules' ? [o.ptype, o.count, o.psize] : [0]);
  function nodeOf(o) {
    let n = nodes.get(o.id); const sig = sigOf(o);
    if (!n) { n = { node: new THREE.Group(), sig: null }; n.node.userData.stNode = o.id; nodes.set(o.id, n); }
    if (n.sig !== sig) { n.sig = sig; build(o, n); }
    return n;
  }
  /** L'avatar d'un élément « personnage » (ajouté, ou du record), s'il est construit */
  const avatarOf = o => (O.isChar(o) ? S.world.avatars.get(o.kind === 'perso' ? o.uid : idOf(o.ref)) : null);

  // ---------------------------------------------------------------- Lumières : une réserve FIXE (jamais de shader recompilé en cours de montage)
  function makePool() {
    const w = S.world, mk = (L, n) => Array.from({ length: n }, () => { const l = L(); l.userData.fixed = true; l.userData.stPool = true; if (l.target) { l.target.userData.stPool = true; } return l; });
    pool = { point: mk(() => new THREE.PointLight(0xffffff, 0, 10, 1.4), O.POOL.point), spot: mk(() => new THREE.SpotLight(0xffffff, 0, 16, 0.6, 0.4, 1.2), O.POOL.spot), dir: mk(() => new THREE.DirectionalLight(0xffffff, 0), O.POOL.dir) };
    for (const l of pool.spot) { l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0015; }
    keepPool(w);
  }
  function keepPool(w) { if (pool) for (const L of Object.values(pool)) for (const l of L) { if (l.parent !== w.scene) w.scene.add(l); if (l.target && l.target.parent !== w.scene) w.scene.add(l.target); if (!l.visible) l.visible = true; } }
  // L'éclairage du lieu (lampes, ambiance, soleil) : ses intensités sont multipliées le temps du dessin, puis rendues au moteur — il
  // continue de les régler comme il veut (jour et nuit, clignotements), et aucune lumière n'est retirée (0 = éteinte, pas cachée).
  function hookLighting(w) {
    const sc = w.scene; if (sc.userData.stHook) return; sc.userData.stHook = true;
    const b = sc.onBeforeRender, a = sc.onAfterRender;
    sc.onBeforeRender = function (...args) { b?.apply(this, args); if (depth++ === 0 && LF) dim(); };
    sc.onAfterRender = function (...args) { if (--depth <= 0) { depth = 0; undim(); } a?.apply(this, args); };
  }
  function lamps(w, now, force = false) {
    if (!force && now - lampAt < 1500 && lampList.length) return lampList; lampAt = now; const L = [];
    w.scene.traverse(o => { if (o.isLight && !o.userData.stPool) L.push(o); });
    return (lampList = L);
  }
  function dim() {
    // (les lampes du lieu sont souvent des lumières « prêtées » : le moteur déplace à chaque image un petit nombre fixe de lumières vers
    // les lampes les plus proches — une lampe se reconnaît donc à sa place AU MOMENT du dessin, pas à l'objet lumière)
    const per = LF.lampes.size > 0;
    for (const l of lampList) {
      if (!l.visible) continue; let one = null;
      if (per && (l.isPointLight || l.isSpotLight)) { const e = l.matrixWorld.elements; one = LF.lampes.get(O.lightKey(e[12], e[13], e[14])) || null; }
      const kind = l.isAmbientLight || l.isHemisphereLight ? LF.amb : l.isDirectionalLight ? LF.sun : LF.lamps;
      const f = LF.expo * kind * (one ? one.k : 1), t = LF.tint, c = l.color;
      saved.push(l, l.intensity, c.r, c.g, c.b);
      l.intensity *= f; c.r *= t[0] * (one ? one.tint[0] : 1); c.g *= t[1] * (one ? one.tint[1] : 1); c.b *= t[2] * (one ? one.tint[2] : 1);
    }
  }
  function undim() { for (let i = 0; i < saved.length; i += 5) { const l = saved[i]; l.intensity = saved[i + 1]; l.color.setRGB(saved[i + 2], saved[i + 3], saved[i + 4]); } saved.length = 0; }
  /** Les lampes du lieu (ponctuelles et projecteurs), les plus proches de la vue d'abord : [{ key, type, x, y, z, intensite, couleur, eteinte, reglee }] */
  function sceneLamps(max = 40, around = null) {
    const w = S.world; if (!w || !THREE) return []; const c = around || S.cam, seen = new Set(), out = [];
    for (const l of lamps(w, performance.now(), true)) { if (!(l.isPointLight || l.isSpotLight) || !l.visible || !(l.intensity > 0)) continue; l.getWorldPosition(v3); const k = O.lightKey(v3.x, v3.y, v3.z); if (seen.has(k)) continue; seen.add(k); const p = [v3.x, v3.y, v3.z], o = A.objs.find(x => x.kind === 'lampe' && x.lkey === k);
      out.push({ key: k, type: l.isSpotLight ? 'projecteur' : 'ponctuelle', x: +p[0].toFixed(1), y: +p[1].toFixed(1), z: +p[2].toFixed(1), intensite: +l.intensity.toFixed(2), couleur: '#' + l.color.getHexString(), d: Math.hypot(p[0] - c.x, p[2] - c.z), eteinte: !!o && O.chanAt(o, 'lm', S.T) < 0.02, reglee: !!o, nom: o?.name || '' }); }
    for (const o of A.objs) if (o.kind === 'lampe' && !seen.has(o.lkey)) { const p = o.lkey.split(',').map(Number); out.push({ key: o.lkey, type: 'ponctuelle', x: p[0], y: p[1], z: p[2], intensite: 0, couleur: '#ffffff', d: Math.hypot(p[0] - c.x, p[2] - c.z), eteinte: O.chanAt(o, 'lm', S.T) < 0.02, reglee: true, nom: o.name, absente: true }); }
    return out.sort((a, b) => a.d - b.d).slice(0, max);
  }
  const ambiance = (create = false) => A.objs.find(o => o.kind === 'ambiance') || (create ? O.newObj(A, 'ambiance') : null);
  function lampObj(key, create = false) { let o = A.objs.find(x => x.kind === 'lampe' && x.lkey === key); if (!o && create) { const n = A.objs.filter(x => x.kind === 'lampe').length + 1; o = O.newObj(A, 'lampe', { lkey: key, name: `Lampe ${n}` }); } return o || null; }

  // ---------------------------------------------------------------- À chaque image
  function wrap(a) {
    if (a._stWrap) return; a._stWrap = true; const up = a.update;
    a.update = function (now, t) { const r = up.call(this, now, t); const st = this._st; if (st) { place(this, st); bones(this, st); } return r; };
  }
  function place(a, st) {
    const p = a.group.position; if (st.p[0] != null) p.x = st.p[0]; if (st.p[1] != null) p.y = st.p[1]; if (st.p[2] != null) p.z = st.p[2];
    if (st.rot) { a.ang = a.targetAng = 0; if (a.fpLocal) a.fpLocal.ang = 0; a.body.rotation.y = 0; a.group.rotation.set(st.rot[0], st.rot[1], st.rot[2], 'YXZ'); a._stRot = true; }
    else if (a._stRot) { a._stRot = false; a.group.rotation.set(0, 0, 0); }
    if (st.scl) { a.group.scale.set(st.scl[0], st.scl[1], st.scl[2]); a._stScl = true; } else if (a._stScl) { a._stScl = false; a.group.scale.set(1, 1, 1); }
    if (!st.vis) { a.zoneHidden = true; if (a.group.visible) a.group.visible = false; a._stHid = true; }
    else if (a._stHid) { a._stHid = false; if (!S.scene?.isHidden(st.key)) { a.zoneHidden = false; a.group.visible = true; a._tagVis = null; } }
  }
  // (les os : après la pose du moteur. Tête et bras suivent le buste — le moteur l'a déjà fait avec SA rotation du buste : on la défait,
  // on pose nos rotations, puis on refait suivre)
  function bones(a, st) {
    const B = st.bones, b = a.rig?.bones; if (!b || !b.corps) return; let any = false; for (const k in B) { any = true; break; } if (!any) return;
    const follow = ['tete', 'bras_g', 'bras_d'], c = b.corps, still = !c.rotation.x && !c.rotation.y && !c.rotation.z;
    if (!still) { q3.copy(c.quaternion).invert(); for (const k of follow) if (b[k]) b[k].quaternion.premultiply(q3); }
    for (const ch in B) { const [bn, ax] = ch.split('.'), o = b[bn]; if (o) o.rotation[ax] = B[ch]; }
    const hip = c.position, moved = c.rotation.x || c.rotation.y || c.rotation.z;
    for (const k of follow) { const o = b[k]; if (!o) continue; const p0 = o.userData.p0 ??= o.position.clone(); if (!moved) { o.position.copy(p0); continue; } o.position.copy(p0).sub(hip).applyQuaternion(c.quaternion).add(hip); o.quaternion.premultiply(c.quaternion); }
  }
  function release(a) { a._st = null; if (a._stRot) { a._stRot = false; a.group.rotation.set(0, 0, 0); } if (a._stScl) { a._stScl = false; a.group.scale.set(1, 1, 1); } if (a._stHid) { a._stHid = false; a.zoneHidden = false; a.group.visible = true; a._tagVis = null; } if (a._stClip) { a._stClip = false; a.em = null; a.emo = null; } }
  function applyChar(o, W, T, w) {
    const a = avatarOf(o); if (!a || W.lost) return; wrap(a); touched.add(a); a._stSeen = true;
    const full = o.kind === 'perso' || !!o.parent, set = ch => full || O.isSet(o, ch);
    const st = a._st = { key: O.entKey(o), p: [set('x') ? W.x : null, set('y') ? W.y : null, set('z') ? W.z : null], rot: full || O.ROT.some(c => O.isSet(o, c)) ? [W.rx, W.ry, W.rz] : null, scl: full || O.SCL.some(c => O.isSet(o, c)) ? [W.sx, W.sy, W.sz] : null, bones: O.bonesAt(o, T), vis: W.vis };
    if (o.kind === 'perso') {   // (il marche quand ses clés le déplacent, tourné vers où il va)
      const P0 = T >= 120 ? ws(o, T - 120) : W, dx = W.x - P0.x, dz = W.z - P0.z, sp = Math.hypot(dx, dz) / 0.12, moving = o.walk && sp > 0.3;
      if (moving && o.face && !O.isAnimated(o, 'ry')) st.rot[1] = Math.atan2(dx, dz);
      const L = a._stLast, fwd = L && T > L[2] && T - L[2] < 500, step = fwd ? Math.min(0.6, Math.hypot(W.x - L[0], W.z - L[1])) : 0; a._stLast = [W.x, W.z, T];   // (le temps avance — lecture ou export image par image — : la foulée suit la distance)
      a.route = null; a.fpLocal = moving ? { moving: true, step, ang: 0, run: sp > 4.2, at: 0 } : null;
    }
    const c0 = O.clipAt(o, T), c = c0 && c0.id === 'coucou' ? null : c0, d = c && SH().EMOTE_SHOP?.[c.id];
    if (c0 && c0.id === 'coucou' && c0.at < 2600) a.waveUntil = performance.now() + 250;   // (« coucou » : le salut de la main du jeu, 2,6 s)
    if (d) { const at = performance.now() - c.at; if (d.dur) { a.em = null; a.emo = c.at < d.dur * 1000 ? { id: c.id, at } : null; } else { a.em = c.id; a.emAt = at; a.emo = null; } a._stClip = true; }
    else if (a._stClip) { a._stClip = false; a.em = null; a.emo = null; }
    place(a, st);
  }
  function applyItem(o, W, w) {
    const id = idOf(o.ref), h = itemOf(id); if (!h) return; itemBase(h); touchedItems.set(id, h); h.seen = true; const m = h.m;
    if (h.i !== undefined) {   // (instance : sa matrice dans le maillage commun ; cachée = taille nulle)
      const k = W.vis && !S.scene?.isHidden(o.ref) ? 1 : 0, sig = `${W.x},${W.y},${W.z},${W.rx},${W.ry},${W.rz},${W.sx * k},${W.sy * k},${W.sz * k}`; if (h.sig === sig) return; h.sig = sig;
      m4.fromArray(O.compose({ ...W, sx: W.sx * k, sy: W.sy * k, sz: W.sz * k })); m.setMatrixAt(h.i, m4); m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.computeBoundingBox?.(); return;
    }
    m.position.set(W.x, W.y, W.z); m.rotation.set(W.rx, W.ry, W.rz, 'YXZ'); m.scale.set(W.sx, W.sy, W.sz);
    if (!W.vis) { if (m.visible) { m.visible = false; w.fogCulled?.delete(m); } m.userData.stHid = true; } else if (m.userData.stHid) { m.userData.stHid = false; if (!S.scene?.isHidden(o.ref)) m.visible = true; }
    m.updateMatrix(); m.updateMatrixWorld(true);
  }
  function restoreItem(h) {
    const m = h.m; if (!m.parent) return;
    if (h.i !== undefined) { const B = m.userData.stBase?.[h.i]; if (B) { m4.fromArray(O.compose(B)); m.setMatrixAt(h.i, m4); m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } h.sig = null; return; }
    const B = m.userData.stBase; if (B) { m.position.set(B.x, B.y, B.z); m.rotation.set(B.rx, B.ry, B.rz, 'YXZ'); m.scale.set(B.sx, B.sy, B.sz); m.updateMatrix(); m.updateMatrixWorld(true); } if (m.userData.stHid) { m.userData.stHid = false; m.visible = true; }
  }
  function applyVeh(o, W, w) {
    const V = w.pvs?.get(idOf(o.ref)); if (!V) return; const set = ch => !!o.parent || O.isSet(o, ch);
    if (set('x')) V.x = V.tx = W.x; if (set('z')) V.y = V.ty = W.z; if (set('ry')) V.ang = V.tang = W.ry; V.v = 0;
    V._st = { y: set('y') ? W.y : null, rx: W.rx, rz: W.rz, rot: set('rx') || set('rz'), scl: O.SCL.some(c => O.isSet(o, c)) ? [W.sx, W.sy, W.sz] : null, vis: W.vis, seen: true };
  }
  function hookVeh(w) {
    if (w._stPv) return; w._stPv = true; const up = w.pvUpdate;
    w.pvUpdate = function (dt) { up.call(this, dt); if (this.pvs) for (const V of this.pvs.values()) { const s = V._st, m = V.mesh; if (!s || !m) continue;
      if (s.y != null) m.position.y = s.y; if (s.rot) { m.rotation.x = s.rx; m.rotation.z = s.rz; s.did = true; } else if (s.did) { m.rotation.x = m.rotation.z = 0; s.did = false; }
      if (s.scl) { m.scale.set(...s.scl); V._stScl = true; } else if (V._stScl) { V._stScl = false; m.scale.set(1, 1, 1); }
      if (!s.vis) { m.visible = false; V._stHid = true; } else if (V._stHid) { V._stHid = false; m.visible = true; } } };
  }
  /** À chaque image, après la relecture (pb.step) et avant le dessin. shown : les repères (lumières, groupes) se voient */
  function tick(now, shown) {
    const w = S.world, pb = S.pb; if (!w || !pb || !THREE) return; const T = S.T; show = shown; cache.clear(); depth = 0; if (saved.length) undim();
    keepPool(w); hookVeh(w); hookLighting(w);
    if (sel && (S.selCam() || S.scene?.sel)) { sel = null; lastTarget = '?'; }
    const tg = target(), tk = tg ? `${tg.o.id}|${tg.key}` : ''; if (tk !== lastTarget) { lastTarget = tk; if (!tg) ghost = null; selKeys = selKeys.filter(k => k.id === tg?.o.id); renderPanel(); renderTree(); S.renderTracks(); }
    const used = { point: 0, spot: 0, dir: 0 }; let mirrors = 0;
    for (const a of touched) a._stSeen = false; for (const h of touchedItems.values()) h.seen = false; if (w.pvs) for (const V of w.pvs.values()) if (V._st) V._st.seen = false;
    for (const o of A.objs) {
      if (O.noTR(o)) continue;
      const W = O.worldAt(A, o, T, base); cache.set(o.id, W);
      if (O.isChar(o)) { applyChar(o, W, T, w); continue; }
      if (o.kind === 'ref') { if (W.lost) continue; if (o.ref[0] === 'i') applyItem(o, W, w); else applyVeh(o, W, w); continue; }
      const n = nodeOf(o), nd = n.node, pa = o.bone && o.parent ? byId(o.parent) : null, av = pa && avatarOf(pa), bone = av?.rig?.bones?.[o.bone] || null;
      const L = bone ? W.local : W, home = bone || w.scene; if (nd.parent !== home) home.add(nd);
      nd.position.set(L.x, L.y, L.z); nd.rotation.set(L.rx, L.ry, L.rz, 'YXZ'); nd.scale.set(L.sx, L.sy, L.sz); nd.visible = bone ? L.vis >= 0.5 : W.vis;
      if (o.kind === 'texte' && o.face) nd.quaternion.copy(w.camera.quaternion);
      for (const h of n.help || []) h.visible = show && !veiled;
      if (o.kind === 'particules' && n.pts && W.vis) { const g = n.pts.geometry; O.particlesAt(o, T, g.attributes.position.array, g.attributes.color.array); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; }
      if (o.kind === 'miroir') { n.mirror.setTint(o.tint); n.mirror.mesh.userData.off = ++mirrors > O.MAX.miroir; }
      if (o.kind === 'lumiere') {
        const l = pool[o.ltype][used[o.ltype]++]; n.over = !l; if (!l) continue;
        const g = c => O.chanAt(o, c, T), on = W.vis ? g('li') : 0; nd.visible = true; for (const h of n.help) h.visible = show && !veiled;
        nd.updateMatrixWorld(true); const e = nd.matrixWorld.elements; l.position.set(e[12], e[13], e[14]); l.color.setRGB(g('cr'), g('cg'), g('cb')); l.intensity = on;
        if (n.mat) n.mat.color.copy(l.color).lerp(new THREE.Color(0xffffff), W.vis ? 0.25 : 0).multiplyScalar(W.vis ? 1 : 0.35);
        if (l.target) { const k = Math.hypot(e[4], e[5], e[6]) || 1; l.target.position.set(e[12] - e[4] / k, e[13] - e[5] / k, e[14] - e[6] / k); l.target.updateMatrixWorld(); }
        if (!l.isDirectionalLight) l.distance = g('lr'); if (l.isSpotLight) { l.angle = g('la'); l.penumbra = o.penumbra; if (l.castShadow !== !!o.shadow) l.castShadow = !!o.shadow; }
      }
    }
    // (un objet du décor masqué par l'œil du panneau Scène, quand il est une instance d'un maillage commun : sa taille passe à zéro)
    for (const key of S.ents.hidden) if (key[0] === 'i' && !byEnt(key)) { const id = idOf(key), h = itemOf(id); if (!h || h.i === undefined) continue; const B = itemBase(h); touchedItems.set(id, h); h.seen = true;
      if (h.sig !== 'hid') { h.sig = 'hid'; m4.fromArray(O.compose({ ...B, sx: 0, sy: 0, sz: 0 })); h.m.setMatrixAt(h.i, m4); h.m.instanceMatrix.needsUpdate = true; } }
    for (const t of Object.keys(pool)) for (let i = used[t]; i < pool[t].length; i++) { const l = pool[t][i]; if (l.intensity) l.intensity = 0; if (l.castShadow) l.castShadow = false; }
    for (const id of [...nodes.keys()]) if (!byId(id) || O.isChar(byId(id)) || byId(id).kind === 'ref') drop(id);
    for (const a of [...touched]) if (!a._stSeen) { release(a); touched.delete(a); }
    for (const [id, h] of [...touchedItems]) if (!h.seen) { restoreItem(h); touchedItems.delete(id); }
    if (w.pvs) for (const V of w.pvs.values()) if (V._st && !V._st.seen) { V._st.vis = true; V._st.scl = null; V._st.rot = false; V._st.y = null; }
    LF = O.lightingAt(A, T); if (LF) lamps(w, now);
    // (tremblement : ajouté à la pose de la caméra à l'antenne — vue caméra, cinématique, export —, recalculée à chaque image par studio.js)
    const sk = (S.mode === 'cam' || S.mode === 'cine') ? O.shakeAt(A, T) : null; if (sk) { const c = S.cam; for (const k of ['x', 'y', 'z', 'yaw', 'roll']) c[k] += sk[k]; c.pitch = clamp(c.pitch + sk.pitch, -1.55, 1.55); }
    followHead(); tickAudio(T);
    // (calque 2D : fondus — seulement à travers une caméra — et titres ; redessiné quand il change)
    { const ov = overlay(T, S.mode === 'cam' || S.mode === 'cine'), sig = ov ? JSON.stringify(ov) + ovCv.clientWidth + 'x' + ovCv.clientHeight : '';
      if (sig !== ovSig) { ovSig = sig; const cw = ovCv.clientWidth || 16, chh = ovCv.clientHeight || 9; if (ovCv.width !== cw || ovCv.height !== chh) { ovCv.width = cw; ovCv.height = chh; } const g = ovCv.getContext('2d'); g.clearRect(0, 0, cw, chh); O.paintOverlay(g, cw, chh, ov); } }
    if (now - liveAt > 180) { liveAt = now; for (const f of live) { try { f(); } catch { /* champ retiré */ } } }
  }

  // ---------------------------------------------------------------- Poignées (celles des caméras, prêtées à l'élément sélectionné)
  const ext = {
    get noScale() { return false; },
    get() {
      const t = target(); if (!t || O.noTR(t.o) || S.mode === 'cam' || S.mode === 'cine') return null;
      if (t.o.bone && t.o.parent) return null;   // (tenu par un os : se règle dans le panneau)
      const W = wsT(t.o); if (!W || W.lost) return null;
      q3.setFromEuler(e3.set(W.rx, W.ry, W.rz, 'YXZ'));
      return { p: [W.x, W.y, W.z], q: [q3.x, q3.y, q3.z, q3.w], s: [W.sx, W.sy, W.sz] };
    },
    drag() { /* (le projet est enregistré par studio.js à la fin du geste) */ },
    change(mode, proxy) {
      const t = target(); if (!t) return; const o = real(t.o), W = ws(o); e3.setFromQuaternion(proxy.quaternion, 'YXZ');
      const want = { ...W, ...(mode === 'translate' ? { x: proxy.position.x, y: proxy.position.y, z: proxy.position.z } : mode === 'rotate' ? { rx: e3.x, ry: e3.y, rz: e3.z } : { sx: Math.abs(proxy.scale.x) || 0.01, sy: Math.abs(proxy.scale.y) || 0.01, sz: Math.abs(proxy.scale.z) || 0.01 }) };
      const L = O.toLocal(O.compose(want), W.parent, W.local), chs = mode === 'translate' ? O.POS : mode === 'rotate' ? O.ROT : O.SCL;
      for (const ch of chs) if (Math.abs(L[ch] - W.local[ch]) > 1e-6) O.setParam(o, ch, L[ch], S.T, { auto: A.auto });
      cache.delete(o.id); liveAt = 0;
    },
  };

  // ---------------------------------------------------------------- Clic dans la vue
  function rayAt(x, y) { const r = S.giz.ray(x, y); ray.set(v3.set(...r.o), new THREE.Vector3(...r.d)); return ray; }
  /** L'élément ajouté sous le pointeur, ou null */
  function pick(x, y) {
    if (!THREE || !S.giz || !nodes.size) return null; const L = []; for (const [id, n] of nodes) { const o = byId(id); if (o && n.node.visible) for (const m of n.pick || []) if (m.visible !== false && (show || !n.help?.includes(m))) L.push(m); }
    const hit = rayAt(x, y).intersectObjects(L, false)[0]; return hit ? byId(hit.object.userData.stObj) : null;
  }
  /** L'objet du décor (du record) sous le pointeur : { key, id } — pas les bâtiments (Alt : eux aussi) */
  function pickItem(x, y, all = false) {
    const w = S.world; if (!THREE || !w?.itemGroup) return null;
    const hits = rayAt(x, y).intersectObjects(w.itemGroup.children, true);
    for (const h of hits) { if (h.distance > 60) break; let m = h.object, id = null; if (m.isInstancedMesh && h.instanceId !== undefined) id = m.userData.ids?.[h.instanceId]; else { while (m && m.userData.itemId == null) m = m.parent; id = m?.userData.itemId; } if (id == null || !m.visible) continue; if (m.userData.building && !all) return null; const key = `i:${id}`; return S.scene?.byKey(key) ? { key, id } : null; }
    return null;
  }

  // ---------------------------------------------------------------- Ajouter
  function front(d = 3.5, up = 0) {
    const c = S.cam, x = c.x + Math.cos(c.yaw) * d, z = c.z + Math.sin(c.yaw) * d; let y = 0; try { y = S.world.heightAt(Math.round(x), Math.round(z)) || 0; } catch { y = 0; }
    if (!Number.isFinite(y) || Math.abs(y - c.y) > 8) y = c.y - 1.6;
    return { x: Math.round(x * 100) / 100, y: Math.round((y + up) * 100) / 100, z: Math.round(z * 100) / 100, ry: Math.atan2(c.x - x, c.z - z) };
  }
  /** Ajoute un élément (devant la vue si pose n'est pas donnée) ; rend l'élément, ou { error } */
  function add(kind, props = {}, pose = null, pickIt = true) {
    if (!S.pb) return { error: 'aucun record ouvert' };
    if (kind === 'lumiere') { const t = O.LTYPES[props.ltype] ? props.ltype : 'point'; if (A.objs.filter(o => o.kind === 'lumiere' && o.ltype === t).length >= O.POOL[t]) return { error: `maximum atteint : ${O.POOL[t]} lumière${O.POOL[t] > 1 ? 's' : ''} de ce type (la réserve est fixe, pour ne jamais figer l’image)` }; }
    if (kind === 'miroir' && A.objs.filter(o => o.kind === 'miroir').length >= O.MAX.miroir) return { error: `maximum atteint : ${O.MAX.miroir} miroirs (chaque miroir redessine toute la scène)` };
    if (kind === 'perso' && A.objs.filter(o => o.kind === 'perso').length >= O.MAX.perso) return { error: `maximum atteint : ${O.MAX.perso} personnages ajoutés` };
    const P = pose || front(kind === 'lumiere' ? 3 : 3.5, kind === 'lumiere' ? (props.ltype === 'dir' ? 6 : 2.6) : kind === 'texte' ? 1.2 : 0); if (kind === 'lumiere' || kind === 'groupe') P.ry = pose?.ry || 0;
    if (kind === 'perso' && !props.look) props = { ...props, look: defaultLook(props.npc !== false) };
    if (kind === 'perso' && !props.name) props = { ...props, name: props.npc === false ? 'Figurant' : 'PNJ' };
    if (kind === 'modele' && !props.label) props = { ...props, label: SH().FURNI?.[props.model]?.name || props.model };
    const o = O.newObj(A, kind, props, P); if (!o) return { error: 'trop d’éléments dans ce projet' };
    if (kind === 'perso') { syncPersos(); S.scene?.relist?.(); }
    if (pickIt) select(o); changed(); return o;
  }
  function remove(o) {
    if (!o) return; const W = c => ws(c);
    O.removeObj(A, o, (c, change) => { const w0 = W(c); change(); const L = O.toLocal(w0.m, null, w0.local); for (const ch of [...O.POS, ...O.ROT, ...O.SCL]) { delete c.tracks[ch]; c.st[ch] = L[ch]; } });
    if (sel === o.id) sel = null; selKeys = selKeys.filter(k => k.id !== o.id);
    if (o.kind === 'perso') { if (S.scene?.sel?.key === `u:${o.uid}`) S.scene.select(null, false); delete S.ents.over[`u:${o.uid}`]; S.ents.hidden = S.ents.hidden.filter(k => k !== `u:${o.uid}`); syncPersos(); S.scene?.relist?.(); }
    lastTarget = '?'; changed(); renderPanel();
  }
  function duplicate(o) { const c = O.dupObj(A, o); if (!c) return null; if (c.kind === 'perso') { const ov = S.ents.over[`u:${o.uid}`]; if (ov) S.ents.over[`u:${c.uid}`] = JSON.parse(JSON.stringify(ov)); syncPersos(); S.scene?.relist?.(); S.scene?.applyEnts?.(true); } select(c); changed(); return c; }
  /** Change le parent d'un élément sans qu'il bouge (ses clés sont converties à leur instant) */
  function setParent(o, parentId, bone = '') {
    if (parentId && (parentId === o.id || O.wouldLoop(A, o, parentId))) return false;
    const times = [...new Set([S.T, ...O.keyTimes(o, [...O.POS, ...O.ROT, ...O.SCL])])], W0 = times.map(t => ws(o, t));
    o.parent = parentId || null; o.bone = parentId && O.isChar(byId(parentId)) ? bone : '';
    if (!o.bone) times.forEach((t, i) => { const p = o.parent ? ws(byId(o.parent), t).m : null, L = O.toLocal(W0[i].m, p, W0[i].local); for (const ch of [...O.POS, ...O.ROT, ...O.SCL]) { const K = o.tracks[ch], j = O.keyAt(K, t, 0); if (K && j >= 0) K[j].v = L[ch]; else if (!K?.length && t === S.T) o.st[ch] = L[ch]; } });
    else { for (const ch of [...O.POS, ...O.ROT]) { delete o.tracks[ch]; o.st[ch] = 0; } o.st.y = -0.55; }   // (dans la main : au bout du bras)
    changed(); renderPanel(); return true;
  }
  /** K : image-clé de la position, de la rotation et de l'échelle de la cible à l'instant courant (aux valeurs du moment) */
  function keyPose(chs = null) {
    const t = target(); if (!t || !S.pb) return false; const o = real(t.o), T = Math.round(S.T);
    if (O.noTR(o)) { for (const ch of O.channelsOf(o)) O.setKey(o, ch, T, O.chanAt(o, ch, T)); }
    else { const W = ws(o); for (const ch of chs || [...O.POS, ...O.ROT]) O.setKey(o, ch, T, W.local[ch]); for (const ch of O.SCL) if (!chs && (o.tracks[ch]?.length || Math.abs(W.local[ch] - 1) > 1e-6)) O.setKey(o, ch, T, W.local[ch]); }
    selKeys = [{ id: o.id, ch: null, t: T }]; S.hint(`Clé posée sur ${o.name} à ${fmt(T)}.`, 2200); changed(); renderPanel(); return true;
  }
  function toggleKey(o0, ch) {
    const o = real(o0), T = Math.round(S.T), L = o.tracks[ch], i = O.keyAt(L, T);
    if (i >= 0) O.delAt(o, ch, L[i].t); else { const v = O.noTR(o) || ch.includes('.') || O.LIGHT_CH.includes(ch) ? (O.chanAt(o, ch, T) ?? 0) : ws(o).local[ch]; O.setKey(o, ch, T, v); }
    changed(); renderPanel();
  }
  function edit(o0, ch, v) { const o = real(o0); O.setParam(o, ch, v, S.T, { auto: A.auto }); cache.delete(o.id); S.touch(); return o; }
  function frame(o) {
    if (O.noTR(o)) return; const W = ws(o); if (W.lost) return S.hint('Cette entité n’est pas là à cet instant.', 2500);
    if (S.mode !== 'free') S.setMode('free'); const c = S.cam, w = S.world, a0 = Math.atan2(c.z - W.z, c.x - W.x);
    const big = o.kind === 'miroir' ? Math.max(3, o.w * 1.4) : 4, ty = W.y + (o.kind === 'lumiere' ? 0 : 0.9); let best = null;
    // (du côté de la vue d'abord ; dans un bâtiment, sans passer derrière un mur — un miroir : de face)
    for (const da of o.kind === 'miroir' ? [0] : [0, Math.PI / 2, -Math.PI / 2, Math.PI]) { const a = o.kind === 'miroir' ? Math.PI / 2 - W.ry : a0 + da; let d = big; const at = k => [W.x + Math.cos(a) * k, W.z + Math.sin(a) * k];
      while (d > 1.2 && w.room && !w.room.outdoor && !w.isFloor(Math.round(at(d)[0]), Math.round(at(d)[1]))) d -= 0.4;
      if (!best || d > best.d + 0.3) best = { d, x: at(d)[0], z: at(d)[1] }; if (best.d >= big - 0.1) break; }
    const y = ty + best.d * 0.28;
    Object.assign(c, { x: best.x, z: best.z, y, yaw: Math.atan2(W.z - best.z, W.x - best.x), pitch: Math.atan2(ty - y, Math.hypot(W.x - best.x, W.z - best.z)), roll: 0 });
  }

  // ---------------------------------------------------------------- Onglet Scène : la section « Éléments »
  const treeBox = el('div', { class: 'an-box' }), panel = el('div', { class: 'panel an-panel', hidden: '' });
  $('#tabScene').insertBefore(treeBox, $('#sceneTree')); $('#stage').append(panel);
  for (const b of [treeBox, panel]) b.addEventListener('keydown', e => { if (e.target.matches?.('input, select, textarea')) { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && !e.target.matches('textarea'))) e.target.blur(); } });
  const btn = (text, title, onclick, cls = 'btn small') => el('button', { class: cls, title, text, onclick });
  function fail(r) { if (r?.error) { S.toast(r.error, true); return true; } return false; }
  function loadCatalog() {
    if (catalog) return catalog; const sh = SH(), L = [];
    for (const [type, d] of Object.entries(sh.FURNI || {})) if (d && !d.building && !d.variantOf) L.push({ type, name: d.name || type, cat: 'Mobilier et décor' });
    for (const [type, d] of Object.entries(sh.FURNI || {})) if (d?.building) L.push({ type, name: d.name || type, cat: 'Bâtiments' });
    for (const [type, d] of Object.entries(sh.VEHICLES || {})) L.push({ type, name: d.name || type, cat: 'Véhicules' });
    for (const [type, d] of Object.entries(sh.ITEMS || {})) if (!sh.FURNI?.[type] && d) L.push({ type: sh.itemModel ? (sh.itemModel(type) || type) : type, name: d.name || type, cat: 'Objets' });
    const seen = new Set(); catalog = L.filter(m => !seen.has(m.type) && seen.add(m.type)).sort((a, b) => a.cat.localeCompare(b.cat, 'fr') || a.name.localeCompare(b.name, 'fr'));
    return catalog;
  }
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function searchCatalog(q, max = 60) { const n = norm(q).trim().split(/\s+/).filter(Boolean); return loadCatalog().filter(m => { const h = norm(`${m.name} ${m.type} ${m.cat}`); return n.every(w => h.includes(w)); }).slice(0, max); }
  function renderTree() {
    if (!S.rec || !S.pb) { treeBox.replaceChildren(); return; }
    const tg = target(), kids = [];
    kids.push(el('div', { class: 'an-add' },
      btn('＋ PNJ', 'Ajouter un PNJ devant la vue', () => fail(add('perso', { npc: true }))), btn('＋ Joueur', 'Ajouter un faux joueur (il prend d’abord l’apparence du joueur enregistré ; ses vêtements se règlent comme ceux des autres personnages, avec les skins de ton compte)', () => fail(add('perso', { npc: false }))),
      btn('＋ Objet', 'Ajouter un modèle du jeu : meuble, véhicule, objet, bâtiment', () => { catOpen = !catOpen; renderTree(); if (catOpen) setTimeout(() => treeBox.querySelector('.an-cat input')?.focus(), 30); }, 'btn small' + (catOpen ? ' on' : '')),
      btn('＋ Lumière', 'Ajouter une lumière ponctuelle (ampoule)', () => fail(add('lumiere', { ltype: 'point' }))), btn('＋ Spot', 'Ajouter un projecteur (cône de lumière, vers le bas par défaut)', () => fail(add('lumiere', { ltype: 'spot' }))), btn('＋ Soleil', 'Ajouter une lumière directionnelle', () => fail(add('lumiere', { ltype: 'dir' }))),
      btn('＋ Particules', 'Ajouter des particules : fumée, feu, étincelles, pluie, neige, confettis (le type se choisit dans ses réglages)', () => fail(add('particules', { ptype: 'fumee' }))),
      btn('＋ Son', 'Importer une musique ou un son (mp3, ogg, wav…) : il est posé sur la frise à l’instant courant, avec sa forme d’onde ; volume animable', () => fileIn.click()),
      btn('＋ Titre', 'Ajouter un titre ou un sous-titre à l’écran (2D, par-dessus l’image, inclus dans l’export) — il apparaît à l’instant courant', () => fail(add('titre', { text: 'Titre', pos: 'centre', t0: Math.round(S.T), t1: Math.min(Math.round(S.rec.dur), Math.round(S.T) + 3000) }))),
      btn('＋ Miroir', 'Ajouter un miroir (reflet réel de la scène)', () => fail(add('miroir', {}))), btn('＋ Texte', 'Ajouter un texte dans la scène (titre, panneau)', () => fail(add('texte', { text: 'Titre' }))), btn('🎞 Modèle', 'Modèles de projets : un montage tout fait (caméras, fondus, titre) sur le personnage sélectionné — sinon le joueur enregistré —, à retoucher ensuite', () => { tplOpen = !tplOpen; renderTree(); }, 'btn small' + (tplOpen ? ' on' : '')), btn('＋ Groupe', 'Ajouter un repère vide : parent d’autres éléments, pour les déplacer ensemble', () => fail(add('groupe', {})))));
    if (tplOpen) kids.push(el('div', { class: 'an-cat' }, ...Object.entries(O.TEMPLATES).map(([k, t]) => el('div', { class: 'an-cat-row', title: t, onclick: () => { const r = template(k); tplOpen = false; renderTree(); if (r.error) S.toast(`Modèle : ${r.error}`, true); else S.toast(`🎞 ${r.cams.length} plans posés${r.subject ? ` sur ${r.subject}` : ''} — P : prévisualiser · Ctrl+Z : annuler.`); } }, el('span', { text: t })))));
    if (catOpen) {
      const list = el('div', { class: 'an-cat-list' }), fill = () => { const R = searchCatalog(catQuery); list.replaceChildren(...(R.length ? R.map(m => el('div', { class: 'an-cat-row', title: `${m.cat} — ${m.type}`, onclick: () => { fail(add('modele', { model: m.type, label: m.name })); } }, el('span', { text: m.name }), el('small', { text: m.cat }))) : [el('div', { class: 'none', text: 'Aucun modèle ne correspond.' })])); };
      const inp = el('input', { placeholder: 'Chercher un modèle (chaise, voiture, lampadaire…)', spellcheck: 'false', value: catQuery, oninput: e => { catQuery = e.target.value; fill(); } }); fill();
      kids.push(el('div', { class: 'an-cat' }, inp, list));
    }
    const amb = ambiance(), row = (o, depth, extra = null) => {
      const on = tg?.o === o, hid = !O.noTR(o) && (O.chanAt(o, 'vis', S.T) ?? 1) < 0.5, n = O.keyCount(o);
      return el('div', { class: 'sc-row an-row' + (on ? ' sel' : '') + (hid ? ' hid' : ''), style: `padding-left:${8 + depth * 14}px`, title: `${O.KINDS[o.kind]} — ${o.name}\nClic : sélectionner · double-clic : cadrer`, onclick: () => select(o), ondblclick: () => frame(o) },
        el('span', { class: 'nm' }, `${O.ICONS[o.kind]} ${o.name}`, n ? el('small', { class: 'chg', text: ` ◆ ${n}` }) : null, extra),
        O.noTR(o) ? null : el('button', { class: 'eye', title: hid ? 'Caché : cliquer pour le montrer' : 'Visible : cliquer pour le cacher', text: hid ? '🚫' : '👁', onclick: e => { e.stopPropagation(); edit(o, 'vis', hid ? 1 : 0); changed(); renderPanel(); } }));
    };
    kids.push(el('div', { class: 'sc-group an-group' }, el('span', { text: '🎬 Éléments ajoutés et animés' }), el('small', { text: String(A.objs.filter(o => !O.noTR(o)).length) })));
    kids.push(amb ? row(amb, 0) : el('div', { class: 'sc-row an-row', style: 'padding-left:8px', title: 'Luminosité générale, lumière ambiante, soleil, lampes du lieu — réglables et animables', onclick: () => { select(ambiance(true)); changed(); } }, el('span', { class: 'nm', text: '🌗 Éclairage de la scène' })));
    const fxo = A.objs.find(o => o.kind === 'effets'); kids.push(fxo ? row(fxo, 0) : el('div', { class: 'sc-row an-row', style: 'padding-left:8px', title: 'Tremblement de caméra (à l’épaule, choc) — réglable et animable', onclick: () => { select(O.newObj(A, 'effets')); changed(); } }, el('span', { class: 'nm', text: '🎥 Effets de caméra' })));
    for (const { o, depth } of O.tree(A)) if (!O.noTR(o)) kids.push(row(o, depth, o.kind === 'ref' ? el('small', { text: ' (du record)' }) : null));
    const LS = lampsOpen ? sceneLamps(30) : [];
    kids.push(el('div', { class: 'sc-group an-group', onclick: () => { lampsOpen = !lampsOpen; renderTree(); } }, el('span', { class: 'tw', text: lampsOpen ? '▾' : '▸' }), el('span', { text: '🔆 Lumières du lieu' }), el('small', { text: lampsOpen ? String(LS.length) : '' })));
    if (lampsOpen) {
      if (!LS.length) kids.push(el('div', { class: 'sc-more', text: 'Aucune lampe ponctuelle allumée près d’ici : ce lieu est éclairé par sa lumière ambiante et sa lumière principale — règle-les dans « Éclairage de la scène ». (Néons, lampadaires et lampes torches apparaissent ici quand ils sont allumés.)' }));
      for (const l of LS) { const o = lampObj(l.key);
        kids.push(el('div', { class: 'sc-row an-row' + (o && tg?.o === o ? ' sel' : '') + (l.eteinte ? ' hid' : ''), title: `${l.type} en ${l.x}, ${l.y}, ${l.z} — à ${Math.round(l.d)} m de la vue\nClic : la régler (intensité, couleur, images-clés)`, onclick: () => { select(lampObj(l.key, true)); changed(); } },
          el('i', { class: 'dot', style: `background:${l.couleur}` }), el('span', { class: 'nm' }, o?.name || `Lampe à ${Math.round(l.d)} m`, el('small', { text: ` ${l.x}, ${l.z}` })),
          el('button', { class: 'eye', title: l.eteinte ? 'Éteinte : cliquer pour la rallumer' : 'Allumée : cliquer pour l’éteindre', text: l.eteinte ? '⚫' : '💡', onclick: e => { e.stopPropagation(); edit(lampObj(l.key, true), 'lm', l.eteinte ? 1 : 0); changed(); renderPanel(); } }))); }
    }
    treeBox.replaceChildren(...kids);
  }

  // ---------------------------------------------------------------- Panneau de réglages de la cible
  const kd = (o, ch) => { const b = el('button', { class: 'kd', title: 'Image-clé de ce réglage à l’instant courant : poser / retirer', text: '◆', onclick: e => { e.preventDefault(); e.stopPropagation(); toggleKey(o, ch); } }); live.push(() => { const L = cur(o).tracks[ch], on = O.keyAt(L, S.T) >= 0, an = (L?.length || 0) > 1; if (b.classList.contains('on') !== on) b.classList.toggle('on', on); if (b.classList.contains('anim') !== an) b.classList.toggle('anim', an); }); return b; };
  const cur = o => (o.ghost ? byEnt(o.ref) || o : byId(o.id) || o);
  /** Un champ numérique lié à un canal (k : facteur d'affichage, ex. degrés) ; glisser sur son nom fait varier la valeur */
  function field(o, ch, label, k = 1, d = 2, step = 0.05, read = null) {
    const inp = el('input', { type: 'number', step: String(step) }), val = () => { const c = cur(o); if (read) return read(c); const v = O.chanAt(c, ch, S.T); return v != null ? v : (O.noTR(c) ? 0 : (wsT(c)?.local?.[ch] ?? 0)); };
    inp.oninput = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { edit(cur(o), ch, v / k); S.renderTracks(); } };
    live.push(() => { if (document.activeElement === inp) return; const v = (val() * k).toFixed(d); if (inp.value !== v) inp.value = v; });
    const name = el('span', { class: 'drag', text: label, title: 'Glisser : faire varier (Maj : plus fin)' });
    name.addEventListener('pointerdown', e => { e.preventDefault(); let x = e.clientX, v = parseFloat(inp.value) || 0; const mv = ev => { v += (ev.clientX - x) * step * (ev.shiftKey ? 0.1 : 1); x = ev.clientX; inp.value = v.toFixed(d); inp.oninput(); }; const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); changed(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
    inp.onchange = () => changed();
    return el('label', {}, el('span', { class: 'fl' }, name, kd(o, ch)), inp);
  }
  function slider(o, ch, label, min, max, step, k = 1, unit = '') {
    const out = el('b'), inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    inp.oninput = () => { edit(cur(o), ch, +inp.value / k); out.textContent = `${(+inp.value).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}${unit}`; }; inp.onchange = () => changed();
    live.push(() => { const v = (O.chanAt(cur(o), ch, S.T) ?? 0) * k; if (document.activeElement !== inp && Math.abs(+inp.value - v) > step / 2) inp.value = String(v); const tx = `${v.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}${unit}`; if (out.textContent !== tx) out.textContent = tx; });
    return el('label', { class: 'sl' }, el('span', { class: 'fl' }, label, kd(o, ch), out), inp);
  }
  function colorField(o, label = 'Couleur') {
    const inp = el('input', { type: 'color' }); inp.oninput = () => { const c = O.hexRgb(inp.value); ['cr', 'cg', 'cb'].forEach((ch, i) => edit(cur(o), ch, c[i])); }; inp.onchange = () => changed();
    live.push(() => { const c = cur(o), h = O.rgbHex(O.chanAt(c, 'cr', S.T), O.chanAt(c, 'cg', S.T), O.chanAt(c, 'cb', S.T)); if (document.activeElement !== inp && inp.value !== h) inp.value = h; });
    return el('label', { class: 'row2' }, el('span', { class: 'fl' }, label, kd(o, 'cr'), kd(o, 'cg'), kd(o, 'cb')), inp);
  }
  const text = (label, value, set, attrs = {}) => { const inp = el(attrs.area ? 'textarea' : 'input', { spellcheck: 'false', ...(attrs.max ? { maxlength: String(attrs.max) } : {}), ...(attrs.type ? { type: attrs.type, step: attrs.step || 'any' } : {}) }); inp.value = value; inp.onchange = () => { set(inp.value); changed(); renderPanel(); }; return el('label', { class: 'row2' }, el('span', { text: label }), inp); };
  const choice = (label, opts, value, set) => { const s = el('select', { onchange: e => { set(e.target.value); changed(); renderPanel(); } }, ...opts.map(([v, t]) => el('option', { value: String(v), text: t, ...(String(v) === String(value) ? { selected: '' } : {}) }))); return el('label', { class: 'row2' }, el('span', { text: label }), s); };
  const check = (label, value, set, title = '') => { const c = el('input', { type: 'checkbox' }); c.checked = !!value; c.onchange = () => { set(c.checked); changed(); renderPanel(); }; return el('label', { class: 'row', title }, c, ` ${label}`); };
  /** Les réglages de la cible : nœuds à mettre dans un panneau (le nôtre, ou celui d'une entité du record — scene.js) */
  function sections(o, own) {
    const out = [], h = t => el('h4', { text: t }), isRef = o.kind === 'ref', ch = O.isChar(o);
    if (own) out.push(el('div', { class: 'p-title' }, el('b', { class: 'e-name', text: `${O.ICONS[o.kind]} ${o.name}` }), el('span', { class: 'e-kind', text: o.kind === 'lumiere' ? O.LTYPES[o.ltype] : O.KINDS[o.kind] })),
      el('div', { class: 'p-btns' }, O.noTR(o) ? null : btn('🎯 Cadrer', 'Amener la vue devant cet élément (double-clic dans la liste)', () => frame(o)), O.noTR(o) || isRef ? null : btn('Dupliquer', 'Copie avec toutes ses clés (Ctrl+D)', () => duplicate(o)), btn(O.noTR(o) ? '↺ Réinitialiser' : '🗑 Supprimer', 'Ctrl+Z pour annuler', () => { remove(o); S.toast(`${o.name} ${O.noTR(o) ? 'réinitialisé' : 'supprimé'} — Ctrl+Z pour annuler.`); }, 'btn small danger')),
      text('Nom', o.name, v => { o.name = v.slice(0, 60) || O.KINDS[o.kind]; if (o.kind === 'perso') { syncPersos(); S.scene?.relist?.(); } }, { max: 60 }));
    if (o.kind === 'ambiance') {
      out.push(el('small', { class: 'muted', text: 'L’éclairage du lieu rejoué : 1 = comme dans le record, 0 = éteint. Tout est animable (◆) : une pièce qui s’assombrit, une coupure de courant, un lever de soleil…' }),
        slider(o, 'expo', 'Luminosité de la scène', 0, 3, 0.05), slider(o, 'amb', 'Lumière ambiante', 0, 4, 0.05), slider(o, 'sun', 'Lumière principale (soleil, lune, plafond)', 0, 4, 0.05), slider(o, 'lamps', 'Lampes du lieu', 0, 5, 0.05), colorField(o, 'Teinte'),
        el('div', { class: 'p-btns' }, btn('Nuit américaine', 'Ambiance sombre et bleutée', () => preset(o, { expo: 0.35, amb: 0.8, sun: 0.5, lamps: 1.3, cr: 0.62, cg: 0.74, cb: 1 })), btn('Tamisé', 'Lumière basse et chaude', () => preset(o, { expo: 0.6, amb: 0.7, sun: 0.7, lamps: 1, cr: 1, cg: 0.86, cb: 0.7 })), btn('Noir', 'Tout éteint', () => preset(o, { expo: 0.04 })), btn('Plein feu', 'Très lumineux', () => preset(o, { expo: 1.6, amb: 1.3 })), btn('Normal', 'Comme dans le record', () => preset(o, {}))));
      return out.concat(keySection(o));
    }
    if (o.kind === 'audio') { const ok0 = AU.bufs.get(o.hash); if (ok0 === undefined) bufferOf(o.hash);
      out.push(el('small', { class: ok0 === null ? 'p-parent err' : 'muted', text: ok0 === null ? `Le fichier « ${o.file} » n’est pas sur cet ordinateur : réimporte-le (＋ Son), puis supprime cette piste.` : `${o.file || 'Son'} — ${(o.dur / 1000).toFixed(1)} s` }),
        el('div', { class: 'p-grid' }, text('Début s', (o.t0 / 1000).toFixed(2), v => { o.t0 = Math.round(clamp(+v || 0, 0, S.rec.dur / 1000) * 1000); stopAudio(o.id); }, { type: 'number', step: '0.1' }), text('Passe le début s', (o.off / 1000).toFixed(2), v => { o.off = Math.round(clamp(+v || 0, 0, o.dur / 1000) * 1000); stopAudio(o.id); }, { type: 'number', step: '0.1' })),
        slider(o, 'vol', 'Volume', 0, 2, 0.02), el('div', { class: 'p-btns' }, btn('Début ici', 'Le son démarre à l’instant courant', () => { o.t0 = Math.round(S.T); stopAudio(o.id); changed(); renderPanel(); }),
          btn('Fondu d’entrée', 'Volume de 0 à 1 sur la première seconde', () => { const r = cur(o); O.setKey(r, 'vol', o.t0, 0, 'doux'); O.setKey(r, 'vol', o.t0 + 1000, 1); changed(); }), btn('Fondu de sortie ici', 'Le volume tombe à 0 pendant les deux secondes qui précèdent l’instant courant', () => { const r = cur(o), t = Math.round(S.T); O.setKey(r, 'vol', Math.max(0, t - 2000), O.chanAt(r, 'vol', t - 2000), 'doux'); O.setKey(r, 'vol', t, 0); changed(); })),
        el('small', { class: 'muted', text: 'Le son suit la lecture (et sa vitesse). Il est inclus dans les vidéos WebM exportées à vitesse 1× ; les autres formats sont muets.' })); return out.concat(keySection(o)); }
    if (o.kind === 'titre') { out.push(text('Texte', o.text, v => { o.text = v.slice(0, 300); }, { area: true, max: 300 }), choice('Place', Object.entries(O.TPOS), o.pos, v => { o.pos = v; }), text('Couleur', o.tcolor, v => { o.tcolor = v; }, { type: 'color' }),
        el('div', { class: 'p-grid' }, text('Taille %', String(o.size), v => { o.size = clamp(+v || 4.5, 1, 40); }, { type: 'number', step: '0.5' }), text('Début s', (o.t0 / 1000).toFixed(2), v => { o.t0 = Math.round(clamp(+v || 0, 0, S.rec.dur / 1000) * 1000); }, { type: 'number', step: '0.1' }), text('Fin s', (o.t1 / 1000).toFixed(2), v => { o.t1 = Math.round(clamp(+v || 0, 0, S.rec.dur / 1000) * 1000); }, { type: 'number', step: '0.1' })),
        text('Fondu s', (o.fadeMs / 1000).toFixed(2), v => { o.fadeMs = Math.round(clamp(+v || 0, 0, 10) * 1000); }, { type: 'number', step: '0.1' }), check('Bandeau sombre derrière le texte', o.box, v => { o.box = v; }),
        el('div', { class: 'p-btns' }, btn('Début ici', 'Le titre apparaît à l’instant courant', () => { o.t0 = Math.round(S.T); if (o.t1 && o.t1 <= o.t0) o.t1 = Math.min(S.rec.dur, o.t0 + 3000); changed(); renderPanel(); }), btn('Fin ici', 'Le titre disparaît à l’instant courant (fin à 0 : jusqu’au bout)', () => { o.t1 = Math.round(S.T); changed(); renderPanel(); })),
        slider(o, 'op', 'Opacité', 0, 1, 0.02), slider(o, 'tsz', 'Grossissement', 0.2, 4, 0.02), slider(o, 'tx', 'Décalage X', -60, 60, 0.5, 1, ' %'), slider(o, 'ty', 'Décalage Y', -60, 60, 0.5, 1, ' %'),
        el('small', { class: 'muted', text: 'Titre en 2D, par-dessus l’image : visible ici et dans la vidéo exportée. Opacité, grossissement et décalage sont animables (◆) : un titre qui glisse, grossit, s’efface.' })); return out.concat(keySection(o)); }
    if (o.kind === 'effets') { out.push(el('small', { class: 'muted', text: 'Tremblement de la caméra à l’antenne (vue caméra, cinématique, export) : caméra à l’épaule, choc, explosion. Animable (◆) : une clé à 0, une à 1 au moment du choc, une à 0 après.' }), slider(o, 'shake', 'Tremblement', 0, 1, 0.02), slider(o, 'shakef', 'Fréquence', 0.5, 30, 0.5, 1, ' Hz'), slider(o, 'fade', 'Fondu au noir', 0, 1, 0.02), slider(o, 'flash', 'Éclair blanc', 0, 1, 0.02),
        slider(o, 'speed', 'Vitesse du temps', 0.05, 4, 0.05, 1, '×'),
        el('div', { class: 'p-btns' }, btn('Ralenti ici', 'Le temps passe à 0,25× pendant la seconde qui suit l’instant courant, puis revient à 1×', () => { const r = cur(o), t = Math.round(S.T); O.setKey(r, 'speed', Math.max(0, t - 150), 1, 'doux'); O.setKey(r, 'speed', t, 0.25, 'fixe'); O.setKey(r, 'speed', Math.min(S.rec.dur, t + 1000), 0.25, 'doux'); O.setKey(r, 'speed', Math.min(S.rec.dur, t + 1300), 1); changed(); }),
          btn('Image figée ici (1 s)', 'L’image s’arrête une seconde à l’instant courant, puis repart', () => { const r = cur(o), t = Math.round(S.T); r.holds = [...(r.holds || []).filter(h => Math.abs(h.t - t) > 40), { t, ms: 1000 }].sort((a, b) => a.t - b.t); changed(); renderPanel(); }), btn('Temps normal', 'Retire ralentis et images figées', () => { const r = cur(o); O.clearChan(r, 'speed'); r.st.speed = 1; r.holds = []; changed(); renderPanel(); })),
        ...(o.holds || []).map(h => el('div', { class: 'an-clip' }, el('span', { text: `Image figée à ${fmt(h.t)} — ${(h.ms / 1000).toFixed(1)} s`, onclick: () => S.seek(h.t) }), el('button', { class: 'eye', text: '✕', title: 'Retirer', onclick: () => { const r = cur(o); r.holds = r.holds.filter(x => x !== h); changed(); renderPanel(); } }))),
        text('Fondu au noir à chaque changement de plan (s, 0 = coupe franche)', (o.cutfade / 1000).toFixed(2), v => { o.cutfade = Math.round(clamp(+v || 0, 0, 5) * 1000); }, { type: 'number', step: '0.1' }),
        el('div', { class: 'p-btns' }, btn('Ouverture au noir', 'Noir à 0 s, image à 1 s', () => { const r = cur(o); O.setKey(r, 'fade', 0, 1, 'doux'); O.setKey(r, 'fade', Math.min(1000, S.rec.dur), 0); changed(); }), btn('Fermeture au noir ici', 'L’image s’éteint pendant la seconde qui précède l’instant courant', () => { const r = cur(o), t = Math.round(S.T); O.setKey(r, 'fade', Math.max(0, t - 1000), 0, 'doux'); O.setKey(r, 'fade', t, 1); changed(); })),
        el('div', { class: 'p-btns' }, btn('Épaule', 'Léger, lent', () => { edit(o, 'shake', 0.18); edit(o, 'shakef', 2.5); changed(); }), btn('Choc', 'Fort, rapide', () => { edit(o, 'shake', 0.8); edit(o, 'shakef', 14); changed(); }), btn('Aucun', '', () => { edit(o, 'shake', 0); changed(); }))); return out.concat(keySection(o)); }
    if (o.kind === 'lampe') { const p = o.lkey.split(',');
      out.push(el('small', { class: 'muted', text: `Une lampe du lieu, en ${p[0]} / ${p[1]} / ${p[2]}. Son intensité est un multiple de celle du record : 1 = inchangée, 0 = éteinte.` }), slider(o, 'lm', 'Intensité (× d’origine)', 0, 5, 0.05), colorField(o, 'Teinte'),
        el('div', { class: 'p-btns' }, btn('Éteindre', '', () => { edit(o, 'lm', 0); changed(); }), btn('Allumer', '', () => { edit(o, 'lm', 1); changed(); })));
      return out.concat(keySection(o));
    }
    const held = !!(o.bone && o.parent);
    out.push(h(isRef ? 'Animation — position, rotation, échelle' : 'Position, rotation, échelle'));
    if (isRef) out.push(el('small', { class: 'muted', text: 'Glisse les poignées (L déplacer · R tourner · T taille) ou écris une valeur : ce réglage remplace alors le record. ◆ pose une image-clé ; deux clés à deux instants = un mouvement (une chute, une porte qui s’ouvre…).' }));
    out.push(el('div', { class: 'p-grid' }, field(o, 'x', 'X', 1, 2, 0.05), field(o, 'y', 'Y', 1, 2, 0.05), field(o, 'z', 'Z', 1, 2, 0.05),
      field(o, 'ry', 'Cap °', R2D, 1, 1), field(o, 'rx', 'Tangage °', R2D, 1, 1), field(o, 'rz', 'Roulis °', R2D, 1, 1),
      field(o, 'sx', 'Taille X', 1, 2, 0.02), field(o, 'sy', 'Taille Y', 1, 2, 0.02), field(o, 'sz', 'Taille Z', 1, 2, 0.02)));
    const vis = el('input', { type: 'checkbox' }); vis.onchange = () => { edit(cur(o), 'vis', vis.checked ? 1 : 0); changed(); }; live.push(() => { const v = (O.chanAt(cur(o), 'vis', S.T) ?? 1) >= 0.5; if (vis.checked !== v) vis.checked = v; });
    const uni = el('input', { type: 'number', step: '0.05', min: '0.01', title: 'Taille uniforme : la même sur les trois axes' }); uni.oninput = () => { const v = parseFloat(uni.value); if (v > 0) { for (const c of O.SCL) edit(cur(o), c, v); S.renderTracks(); } }; uni.onchange = () => changed();
    live.push(() => { if (document.activeElement === uni) return; const W = wsT(cur(o)), v = W ? W.local.sx.toFixed(2) : '1.00'; if (uni.value !== v) uni.value = v; });
    out.push(el('div', { class: 'an-line' }, el('label', { class: 'row' }, vis, ' Visible ', kd(o, 'vis')), el('label', { class: 'row' }, 'Taille ', uni)));
    out.push(el('div', { class: 'p-btns' }, btn('◆ Clé (K)', 'Image-clé de la position et de la rotation à l’instant courant', () => keyPose()), btn(A.auto ? '⏺ Clé auto : oui' : '⏺ Clé auto : non', 'Clé automatique : chaque déplacement pose une image-clé à l’instant courant (comme dans Mine-Imator). Sinon, un élément sans animation reste fixe quand on le déplace.', () => { A.auto = !A.auto; changed(); renderPanel(); }, 'btn small' + (A.auto ? ' on' : '')),
      isRef ? btn('↺ Comme le record', 'Retire toutes les surcharges et les clés de cette entité', () => { const r = byId(o.id); if (r) { A.objs = A.objs.filter(x => x !== r); for (const c of A.objs) if (c.parent === r.id) { c.parent = null; c.bone = ''; } } lastTarget = '?'; changed(); renderPanel(); }, 'btn small danger') : null));
    // Parent
    const others = A.objs.filter(x => x !== o && !O.noTR(x) && !O.wouldLoop(A, o, x.id)), par = o.parent ? byId(o.parent) : null;
    if (!o.ghost) { out.push(h('Parent'), choice('Attaché à', [['', 'Rien (libre dans la scène)'], ...others.map(x => [x.id, `${O.ICONS[x.kind]} ${x.name}`])], o.parent || '', v => { setParent(o, v || null, ''); }));
      if (par && O.isChar(par) && !ch) out.push(choice('Tenu par', [['', 'Le personnage (à ses pieds)'], ...O.BONES.map(([b, n]) => [b, n])], o.bone, v => setParent(o, o.parent, v)));
      if (held) out.push(el('small', { class: 'muted', text: 'Tenu par un os : X / Y / Z et les angles sont relatifs à cet os (Y négatif = vers la main ou le pied).' })); }
    // Réglages propres à chaque type
    if (o.kind === 'lumiere') {
      out.push(h('Lumière'), choice('Type', Object.entries(O.LTYPES), o.ltype, v => { if (v !== o.ltype && A.objs.filter(x => x.kind === 'lumiere' && x.ltype === v).length >= O.POOL[v]) return S.toast(`Maximum atteint : ${O.POOL[v]} lumière(s) de ce type.`, true); o.ltype = v; }), colorField(o),
        slider(o, 'li', 'Intensité', 0, o.ltype === 'dir' ? 8 : 60, 0.1), o.ltype === 'dir' ? null : slider(o, 'lr', 'Portée', 1, 80, 0.5, 1, ' m'), o.ltype === 'spot' ? slider(o, 'la', 'Angle du cône', 3, 85, 1, R2D, '°') : null);
      if (o.ltype === 'spot') { const pn = el('input', { type: 'range', min: '0', max: '1', step: '0.05' }); pn.value = String(o.penumbra); pn.oninput = () => { o.penumbra = +pn.value; S.touch(); }; out.push(el('label', { class: 'sl' }, el('span', { class: 'fl', text: 'Bord doux (pénombre)' }), pn),
        check('Ombres portées', o.shadow, v => { o.shadow = v; if (v) S.hint('Ombres de ce projecteur : l’image se fige une seconde, le temps de préparer les ombres.', 4000); }, 'Ce projecteur projette des ombres. Changer ce réglage recalcule les matériaux une fois (court gel) — à faire avant d’animer.')); }
      if (o.ltype !== 'point') out.push(el('small', { class: 'muted', text: 'Elle éclaire vers le bas ; tourne-la (R) pour viser ailleurs.' }));
      if (nodes.get(o.id)?.over) out.push(el('small', { class: 'p-parent err', text: 'Réserve de lumières dépassée : celle-ci n’éclaire pas.' }));
    }
    if (o.kind === 'miroir') out.push(h('Miroir'), el('div', { class: 'p-grid' }, text('Largeur m', String(o.w), v => { o.w = clamp(+v || 2, 0.2, 30); }, { type: 'number', step: '0.1' }), text('Hauteur m', String(o.h), v => { o.h = clamp(+v || 2, 0.2, 30); }, { type: 'number', step: '0.1' })),
      text('Teinte', o.tint, v => { o.tint = v; }, { type: 'color' }), choice('Qualité du reflet', [[256, 'Basse (rapide)'], [512, 'Normale'], [1024, 'Haute'], [2048, 'Très haute (lent)']], o.q, v => { o.q = +v; }),
      el('small', { class: 'muted', text: 'Le miroir reflète vraiment la scène (elle est dessinée une fois de plus) : deux miroirs au plus. Il se regarde de face.' }));
    if (o.kind === 'texte') out.push(h('Texte'), text('Texte', o.text, v => { o.text = v.slice(0, 200); }, { area: true, max: 200 }), text('Couleur', o.tcolor, v => { o.tcolor = v; }, { type: 'color' }), text('Hauteur m', String(o.size), v => { o.size = clamp(+v || 1, 0.1, 30); }, { type: 'number', step: '0.1' }), check('Toujours face à la caméra', o.face, v => { o.face = v; }));
    if (o.kind === 'particules') out.push(h('Particules'), choice('Type', Object.entries(O.PTYPES), o.ptype, v => { o.ptype = v; }), text('Nombre', String(o.count), v => { o.count = Math.round(clamp(+v || 150, 10, 1500)); }, { type: 'number', step: '10' }), text('Taille (×)', String(o.psize), v => { o.psize = clamp(+v || 1, 0.1, 10); }, { type: 'number', step: '0.1' }),
      text('Étendue m', String(o.spread), v => { o.spread = clamp(+v || 1, 0.05, 100); }, { type: 'number', step: '0.5' }), text('Couleur', o.pcolor || O.PSPEC[o.ptype].color || '#ffffff', v => { o.pcolor = v; }, { type: 'color' }),
      el('small', { class: 'muted', text: 'Les particules suivent l’instant de la frise (pause, retour arrière, export : même image). Clés « visible » pour les faire démarrer ou s’arrêter ; la taille de l’élément agrandit la zone.' }));
    if (o.kind === 'modele') out.push(h('Modèle'), el('small', { class: 'muted', text: `${SH().FURNI?.[o.model]?.name || o.model} (${o.model})` }));
    if (o.kind === 'perso') out.push(h('Personnage'), text('Nom', o.name, v => { o.name = v.slice(0, 60) || 'PNJ'; syncPersos(); S.scene?.relist?.(); }, { max: 60 }), text('Titre', o.title, v => { o.title = v.slice(0, 40); syncPersos(); S.scene?.relist?.(); }, { max: 40 }), check('PNJ (sinon : faux joueur)', o.npc, v => { o.npc = v; syncPersos(); S.scene?.relist?.(); }),
      check('Marche quand il se déplace', o.walk, v => { o.walk = v; }, 'Quand ses clés de position le déplacent, il marche (ou court s’il va vite) au lieu de glisser'), check('Se tourne vers où il va', o.face, v => { o.face = v; }, 'Sauf si son cap est animé par des clés'),
      el('div', { class: 'p-btns' }, btn('🗑 Supprimer ce personnage', 'Ctrl+Z pour annuler', () => remove(o), 'btn small danger'), btn('Dupliquer', '', () => duplicate(o))));
    if (ch) out.push(...charSection(o));
    return out.concat(keySection(o));
  }
  function preset(o, v) { for (const ch of O.AMB_CH) edit(o, ch, v[ch] ?? 1); changed(); }
  // (personnages : bibliothèque de poses, rotation de chaque os, animations du jeu)
  function charSection(o) {
    const out = [el('h4', { text: 'Pose (os par os)' })], pick = el('select', {}, ...Object.entries(O.POSES).map(([k, p]) => el('option', { value: k, text: p.label })));
    out.push(el('label', { class: 'row2' }, el('span', { text: 'Bibliothèque' }), pick), el('div', { class: 'p-btns' },
      btn('◆ Appliquer ici', 'Pose des clés sur tous les os à l’instant courant : entre deux poses à deux instants, le personnage passe de l’une à l’autre', () => { const r = real(cur(o)); O.applyPose(r, pick.value, Math.round(S.T), true); changed(); renderPanel(); }),
      btn('Fixe', 'Applique la pose sans clé (le personnage la garde tout le temps)', () => { const r = real(cur(o)); O.clearPose(r); O.applyPose(r, pick.value, 0, false); changed(); renderPanel(); }),
      btn('↺ Retirer', 'Retire toute pose : le personnage retrouve ses mouvements du jeu', () => { const r = real(cur(o)); O.clearPose(r); changed(); renderPanel(); }, 'btn small danger')));
    for (const [b, name] of O.BONES) out.push(el('div', { class: 'an-bone' }, el('b', { text: name }), ...['x', 'y', 'z'].map(a => field(o, `${b}.${a}`, a.toUpperCase(), R2D, 0, 1))));
    out.push(el('small', { class: 'muted', text: 'Un os sans valeur suit le jeu (marche, gestes). Bras : X négatif = levé devant ; Z = écarté du corps.' }));
    const em = [['coucou', { icon: '👋', name: 'Coucou (salut de la main)', dur: 2.6 }], ...Object.entries(SH().EMOTE_SHOP || {})], esel = el('select', {}, ...em.map(([k, d]) => el('option', { value: k, text: `${d.icon || ''} ${d.name}${d.dur ? ` (${d.dur} s)` : ' (en boucle)'}` })));
    out.push(el('h4', { text: 'Animations du jeu' }), el('label', { class: 'row2' }, el('span', { text: 'Animation' }), esel), el('div', { class: 'p-btns' },
      btn('▶ Lancer ici', 'L’animation démarre à l’instant courant', () => { const r = real(cur(o)); O.setClip(r, S.T, esel.value); changed(); renderPanel(); }), btn('⏹ Arrêt ici', 'L’animation en cours s’arrête à l’instant courant', () => { const r = real(cur(o)); O.setClip(r, S.T, ''); changed(); renderPanel(); })));
    for (const c of o.clips || []) out.push(el('div', { class: 'an-clip' }, el('span', { text: `${fmt(c.t)} — ${c.id ? (c.id === 'coucou' ? 'Coucou' : SH().EMOTE_SHOP?.[c.id]?.name || c.id) : 'arrêt'}`, onclick: () => S.seek(c.t) }), el('button', { class: 'eye', text: '✕', title: 'Retirer', onclick: () => { O.delClip(cur(o), c.t); changed(); renderPanel(); } })));
    return out;
  }
  function keySection(o) {
    const mine = selKeys.filter(k => k.id === o.id), out = [el('h4', {}, 'Images-clés ', el('small', { class: 'muted', text: mine.length ? `${mine.length} sélectionnée${mine.length > 1 ? 's' : ''}` : `${O.keyCount(o)} au total` }))];
    if (mine.length) {
      const first = mine[0], ez = el('select', { onchange: e => { for (const k of mine) O.easeAt(cur(o), k.ch, k.t, e.target.value); changed(); } }, ...Object.entries(O.EASES).map(([v, t]) => el('option', { value: v, text: t, ...(O.easeOf(o, first.ch, first.t) === v ? { selected: '' } : {}) })));
      const tt = el('input', { type: 'number', step: '0.1', min: '0' }); tt.value = (first.t / 1000).toFixed(2); tt.onchange = () => { const dt = Math.round((+tt.value || 0) * 1000) - first.t; selKeys = O.shiftKeys(cur(o), mine, dt, S.rec.dur).map(k => ({ id: o.id, ...k })); changed(); renderPanel(); };
      out.push(el('div', { class: 'p-grid' }, el('label', {}, el('span', { text: 'Instant s' }), tt), el('label', { class: 'wide' }, el('span', { text: 'Courbe vers la suivante' }), ez)),
        el('div', { class: 'p-btns' }, btn('Copier', 'Ctrl+C', () => copy()), btn('Coller', 'Colle à l’instant courant (Ctrl+V)', () => paste()), btn('Supprimer', 'Suppr', () => delKeys(), 'btn small danger')));
    } else out.push(el('small', { class: 'muted', text: 'Clique une clé sur la frise pour la régler (Ctrl ou Maj + clic : plusieurs ; Ctrl+C / Ctrl+V : copier / coller ; glisser : déplacer).' }), clip ? el('div', { class: 'p-btns' }, btn('Coller ici', 'Colle les clés copiées à l’instant courant (Ctrl+V)', () => paste())) : null);
    return out;
  }
  function renderPanel() {
    live.length = 0; const t = target();
    const own = !!t && !!sel; panel.hidden = !own || !S.pb;
    panel.replaceChildren(...(own && S.pb ? sections(t.o, true) : []));
    if (!own && t && S.scene?.sel) S.scene.render?.(); liveAt = 0;
  }
  /** La section ajoutée au panneau d'une entité du record (scene.js) */
  function entExtra(e) { const t = target(); if (!t || sel || t.key !== e.key) return []; live.length = 0; liveAt = 0; return sections(t.o, false); }

  // ---------------------------------------------------------------- Frise : une ligne par élément, dépliable en une ligne par canal
  function keysOf(o) { return selKeys.filter(k => k.id === o.id); }
  const isSel = (o, ch, t) => selKeys.some(k => k.id === o.id && k.t === t && (k.ch == null || ch == null || k.ch === ch));
  function lane(o, ch, dur) {
    const tg = target(), on = tg?.o === o, times = ch ? o.tracks[ch].map(k => k.t) : O.keyTimes(o);
    const L = el('div', { class: 'lane' + (ch ? ' sub' : '') + (on && !ch ? ' sel' : ''), title: ch ? 'Double-clic : poser une clé de ce réglage à cet instant' : 'Double-clic : poser une clé à cet instant' }); L.style.setProperty('--c', o.color);
    for (let i = 0; i + 1 < times.length; i++) { const cut = (ch ? o.tracks[ch][i].ease : O.easeOf(o, null, times[i])) === 'fixe', b = el('div', { class: 'bar' + (cut ? ' cut' : '') }); b.style.left = `${times[i] / dur * 100}%`; b.style.width = `${(times[i + 1] - times[i]) / dur * 100}%`; L.append(b); }
    if (!ch && (o.kind === 'audio' || o.kind === 'titre')) {   // (bloc du son — avec sa forme d'onde — ou du titre : glisser = le déplacer dans le temps)
      const a = o.t0, b = o.kind === 'audio' ? o.t0 + o.dur - o.off : (o.t1 > o.t0 ? o.t1 : dur), blk = el(o.kind === 'audio' ? 'canvas' : 'div', { class: 'an-block', title: `${o.name} — de ${fmt(a)} à ${fmt(b)} (glisser pour déplacer)` });
      blk.style.left = `${a / dur * 100}%`; blk.style.width = `${Math.max(0.3, (Math.min(b, dur) - a) / dur * 100)}%`;
      if (o.kind === 'audio') { const P = AU.peaks.get(o.hash); if (P === undefined && AU.bufs.get(o.hash) === undefined) bufferOf(o.hash); blk.width = 1200; blk.height = 24; if (P) { const g = blk.getContext('2d'), i0 = Math.floor(o.off / Math.max(1, o.dur) * P.length); g.fillStyle = o.color; for (let x = 0; x < 1200; x++) { const v = P[Math.min(P.length - 1, i0 + Math.floor(x / 1200 * (P.length - i0)))] || 0, hh = Math.max(1, v * 22); g.fillRect(x, 12 - hh / 2, 1, hh); } } }
      blk.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); const box = L.getBoundingClientRect(), x0 = e.clientX, t00 = o.t0, len = o.kind === 'titre' && o.t1 > o.t0 ? o.t1 - o.t0 : 0; let moved = false; if (target()?.o !== o) select(o, false);
        const mv = ev => { if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true; const raw = t00 + (ev.clientX - x0) / box.width * dur, s2 = ev.altKey ? { t: Math.round(raw) } : snapTime(raw, [[Math.round(S.T)], [Math.round(raw / 1000) * 1000]], 7 / box.width * dur); o.t0 = clamp(s2.t, 0, Math.round(dur)); if (len) o.t1 = Math.min(Math.round(dur), o.t0 + len); stopAudio(o.id); blk.style.left = `${o.t0 / dur * 100}%`; S.hint(fmt(o.t0), 1000); };
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) { changed(); renderPanel(); } };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); });
      L.append(blk);
    }
    if (!ch) for (const c of o.clips || []) { const m = el('div', { class: 'an-clipmark', title: `${fmt(c.t)} — ${c.id ? (c.id === 'coucou' ? 'Coucou' : SH().EMOTE_SHOP?.[c.id]?.name || c.id) : 'arrêt de l’animation'}`, text: c.id ? '▶' : '■' }); m.style.left = `${c.t / dur * 100}%`; L.append(m); }
    times.forEach((t, i) => { const d = el('div', { class: 'kf' + (isSel(o, ch, t) ? ' sel' : ''), title: ch ? `${O.LABELS[ch]} — ${fmtVal(ch, o.tracks[ch][i].v)} à ${fmt(t)}` : `${o.name} — clés de ${fmt(t)}` }); d.style.left = `${t / dur * 100}%`; d.addEventListener('pointerdown', e => keyDown(e, o, ch, t)); L.append(d); });
    L.addEventListener('pointerdown', e => { if (e.target.classList.contains('kf')) return; if (target()?.o !== o) select(o, false); if (!e.ctrlKey && !e.shiftKey && selKeys.length) { selKeys = []; renderPanel(); } S.scrub(e, L); });
    L.addEventListener('dblclick', e => { if (e.target.classList.contains('kf')) return; const box = L.getBoundingClientRect(), t = Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * S.rec.dur);
      if (ch) { const v = O.chanAt(o, ch, t); O.setKey(o, ch, t, v != null ? v : ws(o, t).local[ch] ?? 0); } else { const W = ws(o, t); for (const c of O.noTR(o) ? O.channelsOf(o) : [...O.POS, ...O.ROT]) O.setKey(o, c, t, O.noTR(o) ? O.chanAt(o, c, t) : W.local[c]); }
      selKeys = [{ id: o.id, ch, t }]; S.seek(t); changed(); renderPanel(); });
    return L;
  }
  const fmtVal = (ch, v) => (ch === 'vis' ? (v >= 0.5 ? 'visible' : 'caché') : ch.includes('.') || O.ROT.includes(ch) || ch === 'la' ? `${(v * R2D).toFixed(1)}°` : v.toFixed(2));
  function keyDown(e, o, ch, t) {
    e.stopPropagation(); e.preventDefault(); const box = e.currentTarget.parentElement.getBoundingClientRect(), x0 = e.clientX, multi = e.ctrlKey || e.shiftKey || e.metaKey; let moved = false;
    const has = isSel(o, ch, t);
    if (multi) { if (has) selKeys = selKeys.filter(k => !(k.id === o.id && k.t === t && (k.ch == null || ch == null || k.ch === ch))); else selKeys.push({ id: o.id, ch, t }); }
    else if (!has) selKeys = [{ id: o.id, ch, t }];
    if (target()?.o !== o) select(o, false); else { S.renderTracks(); renderPanel(); }
    const ids = [...new Set(selKeys.map(k => k.id))].map(byId).filter(Boolean), keep = ids.map(x => JSON.stringify(x.tracks)), sel0 = selKeys.map(k => ({ ...k })), dur = S.rec.dur;
    const others = new Set(); for (const x of A.objs) for (const L of Object.values(x.tracks)) for (const k of L) others.add(k.t); for (const c of S.cams) for (const L of Object.values(c.tracks)) for (const k of L) others.add(k.t); for (const k of sel0) others.delete(k.t);
    const mv = ev => { if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true;
      const raw = t + (ev.clientX - x0) / box.width * dur, s = ev.altKey ? { t: Math.round(raw), snap: -1 } : snapTime(raw, [[Math.round(S.T)], [...others], [Math.round(raw / 1000) * 1000]], 7 / box.width * dur);
      let dt = clamp(s.t, 0, Math.round(dur)) - t; const next = [];
      ids.forEach((x, i) => { x.tracks = JSON.parse(keep[i]); const mine = sel0.filter(k => k.id === x.id); for (const k of O.shiftKeys(x, mine, dt, dur)) next.push({ id: x.id, ...k }); });
      // (la ligne résumé reste « toutes les clés de l'instant »)
      selKeys = sel0.some(k => k.ch == null) ? [...new Map(next.map(k => [`${k.id}|${k.t}`, { id: k.id, ch: null, t: k.t }])).values()] : next;
      S.renderTracks(); S.hint(s.snap >= 0 ? `🧲 ${fmt(t + dt)} (Alt : libre)` : fmt(t + dt), 1200); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) { changed(); renderPanel(); } else if (!multi) S.seek(t); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  /** Les lignes des éléments, ajoutées sous celles des caméras (appelé par studio.js, renderTracks) */
  function renderRows(wrapEl, dur) {
    if (!S.rec) return; applyZoom(wrapEl); renderMarks(dur); const list = O.tree(A), tg = target();
    const rows = tg?.o.ghost ? [{ o: tg.o, depth: 0 }, ...list] : list; if (!rows.length) return;
    wrapEl.querySelector('.tr-empty')?.remove();
    wrapEl.append(el('div', { class: 'tr-head ruler-head an-sep' }, el('span', { class: 'muted', text: 'Éléments' })), el('div', { class: 'an-sep-line' }));
    for (const { o, depth } of rows) {
      const on = tg?.o === o, n = O.keyCount(o), shown = O.channelsOf(o).filter(c => o.tracks[c]?.length);
      const head = el('div', { class: 'tr-head' + (on ? ' sel' : ''), title: `${O.KINDS[o.kind]} — ${o.name}`, onclick: () => select(o, false) },
        el('button', { class: 'tw on', title: o.open ? 'Replier' : 'Déplier : une ligne d’images-clés par réglage animé', text: o.open ? '▾' : '▸', onclick: e => { e.stopPropagation(); if (o.ghost) return; o.open = !o.open; S.renderTracks(); S.touch(); } }), el('i'),
        el('span', { class: 'nm', style: `padding-left:${depth * 8}px` }, `${O.ICONS[o.kind]} ${o.name}`, n ? null : el('small', { text: ' fixe' })),
        el('button', { class: 'kd' + (O.hasKey(o, null, S.T) ? ' on' : ''), title: 'Image-clé à l’instant courant (K)', text: '◆', onclick: e => { e.stopPropagation(); select(o, false); keyPose(); } }));
      head.style.setProperty('--c', o.color); wrapEl.append(head, lane(o, null, dur));
      if (o.open) { for (const ch of shown) wrapEl.append(el('div', { class: 'tr-head sub', title: O.LABELS[ch] }, el('span', { class: 'nm', text: O.LABELS[ch] }), el('small', { class: 'muted', text: String(o.tracks[ch].length) }),
        el('button', { class: 'kd' + (O.keyAt(o.tracks[ch], S.T) >= 0 ? ' on' : ''), title: 'Poser / retirer la clé de cet instant', text: '◆', onclick: e => { e.stopPropagation(); toggleKey(o, ch); } })), lane(o, ch, dur));
        if (!shown.length) wrapEl.append(el('div', { class: 'tr-head sub' }, el('span', { class: 'nm muted', text: 'aucune clé' })), el('div', { class: 'lane sub', title: 'Pose une clé avec K ou ◆' })); }
    }
  }
  // ---- Zoom de la frise (Ctrl + molette, boutons − / ＋) : les lignes s'élargissent et défilent ; les noms restent à gauche
  let zoom = 1, scrollX = 0, wrapNow = null;
  function applyZoom(wrapEl) {
    wrapNow = wrapEl; const tl = $('#timeline'), tr = $('#tracks');
    tr.classList.toggle('an-zoomed', zoom > 1); wrapEl.classList.toggle('an-zoomed', zoom > 1);
    wrapEl.style.gridTemplateColumns = zoom > 1 ? `190px calc((100% - 198px) * ${zoom})` : ''; wrapEl.style.overflowX = zoom > 1 ? 'auto' : '';
    tl.style.width = zoom > 1 ? `${zoom * 100}%` : ''; tl.style.transform = zoom > 1 ? `translateX(${-scrollX}px)` : '';
    wrapEl.addEventListener('scroll', () => { if (wrapNow !== wrapEl) return; scrollX = wrapEl.scrollLeft; tl.style.transform = zoom > 1 ? `translateX(${-scrollX}px)` : ''; });
    queueMicrotask(() => { if (zoom > 1) wrapEl.scrollLeft = scrollX; else scrollX = 0; });
    if (zb) zb.textContent = zoom > 1 ? `×${zoom % 1 ? zoom.toFixed(1) : zoom}` : '×1';
  }
  /** Change le zoom en gardant sous le pointeur (ou la tête de lecture) le même instant */
  function setZoom(z, clientX = null) {
    z = clamp(Math.round(z * 4) / 4, 1, 32); if (z === zoom || !S.rec) return; const tl = $('#timeline'), box = tl.getBoundingClientRect(), view = box.width / zoom;
    const k = clientX != null ? clamp((clientX - box.left) / box.width, 0, 1) : S.T / Math.max(1, S.rec.dur), at = clientX != null ? clientX - (box.left + scrollX) : view / 2;
    zoom = z; scrollX = clamp(k * view * zoom - at, 0, Math.max(0, view * zoom - view)); S.renderTracks();
  }
  function followHead() {   // (en lecture, la tête de lecture reste dans la partie visible)
    if (zoom <= 1 || !wrapNow || !S.playing) return; const w = wrapNow.clientWidth - 198, x = S.T / Math.max(1, S.rec.dur) * w * zoom;
    if (x < wrapNow.scrollLeft + 10 || x > wrapNow.scrollLeft + w - 30) wrapNow.scrollLeft = clamp(x - w * 0.15, 0, w * zoom);
  }
  // ---- Boucle de lecture et marqueurs
  const marksBox = el('div', { class: 'an-marks' }); $('#timeline').append(marksBox);
  function renderMarks(dur) {
    const kids = []; const L = A.loop;
    if (L.on && L.b > L.a) { const z = el('div', { class: 'an-loop', title: `Boucle de ${fmt(L.a)} à ${fmt(L.b)}` }); z.style.left = `${L.a / dur * 100}%`; z.style.width = `${(L.b - L.a) / dur * 100}%`; kids.push(z); }
    for (const m of A.marks) { const f = el('div', { class: 'an-mark', title: `${m.name} — ${fmt(m.t)}\nClic : y aller · clic droit : le retirer`, text: '⚑' }); f.style.left = `${m.t / dur * 100}%`; f.style.color = m.color;
      f.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.button === 2) { A.marks = A.marks.filter(x => x !== m); changed(); } else S.seek(m.t); }); f.addEventListener('contextmenu', e => e.preventDefault()); kids.push(f); }
    marksBox.replaceChildren(...kids);
    if (lb) { lb.classList.toggle('on', L.on); lb.title = `Boucle de lecture${L.on ? (L.b > L.a ? ` : de ${fmt(L.a)} à ${fmt(L.b)}` : ' : tout le record') : ''}\nClic : activer / couper · Alt+clic : début de la boucle à l’instant courant · Maj+clic : fin à l’instant courant · double-clic : tout le record`; }
  }
  function addMark(name = '') { const t = Math.round(S.T); if (A.marks.some(m => Math.abs(m.t - t) < 50)) { A.marks = A.marks.filter(m => Math.abs(m.t - t) >= 50); S.hint('Marqueur retiré.', 1500); } else { A.marks.push({ t, name: String(name || `Repère ${A.marks.length + 1}`).slice(0, 40), color: '#ffd23d' }); A.marks.sort((a, b) => a.t - b.t); S.hint(`⚑ Marqueur posé à ${fmt(t)} (M : poser / retirer · clic droit dessus : retirer)`, 2500); } changed(); }
  /** Saute à la clé (ou au marqueur) d'avant ou d'après — de la cible, de la caméra sélectionnée, sinon de tout le projet */
  function jumpKey(dir) {
    const t = target(), c = S.selCam(), T = Math.round(S.T); let L = t ? O.keyTimes(t.o) : c ? Object.values(c.tracks).flatMap(x => x.map(k => k.t)) : [...A.objs.flatMap(o => O.keyTimes(o)), ...S.cams.flatMap(x => Object.values(x.tracks).flatMap(y => y.map(k => k.t)))];
    L = [...new Set([...L, ...A.marks.map(m => m.t)])].sort((a, b) => a - b); const n = dir > 0 ? L.find(x => x > T + 20) : L.filter(x => x < T - 20).pop();
    if (n == null) return S.hint(dir > 0 ? 'Pas de clé après.' : 'Pas de clé avant.', 1200); S.seek(n);
  }
  let lb = null, zb = null;
  {   // (boutons ajoutés à la barre de la frise)
    lb = btn('🔁', '', e => { const L = A.loop, T = Math.round(S.T); if (e.altKey) { L.a = T; if (L.b <= L.a) L.b = Math.round(S.rec?.dur || 0); L.on = true; } else if (e.shiftKey) { L.b = T; if (L.b <= L.a) L.a = 0; L.on = true; } else L.on = !L.on; changed(); S.hint(L.on ? (L.b > L.a ? `Boucle de ${fmt(L.a)} à ${fmt(L.b)}` : 'Lecture en boucle') : 'Boucle coupée', 2000); }, 'an-tl');
    lb.addEventListener('dblclick', () => { A.loop = { on: true, a: 0, b: 0 }; changed(); });
    zb = el('span', { class: 'an-zoomv', text: '×1', title: 'Zoom de la frise (Ctrl + molette sur la frise)' });
    const box = el('span', { class: 'tl-extra' }, lb, btn('⚑', 'Marqueur à l’instant courant : poser / retirer (M)', () => addMark(), 'an-tl'), btn('⏮', 'Clé précédente (Maj+←)', () => jumpKey(-1), 'an-tl'), btn('⏭', 'Clé suivante (Maj+→)', () => jumpKey(1), 'an-tl'),
      btn('−', 'Dézoomer la frise', () => setZoom(zoom / 2), 'an-tl'), zb, btn('＋', 'Zoomer la frise (Ctrl + molette)', () => setZoom(zoom * 2), 'an-tl'));
    document.querySelector('#tracks .ruler-head').append(box);
    $('#tracks').addEventListener('wheel', e => { if (!e.ctrlKey || !S.rec) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.5 : 1 / 1.5), e.clientX); }, { passive: false });
  }
  // ---- Copier, coller, supprimer (les clés sélectionnées d'un élément — ou celle de la caméra sélectionnée)
  function copy() {
    const t = target(), c = S.selCam();
    if (t && keysOf(t.o).length) { clip = { from: 'obj', ...O.copyKeys(t.o, keysOf(t.o)) }; S.hint(`${clip.keys.length} clé${clip.keys.length > 1 ? 's' : ''} copiée${clip.keys.length > 1 ? 's' : ''} — Ctrl+V : coller à l’instant courant`, 2500); return true; }
    if (c && S.selT != null) { const k = O.copyKeys(c, [{ ch: S.selCh, t: S.selT }]); if (k) { clip = { from: 'cam', ...k }; S.hint(`${k.keys.length} clé${k.keys.length > 1 ? 's' : ''} de ${c.name} copiée${k.keys.length > 1 ? 's' : ''} — Ctrl+V : coller à l’instant courant`, 2500); return true; } }
    return false;
  }
  function paste() {
    if (!clip) return false; const t = target(), c = S.selCam(), T = Math.round(S.T);
    if (c && clip.from === 'cam') { const n = O.pasteKeys(c, clip, T, S.rec.dur).length; if (n) { S.hint(`${n} clé${n > 1 ? 's' : ''} collée${n > 1 ? 's' : ''} sur ${c.name} à ${fmt(T)}.`, 2500); S.touch(); S.renderTracks(); S.renderProps(); } return n > 0; }
    if (t && clip.from === 'obj') { const o = real(t.o), done = O.pasteKeys(o, clip, T, S.rec.dur, O.channelsOf(o)); if (done.length) { selKeys = done.map(k => ({ id: o.id, ...k })); S.hint(`${done.length} clé${done.length > 1 ? 's' : ''} collée${done.length > 1 ? 's' : ''} sur ${o.name} à ${fmt(T)}.`, 2500); changed(); renderPanel(); } return done.length > 0; }
    return false;
  }
  function delKeys() { let n = 0; for (const k of selKeys) { const o = byId(k.id); if (o) n += O.delAt(o, k.ch, k.t); } selKeys = []; if (n) { changed(); renderPanel(); } return n > 0; }
  /** Touches (avant celles des caméras) : rend true si la touche est prise */
  function onKey(e, locked) {
    const t = target(), ctrl = (e.ctrlKey || e.metaKey) && !e.altKey, k = e.key.toLowerCase();
    if (e.shiftKey && !ctrl && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { jumpKey(e.code === 'ArrowLeft' ? -1 : 1); return true; }
    if (!ctrl && !e.shiftKey && e.code === 'KeyM' && !locked) { addMark(); return true; }
    if (ctrl) { if (k === 'c') return copy(); if (k === 'v') return paste(); if (k === 'd' && t && !t.o.ghost && sel) { duplicate(t.o); return true; } return false; }
    if (!t) return false;
    if (e.code === 'KeyK' && !e.shiftKey) return keyPose();
    if (e.code === 'Delete' || e.code === 'Backspace') { if (selKeys.length) return delKeys(); if (e.code === 'Delete' && sel) { const o = t.o; remove(o); S.toast(`${o.name} supprimé — Ctrl+Z pour annuler.`); return true; } return false; }
    if (locked || O.noTR(t.o)) return false;
    const m = { KeyR: 'rotate', KeyL: 'translate', KeyT: 'scale' }[e.code]; if (m) { gizMode(m); return true; }
    if (e.code === 'KeyF' && sel) { frame(t.o); return true; }
    return false;
  }
  function gizMode(m) { if (!S.giz) return; S.giz.setMode(m); if (S.mode !== 'free') S.setMode('free'); S.renderTracks(); S.hint({ rotate: 'Rotation : glisse un anneau (L : flèches, T : taille)', translate: 'Déplacement : glisse une flèche (R : rotation, T : taille)', scale: 'Taille : glisse une poignée (L : flèches, R : rotation)' }[m], 2500); }

  // ---------------------------------------------------------------- Cadre : bandes au format choisi, grille des tiers, zones sûres
  // (une surimpression pour composer l'image : elle n'est ni dans le record ni dans la vidéo exportée)
  const guide = el('div', { class: 'an-guide' }, el('i', { class: 'b1' }), el('i', { class: 'b2' }), el('div', { class: 'an-frame' }, el('u', { class: 'safe a' }), el('u', { class: 'safe t' }))); $('#stage').append(guide);
  let cadre = { ratio: 0, thirds: false, safe: false }; try { Object.assign(cadre, JSON.parse(localStorage.getItem('studio.cadre') || '{}')); } catch { /* réglages par défaut */ }
  function drawGuide() {
    const st = $('#stage'), w = st.clientWidth || 16, h = st.clientHeight || 9, as = w / h, r = +cadre.ratio || 0, [b1, b2, fr] = guide.children;
    let ix = 0, iy = 0; if (r > as) iy = (1 - as / r) / 2 * 100; else if (r && r < as) ix = (1 - r / as) / 2 * 100;
    b1.style.cssText = r ? (iy ? `left:0;right:0;top:0;height:${iy}%` : `top:0;bottom:0;left:0;width:${ix}%`) : 'display:none'; b2.style.cssText = r ? (iy ? `left:0;right:0;bottom:0;height:${iy}%` : `top:0;bottom:0;right:0;width:${ix}%`) : 'display:none';
    fr.style.inset = `${iy}% ${ix}%`; fr.classList.toggle('thirds', !!cadre.thirds); fr.classList.toggle('safes', !!cadre.safe);
    try { localStorage.setItem('studio.cadre', JSON.stringify(cadre)); } catch { /* tant pis */ }
  }
  {
    const sel0 = el('select', { title: 'Bandes noires au format de l’image voulue', onchange: e => { cadre.ratio = +e.target.value; drawGuide(); } }, ...[[0, 'Aucun'], [2.39, 'Cinémascope 2,39:1'], [2, 'Univisium 2:1'], [1.85, 'Panoramique 1,85:1'], [1.7778, '16:9'], [1.3333, '4:3'], [1, 'Carré 1:1'], [0.5625, 'Vertical 9:16']].map(([v, t]) => el('option', { value: String(v), text: t, ...(Math.abs(v - cadre.ratio) < 0.001 ? { selected: '' } : {}) })));
    const ck = (label, key) => { const c = el('input', { type: 'checkbox' }); c.checked = !!cadre[key]; c.onchange = () => { cadre[key] = c.checked; drawGuide(); }; return el('label', { class: 'row' }, c, ` ${label}`); };
    $('#settings').append(el('label', {}, 'Format du cadre', sel0), ck('Grille des tiers', 'thirds'), ck('Zones sûres (action 90 %, titres 80 %)', 'safe'));
    new ResizeObserver(drawGuide).observe($('#stage')); drawGuide();
  }

  // ---------------------------------------------------------------- Piste audio : musiques et sons importés (mp3, ogg, wav…)
  // Le fichier est gardé dans la base locale du Studio (IndexedDB), sous l'empreinte de son contenu ; le projet n'en retient que
  // l'empreinte, le nom, la durée, la place sur la frise et le volume (animable). Lecture par Web Audio, calée sur la tête de lecture.
  const AU = { ctx: null, bufs: new Map(), peaks: new Map(), live: new Map(), loading: new Set() };
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('studio-audio', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbPut = async (k, v) => { const d = await idb(); await new Promise((res, rej) => { const t = d.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); d.close(); };
  const idbGet = async k => { const d = await idb(); const v = await new Promise((res, rej) => { const q = d.transaction('f').objectStore('f').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); d.close(); return v; };
  const actx = () => (AU.ctx ||= new AudioContext({ sampleRate: 48000 }));
  function peaksOf(buf, n = 1600) { const d = buf.getChannelData(0), k = Math.max(1, Math.floor(d.length / n)), P = new Float32Array(n); for (let i = 0; i < n; i++) { let m = 0; for (let j = i * k, e = Math.min(d.length, j + k); j < e; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; } P[i] = m; } return P; }
  async function bufferOf(hash) {
    if (AU.bufs.has(hash)) return AU.bufs.get(hash); if (AU.loading.has(hash)) return null; AU.loading.add(hash);
    try { const bytes = await idbGet(hash); if (!bytes) { AU.bufs.set(hash, null); return null; } const buf = await actx().decodeAudioData(bytes.slice(0)); AU.bufs.set(hash, buf); AU.peaks.set(hash, peaksOf(buf)); S.renderTracks(); return buf; }
    catch (e) { console.warn('son illisible', e); AU.bufs.set(hash, null); return null; } finally { AU.loading.delete(hash); }
  }
  /** Importe un fichier son (octets) et le pose sur la frise à l'instant courant ; rend l'élément, ou { error } */
  async function importAudio(bytes, name = 'Son') {
    if (!S.pb) return { error: 'aucun record ouvert' }; if (bytes.byteLength > 80e6) return { error: 'fichier trop gros (80 Mo au plus)' };
    let buf; try { buf = await actx().decodeAudioData(bytes.slice(0)); } catch { return { error: 'ce fichier n’est pas un son lisible (mp3, ogg, wav, m4a, flac)' }; }
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { await idbPut(hash, bytes); } catch (e) { console.warn('son non gardé', e); }
    AU.bufs.set(hash, buf); AU.peaks.set(hash, peaksOf(buf));
    const o = O.newObj(A, 'audio', { name: String(name).replace(/\.[a-z0-9]{2,5}$/i, ''), file: name, hash, dur: Math.round(buf.duration * 1000), t0: Math.round(S.T) }); if (!o) return { error: 'trop d’éléments' };
    select(o); changed(); return o;
  }
  function stopAudio(id = null) { for (const [k, L] of AU.live) if (id == null || k === id) { try { L.src.stop(); } catch { /* déjà arrêté */ } L.gain.disconnect(); AU.live.delete(k); } }
  // (à chaque image : en lecture, chaque son en cours joue depuis le bon endroit — relancé s'il s'écarte de la tête de lecture)
  function tickAudio(T) {
    const fxo = A.objs.find(o => o.kind === 'effets'), playing = S.playing && !S.xpHost?.holding?.(), rate = (S.rate || 1) * (fxo ? Math.max(0.05, O.chanAt(fxo, 'speed', T)) : 1), now = AU.ctx?.currentTime || 0, want = playing ? O.audioAt(A, T) : [];
    for (const [id] of AU.live) if (!want.some(w => w.o.id === id)) stopAudio(id);
    for (const w of want) { const buf = AU.bufs.get(w.o.hash); if (buf === undefined) { bufferOf(w.o.hash); continue; } if (!buf) continue;
      let L = AU.live.get(w.o.id); const pos = w.at / 1000;
      if (L) { const exp = L.pos0 + (actx().currentTime - L.at0) * L.rate; if (Math.abs(exp - pos) > 0.15 || L.rate !== rate) { stopAudio(w.o.id); L = null; } }
      if (!L) { const c = actx(); if (c.state === 'suspended') c.resume(); const src = c.createBufferSource(), gain = c.createGain(); src.buffer = buf; src.playbackRate.value = rate; src.connect(gain); gain.connect(c.destination); gain.gain.value = w.vol; src.start(0, Math.max(0, pos)); L = { src, gain, pos0: pos, at0: c.currentTime, rate }; AU.live.set(w.o.id, L); }
      L.gain.gain.value = w.vol; }
    void now;
  }
  /** Le son mixé de la cinématique entre deux instants (export) : { rate, channels, data: [Float32Array, Float32Array] } ou null s'il n'y a pas de son */
  async function mixAudio(start, end) {
    const L = A.objs.filter(o => o.kind === 'audio' && o.hash && o.t0 < end && o.t0 + o.dur - o.off > start); if (!L.length) return null;
    const rate = 48000, n = Math.max(1, Math.ceil((end - start) / 1000 * rate)), oc = new OfflineAudioContext(2, n, rate); let any = false;
    for (const o of L) { const buf = AU.bufs.get(o.hash) || await bufferOf(o.hash); if (!buf) continue; any = true; const src = oc.createBufferSource(), g = oc.createGain(); src.buffer = buf; src.connect(g); g.connect(oc.destination);
      const a = Math.max(start, o.t0), b = Math.min(end, o.t0 + o.dur - o.off); for (let t = a; t <= b; t += 40) g.gain.setValueAtTime(O.chanAt(o, 'vol', t), Math.max(0, (t - start) / 1000));
      src.start(Math.max(0, (o.t0 - start) / 1000), Math.max(0, (start - o.t0 + o.off) / 1000, o.off / 1000)); }
    if (!any) return null; const out = await oc.startRendering(); return { rate, channels: 2, data: [out.getChannelData(0), out.getChannelData(1)] };
  }
  /** Le son de la cinématique, encodé en Opus pour l'export WebM : { head (« OpusHead »), packets: [[octets, µs]] } ou null */
  async function encodeAudio(start, end) {
    // (ralenti ou image figée : la vidéo est muette)
    if (typeof AudioEncoder !== 'function' || O.hasRemap(A)) return null;
    const mix = await mixAudio(start, end); if (!mix) return null;
    const packets = []; let head = null, err = null;
    const enc = new AudioEncoder({ output: (c, meta) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); packets.push([b, c.timestamp]); const d = meta?.decoderConfig?.description; if (d && !head) head = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer); }, error: e => { err = e; } });
    enc.configure({ codec: 'opus', sampleRate: mix.rate, numberOfChannels: 2, bitrate: 160000 });
    const n = mix.data[0].length, step = 960 * 50;
    for (let i = 0; i < n && !err; i += step) { const len = Math.min(step, n - i), buf = new Float32Array(len * 2); buf.set(mix.data[0].subarray(i, i + len), 0); buf.set(mix.data[1].subarray(i, i + len), len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: mix.rate, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round(i / mix.rate * 1e6), data: buf }); enc.encode(ad); ad.close(); }
    await enc.flush(); enc.close(); if (err) throw err;
    return packets.length ? { head: head || O.opusHead(2, mix.rate), packets } : null;
  }
  const fileIn = el('input', { type: 'file', accept: 'audio/*,.mp3,.ogg,.wav,.m4a,.flac,.opus', hidden: '' }); document.body.append(fileIn);
  fileIn.onchange = async () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (!f) return; S.hint('Lecture du fichier son…', 4000); const r = await importAudio(await f.arrayBuffer(), f.name); if (r.error) S.toast(`Son : ${r.error}`, true); else S.hint(`🎵 ${r.name} posé à ${fmt(r.t0)} — glisse son bloc sur la frise pour le déplacer`, 4000); };

  // ---------------------------------------------------------------- Calque 2D (fondus, titres) et capture PNG
  const ovCv = el('canvas', { class: 'an-ov' }); guide.append(ovCv); let ovSig = '';
  /** Les changements de plan de la cinématique (début de chaque caméra active, sauf la première) */
  const cuts = () => S.cams.map(c => c.on && camSpan(c)).filter(Boolean).map(s0 => s0[0]).sort((a, b) => a - b).slice(1);
  function overlay(t, shot = true) { const ov = O.overlayAt(A, t, shot ? cuts() : []); if (ov && !shot) { ov.fade = 0; ov.flash = 0; if (!ov.titles.length) return null; } return ov; }
  /** Une image fixe en haute résolution de la cinématique à l'instant courant (PNG, avec les titres), à côté des vidéos exportées */
  async function capturePng(w = 3840, h = 2160) {
    const X = S.xpHost, W = S.world, cv = $('#view'); if (!X || !W || !S.pb || capturePng.busy) return { ok: false, error: 'indisponible' }; capturePng.busy = true;
    const T0 = S.T, mode0 = S.mode, keep = { css: cv.style.cssText, pr: W.renderer.getPixelRatio() }, shot = S.cams.some(c => c.on && camSpan(c)), view = { ...S.cam };
    try {
      const f = await S.api.xport.open({ name: `capture-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`, ext: 'png' }).catch(() => null); if (!f?.ok) return { ok: false, error: f?.error || 'Impossible de créer le fichier.' };
      const k = Math.min(1, innerWidth / w, innerHeight / h); cv.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;transform:scale(${k});z-index:0`; W.renderer.setPixelRatio(1); W.resize();
      const draw1 = () => { if (shot) X.frame(T0, false); else { Object.assign(S.cam, view); W.frame(); } };
      if (shot) X.begin(); for (let i = 0; i < 4; i++) { draw1(); await new Promise(r => setTimeout(r, 60)); } draw1();
      const oc = new OffscreenCanvas(w, h), g = oc.getContext('2d'); g.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, w, h); O.paintOverlay(g, w, h, overlay(T0, shot));
      const bytes = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer()); S.api.xport.write(0, bytes);
      const r = await S.api.xport.finish(false, true); if (!r?.ok) return { ok: false, error: r?.error || 'écriture impossible' };
      S.toast(`📸 Capture ${w}×${h} enregistrée : ${String(r.name).replace(/\.png$/, '')}.png`); return { ok: true, name: r.name, size: bytes.length, width: w, height: h };
    } catch (e) { console.error(e); try { await S.api.xport.finish(true); } catch { /* déjà fermé */ } return { ok: false, error: String(e?.message || e) }; }
    finally { cv.style.cssText = keep.css; W.renderer.setPixelRatio(keep.pr); W.resize(); if (shot) X.end(); if (mode0 !== 'free' && mode0 !== 'cine') S.setMode(mode0); Object.assign(S.cam, view); S.seek(T0); capturePng.busy = false; }
  }
  { const rs = el('select', { title: 'Taille de la capture' }, ...[['1920x1080', 'Full HD 1920×1080'], ['2560x1440', '1440p'], ['3840x2160', '4K 3840×2160'], ['7680x4320', '8K 7680×4320']].map(([v, t], i) => el('option', { value: v, text: t, ...(i === 2 ? { selected: '' } : {}) })));
    $('#settings').append(el('label', {}, 'Capture d’image (PNG)', rs), btn('📸 Capturer cet instant', 'Image fixe en haute résolution : ce que montre la cinématique à l’instant courant (caméras actives ; sinon la vue libre), avec les titres', async () => { const [w, h] = rs.value.split('x').map(Number); S.hint('Capture en cours…', 4000); const r = await capturePng(w, h); if (!r.ok) S.toast(`Capture impossible : ${r.error}`, true); })); }

  // ---------------------------------------------------------------- Le projet
  function load(raw) {
    A = O.cleanAnim(raw); if (S.rec) O.clampAnim(A, S.rec.dur); if (!S.pb) cleanup(); sel = sel && byId(sel) ? sel : null; selKeys = []; ghost = null; lastTarget = '?';
    const ch = syncPersos(); if (ch) S.scene?.relist?.();
    renderTree(); renderPanel();
  }
  function cleanup() { stopAudio(); for (const id of [...nodes.keys()]) drop(id); for (const a of touched) release(a); touched.clear(); for (const h of touchedItems.values()) restoreItem(h); touchedItems.clear(); handles.clear(); if (pool) for (const L of Object.values(pool)) for (const l of L) l.intensity = 0; sel = null; selKeys = []; ghost = null; LF = null; lampList = []; panel.hidden = true; panel.replaceChildren(); treeBox.replaceChildren(); }
  let clockSt = null;
  /** Applique un modèle de projet (objets.js, TEMPLATES) sur un sujet (clé d'entité ; par défaut l'entité sélectionnée, sinon le joueur enregistré) */
  function template(name, subjectKey = null, opts = {}) {
    if (!S.pb) return { error: 'aucun record ouvert' }; const sc = S.scene, e = (subjectKey && sc.byKey(subjectKey)) || (sc.sel && sc.sel.kind === 'u' && sc.byKey(sc.sel.key)) || sc.list.find(x => x.me) || sc.list.find(x => x.kind === 'joueur' || x.kind === 'pnj') || null;
    const subject = e && e.key[0] === 'u' ? { id: e.id, name: e.name, at: t => sc.posOf(e.key, t) } : null, w = S.world; let radius = 6;
    if (w?.room && !w.room.outdoor && w.room.rows) radius = Math.max(2.5, Math.min(9, Math.min(w.room.rows.length, (w.room.rows[0] || '').length) * 0.38));
    const title = S.rec?.info?.roomName || w?.room?.name || '';
    const r = O.applyTemplate(CAMS, S.cams, A, name, { dur: S.rec.dur, start: opts.start ?? 0, subject, place: opts.place || title, title: opts.title || '', radius, ...(w?.room && !w.room.outdoor ? { maxR: radius, maxH: 2.6 } : {}) });
    if (r.error) return r; changed(); S.refreshUi?.(); return { ...r, subject: subject?.name || null };
  }
  const api = {
    O, get data() { return A; }, get objs() { return A.objs; }, get sel() { return sel; }, get selKeys() { return selKeys; }, get target() { return target(); }, byId, byEnt, ws, add, remove, duplicate, setParent, select, real, changed,
    sceneLamps, ambiance, lampObj, searchCatalog, capturePng, overlay, template, importAudio, mixAudio, get audio() { return AU; }, syncPersos, frame, keyPose, setZoom, addMark, jumpKey, get zoom() { return zoom; },
    /** L'élément d'une entité du record (créé au besoin) : pour l'animer */
    entity(key, create = true) { let o = byEnt(key); if (!o && create && S.scene?.byKey(key)) o = O.newObj(A, 'ref', { ref: key, name: S.scene.byKey(key).name }); return o || null; },
    find(q) { const n = norm(q).trim(); if (!n) return null; return A.objs.find(o => o.id === q) || A.objs.find(o => norm(o.name) === n) || A.objs.find(o => norm(o.name).includes(n)) || null; },
    emotes: () => [{ id: 'coucou', nom: 'Coucou (salut de la main)', duree: 2.6 }, ...Object.entries(SH().EMOTE_SHOP || {}).map(([id, d]) => ({ id, nom: d.name, duree: d.dur || 'en boucle' }))],
    get pool() { return pool; }, get nodes() { return nodes; }, get programs() { return S.world?.renderer.info.programs?.length || 0; },
  };
  return {
    api, ext, tick, pick, pickItem, itemOf, load, onKey, renderRows, renderTree, renderPanel, entExtra, select, gizMode, keyPose,
    get data() { return A; }, get target() { return target(); },
    // (partie « anim » du projet — enregistrée, rechargée, annulée avec le reste : cf. « extras » dans studio.js)
    save() { prune(); return O.hasAnim(A) ? A : undefined; }, has() { return O.hasAnim(A) && (prune(), O.hasAnim(A)); }, keyTimes() { return A.objs.flatMap(o => O.keyTimes(o)); }, clampTimes(dur) { O.clampAnim(A, dur); }, renderTrack(wrapEl, dur) { renderRows(wrapEl, dur); },
    /** Le moteur est prêt : objets 3D, réserve de lumières (créée AVANT le premier lieu : ses shaders la comptent dès le départ) */
    async engine(T3, giz) { THREE = T3; e3 = new THREE.Euler(); q3 = new THREE.Quaternion(); v3 = new THREE.Vector3(); m4 = new THREE.Matrix4(); ray = new THREE.Raycaster(); G = await import('/js/game.js'); makePool(); giz?.setExt(ext);
      if (giz) { const v = giz.veil.bind(giz); giz.veil = on => { v(on); veiled = !!on; for (const n of nodes.values()) for (const h of n.help || []) h.visible = show && !on; }; } },
    /** Le repère d'un personnage ou d'un véhicule du record, corrigé de ses surcharges (parents des caméras, assistant) : f = { x, y, z, yaw } */
    fixFrame(parent, t, f, originY) {
      const o = byEnt(`${parent.kind === 'perso' ? 'u' : 'v'}:${parent.id}`); if (!o || !f) return f; const W = ws(o, t), set = c => o.kind === 'perso' || !!o.parent || O.isSet(o, c);
      return { x: set('x') ? W.x : f.x, y: set('y') ? W.y + originY * W.sy : f.y, z: set('z') ? W.z : f.z, yaw: set('ry') ? (parent.kind === 'perso' ? Math.PI / 2 - W.ry : W.ry) : f.yaw };
    },
    mixAudio, encodeAudio,
    /** Le temps avance de dOut ms de vidéo depuis T (ralenti, accéléré, images figées) : rend le nouvel instant du record */
    advance(T, dOut) { if (!O.hasRemap(A)) { clockSt = null; return T + dOut; } if (!clockSt || Math.abs(clockSt.T - T) > 0.5) clockSt = { T, used: {} }; O.advanceTime(A, clockSt, dOut); return clockSt.T; },
    /** Les instants de chaque image d'un export (null : temps normal) */
    frameTimes(start, end, stepOut) { return O.hasRemap(A) ? O.frameTimes(A, start, end, stepOut) : null; },
    /** Le calque 2D (fondus, titres) peint sur une image de l'export */
    paint(g, w, h, t) { O.paintOverlay(g, w, h, overlay(t, true)); },
    /** Les éléments ajoutés vus comme des sujets par l'assistant (cadrage, parent de caméra) : [{ key: 'o:<id>', id, kind: 'objet', name, sub, type }] */
    subjects: () => A.objs.filter(o => !O.noTR(o) && !O.isChar(o) && o.kind !== 'ref').map(o => ({ key: `o:${o.id}`, id: o.id, kind: 'objet', name: o.name, sub: `élément ajouté (${O.KINDS[o.kind].toLowerCase()})`, type: o.model || o.kind, t0: 0, t1: Infinity, added: true })),
    subjectPos(key, t) { const o = byId(String(key).slice(2)); if (!o || O.noTR(o)) return null; const W = ws(o, t); return { x: W.x, y: W.y, z: W.z, yaw: Math.PI / 2 - W.ry, present: W.vis }; },
    /** Éléments ajoutés qui peuvent porter une caméra, et leur repère à l'instant t : { x, y, z, yaw } (convention des caméras) */
    parents: () => A.objs.filter(o => !O.noTR(o) && !O.isChar(o) && o.kind !== 'ref' && !(o.bone && o.parent)),
    objFrame(id, t) { const o = byId(id); if (!o || O.noTR(o)) return null; const W = ws(o, t); return { x: W.x, y: W.y, z: W.z, yaw: Math.PI / 2 - W.ry }; },
    /** La boucle de lecture : à la fin (ou à la fin de la plage), revenir au début — rend l'instant où reprendre, ou null */
    loopAt(T, end) { const L = A.loop; if (!L.on) return null; const b = L.b > L.a ? Math.min(L.b, end) : end, a = L.b > L.a ? L.a : 0; return T >= b ? a : null; },
    close() { A = O.emptyAnim(); cleanup(); },
  };
}

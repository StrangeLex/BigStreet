// Big Street Studio — les caméras dans la scène, comme dans un logiciel 3D : chaque caméra posée est dessinée (pyramide de
// champ, cadre, triangle « haut », son nom au-dessus), se sélectionne au clic, et la caméra sélectionnée porte une poignée de
// déplacement (flèches X rouge, Y vert, Z bleu, et plans) ou de rotation (anneaux). Les poignées sont celles de Three.js
// (TransformControls), embarquées dans le launcher (tcontrols.js, fabriqué par tools/vendor-tcontrols.mjs) : elles ne dépendent
// ni du site ni de la copie locale du moteur, et marchent hors ligne.
import { makeTransformControls } from '/__studio/tcontrols.js';

export async function createGizmos(THREE, world, canvas, overlay, cb) {
  const helpers = new Map();   // id → { group, frame, mats, pick, label, fov, color }
  const tmpCam = new THREE.PerspectiveCamera(), v = new THREE.Vector3(), ray = new THREE.Raycaster();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Orientation d'une caméra (même calcul que le moteur : regard, puis inclinaison) */
  function quatOf(p, out) {
    const cp = Math.cos(p.pitch);
    tmpCam.position.set(p.x, p.y, p.z); tmpCam.up.copy(UP);
    tmpCam.lookAt(p.x + Math.cos(p.yaw) * cp, p.y + Math.sin(p.pitch), p.z + Math.sin(p.yaw) * cp);
    if (p.roll) tmpCam.rotateZ(p.roll);
    return out.copy(tmpCam.quaternion);
  }
  /** L'inverse : lacet, tangage, inclinaison d'après une orientation (near : lacet voisin, pour ne pas sauter d'un tour) */
  function anglesOf(q, near = 0) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let yaw = Math.atan2(f.z, f.x); yaw = near + Math.atan2(Math.sin(yaw - near), Math.cos(yaw - near));
    const pitch = Math.max(-1.55, Math.min(1.55, Math.asin(Math.max(-1, Math.min(1, f.y)))));
    const right = new THREE.Vector3().crossVectors(f, UP); if (right.lengthSq() < 1e-8) return { yaw: near, pitch, roll: 0 };
    right.normalize(); const bu = new THREE.Vector3().crossVectors(right, f);
    return { yaw, pitch, roll: Math.atan2(-up.dot(right), up.dot(bu)) };
  }

  function make(id, color) {
    const group = new THREE.Group(), col = new THREE.Color(color);
    const line = new THREE.LineBasicMaterial({ color: col, fog: false, transparent: true, opacity: 0.9 }), fill = new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    // (cadre du champ : sommet à l'origine, rectangle à z = −1, mis à l'échelle selon la focale ; triangle « haut » au-dessus)
    const P = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]], L = [];
    for (let i = 0; i < 4; i++) { L.push(0, 0, 0, ...P[i], ...P[i], ...P[(i + 1) % 4]); }
    const frame = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(L, 3)), line);
    const tri = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.55, 1.12, -1, 0.55, 1.12, -1, 0, 1.62, -1], 3)), fill);
    frame.add(tri);
    // (le boîtier, derrière le sommet)
    const body = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.34, 0.34, 0.5)), line); body.position.z = 0.25;
    const pick = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.7), new THREE.MeshBasicMaterial({ visible: false })); pick.position.z = -0.35; pick.userData.cam = id;
    for (const o of [frame, tri, body]) o.raycast = () => {};
    group.add(frame, body, pick); world.scene.add(group);
    const label = document.createElement('div'); label.className = 'cam-label'; label.style.setProperty('--c', color);
    label.addEventListener('pointerdown', e => { e.stopPropagation(); cb.select?.(id); });
    overlay.append(label);
    const h = { group, frame, mats: [line, fill], pick, label, color, text: '' };
    helpers.set(id, h); return h;
  }
  function drop(id) {
    const h = helpers.get(id); if (!h) return;
    world.scene.remove(h.group); h.group.traverse(o => o.geometry?.dispose()); for (const m of h.mats) m.dispose(); h.pick.material.dispose(); h.label.remove(); helpers.delete(id);
  }

  // Poignées de déplacement et de rotation
  let tc = null, tcHelper = null, proxy = new THREE.Object3D(), attached = null, lastYaw = 0, mode = 'translate', enabled = true, veiled = false;
  // (ext : un élément animé — objet, personnage, lumière… cf. anim.js — qui porte les poignées quand aucune caméra n'est sélectionnée :
  // { id, get() → { p: [x, y, z], q: [x, y, z, w], s: [x, y, z] }, change(mode, proxy), space })
  let ext = null, extOn = false;
  world.scene.add(proxy);
  try {
    const { TransformControls } = makeTransformControls(THREE);
    tc = new TransformControls(world.camera, canvas);
    tc.setSize(1.3); tc.setSpace('world');
    // (LA cause des flèches qu'on voyait sans pouvoir les saisir : le moteur du jeu ne recalcule plus la place des objets invisibles
    // — game.js, Object3D.updateMatrixWorld — ; or les zones de saisie des poignées sont des objets invisibles : elles restaient à
    // l'origine du monde et le pointeur ne les touchait jamais. Elles deviennent « visibles » avec un matériau qui ne se dessine pas.)
    for (const g of Object.values(tc._gizmo?.picker || {})) { g.visible = true; g.traverse(o => { if (o.material) o.material.visible = false; }); }
    tcHelper = tc.getHelper ? tc.getHelper() : tc; world.scene.add(tcHelper);
    tc.addEventListener('dragging-changed', e => { if (extOn && ext) ext.drag?.(!!e.value); cb.drag?.(!!e.value); });
    tc.addEventListener('objectChange', () => {
      if (extOn && ext) { ext.change?.(mode, proxy); return; }
      if (!attached) return;
      const a = anglesOf(proxy.quaternion, lastYaw); lastYaw = a.yaw;
      cb.change?.(attached, mode === 'rotate' ? a : { x: proxy.position.x, y: proxy.position.y, z: proxy.position.z });
    });
  } catch (e) { console.warn('poignées indisponibles', e); tc = null; }

  const G = {
    quatOf, anglesOf, hasHandles: !!tc, get tc() { return tc; },
    get dragging() { return !!tc?.dragging; },
    /** le pointeur est-il sur une poignée ? (le clic lui revient alors, pas à la prise de la caméra libre) */
    get hover() { return !!tc && enabled && (!!attached || extOn) && tcHelper.visible && tc.axis !== null; },
    /** Les poignées sur un élément animé (null : aucun) — une caméra sélectionnée garde la priorité */
    setExt(e) { ext = e || null; if (!ext) extOn = false; }, get ext() { return extOn ? ext : null; },
    /** Poignées utilisables ou non (pointeur pris par la caméra libre : elles ne doivent pas réagir à un pointeur figé) */
    setEnabled(on) { enabled = !!on; if (tc) { tc.enabled = enabled && !!attached; if (!enabled) tc.axis = null; } },
    /** Cache (ou remet) tout ce que ce module dessine dans la scène — le temps de calculer l'aperçu d'une caméra */
    veil(on) {
      if (on === veiled) return; veiled = on;
      if (on) { G._vis = [...helpers.values()].map(h => [h.group, h.group.visible]); G._tcv = tcHelper ? tcHelper.visible : false; for (const [g] of G._vis) g.visible = false; if (tcHelper) tcHelper.visible = false; }
      else { for (const [g, v] of G._vis || []) g.visible = v; if (tcHelper) tcHelper.visible = G._tcv; }
    },
    /** Un point du monde est-il devant la vue et dans l'image ? rend aussi sa distance : { on, dist } */
    seen(x, y, z) { const c = world.camera; v.set(x, y, z); const dist = v.distanceTo(c.position); v.project(c); return { on: v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88, dist }; },
    /** Position à l'écran (pixels de la fenêtre) d'un point du monde — essais automatiques */
    screen(x, y, z) { const r = canvas.getBoundingClientRect(); v.set(x, y, z).project(world.camera); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, front: v.z < 1 }; },
    get mode() { return mode; },
    setMode(m) { mode = m === 'rotate' ? 'rotate' : m === 'scale' ? 'scale' : 'translate'; if (tc) { tc.setMode(mode); tc.setSpace(mode === 'translate' ? 'world' : 'local'); } },
    /**
     * Met la scène à jour. list : [{ id, name, color, parentName, pose (monde) | null, lost }], sel : id de la caméra
     * sélectionnée, show : dessiner les caméras (pas pendant une cinématique ni en vue caméra), aspect : format de l'image.
     */
    sync(list, sel, show, aspect) {
      const cam = world.camera, w = canvas.clientWidth, hgt = canvas.clientHeight;
      for (const id of [...helpers.keys()]) if (!list.some(c => c.id === id)) drop(id);
      for (const c of list) {
        let h = helpers.get(c.id); if (!h || h.color !== c.color) { if (h) drop(c.id); h = make(c.id, c.color); }
        const on = show && !!c.pose; h.group.visible = on; h.label.style.display = on ? '' : 'none';
        if (!on) continue;
        const p = c.pose, t = Math.tan(Math.min(120, Math.max(8, p.fov)) * Math.PI / 360), d = 0.9;
        h.group.position.set(p.x, p.y, p.z); quatOf(p, h.group.quaternion);
        h.frame.scale.set(d * t * aspect, d * t, d);
        const k = c.id === sel ? 1 : 0.62; for (const m of h.mats) m.opacity = k;
        const text = c.name + (c.parentName ? `\n↳ ${c.parentName}${c.lost ? ' (absent)' : ''}` : '');
        if (h.text !== text) { h.text = text; h.label.textContent = text; }
        h.label.classList.toggle('sel', c.id === sel);
        v.set(p.x, p.y + 0.75, p.z).project(cam);
        const vis = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
        h.label.style.visibility = vis ? '' : 'hidden';
        if (vis) h.label.style.transform = `translate(${((v.x + 1) / 2 * w) | 0}px, ${((1 - v.y) / 2 * hgt) | 0}px) translate(-50%, -100%)`;
      }
      const s = show ? list.find(c => c.id === sel && c.pose) : null;
      attached = s ? s.id : null;
      const X = !s && show && ext ? ext.get() : null; extOn = !!X;
      if (tc && X) {   // (un élément animé porte les poignées)
        tc.camera = cam; if (mode === 'scale' && ext.noScale) G.setMode('translate');
        if (!tc.dragging) { proxy.position.set(...X.p); proxy.quaternion.set(...X.q); proxy.scale.set(...X.s); proxy.updateMatrixWorld(); }
        if (tc.object !== proxy) tc.attach(proxy); tcHelper.visible = true; tc.enabled = enabled; return;
      }
      if (tc) {
        if (mode === 'scale') G.setMode('translate'); proxy.scale.set(1, 1, 1);
        tc.camera = cam;
        if (s && !tc.dragging) { proxy.position.set(s.pose.x, s.pose.y, s.pose.z); quatOf(s.pose, proxy.quaternion); lastYaw = s.pose.yaw; proxy.updateMatrixWorld(); }
        if (s && tc.object !== proxy) tc.attach(proxy); else if (!s && tc.object) tc.detach();
        tcHelper.visible = !!s; tc.enabled = !!s && enabled;
      }
    },
    /** La caméra sous le pointeur (id), ou null */
    pick(x, y) {
      const r = canvas.getBoundingClientRect(); v.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5);
      ray.setFromCamera(v, world.camera);
      const hit = ray.intersectObjects([...helpers.values()].filter(h => h.group.visible).map(h => h.pick), false)[0];
      return hit ? hit.object.userData.cam : null;
    },
    /** Le rayon du pointeur dans la scène : { o: [x, y, z], d: [x, y, z] } (déplacement au clavier, G) */
    ray(x, y) {
      const r = canvas.getBoundingClientRect(); v.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5);
      ray.setFromCamera(v, world.camera); const o = ray.ray.origin, d = ray.ray.direction;
      return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
    },
    clear() { for (const id of [...helpers.keys()]) drop(id); if (tc?.object) tc.detach(); if (tcHelper) tcHelper.visible = false; attached = null; extOn = false; },
  };
  return G;
}

/**
 * Contrôles de l'intelligence de la scène de l'assistant du Studio (appelés par tools/selftest.mjs) : géométrie (geo.js),
 * connaissance des lieux (places.js), et l'extension du moteur d'actions (ai-tools-geo.js) sur une fausse salle — deux pièces
 * séparées par une cloison percée d'une porte, un plafond, une table, un placard fermé.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export async function checkIA({ ok, root, C }) {
  // (les modules de la page s'importent par « /__studio/… » : ici, chaque import est remplacé par le module lui-même)
  const seen = new Map();
  const link = f => { if (seen.has(f)) return seen.get(f); const src = readFileSync(path.join(root, 'src/studio', f), 'utf8').replace(/from '\/__studio\/([\w.-]+)'/g, (_, g) => `from '${link(g)}'`); const url = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64'); seen.set(f, url); return url; };
  const GEO = await import(link('geo.js')), PL = await import(link('places.js')), X = await import(link('ai-tools-geo.js')), A = await import(link('ai-tools.js'));

  // ------------------------------------------------------------ La fausse salle (21 × 11 m, plafond à 3 m)
  const T = [];
  GEO.boxTris(-0.5, -0.3, -0.5, 20.5, 0, 10.5, T);                                                    // sol
  GEO.boxTris(-0.7, 0, -0.7, 20.7, 3, -0.5, T); GEO.boxTris(-0.7, 0, 10.5, 20.7, 3, 10.7, T); GEO.boxTris(-0.7, 0, -0.7, -0.5, 3, 10.7, T); GEO.boxTris(20.5, 0, -0.7, 20.7, 3, 10.7, T);   // murs
  GEO.boxTris(9.9, 0, -0.5, 10.1, 3, 4, T); GEO.boxTris(9.9, 0, 6, 10.1, 3, 10.5, T);                 // cloison, porte de z = 4 à 6
  GEO.boxTris(4, 0, 4, 6, 0.8, 5, T);                                                                  // table
  for (const [a, b, c, d] of [[17, 7.5, 20.5, 7.7], [17, 7.5, 17.2, 10.5]]) GEO.boxTris(a, 0, b, c, 3, d, T);   // placard fermé (x 17–20,5, z 7,5–10,5)
  T.push(-0.7, 3, -0.7, 20.7, 3, -0.7, 20.7, 3, 10.7, -0.7, 3, -0.7, 20.7, 3, 10.7, -0.7, 3, 10.7);  // plafond (face vers le bas, comme dans le jeu)
  const rows = Array.from({ length: 11 }, (_, z) => Array.from({ length: 21 }, (_, x) => (x === 10 && (z < 4 || z > 6) ? 'x' : '0')).join(''));
  const soup = GEO.createSoup(new Float32Array(T)), map = { outdoor: false, inMap: (x, z) => x > -2 && x < 22 && z > -2 && z < 12, isFloor: (x, z) => rows[Math.round(z)]?.[Math.round(x)] === '0', groundY: () => 0 };
  const G = GEO.createGeo(soup, map), why = (x, y, z) => G.status({ x, y, z }).why;
  ok('géométrie : libre, mur, meuble, plafond, sol, vide, hors carte, trop près', why(3, 1.6, 2) === null && why(10, 1.5, 2) === 'volume' && why(5, 0.4, 4.5) === 'volume' && why(3, 3.5, 2) === 'plafond' && why(3, -1, 2) === 'sous_le_sol' && why(-1.5, 1, 2) === 'vide' && why(-30, 1, 2) === 'hors_carte' && why(9.8, 1.5, 2) === 'trop_pres' && why(5, 1.5, 4.5) === null,
    [why(3, 1.6, 2), why(10, 1.5, 2), why(5, 0.4, 4.5), why(3, 3.5, 2), why(3, -1, 2), why(-1.5, 1, 2), why(-30, 1, 2), why(9.8, 1.5, 2)].join(' '));
  const a0 = { x: 3, y: 1.6, z: 2 }, b0 = { x: 15, y: 1.6, z: 2 }, R = G.route(a0, b0);
  ok('géométrie : rayon arrêté par la cloison, libre par la porte, chemin qui contourne', Math.abs(G.blockedAt(a0, b0) - 6.9) < 0.01 && G.blockedAt({ x: 3, y: 1.6, z: 5 }, { x: 15, y: 1.6, z: 5 }) === null && !!R && R.length >= 3 && R.every((p, i) => !i || G.blockedAt(R[i - 1], p) === null) && R.some(p => Math.abs(p.x - 10) < 0.6 && p.z > 4 && p.z < 6));
  const spots = G.freeSpots({ x: 5, y: 1.4, z: 7 }, { n: 5 }), nf = G.nearestFree({ x: 10, y: 1.5, z: 2 }), up = G.nearestFree({ x: 3, y: 5, z: 2 });
  ok('géométrie : positions libres avec le sujet en vue, point libre le plus proche', spots.length === 5 && spots.every(p => G.free(p, 0.3) && G.blockedAt(p, { x: 5, y: 1.4, z: 7 }, true, 0.35) === null) && !!nf && G.free(nf) && Math.abs(nf.x - 10) <= 1 && !!up && up.y < 3 && G.free(up));
  const smp = Array.from({ length: 21 }, (_, i) => ({ t: i * 100, x: 3 + i * 0.6, y: 1.6, z: 2 })), K0 = G.check(smp), fast = G.check([{ t: 0, x: 9, y: 1.6, z: 2 }, { t: 100, x: 11, y: 1.6, z: 2 }]);
  ok('géométrie : contrôle échantillon par échantillon (traversée vue même entre deux échantillons libres)', K0.bad >= 1 && K0.list[0] === null && K0.list[20] === null && fast.bad === 1 && fast.list[1] === 'traverse', JSON.stringify(K0.reasons));
  const mesh = { isMesh: true, visible: true, material: {}, geometry: { attributes: { position: { count: T.length / 3, itemSize: 3, array: new Float32Array(T) } } }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, children: [] };
  const ghost = { ...mesh, material: { transparent: true, opacity: 0.1 } }, hidden = { ...mesh, visible: false }, moved = { ...mesh, geometry: { attributes: { position: { count: 3, itemSize: 3, array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) } } }, matrixWorld: { elements: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1] } };
  const ex = GEO.extractTriangles([{ children: [mesh, ghost, hidden] }]), mv = GEO.extractTriangles([moved]);
  ok('géométrie : triangles relevés dans la scène (repère du monde ; ni le caché ni les fumées)', ex.count === T.length / 9 && [...mv.tris].join() === '5,0,0,7,0,0,5,2,0');

  // ------------------------------------------------------------ Connaissance des lieux
  const all = JSON.stringify(PL.PLACES) + JSON.stringify(PL.DISTRICTS), tac = PL.placeInfo('pizzeria_coco');
  ok('lieux : fiche de Teddy Bear Tacos (mascottes originales, aucune référence à une œuvre existante)', /Teddy Bear Tacos/.test(tac.resume) && /mascottes/.test(tac.resume) && tac.zones.length > 20 && !/fnaf|freddy|fazb|bonnie|chica|foxy|five nights/i.test(all) && PL.placeInfo('hopital_5') === PL.PLACES.hopital && PL.placeInfo('pharmacie_tour') === PL.PLACES.pharmacie && PL.roomName('pizzeria_coco') === 'Teddy Bear Tacos');
  const FURNI = { anim_teddy: { name: 'Teddy l’Ours', w: 1, d: 1 }, affiche_tacos: { name: 'Affiche', w: 2, d: 1 }, dessins_enfants: { name: 'Dessins d’enfants', w: 2, d: 1 }, table_fete: { name: 'Table de fête', w: 2, d: 1 }, caisses: { name: 'Caisses de légumes', w: 1, d: 1 }, scene_coco: { name: 'Scène', w: 6, d: 2 } };
  const room = { id: 'pizzeria_coco', name: 'Teddy Bear Tacos', rows, outdoor: false, portals: [{ x: 2, y: 10, to: 'ville' }],
    items: [{ id: 'p7', type: 'anim_teddy', x: 15, y: 2, rot: 0 }, { id: 'p164', type: 'affiche_tacos', x: 5, y: 0, rot: 0 }, { id: 'p165', type: 'dessins_enfants', x: 12, y: 0, rot: 0 }, { id: 'p3', type: 'table_fete', x: 4, y: 4, rot: 0 }, { id: 'p4', type: 'caisses', x: 18, y: 9, rot: 0 }, { id: 'p5', type: 'scene_coco', x: 12, y: 1, rot: 0 }] };
  const split = PL.splitRooms(rows), D = PL.describePlace(room, { furni: FURNI, npcs: [{ id: 2, name: 'Nina', title: 'Gérante', x: 15, z: 8 }], at: { x: 3, z: 5 }, ceil: () => 3 });
  ok('lieux : plan découpé en pièces', split.length === 2 && split[0].area === 110 && split[1].area === 110, JSON.stringify(split.map(r => [r.x0, r.x1, r.z0, r.z1])));
  ok('lieux : describe_place — pièces, plafond, entrées, mascottes ≠ décor ≠ PNJ', D.lieu === 'Teddy Bear Tacos' && D.pieces.length === 2 && D.pieces[0].le_joueur_est_ici && D.pieces[0].hauteur_sous_plafond === 3 && D.pieces[0].communique_avec?.length === 1 && D.entrees[0].vers.startsWith('Big Street')
    && D.mascottes.liste.length === 1 && D.mascottes.liste[0].nom === 'Teddy l’Ours' && D.mascottes.liste[0].id === 'p7' && D.decor.compte.Affiche === 1 && D.decor.compte['Dessins d’enfants'] === 1 && !JSON.stringify(D.mascottes).includes('Affiche') && D.pnj[0].role === 'Gérante' && D.mobilier_marquant.some(m => m.nom === 'Scène')
    && PL.itemKind('anim_coco') === 'mascotte' && PL.itemKind('affiche_coco') === 'decor' && PL.itemKind('caisses') === 'mobilier' && JSON.stringify(D).length < 9000);
  const city = PL.describePlace({ id: 'ville', name: 'Big Street', outdoor: true, rows: [], items: [{ id: 9, type: 'scene_coco', x: -470, y: 745 }], portals: [{ x: -467, y: 750, to: 'pizzeria_coco' }] }, { furni: FURNI, at: { x: -470, z: 760 } });
  ok('lieux : dehors — quartier, bâtiments marquants, entrées des lieux', city.quartier?.nom === 'Les Lucioles' && city.entrees_de_lieux[0]?.vers === 'Teddy Bear Tacos' && city.batiments_et_objets_marquants.length === 1);

  // ------------------------------------------------------------ L'extension du moteur d'actions, sur un faux Studio
  const ents = [{ key: 'u:1', kind: 'joueur', id: 1, name: 'Lex', me: true, sub: 'le joueur', t0: 0, t1: Infinity }, { key: 'u:2', kind: 'pnj', id: 2, name: 'Nina', sub: 'Gérante', t0: 0, t1: Infinity }, { key: 'u:3', kind: 'pnj', id: 3, name: 'Paolo', sub: 'Cuisinier', t0: 0, t1: Infinity },
    ...room.items.map(it => ({ key: `i:${it.id}`, kind: 'objet', id: it.id, name: FURNI[it.type].name, type: it.type, x: it.x, y: it.y, t0: 0, t1: Infinity }))];
  const where = (id, t) => (id === 1 ? [3 + 14 * Math.min(1, t / 20000), 5, 0, Math.PI / 2] : id === 2 ? [15, 8, 0, 0] : id === 3 ? [19, 9, 0, 0] : null);   // (Paolo est enfermé dans le placard)
  const posAt = (key, t) => { const [k, raw] = key.split(':'); if (k === 'u') { const q = where(+raw, t); return q ? { x: q[0], y: 0, z: q[1], yaw: Math.PI / 2 - q[3], present: true } : null; } const it = room.items.find(i => String(i.id) === raw); return it ? { x: it.x, y: 0, z: it.y, yaw: Math.PI / 2, present: true } : null; };
  const world = { room, grid: rows, ox: 0, oy: 0, roomGroup: { children: [mesh] }, itemGroup: { children: [] }, isFloor: (x, z) => rows[z]?.[x] === '0', heightAt: () => 0, avatars: new Map() };
  const pb = { me: 1, where: (t, id = 1) => where(id, t), lookAt: () => ({ yaw: 0.4, pitch: -0.1 }) };
  const kit = X.createGeoKit({ world: () => world, pb: () => pb, rec: () => ({ users: new Map() }), shared: () => ({ FURNI }), entities: () => ents, posAt, T: () => 0 });
  const st = { cams: [], changes: 0, vip: false };
  const frame = (p, t) => { const q = posAt(`u:${p.id}`, t); if (!q) return null; const f = { x: q.x, y: C.ORIGIN_Y.perso, z: q.z, yaw: q.yaw }; Object.defineProperty(f, 'eye', { get: () => kit.eye(p.id, t) }); return f; };
  const norm = v => String(v ?? '').toLowerCase().trim();
  const H = { C, get cams() { return st.cams; }, set cams(v) { st.cams = v; }, get T() { return 0; }, dur: 20000, frame, info: () => ({ lieu: 'Teddy Bear Tacos', interieur: true, heure: 15, nuit: false, joueur: { id: 1, nom: 'Lex' }, compte: { pseudo: 'Lex', admin: false } }),
    entities: () => ents, find: q => (['joueur', 'le joueur'].includes(norm(q)) ? ents[0] : ents.find(e => String(e.id) === String(q) && e.kind !== 'objet') || ents.find(e => norm(e.name) === norm(q)) || null),
    posAt, blocked: () => false, aspect: () => 16 / 9, isHidden: () => false, stateOf: () => ({ etat: 'debout' }), lookOf: () => null, lookOptions: () => null, events: () => [], seek() {}, setRate() {}, play() {}, view() {}, preview: () => true, exportVideo: () => false, setLook: () => ({ done: [], refused: [] }), resetLook() {}, setHidden() {}, changed: () => { st.changes++; },
    ext: [X.createGeoExt()], geo: kit, rtMax: () => (st.vip ? 300 : 100) };
  const eng = A.createEngine(H), run = (n, a) => eng.exec(n, a), cam = n => st.cams.find(c => c.name === n);
  const badOf = c => { const S = []; const sp = C.span(c); for (let t = sp[0]; t <= sp[1]; t += 100) { const w = C.worldPose(c, t, st.cams, frame); S.push({ t, x: w.x, y: w.y, z: w.z }); } return G.check(S).bad; };
  ok('assistant : nouveaux outils décrits, prompt complété', ['describe_place', 'room_bounds', 'probe', 'free_spots', 'line_of_sight', 'check_cameras', 'path_shot', 'pov_shot'].every(n => eng.tools.some(t => t.function.name === n)) && eng.tools.length <= 64 && X.GEO_PROMPT.includes('CONTRÔLE MOTEUR') && !/fnaf|freddy|fazb/i.test(X.GEO_PROMPT));
  const dp = run('describe_place', {}), rb = run('room_bounds', { x: 3, y: 1.6, z: 2 }), pr = run('probe', { x: 3, y: 1.6, z: 2, yaw: 0 }), los1 = run('line_of_sight', { x: 3, y: 1.6, z: 9, to: { entity: 'Nina' } }), los2 = run('line_of_sight', { x: 12, y: 1.6, z: 8, to: { entity: 'Nina' } });
  ok('assistant : describe_place, room_bounds, probe, line_of_sight sur la vraie géométrie', dp.ok && dp.data.pieces.length === 2 && dp.data.le_joueur_est_dans && rb.ok && rb.data.hauteur_sous_plafond === 3 && rb.data.camera_possible_ici && Math.abs(rb.data.espace_libre_m.est - 6.9) < 0.05 && pr.ok && Math.abs(pr.data.distance - 6.9) < 0.01 && los1.ok && los1.data.visible === false && los2.data.visible === true,
    JSON.stringify([rb.data.espace_libre_m, pr.data.distance, los1.data, los2.data]));
  // sujets par id : un objet du décor par son identifiant texte, sous toutes ses formes
  const f1 = run('frame_shot', { camera: 'Mascotte', t: 0, subject: 'p7', shot: 'moyen', side: 'face' }), f2 = run('get_entity', { entity: 'i:p164' }), f3 = run('get_entity', { entity: '#2' }), f4 = run('get_entity', { entity: 'id 2' });
  ok('assistant : sujets par id fiables (objet « p7 », clé « i:p164 », « #2 », « id 2 »)', f1.ok && f1.data.sujet === 'Teddy l’Ours' && f2.ok && f2.data.nom === 'Affiche' && f3.ok && f3.data.nom === 'Nina' && f4.ok && f4.data.nom === 'Nina', [f1.text, f2.text, f3.text].join(' | '));
  const fs = run('free_spots', { subject: 'Nina', count: 4 });
  ok('assistant : free_spots — positions libres, sujet en vue', fs.ok && fs.data.positions.length === 4 && fs.data.positions.every(p => G.free(p, 0.3) && G.blockedAt(p, { x: 15, y: 1.5, z: 8 }, true, 0.35) === null));
  // trajectoire à travers la cloison (ce que faisait l'assistant) : mesurée, corrigée par un détour, et le compte rendu est celui du moteur
  const naive = C.newCam([], { x: 3, y: 1.6, z: 2, yaw: 0, pitch: 0, roll: 0, fov: 60 }, 0); for (const ch of ['x', 'y', 'z']) C.setKey(naive, ch, 6000, { x: 16, y: 1.6, z: 2 }[ch]);
  const k1 = run('set_keys', { camera: 'Travelling', keys: [{ t: 0, x: 3, y: 1.6, z: 2, yaw: 0 }, { t: 6, x: 16, y: 1.6, z: 2 }] }), tr = cam('Travelling'), cm = k1.data.controle_moteur;
  ok('trajectoires : traversée d’un mur mesurée puis corrigée par un détour (comptes du moteur dans le résultat)', badOf(naive) >= 2 && k1.ok && cm.avant >= 2 && cm.restants === 0 && cm.corrections.some(s => s.includes('détour')) && badOf(tr) === 0 && tr.tracks.x.length > 2 && k1.text.includes('contrôle moteur') && Math.abs(C.poseAt(tr, 6000).x - 16) < 1e-6,
    `${badOf(naive)} avant, ${badOf(tr)} après — ${k1.text.slice(0, 200)}`);
  const k2 = run('set_keys', { camera: 'Travelling', keys: [{ t: 6, x: 8, y: 1.6, z: 2 }] });
  ok('trajectoires : clés de détour recalculées quand le plan change (pas de résidu)', k2.ok && k2.data.controle_moteur.restants === 0 && badOf(tr) === 0 && tr.tracks.x.length === 2, `${tr.tracks.x.length} clés`);
  const k3 = run('create_camera', { name: 'Perdue', t: 0, x: -40, y: 12, z: 2, look_at: { entity: 'joueur' } }), lost = cam('Perdue'), w3 = C.worldPose(lost, 0, st.cams, frame);
  ok('trajectoires : caméra hors carte, dans le vide ou au-dessus du plafond ramenée dans le lieu, sujet en vue', k3.ok && k3.data.controle_moteur.avant === 1 && k3.data.controle_moteur.restants === 0 && G.free(w3) && G.blockedAt(w3, { x: 3, y: 1.4, z: 5 }, true, 0.4) === null, JSON.stringify([w3.x, w3.y, w3.z].map(v => +v.toFixed(1))));
  const o1 = run('orbit_shot', { camera: 'Tour', subject: 'joueur', from: 0, to: 6, degrees: 360, distance: 5 }), tour = cam('Tour');
  ok('trajectoires : travelling circulaire rapproché là où un mur s’interpose', o1.ok && o1.data.controle_moteur.avant > 0 && o1.data.controle_moteur.restants === 0 && badOf(tour) === 0, JSON.stringify(o1.data.controle_moteur).slice(0, 220));
  // chemin praticable d'une pièce à l'autre, par la porte
  const p1 = run('path_shot', { camera: 'Visite', waypoints: [{ x: 2, z: 2 }, { entity: 'Nina' }], from: 6, to: 14, height: 1.4 }), vis = cam('Visite'), mid = C.worldPose(vis, 10000, st.cams, frame);
  ok('path_shot : travelling le long d’un chemin praticable (passe par la porte, regarde devant)', p1.ok && p1.data.controle_moteur.restants === 0 && badOf(vis) === 0 && p1.data.longueur_m > 10 && vis.tracks.x.length >= 4 && Math.abs(C.worldPose(vis, 6000, st.cams, frame).x - 2) < 0.3 && mid.y > 1.3 && mid.y < 1.5, p1.text.slice(0, 220));
  const p2 = run('path_shot', { camera: 'Impossible', waypoints: [{ x: 2, z: 2 }, { x: 19, z: 9 }], from: 0, to: 5 });
  ok('path_shot : pas de chemin (pièce fermée) → refus expliqué, rien n’est inventé', !p2.ok && /pas de chemin praticable/.test(p2.text) && !cam('Impossible'), p2.text.slice(0, 160));
  // vue subjective : la caméra est aux yeux du personnage, regard du record
  const v1 = run('pov_shot', { camera: 'Subjective', from: 14, to: 18 }), sub = cam('Subjective'), ws = C.worldPose(sub, 16000, st.cams, frame), ey = kit.eye(1, 16000);
  ok('vue subjective : caméra = yeux du joueur, regard du record ; gardée à l’enregistrement', v1.ok && sub.pov && sub.parent?.id === 1 && ws.pov && Math.abs(ws.x - ey.x) < 1e-6 && Math.abs(ws.y - 1.68) < 1e-6 && Math.abs(ws.yaw - 0.4) < 1e-6 && Math.abs(ws.pitch + 0.1) < 1e-6
    && C.loadProject(JSON.parse(C.saveProject('x', 1, st.cams))).cams.find(c => c.name === 'Subjective').pov === true && C.loadProject({ v: 5, cams: [{ id: 'a', pov: true, tracks: {} }] }).cams[0].pov === false);
  // honnêteté : un sujet enfermé — le moteur ne peut pas le montrer ; le modèle a beau dire « corrigé », la réponse porte la mesure
  st.cams = []; const script = [
    { content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'set_keys', arguments: JSON.stringify({ camera: 'Paolo', keys: [{ t: 0, x: 14, y: 1.6, z: 3, look_at: { entity: 'Paolo' } }, { t: 4, x: 13, y: 1.6, z: 4, look_at: { entity: 'Paolo' } }] }) } }] },
    { content: 'Corrigé : plus aucun mur traversé, Paolo est bien visible.' }, { content: 'C’est corrigé, tout est parfait.' }, { content: 'Tout est corrigé.' }];
  let n = 0; const hist = [], seenReq = [], res = await A.runTurn(H, hist, 'Filme Paolo.', async req => { seenReq.push(req); return { ok: true, message: { role: 'assistant', ...script[Math.min(n++, script.length - 1)] } }; });
  ok('honnêteté : « corrigé » démenti par la mesure du moteur (vérification forcée, puis la vérité dans la réponse)', hist.some(m => m.role === 'user' && m.content.includes('[Vérification automatique du Studio]') && m.content.includes('le moteur mesure')) && /Contrôle moteur des caméras : \d+ échantillons? sur \d+ encore en défaut/.test(res.text) && res.text.includes('sujet caché')
    && seenReq[0].messages[0].content.includes('CONTRÔLE MOTEUR') && seenReq[0].messages[1].content.includes('fiche_du_lieu') && hist.find(m => m.role === 'tool').content.includes('controle_moteur'), res.text.slice(-260));
  st.cams = []; n = 0; const good = [{ content: '', tool_calls: [{ id: 'b', type: 'function', function: { name: 'frame_shot', arguments: JSON.stringify({ camera: 'Nina', t: 0, subject: 'Nina', shot: 'moyen', side: 'face' }) } }, { id: 'c', type: 'function', function: { name: 'frame_shot', arguments: JSON.stringify({ camera: 'Nina', t: 4, subject: 'Nina', shot: 'rapproche_taille', side: 'face' }) } }] }, { content: 'Un plan sur Nina.' }];
  const res2 = await A.runTurn(H, [], 'Filme Nina.', async () => ({ ok: true, message: { role: 'assistant', ...good[Math.min(n++, 1)] } }));
  ok('honnêteté : montage sain → « aucun dans un mur » écrit par le moteur', /Contrôle moteur des caméras : \d+ échantillons vérifiés.*aucun dans un mur/.test(res2.text), res2.text.slice(-200));
  // actions refusées : écrites sous la réponse par le moteur, sauf si le même outil a réussi ensuite
  st.cams = []; n = 0; const lie = [{ content: '', tool_calls: [{ id: 'r1', type: 'function', function: { name: 'frame_shot', arguments: '{"camera":"A","t":0,"subject":"Inconnu","shot":"moyen"}' } }, { id: 'r2', type: 'function', function: { name: 'set_visibility', arguments: '{"entity":"Fantôme","visible":false}' } }, { id: 'r3', type: 'function', function: { name: 'frame_shot', arguments: '{"camera":"A","t":0,"subject":"Nina","shot":"moyen"}' } }, { id: 'r4', type: 'function', function: { name: 'frame_shot', arguments: '{"camera":"A","t":3,"subject":"Nina","shot":"moyen"}' } }] }, { content: 'C’est fait : le fantôme est masqué et Nina est cadrée.' }];
  const res3 = await A.runTurn(H, [], 'Masque le fantôme et cadre Nina.', async () => ({ ok: true, message: { role: 'assistant', ...lie[Math.min(n++, 1)] } }));
  ok('honnêteté : action refusée et non rattrapée écrite sous la réponse (pas celle qui a réussi ensuite)', /Une action a été refusée par le Studio et n’a PAS été faite/.test(res3.text) && res3.text.includes('• set_visibility — « Fantôme »') && !res3.text.includes('• frame_shot') && A.refusedText([{ ok: true, name: 'a', text: '✓' }]) === '' && X.GEO_PROMPT.includes('ACTIONS REFUSÉES'), res3.text.slice(-240));
  // familles d'outils à la demande : caméras et géométrie toujours ; le reste selon la demande, les outils déjà appelés, ou list_tool_groups
  const fake = { tools: [{ name: 'add_object', description: 'Ajoute un objet (essai).', parameters: { type: 'object', properties: {} }, mut: true }, { name: 'set_world', description: 'Règle le monde (essai).', parameters: { type: 'object', properties: {} }, mut: true }], prompt: '\nPROMPT-ANIM', create: (h, k) => ({ RUN: { add_object: () => k.ok('objet ajouté'), set_world: () => k.ok('monde réglé') } }) };
  const H2 = Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(H), ext: { value: [X.createGeoExt(), fake], enumerable: true } }), reqs = [], names = r => r.tools.map(t => t.function.name);
  st.cams = []; n = 0; const sc = [{ content: '', tool_calls: [{ id: 'g1', type: 'function', function: { name: 'list_tool_groups', arguments: '{"enable":["animation"]}' } }] }, { content: '', tool_calls: [{ id: 'g2', type: 'function', function: { name: 'add_object', arguments: '{}' } }] }, { content: 'Fait.' }];
  const hg = []; await A.runTurn(H2, hg, 'Un plan large sur moi.', async req => { reqs.push(req); return { ok: true, message: { role: 'assistant', ...sc[Math.min(n++, 2)] } }; });
  n = 2; await A.runTurn(H2, hg, 'Merci, et maintenant exporte en mp4 avec une ambiance de nuit.', async req => { reqs.push(req); return { ok: true, message: { role: 'assistant', content: 'Voilà.' } }; });
  ok('familles d’outils : seules les utiles partent au modèle, ouvertes à la demande et gardées ensuite', !names(reqs[0]).includes('add_object') && !names(reqs[0]).includes('set_appearance') && names(reqs[0]).includes('frame_shot') && names(reqs[0]).includes('path_shot') && names(reqs[0]).includes('list_tool_groups') && !reqs[0].messages[0].content.includes('PROMPT-ANIM') && reqs[0].messages[0].content.includes('Outils à la demande')
    && names(reqs[1]).includes('add_object') && !names(reqs[1]).includes('set_world') && reqs[1].messages[0].content.includes('PROMPT-ANIM') && names(reqs[3]).includes('add_object') && names(reqs[3]).includes('set_world') && names(reqs[3]).includes('export_video') && names(reqs[0]).length < names(reqs[3]).length,
    `${names(reqs[0]).length} outils puis ${names(reqs[1]).length}, puis ${names(reqs[3]).length}`);
  // raytracing : 100 pour tous, 300 pour un compte VIP ; réglages fins
  run('create_camera', { name: 'RT', t: 0, x: 3, y: 1.6, z: 5 }); const u1 = run('update_camera', { camera: 'RT', raytracing: 250, rt_ao: 150, rt_reflets: 40 }), rt = cam('RT'), v0 = rt.rt;
  st.vip = true; const u2 = run('update_camera', { camera: 'RT', raytracing: 250 }), k9 = run('set_keys', { camera: 'RT', keys: [{ t: 0, raytracing: 300 }, { t: 2, raytracing: 100 }] });
  const back = C.loadProject(JSON.parse(C.saveProject('x', 1, [rt]))).cams[0];
  ok('raytracing : 100 sans VIP, jusqu’à 300 avec ; réglages fins gardés', u1.ok && v0 === 1 && /limité à 100/.test(u1.text) && rt.rtAo === 1.5 && rt.rtRefl === 0.4 && u2.ok && k9.ok && rt.tracks.rt[0].v === 3 && Math.abs(C.fxAt(rt, 1000).rt - 2) < 1e-6 && C.fxAt(rt, 0).rtAo === 1.5 && back.rtAo === 1.5 && back.tracks.rt[0].v === 3 && C.RT_MAX === 3,
    `${v0} puis ${rt.tracks.rt[0].v}`);
}

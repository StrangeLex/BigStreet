// Big Street Studio — l'intelligence de la scène pour l'assistant IA (21/11) : une extension du moteur d'actions (ai-tools.js).
//  - connaissance du lieu : describe_place (fiche du lieu, pièces, couloirs, plafonds, entrées, mascottes ≠ décor ≠ PNJ) ;
//  - géométrie vraie (geo.js : les triangles de la scène dessinée) : probe, room_bounds, free_spots, line_of_sight ;
//  - trajectoires sûres : après CHAQUE action sur une caméra, le moteur la contrôle échantillon par échantillon (tous les 100 ms le
//    long de son interpolation, pas seulement aux clés), la corrige lui-même (clé repoussée au point libre le plus proche, détour
//    par des clés intermédiaires, mouvement raccourci, caméra attachée rapprochée de son sujet) et REND LE COMPTE MESURÉ à
//    l'assistant ; le montage final est recontrôlé et le compte est écrit dans la réponse — l'assistant ne peut pas dire « corrigé »
//    si le moteur ne le mesure pas ;
//  - path_shot : travelling le long d'un chemin praticable (visite d'un lieu) ; pov_shot : vraie vue subjective (yeux du personnage).
// Deux moitiés : createGeoKit (côté page : lit le monde du jeu) et createGeoExt (côté moteur d'actions : outils et contrôles).
// L'extension est passée au moteur par l'hôte (H.ext) : ai-tools.js n'importe rien (tools/selftest.mjs le charge seul).
import { extractTriangles, createSoup, createGeo, reasonsText, WHY } from '/__studio/geo.js';
import { describePlace, placeBrief } from '/__studio/places.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const nrm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SIDE_NAMES = [[0, 'face'], [45, 'trois_quarts_droit'], [90, 'profil_droit'], [135, 'trois_quarts_dos_droit'], [180, 'dos'], [-135, 'trois_quarts_dos_gauche'], [-90, 'profil_gauche'], [-45, 'trois_quarts_gauche']];
const CARD = a => ['est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest', 'nord', 'nord-est'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];

// ---------------------------------------------------------------- Côté page : la scène du jeu
/**
 * Ce que l'extension lit du monde. S : { world(), pb(), rec(), shared(), entities() (liste de scene.js), posAt(key, t), T() }.
 * Rend l'objet « H.geo » de l'hôte : geo() (questions de géométrie — la scène est relevée à la demande et gardée tant qu'elle ne
 * change pas), describe(…), brief(), pieces(), eye(id, t), stats().
 */
export function createGeoKit(S) {
  let G = null, sig = '', builtAt = 0, stats = null, placeKey = '', placeCache = null;
  const signature = w => `${w.room?.id}|${w.roomGroup?.children.length}|${w.itemGroup?.children.length}|${w.chunks?.size || 0}`;
  function build() {
    const w = S.world(); if (!w?.room || !w.roomGroup) return null;
    const s = signature(w), now = Date.now();
    if (G && (s === sig || now - builtAt < 1500)) return G;
    const t0 = Date.now(), fog = w.fogCulled, out = !!w.room.outdoor;
    // (ville : seulement autour de ce qui se passe — le trajet du joueur et la caméra — ; un intérieur : tout)
    let box = null;
    if (out) { const rec = S.rec(), pb = S.pb(), K = rec?.users.get(pb?.me); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; const add = (x, z) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
      if (K) for (let i = 0; i < K.x.length; i++) add(K.x[i], K.z[i]); const c = S.cam?.(); if (c) add(c.x, c.z); for (const p of S.points?.() || []) add(p.x, p.z);
      if (x1 >= x0) box = { x0: x0 - 90, x1: x1 + 90, z0: z0 - 90, z1: z1 + 90 }; }
    const R = extractTriangles([w.roomGroup, w.itemGroup], { keep: o => !!fog?.has(o), skip: o => o.isSprite || o.isPoints || o.isLine || o.userData?.studioSkip, box, max: out ? 1200000 : 2500000 });
    const soup = createSoup(R.tris, R.flags, 2, box), ox = w.ox || 0, oy = w.oy || 0, rows = w.grid || [], Hh = rows.length, Ww = Math.max(0, ...rows.map(r => r.length)), lv = !!w.levelShift;
    G = createGeo(soup, { outdoor: out,
      inMap: (x, z) => x >= ox - 1 && x <= ox + Ww && z >= oy - 1 && z <= oy + Hh,
      ...(lv ? {} : { isFloor: (x, z) => w.isFloor(Math.round(x), Math.round(z)), groundY: (x, z) => { const h = w.heightAt(x, z); return Number.isFinite(h) ? h : 0; } }),
      loaded: (x, z) => !w.chunks || !w.chunked || w.chunks.has(`${Math.floor(x / 24)},${Math.floor(z / 24)}`) });
    sig = s; builtAt = now; stats = { triangles: R.count, tronque: R.truncated, ms: Date.now() - t0, zone: box };
    return G;
  }
  const npcs = t => { const out = []; for (const e of S.entities()) { if (e.kind !== 'pnj') continue; const p = S.posAt(e.key, t >= e.t0 && t <= e.t1 ? t : Math.min(e.t1, e.t0 + 1)); if (p) out.push({ id: e.id, name: e.name, title: e.sub || '', x: p.x, z: p.z }); } return out; };
  const meAt = t => { const e = S.entities().find(x => x.me), p = e && S.posAt(e.key, t); return p ? { x: p.x, z: p.z, y: p.y } : null; };
  const ceilAt = (x, z) => { const g = build(); if (!g) return null; const f = g.groundAt(x, z) ?? 0, h = g.probe({ x, y: f + 1.2, z }, 0, Math.PI / 2, 40); return h ? h.d + 1.2 : null; };
  function describe({ at = null, zone = null, t = S.T(), radius = 45 } = {}) {
    const w = S.world(); if (!w?.room) return null;
    return describePlace(w.room, { furni: S.shared()?.FURNI || {}, npcs: npcs(t), at: at || meAt(t), ceil: w.room.outdoor ? null : ceilAt, zone, radius });
  }
  /** Les pièces du lieu (intérieur) : [{ nom, genre, x: [x0, x1], z: [z0, z1], centre }] — gardées tant qu'on reste dans la même salle */
  function pieces() {
    const w = S.world(); if (!w?.room || w.room.outdoor) return [];
    const k = `${w.room.id}|${w.room.rows?.length}`; if (placeKey === k && placeCache) return placeCache;
    const d = describePlace({ ...w.room, items: [] }, {}), all = [...(d.pieces || [])];
    for (const s of d.autres_pieces || []) { const m = /^(.*) \(([^,]+), x (-?\d+)–(-?\d+), z (-?\d+)–(-?\d+)\)$/.exec(s); if (m) all.push({ nom: m[1], genre: m[2], x: [+m[3], +m[4]], z: [+m[5], +m[6]], centre: { x: (+m[3] + +m[4]) / 2, z: (+m[5] + +m[6]) / 2 } }); }
    placeKey = k; placeCache = all; return all;
  }
  const pieceAt = (x, z) => pieces().find(p => x >= p.x[0] - 0.5 && x <= p.x[1] + 0.5 && z >= p.z[0] - 0.5 && z <= p.z[1] + 0.5) || null;
  /** Les yeux d'un personnage à l'instant t : { x, y, z, yaw, pitch } — son regard enregistré pour le joueur du record, son cap sinon */
  function eye(id, t) {
    const pb = S.pb(), w = S.world(); if (!pb || !w) return null; const q = pb.where(t, id); if (!q) return null;
    const L = id === pb.me ? pb.lookAt(t) : null, yaw = L ? L.yaw : Math.PI / 2 - (q[3] || 0), pitch = L ? L.pitch : -0.04, a = w.avatars.get(id);
    let sit = a?.st === 'sit'; if (!a) { const K = S.rec()?.users.get(id); let d = K?.desc[0]; for (const x of K?.desc || []) if (x[0] <= t) d = x; sit = d?.[1]?.st === 'sit'; }
    const gy = q[2] ?? (w.heightAt(Math.round(q[0]), Math.round(q[1])) || 0);
    return { x: q[0] + Math.cos(yaw) * 0.22, y: gy + (sit ? 1.25 : 1.68), z: q[1] + Math.sin(yaw) * 0.22, yaw, pitch };
  }
  /** Le dessus d'un objet du décor (hauteur au-dessus du sol), mesuré dans la scène */
  function topOf(x, z) { const g = build(); if (!g?.soup) return null; const f = g.groundAt(x, z) ?? 0, h = g.soup.ray(x, f + 6, z, 0, -1, 0, 6.5); return h ? Math.max(0, 6 - h.d) : null; }
  return { geo: build, describe, brief: () => { const w = S.world(); return w?.room ? { ...placeBrief(w.room, meAt(S.T())), ...(pieceAt(meAt(S.T())?.x, meAt(S.T())?.z) ? { le_joueur_est_dans: pieceAt(meAt(S.T()).x, meAt(S.T()).z).nom } : {}) } : null; },
    pieces, pieceAt, eye, topOf, stats: () => stats, reset() { G = null; sig = ''; placeCache = null; placeKey = ''; } };
}

// ---------------------------------------------------------------- Côté moteur : outils, contrôle et correction des caméras
const P = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const Sx = (description, extra = {}) => ({ type: 'string', description, ...extra }), N = description => ({ type: 'number', description }), B = description => ({ type: 'boolean', description });
const ENT = Sx('Entité : son id, son nom, ou "joueur".'), CAM = Sx('Caméra : son nom.'), TS = N('Instant en secondes (défaut : instant courant).');
const PT = { x: N('X (m)'), y: N('Y, hauteur (m)'), z: N('Z (m)'), entity: ENT };
const T = (name, description, parameters, mut = false) => ({ name, description, parameters, mut });
export const GEO_TOOLS = [
  T('describe_place', 'Le LIEU du record, à connaître avant de filmer : ce que c’est, ambiance, les pièces (nom, genre : grande salle / salle / couloir, étendue x et z, hauteur sous plafond, mobilier, qui s’y trouve, avec quoi elle communique), les entrées, les MASCOTTES et statues (objets), le décor (affiches… : ni personnages ni mascottes), les PNJ et leur rôle. zone : le nom d’une pièce pour son détail. Dehors : le quartier et ce qu’il y a autour d’un point.', P({ zone: Sx('Nom d’une pièce à détailler.'), near: ENT, x: N('X du point décrit (dehors).'), z: N('Z du point décrit (dehors).'), t: TS })),
  T('room_bounds', 'Le volume libre autour d’un point ou d’une entité, mesuré dans la vraie géométrie : distance au premier obstacle vers l’est, l’ouest, le nord, le sud, hauteur du sol et du plafond, dans quelle pièce, et si une caméra peut s’y trouver.', P({ ...PT, t: TS })),
  T('probe', 'Lancer de rayon dans la vraie géométrie : depuis un point (ou les yeux d’une entité), dans une direction (yaw, pitch en degrés) ou vers une entité / un point (toward) → distance au premier mur, plafond, sol ou modèle.', P({ ...PT, yaw: N('Direction à plat (°) : 0 = est (+X), 90 = sud (+Z).'), pitch: N('Élévation (°) : 90 = vers le plafond, −90 = vers le sol.'), toward: { type: 'object', description: 'Viser une entité ou un point.', properties: PT, additionalProperties: false }, t: TS })),
  T('free_spots', 'Des positions de caméra LIBRES et DÉGAGÉES autour d’un sujet (entité, objet ou point), vérifiées par le moteur : pas dans un mur ni un meuble, sous le plafond, avec le sujet en vue. Chaque position (x, y, z) est utilisable telle quelle dans create_camera ou set_keys avec look_at. À utiliser dès que frame_shot signale un obstacle ou pour un cadrage sur mesure.', P({ subject: ENT, x: N('X du point à regarder.'), y: N('Y du point à regarder.'), z: N('Z du point à regarder.'), t: TS, distance: N('Distance souhaitée au sujet (m).'), side: Sx('Côté souhaité par rapport au regard du sujet (face, dos, profil_droit…).'), count: N('Nombre de positions (défaut 6).') })),
  T('line_of_sight', 'Le sujet est-il visible depuis un point ou depuis une caméra (à un instant) ? Rend visible oui/non et la distance du premier obstacle.', P({ camera: CAM, x: N('X du point de vue.'), y: N('Y.'), z: N('Z.'), to: { type: 'object', description: 'Ce qu’on veut voir : entité ou point.', properties: PT, additionalProperties: false }, t: TS }, ['to'])),
  T('check_cameras', 'Contrôle moteur des trajectoires : chaque caméra (ou une seule) est vérifiée échantillon par échantillon le long de son mouvement — dans un mur / meuble / modèle, hors carte, dans le vide, sous le sol, au-dessus du plafond, traversée d’un obstacle, sujet caché — et corrigée automatiquement (fix, vrai par défaut). Rend les comptes MESURÉS avant et après : ce sont les seuls chiffres à annoncer.', P({ camera: CAM, fix: B('Corriger automatiquement (défaut vrai).') }), true),
  T('path_shot', 'Travelling le long d’un CHEMIN PRATICABLE calculé par le moteur (il contourne murs et meubles, passe par les portes) : pour visiter ou découvrir un lieu, traverser un couloir, aller d’une pièce à une autre. waypoints : étapes dans l’ordre — { place: "nom de pièce" }, { entity: … } (s’arrête devant, en vue) ou { x, z }. La caméra regarde devant elle (look: "devant") ou vers une entité / un point. Vitesse conseillée : 1 à 2,5 m/s.', P({ camera: Sx('Nom de la caméra (créée si elle n’existe pas).'), waypoints: { type: 'array', description: 'Étapes du trajet, dans l’ordre (au moins 2).', items: { type: 'object', properties: { place: Sx('Nom d’une pièce (describe_place).'), entity: ENT, x: N('X'), z: N('Z') }, additionalProperties: false } }, from: N('Début (s).'), to: N('Fin (s).'), height: N('Hauteur de la caméra au-dessus du sol (m), défaut 1,5 ; 0,5 = au ras du sol (inquiétant).'), look: { description: '"devant" (défaut), ou une entité / un point à regarder pendant tout le trajet.', anyOf: [{ type: 'string' }, { type: 'object', properties: PT, additionalProperties: false }] }, pitch: N('Tangage (°) quand elle regarde devant, défaut 0.'), fov: N('Focale (°), défaut 65.'), ease: Sx('Interpolation.', { enum: ['fluide', 'doux', 'accel', 'frein'] }) }, ['camera', 'waypoints', 'from', 'to']), true),
  T('pov_shot', 'VRAIE vue subjective : la caméra EST les yeux d’un personnage (par défaut le joueur) de « from » à « to » — elle bouge avec lui et regarde où il regardait dans le record ; sa tête est masquée. C’est le seul outil à utiliser pour « vue subjective », « à la première personne », « par ses yeux », « POV ».', P({ camera: Sx('Nom de la caméra (créée si elle n’existe pas).'), subject: ENT, from: N('Début (s).'), to: N('Fin (s).'), fov: N('Focale (°), défaut 75.') }, ['camera', 'from', 'to']), true),
];
export const GEO_PROMPT = `

# Le lieu et sa géométrie (le moteur mesure tout : sers-t'en)
- Avant de placer une caméra, appelle describe_place : tu sauras où tu es (les pièces et leurs coordonnées, les couloirs, la hauteur sous plafond, les entrées), ce qui est une MASCOTTE ou une statue (objet du décor, filmable par son id), ce qui n'est que du décor (affiches, dessins, caisses, panneaux : jamais des personnages) et qui sont les PNJ. Ne nomme jamais un objet autrement que par son nom donné par les outils ; n'invente ni personnage ni référence à une œuvre existante.
- Un sujet peut être n'importe quelle entité listée — joueur, PNJ, véhicule ou OBJET du décor — par son id exact (ex. 1886, "p164") ou son nom.
- Positions : n'invente pas de coordonnées au hasard. Utilise frame_shot / orbit_shot (cadrage calculé), free_spots (positions libres garanties autour d'un sujet), path_shot (travelling le long d'un chemin praticable : visite, couloir, d'une pièce à l'autre) ; room_bounds et probe mesurent l'espace libre ; line_of_sight dit si le sujet est visible.
- Découvrir, visiter ou présenter un lieu : au moins un path_shot qui enchaîne les pièces voisines (ex. Hall d'entrée → Vestibule → Grande salle), puis des plans sur ce qu'il y a à voir (mascottes par leur id, PNJ). À l'intérieur il y a un plafond : pas de hauteur « aerien » ni « forte_plongee », pas de plan « tres_large » ; « plongee » au plus.
- Vue subjective / première personne / « par ses yeux » : pov_shot, et rien d'autre.
- CONTRÔLE MOTEUR : après chaque action sur une caméra, le moteur vérifie sa trajectoire échantillon par échantillon (murs, meubles, modèles, plafond, sol, vide, hors carte, sujet caché), la corrige lui-même et te rend « controle_moteur » avec les comptes mesurés. Ces comptes sont la seule vérité : ne dis JAMAIS « corrigé » ou « plus de murs traversés » si « restants » n'est pas 0 — dis ce qui reste et propose une autre approche (free_spots, path_shot, plan plus court). Ne décale pas des coordonnées au hasard pour « corriger » : rappelle l'outil de cadrage ou check_cameras.
- ACTIONS REFUSÉES : un outil qui répond ✗ n'a RIEN fait. Ne dis jamais qu'une chose est faite si son outil a répondu ✗ : réessaie autrement (autre outil, autre paramètre — le message d'erreur dit lesquels), ou dis clairement à l'utilisateur ce qui n'a pas pu être fait et pourquoi. Un outil plus large utilisé à la place (ex. tout le lieu au lieu d'une pièce) doit être annoncé comme tel. Le Studio écrit de toute façon sous ta réponse la liste des actions refusées.
- Raytracing : 0 à 100 ; jusqu'à 300 pour un compte VIP (rendu poussé : occlusion plus profonde, halos et reflets renforcés). update_camera règle aussi rt_ao, rt_radius, rt_bloom, rt_reflets (0 à 200, 100 = normal).`;

/** L'extension du moteur d'actions : { tools, prompt, create(H, kit) → { RUN, after(name, args, result), problems(), recapText(), digest() } } */
export function createGeoExt() {
  return { tools: GEO_TOOLS, prompt: GEO_PROMPT, create(H, kit) {
    const C = H.C, { ok, ko, ms, ent, camOf, noCam, writePose, fmtT, headY } = kit;
    const geo = () => { try { return H.geo?.geo() || null; } catch (e) { console.warn('géométrie indisponible', e); return null; } };
    const NOGEO = 'La géométrie de la scène n’est pas disponible (scène non chargée).';
    const tNow = a => ms(a?.t, Math.round(H.T));
    const posOf = (e, t) => H.posAt(e.key, t);
    const headOf = (e, t) => { const p = posOf(e, t); if (!p) return null; const h = e.kind === 'objet' ? Math.max(0.4, (H.geo?.topOf?.(p.x, p.z) ?? 1) * 0.62) : headY(e); return { x: p.x, y: p.y + h, z: p.z, yaw: p.yaw || 0, floor: p.y, name: e.name }; };
    /** Un point donné par l'assistant : entité (sa tête), ou x / y / z (y par défaut : 1,5 m au-dessus du sol) */
    function point(a, t, G) {
      if (a?.entity != null && a.entity !== '') { const e = ent(a.entity); return e ? headOf(e, t) : null; }
      const x = num(a?.x), z = num(a?.z); if (x === null || z === null) return null;
      const f = G?.groundAt(x, z) ?? 0; return { x, y: num(a.y) ?? f + 1.5, z, floor: f, name: 'le point' };
    }
    const wAt = (c, t) => C.worldPose(c, t, H.cams, H.frame);
    function targetOf(c, t, w) {
      if (c.look && w?.P) return { x: w.P.x, y: w.P.y - 0.12, z: w.P.z };
      if (c.aim) { const e = H.entities().find(x => x.key === c.aim), h = e && headOf(e, t); if (h) return h; }
      return null;
    }
    /** Les échantillons d'une caméra le long de son mouvement (tous les 100 ms ; une seule clé : un échantillon) */
    function samplesOf(c, t0 = null, t1 = null) {
      const sp = C.span(c); if (!sp) return [];
      const a = Math.max(sp[0], t0 ?? sp[0]), b = Math.min(sp[1], t1 ?? sp[1]), step = Math.max(100, Math.ceil((b - a) / 500)), out = [];
      for (let t = a; t <= b + 0.5; t += step) { const w = wAt(c, t); if (!w || w.lost) continue; out.push({ t, x: w.x, y: w.y, z: w.z, target: c.pov ? null : targetOf(c, t, w), exempt: !!c.pov }); if (b - a < 1) break; }
      return out;
    }
    function measure(c) { const G = geo(), S = samplesOf(c); if (!G || !S.length) return null; const R = G.check(S); return { ...R, S }; }
    const intervals = (S, list) => { const out = []; let cur = null; S.forEach((s, i) => { const w = list[i]; if (w && w !== 'non_verifie') { if (cur && cur.why === w) cur.to = s.t; else out.push(cur = { from: s.t, to: s.t, why: w }); } else cur = null; }); return out.map(o => `${r1(o.from / 1000)}→${r1(o.to / 1000)} s : ${WHY[o.why] || o.why}`); };
    /** Pose la position (monde) d'une caméra à l'instant t ; auto : clé ajoutée par le moteur (retirée et recalculée au contrôle suivant) */
    function setPos(c, t, p, auto = false) {
      const had = ['x', 'y', 'z'].map(ch => C.keyAt(c.tracks[ch], t) >= 0);
      writePose(c, t, { x: p.x, y: p.y, z: p.z }, false, auto ? 'fluide' : null);
      ['x', 'y', 'z'].forEach((ch, i) => { const k = c.tracks[ch][C.keyAt(c.tracks[ch], t)]; if (k && auto && !had[i]) k.auto = true; });
      // (une caméra libre qui visait un sujet à cette clé le vise encore depuis sa nouvelle place)
      if (!c.parent && c.aim && C.keyAt(c.tracks.yaw, t) >= 0) { const tg = targetOf(c, t, null); if (tg) { const dx = tg.x - p.x, dy = tg.y - p.y, dz = tg.z - p.z; writePose(c, t, { yaw: Math.atan2(dz, dx), pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.55, 1.55) }); } }
    }
    const dropAuto = c => { let n = 0; for (const ch of ['x', 'y', 'z']) { const L = c.tracks[ch], m = L.length; c.tracks[ch] = L.filter(k => !k.auto); n += m - c.tracks[ch].length; } return n; };
    const meHead = t => { const e = H.entities().find(x => x.me); return e ? headOf(e, t) : null; };
    /** Un point libre pour une clé mal placée : au plus près, le sujet en vue si possible ; perdue loin de tout : près du sujet ou du joueur */
    function rescue(G, w, tg, t) {
      let q = (tg && G.nearestFree(w, { see: tg, maxR: 6 })) || G.nearestFree(w, { maxR: 9 });
      if (!q) { const s = tg || meHead(t); if (s) { const f = G.freeSpots(s, { n: 1, prefer: { az: Math.atan2(w.z - s.z, w.x - s.x), dist: clamp(Math.hypot(w.x - s.x, w.z - s.z), 1.5, 6) } })[0]; if (f) q = { x: f.x, y: f.y, z: f.z }; } }
      return q;
    }
    function fixFree(c, G, log) {
      const KT = () => C.keyTimes(c, ['x', 'y', 'z']);
      // 1. chaque clé de position : dans un obstacle, hors du lieu, ou sans vue sur son sujet → au point libre le plus proche
      for (const t of KT()) {
        const w = wAt(c, t); if (!w) continue; const tg = targetOf(c, t, w), st = G.status(w);
        if (st.why === 'non_verifie') continue;
        const hid = !st.why && tg && G.blockedAt(w, tg, true, 0.4) !== null; if (!st.why && !hid) continue;
        const q = rescue(G, w, tg, t); if (q) { setPos(c, t, q); log.push(`clé de ${fmtT(t)} déplacée de ${r1(dist3(q, w))} m (${st.why ? WHY[st.why] : WHY.masque})`); } else if (st.why) log.push(`clé de ${fmtT(t)} : aucun point libre trouvé à proximité`);
      }
      // 2. entre deux clés : un obstacle sur le trajet → détour par des clés intermédiaires, sinon le mouvement s'arrête avant
      const K = KT();
      for (let i = 0; i + 1 < K.length; i++) {
        const a = K[i], b = K[i + 1]; if (b - a < 200 || C.easeOf(c, 'x', a) === 'fixe') continue;
        const S = samplesOf(c, a, b), R = G.check(S); if (!S.length || !R.list.some(w => w && w !== 'masque' && w !== 'non_verifie')) continue;
        const pa = wAt(c, a), pb = wAt(c, b), L0 = dist3(pa, pb); if (!pa || !pb) continue;
        if (L0 < 0.05) continue;
        const route = G.route(pa, pb, { step: L0 > 30 ? 1 : 0.5, pad: L0 > 30 ? 14 : 8, maxNodes: 9000 });
        let len = 0; if (route) for (let j = 1; j < route.length; j++) len += dist3(route[j - 1], route[j]);
        if (route && route.length > 2 && len <= Math.max(L0 * 3, L0 + 14)) {
          const pts = densify(route, 1.6), nMax = Math.max(1, Math.floor((b - a) / 120) - 1), every = Math.max(1, Math.ceil((pts.length - 2) / nMax)); let acc = 0, n = 0;
          for (let j = 1; j < pts.length - 1; j++) { acc += dist3(pts[j - 1], pts[j]); if (j % every) continue; setPos(c, Math.round(a + (b - a) * acc / len), pts[j], true); n++; }
          log.push(`de ${fmtT(a)} à ${fmtT(b)} : détour de ${r1(len)} m par ${n} clé${n > 1 ? 's' : ''} intermédiaire${n > 1 ? 's' : ''} (au lieu de traverser)`);
        } else if (!route || route.length > 2) {
          // (pas de chemin raisonnable : la caméra avance jusqu'à l'obstacle et s'y arrête)
          let d = 0; const dir = { x: (pb.x - pa.x) / L0, y: (pb.y - pa.y) / L0, z: (pb.z - pa.z) / L0 }, hit = G.blockedAt(pa, pb), lim = (hit ?? L0) - 0.45;
          for (let s = 0.25; s <= lim; s += 0.25) { if (!G.free({ x: pa.x + dir.x * s, y: pa.y + dir.y * s, z: pa.z + dir.z * s }, 0.25)) break; d = s; }
          setPos(c, b, { x: pa.x + dir.x * d, y: pa.y + dir.y * d, z: pa.z + dir.z * d });
          log.push(`de ${fmtT(a)} à ${fmtT(b)} : mouvement raccourci à ${r1(d)} m (un obstacle barre le trajet, pas de détour praticable)`);
        }
      }
      // 3. ce qui reste (courbe qui déborde dans un angle) : une clé au point libre, à l'instant du défaut
      for (let pass = 0; pass < 2; pass++) {
        const M = measure(c); if (!M || !M.bad) break; let last = -1e9, n = 0;
        M.S.forEach((s, i) => { const w = M.list[i]; if (!w || w === 'non_verifie' || s.t - last < 280 || n >= 14 || C.keyAt(c.tracks.x, s.t) >= 0) return; const q = rescue(G, s, s.target, s.t); if (q) { setPos(c, s.t, q, true); last = s.t; n++; } });
        if (!n) break; log.push(`${n} clé${n > 1 ? 's' : ''} de contournement ajoutée${n > 1 ? 's' : ''} là où la courbe débordait`);
      }
    }
    function densify(pts, max) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(dist3(a, b) / max)); for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n }); } return out; }
    /** Caméra attachée à un personnage ou un véhicule : là où elle entre dans un obstacle ou perd son sujet, elle se rapproche de lui */
    function fixAttached(c, G, log) {
      const M = measure(c); if (!M) return; const times = new Set(C.keyTimes(c, ['x', 'y', 'z'])); let last = -1e9;
      M.S.forEach((s, i) => { if (M.list[i] && M.list[i] !== 'non_verifie' && s.t - last >= 250) { times.add(s.t); last = s.t; } });
      let n = 0;
      for (const t of [...times].sort((a, b) => a - b).slice(0, 60)) {
        const w = wAt(c, t); if (!w?.P) continue; const tg = { x: w.P.x, y: w.P.y - 0.12, z: w.P.z }, st = G.status(w);
        if (st.why === 'non_verifie' || (!st.why && G.blockedAt(w, tg, true, 0.4) === null)) continue;
        let q = null; const d0 = dist3(w, tg);
        for (const f of [0.82, 0.66, 0.52, 0.4, 0.3, 0.22]) { if (d0 * f < 0.5) break; const p = { x: tg.x + (w.x - tg.x) * f, y: tg.y + (w.y - tg.y) * f, z: tg.z + (w.z - tg.z) * f }; if (G.free(p, 0.22) && G.blockedAt(p, tg, true, 0.4) === null) { q = p; break; } }
        q ||= G.nearestFree(w, { see: tg, maxR: 4 });
        if (q) { setPos(c, t, q, !C.hasKey(c, 'x', t)); n++; }
      }
      if (n) log.push(`${n} position${n > 1 ? 's' : ''} rapprochée${n > 1 ? 's' : ''} du sujet (un mur ou un meuble s’interposait)`);
    }
    /**
     * Contrôle (et corrige) une caméra. Rend { echantillons, avant, restants, raisons, intervalles, corrections, non_verifies } — des
     * comptes mesurés par le moteur ; null si la caméra n'a pas de position ou si la scène n'est pas lisible.
     */
    function control(c, fix = true) {
      const G = geo(); if (!G) return null;
      if (fix && !c.pov) dropAuto(c);
      const before = measure(c); if (!before) return null; const log = [];
      if (fix && before.bad && !c.pov) { try { if (c.parent && c.parent.kind !== 'camera') fixAttached(c, G, log); else fixFree(c, G, log); } catch (e) { console.warn('correction de caméra', e); log.push(`correction interrompue (${String(e?.message || e).slice(0, 80)})`); } }
      const after = log.length ? measure(c) || before : before, nv = after.n - after.checked;
      return { echantillons: after.n, avant: before.bad, restants: after.bad, ...(after.bad ? { raisons: reasonsText(after.reasons), intervalles: intervals(after.S, after.list).slice(0, 5) } : {}), ...(before.bad ? { defauts_avant: reasonsText(before.reasons) } : {}), ...(log.length ? { corrections: log.slice(0, 8) } : {}), ...(nv ? { non_verifies: nv } : {}) };
    }
    const controlText = R => (!R ? '' : R.restants ? ` — ⚠ contrôle moteur : ${R.restants}/${R.echantillons} échantillons encore ${R.raisons}` : R.avant ? ` — contrôle moteur : ${R.avant}/${R.echantillons} échantillons étaient ${R.defauts_avant} → corrigé par le moteur, 0 restant` : ` — contrôle moteur : ${R.echantillons} échantillon${R.echantillons > 1 ? 's' : ''}, aucun obstacle`);
    /** Le montage tel qu'il passe à l'antenne : compte des échantillons dans un obstacle, par caméra */
    function montage() {
      const G = geo(), R = C.cineRange(H.cams); if (!G || !R) return null;
      const step = Math.max(100, Math.ceil((R[1] - R[0]) / 900)), S = []; let lastCam = null;
      for (let t = R[0]; t <= R[1]; t += step) { const c = C.activeCam(H.cams, t), w = c && wAt(c, t); if (!w || w.lost) continue; S.push({ t, x: w.x, y: w.y, z: w.z, target: c.pov ? null : targetOf(c, t, w), exempt: !!c.pov, cut: c !== lastCam, cam: c.name, id: c.id }); lastCam = c; }
      const K = G.check(S), per = new Map();
      S.forEach((s, i) => { const w = K.list[i]; if (!w || w === 'non_verifie') return; const o = per.get(s.cam) || { n: 0, reasons: {}, from: s.t, to: s.t, id: s.id }; o.n++; o.reasons[w] = (o.reasons[w] || 0) + 1; o.to = s.t; per.set(s.cam, o); });
      return { n: K.n, bad: K.bad, checked: K.checked, reasons: K.reasons, per };
    }
    const MOVERS = new Set(['create_camera', 'set_keys', 'frame_shot', 'orbit_shot', 'set_parent', 'move_keys', 'duplicate_camera', 'delete_keys', 'path_shot']);
    const sideOf = (az, yaw) => { const d = Math.atan2(Math.sin(az - yaw), Math.cos(az - yaw)) * R2D; return SIDE_NAMES.reduce((b, s) => (Math.abs(Math.atan2(Math.sin((d - s[0]) * D2R), Math.cos((d - s[0]) * D2R))) < Math.abs(Math.atan2(Math.sin((d - b[0]) * D2R), Math.cos((d - b[0]) * D2R))) ? s : b))[1]; };

    const RUN = {
      describe_place(a) {
        if (!H.geo?.describe) return ko('La description du lieu n’est pas disponible.');
        const t = tNow(a), e = a.near != null && a.near !== '' ? ent(a.near) : null, p = e && posOf(e, t), x = num(a.x), z = num(a.z);
        const d = H.geo.describe({ zone: a.zone || null, t, at: p ? { x: p.x, z: p.z } : x !== null && z !== null ? { x, z } : null }); if (!d) return ko('Aucun lieu chargé.');
        return ok(`Lieu : ${d.lieu} (${d.type})${d.pieces ? `, ${d.pieces.length + (d.autres_pieces?.length || 0)} pièces` : d.quartier ? `, ${d.quartier.nom}` : ''}${d.le_joueur_est_dans ? ` — le joueur est dans « ${d.le_joueur_est_dans} »` : ''}.`, d);
      },
      room_bounds(a) {
        const G = geo(); if (!G) return ko(NOGEO); const t = tNow(a), p = point(a.entity != null || num(a.x) !== null ? a : { entity: 'joueur' }, t, G); if (!p) return ko('room_bounds : point ou entité introuvable (donne entity, ou x et z).');
        const b = G.bounds(p), f = b.status.floor ?? p.floor ?? null, piece = H.geo.pieceAt?.(p.x, p.z), q = v => (v === null ? 'dégagé (> 60 m)' : r1(v));
        const d = { point: { x: r2(p.x), y: r2(p.y), z: r2(p.z) }, ...(piece ? { piece: piece.nom, genre: piece.genre, etendue_piece: { x: piece.x, z: piece.z } } : {}), camera_possible_ici: !b.status.why, ...(b.status.why ? { raison: WHY[b.status.why] } : {}),
          sol_y: f === null ? null : r2(f), plafond_y: b.up === null ? null : r2(p.y + b.up), hauteur_sous_plafond: f === null || b.up === null ? (G.outdoor ? 'ciel' : null) : r1(p.y + b.up - f),
          espace_libre_m: { est: q(b.east), ouest: q(b.west), sud: q(b.south), nord: q(b.north) }, largeur_x: b.east !== null && b.west !== null ? r1(b.east + b.west) : null, profondeur_z: b.south !== null && b.north !== null ? r1(b.south + b.north) : null,
          plus_grand_recul: (() => { let k = 0; b.ring.forEach((v, i) => { if (v > b.ring[k]) k = i; }); return { direction: CARD(k * Math.PI / 8), yaw: Math.round(k * 22.5), distance: r1(b.ring[k]) }; })() };
        return ok(`Autour de ${p.name} (${r1(p.x)}, ${r1(p.y)}, ${r1(p.z)})${piece ? ` — ${piece.nom}` : ''} : ${d.largeur_x ?? '?'} × ${d.profondeur_z ?? '?'} m libres, plafond ${d.hauteur_sous_plafond ?? '?'}${typeof d.hauteur_sous_plafond === 'number' ? ' m' : ''}.`, d);
      },
      probe(a) {
        const G = geo(); if (!G) return ko(NOGEO); const t = tNow(a), p = point(a.entity != null || num(a.x) !== null ? a : { entity: 'joueur' }, t, G); if (!p) return ko('probe : point de départ introuvable (entity, ou x, y, z).');
        let yaw = (num(a.yaw) ?? 0) * D2R, pitch = clamp((num(a.pitch) ?? 0) * D2R, -Math.PI / 2, Math.PI / 2), max = 80, to = null;
        if (a.toward) { to = point(a.toward, t, G); if (!to) return ko('probe : « toward » introuvable.'); yaw = Math.atan2(to.z - p.z, to.x - p.x); pitch = Math.atan2(to.y - p.y, Math.hypot(to.x - p.x, to.z - p.z)); max = dist3(p, to); }
        const h = G.probe(p, yaw, pitch, max);
        const d = { depuis: { x: r2(p.x), y: r2(p.y), z: r2(p.z) }, direction: { yaw: Math.round(yaw * R2D), pitch: Math.round(pitch * R2D) }, ...(to ? { vers: to.name, distance_cible: r2(max) } : {}), obstacle: !!h, ...(h ? { distance: r2(h.d), nature: h.see ? 'vitre (on voit à travers)' : Math.abs(h.ny) > 0.7 ? (h.ny > 0 ? 'sol ou dessus d’un meuble' : 'plafond ou dessous de quelque chose') : 'mur ou flanc d’un modèle', impact: { x: r2(p.x + Math.cos(yaw) * Math.cos(pitch) * h.d), y: r2(p.y + Math.sin(pitch) * h.d), z: r2(p.z + Math.sin(yaw) * Math.cos(pitch) * h.d) } } : {}) };
        return ok(h ? `Obstacle à ${r2(h.d)} m (${d.nature}).` : to ? `Rien entre le point et ${to.name} (${r1(max)} m).` : 'Aucun obstacle à moins de 80 m dans cette direction.', d);
      },
      free_spots(a) {
        const G = geo(); if (!G) return ko(NOGEO); const t = tNow(a), e = a.subject != null && a.subject !== '' ? ent(a.subject) : null;
        if (a.subject != null && a.subject !== '' && !e) return ko(`free_spots : sujet « ${a.subject} » introuvable.`);
        const tg = e ? headOf(e, t) : point(a, t, G) || meHead(t); if (!tg) return ko('free_spots : donne subject (entité) ou x, y, z.');
        const want = num(a.distance), sd = a.side ? kit.sideAngle?.(a.side) : null, n = clamp(num(a.count) ?? 6, 1, 12);
        const L = G.freeSpots(tg, { n, floorY: tg.floor ?? null, rMin: want ? Math.max(0.8, want * 0.6) : 1.2, rMax: want ? Math.max(2, want * 1.5) : 8, prefer: { ...(want ? { dist: want } : {}), ...(sd !== null && sd !== undefined ? { az: (tg.yaw || 0) + sd } : {}) } });
        const rows = L.map(p => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z), distance: r1(p.dist), cote: e && e.kind !== 'objet' ? sideOf(p.az, tg.yaw || 0) : `au ${CARD(p.az)} du sujet`, hauteur_sol: r1(p.y - (tg.floor ?? p.y - 1.6)), degagement: r1(p.clear) }));
        if (!rows.length) return ko(`Aucune position libre avec ${tg.name} en vue dans un rayon de ${want ? r1(want * 1.5) : 8} m : essaie une autre distance, ou un autre sujet.`);
        return ok(`${rows.length} position${rows.length > 1 ? 's' : ''} libre${rows.length > 1 ? 's' : ''} autour de ${tg.name}, sujet en vue.`, { sujet: tg.name, regarder: { x: r2(tg.x), y: r2(tg.y), z: r2(tg.z) }, positions: rows, usage: 'create_camera ou set_keys avec x, y, z d’une position et look_at: { entity } (ou le point « regarder »)' });
      },
      line_of_sight(a) {
        const G = geo(); if (!G) return ko(NOGEO); const t = tNow(a), to = point(a.to || {}, t, G); if (!to) return ko('line_of_sight : « to » introuvable (entité ou point).');
        let from = null, nm = 'le point';
        if (a.camera) { const c = camOf(a.camera); if (!c) return noCam(a.camera, 'line_of_sight'); const w = wAt(c, t); if (!w) return ko(`${c.name} n’a pas de position à ${fmtT(t)}.`); from = w; nm = c.name; } else from = point(a, t, G);
        if (!from) return ko('line_of_sight : donne camera, ou x, y, z.');
        const h = G.blockedAt(from, to, true, 0.35), L = dist3(from, to);
        return ok(h === null ? `${to.name} est visible depuis ${nm} (${r1(L)} m, rien entre les deux).` : `${to.name} n’est PAS visible depuis ${nm} : un obstacle à ${r1(h)} m (sur ${r1(L)} m).`, { visible: h === null, distance: r1(L), ...(h !== null ? { obstacle_a: r1(h) } : {}) });
      },
      check_cameras(a) {
        const G = geo(); if (!G) return ko(NOGEO); const one = a.camera ? camOf(a.camera) : null; if (a.camera && !one) return noCam(a.camera, 'check_cameras');
        const L = one ? [one] : H.cams.filter(c => C.span(c)); if (!L.length) return ko('Aucune caméra à contrôler.');
        const rows = L.map(c => ({ camera: c.name, ...(control(c, a.fix !== false) || { echantillons: 0 }) })), tot = rows.reduce((s, r) => s + (r.echantillons || 0), 0), bad = rows.reduce((s, r) => s + (r.restants || 0), 0), was = rows.reduce((s, r) => s + (r.avant || 0), 0);
        return ok(`Contrôle moteur : ${tot} échantillons sur ${L.length} caméra${L.length > 1 ? 's' : ''} — ${was} en défaut avant, ${bad} après correction${bad ? ' (voir « intervalles » : à refaire autrement)' : ''}.`, { echantillons: tot, en_defaut_avant: was, restants: bad, cameras: rows });
      },
      path_shot(a) {
        const G = geo(); if (!G) return ko(NOGEO); if (!a.camera) return ko('path_shot : il manque « camera » (le nom du plan).');
        if (!Array.isArray(a.waypoints) || a.waypoints.length < 2) return ko('path_shot : il faut au moins deux étapes dans « waypoints » ({ place }, { entity } ou { x, z }).');
        const t0 = ms(a.from, Math.round(H.T)), t1 = ms(a.to, Math.round(H.dur)); if (t1 - t0 < 1000) return ko('path_shot : « to » doit être au moins 1 s après « from ».');
        const hgt = clamp(num(a.height) ?? 1.5, 0.3, 30), pieces = H.geo.pieces?.() || [], pts = [], names = [];
        for (const wp of a.waypoints.slice(0, 12)) {
          let p = null, nm = '';
          if (wp?.place) { const n = nrm(wp.place), pc = pieces.find(q => nrm(q.nom) === n) || pieces.find(q => nrm(q.nom).includes(n) || n.includes(nrm(q.nom))); if (!pc) return ko(`path_shot : pièce « ${wp.place} » inconnue (describe_place donne les noms : ${pieces.slice(0, 12).map(q => q.nom).join(', ')}…).`); p = { x: pc.centre.x, z: pc.centre.z }; nm = pc.nom; }
          else if (wp?.entity != null && wp.entity !== '') { const e = ent(wp.entity), h = e && headOf(e, t1); if (!h) return ko(`path_shot : entité « ${wp.entity} » introuvable.`); const f = G.freeSpots(h, { n: 1, floorY: h.floor, heights: [hgt], rMin: 1.6, rMax: 6, prefer: { dist: 2.6, ...(pts.length ? { az: Math.atan2(pts[pts.length - 1].z - h.z, pts[pts.length - 1].x - h.x) } : {}) } })[0]; p = f ? { x: f.x, z: f.z } : { x: h.x, z: h.z }; nm = `devant ${e.name}`; }
          else if (num(wp?.x) !== null && num(wp?.z) !== null) { p = { x: num(wp.x), z: num(wp.z) }; nm = `(${r1(p.x)}, ${r1(p.z)})`; }
          else return ko('path_shot : une étape doit être { place }, { entity } ou { x, z }.');
          const f = G.groundAt(p.x, p.z) ?? 0, q = G.nearestFree({ x: p.x, y: f + hgt, z: p.z }, { maxR: 6 }); if (!q) return ko(`path_shot : aucun point libre près de l’étape ${nm}.`);
          pts.push(q); names.push(nm);
        }
        const line = [pts[0]];
        for (let i = 1; i < pts.length; i++) { const L = dist3(pts[i - 1], pts[i]), R = G.route(pts[i - 1], pts[i], { step: L > 24 ? 1 : 0.5, pad: L > 24 ? 16 : 9, maxNodes: 14000 }); if (!R) return ko(`path_shot : pas de chemin praticable entre ${names[i - 1]} et ${names[i]} (pièces séparées ou trop éloignées : ajoute une étape intermédiaire — une pièce voisine, cf. « communique_avec » de describe_place).`); line.push(...R.slice(1)); }
        const dense = densify(line, 1.8), cum = [0]; for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist3(dense[i - 1], dense[i])); const len = cum[cum.length - 1] || 1;
        const nMax = Math.max(2, Math.min(48, Math.floor((t1 - t0) / 250))), every = Math.max(1, Math.ceil(dense.length / nMax)), ease = C.EASES[a.ease] && a.ease !== 'fixe' ? a.ease : 'fluide';
        let c = camOf(a.camera); const made = !c; if (!c) { c = C.newCam(H.cams); c.name = String(a.camera).slice(0, 40); H.cams.push(c); }
        for (const ch of ['x', 'y', 'z', 'yaw', 'pitch']) c.tracks[ch] = c.tracks[ch].filter(k => k.t < t0 || k.t > t1);
        if (c.parent) { c.parent = null; c.follow = false; c.look = false; } c.pov = false;
        let look = null; if (a.look && a.look !== 'devant') { look = typeof a.look === 'object' ? a.look : { entity: a.look }; if (!point(look, t0, G)) look = null; else if (look.entity != null) c.aim = ent(look.entity)?.key || null; } if (!look) c.aim = null;
        const ahead = d => { const s = Math.min(len, d + 2.8); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const u = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return { x: dense[i - 1].x + (dense[i].x - dense[i - 1].x) * u, z: dense[i - 1].z + (dense[i].z - dense[i - 1].z) * u }; };
        const pitch = clamp((num(a.pitch) ?? 0) * D2R, -1.2, 1.2); let n = 0, lastYaw = 0;
        dense.forEach((p, i) => {
          if (i % every && i !== dense.length - 1) return; const t = Math.round(t0 + (t1 - t0) * cum[i] / len), v = { x: p.x, y: p.y, z: p.z };
          if (look) { const tg = point(look, t, G); if (tg) { v.yaw = Math.atan2(tg.z - p.z, tg.x - p.x); v.pitch = clamp(Math.atan2(tg.y - p.y, Math.hypot(tg.x - p.x, tg.z - p.z)), -1.55, 1.55); } }
          else { const q = ahead(cum[i]); if (Math.hypot(q.x - p.x, q.z - p.z) > 0.3) lastYaw = Math.atan2(q.z - p.z, q.x - p.x); v.yaw = lastYaw; v.pitch = pitch; }
          writePose(c, t, v, false, ease); n++;
        });
        const fov = clamp(num(a.fov) ?? 65, 8, 120); for (const t of [t0, t1]) { C.setKey(c, 'fov', t, fov); if (!c.tracks.roll.length) C.setKey(c, 'roll', t, 0); }
        const speed = len / ((t1 - t0) / 1000);
        return ok(`${made ? `Caméra « ${c.name} » créée : ` : `${c.name} : `}travelling de ${r1(len)} m le long d’un chemin praticable (${names.join(' → ')}), de ${fmtT(t0)} à ${fmtT(t1)}, à ${r1(hgt)} m du sol, ${r1(speed)} m/s${speed > 3.2 ? ' — ⚠ rapide : allonge la durée ou raccourcis le trajet (1 à 2,5 m/s conseillés)' : ''} — ce plan occupe ${fmtT(t0)} → ${fmtT(t1)} : fais commencer le plan suivant à ${fmtT(t1)} (un plan posé sur le même intervalle le recouvrirait).`, { camera: c.name, creee: made, longueur_m: r1(len), vitesse_m_s: r1(speed), cles: n, etapes: names });
      },
      pov_shot(a) {
        if (!a.camera) return ko('pov_shot : il manque « camera » (le nom du plan).');
        const e = a.subject == null || a.subject === '' ? H.entities().find(x => x.me) : ent(a.subject); if (!e || (e.kind !== 'joueur' && e.kind !== 'pnj')) return ko(`pov_shot : « ${a.subject ?? 'joueur'} » n’est pas un personnage.`);
        const t0 = ms(a.from, Math.round(H.T)); let t1 = ms(a.to, Math.round(H.dur)); if (t1 - t0 < 500) t1 = Math.min(Math.round(H.dur), t0 + 3000); if (t1 - t0 < 300) return ko('pov_shot : « to » doit être après « from ».');
        let c = camOf(a.camera); const made = !c; if (!c) { c = C.newCam(H.cams); c.name = String(a.camera).slice(0, 40); H.cams.push(c); }
        for (const ch of C.CH) c.tracks[ch] = c.tracks[ch].filter(k => k.t < t0 || k.t > t1);
        c.parent = { kind: 'perso', id: e.id, name: e.name }; c.follow = true; c.look = false; c.pov = true; c.aim = null;
        const fov = clamp(num(a.fov) ?? 75, 20, 120);
        for (const t of [t0, t1]) { for (const ch of ['x', 'y', 'z', 'yaw', 'pitch', 'roll']) C.setKey(c, ch, t, 0); C.setKey(c, 'fov', t, fov); }
        return ok(`${made ? `Caméra « ${c.name} » créée : ` : `${c.name} : `}vue subjective de ${e.name} de ${fmtT(t0)} à ${fmtT(t1)} — la caméra est à ses yeux${e.me ? ' et regarde où il regardait dans le record' : ' et regarde devant lui'} (sa tête est masquée).`, { camera: c.name, creee: made, subjective: true, sujet: e.name });
      },
    };
    return {
      RUN,
      /** Après un outil qui a réussi : la caméra touchée est contrôlée et corrigée ; le compte mesuré rejoint le résultat */
      after(name, a, r) {
        if (!r?.ok || !H.geo) return r;
        if (name === 'pov_shot' || name === 'check_cameras' || !MOVERS.has(name)) return r;
        const c = camOf(r.data?.camera ?? a?.camera ?? a?.name); if (!c) return r;
        // (le sujet visé : gardé sur la caméra, pour contrôler qu'il reste en vue)
        const sub = name === 'frame_shot' || name === 'orbit_shot' ? a.subject ?? 'joueur' : name === 'create_camera' ? a.look_at?.entity : name === 'set_keys' ? [...(a.keys || [])].reverse().find(k => k?.look_at?.entity != null)?.look_at.entity : undefined;
        if (sub !== undefined && sub !== null) { const e = ent(sub); if (e) c.aim = e.key; } else if (name === 'create_camera' || (name === 'set_keys' && (a.keys || []).some(k => num(k?.yaw) !== null))) c.aim = name === 'create_camera' ? null : c.aim;
        if (name !== 'path_shot' && c.pov && (name === 'set_keys' || name === 'frame_shot' || name === 'orbit_shot' || name === 'set_parent')) c.pov = false;
        const R = control(c, true); if (!R) return r;
        return { ...r, text: `${r.text.replace(/ — ⚠ (elle semble dans un mur ou hors du lieu|à [\d.,]+ s la caméra semble dans un mur ou hors du lieu)/g, '').replace(/\.$/, '')}${controlText(R)}.`, data: { ...r.data, controle_moteur: R } };
      },
      /** Défauts de géométrie du montage à l'antenne (phrases pour l'assistant) */
      problems(old = null) {   // (old : les caméras d'avant ce tour — celles de l'utilisateur : on ne pousse pas l'assistant à les refaire)
        const M = montage(); if (!M || !M.bad) return [];
        return [...M.per.entries()].filter(([, o]) => !old?.has?.(o.id)).map(([cam, o]) => `caméra « ${cam} » : le moteur mesure ${o.n} échantillon${o.n > 1 ? 's' : ''} ${reasonsText(o.reasons)} (entre ${r1(o.from / 1000)} et ${r1(o.to / 1000)} s) qu’il n’a pas pu corriger : refais ce plan autrement (free_spots pour une position libre, path_shot pour un trajet praticable, ou raccourcis le mouvement) — ne décale pas des coordonnées au hasard`);
      },
      /** La ligne de vérité ajoutée à la réponse finale */
      recapText() {
        const M = montage(); if (!M) return '';
        const nv = M.n - M.checked;
        return M.bad ? `Contrôle moteur des caméras : ${M.bad} échantillon${M.bad > 1 ? 's' : ''} sur ${M.checked} encore en défaut (${reasonsText(M.reasons)}).` : `Contrôle moteur des caméras : ${M.checked} échantillons vérifiés (tous les ${M.n > 1 ? 'dixièmes de seconde' : 'instants'}), aucun dans un mur, un modèle, le vide ou hors carte${nv ? ` ; ${nv} hors de la zone chargée, non vérifiés` : ''}.`;
      },
      digest() { try { return H.geo?.brief?.() || null; } catch { return null; } },
      control, montage,
    };
  } };
}

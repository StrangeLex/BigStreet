// Big Street Studio — la connaissance des lieux, pour l'assistant (21/11). « Si j'ai un record dans Teddy Bear Tacos et que j'en parle
// à l'IA, elle est censée savoir ce que c'est » : ce module dit OÙ l'on est et CE QU'IL Y A.
//  - PLACES : ce qu'on sait d'avance de chaque lieu du jeu (ce que c'est, l'ambiance, ses pièces nommées, ce qu'il ne faut pas
//    confondre) — écrit d'après les cartes du jeu (maps.js) ; ROOM_NAMES : le nom de chaque salle (pour les portes).
//  - describePlace(…) : la description d'un record — tirée de SA salle (elle est dans le record : plan, objets, portes) : pièces,
//    couloirs, grandes salles, entrées, mobilier marquant, mascottes et statues (des objets), décor mural, PNJ et rôles.
// Aucune référence à une œuvre existante : les mascottes de Teddy Bear Tacos sont des personnages originaux du jeu.
// Ce module ne touche ni au DOM ni au moteur : il se teste seul (tools/selftest.mjs).
const nrm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const r1 = v => Math.round(v * 10) / 10;

export const ROOM_NAMES = {"casino":"Casino Fortuna","casino_2":"Casino Fortuna — Lounge VIP","hopital_5":"Hôpital Saint-Faubourg — 5e étage","hopital_6":"Hôpital Saint-Faubourg — 6e étage","hopital_7":"Hôpital Saint-Faubourg — 7e étage","hopital_8":"Hôpital Saint-Faubourg — 8e étage","hopital_9":"Hôpital Saint-Faubourg — 9e étage","hopital_10":"Hôpital Saint-Faubourg — 10e étage","hopital_m3":"Hôpital Saint-Faubourg — −3","hopital":"Hôpital Saint-Faubourg","emmaus":"Emmaüs","collection_babylone":"Collection Babylone","caravane_graines":"La caravane de Jah","police":"Hôtel de police","laverie":"Laverie","momop":"Momop'","labo_piscine":"Le labo sous la tente","mairie_lucioles":"Mairie des Lucioles","pharmacie_lucioles":"Pharmacie des Lucioles","coiffeur_lucioles":"Salon de coiffure des Lucioles","tabac_lucioles":"Tabac-presse des Lucioles","momop_lucioles":"Momop' — Les Lucioles","aeroport":"Aéroport — aérogare","flonch":"Flonch","snack_mehdi":"Chez Mehdi","pizzeria_coco":"Teddy Bear Tacos","kebab_epis":"Kebab du Rond-Point","restaurant_criee":"La Criée","cuisine_criee":"Cuisine de La Criée","hlm":"HLM — Hall","hlm_1":"HLM — 1er étage","hlm_2":"HLM — 2e étage","hlm_3":"HLM — 3e étage","hlm_4":"HLM — 4e étage","hlm_5":"HLM — 5e étage","hlm_6":"HLM — 6e étage","hlm_7":"HLM — 7e étage","studio_1":"Studio — HLM, porte 25","hlm_esc_0":"HLM — Escalier (rez-de-chaussée)","hlm_esc_1":"HLM — Escalier (1er étage)","hlm_esc_2":"HLM — Escalier (2e étage)","hlm_esc_3":"HLM — Escalier (3e étage)","hlm_esc_4":"HLM — Escalier (4e étage)","hlm_esc_5":"HLM — Escalier (5e étage)","hlm_esc_6":"HLM — Escalier (6e étage)","hlm_esc_7":"HLM — Escalier (7e étage)","parking_m3":"Parking — Sous-sol −3","parking_m2":"Parking — Sous-sol −2","parking_m1":"Parking — Sous-sol −1","parking":"Parking — Rez-de-chaussée","parking_1":"Parking — Niveau 1","parking_2":"Parking — Niveau 2","parking_3":"Parking — Niveau 3","pharmacie_epis":"Pharmacie des Épis","labo_oublie":"Laboratoire oublié","centre_epis":"Centre commercial Les Épis","ochan":"Ochan","hopital_epis":"Hôpital des Épis","hopital_epis_1":"Hôpital des Épis — 1er étage","hopital_epis_2":"Hôpital des Épis — 2e étage","hopital_epis_3":"Hôpital des Épis — 3e étage","hopital_epis_4":"Hôpital des Épis — 4e étage","hopital_epis_5":"Hôpital des Épis — 5e étage","hopital_epis_6":"Hôpital des Épis — 6e étage","pharmacie_tour":"Pharmacie de la Tour","pharmacie":"Pharmacie des Sentiers","agence_cityo":"CITYO — Agence immobilière","club":"Club Liberia","tour_escaliers":"Tour Eiffel — Escaliers","banque":"Banque Impériale","banque_ss":"Banque Impériale — Sous-sol","banque_1":"Banque Impériale — Étage","concession":"Concessionnaire","mairie":"Mairie","mairie_service":"Mairie — local du personnel","france_travail":"Fraude Travail","france_travail_1":"Fraude Travail — 1er étage","telephones":"Téléphones Chen","cuisine_nems":"Arrière-boutique","restaurant_chinois":"Le Dragon d’Or","bar_pmu":"Bar PMU « Le Galop »","salle_arcade":"Salle d’arcade","musee":"Musée","ville":"Big Street (la ville, dehors)","egouts":"Égouts","egouts_cite":"Égouts de la cité","egouts_epis":"Égouts des Épis","egout_ville":"Les Bas-Fonds (ville souterraine)","metro":"Métro"};

// zones : [nom, x0, z0, x1, z1, note] — les pièces nommées (cases de la salle : x vers l'est, z vers le sud)
export const PLACES = {
  pizzeria_coco: {
    genre: 'restaurant familial à mascottes (intérieur, grand : 88 × 54 m)',
    resume: 'Teddy Bear Tacos, le restaurant de tacos du quartier des Lucioles : anniversaires d’enfants, tables de fête, ballons, guirlandes, et sur la scène un spectacle de mascottes mécaniques en peluche — Teddy l’Ours (au centre : poncho, chapeau de paille, maracas), Coco le Crocodile et Lulu la Loutre ; Gédéon le Hibou est derrière le rideau du Coin du Magicien (fermé pour travaux), Barnabé le Blaireau dans la salle des fêtes. Ouvert de 14 h à 19 h ; la nuit, un gardien surveille les lieux depuis le bureau de sécurité. Murs en damier, sol un peu sale, néons au plafond.',
    ambiance: 'Joyeux et coloré le jour ; vide, sombre et inquiétant la nuit (couloirs étroits, mascottes immobiles, ateliers de maintenance). Pour une touche d’horreur : couloirs, plans lents, contre-plongée sur une mascotte, vignette et grain, peu de lumière.',
    zones: [['Grande salle de spectacle', 20, 7, 59, 26, 'la scène (mur nord, x 31–48, z 7–10) avec Coco, Teddy et Lulu ; quinze tables de fête ; piscine à balles à l’est'], ['Coin du Magicien', 15, 8, 18, 15, 'recoin fermé par un rideau, à l’ouest de la grande salle : Gédéon le Hibou sur son estrade, sol très sale'],
      ['Local électrique', 15, 1, 24, 5], ['Coulisses', 26, 1, 59, 5, 'derrière la scène : étagères de têtes, costume de rechange, pièces en réparation'], ['Cuisine', 61, 1, 70, 14, 'planchas, frigos, passe-plat vers la grande salle'], ['Loge des artistes', 61, 16, 70, 24],
      ['Entrepôt', 61, 26, 70, 45], ['Quai de livraison', 61, 47, 70, 52], ['Vestibule', 20, 28, 23, 38, 'passage entre le hall d’entrée et la grande salle'], ['Hall d’entrée', 15, 39, 31, 52, 'la porte du restaurant est au sud (x 22–23, z 53) ; guichet d’accueil de la gérante'],
      ['Bureau du gérant', 25, 28, 31, 37], ['Couloir ouest', 33, 28, 34, 52, 'couloir étroit (2 m) qui mène au bureau de sécurité'], ['Couloir est', 49, 28, 50, 52, 'couloir étroit (2 m) qui mène au bureau de sécurité'], ['Placard à fournitures', 36, 28, 47, 32],
      ['Salle des fêtes', 36, 34, 47, 41, 'Barnabé le Blaireau, deux tables de fête'], ['Bureau de sécurité', 36, 43, 47, 52, 'le poste du gardien de nuit : six écrans de surveillance au mur nord, bureau et ordinateur, deux portes (ouest et est)'],
      ['Salle de jeux', 52, 28, 59, 37, 'bornes d’arcade'], ['Toilettes', 52, 39, 59, 46], ['Vestiaire du personnel', 52, 48, 59, 52], ['Couloir de service ouest', 12, 1, 13, 52, 'long couloir étroit (2 m × 52 m)'], ['Couloir de service est', 72, 1, 73, 52, 'long couloir étroit (2 m × 52 m)'],
      ...[[1, 9], [11, 19], [21, 29], [31, 39], [41, 52]].flatMap(([a, b], i) => [[`Atelier de maintenance ouest ${i + 1}`, 1, a, 10, b, 'établi, mascotte démontée, pièces de rechange'], [`Atelier de maintenance est ${i + 1}`, 75, a, 86, b, 'établi, mascotte démontée, pièces de rechange']])],
    notes: ['Les SEULES mascottes sont les objets « Teddy l’Ours », « Coco le Crocodile », « Lulu la Loutre », « Gédéon le Hibou » et « Barnabé le Blaireau » (rubrique « mascottes ») : des statues mécaniques, pas des personnages du record — on les cadre par leur id d’objet ou leurs coordonnées.',
      '« Affiche », « Dessins d’enfants », « Caisses », « Sortie », « Ballons », « Guirlande » sont du décor : ne jamais les présenter comme des mascottes ou des personnages.',
      'Les personnes présentes sont des PNJ : Sandrine (gérante, au guichet du hall), Nico et Paolo (cuisiniers), des familles clientes attablées dans la grande salle.',
      'Plafond bas (≈ 3 m) partout : caméras entre 0,4 et 2,6 m du sol ; les couloirs font 2 m de large : y rester dans l’axe.'],
  },
  france_travail: { genre: 'administration (intérieur)', resume: 'Fraude Travail, l’agence pour l’emploi de Big Street (satire) : accueil, borne à tickets, écran d’appel, salle d’attente pleine, quatre guichets de conseillers ; un escalier mène à l’open space du 1er étage.', notes: ['Les conseillers sont assis derrière leurs bureaux (PNJ avec un titre) ; les autres PNJ attendent sur les chaises.'] },
  france_travail_1: { genre: 'administration (intérieur)', resume: 'Fraude Travail, 1er étage : l’open space des conseillers.' },
  tabac_lucioles: { genre: 'petit commerce (intérieur, 8 × 8 m)', resume: 'Le tabac-presse des Lucioles : un guichet (cigarettes, roulage, jeux à gratter), des présentoirs de journaux. Une seule pièce, très petite : focales larges, caméra près des murs.' },
  tabac: { genre: 'petit commerce (intérieur)', resume: 'Tabac-presse : guichet, présentoirs, une seule petite pièce.' },
  momop: { genre: 'supérette (intérieur)', resume: 'Momop’, la petite supérette ouverte jour et nuit : rayons, frigos, une caisse.' },
  momop_lucioles: { genre: 'supérette (intérieur)', resume: 'Momop’ des Lucioles, la supérette au pied de Teddy Bear Tacos : rayons, frigos, le caissier Yanis.' },
  pharmacie: { genre: 'pharmacie (intérieur)', resume: 'Pharmacie : comptoir, rayons bien rangés, croix verte ; la pharmacienne et son aide derrière le comptoir.' },
  coiffeur_lucioles: { genre: 'salon de coiffure (intérieur)', resume: 'Salon de coiffure des Lucioles : fauteuils, miroirs, bacs ; le coiffeur et son aide.' },
  laverie: { genre: 'laverie (intérieur)', resume: 'Laverie automatique : rangées de machines à tambour, bancs d’attente, une seule pièce étroite.' },
  emmaus: { genre: 'boutique solidaire (intérieur, minuscule)', resume: 'Emmaüs : portants de vêtements d’occasion, cabines d’essayage, bac à dons, une bénévole à la caisse.' },
  snack_mehdi: { genre: 'snack (intérieur, minuscule)', resume: 'Chez Mehdi : kebabs, tacos, frites ; un comptoir, la broche, deux ou trois tables.' },
  kebab_epis: { genre: 'snack (intérieur, minuscule)', resume: 'Kebab du Rond-Point, aux Épis : comptoir, broche, quelques tables.' },
  flonch: { genre: 'cafétéria (intérieur)', resume: 'Flonch, la cafétéria des familles : parcours self avec plateaux, grande salle de tables.' },
  police: { genre: 'commissariat (intérieur)', resume: 'Hôtel de police : hall du public, guichet derrière une vitre blindée, chaises d’attente, cellules et bureaux.' },
  aeroport: { genre: 'aérogare (intérieur, immense : 276 × 130 m)', resume: 'L’aérogare de Big Street : hall immense sous une haute verrière, comptoirs d’enregistrement, files d’attente, contrôles, portes d’embarquement, écrans des vols.', notes: ['Très haut de plafond : plans larges et travellings longs possibles ; les foules sont des PNJ.'] },
  casino: { genre: 'casino (intérieur, immense)', resume: 'Casino Fortuna : moquette rouge, lustres, dorures ; machines à sous, tables de jeu, bar, scène de concert.' },
  casino_2: { genre: 'casino (intérieur)', resume: 'Lounge VIP du Casino Fortuna : velours, champagne, piscine sur le toit.' },
  hopital: { genre: 'hôpital (intérieur, immense)', resume: 'Hôpital Saint-Faubourg : hall, salles d’attente bondées, longs couloirs, services ; hôpital public débordé.' },
  hlm: { genre: 'immeuble (intérieur)', resume: 'Hall d’un HLM de la cité des Sentiers : boîtes aux lettres, murs tagués, couloir étroit ; pauvreté, minuterie en panne.' },
  studio_1: { genre: 'logement (intérieur, minuscule : 5 × 7 m)', resume: 'Le studio du joueur dans le HLM : une pièce, un lit, un coin cuisine. Très exigu : caméra dans un angle, focale large.' },
  banque: { genre: 'banque (intérieur)', resume: 'Banque Impériale : marbre, dorures, guichets, gardes ; salle des coffres au sous-sol.' },
  club: { genre: 'boîte de nuit (intérieur)', resume: 'Club Liberia : piste de danse, basses, lumière rouge, bar.' },
  mairie: { genre: 'mairie (intérieur)', resume: 'Mairie : salle d’honneur, accueil, service des cartes d’identité.' },
  egouts: { genre: 'souterrain (tunnels)', resume: 'Les égouts sous toute la ville : tunnels étroits et voûtés, eaux usées, rats, obscurité. Plafond bas, couloirs : caméra dans l’axe du tunnel.' },
  egout_ville: { genre: 'souterrain', resume: 'Les Bas-Fonds : une ville souterraine sous les égouts, sombre, baraques et braseros, où le Baron fait la loi.' },
  catacombes: { genre: 'souterrain (galeries)', resume: 'Les catacombes : galeries étroites tapissées d’os, piliers, obscurité presque totale.' },
  metro: { genre: 'souterrain (stations et tunnel)', resume: 'Le métro de Big Street : quais, voies en contrebas, tunnel.' },
  parking: { genre: 'parking à étages', resume: 'Parking à étages au bord du canal : béton, poteaux, voitures en rang, néons.' },
  ville: { genre: 'extérieur (la ville entière)', resume: 'Big Street, ville française satirique en blocs : boulevards, gratte-ciel, cité des Sentiers (HLM), quartier chinois, beaux quartiers, parc Eiffel et sa tour, canal, port, campagne, quartiers des Lucioles et des Épis.' },
};
// Quartiers de la ville (cases x, z) : [nom, x0, z0, x1, z1, ce qu'on y trouve]
export const DISTRICTS = [
  ['Les Lucioles', -664, 596, -338, 944, 'petite ville tranquille : avenue des Lucioles, rue Coco (Teddy Bear Tacos, Momop’, tabac-presse, pharmacie, coiffeur, arcade), rue des Écoles (école, mairie annexe, église), rue des Tilleuls (maisons), square, city-stade'],
  ['Les Épis', -1319, 772, -709, 1332, 'grand ensemble : barres courbes autour du rond-point, résidences, centre commercial et hypermarché Ochan, hôpital des Épis'],
  ['La Grande Prairie', -1060, 480, -462, 660, 'champs, hippies, crop circle'], ['La Riviera', -100, 617, 310, 787, 'corniche, plages, port de yachts au pied de la falaise'],
  ['Le Petit Port', 386, -96, 529, -2, 'pêcheurs, marché du matin, restaurant La Criée'], ['Cité des Sentiers', 0, -96, 459, 95, 'HLM, snack de Mehdi, pharmacie, laverie : quartier pauvre'],
  ['Quartier chinois', 0, 96, 205, 151, 'restaurant Le Dragon d’Or, boutiques de téléphones'], ['Centre-ville', -100, 152, 205, 299, 'mairie, commerces, Fraude Travail, boulevards'], ['Quartier d’affaires', 206, 96, 299, 299, 'gratte-ciel, Banque Impériale'],
  ['Beaux Quartiers', 300, 96, 351, 299, 'immeubles bourgeois'], ['Domaine des Cèdres', 352, 96, 459, 299, 'quartier ultra-riche fermé par une barrière gardée'], ['Square', 100, 300, 170, 440, 'parc, bancs, jeux'],
  ['Parc Eiffel', 252, 300, 459, 531, 'la tour Eiffel de Big Street et ses touristes'], ['Zone industrielle', 171, 488, 251, 531, 'usine Totol qui pollue'], ['Les Quais', 171, 300, 251, 487, 'le canal, le parking à étages'], ['Faubourg Liberia', 0, 300, 170, 531, 'quartier populaire, l’hôpital, le Club Liberia'],
];
/** Ce qu'on sait d'avance d'un lieu : sa fiche, ou celle de sa famille (« hopital_5 » → hopital, « pharmacie_tour » → pharmacie) */
export function placeInfo(id) {
  const k = String(id || ''); if (PLACES[k]) return PLACES[k];
  const fam = Object.keys(PLACES).filter(p => k.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  return fam ? PLACES[fam] : /^egout|sewer/.test(k) ? PLACES.egouts : /^catacomb/.test(k) ? PLACES.catacombes : null;
}
export const roomName = id => ROOM_NAMES[id] || placeInfo(id)?.resume?.split(/[,:.]/)[0] || String(id || '').replace(/_/g, ' ');
export const districtAt = (x, z) => DISTRICTS.find(d => x >= d[1] && x <= d[3] && z >= d[2] && z <= d[4]) || null;

// ---------------------------------------------------------------- Découpage d'un plan en pièces
const WALK = c => c !== undefined && c !== 'x' && c !== ' ';
/**
 * Les pièces d'un plan (rows : lignes de caractères, 'x' ou ' ' = pas de sol) : on retire le plus grand rectangle de sol, puis le
 * suivant… (les cartes du jeu sont faites de salles rectangulaires reliées par des ouvertures d'une case). Rend [{ x0, z0, x1, z1,
 * w, d, area }] — les plus grandes d'abord ; ce qui reste (ouvertures, recoins de moins de minArea cases) n'est pas listé.
 */
export function splitRooms(rows, { minArea = 6, max = 60 } = {}) {
  const H = rows.length, W = Math.max(0, ...rows.map(r => r.length)), free = rows.map(r => Array.from({ length: W }, (_, x) => WALK(r[x]))), out = [];
  const h = new Int32Array(W);
  for (let n = 0; n < max; n++) {
    let best = null; h.fill(0);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) h[x] = free[z][x] ? h[x] + 1 : 0;
      const st = [];   // (plus grand rectangle sous l'histogramme)
      for (let x = 0; x <= W; x++) { const cur = x < W ? h[x] : 0; let s = x; while (st.length && st[st.length - 1][1] > cur) { const [sx, sh] = st.pop(), a = sh * (x - sx); if (!best || a > best.area) best = { x0: sx, x1: x - 1, z0: z - sh + 1, z1: z, area: a }; s = sx; } if (cur && (!st.length || st[st.length - 1][1] < cur)) st.push([s, cur]); }
    }
    if (!best || best.area < minArea) break;
    for (let z = best.z0; z <= best.z1; z++) for (let x = best.x0; x <= best.x1; x++) free[z][x] = false;
    out.push({ ...best, w: best.x1 - best.x0 + 1, d: best.z1 - best.z0 + 1 });
  }
  return out;
}
const kindOf = r => { const a = Math.min(r.w, r.d), b = Math.max(r.w, r.d); return a <= 3 && b >= a * 3 ? 'couloir' : r.area >= 300 ? 'grande salle' : r.area >= 60 ? 'salle' : r.area >= 12 ? 'petite pièce' : 'recoin'; };
const DECOR = /^(affiche|dessins|tableau|poster|cadre|pancarte|panneau|guirlande|ballons|griffures|sortie|neon|horloge|miroir|rideau|tapis|detritus|cartes_au_sol|plante|lampe|extincteur|regles|prise|cable|bouche|conduit|fiche_|camera_|tete_|marque|paillasson|drapeau|graff|tag_)/;
/** Ce qu'est un objet du décor : 'mascotte' (statue de personnage : Teddy, Coco…), 'decor' (au mur, au sol, au plafond : on ne le cadre pas comme un sujet) ou 'mobilier' */
export function itemKind(type, def = null) {
  if (/^anim_/.test(type)) return 'mascotte';
  if (DECOR.test(type) || def?.wall || def?.rug || def?.flat || def?.ceil || def?.edge) return 'decor';
  return 'mobilier';
}

/**
 * La description d'un lieu pour l'assistant. room : la salle du record ({ id, name, desc, rows, items, portals, outdoor }) ; opts :
 * { furni (fiches des objets : nom, w, d…), npcs: [{ id, name, title, x, z }], at: { x, z } (où est le joueur), ceil(x, z) (hauteur
 * sous plafond mesurée, ou null), radius (dehors : rayon décrit autour de « at ») }. Rend un objet prêt à donner à l'assistant.
 */
export function describePlace(room, { furni = {}, npcs = [], at = null, ceil = null, radius = 45, zone = null } = {}) {
  const K = placeInfo(room.id), name = room.name || roomName(room.id), rows = room.rows || [], ox = room.ox || 0, oz = room.oy || 0;
  const def = t => furni[t] || null, label = t => def(t)?.name || String(t).replace(/_/g, ' ');
  const size = (t, rot) => { const d = def(t), w = d?.w || 1, dd = d?.d || 1; return Math.round(rot || 0) % 2 ? [dd, w] : [w, dd]; };
  const out = { lieu: name, id: room.id, type: room.outdoor ? 'extérieur' : 'intérieur', ...(K?.genre ? { genre: K.genre } : {}), description: K?.resume || room.desc || '', ...(K?.ambiance ? { ambiance: K.ambiance } : {}),
    reperes: 'coordonnées en mètres : x vers l’est, z vers le sud, y vers le haut ; le sol est à y ≈ 0' };
  const portals = (room.portals || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (room.outdoor) {
    // Dehors : le quartier, et ce qu'il y a autour du joueur (bâtiments et objets marquants, entrées des lieux)
    const c = at || { x: ox + (rows[0]?.length || 0) / 2, z: oz + rows.length / 2 }, D = districtAt(c.x, c.z);
    out.quartier = D ? { nom: D[0], on_y_trouve: D[5] } : null; out.autour_de = { x: r1(c.x), z: r1(c.z), rayon_m: radius };
    const near = [];
    for (const it of room.items || []) { const [w, d] = size(it.type, it.rot), cx = it.x + (w - 1) / 2, cz = it.y + (d - 1) / 2, dist = Math.hypot(cx - c.x, cz - c.z); if (dist > radius) continue; const k = itemKind(it.type, def(it.type)); if (k === 'decor' && w * d < 9) continue; near.push({ id: it.id, nom: label(it.type), x: r1(cx), z: r1(cz), taille: `${w} × ${d} m`, distance: Math.round(dist), big: w * d }); }
    near.sort((a, b) => b.big - a.big || a.distance - b.distance);
    const groups = new Map(); for (const n of near) { const g = groups.get(n.nom); if (g) { g.nombre++; if (n.distance < g.distance) Object.assign(g, { id: n.id, x: n.x, z: n.z, distance: n.distance }); } else groups.set(n.nom, { ...n, nombre: 1 }); }
    out.batiments_et_objets_marquants = [...groups.values()].slice(0, 28).map(({ big, ...g }) => (g.nombre > 1 ? { ...g, note: 'le plus proche' } : (delete g.nombre, g)));
    const seen = new Map(); for (const p of portals) { const d = Math.hypot(p.x - c.x, p.y - c.z); if (d > radius * 1.5) continue; const k = p.to; if (!seen.has(k) || d < seen.get(k).distance) seen.set(k, { vers: roomName(p.to), x: p.x, z: p.y, distance: Math.round(d) }); }
    out.entrees_de_lieux = [...seen.values()].sort((a, b) => a.distance - b.distance).slice(0, 14);
    out.plafond = 'aucun (ciel) : la caméra peut monter ; attention aux bâtiments, arbres et véhicules';
    out.pnj = npcs.map(n => ({ ...n, d: Math.hypot(n.x - c.x, n.z - c.z) })).filter(n => n.d <= radius).sort((a, b) => a.d - b.d).slice(0, 20).map(n => ({ id: n.id, nom: n.name, ...(n.title ? { role: n.title } : {}), x: r1(n.x), z: r1(n.z), distance: Math.round(n.d) }));
    if (K?.notes) out.a_savoir = K.notes;
    return out;
  }
  // Dedans : les pièces (rectangles de sol), nommées d'après la fiche du lieu quand elles y sont
  const W = Math.max(0, ...rows.map(r => r.length)), H = rows.length;
  out.dimensions = { largeur_x: W, profondeur_z: H, x: [ox, ox + W - 1], z: [oz, oz + H - 1] };
  const R = splitRooms(rows).map(r => ({ ...r, x0: r.x0 + ox, x1: r.x1 + ox, z0: r.z0 + oz, z1: r.z1 + oz }));
  const named = (K?.zones || []).map(([nom, x0, z0, x1, z1, note]) => ({ nom, x0, z0, x1, z1, note }));
  const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) + 1);
  let anon = 0;
  const pieces = R.map(r => {
    const z = named.map(q => ({ q, k: inter(r, q) / Math.max(r.area, (q.x1 - q.x0 + 1) * (q.z1 - q.z0 + 1)) })).sort((a, b) => b.k - a.k)[0], hit = z && z.k > 0.45 ? z.q : null, kind = kindOf(r);
    return { nom: hit?.nom || `${kind[0].toUpperCase()}${kind.slice(1)} ${String.fromCharCode(65 + (anon++ % 26))}${anon > 26 ? Math.floor(anon / 26) : ''}`, genre: kind, x: [r.x0, r.x1], z: [r.z0, r.z1], taille: `${r.w} × ${r.d} m`, centre: { x: r1((r.x0 + r.x1) / 2), z: r1((r.z0 + r.z1) / 2) }, ...(hit?.note ? { note: hit.note } : {}), _r: r, _items: new Map(), _npcs: [], _w: (hit?.note ? 150 : 0) + r.area };
  });
  const pieceAt = (x, z) => pieces.find(p => x >= p._r.x0 - 0.5 && x <= p._r.x1 + 0.5 && z >= p._r.z0 - 0.5 && z <= p._r.z1 + 0.5) || null;
  // (qui communique avec qui : deux pièces qui se touchent, ou qu'une ouverture d'une ou deux cases relie)
  const cell = (x, z) => WALK(rows[z - oz]?.[x - ox]);
  const links = new Map(pieces.map(p => [p, new Set()]));
  for (let z = oz; z < oz + H; z++) for (let x = ox; x < ox + W; x++) {
    if (!cell(x, z)) continue; const a = pieceAt(x, z);
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      let nx = x + dx, nz = z + dz, hops = 0; while (cell(nx, nz) && !pieceAt(nx, nz) && hops < 3) { nx += dx; nz += dz; hops++; }
      if (!cell(nx, nz)) continue; const b = pieceAt(nx, nz); if (a && b && a !== b) { links.get(a).add(b.nom); links.get(b).add(a.nom); }
    }
  }
  // Les objets : mascottes (à part), décor (compté), mobilier (par pièce)
  const masc = [], decor = new Map(), big = [];
  for (const it of room.items || []) {
    const d = def(it.type), k = itemKind(it.type, d), [w, dd] = size(it.type, it.rot), cx = it.x + (w - 1) / 2, cz = it.y + (dd - 1) / 2, p = pieceAt(cx, cz), nom = label(it.type);
    if (k === 'mascotte') { masc.push({ id: it.id, nom, x: r1(cx), z: r1(cz), piece: p?.nom || '?' }); if (p) p._w += 500; continue; }
    if (k === 'decor') { if (!/^detritus|^cable|^conduit/.test(it.type)) decor.set(nom, (decor.get(nom) || 0) + 1); continue; }
    if (p) { const g = p._items.get(nom) || { n: 0, id: it.id, x: r1(cx), z: r1(cz), a: w * dd }; g.n++; p._items.set(nom, g); }
    if (w * dd >= 12) big.push({ id: it.id, nom, x: r1(cx), z: r1(cz), taille: `${w} × ${dd} m`, piece: p?.nom || '?' });
  }
  for (const n of npcs) { const p = pieceAt(n.x, n.z); if (p) { p._npcs.push(n.name); p._w += 120; } }
  const here = at ? pieceAt(at.x, at.z) : null, focus = zone ? pieces.filter(p => nrm(p.nom).includes(nrm(zone))) : null;
  if (zone && !focus.length) out.remarque = `aucune pièce ne s’appelle « ${zone} » : voici tout le lieu`;
  // (d'abord la pièce du joueur, puis celles où il y a quelque chose à filmer — mascottes, gens, pièces décrites —, puis les plus grandes)
  const show = (focus?.length ? focus : pieces).sort((a, b) => (b === here) - (a === here) || b._w - a._w).slice(0, focus?.length ? 8 : 12);
  out.pieces = show.map(p => {
    const c = ceil ? ceil(p.centre.x, p.centre.z) : null, mob = [...p._items.entries()].sort((a, b) => b[1].a * b[1].n - a[1].a * a[1].n).slice(0, focus?.length ? 14 : 4).map(([nom, g]) => (g.n > 1 ? `${g.n} × ${nom}` : `${nom} (id ${g.id}, x ${g.x}, z ${g.z})`));
    const o = { nom: p.nom, genre: p.genre, x: p.x, z: p.z, taille: p.taille, centre: p.centre, ...(Number.isFinite(c) ? { hauteur_sous_plafond: r1(c) } : {}), ...(p.note ? { note: p.note } : {}) };
    if (mob.length) o.mobilier = mob; if (p._npcs.length) o.personnes = [...new Set(p._npcs)].slice(0, 5).concat(p._npcs.length > 5 ? [`… ${p._npcs.length} en tout`] : []); const L = [...links.get(p)]; if (L.length) o.communique_avec = L.slice(0, 6);
    if (p === here) o.le_joueur_est_ici = true;
    return o;
  });
  if (pieces.length > show.length) { out.autres_pieces = pieces.filter(p => !show.includes(p)).slice(0, 40).map(p => `${p.nom} (${p.genre}, x ${p.x[0]}–${p.x[1]}, z ${p.z[0]}–${p.z[1]})`); out.pour_le_detail = 'describe_place avec zone = le nom d’une pièce'; }
  if (here) out.le_joueur_est_dans = here.nom;
  const cs = ceil ? show.slice(0, 6).map(p => ceil(p.centre.x, p.centre.z)).filter(Number.isFinite) : [];
  out.plafond = cs.length ? `oui : ${r1(Math.min(...cs))}${Math.max(...cs) - Math.min(...cs) > 0.3 ? ` à ${r1(Math.max(...cs))}` : ''} m au-dessus du sol — une caméra doit rester en dessous (0,3 m de marge)` : 'oui (intérieur) : garder la caméra sous 2,6 m du sol sauf mesure contraire (room_bounds)';
  out.entrees = portals.slice(0, 12).map(p => ({ x: p.x, z: p.y, vers: roomName(p.to), ...(pieceAt(p.x, p.y) ? { dans: pieceAt(p.x, p.y).nom } : {}) }));
  out.mascottes = masc.length ? { ce_que_c_est: 'statues mécaniques de personnages, immobiles ou animées sur place : des OBJETS du décor (pas des entités du record). Pour les filmer : frame_shot avec subject = leur id.', liste: masc } : [];
  out.mobilier_marquant = big.slice(0, 10);
  out.decor = { ce_que_c_est: 'décor mural, au sol ou au plafond : ni personnages ni mascottes', compte: Object.fromEntries([...decor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) };
  out.pnj = npcs.slice(0, 24).map(n => ({ id: n.id, nom: n.name, ...(n.title ? { role: n.title } : {}), x: r1(n.x), z: r1(n.z), ...(pieceAt(n.x, n.z) ? { piece: pieceAt(n.x, n.z).nom } : {}) }));
  if (K?.notes) out.a_savoir = K.notes;
  return out;
}
/** La fiche courte d'un lieu, jointe à chaque message (quelques lignes) */
export function placeBrief(room, at = null) {
  const K = placeInfo(room.id), D = room.outdoor && at ? districtAt(at.x, at.z) : null;
  return { ...(K?.genre ? { genre: K.genre } : {}), ...(K?.resume || room.desc ? { description: (K?.resume || room.desc).slice(0, 420) } : {}), ...(D ? { quartier: D[0] } : {}), detail: 'describe_place' };
}

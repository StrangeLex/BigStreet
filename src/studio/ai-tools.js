// Big Street Studio — le moteur d'actions de l'assistant IA (Studio VIP). L'assistant ne touche à rien directement : il appelle les
// outils décrits ici (« function calling », schémas au format OpenAI), le Studio les exécute et lui rend le résultat. Tout y est :
// décrire la scène (entités, positions, rotations, trajectoires, tenues, événements), créer et animer des caméras (clés par
// paramètre, interpolations, parent, filtres, raytracing, ombre), cadrer un sujet selon la grammaire du cinéma, changer l'apparence
// d'un personnage (dans la limite des skins du compte), masquer une entité, piloter la lecture, prévisualiser, exporter.
// Unités de l'assistant : secondes, mètres (1 case = 1 m), degrés, pourcentages. Ce module ne touche ni au DOM ni au moteur : il
// parle à un « hôte » (H, fourni par studio.js — ou par tools/selftest.mjs, qui le teste avec un faux modèle).
// EXTENSIONS (21/11) : ce fichier n'importe rien (le selftest le charge seul). Un module qui ajoute des outils les donne à l'hôte :
// H.ext = [{ tools: [T(…)], prompt: 'texte ajouté au prompt système', create(H, kit) → { RUN: { outil(a) → ok(…) | ko(…) },
//   after(name, args, result) → result (après un outil réussi), problems() → [phrases], recapText() → phrase, digest() → objet } }]
// (tout est facultatif ; kit : { ok, ko, ms, ent, camOf, noCam, writePose, fmtT, headY, sideAngle }). Exemple : ai-tools-geo.js.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = ms => `${r2(ms / 1000)} s`;
// (noms comparés sans casse, accents, espaces ni tirets : « Orbit_Mehdi chute » = « orbit mehdi-chute »)
const nrm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pickKey = (table, v, syn = {}) => { const n = nrm(v).replace(/ /g, '_'); if (!n) return null; if (n in table) return n; if (syn[n]) return syn[n]; return Object.keys(table).find(k => k.replace(/_/g, '') === n.replace(/_/g, '')) || Object.keys(syn).find(k => n.includes(k)) && syn[Object.keys(syn).find(k => n.includes(k))] || null; };
const SHOT_SYN = { plan_large: 'ensemble', large: 'ensemble', plan_d_ensemble: 'ensemble', wide: 'ensemble', tres_large: 'tres_large', aerien: 'tres_large', close_up: 'gros_plan', closeup: 'gros_plan', visage: 'gros_plan', gros: 'gros_plan', plan_moyen: 'moyen', medium: 'moyen', pied: 'moyen', rapproche: 'rapproche_poitrine', poitrine: 'rapproche_poitrine', taille: 'rapproche_taille', plan_americain: 'americain', demi: 'demi_ensemble', insert: 'tres_gros_plan', detail: 'tres_gros_plan' };
const SIDE_SYN = { devant: 'face', avant: 'face', derriere: 'dos', arriere: 'dos', droite: 'profil_droit', gauche: 'profil_gauche', profil: 'profil_droit', trois_quarts: 'trois_quarts_droit', '3_4': 'trois_quarts_droit' };
const HEIGHT_SYN = { oeil: 'yeux', normal: 'yeux', haut: 'plongee', dessus: 'plongee', bas: 'contre_plongee', dessous: 'contre_plongee', ras_du_sol: 'sol', drone: 'aerien', top: 'aerien' };
const TYPE_SYN = { joueur: 'joueur', joueurs: 'joueur', player: 'joueur', players: 'joueur', pnj: 'pnj', npc: 'pnj', npcs: 'pnj', vehicule: 'vehicule', vehicules: 'vehicule', voiture: 'vehicule', voitures: 'vehicule', vehicle: 'vehicule', objet: 'objet', objets: 'objet', decor: 'objet', object: 'objet', personnage: 'personnages', personnages: 'personnages', perso: 'personnages', persos: 'personnages', character: 'personnages', characters: 'personnages', humain: 'personnages', humains: 'personnages' };
export const MIN_SHOT = 1.5;   // (secondes : en dessous, un plan n'est pas lisible)

export const SHOTS = {   // (hauteur d'image visible en mètres, hauteur visée sur le sujet, focale conseillée)
  tres_gros_plan: [0.5, 1.52, 30, 'très gros plan (les yeux, un détail)'], gros_plan: [0.9, 1.48, 35, 'gros plan (le visage)'], rapproche_poitrine: [1.25, 1.34, 40, 'plan rapproché poitrine'],
  rapproche_taille: [1.6, 1.2, 42, 'plan rapproché taille'], americain: [2.0, 1.05, 45, 'plan américain (mi-cuisses)'], moyen: [2.7, 0.95, 50, 'plan moyen (en pied)'],
  demi_ensemble: [4.8, 1.0, 55, 'plan de demi-ensemble (le sujet dans son décor proche)'], ensemble: [9, 1.0, 60, 'plan d’ensemble (le lieu)'], tres_large: [18, 1.2, 65, 'plan très large (le paysage)'] };   // (les personnages sont en blocs : tête large — cadres un peu plus amples qu'au cinéma)
export const SIDES = { face: 0, trois_quarts_droit: 40, profil_droit: 90, trois_quarts_dos_droit: 140, dos: 180, trois_quarts_dos_gauche: -140, profil_gauche: -90, trois_quarts_gauche: -40 };
export const HEIGHTS = { yeux: 0, plongee: 30, forte_plongee: 55, aerien: 72, contre_plongee: -22, sol: null };
const FX = { vignette: 'vignette', grain: 'grain', dof: 'dof', raytracing: 'rt' };
const POSE = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov'];

// ---------------------------------------------------------------- Le prompt système
export const SYSTEM_PROMPT = `Tu es l'assistant réalisateur de « Big Street Studio », le logiciel de cinématiques du jeu Big Street (ville française satirique, en blocs 3D). L'utilisateur a enregistré une scène de jeu (un « record ») et veut en tirer une cinématique de haute qualité. Tu agis sur le logiciel UNIQUEMENT par les outils fournis : tu as toutes les permissions, sers-t'en. Tu parles français, tu tutoies, tu es bref et concret.

# Méthode
1. Regarde avant d'agir : l'état du Studio est joint à chaque message (lieu, durée, joueur, entités proches, caméras). Pour le détail, appelle scene_info, list_entities, get_entity, entity_path (trajectoire dans le temps), list_events (paroles, gestes, émotes), list_cameras, get_camera.
2. Agis : enchaîne tous les appels d'outils nécessaires sans demander la permission. Préfère frame_shot et orbit_shot (ils calculent seuls la position et l'orientation d'après le sujet) aux coordonnées tapées à la main ; set_keys sert aux mouvements sur mesure.
3. Vérifie : get_camera ou cinematic_summary pour contrôler ce que tu as fait ; corrige si un résultat dit ✗ ou signale un mur.
4. Conclus en deux ou trois phrases : ce que tu as créé (plans, durées), et propose de prévisualiser (preview_cinematic) ou d'ajuster. N'exporte (export_video) que si on te le demande.
Si la demande est vague (« fais-moi une belle cinématique »), décide toi-même d'un découpage complet et réalise-le. Chaque message où tu modifies le projet crée un point de restauration : l'utilisateur peut revenir en arrière, n'hésite donc pas à proposer une version.

# Repères du monde
- Unités : 1 case = 1 mètre. Axes : X et Z à plat (X vers l'est de la carte, Z vers le sud), Y vers le haut. Le sol d'un lieu est en général à y ≈ 0 (les positions rendues par les outils donnent le vrai sol sous chaque entité).
- Un personnage mesure environ 1,8 m : yeux à 1,55 m du sol (assis : 1,15 m), poitrine 1,3 m, taille 1,0 m. Une voiture : 4,5 m de long, 1,5 m de haut.
- Temps : en secondes depuis le début du record (0 → durée). Angles en degrés.
- Lacet (yaw) : direction du regard à plat. 0° = vers +X, 90° = vers +Z, 180° = vers −X, −90° = vers −Z. Le « cap » d'une entité suit la même convention : une caméra placée derrière un personnage avec yaw = son cap regarde dans la même direction que lui.
- Tangage (pitch) : 0° = horizontal, négatif = vers le bas (plongée), positif = vers le haut (contre-plongée). Roulis (roll) : inclinaison de l'horizon (plan « débullé »), 0° sauf effet voulu (5 à 15°).
- FOV (focale) en degrés : 20–35° téléobjectif (portraits, arrière-plan écrasé), 40–55° normal, 60–80° grand-angle (lieux, action proche, sensation de vitesse). Au-delà de 90° : déformation, à réserver à un effet.
- « Le joueur » : celui qui a enregistré la scène (marqué joueur:true, donné dans l'état). C'est presque toujours le sujet principal. Les autres « joueur » sont d'autres vrais joueurs ; les « pnj » sont les habitants ; « vehicule » et « objet » complètent la scène. Désigne une entité par son id, son nom, ou "joueur".

# Caméras et images-clés
- Une caméra a UNE PISTE PAR PARAMÈTRE : x, y, z, yaw, pitch, roll, fov, vignette, grain, dof (flou de profondeur), raytracing. Chaque piste a ses propres clés (instant, valeur, interpolation vers la suivante). Un paramètre sans clé garde une valeur fixe ; une seule clé = valeur fixe ; deux clés ou plus = animation. Les courbes sont lissées (passage fluide par les clés).
- Interpolations (ease) : "fluide" (vitesse constante, par défaut), "doux" (départ et arrivée en douceur — le plus cinématographique pour un travelling isolé), "accel", "frein", "fixe" (aucun mouvement jusqu'à la clé suivante : plan fixe ou coupe).
- Cinématique : les caméras ACTIVES s'enchaînent toutes seules. À chaque instant, la caméra à l'antenne est celle dont les clés encadrent cet instant (la dernière commencée si plusieurs se chevauchent). La cinématique va de la toute première clé à la toute dernière. Donc : UN PLAN = UNE CAMÉRA dont la première et la dernière clé donnent le début et la fin du plan ; pour un raccord « cut », fais commencer la caméra suivante exactement là où la précédente finit. Un plan fixe a quand même besoin de deux clés (début et fin, mêmes valeurs) pour avoir une durée.
- Parent : une caméra peut être attachée à un personnage, un véhicule ou une autre caméra. Ses coordonnées deviennent RELATIVES au parent : (0, 0, 0) = dans la tête du personnage (origine à 1,5 m du sol) ou au centre du véhicule. Options : follow (« tourner avec » : x = devant lui, z = à sa droite, le lacet lui devient relatif — pour une caméra embarquée, une vue par-dessus l'épaule : x −1,2, y 0,3, z 0,5) et look (« regarder le parent » : la caméra vise toujours son visage, lacet et tangage sont alors calculés). Sans follow, le décalage reste orienté selon le monde (la caméra suit sans tourner — idéal pour un travelling d'accompagnement). Dans set_keys, space:"monde" (défaut) donne des coordonnées du monde converties pour toi ; space:"parent" donne des coordonnées relatives.
- Image : filter ("" | "nuit" | "thermique" | "nb" | "sepia" | "cine"), vignette, grain, dof et raytracing de 0 à 100 (animables), shadow (ombres portées, vrai/faux). raytracing 40–70 + shadow donnent un rendu riche (occlusion, halos, reflets) ; "cine" + vignette 20–35 + grain 8–15 donne un look film. Le flou (dof) isole un sujet en gros plan (30–60).

# Grammaire du cinéma (applique-la)
- Valeurs de plan : très large / ensemble (situer le lieu, ouvrir ou fermer une séquence), demi-ensemble (le sujet dans son décor), moyen (en pied : l'action), américain (mi-cuisses : duel, démarche), rapproché taille ou poitrine (dialogue), gros plan (émotion), très gros plan (détail, regard). Alterne les valeurs : jamais deux plans de même valeur et de même axe à la suite (faux raccord, « jump cut ») — change la valeur ET l'angle d'au moins 30°.
- Règle des 180° : entre deux personnages qui se font face, reste du même côté de la ligne qui les relie, sinon ils semblent échanger leurs places. Champ / contre-champ : par-dessus l'épaule de l'un, puis de l'autre, du même côté de cette ligne.
- Règle des tiers : ne centre pas systématiquement. Place le sujet sur un tiers (thirds: "gauche" ou "droite") en laissant de l'« air » devant son regard ou sa marche (il regarde ou avance vers l'espace vide).
- Angles : hauteur des yeux (neutre), plongée (écrase, fragilise, montre le sol et l'espace), contre-plongée (grandit, menace, héroïse), au ras du sol (dramatise une marche, une voiture), aérien (situe, respire).
- Mouvements : travelling avant (on entre dans la scène, on se rapproche d'une émotion), arrière (on révèle, on quitte), latéral (accompagne une marche — garde le sujet au même endroit du cadre), panoramique (yaw seul : suit ou découvre), tilt (pitch seul), travelling circulaire (orbit_shot : met en valeur, tension), zoom (fov seul, à utiliser peu), travelling compensé (avance + fov qui s'ouvre). Un mouvement a un début et une fin motivés ; lent vaut mieux que rapide ; "doux" pour un mouvement isolé.
- Suivi : pour un sujet qui se déplace, attache la caméra (parent) plutôt que d'empiler les clés ; regarde sa trajectoire (entity_path) pour le précéder ou le suivre, et place la caméra du côté où il va.
- Rythme et durées : plan d'ensemble 4 à 6 s, plan moyen 3 à 5 s, gros plan 1,5 à 3 s, insert 1 à 2 s ; une action rapide se monte plus court, une émotion plus long. Ouvre large (où sommes-nous), resserre (qui, quoi), finis sur une image forte (gros plan ou plan large qui s'éloigne). Cale les coupes sur les événements (list_events : une parole, un geste, un coup, un départ).
- Lisibilité : garde le sujet net et dans le cadre du début à la fin du plan (vérifie sa position au début ET à la fin avec get_entity ou entity_path) ; évite de traverser un mur (les outils te préviennent : rapproche la caméra ou change de côté) ; à l'intérieur, les pièces sont petites : focales 45–70° et distances courtes.

# Règles de montage OBLIGATOIRES (le Studio les contrôle)
- Le joueur est LE sujet : au moins deux plans sur trois sont sur lui. Un PNJ n'a un plan que s'il interagit avec le joueur (il lui parle, le touche, le suit) ou se trouve à moins de 5 m de lui au moment du plan ; jamais d'insert sur un inconnu au loin.
- Aucun plan de moins de ${MIN_SHOT} s (vise 2,5 à 5 s). Si une action est brève, élargis le plan autour d'elle au lieu de le raccourcir.
- La cinématique couvre tout le passage demandé sans trou : chaque plan commence exactement là où le précédent finit (mêmes instants), du début à la fin. Par défaut : tout le record.
- Un plan = une caméra, créée AVANT d'être réglée : crée (frame_shot, create_camera, orbit_shot), puis seulement après update_camera / set_keys sur le même nom, écrit exactement pareil.
- Alterne les valeurs de plan et change d'axe d'au moins 30° à chaque coupe ; pas deux plans d'ensemble ou aériens de suite ; respecte la règle des 180°.
- frame_shot : donne toujours subject, shot, side, height et t.
- AVANT ta réponse finale, appelle cinematic_summary : il donne la liste RÉELLE des plans et ses « problemes ». Corrige chaque problème signalé, rappelle-le, puis seulement résume — avec exactement le nombre de plans, les noms et les durées qu'il indique (une caméra peut ne pas être à l'antenne : ne compte que les plans listés).
- « Fais la suite » : repars de la fin du montage existant (cinematic_summary → fin) et continue jusqu'à la fin du record, sans toucher aux plans déjà faits.

# Apparence et scène
- set_appearance change la tenue d'un personnage du record (corps, coiffure, couleurs, vêtements, skins, objet en main, sac) ; seuls les articles du compte de l'utilisateur sont permis (un administrateur a tout) — appearance_options te dit ce qui est possible, avec les numéros à utiliser. Un refus (« pas dans les skins du compte ») est normal : propose autre chose.
- set_visibility masque ou montre une entité (un passant qui gêne le cadre, par exemple).
- Rien n'est écrit dans le record : tout va dans le projet.

Si tu ne peux pas appeler les outils nativement, réponds par un seul bloc JSON : {"actions":[{"outil":"nom_de_l_outil","arguments":{…}}],"message":"ce que tu dis à l'utilisateur"} ; tu recevras les résultats et pourras continuer.`;

// ---------------------------------------------------------------- Schémas des outils
const P = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const S = (description, extra = {}) => ({ type: 'string', description, ...extra }), N = description => ({ type: 'number', description }), B = description => ({ type: 'boolean', description });
const ENT = S('Entité : son id (nombre), son nom ou pseudo, ou "joueur" (celui qui a enregistré).'), CAM = S('Caméra : son nom (ou son id).'), TS = N('Instant en secondes depuis le début du record.');
const LOOKAT = { type: 'object', description: 'Point visé : une entité (visage d’un personnage, centre d’un véhicule) ou un point du monde.', properties: { entity: ENT, x: N('X'), y: N('Y'), z: N('Z') }, additionalProperties: false };
const KEYP = { t: TS, x: N('Position X (m)'), y: N('Position Y, hauteur (m)'), z: N('Position Z (m)'), yaw: N('Lacet (°)'), pitch: N('Tangage (°), négatif = vers le bas'), roll: N('Roulis (°)'), fov: N('Focale (°), 5–130'),
  vignette: N('0–100'), grain: N('0–100'), dof: N('Flou de profondeur 0–100'), raytracing: N('0–100'), look_at: LOOKAT, ease: S('Interpolation vers la clé suivante.', { enum: ['fluide', 'doux', 'accel', 'frein', 'fixe'] }) };
const IMG = { filter: S('Filtre.', { enum: ['', 'nuit', 'thermique', 'nb', 'sepia', 'cine'] }), shadow: B('Ombres portées en temps réel.'), raytracing: N('Valeur fixe 0–100 (jusqu’à 300 pour un compte VIP).'),
  rt_ao: N('Raytracing, réglage fin : force de l’occlusion ambiante, 0–200 (100 = normal).'), rt_radius: N('Rayon de l’occlusion, 0–200 (100 = normal).'), rt_bloom: N('Halo des lumières, 0–200.'), rt_reflets: N('Reflets du sol, 0–200.'), vignette: N('Valeur fixe 0–100.'), grain: N('Valeur fixe 0–100.'), dof: N('Valeur fixe 0–100.') };
const SHOTP = { subject: ENT, shot: S('Valeur de plan.', { enum: Object.keys(SHOTS) }), side: S('D’où la caméra regarde le sujet, par rapport à là où IL regarde : face = devant lui, dos = derrière lui, profil_droit = à sa droite…', { enum: Object.keys(SIDES) }),
  height: S('Hauteur de la caméra : yeux, plongee (au-dessus, 30°), forte_plongee (55°), aerien (72°), contre_plongee (en dessous), sol (au ras du sol).', { enum: Object.keys(HEIGHTS) }), fov: N('Focale (°) ; par défaut celle conseillée pour ce plan.'),
  thirds: S('Règle des tiers : où placer le sujet dans le cadre.', { enum: ['centre', 'gauche', 'droite'] }), distance: N('Distance au sujet en mètres (remplace celle calculée d’après la valeur de plan).') };
const T = (name, description, parameters, mut = false) => ({ name, description, parameters, mut });
export const TOOLS = [
  T('scene_info', 'Le record : lieu, intérieur ou extérieur, durée, heure du jeu, jour ou nuit, le joueur enregistreur, nombre d’entités, instant courant de la frise.', P({})),
  T('list_entities', 'Les entités du record avec leur position à un instant : id, type (joueur | pnj | vehicule | objet), nom, x/y/z (pieds), cap (°), présent, état, distance au joueur. Filtre par type, recherche par nom, ou autour d’un point / d’une entité.', P({ type: S('Type voulu.', { enum: ['joueur', 'pnj', 'vehicule', 'objet', 'personnages'] }), search: S('Texte cherché dans le nom.'), near: ENT, radius: N('Rayon en mètres autour de « near » (défaut 15).'), t: TS, limit: N('Nombre maximal (défaut 40).') })),
  T('get_entity', 'Tout sur une entité à un instant : position, cap, vitesse, état (debout, assis, en marche, en course…), tenue détaillée et skins, objet en main, sac, véhicule occupé, présence dans le record (de… à…), entités et objets proches.', P({ entity: ENT, t: TS }, ['entity'])),
  T('entity_path', 'La trajectoire d’une entité dans le temps : positions, cap et vitesse échantillonnés entre deux instants. Indispensable avant un plan de suivi.', P({ entity: ENT, from: N('Début (s), défaut 0.'), to: N('Fin (s), défaut la durée.'), step: N('Pas en secondes (défaut : 20 points sur l’intervalle).') }, ['entity'])),
  T('list_events', 'Ce qui se passe dans le record : paroles (chat), gestes, émotes, tirs, coups, chutes — avec l’instant et l’entité. Pour caler les coupes.', P({ from: N('Début (s).'), to: N('Fin (s).'), entity: ENT })),
  T('list_cameras', 'Les caméras du projet : nom, active, parent, options, filtre, image, début et fin de leurs clés, nombre de clés par paramètre.', P({})),
  T('get_camera', 'Une caméra en détail : toutes ses clés par paramètre (instant, valeur, ease) et sa pose dans le monde à un instant.', P({ camera: CAM, t: TS }, ['camera'])),
  T('cinematic_summary', 'Le montage actuel : la suite des plans (quelle caméra est à l’antenne, de quand à quand) et la durée totale.', P({})),
  T('create_camera', 'Crée une caméra avec une première clé à l’instant t. Donne sa position (monde) et son orientation (yaw/pitch, ou look_at pour viser une entité ou un point). Pour un cadrage de cinéma sur un sujet, préfère frame_shot.', P({ name: S('Nom du plan (ex. « Plan large d’ouverture »).'), t: TS, x: N('X'), y: N('Y (hauteur)'), z: N('Z'), yaw: N('Lacet (°)'), pitch: N('Tangage (°)'), roll: N('Roulis (°)'), fov: N('Focale (°), défaut 50'), look_at: LOOKAT, ...IMG }, ['name', 't', 'x', 'y', 'z']), true),
  T('update_camera', 'Change les réglages d’une caméra : nom, active (prise dans la cinématique), couleur, filtre, ombre, et les valeurs FIXES de raytracing / vignette / grain / dof (pour les animer : set_keys).', P({ camera: CAM, name: S('Nouveau nom.'), active: B('Prise en compte dans la cinématique.'), color: S('Couleur #rrggbb de sa piste.'), ...IMG }, ['camera']), true),
  T('delete_camera', 'Supprime une caméra (annulable par l’utilisateur).', P({ camera: CAM }, ['camera']), true),
  T('duplicate_camera', 'Duplique une caméra avec toutes ses clés.', P({ camera: CAM, name: S('Nom de la copie.') }, ['camera']), true),
  T('set_parent', 'Attache une caméra à un parent (personnage, véhicule ou caméra) ou la détache (parent: null). La caméra ne bouge pas au moment de l’attache (ses clés sont converties). follow : elle tourne avec lui ; look : elle le regarde toujours.', P({ camera: CAM, parent: { description: 'Entité ou nom de caméra ; null pour détacher.', anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] }, follow: B('Tourner avec le parent.'), look: B('Regarder le parent.') }, ['camera', 'parent']), true),
  T('set_keys', 'Pose ou remplace des images-clés sur une caméra. Chaque clé ne donne QUE les paramètres à poser à cet instant (une clé de fov seule ne touche pas la position). look_at calcule yaw et pitch pour viser une entité ou un point depuis la position de la caméra à cet instant. space : "monde" (défaut) ou "parent" (coordonnées relatives au parent).', P({ camera: CAM, keys: { type: 'array', description: 'Les clés à poser.', items: P(KEYP, ['t']) }, space: S('Repère des x/y/z/yaw donnés.', { enum: ['monde', 'parent'] }) }, ['camera', 'keys']), true),
  T('delete_keys', 'Supprime des clés : à un instant (t) ou sur un intervalle (from → to) ; params limite à certains paramètres (sinon tous).', P({ camera: CAM, t: TS, from: N('Début (s).'), to: N('Fin (s).'), params: { type: 'array', items: { type: 'string', enum: [...POSE, ...Object.keys(FX)] }, description: 'Paramètres visés.' } }, ['camera']), true),
  T('set_ease', 'Change l’interpolation des clés d’un instant (vers la clé suivante).', P({ camera: CAM, t: TS, ease: KEYP.ease, params: { type: 'array', items: { type: 'string' }, description: 'Paramètres visés (défaut : tous).' } }, ['camera', 't', 'ease']), true),
  T('move_keys', 'Décale dans le temps toutes les clés d’une caméra (ou celles d’un intervalle) : pour avancer, retarder ou resserrer un plan.', P({ camera: CAM, shift: N('Décalage en secondes (négatif = plus tôt).'), from: N('Début de l’intervalle (s).'), to: N('Fin de l’intervalle (s).') }, ['camera', 'shift']), true),
  T('frame_shot', 'Cadre un sujet selon la grammaire du cinéma et pose la clé correspondante (position + orientation + focale) à l’instant t : valeur de plan, côté, hauteur, règle des tiers. La caméra est créée si « camera » n’existe pas. Appelle-le deux fois (début et fin) pour un plan fixe avec durée ou un travelling entre deux cadrages. Tient compte des murs.', P({ camera: S('Nom de la caméra (créée si elle n’existe pas).'), t: TS, ...SHOTP, ease: KEYP.ease }, ['camera', 't', 'subject', 'shot']), true),
  T('orbit_shot', 'Travelling circulaire autour d’un sujet, de « from » à « to » : la caméra est attachée au sujet (elle le suit s’il bouge) et le regarde ; elle tourne de « degrees » autour de lui à partir du côté « side ».', P({ camera: S('Nom de la caméra (créée si elle n’existe pas).'), subject: ENT, from: N('Début (s).'), to: N('Fin (s).'), side: SHOTP.side, degrees: N('Angle parcouru (°), positif = vers la droite du sujet ; défaut 120.'), distance: N('Distance au sujet (m), défaut 4.'), height: N('Hauteur de la caméra au-dessus du sol du sujet (m), défaut 1,6.'), fov: N('Focale (°), défaut 45.'), ease: KEYP.ease }, ['camera', 'subject', 'from', 'to']), true),
  T('seek', 'Place la tête de lecture de la frise à un instant.', P({ t: TS }, ['t'])),
  T('set_playback', 'Lecture : en marche ou en pause, et vitesse (0,1 à 4 ; 1 = normale — elle vaut aussi pour la cinématique et l’export : 0,5 = ralenti).', P({ playing: B('Lecture en marche.'), rate: N('Vitesse.') }), true),
  T('set_view', 'Ce que montre la vue : "libre" (caméra libre), "camera" (à travers une caméra), "joueur" (par les yeux du joueur).', P({ mode: S('Vue.', { enum: ['libre', 'camera', 'joueur'] }), camera: CAM }, ['mode'])),
  T('appearance_options', 'Ce qu’on peut faire porter à un personnage : pour chaque attribut (gender, skin, hair, hairStyle, eyes, beard, chest, hat, glasses, top, bottom, feet et leurs couleurs acc, glassesCol, shirt, pants, shoes) la liste « numéro: nom » permise au compte, les skins de vêtements possédés qui vont sur sa tenue, les objets tenables et les sacs.', P({ entity: ENT, attribute: S('Un seul attribut à détailler (sinon tous, en abrégé).') }, ['entity'])),
  T('set_appearance', 'Change l’apparence d’un personnage du record. look : { attribut: numéro } (voir appearance_options) ; skins : { hat | glasses | top | bottom | feet : "clé du skin" ou null } ; hold : objet en main ("glock17", "couteau__lave"… ou null) ; bag : "sac_a_dos", "sacoche", "sac_a_dos__pirate", "sacoche:3" (teinte) ou null. Ce que le compte ne possède pas est refusé.', P({ entity: ENT, look: { type: 'object', description: 'Attributs à changer.', additionalProperties: { type: 'number' } }, skins: { type: 'object', description: 'Skins de vêtements.', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, hold: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Objet tenu.' }, bag: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Sac.' } }, ['entity']), true),
  T('reset_appearance', 'Rend à un personnage son apparence d’origine (celle du record).', P({ entity: ENT }, ['entity']), true),
  T('set_visibility', 'Masque ou montre une entité (personnage, véhicule, objet) dans la scène.', P({ entity: ENT, visible: B('Visible ou non.') }, ['entity', 'visible']), true),
  T('preview_cinematic', 'Lance la prévisualisation de la cinématique dans la vue (les caméras actives s’enchaînent).', P({})),
  T('export_video', 'Ouvre la page « Exporter » (l’utilisateur y choisit format, compression, nom, début et fin). Pour lancer un export réglé : export_cinematic. Seulement si l’utilisateur le demande.', P({})),
];
// Familles d'outils « à la demande » : hors de ces familles (caméras, scène, géométrie, lecture), un outil part toujours au modèle. Une
// famille s'ouvre quand la demande de l'utilisateur en parle (when, sur le texte sans accents), quand un de ses outils a déjà servi,
// ou quand le modèle la demande (list_tool_groups). Un outil d'extension choisit sa famille par son champ « group », sinon par GROUP_OF.
export const TOOL_GROUPS = {
  animation: { label: 'ajouter et animer des objets, des PNJ, des faux joueurs ; poses, émotes, chutes, particules', when: /objet|modele|caisse|carton|tomb|chute|renvers|pnj|personnage|passant|figurant|faux joueur|ajout|rajout|pose|coucou|salu|danse|emote|geste|particule|fumee|etincelle|porte|voiture|deplac|bouge|anime|element|apparai|lance|jette/ },
  lumieres: { label: 'lumières ajoutées, éclairage du lieu, miroirs', when: /lumi|lampe|eclair|spot|sombre|obscur|noir|etein|allum|nuit|ambiance|horreur|peur|angoiss|miroir|neon|projecteur|penombre/ },
  titres: { label: 'titres et textes, fondus, tremblement de caméra, capture d’image', when: /titre|texte|sous titre|generique|fondu|trembl|secou|capture|photo|image fixe|affiche le/ },
  monde: { label: 'heure du jour, météo, ciel, brouillard', when: /heure|nuit|jour|matin|soir|midi|minuit|meteo|pluie|pleut|brouillard|brume|ciel|coucher|aube|crepuscule|orage|ambiance|horreur/ },
  export: { label: 'exporter la cinématique en vidéo', when: /export|mp4|webm|gif|avi|video|fichier|rendu final/ },
  apparence: { label: 'tenues et apparence des personnages, masquer une entité', when: /tenue|habit|habill|vetement|apparence|skin|chapeau|coiff|cheveu|lunette|masqu|cache|invisible|disparai|sac|look|deguis|en main/ },
};
const GROUP_OF = Object.fromEntries(Object.entries({
  animation: 'list_elements search_models add_object add_character add_particles animate_element make_fall update_element delete_element delete_element_keys list_poses set_pose play_emote',
  lumieres: 'add_light add_mirror list_scene_lights set_scene_lighting set_scene_light', titres: 'add_text add_title set_fade capture_image set_camera_shake',
  monde: 'world_settings set_world set_world_keys', export: 'export_cinematic export_video', apparence: 'appearance_options set_appearance reset_appearance set_visibility',
}).flatMap(([g, names]) => names.split(' ').map(n => [n, g])));
export const toolSchemas = (list = TOOLS) => list.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

// ---------------------------------------------------------------- Exécution
export function createEngine(H) {
  const C = H.C, ok = (text, data = {}) => ({ ok: true, text: `✓ ${text}`, data }), ko = text => ({ ok: false, text: `✗ ${text}`, data: {} });
  const ms = (v, def = null) => { const n = num(v); return n === null ? def : Math.round(clamp(n, 0, H.dur / 1000) * 1000); };
  // (une entité par son id exact — nombre ou texte, objets du décor compris : « p164 » —, sa clé « i:p164 », « #12 », « id 12 », son nom)
  const ent = q => { if (q == null || q === '') return null; const L = H.entities(), s = String(q).trim(), bare = s.replace(/^(?:id|pnj|npc|objet|entite|entité|joueur|#)\s*[:#n°]*\s*(?=\S)/i, '');
    return H.find(q) || L.find(e => e.key === s) || L.find(e => String(e.id) === s) || (bare !== s && /^[a-z]{0,2}\d+$/i.test(bare) ? L.find(e => String(e.id) === bare && e.kind !== 'objet') || L.find(e => String(e.id) === bare) : null) || L.find(e => e.kind === 'objet' && nrm(e.name) === nrm(s)) || null; };
  const camOf = q => { const s = nrm(q); return s ? H.cams.find(c => c.id === q) || H.cams.find(c => nrm(c.name) === s) || H.cams.find(c => nrm(c.name).replace(/ /g, '') === s.replace(/ /g, '')) || H.cams.find(c => nrm(c.name).includes(s) || s.includes(nrm(c.name))) || null : null; };
  const noCam = (q, tool) => ({ ...ko(`Caméra « ${q ?? ''} » introuvable${H.cams.length ? ` (caméras existantes : ${H.cams.map(c => `« ${c.name} »`).join(', ')})` : ' (aucune caméra n’existe encore)'} : crée-la d’abord avec frame_shot, create_camera ou orbit_shot, puis rappelle ${tool}.`), retry: true });
  const headY = e => (e.kind === 'vehicule' ? 0.8 : e.kind === 'objet' ? 0.5 : 1.5);
  const rtMax = () => { const m = +H.rtMax?.(); return m > 0 ? m : 100; };   // (raytracing : 100, ou 300 pour un compte VIP)
  const RT_FINE = { rt_ao: 'rtAo', rt_radius: 'rtRad', rt_bloom: 'rtBloom', rt_reflets: 'rtRefl' };
  const pos = (e, t) => H.posAt(e.key, t);
  const target = (la, t) => { if (!la) return null; if (la.entity != null) { const e = ent(la.entity), p = e && pos(e, t); return p ? { x: p.x, y: p.y + headY(e) - (e.kind === 'vehicule' || e.kind === 'objet' ? 0 : 0.1), z: p.z, name: e.name } : null; } const x = num(la.x), y = num(la.y), z = num(la.z); return x === null || z === null ? null : { x, y: y ?? 1, z, name: 'le point' }; };
  const aim = (from, to) => { const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z; return { yaw: Math.atan2(dz, dx), pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.55, 1.55) }; };
  const frameOf = (c, t) => C.parentFrame(c, t, H.cams, H.frame);
  const entBrief = (e, t) => { const p = pos(e, t); return { id: e.id, type: e.kind, nom: e.name, ...(e.me ? { joueur: true } : {}), ...(e.sub && !e.me ? { precision: e.sub } : {}), ...(p ? { x: r2(p.x), y: r2(p.y), z: r2(p.z), ...(e.kind !== 'objet' ? { cap: Math.round(p.yaw * R2D) } : {}), present: !!p.present } : { present: false }) }; };
  const speedAt = (e, t) => { const a = pos(e, Math.max(0, t - 250)), b = pos(e, Math.min(H.dur, t + 250)); return a && b ? Math.hypot(b.x - a.x, b.z - a.z) / 0.5 : 0; };
  const camBrief = c => { const K = C.keyTimes(c, C.CH), all = C.keyTimes(c); return { nom: c.name, active: c.on, parent: c.parent ? { nom: c.parent.name, type: c.parent.kind, follow: c.follow, look: c.look } : null, filtre: c.filter || 'aucun', ombre: !!c.shadow,
    raytracing: Math.round((c.tracks.rt.length ? C.fxAt(c, H.T).rt : c.rt) * 100), debut: K.length ? r2(K[0] / 1000) : null, fin: K.length ? r2(K[K.length - 1] / 1000) : null, cles: all.length, animee: K.length > 1 }; };
  /** Écrit une pose du monde (ou locale) à l'instant t sur les pistes d'une caméra : seuls les paramètres donnés */
  function writePose(c, t, vals, local = false, ease = null) {
    const P0 = frameOf(c, t), cur = C.poseAt(c, t) || { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60 };
    let L = vals;
    if (!local && P0 && ['x', 'y', 'z', 'yaw'].some(k => k in vals)) {   // (monde → repère du parent : la pose complète est convertie, puis seuls les paramètres demandés sont gardés)
      const W0 = C.toWorld(cur, P0, c.follow), Lc = C.toLocal({ ...W0, ...vals }, P0, c.follow); L = { ...vals }; for (const k of ['x', 'y', 'z', 'yaw']) if (k in vals) L[k] = Lc[k];
    }
    let n = 0; for (const ch of POSE) if (ch in L && Number.isFinite(L[ch])) { C.setKey(c, ch, t, L[ch], ease); n++; }
    return n;
  }
  function ensureCam(name, t, pose) {
    let c = camOf(name), made = false;
    if (!c) { c = C.newCam(H.cams, pose, t); c.name = String(name || c.name).slice(0, 40); H.cams.push(c); made = true; }
    return { c, made };
  }
  function shotPose(e, t, a) {
    const p = pos(e, t); if (!p) return null;
    const S0 = SHOTS[a.shot] || SHOTS.moyen, k = e.kind === 'vehicule' ? 2.3 : 1, fov = clamp(num(a.fov) ?? S0[2], 8, 120), ht = e.kind === 'vehicule' ? 0.8 : e.kind === 'objet' ? Math.max(0.4, (H.geo?.topOf?.(p.x, p.z) ?? 0.8) * 0.62) : S0[1];
    const tgt = { x: p.x, y: p.y + ht, z: p.z }, az = p.yaw + (SIDES[a.side] ?? SIDES.trois_quarts_droit) * D2R;
    let d = num(a.distance) ?? (S0[0] * k / 2) / Math.tan(fov * D2R / 2); d = clamp(d, 0.35, 120);
    const hgt = a.height in HEIGHTS ? a.height : 'yeux', el = HEIGHTS[hgt] === null ? null : HEIGHTS[hgt] * D2R;
    const place = dd => { const dh = el === null ? dd : dd * Math.cos(el); return { x: tgt.x + Math.cos(az) * dh, z: tgt.z + Math.sin(az) * dh, y: el === null ? p.y + 0.22 : Math.max(p.y + 0.2, tgt.y + dd * Math.sin(el)) }; };
    let q = place(d), wall = false;
    while (d > 0.7 && H.blocked(q.x, q.z)) { d -= 0.3; q = place(d); wall = true; }
    const A = aim(q, tgt); let yaw = A.yaw;
    if (a.thirds === 'gauche' || a.thirds === 'droite') { const hf = Math.atan(Math.tan(fov * D2R / 2) * H.aspect()), dlt = Math.atan(Math.tan(hf) / 3); yaw += a.thirds === 'gauche' ? dlt : -dlt; }
    return { pose: { x: q.x, y: q.y, z: q.z, yaw, pitch: A.pitch, roll: 0, fov }, wall, d, name: S0[3] };
  }
  const RUN = {
    scene_info() { const I = H.info(); return ok(`Record : ${I.lieu}, ${r1(H.dur / 1000)} s.`, { ...I, duree_s: r2(H.dur / 1000), instant_courant_s: r2(H.T / 1000), entites: H.entities().reduce((o, e) => { o[e.kind] = (o[e.kind] || 0) + 1; return o; }, {}), cameras: H.cams.length }); },
    list_entities(a) {
      const t = ms(a.t, Math.round(H.T)), n = clamp(num(a.limit) ?? 40, 1, 120), me = H.entities().find(e => e.me), pm = me && pos(me, t), q = String(a.search || '').toLowerCase();
      const c = a.near != null ? (() => { const e = ent(a.near); return e && pos(e, t); })() : null; if (a.near != null && !c) return ko(`« ${a.near} » : entité introuvable.`);
      // (type et recherche tolérants : « npc », « personnage », « voitures »… ; un type inconnu ou une recherche sans résultat ne vide pas la liste)
      const type = a.type ? TYPE_SYN[nrm(a.type).replace(/ /g, '_')] || null : null, notes = [], qn = nrm(a.search);
      if (a.type && !type) notes.push(`type « ${a.type} » inconnu (joueur, pnj, vehicule, objet, personnages) : tout est listé`);
      const ofType = e => !type || (type === 'personnages' ? e.kind === 'joueur' || e.kind === 'pnj' : e.kind === type);
      let L = H.entities().filter(ofType); if (!type && !c) L = L.filter(e => e.kind !== 'objet' || qn);   // (le décor : seulement sur demande)
      if (qn) { const F = L.filter(e => nrm(`${e.name} ${e.sub || ''} ${e.type || ''} ${e.id}`).includes(qn)); if (F.length) L = F; else { notes.push(`rien ne s’appelle « ${a.search} » : voici les entités les plus proches du joueur`); L = L.filter(e => e.kind !== 'objet'); } }
      let rows = L.map(e => { const b = entBrief(e, t), o = c || pm; if (o && b.x !== undefined) b.distance = r1(Math.hypot(b.x - o.x, b.z - o.z)); return b; });
      rows.sort((x, y) => (y.joueur ? 1 : 0) - (x.joueur ? 1 : 0) || (x.distance ?? 1e9) - (y.distance ?? 1e9));
      if (c) { const rad = num(a.radius) ?? 15, In = rows.filter(b => b.distance !== undefined && b.distance <= rad); if (In.length > 1 || (In.length && !rows.some(b => b.distance > rad))) rows = In; else { notes.push(`presque rien à moins de ${rad} m : voici les plus proches`); rows = rows.filter(b => b.distance !== undefined).slice(0, 12); } }
      if (!rows.length && !type && !qn) notes.push('ce record ne contient aucun personnage ni véhicule');
      return ok(`${rows.length} entité${rows.length > 1 ? 's' : ''} listée${rows.length > 1 ? 's' : ''} à ${fmtT(t)}${notes.length ? ` — ${notes.join(' ; ')}` : ''}.`, { t: r2(t / 1000), total: rows.length, entites: rows.slice(0, n), ...(notes.length ? { remarques: notes } : {}) });
    },
    get_entity(a) {
      const e = ent(a.entity); if (!e) return ko(`« ${a.entity} » : entité introuvable (list_entities donne les noms).`);
      const t = ms(a.t, Math.round(H.T)), b = entBrief(e, t), p = pos(e, t), d = { ...b, presence_s: [r2(e.t0 / 1000), Number.isFinite(e.t1) ? r2(e.t1 / 1000) : r2(H.dur / 1000)], masque: H.isHidden(e.key) };
      if (e.kind !== 'objet' && p) { const v = speedAt(e, t); d.vitesse_m_s = r1(v); d.mouvement = v < 0.15 ? 'immobile' : v < 3 ? 'marche' : v < 7 ? 'court' : 'roule ou file'; d.hauteur_yeux = r2(p.y + headY(e)); }
      if (e.kind === 'joueur' || e.kind === 'pnj') { const L = H.lookOf(e.id, t); if (L) { d.tenue = L.text; d.look = L.look; if (L.wd) d.skins = L.wd; if (L.hold) d.en_main = L.hold; if (L.bag) d.sac = L.bag; } Object.assign(d, H.stateOf(e.id, t) || {}); }
      if (p) d.proches = H.entities().filter(o => o !== e && o.kind !== 'objet').map(o => { const q = pos(o, t); return q?.present ? { id: o.id, nom: o.name, type: o.kind, distance: r1(Math.hypot(q.x - p.x, q.z - p.z)), x: r2(q.x), z: r2(q.z) } : null; }).filter(o => o && o.distance < 12).sort((x, y) => x.distance - y.distance).slice(0, 8);
      return ok(`${e.name} à ${fmtT(t)} : ${p ? `(${r1(p.x)}, ${r1(p.y)}, ${r1(p.z)})` : 'absent'}.`, d);
    },
    entity_path(a) {
      const e = ent(a.entity); if (!e) return ko(`« ${a.entity} » : entité introuvable.`);
      const t0 = ms(a.from, 0), t1 = Math.max(t0 + 100, ms(a.to, Math.round(H.dur))), st = Math.max(100, Math.round((num(a.step) ?? (t1 - t0) / 1000 / 20) * 1000)), pts = [];
      for (let t = t0; t <= t1 + 1 && pts.length < 80; t += st) { const p = pos(e, t); if (p) pts.push({ t: r2(t / 1000), x: r2(p.x), y: r2(p.y), z: r2(p.z), cap: Math.round(p.yaw * R2D), v: r1(speedAt(e, t)), ...(p.present ? {} : { absent: true }) }); }
      const f = pts[0], l = pts[pts.length - 1], dist = pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);
      return ok(`Trajectoire de ${e.name} : ${pts.length} points, ${r1(dist)} m parcourus.`, { entite: e.name, parcouru_m: r1(dist), deplacement: f && l ? { dx: r2(l.x - f.x), dz: r2(l.z - f.z) } : null, points: pts });
    },
    list_events(a) {
      const t0 = ms(a.from, 0), t1 = ms(a.to, Math.round(H.dur)), e = a.entity != null ? ent(a.entity) : null; if (a.entity != null && !e) return ko(`« ${a.entity} » : entité introuvable.`);
      const L = H.events(t0, t1).filter(x => !e || x.id === e.id).slice(0, 80).map(x => ({ t: r2(x.t / 1000), quoi: x.type, qui: x.name, ...(x.text ? { texte: x.text } : {}) }));
      return ok(`${L.length} événement${L.length > 1 ? 's' : ''} entre ${fmtT(t0)} et ${fmtT(t1)}.`, { evenements: L });
    },
    list_cameras() { return ok(`${H.cams.length} caméra${H.cams.length > 1 ? 's' : ''}.`, { cameras: H.cams.map(camBrief) }); },
    get_camera(a) {
      const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil');
      const t = ms(a.t, Math.round(H.T)), w = C.worldPose(c, t, H.cams, H.frame), tr = {};
      for (const [ch] of C.PARAMS) if (c.tracks[ch].length) tr[ch === 'rt' ? 'raytracing' : ch] = c.tracks[ch].map(k => ({ t: r2(k.t / 1000), v: ['yaw', 'pitch', 'roll'].includes(ch) ? r1(k.v * R2D) : C.FX_CH.includes(ch) ? Math.round(k.v * 100) : r2(k.v), ...(k.ease !== 'fluide' ? { ease: k.ease } : {}) }));
      return ok(`${c.name} : ${C.keyTimes(c).length} instants-clés.`, { ...camBrief(c), cles_par_parametre: tr, repere_des_cles: c.parent ? `relatif à ${c.parent.name}` : 'monde', pose_monde: w ? { t: r2(t / 1000), x: r2(w.x), y: r2(w.y), z: r2(w.z), yaw: r1(w.yaw * R2D), pitch: r1(w.pitch * R2D), roll: r1(w.roll * R2D), fov: r1(w.fov), ...(w.lost ? { parent_absent: true } : {}) } : null });
    },
    cinematic_summary(old = null) {   // (old : caméras d'avant ce tour — celles de l'utilisateur, qu'on ne lui reproche pas de laisser sans durée)
      const R = C.cineRange(H.cams); if (!R) return ok('Pas encore de cinématique : il faut au moins une caméra active avec deux clés.', { plans: [] });
      const cuts = new Set([R[0], R[1]]); for (const c of H.cams) if (c.on) { const K = C.keyTimes(c, C.CH); if (K.length) { cuts.add(K[0]); cuts.add(K[K.length - 1] + 1); } }
      const ts = [...cuts].filter(t => t >= R[0] && t <= R[1]).sort((x, y) => x - y), plans = [];
      for (let i = 0; i + 1 < ts.length; i++) { const c = C.activeCam(H.cams, (ts[i] + ts[i + 1]) / 2); if (!c) continue; const l = plans[plans.length - 1]; if (l && l.camera === c.name) l.fin = r2(ts[i + 1] / 1000); else plans.push({ camera: c.name, debut: r2(ts[i] / 1000), fin: r2(ts[i + 1] / 1000) }); }
      for (const p of plans) p.duree = r2(p.fin - p.debut);
      const pb = problems(plans, R, old instanceof Set ? old : null), dur = H.dur / 1000, rest = [];   // (non couvert : une remarque, pas un défaut — on peut ne vouloir qu'un passage)
      if (R[0] / 1000 > 2) rest.push(`le début du record (0 → ${r2(R[0] / 1000)} s) n’a pas de plan`); if (dur - R[1] / 1000 > 2) rest.push(`la fin du record (${r2(R[1] / 1000)} → ${r2(dur)} s) n’a pas de plan : pour tout couvrir, ajoute un plan final ou prolonge le dernier`);
      return ok(`Cinématique : ${plans.length} plan${plans.length > 1 ? 's' : ''}, ${r1((R[1] - R[0]) / 1000)} s${pb.length ? ` — ${pb.length} problème${pb.length > 1 ? 's' : ''} à corriger` : ''}.`, { debut: r2(R[0] / 1000), fin: r2(R[1] / 1000), duree: r2((R[1] - R[0]) / 1000), nombre_de_plans: plans.length, plans, problemes: pb, ...(rest.length ? { non_couvert: rest } : {}), ...(pb.length ? {} : { verdict: 'montage correct : résume-le tel quel (mêmes plans, mêmes durées)' }) });
    },
    create_camera(a) {
      const t = ms(a.t, Math.round(H.T)), x = num(a.x), y = num(a.y), z = num(a.z); if (x === null || y === null || z === null) return ko('create_camera : x, y et z sont obligatoires.');
      const pose = { x, y, z, yaw: (num(a.yaw) ?? 0) * D2R, pitch: clamp((num(a.pitch) ?? 0) * D2R, -1.55, 1.55), roll: (num(a.roll) ?? 0) * D2R, fov: clamp(num(a.fov) ?? 50, 5, 130) };
      const tg = target(a.look_at, t); if (a.look_at && !tg) return ko('create_camera : look_at introuvable.'); if (tg) Object.assign(pose, aim(pose, tg));
      const c = C.newCam(H.cams, pose, t); if (a.name) c.name = String(a.name).slice(0, 40); H.cams.push(c); applyImage(c, a);
      return ok(`Caméra « ${c.name} » créée à ${fmtT(t)} en (${r1(x)}, ${r1(y)}, ${r1(z)})${tg ? `, tournée vers ${tg.name}` : ''}${H.blocked(x, z) ? ' — ⚠ elle semble dans un mur ou hors du lieu' : ''}.`, { camera: c.name });
    },
    update_camera(a) {
      const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil'); const did = [];
      if (a.name) { const old = c.name; c.name = String(a.name).slice(0, 40); for (const o of H.cams) if (o.parent?.kind === 'camera' && o.parent.id === c.id) o.parent.name = c.name; did.push(`renommée « ${c.name} » (ex-« ${old} »)`); }
      if (typeof a.active === 'boolean') { c.on = a.active; did.push(a.active ? 'active' : 'écartée de la cinématique'); }
      if (/^#[0-9a-f]{6}$/i.test(a.color || '')) { c.color = a.color; did.push('couleur changée'); }
      did.push(...applyImage(c, a));
      return did.length ? ok(`${c.name} : ${did.join(', ')}.`, { camera: c.name }) : ko('update_camera : rien à changer.');
    },
    delete_camera(a) { const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil'); H.cams = C.removeCam(H.cams, c, H.frame); return ok(`Caméra « ${c.name} » supprimée.`); },
    duplicate_camera(a) { const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil'); const d = C.newCam(H.cams); Object.assign(d, JSON.parse(JSON.stringify({ ...c, id: d.id, name: a.name ? String(a.name).slice(0, 40) : d.name, color: d.color }))); H.cams.push(d); return ok(`« ${c.name} » dupliquée en « ${d.name} ».`, { camera: d.name }); },
    set_parent(a) {
      const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil');
      if (a.parent === null || a.parent === '' || a.parent === 'null') { C.rebase(c, H.cams, H.frame, () => { c.parent = null; c.look = false; c.follow = false; }); return ok(`${c.name} détachée : elle est libre dans la scène.`); }
      const pc = camOf(a.parent), e = pc ? null : ent(a.parent);
      // (un élément ajouté à la scène — objet, lumière, groupe : anim.js — peut aussi porter une caméra)
      const ao = !pc && (!e || e.kind === 'objet') ? (o => (o && !['ref', 'perso', 'ambiance', 'lampe', 'effets', 'audio', 'titre'].includes(o.kind) ? o : null))(H.anim?.find?.(a.parent)) : null;
      if (pc) { if (pc === c || C.wouldLoop(c, pc.id, H.cams)) return ko('Impossible : ces caméras se suivraient en boucle.'); }
      else if (!ao && (!e || e.kind === 'objet')) return ko(`Parent « ${a.parent} » introuvable (personnage, véhicule, caméra ou élément ajouté).`);
      const P1 = pc ? { kind: 'camera', id: pc.id, name: pc.name } : ao ? { kind: 'objet', id: ao.id, name: ao.name } : { kind: e.kind === 'vehicule' ? 'vehicule' : 'perso', id: e.id, name: e.name };
      C.rebase(c, H.cams, H.frame, () => { c.parent = P1; if (typeof a.follow === 'boolean') c.follow = a.follow; else if (P1.kind === 'vehicule') c.follow = true; });
      if (typeof a.look === 'boolean') c.look = a.look;
      return ok(`${c.name} attachée à ${P1.name}${c.follow ? ', tourne avec lui' : ''}${c.look ? ', le regarde' : ''} (sans bouger : ses clés sont maintenant relatives à ${P1.name}).`, { camera: c.name });
    },
    set_keys(a) {
      if (!Array.isArray(a.keys) || !a.keys.length) return ko('set_keys : il manque « keys » (liste de clés { t, x, y, z, yaw… }).');
      let c = camOf(a.camera), born = false;
      if (!c) {   // (caméra inconnue : créée d'ici si une clé donne sa position complète ; sinon l'appel sera rejoué après les créations du lot)
        const k0 = a.keys.find(k => num(k?.t) !== null && num(k.x) !== null && num(k.y) !== null && num(k.z) !== null); if (!k0 || !a.camera) return noCam(a.camera, 'set_keys');
        c = C.newCam(H.cams, { x: num(k0.x), y: num(k0.y), z: num(k0.z), yaw: (num(k0.yaw) ?? 0) * D2R, pitch: (num(k0.pitch) ?? 0) * D2R, roll: 0, fov: clamp(num(k0.fov) ?? 50, 5, 130) }, ms(k0.t)); c.name = String(a.camera).slice(0, 40); H.cams.push(c); born = true;
      }
      const local = a.space === 'parent' && !!c.parent, notes = []; let n = 0; const times = [];
      for (const k of a.keys.slice(0, 200)) {
        const t = ms(k?.t); if (t === null) { notes.push('une clé sans instant a été ignorée'); continue; }
        const v = {}; for (const ch of ['x', 'y', 'z', 'fov']) { const q = num(k[ch]); if (q !== null) v[ch] = ch === 'fov' ? clamp(q, 5, 130) : q; }
        for (const ch of ['yaw', 'pitch', 'roll']) { const q = num(k[ch]); if (q !== null) v[ch] = q * D2R; }
        if (k.look_at) {
          const tg = target(k.look_at, t); if (!tg) { notes.push(`look_at introuvable à ${fmtT(t)}`); }
          else { const P0 = frameOf(c, t), cur = C.poseAt(c, t), W0 = cur ? C.toWorld(cur, P0, c.follow) : null, from = local ? C.toWorld({ ...(cur || {}), ...v }, P0, c.follow) : { ...(W0 || {}), ...v };
            if (!Number.isFinite(from.x)) notes.push(`look_at à ${fmtT(t)} : la caméra n’a pas encore de position`); else { const A = aim(from, tg); if (local) { const Lc = C.toLocal({ ...from, ...A }, P0, c.follow); v.yaw = Lc.yaw; } else v.yaw = A.yaw; v.pitch = A.pitch; } }
        }
        const ease = C.EASES[k.ease] ? k.ease : null;
        n += writePose(c, t, v, local, ease);
        for (const [name, ch] of Object.entries(FX)) { const q = num(k[name]); if (q !== null) { C.setKey(c, ch, t, clamp(q, 0, ch === 'rt' ? rtMax() : 100) / 100, ease); n++; } }
        if (ease && !Object.keys(v).length) C.easeAt(c, null, t, ease);
        if (!local && 'x' in v && 'z' in v && !c.parent && H.blocked(v.x, v.z)) notes.push(`⚠ à ${fmtT(t)} la caméra semble dans un mur ou hors du lieu`);
        times.push(t);
      }
      if (!n) return ko(`set_keys : aucune valeur posée${notes.length ? ` (${notes.join(' ; ')})` : ''}.`);
      const S0 = Math.min(...times), S1 = Math.max(...times);
      return ok(`${born ? `Caméra « ${c.name} » créée ; ` : ''}${n} clé${n > 1 ? 's' : ''} posée${n > 1 ? 's' : ''} sur ${c.name} (${times.length > 1 ? `de ${fmtT(S0)} à ${fmtT(S1)}` : `à ${fmtT(S0)}`})${notes.length ? ` — ${notes.join(' ; ')}` : ''}.`, { camera: c.name, cles: n, ...(notes.length ? { remarques: notes } : {}) });
    },
    delete_keys(a) {
      const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil');
      const chans = Array.isArray(a.params) && a.params.length ? a.params.map(p => FX[p] || p).filter(p => c.tracks[p]) : Object.keys(c.tracks); let n = 0;
      if (num(a.t) !== null) { const t = ms(a.t); for (const ch of chans) n += C.delAt(c, ch, t); }
      else { const t0 = ms(a.from, 0), t1 = ms(a.to, Math.round(H.dur)); for (const ch of chans) { const L = c.tracks[ch], m = L.length; c.tracks[ch] = L.filter(k => k.t < t0 || k.t > t1); n += m - c.tracks[ch].length; } }
      return n ? ok(`${n} clé${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''} sur ${c.name}.`) : ko(`Aucune clé à supprimer sur ${c.name} à cet endroit.`);
    },
    set_ease(a) { const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil'); if (!C.EASES[a.ease]) return ko(`Interpolation « ${a.ease} » inconnue.`); const t = ms(a.t), chans = Array.isArray(a.params) && a.params.length ? a.params.map(p => FX[p] || p).filter(p => c.tracks[p]) : [null]; if (!C.hasKey(c, null, t)) return ko(`${c.name} n’a pas de clé à ${fmtT(t)}.`); for (const ch of chans) C.easeAt(c, ch, t, a.ease); return ok(`${c.name} : interpolation « ${a.ease} » à ${fmtT(t)}.`); },
    move_keys(a) {
      const c = camOf(a.camera); if (!c) return noCam(a.camera, 'cet outil'); const sh = Math.round((num(a.shift) ?? 0) * 1000); if (!sh) return ko('move_keys : décalage nul.');
      const t0 = ms(a.from, 0), t1 = ms(a.to, Math.round(H.dur)); let n = 0;
      for (const ch of Object.keys(c.tracks)) { for (const k of c.tracks[ch]) if (k.t >= t0 && k.t <= t1) { k.t = clamp(k.t + sh, 0, Math.round(H.dur)); n++; } C.sortTrack(c.tracks[ch], ch); c.tracks[ch] = c.tracks[ch].filter((k, j, L) => !j || k.t - L[j - 1].t > 0); }
      return n ? ok(`${n} clé${n > 1 ? 's' : ''} de ${c.name} décalée${n > 1 ? 's' : ''} de ${r2(sh / 1000)} s.`) : ko('Aucune clé dans cet intervalle.');
    },
    frame_shot(a) {
      // (paramètre manquant ou approximatif : une valeur par défaut sensée, dite dans le résultat — jamais d'échec pour ça)
      const dflt = [], e = a.subject == null || a.subject === '' ? (dflt.push('subject → le joueur'), H.entities().find(x => x.me) || H.entities().find(x => x.kind !== 'objet')) : ent(a.subject);
      if (!e) return ko(`frame_shot : sujet « ${a.subject} » introuvable (donne « subject » : un id, un nom de list_entities, ou "joueur").`);
      if (!a.camera) return ko('frame_shot : il manque « camera » (le nom du plan, ex. « Plan large d’ouverture »).');
      const t = ms(a.t, Math.round(H.T)); if (num(a.t) === null) dflt.push(`t → ${fmtT(t)} (instant courant)`);
      const shot = pickKey(SHOTS, a.shot, SHOT_SYN) || (dflt.push(`shot ${a.shot == null ? 'manquant' : `« ${a.shot} » inconnu`} → moyen (valeurs : ${Object.keys(SHOTS).join(', ')})`), 'moyen');
      const side = pickKey(SIDES, a.side, SIDE_SYN) || (a.side != null && dflt.push(`side « ${a.side} » inconnu → trois_quarts_droit`), 'trois_quarts_droit');
      const height = pickKey(HEIGHTS, a.height, HEIGHT_SYN) || (a.height != null && dflt.push(`height « ${a.height} » inconnu → yeux`), 'yeux');
      a = { ...a, shot, side, height, thirds: { gauche: 'gauche', left: 'gauche', droite: 'droite', right: 'droite' }[nrm(a.thirds)] || 'centre' };
      const R = shotPose(e, t, a); if (!R) return ko(`${e.name} n’est pas là à ${fmtT(t)} (get_entity donne sa présence).`);
      const { c, made } = ensureCam(a.camera, t, R.pose);
      if (!made) writePose(c, t, c.look && c.parent ? { x: R.pose.x, y: R.pose.y, z: R.pose.z, fov: R.pose.fov, roll: 0 } : R.pose, false, C.EASES[a.ease] ? a.ease : null); else if (C.EASES[a.ease]) C.easeAt(c, null, t, a.ease);
      return ok(`${made ? `Caméra « ${c.name} » créée : ` : `${c.name} : `}${R.name} sur ${e.name} à ${fmtT(t)} (${a.side}, ${a.height}, à ${r1(R.d)} m, focale ${Math.round(R.pose.fov)}°)${R.wall ? ' — rapprochée : un mur gênait' : ''}${dflt.length ? ` — par défaut : ${dflt.join(' ; ')}` : ''}.`, { camera: c.name, creee: made, sujet: e.name, plan: shot, ...(dflt.length ? { valeurs_par_defaut: dflt } : {}), pose_monde: { x: r2(R.pose.x), y: r2(R.pose.y), z: r2(R.pose.z), yaw: r1(R.pose.yaw * R2D), pitch: r1(R.pose.pitch * R2D), fov: r1(R.pose.fov) }, distance: r1(R.d), ...(R.wall ? { mur: true } : {}) });
    },
    orbit_shot(a) {
      const e = a.subject == null || a.subject === '' ? H.entities().find(x => x.me) : ent(a.subject); if (!e || e.kind === 'objet') return ko(`orbit_shot : sujet « ${a.subject} » introuvable (donne « subject » : un personnage ou un véhicule, ou "joueur").`);
      if (!a.camera) return ko('orbit_shot : il manque « camera » (le nom du plan).');
      const t0 = ms(a.from, Math.round(H.T)); let t1 = ms(a.to, Math.min(Math.round(H.dur), t0 + 4000)); if (t1 - t0 < MIN_SHOT * 1000) t1 = Math.min(Math.round(H.dur), t0 + 3000); if (t1 - t0 < 300) return ko('orbit_shot : « to » doit être après « from » (en secondes).');
      a = { ...a, side: pickKey(SIDES, a.side, SIDE_SYN) || 'face' };
      const p0 = pos(e, t0); if (!p0) return ko(`${e.name} n’est pas là à ${fmtT(t0)}.`);
      const deg = num(a.degrees) ?? 120, d = clamp(num(a.distance) ?? 4, 0.6, 80), hy = (num(a.height) ?? 1.6) - C.ORIGIN_Y[e.kind === 'vehicule' ? 'vehicule' : 'perso'], fov = clamp(num(a.fov) ?? 45, 8, 120);
      const a0 = p0.yaw + (SIDES[a.side] ?? 0) * D2R, n = Math.max(2, Math.ceil(Math.abs(deg) / 30)), ease = C.EASES[a.ease] ? a.ease : 'fluide';
      let c = camOf(a.camera); const made = !c; if (!c) { c = C.newCam(H.cams); c.name = String(a.camera || c.name).slice(0, 40); H.cams.push(c); }
      for (const ch of ['x', 'y', 'z', 'yaw', 'pitch']) c.tracks[ch] = c.tracks[ch].filter(k => k.t < t0 || k.t > t1);
      c.parent = { kind: e.kind === 'vehicule' ? 'vehicule' : 'perso', id: e.id, name: e.name }; c.follow = false; c.look = true;
      for (let i = 0; i <= n; i++) { const t = Math.round(t0 + (t1 - t0) * i / n), an = a0 + deg * D2R * i / n; C.setKey(c, 'x', t, Math.cos(an) * d, ease); C.setKey(c, 'y', t, hy, ease); C.setKey(c, 'z', t, Math.sin(an) * d, ease); }
      for (const t of [t0, t1]) { C.setKey(c, 'fov', t, fov); for (const ch of ['yaw', 'pitch', 'roll']) if (!c.tracks[ch].length) C.setKey(c, ch, t, 0); }
      return ok(`${made ? `Caméra « ${c.name} » créée : ` : `${c.name} : `}travelling circulaire de ${Math.round(deg)}° autour de ${e.name}, de ${fmtT(t0)} à ${fmtT(t1)} (à ${r1(d)} m, attachée à lui, elle le regarde).`, { camera: c.name, creee: made, cles: n + 1 });
    },
    seek(a) { const t = ms(a.t); if (t === null) return ko('seek : instant manquant.'); H.seek(t); return ok(`Tête de lecture à ${fmtT(t)}.`); },
    set_playback(a) { const did = []; if (num(a.rate) !== null) { H.setRate(clamp(num(a.rate), 0.05, 8)); did.push(`vitesse ${clamp(num(a.rate), 0.05, 8)}×`); } if (typeof a.playing === 'boolean') { H.play(a.playing); did.push(a.playing ? 'lecture' : 'pause'); } return did.length ? ok(`Lecture : ${did.join(', ')}.`) : ko('set_playback : rien à faire.'); },
    set_view(a) { if (a.mode === 'camera') { const c = camOf(a.camera) || H.cams[0]; if (!c) return ko('Aucune caméra à regarder.'); H.view('cam', c.id); return ok(`Vue à travers ${c.name}.`); } H.view(a.mode === 'joueur' ? 'pov' : 'free'); return ok(a.mode === 'joueur' ? 'Vue par les yeux du joueur.' : 'Vue libre.'); },
    appearance_options(a) { const e = ent(a.entity); if (!e || (e.kind !== 'joueur' && e.kind !== 'pnj')) return ko(`« ${a.entity} » : ce n’est pas un personnage.`); const o = H.lookOptions(e.id, a.attribute || null); return o ? ok(`Options d’apparence de ${e.name}.`, o) : ko('Options d’apparence indisponibles.'); },
    set_appearance(a) {
      const e = ent(a.entity); if (!e || (e.kind !== 'joueur' && e.kind !== 'pnj')) return ko(`« ${a.entity} » : ce n’est pas un personnage.`);
      const patch = {}; if (a.look && typeof a.look === 'object') patch.look = Object.fromEntries(Object.entries(a.look).map(([k, v]) => [k, Math.round(+v)])); if (a.skins && typeof a.skins === 'object') patch.skins = a.skins; if ('hold' in a) patch.hold = a.hold; if ('bag' in a) patch.bag = a.bag;
      const r = H.setLook(e.id, patch);
      return r.done.length ? ok(`Apparence de ${e.name} : ${r.done.join(', ')}${r.refused.length ? ` — refusé : ${r.refused.join(' ; ')}` : ''}.`, { fait: r.done, refuse: r.refused }) : ko(`Apparence de ${e.name} inchangée${r.refused.length ? ` : ${r.refused.join(' ; ')}` : ''}.`);
    },
    reset_appearance(a) { const e = ent(a.entity); if (!e) return ko(`« ${a.entity} » : entité introuvable.`); H.resetLook(e.id); return ok(`${e.name} a retrouvé son apparence d’origine.`); },
    set_visibility(a) { const e = ent(a.entity); if (!e) return ko(`« ${a.entity} » : entité introuvable.`); H.setHidden(e.key, a.visible === false); return ok(`${e.name} ${a.visible === false ? 'masqué' : 'visible'}.`); },
    preview_cinematic() { return H.preview() ? ok('Prévisualisation lancée dans la vue.') : ko('Pas de cinématique à prévisualiser : il faut au moins une caméra active avec deux clés.'); },
    export_video() { return H.exportVideo() ? ok('Page « Exporter » ouverte : l’utilisateur choisit le format (WebM, MP4, AVI, GIF), la compression, le nom, le début et la fin.') : ko(H.C?.cineRange && !H.C.cineRange(H.cams) ? 'Pas d’export : il n’y a pas encore de cinématique (aucune caméra active avec au moins deux images-clés). Crée d’abord les plans, puis propose l’export.' : 'Export impossible pour le moment (un export est déjà en cours).'); },
  };
  /** Ce qui cloche dans un montage (plans trop courts, caméras jamais à l'antenne, début ou fin non couverts) : des phrases pour l'assistant */
  function problems(plans, R, old = null) {
    const out = [], dur = H.dur / 1000;
    for (const p of plans) if (p.duree < MIN_SHOT) out.push(`plan « ${p.camera} » trop court (${p.duree} s, de ${p.debut} à ${p.fin} s) : allonge-le à ${MIN_SHOT} s au moins (move_keys / set_keys) ou supprime sa caméra (delete_camera)`);
    const air = new Set(plans.map(p => p.camera));
    for (const x of EXT) { try { out.push(...(x.run.problems?.(old) || [])); } catch (e) { console.warn('extension : problèmes', e); } }
    for (const c of H.cams) if (c.on && !air.has(c.name) && !old?.has(c.id)) out.push(C.keyTimes(c, C.CH).length < 2 ? `caméra « ${c.name} » : une seule clé, elle n’a pas de durée — ajoute sa clé de fin (frame_shot ou set_keys à un autre instant) ou supprime-la` : `caméra « ${c.name} » jamais à l’antenne (recouverte par une autre) : décale ses clés ou supprime-la`);
    return out;
  }
  function applyImage(c, a) {
    const did = [];
    if (typeof a.filter === 'string' && a.filter in C.FILTERS) { c.filter = a.filter; did.push(`filtre ${a.filter ? C.FILTERS[a.filter] : 'retiré'}`); }
    if (typeof a.shadow === 'boolean') { c.shadow = a.shadow; did.push(a.shadow ? 'ombres activées' : 'ombres coupées'); }
    for (const [name, f] of Object.entries(RT_FINE)) { const q = num(a[name]); if (q !== null) { c[f] = clamp(q, 0, 200) / 100; did.push(`${name} ${Math.round(c[f] * 100)}`); } }
    for (const [name, ch] of Object.entries(FX)) { const q = num(a[name]); if (q === null) continue; const v = clamp(q, 0, ch === 'rt' ? rtMax() : 100) / 100; if (ch === 'rt' && q > rtMax()) did.push(`raytracing limité à ${rtMax()} (au-delà : compte VIP)`); if (c.tracks[ch].length === 1) c.tracks[ch][0].v = v; else if (c.tracks[ch].length > 1) { did.push(`${name} : déjà animé (utilise set_keys)`); continue; } c[ch] = v; did.push(`${name} ${Math.round(v * 100)}`); }
    return did;
  }
  const sideAngle = v => { const k = pickKey(SIDES, v, SIDE_SYN); return k ? SIDES[k] * D2R : null; };
  const EXT = (H.ext || []).map(x => { try { return { def: x, run: x.create?.(H, { ok, ko, ms, ent, camOf, noCam, writePose, fmtT, headY, sideAngle }) || {} }; } catch (e) { console.warn('extension de l’assistant', e); return null; } }).filter(Boolean);
  for (const x of EXT) Object.assign(RUN, x.run.RUN || {});
  const ALL = [...TOOLS, ...EXT.flatMap(x => x.def.tools || [])], byName = new Map(ALL.map(t => [t.name, t]));
  // Familles d'outils (cf. TOOL_GROUPS) : seules les familles utiles à la demande partent au modèle — moins de jetons, moins de
  // confusion. « active » : les familles ouvertes dans cette conversation (demande, outil déjà appelé, list_tool_groups).
  const active = new Set(), groupOf = name => byName.get(name)?.group || GROUP_OF[name] || null;
  RUN.list_tool_groups = a => {
    const want = (Array.isArray(a.enable) ? a.enable : a.enable ? [a.enable] : []).map(g => nrm(g).replace(/ /g, '_')).filter(g => g.length >= 3), opened = [];
    for (const g of Object.keys(TOOL_GROUPS)) if (want.some(w => w === g || w === 'tout' || w === 'toutes' || g.startsWith(w) || w.startsWith(g))) { active.add(g); opened.push(g); }
    return ok(opened.length ? `Familles d’outils ouvertes : ${opened.join(', ')} — leurs outils sont disponibles dès maintenant.` : 'Familles d’outils à la demande (enable: ["nom"] pour en ouvrir).', { familles: Object.entries(TOOL_GROUPS).map(([id, g]) => ({ id, pour: g.label, ouverte: active.has(id), outils: ALL.filter(t => groupOf(t.name) === id).map(t => t.name) })).filter(g => g.outils.length) });
  };
  const META = T('list_tool_groups', 'Les familles d’outils à la demande (animation d’objets et de PNJ, lumières, titres et effets, monde et météo, export, apparence) : liste, et ouverture avec enable. À appeler dès que la demande sort des caméras et qu’un outil nécessaire n’est pas dans ta liste.', P({ enable: { type: 'array', items: { type: 'string' }, description: 'Familles à ouvrir (ex. ["animation", "lumieres"]) ; "tout" pour toutes.' } }));
  byName.set(META.name, META);
  return {
    tools: toolSchemas(ALL), ext: EXT.map(x => x.run), active,
    /** Ouvre les familles que la conversation réclame : mots de la demande, outils déjà appelés, familles déjà ouvertes */
    open(history) {
      for (const m of history) {
        if (m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[')) { const s = nrm(m.content.split('\n\n[État du Studio]')[0]); for (const [g, G] of Object.entries(TOOL_GROUPS)) if (G.when.test(s)) active.add(g); }
        for (const c of m.tool_calls || []) { const g = groupOf(c.function?.name); if (g) active.add(g); if (c.function?.name === 'list_tool_groups') { try { RUN.list_tool_groups(JSON.parse(c.function.arguments || '{}')); } catch { /* arguments illisibles */ } } }
      }
    },
    /** Les outils envoyés au modèle à cet instant : les caméras et la géométrie toujours, les familles ouvertes, et list_tool_groups s'il en reste de fermées */
    toolsNow() { const L = ALL.filter(t => !groupOf(t.name) || active.has(groupOf(t.name))); return toolSchemas(L.length < ALL.length ? [...L, META] : L); },
    /** Le prompt système à cet instant : celui des extensions dont au moins un outil est disponible, et le rappel des familles fermées */
    promptNow() {
      const on = x => !(x.def.tools || []).length || x.def.tools.some(t => !groupOf(t.name) || active.has(groupOf(t.name)));
      const shut = Object.entries(TOOL_GROUPS).filter(([g]) => !active.has(g) && ALL.some(t => groupOf(t.name) === g)).map(([g, G]) => `${g} (${G.label})`);
      return SYSTEM_PROMPT + EXT.filter(on).map(x => x.def.prompt || '').join('') + (shut.length ? `\n\n# Outils à la demande\nD'autres familles d'outils existent mais ne sont pas chargées : ${shut.join(' ; ')}. Si la demande en a besoin, appelle d'abord list_tool_groups avec enable (ex. { "enable": ["animation"] }) : leurs outils apparaissent aussitôt. N'invente jamais un nom d'outil.` : '');
    },
    isMutating: name => !!byName.get(name)?.mut,
    /** Exécute un outil : { ok, text (« ✓ … » ou « ✗ … », montré dans le fil), data } — jamais d'exception */
    exec(name, args) {
      const fn = RUN[name]; if (!fn) return ko(`Outil « ${name} » inconnu.`);
      let a = args; if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {}; } catch { return ko(`${name} : arguments illisibles (JSON invalide).`); } }
      try { a = a && typeof a === 'object' ? a : {};
        // (« entity », « element » et « character » désignent la même chose : le modèle les confond d'un outil à l'autre — tous acceptés partout)
        { const who = a.entity ?? a.element ?? a.character; if (who != null && who !== '') { a = { ...a }; a.entity ??= who; a.element ??= who; a.character ??= who; } }
        if (groupOf(name)) active.add(groupOf(name)); let r = fn(a); if (r.ok) for (const x of EXT) if (x.run.after) { try { r = x.run.after(name, a, r) || r; } catch (e) { console.warn('extension : après', name, e); } } if (r.ok && byName.get(name)?.mut) H.changed(); return r; } catch (e) { return ko(`${name} : erreur (${String(e?.message || e).slice(0, 160)}).`); }
    },
    /**
     * Un lot d'appels du modèle, dans l'ordre. Un appel qui vise une caméra pas encore créée (le modèle règle parfois un plan avant de
     * le créer dans le même lot) est rejoué une fois après les autres. calls : [{ name, args }] → [{ ok, text, data, name }] dans l'ordre d'origine.
     */
    batch(calls) {
      const out = calls.map(c => ({ ...this.exec(c.name, c.args), name: c.name }));
      out.forEach((r, i) => { if (!r.ok && r.retry) { const again = this.exec(calls[i].name, calls[i].args); if (again.ok) out[i] = { ...again, name: calls[i].name, text: `${again.text} (rejoué après la création de la caméra)` }; } });
      return out;
    },
    /** Le montage réel, en une phrase, et ses problèmes : { text, plans, problems } */
    recap(old = null) { const d = RUN.cinematic_summary(old).data, more = d.plans?.length ? EXT.map(x => { try { return x.run.recapText?.() || ''; } catch { return ''; } }).filter(Boolean) : [];
      return { plans: d.plans || [], problems: d.problemes || [], text: d.plans?.length ? `Montage réel : ${d.plans.length} plan${d.plans.length > 1 ? 's' : ''}, ${d.duree} s — ${d.plans.map(p => `« ${p.camera} » ${p.debut}→${p.fin} s`).join(' · ')}.${more.length ? `\n${more.join('\n')}` : ''}` : '' }; },
  };
}

// ---------------------------------------------------------------- Un tour de conversation
/** L'état du Studio joint à chaque message de l'utilisateur : de quoi agir sans poser de question */
export function digest(H) {
  const eng = createEngine({ ...H, changed() {} }), I = H.info(), L = eng.exec('list_entities', { limit: 30 }).data, C0 = eng.exec('list_cameras', {}).data;
  return JSON.stringify({ lieu: I.lieu, interieur: I.interieur, duree_s: r2(H.dur / 1000), heure_du_jeu: I.heure, nuit: I.nuit, instant_courant_s: r2(H.T / 1000), joueur: I.joueur, format_image: r2(H.aspect()), entites_proches: L.entites, autres_entites: Math.max(0, L.total - L.entites.length), cameras: C0.cameras, compte: I.compte, ...Object.assign({}, ...eng.ext.map(x => { try { const d = x.digest?.(); return d ? { fiche_du_lieu: d } : {}; } catch { return {}; } })) });
}
/** Actions écrites dans le texte (modèle sans appel d'outils natif) : [{ name, args }] ou null */
export function parseTextActions(text) {
  const s = String(text || ''), i = s.indexOf('{'), j = s.lastIndexOf('}'); if (i < 0 || j <= i) return null;
  let o; try { o = JSON.parse(s.slice(i, j + 1)); } catch { return null; }
  const L = Array.isArray(o.actions) ? o.actions : Array.isArray(o.tool_calls) ? o.tool_calls : null; if (!L) return null;
  const calls = L.map(x => ({ name: x.outil || x.tool || x.name || x.function?.name, args: x.arguments ?? x.args ?? x.function?.arguments ?? {} })).filter(x => typeof x.name === 'string');
  return { calls, message: typeof o.message === 'string' ? o.message : '' };
}
/**
 * Un tour : le message de l'utilisateur part au modèle avec l'historique ; tant que le modèle appelle des outils, ils sont exécutés
 * et leurs résultats lui sont rendus (au plus maxRounds allers-retours). ask({ messages, tools }) → { message } | { error } : le
 * relais du site — ou un faux modèle (essais). on(event) : { type: 'action', ok, text } | { type: 'say', text } au fil de l'eau.
 * history : messages au format OpenAI déjà échangés (sans le prompt système) ; il est complété sur place.
 * Rend { text, actions: [{ ok, text, name }], changed (le projet a été modifié), error }.
 */
/**
 * Ce que le Studio a REFUSÉ pendant ce tour et qui n'a pas été rattrapé (aucun appel réussi du même outil ensuite) : écrit sous la
 * réponse par le moteur — le modèle ne peut pas laisser croire qu'une action refusée a été faite. actions : [{ ok, name, text }].
 */
export function refusedText(actions) {
  const left = actions.filter((a, i) => !a.ok && !actions.slice(i + 1).some(b => b.ok && b.name === a.name)), seen = new Set(), L = [];
  for (const a of left) { const t = `${a.name} — ${String(a.text).replace(/^✗\s*/, '').slice(0, 220)}`; if (!seen.has(t)) { seen.add(t); L.push(t); } }
  return L.length ? `\n\n⚠ ${L.length > 1 ? `${L.length} actions ont été refusées par le Studio et n’ont PAS été faites` : 'Une action a été refusée par le Studio et n’a PAS été faite'} :\n${L.slice(0, 6).map(t => `• ${t}`).join('\n')}${L.length > 6 ? `\n• … et ${L.length - 6} autre${L.length > 7 ? 's' : ''}` : ''}` : '';
}
export async function runTurn(H, history, userText, ask, on = () => {}, maxRounds = 14, wait = ms => new Promise(r => setTimeout(r, ms))) {
  const eng = createEngine(H), actions = [], old = new Set(H.cams.map(c => c.id)); let changed = false, text = '', error = null, checked = 0;
  history.push({ role: 'user', content: `${userText}\n\n[État du Studio] ${digest(H)}` });
  eng.open(history);
  const run = calls => { const R = eng.batch(calls); R.forEach(r => { if (r.ok && eng.isMutating(r.name)) changed = true; const a = { ok: r.ok, text: r.text, name: r.name }; actions.push(a); on({ type: 'action', ...a }); }); return R; };
  for (let round = 0; round < maxRounds; round++) {
    // (contexte borné : le prompt, puis les échanges les plus récents — un échange d'outils n'est jamais coupé en deux)
    let from = Math.max(0, history.length - 60); while (from > 0 && history[from].role !== 'user') from--;
    // (site occupé — 429, « Doucement », « Trop de requêtes » — : on attend et on réessaie, jusqu'à trois fois)
    let res;
    for (let tries = 0; ; tries++) {
      try { res = await ask({ messages: [{ role: 'system', content: eng.promptNow() }, ...history.slice(from)], tools: eng.toolsNow() }); } catch (e) { res = { error: String(e?.message || e) }; }
      const busy = res && !res.message && (res.status === 429 || /doucement|trop de requ|rate.?limit|déjà en cours/i.test(String(res.error || '')));
      if (!busy || tries >= 3) break;
      on({ type: 'wait', text: `Le site est occupé : nouvel essai dans ${[1.5, 3, 6][tries]} s…` }); await wait([1500, 3000, 6000][tries]);
    }
    if (!res || res.error || !res.message) { error = { text: res?.error || 'L’assistant n’a pas répondu.', vip: res?.vip, login: res?.login }; break; }
    // (au plus 30 appels d'outils par réponse : le site en refuse plus de 32 dans un message — « Appels d’outils invalides » —, la conversation était perdue ; le modèle voit ses 30 résultats et continue)
    const m = res.message, calls = Array.isArray(m.tool_calls) ? m.tool_calls.filter(c => c?.function?.name).slice(0, 30) : [];
    if (calls.length) {
      history.push({ role: 'assistant', content: m.content || '', tool_calls: calls });
      if (m.content) { text = m.content; on({ type: 'say', text: m.content }); }
      run(calls.map(c => ({ name: c.function.name, args: c.function.arguments }))).forEach((r, i) => history.push({ role: 'tool', tool_call_id: calls[i].id || `call_${actions.length}_${i}`, content: JSON.stringify({ ok: r.ok, message: r.text, ...r.data }).slice(0, 14000) }));
      continue;
    }
    const alt = parseTextActions(m.content);
    if (alt?.calls.length) {
      history.push({ role: 'assistant', content: m.content });
      if (alt.message) { text = alt.message; on({ type: 'say', text: alt.message }); }
      const out = run(alt.calls).map(r => ({ outil: r.name, ok: r.ok, message: r.text, ...r.data }));
      history.push({ role: 'user', content: `[Résultats des outils] ${JSON.stringify(out).slice(0, 20000)}\nContinue (d'autres actions en JSON), ou conclus par une réponse en clair sans JSON.` });
      continue;
    }
    text = String(m.content || '').trim() || (actions.length ? 'C’est fait.' : '…');
    // (avant d'accepter la conclusion : le montage réel est contrôlé ; s'il a des défauts, l'assistant doit les corriger — deux fois au plus)
    const rc = changed ? eng.recap(old) : null;
    if (rc?.problems.length && checked < 2 && round < maxRounds - 1) {
      checked++; history.push({ role: 'assistant', content: text });
      history.push({ role: 'user', content: `[Vérification automatique du Studio] Le montage a encore ${rc.problems.length} problème(s) :\n- ${rc.problems.join('\n- ')}\n${rc.text}\nCorrige-les avec les outils, appelle cinematic_summary, puis donne ton résumé final — il doit correspondre exactement à la liste des plans.` });
      on({ type: 'check', text: `Vérification du montage : ${rc.problems.length} défaut${rc.problems.length > 1 ? 's' : ''} à corriger…` });
      continue;
    }
    // (le résumé du modèle est suivi du montage réel : ce que l'utilisateur lit correspond toujours à ce qui existe)
    if (rc?.text) text += `\n\n${rc.text}${rc.problems.length ? `\n⚠ ${rc.problems.join('\n⚠ ')}` : ''}`;
    text += refusedText(actions);
    history.push({ role: 'assistant', content: text }); on({ type: 'say', text, final: true });
    return { text, actions, changed, error: null, recap: rc };
  }
  if (!error) { const rc = changed ? eng.recap(old) : null; text = `${text || 'J’ai fait une première série d’actions ; dis-moi si je continue.'}${rc?.text ? `\n\n${rc.text}` : ''}${refusedText(actions)}`; history.push({ role: 'assistant', content: text }); }
  return { text, actions, changed, error };
}

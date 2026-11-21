// Big Street Studio — les outils de l'assistant IA pour l'animation façon Mine-Imator (21/11) : une extension du moteur d'actions
// (ai-tools.js, cf. son en-tête « EXTENSIONS »). L'assistant peut ajouter des objets (modèles du jeu), des PNJ et de faux joueurs,
// des lumières, des miroirs, des textes ; animer par images-clés n'importe quel élément — y compris une entité DU record (un meuble
// qui tombe, une voiture déplacée) — ; poser un personnage os par os ou avec la bibliothèque de poses, lancer une animation du jeu ;
// régler et animer l'éclairage du lieu (luminosité générale, ambiance, soleil, lampes une par une).
// Ce module n'importe rien : il parle à l'hôte (H.anim = l'interface d'anim.js, qui porte le modèle objets.js sous H.anim.O).
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const r2 = v => Math.round(v * 100) / 100;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nrm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const S = (description, extra = {}) => ({ type: 'string', description, ...extra }), N = description => ({ type: 'number', description }), B = description => ({ type: 'boolean', description });
const P = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const T = (name, description, parameters, mut = false) => ({ name, description, parameters, mut });
const EL = S('Élément : le nom d’un élément ajouté (objet, PNJ, lumière, miroir, texte…) OU une entité du record (id, nom, "joueur") — un objet du décor s’écrit "i:<id>".');
const TS = N('Instant en secondes depuis le début du record.');
const EASE = S('Courbe vers la clé suivante.', { enum: ['fluide', 'lineaire', 'doux', 'accel', 'frein', 'rebond', 'elastique', 'depasse', 'fixe'] });
const PLACE = { x: N('X (m). Sans x/y/z : devant la vue actuelle.'), y: N('Y, hauteur (m) : le sol du lieu est en général à 0.'), z: N('Z (m)'), cap: N('Cap (°), même convention que les entités : vers où il regarde.'), near: S('Le poser près de cette entité du record (à 1,2 m sur son côté) au lieu de donner x/y/z.'), at: S('Le poser À un endroit nommé au lieu de donner x/y/z : le nom d’une pièce du lieu (describe_place : « cuisine », « salle »… → son centre) ou d’une entité (→ sa place). Une lumière y est mise sous le plafond.') };
const KEY = { t: TS, x: N('X (m)'), y: N('Y, hauteur (m)'), z: N('Z (m)'), cap: N('Cap (°)'), pitch: N('Tangage (°) : bascule vers l’avant / l’arrière'), roll: N('Roulis (°) : bascule sur le côté'), scale: N('Taille uniforme (1 = normale)'), sx: N('Taille X'), sy: N('Taille Y'), sz: N('Taille Z'),
  visible: B('Visible à partir de cet instant (false : il disparaît).'), intensity: N('Lumière : intensité'), range: N('Lumière : portée (m)'), angle: N('Projecteur : angle du cône (°)'), color: S('Lumière : couleur #rrggbb'), ease: EASE };
const BONES = ['tete', 'corps', 'bras_d', 'bras_g', 'jambe_d', 'jambe_g'];

export const ANIM_TOOLS = [
  T('list_elements', 'Les éléments ajoutés ou animés du projet (objets, PNJ et faux joueurs ajoutés, lumières, miroirs, textes, groupes, entités du record animées) : type, position, visibilité, parent, clés ; et l’état de l’éclairage du lieu.', P({})),
  T('find_models', 'Trouve des modèles du catalogue par mots-clés et/ou famille : rend les noms EXACTS (« model ») à passer à add_object. À appeler avant add_object : n’invente jamais un nom de modèle.', P({ query: S('Mots-clés (ex. "chaise bureau", "voiture rouge", "lampadaire").'), category: S('Famille.', { enum: ['Mobilier et décor', 'Bâtiments', 'Véhicules', 'Objets'] }), limit: N('Nombre maximal (défaut 25).') })),
  T('search_models', 'Cherche dans le catalogue des modèles du jeu (meubles, décor, véhicules, objets, bâtiments) : rend les « model » à passer à add_object.', P({ search: S('Mots cherchés (ex. "chaise", "voiture", "lampadaire").'), limit: N('Nombre maximal (défaut 25).') }, ['search'])),
  T('add_object', 'Ajoute un modèle du jeu dans la scène (voir search_models). Il s’anime ensuite avec animate_element.', P({ model: S('Type du modèle (clé du catalogue).'), name: S('Nom de l’élément.'), ...PLACE, scale: N('Taille (1 = normale).'), parent: S('Nom d’un élément parent (il le suivra).') }, ['model']), true),
  T('add_character', 'Ajoute un personnage : un PNJ, ou un faux joueur (il prend l’apparence du joueur enregistré). Il devient une entité de la scène : set_appearance change sa tenue (skins du compte), frame_shot le cadre, une caméra peut le suivre. Animé par animate_element (il marche tout seul quand ses clés le déplacent), set_pose et play_emote.', P({ kind: S('pnj ou joueur.', { enum: ['pnj', 'joueur'] }), name: S('Son nom (affiché au-dessus de lui).'), title: S('Titre d’un PNJ (ex. "Vendeur").'), ...PLACE }, ['name']), true),
  T('add_light', 'Ajoute une lumière : "point" (ampoule), "spot" (projecteur : cône, vers le bas par défaut — look_at pour le viser) ou "dir" (directionnelle, comme un soleil). Réserve fixe : 4 point, 3 spot, 1 dir. Animable (intensité, couleur, position) par animate_element.', P({ type: S('Type de lumière.', { enum: ['point', 'spot', 'dir'] }), name: S('Nom.'), ...PLACE, color: S('Couleur #rrggbb (défaut blanc chaud).'), intensity: N('Intensité (ampoule ≈ 6, projecteur ≈ 14, forte ≈ 40).'), range: N('Portée (m).'), angle: N('Projecteur : angle du cône (°), défaut 35.'), shadow: B('Projecteur : ombres portées.'), look_at: { type: 'object', description: 'Projecteur / directionnelle : point visé.', properties: { entity: S('Entité visée.'), x: N('X'), y: N('Y'), z: N('Z') }, additionalProperties: false } }, ['type']), true),
  T('add_mirror', 'Ajoute un miroir plan (reflet réel de la scène), posé au sol, face tournée vers « cap ». Deux miroirs au plus.', P({ name: S('Nom.'), ...PLACE, width: N('Largeur (m), défaut 2.'), height: N('Hauteur (m), défaut 2,4.'), tint: S('Teinte #rrggbb.'), quality: N('Qualité du reflet : 256, 512, 1024 ou 2048.') }), true),
  T('add_text', 'Ajoute un texte dans la scène (titre de film, panneau).', P({ text: S('Le texte (\\n pour aller à la ligne).'), name: S('Nom.'), ...PLACE, size: N('Hauteur d’une ligne (m), défaut 1.'), color: S('Couleur #rrggbb.'), face_camera: B('Toujours tourné vers la caméra.') }, ['text']), true),
  T('add_particles', 'Ajoute un émetteur de particules : fumee, feu, etincelles (gerbe depuis un point), pluie, neige, confettis (tombent sur une zone de « spread » mètres). Elles suivent la frise ; clés « visible » (animate_element) pour les déclencher.', P({ type: S('Type de particules.', { enum: ['fumee', 'feu', 'etincelles', 'pluie', 'neige', 'confettis'] }), name: S('Nom.'), ...PLACE, count: N('Nombre (10 à 1500, défaut 150).'), size: N('Taille des particules (× ; défaut 1).'), spread: N('Étendue (m).'), color: S('Couleur #rrggbb.') }, ['type']), true),
  T('animate_element', 'Pose des images-clés sur un élément ajouté OU sur une entité du record (un meuble, un véhicule, un personnage : ce qui est donné remplace alors le record — donner seulement « y » le fait tomber sans changer sa route). Chaque clé ne donne QUE les réglages à poser. Deux clés à deux instants = un mouvement. fixed: true = valeurs fixes sans clé (placer sans animer). Courbe "rebond" pour une chute.', P({ element: EL, keys: { type: 'array', description: 'Les clés.', items: P(KEY, ['t']) }, fixed: B('Valeurs fixes au lieu de clés (le « t » est ignoré).') }, ['element', 'keys']), true),
  T('make_fall', 'Fait tomber un élément ou une entité du record : il part de « height » mètres au-dessus de sa place à l’instant t et touche le sol après « duration » secondes, avec rebond et une rotation. Pratique pour « des objets qui tombent ».', P({ element: EL, t: TS, height: N('Hauteur de chute (m), défaut 4.'), duration: N('Durée (s), défaut 1,2.'), spin: N('Rotation pendant la chute (°), défaut 90.'), hide_before: B('Invisible avant le début de la chute (défaut true).') }, ['element', 't']), true),
  T('update_element', 'Change les réglages d’un élément : nom, parent (nom d’un autre élément, ou null), bone (os du personnage parent qui le tient : tete, corps, bras_d, bras_g, jambe_d, jambe_g), texte, ombre d’un projecteur, marche automatique d’un personnage ajouté.', P({ element: EL, name: S('Nouveau nom.'), parent: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Élément parent, ou null.' }, bone: S('Os du parent qui le tient ("" : aucun).'), text: S('Texte (élément texte).'), shadow: B('Ombres (projecteur).'), walk: B('Personnage ajouté : marche quand ses clés le déplacent.') }, ['element']), true),
  T('delete_element', 'Supprime un élément ajouté (ou retire toutes les animations d’une entité du record : elle redevient comme dans le record).', P({ element: EL }, ['element']), true),
  T('delete_element_keys', 'Supprime des clés d’un élément : à un instant (t) ou sur un intervalle (from → to).', P({ element: EL, t: TS, from: N('Début (s).'), to: N('Fin (s).') }, ['element']), true),
  T('list_poses', 'La bibliothèque de poses des personnages (noms à passer à set_pose) et les animations du jeu (pour play_emote).', P({})),
  T('set_pose', 'Pose un personnage (ajouté ou du record) à l’instant t : une pose de la bibliothèque (pose) et/ou des os précis (bones : { os: [x, y, z] } en degrés ; os : tete, corps, bras_d, bras_g, jambe_d, jambe_g ; bras : x négatif = levé devant, z = écarté). Deux poses à deux instants : il passe de l’une à l’autre. fixed : pose tenue tout le temps. clear : retire toute pose (il retrouve ses mouvements du jeu).', P({ character: EL, t: TS, pose: S('Nom d’une pose (list_poses).'), bones: { type: 'object', description: 'Rotations d’os en degrés.', additionalProperties: { type: 'array', items: { type: 'number' } } }, ease: EASE, fixed: B('Sans clé.'), clear: B('Retirer la pose.') }, ['character']), true),
  T('play_emote', 'Lance une animation du jeu (émote : applaudir, danser…) sur un personnage à l’instant t ; emote: null = l’arrêter à cet instant.', P({ character: EL, t: TS, emote: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Identifiant de l’animation (list_poses), ou null.' } }, ['character', 't']), true),
  T('list_scene_lights', 'Les lumières DÉJÀ présentes dans le lieu rejoué (plafonniers, lampes) : clé, position, intensité, couleur, éteinte ou non ; et les réglages généraux (luminosité, ambiance, soleil, lampes).', P({ near: S('Une PIÈCE du lieu par son nom (« cuisine » : toute la pièce) ou une entité (rayon autour d’elle).'), radius: N('Rayon (m) autour d’une entité (défaut 8).') })),
  T('set_scene_lighting', 'Règle l’éclairage général du lieu (1 = comme dans le record, 0 = éteint) : brightness (luminosité de toute la scène), ambient (lumière ambiante), sun (la lumière principale : soleil, lune, ou l’éclairage de plafond d’un intérieur), lamps (les lampes ponctuelles : néons, lampadaires, lampes torches), color (teinte). Avec t : image-clé à cet instant (ex. la pièce s’assombrit entre 2 s et 5 s) ; sans t : valeur fixe. preset : "sombre", "tamise", "nuit_americaine", "noir", "plein_feu", "normal".', P({ t: TS, brightness: N('0 à 4.'), ambient: N('0 à 6.'), sun: N('0 à 6.'), lamps: N('0 à 8.'), color: S('Teinte #rrggbb.'), preset: S('Ambiance toute faite.', { enum: ['sombre', 'tamise', 'nuit_americaine', 'noir', 'plein_feu', 'normal'] }), ease: EASE }), true),
  T('add_title', 'Ajoute un titre ou un sous-titre À L’ÉCRAN (2D, par-dessus l’image, inclus dans la vidéo exportée) : visible de « from » à « to » secondes avec un fondu d’entrée et de sortie. position : "centre" (titre de film), "bas" (sous-titre), "haut", "bas_gauche" (générique). Pour un sous-titre de dialogue, cale from/to sur list_events.', P({ text: S('Le texte (\\n pour aller à la ligne).'), from: N('Apparition (s).'), to: N('Disparition (s) ; absent = jusqu’à la fin.'), position: S('Place à l’écran.', { enum: ['centre', 'bas', 'haut', 'bas_gauche'] }), size: N('Hauteur du texte en % de l’image (titre ≈ 9, sous-titre ≈ 4,5).'), color: S('Couleur #rrggbb.'), fade: N('Durée du fondu (s), défaut 0,3.'), box: B('Bandeau sombre derrière le texte.') }, ['text', 'from']), true),
  T('set_fade', 'Fondu au noir (ou éclair blanc) de l’image, par images-clés : black / white de 0 à 100 à l’instant t. Ouverture au noir : black 100 à 0 s puis black 0 à 1 s. Fermeture : black 0 puis black 100 à la fin. cut_fade : durée (s) d’un fondu au noir automatique à CHAQUE changement de plan (0 = coupes franches).', P({ t: TS, black: N('Noir 0–100.'), white: N('Blanc 0–100 (éclair, explosion).'), ease: EASE, cut_fade: N('Fondu automatique aux changements de plan (s).') }), true),
  T('apply_template', 'Applique un MODÈLE DE PROJET : un montage complet tout fait (caméras, fondu d’ouverture et de fermeture, titre) à retoucher ensuite. "trailer" : bande-annonce de 30 s au plus autour d’un sujet (plan large, tour, gros plan, suivi, envol, titre) ; "lieu" : présentation d’un lieu (vue d’ensemble, travelling, tour complet, plan bas, nom du lieu) ; "portrait" : portrait d’un personnage. Les caméras déjà là sont écartées (pas supprimées). Vérifie ensuite avec cinematic_summary.', P({ template: S('Modèle.', { enum: ['trailer', 'lieu', 'portrait'] }), subject: S('Le personnage sujet (défaut : le joueur enregistré).'), start: N('Instant de début (s), défaut 0.'), title: S('Texte du titre.') }, ['template']), true),
  T('set_speed', 'Ralenti / accéléré par segment : la vitesse du temps à l’instant t (1 = normal, 0,25 = ralenti, 2 = accéléré), par images-clés — ex. 1 à 4,8 s, 0,25 à 5 s, 0,25 à 6 s, 1 à 6,3 s pour un ralenti sur l’action. freeze : à l’instant t, l’image reste figée « freeze » secondes. reset : true = temps normal partout. (Une vidéo ralentie ou figée est exportée sans le son.)', P({ t: TS, speed: N('Vitesse 0,05 à 8.'), ease: EASE, freeze: N('Durée d’une image figée à t (s).'), reset: B('Tout remettre à la vitesse normale.') }), true),
  T('capture_image', 'Enregistre une image fixe PNG haute résolution de la cinématique à l’instant courant (affiche, miniature). Seulement si l’utilisateur le demande.', P({ resolution: S('Taille.', { enum: ['1080p', '1440p', '4k', '8k'] }) })),
  T('set_camera_shake', 'Tremblement de la caméra à l’antenne (caméra à l’épaule, choc, explosion) : intensity 0 à 100, frequency en Hz (2–3 : épaule ; 12–16 : choc). Avec t : image-clé (ex. 0 à 4,8 s, 80 à 5 s, 0 à 6 s pour un choc) ; sans t : valeur fixe.', P({ t: TS, intensity: N('0 à 100.'), frequency: N('Hz (défaut 8).'), ease: EASE }, ['intensity']), true),
  T('set_scene_light', 'Allume, éteint ou règle des lampes du lieu : une seule (light = sa clé, cf. list_scene_lights) ou toutes celles autour d’une entité ou d’un point (near + radius — « éteins les lumières de la cuisine » : near = une entité de la cuisine). intensity : multiple de l’intensité d’origine (0 = éteinte, 1 = inchangée). Avec t : image-clé.', P({ light: S('Clé de la lampe.'), near: S('Une PIÈCE du lieu par son nom (toutes ses lampes) ou une entité (rayon autour d’elle).'), x: N('X du centre'), z: N('Z du centre'), radius: N('Rayon (m), défaut 6.'), on: B('Allumée ou éteinte.'), intensity: N('× l’intensité d’origine (0 à 10).'), color: S('Teinte #rrggbb.'), t: TS, ease: EASE }), true),
];

export const ANIM_PROMPT = `

ANIMATION FAÇON MINE-IMATOR (éléments ajoutés et entités animées)
- Tu peux AJOUTER à la scène : des modèles du jeu (find_models puis add_object avec le « model » exact — n'invente pas de nom), des PNJ et de faux joueurs (add_character), des lumières (add_light), des miroirs (add_mirror), des textes (add_text), des particules (add_particles : fumée, feu, étincelles, pluie, neige, confettis). Et ANIMER par images-clés n'importe quel élément ou entité du record (animate_element) : position x/y/z, cap, pitch, roll, taille, visible.
- Une entité du record animée garde le record pour tout ce que tu ne donnes pas : une clé « y » seule la fait monter ou tomber sans changer sa route. Pour une chute : make_fall, ou deux clés « y » avec la courbe "rebond". Pour faire apparaître / disparaître : clés « visible ».
- Personnages : set_pose (bibliothèque : list_poses ; ou os par os en degrés) à plusieurs instants pour l'animer comme une marionnette ; play_emote pour les animations du jeu. Un personnage ajouté marche tout seul quand ses clés de position le déplacent. Sa tenue : set_appearance (comme les autres personnages).
- Éclairage : le lieu a déjà ses lumières. Un intérieur est éclairé surtout par sa lumière ambiante et sa lumière principale : pour « ambiance sombre », « éteins la lumière », utilise set_scene_lighting (brightness, ambient, sun) ; list_scene_lights ne liste que les lampes ponctuelles allumées (néons, lampadaires), souvent aucune en intérieur. set_scene_lighting règle la luminosité générale, l'ambiance, le soleil et les lampes (animables : « la lumière baisse ») ; set_scene_light allume / éteint les lampes d'une zone. add_light ajoute une lumière de cinéma (colorée, projecteur). On n'enlève jamais une lumière : on met son intensité à 0.
- set_camera_shake : tremblement de la caméra (à l'épaule, choc), animable. add_title : titres et sous-titres à l'écran. apply_template : un montage tout fait (trailer, lieu, portrait) quand l'utilisateur veut « une bande-annonce », « présenter le lieu » — puis ajuste. set_speed : ralenti, accéléré, image figée. set_fade : ouverture / fermeture au noir, éclair blanc, fondu automatique aux changements de plan.
- Le sol est en général à y = 0 ; 1 unité = 1 m. Pose les éléments près du sujet (near), dans une pièce ou sur une entité nommée (at : "cuisine", "comptoir"…), ou à des coordonnées lues dans list_entities. Un élément ajouté est aussi un sujet : frame_shot, orbit_shot et set_parent acceptent son nom. Vérifie avec list_elements.`;

const PRESETS = { sombre: { expo: 0.45, amb: 0.7, sun: 0.6, lamps: 1 }, tamise: { expo: 0.6, amb: 0.7, sun: 0.7, lamps: 1, cr: 1, cg: 0.86, cb: 0.7 }, nuit_americaine: { expo: 0.35, amb: 0.8, sun: 0.5, lamps: 1.3, cr: 0.62, cg: 0.74, cb: 1 }, noir: { expo: 0.04 }, plein_feu: { expo: 1.6, amb: 1.3 }, normal: {} };

/** L'extension du moteur d'actions : { tools, prompt, create(H, kit) → { RUN, digest() } } */
export function createAnimExt() {
  return { tools: ANIM_TOOLS, prompt: ANIM_PROMPT, create(H, kit) {
    const { ok, ko, ms, ent } = kit, AN = () => H.anim, NO = 'Les éléments animés ne sont pas disponibles (scène non chargée).';
    const tOf = (v, d = null) => ms(v, d ?? Math.round(H.T));
    /** L'élément désigné : un élément ajouté par son nom, sinon une entité du record (créée pour être animée si create) */
    function elem(q, create = true) {
      const A = AN(); if (!A || q == null || q === '') return null;
      const own = A.find(q); if (own) return own;
      const s = String(q), e = /^[uvi]:/.test(s) ? H.entities().find(x => x.key === s) : ent(q);
      return e ? A.entity(e.key, create) : null;
    }
    // (catalogue : le meilleur modèle pour un nom approché — mots communs avec le nom ou la clé du modèle)
    const words = v => nrm(v).split(' ').filter(w => w.length > 1);
    function rankModels(q, cat = null) {
      const A = AN(), all = A.searchCatalog('', 6000).filter(m => !cat || nrm(m.cat) === nrm(cat)), W = words(q); if (!W.length) return all;
      return all.map(m => { const hay = words(`${m.name} ${m.type}`), full = nrm(`${m.name} ${m.type}`); let sc = 0; for (const w of W) sc += hay.includes(w) ? 3 : hay.some(h => h.startsWith(w) || w.startsWith(h)) ? 2 : full.includes(w) ? 1 : 0;
        if (nrm(m.type) === nrm(q) || nrm(m.name) === nrm(q)) sc += 20; return { m, sc: sc - hay.length * 0.01 }; }).filter(x => x.sc > 0.5).sort((a, b) => b.sc - a.sc).map(x => x.m);
    }
    /** Un endroit nommé (pièce du lieu ou entité) : { x, y (sol), z, ceil (plafond ou null), name } ou null */
    function placeNamed(q) {
      const e = ent(q), p = e && H.posAt(e.key, H.T); let r = p ? { x: p.x, y: p.y, z: p.z, name: e.name } : null;
      if (!r) { const n = nrm(q), L = H.geo?.pieces?.() || [], pc = L.find(c => nrm(c.nom) === n) || L.find(c => nrm(c.nom).includes(n) || n.includes(nrm(c.nom))); if (pc) r = { x: pc.centre?.x ?? (pc.x[0] + pc.x[1]) / 2, y: 0, z: pc.centre?.z ?? (pc.z[0] + pc.z[1]) / 2, name: pc.nom }; }
      if (!r) return null; let st = null; try { st = H.geo?.geo?.()?.status?.({ x: r.x, y: r.y + 1.2, z: r.z }) || null; } catch { st = null; }
      if (st && Number.isFinite(st.floor) && !p) r.y = st.floor; r.ceil = st && Number.isFinite(st.ceil) ? st.ceil : null; return r;
    }
    /** Une zone : une pièce du lieu (son étendue), sinon un disque autour d'une entité ou d'un point. Rend { c: { x, z }, has(l), name } ou { error } */
    function zone(a, defR) {
      const R = clamp(num(a.radius) ?? defR, 0.5, 300), q = a.near ?? a.room ?? a.at;
      if (q != null && q !== '') {
        const n = nrm(q), L = H.geo?.pieces?.() || [], pc = L.find(c => nrm(c.nom) === n) || L.find(c => nrm(c.nom).includes(n) || n.includes(nrm(c.nom)));
        if (pc) return { c: { x: pc.centre?.x ?? (pc.x[0] + pc.x[1]) / 2, z: pc.centre?.z ?? (pc.z[0] + pc.z[1]) / 2 }, has: l => l.x >= pc.x[0] - 0.6 && l.x <= pc.x[1] + 0.6 && l.z >= pc.z[0] - 0.6 && l.z <= pc.z[1] + 0.6, name: `la pièce « ${pc.nom} »` };
        const e = ent(q), p = e && H.posAt(e.key, H.T); if (!p) return { error: `« ${q} » : ni une pièce du lieu (${L.map(c => c.nom).slice(0, 10).join(', ') || 'aucune pièce connue'}), ni une entité` };
        const room = H.geo?.pieceAt?.(p.x, p.z) || null; return { c: p, has: l => Math.hypot(l.x - p.x, l.z - p.z) <= R, name: `${R} m autour de ${e.name}${room ? ` (dans « ${room.nom} »)` : ''}` };
      }
      if (num(a.x) != null && num(a.z) != null) { const c = { x: +a.x, z: +a.z }; return { c, has: l => Math.hypot(l.x - c.x, l.z - c.z) <= R, name: `${R} m autour de ce point` }; }
      return null;
    }
    const POSE_SYN = { salut: 'saluer', coucou: 'saluer', bonjour: 'saluer', hello: 'saluer', wave: 'saluer', au_revoir: 'saluer', montrer: 'pointer', designer: 'pointer', doigt: 'pointer', point: 'pointer', debout: 'repos', neutre: 'repos', normal: 'repos', idle: 'repos', bras_leves: 'bras_en_l_air', mains_en_l_air: 'bras_en_l_air', haut_les_mains: 'bras_en_l_air', croix: 't', t_pose: 't', hanches: 'mains_hanches', zombie: 'bras_tendus', somnambule: 'bras_tendus', reflechir: 'penser', pensif: 'penser', sit: 'assis', asseoir: 'assis', assise: 'assis', par_terre: 'assis_sol', marche: 'marche_1', marcher: 'marche_1', walk: 'marche_1', course: 'course_1', courir: 'course_1', run: 'course_1', sauter: 'saut', jump: 'saut', tomber: 'chute', gagne: 'victoire', poing_leve: 'victoire', effraye: 'peur', tristesse: 'triste', pleurer: 'triste', frapper: 'coup_de_poing', poing: 'coup_de_poing', kick: 'coup_de_pied', tenir: 'porter', regarder_a_gauche: 'regard_gauche', regarder_a_droite: 'regard_droite', regarder_en_haut: 'regard_haut' };
    const poseKey = (O, v, strict = false) => { const n = nrm(v), u = n.replace(/ /g, '_'), K = Object.keys(O.POSES); if (!u) return null; const exact = K.find(k => k === u) || (POSE_SYN[u] && K.includes(POSE_SYN[u]) ? POSE_SYN[u] : null); if (exact || strict) return exact;
      return K.find(k => n.length > 3 && nrm(O.POSES[k].label).includes(n)) || K.find(k => k.length > 3 && u.length > 3 && (u.includes(k) || k.includes(u))) || Object.keys(POSE_SYN).filter(k => k.length > 3 && u.includes(k)).map(k => POSE_SYN[k]).find(k => K.includes(k)) || null; };
    const EMOTE_SYN = { saluer: 'coucou', salut: 'coucou', bonjour: 'coucou', hello: 'coucou', wave: 'coucou', au_revoir: 'coucou', signe: 'coucou', applaudissements: 'applaudir', bravo: 'applaudir', clap: 'applaudir', dormir: 'dodo', sommeil: 'dodo', hausser_les_epaules: 'epaules', shrug: 'epaules', facepalm: 'desespoir', backflip: 'salto', flip: 'salto', leviter: 'levitation' };
    const noEl = q => ko(`Élément « ${q ?? ''} » introuvable : ni un élément ajouté (${AN()?.objs.filter(o => o.kind !== 'ref').map(o => `« ${o.name} »`).slice(0, 12).join(', ') || 'aucun'}), ni une entité du record (list_entities).`);
    const isVeh = o => o.kind === 'ref' && String(o.ref).startsWith('v:');
    const capToRy = (o, deg) => (isVeh(o) ? deg * D2R : Math.PI / 2 - deg * D2R);
    const hex = c => (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim()) ? '#' + c.trim().replace('#', '') : null);
    function place(a) {
      const x = num(a.x), y = num(a.y), z = num(a.z), cap = num(a.cap);
      if (a.at != null && a.at !== '' && (x == null || z == null)) { const r = placeNamed(a.at); if (!r) return { error: `endroit « ${a.at} » introuvable : ni une pièce du lieu (${(H.geo?.pieces?.() || []).map(c => c.nom).slice(0, 8).join(', ') || 'describe_place'}), ni une entité — donne x, y, z` }; return { x: r2(r.x), y: r2(y ?? (a._light ? (r.ceil != null ? r.ceil - 0.3 : r.y + 2.6) : r.y)), z: r2(r.z), ry: cap != null ? Math.PI / 2 - cap * D2R : 0, where: r.name }; }
      if (a.near != null && a.near !== '') { const e = ent(a.near), p = e && H.posAt(e.key, H.T); if (!p) return { error: `entité « ${a.near} » introuvable à cet instant` }; const s = p.yaw + Math.PI / 2; return { x: r2(p.x + Math.cos(s) * 1.2), y: r2(y ?? p.y), z: r2(p.z + Math.sin(s) * 1.2), ry: cap != null ? Math.PI / 2 - cap * D2R : Math.PI / 2 - p.yaw }; }
      if (x == null || z == null) return null;   // (devant la vue)
      return { x, y: y ?? 0, z, ry: cap != null ? Math.PI / 2 - cap * D2R : 0 };
    }
    const done = (o, what) => { AN().changed(); return ok(`${what} « ${o.name} »`, AN().O.brief(AN().data, o, H.T)); };
    function addAny(kind, props, a, after = null) {
      const A = AN(); if (!A) return ko(NO); const P0 = place(a); if (P0?.error) return ko(P0.error);
      const o = A.add(kind, props, P0, false); if (o.error) return ko(o.error);
      if (!P0 && num(a.cap) != null) o.st.ry = Math.PI / 2 - a.cap * D2R; if (!P0 && num(a.y) != null) o.st.y = +a.y;
      after?.(o); if (P0?.where) { const r = done(o, { perso: 'Personnage ajouté :', modele: 'Objet ajouté :', lumiere: 'Lumière ajoutée :', miroir: 'Miroir ajouté :', texte: 'Texte ajouté :', particules: 'Particules ajoutées :' }[kind]); r.text += ` — placé : ${P0.where} (x ${P0.x}, y ${P0.y}, z ${P0.z})`; return r; }
      return done(o, { perso: 'Personnage ajouté :', modele: 'Objet ajouté :', lumiere: 'Lumière ajoutée :', miroir: 'Miroir ajouté :', texte: 'Texte ajouté :', particules: 'Particules ajoutées :' }[kind]);
    }
    /** Écrit les réglages d'une clé (unités de l'assistant) sur un élément ; rend le nombre de canaux écrits */
    function writeKey(o, k, t, fixed, O) {
      const V = {}; const put = (ch, v) => { if (v != null && Number.isFinite(v)) V[ch] = v; };
      put('x', num(k.x)); put('y', num(k.y)); put('z', num(k.z)); if (num(k.cap) != null) put('ry', capToRy(o, num(k.cap))); if (num(k.pitch) != null) put('rx', num(k.pitch) * D2R); if (num(k.roll) != null) put('rz', num(k.roll) * D2R);
      if (num(k.scale) != null) for (const c of O.SCL) put(c, num(k.scale)); put('sx', num(k.sx) ?? V.sx); put('sy', num(k.sy) ?? V.sy); put('sz', num(k.sz) ?? V.sz);
      if (typeof k.visible === 'boolean') V.vis = k.visible ? 1 : 0;
      if (o.kind === 'lumiere') { put('li', num(k.intensity)); put('lr', num(k.range)); if (num(k.angle) != null) put('la', num(k.angle) * D2R); const c = hex(k.color); if (c) { const [r, g, b] = O.hexRgb(c); V.cr = r; V.cg = g; V.cb = b; } }
      // (cap : par le plus court depuis la clé précédente)
      if ('ry' in V && !fixed) { const L = o.tracks.ry || [], prev = L.filter(x => x.t < t).pop(); if (prev) V.ry = prev.v + Math.atan2(Math.sin(V.ry - prev.v), Math.cos(V.ry - prev.v)); }
      const ease = O.EASE[k.ease] ? k.ease : null;
      for (const [ch, v] of Object.entries(V)) { if (fixed) { delete o.tracks[ch]; (o.st ||= {})[ch] = v; } else O.setKey(o, ch, t, v, ch === 'vis' ? 'fixe' : ease); }
      return Object.keys(V).length;
    }
    const lighting = () => { const A = AN(), a = A.ambiance(false), O = A.O, g = c => (a ? r2(O.chanAt(a, c, H.T)) : 1); return { luminosite: g('expo'), ambiante: g('amb'), soleil: g('sun'), lampes: g('lamps'), teinte: a ? O.rgbHex(g('cr'), g('cg'), g('cb')) : '#ffffff', animee: !!a && O.keyCount(a) > 0 }; };
    const RUN = {
      list_elements() { const A = AN(); if (!A) return ko(NO); const O = A.O, L = A.objs.filter(o => !O.noTR(o)).map(o => O.brief(A.data, o, H.T));
        return ok(`${L.length} élément${L.length > 1 ? 's' : ''} ajouté${L.length > 1 ? 's' : ''} ou animé${L.length > 1 ? 's' : ''}`, { elements: L, eclairage_du_lieu: lighting(), lampes_reglees: A.objs.filter(o => o.kind === 'lampe').map(o => ({ cle: o.lkey, nom: o.name, intensite: r2(O.chanAt(o, 'lm', H.T)) })),
          lumieres_restantes: Object.fromEntries(Object.entries(O.POOL).map(([k, n]) => [k, n - A.objs.filter(o => o.kind === 'lumiere' && o.ltype === k).length])) }); },
      find_models(a) { const A = AN(); if (!A) return ko(NO); const L = rankModels(a.query || '', a.category || null).slice(0, clamp(num(a.limit) ?? 25, 1, 80)); return L.length ? ok(`${L.length} modèle${L.length > 1 ? 's' : ''}${a.query ? ` pour « ${a.query} »` : ''}`, { modeles: L.map(m => ({ model: m.type, nom: m.name, famille: m.cat })) }) : ko(`Aucun modèle pour « ${a.query || ''} » : essaie d’autres mots (un seul mot simple : chaise, table, voiture, arbre…).`); },
      search_models(a) { const A = AN(); if (!A) return ko(NO); const L = A.searchCatalog(a.search || '', clamp(num(a.limit) ?? 25, 1, 80)); return ok(`${L.length} modèle${L.length > 1 ? 's' : ''} pour « ${a.search || ''} »`, { modeles: L.map(m => ({ model: m.type, nom: m.name, famille: m.cat })) }); },
      add_object(a) { if (!a.model) return ko('add_object : « model » manquant (voir find_models).'); const A = AN(); if (!A) return ko(NO);
        const asked = String(a.model), all = A.searchCatalog('', 6000); let hit = all.find(m => m.type === asked) || all.find(m => nrm(m.type) === nrm(asked) || nrm(m.name) === nrm(asked)), approx = false;
        if (!hit) { hit = rankModels(asked)[0]; approx = true; } if (!hit) return ko(`Modèle « ${asked} » inconnu et rien d’approchant : cherche-le avec find_models (mots simples).`);
        const r = addAny('modele', { model: hit.type, name: a.name, label: hit.name }, a, o => { const sc = num(a.scale); if (sc) for (const c of A.O.SCL) o.st[c] = clamp(sc, 0.01, 100); if (a.parent) { const p = A.find(a.parent); if (p) A.setParent(o, p.id); } });
        if (r.ok && approx) r.text += ` — « ${asked} » n’existe pas : j’ai pris le modèle le plus proche, « ${hit.name} » (${hit.type}). find_models donne les noms exacts.`; return r; },
      add_character(a) { const A = AN(); if (!A) return ko(NO); const base = String(a.name || (a.kind === 'joueur' ? 'Figurant' : 'PNJ')).slice(0, 56), taken = new Set([...H.entities().map(e => nrm(e.name)), ...A.objs.map(o => nrm(o.name))]); let name = base;
        // (jamais d'homonyme d'un personnage du record : set_appearance, frame_shot… désignent les personnages par leur nom)
        for (let i = 2; taken.has(nrm(name)) && i < 99; i++) name = `${base} ${i}`;
        const r = addAny('perso', { npc: a.kind !== 'joueur', name, title: a.title }, a); if (r.ok && name !== base) r.text += ` — un personnage « ${base} » existe déjà dans le record : le nouveau s’appelle « ${name} » (utilise ce nom pour le désigner)`; return r; },
      add_light(a) { const A = AN(); if (!A) return ko(NO); const type = ['point', 'spot', 'dir'].includes(a.type) ? a.type : 'point';
        a = { ...a, _light: true }; return addAny('lumiere', { ltype: type, name: a.name, color: hex(a.color) || undefined, intensity: num(a.intensity) ?? undefined, range: num(a.range) ?? undefined, angle: num(a.angle) != null ? clamp(num(a.angle), 2, 85) * D2R : undefined }, a, o => {
          if (typeof a.shadow === 'boolean') o.shadow = a.shadow && type === 'spot';
          const la = a.look_at; if (la && type !== 'point') { let p = null; if (la.entity != null) { const e = ent(la.entity), q = e && H.posAt(e.key, H.T); if (q) p = { x: q.x, y: q.y + 1, z: q.z }; } else if (num(la.x) != null && num(la.z) != null) p = { x: +la.x, y: num(la.y) ?? 0, z: +la.z };
            if (p) { const dx = p.x - o.st.x, dy = p.y - o.st.y, dz = p.z - o.st.z, h = Math.hypot(dx, dz); o.st.ry = Math.atan2(dx, dz); o.st.rx = -(Math.PI / 2 - Math.atan2(-dy, h)); o.st.rz = 0; } } }); },
      add_mirror(a) { return addAny('miroir', { name: a.name, w: num(a.width) ?? 2, h: num(a.height) ?? 2.4, tint: hex(a.tint) || undefined, q: num(a.quality) ?? 512 }, a); },
      add_particles(a) { return addAny('particules', { ptype: a.type, name: a.name, count: num(a.count) ?? undefined, size: num(a.size) ?? undefined, spread: num(a.spread) ?? undefined, color: hex(a.color) || undefined }, a); },
      add_text(a) { if (!a.text) return ko('add_text : « text » manquant.'); return addAny('texte', { name: a.name || String(a.text).slice(0, 24), text: String(a.text), size: num(a.size) ?? 1, color: hex(a.color) || undefined, face: !!a.face_camera }, a); },
      animate_element(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.element); if (!o) return noEl(a.element); const O = A.O;
        if (O.noTR(o)) return ko('Cet élément est un réglage d’éclairage : utilise set_scene_lighting ou set_scene_light.');
        const K = Array.isArray(a.keys) ? a.keys : []; if (!K.length) return ko('animate_element : « keys » est vide.'); let n = 0; const times = [];
        for (const k of K) { const t = tOf(k?.t, 0); n += writeKey(o, k || {}, t, !!a.fixed, O); times.push(t); }
        if (!n) return ko('animate_element : aucune valeur reconnue dans les clés (x, y, z, cap, pitch, roll, scale, visible…).');
        A.changed(); return ok(a.fixed ? `« ${o.name} » placé (${n} réglage${n > 1 ? 's' : ''} fixe${n > 1 ? 's' : ''})` : `${n} clé${n > 1 ? 's' : ''} posée${n > 1 ? 's' : ''} sur « ${o.name} » (${[...new Set(times)].map(t => r2(t / 1000) + ' s').join(', ')})`, O.brief(A.data, o, H.T)); },
      make_fall(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.element); if (!o) return noEl(a.element); const O = A.O; if (O.noTR(o)) return ko('Cet élément ne peut pas tomber.');
        const t0 = tOf(a.t, 0), d = Math.round(clamp(num(a.duration) ?? 1.2, 0.15, 30) * 1000), t1 = Math.min(H.dur, t0 + d), hgt = clamp(num(a.height) ?? 4, 0.1, 300), W = A.ws(o, t1), y1 = W.local.y, spin = (num(a.spin) ?? 90) * D2R;
        O.setKey(o, 'y', t0, y1 + hgt, 'rebond'); O.setKey(o, 'y', t1, y1, 'fluide'); if (spin) { O.setKey(o, 'rz', t0, W.local.rz + spin, 'frein'); O.setKey(o, 'rz', t1, W.local.rz, 'fluide'); }
        if (a.hide_before !== false && t0 > 0) { O.setKey(o, 'vis', 0, 0, 'fixe'); O.setKey(o, 'vis', t0, 1, 'fixe'); }
        A.changed(); return ok(`« ${o.name} » tombe de ${r2(hgt)} m entre ${r2(t0 / 1000)} s et ${r2(t1 / 1000)} s (avec rebond)`, O.brief(A.data, o, t1)); },
      update_element(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.element); if (!o) return noEl(a.element); const did = [];
        if (typeof a.name === 'string' && a.name.trim() && o.kind !== 'ref') { o.name = a.name.trim().slice(0, 60); if (o.kind === 'perso') A.syncPersos(); did.push(`nom « ${o.name} »`); }
        if ('parent' in a) { const p = a.parent ? elem(a.parent) : null; if (a.parent && !p) return noEl(a.parent); if (!A.setParent(o, p ? p.id : null, BONES.includes(a.bone) ? a.bone : '')) return ko('Impossible : ces éléments se suivraient en boucle.'); did.push(p ? `attaché à « ${p.name} »${o.bone ? ` (${o.bone})` : ''}` : 'détaché'); }
        else if (typeof a.bone === 'string' && o.parent) { A.setParent(o, o.parent, BONES.includes(a.bone) ? a.bone : ''); did.push(o.bone ? `tenu par ${o.bone}` : 'plus tenu par un os'); }
        if (typeof a.text === 'string' && o.kind === 'texte') { o.text = a.text.slice(0, 200); did.push('texte changé'); }
        if (typeof a.shadow === 'boolean' && o.kind === 'lumiere') { o.shadow = a.shadow && o.ltype === 'spot'; did.push(o.shadow ? 'ombres activées' : 'ombres coupées'); }
        if (typeof a.walk === 'boolean' && o.kind === 'perso') { o.walk = a.walk; did.push(a.walk ? 'marche automatique' : 'sans marche automatique'); }
        if (!did.length) return ko('update_element : rien à changer (pour la position ou la visibilité : animate_element).');
        return done(o, `${did.join(', ')} —`); },
      delete_element(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.element, false); if (!o) return noEl(a.element); const name = o.name; A.remove(o); return ok(o.kind === 'ref' ? `« ${name} » est de nouveau comme dans le record` : `« ${name} » supprimé`); },
      delete_element_keys(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.element, false); if (!o) return noEl(a.element); const O = A.O; let n = 0;
        if (num(a.t) != null) n = O.delAt(o, null, tOf(a.t)); else { const f = tOf(a.from, 0), to = tOf(a.to, H.dur); for (const ch of Object.keys(o.tracks)) { const L = o.tracks[ch], m = L.length; o.tracks[ch] = L.filter(k => k.t < f || k.t > to); n += m - o.tracks[ch].length; } }
        if (!n) return ko('Aucune clé à cet endroit.'); A.changed(); return ok(`${n} clé${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''} sur « ${o.name} »`); },
      list_poses() { const A = AN(); if (!A) return ko(NO); return ok('Poses et animations disponibles', { poses: Object.entries(A.O.POSES).map(([k, p]) => ({ pose: k, description: p.label })), os: BONES, animations_du_jeu: A.emotes() }); },
      set_pose(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.character); if (!o) return noEl(a.character); const O = A.O; if (!O.isChar(o)) return ko(`« ${o.name} » n’est pas un personnage.`);
        if (a.clear) { O.clearPose(o); A.changed(); return ok(`Pose retirée : « ${o.name} » retrouve ses mouvements du jeu`); }
        const t = tOf(a.t), fixed = !!a.fixed, ease = O.EASE[a.ease] ? a.ease : null; let n = 0;
        if (a.pose != null && a.pose !== '') { const key = poseKey(O, a.pose); if (!key) return ko(`Pose « ${a.pose} » inconnue (list_poses : ${Object.keys(O.POSES).join(', ')}).`); if (fixed) O.clearPose(o); n += O.applyPose(o, key, t, !fixed, ease); }
        for (const [b, r] of Object.entries(a.bones && typeof a.bones === 'object' ? a.bones : {})) { if (!BONES.includes(b) || !Array.isArray(r)) continue; ['x', 'y', 'z'].forEach((ax, i) => { const v = num(r[i]); if (v == null) return; const ch = `${b}.${ax}`; if (fixed) { delete o.tracks[ch]; o.st[ch] = v * D2R; } else O.setKey(o, ch, t, v * D2R, ease); n++; }); }
        if (!n) return ko('set_pose : donne « pose » (list_poses) et/ou « bones ».');
        A.changed(); return ok(fixed ? `« ${o.name} » garde cette pose` : `Pose de « ${o.name} » à ${r2(t / 1000)} s (${n} rotations d’os)`); },
      play_emote(a) { const A = AN(); if (!A) return ko(NO); const o = elem(a.character); if (!o) return noEl(a.character); const O = A.O; if (!O.isChar(o)) return ko(`« ${o.name} » n’est pas un personnage.`);
        const t = tOf(a.t, 0), L = A.emotes(); let id = '';
        if (a.emote) { const n = nrm(a.emote), u = n.replace(/ /g, '_');
          const hit = L.find(e => e.id === a.emote) || L.find(e => nrm(e.id) === n || nrm(e.nom) === n) || L.find(e => e.id === EMOTE_SYN[u]) || L.find(e => nrm(e.nom).includes(n) || n.includes(nrm(e.id)));
          if (!hit) { const pk = poseKey(O, a.emote, true);   // (pas une animation du jeu, mais une pose connue — « pointer » : la pose est posée à cet instant)
            if (pk) { O.applyPose(o, pk, t, true); A.changed(); return ok(`« ${a.emote} » n’est pas une animation du jeu : la pose « ${pk} » est posée sur « ${o.name} » à ${r2(t / 1000)} s (set_pose pour l’enchaîner avec d’autres)`); }
            return ko(`Animation « ${a.emote} » inconnue. Animations valides : ${L.map(e => e.id).join(', ')}. (Pour une pose fixe : set_pose.)`); }
          id = hit.id; }
        O.setClip(o, t, id); A.changed(); return ok(id ? `« ${o.name} » : animation « ${L.find(e => e.id === id).nom} » à ${r2(t / 1000)} s` : `« ${o.name} » : animation arrêtée à ${r2(t / 1000)} s`); },
      list_scene_lights(a) { const A = AN(); if (!A) return ko(NO); const Z = zone(a, 8); if (Z?.error) return ko(`list_scene_lights : ${Z.error}.`);
        let L = A.sceneLamps(Z ? 300 : 60, Z?.c || null); if (Z) L = L.filter(Z.has);
        return ok(`${L.length} lampe${L.length > 1 ? 's' : ''} ${Z ? `dans ${Z.name}` : 'près de la vue'}${!L.length ? ' — ce lieu est éclairé par sa lumière ambiante et sa lumière principale, qui valent pour TOUT le lieu (set_scene_lighting) : on ne peut pas éteindre une seule pièce sans lampe' : ''}`, { eclairage_du_lieu: lighting(), pieces: (H.geo?.pieces?.() || []).map(c => c.nom).slice(0, 20), lampes: L.map(l => ({ cle: l.key, type: l.type, x: l.x, y: l.y, z: l.z, intensite: l.intensite, couleur: l.couleur, distance: r2(l.d), eteinte: l.eteinte })) }); },
      set_scene_lighting(a) { const A = AN(); if (!A) return ko(NO); const O = A.O, o = A.ambiance(true), V = {};
        if (a.preset != null) { const p = PRESETS[nrm(a.preset).replace(/ /g, '_')]; if (!p) return ko(`Ambiance « ${a.preset} » inconnue (${Object.keys(PRESETS).join(', ')}).`); for (const ch of O.AMB_CH) V[ch] = p[ch] ?? 1; }
        for (const [k, ch] of [['brightness', 'expo'], ['ambient', 'amb'], ['sun', 'sun'], ['lamps', 'lamps']]) if (num(a[k]) != null) V[ch] = num(a[k]);
        const c = hex(a.color); if (c) { const [r, g, b] = O.hexRgb(c); V.cr = r; V.cg = g; V.cb = b; }
        if (!Object.keys(V).length) return ko('set_scene_lighting : donne brightness, ambient, sun, lamps, color ou preset.');
        const keyed = num(a.t) != null, t = tOf(a.t, 0), ease = O.EASE[a.ease] ? a.ease : null;
        for (const [ch, v] of Object.entries(V)) { if (keyed) { if (!o.tracks[ch]?.length && t > 0) O.setKey(o, ch, 0, O.chanAt(o, ch, 0)); O.setKey(o, ch, t, v, ease); } else { delete o.tracks[ch]; o.st[ch] = clamp(v, 0, 8); } }
        A.changed(); return ok(keyed ? `Éclairage du lieu : clé à ${r2(t / 1000)} s` : 'Éclairage du lieu réglé', lighting()); },
      add_title(a) { const A = AN(); if (!A) return ko(NO); if (!a.text) return ko('add_title : « text » manquant.'); const t0 = tOf(a.from, 0), t1 = num(a.to) != null ? tOf(a.to) : 0; if (t1 && t1 <= t0) return ko('add_title : « to » doit être après « from ».');
        const o = A.add('titre', { text: String(a.text).replace(/\\n/g, '\n'), pos: a.position, size: num(a.size) ?? undefined, color: hex(a.color) || undefined, t0, t1, fade: num(a.fade) != null ? num(a.fade) * 1000 : undefined, box: !!a.box }, null, false); if (o.error) return ko(o.error);
        A.changed(); return ok(`Titre « ${o.name} » de ${r2(t0 / 1000)} s à ${t1 ? r2(t1 / 1000) + ' s' : 'la fin'}`); },
      set_fade(a) { const A = AN(); if (!A) return ko(NO); const O = A.O, o = O.newObj(A.data, 'effets'), did = [], t = tOf(a.t, 0), ease = O.EASE[a.ease] ? a.ease : null;
        for (const [k, ch, nm] of [['black', 'fade', 'noir'], ['white', 'flash', 'blanc']]) { const v = num(a[k]); if (v == null) continue; O.setKey(o, ch, t, clamp(v, 0, 100) / 100, ease); did.push(`${nm} ${Math.round(clamp(v, 0, 100))} à ${r2(t / 1000)} s`); }
        if (num(a.cut_fade) != null) { o.cutfade = Math.round(clamp(num(a.cut_fade), 0, 5) * 1000); did.push(o.cutfade ? `fondu de ${r2(o.cutfade / 1000)} s à chaque changement de plan` : 'coupes franches'); }
        if (!did.length) return ko('set_fade : donne black, white ou cut_fade.'); A.changed(); return ok(`Fondu : ${did.join(', ')}`); },
      apply_template(a) { const A = AN(); if (!A?.template) return ko(NO); let key = null; if (a.subject != null && a.subject !== '') { const e = ent(a.subject); if (!e || e.key[0] !== 'u') return ko(`Sujet « ${a.subject} » introuvable (un personnage).`); key = e.key; }
        const r = A.template(nrm(a.template), key, { start: num(a.start) != null ? tOf(a.start) : 0, title: a.title ? String(a.title).slice(0, 80) : '' }); if (r.error) return ko(`apply_template : ${r.error}.`);
        return ok(`Modèle « ${a.template} » appliqué : ${r.cams.length} plans de ${r2(r.start / 1000)} à ${r2(r.end / 1000)} s${r.subject ? ` sur ${r.subject}` : ''}`, { plans: r.cams, note: r.notes }); },
      set_speed(a) { const A = AN(); if (!A) return ko(NO); const O = A.O, o = O.newObj(A.data, 'effets'), did = [], t = tOf(a.t, 0);
        if (a.reset) { O.clearChan(o, 'speed'); o.st.speed = 1; o.holds = []; did.push('temps normal partout'); }
        if (num(a.speed) != null) { if (!o.tracks.speed?.length && t > 0) O.setKey(o, 'speed', 0, 1); O.setKey(o, 'speed', t, clamp(num(a.speed), 0.05, 8), O.EASE[a.ease] ? a.ease : null); did.push(`vitesse ×${r2(clamp(num(a.speed), 0.05, 8))} à ${r2(t / 1000)} s`); }
        if (num(a.freeze) != null && num(a.freeze) > 0) { o.holds = [...(o.holds || []).filter(h => Math.abs(h.t - t) > 40), { t, ms: Math.round(clamp(num(a.freeze), 0.02, 60) * 1000) }].sort((x, y) => x.t - y.t); did.push(`image figée ${r2(clamp(num(a.freeze), 0.02, 60))} s à ${r2(t / 1000)} s`); }
        if (!did.length) return ko('set_speed : donne speed, freeze ou reset.'); A.changed(); return ok(`Temps : ${did.join(', ')}`); },
      capture_image(a) { const A = AN(); if (!A?.capturePng) return ko(NO); const [w, h] = { '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160], '8k': [7680, 4320] }[nrm(a.resolution).replace(/ /g, '')] || [3840, 2160]; A.capturePng(w, h); return ok(`Capture ${w}×${h} lancée (fichier PNG à côté des vidéos exportées)`); },
      set_camera_shake(a) { const A = AN(); if (!A) return ko(NO); const O = A.O, v = num(a.intensity); if (v == null) return ko('set_camera_shake : « intensity » manquant.'); const o = O.newObj(A.data, 'effets'), keyed = num(a.t) != null, t = tOf(a.t, 0), V = { shake: clamp(v, 0, 100) / 100 }; if (num(a.frequency) != null) V.shakef = clamp(num(a.frequency), 0.5, 40);
        for (const [ch, x] of Object.entries(V)) { if (keyed) { if (!o.tracks[ch]?.length && t > 0) O.setKey(o, ch, 0, O.chanAt(o, ch, 0)); O.setKey(o, ch, t, x, O.EASE[a.ease] ? a.ease : null); } else { delete o.tracks[ch]; o.st[ch] = x; } }
        A.changed(); return ok(keyed ? `Tremblement de caméra : ${Math.round(V.shake * 100)} à ${r2(t / 1000)} s` : `Tremblement de caméra réglé à ${Math.round(V.shake * 100)}`); },
      set_scene_light(a) { const A = AN(); if (!A) return ko(NO); const O = A.O; let L = [];
        if (a.light) { const all = A.sceneLamps(200), hit = all.find(l => l.key === a.light) || all.find(l => l.nom && nrm(l.nom) === nrm(a.light)); if (!hit) return ko(`Lampe « ${a.light} » introuvable (list_scene_lights).`); L = [hit]; }
        else { const Z = zone(a, 6); if (Z?.error) return ko(`set_scene_light : ${Z.error}.`); if (!Z) return ko('set_scene_light : donne « light » (une lampe) ou « near » (une pièce, une entité) / x, z (une zone).');
          L = A.sceneLamps(300, Z.c).filter(Z.has); if (!L.length) return ko(`Aucune lampe ponctuelle dans ${Z.name} : RIEN n’a été éteint. Ce lieu est éclairé par sa lumière ambiante et sa lumière principale, communes à tout le lieu — on ne peut pas éteindre cette seule zone. Dis-le à l’utilisateur ; pour assombrir TOUT le lieu : set_scene_lighting (brightness, ambient, sun) ; pour éclairer une zone : add_light.`); }
        const k = typeof a.on === 'boolean' && num(a.intensity) == null ? (a.on ? 1 : 0) : num(a.intensity), c = hex(a.color); if (k == null && !c) return ko('set_scene_light : donne « on », « intensity » ou « color ».');
        const keyed = num(a.t) != null, t = tOf(a.t, 0), ease = O.EASE[a.ease] ? a.ease : null;
        for (const l of L) { const o = A.lampObj(l.key, true), V = {}; if (k != null) V.lm = clamp(k, 0, 10); if (c) { const [r, g, b] = O.hexRgb(c); V.cr = r; V.cg = g; V.cb = b; }
          for (const [ch, v] of Object.entries(V)) { if (keyed) { if (!o.tracks[ch]?.length && t > 0) O.setKey(o, ch, 0, O.chanAt(o, ch, 0)); O.setKey(o, ch, t, v, ease); } else { delete o.tracks[ch]; o.st[ch] = v; } } }
        A.changed(); return ok(`${L.length} lampe${L.length > 1 ? 's' : ''} ${k === 0 ? 'éteinte' : k != null ? `réglée${L.length > 1 ? 's' : ''} à ×${r2(k)}` : 'teintée'}${L.length > 1 && k === 0 ? 's' : ''}${keyed ? ` (clé à ${r2(t / 1000)} s)` : ''}${a.light ? '' : ` dans ${zone(a, 6).name}`}`, { lampes: L.map(l => l.key) }); },
    };
    return { RUN, digest() { const A = AN(); if (!A) return null; const O = A.O, L = A.objs.filter(o => !O.noTR(o)); return L.length || A.ambiance(false) ? { elements_animes: L.slice(0, 20).map(o => ({ nom: o.name, type: o.kind === 'ref' ? 'entite_du_record' : o.kind, cles: O.keyCount(o) })), eclairage_du_lieu: lighting() } : null; } };
  } };
}

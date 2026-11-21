// Big Street Studio — outils de l'assistant IA pour le MONDE (heure du jour, vitesse du temps, brume, clés de la piste « Monde ») et
// l'EXPORT vidéo réglé (format, résolution, cadence, qualité, début, fin, nom). Extension du moteur d'actions (ai-tools.js) passée
// par l'hôte (H.ext) ; elle parle au monde (world.js, H.monde()) et à la page « Exporter » (export.js, H.xport()).
// Ce module n'importe rien : tools/selftest.mjs le charge seul.
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v.replace(',', '.')) ? +v.replace(',', '.') : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;
const mod24 = h => ((h % 24) + 24) % 24;
const fmtHour = h => { const m = Math.round(mod24(h) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** « 21:30 », « 21h30 », « 21 h », 21.5 → heure décimale, ou null */
export function hourOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? mod24(v) : null;
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:h](\d{1,2})?)?$/.exec(s); if (m) { const h = +m[1], mn = +(m[2] || 0); return h <= 24 && mn < 60 ? mod24(h + mn / 60) : null; }
  const N = { minuit: 0, aube: 6, matin: 9, midi: 12, apresmidi: 15, soir: 19, coucher: 19.5, nuit: 23 }[s.normalize('NFD').replace(/[̀-ͯ-]/g, '')];
  if (N !== undefined) return N;
  const x = num(s); return x === null ? null : mod24(x);
}
const P = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const S = (description, extra = {}) => ({ type: 'string', description, ...extra }), N = description => ({ type: 'number', description }), B = description => ({ type: 'boolean', description });
const HOUR = { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'Heure du jour : "21:30", "6h", 18.5, ou "aube", "midi", "soir", "nuit".' };
const T = (name, description, parameters, mut = false) => ({ name, description, parameters, mut });
/** Y a-t-il une cinématique ? (au moins une caméra active avec deux clés de pose — cineRange de cams.js) */
export const hasCine = H => { try { return !!(H.C?.cineRange ? H.C.cineRange(H.cams || []) : null); } catch { return false; } };
export const NO_CINE = 'Pas d’export : il n’y a pas encore de cinématique (aucune caméra active avec au moins deux images-clés). Crée d’abord les plans (frame_shot, orbit_shot…), puis propose l’export.';

export const MONDE_TOOLS = [
  T('world_settings', 'Le monde : heure du jour à un instant (et d’où elle vient : record, réglée, accélérée, animée), vitesse du temps, brume, clés de la piste « Monde », lieu intérieur ou extérieur.', P({ t: N('Instant (s), défaut l’instant courant.') })),
  T('set_world', 'Règle le monde : l’heure du jour (à l’instant t, le temps continue ensuite à la vitesse choisie), la vitesse du temps (0 = figé, 1 = normal : 1 s = 30 s de jeu, 60 = 1 s pour 30 min), la brume (0–100), ou revient à l’heure du record. Sans clé, une seule valeur pour toute la cinématique.', P({ hour: HOUR, t: N('Instant (s) où l’heure doit valoir « hour » (défaut : instant courant).'), speed: N('Vitesse du temps (0 à 1440).'), haze: N('Brume 0–100.'), reset: B('Revenir à l’heure du record, sans brume ni clés.') }), true),
  T('set_world_keys', 'Anime le monde par des images-clés sur la piste « Monde » de la frise : heure (coucher de soleil, nuit qui tombe, lever du jour en accéléré) et/ou brume, à des instants donnés. Entre deux clés l’heure passe par le plus court (23 h → 1 h passe par minuit). clear : efface d’abord les clés existantes.', P({ keys: { type: 'array', description: 'Les clés.', items: P({ t: N('Instant (s).'), hour: HOUR, haze: N('Brume 0–100.'), ease: S('Interpolation vers la clé suivante.', { enum: ['fluide', 'doux', 'accel', 'frein', 'fixe'] }) }, ['t']) }, clear: B('Effacer d’abord les clés du monde.') }, ['keys']), true),
  T('export_cinematic', 'Prépare l’export de la vidéo avec des réglages précis (seulement si l’utilisateur le demande) : la page « Exporter » s’ouvre préremplie, l’utilisateur lance lui-même le rendu (il peut durer des minutes). Refusé tant qu’il n’y a pas de cinématique (caméra active avec deux clés). Par défaut : MP4 1080p 30 i/s qualité haute, de 0 à la dernière clé de la frise.', P({
    format: S('Format.', { enum: ['mp4', 'webm', 'avi', 'gif'] }), resolution: S('Résolution.', { enum: ['360p', '480p', '720p', '1080p', '1440p', '4k'] }), fps: N('Images par seconde (24, 30, 60 ; GIF : 10, 15, 20, 25).'),
    quality: S('Compression.', { enum: ['basse', 'moyenne', 'haute', 'tres_haute', 'max'] }), bitrate_mbps: N('Débit en Mb/s (WebM, MP4), remplace la qualité.'),
    start: N('Début (s), défaut 0.'), end: N('Fin (s), défaut la dernière clé de la frise.'), name: S('Nom du fichier, sans extension.'), bars: B('Bandes de cinéma noires.') })),
];
export const MONDE_PROMPT = `

# Monde et export
- L'heure du jour se règle (set_world) et s'anime (set_world_keys : clés d'heure et de brume sur la piste « 🌍 Monde » de la frise). Dehors, elle change la lumière, le ciel, la lune, les vitrines ; à l'intérieur, presque rien (sauf les logements). Pas de météo (ni pluie ni neige) : seulement une brume (0–100). Idées : une scène de nuit (22 h–4 h), l'heure dorée (7 h ou 19 h), un lever de soleil en accéléré sur un plan large (5 h → 8 h).
- Quand l'utilisateur demande l'heure ou l'ambiance, règle le monde ; vérifie avec world_settings.
- export_video ouvre la page « Exporter » (l'utilisateur choisit) ; export_cinematic l'ouvre préremplie avec les réglages demandés (format, résolution, cadence, compression, début, fin, nom). Dans les deux cas c'est l'utilisateur qui clique « Exporter ». Il faut une cinématique (des caméras avec deux clés) : sinon, crée d'abord les plans. N'exporte que sur demande.`;

/** L'extension (H.ext) : { tools, prompt, create(H, kit) } */
export function createMondeExt() {
  return {
    tools: MONDE_TOOLS, prompt: MONDE_PROMPT,
    create(H, { ok, ko, ms }) {
      const M = () => H.monde?.() || null;
      const at = a => ms(a.t, H.T);
      const state = t => {
        const m = M(); if (!m) return null; const S0 = m.state;
        return { heure: fmtHour(m.hourAt(t)), source: S0.tracks.hour.length ? 'animée par clés' : S0.hour != null ? 'réglée' : S0.speed !== 1 ? 'accélérée' : 'celle du record',
          heure_du_record: m.recordHour() != null ? fmtHour(m.recordHour()) : null, vitesse: S0.speed, brume: Math.round(m.hazeAt(t) * 100),
          cles: [...S0.tracks.hour.map(k => ({ t: r2(k.t / 1000), heure: fmtHour(k.v), ease: k.ease })), ...S0.tracks.haze.map(k => ({ t: r2(k.t / 1000), brume: Math.round(k.v * 100), ease: k.ease }))].sort((a, b) => a.t - b.t) };
      };
      return {
        RUN: {
          world_settings(a) { const m = M(); if (!m) return ko('Monde indisponible.'); const t = at(a), s = state(t); return ok(`Monde à ${r2(t / 1000)} s : ${s.heure} (${s.source}), brume ${s.brume} %, ${s.cles.length} clé(s).`, { ...s, interieur: !!H.info?.().interieur }); },
          set_world(a) {
            const m = M(); if (!m) return ko('Monde indisponible.');
            if (a.reset) { m.reset(); return ok('Monde remis à l’heure du record, sans brume ni clés.', state(H.T)); }
            const did = [];
            if (a.speed != null) { const s = num(a.speed); if (s === null) return ko('speed : nombre attendu (0 = figé, 1 = normal).'); m.setSpeed(clamp(s, 0, 1440)); did.push(`vitesse du temps ${s === 0 ? 'figée' : `×${s}`}`); }
            if (a.hour != null) {
              const h = hourOf(a.hour); if (h === null) return ko(`hour : « ${a.hour} » n’est pas une heure (ex. "21:30", 6, "soir").`);
              if (m.state.tracks.hour.length) m.delKeys('hour');
              const t = at(a); m.setHourAt(h, t); did.push(`heure ${fmtHour(h)} à ${r2(t / 1000)} s`);
            }
            if (a.haze != null) { const z = num(a.haze); if (z === null) return ko('haze : nombre 0–100 attendu.'); if (m.state.tracks.haze.length) m.delKeys('haze'); m.setHaze(clamp(z, 0, 100) / 100); did.push(`brume ${Math.round(clamp(z, 0, 100))} %`); }
            if (!did.length) return ko('Rien à régler : donne hour, speed, haze ou reset.');
            m.changed?.();
            return ok(`Monde : ${did.join(', ')}.`, state(H.T));
          },
          set_world_keys(a) {
            const m = M(); if (!m) return ko('Monde indisponible.');
            if (!Array.isArray(a.keys) || !a.keys.length) return ko('keys : liste de clés attendue ([{ t, hour, haze }]).');
            if (a.clear) m.delKeys(null);
            const did = [], bad = [];
            for (const k of a.keys.slice(0, 60)) {
              const t = ms(k?.t, null); if (t === null) { bad.push('clé sans instant t'); continue; }
              if (k.hour != null) { const h = hourOf(k.hour); if (h === null) bad.push(`heure « ${k.hour} » illisible`); else { m.setKey('hour', t, h, k.ease); did.push(`${r2(t / 1000)} s → ${fmtHour(h)}`); } }
              if (k.haze != null) { const z = num(k.haze); if (z === null) bad.push('brume illisible'); else { m.setKey('haze', t, clamp(z, 0, 100) / 100, k.ease); did.push(`${r2(t / 1000)} s → brume ${Math.round(z)} %`); } }
            }
            if (!did.length) return ko(`Aucune clé posée${bad.length ? ` : ${bad.join(' ; ')}` : ' (donne hour ou haze)'}.`);
            return ok(`Piste Monde : ${did.join(' · ')}${bad.length ? ` — ignoré : ${bad.join(' ; ')}` : ''}.`, state(H.T));
          },
          export_cinematic(a) {
            const X = H.xport?.(); if (!X) return ko('Export indisponible.');
            if (X.busy) return ko('Un export est déjà en cours.');
            // (pas de cinématique — aucune caméra active avec deux clés — : rien à exporter ; jamais tout le record par défaut)
            if (!hasCine(H)) return ko(NO_CINE);
            const o = {};
            if (a.format) o.format = String(a.format).toLowerCase();
            if (a.resolution) o.res = String(a.resolution).toLowerCase();
            if (a.fps != null) o.fps = num(a.fps);
            if (a.quality) o.quality = String(a.quality);
            if (a.bitrate_mbps != null && num(a.bitrate_mbps) > 0) o.bitrate = num(a.bitrate_mbps) * 1e6;
            if (a.start != null) o.start = ms(a.start, 0);
            if (a.end != null) o.end = ms(a.end, null) ?? undefined;
            if (a.name) o.name = String(a.name).slice(0, 120);
            if (a.bars != null) o.bars = !!a.bars;
            // (l'outil ne lance JAMAIS le rendu : il ouvre la page « Exporter » préremplie et rend la main tout de suite — c'est
            // l'utilisateur qui clique « Exporter » ; un rendu image par image peut durer des minutes)
            if (!X.open(o)) return ko('Export impossible pour le moment.');
            const O = X.options;
            return ok(`Page « Exporter » ouverte et préremplie : ${O.format.toUpperCase()} ${O.width}×${O.height}, ${O.fps} i/s, qualité ${O.quality}, de ${r2(O.start / 1000)} à ${r2(O.end / 1000)} s (${r2((O.end - O.start) / 1000)} s). L’utilisateur n’a plus qu’à cliquer « Exporter » ; dis-le-lui.`, { format: O.format, largeur: O.width, hauteur: O.height, fps: O.fps, debut: r2(O.start / 1000), fin: r2(O.end / 1000), lance: false });
          },
        },
        digest() { return null; },
      };
    },
  };
}

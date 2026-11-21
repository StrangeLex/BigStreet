// Big Street Studio — la géométrie de la scène, pour l'assistant et pour le contrôle des caméras (21/11).
//
// Le moteur d'actions ne savait qu'une chose du décor : « cette case est-elle un sol ? ». Ni les meubles, ni les plafonds, ni la
// hauteur, ni rien dehors. Ici, la VRAIE géométrie dessinée (sols, murs, plafonds, meubles, bâtiments) est relevée une fois, triangle
// par triangle, dans le repère du monde (extractTriangles), rangée dans une grille (createSoup) et interrogée par des lancers de
// rayons rapides : distance au premier obstacle, face vue de devant ou de DERRIÈRE (un point enfermé dans un mur ou un meuble ne
// voit que des dos de faces), ligne de vue, volume libre, positions dégagées, chemin qui contourne (createGeo).
// Ce module ne touche ni au DOM ni à three.js (les objets de la scène sont lus tels quels : matrices, attributs) : il se teste seul.

// ---------------------------------------------------------------- Relevé des triangles de la scène
const SEE = 1;   // (drapeau d'un triangle : on voit à travers — vitre —, mais on ne passe pas)
/**
 * Les triangles (repère du monde) de tout ce qui est dessiné sous « roots ». Rend { tris: Float32Array (9 par triangle), flags:
 * Uint8Array, count, truncated }. Écartés : ce qui est caché (sauf keep(o) — objets éteints par le brouillard), les points, lignes,
 * images plates face caméra, halos (mélange additif), fumées (très transparent), maillages animés par un squelette, et skip(o).
 * box : { x0, x1, z0, z1 } — seuls les triangles qui touchent cette zone sont gardés (ville). max : nombre maximal de triangles.
 */
export function extractTriangles(roots, { keep = null, skip = null, box = null, max = 1500000 } = {}) {
  let buf = new Float32Array(9 * 65536), fl = new Uint8Array(65536), n = 0, truncated = false;
  const grow = () => { const b = new Float32Array(buf.length * 2); b.set(buf); buf = b; const f = new Uint8Array(fl.length * 2); f.set(fl); fl = f; };
  const M = new Float64Array(16), v = new Float64Array(9);
  const mul = (a, b, o) => { for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; };
  function emit(geo, m, flag) {
    const P = geo.attributes?.position; if (!P || !P.count) return;
    const raw = !P.isInterleavedBufferAttribute && !P.normalized && P.itemSize === 3 ? P.array : null, idx = geo.index ? geo.index.array : null, cnt = idx ? idx.length : P.count;
    const dr = geo.drawRange, i0 = Math.max(0, dr?.start || 0), i1 = Math.min(cnt, i0 + (Number.isFinite(dr?.count) ? dr.count : cnt));
    for (let i = i0; i + 2 < i1 + 0.5 && i + 2 < cnt; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx[i + k] : i + k, x = raw ? raw[j * 3] : P.getX(j), y = raw ? raw[j * 3 + 1] : P.getY(j), z = raw ? raw[j * 3 + 2] : P.getZ(j);
        v[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]; v[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; v[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      if (!(v[0] === v[0] && v[4] === v[4] && v[8] === v[8])) continue;   // (NaN)
      if (box && (Math.max(v[0], v[3], v[6]) < box.x0 || Math.min(v[0], v[3], v[6]) > box.x1 || Math.max(v[2], v[5], v[8]) < box.z0 || Math.min(v[2], v[5], v[8]) > box.z1)) continue;
      if (n >= max) { truncated = true; return; }
      if (n >= fl.length) grow();
      buf.set(v, n * 9); fl[n++] = flag;
    }
  }
  function walk(o, hidden) {
    if (truncated || skip?.(o)) return;
    if (o.visible === false && !keep?.(o)) hidden = true;
    if (!hidden && (o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh && o.geometry) {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material, op = mat?.opacity ?? 1;
      const ghost = !mat || mat.visible === false || mat.blending === 2 || (mat.transparent && op < 0.3) || mat.colorWrite === false;
      if (!ghost) {
        const flag = mat.transparent && (op < 0.85 || mat.depthWrite === false) ? SEE : 0;
        o.updateWorldMatrix?.(true, false); const W = o.matrixWorld.elements;
        if (o.isInstancedMesh) { const A = o.instanceMatrix.array, c = Math.min(o.count, A.length / 16); for (let i = 0; i < c && !truncated; i++) { mul(W, A.subarray(i * 16, i * 16 + 16), M); if (Math.abs(M[0]) + Math.abs(M[1]) + Math.abs(M[2]) > 1e-5) emit(o.geometry, M, flag); } }
        else emit(o.geometry, W, flag);
      }
    }
    if (o.children) for (const c of o.children) walk(c, hidden);
  }
  for (const r of roots) if (r) walk(r, false);
  return { tris: buf.subarray(0, n * 9), flags: fl.subarray(0, n), count: n, truncated };
}

// ---------------------------------------------------------------- La grille de triangles et le lancer de rayons
/** Une « soupe » de triangles rangée par cases (x, z) : ray(…) rend le premier triangle touché. */
export function createSoup(tris, flags = null, cell = 2, box = null) {
  const n = (tris.length / 9) | 0; flags ||= new Uint8Array(n);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n * 9; i += 3) { const x = tris[i], y = tris[i + 1], z = tris[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!n) { x0 = z0 = y0 = 0; x1 = z1 = y1 = 1; }
  // (box : la zone utile — en ville, la mer et les falaises sont d'immenses triangles : sans elle, la grille s'étirait sur 60 km et chaque rayon coûtait cher)
  if (box) { x0 = Math.max(x0, box.x0); x1 = Math.min(x1, box.x1); z0 = Math.max(z0, box.z0); z1 = Math.min(z1, box.z1); if (x1 <= x0) x1 = x0 + 1; if (z1 <= z0) z1 = z0 + 1; }
  while ((x1 - x0) / cell > 700 || (z1 - z0) / cell > 700) cell *= 2;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell + 1e-6)), nz = Math.max(1, Math.ceil((z1 - z0) / cell + 1e-6));
  const cx = x => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / cell))), cz = z => Math.max(0, Math.min(nz - 1, Math.floor((z - z0) / cell)));
  // (deux passes : compter, puis remplir ; un triangle immense — un sol d'un seul tenant — va dans la liste « partout »)
  const start = new Int32Array(nx * nz + 1), big = [];
  const span = i => { const a = i * 9; return [cx(Math.min(tris[a], tris[a + 3], tris[a + 6])), cx(Math.max(tris[a], tris[a + 3], tris[a + 6])), cz(Math.min(tris[a + 2], tris[a + 5], tris[a + 8])), cz(Math.max(tris[a + 2], tris[a + 5], tris[a + 8]))]; };
  const isBig = s => (s[1] - s[0] + 1) * (s[3] - s[2] + 1) > 4096;
  for (let i = 0; i < n; i++) { const s = span(i); if (isBig(s)) { big.push(i); continue; } for (let c = s[2]; c <= s[3]; c++) for (let b = s[0]; b <= s[1]; b++) start[c * nx + b + 1]++; }
  for (let i = 0; i < nx * nz; i++) start[i + 1] += start[i];
  const list = new Int32Array(start[nx * nz]), fill = new Int32Array(nx * nz);
  for (let i = 0; i < n; i++) { const s = span(i); if (isBig(s)) continue; for (let c = s[2]; c <= s[3]; c++) for (let b = s[0]; b <= s[1]; b++) { const k = c * nx + b; list[start[k] + fill[k]++] = i; } }
  const stamp = new Int32Array(n); let gen = 0;
  const hit = { d: 0, back: false, see: false, ny: 0, tri: -1 };
  // (Möller–Trumbore, des deux côtés : « back » = la face est vue de dos)
  function test(i, ox, oy, oz, dx, dy, dz, best, mask) {
    if (flags[i] & mask) return best;
    const a = i * 9, ax = tris[a], ay = tris[a + 1], az = tris[a + 2], e1x = tris[a + 3] - ax, e1y = tris[a + 4] - ay, e1z = tris[a + 5] - az, e2x = tris[a + 6] - ax, e2y = tris[a + 7] - ay, e2z = tris[a + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) return best;
    const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-6 || u > 1 + 1e-6) return best;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, w = (dx * qx + dy * qy + dz * qz) * inv; if (w < -1e-6 || u + w > 1 + 1e-6) return best;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t < 1e-5 || t >= best) return best;
    hit.d = t; hit.back = det < 0; hit.see = !!(flags[i] & SEE); hit.tri = i;
    const nyv = e1z * e2x - e1x * e2z, nl = Math.hypot(e1y * e2z - e1z * e2y, nyv, e1x * e2y - e1y * e2x) || 1; hit.ny = nyv / nl;
    return t;
  }
  /**
   * Premier triangle touché depuis (ox, oy, oz) dans la direction (dx, dy, dz) — normalisée —, à moins de max : { d, back, see, ny }
   * (objet réutilisé : à lire tout de suite) ou null. sight : les vitres ne comptent pas.
   */
  function ray(ox, oy, oz, dx, dy, dz, max = 80, sight = false) {
    const mask = sight ? SEE : 0; let best = max; gen++;
    for (const i of big) best = test(i, ox, oy, oz, dx, dy, dz, best, mask);
    // (parcours des cases traversées, de proche en proche)
    let gx = (ox - x0) / cell, gz = (oz - z0) / cell, t0 = 0;
    if (gx < 0 || gx >= nx || gz < 0 || gz >= nz) {   // (départ hors de la grille : on avance jusqu'à son bord)
      let ta = 0, tb = max;
      for (const [o, d, lo, hi] of [[ox, dx, x0, x0 + nx * cell], [oz, dz, z0, z0 + nz * cell]]) { if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return best < max ? hit : null; continue; } let a = (lo - o) / d, b = (hi - o) / d; if (a > b) [a, b] = [b, a]; ta = Math.max(ta, a); tb = Math.min(tb, b); }
      if (ta > tb || ta > max) return best < max ? hit : null;
      t0 = ta + 1e-6; gx = (ox + dx * t0 - x0) / cell; gz = (oz + dz * t0 - z0) / cell;
    }
    let ix = Math.max(0, Math.min(nx - 1, Math.floor(gx))), iz = Math.max(0, Math.min(nz - 1, Math.floor(gz)));
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, ddx = Math.abs(dx) < 1e-12 ? Infinity : cell / Math.abs(dx), ddz = Math.abs(dz) < 1e-12 ? Infinity : cell / Math.abs(dz);
    let tmx = ddx === Infinity ? Infinity : t0 + ((dx > 0 ? ix + 1 - gx : gx - ix) * ddx), tmz = ddz === Infinity ? Infinity : t0 + ((dz > 0 ? iz + 1 - gz : gz - iz) * ddz), tin = t0;
    let found = best < max ? { ...hit } : null;
    for (let guard = 0; guard < 4096; guard++) {
      if (tin > best) break;
      const k = iz * nx + ix;
      for (let j = start[k]; j < start[k + 1]; j++) { const i = list[j]; if (stamp[i] === gen) continue; stamp[i] = gen; const b = test(i, ox, oy, oz, dx, dy, dz, best, mask); if (b < best) { best = b; found = found || {}; found.d = hit.d; found.back = hit.back; found.see = hit.see; found.ny = hit.ny; found.tri = hit.tri; } }
      if (tmx < tmz) { tin = tmx; tmx += ddx; ix += sx; if (ix < 0 || ix >= nx) break; } else { tin = tmz; tmz += ddz; iz += sz; if (iz < 0 || iz >= nz) break; }
      if (tin === Infinity) break;
    }
    return found;
  }
  return { count: n, cell, bounds: { x0, x1, y0, y1, z0, z1 }, ray };
}
/** Les 12 triangles d'un pavé (faces tournées vers l'extérieur) — essais, et obstacles ajoutés à la main */
export function boxTris(x0, y0, z0, x1, y1, z1, out = []) {
  const q = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const p = (x, y, z) => [x, y, z], A = p(x0, y0, z0), B = p(x1, y0, z0), C = p(x1, y0, z1), D = p(x0, y0, z1), E = p(x0, y1, z0), F = p(x1, y1, z0), G = p(x1, y1, z1), H = p(x0, y1, z1);
  q(E, H, G, F); q(A, B, C, D); q(A, E, F, B); q(D, C, G, H); q(A, D, H, E); q(B, F, G, C);   // (dessus, dessous, −z, +z, −x, +x)
  return out;
}

// ---------------------------------------------------------------- Questions sur le lieu
const AX = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
const DG = [[0.7071, 0, 0.7071], [-0.7071, 0, 0.7071], [0.7071, 0, -0.7071], [-0.7071, 0, -0.7071]];
export const WHY = { hors_carte: 'hors de la carte', vide: 'dans le vide (hors du lieu, rien sous elle)', sous_le_sol: 'sous le sol', volume: 'à l’intérieur d’un mur, d’un meuble ou d’un modèle', plafond: 'au-dessus du plafond',
  trop_pres: 'collée à une surface (l’image la traverse)', traverse: 'traverse un mur ou un modèle', masque: 'sujet caché par un obstacle', non_verifie: 'zone non chargée : non vérifié' };
/**
 * Les questions de géométrie d'un lieu. soup : createSoup(…) (ou null : seule la carte répond) ; map : { outdoor, inMap(x, z),
 * isFloor(x, z) (case où l'on marche), groundY(x, z), loaded(x, z) (zone de la ville chargée) } — tout est facultatif.
 */
export function createGeo(soup, map = {}) {
  const outdoor = !!map.outdoor, MARGIN = 0.22;
  const ray = (p, d, max, sight) => (soup ? soup.ray(p.x, p.y, p.z, d[0], d[1], d[2], max, sight) : null);
  const groundAt = (x, z, y = null) => {   // (le sol sous un point : la carte quand elle le sait, sinon le premier dessus de quelque chose)
    const g = map.groundY?.(x, z); if (Number.isFinite(g) && (map.isFloor ? map.isFloor(x, z) : true)) return g;
    if (soup) { const top = (y ?? soup.bounds.y1) + 0.01, h = soup.ray(x, top, z, 0, -1, 0, top - soup.bounds.y0 + 2); if (h && !h.back) return top - h.d; }
    return null;
  };
  /**
   * Ce point peut-il porter une caméra ? Rend { why (null = libre, sinon une clé de WHY), clear (distance à la surface la plus proche),
   * floor (y du sol dessous), ceil (y du plafond ou de ce qui est au-dessus, null = ciel) }.
   */
  function status(p, margin = MARGIN) {
    const out = { why: null, clear: Infinity, floor: null, ceil: null };
    if (map.loaded && !map.loaded(p.x, p.z)) { out.why = 'non_verifie'; return out; }
    if (map.inMap && !map.inMap(p.x, p.z)) { out.why = 'hors_carte'; return out; }
    const onFloor = map.isFloor ? !!map.isFloor(p.x, p.z) : null, g = onFloor !== false && map.groundY ? map.groundY(p.x, p.z) : null;
    if (Number.isFinite(g)) { out.floor = g; if (p.y < g + 0.08) { out.why = 'sous_le_sol'; return out; } }
    if (!soup) { if (onFloor === false && !outdoor) out.why = 'volume'; return out; }
    // (six rayons dans les axes : un point enfermé dans un volume fermé — mur, meuble — ne voit que des dos de faces ; au-dessus d'un
    // plafond, le rayon vers le bas touche le dos d'une face tournée vers le bas)
    let back = 0, hits = 0, under = null;
    for (let i = 0; i < 6; i++) {
      const h = ray(p, AX[i], i === 5 ? 120 : 40); if (!h) { if (i === 5 && !Number.isFinite(g) && !(outdoor && onFloor !== false)) { out.why = 'vide'; return out; } continue; }
      hits++; if (h.back) back++; if (h.d < out.clear) out.clear = h.d;
      if (i === 4) out.ceil = p.y + h.d;
      if (i === 5) { if (out.floor === null) out.floor = p.y - h.d; if (h.back) under = h.ny < -0.5 ? 'plafond' : 'volume'; }
    }
    if (back >= 4 || (back >= 3 && hits >= 5 && out.clear < 0.6)) out.why = 'volume'; else if (under) out.why = under;
    if (out.why) return out;
    for (const d of DG) { const h = ray(p, d, 3); if (h && h.d < out.clear) out.clear = h.d; }
    if (out.clear < margin) out.why = 'trop_pres';
    return out;
  }
  const free = (p, margin) => !status(p, margin).why;
  /** Le trajet droit de a à b croise-t-il quelque chose ? Rend la distance au premier obstacle, ou null (libre). sight : à travers les vitres. */
  function blockedAt(a, b, sight = false, slack = 0) {
    if (!soup) return null; const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz); if (L < 1e-4) return null;
    const h = soup.ray(a.x, a.y, a.z, dx / L, dy / L, dz / L, L - slack, sight); return h ? h.d : null;
  }
  /** Lancer de rayon pour l'assistant : direction { yaw, pitch } en radians (convention des caméras). */
  function probe(p, yaw, pitch = 0, max = 80) { const c = Math.cos(pitch), h = ray(p, [Math.cos(yaw) * c, Math.sin(pitch), Math.sin(yaw) * c], max); return h ? { d: h.d, back: h.back, see: h.see, ny: h.ny } : null; }
  /** Le volume libre autour d'un point : distances aux obstacles dans les quatre directions, sol et plafond, et les 16 rayons à plat. */
  function bounds(p, max = 60) {
    const s = status(p, 0), d = AX.map(a => ray(p, a, max)?.d ?? null), ring = [];
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; ring.push(ray(p, [Math.cos(a), 0, Math.sin(a)], max)?.d ?? max); }
    return { status: s, east: d[0], west: d[1], south: d[2], north: d[3], up: d[4], down: d[5], ring };
  }
  /**
   * Des positions de caméra libres et dégagées autour d'une cible (un point à regarder) : essayées sur des cercles, à plusieurs hauteurs ;
   * gardées si libres, avec la cible en vue. Rend [{ x, y, z, dist, az (rad, direction cible → caméra), clear, score }], les meilleures d'abord.
   */
  function freeSpots(tg, { rMin = 1.2, rMax = 8, heights = null, n = 8, floorY = null, prefer = null, steps = 16 } = {}) {
    const out = [], fy = floorY ?? groundAt(tg.x, tg.z, tg.y) ?? tg.y - 1.5, hs = heights || [1.6, 2.3, 0.9, 0.4];
    const radii = []; for (let r = rMin; r <= rMax + 1e-6; r *= 1.45) radii.push(r); if (radii[radii.length - 1] < rMax - 0.2) radii.push(rMax);
    for (const r of radii) for (let i = 0; i < steps; i++) {
      const az = i * 2 * Math.PI / steps;
      for (const h of hs) {
        const p = { x: tg.x + Math.cos(az) * r, y: fy + h, z: tg.z + Math.sin(az) * r }, s = status(p, 0.3); if (s.why) continue;
        if (blockedAt(p, tg, true, 0.35) !== null) continue;
        let score = Math.min(s.clear, 2) * 0.5 - Math.abs(h - 1.6) * 0.3;
        if (prefer) { if (Number.isFinite(prefer.az)) score -= Math.abs(Math.atan2(Math.sin(az - prefer.az), Math.cos(az - prefer.az))) * 0.9; if (Number.isFinite(prefer.dist)) score -= Math.abs(r - prefer.dist) * 0.35; }
        out.push({ x: p.x, y: p.y, z: p.z, dist: Math.hypot(r, p.y - tg.y), az, clear: Math.min(s.clear, 9), score }); break;
      }
    }
    out.sort((a, b) => b.score - a.score);
    // (pas dix positions au même endroit)
    const pick = []; for (const c of out) { if (pick.every(q => Math.hypot(q.x - c.x, q.z - c.z) > 0.9)) pick.push(c); if (pick.length >= n) break; }
    return pick;
  }
  /** Le point libre le plus proche de p (recherche en spirale, à sa hauteur d'abord) ; see : un point d'où ce point-là reste visible. */
  function nearestFree(p, { maxR = 7, see = null, from = null, margin = 0.3 } = {}) {
    const okAt = q => { const s = status(q, margin); if (s.why) return false; if (see && blockedAt(q, see, true, 0.35) !== null) return false; if (from && blockedAt(from, q) !== null) return false; return true; };
    if (okAt(p)) return { ...p };
    const s0 = status(p, 0), fy = s0.floor ?? groundAt(p.x, p.z, p.y);
    const ys = [p.y]; if (fy !== null) { const hi = s0.ceil !== null && s0.why !== 'plafond' ? s0.ceil - 0.35 : fy + 2.4; ys.push(Math.max(fy + 0.35, Math.min(hi, p.y)), fy + 1.6, fy + 2.2, fy + 0.6); }
    for (let r = 0; r <= maxR + 1e-6; r += r < 1.5 ? 0.25 : 0.5) {
      const steps = r ? Math.max(8, Math.round(r * 8)) : 1;
      for (const y of ys) for (let i = 0; i < steps; i++) { const a = i * 2 * Math.PI / steps, q = { x: p.x + Math.cos(a) * r, y, z: p.z + Math.sin(a) * r }; if ((r || y !== p.y) && okAt(q)) return q; }
    }
    return null;
  }
  /**
   * Un chemin libre de a à b (A* sur un quadrillage de 0,5 m, la hauteur glissant de a.y à b.y) : [a, …, b] simplifié (les points
   * intermédiaires inutiles sont retirés), ou null s'il n'y en a pas à portée (pièces séparées, trop loin).
   */
  function route(a, b, { step = 0.5, pad = 8, maxNodes = 6000, margin = 0.3 } = {}) {
    if (blockedAt(a, b) === null && free(b, margin)) return [a, b];
    const x0 = Math.min(a.x, b.x) - pad, z0 = Math.min(a.z, b.z) - pad, W = Math.ceil((Math.abs(a.x - b.x) + 2 * pad) / step) + 1, H = Math.ceil((Math.abs(a.z - b.z) + 2 * pad) / step) + 1;
    if (W * H > 260000) return null;
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, yAt = (x, z) => { const u = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (L * L))); return a.y + (b.y - a.y) * u; };
    const P = k => { const i = k % W, j = (k - i) / W, x = x0 + i * step, z = z0 + j * step; return { x, y: yAt(x, z), z }; };
    const K = p => Math.round((p.z - z0) / step) * W + Math.round((p.x - x0) / step), ks = K(a), ke = K(b);
    const okCache = new Map(), ok = k => { let v = okCache.get(k); if (v === undefined) { v = k === ks || k === ke || free(P(k), margin); okCache.set(k, v); } return v; };
    const g = new Map([[ks, 0]]), came = new Map(), open = [[0, ks]], pe = P(ke); let nodes = 0, done = false;
    const push = e => { let i = open.push(e) - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
    const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
    while (open.length && nodes++ < maxNodes) {
      const [, k] = pop(); if (k === ke) { done = true; break; }
      const i = k % W, j = (k - i) / W, pk = k === ks ? a : P(k), gk = g.get(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni; if (!ok(nk)) continue; const pn = nk === ke ? b : P(nk); if (blockedAt(pk, pn) !== null) continue;
        const ng = gk + Math.hypot(di, dj) * step; if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng); came.set(nk, k); push([ng + Math.hypot(pn.x - pe.x, pn.z - pe.z), nk]);
      }
    }
    if (!done) return null;
    const pts = [b]; for (let k = came.get(ke); k !== undefined && k !== ks; k = came.get(k)) pts.push(P(k)); pts.push(a); pts.reverse();
    // (simplification : on saute tout point qu'on peut rejoindre en ligne droite, avec un peu de marge de chaque côté)
    const wide = (p, q) => { if (blockedAt(p, q) !== null) return false; const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1, ox = -dz / l * 0.3, oz = dx / l * 0.3;
      return blockedAt({ x: p.x + ox, y: p.y, z: p.z + oz }, { x: q.x + ox, y: q.y, z: q.z + oz }) === null && blockedAt({ x: p.x - ox, y: p.y, z: p.z - oz }, { x: q.x - ox, y: q.y, z: q.z - oz }) === null; };
    const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !wide(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
    return out;
  }
  /**
   * Contrôle d'une suite de poses, échantillon par échantillon. samples : [{ t, x, y, z, target ({ x, y, z } à garder en vue, ou
   * null), exempt (vue subjective : pas de contrôle de proximité) }]. Rend { n, bad, checked, reasons: { clé: nombre }, list: [why | null] }.
   */
  function check(samples) {
    const list = [], reasons = {}; let bad = 0, checked = 0, prev = null;
    for (const s of samples) {
      let why = null; if (s.cut) prev = null;   // (coupe : un changement de caméra n'est pas une traversée)
      if (!s.exempt) { const st = status(s); why = st.why; if (!why && prev && blockedAt(prev, s) !== null) why = 'traverse'; }
      else if (map.inMap && !map.inMap(s.x, s.z)) why = 'hors_carte';
      if (!why && s.target && !s.exempt && blockedAt(s, s.target, true, 0.4) !== null) why = 'masque';
      if (why !== 'non_verifie') checked++;
      if (why && why !== 'non_verifie') bad++;
      if (why) reasons[why] = (reasons[why] || 0) + 1;
      list.push(why); prev = why && why !== 'masque' && why !== 'traverse' ? null : s;
    }
    return { n: samples.length, bad, checked, reasons, list };
  }
  return { soup, outdoor, status, free, blockedAt, probe, bounds, freeSpots, nearestFree, route, check, groundAt };
}
/** Une phrase pour un décompte de raisons : « 12 à l’intérieur d’un mur…, 3 hors de la carte » */
export const reasonsText = r => Object.entries(r).filter(([k]) => k !== 'non_verifie').sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${WHY[k] || k}`).join(', ');

// Big Street Studio — l'image d'une caméra : filtres (vision nocturne, thermique, noir et blanc, sépia, cinéma), vignette, grain,
// flou de profondeur, « Raytracing » (0 → 1 : occlusion ambiante fine, halo des lumières, reflets du sol, contraste — dosés selon la
// valeur) et « Ombre » (ombres portées en temps réel). La scène est dessinée dans une image (avec sa profondeur), puis repeinte par
// des shaders ; le moteur du jeu passe par ici quand world.post.active est vrai (même contrat que son propre post-traitement).
// L'image finale est celle du canvas : l'export vidéo la filme telle quelle. render(…, out) la dessine ailleurs (aperçu incrusté).
//
// Tout se fait APRÈS le dessin de la scène, à partir de sa profondeur : ni les lumières ni les matériaux du jeu ne sont touchés
// (changer le nombre de lumières ou d'ombres du moteur ferait recompiler tous ses shaders — un gel de plusieurs secondes).
//  - Ombre : la scène est redessinée en profondeur seule depuis le soleil (dehors) ou depuis le plafond (dedans) ; chaque point
//    de l'image est ensuite comparé à cette carte.
//  - Thermique : un second dessin marque ce qui est « chaud » (personnages, véhicules), caché par ce qui est devant.
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COMMON = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth; uniform mat4 projInv, camWorld; uniform float near, far;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
vec3 viewPos(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 p = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
// Lumière : R = occlusion ambiante (1 = aucune), G = ombre portée (1 = éclairé) — à demi-définition
const LIGHT = COMMON + `
uniform vec2 res; uniform float aoK, shK, shBias, shTexel; uniform sampler2D tShadow; uniform mat4 shadowVP; uniform vec3 lightDir; uniform mat4 proj;
void main() {
  float d0 = texture2D(tDepth, vUv).x; if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  // (normale d'après la profondeur : la plus courte des deux différences de chaque côté, pour ne pas baver sur les arêtes)
  vec2 px = 1.0 / res;
  vec3 r = viewPos(vUv + vec2(px.x, 0.0)) - P, l = P - viewPos(vUv - vec2(px.x, 0.0)), u = viewPos(vUv + vec2(0.0, px.y)) - P, dn = P - viewPos(vUv - vec2(0.0, px.y));
  vec3 N = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(dn.z) ? u : dn));
  float ao = 1.0;
  if (aoK > 0.001) {
    float radius = 0.55, rpx = radius * proj[1][1] * 0.5 / max(0.2, -P.z), occ = 0.0, a0 = ign(gl_FragCoord.xy) * 6.2831853;
    for (int i = 0; i < 12; i++) {
      float fi = float(i), a = a0 + fi * 2.39996323, k = sqrt((fi + 0.5) / 12.0);
      vec3 v = viewPos(vUv + vec2(cos(a) * res.y / res.x, sin(a)) * rpx * k) - P; float len2 = dot(v, v);
      occ += max(0.0, dot(N, v) / sqrt(len2 + 1e-5) - 0.12) / (1.0 + len2 / (radius * radius) * 3.0);
    }
    ao = clamp(1.0 - occ / 12.0 * 2.2 * aoK, 0.0, 1.0);
  }
  float sh = 1.0;
  if (shK > 0.001) {
    vec3 Nw = normalize((camWorld * vec4(N, 0.0)).xyz); float ndl = dot(Nw, lightDir);
    if (ndl > 0.03) {
      vec4 W = camWorld * vec4(P, 1.0); W.xyz += Nw * (shBias * (2.0 - ndl));
      vec4 s = shadowVP * W; vec3 c = s.xyz / s.w * 0.5 + 0.5;
      if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) {
        float lit = 0.0, a1 = ign(gl_FragCoord.xy + 17.0) * 6.2831853;
        for (int i = 0; i < 8; i++) { float a = a1 + float(i) * 2.39996323, k = sqrt((float(i) + 0.5) / 8.0) * 2.2 * shTexel; lit += step(c.z - 0.0009, texture2D(tShadow, c.xy + vec2(cos(a), sin(a)) * k).x); }
        // (fondu vers les bords de la carte : pas de coupure nette au loin)
        float edge = smoothstep(0.0, 0.06, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
        sh = mix(1.0, lit / 8.0, edge * smoothstep(0.03, 0.25, ndl));
      }
    }
  }
  gl_FragColor = vec4(ao, sh, 0.0, 1.0);
}`;
// Halo : ce qui brille (au-dessus d'un seuil), réduit puis étalé en deux passes
const BRIGHT = `precision highp float; varying vec2 vUv; uniform sampler2D tScene; uniform vec2 px; uniform float thr;
void main() { vec3 c = vec3(0.0); for (int i = 0; i < 4; i++) { vec2 o = vec2(i == 0 || i == 2 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0) * px; c += min(texture2D(tScene, vUv + o).rgb, vec3(4.0)); } c *= 0.25;
  float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(thr, thr + 0.35, l), 1.0); }`;
const BLUR = `precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 dir;
void main() { vec3 c = texture2D(tSrc, vUv).rgb * 0.227; c += (texture2D(tSrc, vUv + dir * 1.385).rgb + texture2D(tSrc, vUv - dir * 1.385).rgb) * 0.316; c += (texture2D(tSrc, vUv + dir * 3.231).rgb + texture2D(tSrc, vUv - dir * 3.231).rgb) * 0.070; gl_FragColor = vec4(c, 1.0); }`;
const FRAG = COMMON + `
uniform sampler2D tScene, tMask, tLight, tBloom; uniform vec2 res; uniform mat4 proj; uniform float time, vignette, grain, dof, focus, rt, shK, lightOn; uniform vec3 shTint; uniform int mode;
vec3 toSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// (palette « fer » des caméras thermiques : noir, violet, rouge, orange, jaune, blanc)
vec3 iron(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 a = vec3(0.02, 0.0, 0.10), b = vec3(0.32, 0.0, 0.55), c = vec3(0.86, 0.12, 0.25), d = vec3(1.0, 0.55, 0.05), e = vec3(1.0, 0.92, 0.35), f = vec3(1.0);
  if (h < 0.2) return mix(a, b, h / 0.2); if (h < 0.45) return mix(b, c, (h - 0.2) / 0.25); if (h < 0.7) return mix(c, d, (h - 0.45) / 0.25);
  if (h < 0.9) return mix(d, e, (h - 0.7) / 0.2); return mix(e, f, (h - 0.9) / 0.1);
}
// (reflet à l'écran : le rayon réfléchi avance dans l'image jusqu'à passer derrière ce qu'on y voit)
vec4 reflection(vec3 P, vec3 N) {
  vec3 V = normalize(P), R = reflect(V, N); if (R.z > -0.02) return vec4(0.0);
  float stepLen = 0.35; vec3 q = P + N * 0.04;
  for (int i = 0; i < 22; i++) {
    q += R * stepLen; stepLen *= 1.16;
    vec4 c = proj * vec4(q, 1.0); vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    float d = texture2D(tDepth, uv).x; if (d >= 0.99999) continue;
    float zs = -lin(d), dz = zs - q.z;
    if (dz > 0.0 && dz < stepLen * 1.6 + 0.3) { vec2 e = smoothstep(vec2(0.0), vec2(0.12), uv) * smoothstep(vec2(0.0), vec2(0.12), 1.0 - uv); return vec4(texture2D(tScene, uv).rgb, e.x * e.y * (1.0 - float(i) / 22.0)); }
  }
  return vec4(0.0);
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (dof > 0.001) {
    // (flou de profondeur : net à la distance de mise au point, de plus en plus flou en s'en éloignant)
    float d = lin(texture2D(tDepth, vUv).x), coc = clamp(abs(d - focus) / max(focus, 2.0), 0.0, 1.0) * dof * 0.014;
    if (coc > 0.0004) { vec3 s = c; float n = 1.0;
      for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996, r = sqrt((float(i) + 0.5) / 16.0) * coc; s += texture2D(tScene, vUv + vec2(cos(a) * res.y / res.x, sin(a)) * r).rgb; n += 1.0; }
      c = s / n; }
  }
  if (lightOn > 0.5) {
    // (occlusion et ombre : lissées sur quelques points voisins — elles sont calculées à demi-définition, avec un tramage)
    vec2 px = 2.0 / res, L = vec2(0.0);
    for (int i = 0; i < 9; i++) { vec2 o = vec2(float(i - (i / 3) * 3) - 1.0, float(i / 3) - 1.0); L += texture2D(tLight, vUv + o * px).rg; }
    L /= 9.0;
    float d0 = texture2D(tDepth, vUv).x;
    if (d0 < 0.99999) {
      if (rt > 0.3) {   // (reflets : sur ce qui est à plat — sols, tables —, plus marqués en vue rasante)
        vec3 P = viewPos(vUv); vec2 q = 1.0 / res;
        vec3 N = normalize(cross(viewPos(vUv + vec2(q.x, 0.0)) - P, viewPos(vUv + vec2(0.0, q.y)) - P));
        vec3 Nw = normalize((camWorld * vec4(N, 0.0)).xyz);
        if (Nw.y > 0.93) { vec4 r = reflection(P, N); float fres = pow(1.0 - max(0.0, dot(-normalize(P), N)), 3.0); c = mix(c, r.rgb, r.a * (0.06 + 0.5 * fres) * (rt - 0.3) / 0.7); }
      }
      c *= mix(vec3(1.0), shTint, (1.0 - L.y) * shK);
      c *= L.x;
    }
    if (rt > 0.001) {
      c += texture2D(tBloom, vUv).rgb * (0.35 + 0.9 * rt) * rt;
      float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l0), c, 1.0 + 0.14 * rt);   // (couleurs un peu plus denses)
      c = mix(c, c * c * (3.0 - 2.0 * c) * 1.04, 0.22 * rt * step(l0, 1.0));
    }
  }
  c = toSRGB(c);
  float l = dot(c, vec3(0.299, 0.587, 0.114)), g = grain, v = vignette;
  if (mode == 1) {          // vision nocturne : lumière amplifiée, tout en vert, grain, bords sombres, lignes
    float a = pow(clamp(l * 2.4 + 0.05, 0.0, 1.0), 0.72);
    c = vec3(0.10, 1.0, 0.24) * a + vec3(0.0, 0.05, 0.01); c += vec3(0.5, 0.6, 0.5) * smoothstep(0.82, 1.0, a) * 0.5;
    c *= 0.9 + 0.1 * sin(vUv.y * res.y * 1.5708); g = max(g, 0.45); v = max(v, 0.6);
  } else if (mode == 2) {   // thermique : le décor froid (teintes sombres), personnages et véhicules chauds
    float m = texture2D(tMask, vUv).r, h = mix(0.04 + l * 0.40, 0.66 + l * 0.34, m);
    c = iron(h); g = max(g, 0.10);
  } else if (mode == 3) {   // noir et blanc, contrasté
    float k = smoothstep(0.02, 0.98, l); c = vec3(k);
  } else if (mode == 4) {   // sépia
    c = mix(c, vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))), 0.92);
  } else if (mode == 5) {   // cinéma : ombres bleu-vert, lumières orangées, un peu plus de contraste
    c = mix(c, c * vec3(0.78, 1.02, 1.16), (1.0 - l) * 0.85); c = mix(c, c * vec3(1.16, 1.0, 0.82), l * 0.85);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.45); c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.12);
  }
  if (g > 0.001) c += (hash(vUv * res + fract(time) * 91.7) - 0.5) * g * 0.32;
  if (v > 0.001) c *= 1.0 - v * smoothstep(0.32, 0.98, length(vUv - 0.5) * 1.42);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
const MODES = { '': 0, nuit: 1, thermique: 2, nb: 3, sepia: 4, cine: 5 };
const SHADOW_SIZE = 2048;

export function createFX(THREE, world) {
  const depth = new THREE.DepthTexture(2, 2); depth.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthTexture: depth, samples: 0 });
  const mask = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  const light = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  const bloomA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false }), bloomB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  let shadow = null, shadowCam = null;   // (la carte d'ombre : créée la première fois qu'une caméra coche « Ombre »)
  const M4 = () => new THREE.Matrix4();
  const camU = { tDepth: { value: depth }, projInv: { value: M4() }, camWorld: { value: M4() }, proj: { value: M4() }, near: { value: 0.05 }, far: { value: 400 } };
  const U = { ...camU, tScene: { value: rt.texture }, tMask: { value: mask.texture }, tLight: { value: light.texture }, tBloom: { value: bloomA.texture }, res: { value: new THREE.Vector2(2, 2) }, time: { value: 0 },
    vignette: { value: 0 }, grain: { value: 0 }, dof: { value: 0 }, focus: { value: 12 }, mode: { value: 0 }, rt: { value: 0 }, shK: { value: 0 }, lightOn: { value: 0 }, shTint: { value: new THREE.Color(0.34, 0.38, 0.5) } };
  const UL = { ...camU, res: { value: new THREE.Vector2(2, 2) }, aoK: { value: 0 }, shK: { value: 0 }, shBias: { value: 0.05 }, shTexel: { value: 1 / SHADOW_SIZE }, tShadow: { value: null }, shadowVP: { value: M4() }, lightDir: { value: new THREE.Vector3(0, 1, 0) } };
  const UB = { tScene: { value: rt.texture }, px: { value: new THREE.Vector2() }, thr: { value: 0.8 } }, UG = { tSrc: { value: null }, dir: { value: new THREE.Vector2() } };
  const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const mFinal = mat(FRAG, U), mLight = mat(LIGHT, UL), mBright = mat(BRIGHT, UB), mBlur = mat(BLUR, UG);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mFinal); quad.frustumCulled = false;
  const qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qScene.add(quad);
  const pass = (renderer, material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(qScene, qCam); };
  const COLD = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }), HOT = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const DEPTH = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false, side: THREE.DoubleSide });
  const size = new THREE.Vector2(), clear = new THREE.Color(), v3 = new THREE.Vector3(), fwd = new THREE.Vector3(), shear = new THREE.Matrix4();
  // (ce qui est chaud : les personnages et leurs chiens, les véhicules des joueurs, ceux de passage, la circulation)
  const hot = () => {
    const S = new Set();
    for (const a of world.avatars.values()) { S.add(a.group); if (a.dog?.g) S.add(a.dog.g); }
    for (const V of world.pvs?.values() || []) if (V.mesh) S.add(V.mesh);
    for (const L of world.limos?.values() || []) if (L.mesh) S.add(L.mesh);
    for (const m of world.carMeshes || []) S.add(m);
    return S;
  };
  // Ce qui ne porte pas d'ombre : le ciel, les vitres, l'eau, les halos, les particules (tout ce qui est transparent ou ne s'inscrit
  // pas dans la profondeur). La liste est refaite deux fois par seconde, pas à chaque image (la ville compte des milliers d'objets).
  let ghosts = [], ghostsAt = -1e9;
  function noShadowList(scene) {
    const now = Date.now(); if (now - ghostsAt < 500) return ghosts; ghostsAt = now; ghosts = [];
    scene.traverseVisible(o => {
      if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if ((!o.isMesh && !o.isInstancedMesh) || !m || m.transparent || m.depthWrite === false || m.side === THREE.BackSide || m.visible === false || m.blending === THREE.AdditiveBlending) ghosts.push(o);
    });
    return ghosts;
  }
  function drawShadow(renderer, scene, cam) {
    if (!shadow) { shadow = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE) }); shadow.depthTexture.type = THREE.UnsignedIntType; shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200); }
    const out = !!world.room?.outdoor, R = out ? 30 : 22, L = UL.lightDir.value;
    cam.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); fwd.normalize();
    const cx = cam.position.x + fwd.x * R * 0.55, cz = cam.position.z + fwd.z * R * 0.55;
    let cy = 0; try { cy = world.heightAt(Math.round(cam.position.x), Math.round(cam.position.z)) || 0; } catch { cy = 0; }
    if (!Number.isFinite(cy)) cy = 0;
    if (out) { const s = world.sun; v3.copy(s.position); if (s.target) v3.sub(s.target.position); if (v3.lengthSq() > 1e-6) L.copy(v3.normalize()); else L.set(0.26, 0.86, 0.5).normalize(); }
    else L.set(-0.36, 1, -0.46).normalize();   // (dedans : une lumière de plafond, un peu de biais pour que l'ombre se voie à côté des choses)
    const D = 90; shadowCam.left = shadowCam.bottom = -R; shadowCam.right = shadowCam.top = R;
    shadowCam.up.set(0, 0, -1);
    if (out) { shadowCam.near = 1; shadowCam.far = D + 40; shadowCam.position.set(cx + L.x * D, cy + L.y * D, cz + L.z * D); }
    else { shadowCam.near = D - 2.55; shadowCam.far = D + 30; shadowCam.position.set(cx, cy + D, cz); }
    shadowCam.lookAt(cx, cy, cz);
    shadowCam.updateProjectionMatrix(); shadowCam.updateMatrixWorld(true); shadowCam.matrixWorldInverse.copy(shadowCam.matrixWorld).invert();
    if (!out) {
      // (dedans : la carte est prise à la verticale, pour commencer juste sous le plafond — sinon tout serait dans son ombre —, et
      // « penchée » : chaque point glisse le long de la lumière jusqu'au sol. Même résultat qu'une lumière de biais, sans le plafond.)
      shear.set(1, -L.x / L.y, 0, L.x / L.y * cy, 0, 1, 0, 0, 0, -L.z / L.y, 1, L.z / L.y * cy, 0, 0, 0, 1);
      shadowCam.projectionMatrix.multiply(shadowCam.matrixWorldInverse).multiply(shear).multiply(shadowCam.matrixWorld);
      shadowCam.projectionMatrixInverse.copy(shadowCam.projectionMatrix).invert();
    }
    shadowCam.layers.mask = cam.layers.mask;
    const hide = noShadowList(scene).filter(o => o.visible), bg = scene.background, ov = scene.overrideMaterial;
    for (const o of hide) o.visible = false;
    scene.background = null; scene.overrideMaterial = DEPTH;
    const su = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(shadow); renderer.clear(); renderer.render(scene, shadowCam);
    renderer.shadowMap.autoUpdate = su; scene.overrideMaterial = ov; scene.background = bg;
    for (const o of hide) o.visible = true;
    UL.tShadow.value = shadow.depthTexture; UL.shadowVP.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
    UL.shBias.value = out ? 0.07 : 0.05;
    // (force de l'ombre : le soleil de midi la marque, la nuit il n'en reste qu'un soupçon — la lune ; dedans, une ombre douce)
    const sun = Math.max(0, Math.min(1, (world.sun?.intensity ?? 1) / 1.3));
    return out ? 0.2 + 0.65 * sun : 0.8;
  }
  const fx = {
    active: false, cfg: null, focus: 12,
    /** cfg : { filter, vignette, grain, dof, rt, shadow } de la caméra à l'image, ou null (rien à faire) */
    use(cfg, focus = 12) { fx.cfg = cfg; fx.focus = focus; fx.active = !!cfg && !!(MODES[cfg.filter] || cfg.vignette > 0.001 || cfg.grain > 0.001 || cfg.dof > 0.001 || cfg.rt > 0.004 || cfg.shadow); },
    set() {},   // (contrat du moteur : rien à régler d'ici)
    /** out : { target, w, h } pour dessiner dans une autre image que le canvas (aperçu incrusté) */
    render(renderer, scene, cam, out = null) {
      const cfg = fx.cfg || {}; if (out) size.set(out.w, out.h); else renderer.getDrawingBufferSize(size);
      const w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0), hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1), qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
      if (rt.width !== w || rt.height !== h) { rt.setSize(w, h); mask.setSize(w, h); light.setSize(hw, hh); bloomA.setSize(qw, qh); bloomB.setSize(qw, qh); }
      const prev = out ? out.target : renderer.getRenderTarget();
      renderer.setRenderTarget(rt); renderer.render(scene, cam);
      const mode = MODES[cfg.filter] || 0, rtK = Math.max(0, Math.min(1, cfg.rt || 0));
      if (mode === 2) {
        const bg = scene.background, ov = scene.overrideMaterial, auto = renderer.autoClear, a0 = renderer.getClearAlpha(); renderer.getClearColor(clear);
        scene.background = null; renderer.setClearColor(0x000000, 1);
        renderer.setRenderTarget(mask); scene.overrideMaterial = COLD; renderer.render(scene, cam);   // (tout en noir : la profondeur du décor)
        const H = hot(), vis = scene.children.map(o => o.visible);
        for (const o of scene.children) if (!H.has(o)) o.visible = false;
        renderer.autoClear = false; scene.overrideMaterial = HOT; renderer.render(scene, cam);        // (le chaud en blanc, là où rien ne le cache)
        scene.children.forEach((o, i) => { o.visible = vis[i]; });
        renderer.autoClear = auto; scene.overrideMaterial = ov; scene.background = bg; renderer.setClearColor(clear, a0);
      }
      let shK = 0; if (cfg.shadow) { try { shK = drawShadow(renderer, scene, cam); } catch (e) { if (!fx.shadowErr) { fx.shadowErr = String(e); console.warn('ombres indisponibles', e); } } }
      const lit = rtK > 0.004 || shK > 0;
      camU.projInv.value.copy(cam.projectionMatrixInverse); camU.camWorld.value.copy(cam.matrixWorld); camU.proj.value.copy(cam.projectionMatrix); camU.near.value = cam.near; camU.far.value = cam.far;
      if (lit) {
        UL.res.value.set(hw, hh); UL.aoK.value = Math.min(1, rtK * 1.25); UL.shK.value = shK;
        pass(renderer, mLight, light);
        if (rtK > 0.004) {   // (halo : seuil plus bas quand la valeur monte, deux étalements successifs)
          UB.px.value.set(1 / w, 1 / h); UB.thr.value = 0.95 - 0.35 * rtK; pass(renderer, mBright, bloomA);
          for (const k of [1, 2.2]) { UG.tSrc.value = bloomA.texture; UG.dir.value.set(k / qw, 0); pass(renderer, mBlur, bloomB); UG.tSrc.value = bloomB.texture; UG.dir.value.set(0, k / qh); pass(renderer, mBlur, bloomA); }
        }
      }
      U.res.value.set(w, h); U.time.value = (Date.now() % 100000) / 1000; U.mode.value = mode;
      U.vignette.value = cfg.vignette || 0; U.grain.value = cfg.grain || 0; U.dof.value = cfg.dof || 0; U.focus.value = Math.max(0.5, fx.focus);
      U.rt.value = rtK; U.shK.value = shK; U.lightOn.value = lit ? 1 : 0;
      pass(renderer, mFinal, prev);
      fx.last = { rt: rtK, shadow: shK };
      if (fx.probe) { const b = new Uint8Array(hw * hh * 4); renderer.readRenderTargetPixels(light, 0, 0, hw, hh, b); let ao = 0, sh = 0, mn = 255; for (let i = 0; i < b.length; i += 4) { ao += b[i]; sh += b[i + 1]; mn = Math.min(mn, b[i + 1]); } fx.probe = false; fx.probed = { occlusion: +(ao / (b.length / 4) / 255).toFixed(3), eclaire: +(sh / (b.length / 4) / 255).toFixed(3), ombreMin: mn }; renderer.setRenderTarget(prev); }   // (essais : part de l'image éclairée)
    },
    dispose() { for (const t of [rt, mask, light, bloomA, bloomB, shadow]) t?.dispose(); depth.dispose(); quad.geometry.dispose(); for (const m of [mFinal, mLight, mBright, mBlur, COLD, HOT, DEPTH]) m.dispose(); },
  };
  return fx;
}

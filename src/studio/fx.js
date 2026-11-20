// Big Street Studio — les filtres d'une caméra : vision nocturne, thermique, noir et blanc, sépia, cinéma, vignette, grain,
// flou de profondeur. La scène est dessinée dans une image (avec sa profondeur), puis repeinte par un shader ; le moteur du
// jeu passe par ici quand world.post.active est vrai (même contrat que son propre post-traitement). L'image filtrée est celle
// du canvas : l'export vidéo la filme telle quelle.
// Thermique : un second dessin marque ce qui est « chaud » (personnages, véhicules), caché par ce qui est devant ; le décor
// reste froid.
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = `
precision highp float;
uniform sampler2D tScene, tMask, tDepth; uniform vec2 res; uniform float time, vignette, grain, dof, focus, near, far; uniform int mode;
varying vec2 vUv;
vec3 toSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
// (palette « fer » des caméras thermiques : noir, violet, rouge, orange, jaune, blanc)
vec3 iron(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 a = vec3(0.02, 0.0, 0.10), b = vec3(0.32, 0.0, 0.55), c = vec3(0.86, 0.12, 0.25), d = vec3(1.0, 0.55, 0.05), e = vec3(1.0, 0.92, 0.35), f = vec3(1.0);
  if (h < 0.2) return mix(a, b, h / 0.2); if (h < 0.45) return mix(b, c, (h - 0.2) / 0.25); if (h < 0.7) return mix(c, d, (h - 0.45) / 0.25);
  if (h < 0.9) return mix(d, e, (h - 0.7) / 0.2); return mix(e, f, (h - 0.9) / 0.1);
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

export function createFX(THREE, world) {
  const depth = new THREE.DepthTexture(2, 2); depth.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthTexture: depth, samples: 0 });
  const mask = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  const U = { tScene: { value: rt.texture }, tMask: { value: mask.texture }, tDepth: { value: depth }, res: { value: new THREE.Vector2(2, 2) }, time: { value: 0 },
    vignette: { value: 0 }, grain: { value: 0 }, dof: { value: 0 }, focus: { value: 12 }, near: { value: 0.05 }, far: { value: 400 }, mode: { value: 0 } };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: U, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  quad.frustumCulled = false;
  const qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qScene.add(quad);
  const COLD = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }), HOT = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const size = new THREE.Vector2(), clear = new THREE.Color();
  // (ce qui est chaud : les personnages et leurs chiens, les véhicules des joueurs, ceux de passage, la circulation)
  const hot = () => {
    const S = new Set();
    for (const a of world.avatars.values()) { S.add(a.group); if (a.dog?.g) S.add(a.dog.g); }
    for (const V of world.pvs?.values() || []) if (V.mesh) S.add(V.mesh);
    for (const L of world.limos?.values() || []) if (L.mesh) S.add(L.mesh);
    for (const m of world.carMeshes || []) S.add(m);
    return S;
  };
  const fx = {
    active: false, cfg: null, focus: 12,
    /** cfg : { filter, vignette, grain, dof } de la caméra à l'image, ou null (pas de filtre) */
    use(cfg, focus = 12) { fx.cfg = cfg; fx.focus = focus; fx.active = !!cfg && !!(MODES[cfg.filter] || cfg.vignette > 0.001 || cfg.grain > 0.001 || cfg.dof > 0.001); },
    set() {},   // (contrat du moteur : rien à régler d'ici)
    render(renderer, scene, cam) {
      const cfg = fx.cfg || {}; renderer.getDrawingBufferSize(size);
      if (rt.width !== size.x || rt.height !== size.y) { rt.setSize(size.x, size.y); mask.setSize(size.x, size.y); }
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt); renderer.render(scene, cam);
      const mode = MODES[cfg.filter] || 0;
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
      U.res.value.copy(size); U.time.value = (Date.now() % 100000) / 1000; U.mode.value = mode;
      U.vignette.value = cfg.vignette || 0; U.grain.value = cfg.grain || 0; U.dof.value = cfg.dof || 0; U.focus.value = Math.max(0.5, fx.focus);
      U.near.value = cam.near; U.far.value = cam.far;
      renderer.setRenderTarget(prev); renderer.render(qScene, qCam);
    },
    dispose() { rt.dispose(); mask.dispose(); depth.dispose(); quad.geometry.dispose(); quad.material.dispose(); COLD.dispose(); HOT.dispose(); },
  };
  return fx;
}

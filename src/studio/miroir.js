// Big Street Studio — un miroir plan (reflet réel de la scène), d'après le « Reflector » de three.js, réduit à l'essentiel et fabriqué
// avec le three.js du jeu (comme tcontrols.js : rien n'est chargé hors du launcher). Le miroir regarde vers +Z ; son origine est
// au milieu de son bord bas (il se pose par terre). À chaque image où il est visible, la scène est dessinée une fois de plus, vue
// depuis l'autre côté de la glace, dans une texture de « q » pixels de côté.
export function makeMirror(THREE, { w = 2, h = 2.4, q = 512, tint = '#ffffff' } = {}) {
  const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
  const rt = new THREE.WebGLRenderTarget(q, Math.max(64, Math.round(q * h / w)), { samples: 0, type: THREE.HalfFloatType });
  const cam = new THREE.PerspectiveCamera(), plane = new THREE.Plane(), normal = new THREE.Vector3(), pos = new THREE.Vector3(), cpos = new THREE.Vector3(), rot = new THREE.Matrix4();
  const look = new THREE.Vector3(), clip = new THREE.Vector4(), view = new THREE.Vector3(), target = new THREE.Vector3(), qv = new THREE.Vector4(), tm = new THREE.Matrix4();
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(tint) }, tDiffuse: { value: rt.texture }, textureMatrix: { value: tm } },
    vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; void main() { vUv = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv;\nvoid main() {\n  vec4 b = texture2DProj(tDiffuse, vUv); gl_FragColor = vec4(b.rgb * color, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.userData.stMirror = true; mesh.frustumCulled = true;
  let busy = false;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (busy || camera === cam || mesh.userData.off) return;
    pos.setFromMatrixPosition(mesh.matrixWorld); cpos.setFromMatrixPosition(camera.matrixWorld); rot.extractRotation(mesh.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rot); view.subVectors(pos, cpos);
    if (view.dot(normal) > 0) return;   // (vu de dos : pas de reflet)
    view.reflect(normal).negate().add(pos);
    rot.extractRotation(camera.matrixWorld); look.set(0, 0, -1).applyMatrix4(rot).add(cpos);
    target.subVectors(pos, look).reflect(normal).negate().add(pos);
    cam.position.copy(view); cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); cam.lookAt(target);
    cam.far = camera.far; cam.near = camera.near; cam.layers.mask = camera.layers.mask; cam.updateMatrixWorld(); cam.projectionMatrix.copy(camera.projectionMatrix); cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(mesh.matrixWorld);
    // (plan de coupe oblique : rien de ce qui est DERRIÈRE la glace n'entre dans le reflet)
    plane.setFromNormalAndCoplanarPoint(normal, pos).applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = cam.projectionMatrix.elements;
    qv.x = (Math.sign(clip.x) + p[8]) / p[0]; qv.y = (Math.sign(clip.y) + p[9]) / p[5]; qv.z = -1; qv.w = (1 + p[10]) / p[14];
    clip.multiplyScalar(2 / clip.dot(qv));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1 - 0.003; p[14] = clip.w;
    busy = true; mesh.visible = false;
    const cur = renderer.getRenderTarget(), xr = renderer.xr.enabled, sh = renderer.shadowMap.autoUpdate, face = renderer.getActiveCubeFace?.() ?? 0, mip = renderer.getActiveMipmapLevel?.() ?? 0;
    renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    try { renderer.setRenderTarget(rt); renderer.state.buffers.depth.setMask(true); if (renderer.autoClear === false) renderer.clear(); renderer.render(scene, cam); }
    catch (e) { if (!mesh.userData.err) { mesh.userData.err = true; console.warn('miroir : reflet impossible', e); } }
    renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sh; renderer.setRenderTarget(cur, face, mip);
    const vp = camera.viewport; if (vp !== undefined) renderer.state.viewport(vp);
    mesh.visible = true; busy = false;
  };
  return { mesh, w, h, q, setTint(c) { mat.uniforms.color.value.set(c); }, dispose() { rt.dispose(); geo.dispose(); mat.dispose(); } };
}

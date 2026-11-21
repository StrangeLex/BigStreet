// Big Street Studio — l'aperçu incrusté : en bas à droite de la vue, ce que voit la caméra sélectionnée à l'instant de la frise, au
// format de l'image exportée, avec ses filtres, son raytracing et ses ombres. Léger : une petite image, quelques fois par seconde.
// Il n'est jamais dessiné dans le canvas principal (l'export le filmerait) : la scène est rendue dans une image à part, relue, puis
// peinte dans un petit canvas 2D. Les pyramides et les poignées des caméras n'y figurent pas.
export function createPip(THREE, world, giz, fx, canvas) {
  const ctx = canvas.getContext('2d'), cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 400);
  let target = null, buf = null, img = null, W = 0, H = 0, last = 0, err = null, drawn = 0;
  const pip = {
    get drawn() { return drawn; }, get error() { return err; }, get size() { return [W, H]; },
    /**
     * pose : la caméra dans le monde { x, y, z, yaw, pitch, roll, fov } ; cfg : ses réglages d'image (fxAt) ; focus : distance de mise
     * au point ; aspect : format de l'image ; every : au plus une image toutes les « every » millisecondes (heure vraie).
     */
    draw(pose, cfg, focus, aspect, now, every = 180) {
      if (now - last < every) return false; last = now;
      const w = 320, h = Math.max(90, Math.min(240, Math.round(w / Math.max(0.5, aspect))));
      if (w !== W || h !== H) { W = w; H = h; target?.dispose(); target = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false }); buf = new Uint8Array(W * H * 4); img = ctx.createImageData(W, H); canvas.width = W; canvas.height = H; }
      const R = world.renderer, main = world.camera, touched = [];
      try {
        cam.fov = Math.max(5, Math.min(130, pose.fov)); cam.aspect = W / H; cam.near = main.near; cam.far = main.far; cam.updateProjectionMatrix();
        cam.position.set(pose.x, pose.y, pose.z); giz.quatOf(pose, cam.quaternion); cam.layers.mask = main.layers.mask; cam.updateMatrixWorld(true);
        // (le moteur ne dessine ni ne met à jour le corps des personnages sortis de la vue principale : ceux qui sont près de cette
        // caméra sont remis le temps de l'aperçu)
        for (const a of world.avatars.values()) {
          if (!a.body || a.body.visible || !a.group.visible || a.skinKey || a.pvSeat || Math.hypot(a.group.position.x - pose.x, a.group.position.z - pose.z) > 70) continue;
          a.body.visible = true; a.group.updateMatrixWorld(true); touched.push(a);
        }
        giz.veil(true);
        fx.use(cfg, focus); fx.render(R, world.scene, cam, { target, w: W, h: H });
        R.readRenderTargetPixels(target, 0, 0, W, H, buf);
        // (l'image lue est à l'envers : première ligne en bas)
        const row = W * 4, d = img.data; for (let y = 0; y < H; y++) d.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
        for (let i = 3; i < d.length; i += 4) d[i] = 255;
        ctx.putImageData(img, 0, 0); drawn++;
      } catch (e) { if (!err) { err = String(e?.message || e); console.warn('aperçu indisponible', e); } }
      finally { giz.veil(false); for (const a of touched) a.body.visible = false; R.setRenderTarget(null); }
      return true;
    },
    dispose() { target?.dispose(); },
  };
  return pip;
}

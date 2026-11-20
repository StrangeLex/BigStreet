// Big Street Studio — l'interface : liste des records, caméra libre, frise chronologique, caméras posées et travellings.
// Le moteur 3D est celui du jeu (chargé par le relais local du launcher, cf. studio-main.js) ; la relecture d'un record
// est faite par /js/studio-play.js, qui vit avec le jeu.
const $ = s => document.querySelector(s);
const api = window.bsStudio, API = 1;   // (API : version du module /js/studio-play.js attendue — STUDIO_API)
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  e.append(...kids.filter(k => k != null)); return e;
};
function toast(text, err = false) { const t = el('div', { class: 'toast' + (err ? ' err' : ''), text }); $('#toasts').append(t); setTimeout(() => t.remove(), err ? 7000 : 4000); }
const fmt = ms => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const fmtDur = ms => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; };
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const realNow = performance.now.bind(performance);   // (l'heure vraie : le moteur, lui, suit la vitesse de lecture)

// ---------------------------------------------------------------- État
let lib = null, clock = null, world = null, pb = null, rec = null, cur = null;
let T = 0, playing = false, rate = 1, mode = 'free', seekNext = true, opening = false;
const cam = { x: 0, y: 3, z: 0, yaw: 0, pitch: -0.1, roll: 0, fov: 60 };
const view = { dist: 160, real: realNow };
let speed = 12, keys = [], sel = -1, saveTimer = 0, exporting = null, onCineEnd = null, povHead = null;
const held = new Set();
try { const s = JSON.parse(localStorage.getItem('studio.view') || '{}'); if (s.dist) view.dist = clamp(+s.dist, 60, 600); if (s.speed) speed = clamp(+s.speed, 1, 120); } catch { /* réglages par défaut */ }
const keepView = () => { try { localStorage.setItem('studio.view', JSON.stringify({ dist: view.dist, speed })); } catch { /* tant pis */ } };

// ---------------------------------------------------------------- Liste des records
let records = [];
async function refresh() {
  const r = await api.list().catch(() => null);
  const box = $('#recList'); box.replaceChildren();
  if (!r) { box.append(el('div', { class: 'none', text: 'Dossier des records inaccessible.' })); return; }
  records = r.records; $('#sideFoot').textContent = r.dir;
  if (r.recording) box.append(el('div', { class: 'rec' }, el('div', { class: 'name', text: 'Record en cours…' }), el('div', { class: 'tags' }, el('span', { class: 'tag live', text: '● en jeu' }))));
  if (!records.length && !r.recording) box.append(el('div', { class: 'none' }, 'Aucun record pour le moment.', el('br'), el('br'), 'En jeu : Échap → Studio → « Start Record ».'));
  let day = '';
  for (const it of records) {
    const d = new Date(it.date), dk = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (dk !== day) { day = dk; box.append(el('div', { class: 'day', text: dk })); }
    const card = el('div', { class: 'rec' + (cur?.name === it.name ? ' on' : ''), title: it.name, onclick: () => openRecord(it) },
      el('div', { class: 'name', text: it.roomName || it.room || 'Lieu inconnu' }),
      el('div', { class: 'meta' }, el('span', { text: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }), el('span', { text: fmtDur(it.dur || 0) }), el('span', { text: fmtSize(it.size) }), el('span', { text: `rayon ${it.radius}` })),
      el('div', { class: 'tags' }, it.player ? el('span', { class: 'tag', text: it.player }) : null, it.auto ? el('span', { class: 'tag', text: 'auto' }) : null,
        it.project ? el('span', { class: 'tag cine', text: '🎬 cinématique' }) : null, it.done ? null : el('span', { class: 'tag live', text: 'interrompu' })),
      el('button', { class: 'del', title: 'Supprimer ce record', text: '🗑', onclick: async e => { e.stopPropagation(); const x = await api.remove(it.name); if (x?.ok) { if (cur?.name === it.name) closeRecord(); refresh(); } } }));
    box.append(card);
  }
}

// ---------------------------------------------------------------- Moteur
async function engine() {
  if (world) return;
  try { lib = await import('/js/studio-play.js'); }
  catch (e) { console.error(e); throw new Error('Le moteur du jeu n’est pas encore sur cet ordinateur : ouvre le Studio une première fois en étant connecté à Internet.'); }
  // (ce module vient du jeu, cette interface du launcher : ils doivent parler la même version)
  if (lib.STUDIO_API !== API) throw new Error(lib.STUDIO_API > API ? 'Le jeu a évolué : mets le launcher à jour pour utiliser le Studio.' : 'Le moteur du jeu gardé sur cet ordinateur est trop ancien : ouvre le Studio une fois en étant connecté à Internet.');
  clock = lib.installClock(); clock.setSpeed(0);
  world = await lib.createStudioWorld($('#view'), $('#overlay'));
  $('#ultra').checked = world.gfx?.ultra ?? true;
  // (la vue change de taille — liste repliée, panneau de caméra — : image recalculée tout de suite, pas d'éclair noir)
  new ResizeObserver(() => { world.resize(); if (pb) { try { world.frame(); } catch { /* prochaine image */ } } }).observe($('#stage'));
}
function busy(text) { $('#loading').hidden = !text; if (text) { $('#loadingText').textContent = text; $('#empty').hidden = true; } }

function closeRecord() {
  pb = null; rec = null; cur = null; playing = false; mode = 'free'; keys = []; sel = -1;
  for (const id of ['#dock', '#topbar', '#settings', '#help']) $(id).hidden = true;
  $('#empty').hidden = false; $('#overlay').replaceChildren(); $('#view').style.visibility = 'hidden';
  if (document.pointerLockElement) document.exitPointerLock();
}
async function openRecord(it) {
  if (opening || exporting) return; opening = true;
  try {
    if (cur) await saveProject(true);
    busy('Chargement du moteur du jeu…'); await engine();
    busy(`Lecture du record — ${it.roomName || it.room}…`);
    const res = await fetch('/__studio/rec/' + encodeURIComponent(it.name)); if (!res.ok) throw new Error('Record introuvable.');
    const next = lib.parseRecord(await res.text());
    busy('Reconstruction du lieu…');
    pb = null; setPlaying(false); mode = 'free'; povRestore();
    const p = new lib.Playback(world, next);
    await p.load(); lib.attachCamera(world, cam, view);
    rec = next; pb = p; cur = it; T = 0; seekNext = true;
    // (la caméra : derrière le joueur enregistré, tournée vers lui)
    Object.assign(cam, { roll: 0, fov: 60 }); behindPlayer(0);
    keys = []; sel = -1;
    try { const pj = JSON.parse(await api.loadProject(it.name) || 'null'); if (pj?.keys) { keys = pj.keys.filter(k => Number.isFinite(k.t) && Number.isFinite(k.x)); if (pj.rate) setRate(pj.rate); } } catch { /* pas de projet */ }
    sortKeys();
    $('#view').style.visibility = ''; for (const id of ['#dock', '#topbar']) $(id).hidden = false;
    $('#recTitle').textContent = `${it.roomName || it.room} — ${new Date(it.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
    syncSettings(); renderCams(); busy(''); refresh();
    hint('Clique sur la vue pour prendre la caméra · H : commandes', 6000);
  } catch (e) { console.error(e); busy(''); closeRecord(); $('#emptyText').textContent = String(e.message || e); toast(String(e.message || e), true); }
  opening = false;
}

// ---------------------------------------------------------------- Lecture
function setPlaying(on) {
  playing = !!on && !!pb; $('#play').textContent = playing ? '❚❚' : '▶';
  clock?.setSpeed(playing ? rate : 0);
}
function setRate(r) { rate = clamp(+r || 1, 0.05, 8); $('#rate').value = String(rate); if (playing) clock?.setSpeed(rate); }
function seek(t) { if (!rec) return; T = clamp(t, 0, rec.dur); seekNext = true; }
function hint(text, ms = 2500) { const h = $('#hint'); h.textContent = text; h.hidden = !text; clearTimeout(hint.t); if (text && ms) hint.t = setTimeout(() => { h.hidden = true; }, ms); }

// ---------------------------------------------------------------- Caméras et travellings
const EASE = { fluide: u => u, doux: u => u * u * (3 - 2 * u), accel: u => u * u, frein: u => 1 - (1 - u) * (1 - u), fixe: () => 0 };
const CH = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov'];
function sortKeys() {
  const s = keys[sel]; keys.sort((a, b) => a.t - b.t); sel = s ? keys.indexOf(s) : -1;
  // (lacet déroulé d'une caméra à la suivante : le travelling tourne toujours par le plus court)
  for (let i = 1; i < keys.length; i++) { const d = keys[i].yaw - keys[i - 1].yaw; keys[i].yaw = keys[i - 1].yaw + Math.atan2(Math.sin(d), Math.cos(d)); }
}
// La vue du travelling à l'instant t : courbe lisse passant par les caméras (tangentes de Catmull-Rom, selon les durées)
function pathAt(t) {
  const n = keys.length; if (!n) return null;
  if (t <= keys[0].t) return keys[0]; if (t >= keys[n - 1].t) return keys[n - 1];
  let i = 0; while (i + 1 < n && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1]; if (a.ease === 'fixe' || b.t - a.t < 1) return a;
  const D = b.t - a.t, u = (EASE[a.ease] || EASE.fluide)((t - a.t) / D);
  const p = i > 0 && keys[i - 1].ease !== 'fixe' ? keys[i - 1] : null, q = i + 2 < n && b.ease !== 'fixe' ? keys[i + 2] : null;
  const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2, o = {};
  for (const c of CH) {
    const ma = p ? (b[c] - p[c]) / (b.t - p.t) * D : b[c] - a[c], mb = q ? (q[c] - a[c]) / (q.t - a.t) * D : b[c] - a[c];
    o[c] = h00 * a[c] + h10 * ma + h01 * b[c] + h11 * mb;
  }
  o.fov = clamp(o.fov, 5, 130); o.pitch = clamp(o.pitch, -1.55, 1.55);
  return o;
}
function addCam() {
  if (!pb) return;
  const k = { t: Math.round(T), x: cam.x, y: cam.y, z: cam.z, yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll, fov: cam.fov, ease: 'fluide' };
  const near = keys.findIndex(o => Math.abs(o.t - k.t) < 60);
  if (near >= 0) { k.ease = keys[near].ease; keys[near] = k; sel = near; } else { keys.push(k); sel = keys.length - 1; }
  sortKeys(); renderCams(); touch();
  hint(keys.length < 2 ? 'Caméra posée. Avance dans le temps, déplace-toi, puis pose-en une autre : le travelling les relie.' : `Caméra ${sel + 1} posée.`, 4000);
}
function selectCam(i, go = true) {
  sel = i; const k = keys[i];
  if (k && go) { stopCine(); for (const c of CH) cam[c] = k[c]; seek(k.t); syncSettings(); }
  renderCams();
}
function touch() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveProject(true), 1500); }
async function saveProject(quiet = false) {
  clearTimeout(saveTimer); if (!cur) return;
  if (!keys.length && !cur.project) return;
  const r = await api.saveProject(cur.name, JSON.stringify({ v: 1, record: cur.name, rate, keys }, null, 1)).catch(() => null);
  if (r?.ok) { cur.project = true; if (!quiet) toast('💾 Projet enregistré à côté du record.'); } else if (!quiet) toast('Enregistrement du projet impossible.', true);
}
function renderCams() {
  const box = $('#camList'); box.replaceChildren();
  keys.forEach((k, i) => box.append(el('button', { class: 'chip' + (i === sel ? ' sel' : ''), title: 'Aller à cette caméra', onclick: () => selectCam(i) }, el('b', { text: String(i + 1) }), el('small', { text: fmt(k.t) }), k.ease === 'fixe' ? el('small', { text: '✂' }) : null)));
  if (!keys.length) box.append(el('span', { class: 'muted', text: 'Aucune caméra : place la vue, puis « Poser une caméra » (K).' }));
  const marks = $('#tlMarks'); marks.replaceChildren();
  if (rec) keys.forEach((k, i) => { const m = el('div', { class: 'mark' + (i === sel ? ' sel' : ''), title: `Caméra ${i + 1} — glisse pour la déplacer dans le temps` }, el('span', { text: String(i + 1) })); m.style.left = `${k.t / Math.max(1, rec.dur) * 100}%`; m.addEventListener('pointerdown', e => dragMark(e, i)); marks.append(m); });
  const path = $('#tlPath');
  if (rec && keys.length > 1) { path.hidden = false; path.style.left = `${keys[0].t / rec.dur * 100}%`; path.style.width = `${(keys.at(-1).t - keys[0].t) / rec.dur * 100}%`; } else path.hidden = true;
  const k = keys[sel], ed = $('#camEdit'); ed.hidden = !k;
  if (k) { $('#ceName').textContent = `Caméra ${sel + 1}`; $('#ceT').value = (k.t / 1000).toFixed(1); $('#ceT').max = String(rec.dur / 1000); $('#ceFov').value = String(Math.round(k.fov)); $('#ceRoll').value = String(Math.round(k.roll * 180 / Math.PI)); $('#ceEase').value = k.ease || 'fluide'; }
  $('#preview').disabled = $('#export').disabled = keys.length < 2;
}
function dragMark(e, i) {
  e.stopPropagation(); e.preventDefault(); const k = keys[i], box = $('#timeline').getBoundingClientRect(); sel = i; let moved = false;
  const mv = ev => { moved = true; k.t = Math.round(clamp((ev.clientX - box.left) / box.width, 0, 1) * rec.dur); sortKeys(); renderCams(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) touch(); else selectCam(keys.indexOf(k)); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function startCine(done = null) {
  if (keys.length < 2) { toast('Pose au moins deux caméras pour faire un travelling.', true); return false; }
  povRestore(); mode = 'cine'; onCineEnd = done; seek(keys[0].t); setPlaying(true); $('#preview').classList.add('on');
  if (document.pointerLockElement) document.exitPointerLock();
  return true;
}
function stopCine() {
  if (mode !== 'cine') return;
  mode = 'free'; $('#preview').classList.remove('on'); const f = onCineEnd; onCineEnd = null; f?.();
}

// Vue du joueur enregistré : la caméra à ses yeux, tournée comme il regardait
function povRestore() { if (povHead) { povHead.scale.setScalar(1); povHead = null; } $('#povBtn').classList.remove('on'); if (mode === 'pov') mode = 'free'; }
function povApply() {
  const q = pb.where(T); if (!q) return;
  const L = pb.lookAt(T), yaw = L ? L.yaw : Math.atan2(Math.cos(q[3]), Math.sin(q[3])), pitch = L ? L.pitch : -0.05;
  const a = world.avatars.get(pb.me), head = a?.rig?.bones?.tete;
  if (head && head !== povHead) { if (povHead) povHead.scale.setScalar(1); povHead = head; } if (povHead) povHead.scale.setScalar(0.001);
  Object.assign(cam, { x: q[0] + Math.cos(yaw) * 0.22, z: q[1] + Math.sin(yaw) * 0.22, y: (a ? a.group.position.y : q[2] || 0) + (a?.st === 'sit' ? 1.25 : 1.68), yaw, pitch, roll: 0 });
}
// (la caméra derrière le joueur enregistré, tournée vers lui ; dans un bâtiment, sans traverser le mur)
function behindPlayer(t) {
  const q = pb?.where(t); if (!q) return;
  const a = q[3] || 0, out = !!world.room?.outdoor; let d = out ? 5 : 3.2;
  const at = k => [q[0] - Math.sin(a) * k, q[1] - Math.cos(a) * k];
  while (d > 0.6 && !world.isFloor(Math.round(at(d)[0]), Math.round(at(d)[1]))) d -= 0.4;
  const [x, z] = at(d);
  Object.assign(cam, { x, z, y: (q[2] || 0) + (out ? 2.6 : 1.9), pitch: -0.2 }); cam.yaw = Math.atan2(q[1] - z, q[0] - x);
}
function goPlayer() { if (!pb) return; stopCine(); povRestore(); behindPlayer(T); }

// ---------------------------------------------------------------- Export vidéo
async function exportVideo() {
  if (exporting) { stopCine(); return; }
  if (keys.length < 2) return toast('Pose au moins deux caméras pour faire un travelling.', true);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => window.MediaRecorder?.isTypeSupported(m));
  if (!mime) return toast('L’export vidéo n’est pas disponible sur cet ordinateur.', true);
  const st = await api.exportStart(cur.name).catch(() => null); if (!st?.ok) return toast('Impossible de créer le fichier vidéo.', true);
  const stream = $('#view').captureStream(60), mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 24e6 });
  let chain = Promise.resolve();
  mr.ondataavailable = e => { if (e.data.size) chain = chain.then(async () => api.exportChunk(new Uint8Array(await e.data.arrayBuffer()))); };
  mr.onstop = async () => {
    await chain; stream.getTracks().forEach(t => t.stop());
    const r = await api.exportEnd().catch(() => null); exporting = null; $('#recDot').hidden = true; $('#export').textContent = '⏺ Exporter en vidéo'; $('#export').classList.remove('on');
    toast(r?.ok ? `🎬 Vidéo exportée : ${r.file}` : 'Export interrompu.', !r?.ok);
  };
  exporting = mr; $('#recDot').hidden = false; $('#export').textContent = '⏹ Arrêter l’export'; $('#export').classList.add('on');
  if (!startCine(() => { setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, 250); })) { exporting = null; return; }
  mr.start(1000);
}

// ---------------------------------------------------------------- Caméra libre
const MOVE = { KeyW: [1, 0, 0], KeyS: [-1, 0, 0], KeyD: [0, 1, 0], KeyA: [0, -1, 0], Space: [0, 0, 1], KeyC: [0, 0, -1], ControlLeft: [0, 0, -1] };
function moveCamera(dt) {
  if (mode !== 'free') return;
  let f = 0, r = 0, u = 0; const locked = document.pointerLockElement === $('#view');
  for (const c of held) { const m = MOVE[c]; if (!m || (c === 'Space' && !locked)) continue; f += m[0]; r += m[1]; u += m[2]; }
  if (!f && !r && !u) return;
  const v = speed * (held.has('ShiftLeft') || held.has('ShiftRight') ? 3.5 : 1) * dt, cp = Math.cos(cam.pitch), fx = Math.cos(cam.yaw), fz = Math.sin(cam.yaw);
  cam.x += (fx * cp * f - fz * r) * v; cam.z += (fz * cp * f + fx * r) * v; cam.y += (Math.sin(cam.pitch) * f + u) * v;
}
function turn(dx, dy) {
  if (exporting) return;
  if (mode !== 'free') { stopCine(); povRestore(); }
  cam.yaw += dx * 0.0022; cam.pitch = clamp(cam.pitch - dy * 0.0022, -1.55, 1.55);
}
function syncSettings() {
  $('#spd').value = String(speed); $('#spdV').textContent = `${speed} cases/s`;
  $('#fov').value = String(Math.round(cam.fov)); $('#fovV').textContent = `${Math.round(cam.fov)}°`;
  $('#roll').value = String(Math.round(cam.roll * 180 / Math.PI)); $('#rollV').textContent = `${Math.round(cam.roll * 180 / Math.PI)}°`;
  $('#dist').value = String(view.dist); $('#distV').textContent = `${view.dist} cases`;
}

// ---------------------------------------------------------------- Boucle d'image
let last = realNow();
function loop() {
  requestAnimationFrame(loop);
  const now = realNow(), dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (!pb || !world) return;
  if (playing) {
    T += dt * 1000 * rate;
    const end = mode === 'cine' && keys.length ? keys.at(-1).t : rec.dur;
    if (T >= end) { T = end; setPlaying(false); if (mode === 'cine') { const k = pathAt(T); if (k) for (const c of CH) cam[c] = k[c]; stopCine(); } }
  }
  moveCamera(dt);
  if (mode === 'cine') { const k = pathAt(T); if (k) for (const c of CH) cam[c] = k[c]; } else if (mode === 'pov') povApply();
  pb.eye = { x: cam.x, z: cam.z, r: view.dist + 10 };
  try { pb.step(T, seekNext); seekNext = false; world.frame(); } catch (e) { if (!loop.err) { loop.err = true; console.error(e); toast('Erreur d’affichage : ' + (e.message || e), true); } }
  $('#time').textContent = `${fmt(T)} / ${fmt(rec.dur)}`;
  const k = T / Math.max(1, rec.dur) * 100; $('#tlFill').style.width = `${k}%`; $('#tlHead').style.left = `${k}%`;
}

// ---------------------------------------------------------------- Commandes
function bind() {
  const cv = $('#view');
  $('#refresh').onclick = refresh; $('#folder').onclick = () => api.openFolder();
  $('#toggleSide').onclick = () => $('#app').classList.toggle('no-side');
  $('#play').onclick = () => { if (!pb) return; if (!playing && T >= rec.dur - 1) seek(0); setPlaying(!playing); };
  $('#rate').onchange = e => { setRate(e.target.value); touch(); };
  $('#addCam').onclick = addCam; $('#saveProj').onclick = () => saveProject(false); $('#export').onclick = exportVideo;
  $('#preview').onclick = () => { if (mode === 'cine') { setPlaying(false); stopCine(); } else startCine(); };
  $('#goPlayer').onclick = goPlayer;
  $('#povBtn').onclick = () => { if (!pb) return; if (mode === 'pov') povRestore(); else { stopCine(); mode = 'pov'; $('#povBtn').classList.add('on'); } };
  $('#tagsBtn').onclick = () => $('#tagsBtn').classList.toggle('on', !$('#overlay').classList.toggle('hide-tags'));
  $('#tagsBtn').classList.add('on');
  $('#setBtn').onclick = () => { $('#help').hidden = true; $('#settings').hidden = !$('#settings').hidden; };
  $('#helpBtn').onclick = () => { $('#settings').hidden = true; $('#help').hidden = !$('#help').hidden; };
  $('#spd').oninput = e => { speed = +e.target.value; syncSettings(); keepView(); };
  $('#fov').oninput = e => { cam.fov = +e.target.value; syncSettings(); };
  $('#roll').oninput = e => { cam.roll = +e.target.value * Math.PI / 180; syncSettings(); };
  $('#dist').oninput = e => { view.dist = +e.target.value; syncSettings(); keepView(); };
  $('#ultra').onchange = e => world?.applyGfx({ ultra: e.target.checked });
  $('#bars').onchange = e => { $('#letterbox').hidden = !e.target.checked; };
  // Édition de la caméra choisie
  const edit = fn => () => { const k = keys[sel]; if (!k) return; fn(k); sortKeys(); renderCams(); touch(); };
  $('#ceT').onchange = edit(k => { k.t = Math.round(clamp(+$('#ceT').value || 0, 0, rec.dur / 1000) * 1000); });
  $('#ceFov').onchange = edit(k => { k.fov = clamp(+$('#ceFov').value || 60, 10, 120); });
  $('#ceRoll').onchange = edit(k => { k.roll = clamp(+$('#ceRoll').value || 0, -45, 45) * Math.PI / 180; });
  $('#ceEase').onchange = edit(k => { k.ease = $('#ceEase').value; });
  $('#ceHere').onclick = edit(k => { for (const c of CH) k[c] = cam[c]; });
  $('#ceNow').onclick = edit(k => { k.t = Math.round(T); });
  $('#ceDel').onclick = () => { if (!keys[sel]) return; keys.splice(sel, 1); sel = Math.min(sel, keys.length - 1); sortKeys(); renderCams(); touch(); };
  // Frise : cliquer ou glisser pour se déplacer dans le temps
  const tl = $('#timeline');
  tl.addEventListener('pointerdown', e => {
    if (!rec || exporting) return; const box = tl.getBoundingClientRect(), was = playing; setPlaying(false); if (mode === 'cine') stopCine();
    const go = ev => seek(clamp((ev.clientX - box.left) / box.width, 0, 1) * rec.dur); go(e);
    const up = () => { removeEventListener('pointermove', go); removeEventListener('pointerup', up); if (was) setPlaying(true); };
    addEventListener('pointermove', go); addEventListener('pointerup', up);
  });
  // Souris : clic = prendre la caméra ; clic droit maintenu = tourner sans la prendre ; molette = vitesse
  let rdrag = false;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => { if (!pb) return; $('#settings').hidden = $('#help').hidden = true; if (e.button === 2) { rdrag = true; cv.setPointerCapture(e.pointerId); } else if (e.button === 0 && !exporting) cv.requestPointerLock?.(); });
  cv.addEventListener('pointerup', e => { if (e.button === 2) rdrag = false; });
  addEventListener('mousemove', e => { if (document.pointerLockElement === cv || rdrag) turn(e.movementX, e.movementY); });
  cv.addEventListener('wheel', e => { e.preventDefault(); speed = clamp(Math.round(speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2) * 10) / 10 || 1, 1, 120); speed = Math.round(speed); syncSettings(); keepView(); hint(`Vitesse de la caméra : ${speed} cases/s`, 1200); }, { passive: false });
  document.addEventListener('pointerlockchange', () => { const on = document.pointerLockElement === cv; hint(on ? 'Caméra prise — Échap pour la lâcher' : '', 2500); if (!on) held.clear(); });
  addEventListener('blur', () => held.clear());
  addEventListener('keydown', e => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.code === 'Tab') { e.preventDefault(); $('#app').classList.toggle('no-side'); return; }
    if (!pb) return;
    const locked = document.pointerLockElement === cv;
    if (MOVE[e.code] || e.code.startsWith('Shift')) { held.add(e.code); if (MOVE[e.code] && mode !== 'free' && !exporting && !(e.code === 'Space' && !locked)) { stopCine(); povRestore(); } }
    if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!locked) $('#play').click(); }
    else if (e.code === 'ArrowLeft') seek(T - 2000); else if (e.code === 'ArrowRight') seek(T + 2000);
    else if (e.code === 'KeyK') addCam(); else if (e.code === 'KeyP') $('#preview').click();
    else if (e.code === 'KeyJ') goPlayer(); else if (e.code === 'KeyV') $('#povBtn').click();
    else if (e.code === 'KeyN') $('#tagsBtn').click(); else if (e.code === 'KeyH') $('#helpBtn').click();
  });
  addEventListener('keyup', e => held.delete(e.code));
  addEventListener('beforeunload', () => { if (cur && keys.length) api.saveProject(cur.name, JSON.stringify({ v: 1, record: cur.name, rate, keys }, null, 1)); });
  api.onChanged(() => refresh());
}

bind(); closeRecord(); refresh(); requestAnimationFrame(loop);
// (outils de test du launcher : ouvrir un record par son nom, lire l'état)
window.__studio = { open: name => { const it = records.find(r => r.name === name); return it ? openRecord(it) : Promise.reject(new Error('record absent')); }, seek, addCam, startCine,
  get state() { return { ready: !!pb, T, dur: rec?.dur || 0, avatars: world?.avatars.size || 0, keys: keys.length, mode, cam: { ...cam }, room: world?.room?.id || null, chunks: world?.chunkQueue?.length || 0 }; },
  set(o) { Object.assign(cam, o); }, play: setPlaying, get world() { return world; }, get me() { return pb?.me; }, where: t => pb?.where(t) };

// Fenêtre « Console » (F10) : journal filtrable et copiable, infos en direct, champ de commande (historique, Tab).
// Tout le texte est posé en textContent : rien de ce qui vient du jeu n'est interprété comme du HTML.
(() => {
  const $ = s => document.querySelector(s);
  const logEl = $('#log'), statsEl = $('#stats'), cmd = $('#cmd'), hint = $('#hint'), search = $('#search'), follow = $('#follow');
  const CATS = [
    ['game', 'Jeu', ['game', 'info', 'out']], ['net', 'Réseau', ['net']], ['room', 'Salles', ['room']], ['chat', 'Chat', ['chat']],
    ['js', 'JS', ['js']], ['warn', 'Avert.', ['warn']], ['error', 'Erreurs', ['error']], ['cmd', 'Commandes', ['cmd']], ['launcher', 'Launcher', ['launcher']],
  ];
  const CAT_OF = {}; for (const [k, , lv] of CATS) for (const l of lv) CAT_OF[l] = k;
  const NAMES = { game: 'jeu', info: 'jeu', out: 'sortie', net: 'réseau', room: 'salle', chat: 'chat', js: 'js', warn: 'avert.', error: 'erreur', cmd: 'cmd', launcher: 'launcher' };
  let off = new Set(); try { off = new Set(JSON.parse(localStorage.getItem('bs.con.off') || '[]')); } catch { /* rien */ }
  let lines = [], cmds = [], history = [], hIdx = -1, draft = '';
  const counts = {};

  // ------------------------------------------------------------ filtres
  const filters = $('#filters');
  for (const [k, label] of CATS) {
    const lab = document.createElement('label'), box = document.createElement('input'), n = document.createElement('span');
    box.type = 'checkbox'; box.checked = !off.has(k); n.className = 'n'; n.dataset.cat = k;
    lab.append(box, document.createTextNode(label), n); lab.classList.toggle('off', off.has(k));
    box.addEventListener('change', () => { if (box.checked) off.delete(k); else off.add(k); lab.classList.toggle('off', !box.checked); try { localStorage.setItem('bs.con.off', JSON.stringify([...off])); } catch { /* rien */ } renderAll(); });
    filters.append(lab);
  }
  const updCounts = () => { for (const n of filters.querySelectorAll('.n')) n.textContent = counts[n.dataset.cat] ? String(counts[n.dataset.cat]) : ''; };

  // ------------------------------------------------------------ journal
  const p2 = n => String(n).padStart(2, '0');
  const hms = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  const shown = e => !off.has(CAT_OF[e.lvl] || 'game') && (!search.value || (e.text + ' ' + (e.src || '')).toLowerCase().includes(search.value.toLowerCase()));
  function row(e) {
    const d = document.createElement('div'); d.className = 'l ' + e.lvl;
    const t = document.createElement('span'); t.className = 't'; t.textContent = hms(e.t);
    const c = document.createElement('span'); c.className = 'c'; c.textContent = NAMES[e.lvl] || e.lvl;
    const x = document.createElement('span'); x.className = 'x'; x.textContent = e.text;
    if (e.src) { const s = document.createElement('span'); s.className = 's'; s.textContent = e.src; x.append(s); }
    d.append(t, c, x); return d;
  }
  const atBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
  function renderAll() {
    const f = document.createDocumentFragment();
    for (const e of lines) if (shown(e)) f.append(row(e));
    logEl.replaceChildren(f); logEl.scrollTop = logEl.scrollHeight;
  }
  function add(list) {
    const stick = follow.checked && atBottom(), f = document.createDocumentFragment();
    for (const e of list) { lines.push(e); counts[CAT_OF[e.lvl] || 'game'] = (counts[CAT_OF[e.lvl] || 'game'] || 0) + 1; if (shown(e)) f.append(row(e)); }
    if (lines.length > 3000) { lines.splice(0, lines.length - 3000); renderAll(); } else logEl.append(f);
    while (logEl.childElementCount > 3000) logEl.firstElementChild.remove();
    if (stick || (follow.checked && list.some(e => e.lvl === 'cmd'))) logEl.scrollTop = logEl.scrollHeight;
    updCounts();
  }
  search.addEventListener('input', renderAll);
  $('#clear').addEventListener('click', () => bsCon.exec('clear'));
  $('#copy').addEventListener('click', async () => {
    const txt = lines.filter(shown).map(e => `[${hms(e.t)}] [${NAMES[e.lvl] || e.lvl}] ${e.text}${e.src ? `  (${e.src})` : ''}`).join('\n');
    const b = $('#copy'); b.textContent = (await bsCon.copy(txt)) ? 'Copié ✓' : 'Échec'; setTimeout(() => { b.textContent = 'Copier'; }, 1200);
  });

  // ------------------------------------------------------------ infos en direct
  const cls = (v, good, mid, inv) => (v == null ? '' : inv ? (v <= good ? 'good' : v <= mid ? 'mid' : 'bad') : (v >= good ? 'good' : v >= mid ? 'mid' : 'bad'));
  function renderStats(s) {
    s = s || {};
    const rows = [
      ['images/s', s.fps || '—', cls(s.fps, 50, 30)],
      ['ping', s.ping == null ? '—' : `${s.ping} ms${s.via === 'http' ? ' (http)' : ''}`, cls(s.ping, 120, 300, true)],
      ['serveur', s.server ? `${s.server.name}` : (s.inGame === false ? 'accueil' : '—')],
      ['joueur', s.me ? `${s.me}${s.admin ? ' (admin)' : ''}` : '—'],
      ['salle', s.room ? `${s.room.name} (${s.room.id})` : '—'],
      ['position', s.pos ? s.pos.join('  ') : '—'],
      ['plan', s.plan || (s.room ? '—' : '—')],
      ['PNJ visibles', s.npcs ?? '—'], ['joueurs visibles', s.players ?? '—'],
      ['objets (salle)', s.items ?? '—'], ['dessins / image', s.draw ?? '—'], ['triangles', s.tris != null ? Number(s.tris).toLocaleString('fr-FR') : '—'],
      ['réseau ↓', s.net ? `${s.net.inKB} Ko/s · ${s.net.msgs} msg/s` : '—'], ['réseau ↑', s.net ? `${s.net.outKB} Ko/s` : '—'],
      ['mémoire JS', s.heap != null ? `${s.heap} / ${s.heapMax} Mo` : '—'], ['mémoire jeu', s.procMem != null ? `${s.procMem} Mo` : '—'],
      ['version du jeu', s.game || '—'], ['launcher', s.launcher || '—'],
    ];
    const f = document.createDocumentFragment();
    for (const [k, v, c] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = String(v); if (c) dd.className = c; f.append(dt, dd); }
    statsEl.replaceChildren(f);
  }

  // ------------------------------------------------------------ commande : historique et complétion
  let hintSel = -1, hintList = [];
  function matches() {
    const v = cmd.value, sp = v.search(/\s/);
    if (sp < 0) { const q = v.toLowerCase(); return q ? cmds.filter(c => c.name.startsWith(q)).map(c => ({ fill: c.name + ' ', c })) : []; }
    const name = v.slice(0, sp).toLowerCase(), c = cmds.find(x => x.name === name), rest = v.slice(sp).trimStart();
    if (!c) return [];
    if (c.opts && !/\s/.test(rest)) return c.opts.filter(o => o.toLowerCase().startsWith(rest.toLowerCase())).map(o => ({ fill: `${name} ${o}`, c, opt: o }));
    return [{ fill: null, c }];
  }
  function showHint() {
    hintList = matches();
    if (!hintList.length || !cmd.value) { hint.hidden = true; return; }
    const f = document.createDocumentFragment();
    hintList.slice(0, 12).forEach((m, i) => {
      const d = document.createElement('div'); if (i === hintSel) d.className = 'sel';
      const b = document.createElement('b'); b.textContent = m.opt || m.c.name;
      d.append(b, document.createTextNode(m.opt ? '' : ` ${m.c.args || ''}  — ${m.c.help || ''}${m.c.admin ? ' (admin)' : ''}`));
      f.append(d);
    });
    if (hintList.length > 12) f.append(document.createTextNode(`… ${hintList.length - 12} de plus`));
    hint.replaceChildren(f); hint.hidden = false;
  }
  const common = arr => arr.reduce((a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); });
  function complete() {
    const m = matches().filter(x => x.fill);
    if (!m.length) return;
    if (m.length === 1) { cmd.value = m[0].fill; hintSel = -1; }
    else {
      const pre = common(m.map(x => x.fill));
      if (pre.length > cmd.value.length) cmd.value = pre;
      else { hintSel = (hintSel + 1) % m.length; cmd.value = m[hintSel].fill.trimEnd(); }
    }
    showHint();
  }
  cmd.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); complete(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!history.length) return;
      if (hIdx < 0) { draft = cmd.value; hIdx = history.length; }
      hIdx = Math.max(0, Math.min(history.length, hIdx + (e.key === 'ArrowUp' ? -1 : 1)));
      cmd.value = hIdx === history.length ? draft : history[hIdx];
      if (hIdx === history.length) hIdx = -1;
      cmd.setSelectionRange(cmd.value.length, cmd.value.length); hint.hidden = true; return;
    }
    if (e.key === 'Escape') { if (!hint.hidden) hint.hidden = true; else cmd.value = ''; }
  });
  cmd.addEventListener('input', () => { hIdx = -1; hintSel = -1; showHint(); });
  $('#cmdForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = cmd.value.trim(); if (!v) return;
    if (history.at(-1) !== v) history.push(v);
    history = history.slice(-100); hIdx = -1; cmd.value = ''; hint.hidden = true;
    follow.checked = true; bsCon.exec(v);
  });
  // (taper n'importe où renvoie au champ de commande, sauf pour copier une sélection)
  document.addEventListener('keydown', e => {
    if (e.target === cmd || e.target === search || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    cmd.focus();
  });

  // ------------------------------------------------------------ branchement
  bsCon.onLines(add);
  bsCon.onStats(renderStats);
  bsCon.onCmds(c => { cmds = Array.isArray(c) ? c : []; showHint(); });
  bsCon.onClear(() => { lines = []; for (const k of Object.keys(counts)) delete counts[k]; logEl.replaceChildren(); updCounts(); });
  bsCon.init().then(s => {
    if (!s) return;
    cmds = s.cmds || []; history = (s.history || []).slice();
    add(s.lines || []); renderStats(s.stats); cmd.focus();
  });
  window.addEventListener('focus', () => cmd.focus());
})();

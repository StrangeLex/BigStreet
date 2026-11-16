/* Interface du launcher. Aucun accès direct au système : tout passe par le
   pont `bs` exposé par le preload. */
const $ = s => document.querySelector(s);

// ---- barre de titre ----
$('#min').onclick = () => bs.minimize();
$('#close').onclick = () => bs.close();

// ---- onglets ----
document.querySelectorAll('.side button[data-tab]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.side button[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    for (const t of ['play', 'notes', 'opt']) {
      document.getElementById('tab-' + t).style.display = (t === b.dataset.tab) ? '' : 'none';
    }
    if (b.dataset.tab === 'notes') loadNotes();
  };
});

// ---- connexion ----
function showAccount(acc) {
  const on = !!acc;
  $('#loginBox').style.display = on ? 'none' : '';
  $('#playBox').style.display = on ? '' : 'none';
  $('#who').innerHTML = on
    ? `<b>${esc(acc.name)}</b>Connecté`
    : '<b>Non connecté</b>Connecte-toi pour jouer';
  if (on) $('#playHint').textContent =
    `Tu es connecté en tant que ${acc.name}. Le jeu s'ouvrira dans une nouvelle fenêtre.`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#login').onclick = async () => {
  const name = $('#u').value.trim(), password = $('#p').value;
  const msg = $('#loginMsg');
  if (!name || !password) { msg.className = 'msg err'; msg.textContent = 'Pseudo et mot de passe requis.'; return; }
  $('#login').disabled = true; msg.className = 'msg'; msg.textContent = 'Connexion…';
  const r = await bs.login(name, password);
  $('#login').disabled = false;
  if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error || 'Connexion impossible.'; return; }
  msg.textContent = ''; $('#p').value = '';
  showAccount(r.account);
};

$('#logout').onclick = async () => { await bs.logout(); showAccount(null); };

$('#play').onclick = async () => {
  const msg = $('#playMsg');
  $('#play').disabled = true; msg.className = 'msg'; msg.textContent = 'Ouverture…';
  const r = await bs.play();
  $('#play').disabled = false;
  if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error || 'Lancement impossible.'; return; }
  msg.textContent = '';
};

// ---- notes de version ----
let notesLoaded = false;
async function loadNotes() {
  if (notesLoaded) return;
  notesLoaded = true;
  const box = $('#notes');
  const list = await bs.notes();
  if (!list.length) { box.textContent = 'Aucune note de version pour le moment.'; return; }
  box.innerHTML = list.map(n => `
    <article>
      <h3>${esc(n.title)}</h3>
      <time>${esc(n.date)}</time>
      <p>${esc(n.body || 'Pas de description.')}</p>
    </article>`).join('');
}

// ---- options ----
let settings = null;
function paintRam() {
  const pct = Number($('#ram').value);
  const mb = Math.round(settings.totalMb * pct / 100);
  $('#ramVal').textContent = `${pct} % · ${(mb / 1024).toFixed(1)} Go`;
  $('#ramNote').textContent =
    `Ta machine dispose de ${(settings.totalMb / 1024).toFixed(1)} Go. `
    + `Le jeu ne dépassera pas ${(mb / 1024).toFixed(1)} Go. `
    + `La modification s'applique au prochain démarrage du launcher.`;
}
$('#ram').oninput = paintRam;

$('#save').onclick = async () => {
  const msg = $('#optMsg');
  await bs.saveSettings({ ramPercent: Number($('#ram').value) });
  msg.className = 'msg ok';
  msg.textContent = 'Enregistré. Redémarre le launcher pour appliquer la mémoire.';
};

// ---- démarrage ----
(async () => {
  settings = await bs.settings();
  $('#ram').value = settings.ramPercent;
  paintRam();
  const acc = await bs.currentAccount();
  showAccount(acc);
})();

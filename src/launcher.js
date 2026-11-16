/* Interface du launcher. Aucun accès direct au système : tout passe par le
   pont `bs` exposé par le preload. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

// ---- décor : personnages du jeu (src/chars.js) ----
$('#artA').src = CHARS.hero1;
$('#artB').src = CHARS.hero2;
$('#artC').src = CHARS.hero3;

// ---- personnages de départ ----
// Chaque vignette est le rendu exact du look envoyé au site : ce que le joueur
// choisit ici est ce qu'il voit en arrivant en ville. Aucune option payante.
const STARTERS = [
  { id: 'start1', name: 'Passant', look: { gender: 0, skin: 2, hair: 1, hairStyle: 0, top: 0, shirt: 0, bottom: 8, pants: 1, feet: 6, shoes: 0 } },
  { id: 'start2', name: 'Voisine', look: { gender: 1, chest: 2, skin: 3, hair: 4, hairStyle: 4, top: 1, shirt: 10, bottom: 0, pants: 0, feet: 0, shoes: 1 } },
  { id: 'start3', name: 'Discret', look: { gender: 0, skin: 6, hair: 0, hairStyle: 15, beard: 2, top: 3, shirt: 13, bottom: 10, pants: 4, feet: 6, shoes: 2 } },
  { id: 'start4', name: 'Sportive', look: { gender: 1, chest: 1, skin: 5, hair: 0, hairStyle: 12, top: 14, shirt: 5, bottom: 9, pants: 3, feet: 5, shoes: 1 } },
];
let starter = 0;
function paintPicks() {
  $('#picks').innerHTML = STARTERS.map((s, i) =>
    `<button class="pick${i === starter ? ' on' : ''}" data-i="${i}">`
    + `<img src="${CHARS[s.id]}" alt=""><small>${esc(s.name)}</small></button>`).join('');
  $('#picks').querySelectorAll('.pick').forEach(b => {
    b.onclick = () => { starter = Number(b.dataset.i); paintPicks(); };
  });
}
paintPicks();

// ---- bascule connexion / inscription ----
let emailAsked = false;
function authMode(signup) {
  $('#tabLogin').classList.toggle('on', !signup);
  $('#tabSignup').classList.toggle('on', signup);
  $('#loginBox').style.display = signup ? 'none' : '';
  $('#signupBox').style.display = signup ? '' : 'none';
  $('#artCap').textContent = signup
    ? 'Tout se personnalise ensuite en ville.'
    : 'Tout se personnalise en jeu.';
  // Le site n'exige une adresse e-mail que si un service d'envoi est configuré :
  // on le lui demande au lieu de le supposer.
  if (signup && !emailAsked) {
    emailAsked = true;
    bs.registerMode().then(m => { if (m?.emailRequired) $('#emailStep').style.display = ''; }).catch(() => {});
  }
}
$('#tabLogin').onclick = () => authMode(false);
$('#tabSignup').onclick = () => authMode(true);

// ---- connexion ----
function showAccount(acc) {
  const on = !!acc;
  $('#authBox').style.display = on ? 'none' : '';
  $('#playBox').style.display = on ? '' : 'none';
  $('#who').innerHTML = on
    ? `<b>${esc(acc.name)}</b>Connecté`
    : '<b>Non connecté</b>Connecte-toi pour jouer';
  if (on) $('#playHint').textContent =
    `Tu es connecté en tant que ${acc.name}. Le jeu s'ouvrira dans une nouvelle fenêtre.`;
}

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

// ---- inscription ----
const NAME_RE = /^[A-Za-z0-9_\-.]{3,16}$/;   // (même règle que le site)

$('#sendCode').onclick = async () => {
  const msg = $('#signupMsg'), email = $('#se').value.trim(), name = $('#su').value.trim();
  if (!email) { msg.className = 'msg err'; msg.textContent = 'Entre ton adresse e-mail.'; return; }
  $('#sendCode').disabled = true; msg.className = 'msg'; msg.textContent = 'Envoi du code…';
  const r = await bs.registerCode(email, name || undefined);
  $('#sendCode').disabled = false;
  msg.className = 'msg ' + (r.ok ? 'ok' : 'err');
  msg.textContent = r.ok ? r.info : (r.error || 'Envoi impossible.');
};

$('#signup').onclick = async () => {
  const msg = $('#signupMsg');
  const name = $('#su').value.trim(), password = $('#sp1').value;
  const needEmail = $('#emailStep').style.display !== 'none';
  const fail = t => { msg.className = 'msg err'; msg.textContent = t; };
  if (!NAME_RE.test(name)) return fail('Pseudo : 3 à 16 caractères (lettres, chiffres, _ - .).');
  if (password.length < 6) return fail('Mot de passe : 6 caractères minimum.');
  if (needEmail && !$('#se').value.trim()) return fail('Entre ton adresse e-mail.');
  if (needEmail && !$('#sc').value.trim()) return fail('Entre le code reçu par e-mail.');

  $('#signup').disabled = true; msg.className = 'msg'; msg.textContent = 'Création du compte…';
  const r = await bs.register({
    name, password,
    email: needEmail ? $('#se').value.trim() : undefined,
    code: needEmail ? $('#sc').value.trim() : undefined,
    ref: $('#sr').value.trim() || undefined,
    look: STARTERS[starter].look,
  });
  $('#signup').disabled = false;
  if (!r.ok) return fail(r.error || 'Inscription impossible.');
  msg.textContent = ''; $('#sp1').value = '';
  showAccount(r.account);
};

$('#logout').onclick = async () => { await bs.logout(); showAccount(null); authMode(false); };

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

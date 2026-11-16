/* Interface du launcher. Aucun accès direct au système : tout passe par le
   pont `bs` exposé par le preload. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const NAME_RE = /^[A-Za-z0-9_\-.]{3,16}$/;   // (même règle que le site)

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
    if (b.dataset.tab === 'opt') loadVersion();
  };
});

// ---- décor : personnages du jeu (src/chars.js) ----
$('#artA').src = CHARS.hero1;
$('#artB').src = CHARS.hero2;
$('#artC').src = CHARS.hero3;

// ---- bascule connexion / inscription ----
let emailAsked = false;
function authMode(signup) {
  $('#tabLogin').classList.toggle('on', !signup);
  $('#tabSignup').classList.toggle('on', signup);
  $('#loginBox').style.display = signup ? 'none' : '';
  $('#signupBox').style.display = signup ? '' : 'none';
  $('#pseudoBox').style.display = 'none';
  $('#prov').style.display = ''; $('#provOr').style.display = '';
  $('#artCap').textContent = signup
    ? 'Tout se personnalise ensuite en ville.'
    : 'Tout se personnalise en jeu.';
  // Le site n'exige une adresse e-mail que si un envoi est configuré : on le
  // lui demande au lieu de le supposer.
  if (signup && !emailAsked) {
    emailAsked = true;
    bs.registerMode().then(m => { if (m?.emailRequired) $('#emailStep').style.display = ''; }).catch(() => {});
  }
}
$('#tabLogin').onclick = () => authMode(false);
$('#tabSignup').onclick = () => authMode(true);

// ---- compte connecté ----
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

// ---- connexion ----
// Adresse e-mail sans mot de passe : le site envoie un code, qui remplace le
// mot de passe le temps d'une connexion.
let codeSentTo = '';
$('#login').onclick = async () => {
  const msg = $('#loginMsg'), id = $('#u').value.trim(), password = $('#p').value;
  const fail = t => { msg.className = 'msg err'; msg.textContent = t; };
  const byEmail = EMAIL_RE.test(id) && !password;

  if (!id) return fail('Entre ton pseudo ou ton adresse e-mail.');
  if (!byEmail && !password) return fail('Entre ton mot de passe — ou ton adresse e-mail pour recevoir un code.');

  $('#login').disabled = true;
  msg.className = 'msg';

  if (byEmail && codeSentTo !== id) {
    msg.textContent = 'Envoi du code…';
    const r = await bs.loginCode(id);
    $('#login').disabled = false;
    if (!r.ok) return fail(r.error || 'Envoi impossible.');
    codeSentTo = id;
    $('#loginCodeStep').style.display = '';
    $('#loginTip').textContent = 'Entre le code reçu, il est valable 10 minutes.';
    $('#login').textContent = 'Entrer avec le code';
    $('#lc').focus();
    msg.className = 'msg ok'; msg.textContent = r.info;
    return;
  }

  msg.textContent = 'Connexion…';
  const r = byEmail
    ? await bs.loginEmail(id, $('#lc').value.trim())
    : await bs.login(id, password);
  $('#login').disabled = false;
  if (!r.ok) return fail(r.error || 'Connexion impossible.');
  msg.textContent = ''; $('#p').value = ''; $('#lc').value = '';
  showAccount(r.account);
};

// ---- inscription ----
$('#sendCode').onclick = async () => {
  const msg = $('#signupMsg'), email = $('#se').value.trim(), name = $('#su').value.trim();
  if (!EMAIL_RE.test(email)) { msg.className = 'msg err'; msg.textContent = 'Entre une adresse e-mail valide.'; return; }
  $('#sendCode').disabled = true; msg.className = 'msg'; msg.textContent = 'Envoi du code…';
  const r = await bs.registerCode(email, name || undefined);
  $('#sendCode').disabled = false;
  msg.className = 'msg ' + (r.ok ? 'ok' : 'err');
  msg.textContent = r.ok ? r.info : (r.error || 'Envoi impossible.');
  if (r.ok) $('#sc').focus();
};

$('#signup').onclick = async () => {
  const msg = $('#signupMsg');
  const name = $('#su').value.trim(), password = $('#sp1').value;
  const needEmail = $('#emailStep').style.display !== 'none';
  const fail = t => { msg.className = 'msg err'; msg.textContent = t; };
  if (!NAME_RE.test(name)) return fail('Pseudo : 3 à 16 caractères (lettres, chiffres, _ - .).');
  if (password.length < 6) return fail('Mot de passe : 6 caractères minimum.');
  if (needEmail && !EMAIL_RE.test($('#se').value.trim())) return fail('Entre une adresse e-mail valide.');
  if (needEmail && !$('#sc').value.trim()) return fail('Entre le code reçu par e-mail.');

  $('#signup').disabled = true; msg.className = 'msg'; msg.textContent = 'Création du compte…';
  const r = await bs.register({
    name, password,
    email: needEmail ? $('#se').value.trim() : undefined,
    code: needEmail ? $('#sc').value.trim() : undefined,
    ref: $('#sr').value.trim() || undefined,
  });
  $('#signup').disabled = false;
  if (!r.ok) return fail(r.error || 'Inscription impossible.');
  msg.textContent = ''; $('#sp1').value = '';
  showAccount(r.account);
};

// ---- Google / Twitch ----
// L'autorisation s'ouvre dans le navigateur (Google refuse les fenêtres
// embarquées), puis le site rend la main au launcher.
let pending = null;
const provBusy = t => { for (const b of ['#provGoogle', '#provTwitch']) $(b).disabled = t; };

for (const [sel, provider] of [['#provGoogle', 'google'], ['#provTwitch', 'twitch']]) {
  $(sel).onclick = async () => {
    const msg = $('#tabSignup').classList.contains('on') ? $('#signupMsg') : $('#loginMsg');
    provBusy(true); msg.className = 'msg'; msg.textContent = 'Ouverture de ton navigateur…';
    const r = await bs.oauth(provider);
    provBusy(false);
    if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error || 'Impossible d’ouvrir la page.'; return; }
    msg.textContent = 'Termine la connexion dans ton navigateur, puis reviens ici.';
  };
}

bs.oauthAvailable().then(a => {
  $('#provGoogle').style.display = a?.google ? '' : 'none';
  $('#provTwitch').style.display = a?.twitch ? '' : 'none';
  const none = !a?.google && !a?.twitch;
  $('#prov').style.display = none ? 'none' : '';
  $('#provOr').style.display = none ? 'none' : '';
}).catch(() => {});

// Retour du navigateur : soit on est connecté, soit il reste le pseudo à choisir.
bs.onAuth(p => {
  const msg = $('#tabSignup').classList.contains('on') ? $('#signupMsg') : $('#loginMsg');
  if (!p?.ok) { msg.className = 'msg err'; msg.textContent = p?.error || 'Connexion annulée.'; return; }
  if (p.account) { msg.textContent = ''; showAccount(p.account); return; }
  pending = { provider: p.provider, pending: p.pending };
  $('#loginBox').style.display = 'none';
  $('#signupBox').style.display = 'none';
  $('#prov').style.display = 'none'; $('#provOr').style.display = 'none';
  $('#pseudoBox').style.display = '';
  $('#pseudoTitle').textContent = `Bienvenue ! Choisis ton pseudo`;
  $('#pn').value = p.suggest || '';
  $('#pn').focus();
});

$('#pseudoBack').onclick = () => { pending = null; authMode(false); };
$('#pseudoGo').onclick = async () => {
  const msg = $('#pseudoMsg'), name = $('#pn').value.trim();
  if (!pending) { authMode(false); return; }
  if (!NAME_RE.test(name)) { msg.className = 'msg err'; msg.textContent = 'Pseudo : 3 à 16 caractères (lettres, chiffres, _ - .).'; return; }
  $('#pseudoGo').disabled = true; msg.className = 'msg'; msg.textContent = 'Création du compte…';
  const r = await bs.oauthFinish({ ...pending, name });
  $('#pseudoGo').disabled = false;
  if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error || 'Inscription impossible.'; return; }
  pending = null; msg.textContent = '';
  showAccount(r.account);
};

// ---- jouer / déconnexion ----
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
      <p>${esc(n.body)}</p>
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

let versionLoaded = false;
async function loadVersion() {
  if (versionLoaded) return;
  versionLoaded = true;
  const v = await bs.version();
  $('#verCur').textContent = v.current;
  $('#verLast').textContent = v.latest || 'indisponible';
  const st = $('#verState');
  if (!v.latest) { st.className = 'state'; st.textContent = 'Impossible de vérifier (hors ligne ?)'; }
  else if (v.upToDate) { st.className = 'state ok'; st.textContent = '✓ À jour'; }
  else { st.className = 'state up'; st.textContent = `Mise à jour vers ${v.latest} au prochain démarrage`; }
}

// Désinstallation : un premier clic prévient, le second lance vraiment.
let unArmed = false;
$('#uninstall').onclick = async () => {
  const msg = $('#unMsg');
  if (!unArmed) {
    unArmed = true;
    $('#uninstall').textContent = 'Confirmer la désinstallation';
    msg.className = 'msg err';
    msg.textContent = 'Le launcher sera retiré de ta machine. Ton compte et ta progression restent intacts : ils sont sur le serveur.';
    return;
  }
  msg.className = 'msg'; msg.textContent = 'Ouverture du désinstalleur…';
  const r = await bs.uninstall();
  if (!r.ok) {
    unArmed = false;
    $('#uninstall').textContent = 'Désinstaller le launcher';
    msg.className = 'msg err'; msg.textContent = r.error || 'Désinstallation impossible.';
  }
};

// ---- démarrage ----
(async () => {
  settings = await bs.settings();
  $('#ram').value = settings.ramPercent;
  paintRam();
  const acc = await bs.currentAccount();
  showAccount(acc);
})();

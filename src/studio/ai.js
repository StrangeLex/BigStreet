// Big Street Studio — l'assistant IA (Studio VIP) : le fil de discussion. L'utilisateur écrit ce qu'il veut ; l'assistant agit sur le
// Studio par le moteur d'actions (ai-tools.js) et chaque action s'affiche en clair dans le fil (« ✓ Caméra « Plan large » créée… »).
// Chaque message qui modifie le projet garde un point de restauration : « Revenir à avant ce message » remet le projet ET la
// conversation dans l'état d'avant — on peut aussi, simplement, demander des changements. Les échanges passent par le processus
// principal du launcher (le jeton de session n'est jamais dans cette page), qui les relaie au site : POST /api/studio/ai.
import { runTurn } from '/__studio/ai-tools.js';

const IDEAS = ['Fais une cinématique complète et soignée de cette scène.', 'Ouvre sur un plan large du lieu, puis un gros plan sur le joueur.', 'Un travelling circulaire autour du joueur, avec raytracing et ombres.', 'Décris-moi la scène : qui est là, que se passe-t-il ?'];

export function createAI(S) {
  const { $, el } = S;
  let chat = [], history = [], busy = false, gate = '';
  const box = () => $('#aiBody');
  function render() {
    const host = box(), acc = S.account(), rec = S.ready();
    const g = !acc ? 'login' : !acc.vip ? 'vip' : !rec ? 'norec' : 'ok';
    $('#aiForm').hidden = g !== 'ok';
    if (g !== 'ok') {
      if (gate === g && host.firstChild) return; gate = g;
      host.replaceChildren(g === 'norec' ? el('div', { class: 'ai-note' }, el('b', { text: '✨ Assistant réalisateur' }), el('p', { text: 'Ouvre un record : l’assistant voit toute la scène et peut créer les caméras, les mouvements et le montage à ta place.' }))
        : el('div', { class: 'ai-vip' }, el('div', { class: 'ai-vip-t', text: '✨ Fonctionnalité Studio VIP' }),
          el('p', { text: g === 'login' ? 'L’assistant réalisateur est réservé aux comptes VIP. Connecte-toi d’abord dans le launcher.' : 'L’assistant réalisateur — une IA qui voit toute la scène et réalise la cinématique que tu lui décris — est réservé aux comptes VIP.' }),
          el('ul', {}, el('li', { text: 'Découpage, cadrages et mouvements de caméra automatiques' }), el('li', { text: 'Retour en arrière à chaque message' }), el('li', { text: 'Tenues des personnages, filtres, raytracing, ombres' })),
          g === 'vip' ? el('button', { class: 'btn accent', text: 'Voir le VIP dans la boutique du jeu', onclick: () => S.api.openShop?.() }) : null,
          el('button', { class: 'btn small', text: '↻ J’ai le VIP : revérifier', onclick: async () => { await S.reloadAccount(); gate = ''; render(); } })));
      return;
    }
    gate = g;
    const kids = [];
    if (!chat.length) kids.push(el('div', { class: 'ai-note' }, el('b', { text: '✨ Assistant réalisateur' }), el('p', { text: 'Décris la cinématique que tu veux : l’assistant voit les personnages, leurs trajets, ce qu’ils disent, et pilote les caméras. Chaque message peut être annulé.' }),
      el('div', { class: 'ai-ideas' }, ...IDEAS.map(t => el('button', { class: 'ai-idea', text: t, onclick: () => send(t) })))));
    chat.forEach((m, i) => {
      if (m.role === 'user') { kids.push(el('div', { class: 'ai-msg user', text: m.text })); return; }
      const acts = m.actions.length ? el('div', { class: 'ai-acts' }, ...m.actions.map(a => el('div', { class: 'ai-act' + (a.ok ? '' : ' ko'), text: a.text }))) : null;
      kids.push(el('div', { class: 'ai-msg bot' + (m.error ? ' err' : '') }, acts, m.text ? el('div', { class: 'ai-text', text: m.text }) : null, m.pending ? el('div', { class: 'ai-wait' }, el('i'), el('i'), el('i')) : null,
        m.error ? el('div', { class: 'ai-err', text: `⚠ ${m.error}` }) : null,
        !m.pending && m.changed ? el('button', { class: 'ai-back', title: 'Remet le projet (caméras, clés, apparences) et la conversation dans l’état d’avant ce message', text: '↩ Revenir à avant ce message', onclick: () => rollback(i - 1) }) : null));
    });
    const stick = host.scrollTop + host.clientHeight >= host.scrollHeight - 40;
    host.replaceChildren(...kids); if (stick || busy) host.scrollTop = host.scrollHeight;
    $('#aiSend').disabled = busy; $('#aiInput').disabled = busy; $('#aiClear').hidden = !chat.length || busy;
  }
  /** Envoie un message. ask : le modèle (par défaut le relais du site ; un faux modèle dans les essais) */
  async function send(text, ask = S.api.ai) {
    text = String(text || '').trim(); if (!text || busy || !S.ready()) return null;
    busy = true; S.flush();
    const user = { role: 'user', text, snap: S.snapshot(), hLen: history.length }, bot = { role: 'assistant', text: '', actions: [], pending: true };
    chat.push(user, bot); render();
    let res;
    try { res = await runTurn(S.host(), history, text, ask, ev => { if (ev.type === 'action') bot.actions.push({ ok: ev.ok, text: ev.text }); else if (ev.type === 'say') bot.text = ev.text; render(); }); }
    catch (e) { console.error(e); res = { text: '', actions: bot.actions, changed: S.snapshot() !== user.snap, error: { text: String(e?.message || e) } }; }
    bot.pending = false; bot.text = res.text || bot.text; bot.changed = res.changed || S.snapshot() !== user.snap;
    if (res.error) { bot.error = res.error.text; if (res.error.vip === false) { S.account().vip = false; } if (!bot.actions.length) history.length = user.hLen; }
    busy = false; S.flush(); S.refresh(); render();
    if (res.error?.vip === false) { chat = []; history = []; render(); }
    return res;
  }
  /** Revenir à avant le message n° i de l'utilisateur : le projet et la conversation retrouvent leur état d'alors */
  function rollback(i) {
    const m = chat[i]; if (!m || m.role !== 'user' || busy) return;
    S.flush(); S.restore(m.snap); S.flush();
    history.length = m.hLen; chat.length = i; $('#aiInput').value = m.text; render(); $('#aiInput').focus();
    S.toast('↩ Projet et conversation revenus à avant ce message (Ctrl+Y pour rétablir le projet).');
  }
  const submit = () => { const f = $('#aiInput'), t = f.value; if (!t.trim() || busy) return; f.value = ''; send(t); };
  $('#aiSend').onclick = submit;
  $('#aiInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  $('#aiClear').onclick = () => { if (busy) return; chat = []; history = []; render(); };
  return { render, send, rollback, get chat() { return chat; }, get history() { return history; }, get busy() { return busy; },
    open() { chat = []; history = []; gate = ''; render(); }, close() { chat = []; history = []; gate = ''; render(); } };
}

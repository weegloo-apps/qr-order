import { CONFIG } from '/js/config.js';
import { admin, adminAuth, fetchPublicStore, val } from '/js/api.js';
import { navigate, render } from '/js/main.js';
import { t } from '/js/i18n.js';
import { langSwitcher } from '/js/lang-ui.js';
import { h, icon, poweredBy, tableLabel, toast } from '/js/util.js';
import { adminData, alertLength, audioReady, chime, fetchOpenCalls, hush, loadStore, saveStore, soundOn, storeVal, unlockAudio, watcher } from '/js/admin/data.js';
import { dashboardPage } from '/js/admin/dashboard.js';
import { ordersPage } from '/js/admin/orders.js';
import { menuPage } from '/js/admin/menu.js';
import { salesPage } from '/js/admin/sales.js';
import { settingsPage } from '/js/admin/settings.js';
import { qrPage } from '/js/admin/qr.js';

const NAV = [
  ['/admin', 'nav.dashboard', dashboardPage],
  ['/admin/orders', 'nav.orders', ordersPage],
  ['/admin/menu', 'nav.menu', menuPage],
  ['/admin/sales', 'nav.sales', salesPage],
  ['/admin/settings', 'nav.settings', settingsPage],
];

let verifiedToken = null;
let shell = null;
let keepLogin = true;
let listening = false;
let knownCalls = null;

export async function renderAdmin(app, path, isCurrent) {
  document.body.dataset.area = 'admin';
  const auth = await ensureAuth();
  if (!isCurrent()) return;
  if (!auth.ok) {
    shell = null;
    watcher.stop();
    app.replaceChildren(await loginView(auth.reason));
    return;
  }
  try {
    await loadStore();
  } catch (e) {
    if (!isCurrent()) return;
    if (e.status === 401) { verifiedToken = null; render(); return; }
    throw e;
  }
  if (!isCurrent()) return;
  document.documentElement.style.setProperty('--accent', storeVal('brandColor'));

  if (path === '/admin/qr') {
    shell = null;
    const root = h('div');
    await qrPage(root);
    if (isCurrent()) app.replaceChildren(root);
    return;
  }

  // Header and navigation are built once; only the page body is swapped on navigation.
  if (!shell || !app.contains(shell.root)) {
    shell = buildShell();
    app.replaceChildren(shell.root);
  }
  updateHeader();
  const entry = NAV.find(([href]) => href === path) || NAV[0];
  for (const a of shell.nav.querySelectorAll('a')) {
    const on = a.getAttribute('href') === entry[0];
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = t('a.docTitle', { page: t(entry[1]), store: storeVal('name') || t('store.defaultName') });
  watcher.start();
  const main = h('main', { class: 'a-main' }, h('p', { class: 'muted a-loading' }, t('loading')));
  shell.host.replaceChildren(main);
  await entry[2](main, { isCurrent });
}

async function ensureAuth() {
  const token = adminAuth.get();
  if (!token) return { ok: false };
  if (verifiedToken === token) return { ok: true };
  try {
    const [me, member] = await Promise.all([admin.me(), admin.isMember()]);
    if (!member) { adminAuth.clear(); return { ok: false, reason: 'notMember' }; }
    verifiedToken = token;
    adminData.me = me;
    return { ok: true };
  } catch (e) {
    adminAuth.clear();
    return { ok: false, reason: e.status === 401 || e.status === 403 ? 'expired' : 'error' };
  }
}

function listenForLogin() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event) => {
    if (event.origin !== CONFIG.console) return;
    const tok = event.data?.accessToken;
    if (typeof tok === 'string' && tok.trim()) {
      adminAuth.set(tok.trim(), keepLogin);
      render();
    }
  });
}

async function loginView(reason) {
  listenForLogin();
  let name = t('store.defaultName');
  try { name = val((await fetchPublicStore()).fields, 'name') || name; } catch { /* keep default */ }
  // The sign-in click also unlocks audio, so the first alert after login can ring.
  const open = () => { unlockAudio(); window.open(`${CONFIG.console}/login?origin=${encodeURIComponent(location.origin)}`, 'weegloo-login', 'width=500,height=640'); };
  const msg = reason ? t(`a.login.${reason}`) : null;
  document.title = t('a.login.docTitle', { store: name });
  return h('div', { class: 'login' },
    h('div', { class: 'login-hero' },
      h('div', { class: 'brand-row' }, h('span', { class: 'logo-light', 'aria-hidden': 'true' }, name.slice(0, 1)), h('span', { class: 'brand-name' }, name)),
      h('div', { class: 'hero-copy' },
        h('h1', null, t('a.hero1'), h('br'), t('a.hero2')),
        h('p', null, t('a.heroP'))),
      h('div', { class: 'hero-tags' }, ['a.tag1', 'a.tag2', 'a.tag3', 'a.tag4'].map((k) => h('span', null, t(k))))),
    h('div', { class: 'login-side' },
      h('div', { class: 'login-form' },
        langSwitcher('lang-login'),
        h('div', { class: 'col-tight' },
          h('h2', null, t('a.login.title')),
          h('p', { class: 'muted' }, t('a.login.sub'))),
        msg ? h('p', { class: 'form-error', role: 'alert' }, msg) : null,
        h('button', { type: 'button', class: 'login-btn', onClick: open }, t('a.login.btn')),
        h('label', { class: 'check-row' },
          h('input', { type: 'checkbox', checked: keepLogin, onChange: (e) => { keepLogin = e.target.checked; } }),
          t('a.login.keep')),
        h('p', { class: 'login-help' }, t('a.login.help')),
        h('a', { href: '/', class: 'login-back' }, t('a.login.back')),
        poweredBy())));
}

function buildShell() {
  const logo = h('span', { class: 'a-logo', 'aria-hidden': 'true' });
  const name = h('span', { class: 'a-store' });
  const toggle = h('button', { type: 'button', class: 'open-toggle', onClick: toggleOpen });
  const nav = h('nav', { class: 'a-nav', 'aria-label': t('a.adminNav') }, NAV.map(([href, key]) => h('a', { href }, t(key))));
  const host = h('div', { class: 'a-host' });
  const root = h('div', { class: 'a-page' },
    h('header', { class: 'a-header' },
      h('div', { class: 'a-header-in' },
        h('div', { class: 'a-brand' }, logo, name, h('span', { class: 'a-tag' }, t('a.adminTag'))),
        h('div', { class: 'a-actions' },
          toggle,
          h('a', { href: '/', target: '_blank', rel: 'noopener', class: 'a-btn-dark' }, icon('eye', 16), t('a.customerView')),
          langSwitcher('lang-admin'),
          h('button', { type: 'button', class: 'a-logout', onClick: logout }, t('a.logout')))),
      nav),
    host,
    h('footer', { class: 'a-foot' }, poweredBy()));
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  showSoundUnlock();
  fetchOpenCalls().then(rememberCalls).catch(() => {});
  return { root, logo, name, toggle, nav, host };
}

function updateHeader() {
  if (!shell) return;
  const name = storeVal('name') || t('store.defaultName');
  shell.logo.textContent = name.slice(0, 1);
  shell.name.textContent = name;
  const open = !!storeVal('acceptOrders');
  shell.toggle.replaceChildren(h('span', { class: `switch${open ? ' is-on' : ''}` }, h('span')), open ? t('a.open') : t('a.closed'));
  shell.toggle.setAttribute('aria-pressed', String(open));
}

async function toggleOpen() {
  const next = !storeVal('acceptOrders');
  shell.toggle.disabled = true;
  try {
    await saveStore({ acceptOrders: next });
    toast(next ? t('a.toast.reopened') : t('a.toast.closed'));
  } catch (e) {
    console.error(e);
    toast(t('a.toast.changeFail'));
  }
  shell.toggle.disabled = false;
  updateHeader();
}

function logout() {
  dismissAlerts();
  document.querySelector('.sound-unlock')?.remove();
  adminAuth.clear();
  verifiedToken = null;
  watcher.stop();
  shell = null;
  navigate('/admin');
}

// A new order or a new staff call rings on every admin page; each page refreshes its own data.
async function onCounterChange(evt) {
  if (evt.newOrder) {
    const no = `A-${String(evt.seq || 0).padStart(3, '0')}`;
    raise('order', evt.count > 1 ? t('a.alert.orders', { n: evt.count }) : t('a.alert.order', { no }));
  }
  if (evt.callChanged) {
    try {
      const calls = await fetchOpenCalls();
      const fresh = calls.filter((c) => knownCalls && !knownCalls.has(c.id));
      knownCalls = new Set(calls.map((c) => c.id));
      for (const c of fresh) {
        raise('call', t('a.toast.call', { table: tableLabel(c.tableNo), requests: c.requests.length ? ` · ${c.requests.map((r) => t(`call.${r}`)).join(', ')}` : '' }));
      }
    } catch { /* the orders page shows calls too */ }
  }
}

// ---------- Alerts the admin must notice ----------
// A banner that stays until dismissed, the matching alarm, and a blinking tab title. The alarm keeps
// repeating until it is acknowledged: the banner's buttons, or handling an order/call of that kind
// (accept, decline, mark done, "Got it"). A stray tap elsewhere does not silence a busy kitchen's alarm.
// Steady for 3 minutes (about 5 s on / 5 s off), then every 30 s, and it gives up after 30 minutes.
const STEADY_MS = 3 * 60e3;
const GIVE_UP_MS = 30 * 60e3;
const alertState = { items: [], repeatTimer: null, since: 0, titleTimer: null, title: '', el: null };

function raise(kind, message) {
  alertState.items.unshift({ kind, message, at: Date.now(), ringing: true });
  alertState.items = alertState.items.slice(0, 4);
  alertState.since = Date.now();
  hush();
  ring();
  renderAlerts();
  startTitleBlink(message);
}

const ringingKinds = () => [...new Set(alertState.items.filter((x) => x.ringing).map((x) => x.kind))];

function ring() {
  clearTimeout(alertState.repeatTimer);
  const kinds = ringingKinds();
  const elapsed = Date.now() - alertState.since;
  if (!kinds.length || elapsed > GIVE_UP_MS) return;
  let at = 0;
  for (const k of kinds) {
    setTimeout(() => { if (ringingKinds().includes(k)) chime(k); }, at * 1000);
    at += alertLength(k) + 0.6;
  }
  alertState.repeatTimer = setTimeout(ring, (at + (elapsed < STEADY_MS ? 5 : 30)) * 1000);
}

function startTitleBlink(message) {
  clearInterval(alertState.titleTimer);
  if (!alertState.title) alertState.title = document.title;
  let on = false;
  alertState.titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? `🔔 ${message}` : alertState.title;
  }, 1000);
}
function stopTitleBlink() {
  clearInterval(alertState.titleTimer);
  alertState.titleTimer = null;
  if (alertState.title) { document.title = alertState.title; alertState.title = ''; }
}

// An order or call was handled: stop that kind's alarm (the banner stays until dismissed).
function silence(kind) {
  for (const x of alertState.items) if (x.kind === kind) x.ringing = false;
  hush(kind);
  if (!ringingKinds().length) { clearTimeout(alertState.repeatTimer); stopTitleBlink(); }
  renderAlerts();
}
window.addEventListener('qr:handled', (e) => silence(e.detail));

function dismissAlerts() {
  alertState.items = [];
  clearTimeout(alertState.repeatTimer);
  hush();
  stopTitleBlink();
  renderAlerts();
}

function renderAlerts() {
  if (!alertState.el) {
    alertState.el = h('div', { class: 'alert-stack', role: 'alert', 'aria-live': 'assertive' });
    document.body.append(alertState.el);
  }
  const el = alertState.el;
  if (!alertState.items.length || document.body.dataset.area !== 'admin') { el.replaceChildren(); el.hidden = true; return; }
  el.hidden = false;
  const top = alertState.items[0];
  el.replaceChildren(h('div', { class: `alert-card alert-${top.kind}` },
    h('span', { class: 'alert-icon' }, icon(top.kind === 'call' ? 'bell' : 'receipt', 22)),
    h('div', { class: 'alert-text' }, alertState.items.map((x, i) => h(i ? 'span' : 'strong', { class: i ? 'alert-more' : '' }, x.message)),
      ringingKinds().length ? h('span', { class: 'alert-more' }, t('a.alert.untilOk')) : null),
    h('div', { class: 'alert-actions' },
      h('button', { type: 'button', class: 'alert-btn', onClick: () => { dismissAlerts(); navigate('/admin/orders'); } }, t('a.alert.view')),
      h('button', { type: 'button', class: 'alert-btn alert-btn-ghost', onClick: dismissAlerts }, t('a.alert.ok')))));
}


// Until the page is touched once the browser keeps audio blocked; say so instead of staying silent.
function showSoundUnlock() {
  if (!soundOn() || audioReady() || document.querySelector('.sound-unlock')) return;
  const el = h('button', { type: 'button', class: 'sound-unlock', onClick: () => unlockAudio() }, icon('bell', 16), t('a.soundUnlock'));
  document.body.append(el);
  const done = () => { unlockAudio(); el.remove(); };
  document.addEventListener('pointerdown', done, { once: true, capture: true });
}

export function rememberCalls(calls) { knownCalls = new Set(calls.map((c) => c.id)); }

watcher.on(onCounterChange);
window.addEventListener('qr:store', updateHeader);
// The header holds translated labels; build it again in the new language.
window.addEventListener('qr:lang', () => { shell = null; });

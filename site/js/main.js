import { renderCustomer } from '/js/customer/views.js';
import { renderAdmin } from '/js/admin/shell.js';
import { initLocales, t } from '/js/i18n.js';
import { h } from '/js/util.js';

const app = document.getElementById('app');
let renderToken = 0;
let cleanups = [];
let inAppNavs = 0;

// Views register teardown work (timers, listeners) that must stop when the route changes.
export function onLeave(fn) { cleanups.push(fn); }
export const canGoBack = () => inAppNavs > 0;

export async function render({ restoreScroll = null } = {}) {
  const mine = ++renderToken;
  const fns = cleanups;
  cleanups = [];
  for (const fn of fns) { try { fn(); } catch (e) { console.error(e); } }
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const isCurrent = () => mine === renderToken;
  setRobots(path === '/admin' || path.startsWith('/admin/'));
  try {
    if (path === '/admin' || path.startsWith('/admin/')) await renderAdmin(app, path, isCurrent);
    else await renderCustomer(app, path, isCurrent);
  } catch (e) {
    console.error(e);
    if (isCurrent()) {
      app.replaceChildren(h('div', { class: 'center-msg' },
        h('p', null, t('app.loadFail')),
        h('button', { type: 'button', class: 'btn', onClick: () => location.reload() }, t('common.retry'))));
    }
  }
  if (isCurrent()) window.scrollTo(0, restoreScroll ?? 0);
}

// Admin screens stay out of search results (robots.txt also keeps crawlers off them).
function setRobots(hide) {
  let m = document.head.querySelector('meta[name="robots"]');
  if (!hide) { m?.remove(); return; }
  if (!m) { m = document.createElement('meta'); m.name = 'robots'; document.head.append(m); }
  m.content = 'noindex, nofollow';
}

export function navigate(to, { replace = false } = {}) {
  try { history.replaceState({ ...(history.state || {}), scroll: window.scrollY }, ''); } catch { /* ignore */ }
  if (replace) history.replaceState({}, '', to);
  else { history.pushState({}, '', to); inAppNavs++; }
  render();
}

export function goBack(fallback = '/') {
  if (canGoBack()) history.back();
  else navigate(fallback, { replace: true });
}

// Internal links swap only the page content instead of reloading the document.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.reload !== undefined) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.hash && !url.search) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});

window.addEventListener('popstate', (e) => {
  inAppNavs = Math.max(0, inAppNavs - 1);
  render({ restoreScroll: e.state?.scroll ?? 0 });
});

// Switching language re-renders the current screen in place.
window.addEventListener('qr:lang', () => render({ restoreScroll: window.scrollY }));

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
initLocales().then(() => render());

import { CONFIG } from '/js/config.js';
import { fetchPublicMenu, fetchPublicStore, mediaUrl, plain, runScript } from '/js/api.js';
import { lbl, t } from '/js/i18n.js';
import { ls, setCurrency, setTimeZone, toMs } from '/js/util.js';

// ---------- Store + menu (published, cached for the page lifetime) ----------
// `raw` keeps every locale (CDA locale=*); `data` is that content in the current language.
export const data = { store: null, sections: [], items: [], loadedAt: 0 };
const raw = { store: null, sections: [], items: [], medias: new Map() };
let loading = null;

const bySort = (a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

function derive() {
  if (!raw.store) return;
  data.store = plain(raw.store);
  setCurrency(data.store.currency);
  setTimeZone(data.store.timeZone);
  data.sections = raw.sections.map((x) => plain(x)).sort(bySort);
  data.items = raw.items.map((x) => {
    const it = plain(x);
    return {
      ...it,
      sectionId: it.section?.sys?.id || null,
      optionGroups: Array.isArray(it.optionGroups) ? it.optionGroups : [],
      img: it.image?.sys?.id ? mediaUrl(raw.medias.get(it.image.sys.id)) : null, // base URL; add /styleN when rendering
    };
  }).sort(bySort);
  applyBrand();
}
window.addEventListener('qr:lang', derive);

export function ensureData(force = false) {
  if (!force && data.store && Date.now() - data.loadedAt < 10 * 60e3) return Promise.resolve(data);
  if (loading) return loading;
  loading = Promise.all([fetchPublicStore(), fetchPublicMenu()])
    .then(([store, menu]) => {
      raw.store = store;
      raw.sections = menu.sections;
      raw.items = menu.items;
      raw.medias = new Map(menu.medias.map((m) => [m.sys.id, m]));
      derive();
      data.loadedAt = Date.now();
      return data;
    })
    .finally(() => { loading = null; });
  return loading;
}

// Coming back to the tab is a real signal that the menu may have changed (sold out, new items).
let lastVisibleRefresh = Date.now();
export function onReturnRefresh(cb) {
  const handler = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastVisibleRefresh < 60e3) return;
    lastVisibleRefresh = Date.now();
    ensureData(true).then(cb).catch(() => {});
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export function applyBrand() {
  const c = data.store?.brandColor || '#C2410C';
  document.documentElement.style.setProperty('--accent', c);
  if (data.store?.name) document.title = data.store.name;
}

export const itemById = (id) => data.items.find((i) => i.id === id) || null;
export const sectionName = (id) => data.sections.find((s) => s.id === id)?.name || '';
export const hasRequiredOptions = (item) => item.optionGroups.some((g) => g.required);

// Unit price for a set of selected option keys ("groupId:optionId").
export function unitPrice(item, options) {
  let unit = Number(item.price) || 0;
  for (const g of item.optionGroups) for (const o of g.options || []) if (options.includes(`${g.id}:${o.id}`)) unit += Number(o.price) || 0;
  return unit;
}

export function optionsText(item, options) {
  const names = [];
  for (const g of item.optionGroups) for (const o of g.options || []) if (options.includes(`${g.id}:${o.id}`)) names.push(lbl(o.name));
  return names.join(' · ');
}

// Order lines keep the name/options text written at order time (default locale); show them in the
// current language from the live menu when the item still exists.
export const lineName = (l) => itemById(l.itemId)?.name || l.name;
export function lineOptions(l) {
  const item = itemById(l.itemId);
  return item && Array.isArray(l.optionKeys) ? optionsText(item, l.optionKeys) : l.options;
}

// ---------- Table ----------
export function getTable() {
  const n = ls.get('qr.table', 0);
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : 0;
}
export function setTable(n) { ls.set('qr.table', n); }

// ---------- Cart ----------
const CART_KEY = 'qr.cart.v1';
export function getCart() {
  const c = ls.get(CART_KEY, null);
  return c && Array.isArray(c.lines) ? { lines: c.lines, orderType: c.orderType === 'togo' ? 'togo' : 'here', note: c.note || '' } : { lines: [], orderType: 'here', note: '' };
}
export function saveCart(cart) { ls.set(CART_KEY, cart); }

const lineKey = (itemId, options) => `${itemId}|${[...options].sort().join(',')}`;

export function addToCart(itemId, options, qty = 1) {
  const cart = getCart();
  const key = lineKey(itemId, options);
  const line = cart.lines.find((l) => l.key === key);
  if (line) line.qty = Math.min(50, line.qty + qty);
  else cart.lines.push({ key, itemId, options: [...options], qty: Math.min(50, qty) });
  saveCart(cart);
}

export function setLineQty(key, qty) {
  const cart = getCart();
  cart.lines = cart.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(50, qty) } : l)).filter((l) => l.qty > 0);
  saveCart(cart);
}

export function itemQty(itemId) {
  return getCart().lines.filter((l) => l.itemId === itemId).reduce((a, l) => a + l.qty, 0);
}

export function lastLineOf(itemId) {
  const lines = getCart().lines.filter((l) => l.itemId === itemId);
  return lines[lines.length - 1] || null;
}

// Cart lines priced from the current menu; lines whose item vanished or sold out are flagged.
export function cartView() {
  const cart = getCart();
  let count = 0;
  let total = 0;
  const lines = cart.lines.map((l) => {
    const item = itemById(l.itemId);
    const available = !!item && !item.soldOut;
    const unit = item ? unitPrice(item, l.options) : 0;
    if (available) { count += l.qty; total += unit * l.qty; }
    return { ...l, item, available, unit, name: item?.name || t('cart.gone'), text: item ? optionsText(item, l.options) : '' };
  });
  return { cart, lines, count, total };
}

export function clearCart() {
  const cart = getCart();
  saveCart({ lines: [], orderType: cart.orderType, note: '' });
}

// ---------- My orders (this device only; the ids are what lets the status Script answer) ----------
const ORDERS_KEY = 'qr.orders.v1';
const KEEP_MS = 12 * 3600e3;

export function getMyOrders() {
  const list = ls.get(ORDERS_KEY, []);
  const now = Date.now();
  return (Array.isArray(list) ? list : []).filter((o) => o && o.id && now - toMs(o.createdAt) < KEEP_MS)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

// The order this device placed a moment ago: its status is already fresh, so the screen that shows
// it skips the immediate check.
export let justPlaced = null;
export const markJustPlaced = (id) => { justPlaced = id; };

export function saveOrder(order) {
  const list = getMyOrders().filter((o) => o.id !== order.id);
  list.unshift(order);
  ls.set(ORDERS_KEY, list.slice(0, 30));
}

// ---------- Card payment (Stripe Checkout) ----------
// Orders sent to Stripe whose payment this device has not confirmed yet. The Stripe session expires
// after an hour, so older entries are dropped.
const PAY_KEY = 'qr.pay.v1';
const PAY_KEEP_MS = 75 * 60e3;
export function pendingPays() {
  const list = ls.get(PAY_KEY, []);
  return (Array.isArray(list) ? list : []).filter((p) => p && p.id && Date.now() - p.at < PAY_KEEP_MS);
}
export function addPendingPay(id) { ls.set(PAY_KEY, [...pendingPays().filter((p) => p.id !== id), { id, at: Date.now() }].slice(-5)); }
export function dropPendingPay(id) { ls.set(PAY_KEY, pendingPays().filter((p) => p.id !== id)); }

// The server asks Stripe whether this order was paid (never this page); once it was, the order gets
// its number and joins "my orders".
export async function confirmPayment(id) {
  const res = await runScript(CONFIG.scripts.confirmPayment, { orderId: id });
  const o = res.order;
  saveOrder({ ...o, prepMinutes: res.prepMinutes, updatedAt: o.createdAt });
  dropPendingPay(id);
  return o;
}

// A payment finished on Stripe whose return page never loaded (tab closed, lost signal) is settled the
// next time this device opens the menu. Once per page load, only while such an entry exists.
let recovered = false;
export async function recoverPayments() {
  if (recovered) return [];
  recovered = true;
  const done = [];
  for (const p of pendingPays().slice(-3)) {
    try { done.push(await confirmPayment(p.id)); } catch { /* not paid (yet) — the entry expires on its own */ }
  }
  return done;
}

const isActive = (o) => o.status === 'new' || o.status === 'preparing';
export const activeOrders = () => getMyOrders().filter(isActive);

// A served card order can still be refunded at the counter (complaint, wrong dish…). The 10 s checks
// cover open orders only, so recent served card orders ride along once when a screen opens or comes
// back into view — same Script call, no extra polling.
const RECHECK_PAID_FOR = 12 * 60 * 60e3;
const servedPaidIds = () => getMyOrders()
  .filter((o) => o.status === 'done' && o.payment === 'paid' && Date.now() - toMs(o.createdAt) < RECHECK_PAID_FOR)
  .map((o) => o.id);

// One Script call answers both this device's open orders and its open staff call.
export async function refreshStatuses(ids) {
  const call = openCall();
  if (!ids.length && !call) return [];
  const payload = { ids: ids.slice(0, 10) };
  if (call) payload.callId = call.id;
  const res = await runScript(CONFIG.scripts.orderStatus, payload);
  const fresh = res?.orders || [];
  const list = getMyOrders();
  for (const f of fresh) {
    const i = list.findIndex((o) => o.id === f.id);
    if (i >= 0) list[i] = { ...list[i], ...f };
    else list.push(f);
  }
  ls.set(ORDERS_KEY, list);
  if (call && res?.call?.id === call.id) applyCallStatus(res.call.status);
  return fresh;
}

// Status updates for this device's open orders (and its open staff call): one Script call by id, at
// once when a screen opens (a refresh included), then every 10 s — but only while the screen is
// visible, so a locked phone or a background tab costs nothing — and for at most an hour after the
// newest open order. Each check is a Script run, which the Organization pays for monthly.
const WATCH_EVERY = 10e3;
const WATCH_FOR = 60 * 60e3;
export function watchOrders(onUpdate, { immediate = true } = {}) {
  let timer = null;
  let stopped = false;
  const ids = () => activeOrders().map((o) => o.id);
  const newest = () => Math.max(0, ...activeOrders().map((o) => toMs(o.createdAt)), openCall()?.at || 0);
  const pending = () => (ids().length > 0 || !!openCall()) && Date.now() - newest() < WATCH_FOR;
  const visible = () => document.visibilityState === 'visible';
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped && visible() && pending()) timer = setTimeout(tick, WATCH_EVERY);
  };
  async function tick(withServed = false) {
    const served = withServed ? servedPaidIds() : [];
    if (stopped || (!pending() && !served.length)) return;
    try { await refreshStatuses([...new Set([...ids(), ...served])]); if (!stopped) onUpdate(); } catch { /* keep the last known status */ }
    schedule();
  }
  const onVis = () => {
    if (stopped) return;
    if (visible()) { clearTimeout(timer); tick(true); } else clearTimeout(timer);
  };
  document.addEventListener('visibilitychange', onVis);
  if (immediate && visible()) tick(true); else schedule();
  return {
    stop() { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); },
    async now() { clearTimeout(timer); await tick(); },
    // Something new to wait for (a staff call just made): make sure the checks are running.
    resume() { if (!stopped) schedule(); },
  };
}

// ---------- Staff call ----------
// The id is kept on this device; its status comes from the server: 'open' until staff tap
// "Got it" ('done'), or 'cancelled'. A handled call shows "on the way" briefly, then clears.
const CALL_KEY = 'qr.call.v1';
const CALL_OPEN_MS = 30 * 60e3;
export const CALL_ACK_MS = 3 * 60e3;
export function getCall() {
  const c = ls.get(CALL_KEY, null);
  if (!c || !c.id) return null;
  if (c.status === 'done') return Date.now() - (c.ackAt || 0) < CALL_ACK_MS ? c : null;
  return Date.now() - c.at < CALL_OPEN_MS ? c : null;
}
export function openCall() {
  const c = getCall();
  return c && c.status !== 'done' ? c : null;
}
export function setCall(c) { if (c) ls.set(CALL_KEY, c); else ls.del(CALL_KEY); }
function applyCallStatus(status) {
  const c = getCall();
  if (!c || status === 'open') return;
  if (status === 'done') setCall({ ...c, status: 'done', ackAt: c.ackAt || Date.now() });
  else setCall(null); // cancelled, or no longer there
}

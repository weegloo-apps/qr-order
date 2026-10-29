import { CONFIG } from '/js/config.js';
import { admin, adminAuth, imageIds, mediaUrl, runScript, val } from '/js/api.js';
import { defaultLocale, isBucket, lbl, t } from '/js/i18n.js';
import { DAY, ls, setCurrency } from '/js/util.js';
import { normHours, serializeHours } from '/js/hours.js';

const CT = CONFIG.contentTypes;

export const adminData = { me: null, store: null, sections: null, items: null, media: new Map() };

// ---------- Store settings (one row; the customer screens read its published copy) ----------
const DEFAULT_STORE = {
  country: 'KR',
  currency: 'KRW',
  acceptOrders: true,
  prepay: true,
  allowTogo: true,
  allowNote: true,
  allowStaffCall: true,
  soundAlert: false,
  lastOrderMinutes: 30,
  prepMinutes: 10,
  paymentMethods: ['card', 'cash', 'easy'],
  tableCount: 6,
  brandColor: '#C2410C',
  hours: serializeHours(normHours([1, 2, 3, 4, 5].map((dow) => ({ dow, open: true, from: '10:00', to: '21:00' })))),
};

export async function loadStore(force = false) {
  if (adminData.store && !force) return adminData.store;
  try {
    adminData.store = await admin.get(CT.store, CONFIG.storeId);
    setCurrency(storeVal('currency'));
  } catch (e) {
    if (e.status !== 404) throw e;
    // The ordering Scripts read this exact row; if it was deleted the app cannot recover its id,
    // so surface it instead of silently creating a row the Scripts would never see.
    throw new Error(t('a.storeMissing'));
  }
  return adminData.store;
}

// The value in the current language (localized fields) or the single stored value.
export const storeVal = (k) => {
  const v = val(adminData.store?.fields, k);
  return v === undefined ? DEFAULT_STORE[k] : v;
};

// Every locale's value of a translatable field, for editing: { 'en-US': …, 'ko-KR': … }.
export function toLocaleMap(v) {
  if (isBucket(v)) return { ...v };
  return v === undefined || v === null || v === '' ? {} : { [defaultLocale()]: v };
}
export const storeMap = (k) => toLocaleMap(adminData.store?.fields?.[k]);

export async function saveStore(values) {
  adminData.store = await admin.patchPublish(CT.store, adminData.store, values);
  setCurrency(storeVal('currency'));
  window.dispatchEvent(new Event('qr:store'));
  return adminData.store;
}

// ---------- Menu (management copy, drafts included) ----------
const bySort = (a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || String(a.sys.createdAt).localeCompare(String(b.sys.createdAt));

export function menuRow(item) {
  const f = item.fields || {};
  const o = { sys: item.sys, id: item.sys.id, raw: item };
  for (const k of Object.keys(f)) o[k] = val(f, k);
  o.sectionId = o.section?.sys?.id || null;
  o.optionGroups = Array.isArray(o.optionGroups) ? o.optionGroups : [];
  o.imageId = o.image?.sys?.id || null;
  o.img = o.imageId ? mediaUrl(adminData.media.get(o.imageId)) : null;
  return o;
}

export async function loadMenu(force = false) {
  if (adminData.items && !force) return adminData;
  const select = 'sys.id,sys.version,sys.status,sys.createdAt,fields';
  const [sections, items] = await Promise.all([admin.list(CT.section, { select }), admin.list(CT.item, { select })]);
  // Menu photos: one list read for the ids not resolved yet.
  const missing = imageIds(items).filter((id) => !adminData.media.has(id));
  if (missing.length) {
    try { for (const m of await admin.mediaList(missing)) adminData.media.set(m.sys.id, m); } catch (e) { console.error('[menu] photos', e); }
  }
  adminData.sections = sections.map(menuRow).sort(bySort);
  adminData.items = items.map(menuRow).sort(bySort);
  return adminData;
}

export function replaceRow(list, item) {
  const row = menuRow(item);
  const i = list.findIndex((r) => r.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
  return row;
}

// Rows carry names in the current language; rebuild them from the raw resources on a language switch.
window.addEventListener('qr:lang', () => {
  if (adminData.sections) adminData.sections = adminData.sections.map((r) => menuRow(r.raw));
  if (adminData.items) adminData.items = adminData.items.map((r) => menuRow(r.raw));
});

// Order lines keep the text written at order time (default locale); show the live menu's name and
// option labels in the current language when the item still exists.
const itemRow = (id) => adminData.items?.find((i) => i.id === id) || null;
export const lineName = (l) => itemRow(l.itemId)?.name || l.name;
export function lineOptions(l) {
  const it = itemRow(l.itemId);
  if (!it || !Array.isArray(l.optionKeys)) return l.options;
  const names = [];
  for (const g of it.optionGroups) for (const o of g.options || []) if (l.optionKeys.includes(`${g.id}:${o.id}`)) names.push(lbl(o.name));
  return names.join(' · ');
}

// ---------- Orders ----------
const ORDER_SELECT = 'sys.id,sys.version,sys.createdAt,fields.orderNo,fields.tableNo,fields.orderType,fields.status,fields.lines,fields.note,fields.total,fields.optionTotal,fields.itemCount,fields.currency,fields.payment';

export function orderRow(item) {
  const f = item.fields || {};
  return {
    id: item.sys.id,
    raw: item,
    createdAt: new Date(item.sys.createdAt).getTime(),
    orderNo: val(f, 'orderNo'),
    tableNo: Number(val(f, 'tableNo')) || 0,
    orderType: val(f, 'orderType') || 'here',
    status: val(f, 'status') || 'new',
    lines: Array.isArray(val(f, 'lines')) ? val(f, 'lines') : [],
    note: val(f, 'note') || '',
    total: Number(val(f, 'total')) || 0,
    optionTotal: Number(val(f, 'optionTotal')) || 0,
    itemCount: Number(val(f, 'itemCount')) || 0,
    currency: val(f, 'currency') || null,
    payment: val(f, 'payment') || 'none', // none = pay at the counter · paid · refunded
  };
}

const iso = (ms) => new Date(ms).toISOString();

// Orders created in [from, to). Filtered on sys.createdAt (an indexed system axis) and paged to the end.
// "pending" rows are checkouts still on Stripe's page (or abandoned there): not orders yet.
export async function fetchOrders(from, to) {
  const items = await admin.list(CT.order, { select: ORDER_SELECT, query: `sys.createdAt[gte]=${iso(from)}&sys.createdAt[lt]=${iso(to)}` });
  return items.map(orderRow).filter((o) => o.status !== 'pending');
}

// Short-lived cache so switching tabs does not re-read the same range; any order event clears it.
const cache = new Map();
export async function ordersCached(key, from, to) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120e3) return hit.data;
  const data = await fetchOrders(from, to);
  cache.set(key, { at: Date.now(), data });
  return data;
}
export const invalidateOrders = () => cache.clear();

// Someone handled an order or a call: that kind's alarm has been heard (the admin shell stops it).
const handled = (kind) => window.dispatchEvent(new CustomEvent('qr:handled', { detail: kind }));

export async function setOrderStatus(order, status) {
  let raw = order.raw;
  for (let i = 0; ; i++) {
    try {
      const saved = await admin.patch(CT.order, raw, { status });
      Object.assign(order, orderRow(saved));
      handled('order');
      return order;
    } catch (e) {
      if (e.status === 409 && i < 2) { raw = await admin.get(CT.order, order.id); continue; }
      throw e;
    }
  }
}

// Refunds a card-paid order through the refund-order Script (it holds the Stripe key and writes the
// order only once Stripe accepted the refund): a new or preparing order is cancelled (rejected), a
// served one stays served and is marked refunded. Stripe's idempotency key makes a retry safe.
export async function refundOrder(order) {
  await runScript(CONFIG.scripts.refundOrder, { orderId: order.id }, adminAuth.get());
  Object.assign(order, orderRow(await admin.get(CT.order, order.id)));
  handled('order');
  return order;
}

// Declining a card-paid order refunds it; a pay-at-counter order just changes status.
export function rejectOrder(order) {
  return order.payment === 'paid' ? refundOrder(order) : setOrderStatus(order, 'rejected');
}

// ---------- Staff calls ----------
export function callRow(item) {
  const f = item.fields || {};
  return {
    id: item.sys.id,
    raw: item,
    createdAt: new Date(item.sys.createdAt).getTime(),
    tableNo: Number(val(f, 'tableNo')) || 0,
    tableLabel: val(f, 'tableLabel') || '',
    requests: Array.isArray(val(f, 'requests')) ? val(f, 'requests') : [],
    status: val(f, 'status') || 'open',
  };
}

export async function fetchOpenCalls() {
  const items = await admin.list(CT.call, {
    select: 'sys.id,sys.version,sys.createdAt,fields',
    query: `sys.createdAt[gte]=${iso(Date.now() - DAY / 2)}`,
    maxPages: 5,
  });
  return items.map(callRow).filter((c) => c.status === 'open').sort((a, b) => a.createdAt - b.createdAt);
}

export async function closeCall(call) {
  await admin.patch(CT.call, call.raw, { status: 'done' });
  handled('call');
}

// ---------- New-order watch ----------
// The ordering Scripts bump a single counter row on every order and staff call. While an admin page
// is open, that one (tiny) row is read by id — every 15 s when visible, every 30 s in a background tab
// so a kitchen screen still rings — and the order list is only re-read when the counter moved.
export const watcher = {
  running: false,
  timer: null,
  last: null,
  listeners: new Set(),
  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', onVisible);
    this.tick();
  },
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', onVisible);
  },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  async tick() {
    clearTimeout(this.timer);
    if (!this.running) return;
    try {
      const c = await admin.get(CT.counter, CONFIG.counterId);
      const snap = { v: c.sys.version, seq: val(c.fields, 'seq'), day: val(c.fields, 'day'), callSeq: val(c.fields, 'callSeq') };
      if (this.last && snap.v !== this.last.v) {
        const newOrder = snap.seq !== this.last.seq || snap.day !== this.last.day;
        const count = !newOrder ? 0 : snap.day === this.last.day ? Math.max(1, snap.seq - this.last.seq) : Math.max(1, snap.seq || 1);
        const evt = { newOrder, count, seq: snap.seq, callChanged: snap.callSeq !== this.last.callSeq };
        if (evt.newOrder) invalidateOrders();
        for (const fn of this.listeners) { try { fn(evt); } catch (e) { console.error(e); } }
      }
      this.last = snap;
    } catch (e) {
      if (e.status === 401) { this.stop(); return; }
    }
    if (this.running) this.timer = setTimeout(() => this.tick(), document.visibilityState === 'visible' ? 15000 : 30000);
  },
};
function onVisible() { if (document.visibilityState === 'visible') watcher.tick(); }

// ---------- Alert sounds ----------
// Alarm sounds, not melodies: hard square-wave beeps at 2–3 kHz, the range the ear is most sensitive to
// and above most kitchen noise (fans, burners). The two kinds differ in rhythm so staff know which it
// is without looking: a new order is rapid "beep-beep-beep-beep" bursts, a staff call a two-tone hi-lo
// alarm. Each lasts about 5 s; the admin shell repeats them until someone acknowledges. Volume is per
// device; a compressor plus make-up gain keeps them loud on tablet speakers.
let audio = null;
let master = null;
const playing = new Map(); // bus gain node -> kind, so an acknowledged alarm can be cut off mid-sound
export const volume = () => { const v = Number(ls.get('qr.admin.volume', 1)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; };
export function setVolume(v) { ls.set('qr.admin.volume', v); if (master) master.gain.value = v; }
export function unlockAudio() {
  try {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      const comp = audio.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 4;
      comp.ratio.value = 12;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
      const makeup = audio.createGain();
      makeup.gain.value = 1.6;
      master = audio.createGain();
      master.gain.value = volume();
      master.connect(comp).connect(makeup).connect(audio.destination);
    }
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no audio */ }
}
// Browsers keep audio blocked until the page has been touched once.
export const audioReady = () => !!audio && audio.state === 'running';
export const soundOn = () => ls.get('qr.admin.sound', null) ?? !!storeVal('soundAlert');
export const setSound = (on) => ls.set('qr.admin.sound', !!on);

// One hard beep: square wave, near-instant attack and release, flat in between.
function beep(bus, freq, start, dur, peak = 0.5) {
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.004);
  g.gain.setValueAtTime(peak, start + dur - 0.006);
  g.gain.linearRampToValueAtTime(0, start + dur);
  o.connect(g).connect(bus);
  o.start(start);
  o.stop(start + dur + 0.02);
}
const PATTERNS = {
  // 6 bursts of 4 fast beeps (like an order printer / kitchen timer alarm) ≈ 5 s
  order: { len: 4.9, vibrate: [70, 40, 70, 40, 70, 40, 70, 380, 70, 40, 70, 40, 70, 40, 70], play: (bus, t0) => {
    let t = t0;
    for (let b = 0; b < 6; b++) {
      for (let i = 0; i < 4; i++) { beep(bus, 3150, t, 0.07); t += 0.11; }
      t += 0.38;
    }
  } },
  // two-tone hi-lo alarm, 8 cycles ≈ 5 s
  call: { len: 4.96, vibrate: [280, 40, 280, 40, 280, 40, 280, 40, 280], play: (bus, t0) => {
    for (let i = 0; i < 8; i++) {
      const t = t0 + i * 0.62;
      beep(bus, 2400, t, 0.28, 0.45);
      beep(bus, 1600, t + 0.3, 0.28, 0.45);
    }
  } },
};
export const alertLength = (kind) => PATTERNS[kind]?.len || 0;

// Cuts off what is sounding now — every alarm, or only one kind.
export function hush(kind) {
  if (!audio) return;
  for (const [bus, k] of playing) {
    if (kind && k !== kind) continue;
    try { bus.gain.cancelScheduledValues(audio.currentTime); bus.gain.setValueAtTime(0, audio.currentTime); bus.disconnect(); } catch { /* already gone */ }
    playing.delete(bus);
  }
  try { navigator.vibrate?.(0); } catch { /* no vibration */ }
}

// Plays one alarm; returns its length in seconds. `force` plays even with alerts switched off (preview).
export function chime(kind = 'order', { force = false } = {}) {
  if (!force && !soundOn()) return 0;
  try {
    unlockAudio();
    const p = PATTERNS[kind];
    if (!audio || !p) return 0;
    if (force) hush();
    const bus = audio.createGain();
    bus.connect(master);
    playing.set(bus, kind);
    setTimeout(() => { if (playing.delete(bus)) { try { bus.disconnect(); } catch { /* gone */ } } }, (p.len + 0.5) * 1000);
    try { navigator.vibrate?.(p.vibrate); } catch { /* no vibration */ }
    p.play(bus, audio.currentTime + 0.05);
    return p.len;
  } catch { return 0; }
}

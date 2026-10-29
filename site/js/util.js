// DOM, formatting, storage and time helpers shared by the customer and admin screens.
import { t, uiTag } from '/js/i18n.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, pv] of Object.entries(v)) {
          if (pv === null || pv === undefined) continue;
          if (p.startsWith('--')) el.style.setProperty(p, pv);
          else el.style[p] = pv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3.7A6 6 0 0 1 18 8c0 3 .7 5 1.4 6.4M17 17H3s3-2 3-9c0-.5 0-.9.1-1.4"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M3 3l18 18"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  insta: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};

// Platform credit. Opens in a new tab so a guest's menu stays where it was.
export const poweredBy = () => h('p', { class: 'powered' },
  h('a', { href: 'https://weegloo.com', target: '_blank', rel: 'noopener' }, 'Powered by ', h('strong', null, 'Weegloo')));

export function icon(name, size = 18, stroke = 2) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return tpl.content.firstChild;
}

export const num = (n) => Math.round(Number(n) || 0).toLocaleString(uiTag());

// ---------- Money ----------
// Prices and totals are stored as integers in the store currency's minor unit (won, cents, yen…);
// the currency itself is a store setting, applied here once the store is loaded.
export const CURRENCIES = ['KRW', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'TWD', 'HKD', 'SGD', 'THB', 'VND', 'PHP', 'IDR', 'MYR', 'AUD', 'NZD', 'CAD'];
let currency = 'KRW';
export const getCurrency = () => currency;
export function setCurrency(code) { currency = CURRENCIES.includes(code) ? code : 'KRW'; }
const fmtCache = new Map();
function nf(tag, cur, opts = {}) {
  const key = `${tag}|${cur}|${JSON.stringify(opts)}`;
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.NumberFormat(tag, { style: 'currency', currency: cur, ...opts }));
  return fmtCache.get(key);
}
export const fractionDigits = (cur = currency) => nf('en-US', cur).resolvedOptions().maximumFractionDigits;
export const toMajor = (minor, cur = currency) => (Number(minor) || 0) / 10 ** fractionDigits(cur);
export const toMinor = (major, cur = currency) => Math.round((Number(major) || 0) * 10 ** fractionDigits(cur));
// Amount as typed in a form: "4500" for KRW, "4.50" for USD.
export const majorInput = (minor, cur = currency) => toMajor(minor, cur).toFixed(fractionDigits(cur));
export function money(minor, cur = currency) {
  const c = CURRENCIES.includes(cur) ? cur : currency;
  // Korean readers expect "4,500원" for won; everything else follows Intl.
  if (c === 'KRW' && uiTag().startsWith('ko')) return t('won', { n: num(minor) });
  return nf(uiTag(), c).format(toMajor(minor, c));
}
export const moneyCompact = (minor, cur = currency) => nf(uiTag(), cur, { notation: 'compact', maximumFractionDigits: 1 }).format(toMajor(minor, cur));
export const currencySymbol = (cur = currency) => (cur === 'KRW' && uiTag().startsWith('ko') ? '원' : nf(uiTag(), cur).formatToParts(0).find((p) => p.type === 'currency')?.value || cur);
export const currencyName = (cur) => { try { return new Intl.DisplayNames([uiTag()], { type: 'currency' }).of(cur); } catch { return cur; } };
export const regionName = (code) => { try { return new Intl.DisplayNames([uiTag()], { type: 'region' }).of(code); } catch { return code; } };
export const pad = (n) => String(n).padStart(2, '0');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// localStorage that never throws (private mode, blocked storage, previews).
export const ls = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
};

let toastTimer = null;
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)?.dataset.loaded) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(s);
  });
}

// ---------- Time ----------
// Times are stored in UTC and shown in the store's time zone (store.timeZone, an IANA name the admin
// screen saves; see admin/data.js syncTimeZone). A store without one is in Korea, the original default.
export const DEFAULT_TIME_ZONE = 'Asia/Seoul';
export const DAY = 86400e3;
let zone = DEFAULT_TIME_ZONE;
const partsFmt = new Map();
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
export const validTimeZone = (tz) => { try { return !!tz && !!new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return false; } };
export function setTimeZone(tz) { zone = validTimeZone(tz) ? tz : DEFAULT_TIME_ZONE; }

// Weekday names in the UI language (dow 0 = Sunday; 2023-01-01 was a Sunday).
export const dayShort = (dow) => new Intl.DateTimeFormat(uiTag(), { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2023, 0, 1 + dow));
export const dayLong = (dow) => new Intl.DateTimeFormat(uiTag(), { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2023, 0, 1 + dow));

// The wall-clock date and time at `ms` in a time zone (the store's by default).
export function storeTime(ms = Date.now(), tz = zone) {
  if (!partsFmt.has(tz)) {
    partsFmt.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric',
    }));
  }
  const p = {};
  for (const { type, value } of partsFmt.get(tz).formatToParts(ms)) p[type] = value;
  const hh = Number(p.hour) % 24;
  const mi = Number(p.minute);
  return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day), dow: WEEKDAY[p.weekday], hh, mi, min: hh * 60 + mi };
}

// The zone's offset from UTC at `ms`, in minutes (540 for Korea; changes with daylight saving time).
export function zoneOffsetMin(ms = Date.now(), tz = zone) {
  const p = storeTime(ms, tz);
  return Math.round((Date.UTC(p.y, p.mo, p.d, p.hh, p.mi) - Math.floor(ms / 60e3) * 60e3) / 60e3);
}

// Epoch ms of the store's midnight, `offset` days from the day containing `ms`. Step from day to day
// with this rather than by adding DAY: a day with a daylight saving change is 23 or 25 hours long.
export function storeMidnight(ms = Date.now(), offset = 0) {
  const p = storeTime(ms);
  const wall = Date.UTC(p.y, p.mo, p.d + offset);
  return wall - zoneOffsetMin(wall - zoneOffsetMin(wall) * 60e3) * 60e3;
}

export const toMs = (iso) => new Date(iso).getTime();
export const hm = (ms) => { const p = storeTime(ms); return `${pad(p.hh)}:${pad(p.mi)}`; };
export const dateLabel = (ms) => new Intl.DateTimeFormat(uiTag(), { month: 'long', day: 'numeric', weekday: 'long', timeZone: zone }).format(ms);
export const md = (ms) => { const p = storeTime(ms); return `${p.mo + 1}/${p.d}`; };
export const minToHM = (min) => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad(((min % 60) + 60) % 60)}`;
export function hmToMin(s) {
  const [a, b] = String(s || '').split(':').map(Number);
  return (a || 0) * 60 + (b || 0);
}
// Minutes after midnight as a clock time in the UI language ("오후 9:00" / "9:00 PM").
export function ampm(min) {
  const hh = Math.floor(min / 60) % 24;
  return new Intl.DateTimeFormat(uiTag(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hh, min % 60));
}
export function ago(ms) {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (m < 1) return t('ago.now');
  if (m < 60) return t('ago.min', { n: m });
  return t('ago.hm', { h: Math.floor(m / 60), m: m % 60 });
}

export const tableLabel = (n) => (Number(n) === 0 ? t('table.takeout') : t('table.n', { n }));
export const typeLabel = (type) => (type === 'togo' ? t('type.togo') : t('type.here'));

export function pct(cur, prev) {
  if (!prev) return cur ? t('pct.new') : '–';
  const p = Math.round(((cur - prev) / prev) * 100);
  return p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : '0%';
}

// replaceChildren that skips null/false/arrays the same way h() does.
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

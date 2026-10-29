// Languages follow the Space's Locales. The list is read from Weegloo (CDA) at boot; content values are
// picked per locale (that Locale's fallbackCode chain, then the Space default). UI strings: English is the
// EN dictionary at the end of this file; ko, ja, zh, de, fr, es, pt, hi and id are in /i18n/<lang>.js and
// load on demand, so a visitor downloads English plus their own language only. A locale shows the text of
// its language (ko-KR → ko, pt-BR → pt); any other locale, and Traditional Chinese, shows English.
import { CONFIG } from '/js/config.js';

// The Locales provisioned in this Space, in the shape the API returns. Used only when the live read
// fails, so a failed read never shrinks the language switcher. Keep in step with the Space.
export const SPACE_LOCALES = [
  { code: 'en-US', name: 'English (United States)', default: true, fallbackCode: null },
  { code: 'ko-KR', name: 'Korean (South Korea)', default: false, fallbackCode: 'en-US' },
];

// UI languages with their own text. Chinese is Simplified only.
export const PRESETS = ['en', 'ko', 'ja', 'zh', 'de', 'fr', 'es', 'pt', 'hi', 'id'];
// A version stamp on this module's URL (?v=…), if a deploy adds one, is passed on to the language files.
const STAMP = new URL(import.meta.url).search;

const LANG_KEY = 'qr.lang';
let locales = SPACE_LOCALES;
let current = SPACE_LOCALES[0].code;
let lang = 'en'; // the UI language on screen
let dict = {}; // its text; a key it lacks (and all of English) comes from EN

function stored() { try { return localStorage.getItem(LANG_KEY); } catch { return null; } }
function remember(code) { try { localStorage.setItem(LANG_KEY, code); } catch { /* storage unavailable */ } }

// The UI language for a locale code: its base language when it has text, else English. Traditional
// Chinese (zh-TW, zh-HK, zh-MO, zh-Hant…) shows English as well.
export function presetFor(code) {
  const parts = String(code || '').toLowerCase().split(/[-_]/);
  if (parts[0] === 'zh' && !parts.includes('hans') && parts.some((p) => ['hant', 'tw', 'hk', 'mo'].includes(p))) return 'en';
  return PRESETS.includes(parts[0]) ? parts[0] : 'en';
}

const loaded = { en: Promise.resolve({}) };
function loadPreset(l) {
  loaded[l] ??= import(`/i18n/${l}.js${STAMP}`).then((m) => m.default || {}, (e) => {
    delete loaded[l]; // try again on the next switch
    console.error(`[i18n] Could not load the ${l} UI text (/i18n/${l}.js): ${e.message}. Showing English.`);
    return null;
  });
  return loaded[l];
}
async function textFor(code) {
  const l = presetFor(code);
  const d = await loadPreset(l);
  return d ? { lang: l, dict: d } : { lang: 'en', dict: {} };
}

export async function initLocales() {
  // Start on the text the provisioned list would choose while the live list loads (usually the same).
  loadPreset(presetFor(initial()));
  const url = `${CONFIG.cda}/v1/spaces/${CONFIG.spaceId}/locales?limit=100`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${CONFIG.customerToken}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const list = (d.items || []).map((l) => ({
      code: l.sys?.code,
      name: l.sys?.name || l.sys?.code,
      default: !!l.sys?.default,
      fallbackCode: l.fallbackCode ?? l.sys?.fallbackCode ?? null,
    })).filter((l) => l.code);
    if (!list.some((l) => l.default)) throw new Error('the response names no default locale');
    locales = list.sort((a, b) => Number(b.default) - Number(a.default));
  } catch (e) {
    console.error(`[i18n] Could not read the Space locales (GET ${url}): ${e.message}. Using the provisioned list (${SPACE_LOCALES.map((l) => l.code).join(', ')}).`);
    locales = SPACE_LOCALES;
  }
  current = initial();
  ({ lang, dict } = await textFor(current));
  applyDocument();
}

// Saved choice, else the browser's languages (exact code, then language), else the Space default.
function initial() {
  const saved = stored();
  if (saved && locales.some((l) => l.code === saved)) return saved;
  const prefs = (navigator.languages?.length ? navigator.languages : [navigator.language || '']).map((x) => String(x).toLowerCase());
  for (const p of prefs) { const hit = locales.find((l) => l.code.toLowerCase() === p); if (hit) return hit.code; }
  for (const p of prefs) { const hit = locales.find((l) => l.code.toLowerCase().split('-')[0] === p.split('-')[0]); if (hit) return hit.code; }
  return defaultLocale();
}

function applyDocument() {
  document.documentElement.lang = current;
  // index.html labels its loading spinner in English until the language is known.
  document.querySelector('#app > .boot')?.setAttribute('aria-label', t('loading'));
}

export const getLocales = () => locales;
export const defaultLocale = () => (locales.find((l) => l.default) || locales[0]).code;
export const contentLocale = () => current;

// Switches once that language's UI text has loaded; the newest pick wins if several overlap.
let switches = 0;
export async function setLocale(code) {
  const mine = ++switches;
  if (code === current || !locales.some((l) => l.code === code)) return;
  const next = await textFor(code);
  if (mine !== switches) return;
  current = code;
  ({ lang, dict } = next);
  remember(code);
  applyDocument();
  window.dispatchEvent(new Event('qr:lang'));
}

// The locales to try for a value: the locale, its fallbackCode chain, then the Space default.
export function localeChain(code = current) {
  const out = [];
  let c = code;
  while (c && !out.includes(c)) { out.push(c); c = locales.find((l) => l.code === c)?.fallbackCode || null; }
  const d = defaultLocale();
  if (!out.includes(d)) out.push(d);
  return out;
}

const LOCALE_KEY = /^[a-z]{2,3}-[A-Za-z0-9-]+$/;
export function isBucket(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.sys) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => LOCALE_KEY.test(k) || locales.some((l) => l.code === k));
}

const filled = (v) => v !== undefined && v !== null && (typeof v === 'string' ? v.trim() !== '' : true);
// Only the locale, its fallbackCode chain and the Space default are read — as Weegloo does. Text that
// exists only in another language is not shown (a Korean-only note stays off the English screen).
export function pick(bucket, code = current) {
  for (const c of localeChain(code)) if (filled(bucket[c])) return bucket[c];
  return undefined;
}

// Locales whose screens would show nothing for this translatable text (filled somewhere, but not in
// that locale, its fallbacks or the default) — used to warn admins.
export function missingIn(map) {
  const b = Object.fromEntries(Object.entries(map || {}).filter(([, v]) => filled(v)));
  if (!Object.keys(b).length) return [];
  return locales.filter((l) => localeChain(l.code).every((c) => !filled(b[c]))).map((l) => l.code);
}

// A label that may be plain text or { localeCode: text } (option names inside the menu JSON).
export const lbl = (x, code) => (isBucket(x) ? pick(x, code) ?? '' : x ?? '');

// Native language name for the switcher ("English", "한국어"); the full code is named when two
// Space locales share a language.
export function langName(code) {
  const primary = code.split('-')[0];
  const shared = locales.filter((l) => l.code.split('-')[0] === primary).length > 1;
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(shared ? code : primary);
    if (n && n !== primary && n !== code) return n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
  } catch { /* Intl.DisplayNames unavailable */ }
  return locales.find((l) => l.code === code)?.name || code;
}

// Locale for number/date formatting: the chosen locale when the UI speaks its language, else English.
export const uiTag = () => (current.split('-')[0].toLowerCase() === lang ? current : 'en-US');

function hasJong(word) {
  const code = String(word ?? '').trim().slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

// Template syntax: {name} inserts a value; {name~을/를} (Korean text only) appends the particle that
// fits the value; {n#item/items} picks singular/plural by n (the first form when n is 1).
const TOKEN = /\{(\w+)(?:([~#])([^/}]*)\/([^}]*))?\}/g;
function render(key, p, asParts) {
  const tpl = dict[key] ?? EN[key] ?? key;
  const parts = [];
  let last = 0;
  for (const m of tpl.matchAll(TOKEN)) {
    parts.push(tpl.slice(last, m.index));
    const [, name, kind, a, b] = m;
    const v = p[name];
    if (!kind) parts.push(v ?? '');
    else if (kind === '#') parts.push(Number(v) === 1 ? a : b);
    else parts.push(v ?? '', hasJong(v) ? a : b);
    last = m.index + m[0].length;
  }
  parts.push(tpl.slice(last));
  return asParts ? parts.filter((x) => x !== '') : parts.join('');
}
export const t = (key, p = {}) => render(key, p, false);
// Like t(), but values may be DOM nodes (e.g. <strong>); returns parts for h().
export const tr = (key, p = {}) => render(key, p, true);

export const badgeLabel = (code) => (code ? t(`badge.${code}`) : '');
export const payLabel = (code) => t(`pay.${code}`);

// English: the source text, and the fallback for any key a language file lacks.
const EN = {
  loading: 'Loading…',
  'app.loadFail': "Couldn't load this page.",
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  copied: 'Copied',
  'lang.label': 'Language',
  'ago.now': 'just now',
  'ago.min': '{n} min ago',
  'ago.hm': '{h} h {m} min ago',
  'table.n': 'Table {n}',
  'table.takeout': 'Takeout · Queue',
  'type.here': 'Dine-in',
  'type.togo': 'Takeout',
  'pct.new': 'New',
  'day.today': 'today',
  'day.tomorrow': 'tomorrow',
  'hours.closedDays': 'Closed {days}',
  'count.orders': '{n} {c#order/orders}',
  'count.items': '{n} {c#item/items}',
  'store.defaultName': 'My store',
  'cart.gone': 'No longer available',
  'pay.default': 'Please pay at the counter after ordering.',
  'pay.card': 'Card',
  'pay.cash': 'Cash',
  'pay.easy': 'Mobile pay',
  'pay.transfer': 'Bank transfer',
  'badge.popular': 'Popular',
  'badge.new': 'New',
  'call.water': 'Water',
  'call.napkin': 'Napkins',
  'call.cutlery': 'Cutlery',
  'call.other': 'Something else',
  'color.orange': 'Orange',
  'color.blue': 'Blue',
  'color.green': 'Green',
  'color.black': 'Black',
  'st.new': 'New',
  'st.preparing': 'Preparing',
  'st.done': 'Done',
  'st.rejected': 'Declined',
  'st.refunded': 'Refunded',
  qrAria: '{label} QR code',
  'l10n.editLang': 'Language',
  'l10n.default': '(default)',
  'l10n.missing': 'Not shown on {langs} screens — that language and its fallback are empty.',
  'l10n.hint': 'The default language is required. Anything left empty in another language shows the default.',

  // Customer
  'c.loadingMenu': 'Loading the menu…',
  'c.menuLoadFail': "Couldn't load the menu.",
  'c.back': 'Go back',
  'c.status.open': 'Open · until {time}',
  'c.status.paused': 'Not taking orders right now',
  'c.status.lastOrder': 'Last order passed · open until {time}',
  'c.status.closedNext': 'Closed · opens {when}',
  'c.status.closed': 'Closed',
  'c.stepper.dec': 'One less {name}',
  'c.stepper.inc': 'One more {name}',
  'c.step.received': 'Received',
  'c.step.preparing': 'Preparing',
  'c.step.ready': 'Ready',
  'c.step.served': 'Served',
  'c.progress': 'Order progress',
  'c.total': 'Total',
  'c.etc': 'Other',
  'c.myOrders': 'My orders',
  'c.storeInfo': 'Store info',
  'c.notTakingBrowse': "We're not taking orders right now. You can still browse the menu.",
  'c.sections': 'Menu sections',
  'c.noMenu': 'No menu items yet.',
  'c.allergyLink': 'See allergen & origin info',
  'c.allergyAsk': 'Please ask our staff about allergens.',
  'c.vatIncluded': ' Prices include VAT.',
  'c.viewCart': 'View cart',
  'c.soldOut': 'Sold out',
  'c.add': 'Add {name}',
  'c.notFoundItem': "We couldn't find that item.",
  'c.backToMenu': 'Back to menu',
  'c.opt.required': 'Required',
  'c.opt.multi': 'Optional · choose any',
  'c.opt.optional': 'Optional',
  'c.qty': 'Quantity',
  'c.added': 'Added to your cart',
  'c.chooseOpt': 'Please choose {group}.',
  'c.addFor': 'Add · {price}',
  'c.soldOutItem': 'This item is sold out',
  'c.notTaking': "We're not taking orders right now",
  'c.cart': 'Cart',
  'c.orderType': 'Order type',
  'c.eatHere': "I'll eat here",
  'c.takeOut': "I'll take it to go",
  'c.inCart': 'In your cart: {n}',
  'c.soldOutDropped': 'Sold out · left out of the order',
  'c.remove': 'Remove',
  'c.cartEmpty': 'Your cart is empty.',
  'c.addMore': '+ Add more items',
  'c.note': 'Requests',
  'c.optional': '(optional)',
  'c.notePh': 'e.g. Less ice, 2 forks please',
  'c.subtotal': 'Subtotal',
  'c.payAccepted': ' We accept {methods}.',
  'c.sending': 'Sending your order…',
  'c.placeOrder': 'Order · {price}',
  'c.err.closed': "We're not taking orders right now.",
  'c.err.soldOut': '{name} just sold out. Please check your cart.',
  'c.err.someItem': 'An item',
  'c.err.option': 'Please choose {group} for {name} again.',
  'c.err.itemFallback': 'this item',
  'c.err.optionFallback': 'the options',
  'c.err.togo': "We're not taking takeout orders right now.",
  'c.err.generic': "Couldn't send your order. Please try again shortly.",
  'c.err.payment': 'Couldn\'t open the payment page. Please try again.',
  'c.err.payMin': 'The total is below the minimum for card payment.',
  'c.payOrder': 'Pay {price} & order',
  'c.toPayment': 'Opening payment…',
  'c.payNowNote': 'You pay by card when you order. The order goes to the kitchen once payment is done.',
  'c.payCancelled': 'Payment cancelled. Your cart is still here.',
  'c.payRecovered': 'Payment confirmed for order {no}.',
  'c.test.title': 'Test mode — you won\'t be charged',
  'c.test.card': 'Card number',
  'c.test.copy': 'Copy',
  'c.test.rest': 'Expiry: any future date (e.g. 12/34) · CVC: any 3 digits (e.g. 123). Real cards don\'t work.',
  'c.paid.checking': 'Checking your payment…',
  'c.paid.unpaid': 'We couldn\'t confirm the payment.',
  'c.paid.unpaidSub': 'If you paid, check again in a moment. Nothing is ordered until the payment is confirmed.',
  'c.paid.failed': 'Couldn\'t check the payment right now. Please try again.',
  'c.paid.retry': 'Check again',
  'c.paid.backToCart': 'Back to cart',
  'c.done.paidSub': 'Paid by card.',
  'c.done.refundedSub': 'Your card payment has been refunded.',
  'c.paidTotal': 'Paid',
  'c.paidNote': 'Paid by card when ordering. Declined orders are refunded automatically.',
  'c.refundedPill': 'Refunded',
  'c.payCardPrepay': 'Card (pay when ordering)',
  'c.payPrepayInfo': 'You pay by card when you place an order.',
  'c.orderNotFound': "We couldn't find that order.",
  'c.done.cancelled': 'Your order was cancelled',
  'c.done.ready': 'Your order is ready',
  'c.done.served': 'Your order has been served',
  'c.done.received': 'Order received',
  'c.done.cancelledSub1': 'The store had to cancel your order.',
  'c.done.cancelledSub2': 'Please ask our staff for details.',
  'c.done.togoSub': "We'll call your order number when it's ready.",
  'c.done.hereSub': "We'll bring it to your table when it's ready.",
  'c.done.readySub': 'Please pick it up at the counter.',
  'c.done.servedSub': 'Enjoy! Let us know if you need anything.',
  'c.done.paySub': 'To pay, give your order number at the counter.',
  'c.orderNo': 'Order number',
  'c.aboutMin': 'about {n} min',
  'c.noteLine': 'Request: {note}',
  'c.orderMore': 'Order more',
  'c.allOrders': 'See all my orders',
  'c.noOrders': "You haven't ordered from this device yet.",
  'c.seeMenu': 'See the menu',
  'c.activeOrder': 'Order in progress',
  'c.orderNoAt': 'Order number · {time}',
  'c.pastOrder': 'Past order',
  'c.cancelledPill': 'Cancelled',
  'c.tableTotal': 'Table total',
  'c.payOnLeave': 'When you leave, give your table number at the counter to pay.',
  'c.checking': 'Checking…',
  'c.refresh': 'Refresh order status',
  'c.staffCall': 'Call staff',
  'c.called': "We've called a staff member. We'll let you know once they've seen it.",
  'c.callAck': 'Staff saw your request and are on the way.',
  'c.requests': 'Requests',
  'c.calling': 'Calling…',
  'c.requestN': 'Send {n} {n#request/requests}',
  'c.callStaff': 'Call staff',
  'c.err.callDisabled': 'Staff calls are turned off right now.',
  'c.err.call': "Couldn't call staff. Please try again.",
  'c.info.openNow': 'Open now · until {time}',
  'c.info.lastOrder': ' (last order {time})',
  'c.info.openNoOrders': 'Open · not taking orders right now',
  'c.hours': 'Opening hours',
  'c.closedDay': 'Closed',
  'c.today': ' · Today',
  'c.wifi': 'Wi-Fi',
  'c.wifiName': 'Network',
  'c.wifiPw': 'Password · tap to copy',
  'c.contact': 'Location · Contact',
  'c.closeMap': 'Close map',
  'c.map': 'Map',
  'c.mapTitle': 'Where to find {name}',
  'c.call': 'Call',
  'c.payInfo': 'Payment',
  'c.payDefaultInfo': 'Order with the QR code and pay at the counter.',
  'c.allergy': 'Allergens · Origin',
  'c.closed.paused1': "We've paused orders for a moment.",
  'c.closed.paused2': 'Please check back a little later.',
  'c.closed.notYet1': "It's not ordering time yet.",
  'c.closed.notYet2': 'You can order from {time} today.',
  'c.closed.lastOrder1': 'Orders are closed for today.',
  'c.closed.over1': "We're closed for today.",
  'c.closed.seeYou': 'See you {day} at {time}.',
  'c.closed.browse': 'Just browse the menu',
  'c.closed.info': 'See store info',
  'c.closed.myOrders': 'See my orders',

  // Admin: shell & login
  'nav.dashboard': 'Dashboard',
  'nav.orders': 'Orders',
  'nav.menu': 'Menu',
  'nav.sales': 'Sales report',
  'nav.settings': 'Store settings',
  'a.docTitle': '{page} · {store} admin',
  'a.login.notMember': "This Weegloo account isn't invited to this store. Ask the store admin for an invite, or sign in with another account.",
  'a.login.expired': 'Your sign-in expired. Please sign in again.',
  'a.login.error': "Couldn't verify your sign-in. Please try again.",
  'a.login.docTitle': 'Admin sign-in · {store}',
  'a.hero1': 'One QR code to take orders',
  'a.hero2': 'and see your day at a glance.',
  'a.heroP': 'Menu edits reach the customer screen right away. Handle order alerts, sold-out items and daily sales from this one screen.',
  'a.tag1': 'Cafés',
  'a.tag2': 'Pop-up bars',
  'a.tag3': 'Food trucks',
  'a.tag4': 'Small studios',
  'a.login.title': 'Admin sign-in',
  'a.login.sub': 'Sign in with your Weegloo account.',
  'a.login.btn': 'Sign in with Weegloo',
  'a.login.keep': 'Keep me signed in',
  'a.login.help': "Only accounts invited to this store (Weegloo Space) can sign in. If the sign-in window doesn't open, allow pop-ups for this site.",
  'a.login.back': 'Go to the customer screen',
  'a.adminTag': 'Admin',
  'a.adminNav': 'Admin menu',
  'a.customerView': 'Customer view',
  'a.logout': 'Sign out',
  'a.open': 'Taking orders',
  'a.closed': 'Orders closed',
  'a.toast.reopened': 'Taking orders again.',
  'a.toast.closed': 'Orders closed. Customers can only browse the menu.',
  'a.toast.changeFail': "Couldn't change it. Please try again.",
  'a.toast.call': '{table} called staff{requests}',
  'a.alert.order': 'New order {no}',
  'a.alert.orders': '{n} new orders',
  'a.alert.view': 'See orders',
  'a.alert.ok': 'Got it',
  'a.alert.untilOk': 'Keeps ringing until you press OK or handle it',
  'a.soundUnlock': 'Tap anywhere once to turn on alert sounds',
  'a.storeMissing': 'The store settings entry is missing. Check it in the Weegloo console.',
  'a.statusFail': "Couldn't change the status. Please try again.",
  'a.notInSales': 'Not counted in sales',

  // Admin: dashboard
  'd.today': 'Today',
  'd.todayTitle': "Today's sales",
  'd.vsYesterday': 'vs. same time yesterday',
  'd.byHour': 'Sales by hour',
  'd.week': 'Last 7 days',
  'd.weekTitle': 'Last 7 days',
  'd.vsPrev7': 'vs. previous 7 days',
  'd.byDay': 'Sales by day',
  'd.month': 'Last 4 weeks',
  'd.monthTitle': 'Last 4 weeks',
  'd.vsPrev4w': 'vs. previous 4 weeks',
  'd.byWeek': 'Sales by week',
  'd.act.start': 'Start',
  'd.act.done': 'Mark done',
  'd.hour': '{h}:00',
  'd.weekOf': 'Wk {date}',
  'd.period': 'Period',
  'd.peakAria': '{chart}, highest: {label}',
  'd.noOrdersPeriod': 'No orders in this period yet.',
  'd.topItems': 'Best sellers',
  'd.noSold': 'Nothing sold yet.',
  'd.live': 'Live orders',
  'd.waiting': '{n} waiting',
  'd.allOrders': 'All orders',
  'd.col.order': 'Order',
  'd.col.seat': 'Seat',
  'd.col.items': 'Items',
  'd.col.amount': 'Amount',
  'd.col.time': 'Time',
  'd.col.status': 'Status',
  'd.col.action': 'Action',
  'd.handled': 'Handled',
  'd.loadFail': "Couldn't load order data.",
  'd.noToday': 'No orders today yet.',
  'k.sales': 'Sales',
  'k.totalSales': 'Total sales',
  'k.orders': 'Orders',
  'k.avg': 'Avg. order',
  'k.qty': 'Items sold',
  'k.rejectedN': '{n} declined',
  'k.refundedN': '{n} refunded',

  // Admin: orders
  'o.col.new': 'New',
  'o.act.accept': 'Accept & start',
  'o.col.preparing': 'Preparing',
  'o.act.ready': 'Ready',
  'o.col.closed': 'Done · Declined',
  'o.showing': '{date} · showing {n} {c#order/orders}',
  'o.title': 'Orders',
  'o.filter': 'Order type filter',
  'o.all': 'All',
  'o.soundOn': 'Sound on',
  'o.soundOff': 'Sound off',
  'o.calls': 'Staff calls',
  'o.callsN': 'Staff calls: {n}',
  'o.callGeneric': 'Staff call',
  'o.ack': 'Got it',
  'o.empty': 'No orders',
  'o.noOptions': 'No options',
  'o.reject': 'Decline',
  'o.rejectConfirm': 'Decline order {no}? The customer will see it as cancelled.',
  'o.rejectRefundConfirm': 'Decline order {no}? The {amount} card payment will be refunded.',
  'o.refunded': 'Order {no} declined and refunded.',
  'o.refundFail': 'Couldn\'t refund, so the order was not declined. Please try again.',
  'o.paidTag': 'Paid',
  'o.refund': 'Refund',
  'o.refundOpenConfirm': 'Refund order {no}? The {amount} card payment goes back to the customer and the order is cancelled. This can\'t be undone.',
  'o.refundDoneConfirm': 'Refund order {no}? The {amount} card payment goes back to the customer. The order stays served. This can\'t be undone.',
  'o.refundDone': 'Order {no} refunded.',
  'o.refundFailOnly': 'Couldn\'t refund. Nothing was changed — please try again.',
  'o.actionFail': "Couldn't do that. Please try again.",
  'o.loadFail': "Couldn't load orders.",

  // Admin: menu
  'm.loadFail': "Couldn't load the menu.",
  'm.conflict': 'It was changed somewhere else first. The latest version is loaded.',
  'm.summary': '{s} sections · {i} items · {o} sold out',
  'm.title': 'Menu',
  'm.addItem': 'Add item',
  'm.sections': 'Sections',
  'm.renameSection': 'Rename section',
  'm.rename': 'Rename',
  'm.up': 'Move {name} up',
  'm.down': 'Move {name} down',
  'm.renameBtn': 'Rename',
  'm.delete': 'Delete',
  'm.newSection': 'New section name',
  'm.add': 'Add',
  'm.addSection': 'Add section',
  'm.makeSectionFirst': 'Create a section first',
  'm.countN': ' {n}',
  'm.hint': '▲▼ to reorder · changes go live right away',
  'm.optN': '{n} {n#option group/option groups}',
  'm.hidden': 'Hidden',
  'm.noDesc': 'No description',
  'm.soldAria': 'Mark {name} as sold out',
  'm.edit': 'Edit {name}',
  'm.del': 'Delete {name}',
  'm.emptySection': 'No items yet. Use “Add item” at the top to add the first one.',
  'm.secPh': 'e.g. Seasonal',
  'm.newItem': 'New item',
  'm.editItem': 'Edit item',
  'm.f.photo': 'Photo',
  'm.f.photoHint': '(optional · shown on the menu and item page)',
  'm.f.photoAdd': 'Add photo',
  'm.f.photoChange': 'Change photo',
  'm.f.photoRemove': 'Remove',
  'm.photo.notImage': 'Choose an image file (JPG, PNG, WebP…).',
  'm.photo.tooBig': 'This photo is over {mb} MB. Choose a smaller one, or resize it first.',
  'm.photo.uploading': 'Uploading the photo…',
  'm.photo.processing': 'Preparing the photo…',
  'm.photo.planLimit': "This file is over your plan's upload size limit. Choose a smaller or resized photo, or raise the limit with a plan upgrade.",
  'm.photo.failed': "This photo couldn't be processed. Try another file.",
  'm.photo.slow': 'The photo is taking long to process. Try again in a moment.',
  'm.photo.uploadFail': "Couldn't upload the photo. Please try again.",
  'm.photo.wait': 'Wait until the photo finishes uploading.',
  'm.f.name': 'Name',
  'm.f.namePh': 'e.g. Black sesame latte',
  'm.f.price': 'Price ({cur})',
  'm.f.section': 'Section',
  'm.f.badge': 'Badge',
  'm.f.none': 'None',
  'm.f.desc': 'Description',
  'm.f.descHint': '(optional · one line)',
  'm.f.descPh': 'e.g. Nutty black sesame with milk',
  'm.f.detail': 'Details',
  'm.f.detailHint': '(optional · shown on the item page)',
  'm.saving': 'Saving…',
  'm.addTo': 'Add to {section}',
  'm.opt.title': 'Options',
  'm.opt.hint': '(temperature, size, extras…)',
  'm.opt.temp': '+ Temperature',
  'm.opt.size': '+ Size',
  'm.opt.extra': '+ Extras',
  'm.opt.blank': '+ Empty group',
  'm.opt.none': 'Items without options can be added straight from the menu list.',
  'm.opt.groupPh': 'Group name (e.g. Temperature)',
  'm.opt.groupAria': 'Option group name',
  'm.opt.required': 'Required',
  'm.opt.multi': 'Allow several',
  'm.opt.delGroup': 'Delete group',
  'm.opt.namePh': 'Option name',
  'm.opt.descPh': 'Note',
  'm.opt.priceAria': 'Extra charge ({cur})',
  'm.opt.del': 'Delete option',
  'm.opt.add': '+ Add option',
  'm.err.groupName': 'Enter a name for each option group.',
  'm.err.groupEmpty': 'Add at least one option to “{name}”.',
  'm.err.name': 'Enter the item name.',
  'm.err.price': 'Check the price.',
  'm.err.section': 'Choose a section.',
  'm.err.tooMany': 'Too many options. Please remove a few.',
  'm.saved': 'Saved. The customer screen is updated.',
  'm.saveFail': "Couldn't save. Please try again.",
  'm.soldOff': '{name} is back on sale.',
  'm.soldOn': '{name} is marked as sold out.',
  'm.toggleFail': "Couldn't change it. Please try again.",
  'm.delConfirm': 'Delete “{name}”? It disappears from the customer screen right away.',
  'm.deleted': 'Deleted.',
  'm.delFail': "Couldn't delete. Please try again.",
  'm.orderFail': "Couldn't change the order.",
  'm.err.secName': 'Enter a section name.',
  'm.secAddFail': "Couldn't add the section.",
  'm.renameFail': "Couldn't rename it.",
  'm.secNotEmpty': 'Move or delete the items in this section first.',
  'm.secDelConfirm': 'Delete the “{name}” section?',
  'm.secDelFail': "Couldn't delete the section.",

  // Admin: settings
  's.t.accept': 'Take QR orders',
  's.t.acceptHelp': 'When off, customers can only browse the menu',
  's.t.prepay': 'Pay when ordering (card)',
  's.t.prepayHelp': 'Orders reach you only after the customer pays by card, so nobody can order without paying — from home or anywhere else. Declining a paid order refunds it. When on, the payment methods and payment note are not shown to customers.',
  's.t.prepayTest': 'Stripe test mode: nothing is actually charged.',
  's.t.togo': 'Allow takeout',
  's.t.togoHelp': 'Customers choose dine-in or takeout in the cart',
  's.t.note': 'Order requests',
  's.t.noteHelp': 'Accept requests like “less ice” or “extra fork”',
  's.t.call': 'Staff call button',
  's.t.callHelp': 'Show water and napkin request buttons to customers',
  's.t.sound': 'New order sound',
  's.t.soundHelp': 'Play a sound on the admin screen when an order arrives (each device can change this)',
  's.soundTest': 'Alert sounds',
  's.soundTestHelp': 'A new order sounds a rapid beep-beep-beep-beep alarm, a staff call a two-tone hi-lo alarm (about 5 s each). They keep repeating until someone presses OK on the alert or handles that order/call (up to 30 minutes). Volume is saved on this device.',
  's.soundOrder': 'New order',
  's.soundCall': 'Staff call',
  's.volume': 'Volume',
  's.dirty': 'You have unsaved changes',
  's.clean': 'All changes saved',
  's.headSub': 'Changes reach the customer screen and QR cards right away',
  's.title': 'Store settings',
  's.nav': 'Settings sections',
  's.info': 'Store info',
  's.hours': 'Opening hours',
  's.order': 'Ordering',
  's.qr': 'Tables · QR',
  's.brand': 'Brand color',
  's.l10nHint': 'Store name, tagline, address, payment note and allergen info are kept per language. The default language is required; anything left empty in another language shows the default.',
  's.country': 'Country / region',
  's.currency': 'Currency',
  's.currencyWarn': 'Prices are not converted when the currency changes — an amount shown as {from} becomes {to}. After saving, check the prices in Menu.',
  's.addrPhIntl': 'Street address, city',
  's.addrKrHint': 'Address search uses the South Korean address database (Kakao) and fills in the English address too.',
  's.addrIntlHint': 'Automatic address search covers South Korea only, so type the address here. Customers see it as entered, with a map.',
  's.postcodeLabel': 'Postcode',
  's.name': 'Store name',
  's.phone': 'Phone',
  's.intro': 'Tagline',
  's.introPh': 'Shown at the top of the customer screen',
  's.addr': 'Address',
  's.addrHint': '(food trucks & pop-ups: today’s location)',
  's.addrPh': 'Use “Find address” or type it in',
  's.addrSearch': 'Find address',
  's.postcode': 'Postcode {code}',
  's.addr2': 'Address details',
  's.addr2Ph': 'Floor, unit, etc.',
  's.wifi': 'Wi-Fi name',
  's.wifiPh': 'Leave empty if none',
  's.wifiPw': 'Wi-Fi password',
  's.sns': 'Social account',
  's.snsPh': '@instagram or a link',
  's.pay': 'Payment methods',
  's.allergy': 'Allergens · Origin',
  's.allergyHint': '(shown on the store info screen)',
  's.allergyPh': 'List allergens such as milk, wheat and eggs, and where ingredients come from',
  's.dayOpenAria': 'Open on {day}',
  's.open': 'Open',
  's.closed': 'Closed',
  's.startAria': '{day} opening time',
  's.endAria': '{day} closing time',
  's.overnight': 'For hours past midnight (e.g. 18:00 – 02:00), set a closing time earlier than the opening time.',
  's.lastOrder': 'Last order',
  's.last30': '30 min before closing',
  's.last15': '15 min before closing',
  's.last0': 'At closing time',
  's.prep': 'Estimated prep time (min)',
  's.payNotice': 'Payment note',
  's.tables': 'Tables',
  's.tableDec': 'Fewer tables',
  's.tableInc': 'More tables',
  's.print': 'Print {n} QR cards',
  's.cardDesign': 'See card design',
  's.tablesAfterSave': 'The new table count reaches the print screen after you save.',
  's.brandSub': 'Used on order buttons, badges and QR cards',
  's.brandAria': 'Accent color',
  's.preview': 'Preview',
  's.reset': 'Revert',
  's.save': 'Save changes',
  's.noTable': 'Order without a table',
  's.postcodeFail': "Couldn't load address search. Please type the address.",
  's.err.name': 'Enter the store name.',
  's.conflict': 'It was changed somewhere else first. Refresh and save again.',

  // Admin: sales report
  'r.weekTable': 'Daily sales',
  'r.monthTable': 'Weekly sales',
  'r.colDate': 'Date',
  'r.colWeek': 'Week',
  'r.fileWeek': 'last-7-days',
  'r.fileMonth': 'last-4-weeks',
  'r.file': 'sales-report_{range}_{date}.csv',
  'r.title': 'Sales report',
  'r.csv': 'Download CSV',
  'r.closed': 'Closed',
  'r.avgPerDay': 'Avg. {n} per open day',
  'r.perOrder': 'Average per order',
  'r.optExtra': 'Option extras {amount}',
  'r.share': 'Sales by section',
  'r.shareAria': 'Sales by section: {list}',
  'r.noData': 'No sales data yet.',
  'r.optNote': 'Option extras ({amount}) are not counted in section shares.',
  'r.byItem': 'Sales by item',
  'r.sort': 'Sort',
  'r.bySales': 'By sales',
  'r.byQty': 'By quantity',
  'r.colItem': 'Item',
  'r.colRejected': 'Declined/refunded',
  'r.colSection': 'Section',
  'r.colQty': 'Qty',
  'r.colShare': 'Share',
  'r.revNoOpt': 'Sales (excl. options)',
  'r.noItems': 'No items sold in this period.',
  'r.heat': 'Orders by day and hour',
  'r.peak': 'Busiest: {day} {hour}',
  'r.peakEmpty': 'Busy hours show up once orders build up',
  'r.heatAria': 'Heatmap of average orders by weekday and hour',
  'r.heatClosed': 'Closed on {day}',
  'r.heatCell': '{day} {hour}: avg. {n} orders',
  'r.less': 'Fewer',
  'r.more': 'More',
  'r.loadFail': "Couldn't load sales data.",

  // Admin: QR cards
  'q.docTitle': 'QR cards · {store}',
  'q.one': 'Table QR card',
  'q.many': '{n} QR cards',
  'q.help': "Prints 4 per A4 page. Pointing a camera at a card opens that table's menu.",
  'q.all': 'See all cards',
  'q.settings': 'Back to store settings',
  'q.print': 'Print',
  'q.libFail': "Couldn't load the QR code tool. Check your connection and refresh.",
  'q.head1': 'Scan for the menu',
  'q.head2': 'and order right here',
  'q.foot': 'Point your camera to open the menu · no app needed',
};

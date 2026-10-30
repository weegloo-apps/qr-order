import { CONFIG, CALL_REASONS, TEST_CARD } from '/js/config.js';
import { runScript } from '/js/api.js';
import { goBack, navigate, onLeave } from '/js/main.js';
import { WEEK_ORDER, hoursSummary, storeStatus } from '/js/hours.js';
import { badgeLabel, lbl, payLabel, t, tr, uiTag } from '/js/i18n.js';
import { langSwitcher } from '/js/lang-ui.js';
import { ampm, dayShort, h, hm, icon, poweredBy, tableLabel, toMs, toast, typeLabel, money, fill } from '/js/util.js';
import {
  CALL_ACK_MS, activeOrders, addPendingPay, addToCart, cartView, clearCart, confirmPayment, data, dropPendingPay, ensureData,
  getCall, getCart, getMyOrders, getTable, justPlaced, markJustPlaced, pendingPays, recoverPayments,
  hasRequiredOptions, itemById, itemQty, lastLineOf, lineName, lineOptions, onReturnRefresh, refreshStatuses, saveCart, saveOrder,
  sectionName, setCall, setLineQty, setTable, unitPrice, watchOrders,
} from '/js/customer/state.js';

export async function renderCustomer(app, path, isCurrent) {
  const tm = path.match(/^\/t\/(\d{1,3})$/);
  if (tm) {
    setTable(Number(tm[1]));
    history.replaceState({}, '', '/');
    path = '/';
  }
  document.body.dataset.area = 'customer';
  if (!data.store) app.replaceChildren(h('div', { class: 'center-msg' }, h('p', { class: 'muted' }, t('c.loadingMenu'))));
  try {
    await ensureData();
  } catch (e) {
    console.error(e);
    if (isCurrent()) {
      app.replaceChildren(h('div', { class: 'center-msg' },
        h('p', null, t('c.menuLoadFail')),
        h('button', { type: 'button', class: 'btn', onClick: () => location.reload() }, t('common.retry'))));
    }
    return;
  }
  if (!isCurrent()) return;

  const root = h('div', { class: 'c-page' });
  let paint;
  const item = path.match(/^\/item\/([A-Za-z0-9_-]{1,64})$/);
  const done = path.match(/^\/done\/([A-Za-z0-9_-]{1,64})$/);
  const paid = path.match(/^\/paid\/([A-Za-z0-9_-]{1,64})$/);
  if (item) paint = detailScreen(root, item[1]);
  else if (paid) paint = await paidScreen(root, paid[1], isCurrent);
  else if (path === '/cart') paint = cartScreen(root);
  else if (done) paint = await doneScreen(root, done[1], isCurrent);
  else if (path === '/orders') paint = ordersScreen(root);
  else if (path === '/info') paint = infoScreen(root);
  else if (path === '/menu') paint = menuScreen(root);
  else {
    if (path !== '/') history.replaceState({}, '', '/');
    paint = storeStatus(data.store).accepting ? menuScreen(root) : closedScreen(root);
  }
  if (!isCurrent()) return;
  app.replaceChildren(root);
  if (paint) onLeave(onReturnRefresh(paint));
  if (!paid && pendingPays().length) {
    recoverPayments().then((list) => {
      if (!list.length || !isCurrent()) return;
      toast(t('c.payRecovered', { no: list.map((o) => o.orderNo).join(', ') }));
      paint?.();
    });
  }
}

// Stripe Checkout takes the browser's language when we have no match for ours.
const STRIPE_LOCALES = ['en', 'ko', 'ja', 'zh', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'sv', 'da', 'fi', 'nb', 'cs'];
const stripeLocale = () => { const b = uiTag().split('-')[0]; return STRIPE_LOCALES.includes(b) ? b : 'auto'; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Card numbers can't be prefilled on Stripe's page, so the test card is shown right by the pay button.
function testCardNote() {
  const copy = () => navigator.clipboard?.writeText(TEST_CARD.replace(/ /g, '')).then(() => toast(t('copied')), () => {});
  return h('aside', { class: 'test-card', role: 'note' },
    h('strong', null, t('c.test.title')),
    h('div', { class: 'test-card-row' },
      h('span', null, t('c.test.card')), h('code', null, TEST_CARD),
      h('button', { type: 'button', class: 'test-card-copy', onClick: copy }, t('c.test.copy'))),
    h('span', null, t('c.test.rest')));
}

// ---------- Shared pieces ----------
function topbar(title, { back = '/', right } = {}) {
  return h('div', { class: 'topbar' },
    h('button', { type: 'button', class: 'back-btn', 'aria-label': t('c.back'), onClick: () => goBack(back) }, icon('back', 22)),
    title ? h('h1', { class: 'topbar-title' }, title) : null,
    h('span', { class: 'topbar-right' }, right ?? tableLabel(getTable())));
}

function statusLine(st) {
  if (st.accepting) return h('span', { class: 'status' }, h('span', { class: 'dot dot-on' }), t('c.status.open', { time: st.closesAt }));
  if (st.inHours && st.manualClosed) return h('span', { class: 'status' }, h('span', { class: 'dot' }), t('c.status.paused'));
  if (st.inHours) return h('span', { class: 'status' }, h('span', { class: 'dot' }), t('c.status.lastOrder', { time: st.closesAt }));
  return h('span', { class: 'status' }, h('span', { class: 'dot' }), st.nextText ? t('c.status.closedNext', { when: st.nextText }) : t('c.status.closed'));
}

function stepper({ qty, onDec, onInc, label, dark = false, size = 44 }) {
  return h('div', { class: dark ? 'stepper stepper-dark' : 'stepper', style: { '--s': `${size}px` } },
    h('button', { type: 'button', 'aria-label': t('c.stepper.dec', { name: label }), onClick: onDec }, icon('minus', 16)),
    h('span', { class: 'stepper-n', 'aria-live': 'polite' }, qty),
    h('button', { type: 'button', 'aria-label': t('c.stepper.inc', { name: label }), onClick: onInc }, icon('plus', 16)));
}

const STEP_INDEX = { new: 0, preparing: 1, done: 2 };
function progress(order, small = false) {
  const idx = STEP_INDEX[order.status] ?? 0;
  const labels = [t('c.step.received'), t('c.step.preparing'), order.orderType === 'togo' ? t('c.step.ready') : t('c.step.served')];
  return h('ol', { class: `progress${small ? ' progress-sm' : ''}`, 'aria-label': t('c.progress') },
    labels.map((label, i) => {
      const state = order.status === 'done' || i < idx ? 'past' : i === idx ? 'now' : 'next';
      return h('li', { class: `step step-${state}`, 'aria-current': state === 'now' ? 'step' : null },
        h('span', { class: 'step-bar' }), h('span', { class: 'step-label' }, label));
    }));
}

function eta(order) {
  if (order.status !== 'new' && order.status !== 'preparing') return null;
  const prep = Number(order.prepMinutes ?? data.store?.prepMinutes) || 10;
  return Math.max(1, prep - Math.floor((Date.now() - toMs(order.createdAt)) / 60000));
}

function linesBox(order, { boxed = true } = {}) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  return h('div', { class: boxed ? 'sum-box' : 'sum-lines' },
    lines.map((l) => {
      const opts = lineOptions(l);
      return h('div', { class: 'sum-row' },
        h('span', null, `${lineName(l)} × ${l.qty}`, opts ? h('span', { class: 'sum-opt' }, opts) : null),
        h('span', null, money(l.lineTotal, order.currency)));
    }),
    boxed ? h('div', { class: 'sum-row sum-total' }, h('span', null, t('c.total')), h('span', null, money(order.total, order.currency))) : null);
}

// ---------- Menu ----------
function menuScreen(root) {
  const paint = () => {
    const s = data.store;
    const st = storeStatus(s);
    const canOrder = st.accepting;
    const { count, total } = cartView();
    const myActive = activeOrders().length;
    const groups = data.sections
      .map((sec) => ({ sec, items: data.items.filter((i) => i.sectionId === sec.id) }))
      .filter((g) => g.items.length);
    const orphans = data.items.filter((i) => !data.sections.some((sec) => sec.id === i.sectionId));
    if (orphans.length) groups.push({ sec: { id: 'etc', name: t('c.etc') }, items: orphans });

    fill(root, 
      h('header', { class: 'menu-head' },
        h('div', { class: 'row-between' }, h('span', { class: 'pill-dark' }, tableLabel(getTable())), statusLine(st)),
        h('h1', { class: 'store-title' }, s.name),
        s.intro || (s.payNotice && !s.prepay) ? h('p', { class: 'lead' }, [s.intro, s.prepay ? '' : s.payNotice].filter(Boolean).join(' ')) : null,
        h('div', { class: 'chip-row' },
          h('a', { href: '/orders', class: 'chip-link' }, icon('receipt', 16), t('c.myOrders'), myActive ? h('span', { class: 'chip-count' }, myActive) : null),
          h('a', { href: '/info', class: 'chip-link' }, icon('info', 16), t('c.storeInfo')),
          langSwitcher())),
      canOrder ? null : h('div', { class: 'notice-bar' }, h('div', { class: 'notice-in' }, icon('moon', 16), t('c.notTakingBrowse'))),
      groups.length ? h('nav', { class: 'sec-nav', 'aria-label': t('c.sections') },
        h('div', { class: 'sec-nav-in' }, groups.map(({ sec }) => h('button', {
          type: 'button',
          class: 'sec-chip',
          onClick: () => document.getElementById(`sec-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        }, sec.name)))) : null,
      h('main', { class: 'menu-main' },
        groups.length
          ? groups.map(({ sec, items }) => h('section', { id: `sec-${sec.id}`, class: 'menu-sec' },
            h('h2', null, sec.name, h('span', { class: 'count' }, items.length)),
            h('div', { class: 'item-grid' }, items.map((it) => itemRow(it, canOrder, paint)))))
          : h('p', { class: 'empty' }, t('c.noMenu')),
        h('p', { class: 'fine' },
          s.allergyInfo ? h('a', { href: '/info' }, t('c.allergyLink')) : t('c.allergyAsk'),
          t('c.vatIncluded')),
        poweredBy()),
      canOrder && count > 0 ? h('div', { class: 'bottom-bar' }, h('div', { class: 'bottom-in' },
        h('button', { type: 'button', class: 'cta cta-split', onClick: () => navigate('/cart') },
          h('span', { class: 'cta-left' }, h('span', { class: 'cta-count' }, count), t('c.viewCart')),
          h('span', null, money(total))))) : null,
    );
  };
  paint();
  return paint;
}

function itemRow(it, canOrder, paint) {
  const qty = itemQty(it.id);
  const needsChoice = hasRequiredOptions(it);
  let action = null;
  if (it.soldOut) action = h('span', { class: 'soldout' }, t('c.soldOut'));
  else if (canOrder && qty === 0) {
    action = h('button', {
      type: 'button',
      class: 'round-add',
      'aria-label': t('c.add', { name: it.name }),
      onClick: () => {
        if (needsChoice) { navigate(`/item/${it.id}`); return; }
        addToCart(it.id, []);
        paint();
      },
    }, icon('plus', 18));
  } else if (canOrder) {
    action = stepper({
      qty,
      dark: true,
      label: it.name,
      onDec: () => { const l = lastLineOf(it.id); if (l) setLineQty(l.key, l.qty - 1); paint(); },
      onInc: () => { const l = lastLineOf(it.id); if (l) setLineQty(l.key, l.qty + 1); paint(); },
    });
  }
  return h('article', { class: `item${it.soldOut ? ' is-sold' : ''}` },
    h('div', { class: 'item-body' },
      h('div', { class: 'item-title' },
        h('h3', null, h('a', { href: `/item/${it.id}` }, it.name)),
        it.badge ? h('span', { class: 'badge' }, badgeLabel(it.badge)) : null),
      it.description ? h('p', { class: 'item-desc' }, it.description) : null,
      h('p', { class: 'item-price' }, money(it.price))),
    it.img ? h('a', { href: `/item/${it.id}`, class: 'item-thumb', tabindex: '-1', 'aria-hidden': 'true' },
      h('img', { src: `${it.img}/style4`, alt: '', loading: 'lazy', decoding: 'async' })) : null,
    action);
}

// ---------- Item detail ----------
function detailScreen(root, id) {
  const it = itemById(id);
  if (!it) {
    fill(root, h('div', { class: 'c-wrap' }, topbar(''),
      h('div', { class: 'center-msg' }, h('p', null, t('c.notFoundItem')), h('a', { href: '/', class: 'btn' }, t('c.backToMenu')))));
    return null;
  }
  const sel = {};
  for (const g of it.optionGroups) sel[g.id] = new Set(g.required && !g.multi && g.options?.[0] ? [g.options[0].id] : []);
  let qty = 1;

  const keys = () => it.optionGroups.flatMap((g) => [...sel[g.id]].map((o) => `${g.id}:${o}`));
  const pick = (g, o) => {
    const set = sel[g.id];
    if (g.multi) { if (set.has(o.id)) set.delete(o.id); else set.add(o.id); } else if (set.has(o.id) && !g.required) set.clear();
    else sel[g.id] = new Set([o.id]);
    paint();
  };

  const paint = () => {
    const cur = itemById(id) || it;
    const st = storeStatus(data.store);
    const canOrder = st.accepting && !cur.soldOut;
    const unit = unitPrice(cur, keys());
    fill(root, 
      h('div', { class: 'c-wrap' },
        topbar(''),
        cur.img ? h('div', { class: 'detail-hero' }, h('img', { src: `${cur.img}/style9`, alt: cur.name, decoding: 'async' })) : null,
        h('div', { class: 'detail-head' },
          h('div', { class: 'row-gap' },
            h('span', { class: 'kicker' }, sectionName(cur.sectionId)),
            cur.badge ? h('span', { class: 'badge' }, badgeLabel(cur.badge)) : null,
            cur.soldOut ? h('span', { class: 'badge badge-grey' }, t('c.soldOut')) : null),
          h('h1', { class: 'detail-title' }, cur.name),
          cur.detail || cur.description ? h('p', { class: 'detail-desc' }, cur.detail || cur.description) : null,
          h('p', { class: 'detail-price' }, money(cur.price))),
        cur.optionGroups.map((g) => h('fieldset', { class: 'opt-group' },
          h('legend', null, lbl(g.name), h('span', { class: g.required ? 'opt-tag opt-tag-req' : 'opt-tag' }, g.required ? t('c.opt.required') : g.multi ? t('c.opt.multi') : t('c.opt.optional'))),
          h('div', { class: 'opt-list' }, (g.options || []).map((o) => {
            const on = sel[g.id]?.has(o.id);
            return h('button', {
              type: 'button',
              class: `opt${on ? ' is-on' : ''}`,
              'aria-pressed': on ? 'true' : 'false',
              onClick: () => pick(g, o),
            },
            h('span', { class: `opt-mark${g.multi ? ' opt-mark-sq' : ''}` }, icon('check', 12, 3.5)),
            h('span', { class: 'opt-label' }, lbl(o.name), o.desc ? h('span', { class: 'opt-desc' }, ` (${lbl(o.desc)})`) : null),
            h('span', { class: 'opt-price' }, Number(o.price) > 0 ? `+${money(o.price)}` : ''));
          })))),
        h('div', { class: 'qty-row' },
          h('span', { class: 'qty-label' }, t('c.qty')),
          stepper({
            qty,
            label: t('c.qty'),
            onDec: () => { qty = Math.max(1, qty - 1); paint(); },
            onInc: () => { qty = Math.min(50, qty + 1); paint(); },
          }))),
      h('div', { class: 'bottom-bar' }, h('div', { class: 'bottom-in' },
        h('button', {
          type: 'button',
          class: 'cta',
          disabled: !canOrder,
          onClick: () => {
            const missing = cur.optionGroups.find((g) => g.required && !sel[g.id]?.size);
            if (missing) { toast(t('c.chooseOpt', { group: lbl(missing.name) })); return; }
            addToCart(cur.id, keys(), qty);
            // Back to the menu (scroll position restored); its cart bar shows the new total.
            toast(t('c.added'));
            goBack('/');
          },
        }, canOrder ? t('c.addFor', { price: money(unit * qty) }) : cur.soldOut ? t('c.soldOutItem') : t('c.notTaking')))),
    );
  };
  paint();
  return paint;
}

// ---------- Cart ----------
function cartScreen(root) {
  let sending = false;
  // Back from Stripe's "cancel": nothing was paid, the cart is untouched.
  const q = new URLSearchParams(location.search);
  if (q.get('pay') === 'cancel') {
    if (q.get('order')) dropPendingPay(q.get('order'));
    history.replaceState({}, '', '/cart');
    setTimeout(() => toast(t('c.payCancelled')), 0);
  }
  const paint = () => {
    const s = data.store;
    const st = storeStatus(s);
    const v = cartView();
    const allowTogo = !!s.allowTogo;
    const orderType = allowTogo ? v.cart.orderType : 'here';
    const setType = (type) => { const c = getCart(); c.orderType = type; saveCart(c); paint(); };
    const methods = Array.isArray(s.paymentMethods) ? s.paymentMethods : [];

    fill(root, 
      h('div', { class: 'c-wrap' },
        topbar(t('c.cart')),
        allowTogo ? h('fieldset', { class: 'plain-fs' },
          h('legend', null, t('c.orderType')),
          h('div', { class: 'two-col' },
            h('button', { type: 'button', class: `seg-btn${orderType === 'here' ? ' is-on' : ''}`, 'aria-pressed': String(orderType === 'here'), onClick: () => setType('here') }, t('c.eatHere')),
            h('button', { type: 'button', class: `seg-btn${orderType === 'togo' ? ' is-on' : ''}`, 'aria-pressed': String(orderType === 'togo'), onClick: () => setType('togo') }, t('c.takeOut')))) : null,
        h('div', { class: 'cart-list' },
          h('h2', { class: 'h-sm' }, t('c.inCart', { n: v.count })),
          v.lines.map((l) => h('div', { class: `cart-line${l.available ? '' : ' is-off'}` },
            l.item?.img ? h('img', { class: 'cart-thumb', src: `${l.item.img}/style3`, alt: '', loading: 'lazy' }) : null,
            h('div', { class: 'cart-line-main' },
              h('span', { class: 'cart-name' }, l.name),
              l.text ? h('span', { class: 'cart-opt' }, l.text) : null,
              h('span', { class: 'cart-unit' }, l.available ? money(l.unit) : t('c.soldOutDropped'))),
            l.available
              ? stepper({ qty: l.qty, label: l.name, size: 40, onDec: () => { setLineQty(l.key, l.qty - 1); paint(); }, onInc: () => { setLineQty(l.key, l.qty + 1); paint(); } })
              : h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { setLineQty(l.key, 0); paint(); } }, t('c.remove')),
            h('span', { class: 'cart-line-total' }, l.available ? money(l.unit * l.qty) : ''))),
          v.lines.length ? null : h('p', { class: 'empty-sm' }, t('c.cartEmpty')),
          h('button', { type: 'button', class: 'link-btn', onClick: () => navigate('/') }, t('c.addMore'))),
        s.allowNote ? h('div', { class: 'field' },
          h('label', { for: 'order-note' }, `${t('c.note')} `, h('span', { class: 'muted-n' }, t('c.optional'))),
          h('textarea', {
            id: 'order-note', rows: 3, maxlength: 200, class: 'textarea',
            placeholder: t('c.notePh'),
            onInput: (e) => { const c = getCart(); c.note = e.target.value; saveCart(c); },
          }, v.cart.note)) : null,
        h('div', { class: 'sum-box' },
          h('div', { class: 'sum-row sum-sub' }, h('span', null, t('c.subtotal')), h('span', null, money(v.total))),
          h('div', { class: 'sum-row sum-total' }, h('span', null, t('c.total')), h('span', null, money(v.total))),
          s.prepay
            ? h('p', { class: 'sum-note' }, t('c.payNowNote'))
            : h('p', { class: 'sum-note' }, s.payNotice || t('pay.default'), methods.length ? t('c.payAccepted', { methods: methods.map(payLabel).join(' · ') }) : ''))),
      h('div', { class: 'bottom-bar' }, h('div', { class: 'bottom-in' },
        s.prepay && v.count && st.accepting ? testCardNote() : null,
        h('button', {
          type: 'button',
          class: 'cta',
          disabled: sending || !v.count || !st.accepting,
          onClick: () => place(orderType),
        }, sending ? (s.prepay ? t('c.toPayment') : t('c.sending')) : !st.accepting ? t('c.notTaking')
          : s.prepay ? t('c.payOrder', { price: money(v.total) }) : t('c.placeOrder', { price: money(v.total) })))),
    );
  };

  async function place(orderType) {
    const v = cartView();
    const lines = v.lines.filter((l) => l.available).map((l) => ({ itemId: l.itemId, qty: l.qty, options: l.options }));
    if (!lines.length || sending) return;
    sending = true;
    paint();
    const payload = { tableNo: getTable(), orderType, lines };
    const note = (v.cart.note || '').trim();
    if (data.store.allowNote && note) payload.note = note.slice(0, 200);
    try {
      const res = await runScript(CONFIG.scripts.placeOrder, payload);
      // Pay first: place-order prices and stores a pending order, start-checkout opens its Stripe
      // payment page. The order reaches the kitchen only after the server confirms it with Stripe,
      // and the cart stays until then, so a cancelled payment loses nothing.
      const pay = res.pay || (res.prepay
        ? (await runScript(CONFIG.scripts.startCheckout, { orderId: res.order.id, locale: stripeLocale() })).pay
        : null);
      if (pay) {
        addPendingPay(pay.orderId);
        location.assign(pay.url);
        return;
      }
      saveOrder({ ...res.order, prepMinutes: res.prepMinutes, updatedAt: res.order.createdAt });
      markJustPlaced(res.order.id);
      clearCart();
      navigate(`/done/${res.order.id}`, { replace: true });
      return;
    } catch (e) {
      const d = e.data || {};
      // The Script names things in the default locale; show them from the menu in the current language.
      const item = () => itemById(d.itemId);
      const itemName = () => item()?.name || d.name;
      const groupName = () => lbl(item()?.optionGroups.find((g) => g.id === d.groupId)?.name) || d.group;
      if (e.code === 'closed') { await ensureData(true).catch(() => {}); toast(t('c.err.closed')); }
      else if (e.code === 'unavailable') { await ensureData(true).catch(() => {}); toast(t('c.err.soldOut', { name: itemName() || t('c.err.someItem') })); }
      else if (e.code === 'option-required' || e.code === 'option-single') { await ensureData(true).catch(() => {}); toast(t('c.err.option', { name: itemName() || t('c.err.itemFallback'), group: groupName() || t('c.err.optionFallback') })); }
      else if (e.code === 'payment-unavailable') toast(e.data?.reason === 'amount_too_small' ? t('c.err.payMin') : t('c.err.payment'));
      else if (e.code === 'togo-disabled') { await ensureData(true).catch(() => {}); const c = getCart(); c.orderType = 'here'; saveCart(c); toast(t('c.err.togo')); }
      else toast(t('c.err.generic'));
    }
    sending = false;
    paint();
  }

  paint();
  return paint;
}

// ---------- Back from Stripe ----------
// The return URL proves nothing by itself: the confirm-payment Script asks Stripe, and only a paid
// session for exactly this order's amount turns it into a real order.
async function paidScreen(root, id, isCurrent) {
  let state = 'checking'; // checking | unpaid | failed | missing
  const known = getMyOrders().some((o) => o.id === id);
  const paint = () => {
    const msg = {
      checking: [h('span', { class: 'boot-dot', 'aria-hidden': 'true' }), h('p', { role: 'status' }, t('c.paid.checking'))],
      unpaid: [h('p', { class: 'b' }, t('c.paid.unpaid')), h('p', { class: 'muted-p' }, t('c.paid.unpaidSub'))],
      failed: [h('p', { class: 'b' }, t('c.paid.failed'))],
      missing: [h('p', null, t('c.orderNotFound'))],
    }[state];
    fill(root, h('div', { class: 'c-wrap' }, topbar('', { back: '/cart' }),
      h('div', { class: 'center-msg' }, msg,
        state === 'checking' ? null : h('div', { class: 'btn-stack' },
          state === 'missing' ? null : h('button', { type: 'button', class: 'btn-outline-lg', onClick: check }, t('c.paid.retry')),
          h('a', { href: '/cart', class: 'link-center' }, t('c.paid.backToCart'))))));
  };
  async function check() {
    state = 'checking';
    paint();
    for (let i = 0; i < 5; i++) {
      try {
        const o = await confirmPayment(id);
        if (!isCurrent()) return;
        if (!known) clearCart();
        markJustPlaced(o.id);
        navigate(`/done/${o.id}`, { replace: true });
        return;
      } catch (e) {
        if (e.code === 'unpaid') { state = 'unpaid'; break; }
        if (e.code === 'not-found') { state = 'missing'; break; }
        await wait(800 * (i + 1)); // another confirm racing this one, or Stripe slow to answer
      }
    }
    if (state === 'checking') state = 'failed';
    if (isCurrent()) paint();
  }
  paint();
  check();
  return null;
}

// ---------- Order complete ----------
async function doneScreen(root, id, isCurrent) {
  let order = getMyOrders().find((o) => o.id === id);
  if (!order) {
    try { await refreshStatuses([id]); } catch { /* shown as not found */ }
    order = getMyOrders().find((o) => o.id === id);
  }
  if (!isCurrent()) return null;
  if (!order) {
    fill(root, h('div', { class: 'c-wrap' }, topbar(''),
      h('div', { class: 'center-msg' }, h('p', null, t('c.orderNotFound')), h('a', { href: '/', class: 'btn' }, t('c.backToMenu')))));
    return null;
  }

  const paint = () => {
    const o = getMyOrders().find((x) => x.id === id) || order;
    const rejected = o.status === 'rejected';
    const togo = o.orderType === 'togo';
    const minutes = eta(o);
    const served = o.status === 'done';
    const title = rejected ? t('c.done.cancelled') : served ? (togo ? t('c.done.ready') : t('c.done.served')) : t('c.done.received');
    const sub = rejected
      ? [t('c.done.cancelledSub1'), h('br'), o.payment === 'refunded' ? t('c.done.refundedSub') : t('c.done.cancelledSub2')]
      : [t(togo ? (served ? 'c.done.readySub' : 'c.done.togoSub') : (served ? 'c.done.servedSub' : 'c.done.hereSub')), h('br'), o.payment === 'refunded' ? t('c.done.refundedSub') : o.payment === 'paid' ? t('c.done.paidSub') : t('c.done.paySub')];
    fill(root, h('div', { class: 'c-wrap done-wrap' },
      h('div', { class: 'done-head' },
        h('div', { class: `done-icon${rejected ? ' is-grey' : ''}` }, icon(rejected ? 'close' : 'check', 30, 2.4)),
        h('h1', null, title),
        h('p', null, sub)),
      h('div', { class: 'no-card' },
        h('span', { class: 'no-label' }, t('c.orderNo')),
        h('span', { class: 'no-big' }, o.orderNo),
        h('span', { class: 'no-meta' }, `${tableLabel(o.tableNo)} · ${typeLabel(o.orderType)}${minutes ? ` · ${t('c.aboutMin', { n: minutes })}` : ''}`)),
      rejected ? null : progress(o),
      linesBox(o),
      o.note ? h('p', { class: 'note-line' }, t('c.noteLine', { note: o.note })) : null,
      h('div', { class: 'btn-stack' },
        h('a', { href: '/', class: 'btn-outline-lg' }, t('c.orderMore')),
        h('a', { href: '/orders', class: 'link-center' }, t('c.allOrders')))));
  };
  paint();
  // A refresh (or coming back later) asks the server at once; right after ordering it is already fresh.
  const w = watchOrders(paint, { immediate: justPlaced !== id });
  markJustPlaced(null);
  onLeave(() => w.stop());
  return paint;
}

// ---------- My orders ----------
function ordersScreen(root) {
  const picked = new Set();
  let calling = false;
  let refreshing = false;
  let w = null;
  let ackTimer = null;

  const paint = () => {
    const s = data.store;
    const orders = getMyOrders();
    const active = orders.filter((o) => o.status === 'new' || o.status === 'preparing');
    const past = orders.filter((o) => o.status === 'done' || o.status === 'rejected');
    const total = orders.filter((o) => o.status !== 'rejected' && o.payment !== 'refunded').reduce((a, o) => a + (Number(o.total) || 0), 0);
    const allPaid = orders.length > 0 && orders.every((o) => o.payment === 'paid' || o.payment === 'refunded');
    const call = getCall();
    // A handled call clears itself after a short while; repaint then (no network involved).
    clearTimeout(ackTimer);
    if (call?.status === 'done') ackTimer = setTimeout(paint, Math.max(0, call.ackAt + CALL_ACK_MS - Date.now()) + 200);

    fill(root, 
      h('div', { class: 'c-wrap orders-wrap' },
        topbar(t('c.myOrders')),
        orders.length ? null : h('div', { class: 'empty-card' }, h('p', null, t('c.noOrders')), h('a', { href: '/', class: 'btn' }, t('c.seeMenu'))),
        active.map((o) => {
          const m = eta(o);
          return h('section', { class: 'order-card is-active', 'aria-label': t('c.activeOrder') },
            h('div', { class: 'row-between' },
              h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, t('c.orderNoAt', { time: hm(toMs(o.createdAt)) })), h('span', { class: 'order-no' }, o.orderNo)),
              h('span', { class: 'pill-accent' }, o.status === 'new' ? t('c.step.received') : `${t('c.step.preparing')}${m ? ` · ${t('c.aboutMin', { n: m })}` : ''}`)),
            progress(o, true),
            h('div', { class: 'order-lines' }, linesBox(o, { boxed: false })));
        }),
        past.map((o) => h('section', { class: 'order-card is-past', 'aria-label': t('c.pastOrder') },
          h('div', { class: 'row-between' },
            h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, t('c.orderNoAt', { time: hm(toMs(o.createdAt)) })), h('span', { class: 'order-no-sm' }, o.orderNo)),
            h('span', { class: `pill-light${o.status === 'rejected' || o.payment === 'refunded' ? ' is-red' : ''}` }, o.payment === 'refunded' ? t('c.refundedPill') : o.status === 'rejected' ? t('c.cancelledPill') : o.orderType === 'togo' ? t('c.step.ready') : t('c.step.served'))),
          linesBox(o, { boxed: false }))),
        orders.length ? h('div', { class: 'total-block' },
          h('div', { class: 'row-between total-row' }, h('span', null, allPaid ? t('c.paidTotal') : t('c.tableTotal')), h('span', null, money(total))),
          h('p', { class: 'muted-p' }, allPaid ? t('c.paidNote') : t('c.payOnLeave')),
          active.length ? h('button', {
            type: 'button', class: 'link-btn link-btn-sm', disabled: refreshing,
            onClick: async () => { refreshing = true; paint(); await w?.now(); refreshing = false; paint(); },
          }, icon('refresh', 14), ` ${refreshing ? t('c.checking') : t('c.refresh')}`) : null) : null,
        s.allowStaffCall ? h('section', { class: 'call-sec', 'aria-label': t('c.staffCall') },
          h('h2', { class: 'h-sm' }, t('c.staffCall')),
          call?.status === 'done'
            ? h('div', { class: 'called is-ack', role: 'status' },
              h('span', { class: 'row-gap' }, icon('check', 18, 2.4), t('c.callAck')),
              h('button', { type: 'button', class: 'called-cancel', onClick: () => { setCall(null); paint(); } }, t('common.close')))
            : call
            ? h('div', { class: 'called', role: 'status' },
              h('span', null, t('c.called')),
              h('button', { type: 'button', class: 'called-cancel', onClick: cancelCall }, t('common.cancel')))
            : h('div', { class: 'call-body' },
              h('div', { class: 'chip-row', role: 'group', 'aria-label': t('c.requests') }, CALL_REASONS.map((r) => h('button', {
                type: 'button',
                class: `pick-chip${picked.has(r) ? ' is-on' : ''}`,
                'aria-pressed': String(picked.has(r)),
                onClick: () => { if (picked.has(r)) picked.delete(r); else picked.add(r); paint(); },
              }, t(`call.${r}`)))),
              h('button', { type: 'button', class: 'btn-outline-lg', disabled: calling, onClick: makeCall },
                icon('bell', 18), calling ? t('c.calling') : picked.size ? t('c.requestN', { n: picked.size }) : t('c.callStaff')))) : null),
      h('div', { class: 'bottom-bar' }, h('div', { class: 'bottom-in' }, h('a', { href: '/', class: 'cta cta-link' }, t('c.orderMore')))),
    );
  };

  async function makeCall() {
    if (calling) return;
    calling = true;
    paint();
    try {
      const requests = [...picked];
      const r = await runScript(CONFIG.scripts.staffCall, { action: 'create', tableNo: getTable(), requests });
      setCall({ id: r.id, at: Date.now(), requests, status: 'open' });
      picked.clear();
      w?.resume();
    } catch (e) {
      toast(e.code === 'disabled' ? t('c.err.callDisabled') : t('c.err.call'));
    }
    calling = false;
    paint();
  }

  async function cancelCall() {
    const c = getCall();
    setCall(null);
    paint();
    if (c) runScript(CONFIG.scripts.staffCall, { action: 'cancel', callId: c.id }).catch(() => {});
  }

  paint();
  w = watchOrders(paint, { immediate: true });
  onLeave(() => { w.stop(); clearTimeout(ackTimer); });
  return paint;
}

// ---------- Store info ----------
function infoScreen(root) {
  let showMap = false;
  const paint = () => {
    const s = data.store;
    const st = storeStatus(s);
    const statusText = st.accepting
      ? `${t('c.info.openNow', { time: st.closesAt })}${st.lastOrderMinutes ? t('c.info.lastOrder', { time: st.lastOrderAt }) : ''}`
      : st.inHours ? t('c.info.openNoOrders') : st.nextText ? t('c.status.closedNext', { when: st.nextText }) : t('c.status.closed');
    const address = [s.address, s.addressDetail].filter(Boolean).join(' ');
    const methods = Array.isArray(s.paymentMethods) ? s.paymentMethods : [];
    const snsHref = s.sns ? (/^https?:\/\//.test(s.sns) ? s.sns : s.sns.startsWith('@') ? `https://www.instagram.com/${s.sns.slice(1)}/` : null) : null;
    const copy = (v) => { navigator.clipboard?.writeText(v).then(() => toast(t('copied')), () => {}); };

    fill(root, h('div', { class: 'c-wrap info-wrap' },
      topbar(t('c.storeInfo'), { right: langSwitcher('lang-compact') || '' }),
      h('div', { class: 'info-head' },
        h('span', { class: 'info-name' }, s.name),
        s.intro ? h('p', { class: 'muted-p' }, s.intro) : null,
        h('span', { class: 'status status-strong' }, h('span', { class: `dot${st.accepting ? ' dot-on' : ''}` }), statusText)),
      h('section', { class: 'info-sec' },
        h('h2', null, t('c.hours')),
        h('dl', { class: 'hours-dl' }, WEEK_ORDER.map((dow) => {
          const e = st.hours[dow];
          const isToday = dow === st.now.dow;
          return [
            h('dt', { class: isToday ? 'is-today' : '' }, dayShort(dow)),
            h('dd', { class: `${isToday ? 'is-today' : ''}${e.open ? '' : ' is-closed'}` }, e.open ? `${e.from} – ${e.to}` : t('c.closedDay'), isToday ? t('c.today') : ''),
          ];
        }))),
      s.wifiName || s.wifiPassword ? h('section', { class: 'info-sec' },
        h('h2', null, t('c.wifi')),
        h('div', { class: 'two-col' },
          h('button', { type: 'button', class: 'info-tile', onClick: () => s.wifiName && copy(s.wifiName) }, h('span', { class: 'tile-k' }, t('c.wifiName')), h('span', { class: 'tile-v' }, s.wifiName || '-')),
          h('button', { type: 'button', class: 'info-tile', onClick: () => s.wifiPassword && copy(s.wifiPassword) }, h('span', { class: 'tile-k' }, t('c.wifiPw')), h('span', { class: 'tile-v' }, s.wifiPassword || '-')))) : null,
      address || s.phone || s.sns ? h('section', { class: 'info-sec info-sec-tight' },
        h('h2', null, t('c.contact')),
        address ? h('button', { type: 'button', class: 'info-row', 'aria-expanded': String(showMap), onClick: () => { showMap = !showMap; paint(); } },
          icon('pin', 20), h('span', { class: 'grow' }, address), h('span', { class: 'u-link' }, showMap ? t('c.closeMap') : t('c.map'))) : null,
        address && showMap ? h('div', { class: 'map-box' }, h('iframe', {
          src: `https://www.google.com/maps/embed/v1/place?key=${CONFIG.mapsEmbedKey}&q=${encodeURIComponent(s.address || address)}&zoom=16&language=${uiTag().split('-')[0]}&region=${s.country || 'KR'}`,
          title: t('c.mapTitle', { name: s.name }), loading: 'lazy', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
        })) : null,
        s.phone ? h('a', { href: `tel:${s.phone.replace(/[^0-9+]/g, '')}`, class: 'info-row' }, icon('phone', 20), h('span', { class: 'grow' }, s.phone), h('span', { class: 'u-link' }, t('c.call'))) : null,
        s.sns ? (snsHref
          ? h('a', { href: snsHref, target: '_blank', rel: 'noopener', class: 'info-row' }, icon('insta', 20), h('span', { class: 'grow' }, s.sns))
          : h('div', { class: 'info-row' }, icon('insta', 20), h('span', { class: 'grow' }, s.sns))) : null) : null,
      h('section', { class: 'info-sec' },
        h('h2', null, t('c.payInfo')),
        s.prepay ? h('div', { class: 'chip-row' }, h('span', { class: 'chip-static' }, t('c.payCardPrepay')))
          : methods.length ? h('div', { class: 'chip-row' }, methods.map((m) => h('span', { class: 'chip-static' }, payLabel(m)))) : null,
        h('p', { class: 'muted-p' }, s.prepay ? t('c.payPrepayInfo') : s.payNotice || t('c.payDefaultInfo'))),
      s.allergyInfo ? h('section', { class: 'soft-box' }, h('h2', null, t('c.allergy')), h('p', { class: 'pre' }, s.allergyInfo)) : null,
      poweredBy()));
  };
  paint();
  return paint;
}

// ---------- Closed ----------
function closedScreen(root) {
  const paint = () => {
    const s = data.store;
    const st = storeStatus(s);
    if (st.accepting) { menuScreen(root); return; }
    const sum = hoursSummary(s.hours);
    const seeYou = st.next ? tr('c.closed.seeYou', { day: st.next.label, time: h('strong', null, ampm(st.next.min)) }) : null;
    let message;
    if (st.inHours && st.manualClosed) message = [t('c.closed.paused1'), h('br'), t('c.closed.paused2')];
    else if (st.next?.kind === 'today') message = [t('c.closed.notYet1'), h('br'), tr('c.closed.notYet2', { time: h('strong', null, ampm(st.next.min)) })];
    else if (st.inHours) message = [t('c.closed.lastOrder1'), h('br'), seeYou];
    else message = [t('c.closed.over1'), h('br'), seeYou];
    const hasOrders = getMyOrders().length > 0;
    fill(root, h('div', { class: 'c-wrap closed-wrap' },
      h('div', { class: 'row-between' }, h('span', { class: 'closed-name' }, s.name), h('div', { class: 'row-gap' }, langSwitcher('lang-compact'), h('span', { class: 'pill-grey' }, tableLabel(getTable())))),
      h('div', { class: 'closed-center' },
        h('div', { class: 'closed-icon' }, icon('moon', 32)),
        h('h1', null, t('c.notTaking')),
        h('p', null, message),
        sum.open.length || sum.closed ? h('div', { class: 'closed-hours' }, sum.open.join(' · '), sum.closed ? [h('br'), sum.closed] : null) : null),
      h('div', { class: 'btn-stack' },
        h('a', { href: '/menu', class: 'btn-dark-lg' }, t('c.closed.browse')),
        h('a', { href: '/info', class: 'btn-outline-lg btn-thin' }, t('c.closed.info')),
        hasOrders ? h('a', { href: '/orders', class: 'link-center' }, t('c.closed.myOrders')) : null)));
  };
  paint();
  return paint;
}

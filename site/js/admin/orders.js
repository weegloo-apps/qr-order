import { onLeave } from '/js/main.js';
import { t } from '/js/i18n.js';
import { DAY, ago, dateLabel, h, icon, storeMidnight, tableLabel, toast, typeLabel, money, fill } from '/js/util.js';
import { closeCall, fetchOpenCalls, fetchOrders, lineName, lineOptions, loadMenu, refundOrder, rejectOrder, setOrderStatus, setSound, soundOn, unlockAudio, watcher } from '/js/admin/data.js';

let filter = 'all';

// title / action are translation keys.
const COLUMNS = [
  { status: 'new', title: 'o.col.new', action: 'o.act.accept', next: 'preparing', dot: 'var(--accent)', btn: 'btn-accent' },
  { status: 'preparing', title: 'o.col.preparing', action: 'o.act.ready', next: 'done', dot: '#111111', btn: 'btn-dark' },
  { status: 'done', also: ['rejected'], title: 'o.col.closed', dot: '#A8A29E' },
];

export async function ordersPage(main, { isCurrent }) {
  let orders = [];
  let calls = [];
  const busy = new Set();

  async function load() {
    // Open orders from the last day (late-night shops), plus everything finished today.
    const [list, open] = await Promise.all([fetchOrders(Date.now() - DAY, Date.now() + 60e3), fetchOpenCalls(), loadMenu().catch(() => null)]);
    orders = list;
    calls = open;
  }

  function paint() {
    const today = storeMidnight();
    const visible = orders.filter((o) => filter === 'all' || o.orderType === filter);
    const closed = (o) => o.status === 'done' || o.status === 'rejected';
    const shown = visible.filter((o) => !closed(o) || o.createdAt >= today);
    const sound = soundOn();

    fill(main, 
      h('div', { class: 'page-head' },
        h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, t('o.showing', { date: dateLabel(Date.now()), n: shown.length, c: shown.length })), h('h1', null, t('o.title'))),
        h('div', { class: 'row-gap wrap' },
          h('div', { class: 'seg', role: 'group', 'aria-label': t('o.filter') }, [['all', t('o.all')], ['here', t('type.here')], ['togo', t('type.togo')]].map(([k, label]) => h('button', {
            type: 'button', 'aria-pressed': String(filter === k), onClick: () => { filter = k; paint(); },
          }, label))),
          h('button', {
            type: 'button', class: 'btn btn-icon', 'aria-pressed': String(sound),
            onClick: () => { unlockAudio(); setSound(!sound); paint(); },
          }, icon(sound ? 'bell' : 'bellOff', 16), sound ? t('o.soundOn') : t('o.soundOff')))),
      calls.length ? h('section', { class: 'calls', 'aria-label': t('o.calls') },
        h('div', { class: 'calls-head' }, icon('bell', 16), h('strong', null, t('o.callsN', { n: calls.length }))),
        h('div', { class: 'calls-list' }, calls.map((c) => h('div', { class: 'call-item' },
          h('div', { class: 'col-tight' },
            h('span', { class: 'b' }, tableLabel(c.tableNo)),
            h('span', { class: 'muted-s' }, `${c.requests.length ? c.requests.map((r) => t(`call.${r}`)).join(', ') : t('o.callGeneric')} · ${ago(c.createdAt)}`)),
          h('button', { type: 'button', class: 'btn-line', disabled: busy.has(c.id), onClick: () => doneCall(c) }, t('o.ack')))))) : null,
      h('div', { class: 'kanban' }, COLUMNS.map((col) => {
        let cards = shown.filter((o) => o.status === col.status || col.also?.includes(o.status));
        cards = col.status === 'done' ? cards.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30) : cards.sort((a, b) => a.createdAt - b.createdAt);
        return h('section', { class: 'k-col', 'aria-label': t(col.title) },
          h('div', { class: 'k-head' }, h('span', { class: 'k-dot', style: { background: col.dot } }), h('h2', null, t(col.title)), h('span', { class: 'muted-s b' }, cards.length)),
          cards.map((o) => card(o, col)),
          cards.length ? null : h('p', { class: 'k-empty' }, t('o.empty')));
      })),
    );
  }

  function card(o, col) {
    const ageMin = Math.floor((Date.now() - o.createdAt) / 60000);
    const late = col.status !== 'done' && ageMin >= 10;
    const rejected = o.status === 'rejected';
    const refunded = o.payment === 'refunded';
    // Card-paid orders already being made or served can still be refunded (complaint, wrong dish…).
    const canRefund = o.payment === 'paid' && (o.status === 'preparing' || o.status === 'done');
    return h('article', { class: `k-card${col.status === 'new' ? ' is-new' : ''}${rejected || refunded ? ' is-rejected' : ''}` },
      h('div', { class: 'row-between top' },
        h('div', { class: 'col-tight' },
          h('span', { class: 'k-no' }, o.orderNo),
          h('span', { class: 'muted-s' }, `${tableLabel(o.tableNo)} · ${typeLabel(o.orderType)}`)),
        h('span', { class: `k-age${late ? ' is-late' : ''}` }, ago(o.createdAt))),
      h('ul', { class: 'k-lines' }, o.lines.map((l) => h('li', null,
        h('span', { class: 'k-line-name' }, `${lineName(l)} `, h('b', null, `× ${l.qty}`)),
        h('span', { class: 'muted-xs' }, lineOptions(l) || t('o.noOptions'))))),
      o.note ? h('p', { class: 'k-note' }, t('c.noteLine', { note: o.note })) : null,
      h('div', { class: 'k-foot' },
        h('span', { class: 'row-gap' },
          h('span', { class: 'k-amount' }, rejected || refunded ? h('s', { title: t('a.notInSales') }, money(o.total, o.currency)) : money(o.total, o.currency)),
          o.payment === 'paid' ? h('span', { class: 'pay-tag' }, t('o.paidTag')) : null),
        rejected || refunded ? h('span', { class: 'st-pill st-rejected' }, refunded ? t('st.refunded') : t('st.rejected')) : null,
        col.next || canRefund ? h('div', { class: 'row-gap' },
          col.status === 'new' ? h('button', { type: 'button', class: 'btn-line', disabled: busy.has(o.id), onClick: () => reject(o) }, t('o.reject')) : null,
          canRefund ? h('button', { type: 'button', class: 'btn-line btn-refund', disabled: busy.has(o.id), onClick: () => refund(o) }, t('o.refund')) : null,
          col.next ? h('button', { type: 'button', class: `btn-solid ${col.btn}`, disabled: busy.has(o.id), onClick: () => move(o, col.next) }, t(col.action)) : null) : null));
  }

  async function move(o, status) {
    busy.add(o.id);
    paint();
    try { await setOrderStatus(o, status); } catch (e) { console.error(e); toast(t('a.statusFail')); }
    busy.delete(o.id);
    paint();
  }

  async function reject(o) {
    const paid = o.payment === 'paid';
    if (!window.confirm(paid ? t('o.rejectRefundConfirm', { no: o.orderNo, amount: money(o.total, o.currency) }) : t('o.rejectConfirm', { no: o.orderNo }))) return;
    busy.add(o.id);
    paint();
    try {
      await rejectOrder(o);
      if (paid) toast(t('o.refunded', { no: o.orderNo }));
    } catch (e) { console.error(e); toast(paid ? t('o.refundFail') : t('a.statusFail')); }
    busy.delete(o.id);
    paint();
  }

  async function refund(o) {
    const msg = o.status === 'done' ? t('o.refundDoneConfirm', { no: o.orderNo, amount: money(o.total, o.currency) }) : t('o.refundOpenConfirm', { no: o.orderNo, amount: money(o.total, o.currency) });
    if (!window.confirm(msg)) return;
    busy.add(o.id);
    paint();
    try { await refundOrder(o); toast(t('o.refundDone', { no: o.orderNo })); } catch (e) { console.error(e); toast(t('o.refundFailOnly')); }
    busy.delete(o.id);
    paint();
  }

  async function doneCall(c) {
    busy.add(c.id);
    paint();
    try {
      await closeCall(c);
      calls = calls.filter((x) => x.id !== c.id);
    } catch (e) { console.error(e); toast(t('o.actionFail')); }
    busy.delete(c.id);
    paint();
  }

  async function reload() {
    try {
      await load();
      if (isCurrent()) paint();
    } catch (e) {
      console.error(e);
      if (isCurrent()) fill(main, h('p', { class: 'muted' }, t('o.loadFail')));
    }
  }

  await reload();
  // "N min ago" labels move with the clock; this repaint reads nothing from the network.
  const tick = setInterval(() => { if (document.visibilityState === 'visible') paint(); }, 30e3);
  onLeave(() => clearInterval(tick));
  onLeave(watcher.on(() => reload()));
}

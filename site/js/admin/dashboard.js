import { onLeave } from '/js/main.js';
import { t } from '/js/i18n.js';
import { DAY, dateLabel, dayShort, getCurrency, h, hm, storeTime, storeMidnight, md, money, moneyCompact, num, pct, tableLabel, toast, fill } from '/js/util.js';
import { normHours } from '/js/hours.js';
import { byItem, lossNote, totals } from '/js/admin/analytics.js';
import { lineName, loadMenu, ordersCached, setOrderStatus, storeVal, watcher } from '/js/admin/data.js';

let period = 'today';

// Labels are translation keys, read at paint time.
const PERIODS = {
  today: { label: 'd.today', title: 'd.todayTitle', compare: 'd.vsYesterday', chart: 'd.byHour', span: DAY, start: 0 },
  week: { label: 'd.week', title: 'd.weekTitle', compare: 'd.vsPrev7', chart: 'd.byDay', span: 7 * DAY, start: 6 },
  month: { label: 'd.month', title: 'd.monthTitle', compare: 'd.vsPrev4w', chart: 'd.byWeek', span: 28 * DAY, start: 27 },
};

function range(p, now = Date.now()) {
  const conf = PERIODS[p];
  const from = storeMidnight(now, -conf.start);
  return { from, to: now + 60e3, prevFrom: from - conf.span, prevTo: now - conf.span };
}

const ACTION = { new: ['d.act.start', 'preparing'], preparing: ['d.act.done', 'done'] };

export async function dashboardPage(main, { isCurrent }) {
  let orders = [];
  let busy = new Set();

  async function load() {
    const r = range(period);
    const [all] = await Promise.all([ordersCached(`dash:${period}:${Math.floor(r.from / DAY)}`, r.prevFrom, r.to), loadMenu().catch(() => null)]);
    orders = all;
  }

  function bars(cur, r) {
    const list = cur.filter((o) => o.status !== 'rejected' && o.payment !== 'refunded');
    if (period === 'today') {
      const td = normHours(storeVal('hours'))[storeTime().dow];
      let lo = td.open ? Math.floor(td.fromMin / 60) : 9;
      let hi = td.open ? Math.max(lo, Math.ceil(td.toMin / 60) - 1) : 21;
      for (const o of list) { const hh = storeTime(o.createdAt).hh; lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
      const out = [];
      for (let hh = lo; hh <= hi; hh++) out.push({ label: t('d.hour', { h: hh }), v: list.filter((o) => storeTime(o.createdAt).hh === hh).reduce((a, o) => a + o.total, 0) });
      return out;
    }
    if (period === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const s = storeMidnight(r.from, i);
        const e = storeMidnight(r.from, i + 1);
        return { label: dayShort(storeTime(s).dow), tip: md(s), v: list.filter((o) => o.createdAt >= s && o.createdAt < e).reduce((a, o) => a + o.total, 0) };
      });
    }
    return Array.from({ length: 4 }, (_, i) => {
      const s = storeMidnight(r.from, i * 7);
      const e = storeMidnight(r.from, i * 7 + 7);
      return { label: t('d.weekOf', { date: md(s) }), v: list.filter((o) => o.createdAt >= s && o.createdAt < e).reduce((a, o) => a + o.total, 0) };
    });
  }

  function paint() {
    const conf = PERIODS[period];
    const r = range(period);
    const cur = orders.filter((o) => o.createdAt >= r.from);
    const prev = orders.filter((o) => o.createdAt >= r.prevFrom && o.createdAt < r.prevTo);
    const a = totals(cur);
    const b = totals(prev);
    const kpis = [
      [t('k.sales'), money(a.sales), pct(a.sales, b.sales)],
      [t('k.orders'), t('count.orders', { n: num(a.received), c: a.received }), pct(a.received, b.received), lossNote(a, t)],
      [t('k.avg'), money(a.avg), pct(a.avg, b.avg)],
      [t('k.qty'), t('count.items', { n: num(a.qty), c: a.qty }), pct(a.qty, b.qty)],
    ];
    const series = bars(cur, r);
    const max = Math.max(0, ...series.map((x) => x.v));
    const peak = max > 0 ? series.findIndex((x) => x.v === max) : -1;
    const tops = byItem(cur).map((x) => ({ ...x, name: lineName(x) })).sort((x, y) => y.qty - x.qty).slice(0, 5);
    const topMax = tops[0]?.qty || 1;
    const todayStart = storeMidnight();
    const todays = orders.filter((o) => o.createdAt >= todayStart).sort((x, y) => y.createdAt - x.createdAt);
    const pending = todays.filter((o) => o.status === 'new' || o.status === 'preparing').length;

    fill(main, 
      h('div', { class: 'page-head' },
        h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, dateLabel(Date.now())), h('h1', null, t(conf.title))),
        h('div', { class: 'seg', role: 'group', 'aria-label': t('d.period') }, Object.entries(PERIODS).map(([k, p]) => h('button', {
          type: 'button', 'aria-pressed': String(k === period), onClick: async () => { if (k === period) return; period = k; await reload(); },
        }, t(p.label))))),
      h('div', { class: 'kpis' }, kpis.map(([label, value, delta, note]) => h('div', { class: 'kpi' },
        h('span', { class: 'kpi-label' }, label),
        h('span', { class: 'kpi-value' }, value),
        h('span', { class: 'kpi-sub' }, h('strong', { class: delta.startsWith('+') || delta === t('pct.new') ? 'is-up' : '' }, delta), ` ${t(conf.compare)}`),
        note ? h('span', { class: 'kpi-note' }, note) : null))),
      h('div', { class: 'flex-wrap-16' },
        h('section', { class: 'card chart-card' },
          h('div', { class: 'card-head' }, h('h2', null, t(conf.chart)), h('span', { class: 'muted-xs' }, getCurrency())),
          h('div', { class: 'bars', role: 'img', 'aria-label': peak >= 0 ? t('d.peakAria', { chart: t(conf.chart), label: series[peak].label }) : t(conf.chart) },
            series.map((x, i) => h('div', { class: 'bar', title: `${x.tip ? `${x.tip} ` : ''}${x.label} ${money(x.v)}` },
              h('span', { class: `bar-v${i === peak ? ' is-peak' : ''}` }, i === peak ? moneyCompact(x.v) : ''),
              h('span', { class: `bar-fill${i === peak ? ' is-peak' : ''}`, style: { height: `${max ? Math.max(4, Math.round((x.v / max) * 180)) : 4}px` } })))),
          h('div', { class: 'bar-labels', 'aria-hidden': 'true' }, series.map((x) => h('span', null, x.label))),
          max ? null : h('p', { class: 'muted-xs center' }, t('d.noOrdersPeriod'))),
        h('section', { class: 'card tops-card' },
          h('div', { class: 'card-head' }, h('h2', null, t('d.topItems')), h('span', { class: 'muted-xs' }, t('k.qty'))),
          tops.length ? h('ol', { class: 'tops' }, tops.map((x, i) => h('li', null,
            h('div', { class: 'tops-row' }, h('span', { class: 'tops-rank' }, i + 1), h('span', { class: 'tops-name' }, x.name), h('span', { class: 'tops-qty' }, t('count.items', { n: num(x.qty), c: x.qty }))),
            h('span', { class: 'meter' }, h('span', { class: i === 0 ? 'is-peak' : '', style: { width: `${Math.round((x.qty / topMax) * 100)}%` } })))))
            : h('p', { class: 'muted-s' }, t('d.noSold')))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', null, t('d.live')),
          h('span', { class: 'muted-xs row-gap' }, t('d.waiting', { n: pending }), h('a', { href: '/admin/orders', class: 'link-strong' }, t('d.allOrders')))),
        todays.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['order', 'seat', 'items', 'amount', 'time', 'status', 'action'].map((c, i) => h('th', { scope: 'col', class: i === 3 || i === 6 ? 'r' : '' }, t(`d.col.${c}`))))),
          h('tbody', null, todays.slice(0, 8).map((o) => h('tr', { class: o.status === 'rejected' || o.payment === 'refunded' ? 'is-dim' : '' },
            h('td', { class: 'b' }, o.orderNo),
            h('td', null, o.orderType === 'togo' && o.tableNo === 0 ? t('type.togo') : tableLabel(o.tableNo)),
            h('td', { class: 'dim' }, o.lines.map((l) => `${lineName(l)} ${l.qty}`).join(', ')),
            h('td', { class: 'r b' }, o.status === 'rejected' || o.payment === 'refunded' ? h('s', { title: t('a.notInSales') }, money(o.total, o.currency)) : money(o.total, o.currency)),
            h('td', { class: 'muted' }, hm(o.createdAt)),
            h('td', null, o.payment === 'refunded' ? h('span', { class: 'st-pill st-rejected' }, t('st.refunded')) : h('span', { class: `st-pill st-${o.status}` }, t(`st.${o.status}`))),
            h('td', { class: 'r' }, ACTION[o.status]
              ? h('button', { type: 'button', class: 'btn-line', disabled: busy.has(o.id), onClick: () => advance(o) }, t(ACTION[o.status][0]))
              : h('span', { class: 'muted' }, t('d.handled')))))))) : h('p', { class: 'muted-s' }, t('d.noToday'))),
    );
  }

  async function advance(o) {
    const next = ACTION[o.status]?.[1];
    if (!next) return;
    busy.add(o.id);
    paint();
    try { await setOrderStatus(o, next); } catch (e) { console.error(e); toast(t('a.statusFail')); }
    busy.delete(o.id);
    paint();
  }

  async function reload() {
    try {
      await load();
      if (isCurrent()) paint();
    } catch (e) {
      console.error(e);
      if (isCurrent()) fill(main, h('p', { class: 'muted' }, t('d.loadFail')));
    }
  }

  await reload();
  onLeave(watcher.on((evt) => { if (evt.newOrder) reload(); }));
}

import { onLeave } from '/js/main.js';
import { t } from '/js/i18n.js';
import { DAY, dayLong, dayShort, getCurrency, h, icon, storeTime, storeMidnight, md, money, num, pct, toMajor, fill } from '/js/util.js';
import { WEEK_ORDER, normHours } from '/js/hours.js';
import { byItem, csv, download, lossNote, totals } from '/js/admin/analytics.js';
import { adminData, lineName, loadMenu, ordersCached, storeVal, watcher } from '/js/admin/data.js';

let rangeKey = 'week';
let sortKey = 'sales';

// label / table / col / compare / file are translation keys.
const RANGES = {
  week: { label: 'd.week', days: 7, table: 'r.weekTable', col: 'r.colDate', compare: 'd.vsPrev7', file: 'r.fileWeek' },
  month: { label: 'd.month', days: 28, table: 'r.monthTable', col: 'r.colWeek', compare: 'd.vsPrev4w', file: 'r.fileMonth' },
};
const LEGEND = ['#F0EFEE', '#D6D3D1', '#A8A29E', '#57534E', '#111111'];

export async function salesPage(main, { isCurrent }) {
  let orders = [];
  let r = null;

  async function load() {
    const conf = RANGES[rangeKey];
    const now = Date.now();
    const from = storeMidnight(now, -(conf.days - 1));
    r = { from, to: now + 60e3, prevFrom: storeMidnight(now, -(2 * conf.days - 1)), prevTo: now - conf.days * DAY };
    const [list] = await Promise.all([ordersCached(`sales:${rangeKey}:${Math.floor(from / DAY)}`, r.prevFrom, r.to), loadMenu()]);
    orders = list;
  }

  function periodRows(cur, hours) {
    const conf = RANGES[rangeKey];
    const rows = [];
    if (rangeKey === 'week') {
      for (let i = conf.days - 1; i >= 0; i--) {
        const s = storeMidnight(r.from, i);
        const e = storeMidnight(r.from, i + 1);
        const list = cur.filter((o) => o.createdAt >= s && o.createdAt < e);
        const tt = totals(list);
        const closed = !tt.received && !hours[storeTime(s).dow].open;
        rows.push({ label: `${md(s)} (${dayShort(storeTime(s).dow)})`, ...tt, closed });
      }
    } else {
      for (let w = 3; w >= 0; w--) {
        const s = storeMidnight(r.from, w * 7);
        const e = storeMidnight(r.from, w * 7 + 7);
        const list = cur.filter((o) => o.createdAt >= s && o.createdAt < e);
        rows.push({ label: `${md(s)} – ${md(storeMidnight(r.from, w * 7 + 6))}`, ...totals(list), closed: false });
      }
    }
    return rows;
  }

  function paint() {
    const conf = RANGES[rangeKey];
    const hours = normHours(storeVal('hours'));
    const cur = orders.filter((o) => o.createdAt >= r.from);
    const prev = orders.filter((o) => o.createdAt >= r.prevFrom && o.createdAt < r.prevTo);
    const a = totals(cur);
    const b = totals(prev);
    const rows = periodRows(cur, hours);
    const openDays = rows.filter((x) => x.received).length || 1;

    const sectionName = (id) => adminData.sections?.find((s) => s.id === id)?.name || t('c.etc');
    const items = byItem(cur).map((x) => ({ ...x, name: lineName(x) }));
    const base = items.reduce((s, x) => s + x.rev, 0);
    const sorted = [...items].sort((x, y) => (sortKey === 'qty' ? y.qty - x.qty : y.rev - x.rev));
    const maxVal = sorted.length ? (sortKey === 'qty' ? sorted[0].qty : sorted[0].rev) || 1 : 1;
    const qtyTotal = items.reduce((s, x) => s + x.qty, 0);

    const secMap = new Map();
    for (const it of items) secMap.set(sectionName(it.sectionId), (secMap.get(sectionName(it.sectionId)) || 0) + it.rev);
    const secColors = ['#111111', 'var(--accent)', '#A8A29E', '#57534E', '#D6D3D1', '#78716C'];
    const shares = [...secMap.entries()].sort((x, y) => y[1] - x[1]).map(([name, rev], i) => ({ name, rev, pct: base ? Math.round((rev / base) * 100) : 0, color: secColors[i % secColors.length] }));

    // Heatmap: average orders per weekday-hour over the range.
    const openHours = hours.filter((x) => x.open);
    let lo = openHours.length ? Math.min(...openHours.map((x) => Math.floor(x.fromMin / 60))) : 10;
    let hi = openHours.length ? Math.max(...openHours.map((x) => (x.toMin > x.fromMin ? Math.ceil(x.toMin / 60) - 1 : 23))) : 21;
    for (const o of cur) { const hh = storeTime(o.createdAt).hh; lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
    const hoursCols = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const dayCount = Array(7).fill(0);
    for (let i = 0, s = r.from; s < r.to; s = storeMidnight(r.from, ++i)) dayCount[storeTime(s).dow] += 1;
    const grid = {};
    // Demand, so every order received counts here — declined ones included.
    for (const o of cur) { const p = storeTime(o.createdAt); grid[`${p.dow}-${p.hh}`] = (grid[`${p.dow}-${p.hh}`] || 0) + 1; }
    let peak = null;
    let peakV = 0;
    for (const [k, v] of Object.entries(grid)) {
      const avg = v / (dayCount[Number(k.split('-')[0])] || 1);
      if (avg > peakV) { peakV = avg; peak = k; }
    }

    const exportCsv = () => {
      const cur = getCurrency();
      const amt = (v) => toMajor(v);
      const lines = [[t(conf.table)], [t(conf.col), t('k.orders'), t('r.colRejected'), t('k.qty'), `${t('k.avg')} (${cur})`, `${t('k.sales')} (${cur})`]];
      for (const x of rows) lines.push([x.label, x.closed ? t('r.closed') : x.received, x.rejected + x.refunded, x.qty, amt(x.avg), amt(x.sales)]);
      lines.push([t('c.total'), a.received, a.rejected + a.refunded, a.qty, amt(a.avg), amt(a.sales)], [], [t('r.byItem')], [t('r.colItem'), t('r.colSection'), t('r.colQty'), `${t('r.revNoOpt')} (${cur})`]);
      for (const it of sorted) lines.push([it.name, sectionName(it.sectionId), it.qty, amt(it.rev)]);
      download(t('r.file', { range: t(conf.file), date: md(Date.now()).replace('/', '') }), csv(lines));
    };

    fill(main, 
      h('div', { class: 'page-head' },
        h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, `${md(r.from)} – ${md(Date.now())}`), h('h1', null, t('r.title'))),
        h('div', { class: 'row-gap wrap' },
          h('div', { class: 'seg', role: 'group', 'aria-label': t('d.period') }, Object.entries(RANGES).map(([k, x]) => h('button', {
            type: 'button', 'aria-pressed': String(k === rangeKey), onClick: async () => { if (k === rangeKey) return; rangeKey = k; await reload(); },
          }, t(x.label)))),
          h('button', { type: 'button', class: 'btn btn-icon', onClick: exportCsv }, icon('download', 16), t('r.csv')))),
      h('div', { class: 'kpis kpis-wide' }, [
        [t('k.totalSales'), money(a.sales), `${t(conf.compare)} ${pct(a.sales, b.sales)}`],
        [t('k.orders'), t('count.orders', { n: num(a.received), c: a.received }), t('r.avgPerDay', { n: num(a.received / openDays) }), lossNote(a, t)],
        [t('k.avg'), money(a.avg), t('r.perOrder')],
        [t('k.qty'), t('count.items', { n: num(a.qty), c: a.qty }), t('r.optExtra', { amount: money(a.opt) })],
      ].map(([label, value, sub, note]) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value), h('span', { class: 'kpi-sub' }, sub), note ? h('span', { class: 'kpi-note' }, note) : null))),
      h('div', { class: 'flex-wrap-16 top' },
        h('section', { class: 'card period-card' },
          h('h2', null, t(conf.table)),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl-num' },
            h('thead', null, h('tr', null, [t(conf.col), t('k.orders'), t('r.colRejected'), t('k.qty'), t('k.avg'), t('k.sales')].map((c, i) => h('th', { scope: 'col', class: i ? 'r' : '' }, c)))),
            h('tbody', null, rows.map((x) => h('tr', { class: x.closed || !x.received ? 'is-dim' : '' },
              h('th', { scope: 'row' }, x.label),
              h('td', { class: 'r' }, x.closed ? t('r.closed') : num(x.received)),
              h('td', { class: 'r' }, x.rejected + x.refunded ? num(x.rejected + x.refunded) : '–'),
              h('td', { class: 'r' }, x.count ? num(x.qty) : '–'),
              h('td', { class: 'r' }, x.count ? money(x.avg) : '–'),
              h('td', { class: 'r b' }, x.count ? money(x.sales) : '–')))),
            h('tfoot', null, h('tr', null,
              h('th', { scope: 'row' }, t('c.total')),
              h('td', { class: 'r' }, num(a.received)), h('td', { class: 'r' }, num(a.rejected + a.refunded)), h('td', { class: 'r' }, num(a.qty)), h('td', { class: 'r' }, money(a.avg)), h('td', { class: 'r' }, money(a.sales))))))),
        h('section', { class: 'card share-card' },
          h('h2', null, t('r.share')),
          shares.length ? [
            h('div', { class: 'share-bar', role: 'img', 'aria-label': t('r.shareAria', { list: shares.map((x) => `${x.name} ${x.pct}%`).join(', ') }) },
              shares.map((x) => h('span', { style: { width: `${Math.max(x.pct, 1)}%`, background: x.color } }))),
            h('ul', { class: 'share-list' }, shares.map((x) => h('li', null,
              h('span', { class: 'sw', style: { background: x.color } }), h('span', { class: 'grow' }, x.name),
              h('span', { class: 'muted' }, money(x.rev)), h('span', { class: 'share-pct' }, `${x.pct}%`)))),
          ] : h('p', { class: 'muted-s' }, t('r.noData')),
          h('p', { class: 'muted-s top-line' }, t('r.optNote', { amount: money(a.opt) })))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', null, t('r.byItem')),
          h('div', { class: 'seg seg-light', role: 'group', 'aria-label': t('r.sort') }, [['sales', t('r.bySales')], ['qty', t('r.byQty')]].map(([k, label]) => h('button', {
            type: 'button', 'aria-pressed': String(k === sortKey), onClick: () => { sortKey = k; paint(); },
          }, label)))),
        sorted.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl-menu' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('r.colItem')), h('th', { scope: 'col' }, t('r.colSection')), h('th', { scope: 'col', class: 'r' }, t('r.colQty')), h('th', { scope: 'col', class: 'r' }, t('k.sales')), h('th', { scope: 'col', class: 'w30' }, t('r.colShare')))),
          h('tbody', null, sorted.map((it, i) => {
            const v = sortKey === 'qty' ? it.qty : it.rev;
            const tot = sortKey === 'qty' ? qtyTotal : base;
            return h('tr', null,
              h('th', { scope: 'row' }, it.name),
              h('td', { class: 'muted' }, sectionName(it.sectionId)),
              h('td', { class: 'r' }, t('count.items', { n: num(it.qty), c: it.qty })),
              h('td', { class: 'r b' }, money(it.rev)),
              h('td', null, h('span', { class: 'meter-row' },
                h('span', { class: 'meter' }, h('span', { class: i === 0 ? 'is-peak' : '', style: { width: `${Math.round((v / maxVal) * 100)}%` } })),
                h('span', { class: 'meter-pct' }, `${tot ? Math.round((v / tot) * 1000) / 10 : 0}%`))));
          })))) : h('p', { class: 'muted-s' }, t('r.noItems'))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', null, t('r.heat')),
          h('span', { class: 'muted-xs' }, peak ? t('r.peak', { day: dayLong(Number(peak.split('-')[0])), hour: t('d.hour', { h: peak.split('-')[1] }) }) : t('r.peakEmpty'))),
        h('div', { class: 'tbl-wrap' }, h('div', { class: 'heat', role: 'img', 'aria-label': t('r.heatAria'), style: { '--cols': hoursCols.length } },
          h('div', { class: 'heat-row heat-hours' }, h('span'), hoursCols.map((hh) => h('span', null, hh))),
          WEEK_ORDER.map((dow) => h('div', { class: 'heat-row' },
            h('span', { class: 'heat-day' }, dayShort(dow)),
            hoursCols.map((hh) => {
              if (!hours[dow].open && !grid[`${dow}-${hh}`]) return h('span', { class: 'heat-cell is-closed', title: t('r.heatClosed', { day: dayLong(dow) }) });
              const avg = (grid[`${dow}-${hh}`] || 0) / (dayCount[dow] || 1);
              const lvl = peakV ? Math.min(4, Math.floor((avg / peakV) * 4.999)) : 0;
              return h('span', { class: 'heat-cell', style: { background: LEGEND[avg ? Math.max(1, lvl) : 0] }, title: t('r.heatCell', { day: dayLong(dow), hour: t('d.hour', { h: hh }), n: Math.round(avg * 10) / 10 }) });
            }))))),
        h('div', { class: 'legend' }, h('span', null, t('r.less')), LEGEND.map((c) => h('span', { class: 'legend-sw', style: { background: c } })), h('span', null, t('r.more')),
          h('span', { class: 'legend-closed' }, h('span', { class: 'legend-sw is-closed' }), t('r.closed')))),
    );
  }

  async function reload() {
    try {
      await load();
      if (isCurrent()) paint();
    } catch (e) {
      console.error(e);
      if (isCurrent()) fill(main, h('p', { class: 'muted' }, t('r.loadFail')));
    }
  }

  await reload();
  onLeave(watcher.on((evt) => { if (evt.newOrder) reload(); }));
}

// Sales math over orders already loaded in the browser (no extra requests).
// A declined order is still an order received (`received`, `rejected`), but no money changed hands —
// nor for a served order refunded afterwards (`refunded`) — so sales, items sold and the average
// order use only the rest (`count`).
export const counted = (orders) => orders.filter((o) => o.status !== 'rejected' && o.payment !== 'refunded');

export function totals(orders) {
  const list = counted(orders);
  const sales = list.reduce((a, o) => a + o.total, 0);
  const qty = list.reduce((a, o) => a + (o.itemCount || o.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)), 0);
  const opt = list.reduce((a, o) => a + o.optionTotal, 0);
  const count = list.length;
  const rejected = orders.filter((o) => o.status === 'rejected').length;
  return { sales, qty, opt, count, received: orders.length, rejected, refunded: orders.length - count - rejected, avg: count ? Math.round(sales / count) : 0 };
}

// Per menu item: quantity and base revenue (option surcharges kept apart, as the report notes).
export function byItem(orders) {
  const map = new Map();
  for (const o of counted(orders)) {
    for (const l of o.lines) {
      const key = l.itemId || l.name;
      const cur = map.get(key) || { itemId: l.itemId, name: l.name, sectionId: l.sectionId, qty: 0, rev: 0, revWithOpt: 0 };
      const q = Number(l.qty) || 0;
      cur.qty += q;
      cur.rev += (Number(l.basePrice) || 0) * q;
      cur.revWithOpt += Number(l.lineTotal) || 0;
      cur.name = l.name || cur.name;
      cur.sectionId = l.sectionId || cur.sectionId;
      map.set(key, cur);
    }
  }
  return [...map.values()];
}

export function sum(list, key) { return list.reduce((a, x) => a + (Number(x[key]) || 0), 0); }

export function csv(rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\n')}`;
}

export function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "Declined 2 · Refunded 1" — empty when neither happened.
export const lossNote = (tt, t) => [tt.rejected ? t('k.rejectedN', { n: tt.rejected }) : '', tt.refunded ? t('k.refundedN', { n: tt.refunded }) : ''].filter(Boolean).join(' · ');

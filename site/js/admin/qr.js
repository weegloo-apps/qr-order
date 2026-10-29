import { t } from '/js/i18n.js';
import { h, icon, loadScript, fill, tableLabel } from '/js/util.js';
import { storeVal } from '/js/admin/data.js';

export const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
export const tableUrl = (n) => `${location.origin}/t/${n}`;

export function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Printable table cards (the "table QR card" design), in the admin's current language. /admin/qr?table=3 shows one card; ?print=1
// opens the print dialog once the codes are drawn.
export async function qrPage(root) {
  const params = new URLSearchParams(location.search);
  const one = params.has('table') ? Math.max(0, Number(params.get('table')) || 0) : null;
  const count = Math.min(40, Math.max(1, Number(storeVal('tableCount')) || 6));
  const name = storeVal('name') || '';
  const tables = one !== null ? [one] : [...Array.from({ length: count }, (_, i) => i + 1), 0];
  document.title = t('q.docTitle', { store: name });

  let libOk = true;
  try { await loadScript(QR_LIB); } catch { libOk = false; }

  fill(root, h('div', { class: 'qr-page' },
    h('div', { class: 'qr-toolbar no-print' },
      h('div', { class: 'col-tight' },
        h('strong', null, one !== null ? t('q.one') : t('q.many', { n: tables.length })),
        h('span', { class: 'muted-s' }, t('q.help'))),
      h('div', { class: 'row-gap wrap' },
        one !== null ? h('a', { href: '/admin/qr', class: 'btn' }, t('q.all')) : null,
        h('a', { href: '/admin/settings', class: 'btn' }, t('q.settings')),
        h('button', { type: 'button', class: 'btn btn-dark', onClick: () => window.print() }, icon('print', 16), t('q.print')))),
    libOk ? null : h('p', { class: 'form-error no-print' }, t('q.libFail')),
    h('div', { class: 'qr-cards' }, tables.map((n) => {
      const code = h('div', { class: 'qr-code', role: 'img', 'aria-label': t('qrAria', { label: tableLabel(n) }) });
      if (libOk) code.innerHTML = qrSvg(tableUrl(n));
      return h('div', { class: 'qr-card' },
        h('div', { class: 'qr-card-top' },
          h('span', { class: 'qr-store' }, name),
          h('h1', null, t('q.head1'), h('br'), t('q.head2'))),
        h('div', { class: 'qr-frame' }, code),
        h('div', { class: 'qr-card-bottom' },
          h('span', { class: 'qr-table' }, tableLabel(n)),
          h('p', null, t('q.foot'))));
    }))));

  if (params.get('print') === '1' && libOk) setTimeout(() => window.print(), 400);
}

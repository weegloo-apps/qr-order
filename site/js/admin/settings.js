import { BRAND_COLORS, PAYMENT_METHODS } from '/js/config.js';
import { localized } from '/js/api.js';
import { onLeave } from '/js/main.js';
import { contentLocale, defaultLocale, getLocales, langName, payLabel, t } from '/js/i18n.js';
import { localeTabs, missingNote } from '/js/lang-ui.js';
import { CURRENCIES, currencyName, dayLong, dayShort, fractionDigits, h, icon, loadScript, money, regionName, tableLabel, toast, fill } from '/js/util.js';
import { WEEK_ORDER, normHours, serializeHours } from '/js/hours.js';
import { chime, saveStore, setVolume, storeMap, storeVal, unlockAudio, volume } from '/js/admin/data.js';
import { QR_LIB, qrSvg, tableUrl } from '/js/admin/qr.js';

const POSTCODE_LIB = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
// Translatable store text, kept per locale ({ localeCode: text }); the rest is one value for every language.
const L10N_KEYS = ['name', 'intro', 'payNotice', 'allergyInfo', 'address', 'addressDetail'];
const TEXT_KEYS = ['country', 'currency', 'phone', 'postcode', 'wifiName', 'wifiPassword', 'sns'];
// The store's country decides the address input: Kakao address search covers South Korea only,
// every other country is typed in.
const COUNTRIES = ['KR', 'US', 'CA', 'MX', 'BR', 'GB', 'IE', 'FR', 'DE', 'ES', 'IT', 'PT', 'NL', 'BE', 'CH', 'AT', 'SE', 'DK', 'NO', 'FI', 'PL',
  'JP', 'CN', 'TW', 'HK', 'MO', 'SG', 'TH', 'VN', 'PH', 'ID', 'MY', 'IN', 'AE', 'TR', 'AU', 'NZ'];
const BOOL_KEYS = ['acceptOrders', 'prepay', 'allowTogo', 'allowNote', 'allowStaffCall', 'soundAlert'];
const TOGGLES = [
  ['acceptOrders', 's.t.accept', 's.t.acceptHelp'],
  ['prepay', 's.t.prepay', 's.t.prepayHelp'],
  ['allowTogo', 's.t.togo', 's.t.togoHelp'],
  ['allowNote', 's.t.note', 's.t.noteHelp'],
  ['allowStaffCall', 's.t.call', 's.t.callHelp'],
  ['soundAlert', 's.t.sound', 's.t.soundHelp'],
];

const trimMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));

function snapshot() {
  const f = {};
  for (const k of L10N_KEYS) f[k] = storeMap(k);
  for (const k of TEXT_KEYS) f[k] = storeVal(k) || '';
  for (const k of BOOL_KEYS) f[k] = !!storeVal(k);
  f.lastOrderMinutes = Number(storeVal('lastOrderMinutes')) || 0;
  f.prepMinutes = Number(storeVal('prepMinutes')) || 10;
  f.tableCount = Math.min(40, Math.max(1, Number(storeVal('tableCount')) || 6));
  f.brandColor = storeVal('brandColor') || '#C2410C';
  f.paymentMethods = Array.isArray(storeVal('paymentMethods')) ? [...storeVal('paymentMethods')] : [];
  f.hours = normHours(storeVal('hours'));
  return f;
}

// The values exactly as they would be written, so "dirty" compares like with like.
function toValues(f) {
  const v = {};
  for (const k of L10N_KEYS) v[k] = trimMap(f[k]);
  for (const k of TEXT_KEYS) v[k] = String(f[k] || '').trim();
  for (const k of BOOL_KEYS) v[k] = !!f[k];
  v.lastOrderMinutes = f.lastOrderMinutes;
  v.prepMinutes = f.prepMinutes;
  v.tableCount = f.tableCount;
  v.brandColor = f.brandColor;
  v.paymentMethods = PAYMENT_METHODS.filter((m) => f.paymentMethods.includes(m));
  v.hours = serializeHours(f.hours);
  return v;
}

export async function settingsPage(main) {
  let f = snapshot();
  let base = toValues(f);
  let saving = false;
  let saved = false;
  let postcodeOpen = false;
  let loc = getLocales().some((l) => l.code === contentLocale()) ? contentLocale() : defaultLocale();

  const dirtyKeys = () => {
    const now = toValues(f);
    return Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(base[k]));
  };
  const change = () => { saved = false; updateBar(); };

  const bar = { status: h('span', { class: 'save-status', role: 'status' }), save: null, reset: null };
  function updateBar() {
    const dirty = dirtyKeys().length > 0;
    bar.status.textContent = saving ? t('m.saving') : saved ? t('m.saved') : dirty ? t('s.dirty') : t('s.clean');
    if (bar.save) bar.save.disabled = saving || !dirty;
    if (bar.reset) bar.reset.disabled = saving || !dirty;
  }

  const beforeUnload = (e) => { if (dirtyKeys().length) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  onLeave(() => window.removeEventListener('beforeunload', beforeUnload));

  const isKR = () => f.country === 'KR';
  const countryOptions = () => {
    const list = COUNTRIES.includes(f.country) || !f.country ? COUNTRIES : [f.country, ...COUNTRIES];
    return [...list].sort((x, y) => (x === 'KR' ? -1 : y === 'KR' ? 1 : regionName(x).localeCompare(regionName(y))));
  };
  const multi = () => getLocales().length > 1;
  const locTag = () => (multi() ? h('span', { class: 'loc-tag', lang: loc }, langName(loc)) : null);
  // In a non-default locale the placeholder shows the default text used when this is left empty.
  const l10nPh = (key, example) => (loc === defaultLocale() ? example : f[key][defaultLocale()] || example);

  const text = (key, { id, type = 'text', placeholder = '', max = 64, full = false, label, hint }) => h('div', { class: `field${full ? ' span-all' : ''}` },
    h('label', { for: id, class: 'lbl' }, label, hint ? h('span', { class: 'muted-n' }, ` ${hint}`) : null),
    h('input', { id, type, class: 'input', maxlength: max, placeholder, value: f[key], onInput: (e) => { f[key] = e.target.value; change(); } }));

  // A translatable input; the note under it says which language screens would show nothing.
  const l10nInput = (key, { id, max, label, hint, placeholder = '', area = false, full = true }) => {
    const note = h('span', { class: 'missing-slot' }, missingNote(f[key]));
    const onInput = (e) => { f[key][loc] = e.target.value; change(); fill(note, missingNote(f[key])); };
    return h('div', { class: `field${full ? ' span-all' : ''}` },
      h('label', { for: id, class: 'lbl' }, label, hint ? h('span', { class: 'muted-n' }, ` ${hint}`) : null, locTag()),
      area
        ? h('textarea', { id, class: 'textarea', rows: 3, maxlength: max, lang: loc, placeholder: l10nPh(key, placeholder), onInput }, f[key][loc] || '')
        : h('input', { id, class: 'input', maxlength: max, lang: loc, placeholder: l10nPh(key, placeholder), value: f[key][loc] || '', onInput }),
      note);
  };

  const toggleBtn = (on, label, onClick, big = false) => h('button', {
    type: 'button', class: big ? 'toggle-big' : 'toggle-inline', 'aria-pressed': String(on), 'aria-label': label, onClick,
  }, h('span', { class: `switch${on ? ' is-on' : ''}${big ? ' switch-lg' : ''}` }, h('span')));

  function paint() {
    const qrHost = h('div', { class: 'qr-grid' });
    fill(main,
      h('div', { class: 'page-head' }, h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, t('s.headSub')), h('h1', null, t('s.title')))),
      h('div', { class: 'settings-layout' },
        h('nav', { class: 'settings-nav', 'aria-label': t('s.nav') }, [['s-info', 's.info'], ['s-hours', 's.hours'], ['s-order', 's.order'], ['s-qr', 's.qr'], ['s-brand', 's.brand']].map(([id, key]) => h('button', {
          type: 'button', class: 'settings-link', onClick: () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        }, t(key)))),
        h('div', { class: 'settings-body' },
          multi() ? h('div', { class: 'card set-card loc-card' },
            h('div', { class: 'loc-bar' },
              h('span', { class: 'lbl' }, t('l10n.editLang')),
              localeTabs(loc, (code) => { loc = code; paint(); })),
            h('span', { class: 'muted-xs' }, t('s.l10nHint'))) : null,
          // Store info
          h('section', { id: 's-info', class: 'card set-card' },
            h('h2', null, t('s.info')),
            h('div', { class: 'form-grid wide' },
              l10nInput('name', { id: 'st-name', max: 64, label: t('s.name'), full: false }),
              text('phone', { id: 'st-phone', type: 'tel', label: t('s.phone'), placeholder: isKR() ? '02-000-0000' : '', max: 32 }),
              l10nInput('intro', { id: 'st-intro', max: 200, label: t('s.intro'), placeholder: t('s.introPh') }),
              h('div', { class: 'field' },
                h('label', { for: 'st-country', class: 'lbl' }, t('s.country')),
                h('select', { id: 'st-country', class: 'input', onChange: (e) => { f.country = e.target.value; postcodeOpen = false; change(); paint(); } },
                  countryOptions().map((c) => h('option', { value: c, selected: c === f.country }, regionName(c))))),
              h('div', { class: 'field' },
                h('label', { for: 'st-currency', class: 'lbl' }, t('s.currency')),
                h('select', { id: 'st-currency', class: 'input', onChange: (e) => { f.currency = e.target.value; change(); paint(); } },
                  CURRENCIES.map((c) => h('option', { value: c, selected: c === f.currency }, `${currencyName(c)} (${c})`)))),
              f.currency !== base.currency ? h('p', { class: 'warn-note span-all', role: 'status' },
                t('s.currencyWarn', { from: money(4500, base.currency), to: money(4500, f.currency) })) : null,
              h('div', { class: 'field span-all' },
                h('label', { for: 'st-addr', class: 'lbl' }, `${t('s.addr')} `, h('span', { class: 'muted-n' }, t('s.addrHint')), locTag()),
                h('div', { class: 'row-gap' },
                  h('input', {
                    id: 'st-addr', class: 'input grow', maxlength: 300, lang: loc, value: f.address[loc] || '',
                    placeholder: l10nPh('address', isKR() ? t('s.addrPh') : t('s.addrPhIntl')),
                    onInput: (e) => { f.address[loc] = e.target.value; if (isKR()) f.postcode = ''; change(); },
                  }),
                  isKR() ? h('button', { type: 'button', class: 'btn', onClick: openPostcode }, icon('search', 16), t('s.addrSearch')) : null),
                isKR() && postcodeOpen ? h('div', { class: 'postcode-layer', id: 'postcode-layer' }) : null,
                isKR() && f.postcode ? h('span', { class: 'muted-xs' }, t('s.postcode', { code: f.postcode })) : null,
                h('span', { class: 'muted-xs' }, isKR() ? t('s.addrKrHint') : t('s.addrIntlHint'))),
              isKR() ? null : text('postcode', { id: 'st-postcode', label: t('s.postcodeLabel'), max: 10 }),
              l10nInput('addressDetail', { id: 'st-addr2', max: 64, label: t('s.addr2'), placeholder: t('s.addr2Ph'), full: isKR() }),
              text('wifiName', { id: 'st-wifi', label: t('s.wifi'), placeholder: t('s.wifiPh') }),
              text('wifiPassword', { id: 'st-wifipw', label: t('s.wifiPw') }),
              text('sns', { id: 'st-sns', label: t('s.sns'), placeholder: t('s.snsPh'), hint: '' }),
              h('div', { class: 'field' },
                h('span', { class: 'lbl' }, t('s.pay')),
                h('div', { class: 'chip-row' }, PAYMENT_METHODS.map((m) => {
                  const on = f.paymentMethods.includes(m);
                  return h('button', {
                    type: 'button', class: `pick-chip sm${on ? ' is-on' : ''}`, 'aria-pressed': String(on),
                    onClick: () => { f.paymentMethods = on ? f.paymentMethods.filter((x) => x !== m) : [...f.paymentMethods, m]; change(); paint(); },
                  }, payLabel(m));
                }))),
              l10nInput('allergyInfo', { id: 'st-allergy', max: 3000, area: true, label: t('s.allergy'), hint: t('s.allergyHint'), placeholder: t('s.allergyPh') }))),
          // Opening hours
          h('section', { id: 's-hours', class: 'card set-card' },
            h('h2', null, t('s.hours')),
            WEEK_ORDER.map((dow) => {
              const d = f.hours[dow];
              const day = dayLong(dow);
              return h('div', { class: 'hour-row' },
                h('span', { class: 'hour-day' }, dayShort(dow)),
                h('button', {
                  type: 'button', class: 'toggle-inline', 'aria-pressed': String(d.open), 'aria-label': t('s.dayOpenAria', { day }),
                  onClick: () => { d.open = !d.open; change(); paint(); },
                }, h('span', { class: `switch${d.open ? ' is-on' : ''}` }, h('span')), d.open ? t('s.open') : t('s.closed')),
                d.open ? h('div', { class: 'row-gap' },
                  h('input', { type: 'time', class: 'input input-time', value: d.from, 'aria-label': t('s.startAria', { day }), onChange: (e) => { d.from = e.target.value || d.from; change(); } }),
                  h('span', { 'aria-hidden': 'true' }, '–'),
                  h('input', { type: 'time', class: 'input input-time', value: d.to, 'aria-label': t('s.endAria', { day }), onChange: (e) => { d.to = e.target.value || d.to; change(); } }))
                  : h('span', { class: 'muted' }, t('c.closedDay')));
            }),
            h('p', { class: 'muted-xs' }, t('s.overnight'))),
          // Ordering
          h('section', { id: 's-order', class: 'card set-card' },
            h('h2', null, t('s.order')),
            TOGGLES.map(([key, label, help]) => h('div', { class: 'toggle-row' },
              h('div', { class: 'col-tight' }, h('span', { class: 'toggle-label' }, t(label)), h('span', { class: 'muted-s' }, t(help)),
                key === 'prepay' && f.prepay ? h('span', { class: 'test-mode-line' }, t('s.t.prepayTest')) : null),
              toggleBtn(f[key], t(label), () => { f[key] = !f[key]; change(); paint(); }, true))),
            // Preview the two alerts and set this device's volume (saved on the device, not the store).
            h('div', { class: 'sound-row' },
              h('div', { class: 'col-tight' }, h('span', { class: 'toggle-label' }, t('s.soundTest')), h('span', { class: 'muted-s' }, t('s.soundTestHelp'))),
              h('div', { class: 'row-gap wrap' },
                h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { unlockAudio(); chime('order', { force: true }); } }, icon('receipt', 14), t('s.soundOrder')),
                h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { unlockAudio(); chime('call', { force: true }); } }, icon('bell', 14), t('s.soundCall')),
                h('label', { class: 'vol' }, h('span', { class: 'muted-s' }, t('s.volume')),
                  h('input', { type: 'range', min: 0, max: 100, step: 5, value: String(Math.round(volume() * 100)), 'aria-label': t('s.volume'), onInput: (e) => setVolume(Number(e.target.value) / 100) })))),
            h('div', { class: 'form-grid wide top-line' },
              h('div', { class: 'field' },
                h('label', { for: 'st-last', class: 'lbl' }, t('s.lastOrder')),
                h('select', { id: 'st-last', class: 'input', onChange: (e) => { f.lastOrderMinutes = Number(e.target.value); change(); } },
                  [[30, t('s.last30')], [15, t('s.last15')], [0, t('s.last0')]].map(([v, l]) => h('option', { value: v, selected: f.lastOrderMinutes === v }, l)))),
              h('div', { class: 'field' },
                h('label', { for: 'st-prep', class: 'lbl' }, t('s.prep')),
                h('input', { id: 'st-prep', class: 'input', type: 'number', min: 1, max: 180, value: String(f.prepMinutes), onInput: (e) => { f.prepMinutes = Math.min(180, Math.max(1, Math.round(Number(e.target.value) || 1))); change(); } })),
              l10nInput('payNotice', { id: 'st-pay', max: 300, label: t('s.payNotice'), placeholder: t('pay.default') }))),
          // Tables · QR
          h('section', { id: 's-qr', class: 'card set-card' },
            h('div', { class: 'row-between wrap' },
              h('h2', null, t('s.qr')),
              h('div', { class: 'row-gap' },
                h('span', { class: 'b' }, t('s.tables')),
                h('div', { class: 'stepper', style: { '--s': '40px' } },
                  h('button', { type: 'button', 'aria-label': t('s.tableDec'), onClick: () => { f.tableCount = Math.max(1, f.tableCount - 1); change(); paint(); } }, icon('minus', 14)),
                  h('span', { class: 'stepper-n' }, f.tableCount),
                  h('button', { type: 'button', 'aria-label': t('s.tableInc'), onClick: () => { f.tableCount = Math.min(40, f.tableCount + 1); change(); paint(); } }, icon('plus', 14))))),
            qrHost,
            h('div', { class: 'row-gap wrap' },
              h('a', { href: '/admin/qr?print=1', target: '_blank', rel: 'noopener', class: 'btn btn-dark' }, icon('print', 16), t('s.print', { n: f.tableCount + 1 })),
              h('a', { href: '/admin/qr?table=1', target: '_blank', rel: 'noopener', class: 'btn' }, t('s.cardDesign'))),
            dirtyKeys().includes('tableCount') ? h('p', { class: 'muted-xs' }, t('s.tablesAfterSave')) : null),
          // Brand color
          h('section', { id: 's-brand', class: 'card set-card' },
            h('div', { class: 'col-tight' }, h('h2', null, t('s.brand')), h('span', { class: 'muted-s' }, t('s.brandSub'))),
            h('div', { class: 'row-gap wrap brand-pick' },
              h('div', { class: 'row-gap', role: 'group', 'aria-label': t('s.brandAria') }, BRAND_COLORS.map(([c, key]) => h('button', {
                type: 'button', class: `swatch${c.toLowerCase() === f.brandColor.toLowerCase() ? ' is-on' : ''}`, 'aria-pressed': String(c === f.brandColor), 'aria-label': t(`color.${key}`),
                onClick: () => { f.brandColor = c; change(); paint(); },
              }, h('span', { style: { background: c } })))),
              h('div', { class: 'brand-preview', style: { '--accent': f.brandColor } },
                h('span', { class: 'muted-xs' }, t('s.preview')),
                h('span', { class: 'badge badge-white' }, t('badge.popular')),
                h('span', { class: 'preview-cta' }, t('c.placeOrder', { price: money(fractionDigits(f.currency) ? 1150 : 11500, f.currency) }))))))),
      h('div', { class: 'save-bar' }, h('div', { class: 'save-bar-in' },
        bar.status,
        bar.reset = h('button', { type: 'button', class: 'btn', onClick: () => { f = snapshot(); saved = false; postcodeOpen = false; paint(); } }, t('s.reset')),
        bar.save = h('button', { type: 'button', class: 'btn btn-dark', onClick: save }, t('s.save')))),
    );
    updateBar();
    renderQrs(qrHost);
    if (postcodeOpen) mountPostcode();
  }

  async function renderQrs(host) {
    const cells = [];
    for (let n = 1; n <= f.tableCount; n++) cells.push({ n, label: tableLabel(n) });
    cells.push({ n: 0, label: tableLabel(0), sub: t('s.noTable') });
    host.replaceChildren(...cells.map((c) => h('div', { class: `qr-cell${c.n === 0 ? ' is-counter' : ''}` },
      h('div', { class: 'qr-thumb', role: 'img', 'aria-label': t('qrAria', { label: c.label }), 'data-n': c.n }),
      h('span', { class: 'b' }, c.label),
      c.sub ? h('span', { class: 'muted-xs' }, c.sub) : null)));
    try {
      await loadScript(QR_LIB);
      for (const el of host.querySelectorAll('.qr-thumb')) el.innerHTML = qrSvg(tableUrl(Number(el.dataset.n)));
    } catch { /* thumbnails stay as empty frames */ }
  }

  async function openPostcode() {
    postcodeOpen = !postcodeOpen;
    paint();
    if (postcodeOpen) document.getElementById('postcode-layer')?.scrollIntoView({ block: 'nearest' });
  }

  async function mountPostcode() {
    const layer = document.getElementById('postcode-layer');
    if (!layer) return;
    try {
      await loadScript(POSTCODE_LIB);
      new window.kakao.Postcode({
        oncomplete: (d) => {
          const road = d.userSelectedType !== 'J';
          let addr = road ? (d.roadAddress || d.autoRoadAddress) : (d.jibunAddress || d.autoJibunAddress);
          if (road) {
            let extra = '';
            if (d.bname && /[동로가]$/.test(d.bname)) extra = d.bname;
            if (d.buildingName && d.apartment === 'Y') extra += (extra ? ', ' : '') + d.buildingName;
            if (extra) addr = `${addr} (${extra})`;
          }
          // Korean for Korean, the English twin for English; other languages fall back to the default.
          const en = (road ? (d.roadAddressEnglish || d.autoRoadAddressEnglish) : (d.jibunAddressEnglish || d.autoJibunAddressEnglish)) || d.addressEnglish || '';
          const next = {};
          for (const l of getLocales()) {
            const lang = l.code.split('-')[0];
            if (lang === 'ko') next[l.code] = addr;
            else if (lang === 'en' && en) next[l.code] = en;
          }
          if (!next[defaultLocale()]) next[defaultLocale()] = en || addr;
          f.address = next;
          f.postcode = d.zonecode;
          postcodeOpen = false;
          change();
          paint();
          document.getElementById('st-addr2')?.focus();
        },
        onresize: (size) => { layer.style.height = `${size.height}px`; },
        onclose: () => { postcodeOpen = false; paint(); },
        width: '100%',
        height: '100%',
      }).embed(layer);
    } catch {
      fill(layer, h('p', { class: 'muted-s' }, t('s.postcodeFail')));
    }
  }

  async function save() {
    const keys = dirtyKeys();
    if (!keys.length || saving) return;
    const v = toValues(f);
    // The store name is required: an empty default locale takes the first filled translation.
    const d = defaultLocale();
    if (!v.name[d]) { const first = Object.values(v.name)[0]; if (first) v.name[d] = first; }
    if (!v.name[d]) { toast(t('s.err.name')); return; }
    const values = {};
    for (const k of keys) values[k] = L10N_KEYS.includes(k) ? localized(v[k]) : v[k];
    if (keys.includes('name')) values.name = localized(v.name);
    saving = true;
    updateBar();
    try {
      await saveStore(values);
      f = snapshot();
      base = toValues(f);
      saved = true;
      document.documentElement.style.setProperty('--accent', v.brandColor);
    } catch (e) {
      console.error(e);
      toast(e.status === 409 ? t('s.conflict') : t('m.saveFail'));
    }
    saving = false;
    paint();
  }

  paint();
}

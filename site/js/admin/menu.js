import { BADGES, CONFIG } from '/js/config.js';
import { admin, localized, mediaUrl, val } from '/js/api.js';
import { badgeLabel, contentLocale, defaultLocale, getLocales, langName, lbl, t } from '/js/i18n.js';
import { localeTabs, missingNote } from '/js/lang-ui.js';
import { currencySymbol, fractionDigits, getCurrency, h, icon, majorInput, money, toMinor, toast, fill } from '/js/util.js';
import { adminData, loadMenu, replaceRow, toLocaleMap } from '/js/admin/data.js';
import { sleep } from '/js/util.js';

const CT = CONFIG.contentTypes;
let selectedId = null;

const ref = (id) => ({ sys: { type: 'Refer', id, targetType: 'Content' } });
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const blankForm = (sectionId) => ({ name: {}, price: '', sectionId, badge: '', description: {}, detail: {}, optionGroups: [], imageId: null, img: null, newMedia: null, photo: '' });

// ---------- Menu photos ----------
// Upload → Media; the platform processes it and publishes it by itself, so wait (bounded, by id) until
// it is Published with a finished file before the menu item points at it.
const MAX_PHOTO_BYTES = 50 * 1024 * 1024; // the smallest plan's per-file cap; larger plans allow more
async function waitForMedia(id) {
  for (const ms of [700, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000]) {
    await sleep(ms);
    const m = await admin.getMedia(id);
    const state = val(m.fields, 'file')?.state ?? null;
    if (state === 'FAILED') throw new Error('media-failed');
    if (m.sys.status === 'Published' && state !== 'PENDING' && state !== 'PROCESSING') return m;
  }
  throw new Error('media-timeout');
}
// Best effort: drop a photo uploaded in a form that was then cancelled or replaced before saving.
async function discardMedia(media) {
  try { await admin.removeMedia(await admin.getMedia(media.sys.id)); } catch (e) { console.warn('[menu] could not remove an unused photo', e); }
  adminData.media.delete(media.sys.id);
}

// Translatable text is kept as { localeCode: text }. The default locale must hold a value: when it is
// left empty, the first filled locale is copied into it so every language has something to show.
const trimMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));
function withDefault(m) {
  const out = trimMap(m);
  const d = defaultLocale();
  if (!out[d]) { const first = Object.values(out)[0]; if (first) out[d] = first; }
  return out;
}
const hasText = (m) => Object.keys(trimMap(m)).length > 0;

// Preset names in the languages the dictionaries know; a Space locale without one gets the English name.
function presetName(byLang) {
  const out = {};
  for (const l of getLocales()) out[l.code] = byLang[l.code.split('-')[0]] || byLang.en;
  return out;
}
// Form prices are typed in the store currency's normal unit ("4500" won, "4.50" dollars) and saved
// as integers in its minor unit; a preset's add-on price is a small amount in that currency.
const upcharge = () => (fractionDigits() ? (0.5).toFixed(fractionDigits()) : '500');
const zero = () => (0).toFixed(fractionDigits());
const priceStep = () => (fractionDigits() ? 1 / 10 ** fractionDigits() : getCurrency() === 'KRW' ? 100 : 1);
const PRESETS = {
  temp: () => ({ id: uid('g'), name: presetName({ en: 'Temperature', ko: '온도' }), required: true, multi: false, options: [
    { id: 'hot', name: presetName({ en: 'Hot', ko: '핫' }), price: zero() }, { id: 'ice', name: presetName({ en: 'Iced', ko: '아이스' }), price: zero() }] }),
  size: () => ({ id: uid('g'), name: presetName({ en: 'Size', ko: '사이즈' }), required: true, multi: false, options: [
    { id: 'regular', name: presetName({ en: 'Regular', ko: '레귤러' }), desc: '355ml', price: zero() }, { id: 'large', name: presetName({ en: 'Large', ko: '라지' }), desc: '473ml', price: upcharge() }] }),
  extra: () => ({ id: uid('g'), name: presetName({ en: 'Extras', ko: '추가 옵션' }), required: false, multi: true, options: [
    { id: uid('o'), name: presetName({ en: 'Extra shot', ko: '샷 추가' }), price: upcharge() }] }),
};

export async function menuPage(main, { isCurrent }) {
  try {
    await loadMenu(true);
  } catch (e) {
    console.error(e);
    if (isCurrent()) fill(main, h('p', { class: 'muted' }, t('m.loadFail')));
    return;
  }
  if (!isCurrent()) return;

  let editing = null; // null | 'new' | item id
  let form = null;
  let addingSection = false;
  let renamingSection = false;
  let sectionName = {};
  let saving = false;

  const sections = () => adminData.sections;
  const items = () => adminData.items;
  const itemsOf = (sid) => items().filter((i) => i.sectionId === sid).sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
  const startLocale = () => (getLocales().some((l) => l.code === contentLocale()) ? contentLocale() : defaultLocale());
  if (!sections().some((s) => s.id === selectedId)) selectedId = sections()[0]?.id || null;

  const fail = async (e, msg) => {
    console.error(e);
    toast(e?.status === 409 ? t('m.conflict') : msg);
    if (e?.status === 409) { await loadMenu(true); paint(); }
  };

  function paint() {
    const secs = sections();
    const all = items();
    const current = secs.find((s) => s.id === selectedId) || null;
    const list = current ? itemsOf(current.id) : [];
    const soldCount = all.filter((i) => i.soldOut).length;

    fill(main,
      h('div', { class: 'page-head' },
        h('div', { class: 'col-tight' }, h('span', { class: 'muted-s' }, t('m.summary', { s: secs.length, i: all.length, o: soldCount })), h('h1', null, t('m.title'))),
        h('button', {
          type: 'button', class: 'btn btn-accent', disabled: !secs.length,
          onClick: () => { if (form?.newMedia) discardMedia(form.newMedia); editing = 'new'; form = { ...blankForm(selectedId), loc: startLocale() }; paint(); main.querySelector('#f-name')?.focus(); },
        }, icon('plus', 16, 2.2), t('m.addItem'))),
      h('div', { class: 'menu-layout' },
        h('aside', { class: 'card sec-aside', 'aria-label': t('m.sections') },
          h('h2', { class: 'aside-title' }, t('m.sections')),
          h('div', { class: 'sec-list' }, secs.map((s) => h('button', {
            type: 'button', class: `sec-btn${s.id === selectedId ? ' is-on' : ''}`, 'aria-pressed': String(s.id === selectedId),
            onClick: () => { selectedId = s.id; renamingSection = false; paint(); },
          }, icon('grip', 16), h('span', { class: 'grow' }, s.name), h('span', { class: 'sec-count' }, itemsOf(s.id).length)))),
          current && !addingSection ? h('div', { class: 'sec-tools' },
            renamingSection
              ? sectionForm(t('m.renameSection'), t('m.rename'), () => renameSection(current))
              : h('div', { class: 'row-gap wrap' },
                h('button', { type: 'button', class: 'mini', 'aria-label': t('m.up', { name: current.name }), onClick: () => moveSection(current, -1) }, icon('up', 14)),
                h('button', { type: 'button', class: 'mini', 'aria-label': t('m.down', { name: current.name }), onClick: () => moveSection(current, 1) }, icon('down', 14)),
                h('button', { type: 'button', class: 'mini mini-text', onClick: () => { renamingSection = true; sectionName = toLocaleMap(current.raw.fields?.name); paint(); } }, t('m.renameBtn')),
                h('button', { type: 'button', class: 'mini mini-text', onClick: () => deleteSection(current) }, t('m.delete')))) : null,
          addingSection
            ? sectionForm(t('m.newSection'), t('m.add'), addSection)
            : h('button', { type: 'button', class: 'dashed-btn', onClick: () => { addingSection = true; renamingSection = false; sectionName = {}; paint(); main.querySelector('.sec-form input')?.focus(); } }, icon('plus', 16), t('m.addSection'))),
        h('div', { class: 'menu-right' },
          editing ? itemForm() : null,
          h('section', { class: 'card item-card' },
            h('div', { class: 'card-head' },
              h('h2', { class: 'h-lg' }, current ? current.name : t('m.makeSectionFirst'), current ? h('span', { class: 'muted-s' }, t('m.countN', { n: list.length })) : null),
              h('span', { class: 'muted-xs' }, t('m.hint'))),
            list.map((it, idx) => h('div', { class: 'a-item' },
              h('div', { class: 'col-arrows' },
                h('button', { type: 'button', class: 'mini', disabled: idx === 0, 'aria-label': t('m.up', { name: it.name }), onClick: () => moveItem(it, -1) }, icon('up', 14)),
                h('button', { type: 'button', class: 'mini', disabled: idx === list.length - 1, 'aria-label': t('m.down', { name: it.name }), onClick: () => moveItem(it, 1) }, icon('down', 14))),
              it.img ? h('img', { class: 'a-thumb', src: `${it.img}/style3`, alt: '', loading: 'lazy' }) : h('span', { class: 'a-thumb', 'aria-hidden': 'true' }, icon('image', 18)),
              h('div', { class: 'a-item-main' },
                h('div', { class: 'row-gap wrap' },
                  h('span', { class: `a-item-name${it.soldOut ? ' is-sold' : ''}` }, it.name),
                  it.badge ? h('span', { class: 'badge' }, badgeLabel(it.badge)) : null,
                  it.optionGroups.length ? h('span', { class: 'tag-soft' }, t('m.optN', { n: it.optionGroups.length })) : null,
                  it.sys.status === 'Draft' ? h('span', { class: 'tag-soft' }, t('m.hidden')) : null),
                h('span', { class: 'muted-s' }, it.description || t('m.noDesc'))),
              h('div', { class: 'a-item-side' },
                h('span', { class: 'a-item-price' }, money(it.price)),
                h('button', {
                  type: 'button', class: 'sold-toggle', 'aria-pressed': String(!!it.soldOut), 'aria-label': t('m.soldAria', { name: it.name }),
                  onClick: () => toggleSold(it),
                }, h('span', { class: `switch switch-sm${it.soldOut ? ' is-on' : ''}` }, h('span')), t('c.soldOut')),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('m.edit', { name: it.name }), onClick: () => { if (form?.newMedia) discardMedia(form.newMedia); editing = it.id; form = toForm(it); paint(); main.scrollIntoView({ block: 'start' }); } }, icon('edit', 18)),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('m.del', { name: it.name }), onClick: () => deleteItem(it) }, icon('trash', 18))))),
            current && !list.length ? h('p', { class: 'empty-row' }, t('m.emptySection')) : null))),
    );
  }

  // Section names are short, so every locale gets its own input (default locale first).
  function sectionForm(label, cta, onSubmit) {
    return h('form', { class: 'sec-form', onSubmit: (e) => { e.preventDefault(); onSubmit(); } },
      h('span', { class: 'lbl' }, label),
      getLocales().map((l, i) => h('label', { class: 'loc-field' },
        getLocales().length > 1 ? h('span', { class: 'muted-xs' }, langName(l.code), l.default ? ` ${t('l10n.default')}` : '') : null,
        h('input', {
          id: i === 0 ? 'sec-name' : null, class: 'input', maxlength: 32, lang: l.code, value: sectionName[l.code] || '',
          placeholder: l.default ? t('m.secPh') : sectionName[defaultLocale()] || '', onInput: (e) => { sectionName[l.code] = e.target.value; },
        }))),
      h('div', { class: 'row-gap' },
        h('button', { type: 'button', class: 'btn btn-sm grow', onClick: () => { addingSection = false; renamingSection = false; paint(); } }, t('common.cancel')),
        h('button', { type: 'submit', class: 'btn btn-sm btn-dark grow', disabled: saving }, cta)));
  }

  function toForm(it) {
    const f = it.raw.fields || {};
    return {
      loc: startLocale(),
      imageId: it.imageId, img: it.img, newMedia: null, photo: '',
      name: toLocaleMap(f.name), price: it.price === undefined || it.price === null ? '' : majorInput(it.price), sectionId: it.sectionId, badge: it.badge || '',
      description: toLocaleMap(f.description), detail: toLocaleMap(f.detail),
      optionGroups: JSON.parse(JSON.stringify(it.optionGroups || [])).map((g) => ({
        ...g, name: toLocaleMap(g.name), options: (g.options || []).map((o) => ({ ...o, name: toLocaleMap(o.name), price: majorInput(o.price) })),
      })),
    };
  }

  function closeForm() {
    if (form?.newMedia) discardMedia(form.newMedia);
    editing = null;
    form = null;
    paint();
  }

  function photoField() {
    const f = form;
    const pick = (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) uploadPhoto(f, file); };
    return h('div', { class: 'photo-field' },
      h('div', { class: `photo-box${f.photo ? ' is-busy' : ''}` },
        f.img ? h('img', { src: `${f.img}/style5`, alt: '' }) : icon('image', 28)),
      h('div', { class: 'col-tight photo-side' },
        h('span', { class: 'lbl' }, t('m.f.photo'), ' ', h('span', { class: 'muted-n' }, t('m.f.photoHint'))),
        h('div', { class: 'row-gap wrap' },
          h('label', { class: `btn btn-sm${f.photo ? ' is-disabled' : ''}` }, icon('image', 14), f.img ? t('m.f.photoChange') : t('m.f.photoAdd'),
            h('input', { type: 'file', accept: 'image/*', class: 'sr-only', disabled: !!f.photo, onChange: pick })),
          f.img && !f.photo ? h('button', { type: 'button', class: 'btn btn-sm', onClick: () => removePhoto(f) }, t('m.f.photoRemove')) : null),
        f.photo ? h('span', { class: 'muted-xs', role: 'status' }, f.photo) : null));
  }

  async function uploadPhoto(f, file) {
    if (!/^image\//.test(file.type)) { toast(t('m.photo.notImage')); return; }
    if (file.size > MAX_PHOTO_BYTES) { toast(t('m.photo.tooBig', { mb: 50 })); return; }
    f.photo = t('m.photo.uploading');
    paint();
    try {
      const upload = await admin.uploadFile(file);
      if (form === f) { f.photo = t('m.photo.processing'); paint(); }
      const created = await admin.createMedia({ upload, fileName: file.name, contentType: file.type, title: lbl(withDefault(f.name)) || file.name });
      const media = await waitForMedia(created.sys.id);
      adminData.media.set(media.sys.id, media);
      if (form !== f) { discardMedia(media); return; }
      if (f.newMedia) discardMedia(f.newMedia);
      f.newMedia = media;
      f.imageId = media.sys.id;
      f.img = mediaUrl(media);
    } catch (e) {
      console.error(e);
      toast(e.status === 429 || e.code === 'WGL429004' ? t('m.photo.planLimit')
        : e.message === 'media-failed' ? t('m.photo.failed')
          : e.message === 'media-timeout' ? t('m.photo.slow') : t('m.photo.uploadFail'));
    }
    f.photo = '';
    if (form === f) paint();
  }

  function removePhoto(f) {
    if (f.newMedia) { discardMedia(f.newMedia); f.newMedia = null; }
    f.imageId = null;
    f.img = null;
    paint();
  }

  function itemForm() {
    const isNew = editing === 'new';
    const loc = form.loc;
    const d = defaultLocale();
    const secName = sections().find((s) => s.id === form.sectionId)?.name || '';
    const field = (id, label, input) => h('div', { class: 'field' }, h('label', { for: id, class: 'lbl' }, label), input);
    // In a non-default locale the placeholder shows the default text that is used when this is left empty.
    const ph = (map, example) => (loc === d ? example : map[d] || example);
    const tag = getLocales().length > 1 ? h('span', { class: 'loc-tag', lang: loc }, langName(loc)) : null;
    const descNote = h('span', { class: 'missing-slot' }, missingNote(form.description));
    const detailNote = h('span', { class: 'missing-slot' }, missingNote(form.detail));
    return h('section', { class: 'card form-card', 'aria-label': isNew ? t('m.newItem') : t('m.editItem') },
      h('div', { class: 'row-between' },
        h('h2', null, isNew ? t('m.newItem') : t('m.editItem')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), onClick: closeForm }, icon('close', 18))),
      photoField(),
      getLocales().length > 1 ? h('div', { class: 'loc-bar' },
        h('span', { class: 'lbl' }, t('l10n.editLang')),
        localeTabs(loc, (code) => { form.loc = code; paint(); }),
        h('span', { class: 'muted-xs' }, t('l10n.hint'))) : null,
      h('div', { class: 'form-grid' },
        field('f-name', h('span', null, t('m.f.name'), tag),
          h('input', { id: 'f-name', class: 'input', maxlength: 40, lang: loc, value: form.name[loc] || '', placeholder: ph(form.name, t('m.f.namePh')), onInput: (e) => { form.name[loc] = e.target.value; } })),
        field('f-price', t('m.f.price', { cur: currencySymbol() }), h('input', { id: 'f-price', class: 'input', type: 'number', inputmode: fractionDigits() ? 'decimal' : 'numeric', min: 0, step: priceStep(), value: form.price, placeholder: fractionDigits() ? (5.5).toFixed(fractionDigits()) : '5500', onInput: (e) => { form.price = e.target.value; } })),
        field('f-section', t('m.f.section'), h('select', { id: 'f-section', class: 'input', onChange: (e) => { form.sectionId = e.target.value; } },
          sections().map((s) => h('option', { value: s.id, selected: s.id === form.sectionId }, s.name)))),
        field('f-badge', t('m.f.badge'), h('select', { id: 'f-badge', class: 'input', onChange: (e) => { form.badge = e.target.value; } },
          [['', t('m.f.none')], ...BADGES.map((b) => [b, badgeLabel(b)])].map(([v, l]) => h('option', { value: v, selected: form.badge === v }, l))))),
      field('f-desc', h('span', null, `${t('m.f.desc')} `, h('span', { class: 'muted-n' }, t('m.f.descHint')), tag),
        [h('input', { id: 'f-desc', class: 'input', maxlength: 200, lang: loc, value: form.description[loc] || '', placeholder: ph(form.description, t('m.f.descPh')), onInput: (e) => { form.description[loc] = e.target.value; fill(descNote, missingNote(form.description)); } }), descNote]),
      field('f-detail', h('span', null, `${t('m.f.detail')} `, h('span', { class: 'muted-n' }, t('m.f.detailHint')), tag),
        [h('textarea', { id: 'f-detail', class: 'textarea', rows: 2, maxlength: 1000, lang: loc, placeholder: loc === d ? '' : form.detail[d] || '', onInput: (e) => { form.detail[loc] = e.target.value; fill(detailNote, missingNote(form.detail)); } }, form.detail[loc] || ''), detailNote]),
      optionsEditor(loc, tag),
      h('div', { class: 'row-gap end wrap' },
        h('button', { type: 'button', class: 'btn', onClick: closeForm }, t('common.cancel')),
        h('button', { type: 'button', class: 'btn btn-dark', disabled: saving, onClick: saveItem }, saving ? t('m.saving') : isNew ? t('m.addTo', { section: secName }) : t('common.save'))));
  }

  function optionsEditor(loc, tag) {
    const groups = form.optionGroups;
    const d = defaultLocale();
    const ph = (map, example) => (loc === d ? example : map[d] || example);
    return h('div', { class: 'opt-editor' },
      h('div', { class: 'row-between wrap' },
        h('span', { class: 'lbl' }, `${t('m.opt.title')} `, h('span', { class: 'muted-n' }, t('m.opt.hint')), tag),
        h('div', { class: 'row-gap wrap' },
          h('button', { type: 'button', class: 'mini mini-text', onClick: () => { groups.push(PRESETS.temp()); paint(); } }, t('m.opt.temp')),
          h('button', { type: 'button', class: 'mini mini-text', onClick: () => { groups.push(PRESETS.size()); paint(); } }, t('m.opt.size')),
          h('button', { type: 'button', class: 'mini mini-text', onClick: () => { groups.push(PRESETS.extra()); paint(); } }, t('m.opt.extra')),
          h('button', { type: 'button', class: 'mini mini-text', onClick: () => { groups.push({ id: uid('g'), name: {}, required: false, multi: false, options: [{ id: uid('o'), name: {}, price: zero() }] }); paint(); } }, t('m.opt.blank')))),
      groups.length ? null : h('p', { class: 'muted-xs' }, t('m.opt.none')),
      groups.map((g, gi) => h('div', { class: 'opt-g' },
        h('div', { class: 'opt-g-head' },
          h('input', { class: 'input input-sm grow', maxlength: 20, lang: loc, value: g.name[loc] || '', placeholder: ph(g.name, t('m.opt.groupPh')), 'aria-label': t('m.opt.groupAria'), onInput: (e) => { g.name[loc] = e.target.value; } }),
          h('label', { class: 'check-row sm' }, h('input', { type: 'checkbox', checked: !!g.required, onChange: (e) => { g.required = e.target.checked; } }), t('m.opt.required')),
          h('label', { class: 'check-row sm' }, h('input', { type: 'checkbox', checked: !!g.multi, onChange: (e) => { g.multi = e.target.checked; } }), t('m.opt.multi')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('m.opt.delGroup'), onClick: () => { groups.splice(gi, 1); paint(); } }, icon('trash', 16))),
        (g.options || []).map((o, oi) => h('div', { class: 'opt-o' },
          h('input', { class: 'input input-sm grow', maxlength: 20, lang: loc, value: o.name[loc] || '', placeholder: ph(o.name, t('m.opt.namePh')), 'aria-label': t('m.opt.namePh'), onInput: (e) => { o.name[loc] = e.target.value; } }),
          h('input', { class: 'input input-sm w-90', maxlength: 20, value: lbl(o.desc) || '', placeholder: t('m.opt.descPh'), 'aria-label': t('m.opt.descPh'), onInput: (e) => { o.desc = e.target.value; } }),
          h('input', { class: 'input input-sm w-90', type: 'number', inputmode: fractionDigits() ? 'decimal' : 'numeric', min: 0, step: priceStep(), value: String(o.price ?? zero()), 'aria-label': t('m.opt.priceAria', { cur: currencySymbol() }), onInput: (e) => { o.price = e.target.value; } }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('m.opt.del'), onClick: () => { g.options.splice(oi, 1); paint(); } }, icon('close', 16)))),
        h('button', { type: 'button', class: 'link-btn link-btn-sm', onClick: () => { g.options = g.options || []; g.options.push({ id: uid('o'), name: {}, price: zero() }); paint(); } }, t('m.opt.add')))));
  }

  // Option group / option names are stored inside the item's optionGroups JSON as { localeCode: name }.
  function cleanGroups() {
    const out = [];
    for (const g of form.optionGroups) {
      const options = (g.options || []).filter((o) => hasText(o.name)).map((o) => {
        const opt = { id: o.id || uid('o'), name: withDefault(o.name), price: Math.max(0, toMinor(o.price)) };
        const desc = String(lbl(o.desc) || '').trim();
        if (desc) opt.desc = desc;
        return opt;
      });
      if (!hasText(g.name) && !options.length) continue;
      if (!hasText(g.name)) throw new Error(t('m.err.groupName'));
      const name = withDefault(g.name);
      if (!options.length) throw new Error(t('m.err.groupEmpty', { name: lbl(name) }));
      out.push({ id: g.id || uid('g'), name, required: !!g.required, multi: !!g.multi, options });
    }
    return out;
  }

  async function saveItem() {
    const name = withDefault(form.name);
    const price = toMinor(form.price);
    if (!hasText(name)) { toast(t('m.err.name')); return; }
    if (!Number.isFinite(Number(form.price)) || price < 0 || form.price === '') { toast(t('m.err.price')); return; }
    if (!form.sectionId) { toast(t('m.err.section')); return; }
    let optionGroups;
    try { optionGroups = cleanGroups(); } catch (e) { toast(e.message); return; }
    if (JSON.stringify(optionGroups).length > 5000) { toast(t('m.err.tooMany')); return; }

    const existing = editing === 'new' ? null : items().find((i) => i.id === editing);
    const sectionChanged = !existing || existing.sectionId !== form.sectionId;
    if (form.photo) { toast(t('m.photo.wait')); return; }
    const values = {
      image: form.imageId ? { sys: { type: 'Refer', id: form.imageId, targetType: 'Media' } } : null,
      name: localized(name), price, section: ref(form.sectionId), badge: form.badge || '',
      description: localized(form.description), detail: localized(form.detail), optionGroups,
    };
    if (sectionChanged) values.sortOrder = Math.max(0, ...itemsOf(form.sectionId).map((i) => i.sortOrder || 0)) + 1;
    saving = true;
    paint();
    try {
      if (existing) {
        replaceRow(adminData.items, await admin.patchPublish(CT.item, existing.raw, values));
      } else {
        const create = { ...values, soldOut: false };
        replaceRow(adminData.items, await admin.createPublish(CT.item, create));
      }
      // The saved item now uses this photo; it is no longer an unsaved upload to clean up.
      form.newMedia = null;
      selectedId = form.sectionId;
      editing = null;
      form = null;
      toast(t('m.saved'));
    } catch (e) {
      await fail(e, t('m.saveFail'));
    }
    saving = false;
    paint();
  }

  async function toggleSold(it) {
    try {
      replaceRow(adminData.items, await admin.patchPublish(CT.item, it.raw, { soldOut: !it.soldOut }));
      toast(it.soldOut ? t('m.soldOff', { name: it.name }) : t('m.soldOn', { name: it.name }));
    } catch (e) { await fail(e, t('m.toggleFail')); }
    paint();
  }

  async function deleteItem(it) {
    if (!window.confirm(t('m.delConfirm', { name: it.name }))) return;
    try {
      await admin.remove(CT.item, it.raw);
      adminData.items = items().filter((i) => i.id !== it.id);
      if (editing === it.id) { if (form?.newMedia) discardMedia(form.newMedia); editing = null; form = null; }
      toast(t('m.deleted'));
    } catch (e) { await fail(e, t('m.delFail')); }
    paint();
  }

  // Reorder by rewriting sortOrder as 1..n and saving only the rows whose number changed.
  async function reorder(list, ctId, rowsRef) {
    const changed = list.map((r, i) => ({ r, n: i + 1 })).filter(({ r, n }) => r.sortOrder !== n);
    for (const { r, n } of changed) replaceRow(rowsRef(), await admin.patchPublish(ctId, r.raw, { sortOrder: n }));
  }

  async function moveItem(it, dir) {
    const list = itemsOf(it.sectionId);
    const i = list.findIndex((x) => x.id === it.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    try { await reorder(list, CT.item, () => adminData.items); } catch (e) { await fail(e, t('m.orderFail')); }
    paint();
  }

  async function moveSection(s, dir) {
    const list = [...sections()];
    const i = list.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    try {
      await reorder(list, CT.section, () => adminData.sections);
      adminData.sections.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
    } catch (e) { await fail(e, t('m.orderFail')); }
    paint();
  }

  async function addSection() {
    const name = withDefault(sectionName);
    if (!hasText(name)) { toast(t('m.err.secName')); return; }
    saving = true;
    try {
      const sortOrder = Math.max(0, ...sections().map((s) => s.sortOrder || 0)) + 1;
      const row = replaceRow(adminData.sections, await admin.createPublish(CT.section, { name: localized(name), sortOrder }));
      selectedId = row.id;
      addingSection = false;
    } catch (e) { await fail(e, t('m.secAddFail')); }
    saving = false;
    paint();
  }

  async function renameSection(s) {
    const name = withDefault(sectionName);
    if (!hasText(name)) { toast(t('m.err.secName')); return; }
    saving = true;
    try {
      replaceRow(adminData.sections, await admin.patchPublish(CT.section, s.raw, { name: localized(name) }));
      renamingSection = false;
    } catch (e) { await fail(e, t('m.renameFail')); }
    saving = false;
    paint();
  }

  async function deleteSection(s) {
    if (itemsOf(s.id).length) { toast(t('m.secNotEmpty')); return; }
    if (!window.confirm(t('m.secDelConfirm', { name: s.name }))) return;
    try {
      await admin.remove(CT.section, s.raw);
      adminData.sections = sections().filter((x) => x.id !== s.id);
      selectedId = adminData.sections[0]?.id || null;
    } catch (e) { await fail(e, t('m.secDelFail')); }
    paint();
  }

  paint();
}

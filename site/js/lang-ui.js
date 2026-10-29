import { contentLocale, getLocales, langName, missingIn, setLocale, t } from '/js/i18n.js';
import { h, icon } from '/js/util.js';

// Language picker built from the Space's Locales (see i18n.js). Hidden when the Space has one locale.
export function langSwitcher(extraClass = '') {
  const list = getLocales();
  if (list.length < 2) return null;
  return h('label', { class: `lang-select ${extraClass}`.trim() },
    icon('globe', 16),
    h('span', { class: 'sr-only' }, t('lang.label')),
    h('select', { onChange: (e) => setLocale(e.target.value) },
      list.map((l) => h('option', { value: l.code, selected: l.code === contentLocale(), lang: l.code }, langName(l.code)))));
}

// Tabs that choose which locale a form's translatable inputs are editing.
export function localeTabs(active, onPick) {
  const list = getLocales();
  if (list.length < 2) return null;
  return h('div', { class: 'seg seg-light loc-tabs', role: 'group', 'aria-label': t('l10n.editLang') }, list.map((l) => h('button', {
    type: 'button', 'aria-pressed': String(l.code === active), lang: l.code, onClick: () => onPick(l.code),
  }, langName(l.code), l.default ? h('span', { class: 'loc-default' }, ` ${t('l10n.default')}`) : null)));
}

// Warning under a translatable input when some language would show nothing for it.
export function missingNote(map) {
  const langs = missingIn(map);
  return langs.length ? h('span', { class: 'missing-note' }, t('l10n.missing', { langs: langs.map(langName).join(', ') })) : null;
}

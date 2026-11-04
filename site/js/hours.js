import { t } from '/js/i18n.js';
import { ampm, dayLong, dayShort, hmToMin, storeTime, minToHM } from '/js/util.js';

// Business hours are stored as [{ dow: 0..6 (Sun..Sat), open, from: 'HH:MM', to: 'HH:MM', fromMin, toMin }].
// The place-order Script applies the same rule server-side (yesterday's past-midnight opening included),
// so the two must stay in step.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function normHours(hours) {
  const out = Array.from({ length: 7 }, (_, dow) => ({ dow, open: false, from: '10:00', to: '21:00', fromMin: 600, toMin: 1260 }));
  for (const e of Array.isArray(hours) ? hours : []) {
    if (!e || !(e.dow >= 0 && e.dow <= 6)) continue;
    const from = e.from || out[e.dow].from;
    const to = e.to || out[e.dow].to;
    out[e.dow] = { dow: e.dow, open: !!e.open, from, to, fromMin: hmToMin(from), toMin: hmToMin(to) };
  }
  return out;
}

export function serializeHours(hours) {
  return WEEK_ORDER.map((dow) => {
    const e = hours[dow];
    return { dow, open: !!e.open, from: e.from, to: e.to, fromMin: hmToMin(e.from), toMin: hmToMin(e.to) };
  });
}

// A day's closing time in minutes from that day's midnight. A closing time at or before the opening time
// ("18:00 – 02:00", "09:00 – 09:00") runs past midnight into the next day, so 1440 is added.
export const endMin = (e) => (e.toMin <= e.fromMin ? e.toMin + 1440 : e.toMin);

const nextLabel = (n) => (n.kind === 'today' ? t('day.today') : n.kind === 'tomorrow' ? t('day.tomorrow') : dayLong(n.dow));

// The openings the current time falls in, in minutes from today's midnight. After midnight that can
// still be yesterday's opening when it runs past midnight; today's own past-midnight part belongs to
// tomorrow, never to this morning.
export function currentSessions(hours, now) {
  const out = [];
  const yesterday = hours[(now.dow + 6) % 7];
  if (yesterday.open && now.min < endMin(yesterday) - 1440) out.push({ e: yesterday, end: endMin(yesterday) - 1440 });
  const today = hours[now.dow];
  if (today.open && now.min >= today.fromMin && now.min < endMin(today)) out.push({ e: today, end: endMin(today) });
  return out;
}

export function storeStatus(store, ms = Date.now()) {
  const now = storeTime(ms);
  const hours = normHours(store?.hours);
  const today = hours[now.dow];
  const last = Number(store?.lastOrderMinutes) || 0;
  const sessions = currentSessions(hours, now);
  const inHours = sessions.length > 0;
  const inOrderWindow = sessions.some((s) => now.min < s.end - last);
  const manualClosed = !store?.acceptOrders;
  const accepting = !manualClosed && inOrderWindow;
  const shown = sessions.length ? sessions[sessions.length - 1].e : today;

  let next = null;
  if (today.open && now.min < today.fromMin) next = { kind: 'today', dow: now.dow, min: today.fromMin };
  else {
    for (let i = 1; i <= 7; i++) {
      const e = hours[(now.dow + i) % 7];
      if (e.open) { next = { kind: i === 1 ? 'tomorrow' : 'day', dow: e.dow, min: e.fromMin }; break; }
    }
  }
  if (next) next.label = nextLabel(next);
  return {
    accepting,
    inHours,
    manualClosed,
    today,
    hours,
    now,
    closesAt: shown.to,
    lastOrderAt: minToHM(endMin(shown) - last),
    lastOrderMinutes: last,
    next,
    nextText: next ? `${next.label} ${ampm(next.min)}` : null,
  };
}

// "Mon–Thu 10:00 – 21:00 · Fri 10:00 – 22:00" + "Closed Sunday"
export function hoursSummary(hoursRaw) {
  const hours = normHours(hoursRaw);
  const groups = [];
  for (const dow of WEEK_ORDER) {
    const e = hours[dow];
    const key = e.open ? `${e.from}-${e.to}` : 'closed';
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.days.push(dow);
    else groups.push({ key, days: [dow], e });
  }
  const name = (days) => (days.length === 1 ? dayShort(days[0]) : `${dayShort(days[0])}–${dayShort(days[days.length - 1])}`);
  const open = groups.filter((g) => g.key !== 'closed').map((g) => `${name(g.days)} ${g.e.from} – ${g.e.to}`);
  const closedDays = groups.filter((g) => g.key === 'closed').flatMap((g) => g.days);
  const closed = closedDays.length ? t('hours.closedDays', { days: closedDays.map(dayLong).join(', ') }) : '';
  return { open, closed };
}

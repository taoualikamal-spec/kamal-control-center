/* Up Again — the daily routine, prayer times, and the Google Calendar events
   built from them. Pure functions only: no page, no saved state, no network.
   app.js decides what to show; google-sync.js sends the events. */

const ROUTINE_TZ = 'Africa/Casablanca';
const ROUTINE_DAYS = [
  { n: 1, code: 'MO', short: 'Mon' }, { n: 2, code: 'TU', short: 'Tue' }, { n: 3, code: 'WE', short: 'Wed' },
  { n: 4, code: 'TH', short: 'Thu' }, { n: 5, code: 'FR', short: 'Fri' }, { n: 6, code: 'SA', short: 'Sat' }, { n: 7, code: 'SU', short: 'Sun' }
];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];

const PRAYERS = [
  { id: 'fajr', name: 'Fajr' }, { id: 'dhuhr', name: 'Dhuhr' }, { id: 'asr', name: 'Asr' },
  { id: 'maghrib', name: 'Maghrib' }, { id: 'isha', name: 'Isha' }
];
// The Moroccan Ministry of Habous method: Fajr 19°, Isha 17°, one-shadow Asr,
// Dhuhr and Maghrib 5 minutes after the astronomical times.
const PRAYER_METHOD = { fajrAngle: 19, ishaAngle: 17, dhuhrMinutes: 5, maghribMinutes: 5 };
const DEFAULT_PLACE = { city: 'Tangier', lat: 35.7595, lng: -5.834 };
const PRAYER_DAYS_AHEAD = 30;

function defaultRoutineItems() {
  return [
    { id: 'wake', title: 'Wake up', start: '09:00', end: '', days: EVERY_DAY, monthDay: 0, page: 'day', note: 'Same time every day, even after a bad night. Write down when you woke.' },
    { id: 'breakfast', title: 'Breakfast', start: '09:30', end: '', days: EVERY_DAY, monthDay: 0, page: '', note: 'Meal 1.' },
    { id: 'work1', title: 'Work: first block', start: '10:00', end: '14:00', days: WEEKDAYS, monthDay: 0, page: 'home', note: 'Four hours toward this week.' },
    { id: 'lunch', title: 'Lunch', start: '14:00', end: '14:45', days: EVERY_DAY, monthDay: 0, page: '', note: 'Meal 2.' },
    { id: 'work2', title: 'Work: second block', start: '15:00', end: '19:00', days: WEEKDAYS, monthDay: 0, page: 'home', note: 'Four more hours.' },
    { id: 'hours', title: 'Log today’s work hours', start: '19:00', end: '', days: WEEKDAYS, monthDay: 0, page: 'home', note: '', live: 'hours' },
    { id: 'week', title: 'Week check: hours, pay, debts', start: '19:15', end: '', days: [5], monthDay: 0, page: 'home', note: '', live: 'week' },
    { id: 'dinner', title: 'Dinner', start: '20:00', end: '', days: EVERY_DAY, monthDay: 0, page: '', note: 'Meal 3.' },
    { id: 'money', title: 'Write down today’s money', start: '21:30', end: '', days: EVERY_DAY, monthDay: 0, page: 'month', note: 'Every amount in and out, so the app stays true.', live: 'money' },
    { id: 'homeready', title: 'Home money ready for the 1st?', start: '20:30', end: '', days: [], monthDay: 28, page: 'home', note: '', live: 'home' },
    { id: 'sendhome', title: 'Send home money', start: '09:15', end: '', days: [], monthDay: 1, page: 'home', note: 'Before anyone else.', live: 'send' },
    { id: 'sleep', title: 'Phone away, get ready to sleep', start: '00:30', end: '', days: EVERY_DAY, monthDay: 0, page: 'day', note: 'Asleep by 01:00 for a 09:00 wake.' }
  ];
}

const clockRe = /^([01]\d|2[0-3]):[0-5]\d$/;
function routineMinutes(clock) { const [h, m] = String(clock).split(':').map(Number); return h * 60 + m; }
function routineClock(minutes) { const m = ((minutes % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function routineId() { return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

function normalizeRoutine(routine) {
  const r = routine && typeof routine === 'object' ? routine : {};
  const items = Array.isArray(r.items) ? r.items : defaultRoutineItems();
  const prayersOn = r.prayers && typeof r.prayers.on === 'object' ? r.prayers.on : {};
  const place = r.prayers || {};
  const google = r.google && typeof r.google === 'object' ? r.google : {};
  return {
    items: items.filter(item => item && String(item.title || '').trim() && clockRe.test(String(item.start || ''))).map(item => ({
      id: item.id || routineId(),
      title: String(item.title).trim().slice(0, 80),
      start: item.start,
      end: clockRe.test(String(item.end || '')) ? item.end : '',
      days: Array.isArray(item.days) ? [...new Set(item.days.map(Number).filter(n => n >= 1 && n <= 7))].sort() : [],
      monthDay: Math.min(28, Math.max(0, Math.round(Number(item.monthDay) || 0))),
      page: ['day', 'month', 'home', 'payback', 'time', 'body'].includes(item.page) ? item.page : '',
      note: String(item.note || '').slice(0, 300),
      live: item.live || '',
      // The work that pays. Shown first on the Overview. The two work blocks start as yes.
      earns: item.earns !== undefined ? Boolean(item.earns) : (item.id === 'work1' || item.id === 'work2')
    })).filter(item => item.monthDay || item.days.length),
    prayers: {
      on: Object.fromEntries(PRAYERS.map(p => [p.id, prayersOn[p.id] !== undefined ? Boolean(prayersOn[p.id]) : true])),
      city: String(place.city || DEFAULT_PLACE.city),
      lat: Number.isFinite(Number(place.lat)) && place.lat !== '' && place.lat !== undefined ? Number(place.lat) : DEFAULT_PLACE.lat,
      lng: Number.isFinite(Number(place.lng)) && place.lng !== '' && place.lng !== undefined ? Number(place.lng) : DEFAULT_PLACE.lng
    },
    google: {
      clientId: String(google.clientId || ''),
      calendarId: String(google.calendarId || ''),
      events: google.events && typeof google.events === 'object' ? google.events : {},
      lastSync: String(google.lastSync || ''),
      prayersUntil: String(google.prayersUntil || ''),
      lastError: String(google.lastError || '')
    }
  };
}

// ISO weekday 1 (Monday) .. 7 (Sunday) of a YYYY-MM-DD date.
function isoWeekday(date) { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; }
function addDays(date, n) { return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }

function routineRunsOn(item, date) {
  if (item.monthDay) return Number(date.slice(8, 10)) === item.monthDay;
  return item.days.includes(isoWeekday(date));
}

function routineDaysLabel(item) {
  if (item.monthDay) return `every month on the ${item.monthDay}${item.monthDay === 1 ? 'st' : item.monthDay === 2 ? 'nd' : item.monthDay === 3 ? 'rd' : 'th'}`;
  if (item.days.length === 7) return 'every day';
  if (item.days.join() === WEEKDAYS.join()) return 'Mon–Fri';
  if (item.days.join() === '6,7') return 'weekends';
  return item.days.map(n => ROUTINE_DAYS[n - 1].short).join(', ');
}

/* ---------- Prayer times ----------
   The standard sun-position method (as in PrayTimes.org), two passes for
   accuracy. Returns real moments (Date objects, UTC inside), so the clock
   shown follows whatever time Morocco is on that day. */
const dsin = d => Math.sin(d * Math.PI / 180);
const dcos = d => Math.cos(d * Math.PI / 180);
const dtan = d => Math.tan(d * Math.PI / 180);
const darcsin = x => Math.asin(x) * 180 / Math.PI;
const darccos = x => Math.acos(Math.max(-1, Math.min(1, x))) * 180 / Math.PI;
const darctan2 = (y, x) => Math.atan2(y, x) * 180 / Math.PI;
const darccot = x => Math.atan(1 / x) * 180 / Math.PI;
const fixAngle = a => a - 360 * Math.floor(a / 360);
const fixHour = h => h - 24 * Math.floor(h / 24);

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = fixHour(darctan2(dcos(e) * dsin(L), dcos(L)) / 15);
  let eqt = q / 15 - RA;
  eqt -= 24 * Math.round(eqt / 24);
  return { declination: darcsin(dsin(e) * dsin(L)), equation: eqt };
}

function prayerTimes(date, lat = DEFAULT_PLACE.lat, lng = DEFAULT_PLACE.lng) {
  const jd0 = Date.parse(`${date}T00:00:00Z`) / 86400000 + 2440587.5;
  const at = hours => sunPosition(jd0 + hours / 24);
  const noon = hours => 12 - lng / 15 - at(hours).equation;
  const angleTime = (angle, hours, before) => {
    const decl = at(hours).declination;
    const t = darccos((-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat))) / 15;
    return noon(hours) + (before ? -t : t);
  };
  const asrTime = hours => {
    const decl = at(hours).declination;
    return angleTime(-darccot(1 + dtan(Math.abs(lat - decl))), hours, false);
  };
  // First guesses in UTC hours, then two passes.
  let t = { fajr: 5, sunrise: 7, dhuhr: 12, asr: 15, sunset: 17.5, isha: 19 };
  for (let pass = 0; pass < 2; pass++) {
    t = {
      fajr: angleTime(PRAYER_METHOD.fajrAngle, t.fajr, true),
      sunrise: angleTime(0.833, t.sunrise, true),
      dhuhr: noon(t.dhuhr),
      asr: asrTime(t.asr),
      sunset: angleTime(0.833, t.sunset, false),
      isha: angleTime(PRAYER_METHOD.ishaAngle, t.isha, false)
    };
  }
  const moment = (hours, extraMinutes = 0) => new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(hours * 60 + extraMinutes) * 60000);
  return {
    fajr: moment(t.fajr),
    sunrise: moment(t.sunrise),
    dhuhr: moment(t.dhuhr, PRAYER_METHOD.dhuhrMinutes),
    asr: moment(t.asr),
    maghrib: moment(t.sunset, PRAYER_METHOD.maghribMinutes),
    isha: moment(t.isha)
  };
}

// "HH:MM" on the wall clock in Morocco for a moment.
function clockInZone(moment, timeZone = ROUTINE_TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(moment);
  const get = type => (parts.find(part => part.type === type) || {}).value;
  return `${get('hour')}:${get('minute')}`;
}

/* ---------- Google Calendar events ----------
   Every event carries its own key, and a signature of its content, so a sync
   only sends what changed. Each one has a phone reminder at its start time. */
function firstRunDate(item, fromDate) {
  for (let i = 0; i < 62; i++) { const date = addDays(fromDate, i); if (routineRunsOn(item, date)) return date; }
  return fromDate;
}

function routineRecurrence(item) {
  if (item.monthDay) return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${item.monthDay}`;
  if (item.days.length === 7) return 'RRULE:FREQ=DAILY';
  return `RRULE:FREQ=WEEKLY;BYDAY=${item.days.map(n => ROUTINE_DAYS[n - 1].code).join(',')}`;
}

function eventSignature(event) { return JSON.stringify([event.summary, event.description, event.start, event.end, event.recurrence || null]); }

const POPUP_AT_START = { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] };

function routineEvent(item, { fromDate, appUrl = '', liveNote = '' }) {
  const date = firstRunDate(item, fromDate);
  const startMin = routineMinutes(item.start);
  let endMin = item.end ? routineMinutes(item.end) : startMin + 15;
  if (endMin <= startMin) endMin = item.end ? endMin + 1440 : startMin + 15;
  const endDate = endMin >= 1440 ? addDays(date, 1) : date;
  const link = item.page && appUrl ? `Open Up Again: ${appUrl}#${item.page}` : '';
  const description = [item.note, liveNote, link].filter(Boolean).join('\n\n');
  const event = {
    summary: item.title,
    description,
    start: { dateTime: `${date}T${item.start}:00`, timeZone: ROUTINE_TZ },
    end: { dateTime: `${endDate}T${routineClock(endMin)}:00`, timeZone: ROUTINE_TZ },
    recurrence: [routineRecurrence(item)],
    reminders: POPUP_AT_START,
    extendedProperties: { private: { upAgain: `routine:${item.id}` } }
  };
  return { key: `routine:${item.id}`, event, sig: eventSignature(event) };
}

function prayerEvents(routine, fromDate, days = PRAYER_DAYS_AHEAD) {
  const out = [];
  const { lat, lng, on } = routine.prayers;
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const times = prayerTimes(date, lat, lng);
    PRAYERS.filter(p => on[p.id]).forEach(p => {
      const start = times[p.id];
      const event = {
        summary: p.name,
        description: `Prayer time in ${routine.prayers.city}, Ministry of Habous method (calculated; your mosque may differ by a minute or two).`,
        start: { dateTime: start.toISOString(), timeZone: ROUTINE_TZ },
        end: { dateTime: new Date(start.getTime() + 15 * 60000).toISOString(), timeZone: ROUTINE_TZ },
        reminders: POPUP_AT_START,
        extendedProperties: { private: { upAgain: `prayer:${date}:${p.id}` } }
      };
      out.push({ key: `prayer:${date}:${p.id}`, event, sig: eventSignature(event) });
    });
  }
  return out;
}

// What one day looks like, routine and prayers together, in time order.
function dayPlan(routine, date) {
  const rows = routine.items.filter(item => routineRunsOn(item, date))
    .map(item => ({ kind: 'routine', id: item.id, title: item.title, start: item.start, end: item.end, page: item.page, earns: Boolean(item.earns) }));
  const times = prayerTimes(date, routine.prayers.lat, routine.prayers.lng);
  PRAYERS.filter(p => routine.prayers.on[p.id]).forEach(p => rows.push({ kind: 'prayer', id: p.id, title: p.name, start: clockInZone(times[p.id]), end: '', page: '' }));
  // The day starts at the wake-up time: anything before it (like 00:30) belongs to the night after.
  const wake = routine.items.find(item => item.id === 'wake');
  const dayStart = wake ? routineMinutes(wake.start) - 180 : 0;
  const order = clock => (routineMinutes(clock) - dayStart + 1440) % 1440;
  return rows.sort((a, b) => order(a.start) - order(b.start));
}

/* ---------- Sync plan ----------
   Given what the calendar should hold and what was sent last time, decide
   what to create, update or delete. Prayer events from past days are left in
   the calendar and simply forgotten. */
function syncPlan(desired, sent, todayDate) {
  const want = new Map(desired.map(item => [item.key, item]));
  const create = [], update = [], remove = [], forget = [];
  desired.forEach(item => {
    const known = sent[item.key];
    if (!known) create.push(item);
    else if (known.sig !== item.sig) update.push({ ...item, id: known.id });
  });
  Object.entries(sent).forEach(([key, known]) => {
    if (want.has(key)) return;
    const prayerDate = key.startsWith('prayer:') ? key.split(':')[1] : '';
    if (prayerDate && prayerDate < todayDate) forget.push(key);
    else remove.push({ key, id: known.id });
  });
  return { create, update, remove, forget };
}

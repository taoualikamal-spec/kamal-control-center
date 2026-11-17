// Routine: the day in order, prayer times by the Habous method, and the
// Google Calendar sync (tested against a fake Google that records requests).
const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();
const utc = moment => moment.toISOString().slice(11, 16);
const near = (moment, clock) => Math.abs((Date.parse(`2000-01-01T${utc(moment)}:00Z`) - Date.parse(`2000-01-01T${clock}:00Z`)) / 60000) <= 1;

{
  // Published Habous times for Tangier (shown in UTC by the source), 17 Nov 2026.
  const c = load().ctx;
  const t = c.prayerTimes('2026-11-17', 35.7595, -5.834);
  check('Fajr matches the Habous table', near(t.fajr, '05:27'));
  check('Dhuhr matches the Habous table', near(t.dhuhr, '12:13'));
  check('Asr matches the Habous table', near(t.asr, '14:55'));
  check('Maghrib matches the Habous table', near(t.maghrib, '17:20'));
  check('Isha matches the Habous table', near(t.isha, '18:38'));
  const first = c.prayerTimes('2026-11-01', 35.7595, -5.834);
  check('and on another day too', near(first.fajr, '05:14') && near(first.asr, '15:05') && near(first.isha, '18:49'));
}

{
  const h = load();
  const c = h.ctx;
  const r = () => h.api.state.routine;
  check('a new phone gets the default routine', r().items.length === 12 && r().items.some(item => item.id === 'work1' && item.start === '10:00' && item.end === '14:00'));
  check('all five prayers are on', Object.values(r().prayers.on).every(Boolean));
  check('the default place is Tangier', r().prayers.city === 'Tangier');

  // A weekday: work blocks are there; on Saturday they are not.
  const tuesday = c.dayPlan(r(), '2026-11-17').map(row => row.title);
  const saturday = c.dayPlan(r(), '2026-11-21').map(row => row.title);
  check('a weekday has both work blocks', tuesday.includes('Work: first block') && tuesday.includes('Work: second block'));
  check('a Saturday has no work blocks', !saturday.includes('Work: first block'));
  check('the day starts at waking, and 00:30 comes at the end', tuesday[tuesday.length - 1] === 'Phone away, get ready to sleep');
  check('prayers are part of the day', ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every(name => tuesday.includes(name)));
  const plan = c.dayPlan(r(), '2026-11-17');
  check('the day is in time order from waking', plan.findIndex(row => row.title === 'Wake up') < plan.findIndex(row => row.title === 'Lunch'));

  const now = c.routineNow('2026-11-17', '10:30');
  check('at 10:30 the next thing is after the first work block began', now.next && c.routineMinutes(now.next.start) > c.routineMinutes('10:30'));

  // Editing.
  c.saveRoutineItem('wake', { title: 'Wake up', start: '08:30', end: '', days: [1, 2, 3, 4, 5, 6, 7], monthDay: 0, page: 'day', note: '' });
  check('changing the wake time also sets the sleep wake target', h.api.state.settings.wakeTarget === '08:30');
  check('an item needs at least one day', c.saveRoutineItem('new', { title: 'Gym', start: '18:00', end: '', days: [], monthDay: 0, page: '', note: '' }) === null);
  const gym = c.saveRoutineItem('new', { title: 'Gym', start: '18:00', end: '19:00', days: [2, 4], monthDay: 0, page: '', note: '' });
  check('a new item is added', gym && r().items.some(item => item.title === 'Gym') && c.routineDaysLabel(gym) === 'Tue, Thu');
  check('an item can be removed', c.removeRoutineItem(gym.id) && !r().items.some(item => item.title === 'Gym'));
}

{
  // The events sent to Google.
  const h = load();
  const c = h.ctx;
  const r = h.api.state.routine;
  const work = c.routineEvent(r.items.find(item => item.id === 'work1'), { fromDate: '2026-11-21', appUrl: 'https://example.test/app/' });
  check('a weekday item starts on the next weekday', work.event.start.dateTime === '2026-11-23T10:00:00');
  check('it repeats Monday to Friday', work.event.recurrence[0] === 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  check('it ends when the block ends', work.event.end.dateTime === '2026-11-23T14:00:00');
  check('it uses Morocco time', work.event.start.timeZone === 'Africa/Casablanca');
  check('the phone is reminded at the start', work.event.reminders.useDefault === false && work.event.reminders.overrides[0].minutes === 0);
  check('it links back to the right page', work.event.description.includes('https://example.test/app/#home'));
  const send = c.routineEvent(r.items.find(item => item.id === 'sendhome'), { fromDate: '2026-11-17' });
  check('home money repeats on the 1st of every month', send.event.recurrence[0] === 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1' && send.event.start.dateTime === '2026-12-01T09:15:00');
  const sleep = c.routineEvent(r.items.find(item => item.id === 'sleep'), { fromDate: '2026-11-17' });
  check('an item with no end lasts 15 minutes', sleep.event.end.dateTime === '2026-11-17T00:45:00');
  check('every day repeats daily', sleep.event.recurrence[0] === 'RRULE:FREQ=DAILY');
  const prayers = c.prayerEvents(r, '2026-11-17', 2);
  check('prayer events: five a day', prayers.length === 10 && prayers[0].key === 'prayer:2026-11-17:fajr');
  r.prayers.on.fajr = false;
  check('a prayer turned off is not sent', c.prayerEvents(r, '2026-11-17', 2).length === 8);

  // The money notes carry the numbers as they are now.
  c.setHomeSettings({ target: 8000 }, '2026-11-17');
  const note = c.routineLiveNote('home', '2026-11-17');
  check('the home reminder says how much is ready', note.includes('0 MAD of 8,000 MAD ready'));
}

{
  // Sync plan: create, update, delete, and forget old prayer days.
  const c = load().ctx;
  const desired = [{ key: 'routine:a', sig: '1' }, { key: 'routine:b', sig: '2' }, { key: 'prayer:2026-11-20:fajr', sig: '3' }];
  const sent = { 'routine:a': { id: 'A', sig: '1' }, 'routine:b': { id: 'B', sig: 'old' }, 'routine:gone': { id: 'G', sig: 'x' }, 'prayer:2026-11-10:fajr': { id: 'P', sig: 'y' } };
  const plan = c.syncPlan(desired, sent, '2026-11-17');
  check('unchanged events are left alone', !plan.create.some(i => i.key === 'routine:a') && !plan.update.some(i => i.key === 'routine:a'));
  check('changed events are updated', plan.update.length === 1 && plan.update[0].id === 'B');
  check('new events are created', plan.create.length === 1 && plan.create[0].key === 'prayer:2026-11-20:fajr');
  check('removed routine items are deleted', plan.remove.length === 1 && plan.remove[0].id === 'G');
  check('past prayer days are forgotten, not deleted', plan.forget.join() === 'prayer:2026-11-10:fajr');
}

// A fake Google Calendar that keeps what it is sent.
function fakeGoogle() {
  const calendars = {}; const log = [];
  let n = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchFn = async (url, options) => {
    const path = url.replace('https://www.googleapis.com/calendar/v3', '');
    const body = options.body ? JSON.parse(options.body) : null;
    log.push(`${options.method} ${path.split('/').slice(0, 4).join('/')}`);
    if (options.method === 'POST' && path === '/calendars') { const id = `cal${++n}`; calendars[id] = {}; return reply(200, { id }); }
    const [, , calId, , eventId] = path.split('/').map(decodeURIComponent);
    const cal = calendars[calId];
    if (!cal) return reply(404, { error: { message: 'Not Found' } });
    if (options.method === 'GET' && !eventId && path.split('/').length === 3) return reply(200, { id: calId });
    if (options.method === 'POST') { const id = `ev${++n}`; cal[id] = body; return reply(200, { id }); }
    if (!cal[eventId]) return reply(404, { error: { message: 'Not Found' } });
    if (options.method === 'PUT') { cal[eventId] = body; return reply(200, { id: eventId }); }
    if (options.method === 'DELETE') { delete cal[eventId]; return reply(204, null); }
    return reply(400, {});
  };
  return { fetchFn, calendars, log };
}

(async () => {
  const h = load();
  const c = h.ctx;
  const r = h.api.state.routine;
  const google = fakeGoogle();
  const desired = c.routineDesiredEvents('2026-11-17');
  const first = await c.syncGoogleCalendar({ fetchFn: google.fetchFn, token: 't', desired, store: r.google, todayDate: '2026-11-17' });
  const cal = google.calendars[r.google.calendarId];
  check('the first send makes the Up Again calendar', Boolean(r.google.calendarId) && google.log[0] === 'POST /calendars');
  check('the first send creates every event', first.created === desired.length && Object.keys(cal).length === 12 + 150);

  const again = await c.syncGoogleCalendar({ fetchFn: google.fetchFn, token: 't', desired: c.routineDesiredEvents('2026-11-17'), store: r.google, todayDate: '2026-11-17' });
  check('sending again with no change sends nothing', again.created + again.updated + again.removed === 0);

  c.saveRoutineItem('lunch', { title: 'Lunch', start: '14:00', end: '15:00', days: [1, 2, 3, 4, 5, 6, 7], monthDay: 0, page: '', note: 'Meal 2.' });
  c.removeRoutineItem('breakfast');
  const changed = await c.syncGoogleCalendar({ fetchFn: google.fetchFn, token: 't', desired: c.routineDesiredEvents('2026-11-17'), store: r.google, todayDate: '2026-11-17' });
  check('an edit updates one event and a removal deletes one', changed.updated === 1 && changed.removed === 1 && changed.created === 0);
  check('the deleted item is gone from Google', !Object.values(cal).some(event => event.summary === 'Breakfast'));

  // Deleted by hand in Google: it is made again.
  const lunchId = r.google.events['routine:lunch'].id;
  delete cal[lunchId];
  c.saveRoutineItem('lunch', { title: 'Lunch', start: '14:00', end: '14:50', days: [1, 2, 3, 4, 5, 6, 7], monthDay: 0, page: '', note: 'Meal 2.' });
  await c.syncGoogleCalendar({ fetchFn: google.fetchFn, token: 't', desired: c.routineDesiredEvents('2026-11-17'), store: r.google, todayDate: '2026-11-17' });
  check('an event deleted in Google is made again', Object.values(cal).some(event => event.summary === 'Lunch' && event.end.dateTime.endsWith('14:50:00')));

  // A week later: new prayer days are added, past ones forgotten.
  const later = await c.syncGoogleCalendar({ fetchFn: google.fetchFn, token: 't', desired: c.routineDesiredEvents('2026-11-24'), store: r.google, todayDate: '2026-11-24' });
  check('a week later, 7 new days of prayers are added', later.created === 35);
  check('past prayer days are no longer tracked', !Object.keys(r.google.events).some(key => key.startsWith('prayer:2026-11-2') && key < 'prayer:2026-11-24'));

  // The calendar was deleted in Google: a new one is made.
  delete google.calendars[r.google.calendarId];
  await c.syncGoogleCalendar({ fetchFn: google.fetchFn, token: 't', desired: c.routineDesiredEvents('2026-11-24'), store: r.google, todayDate: '2026-11-24' });
  check('if the calendar was deleted, a new one is made', Boolean(google.calendars[r.google.calendarId]) && Object.keys(google.calendars[r.google.calendarId]).length > 100);

  // Older saved data and odd values still load.
  const old = load({ settings: { envelopes: [] }, transactions: [] });
  check('a backup from before Routine gets the default routine', old.api.state.routine.items.length === 12);
  const messy = load({ settings: { envelopes: [] }, transactions: [], routine: { items: [{ title: 'X', start: '25:00', days: [1] }, { title: 'Read', start: '22:00', days: [9, 3, 3] }], prayers: { on: { fajr: false } } } });
  const items = messy.api.state.routine.items;
  check('messy saved routines are cleaned on load', items.length === 1 && items[0].days.join() === '3' && messy.api.state.routine.prayers.on.fajr === false && messy.api.state.routine.prayers.on.isha === true);

  const nav = load();
  nav.ctx.showTab('month');
  nav.ctx.selectTab('routine');
  check('the Routine page opens', nav.activePages().join() === 'routine');
  check('the Day tab stays lit inside it', nav.litTab() === 'day');
  done();
})();

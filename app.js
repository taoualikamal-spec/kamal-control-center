/* Kamal Control Center - private, offline-first tracker */
const STORAGE_KEY = 'kamal-control-center.v1';
const moneyFormat = new Intl.NumberFormat('en-MA', { maximumFractionDigits: 0 });
const DAY_MS = 24 * 60 * 60 * 1000;

const envelopeIcons = { family: '⌂', personal: '◌', debt: '↘', emergency: '✦' };
const defaultEnvelopes = [
  { id: 'family', name: 'Family & home', percent: 60, target: 8000, color: '#69a9ff' },
  { id: 'personal', name: 'Myself', percent: 20, target: 3000, color: '#ba9aff' },
  { id: 'debt', name: 'Money I owe', percent: 15, target: 0, color: '#ff9b70' },
  { id: 'emergency', name: 'Just in case', percent: 5, target: 1000, color: '#53d6ad' }
];
const defaultHabits = [
  { id: 'money', title: 'Write down today’s money', detail: 'Every amount you got or spent.' },
  { id: 'focus', title: 'Do 25 minutes of focus', detail: 'One block of real work, with the phone away.' },
  { id: 'review', title: 'Write a short note before bed', detail: 'Two minutes. How the day went.' }
];
const timeCategories = {
  stolen: ['Phone / social media', 'Videos / TV', 'Chatting', 'Games', 'Putting things off', 'Other'],
  focus: ['Paid work', 'Making money', 'Learning', 'Building something', 'Family', 'Other']
};

// Simple labels. Storage keys stay 'stolen'/'focus' so old data still loads.
const timeTypeLabel = { stolen: 'Lost', focus: 'Focus' };

const defaultSubstances = [
  { id: 'cigarettes', name: 'Cigarettes', costPerUse: 3 },
  { id: 'cannabis', name: 'Weed', costPerUse: 30 }
];

const cravingTriggers = ['Stress', 'Money worry', 'Bored', 'After food', 'With people', 'Tired', 'Feeling sad', 'My usual time', 'Other'];

// Tappable answers, so "what did it help with" can actually be counted.
// Free text could never be added up, which is why that panel stayed empty.
const helpOptions = ['Calm down', 'Take a break', 'Stop thinking', 'Be with people', 'Reward myself', 'Get to sleep', 'Feel less bored'];

// Shown one after another while waiting. The feeling rises, then falls —
// the job is to stay busy for a few minutes, not to be strong.
const surfScript = [
  'This feeling will get strong, then it will go. You only have to wait.',
  'Breathe in for 4 seconds. Hold for 4. Breathe out for 6. Again.',
  'Where do you feel it in your body? Just watch it. Do not fight it.',
  'It is getting stronger now. That is normal. It will not stay.',
  'If you can, walk for two minutes. Moving your body really does help.',
  'You only have to wait a few more minutes. Not for ever.',
  'The strongest part is passing now. It gets easier from here.',
  'Almost done. Whatever you do next, writing this down helped.'
];

const SURF_SECONDS = 300;

const envelopePalette = ['#69a9ff', '#ba9aff', '#ff9b70', '#53d6ad', '#f7c968', '#fa7888', '#8abaff', '#c7aaff'];

function defaultState() {
  return {
    version: 1,
    settings: { envelopes: structuredClone(defaultEnvelopes), habits: structuredClone(defaultHabits), substances: structuredClone(defaultSubstances), debtTotal: 45000, dailyFocusTarget: 120 },
    transactions: [],
    timeEntries: [],
    cravings: [],
    days: {},
    months: {},
    years: {},
    activeTimer: null,
    activeSurf: null,
    updatedAt: new Date().toISOString()
  };
}

/* Wording written before the plain-English pass lives in saved data, not in code.
   Rewrite only the exact old default strings, so anything renamed by hand is kept. */
const wordingUpgrades = {
  habitTitle: {
    'Track today’s money': 'Write down today’s money',
    'Protect one focus block': 'Do 25 minutes of focus',
    'Close the day clearly': 'Write a short note before bed'
  },
  habitDetail: {
    'Record every payment received or spent.': 'Every amount you got or spent.',
    'At least 25 minutes on a meaningful task.': 'One block of real work, with the phone away.',
    'Write a two-minute note before sleep.': 'Two minutes. How the day went.'
  },
  envelopeName: {
    'Family & Home': 'Family & home',
    'Personal Needs': 'Myself',
    'Debt': 'Money I owe',
    'Emergency': 'Just in case'
  },
  substanceName: { 'Cannabis': 'Weed' }
};

function upgradeWording(settings) {
  settings.habits.forEach(habit => {
    habit.title = wordingUpgrades.habitTitle[habit.title] || habit.title;
    habit.detail = wordingUpgrades.habitDetail[habit.detail] || habit.detail;
  });
  settings.envelopes.forEach(envelope => {
    envelope.name = wordingUpgrades.envelopeName[envelope.name] || envelope.name;
  });
  settings.substances.forEach(substance => {
    substance.name = wordingUpgrades.substanceName[substance.name] || substance.name;
  });
}

function normalizeSettings(settings) {
  settings.envelopes = (settings.envelopes || defaultEnvelopes).map((item, index) => ({ ...defaultEnvelopes[index], ...item }));
  settings.habits = (settings.habits && settings.habits.length ? settings.habits : structuredClone(defaultHabits)).map(item => ({ detail: '', ...item }));
  settings.substances = (settings.substances && settings.substances.length ? settings.substances : structuredClone(defaultSubstances)).map(item => ({ costPerUse: 0, ...item }));
  settings.debtTotal = Number(settings.debtTotal ?? 45000);
  settings.dailyFocusTarget = Math.max(0, Number(settings.dailyFocusTarget ?? 120));
  upgradeWording(settings);
  return settings;
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !stored.settings) return defaultState();
    normalizeSettings(stored.settings);
    stored.transactions ||= [];
    stored.timeEntries ||= [];
    stored.cravings ||= [];
    stored.days ||= {};
    stored.months ||= {};
    stored.years ||= {};
    stored.activeSurf ||= null;
    return stored;
  } catch { return defaultState(); }
}

let state = loadState();
let currentTransactionFilter = 'month';
let installEvent = null;
let toastTimeout;
let selectedDate;   // set during init, once today() exists
let selectedMonth;
let editingIncomeId = null;
let editingExpenseId = null;
let editingTimeId = null;
let themePreference = localStorage.getItem('kamal-theme') || 'system';
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)');

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = amount => `${moneyFormat.format(Math.round(Number(amount || 0)))} MAD`;
const today = () => new Date().toISOString().slice(0, 10);
const monthKey = (date = today()) => String(date).slice(0, 7);
const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $('#storageNote').textContent = `Saved on this phone: ${new Date(state.updatedAt).toLocaleString()}`;
}

function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => box.classList.remove('show'), 2600);
}

function isCurrentMonth(date) { return monthKey(date) === monthKey(); }
function beginningOfDay(date) { return new Date(`${date}T00:00:00`).getTime(); }
function getDayData(date = today()) {
  state.days[date] ||= { priority: '', reflection: '', habits: {} };
  return state.days[date];
}

const MAX_TASKS = 3;

// Days hold small actions, months hold big ones, years hold the whole view.
const yearKey = (date = today()) => String(date).slice(0, 4);

/* Which day and month the user is looking at. Noon anchoring keeps the
   arithmetic safe across daylight-saving shifts. */
function shiftDate(date, days) {
  return new Date(new Date(`${date}T12:00:00`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
function shiftMonth(key, months) {
  const [year, month] = key.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}
function firstOfMonth(key) { return `${key}-01`; }

function dayTitleFor(date) {
  if (date === today()) return 'Today';
  if (date === shiftDate(today(), -1)) return 'Yesterday';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function setSelectedDate(date) {
  if (date > today()) return;
  selectedDate = date;
  renderDay();
  renderTransactions();
}

function setSelectedMonth(key) {
  if (key > monthKey()) return;
  selectedMonth = key;
  renderMonth();
  renderTransactions();
}
function getMonthData(key = monthKey()) {
  state.months[key] ||= { bigMove: '', done: false };
  return state.months[key];
}
function getYearData(key = yearKey()) {
  state.years[key] ||= { theme: '', note: '' };
  return state.years[key];
}

// Carry unfinished tasks from the most recent earlier day into today, once per day.
function rolloverTasks() {
  const day = getDayData(today());
  if (Array.isArray(day.tasks)) return;
  const priorDates = Object.keys(state.days).filter(date => date < today() && Array.isArray(state.days[date].tasks)).sort();
  const lastDate = priorDates[priorDates.length - 1];
  const carried = lastDate ? state.days[lastDate].tasks.filter(task => !task.done).map(task => ({ id: makeId(), text: task.text, done: false, rolled: true })) : [];
  day.tasks = carried;
  if (carried.length) saveState();
}

function addTask(text) {
  const value = text.trim();
  if (!value) return;
  const day = getDayData(selectedDate);
  day.tasks ||= [];
  if (day.tasks.length >= MAX_TASKS) { toast(`Only ${MAX_TASKS} at a time. Finish or remove one first.`); return; }
  day.tasks.push({ id: makeId(), text: value, done: false });
  saveState();
  renderTasks();
  updateTimerTaskOptions();
}

function toggleTask(id, done) {
  const day = getDayData(selectedDate);
  const task = (day.tasks || []).find(item => item.id === id);
  if (!task) return;
  task.done = done;
  saveState();
  renderTasks();
  renderFocusGoal();
  updateTimerTaskOptions();
}

function deleteTask(id) {
  const day = getDayData(selectedDate);
  day.tasks = (day.tasks || []).filter(item => item.id !== id);
  saveState();
  renderTasks();
  updateTimerTaskOptions();
}

/* ---------- Urges: capture, ride, log ----------
   Every craving gets logged whether or not it was acted on. A craving you gave
   into is still data worth having, so nothing here is phrased as a failure. */

let pendingDebriefId = null;

function substanceById(id) { return state.settings.substances.find(item => item.id === id); }

// "cigarettes or weed" — built from what this person actually tracks, so the
// button names the real feeling instead of an abstract one.
function substancePhrase() {
  const names = state.settings.substances.map(item => String(item.name || '').trim().toLowerCase()).filter(Boolean);
  if (!names.length) return 'it';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

const surfMinutes = () => Math.round(SURF_SECONDS / 60);

function beginSurf() {
  const substanceId = $('#cravingSubstance').value;
  state.activeSurf = {
    substanceId,
    trigger: $('#cravingTrigger').value,
    intensity: Number($('#cravingIntensity').value || 3),
    startedAt: new Date().toISOString(),
    targetSeconds: SURF_SECONDS
  };
  requestNotifyPermission();
  surfNotified = false;
  saveState();
  renderBody();
  toast('Stay here. It gets strong, then it goes.');
}

function cancelSurf() {
  state.activeSurf = null;
  surfNotified = false;
  saveState();
  renderBody();
  toast('Stopped. Nothing was saved.');
}

function logCraving(outcome) {
  const surf = state.activeSurf;
  const substanceId = surf ? surf.substanceId : $('#cravingSubstance').value;
  const substance = substanceById(substanceId);
  const seconds = surf ? Math.round((Date.now() - new Date(surf.startedAt).getTime()) / 1000) : 0;
  const recovered = outcome === 'rode' ? Number(substance?.costPerUse || 0) : 0;
  state.cravings.push({
    id: makeId(),
    date: today(),
    substanceId,
    substance: substance?.name || 'Craving',
    trigger: surf ? surf.trigger : $('#cravingTrigger').value,
    intensity: surf ? surf.intensity : Number($('#cravingIntensity').value || 3),
    outcome,
    secondsSurfed: seconds,
    recovered,
    createdAt: new Date().toISOString()
  });
  state.activeSurf = null;
  surfNotified = false;
  const logged = state.cravings[state.cravings.length - 1];
  // A lapse is where people quit. Answer it instead of leaving silence.
  if (outcome !== 'rode') pendingDebriefId = logged.id;
  saveState();
  renderAll();
  if (outcome === 'rode') toast(`You waited. You kept ${money(recovered)}.`);
}

function debriefHeadline(outcome) {
  return outcome === 'less'
    ? 'Less than usual is still better. Take it.'
    : 'This does not make you a bad person. It was one hard moment.';
}

function saveDebrief() {
  const entry = state.cravings.find(item => item.id === pendingDebriefId);
  if (entry) {
    entry.debrief = {
      gaveTags: $$('#helpChips .chip-toggle.on').map(button => button.dataset.help),
      gave: $('#debriefGave').value.trim(),
      next: $('#debriefNext').value.trim()
    };
  }
  closeDebrief();
  saveState();
  renderAll();
  toast('Saved. This is how you learn the pattern.');
}

function skipDebrief() {
  closeDebrief();
  renderBody();
  toast('That is fine. It is saved either way.');
}

function closeDebrief() {
  pendingDebriefId = null;
  ['#debriefGave', '#debriefNext'].forEach(selector => { $(selector).value = ''; });
  const chips = $('#helpChips');
  chips.dataset.for = '';
  chips.innerHTML = '';
}

function timeOfDayBand(iso) {
  const hour = new Date(iso).getHours();
  if (hour < 6) return 'late at night';
  if (hour < 12) return 'in the morning';
  if (hour < 18) return 'in the afternoon';
  return 'in the evening';
}

/* Turns the answers into findings. Uses the three fields that used to be
   collected and never read: how strong it was, how long the wait took,
   and what it helped with. */
function cravingInsights() {
  const all = state.cravings;
  const waited = all.filter(entry => entry.outcome === 'rode' && Number(entry.secondsSurfed) > 0);
  const average = list => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);

  const tagCounts = {};
  all.forEach(entry => (entry.debrief?.gaveTags || []).forEach(tag => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }));
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  const reasons = all.reduce((map, entry) => ({ ...map, [entry.trigger]: (map[entry.trigger] || 0) + 1 }), {});
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];

  const bands = all.reduce((map, entry) => {
    const band = timeOfDayBand(entry.createdAt);
    return { ...map, [band]: (map[band] || 0) + 1 };
  }, {});
  const topBand = Object.entries(bands).sort((a, b) => b[1] - a[1])[0];

  const waitMinutes = waited.map(entry => Math.max(1, Math.round(entry.secondsSurfed / 60)));
  const strong = waited.filter(entry => Number(entry.intensity) >= 4).map(entry => entry.secondsSurfed / 60);
  const mild = waited.filter(entry => Number(entry.intensity) <= 3).map(entry => entry.secondsSurfed / 60);

  const lastPlan = all.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .find(entry => entry.debrief?.next)?.debrief.next || '';

  return {
    total: all.length,
    tags,
    tagTotal: tags.reduce((sum, item) => sum + item[1], 0),
    topReason,
    topBand,
    waitedCount: waited.length,
    avgWait: waitMinutes.length ? Math.round(average(waitMinutes)) : 0,
    maxWait: waitMinutes.length ? Math.max(...waitMinutes) : 0,
    strongAvg: average(strong), mildAvg: average(mild),
    strongCount: strong.length, mildCount: mild.length,
    lastPlan
  };
}

function cravingsOn(dateFilter) { return state.cravings.filter(dateFilter); }
function recoveredTotal(entries = state.cravings) { return entries.reduce((sum, entry) => sum + Number(entry.recovered || 0), 0); }

function cravingStats() {
  const week = new Set(weekDates());
  const recent = cravingsOn(entry => week.has(entry.date));
  const acted = recent.filter(entry => entry.outcome !== 'used');
  const triggers = recent.reduce((map, entry) => ({ ...map, [entry.trigger]: (map[entry.trigger] || 0) + 1 }), {});
  const topTrigger = Object.entries(triggers).sort((a, b) => b[1] - a[1])[0];
  return {
    weekCount: recent.length,
    rodeCount: recent.filter(entry => entry.outcome === 'rode').length,
    rideRate: recent.length ? Math.round(acted.length / recent.length * 100) : 0,
    topTrigger: topTrigger ? topTrigger[0] : null,
    topTriggerCount: topTrigger ? topTrigger[1] : 0,
    recoveredMonth: recoveredTotal(cravingsOn(entry => monthKey(entry.date) === monthKey())),
    recoveredAll: recoveredTotal(),
    rodeAll: state.cravings.filter(entry => entry.outcome === 'rode').length
  };
}

function focusOnTasksFor(date = selectedDate) {
  return state.timeEntries.filter(entry => entry.type === 'focus' && entry.date === date && entry.task).reduce((sum, entry) => sum + Number(entry.minutes), 0);
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + index * 0.18;
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      oscillator.start(start);
      oscillator.stop(start + 0.52);
    });
    setTimeout(() => ctx.close?.(), 1500);
  } catch { /* audio unavailable */ }
}

function requestNotifyPermission() {
  try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
}

function notify(title, body) {
  try { if (window.Notification && Notification.permission === 'granted') new Notification(title, { body, icon: 'icon.svg' }); } catch { /* ignore */ }
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function splitIncome(amount) {
  const allocations = {};
  let allocated = 0;
  state.settings.envelopes.forEach((envelope, index) => {
    const allocation = index === state.settings.envelopes.length - 1 ? amount - allocated : Math.round(amount * Number(envelope.percent) / 100);
    allocations[envelope.id] = allocation;
    allocated += allocation;
  });
  return allocations;
}

function entriesForMonth(entries, dateKey = today()) {
  return entries.filter(entry => monthKey(entry.date) === monthKey(dateKey));
}

function envelopeMetrics(dateKey = today()) {
  const metrics = Object.fromEntries(state.settings.envelopes.map(envelope => [envelope.id, { funded: 0, spent: 0, balance: 0 }]));
  entriesForMonth(state.transactions, dateKey).forEach(entry => {
    if (entry.type === 'income') {
      Object.entries(entry.allocations || {}).forEach(([id, amount]) => {
        if (metrics[id]) { metrics[id].funded += Number(amount); metrics[id].balance += Number(amount); }
      });
    }
    if (entry.type === 'expense' && metrics[entry.envelopeId]) {
      metrics[entry.envelopeId].spent += Number(entry.amount);
      metrics[entry.envelopeId].balance -= Number(entry.amount);
    }
  });
  return metrics;
}

function totalIncome(dateKey = today()) {
  return entriesForMonth(state.transactions, dateKey).filter(entry => entry.type === 'income').reduce((sum, entry) => sum + Number(entry.amount), 0);
}

function debtPaidTotal() {
  return state.transactions.filter(entry => entry.type === 'expense' && entry.envelopeId === 'debt').reduce((sum, entry) => sum + Number(entry.amount), 0);
}

function timeTotals(dateFilter) {
  const totals = { stolen: 0, focus: 0 };
  state.timeEntries.filter(dateFilter).forEach(entry => { totals[entry.type] += Number(entry.minutes); });
  return totals;
}

function todayTimeTotals() { return timeTotals(entry => entry.date === today()); }
function weekDates() {
  const result = [];
  const current = new Date(`${today()}T12:00:00`);
  for (let i = 6; i >= 0; i--) { const date = new Date(current.getTime() - i * DAY_MS); result.push(date.toISOString().slice(0, 10)); }
  return result;
}
function weekTimeTotals() { const dates = new Set(weekDates()); return timeTotals(entry => dates.has(entry.date)); }

function renderHeader() {
  // #todayLabel and #scorecardDate follow the day cursor and are set by renderDay.
  $('#incomeDate').value ||= today();
  $('#expenseDate').value ||= today();
  $('#timeDate').value ||= today();
}

function resolvedTheme() {
  return themePreference === 'system' ? (prefersDark?.matches ? 'dark' : 'light') : themePreference;
}

function applyTheme() {
  const active = resolvedTheme();
  document.documentElement.dataset.theme = active;
  const button = $('#themeButton');
  button.textContent = active === 'dark' ? '☀' : '☾';
  const title = themePreference === 'system' ? 'Following device theme' : (active === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = title;
  button.setAttribute('aria-label', title);
  const select = $('#themeSelect');
  if (select) select.value = themePreference;
}

function setThemePreference(preference) {
  themePreference = preference;
  localStorage.setItem('kamal-theme', preference);
  applyTheme();
}

function renderRule() {
  const items = state.settings.envelopes.map(envelope => `<span class="rule-chip" style="border-color:${envelope.color}55"><b style="color:${envelope.color}">${envelope.percent}%</b>${escapeHtml(envelope.name)}</span>`).join('');
  $('#ruleStrip').innerHTML = items;
}

function renderEnvelopes(dateKey = today()) {
  const metrics = envelopeMetrics(dateKey);
  $('#moneyEnvelopes').innerHTML = state.settings.envelopes.map(envelope => {
    const metric = metrics[envelope.id];
    const target = Number(envelope.target || 0);
    const progress = target ? Math.min(100, Math.max(0, metric.balance / target * 100)) : 0;
    let caption = target ? `Goal: ${money(target)}` : `${money(metric.funded)} put in this month`;
    if (envelope.id === 'debt') caption = `${money(debtPaidTotal())} paid back, of ${money(state.settings.debtTotal)} owed`;
    return `<article class="envelope-card" style="--card-color:${envelope.color}">
      <div class="card-top"><span>${escapeHtml(envelope.name)}</span><span class="card-icon">${envelopeIcons[envelope.id] || '•'}</span></div>
      <strong>${money(metric.balance)}</strong><span class="card-caption">${caption}</span>
      <div class="progress-track"><div class="progress-fill" style="background:${envelope.color};width:${progress}%"></div></div>
      <span class="card-caption">${money(metric.spent)} spent from this box</span>
    </article>`;
  }).join('');
  $('#expenseEnvelope').innerHTML = state.settings.envelopes.map(envelope => `<option value="${envelope.id}">${escapeHtml(envelope.name)}</option>`).join('');
}

function renderDay() {
  const time = timeTotals(entry => entry.date === selectedDate);
  const ridden = state.cravings.filter(entry => entry.date === selectedDate && entry.outcome === 'rode').length;
  const focusTarget = state.settings.dailyFocusTarget || 0;
  const isToday = selectedDate === today();

  $('#dayTitle').textContent = dayTitleFor(selectedDate);
  $('#todayLabel').textContent = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#scorecardDate').textContent = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  $('#dayCursorLabel').textContent = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#dayNext').disabled = isToday;
  $('#dayToday').hidden = isToday;

  $('#focusToday').textContent = `${time.focus} min`;
  $('#focusDetail').textContent = focusTarget ? `Your goal is ${focusTarget} min a day` : (time.focus ? 'Good. That time was yours.' : 'Keep one good block of time.');
  $('#stolenToday').textContent = `${time.stolen} min`;
  $('#stolenDetail').textContent = time.stolen ? 'Now choose what to do next.' : 'Just notice it. No blame.';
  $('#urgesToday').textContent = ridden;
  $('#urgesDetail').textContent = ridden
    ? `You wanted ${substancePhrase()} and waited instead.`
    : `When you want ${substancePhrase()}, wait instead of fighting it.`;

  renderHabits();
  renderFocusGoal();

  const banner = $('#insightBanner');
  if (ridden) banner.textContent = `You waited ${ridden} ${ridden === 1 ? 'time' : 'times'} today. That is harder than a quiet day, and it counts more.`;
  else if (time.stolen > time.focus && time.stolen >= 30) banner.textContent = `Today you lost ${time.stolen - time.focus} more minutes than you used well. One 25-minute block is enough to turn it around.`;
  else if (!state.transactions.length && !state.timeEntries.length) banner.textContent = 'Start with one honest entry. Days are for small things, and one is enough to begin.';
  else banner.textContent = 'You are building proof, slowly. Small things that last beat quick wins.';
  banner.classList.add('show');
}

function monthSpentTotal(dateKey = today()) {
  return entriesForMonth(state.transactions, dateKey).filter(entry => entry.type === 'expense').reduce((sum, entry) => sum + Number(entry.amount), 0);
}

function renderMonth() {
  const anchor = firstOfMonth(selectedMonth);
  const income = totalIncome(anchor);
  const spent = monthSpentTotal(anchor);
  const debtPaid = debtPaidTotal();
  const kept = recoveredTotal(state.cravings.filter(entry => monthKey(entry.date) === selectedMonth));
  const bigMove = getMonthData(selectedMonth);
  const isThisMonth = selectedMonth === monthKey();

  $('#monthCursorLabel').textContent = new Date(`${anchor}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('#monthNext').disabled = isThisMonth;
  $('#monthThis').hidden = isThisMonth;
  $('#monthLabel').textContent = new Date(`${anchor}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('#monthIncome').textContent = money(income);
  $('#monthIncomeDetail').textContent = income ? `Split ${state.settings.envelopes.map(item => item.percent).join(' / ')} into your boxes.` : 'Add the money you really get.';
  $('#monthSpent').textContent = money(spent);
  $('#monthSpentDetail').textContent = income ? `${money(Math.max(0, income - spent))} of this month's money is left.` : 'From all your money boxes.';
  $('#debtPaid').textContent = money(debtPaid);
  $('#debtDetail').textContent = `${money(Math.max(0, state.settings.debtTotal - debtPaid))} still to pay, of ${money(state.settings.debtTotal)}`;
  $('#monthKept').textContent = money(kept);
  $('#monthKeptDetail').textContent = kept ? 'You kept this by waiting.' : 'From the times you waited.';

  $('#bigMoveInput').value = bigMove.bigMove || '';
  $('#bigMoveDone').checked = Boolean(bigMove.done);
  renderEnvelopes(anchor);
}

function inYear(date, year) { return String(date).slice(0, 4) === String(year); }

function yearTotals(year) {
  const focusMinutes = state.timeEntries.filter(entry => entry.type === 'focus' && inYear(entry.date, year)).reduce((sum, entry) => sum + Number(entry.minutes), 0);
  const ridden = state.cravings.filter(entry => entry.outcome === 'rode' && inYear(entry.date, year)).length;
  const kept = recoveredTotal(state.cravings.filter(entry => inYear(entry.date, year)));
  const debt = state.transactions.filter(entry => entry.type === 'expense' && entry.envelopeId === 'debt' && inYear(entry.date, year)).reduce((sum, entry) => sum + Number(entry.amount), 0);
  return { focusMinutes, ridden, kept, debt };
}

function renderYear() {
  const year = yearKey();
  const data = getYearData(year);
  const totals = yearTotals(year);

  $('#yearLabel').textContent = year;
  $('#yearTheme').value = data.theme || '';
  $('#yearNote').value = data.note || '';

  $('#yearStats').innerHTML = `
    <article class="metric-card"><span>Focus time</span><strong>${Math.round(totals.focusMinutes / 60)} h</strong><small>${totals.focusMinutes} minutes used well this year</small></article>
    <article class="metric-card"><span>Times you waited</span><strong>${totals.ridden}</strong><small>Each one was a time you did not give in.</small></article>
    <article class="metric-card"><span>Money saved</span><strong>${money(totals.kept)}</strong><small>Money you kept by waiting.</small></article>
    <article class="metric-card"><span>Debt paid</span><strong>${money(totals.debt)}</strong><small>Paid back this year.</small></article>`;

  const months = Array.from({ length: 12 }, (unused, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  const arc = months.map(key => ({
    key,
    label: new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short' }),
    focus: state.timeEntries.filter(entry => entry.type === 'focus' && monthKey(entry.date) === key).reduce((sum, entry) => sum + Number(entry.minutes), 0),
    ridden: state.cravings.filter(entry => entry.outcome === 'rode' && monthKey(entry.date) === key).length
  }));
  const max = Math.max(60, ...arc.map(item => item.focus));
  $('#yearArc').innerHTML = arc.map(item => {
    const height = item.focus / max * 100;
    const current = item.key === monthKey();
    return `<div class="arc-cell ${current ? 'current' : ''}" title="${item.label}: ${Math.round(item.focus / 60)} h of focus, waited ${item.ridden} times">
      <div class="arc-track"><div class="arc-fill" style="height:${height}%"></div></div>
      <b>${item.label.slice(0, 1)}</b><span>${item.focus ? `${Math.round(item.focus / 60)}h` : '·'}</span>
    </div>`;
  }).join('');

  const best = arc.slice().sort((a, b) => b.focus - a.focus)[0];
  $('#yearSuggestion').textContent = best && best.focus
    ? `Your best month so far is ${best.label}, with ${Math.round(best.focus / 60)} hours of focus. Small months are just information, not blame.`
    : 'The bars show hours of focus time. Small months are just information, not blame.';
}

function renderIncomePreview() {
  const amount = Number($('#incomeAmount').value || 0);
  const box = $('#splitPreview');
  if (!amount) { box.innerHTML = '<span>Type an amount to see how it splits.</span>'; return; }
  const splits = splitIncome(amount);
  box.innerHTML = state.settings.envelopes.map(envelope => `<div class="split-piece" style="background:${envelope.color}18;color:${envelope.color}">${escapeHtml(envelope.name)}<b>${money(splits[envelope.id])}</b></div>`).join('');
}

function renderTransactions() {
  const entries = (currentTransactionFilter === 'month' ? entriesForMonth(state.transactions, firstOfMonth(selectedMonth)) : state.transactions).slice().sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`));
  $('#clearMonthFilter').textContent = currentTransactionFilter === 'month' ? 'Show all' : 'This month';
  $('#transactionRows').innerHTML = entries.length ? entries.map(entry => {
    const isIncome = entry.type === 'income';
    const envelope = state.settings.envelopes.find(item => item.id === entry.envelopeId);
    const description = isIncome ? `<strong>${escapeHtml(entry.source)}</strong><br><small>${escapeHtml(entry.note || 'Money in')}</small>` : `<strong>${escapeHtml(entry.note)}</strong><br><small>${escapeHtml(envelope?.name || 'Money box removed')}</small>`;
    const allocation = isIncome ? Object.entries(entry.allocations || {}).map(([id, amount]) => `${state.settings.envelopes.find(item => item.id === id)?.percent || 0}% ${money(amount)}`).join(' · ') : escapeHtml(envelope?.name || '');
    return `<tr><td>${dateLabel(entry.date)}</td><td>${description}</td><td>${allocation}</td><td class="number ${isIncome ? 'positive' : 'negative'}">${isIncome ? '+' : '−'}${money(entry.amount)}</td><td class="row-actions"><button class="icon-action" data-edit-transaction="${entry.id}" title="Change this" aria-label="Change this">✎</button><button class="delete-button" data-delete-transaction="${entry.id}" title="Delete this" aria-label="Delete this">×</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-row">No money added yet.</td></tr>';
}

function categoriesFor(type) { return timeCategories[type].map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join(''); }
function updateTimeCategoryOptions() {
  $('#timerCategory').innerHTML = categoriesFor($('#timerType').value);
  $('#timeCategory').innerHTML = categoriesFor($('#timeType').value);
  updateTimerTaskVisibility();
}

function renderTime() {
  const daily = todayTimeTotals();
  const weekly = weekTimeTotals();
  $('#stolenTodayTime').textContent = `${daily.stolen} min`;
  $('#focusedTodayTime').textContent = `${daily.focus} min`;
  $('#stolenWeek').textContent = `${weekly.stolen} min this week`;
  $('#focusWeek').textContent = `${weekly.focus} min this week`;
  const seven = new Set(weekDates());
  const stolenEntries = state.timeEntries.filter(entry => entry.type === 'stolen' && seven.has(entry.date));
  const categories = stolenEntries.reduce((map, entry) => ({ ...map, [entry.category]: (map[entry.category] || 0) + Number(entry.minutes) }), {});
  const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  $('#biggestThief').textContent = top ? top[0] : '—';
  $('#biggestThiefDetail').textContent = top ? `${top[1]} minutes this week` : 'Add a few days to see the pattern.';
  renderWeeklyBars();
  $('#timeSuggestion').textContent = top ? `Most of your lost time goes to ${top[0].toLowerCase()}. Make the next focus block easier to start than that.` : 'Start with one entry. Being honest matters more than being perfect.';
  renderTimeRows();
  renderFocusGoal();
  renderTimer();
}

function renderWeeklyBars() {
  const dates = weekDates();
  const totals = dates.map(date => ({ date, ...timeTotals(entry => entry.date === date) }));
  const max = Math.max(60, ...totals.map(item => item.stolen + item.focus));
  $('#weeklyBars').innerHTML = totals.map(item => {
    const focusHeight = item.focus / max * 100;
    const stolenHeight = item.stolen / max * 100;
    const label = new Date(`${item.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
    return `<div class="day-bar"><div class="bar-stack" title="${dateLabel(item.date)}: ${item.focus} min focus / ${item.stolen} min drifted"><div class="bar-focus" style="height:${focusHeight}%"></div><div class="bar-stolen" style="height:${stolenHeight}%"></div></div><b>${label}</b><span>${item.focus + item.stolen}m</span></div>`;
  }).join('');
}

function renderTimeRows() {
  const entries = state.timeEntries.slice().sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`)).slice(0, 25);
  $('#timeRows').innerHTML = entries.length ? entries.map(entry => `<tr><td>${dateLabel(entry.date)}</td><td><strong class="${entry.type === 'focus' ? 'positive' : 'drifted'}">${timeTypeLabel[entry.type] || 'Saved'}</strong></td><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.note || '—')}${entry.task ? ` <span class="task-tag">${escapeHtml(entry.task)}</span>` : ''}</td><td class="number">${entry.minutes} min</td><td class="row-actions"><button class="icon-action" data-edit-time="${entry.id}" title="Change this" aria-label="Change this">✎</button><button class="delete-button" data-delete-time="${entry.id}" title="Delete this" aria-label="Delete this">×</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">No time added yet. Use the timer, or add your best guess.</td></tr>';
}

function updateTimerTaskOptions() {
  const select = $('#timerTask');
  if (!select) return;
  const current = select.value;
  const tasks = (getDayData(today()).tasks || []).filter(task => !task.done);
  select.innerHTML = `<option value="">Anything</option>` + tasks.map(task => `<option value="${task.id}">${escapeHtml(task.text)}</option>`).join('');
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function updateTimerTaskVisibility() {
  const wrap = $('#timerTaskWrap');
  if (wrap) wrap.hidden = $('#timerType').value !== 'focus';
}

function renderTimer() {
  const active = state.activeTimer;
  $$('#focusPresets .chip-button').forEach(button => { button.disabled = Boolean(active); });
  $('#stopTimerButton').disabled = !active;
  const display = $('#timerDisplay');
  const title = $('#timerTitle');
  if (!active) {
    title.textContent = 'Start focus time';
    display.textContent = '00:00:00';
    display.classList.remove('countdown', 'break');
    return;
  }
  const elapsed = (Date.now() - new Date(active.startedAt).getTime()) / 1000;
  if (active.mode === 'stopwatch') {
    title.textContent = active.type === 'focus' ? 'Focus time running' : 'Time running';
    display.classList.remove('countdown', 'break');
    display.textContent = formatClock(elapsed);
  } else {
    const remaining = active.targetMinutes * 60 - elapsed;
    title.textContent = active.mode === 'break' ? 'Resting — step away' : 'Counting down';
    display.classList.toggle('break', active.mode === 'break');
    display.classList.toggle('countdown', active.mode !== 'break');
    display.textContent = formatClock(remaining);
  }
}

function renderBody() {
  const surf = state.activeSurf;
  const stats = cravingStats();

  const want = substancePhrase();
  const mins = surfMinutes();
  $('#wantQuestion').textContent = `Do you want ${want} right now?`;
  $('#waitExplain').textContent = `A strong want lasts a few minutes, then it gets weaker on its own. This screen stays with you for ${mins} minutes so you do not have to fight it alone.`;
  $('#startSurfButton').textContent = `Wait ${mins} minutes until it passes`;
  $('#dayRescueButton').textContent = `I want ${want}`;
  $('#rescueButton').title = `I want ${want} — help me wait`;
  $('#rescueButton').setAttribute('aria-label', `I want ${want} — help me wait`);

  $('#cravingSubstance').innerHTML = state.settings.substances.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  if (!$('#cravingTrigger').options.length) $('#cravingTrigger').innerHTML = cravingTriggers.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');

  const debriefing = Boolean(pendingDebriefId);
  $('#bodyIdle').hidden = Boolean(surf) || debriefing;
  $('#bodySurf').hidden = !surf || debriefing;
  $('#bodyDebrief').hidden = !debriefing;
  if (debriefing) {
    const entry = state.cravings.find(item => item.id === pendingDebriefId);
    $('#debriefHeadline').textContent = debriefHeadline(entry?.outcome);
    // Rebuild the choices only for a new debrief, so taps are not wiped by a re-render.
    const chips = $('#helpChips');
    if (chips.dataset.for !== pendingDebriefId) {
      chips.dataset.for = pendingDebriefId;
      chips.innerHTML = helpOptions.map(option => `<button type="button" class="chip-button chip-toggle" data-help="${escapeHtml(option)}" aria-pressed="false">${escapeHtml(option)}</button>`).join('');
    }
  }

  const lastPlan = cravingInsights().lastPlan;
  $('#lastPlan').hidden = !lastPlan;
  if (lastPlan) $('#lastPlanText').textContent = lastPlan;

  if (surf) {
    const elapsed = (Date.now() - new Date(surf.startedAt).getTime()) / 1000;
    const remaining = Math.max(0, surf.targetSeconds - elapsed);
    const fraction = Math.min(1, elapsed / surf.targetSeconds);
    const passed = remaining <= 0;
    $('#surfDisplay').textContent = formatClock(remaining);
    $('#surfTitle').textContent = passed ? 'The time is up' : 'Waiting — it will pass';
    $('#surfContext').textContent = `${substanceById(surf.substanceId)?.name || 'Craving'} · ${surf.trigger}`;
    $('#surfScript').textContent = passed
      ? 'The time is up. Whatever happened, say it plainly. This list is for you, not against you.'
      : surfScript[Math.min(surfScript.length - 1, Math.floor(fraction * surfScript.length))];
    const x = 10 + fraction * 280;
    const y = 70 - 56 * Math.exp(-((x - 150) ** 2) / (2 * 45 ** 2));
    $('#surfDot').setAttribute('cx', x.toFixed(1));
    $('#surfDot').setAttribute('cy', y.toFixed(1));
    $('#surfCrest').textContent = fraction > 0.55 ? 'The hardest part is over.' : 'Getting stronger. It will not stay this way.';
  }

  $('#cravingStats').innerHTML = `
    <article class="metric-card"><span>Times you waited</span><strong>${stats.rodeAll}</strong><small>${stats.weekCount ? `${stats.rodeCount} of ${stats.weekCount} this week` : 'Add the next one, whatever happens.'}</small></article>
    <article class="metric-card"><span>Money saved</span><strong>${money(stats.recoveredAll)}</strong><small>${money(stats.recoveredMonth)} this month</small></article>
    <article class="metric-card"><span>Most common reason</span><strong>${stats.topTrigger ? escapeHtml(stats.topTrigger) : '—'}</strong><small>${stats.topTrigger ? `${stats.topTriggerCount} times this week` : 'Add a few and the pattern will show.'}</small></article>`;

  const entries = state.cravings.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 25);
  const outcomeLabel = { rode: 'Waited', less: 'Used less', used: 'Used' };
  $('#cravingRows').innerHTML = entries.length ? entries.map(entry => `<tr>
    <td>${dateLabel(entry.date)}</td>
    <td>${escapeHtml(entry.substance)}</td>
    <td>${escapeHtml(entry.trigger)}</td>
    <td><span class="outcome-chip ${entry.outcome}">${outcomeLabel[entry.outcome] || 'Saved'}</span></td>
    <td class="number">${Math.round((entry.secondsSurfed || 0) / 60)} min</td>
    <td class="row-actions"><button class="delete-button" data-delete-craving="${entry.id}" title="Delete this" aria-label="Delete this">×</button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty-row">Nothing here yet. The first honest note is the start.</td></tr>';

  const notes = state.cravings
    .filter(entry => entry.debrief && (entry.debrief.before || entry.debrief.gave || entry.debrief.next))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 6);
  $('#fieldNotes').innerHTML = notes.length ? notes.map(entry => {
    const rows = [
      entry.debrief.before && `<p><b>Just before:</b> ${escapeHtml(entry.debrief.before)}</p>`,
      entry.debrief.gave && `<p><b>It gave me:</b> ${escapeHtml(entry.debrief.gave)}</p>`,
      entry.debrief.next && `<p><b>Next move:</b> ${escapeHtml(entry.debrief.next)}</p>`
    ].filter(Boolean).join('');
    return `<article class="field-note"><span class="field-note-date">${dateLabel(entry.date)}</span><div>${rows}</div></article>`;
  }).join('') : '<p class="small-note">Notes you write after a hard moment show up here. After a while they show you what it really helps with.</p>';

  renderHelpPanel();
  renderFindings();
}

function renderHelpPanel() {
  const insights = cravingInsights();
  const headline = $('#helpHeadline');
  const breakdown = $('#helpBreakdown');

  if (!insights.tags.length) {
    headline.textContent = 'Nothing here yet.';
    breakdown.innerHTML = '<p class="small-note">Next time you use, tap what it helped with. After a few times this will show you what it is really for — and that is the thing you can start meeting another way.</p>';
    return;
  }

  const [topTag, topCount] = insights.tags[0];
  headline.textContent = `Most of all, it helps you ${topTag.toLowerCase()}.`;
  const max = insights.tags[0][1];
  breakdown.innerHTML = insights.tags.map(([tag, count]) => `<div class="bar-row">
    <span class="bar-label">${escapeHtml(tag)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${Math.round(count / max * 100)}%"></span></span>
    <span class="bar-count">${count}</span>
  </div>`).join('')
    + `<p class="small-note">You reached for it ${topCount} ${topCount === 1 ? 'time' : 'times'} to ${topTag.toLowerCase()}. If you can find another way to ${topTag.toLowerCase()}, the want gets weaker on its own.</p>`;
}

function renderFindings() {
  const insights = cravingInsights();
  const findings = [];

  if (insights.topReason) {
    findings.push(`It starts with <b>${escapeHtml(insights.topReason[0].toLowerCase())}</b> more than anything else — ${insights.topReason[1]} ${insights.topReason[1] === 1 ? 'time' : 'times'} so far.`);
  }
  if (insights.topBand && insights.total >= 3) {
    findings.push(`It happens most often <b>${insights.topBand[0]}</b>.`);
  }
  if (insights.waitedCount >= 2) {
    findings.push(`When you waited, you usually needed about <b>${insights.avgWait} ${insights.avgWait === 1 ? 'minute' : 'minutes'}</b>. The longest was ${insights.maxWait}.`);
  }
  if (insights.strongCount >= 2 && insights.mildCount >= 2) {
    const strong = insights.strongAvg;
    const mild = insights.mildAvg;
    const close = Math.abs(strong - mild) < 1.5;
    findings.push(close
      ? `A <b>strong</b> want took about ${strong.toFixed(1)} min to pass, a mild one about ${mild.toFixed(1)} min. Strong or mild, it passes in about the same time — so a strong one is not more dangerous, it just feels louder.`
      : `A <b>strong</b> want took about ${strong.toFixed(1)} min, a mild one about ${mild.toFixed(1)} min.`);
  }

  const box = $('#cravingFindings');
  if (!findings.length) {
    box.innerHTML = '<p class="small-note">Add a few, including the times you used. Once there are three or four, real patterns show up here: what sets it off, what time of day, and how long you actually need to wait.</p>';
    return;
  }
  box.innerHTML = findings.map(text => `<p class="finding">${text}</p>`).join('');
}

function renderHabits() {
  const day = getDayData(selectedDate);
  const habits = state.settings.habits;
  $('#habitList').innerHTML = habits.length ? habits.map(habit => `<label class="habit-item ${day.habits[habit.id] ? 'done' : ''}"><input type="checkbox" data-habit="${habit.id}" ${day.habits[habit.id] ? 'checked' : ''}><span class="habit-text"><strong>${escapeHtml(habit.title)}</strong><small>${escapeHtml(habit.detail)}</small></span><span>${day.habits[habit.id] ? '✓' : ''}</span></label>`).join('') : '<p class="small-note">Nothing here yet. Add a few in Settings.</p>';
  $('#priorityInput').value = day.priority || '';
  $('#dailyReflection').value = day.reflection || '';
  renderTasks();
  renderStreaks();
}

function taskListHTML(tasks) {
  if (!tasks.length) return '<p class="small-note">Nothing here yet. Add up to three things for today.</p>';
  return tasks.map(task => `<div class="task-item ${task.done ? 'done' : ''}">
    <label><input type="checkbox" data-task-toggle="${task.id}" ${task.done ? 'checked' : ''}><span>${escapeHtml(task.text)}</span></label>
    ${task.rolled ? '<span class="rolled-tag" title="Moved here from an earlier day">from before</span>' : ''}
    <button type="button" class="delete-button" data-task-delete="${task.id}" title="Remove this" aria-label="Remove this">×</button>
  </div>`).join('');
}

function renderTasks() {
  const tasks = getDayData(selectedDate).tasks || [];
  const html = taskListHTML(tasks);
  const done = tasks.filter(task => task.done).length;
  $$('[data-task-list]').forEach(container => { container.innerHTML = html; });
  $$('[data-task-count]').forEach(node => { node.textContent = tasks.length ? `${done}/${tasks.length} done` : ''; });
  const full = tasks.length >= MAX_TASKS;
  $$('[data-task-input]').forEach(input => { input.disabled = full; input.placeholder = full ? 'Three tasks is the limit for today' : 'Add a task that matters (max 3)'; });
}

function focusRingHTML(current, target) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(100, current / target * 100) : 0;
  const offset = circumference * (1 - pct / 100);
  const reached = target > 0 && current >= target;
  return `<div class="focus-ring ${reached ? 'reached' : ''}">
    <svg viewBox="0 0 80 80" aria-hidden="true">
      <circle class="ring-bg" cx="40" cy="40" r="${radius}"></circle>
      <circle class="ring-fg" cx="40" cy="40" r="${radius}" style="stroke-dasharray:${circumference.toFixed(1)};stroke-dashoffset:${offset.toFixed(1)}"></circle>
    </svg>
    <div class="ring-label"><strong>${current}</strong><span>/ ${target || '—'} min</span></div>
  </div>`;
}

function renderFocusGoal() {
  const focusMinutes = timeTotals(entry => entry.date === selectedDate).focus;
  const target = state.settings.dailyFocusTarget || 0;
  const onTasks = focusOnTasksFor(selectedDate);
  const ring = focusRingHTML(focusMinutes, target);
  const pct = target > 0 ? Math.round(Math.min(100, focusMinutes / target * 100)) : 0;
  const when = selectedDate === today() ? 'today' : 'that day';
  let caption;
  if (!target) caption = 'Set a daily focus goal in Settings.';
  else if (focusMinutes >= target) caption = `Goal done — ${focusMinutes} min of focus ${when}.`;
  else caption = `${pct}% of your ${target} min goal ${when}.`;
  if (onTasks > 0) caption += ` ${onTasks} min went to your list.`;
  $$('[data-focus-ring]').forEach(node => { node.innerHTML = ring; });
  $$('[data-focus-caption]').forEach(node => { node.textContent = caption; });
}

function lastDates(count) {
  const result = [];
  const current = new Date(`${today()}T12:00:00`);
  for (let i = 0; i < count; i++) result.push(new Date(current.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  return result;
}

/* Rolling completion instead of a consecutive streak. A streak that resets to zero
   turns one missed day into a reason to quit; a rate treats it as one data point. */
function completionFor(habitId) {
  const week = lastDates(7).filter(date => state.days[date]?.habits?.[habitId]).length;
  const month = lastDates(30).filter(date => state.days[date]?.habits?.[habitId]).length;
  return { week, month, monthPct: Math.round(month / 30 * 100) };
}

function renderStreaks() {
  const habits = state.settings.habits;
  $('#streakCards').innerHTML = habits.map(habit => {
    const rate = completionFor(habit.id);
    return `<article class="streak-card" title="${escapeHtml(habit.title)}"><strong>${rate.week}<em>/7</em></strong><span>days this week · ${escapeHtml(habit.title)}</span><small>${rate.monthPct}% of the last 30 days</small></article>`;
  }).join('');
  $('#weekChecks').innerHTML = weekDates().map(date => {
    const checked = habits.filter(habit => state.days[date]?.habits?.[habit.id]).length;
    const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
    const classes = [
      'week-day',
      habits.length && checked === habits.length ? 'complete' : '',
      date === today() ? 'today' : '',
      date === selectedDate ? 'selected' : ''
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-goto-day="${date}" aria-pressed="${date === selectedDate}" title="Open ${dayTitleFor(date)}"><b>${label}</b><span>${checked}/${habits.length}</span></button>`;
  }).join('');
}

function renderSettings() {
  $('#envelopeSettings').innerHTML = state.settings.envelopes.map(envelope => `<div class="settings-row envelope-settings-row">
    <label><span class="row-swatch" style="background:${envelope.color}"></span>Name<input data-name="${envelope.id}" maxlength="40" value="${escapeHtml(envelope.name)}"></label>
    <label>%<input data-percent="${envelope.id}" type="number" min="0" max="100" step="1" value="${envelope.percent}"></label>
    <label>Goal<input data-target="${envelope.id}" type="number" min="0" step="1" value="${envelope.target}"></label>
    <button class="delete-button" type="button" data-remove-envelope="${envelope.id}" title="Remove this money box" aria-label="Remove ${escapeHtml(envelope.name)}">×</button>
  </div>`).join('');
  $('#habitSettings').innerHTML = state.settings.habits.map(habit => `<div class="settings-row habit-settings-row">
    <label>What is it?<input data-habit-title="${habit.id}" maxlength="60" value="${escapeHtml(habit.title)}"></label>
    <label>A few more words <span class="optional">you can skip this</span><input data-habit-detail="${habit.id}" maxlength="120" value="${escapeHtml(habit.detail || '')}"></label>
    <button class="delete-button" type="button" data-remove-habit="${habit.id}" title="Remove this" aria-label="Remove ${escapeHtml(habit.title)}">×</button>
  </div>`).join('') || '<p class="small-note">Nothing here yet. Add one below.</p>';
  $('#substanceSettings').innerHTML = state.settings.substances.map(substance => `<div class="settings-row habit-settings-row">
    <label>What is it?<input data-substance-name="${substance.id}" maxlength="40" value="${escapeHtml(substance.name)}"></label>
    <label>Price each time (MAD)<input data-substance-cost="${substance.id}" type="number" min="0" step="1" value="${Number(substance.costPerUse || 0)}"></label>
    <button class="delete-button" type="button" data-remove-substance="${substance.id}" title="Remove" aria-label="Remove ${escapeHtml(substance.name)}">×</button>
  </div>`).join('') || '<p class="small-note">Nothing tracked yet. Add one below.</p>';
  $('#debtTotalInput').value = state.settings.debtTotal;
  $('#focusTargetInput').value = state.settings.dailyFocusTarget;
  $('#storageNote').textContent = state.updatedAt ? `Saved on this phone: ${new Date(state.updatedAt).toLocaleString()}` : 'No backup file saved yet.';
  applyTheme();
}

function renderAll() {
  renderHeader();
  renderRule();
  renderDay();
  renderMonth();
  renderYear();
  renderIncomePreview();
  renderTransactions();
  updateTimeCategoryOptions();
  updateTimerTaskOptions();
  renderTime();
  renderBody();
  renderSettings();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
}

function addIncome(event) {
  event.preventDefault();
  const amount = Math.round(Number($('#incomeAmount').value));
  if (!amount || amount < 1) return;
  const fields = { amount, date: $('#incomeDate').value, source: $('#incomeSource').value.trim(), note: $('#incomeNote').value.trim(), allocations: splitIncome(amount) };
  if (editingIncomeId) {
    const entry = state.transactions.find(item => item.id === editingIncomeId);
    if (entry) Object.assign(entry, fields);
  } else {
    state.transactions.push({ id: makeId(), type: 'income', ...fields, createdAt: new Date().toISOString() });
  }
  const wasEditing = Boolean(editingIncomeId);
  saveState();
  cancelIncomeEdit();
  renderAll();
  toast(wasEditing ? 'Money updated and split again.' : `${money(amount)} split into your money boxes.`);
}

function addExpense(event) {
  event.preventDefault();
  const amount = Math.round(Number($('#expenseAmount').value));
  if (!amount || amount < 1) return;
  const envelopeId = $('#expenseEnvelope').value;
  const fields = { amount, date: $('#expenseDate').value, envelopeId, note: $('#expenseNote').value.trim() };
  if (editingExpenseId) {
    const entry = state.transactions.find(item => item.id === editingExpenseId);
    if (entry) Object.assign(entry, fields);
  } else {
    state.transactions.push({ id: makeId(), type: 'expense', ...fields, createdAt: new Date().toISOString() });
  }
  const wasEditing = Boolean(editingExpenseId);
  saveState();
  cancelExpenseEdit();
  renderAll();
  const envelope = state.settings.envelopes.find(item => item.id === envelopeId);
  toast(wasEditing ? 'Money updated.' : `${money(amount)} taken from ${envelope?.name || 'your money box'}.`);
}

function addTimeEntry(event) {
  event.preventDefault();
  const minutes = Math.round(Number($('#timeMinutes').value));
  if (!minutes || minutes < 1) return;
  const fields = { type: $('#timeType').value, category: $('#timeCategory').value, minutes, date: $('#timeDate').value, note: $('#timeNote').value.trim() };
  if (editingTimeId) {
    const entry = state.timeEntries.find(item => item.id === editingTimeId);
    if (entry) Object.assign(entry, fields);
  } else {
    state.timeEntries.push({ id: makeId(), ...fields, createdAt: new Date().toISOString() });
  }
  const wasEditing = Boolean(editingTimeId);
  saveState();
  cancelTimeEdit();
  renderAll();
  toast(wasEditing ? 'Time updated.' : `${minutes} minutes saved. This is information, not blame.`);
}

function editTransaction(id) {
  const entry = state.transactions.find(item => item.id === id);
  if (!entry) return;
  selectTab('money');
  if (entry.type === 'income') {
    cancelExpenseEdit();
    editingIncomeId = id;
    $('#incomeAmount').value = entry.amount;
    $('#incomeDate').value = entry.date;
    $('#incomeSource').value = entry.source || '';
    $('#incomeNote').value = entry.note || '';
    renderIncomePreview();
    setFormEditing('#incomeForm', true, 'Save the change');
    $('#incomeAmount').focus();
  } else {
    cancelIncomeEdit();
    editingExpenseId = id;
    $('#expenseAmount').value = entry.amount;
    $('#expenseDate').value = entry.date;
    $('#expenseEnvelope').value = entry.envelopeId;
    $('#expenseNote').value = entry.note || '';
    setFormEditing('#expenseForm', true, 'Save the change');
    $('#expenseAmount').focus();
  }
}

function editTimeEntry(id) {
  const entry = state.timeEntries.find(item => item.id === id);
  if (!entry) return;
  selectTab('time');
  editingTimeId = id;
  $('#timeType').value = entry.type;
  updateTimeCategoryOptions();
  $('#timeCategory').value = entry.category;
  $('#timeMinutes').value = entry.minutes;
  $('#timeDate').value = entry.date;
  $('#timeNote').value = entry.note || '';
  setFormEditing('#timeForm', true, 'Save the change');
  $('#timeMinutes').focus();
}

function setFormEditing(formSelector, editing, submitLabel) {
  const form = $(formSelector);
  form.classList.toggle('is-editing', editing);
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = submitLabel;
  const cancel = form.querySelector('.cancel-edit');
  if (cancel) cancel.hidden = !editing;
}

function cancelIncomeEdit() {
  editingIncomeId = null;
  $('#incomeForm').reset();
  $('#incomeDate').value = today();
  renderIncomePreview();
  setFormEditing('#incomeForm', false, 'Split into money boxes');
}

function cancelExpenseEdit() {
  editingExpenseId = null;
  $('#expenseForm').reset();
  $('#expenseDate').value = today();
  setFormEditing('#expenseForm', false, 'Save it');
}

function cancelTimeEdit() {
  editingTimeId = null;
  $('#timeForm').reset();
  $('#timeDate').value = today();
  setFormEditing('#timeForm', false, 'Save it');
}

function beginTimer(mode, targetMinutes = 0) {
  if (state.activeTimer) return;
  if (mode !== 'break') requestNotifyPermission();
  const type = mode === 'break' ? 'break' : $('#timerType').value;
  const taskSelect = $('#timerTask');
  const isFocus = type === 'focus';
  state.activeTimer = {
    mode,
    type,
    category: mode === 'break' ? '' : $('#timerCategory').value,
    note: mode === 'break' ? '' : $('#timerNote').value.trim(),
    taskId: isFocus && taskSelect ? taskSelect.value : '',
    taskText: isFocus && taskSelect && taskSelect.value ? taskSelect.options[taskSelect.selectedIndex].text : '',
    targetMinutes,
    startedAt: new Date().toISOString()
  };
  saveState();
  renderTimer();
  if (mode === 'break') toast(`Rest for ${targetMinutes} minutes. Really rest.`);
  else if (mode === 'countdown') toast(`${targetMinutes} minutes started. Stay with it.`);
  else toast('Timer started. Stop it when you are done.');
}

function finishActiveTimer(auto) {
  const active = state.activeTimer;
  if (!active) return;
  state.activeTimer = null;
  if (active.mode === 'break') {
    saveState();
    renderAll();
    if (auto) { playChime(); notify('Break over', 'Back to it — start your next focus block.'); }
    toast(auto ? 'Rest is over. Start the next block.' : 'Rest stopped.');
    return;
  }
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60000));
  const minutes = active.mode === 'countdown' && auto ? active.targetMinutes : elapsedMinutes;
  state.timeEntries.push({ id: makeId(), type: active.type, category: active.category, note: active.note, minutes, date: today(), taskId: active.taskId || '', task: active.taskText || '', createdAt: new Date().toISOString() });
  saveState();
  renderAll();
  if (auto) {
    playChime();
    notify(active.type === 'focus' ? 'Focus session complete' : 'Timer complete', `${minutes} minutes logged${active.taskText ? ` · ${active.taskText}` : ''}.`);
  }
  toast(active.type === 'focus' ? `${minutes} minutes of focus. Well done.` : `${minutes} minutes saved. No blame.`);
}

let surfNotified = false;

function tickTimer() {
  const surf = state.activeSurf;
  if (surf) {
    const remaining = surf.targetSeconds - (Date.now() - new Date(surf.startedAt).getTime()) / 1000;
    if (remaining <= 0 && !surfNotified) {
      surfNotified = true;
      playChime();
      notify('The wave passed', 'However it went, log it. That is the useful part.');
    }
    renderBody();
  }
  const active = state.activeTimer;
  if (active && active.mode !== 'stopwatch') {
    const remaining = active.targetMinutes * 60 - (Date.now() - new Date(active.startedAt).getTime()) / 1000;
    if (remaining <= 0) { finishActiveTimer(true); return; }
  }
  renderTimer();
}

function updateHabit(habitId, completed) {
  getDayData(selectedDate).habits[habitId] = completed;
  saveState();
  renderHabits();
}

function saveDayText(field, value) {
  getDayData(selectedDate)[field] = value;
  saveState();
}

function readEnvelopeInputs() {
  return state.settings.envelopes.map(envelope => ({
    ...envelope,
    name: ($(`[data-name="${envelope.id}"]`)?.value.trim()) || envelope.name,
    percent: Number($(`[data-percent="${envelope.id}"]`)?.value ?? envelope.percent),
    target: Number($(`[data-target="${envelope.id}"]`)?.value ?? envelope.target)
  }));
}

function readHabitInputs() {
  return state.settings.habits.map(habit => ({
    ...habit,
    title: ($(`[data-habit-title="${habit.id}"]`)?.value.trim()) || habit.title,
    detail: ($(`[data-habit-detail="${habit.id}"]`)?.value.trim()) ?? habit.detail
  }));
}

function readSubstanceInputs() {
  return state.settings.substances.map(substance => ({
    ...substance,
    name: ($(`[data-substance-name="${substance.id}"]`)?.value.trim()) || substance.name,
    costPerUse: Math.max(0, Number($(`[data-substance-cost="${substance.id}"]`)?.value ?? substance.costPerUse))
  }));
}

function addSubstance() {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs();
  state.settings.substances = readSubstanceInputs();
  state.settings.substances.push({ id: makeId(), name: 'Something else', costPerUse: 0 });
  renderSettings();
  toast('Added. Give it a name and a price, then press Save.');
}

function removeSubstance(id) {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs();
  state.settings.substances = readSubstanceInputs().filter(substance => substance.id !== id);
  renderSettings();
  toast('Removed. Press Save to keep this.');
}

function saveSettings(event) {
  event.preventDefault();
  const envelopes = readEnvelopeInputs();
  if (!envelopes.length) { toast('You need at least one money box.'); return; }
  const total = envelopes.reduce((sum, envelope) => sum + envelope.percent, 0);
  if (total !== 100) { toast(`Your boxes add up to ${total}%. They must add up to 100%.`); return; }
  if (envelopes.some(envelope => envelope.percent < 0 || envelope.target < 0)) { toast('Numbers cannot be below zero.'); return; }
  state.settings.envelopes = envelopes;
  state.settings.habits = readHabitInputs().filter(habit => habit.title);
  state.settings.substances = readSubstanceInputs().filter(substance => substance.name);
  state.settings.debtTotal = Math.max(0, Math.round(Number($('#debtTotalInput').value || 0)));
  state.settings.dailyFocusTarget = Math.max(0, Math.round(Number($('#focusTargetInput').value || 0)));
  saveState();
  renderAll();
  toast('Settings saved.');
}

function addEnvelope() {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs();
  const color = envelopePalette[state.settings.envelopes.length % envelopePalette.length];
  state.settings.envelopes.push({ id: makeId(), name: 'New envelope', percent: 0, target: 0, color });
  renderSettings();
  toast('Money box added. Give it a number, then press Save.');
}

function removeEnvelope(id) {
  state.settings.envelopes = readEnvelopeInputs().filter(envelope => envelope.id !== id);
  state.settings.habits = readHabitInputs();
  renderSettings();
  toast('Money box removed. Make the numbers add up to 100, then press Save.');
}

function addHabit() {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs();
  state.settings.habits.push({ id: makeId(), title: 'New daily action', detail: '' });
  renderSettings();
  toast('Added. Give it a name, then press Save.');
}

function removeHabit(id) {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs().filter(habit => habit.id !== id);
  renderSettings();
  toast('Removed. Press Save to keep this.');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kamal-control-center-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Backup file saved. Keep it somewhere safe.');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const nextState = JSON.parse(await file.text());
    if (!nextState?.settings || !Array.isArray(nextState.transactions)) throw new Error('Invalid backup');
    state = nextState;
    normalizeSettings(state.settings);
    state.timeEntries ||= []; state.cravings ||= []; state.days ||= {}; state.months ||= {}; state.years ||= {}; state.activeTimer ||= null; state.activeSurf ||= null;
    saveState(); renderAll(); toast('Backup loaded.');
  } catch { toast('This file is not an Up Again backup.'); }
  event.target.value = '';
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter(entry => entry.id !== id);
  if (editingIncomeId === id) cancelIncomeEdit();
  if (editingExpenseId === id) cancelExpenseEdit();
  saveState(); renderAll(); toast('Deleted.');
}
function deleteTime(id) {
  state.timeEntries = state.timeEntries.filter(entry => entry.id !== id);
  if (editingTimeId === id) cancelTimeEdit();
  saveState(); renderAll(); toast('Deleted.');
}
function deleteCraving(id) {
  state.cravings = state.cravings.filter(entry => entry.id !== id);
  saveState(); renderAll(); toast('Entry deleted.');
}

function selectTab(tab) {
  $$('.page').forEach(page => page.classList.toggle('active', page.id === tab));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.tab === tab));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function registerEvents() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  $$('[data-open-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.openTab)));
  $('#incomeForm').addEventListener('submit', addIncome);
  $('#expenseForm').addEventListener('submit', addExpense);
  $('#timeForm').addEventListener('submit', addTimeEntry);
  $('#incomeAmount').addEventListener('input', renderIncomePreview);
  $('#timerType').addEventListener('change', updateTimeCategoryOptions);
  $('#timeType').addEventListener('change', updateTimeCategoryOptions);
  $('#focusPresets').addEventListener('click', event => {
    const button = event.target.closest('.chip-button');
    if (!button || button.disabled) return;
    if (button.dataset.focusMinutes) beginTimer('countdown', Number(button.dataset.focusMinutes));
    else if (button.dataset.breakMinutes) beginTimer('break', Number(button.dataset.breakMinutes));
    else if (button.id === 'startOpenTimer') beginTimer('stopwatch');
  });
  $('#stopTimerButton').addEventListener('click', () => finishActiveTimer(false));
  $('#dayTaskForm').addEventListener('submit', event => { event.preventDefault(); addTask($('#dayTaskInput').value); $('#dayTaskInput').value = ''; });
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#exportButton').addEventListener('click', exportData);
  $('#quickBackupButton').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', importData);
  $('#clearMonthFilter').addEventListener('click', () => { currentTransactionFilter = currentTransactionFilter === 'month' ? 'all' : 'month'; renderTransactions(); });
  $('#resetButton').addEventListener('click', () => {
    if (!confirm('This deletes all your money, time, waiting and daily notes. Save a backup file first. Are you sure?')) return;
    state = defaultState(); saveState(); renderAll(); toast('Everything deleted.');
  });
  $('#addEnvelopeButton').addEventListener('click', addEnvelope);
  $('#addHabitButton').addEventListener('click', addHabit);
  $('#addSubstanceButton').addEventListener('click', addSubstance);
  $('#startSurfButton').addEventListener('click', beginSurf);
  $('#cancelSurfButton').addEventListener('click', cancelSurf);
  $('#saveDebriefButton').addEventListener('click', saveDebrief);
  $('#skipDebriefButton').addEventListener('click', skipDebrief);
  $('#surfOutcomes').addEventListener('click', event => {
    const button = event.target.closest('[data-outcome]');
    if (button) logCraving(button.dataset.outcome);
  });
  $('#themeSelect').addEventListener('change', event => setThemePreference(event.target.value));
  $('#cancelIncomeEdit').addEventListener('click', cancelIncomeEdit);
  $('#cancelExpenseEdit').addEventListener('click', cancelExpenseEdit);
  $('#cancelTimeEdit').addEventListener('click', cancelTimeEdit);
  document.addEventListener('change', event => {
    if (event.target.matches('[data-habit]')) updateHabit(event.target.dataset.habit, event.target.checked);
    if (event.target.matches('[data-task-toggle]')) toggleTask(event.target.dataset.taskToggle, event.target.checked);
  });
  $('#priorityInput').addEventListener('input', event => saveDayText('priority', event.target.value));
  $('#dailyReflection').addEventListener('input', event => saveDayText('reflection', event.target.value));
  $('#rescueButton').addEventListener('click', () => selectTab('body'));
  $('#bigMoveInput').addEventListener('input', event => { getMonthData(selectedMonth).bigMove = event.target.value; saveState(); });
  $('#bigMoveDone').addEventListener('change', event => {
    getMonthData(selectedMonth).done = event.target.checked;
    saveState();
    if (event.target.checked) toast('Done. That one counts.');
  });
  $('#dayPrev').addEventListener('click', () => setSelectedDate(shiftDate(selectedDate, -1)));
  $('#dayNext').addEventListener('click', () => setSelectedDate(shiftDate(selectedDate, 1)));
  $('#dayToday').addEventListener('click', () => setSelectedDate(today()));
  $('#monthPrev').addEventListener('click', () => setSelectedMonth(shiftMonth(selectedMonth, -1)));
  $('#monthNext').addEventListener('click', () => setSelectedMonth(shiftMonth(selectedMonth, 1)));
  $('#monthThis').addEventListener('click', () => setSelectedMonth(monthKey()));
  $('#yearTheme').addEventListener('input', event => { getYearData().theme = event.target.value; saveState(); });
  $('#yearNote').addEventListener('input', event => { getYearData().note = event.target.value; saveState(); });
  document.addEventListener('click', event => {
    const transactionButton = event.target.closest('[data-delete-transaction]');
    const timeButton = event.target.closest('[data-delete-time]');
    const editTransactionButton = event.target.closest('[data-edit-transaction]');
    const editTimeButton = event.target.closest('[data-edit-time]');
    const removeEnvelopeButton = event.target.closest('[data-remove-envelope]');
    const removeHabitButton = event.target.closest('[data-remove-habit]');
    const taskDeleteButton = event.target.closest('[data-task-delete]');
    const removeSubstanceButton = event.target.closest('[data-remove-substance]');
    const deleteCravingButton = event.target.closest('[data-delete-craving]');
    const gotoDayButton = event.target.closest('[data-goto-day]');
    if (gotoDayButton) { selectTab('day'); setSelectedDate(gotoDayButton.dataset.gotoDay); }
    const helpChip = event.target.closest('[data-help]');
    if (helpChip) {
      const on = helpChip.classList.toggle('on');
      helpChip.setAttribute('aria-pressed', String(on));
    }
    if (removeSubstanceButton) removeSubstance(removeSubstanceButton.dataset.removeSubstance);
    if (deleteCravingButton) deleteCraving(deleteCravingButton.dataset.deleteCraving);
    if (transactionButton) deleteTransaction(transactionButton.dataset.deleteTransaction);
    if (timeButton) deleteTime(timeButton.dataset.deleteTime);
    if (editTransactionButton) editTransaction(editTransactionButton.dataset.editTransaction);
    if (editTimeButton) editTimeEntry(editTimeButton.dataset.editTime);
    if (removeEnvelopeButton) removeEnvelope(removeEnvelopeButton.dataset.removeEnvelope);
    if (removeHabitButton) removeHabit(removeHabitButton.dataset.removeHabit);
    if (taskDeleteButton) deleteTask(taskDeleteButton.dataset.taskDelete);
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('#installButton').hidden = false; });
  $('#installButton').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('#installButton').hidden = true; });
  $('#themeButton').addEventListener('click', () => setThemePreference(resolvedTheme() === 'dark' ? 'light' : 'dark'));
  prefersDark?.addEventListener?.('change', () => { if (themePreference === 'system') applyTheme(); });
}

function registerPWA() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

selectedDate = today();
selectedMonth = monthKey();
registerEvents();
applyTheme();
rolloverTasks();
renderAll();
updateTimerTaskVisibility();
renderTimer();
setInterval(tickTimer, 1000);
registerPWA();

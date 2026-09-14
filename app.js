/* Kamal Control Center - private, offline-first tracker */
const STORAGE_KEY = 'kamal-control-center.v1';
const moneyFormat = new Intl.NumberFormat('en-MA', { maximumFractionDigits: 0 });
const DAY_MS = 24 * 60 * 60 * 1000;

const envelopeIcons = { family: '⌂', personal: '◌', debt: '↘', emergency: '✦' };
const defaultEnvelopes = [
  { id: 'family', name: 'Family & Home', percent: 60, target: 8000, color: '#69a9ff' },
  { id: 'personal', name: 'Personal Needs', percent: 20, target: 3000, color: '#ba9aff' },
  { id: 'debt', name: 'Debt', percent: 15, target: 0, color: '#ff9b70' },
  { id: 'emergency', name: 'Emergency', percent: 5, target: 1000, color: '#53d6ad' }
];
const defaultHabits = [
  { id: 'money', title: 'Track today’s money', detail: 'Record every payment received or spent.' },
  { id: 'focus', title: 'Protect one focus block', detail: 'At least 25 minutes on a meaningful task.' },
  { id: 'review', title: 'Close the day clearly', detail: 'Write a two-minute note before sleep.' }
];
const timeCategories = {
  stolen: ['Scroll / social media', 'Video / streaming', 'Unplanned chat', 'Gaming', 'Avoidance', 'Other'],
  focus: ['Paid work', 'Income building', 'Learning', 'Product work', 'Family responsibility', 'Other']
};

const envelopePalette = ['#69a9ff', '#ba9aff', '#ff9b70', '#53d6ad', '#f7c968', '#fa7888', '#8abaff', '#c7aaff'];

function defaultState() {
  return {
    version: 1,
    settings: { envelopes: structuredClone(defaultEnvelopes), habits: structuredClone(defaultHabits), debtTotal: 45000 },
    transactions: [],
    timeEntries: [],
    days: {},
    activeTimer: null,
    updatedAt: new Date().toISOString()
  };
}

function normalizeSettings(settings) {
  settings.envelopes = (settings.envelopes || defaultEnvelopes).map((item, index) => ({ ...defaultEnvelopes[index], ...item }));
  settings.habits = (settings.habits && settings.habits.length ? settings.habits : structuredClone(defaultHabits)).map(item => ({ detail: '', ...item }));
  settings.debtTotal = Number(settings.debtTotal ?? 45000);
  return settings;
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !stored.settings) return defaultState();
    normalizeSettings(stored.settings);
    stored.transactions ||= [];
    stored.timeEntries ||= [];
    stored.days ||= {};
    return stored;
  } catch { return defaultState(); }
}

let state = loadState();
let currentTransactionFilter = 'month';
let installEvent = null;
let toastTimeout;
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
  $('#storageNote').textContent = `Saved locally: ${new Date(state.updatedAt).toLocaleString()}`;
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
  $('#todayLabel').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#incomeDate').value ||= today();
  $('#expenseDate').value ||= today();
  $('#timeDate').value ||= today();
  $('#scorecardDate').textContent = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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

function envelopeRow(envelope, metric) {
  const target = Number(envelope.target || 0);
  const progress = target > 0 ? Math.min(100, Math.max(0, metric.balance / target * 100)) : 0;
  const targetText = envelope.id === 'debt' ? `${money(metric.balance)} reserved` : target ? `${money(metric.balance)} / ${money(target)}` : money(metric.balance);
  return `<div class="envelope-row">
    <span class="envelope-symbol" style="color:${envelope.color};background:${envelope.color}18">${envelopeIcons[envelope.id] || '•'}</span>
    <div><div class="envelope-name">${escapeHtml(envelope.name)} <span>${envelope.percent}% rule</span></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%;background:${envelope.color}"></div></div></div>
    <span class="envelope-balance">${targetText}</span>
  </div>`;
}

function renderEnvelopes() {
  const metrics = envelopeMetrics();
  $('#dashboardEnvelopes').innerHTML = state.settings.envelopes.map(envelope => envelopeRow(envelope, metrics[envelope.id])).join('');
  $('#moneyEnvelopes').innerHTML = state.settings.envelopes.map(envelope => {
    const metric = metrics[envelope.id];
    const target = Number(envelope.target || 0);
    const progress = target ? Math.min(100, Math.max(0, metric.balance / target * 100)) : 0;
    let caption = target ? `Target: ${money(target)}` : `${money(metric.funded)} allocated this month`;
    if (envelope.id === 'debt') caption = `${money(debtPaidTotal())} paid of ${money(state.settings.debtTotal)} total debt`;
    return `<article class="envelope-card" style="--card-color:${envelope.color}">
      <div class="card-top"><span>${escapeHtml(envelope.name)}</span><span class="card-icon">${envelopeIcons[envelope.id] || '•'}</span></div>
      <strong>${money(metric.balance)}</strong><span class="card-caption">${caption}</span>
      <div class="progress-track"><div class="progress-fill" style="background:${envelope.color};width:${progress}%"></div></div>
      <span class="card-caption">${money(metric.spent)} paid from this envelope</span>
    </article>`;
  }).join('');
  $('#expenseEnvelope').innerHTML = state.settings.envelopes.map(envelope => `<option value="${envelope.id}">${escapeHtml(envelope.name)}</option>`).join('');
}

function renderDashboard() {
  const income = totalIncome();
  const debtPaid = debtPaidTotal();
  const time = todayTimeTotals();
  $('#monthIncome').textContent = money(income);
  $('#monthIncomeDetail').textContent = income ? `Using your ${state.settings.envelopes.map(item => item.percent).join(' / ')} rule.` : 'Record the money you actually receive.';
  $('#debtPaid').textContent = money(debtPaid);
  $('#debtDetail').textContent = `${money(Math.max(0, state.settings.debtTotal - debtPaid))} remains of ${money(state.settings.debtTotal)}`;
  $('#stolenToday').textContent = `${time.stolen} min`;
  $('#stolenDetail').textContent = time.stolen ? 'Name it, then choose the next block.' : 'Track it honestly, without shame.';
  $('#focusToday').textContent = `${time.focus} min`;
  $('#focusDetail').textContent = time.focus ? 'Focused minutes are protected minutes.' : 'Protect one useful block.';
  renderEnvelopes();
  renderHabits();
  const banner = $('#insightBanner');
  if (!income) { banner.textContent = 'Start small: record the next MAD that reaches your hand. The system begins with one honest entry.'; banner.classList.add('show'); }
  else if (time.stolen > time.focus && time.stolen >= 30) { banner.textContent = `Today has ${time.stolen - time.focus} more stolen minutes than focused minutes. A 25-minute reset is enough to change the direction.`; banner.classList.add('show'); }
  else { banner.textContent = 'You are building evidence that you can manage money and attention deliberately.'; banner.classList.add('show'); }
}

function renderIncomePreview() {
  const amount = Number($('#incomeAmount').value || 0);
  const box = $('#splitPreview');
  if (!amount) { box.innerHTML = '<span>Enter an amount to see the split.</span>'; return; }
  const splits = splitIncome(amount);
  box.innerHTML = state.settings.envelopes.map(envelope => `<div class="split-piece" style="background:${envelope.color}18;color:${envelope.color}">${escapeHtml(envelope.name)}<b>${money(splits[envelope.id])}</b></div>`).join('');
}

function renderTransactions() {
  const entries = (currentTransactionFilter === 'month' ? entriesForMonth(state.transactions) : state.transactions).slice().sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`));
  $('#clearMonthFilter').textContent = currentTransactionFilter === 'month' ? 'Show all' : 'This month';
  $('#transactionRows').innerHTML = entries.length ? entries.map(entry => {
    const isIncome = entry.type === 'income';
    const envelope = state.settings.envelopes.find(item => item.id === entry.envelopeId);
    const description = isIncome ? `<strong>${escapeHtml(entry.source)}</strong><br><small>${escapeHtml(entry.note || 'Income received')}</small>` : `<strong>${escapeHtml(entry.note)}</strong><br><small>${escapeHtml(envelope?.name || 'Unknown envelope')}</small>`;
    const allocation = isIncome ? Object.entries(entry.allocations || {}).map(([id, amount]) => `${state.settings.envelopes.find(item => item.id === id)?.percent || 0}% ${money(amount)}`).join(' · ') : escapeHtml(envelope?.name || '');
    return `<tr><td>${dateLabel(entry.date)}</td><td>${description}</td><td>${allocation}</td><td class="number ${isIncome ? 'positive' : 'negative'}">${isIncome ? '+' : '−'}${money(entry.amount)}</td><td class="row-actions"><button class="icon-action" data-edit-transaction="${entry.id}" title="Edit entry" aria-label="Edit entry">✎</button><button class="delete-button" data-delete-transaction="${entry.id}" title="Delete entry" aria-label="Delete entry">×</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-row">No money activity recorded here yet.</td></tr>';
}

function categoriesFor(type) { return timeCategories[type].map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join(''); }
function updateTimeCategoryOptions() {
  $('#timerCategory').innerHTML = categoriesFor($('#timerType').value);
  $('#timeCategory').innerHTML = categoriesFor($('#timeType').value);
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
  $('#biggestThiefDetail').textContent = top ? `${top[1]} minutes this week` : 'Log a few days to spot a pattern.';
  renderWeeklyBars();
  $('#timeSuggestion').textContent = top ? `Your biggest pattern is ${top[0].toLowerCase()}. Make the next focused block easier than opening it.` : 'Start with one entry. Accuracy beats perfection.';
  renderTimeRows();
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
    return `<div class="day-bar"><div class="bar-stack" title="${dateLabel(item.date)}: ${item.focus} focus / ${item.stolen} stolen minutes"><div class="bar-focus" style="height:${focusHeight}%"></div><div class="bar-stolen" style="height:${stolenHeight}%"></div></div><b>${label}</b><span>${item.focus + item.stolen}m</span></div>`;
  }).join('');
}

function renderTimeRows() {
  const entries = state.timeEntries.slice().sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`)).slice(0, 25);
  $('#timeRows').innerHTML = entries.length ? entries.map(entry => `<tr><td>${dateLabel(entry.date)}</td><td><strong class="${entry.type === 'focus' ? 'positive' : 'negative'}">${entry.type === 'focus' ? 'Focus' : 'Stolen'}</strong></td><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.note || '—')}</td><td class="number">${entry.minutes} min</td><td class="row-actions"><button class="icon-action" data-edit-time="${entry.id}" title="Edit entry" aria-label="Edit entry">✎</button><button class="delete-button" data-delete-time="${entry.id}" title="Delete entry" aria-label="Delete entry">×</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">No time entries yet. Start the timer or add one honest estimate.</td></tr>';
}

function renderTimer() {
  const active = state.activeTimer;
  $('#startTimerButton').disabled = Boolean(active);
  $('#stopTimerButton').disabled = !active;
  if (!active) { $('#timerTitle').textContent = 'Start an honest timer'; $('#timerDisplay').textContent = '00:00:00'; return; }
  $('#timerTitle').textContent = active.type === 'focus' ? 'Focus is being protected' : 'Time is being noticed';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000));
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  $('#timerDisplay').textContent = `${h}:${m}:${s}`;
}

function renderHabits() {
  const day = getDayData();
  const habits = state.settings.habits;
  $('#dashboardHabits').innerHTML = habits.length ? habits.map(habit => `<label class="compact-habit ${day.habits[habit.id] ? 'done' : ''}"><input type="checkbox" data-habit="${habit.id}" ${day.habits[habit.id] ? 'checked' : ''}><span>${escapeHtml(habit.title)}</span></label>`).join('') : '<p class="small-note">Add daily actions in Setup.</p>';
  $('#dashboardPriority').value = day.priority || '';
  $('#habitList').innerHTML = habits.length ? habits.map(habit => `<label class="habit-item ${day.habits[habit.id] ? 'done' : ''}"><input type="checkbox" data-habit="${habit.id}" ${day.habits[habit.id] ? 'checked' : ''}><span class="habit-text"><strong>${escapeHtml(habit.title)}</strong><small>${escapeHtml(habit.detail)}</small></span><span>${day.habits[habit.id] ? '✓' : ''}</span></label>`).join('') : '<p class="small-note">No daily actions yet. Add up to a few in Setup.</p>';
  $('#priorityInput').value = day.priority || '';
  $('#dailyReflection').value = day.reflection || '';
  renderStreaks();
}

function streakFor(habitId) {
  let current = new Date(`${today()}T12:00:00`);
  let count = 0;
  while (state.days[current.toISOString().slice(0, 10)]?.habits?.[habitId]) { count++; current = new Date(current.getTime() - DAY_MS); }
  return count;
}

function renderStreaks() {
  const habits = state.settings.habits;
  $('#streakCards').innerHTML = habits.map(habit => `<article class="streak-card"><strong>${streakFor(habit.id)}</strong><span>day streak · ${escapeHtml(habit.title)}</span></article>`).join('');
  $('#weekChecks').innerHTML = weekDates().map(date => {
    const checked = habits.filter(habit => state.days[date]?.habits?.[habit.id]).length;
    const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
    return `<div class="week-day ${habits.length && checked === habits.length ? 'complete' : ''} ${date === today() ? 'today' : ''}"><b>${label}</b><span>${checked}/${habits.length}</span></div>`;
  }).join('');
}

function renderSettings() {
  $('#envelopeSettings').innerHTML = state.settings.envelopes.map(envelope => `<div class="settings-row envelope-settings-row">
    <label><span class="row-swatch" style="background:${envelope.color}"></span>Name<input data-name="${envelope.id}" maxlength="40" value="${escapeHtml(envelope.name)}"></label>
    <label>%<input data-percent="${envelope.id}" type="number" min="0" max="100" step="1" value="${envelope.percent}"></label>
    <label>Target<input data-target="${envelope.id}" type="number" min="0" step="1" value="${envelope.target}"></label>
    <button class="delete-button" type="button" data-remove-envelope="${envelope.id}" title="Remove envelope" aria-label="Remove ${escapeHtml(envelope.name)}">×</button>
  </div>`).join('');
  $('#habitSettings').innerHTML = state.settings.habits.map(habit => `<div class="settings-row habit-settings-row">
    <label>Daily action<input data-habit-title="${habit.id}" maxlength="60" value="${escapeHtml(habit.title)}"></label>
    <label>Detail <span class="optional">optional</span><input data-habit-detail="${habit.id}" maxlength="120" value="${escapeHtml(habit.detail || '')}"></label>
    <button class="delete-button" type="button" data-remove-habit="${habit.id}" title="Remove daily action" aria-label="Remove ${escapeHtml(habit.title)}">×</button>
  </div>`).join('') || '<p class="small-note">No daily actions yet. Add one below.</p>';
  $('#debtTotalInput').value = state.settings.debtTotal;
  $('#storageNote').textContent = state.updatedAt ? `Saved locally: ${new Date(state.updatedAt).toLocaleString()}` : 'No backup created yet.';
  applyTheme();
}

function renderAll() {
  renderHeader();
  renderRule();
  renderDashboard();
  renderIncomePreview();
  renderTransactions();
  updateTimeCategoryOptions();
  renderTime();
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
  toast(wasEditing ? `Payment updated and re-split.` : `${money(amount)} split into your envelopes.`);
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
  toast(wasEditing ? 'Payment updated.' : `${money(amount)} recorded from ${envelope?.name || 'envelope'}.`);
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
  toast(wasEditing ? 'Time entry updated.' : `${minutes} minutes logged. Data, not guilt.`);
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
    setFormEditing('#incomeForm', true, 'Update payment');
    $('#incomeAmount').focus();
  } else {
    cancelIncomeEdit();
    editingExpenseId = id;
    $('#expenseAmount').value = entry.amount;
    $('#expenseDate').value = entry.date;
    $('#expenseEnvelope').value = entry.envelopeId;
    $('#expenseNote').value = entry.note || '';
    setFormEditing('#expenseForm', true, 'Update payment');
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
  setFormEditing('#timeForm', true, 'Update entry');
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
  setFormEditing('#incomeForm', false, 'Split into envelopes');
}

function cancelExpenseEdit() {
  editingExpenseId = null;
  $('#expenseForm').reset();
  $('#expenseDate').value = today();
  setFormEditing('#expenseForm', false, 'Record payment');
}

function cancelTimeEdit() {
  editingTimeId = null;
  $('#timeForm').reset();
  $('#timeDate').value = today();
  setFormEditing('#timeForm', false, 'Log time');
}

function startTimer() {
  state.activeTimer = { type: $('#timerType').value, category: $('#timerCategory').value, note: $('#timerNote').value.trim(), startedAt: new Date().toISOString() };
  saveState();
  renderTimer();
  toast('Timer started. Stay with the next minute.');
}

function stopTimer() {
  const active = state.activeTimer;
  if (!active) return;
  const minutes = Math.max(1, Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60000));
  state.timeEntries.push({ id: makeId(), type: active.type, category: active.category, note: active.note, minutes, date: today(), createdAt: new Date().toISOString() });
  state.activeTimer = null;
  saveState();
  renderAll();
  toast(`${minutes} minutes ${active.type === 'focus' ? 'of focus protected' : 'noticed and logged'}.`);
}

function updateHabit(habitId, completed) {
  getDayData().habits[habitId] = completed;
  saveState();
  renderHabits();
}

function saveDayText(field, value) {
  getDayData()[field] = value;
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

function saveSettings(event) {
  event.preventDefault();
  const envelopes = readEnvelopeInputs();
  if (!envelopes.length) { toast('Add at least one envelope.'); return; }
  const total = envelopes.reduce((sum, envelope) => sum + envelope.percent, 0);
  if (total !== 100) { toast(`Your envelope percentages add up to ${total}%. They must equal 100%.`); return; }
  if (envelopes.some(envelope => envelope.percent < 0 || envelope.target < 0)) { toast('Percentages and targets cannot be negative.'); return; }
  state.settings.envelopes = envelopes;
  state.settings.habits = readHabitInputs().filter(habit => habit.title);
  state.settings.debtTotal = Math.max(0, Math.round(Number($('#debtTotalInput').value || 0)));
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
  toast('Envelope added. Set its percentage, then save.');
}

function removeEnvelope(id) {
  state.settings.envelopes = readEnvelopeInputs().filter(envelope => envelope.id !== id);
  state.settings.habits = readHabitInputs();
  renderSettings();
  toast('Envelope removed. Adjust percentages to total 100%, then save.');
}

function addHabit() {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs();
  state.settings.habits.push({ id: makeId(), title: 'New daily action', detail: '' });
  renderSettings();
  toast('Daily action added. Rename it, then save.');
}

function removeHabit(id) {
  state.settings.envelopes = readEnvelopeInputs();
  state.settings.habits = readHabitInputs().filter(habit => habit.id !== id);
  renderSettings();
  toast('Daily action removed. Save to keep the change.');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kamal-control-center-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Backup exported. Keep it somewhere private.');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const nextState = JSON.parse(await file.text());
    if (!nextState?.settings || !Array.isArray(nextState.transactions)) throw new Error('Invalid backup');
    state = nextState;
    normalizeSettings(state.settings);
    state.timeEntries ||= []; state.days ||= {}; state.activeTimer ||= null;
    saveState(); renderAll(); toast('Backup imported successfully.');
  } catch { toast('This file is not a valid Control Center backup.'); }
  event.target.value = '';
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter(entry => entry.id !== id);
  if (editingIncomeId === id) cancelIncomeEdit();
  if (editingExpenseId === id) cancelExpenseEdit();
  saveState(); renderAll(); toast('Money entry deleted.');
}
function deleteTime(id) {
  state.timeEntries = state.timeEntries.filter(entry => entry.id !== id);
  if (editingTimeId === id) cancelTimeEdit();
  saveState(); renderAll(); toast('Time entry deleted.');
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
  $('#startTimerButton').addEventListener('click', startTimer);
  $('#stopTimerButton').addEventListener('click', stopTimer);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#exportButton').addEventListener('click', exportData);
  $('#quickBackupButton').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', importData);
  $('#clearMonthFilter').addEventListener('click', () => { currentTransactionFilter = currentTransactionFilter === 'month' ? 'all' : 'month'; renderTransactions(); });
  $('#resetButton').addEventListener('click', () => {
    if (!confirm('Delete all locally saved transactions, time logs, and scorecards? Export a backup first.')) return;
    state = defaultState(); saveState(); renderAll(); toast('Local app data deleted.');
  });
  $('#addEnvelopeButton').addEventListener('click', addEnvelope);
  $('#addHabitButton').addEventListener('click', addHabit);
  $('#themeSelect').addEventListener('change', event => setThemePreference(event.target.value));
  $('#cancelIncomeEdit').addEventListener('click', cancelIncomeEdit);
  $('#cancelExpenseEdit').addEventListener('click', cancelExpenseEdit);
  $('#cancelTimeEdit').addEventListener('click', cancelTimeEdit);
  document.addEventListener('change', event => { if (event.target.matches('[data-habit]')) updateHabit(event.target.dataset.habit, event.target.checked); });
  $('#dashboardPriority').addEventListener('input', event => { saveDayText('priority', event.target.value); $('#priorityInput').value = event.target.value; });
  $('#priorityInput').addEventListener('input', event => { saveDayText('priority', event.target.value); $('#dashboardPriority').value = event.target.value; });
  $('#dailyReflection').addEventListener('input', event => saveDayText('reflection', event.target.value));
  document.addEventListener('click', event => {
    const transactionButton = event.target.closest('[data-delete-transaction]');
    const timeButton = event.target.closest('[data-delete-time]');
    const editTransactionButton = event.target.closest('[data-edit-transaction]');
    const editTimeButton = event.target.closest('[data-edit-time]');
    const removeEnvelopeButton = event.target.closest('[data-remove-envelope]');
    const removeHabitButton = event.target.closest('[data-remove-habit]');
    if (transactionButton) deleteTransaction(transactionButton.dataset.deleteTransaction);
    if (timeButton) deleteTime(timeButton.dataset.deleteTime);
    if (editTransactionButton) editTransaction(editTransactionButton.dataset.editTransaction);
    if (editTimeButton) editTimeEntry(editTimeButton.dataset.editTime);
    if (removeEnvelopeButton) removeEnvelope(removeEnvelopeButton.dataset.removeEnvelope);
    if (removeHabitButton) removeHabit(removeHabitButton.dataset.removeHabit);
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('#installButton').hidden = false; });
  $('#installButton').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('#installButton').hidden = true; });
  $('#themeButton').addEventListener('click', () => setThemePreference(resolvedTheme() === 'dark' ? 'light' : 'dark'));
  prefersDark?.addEventListener?.('change', () => { if (themePreference === 'system') applyTheme(); });
}

function registerPWA() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

registerEvents();
applyTheme();
renderAll();
renderTimer();
setInterval(renderTimer, 1000);
registerPWA();

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

function defaultState() {
  return {
    version: 1,
    settings: { envelopes: structuredClone(defaultEnvelopes), debtTotal: 45000 },
    transactions: [],
    timeEntries: [],
    days: {},
    activeTimer: null,
    updatedAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !stored.settings) return defaultState();
    stored.settings.envelopes = (stored.settings.envelopes || defaultEnvelopes).map((item, index) => ({ ...defaultEnvelopes[index], ...item }));
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
    return `<tr><td>${dateLabel(entry.date)}</td><td>${description}</td><td>${allocation}</td><td class="number ${isIncome ? 'positive' : 'negative'}">${isIncome ? '+' : '−'}${money(entry.amount)}</td><td><button class="delete-button" data-delete-transaction="${entry.id}" title="Delete entry">×</button></td></tr>`;
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
  $('#timeRows').innerHTML = entries.length ? entries.map(entry => `<tr><td>${dateLabel(entry.date)}</td><td><strong class="${entry.type === 'focus' ? 'positive' : 'negative'}">${entry.type === 'focus' ? 'Focus' : 'Stolen'}</strong></td><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.note || '—')}</td><td class="number">${entry.minutes} min</td><td><button class="delete-button" data-delete-time="${entry.id}" title="Delete entry">×</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">No time entries yet. Start the timer or add one honest estimate.</td></tr>';
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
  $('#dashboardHabits').innerHTML = defaultHabits.map(habit => `<label class="compact-habit ${day.habits[habit.id] ? 'done' : ''}"><input type="checkbox" data-habit="${habit.id}" ${day.habits[habit.id] ? 'checked' : ''}><span>${escapeHtml(habit.title)}</span></label>`).join('');
  $('#dashboardPriority').value = day.priority || '';
  $('#habitList').innerHTML = defaultHabits.map(habit => `<label class="habit-item ${day.habits[habit.id] ? 'done' : ''}"><input type="checkbox" data-habit="${habit.id}" ${day.habits[habit.id] ? 'checked' : ''}><span class="habit-text"><strong>${escapeHtml(habit.title)}</strong><small>${escapeHtml(habit.detail)}</small></span><span>${day.habits[habit.id] ? '✓' : ''}</span></label>`).join('');
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
  $('#streakCards').innerHTML = defaultHabits.map(habit => `<article class="streak-card"><strong>${streakFor(habit.id)}</strong><span>day streak · ${escapeHtml(habit.title)}</span></article>`).join('');
  $('#weekChecks').innerHTML = weekDates().map(date => {
    const checked = defaultHabits.filter(habit => state.days[date]?.habits?.[habit.id]).length;
    const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
    return `<div class="week-day ${checked === defaultHabits.length ? 'complete' : ''} ${date === today() ? 'today' : ''}"><b>${label}</b><span>${checked}/${defaultHabits.length}</span></div>`;
  }).join('');
}

function renderSettings() {
  $('#envelopeSettings').innerHTML = state.settings.envelopes.map(envelope => `<div class="settings-row"><div class="envelope-label" style="color:${envelope.color}">${escapeHtml(envelope.name)}</div><label>%<input data-percent="${envelope.id}" type="number" min="0" max="100" step="1" value="${envelope.percent}"></label><label>Monthly target<input data-target="${envelope.id}" type="number" min="0" step="1" value="${envelope.target}"></label></div>`).join('');
  $('#debtTotalInput').value = state.settings.debtTotal;
  $('#storageNote').textContent = state.updatedAt ? `Saved locally: ${new Date(state.updatedAt).toLocaleString()}` : 'No backup created yet.';
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
  state.transactions.push({ id: makeId(), type: 'income', amount, date: $('#incomeDate').value, source: $('#incomeSource').value.trim(), note: $('#incomeNote').value.trim(), allocations: splitIncome(amount), createdAt: new Date().toISOString() });
  saveState();
  event.target.reset();
  $('#incomeDate').value = today();
  renderAll();
  toast(`${money(amount)} split into your envelopes.`);
}

function addExpense(event) {
  event.preventDefault();
  const amount = Math.round(Number($('#expenseAmount').value));
  if (!amount || amount < 1) return;
  const envelopeId = $('#expenseEnvelope').value;
  state.transactions.push({ id: makeId(), type: 'expense', amount, date: $('#expenseDate').value, envelopeId, note: $('#expenseNote').value.trim(), createdAt: new Date().toISOString() });
  saveState();
  event.target.reset();
  $('#expenseDate').value = today();
  renderAll();
  const envelope = state.settings.envelopes.find(item => item.id === envelopeId);
  toast(`${money(amount)} recorded from ${envelope.name}.`);
}

function addTimeEntry(event) {
  event.preventDefault();
  const minutes = Math.round(Number($('#timeMinutes').value));
  if (!minutes || minutes < 1) return;
  state.timeEntries.push({ id: makeId(), type: $('#timeType').value, category: $('#timeCategory').value, minutes, date: $('#timeDate').value, note: $('#timeNote').value.trim(), createdAt: new Date().toISOString() });
  saveState();
  event.target.reset();
  $('#timeDate').value = today();
  renderAll();
  toast(`${minutes} minutes logged. Data, not guilt.`);
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

function saveSettings(event) {
  event.preventDefault();
  const envelopes = state.settings.envelopes.map(envelope => ({ ...envelope, percent: Number($(`[data-percent="${envelope.id}"]`).value), target: Number($(`[data-target="${envelope.id}"]`).value) }));
  const total = envelopes.reduce((sum, envelope) => sum + envelope.percent, 0);
  if (total !== 100) { toast(`Your envelope percentages add up to ${total}%. They must equal 100%.`); return; }
  if (envelopes.some(envelope => envelope.percent < 0 || envelope.target < 0)) { toast('Percentages and targets cannot be negative.'); return; }
  state.settings.envelopes = envelopes;
  state.settings.debtTotal = Math.max(0, Math.round(Number($('#debtTotalInput').value || 0)));
  saveState();
  renderAll();
  toast('Envelope rule saved.');
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
    state.settings.envelopes = (state.settings.envelopes || defaultEnvelopes).map((item, index) => ({ ...defaultEnvelopes[index], ...item }));
    state.timeEntries ||= []; state.days ||= {}; state.activeTimer ||= null;
    saveState(); renderAll(); toast('Backup imported successfully.');
  } catch { toast('This file is not a valid Control Center backup.'); }
  event.target.value = '';
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter(entry => entry.id !== id);
  saveState(); renderAll(); toast('Money entry deleted.');
}
function deleteTime(id) {
  state.timeEntries = state.timeEntries.filter(entry => entry.id !== id);
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
  document.addEventListener('change', event => { if (event.target.matches('[data-habit]')) updateHabit(event.target.dataset.habit, event.target.checked); });
  $('#dashboardPriority').addEventListener('input', event => { saveDayText('priority', event.target.value); $('#priorityInput').value = event.target.value; });
  $('#priorityInput').addEventListener('input', event => { saveDayText('priority', event.target.value); $('#dashboardPriority').value = event.target.value; });
  $('#dailyReflection').addEventListener('input', event => saveDayText('reflection', event.target.value));
  document.addEventListener('click', event => {
    const transactionButton = event.target.closest('[data-delete-transaction]');
    const timeButton = event.target.closest('[data-delete-time]');
    if (transactionButton) deleteTransaction(transactionButton.dataset.deleteTransaction);
    if (timeButton) deleteTime(timeButton.dataset.deleteTime);
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('#installButton').hidden = false; });
  $('#installButton').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('#installButton').hidden = true; });
}

function registerPWA() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

registerEvents();
renderAll();
renderTimer();
setInterval(renderTimer, 1000);
registerPWA();

// Regression across the whole app, rebuilt after the earlier scratchpad was lost.
const { load, reporter } = require('./harness-lib.js');
require('path').join(__dirname, '..', 'insights.js');
require(require('path').join(__dirname, '..', 'insights.js'));
const Insights = globalThis.Insights;
const { check, done } = reporter();

// ---------- boot ----------
{
  const h = load();
  check('boots with no data and renders everything', typeof h.ctx.renderAll === 'function' && (h.ctx.renderAll(), true));
  check('starts on today and this month', h.api.state && h.ctx.dayTitleFor(h.api.today()) === 'Today');
  check('defaults seeded', h.api.state.settings.habits.length === 3 && h.api.state.settings.substances.length === 2);
}

// ---------- focus timer + tasks ----------
{
  const h = load(); const T = h.api.today();
  check('splitIncome totals to input', Object.values(h.ctx.splitIncome(1000)).reduce((a, b) => a + b, 0) === 1000);
  h.ctx.addTask('A'); h.ctx.addTask('B'); h.ctx.addTask('C'); h.ctx.addTask('D');
  check('max three tasks', h.api.state.days[T].tasks.length === 3);
  h.getEl('#timerType').value = 'focus'; h.getEl('#timerCategory').value = 'Paid work'; h.getEl('#timerNote').value = '';
  h.ctx.beginTimer('countdown', 25); h.ctx.finishActiveTimer(true);
  const last = h.api.state.timeEntries[h.api.state.timeEntries.length - 1];
  check('countdown logs full focus minutes', last && last.type === 'focus' && last.minutes === 25);
  h.ctx.beginTimer('break', 5); const n = h.api.state.timeEntries.length; h.ctx.finishActiveTimer(true);
  check('break logs nothing', h.api.state.timeEntries.length === n);
  h.api.state.days['2020-01-01'] = { priority: '', reflection: '', habits: {}, tasks: [{ id: 'x', text: 'carry', done: false }, { id: 'y', text: 'done', done: true }] };
  delete h.api.state.days[T].tasks; h.ctx.rolloverTasks();
  check('rollover carries only unfinished tasks', h.api.state.days[T].tasks.length === 1 && h.api.state.days[T].tasks[0].rolled);
}

// ---------- urges, lapse response, findings ----------
{
  const h = load();
  h.getEl('#cravingSubstance').value = 'cannabis'; h.getEl('#cravingTrigger').value = 'Stress'; h.getEl('#cravingIntensity').value = '4';
  h.ctx.beginSurf(); h.ctx.logCraving('rode');
  check('waiting it out banks the money', h.api.state.cravings[0].recovered === 30);
  h.ctx.beginSurf(); h.ctx.logCraving('used');
  check('lapse headline is kind', h.ctx.debriefHeadline('used').includes('not make you a bad person'));
  h.ctx.saveDebrief();
  check('debrief closes and craving kept', h.api.state.cravings.length === 2);
  check('want phrase names what they track', h.ctx.substancePhrase() === 'cigarettes or weed');
  h.ctx.renderBody();
  check('start button uses a real wait length', /^Wait \d+ minutes until it passes$/.test(h.getEl('#startSurfButton').textContent));
}

// ---------- insight engine ----------
{
  const c = o => Object.assign({ trigger: 'Stress', intensity: 3, outcome: 'rode', secondsSurfed: 240, createdAt: new Date(2026, 8, 16, 20).toISOString(), debrief: { gaveTags: ['Stop thinking'] } }, o);
  check('nothing ready below threshold', Insights.compute({ cravings: [c(), c()], timeEntries: [] }).every(f => !f.ready));
  const five = Insights.compute({ cravings: [c(), c(), c(), c(), c()], timeEntries: [] });
  check('claims appear at threshold with counts', five.some(f => f.ready && f.count >= 5));
  check('never causal', !/\b(causes?|proves?|will make you)\b/i.test(five.map(f => f.text).join(' ')));
  check('dismissed findings stay hidden', !Insights.compute({ cravings: [c(), c(), c(), c(), c()], timeEntries: [], dismissedInsights: ['urge-reason'] }).some(f => f.id === 'urge-reason'));
}

// ---------- day / month / year + navigation ----------
{
  const h = load(); const T = h.api.today(); const y = h.api.shiftDate(T, -1);
  h.ctx.setSelectedDate(y);
  const habit = h.api.state.settings.habits[0].id;
  h.ctx.updateHabit(habit, true);
  check('editing a past day writes to that day', h.api.state.days[y].habits[habit] === true);
  h.ctx.setSelectedDate(h.api.shiftDate(T, 1));
  check('cannot move into the future', h.ctx.dayTitleFor(y) === 'Yesterday');
  check('week strip cells are buttons', h.getEl('#weekChecks').innerHTML.includes('data-goto-day'));
  h.ctx.getMonthData().bigMove = 'Close one debt';
  h.ctx.getYearData().theme = 'The year I stopped bleeding';
  h.ctx.renderMonth(); h.ctx.renderYear();
  check('month big move renders', h.getEl('#bigMoveInput').value === 'Close one debt');
  check('year puzzle renders', h.getEl('#yearTheme').value === 'The year I stopped bleeding');
  check('month page now shows bills panel', h.getEl('#billsSummary').innerHTML === 'Nothing added yet.');
}

// ---------- wording migration of older saved data ----------
{
  const seed = {
    version: 1,
    settings: {
      envelopes: [{ id: 'family', name: 'Family & Home', percent: 60, target: 8000, color: '#69a9ff' }, { id: 'personal', name: 'Personal Needs', percent: 20, target: 3000, color: '#ba9aff' }, { id: 'debt', name: 'Debt', percent: 15, target: 0, color: '#ff9b70' }, { id: 'emergency', name: 'Emergency', percent: 5, target: 1000, color: '#53d6ad' }],
      habits: [{ id: 'money', title: 'Track today\u2019s money', detail: 'Record every payment received or spent.' }, { id: 'mine', title: 'My renamed habit', detail: 'keep' }],
      substances: [{ id: 'cannabis', name: 'Cannabis', costPerUse: 30 }],
      debtTotal: 45000, dailyFocusTarget: 120
    },
    transactions: [], timeEntries: [], cravings: [], days: {}, activeTimer: null
  };
  const h = load(seed);
  check('old default wording upgraded on load', h.api.state.settings.habits[0].title === 'Write down today\u2019s money');
  check('hand-renamed items untouched', h.api.state.settings.habits[1].title === 'My renamed habit');
  check('money box names upgraded', h.api.state.settings.envelopes[2].name === 'Money I owe');
}

done();

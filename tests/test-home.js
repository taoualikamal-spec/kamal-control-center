// Home first: one amount goes home every month before anyone on the list.
// Money is set aside as it arrives; extra becomes next month's buffer;
// hours show how close the next paycheck is.
const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

{
  const h = load();
  const c = h.ctx;
  const s = () => h.api.state;
  check('a new phone has no home amount yet', s().home.target === 0 && c.homeSummary('2026-11-17').covered === false);

  c.setHomeSettings({ target: 8000, rate: 90 }, '2026-11-17');
  check('set up after the 3rd, the first month is the next one', s().home.since === '2026-12');
  let sum = c.homeSummary('2026-11-17');
  check('the next 1st is the one to fill', sum.dueDate === '2026-12-01' && sum.need === 8000 && sum.ready === 0);

  // Two paychecks: the app suggests home first, never more than the paycheck.
  c.recordSimonPay(3600, 3600, '2026-11-20');
  sum = c.homeSummary('2026-11-21');
  check('a paycheck set aside counts toward the 1st', sum.ready === 3600 && sum.toSetAside === 4400 && !sum.covered);
  c.recordSimonPay(3600, 99999, '2026-11-27');
  sum = c.homeSummary('2026-11-28');
  check('setting aside is capped at what was paid', sum.ready === 7200);
  c.addHomeMove('aside', 2800, '2026-11-29');
  sum = c.homeSummary('2026-11-29');
  check('money beyond the amount becomes next month\'s buffer', sum.covered && sum.ready === 8000 && sum.buffer === 2000);

  // Sending on the 1st counts for December, on time.
  const sent = c.addHomeMove('sent', 8000, '2026-12-01');
  check('money sent on the 1st is for that month', sent.month === '2026-12');
  sum = c.homeSummary('2026-12-01');
  check('after sending, the next 1st is in front of you', sum.dueDate === '2027-01-01');
  check('the buffer is now this month\'s start', sum.ready === 2000 && sum.buffer === 0);
  check('December went home on time', sum.months.length === 1 && sum.months[0].onTime === true && sum.onTimeCount === 1);
}

{
  // A month sent late, and in two parts, is recorded honestly.
  const h = load();
  const c = h.ctx;
  c.setHomeSettings({ target: 8000 }, '2026-12-02');
  check('set up by the 3rd, this month counts', h.api.state.home.since === '2026-12');
  c.addHomeMove('aside', 8000, '2026-12-02');
  c.addHomeMove('sent', 5000, '2026-12-02');
  let sum = c.homeSummary('2026-12-10');
  check('a part sent leaves the rest due this month', sum.dueMonth === '2026-12' && sum.need === 3000 && sum.ready === 3000);
  c.addHomeMove('sent', 3000, '2026-12-10');
  sum = c.homeSummary('2026-12-10');
  check('sent in full but after the 3rd is not on time', sum.months[0].sent === 8000 && sum.months[0].onTime === false);
  sum = c.homeSummary('2027-01-05');
  check('a month with nothing sent shows as not sent, and the next one moves on', sum.months.length === 2 && sum.months[1].sent === 0 && sum.dueMonth === '2027-01');
}

{
  // Hours: this week, and toward the next paycheck (paid every 40 hours).
  const h = load();
  const c = h.ctx;
  c.setHomeSettings({ target: 8000, weeklyHours: 27, blockHours: 40, rate: 90 }, '2026-11-17');
  c.addHomeHours(6, '2026-11-16');   // Monday
  c.addHomeHours(5.5, '2026-11-17');
  c.addHomeHours(8, '2026-11-15');   // the Sunday before: last week
  check('a day cannot have more than 24 hours', c.addHomeHours(30, '2026-11-17') === null);
  let sum = c.homeSummary('2026-11-18');
  check('the week starts on Monday', sum.weekHours === 11.5 && sum.weekHoursLeft === 15.5);
  check('all hours count toward the next paycheck', sum.blockDone === 19.5 && sum.blockValue === 1755);
  c.addHomeHours(24, '2026-11-18');
  c.recordSimonPay(3600, 0, '2026-11-19');
  sum = c.homeSummary('2026-11-19');
  check('a paycheck closes a block and the extra hours carry over', sum.blockDone === 3.5);
  check('home alone needs this many hours a week', sum.homeHoursPerWeek === Math.ceil(8000 / (90 * 4.33)));
}

{
  // With no rate typed, the rate comes from the last paycheck.
  const h = load();
  const c = h.ctx;
  c.setHomeSettings({ target: 8000, blockHours: 40 }, '2026-11-17');
  c.recordSimonPay(3720, 0, '2026-11-20');
  check('the hourly rate is learned from a paycheck', c.homeRate() === 93);
}

{
  // Pay back waits for home.
  const h = load();
  const c = h.ctx;
  c.addPaybackItems(c.parsePaybackLines('Amine 300\nSara 600'));
  c.renderPayback();
  check('with no home amount, Pay back shows the next person', h.getEl('#paybackNext').innerHTML.startsWith('Next:'));
  c.setHomeSettings({ target: 8000 }, h.api.today());
  c.renderPayback();
  check('while home is not ready, home comes first', h.getEl('#paybackNext').innerHTML.startsWith('Home first') && h.getEl('#paybackNext').innerHTML.includes('Amine'));
  c.addHomeMove('aside', 8000, h.api.today());
  c.renderPayback();
  check('once home is ready, the next person is back', h.getEl('#paybackNext').innerHTML.startsWith('Next:'));
}

{
  // Removing a mistake, and old or messy saved data.
  const h = load();
  const c = h.ctx;
  c.setHomeSettings({ target: 8000 }, '2026-11-17');
  const move = c.addHomeMove('aside', 500, '2026-11-18');
  check('a wrong entry can be removed', c.removeHomeEntry('move', move.id) && c.homeSummary('2026-11-18').ready === 0);
  const old = load({ settings: { envelopes: [] }, transactions: [] });
  check('a backup from before Home loads with Home off', old.api.state.home.target === 0 && old.api.state.home.blockHours === 40);
  const messy = load({ settings: { envelopes: [] }, transactions: [], home: { target: '8000', hours: [{ date: '2026-11-17', hours: '6' }, { date: 'bad', hours: 3 }], moves: [{ date: '2026-11-17', kind: 'aside', amount: '700' }, { date: '2026-11-17', kind: 'other', amount: 5 }] } });
  const home = messy.api.state.home;
  check('messy saved home data is cleaned on load', home.target === 8000 && home.hours.length === 1 && home.hours[0].hours === 6 && home.moves.length === 1 && home.moves[0].month === '2026-11');
}

{
  const h = load();
  h.ctx.showTab('day');
  h.ctx.selectTab('home');
  check('the Home page opens', h.activePages().join() === 'home');
  check('the Month tab stays lit inside it', h.litTab() === 'month');
}

done();

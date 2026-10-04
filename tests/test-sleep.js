// Sleep. A night belongs to the morning you woke, waking time is the lever,
// and nothing is compared against an outside idea of a good night.
const { load, reporter } = require('./harness-lib.js');
require(require('path').join(__dirname, '..', 'insights.js'));
const Insights = globalThis.Insights;
const { check, done } = reporter();

{
  const h = load();
  const T = h.api.today();
  h.ctx.setSleep('toBed', '23:30');
  h.ctx.setSleep('wokeAt', '07:00');
  check('a night is stored on the morning you woke', Boolean(h.api.state.days[T].sleep.wokeAt === '07:00'));
  check('hours are counted across midnight', h.ctx.sleepMinutes({ toBed: '23:30', wokeAt: '07:00' }) === 450);
  check('a night that starts after midnight also works', h.ctx.sleepMinutes({ toBed: '01:15', wokeAt: '08:00' }) === 405);
  check('half a night is not counted at all', h.ctx.sleepMinutes({ toBed: '23:00' }) === 0);
  check('the readout shows the length', h.getEl('#sleepReadout').textContent.includes('7h 30m'));

  h.ctx.setSleep('toBed', '');
  h.ctx.setSleep('wokeAt', '');
  check('clearing both removes the night', h.api.state.days[T].sleep === undefined);
}

{
  const h = load();
  // Waking all over the place versus waking steadily.
  const nights = [['23:00', '06:00'], ['01:00', '09:30'], ['22:30', '05:15'], ['02:00', '10:00'], ['23:30', '07:00']];
  nights.forEach((pair, index) => {
    const date = h.api.shiftDate(h.api.today(), -index);
    h.api.state.days[date] = { priority: '', reflection: '', habits: {}, sleep: { toBed: pair[0], wokeAt: pair[1] } };
  });
  const stats = h.ctx.sleepStats();
  check('counts every night found', stats.nights === 5);
  check('reports an average length', stats.averageMinutes > 0);
  check('reports the usual waking time', /^\d\d:\d\d$/.test(stats.averageWake));
  check('measures how much waking moves', stats.wakeSpread > 60);

  const steady = load();
  [0, 1, 2, 3, 4].forEach(index => {
    const date = steady.api.shiftDate(steady.api.today(), -index);
    steady.api.state.days[date] = { priority: '', reflection: '', habits: {}, sleep: { toBed: '23:00', wokeAt: '07:00' } };
  });
  check('a steady week shows almost no movement', steady.ctx.sleepStats().wakeSpread === 0);
}

{
  // Findings: below the threshold nothing is claimed.
  const few = { days: {}, timeEntries: [], cravings: [] };
  few.days['2026-10-01'] = { sleep: { toBed: '23:00', wokeAt: '07:00' } };
  check('one night claims nothing', Insights.compute(few).filter(f => f.area === 'sleep').every(f => !f.ready));
  // Each side of a comparison needs its own evidence, not just the total.
  const lopsided = { days: {}, timeEntries: [], cravings: [] };
  for (let i = 1; i <= 12; i++) {
    const date = '2026-11-' + String(i).padStart(2, '0');
    lopsided.days[date] = { sleep: { toBed: i === 1 ? '01:30' : '22:30', wokeAt: '07:00' } };
  }
  check('a lopsided split is not compared', !Insights.compute(lopsided).some(f => f.id === 'sleep-focus' && f.ready));

  const many = { days: {}, timeEntries: [], cravings: [] };
  for (let i = 1; i <= 12; i++) {
    const date = '2026-10-' + String(i).padStart(2, '0');
    const long = i % 2 === 0;
    many.days[date] = { sleep: { toBed: long ? '22:30' : '01:30', wokeAt: '07:00' } };
    many.timeEntries.push({ type: 'focus', category: 'Paid work', minutes: long ? 90 : 20, date });
    if (long) many.cravings.push({ date, outcome: 'rode', trigger: 'Stress', intensity: 3, secondsSurfed: 200, createdAt: date + 'T20:00:00', debrief: {} });
  }
  const found = Insights.compute(many).filter(f => f.area === 'sleep' && f.ready);
  const text = found.map(f => f.text).join(' ');
  check('with enough nights it reports the average', text.includes('a night'));
  check('and the usual waking time', text.includes('give or take'));
  check('it compares focus after longer and shorter nights', text.includes('focused about'));
  check('and how the wanting went', text.includes('waited out'));
  check('every sleep finding carries its count', found.every(f => f.count >= Insights.thresholds.MIN_GROUP || f.count >= Insights.thresholds.MIN));
  check('it never claims sleep caused anything', !/\b(causes?|because of|proves?|will make you)\b/i.test(text));
  check('it never prescribes an outside number of hours', !/should sleep|8 hours|eight hours|recommended/i.test(text));
}

done();

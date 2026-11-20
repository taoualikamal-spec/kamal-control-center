// Overview: the first page leads with the work that brings money in, then
// shows where you stand. Payments are facts lower down, never the headline.
const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

function scenario() {
  const h = load();
  const st = h.api.state;
  const c = h.ctx;
  st.settings.boxesSince = '2026-11-01';
  st.settings.keepForLiving = 700;
  c.setHomeSettings({ target: 7100, rate: 110 }, '2026-11-17');
  st.transactions.push({ id: 'i1', type: 'income', amount: 2500, date: '2026-11-18', source: 'Work', note: '', allocations: { family: 1500, personal: 500, debt: 375, emergency: 125 } });
  st.transactions.push({ id: 'e1', type: 'expense', amount: 600, date: '2026-11-18', envelopeId: 'debt', note: 'Paid back: Amine' });
  st.bills = [
    { id: 'wifi', name: 'Wi-Fi (last month)', amount: 400, dueDate: '2026-11-20', envelopeId: 'family', monthly: false, priority: 'earn' },
    { id: 'tooth', name: 'Tooth medicine', amount: 750, dueDate: '2026-11-25', envelopeId: 'personal', monthly: false, priority: 'live' },
    { id: 'sara', name: 'Sara', amount: 2000, dueDate: '2026-11-25', envelopeId: 'debt', monthly: false, priority: 'other' },
    { id: 'loan', name: 'Loan 1/3', amount: 1740, dueDate: '2026-12-12', envelopeId: 'debt', monthly: false, priority: 'other' }
  ];
  st.payback = c.normalizePayback([{ name: 'Youssef', amount: 300 }, { name: 'Karim', amount: 1500 }]);
  return h;
}

{
  // Friday 20 November 2026: work 10:00-14:00 and 15:00-19:00.
  const h = scenario();
  const c = h.ctx;
  let e = c.overviewEarning('2026-11-20', '09:10');
  check('before work, the next step is the first work block', e.status === 'next' && e.block.id === 'work1' && e.laterToday.map(row => row.id).join() === 'work2');
  check('it says what today is worth', e.plannedToday === 8 && e.plannedValue === 880);
  e = c.overviewEarning('2026-11-20', '11:00');
  check('during a block, the step is to work now', e.status === 'now' && e.block.id === 'work1');
  e = c.overviewEarning('2026-11-20', '14:20');
  check('between blocks, the next one leads', e.status === 'next' && e.block.id === 'work2' && e.laterToday.length === 0);
  e = c.overviewEarning('2026-11-20', '20:00');
  check('after work on Friday, it points to Monday, not to a problem', e.status === 'later' && e.date === '2026-11-23' && e.block.id === 'work1');

  c.addHomeHours(12, '2026-11-19');
  c.addHomeHours(3, '2026-11-20');
  e = c.overviewEarning('2026-11-20', '14:20');
  check('hours count toward the next pay', e.blockDone === 15 && e.hoursToPay === 25 && e.payValue === 4400 && e.loggedToday === 3);

  const data = c.overviewData('2026-11-20');
  check('money I have is all the boxes together', data.total === 1900 && data.boxes.find(box => box.id === 'debt').balance === -225);
  check('coming up shows the next three, soonest first', data.bills.map(item => item.bill.id).join() === 'wifi,tooth,sara' && data.billsCount === 4 && data.billsTotal === 4890);
  check('home shows what is ready', data.home.ready === 1500 && data.home.need === 7100);

  c.renderOverview();
  const html = h.getEl('#overviewCards').innerHTML;
  const top = html.slice(0, html.indexOf('Money I have'));
  check('the earning card comes first on the page', top.includes('it brings in money'));
  check('no payment is ever the headline', !top.includes('Wi-Fi') && !top.includes('Pay '));
  check('the pay ahead is shown as the reason', top.includes('to your next pay') && top.includes('4,400 MAD'));
  check('logging hours is one tap away', top.includes('data-focus="#homeHoursInput"'));
  check('all five cards follow', ['Money I have', 'Coming up', 'Home first', 'Pay back', 'Today'].every(label => html.includes(label)));
  check('a box below zero is explained, not alarmed', html.includes('borrowed from the others'));
}

{
  // What counts as earning is the user's choice.
  const h = scenario();
  const c = h.ctx;
  const items = h.api.state.routine.items;
  check('the two work blocks start as earning, nothing else does', items.filter(item => item.earns).map(item => item.id).join() === 'work1,work2');
  c.saveRoutineItem('new', { title: 'Driving', start: '20:00', end: '23:00', days: [6, 7], monthDay: 0, page: '', note: '', earns: true });
  const e = c.overviewEarning('2026-11-21', '12:00');
  check('an item marked as bringing in money leads on its day', e.status === 'next' && e.block.title === 'Driving');
  items.forEach(item => { item.earns = false; });
  check('with nothing marked, it asks to mark something', c.overviewEarning('2026-11-20', '09:00').status === 'none');
  c.renderOverview();
  check('and the page still opens', h.getEl('#overviewCards').innerHTML.includes('Mark what brings in money'));
}

{
  // A new user: a calm first screen, never an empty or broken one.
  const h = load();
  h.ctx.renderOverview();
  const html = h.getEl('#overviewCards').innerHTML;
  check('work leads even before money is set up', html.includes('it brings in money') && !html.includes('to your next pay'));
  check('empty cards say how to start', html.includes('Add your bills') && html.includes('Not set yet') && html.includes('No one on the list'));
}

done();

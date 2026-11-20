// Overview: the first page leads with one action, then shows where you stand.
const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

function scenario() {
  const h = load();
  const st = h.api.state;
  const c = h.ctx;
  st.settings.boxesSince = '2026-11-01';
  st.settings.keepForLiving = 700;
  c.setHomeSettings({ target: 7100 }, '2026-11-17');
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
  const h = scenario();
  const c = h.ctx;
  const steps = c.overviewSteps('2026-11-20');
  check('the first step is an action: pay what is due today', steps[0].kind === 'bill' && steps[0].text === 'Pay Wi-Fi (last month): 400 MAD');
  check('every step is something to do and names where to do it', steps.every(step => Boolean(step.text && step.tab)));
  check('then what is coming this week', steps[1].kind === 'soon' && steps[1].text.includes('Tooth medicine') && steps[1].detail.includes('2,750'));
  check('then writing down today, when nothing was entered today', steps[2].kind === 'log');
  check('pay back waits while home is not set aside', !steps.some(step => step.kind === 'payback') && steps.some(step => step.kind === 'aside'));

  const data = c.overviewData('2026-11-20');
  check('money I have is all the boxes together', data.total === 1900 && data.boxes.find(box => box.id === 'debt').balance === -225);
  check('coming up shows the next three, soonest first', data.bills.map(item => item.bill.id).join() === 'wifi,tooth,sara' && data.billsCount === 4 && data.billsTotal === 4890);
  check('home shows what is ready', data.home.ready === 1500 && data.home.need === 7100);

  c.renderOverview();
  const html = h.getEl('#overviewCards').innerHTML;
  check('the action card comes first on the page', html.indexOf('Do this next') >= 0 && html.indexOf('Do this next') < html.indexOf('Money I have'));
  check('all five cards are there', ['Money I have', 'Coming up', 'Home first', 'Pay back', 'Today'].every(label => html.includes(label)));
  check('a box below zero is explained, not alarmed', html.includes('borrowed from the others'));
}

{
  // On the 1st with money ready, going home comes before everything else.
  const h = scenario();
  const steps = h.ctx.overviewSteps('2026-12-01');
  check('on the 1st, the first step is giving at home', steps[0].kind === 'home' && steps[0].text === 'Give 1,500 MAD at home');
  check('late bills follow it', steps[1].kind === 'bill');
}

{
  // Nothing set up: a calm first screen, never an empty or broken one.
  const h = load();
  const steps = h.ctx.overviewSteps();
  check('a new user is asked for one small thing', steps[0].kind === 'log');
  h.ctx.renderOverview();
  const html = h.getEl('#overviewCards').innerHTML;
  check('empty cards say how to start', html.includes('Add your bills') && html.includes('Not set yet') && html.includes('No one on the list'));

  h.api.state.transactions.push({ id: 'x', type: 'expense', amount: 10, date: h.api.today(), envelopeId: 'personal', note: 'Tea' });
  check('with nothing waiting, it says so', h.ctx.overviewSteps()[0].kind === 'clear');
}

done();

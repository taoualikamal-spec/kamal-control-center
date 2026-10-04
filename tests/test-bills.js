const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

// A realistic week: rent and electricity due soon, a friend owed money from
// yesterday, internet due later in the month.
function setup(h) {
  const { api } = h;
  const T = api.today();
  api.state.bills = [
    { id: 'rent', name: 'Rent', amount: 3000, dueDate: api.shiftDate(T, 2), envelopeId: 'family', monthly: true, priority: 'live' },
    { id: 'elec', name: 'Electricity', amount: 400, dueDate: api.shiftDate(T, 3), envelopeId: 'family', monthly: true, priority: 'live' },
    { id: 'friend', name: 'Money owed to a friend', amount: 1000, dueDate: api.shiftDate(T, -1), envelopeId: 'debt', monthly: false, priority: 'other' },
    { id: 'net', name: 'Internet', amount: 200, dueDate: api.shiftDate(T, 20), envelopeId: 'family', monthly: true, priority: 'live' }
  ];
  return T;
}
const incomeEvent = { preventDefault() {}, target: { reset() {} } };
function receive(h, amount, source = 'Client') {
  h.getEl('#incomeAmount').value = String(amount);
  h.getEl('#incomeDate').value = h.api.today();
  h.getEl('#incomeSource').value = source;
  h.ctx.addIncome(incomeEvent);
}

// ---------------- no bills: exactly the old behaviour ----------------
{
  const h = load();
  receive(h, 1000);
  const income = h.api.state.transactions.find(t => t.type === 'income');
  const sum = Object.values(income.allocations).reduce((a, b) => a + b, 0);
  check('no bills: whole amount is split, as before', sum === 1000 && h.api.state.transactions.length === 1);
  check('no bills: family still gets 60%', income.allocations.family === 600);
}

// ---------------- suggestions: triage order ----------------
{
  const h = load(); setup(h);
  const ids = p => Object.keys(p).map(k => k.split('|')[0]);
  const s5000 = h.ctx.suggestedPicks(5000);
  check('suggests late + due-this-week, not the bill due in 20 days', ids(s5000).sort().join() === 'elec,friend,rent');
  check('things needed to live are covered before other debts',
    (() => { const s = h.ctx.suggestedPicks(3400); return ids(s).sort().join() === 'elec,rent'; })());
  const s3200 = h.ctx.suggestedPicks(3200);
  const elecKey = Object.keys(s3200).find(k => k.startsWith('elec'));
  check('part-pays the last one when money runs out', s3200[elecKey] && s3200[elecKey].amount === 200);
  check('stops when the money is gone', Object.keys(h.ctx.suggestedPicks(3000)).length === 1);
  check('nothing suggested with no money', Object.keys(h.ctx.suggestedPicks(0)).length === 0);
}

// ---------------- paying first, splitting the rest ----------------
{
  const h = load(); setup(h);
  receive(h, 5000);
  const tx = h.api.state.transactions;
  const income = tx.find(t => t.type === 'income');
  const payments = tx.filter(t => t.type === 'expense');
  check('three bills paid from the incoming money', payments.length === 3);
  check('payments link back to the bill and the money', payments.every(p => p.billId && p.billMonth && p.fromIncomeId === income.id));
  check('allocations still add up to what arrived', Object.values(income.allocations).reduce((a, b) => a + b, 0) === 5000);
  const split600 = h.ctx.splitIncome(600);
  const metrics = h.ctx.envelopeMetrics();
  check('family box shows only its share of the 600 left, not money already gone', metrics.family.balance === split600.family);
  check('debt box shows only its share of what was left', metrics.debt.balance === split600.debt);
  check('debt paid counts the friend payment', h.ctx.debtPaidTotal() === 1000);
  const left = h.ctx.unpaidBills().map(i => i.bill.id);
  check('paid bills leave the still-to-pay list', !left.includes('rent') && !left.includes('elec') && !left.includes('friend'));
  check('the form resets its picks after saving', Object.keys(h.api.picks).length === 0 || !h.api.editingIncome);
}

// ---------------- honesty when money is short ----------------
{
  const h = load(); setup(h);
  h.getEl('#incomeAmount').value = '3000';
  h.ctx.renderIncomePreview();
  const text = h.getEl('#paySummary').innerHTML;
  check('shortfall is stated plainly', text.includes('still waiting'));
  check('shortfall gives the one piece of advice everyone agrees on', text.includes('before the date'));
  check('nothing left to split is described as fine', h.getEl('#splitPreview').innerHTML.includes('that is fine'));
  check('submit label says what will happen', h.getEl('#incomeForm button[type="submit"]').textContent === 'Pay these first, split the rest');

  // user overrides the suggestion with more than they have
  const keys = h.ctx.unpaidBills().map(i => i.key);
  const picks = {}; keys.forEach(k => { picks[k] = { on: true, amount: 5000 }; });
  h.api.setPicks(picks);
  const before = h.api.state.transactions.length;
  receive(h, 3000);
  check('cannot pay out more than arrived', h.api.state.transactions.length === before);
  h.ctx.renderPaySummary(3000);
  check('over-payment is explained, in the warm colour not red', h.getEl('#paySummary').classList.contains('over'));
}

// ---------------- partial payments ----------------
{
  const h = load(); setup(h);
  const elec = h.ctx.unpaidBills().find(i => i.bill.id === 'elec');
  h.api.setPicks({ [elec.key]: { on: true, amount: 150 } });
  receive(h, 150);
  const after = h.ctx.unpaidBills().find(i => i.bill.id === 'elec');
  check('a part payment leaves the rest still to pay', after && after.remaining === 250 && after.paid === 150);
}

// ---------------- monthly logic ----------------
{
  const h = load();
  const T = h.api.today();
  h.api.state.bills = [{ id: 'r', name: 'Rent', amount: 3000, dueDate: '2026-08-05', envelopeId: 'family', monthly: true, priority: 'live' }];
  const inst = h.ctx.billInstances('2026-09-17');
  check('an unpaid monthly bill shows last month and this month', inst.length === 2);
  check('last month is reported as late', h.ctx.dueLabel(inst[0].due, '2026-09-17').includes('late'));

  h.api.state.bills = [{ id: 'r', name: 'Rent', amount: 3000, dueDate: '2026-10-25', envelopeId: 'family', monthly: true, priority: 'live' }];
  check('a bill starting well into next month does not appear yet', h.ctx.billInstances('2026-09-17').length === 0);

  // Month boundary, on fixed dates so the result never depends on when tests run.
  h.api.state.bills = [{ id: 'rent', name: 'Rent', amount: 3000, dueDate: '2026-10-01', envelopeId: 'family', monthly: true, priority: 'live' }];
  check('rent due on the 1st shows on the 28th of the month before', h.ctx.unpaidBills('2026-09-28').length === 1);
  check('and is suggested when money arrives then', Object.keys(h.ctx.suggestedPicks(3000, '2026-09-28')).length === 1);
  check('but a bill due three weeks into next month waits', h.ctx.unpaidBills('2026-09-10').length === 0);
  h.api.state.bills = [{ id: 'rent', name: 'Rent', amount: 3000, dueDate: '2026-08-01', envelopeId: 'family', monthly: true, priority: 'live' }];
  const lateSept = h.ctx.unpaidBills('2026-09-28').map(i => i.due).join();
  check('near month end: last month, this month and next month are all counted once', lateSept === '2026-08-01,2026-09-01,2026-10-01');

  check('a bill due on the 31st falls on the last day of February', h.ctx.billDueIn({ dueDate: '2026-01-31' }, '2026-02') === '2026-02-28');
  check('due labels read naturally',
    h.ctx.dueLabel(T) === 'due today' && h.ctx.dueLabel(h.api.shiftDate(T, 1)) === 'due tomorrow' &&
    h.ctx.dueLabel(h.api.shiftDate(T, 4)) === 'due in 4 days' && h.ctx.dueLabel(h.api.shiftDate(T, -1)) === '1 day late');
}

// ---------------- editing and deleting ----------------
{
  const h = load(); setup(h);
  const unpaidBefore = h.ctx.unpaidBills().map(i => i.key).sort().join();
  receive(h, 5000);
  const income = h.api.state.transactions.find(t => t.type === 'income');

  h.ctx.selectTab('day');
  h.ctx.editTransaction(income.id);
  check('editing money shows the Month page, not a blank screen', h.activePages().join() === 'month');

  h.getEl('#incomeAmount').value = '4000';
  h.ctx.addIncome(incomeEvent);
  check('cannot lower money below the bills it already paid', h.api.state.transactions.find(t => t.id === income.id).amount === 5000);

  h.ctx.editTransaction(income.id);
  h.getEl('#incomeAmount').value = '6000';
  h.ctx.addIncome(incomeEvent);
  const edited = h.api.state.transactions.find(t => t.id === income.id);
  check('raising it re-splits only the new remainder', Object.values(edited.allocations).reduce((a, b) => a + b, 0) === 6000);
  check('bill payments are untouched by the edit', h.api.state.transactions.filter(t => t.fromIncomeId === income.id).length === 3);

  h.ctx.deleteTransaction(income.id);
  check('deleting money also removes the payments made from it', h.api.state.transactions.length === 0);
  check('those bills become unpaid again', h.ctx.unpaidBills().map(i => i.key).sort().join() === unpaidBefore);
}

// ---------------- paying with money already in hand ----------------
{
  const h = load(); setup(h);
  const rent = h.ctx.unpaidBills().find(i => i.bill.id === 'rent');
  h.ctx.markBillPaid(rent.key);
  const payment = h.api.state.transactions.find(t => t.billId === 'rent');
  check('marking paid records the payment from the right box', payment && payment.amount === 3000 && payment.envelopeId === 'family' && !payment.fromIncomeId);
  check('the bill leaves the list', !h.ctx.unpaidBills().some(i => i.bill.id === 'rent'));
  h.ctx.deleteBill('rent');
  check('removing a bill keeps the payment history', h.api.state.transactions.some(t => t.billId === 'rent'));
  h.ctx.deleteTransaction(payment.id);
  check('deleting a payment on its own works', !h.api.state.transactions.some(t => t.billId === 'rent'));
}

// ---------------- old data keeps working ----------------
{
  const seed = {
    version: 1,
    settings: { envelopes: [{ id: 'family', name: 'Family & home', percent: 60, target: 0, color: '#69a9ff' }, { id: 'personal', name: 'Myself', percent: 20, target: 0, color: '#ba9aff' }, { id: 'debt', name: 'Money I owe', percent: 15, target: 0, color: '#ff9b70' }, { id: 'emergency', name: 'Just in case', percent: 5, target: 0, color: '#53d6ad' }], habits: [], substances: [], debtTotal: 45000, dailyFocusTarget: 120 },
    transactions: [{ id: 'old', type: 'income', amount: 1000, date: new Date().toISOString().slice(0, 8) + '01', source: 'Old', note: '', allocations: { family: 600, personal: 200, debt: 150, emergency: 50 } }],
    timeEntries: [], cravings: [], days: {}, activeTimer: null
  };
  const h = load(seed);
  check('data saved before bills existed loads with an empty bills list', Array.isArray(h.api.state.bills) && h.api.state.bills.length === 0);
  h.ctx.renderTransactions();
  check('old money rows still show their split', h.getEl('#transactionRows').innerHTML.includes('60%'));
}

done();

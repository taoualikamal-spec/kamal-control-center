const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

const bill = (id, name, amount, days, priority, envelopeId, api) => ({
  id, name, amount, dueDate: api.shiftDate(api.today(), days),
  envelopeId, monthly: false, priority
});

// ---------------- the real case: 3,700 from Simon ----------------
{
  const h = load();
  const { api, ctx, getEl } = h;
  api.state.settings.keepForLiving = 1500;
  api.state.bills = [
    bill('fuel', 'Fuel and InDrive', 200, 0, 'earn', 'personal', api),
    bill('zak', 'Zakaria Alaoui', 3500, 7, 'other', 'debt', api),
    bill('ous', 'Oussama', 300, 14, 'other', 'debt', api),
    bill('abdo', 'Abdo', 500, 14, 'other', 'debt', api)
  ];

  const picks = ctx.suggestedPicks(3700);
  const paid = k => (picks[Object.keys(picks).find(key => key.startsWith(k))] || {}).amount || 0;
  check('fuel is paid in full, first', paid('fuel') === 200);
  check('Zakaria gets 2,000, not the whole 3,500', paid('zak') === 2000);
  check('Oussama and Abdo wait, because their date is further away', paid('ous') === 0 && paid('abdo') === 0);
  const total = Object.values(picks).reduce((a, p) => a + p.amount, 0);
  check('the suggestion spends 2,200 and keeps 1,500', total === 2200 && 3700 - total === 1500);

  getEl('#incomeAmount').value = '3700';
  ctx.renderIncomePreview();
  const text = getEl('#paySummary').innerHTML;
  check('the summary says money was kept for food and fuel', text.includes('food and fuel') && text.includes('1,500'));
  check('and says it was not offered to a debt', text.includes('did not offer it to a debt'));
}

// ---------------- among debts, the nearest date is paid first ----------------
{
  const h = load(); const { api, ctx } = h;
  api.state.settings.keepForLiving = 0;
  api.state.bills = [
    bill('far', 'Owed, later this week', 500, 6, 'other', 'debt', api),
    bill('near', 'Owed, tomorrow', 500, 1, 'other', 'debt', api)
  ];
  const picks = ctx.suggestedPicks(500);
  const paid = k => (picks[Object.keys(picks).find(key => key.startsWith(k))] || {}).amount || 0;
  check('the debt due soonest is paid first', paid('near') === 500 && paid('far') === 0);
}

// ---------------- the reserve only holds back from debts ----------------
{
  const h = load(); const { api, ctx } = h;
  api.state.settings.keepForLiving = 1000;
  api.state.bills = [
    bill('rent', 'Rent', 900, 1, 'live', 'family', api),
    bill('fuel', 'Fuel', 200, 0, 'earn', 'personal', api),
    bill('friend', 'A friend', 900, 2, 'other', 'debt', api)
  ];
  const picks = ctx.suggestedPicks(1500);
  const paid = k => (picks[Object.keys(picks).find(key => key.startsWith(k))] || {}).amount || 0;
  check('what earns money is paid before what you live on', paid('fuel') === 200);
  check('rent is still paid even though it eats the kept money', paid('rent') === 900);
  check('the debt gets nothing, because only 400 is left under the reserve', paid('friend') === 0);
}

// ---------------- the reserve can be partly spendable ----------------
{
  const h = load(); const { api, ctx } = h;
  api.state.settings.keepForLiving = 500;
  api.state.bills = [bill('friend', 'A friend', 2000, 1, 'other', 'debt', api)];
  const picks = ctx.suggestedPicks(1200);
  check('a debt may use everything above the kept amount', Object.values(picks)[0].amount === 700);
}

// ---------------- reserve off = the old behaviour ----------------
{
  const h = load(); const { api, ctx } = h;
  api.state.settings.keepForLiving = 0;
  api.state.bills = [bill('friend', 'A friend', 2000, 1, 'other', 'debt', api)];
  check('with the reserve at 0, nothing is held back', Object.values(ctx.suggestedPicks(1200))[0].amount === 1200);
  api.state.settings.keepForLiving = 5000;
  check('a reserve bigger than the money suggests no debts at all', Object.keys(ctx.suggestedPicks(1200)).length === 0);
}

// ---------------- ordering across the three levels ----------------
{
  const h = load(); const { api, ctx } = h;
  api.state.settings.keepForLiving = 0;
  api.state.bills = [
    bill('other', 'Money I owe', 100, 0, 'other', 'debt', api),
    bill('live', 'Electricity', 100, 0, 'live', 'family', api),
    bill('earn', 'Fuel', 100, 0, 'earn', 'personal', api)
  ];
  const picks = ctx.suggestedPicks(200);
  const paid = k => (picks[Object.keys(picks).find(key => key.startsWith(k))] || {}).amount || 0;
  check('earn comes first, then live, then the rest', paid('earn') === 100 && paid('live') === 100 && paid('other') === 0);
}

// ---------------- older bills keep working ----------------
{
  const seed = {
    version: 1,
    settings: { envelopes: [{ id: 'family', name: 'Family & home', percent: 60, target: 0, color: '#69a9ff' }, { id: 'personal', name: 'Myself', percent: 20, target: 0, color: '#ba9aff' }, { id: 'debt', name: 'Money I owe', percent: 15, target: 0, color: '#ff9b70' }, { id: 'emergency', name: 'Just in case', percent: 5, target: 0, color: '#53d6ad' }], habits: [], substances: [], debtTotal: 45000, dailyFocusTarget: 120 },
    bills: [
      { id: 'a', name: 'Rent', amount: 900, dueDate: '2026-09-01', envelopeId: 'family', monthly: true, essential: true },
      { id: 'b', name: 'A friend', amount: 500, dueDate: '2026-09-01', envelopeId: 'debt', monthly: false, essential: false },
      { id: 'c', name: 'Old one', amount: 100, dueDate: '2026-09-01', envelopeId: 'family', monthly: false }
    ],
    transactions: [], timeEntries: [], cravings: [], days: {}, activeTimer: null
  };
  const h = load(seed);
  const byId = id => h.api.state.bills.find(b => b.id === id).priority;
  check('old "needed to live" becomes to-live', byId('a') === 'live');
  check('old "not needed to live" becomes something else', byId('b') === 'other');
  check('a bill with no flag at all defaults to to-live', byId('c') === 'live');
  check('the reserve defaults to 0 for existing users', h.api.state.settings.keepForLiving === 0);
}

done();

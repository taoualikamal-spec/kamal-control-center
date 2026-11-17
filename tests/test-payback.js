// Pay back in order: the list keeps your order, ticking is reversible,
// "own plan" items stay out of the order, and pasted lists are read
// the way people actually write them.
const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

{
  const h = load();
  const c = h.ctx;
  const items = c.parsePaybackLines([
    'Amine 300',
    'Karim Bennani: 1,000 dh',
    'Nadia 2900 (paid 600 of 3500)',
    'Car rental agency 3400 own plan',
    'not a debt line',
    ''
  ].join('\n'));
  check('reads four real lines and skips the rest', items.length === 4);
  check('keeps a two-word name', items[1].name === 'Karim Bennani' && items[1].amount === 1000);
  check('ignores notes in brackets', items[2].name === 'Nadia' && items[2].amount === 2900);
  check('"own plan" keeps a line out of the order', items[3].separate === true && items[3].name === 'Car rental agency');
}

{
  const h = load();
  const c = h.ctx;
  const s = () => h.api.state;
  check('a new phone starts with an empty list', Array.isArray(s().payback) && s().payback.length === 0);

  const added = c.addPaybackItems(c.parsePaybackLines('Amine 300\nSara 300\nYoussef 600\nCar agency 3400 own plan'));
  check('adds every pasted line', added === 4);
  check('does not add the same name twice', c.addPaybackItems([{ name: 'amine', amount: 300 }]) === 0);

  let sum = c.paybackSummary();
  check('totals everything owed', sum.total === 4600 && sum.left === 4600);
  check('the first in order is next', sum.next.name === 'Amine');
  check('own-plan items are never "next"', sum.inOrder.length === 3 && sum.separate.length === 1);

  const amine = s().payback[0];
  c.setPaybackPaid(amine.id, true, '2026-11-10');
  sum = c.paybackSummary();
  check('ticking moves "next" down the list', sum.next.name === 'Sara');
  check('ticking counts the person and the money', sum.paidCount === 1 && sum.paidAmount === 300 && sum.left === 4300);
  check('the paid date is kept', s().payback[0].paidOn === '2026-11-10');

  c.setPaybackPaid(amine.id, false);
  sum = c.paybackSummary();
  check('unticking puts it back, nothing else changes', sum.paidCount === 0 && sum.next.name === 'Amine' && sum.left === 4600);

  const youssef = s().payback.find(item => item.name === 'Youssef');
  c.movePayback(youssef.id, -1);
  check('moving up changes the order', s().payback[1].name === 'Youssef' && s().payback[2].name === 'Sara');
  check('cannot move the first one higher', c.movePayback(s().payback[0].id, -1) === false);

  c.removePayback(youssef.id);
  check('removing takes it off the list', !s().payback.some(item => item.name === 'Youssef'));
}

{
  // Lists saved by an older version, or a backup with odd values, still load.
  const h = load({ settings: { envelopes: [] }, transactions: [], payback: [{ name: '  Omar ', amount: '6500.4' }, { name: '' }, null] });
  const list = h.api.state.payback;
  check('old or messy saved lists are cleaned on load', list.length === 1 && list[0].name === 'Omar' && list[0].amount === 6500 && list[0].id && list[0].paidOn === null);
}

{
  // Paying in parts, and Money out kept in step.
  const h = load();
  const c = h.ctx;
  const s = () => h.api.state;
  c.addPaybackItems(c.parsePaybackLines('Amine 300\nNadia 3500\nOmar 6500'));
  const nadia = s().payback[1];
  c.setPaybackPaid(s().payback[0].id, true, '2026-11-10');
  check('a tick is also money out of the "Money I owe" box', s().transactions.some(entry => entry.type === 'expense' && entry.envelopeId === 'debt' && entry.amount === 300));

  const part = c.payPayback(nadia.id, 600, '2026-11-12');
  let sum = c.paybackSummary();
  check('a part payment lowers what is left', c.paybackLeftOf(nadia) === 2900 && sum.paidAmount === 900 && sum.left === 9400);
  check('a part payment does not mark the person as paid', sum.paidCount === 1 && sum.next.name === 'Nadia' && nadia.paidOn === null);
  const out = s().transactions.find(entry => entry.id === part.transactionId);
  check('the part shows in Money out with the name', out && out.amount === 600 && out.note === 'Paid back: Nadia' && out.envelopeId === 'debt');
  check('you cannot pay more than is left', c.payPayback(nadia.id, 99999, '2026-11-13').amount === 2900 && nadia.paidOn === '2026-11-13');
  check('paying the last part marks the person as paid', c.paybackSummary().paidCount === 2);

  c.setPaybackPaid(nadia.id, false);
  check('unticking keeps parts that were typed in', c.paybackLeftOf(nadia) === 0 && nadia.payments.length === 2);
  c.removePaybackPart(nadia.id, nadia.payments[1].id);
  check('removing a part puts it back, and out of Money out', c.paybackLeftOf(nadia) === 2900 && nadia.paidOn === null && s().transactions.filter(entry => entry.paybackItemId === nadia.id).length === 1);
  c.setPaybackPaid(nadia.id, true, '2026-11-20');
  check('a tick after a part pays only what is left', nadia.payments[1].amount === 2900 && nadia.payments[1].full === true);
  c.setPaybackPaid(nadia.id, false);
  check('unticking then undoes only the tick', nadia.payments.length === 1 && c.paybackLeftOf(nadia) === 2900);

  // Changes made in Money out flow back.
  out.amount = 1000;
  c.syncPaybackFromTransactions();
  check('changing the amount in Money out changes the part', c.paybackLeftOf(nadia) === 2500);
  c.deleteTransaction(out.id);
  check('deleting it in Money out removes the part', nadia.payments.length === 0 && c.paybackLeftOf(nadia) === 3500);

  // Editing a name or total.
  check('a name cannot clash with someone else', c.editPayback(nadia.id, { name: 'omar', amount: 3500 }) === null);
  c.editPayback(nadia.id, { name: 'Nadia B', amount: 3000 });
  check('the name and total can be changed', nadia.name === 'Nadia B' && c.paybackLeftOf(nadia) === 3000);
  c.payPayback(nadia.id, 1000, '2026-11-21');
  c.editPayback(nadia.id, { amount: 1000 });
  check('lowering the total to what was paid finishes the debt', nadia.paidOn === '2026-11-21' && c.paybackSummary().next.name === 'Omar');
}

{
  // Ticked before parts existed: still paid, and unticking still works.
  const h = load({ settings: { envelopes: [] }, transactions: [], payback: [{ id: 'p1', name: 'Karim', amount: 1000, paidOn: '2026-11-01' }] });
  const c = h.ctx;
  const item = h.api.state.payback[0];
  check('an old tick counts as paid in full', c.paybackLeftOf(item) === 0 && c.paybackSummary().paidAmount === 1000);
  c.setPaybackPaid('p1', false);
  check('an old tick can be undone', item.paidOn === null && c.paybackLeftOf(item) === 1000);
}

{
  const h = load();
  h.ctx.showTab('day');
  h.ctx.selectTab('payback');
  check('the Pay back page opens', h.activePages().join() === 'payback');
  check('the Month tab stays lit inside it', h.litTab() === 'month');
}

done();

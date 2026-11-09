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
  const h = load();
  h.ctx.showTab('day');
  h.ctx.selectTab('payback');
  check('the Pay back page opens', h.activePages().join() === 'payback');
  check('the Month tab stays lit inside it', h.litTab() === 'month');
}

done();

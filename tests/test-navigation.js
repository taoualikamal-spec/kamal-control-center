// Navigation: the phone's back button must walk back through the app,
// the address must name the page, and a page opened from Day must keep
// the Day tab lit so you can see where you are.
const { load, reporter } = require('./harness-lib.js');
const { check, done } = reporter();

// The stub location has no real hash, so give it one that behaves like a
// browser's: setting it fires hashchange, and back/forward replay history.
function browser(h) {
  const history = [''];
  let at = 0;
  const listeners = [];
  Object.defineProperty(h.ctx.location, 'hash', {
    get: () => history[at],
    set: value => {
      const next = value.startsWith('#') ? value : '#' + value;
      if (next === history[at]) return;
      history.length = at + 1;
      history.push(next);
      at = history.length - 1;
      listeners.forEach(fn => fn());
    },
    configurable: true
  });
  h.ctx.addEventListener = (name, fn) => { if (name === 'hashchange') listeners.push(fn); };
  return {
    back: () => { if (at > 0) { at -= 1; listeners.forEach(fn => fn()); } },
    forward: () => { if (at < history.length - 1) { at += 1; listeners.forEach(fn => fn()); } },
    entries: () => history.length
  };
}

{
  const h = load();
  const nav = browser(h);
  h.ctx.registerEvents();          // re-register so hashchange is captured
  const page = () => h.activePages().join();

  check('starts on Day', (h.ctx.showTab('day'), page() === 'day'));

  h.ctx.selectTab('month');
  check('moving to Month shows Month', page() === 'month');
  check('the address names the page', h.ctx.location.hash === '#month');

  h.ctx.selectTab('time');
  check('moving on to Time shows Time', page() === 'time');

  nav.back();
  check('back returns to Month', page() === 'month');
  nav.back();
  check('back again returns to Day', page() === 'day');
  nav.forward();
  check('forward goes to Month again', page() === 'month');
}

{
  const h = load();
  browser(h);
  h.ctx.registerEvents();
  // A page opened from Day keeps the Day tab lit, since it has no tab of its own.
  h.ctx.selectTab('body');
  check('Waiting is reachable', h.activePages().join() === 'body');
  check('inside Waiting, the Day tab stays lit', h.litTab() === 'day');

  h.ctx.selectTab('time');
  check('inside Time, the Day tab stays lit', h.litTab() === 'day');

  h.ctx.selectTab('settings');
  check('Settings lights its own tab', h.litTab() === 'settings');
}

{
  const h = load();
  const nav = browser(h);
  h.ctx.registerEvents();
  // Opening the app straight at an address lands on that page.
  h.ctx.location.hash = '#year';
  check('a saved address opens that page', h.activePages().join() === 'year');
  h.ctx.location.hash = '#nonsense';
  check('an address that means nothing falls back to Day', h.ctx.tabFromHash() === 'day');
}

{
  const h = load();
  browser(h);
  h.ctx.registerEvents();
  // Each page remembers where you were reading.
  h.ctx.selectTab('day');
  h.ctx.window.scrollY = 400;
  h.ctx.selectTab('month');
  h.ctx.window.scrollY = 0;
  let landedAt = null;
  h.ctx.window.scrollTo = opts => { landedAt = opts.top; };
  h.ctx.selectTab('day');
  check('coming back to a page returns to where you were', landedAt === 400);
  landedAt = null;
  h.ctx.selectTab('day');
  check('arriving where you already are changes nothing', landedAt === null);
  h.ctx.openTab('day');
  check('tapping the tab you are on goes to the top', landedAt === 0);
}

done();

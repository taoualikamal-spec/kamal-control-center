// Loads insights.js + app.js into a VM with a stub DOM, so app logic can be
// exercised without a browser. Module-level `let` bindings are exposed via __api.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..') + path.sep;

function load(seed) {
  let code = fs.readFileSync(ROOT + 'insights.js', 'utf8') + ';\n' + fs.readFileSync(ROOT + 'app.js', 'utf8');
  code += `\n;globalThis.__api = {
    get state() { return state; },
    today, monthKey, shiftDate, shiftMonth,
    get picks() { return payPicks; },
    setPicks(value) { payPicks = value; payPicksTouched = true; },
    get editingIncome() { return editingIncomeId; }
  };`;
  const store = seed ? { 'kamal-control-center.v1': JSON.stringify(seed) } : {};
  const elems = new Map();
  const makeEl = () => ({
    value: '', textContent: '', innerHTML: '', checked: false, hidden: false, disabled: false, open: false,
    dataset: {}, style: {}, options: [], selectedIndex: 0, files: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { const want = on === undefined ? !this._s.has(c) : on; want ? this._s.add(c) : this._s.delete(c); return want; }, contains(c) { return this._s.has(c); } },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    focus() {}, reset() {}, appendChild() {}, click() {}, closest() { return null; }, matches() { return false; }
  });
  const getEl = sel => { if (!elems.has(sel)) elems.set(sel, makeEl()); return elems.get(sel); };
  // Real page elements, so tests can see which page selectTab actually shows.
  const pages = ['day', 'month', 'year', 'time', 'body', 'settings'].map(id => Object.assign(makeEl(), { id }));
  // Real nav items too, so tests can see which tab is lit.
  const navItems = ['day', 'month', 'year', 'settings'].map(tab => {
    const el = makeEl(); el.dataset.tab = tab; return el;
  });
  const queryAll = sel => (sel === '.page' ? pages : sel === '.nav-item' ? navItems : []);
  const ctx = {
    console, Intl, Date, Math, JSON, structuredClone, Array, Object, String, Number, Boolean, Set, Map,
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => 0,
    crypto: { randomUUID: () => 'id-' + Math.random().toString(16).slice(2) },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: {}, location: { protocol: 'file:', hostname: '' },
    document: { querySelector: getEl, querySelectorAll: queryAll, addEventListener() {}, createElement: makeEl, documentElement: { dataset: {} } },
    URL: { createObjectURL: () => 'b', revokeObjectURL() {} }, Blob: function () {}, Notification: undefined,
    confirm: () => true,
    scrollTo() {}
  };
  ctx.addEventListener = () => {};
  ctx.window = ctx;
  ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  ctx.globalThis = ctx;
  getEl('#timerType').value = 'focus';
  getEl('#timeType').value = 'stolen';
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const activePages = () => pages.filter(page => page.classList.contains('active')).map(page => page.id);
  const litTab = () => (navItems.find(item => item.classList.contains('active')) || {}).dataset?.tab || '';
  return { ctx, getEl, api: ctx.__api, store, activePages, litTab };
}

function reporter() {
  const results = [];
  return {
    check: (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}`),
    done: () => {
      console.log(results.join('\n'));
      const failed = results.filter(r => r.startsWith('FAIL')).length;
      console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nALL ${results.length} PASS`);
      process.exitCode = failed ? 1 : 0;
    }
  };
}

module.exports = { load, reporter };

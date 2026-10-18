import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.className = ''; this.innerHTML = ''; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getContext() { return {}; }
  remove() { this.removed = true; }
  querySelector(selector) { return selector === 'details' ? this.children.find((x) => x.tag === 'details') : null; }
  insertAdjacentHTML(_where, html) { this.inserted = html; }
}

const charts = [];
class StubChart {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.destroyed = false;
    charts.push(this);
  }
  destroy() { this.destroyed = true; }
}

const context = {
  window: {}, Chart: StubChart,
  document: { createElement: (tag) => new Element(tag) },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
};
vm.runInNewContext(await readFile(new URL('../site/charts.js', import.meta.url), 'utf8'), context);
const api = context.window.MetaCharts;
assert.deepEqual(Object.keys(api).sort(), ['destroy', 'destroyAll', 'scatter', 'trend']);

const track = {
  months: ['2026-01', '2026-02', '2026-03', '2026-04'],
  segments: [{ regulation: 'A' }, { regulation: 'A' }, { regulation: 'B' }, { regulation: 'B' }],
  usage_grouped: { Alpha: [0.2, 0.22, 0.25, 0.3], Beta: [0.1, null, 0.12, 0.15] },
};
const trendEl = new Element();
assert.deepEqual(Array.from(api.trend(trendEl, track, { name: (id) => id, short: (id) => id })), ['Alpha', 'Beta']);
const trendChart = charts.at(-1);
assert.equal(trendChart.config.data.datasets[1].data[1], null, 'missing monthly values remain gaps');
assert.equal(trendChart.config.data.datasets[0].segment.borderColor({ p1DataIndex: 2 }), 'transparent', 'regulation boundary is not connected');
assert.equal(trendChart.config.data.datasets[0].segment.borderColor({ p1DataIndex: 3 }), '#2563eb');
assert.equal(trendChart.config.options.animation, false);
assert.equal(trendChart.config.options.resizeDelay, 0, 'destroy後に遅延更新を残さない');

const weekly = { available: true, recent: { pokemon: {
  Alpha: { usage: 0.2, bring: 0.75, bring_ci: [0.7, 0.8], teams: 1234, games: 90, win_shrunk: 0.57 },
  Beta: { usage: 0.1, bring: 0.5, bring_ci: [0.4, 0.6], teams: 432, games: 20, win_shrunk: 0.52 },
} } };
const scatterEl = new Element();
let clicked = null;
api.scatter(scatterEl, weekly, { name: (id) => id, short: (id) => id, link: (id) => { clicked = id; } });
const scatterChart = charts.at(-1);
const tooltip = scatterChart.config.options.plugins.tooltip.callbacks.label({ dataIndex: 0 });
assert.ok(tooltip.join(' ').includes('70%〜80%'), 'tooltip preserves confidence interval');
assert.ok(tooltip.join(' ').includes('1234 チーム'), 'tooltip preserves sample count');
assert.ok(tooltip.join(' ').includes('90 戦'), 'tooltip preserves battle count');
assert.ok(scatterEl.children[1].innerHTML.includes('70%〜80%'), 'accessible table preserves confidence interval');
assert.ok(scatterEl.children[1].innerHTML.includes('1234'), 'accessible table preserves sample count');
assert.equal(scatterChart.config.plugins[0].id, 'metaScatterLabels');
scatterChart.config.options.onClick({}, [{ index: 0 }]);
assert.equal(clicked, 'Alpha');

api.scatter(scatterEl, weekly);
assert.equal(scatterChart.destroyed, true, 'rerender destroys the previous Chart instance');
const replacement = charts.at(-1);
api.destroy(scatterEl);
assert.equal(replacement.destroyed, true, 'explicit destroy releases the Chart instance');
api.trend(trendEl, track);
api.scatter(scatterEl, weekly);
const active = charts.filter((chart) => !chart.destroyed);
assert.equal(active.length, 2);
api.destroyAll();
assert.ok(active.every((chart) => chart.destroyed), 'route cleanup releases every live Chart instance');

console.log('ui charts stub checks passed');

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
function extractFunction(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `関数 ${name} をソースから見つける`);
  return match[0];
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('loadSpeed は取得開始時の view にだけ結果を保存する', async () => {
  const pending = deferred();
  const first = { f: { id: 'first' } };
  const second = { f: { id: 'second' } };
  const context = { view: first, getJSON: () => pending.promise };
  runInNewContext(extractFunction('loadSpeed'), context);
  const result = context.loadSpeed();
  context.view = second;
  pending.resolve({ source: 'first' });
  assert.deepEqual(await result, { source: 'first' });
  assert.deepEqual(first.speed, { source: 'first' });
  assert.equal(second.speed, undefined);
});

test('loadInduce は取得開始時の view にだけ結果を保存する', async () => {
  const pending = deferred();
  const first = { f: { id: 'first' } };
  const second = { f: { id: 'second' } };
  const context = { view: first, getJSON: () => pending.promise };
  runInNewContext(extractFunction('loadInduce'), context);
  const result = context.loadInduce();
  context.view = second;
  pending.resolve({ source: 'first' });
  assert.deepEqual(await result, { source: 'first' });
  assert.deepEqual(first.induce, { source: 'first' });
  assert.equal(second.induce, undefined);
});

test('loadToolData はルート切替後も取得結果を元の view に保存する', async () => {
  const pending = deferred();
  const first = { f: { id: 'first', replay_days: 1, team_select: true }, mo: {} };
  const second = { f: { id: 'second' }, mo: {} };
  const context = {
    view: first,
    getJSON: (path) => path === 'dex.json' ? Promise.resolve({})
      : path === 'select/first.json' ? pending.promise : Promise.resolve({}),
  };
  runInNewContext(`let DEX = null; ${extractFunction('loadToolData')}`, context);
  const result = context.loadToolData();
  await Promise.resolve();
  context.view = second;
  pending.resolve({ trained: true });
  const target = await result;
  assert.equal(target, first);
  assert.deepEqual(first.sel, { trained: true });
  assert.equal(second.sel, undefined);
});

test('runSelect は演出待ちの間にルートが変わると描画を中断する', async () => {
  let release;
  const classes = () => ({ add() {}, remove() {} });
  const items = Array.from({ length: 4 }, () => ({ classList: classes() }));
  const out = {
    classList: classes(),
    querySelectorAll: () => items,
    set innerHTML(value) { this.html = value; },
    offsetWidth: 0,
  };
  const first = { f: { id: 'first' } };
  let renderCalls = 0;
  const context = {
    routeRevision: 3,
    view: first,
    TEAM: { opp: ['a'], mine: ['b'] },
    SEL_RUN: null,
    SEL_STEPS: ['a', 'b', 'c', 'd'],
    selSig: () => `${context.view.f.id}|a|b`,
    $: () => out,
    matchMedia: () => ({ matches: false }),
    setTimeout: (callback) => { release = callback; return 0; },
    renderSelect: async () => { renderCalls++; },
  };
  runInNewContext(extractFunction('runSelect'), context);
  const run = context.runSelect();
  await new Promise((resolve) => setImmediate(resolve));
  context.routeRevision++;
  release();
  await run;
  assert.equal(renderCalls, 0);
  assert.equal(context.SEL_RUN, null);
});

test('readHash は壊れたパーセントエンコードでも例外を投げない', () => {
  const context = { location: { hash: '#%E0%A4%A' }, URLSearchParams };
  runInNewContext(extractFunction('readHash'), context);
  assert.doesNotThrow(() => context.readHash());
});

test('起動時の取得失敗からはページを再読込して画面構造も復元する', async () => {
  let retry;
  let reloads = 0;
  const grid = { innerHTML: '' };
  const context = {
    setupTheme() {},
    getJSON: async () => { throw new Error('503'); },
    document: { querySelector: () => grid },
    esc: (value) => value,
    $: () => ({ addEventListener: (_event, callback) => { retry = callback; } }),
    location: { reload: () => { reloads++; } },
  };
  runInNewContext(extractFunction('main'), context);
  await context.main();
  assert.match(grid.innerHTML, /再読み込み/);
  retry();
  assert.equal(reloads, 1);
});

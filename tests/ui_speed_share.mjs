import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function spdReadShared(');
const end = source.indexOf('async function spdOpenShare(', start);
assert.ok(start > 0 && end > start);
const api = runInNewContext(`${source.slice(start, end)}\n({read: spdReadShared, url: spdShareURL})`, {
  URL, URLSearchParams,
  location: { href: 'https://champions.fourgetkun.com/?data=../out/#v=speed' },
  view: { f: { id: 'test-format' } },
});
const plain = value => JSON.parse(JSON.stringify(value));

test('共有URLで調整条件を復元し、確認用クエリを公開リンクから除く', () => {
  for (const sign of ['+', '=', '-']) {
    const state = { sign, sp: 17, scarf: true, tw: true };
    const url = new URL(api.url('Pokemon-Mega-X', state));
    assert.equal(url.search, '');
    assert.equal(new URLSearchParams(url.hash.slice(1)).get('p'), 'Pokemon-Mega-X');
    assert.deepEqual(plain(api.read(url.hash, true)), state);
    assert.deepEqual(plain(api.read(url.hash, false)), { ...state, tw: false });
  }
});

test('不正な共有パラメーターを採用しない', () => {
  for (const hash of ['#sp=-1&nature=up', '#sp=33&nature=up', '#sp=NaN&nature=up',
    '#sp=1.5&nature=up', '#sp=&nature=up', '#sp=12&nature=invalid', '#sp=12', '#nature=up']) {
    assert.deepEqual(plain(api.read(hash, true)), {});
  }
  assert.equal(api.read('#sp=0&nature=neutral', true).sp, 0);
  assert.equal(api.read('#sp=32&nature=down', true).sp, 32);
});

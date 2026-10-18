import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
const start = app.indexOf('const spdStat =');
const end = app.indexOf('// 環境全体（姿ごと、使用率で重み付け）', start);
assert.ok(start >= 0 && end > start);
const { split, stat } = runInNewContext(`${app.slice(start, end)}\n({ split: spdMirrorSplit, stat: spdStat })`);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('ミラーの速い・同速・遅いを分け、同速の行動順だけを半分にする', () => {
  assert.deepEqual(plain(split(100, [[90, .2], [100, .5], [110, .3]])),
    { faster: .2, tie: .5, slower: .3, first: .45, available: true });
  assert.equal(split(100, [[100, 1]]).first, .5);
  assert.equal(split(101, [[100, 1]]).first, 1);
  assert.equal(split(99, [[100, 1]]).first, 0);
});

test('丸められた割合を正規化し、分布がないときは比較不可とする', () => {
  const p = split(100, [[90, .3333], [100, .3333], [110, .3333]]);
  assert.ok(Math.abs(p.faster + p.tie + p.slower - 1) < 1e-12);
  assert.equal(p.first, .5);
  assert.equal(split(100, []).available, false);
  assert.equal(split(100, [[90, -1], [100, NaN]]).available, false);
});

test('公開されたすばやさ分布で、ポイントを増やすとミラーの行動順は悪化しない', () => {
  const folder = new URL('../out/speed/', import.meta.url);
  let count = 0;
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(new URL(file, folder), 'utf8'));
    for (const e of Object.values(data.pokemon)) {
      for (const sign of ['=', '+', '-']) {
        let previous = -1;
        for (let points = 0; points <= 32; points++) {
          const p = split(stat(e.base, points, sign), e.dist);
          if (!p.available) continue;
          assert.ok(p.first >= previous - 1e-12 && p.first <= 1 + 1e-12, file);
          previous = p.first;
          count++;
        }
      }
    }
  }
  assert.ok(count > 1000);
});

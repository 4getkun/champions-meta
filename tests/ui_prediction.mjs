import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'site/app.js'), 'utf8');
const start = source.indexOf('// ── 選出予想（docs/DATA_CONTRACT.md');
const end = source.indexOf('async function loadToolData()', start);
assert.ok(start >= 0 && end > start, '選出予測の関数セクションを見つける');
const calculationSource = source.slice(start, end);
const names = JSON.parse(readFileSync(join(root, 'out/names.json'), 'utf8'));
const dex = JSON.parse(readFileSync(join(root, 'out/dex.json'), 'utf8'));
const directory = join(root, 'out/select');
const cases = readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => {
  const value = JSON.parse(readFileSync(join(directory, file), 'utf8'));
  return { file, value };
}).filter(({ value }) => value.available && value.examples?.length);

test(`公開例とブラウザ計算が一致する (${cases.length} ルール)`, () => {
  assert.ok(cases.length > 0, '検証対象の選出予測データがある');
  for (const { file, value } of cases) {
    const context = {
      NAMES: names,
      DEX: dex,
      console: { log() {} },
      poke: (key) => names.pokemon[key] || {},
    };
    const run = `${calculationSource}\nDEX = dexInput; SEL = selectInput; selSelfCheck();`;
    context.dexInput = dex;
    context.selectInput = value;
    const worst = runInNewContext(run, context);
    assert.ok(worst <= 0.00051, `${file}: 最大誤差 ${worst} が丸め許容幅を超過`);
  }
});

# champions-meta

ポケモンチャンピオンズ（Pokémon Showdown の `gen9champions*` ルール）のメタゲームの推移を集計する。
非公式・非商用のファンツール。任天堂・クリーチャーズ・ゲームフリーク・The Pokémon Company とは無関係。

- 計画と参考文献: [docs/PLAN.md](docs/PLAN.md)
- `out/` の JSON の形（デザイン部との約束事）: [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)

## 構成
- **機能部** `src/cmeta/`: 取得・解析・`out/` への書き出し。画面のことは知らない。
- **デザイン部** `site/`（未着手）: `out/` を読んで描くだけ。
- `data/`: リポジトリに入れる縮めたデータ（Smogon の月次統計、リプレイの 1 試合 1 行、日本語名の控え）。
- `.cache/`: 生のファイル（git 管理外）。

## 使い方
```bash
pip install -e ".[dev]"
python -m cmeta fetch-smogon        # まだ持っていない月の Smogon 統計
python -m cmeta fetch-replays       # 新しい公開リプレイ（1 ルール 1,500 件まで）
python -m cmeta build               # out/ を作り直す（--no-names で PokeAPI に問い合わせない）
python -m cmeta all                 # 上の三つ
python -m pytest -q
```
定期実行は `.github/workflows/update.yml`（毎日と毎月 3 日）。

## 手で直すファイル
- `data/name_overrides.json`: 名前の対応が取れないとき。キーは次のとおり。
  - `"species:<showdown id>": "日本語名"`
  - `"slug:<showdown id>": "<PokeAPI の slug>"`
  - `"item:<id>"` / `"move:<id>"` / `"ability:<id>"`: `"日本語名"`
  `out/meta.json` の `warnings` に日本語名の無いものが出る。
- `data/events.json`: レギュレーションの開始日などの出来事。日付が確かなものだけ書く。

## 出典
- Smogon usage statistics — https://www.smogon.com/stats/
- Pokémon Showdown（データとリプレイ、コードは MIT）— https://github.com/smogon/pokemon-showdown
- PokeAPI（BSD-3-Clause）— https://pokeapi.co/ 。取ったものは `data/dex/` に控え、同じものを取りに行かない。
- ポケモンの画像は使わない。

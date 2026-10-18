# champions-meta

ポケモンチャンピオンズ（Pokémon Showdown の `gen9champions*` ルール）のメタゲームの推移を集計する。
非公式・非商用のファンツール。任天堂・クリーチャーズ・ゲームフリーク・The Pokémon Company とは無関係。

- 計画と参考文献: [docs/PLAN.md](docs/PLAN.md)
- `out/` の JSON の形（デザイン部との約束事）: [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)

## 構成
- **機能部** `src/cmeta/`: 取得・解析・`out/` への書き出し。画面のことは知らない。
- **デザイン部** `site/`: `out/` を読んで描くだけ。
- `data/`: リポジトリに入れる縮めたデータ（Smogon の月次統計、リプレイの 1 試合 1 行、日本語名の控え）。
- `.cache/`: 生のファイル（git 管理外）。

## 使い方
```bash
pip install -e ".[dev]"
python -m cmeta fetch-smogon        # まだ持っていない月の Smogon 統計
python -m cmeta fetch-replays       # 新しい公開リプレイ（1 ルール 1,500 件まで）
python -m cmeta fetch-ladder        # 上位 500 人を記録し、25人ずつリプレイを狙って取る（シングル・ダブル）
python -m cmeta build               # out/ を作り直す（--no-names で PokeAPI に問い合わせない）
python -m cmeta all                 # 上の四つ
python -m pytest -q
```
定期実行は Windows タスク `ChampionsMeta-Update`（3 日に 1 回と毎月 3 日）。GitHub Actions の定期取得は停止している。取得先への負荷を抑えるため、リプレイを取るのは今のレギュレーションだけ
（`config.EXTRA_REPLAY_FORMATS`。ダブルは `REPLAY_CAP` を超えたら抜き取り）、ランキング表は週 1 回、リプレイも月次も変わっていないルールの計算は飛ばす（`out/build_inputs.json`）。
一覧の走査も1ルール200ページまでに制限し、残りは次回に続ける。抜き取りは今回走査した区間ごとに等間隔で行う。
上位者のリプレイは1ルール25人ずつ巡回し、詳細取得は150件まで。上位500人のランキング自体は毎回すべて記録する。
一覧はページごとに再開位置を保存し、保留候補がある間は再走査しない。Smogonの月一覧は最新月6時間・過去月7日・空一覧30分キャッシュする。
再計算の判定には入力内容を使い、同じ件数・時刻のデータ修正も検知する。CLIや通信だけの変更では予測モデルを再学習しない。

## 公開
- 公開先: https://champions.fourgetkun.com/ （Cloudflare Pages のプロジェクト `champions-meta` に割り当てたサブドメイン）。
  fourgetkun.com のハブ（fourgetkun-hub）には、トップのカード用の名札 `public/champions-meta/` だけを置いている。
- `python -m cmeta dist` で `dist/`（`site/` の中身 + `out/` を `data/` として + `sitemap.xml`）を作り、
  Windowsの更新タスクが検証後にDirect Uploadする。ハブで使用中のWranglerのOAuth認証を利用する。
- GitHub Actionsは2026年10月31日（JST）まで使用しない。取得・デプロイのworkflowは停止済みで、復旧用に設定だけを残す。
  11月以降も自動では再開せず、利用可能状態と運用方針を確認してから切り替える。

## 運用と復旧

- 更新は3日に1回と毎月3日。画面の最終更新日が7日以上前なら、集計が古いことを表示する。
- 通信に失敗した更新でも、取得済みデータと再開位置は保存する。失敗した実行からは公開しない。
  次の定期実行、または `Start-ScheduledTask -TaskName ChampionsMeta-Update` で再開する。取得状態のファイルを消さない。
  Actionsの取得を復旧用に使う場合はローカルタスクを停止・無効化してから `update data` を有効化する。
- 手元の確認は `pip install -e ".[dev]"` → `python -m pytest -q` → `python -m cmeta dist`。
  フロントの非同期処理・選出予測・ミラーの行動順・グラフは `node --test tests/ui_async_race.mjs tests/ui_prediction.mjs tests/ui_speed.mjs tests/ui_charts.mjs tests/ui_speed_share.mjs` で確認する。
  `dist/` を localhost で開き、環境・ランキング・選出予想・チーム診断・すばやさを確認する。
  予想の成績表は保存時刻以後の試合だけを使い、同日の保存済み予想は変更しない。
- 公開版を戻す場合は Cloudflare Pages の直前の正常なデプロイへロールバックする。
  データの誤りを直す場合は原因の変更を修正し、再集計・確認してから公開する。
- 手元で公開用のものを見る: `python -m cmeta dist` のあと `python -m http.server 8788 --bind 127.0.0.1 --directory dist`。
  `site/` のまま見るときは、リポジトリ直下で `python -m http.server --bind 127.0.0.1` を立てて `/site/?data=../out/`。
- Windows で定期更新する場合は `pwsh -File scripts/register-task.ps1 -WhatIf` で内容を検証し、`pwsh -File scripts/register-task.ps1` で `ChampionsMeta-Update` を登録する。
  JST 04:00 の3日間隔と毎月3日 05:30 に実行し、Python テスト・画面 JavaScript の構文確認・取得と集計・`dist/` 作成・Cloudflare Pages 公開を順に行う。
  `python.exe` が複数ある環境では `-PythonExe "C:\path\python.exe"` で指定する。実行ログはルートの `logs/` に保存する（Git 管理外）。
  登録内容だけを確認する `-WhatIf`、取得を省く `scripts/run-update.ps1 -SkipFetch`、公開を省く `-SkipDeploy` を利用できる。
  PCの電源が入り、登録したユーザーがログインしている間に実行する。未実行分は実行可能になったときに開始する。
  取得→集計→検証→公開は順序依存のため直列実行し、同時実行はタスク設定とmutexで防ぐ。
  通常の詳細取得上限は従来どおり1ルール1,500件（ルール別上限が小さい場合はそちら）。`-MaxReplays`で変更できる。
  OAuthはハブの既存Wranglerを利用する。更新タスクはGit操作をせず、取得済みデータをこのPCに保存して公開する。

## 手で直すファイル
- `data/name_overrides.json`: 名前の対応が取れないとき。キーは次のとおり。
  - `"species:<showdown id>": "日本語名"`
  - `"slug:<showdown id>": "<PokeAPI の slug>"`
  - `"sprite:<showdown id>": "<画像のファイル名>"`（見た目だけの姿。例: `1013-masterpiece`）
  - `"item:<id>"` / `"move:<id>"` / `"ability:<id>"`: `"日本語名"`
  `out/meta.json` の `warnings` に日本語名の無いものが出る。
- `data/events.json`: レギュレーションの開始日などの出来事。日付が確かなものだけ書く。

## 出典
- Smogon usage statistics — https://www.smogon.com/stats/
- グラフ: Chart.js 4.5.1（MIT、`site/vendor/Chart.js-LICENSE.md`）。推移・散布図に使用し、同一ドメインから配信する。
- Pokémon Showdown（データとリプレイ、コードは MIT）— https://github.com/smogon/pokemon-showdown
- PokeAPI（BSD-3-Clause）— https://pokeapi.co/ 。取ったものは `data/dex/` に控え、同じものを取りに行かない。
- 書体: Macの日本語はヒラギノを優先し、それ以外ではZen Kaku Gothic New（400・500・700）を使用。英数はInter（いずれもSIL Open Font License 1.1、google/fonts）。公開用（`python -m cmeta dist`）では、
  使う文字だけに絞って自前で配る（`src/cmeta/fonts.py`。書体の中の著作権表示と`site/font-licenses/`のライセンスを同梱）。元の書体は `.cache/fonts/` に控える。
- ポケモンの画像は PokeAPI の画像（PokeAPI/sprites）を CDN（jsDelivr）から表示する。大きな画像と共有画像は `official-artwork` のイラスト、一覧はドット絵を使う。イラストがない姿はドット絵に戻し、HOMEの立体画像は使わない。ファイルはこのリポジトリに複製しない。画像の権利は任天堂などにある。


### すばやさ調整の共有

- 設定と同条件ミラーの結果を1つのパネルに表示する。環境全体の比較と詳細グラフは開いて確認できる。
- 「結果画像・Xで共有」で1200×675のPNGを端末内で生成する。追加の画像サービスやアップロードは使わない。
- 共有画像に選択したポケモンの画像を添える。既存のCDN画像を匿名CORSで読み、取得に失敗した場合は調整結果だけで生成する。
- PCでは「画像をコピー」→「Xで投稿を作成」→投稿欄にCtrl+V（Macは⌘V）で添付する。画像コピーに非対応または権限がない場合は画像保存を使う。ファイル共有に対応する端末では「画像を共有」で共有先を選べる。
- 共有URLはルール・ポケモン・性格・ポイント・スカーフ・おいかぜを復元する。統計更新後も数値を固定するものではなく、生成画像に統計月と条件を記載する。

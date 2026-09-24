# champions-meta 実装計画書

ポケモンチャンピオンズ（Pokémon Showdown 上の `gen9champions*` ルール）のメタゲーム推移を、
非商用のファンツールとして可視化する。fourgetkun.com の `/champions-meta/` に置く想定。

- 最終更新: 2026-09-25
- 状態: **機能部（F0〜F5）は実装済み**（下の「6. 進め方」）。デザイン部（D1）は未着手。

---

## 1. 方針

### 1.1 機能部とデザイン部を分ける
- **機能部**（`src/cmeta/`）: データを取ってきて、解析し、`out/` に JSON を書くまで。画面のことは一切知らない。
- **デザイン部**（`site/`、最後に作る）: `out/` の JSON を読んで描くだけ。計算はしない。
- 両者の接点は **JSON の約束事だけ**（`docs/DATA_CONTRACT.md`）。JSON の形を変えるときは `schema_version` を上げ、約束事の文書を先に直す。
- こうしておけば、見た目を何度作り直しても解析は壊れない。逆に、解析を足してもページは古い JSON のまま動き続ける。

### 1.2 権利と礼儀
- **非商用**。hub に載せるときは `build-manifest.js` の `ADS_EXCLUDED` に `champions-meta` を足して広告を外す。
- 出典を明記する: Smogon の使用率統計、Pokémon Showdown のデータとリプレイ（コードは MIT）、PokeAPI（BSD-3）。
  「非公式のファンツール。任天堂・クリーチャーズ・ゲームフリーク・The Pokémon Company とは無関係」と書く。
- **ポケモンの画像（スプライト）は使わない**。PokeAPI の画像リポジトリにはライセンスの表記がなく、画像の権利は任天堂などにある。
  名前・タイプ・数値は事実のデータとして扱う。
- **PokeAPI の利用規約（fair use）**: 取得したものは `data/dex/pokeapi_ja.json` に保存して再利用し、同じものを二度取りに行かない。
- **Showdown への負荷**: リプレイは 1 秒に 1 回以下、1 回の実行で取る件数に上限を付け、User-Agent に連絡先を書く。
- **プレイヤー名は公開しない**。保存するときもハッシュにする（Bo3 の同じシリーズをまとめるのに使うだけ）。

---

## 2. データ源（2026-09-25 に実際に取って確かめた）

### 2.1 Smogon の月次統計 — 背骨
- `https://www.smogon.com/stats/YYYY-MM/chaos/<format>-<cutoff>.json`。毎月 1〜2 日ごろ前月分が出る。
- チャンピオンズは **2026-04 から**。ルール名（2026-08 時点）:

  | ルール名 | 内容 | 2026-08 の対戦数 |
  |---|---|---|
  | `gen9championsvgc2026regmb` | VGC（ダブル）レギュレーション M-B | 約 127 万 |
  | `gen9championsvgc2026regmbbo3` | 同上・3本勝負 | 約 18 万 |
  | `gen9championsou` | シングル OU | 約 9.5 万 |
  | `gen9championsbssregmb` | バトルスタジアム・シングル M-B | 約 6.7 万 |
  | `gen9championsuu` / `gen9champions4v4doublesuu` | 小さい | 数千 |

  M-A（`…regma…`）は 2026-04〜06、M-B は 2026-06〜。6 月は両方ある。
- レートの足切り: チャンピオンズは `0 / 1500 / 1630 / 1760`（SV の OU の 1695 / 1825 とは違う）。
- chaos JSON の中身（ポケモンごと）: `usage`（6 匹の枠に占める割合。全体の合計は約 6.0）、`Raw count`、
  `Abilities` / `Items` / `Moves` / `Spreads` / `Teammates`（いずれも**重み付きの件数**）。
  - ポケモン a の重み `w_a` = `Abilities` の値の合計。全体の重み `W` = `w_a / usage_a`（どのポケモンでも同じ値になる）。
  - `Teammates[a][b]` は a と b が同じチームにいた重み付きの件数。これで「一緒に使われやすさ」（lift）が出せる。
  - `Checks and Counters` はダブルでは空。
  - **メガシンカは別のポケモンとして数えられている**（例: `Charizard-Mega-Y`）。メガストーンを持っていればメガの姿で数えるため。
- 1 ファイル最大 13MB。生のファイルはリポジトリに入れず、**必要な部分だけに縮めたもの**（`data/smogon/*.json.gz`）を保存する。
  型・味方の表は標準の足切り（1630）だけに持たせ、ほかの段は使用率だけ。gzip で 1 か月ぶん約 500KB。

### 2.2 Showdown の公開リプレイ — 週単位の補強
- 一覧: `https://replay.pokemonshowdown.com/search.json?format=<format>&before=<uploadtime>`（1 回 50 件＋次ページ用の 1 件）
- 本体: `https://replay.pokemonshowdown.com/<id>.json`（`log` にバトルの全行）
- 実測（2026-09-11〜25 の 14 日間の件数）:
  - `…vgc2026regmb`: 2,339 件（約 170 件/日）。40 件を開いたうち 37 件が**カスタムの Bo3**（練習や大会のシリーズ）。**レートは付いていない**。
  - `…vgc2026regmbbo3`: 573 件（約 40 件/日）。レートなし。
  - `gen9championsou`: 9,897 件（約 700 件/日）。レート付き（一覧の `rating` に入っている）。
  - `gen9championsbssregmb`: 約 4 件/日。
  - 保存すると 1 件あたり gzip で約 100 バイト。OU でも 1 日数十 KB。
- ログから取れるもの:
  - `|poke|p1|Floette, L50, F|` → チーム見せ合いの 6 匹
  - `|switch|p1a: 名前|Floette, L50, F|…` → 実際に場に出た（選出された）ポケモン
  - `|detailschange|p2a: …|Floette-Mega, L50, F` と `|-mega|…` → メガシンカ
  - `|win|名前` → 勝者。`|teamsize|p1|4` → 選出数
  - `Best of = 3` を含む → Bo3 のシリーズの 1 戦
- 注意:
  - 公開されたリプレイだけなので偏る（見せたい試合ほどアップされやすい）。「参考値」と明記する。
  - Bo3 の同じシリーズは、同じ 2 人・同じ 6 匹どうしで 2〜3 戦ぶん並ぶ。**使用率はシリーズ単位で 1 回と数える**。

### 2.3 名前と基礎データ
- **Showdown の図鑑** `https://play.pokemonshowdown.com/data/pokedex.json`（MIT）:
  英語名・`baseSpecies`（メガの元の姿）・タイプ・種族値・図鑑番号。Smogon の名前との対応はこれが一番確実。
  持ち物・技・特性の英語名も `items.js` / `moves.json` / `abilities.js` から取る。
- **PokeAPI**（ユーザー指定）: 日本語名を取る。
  - ポケモン: `pokemon/<slug>` → `pokemon-form` の日本語の名前（例: メガリザードンＹ）があればそれ、
    無ければ `pokemon-species` の日本語名（`ja`、無ければ `ja-hrkt`）＋姿の名前。
  - slug が見つからないとき（例: Showdown の `Basculegion` は PokeAPI では `basculegion-male`）は
    `pokemon-species/<slug>` の既定の姿に落とす。それでもだめなものは `data/name_overrides.json` に手で書く。
  - 持ち物・技・特性も英語名から slug を作って日本語名を取る。
  - チャンピオンズの新しいメガ（メガフロエッテ、メガスコヴィラン、メガライチュウY など）も PokeAPI にあることを確認済み。
- 名前の対応が取れなかったものがあると、ビルドは失敗させずに `out/meta.json` の `warnings` に載せる
  （英語名で表示すれば壊れはしない）。

---

## 3. 解析の中身と、参考にした論文

月次（Smogon）と週次（リプレイ）の二本立て。ルールの区切り（M-A → M-B など）は**必ず系列を切る**。
つなげて見せたいときは「ルール系統」（VGC 2026 の M-A・M-B …）の中で並べ、切り替わりの月に印を付ける。

共通の決まり:
- **対象のルールは決め打ちしない**。毎月の一覧から `gen9champions` で始まるものを拾う（新しいレギュレーションが自動で入る）。
- **標準の足切りは 1630**（Smogon が OU 以外で標準にしている段）。M1・M5 は全段を出し、それ以外は 1630 で計算する。
- **ポケモンの単位**: 多様さ（M2・M3）と、リプレイとの比較は「元の姿にまとめた」集計で行う
  （メガを別に数えると、同じポケモンの持ち物違いで多様さが水増しされる）。M1 は姿ごとと、まとめたものの両方を出す。
- **時刻は日本時間**。リプレイの日付・週（月曜始まり）は JST で区切る。

### 3.1 月次（Smogon、正確）
| # | 出すもの | やり方 | 参考 |
|---|---|---|---|
| M1 | 使用率と順位の推移 | ポケモンごと・足切りごと。メガを元の姿にまとめた集計も出す | — |
| M2 | 環境の多様さ | 枠の割合を正規化して、実効的なポケモン数（ヒル数 q=0,1,2 = 種類数・exp(シャノン)・1/シンプソン） | Jost 2006「Entropy and diversity」; Pendurkar ほか AAMAS 2023（エントロピー＝環境の健全さ、VGC を題材に含む） |
| M3 | 入れ替わりの大きさ | 前月との重なり（Morisita–Horn）。1 − 重なり＝入れ替わり | Jost 2006 |
| M4 | 伸びた・落ちた | 使用率の差・順位の差・新しく上位に入ったもの | Kica ほか 2016（LoL のパッチと使用率・勝率） |
| M5 | 上位ほど使われる | 足切り 1760 と 0 の使用率の差 | Sanjaya ほか 2021（チェスでレート帯ごとに比べる） |
| M6 | 並び（コア）の推移 | Teammates から lift と NPMI の網を作り、コミュニティ検出（Louvain、seed 固定）。月をまたいで Jaccard でつなぐ | Teng・Lin・Adamic 2012（食材の網、PMI）; Traag ほか 2019（Leiden。Louvain の欠点の注意） |
| M7 | 型の推移 | 持ち物・技・特性・メガストーンの採用率（上位のみ） | — |

### 3.2 週次（リプレイ、参考値）
| # | 出すもの | やり方 | 参考 |
|---|---|---|---|
| W1 | 見せ合いの使用率 | シリーズ単位で数え、ジェフリーズ区間（Beta(k+½, n−k+½)）を付ける | Brown・Cai・DasGupta 2001 |
| W2 | **選出率** | 見せ合いに出した回数のうち、実際に場に出した割合。区間付き | Carli 2025（VGC の先発予測）; Smogon に無い指標 |
| W3 | 選出時の勝率 | 同じポケモンどうしのミラーは除く。50% に向けて縮める（Beta 事前分布） | Kica ほか 2016; Semenov ほか 2017 |
| W4 | 先発の組 | 最初に場に出た 2 匹の組み合わせ（ダブルのみ） | Carli 2025 |
| W5 | 変化の検知 | 日ごとの見せ合いの割合に、ベイズ的なオンライン変化点検出（Beta–Bernoulli）。変化の確率が高い日を「変化あり」とする。1 日の件数が少ない VGC では大きな変化しか拾えないので、しきい値を厳しめにする | Adams・MacKay 2007 |

数える単位:
- **見せ合い・選出**（W1・W2・W4）: Bo3 は「シリーズ×プレイヤー」で 1 回。同じシリーズの 2 戦目・3 戦目は数えない。
  選出はシリーズ中に一度でも場に出れば「選出あり」。
- **勝敗**（W3・X1）: 1 戦ごとに数える。同じシリーズの試合は互いに似ているので、区間は実際より狭く出る。
  そのことを約束事の文書に書き、件数（`n_games` と `n_series`）を両方出す。
- シリーズの見分け方: 同じ 2 人（順不同）・同じ 6 匹どうしで、前の試合から 3 時間以内なら同じシリーズ。

### 3.3 実験的（件数が足りるときだけ出す）
| # | 出すもの | やり方 | 参考 |
|---|---|---|---|
| X1 | 並び（アーキタイプ）どうしの相性表 | 各チームを M6 のコアのどれに最も近いかで分類 → 並び×並びの勝率を Beta で縮める。n < 30 のマスは出さない | García-Sánchez ほか 2020（Hearthstone のデッキの分類）; Wellman ほか 2025（経験的ゲーム理論） |
| X2 | 強さの層と三すくみ | 相性表の均衡（線形計画法）と、三すくみの組の列挙 | Balduzzi ほか 2018; Czarnecki ほか 2020 |
| X3 | 流れの予想 | レプリケーター方程式の 1 ステップ（平均より勝っている並びは増える）→ 翌月のリプレイでの割合の増減と、向きが合ったかで答え合わせ | Ramos・Soria 2026（ポケモンカードで同じことをした）; Saravanan・Guzdial 2024（予想の採点方法: 上位 N の重なり・スピアマンの順位相関） |

- X1〜X3 は、プレイヤーの腕前が混ざる（レートが無い）ので「強さ」と断言しない。件数が足りない月は JSON に `available: false` と理由を入れる。

### 3.4 参考文献（すべて開いて確認した。Brown ほか・Semenov ほか・Zuparic ほかは要旨のページのみ）
- Jost, L. (2006) Entropy and diversity. *Oikos* 113(2). https://pdodds.w3.uvm.edu/research/papers/others/2006/jost2006a.pdf
- Pendurkar et al. (2023) Bilevel Entropy based Mechanism Design for Balancing Meta in Video Games. AAMAS. https://www.ifaamas.org/Proceedings/aamas2023/pdfs/p2134.pdf
- Adams & MacKay (2007) Bayesian Online Changepoint Detection. https://arxiv.org/abs/0710.3742
- Teng, Lin & Adamic (2012) Recipe recommendation using ingredient networks. https://arxiv.org/abs/1111.3919
- Traag, Waltman & van Eck (2019) From Louvain to Leiden. https://arxiv.org/abs/1810.08473
- Brown, Cai & DasGupta (2001) Interval Estimation for a Binomial Proportion. *Statistical Science* 16(2).
- Kica et al. (2016) Nerfs, Buffs and Bugs — Analysis of the Impact of Patching on League of Legends. https://web.cs.wpi.edu/~claypool/papers/lol-crawler/paper.pdf
- Semenov et al. (2017) Performance of ML Algorithms in Predicting Game Outcome from Drafts in Dota 2. https://publications.hse.ru/en/chapters/195125281
- Carli (2025) Predicting competitive Pokémon VGC leads using Latent Semantic Analysis. *Journal of Geek Studies* 12(1).
- García-Sánchez et al. (2020) Data Mining of Deck Archetypes in Hearthstone. https://ceur-ws.org/Vol-2719/paper14.pdf
- Zuparic, Khuu & Zach (2021) Information theory and player archetype choice in Hearthstone. https://arxiv.org/abs/2008.07663
- Balduzzi et al. (2018) Re-evaluating Evaluation. https://arxiv.org/abs/1806.02643
- Czarnecki et al. (2020) Real World Games Look Like Spinning Tops. https://arxiv.org/abs/2004.09468
- Sanjaya, Wang & Yang (2021) Measuring the Non-Transitivity in Chess. https://arxiv.org/abs/2110.11737
- Omidshafiei et al. (2019) α-Rank. https://arxiv.org/abs/1903.01373
- Wellman, Tuyls & Greenwald (2025) Empirical Game-Theoretic Analysis: A Survey. *JAIR* 82. https://arxiv.org/abs/2403.04018
- Ramos & Soria (2026) From Rules to Nash Equilibria (Pokémon TCG). https://arxiv.org/abs/2607.08692
- Saravanan & Guzdial (2024) A Framework for Predicting the Impact of Game Balance Changes through Meta Discovery. https://arxiv.org/abs/2409.07340

---

## 4. 構成

```
champions-meta/
├ src/cmeta/                 機能部（Python 3.12+、依存は numpy / scipy / networkx だけ）
│  ├ config.py               対象のルール、足切り、上限、User-Agent
│  ├ formats.py              ルール名 → 系統・レギュレーション・Bo3 かどうか
│  ├ http.py                 取得（間隔・再試行・キャッシュ）
│  ├ dex.py                  Showdown の図鑑と PokeAPI の日本語名
│  ├ smogon.py               月次統計の取得と縮約
│  ├ replays.py              リプレイの取得と解析（ログ → 1 試合 1 行）
│  ├ analysis/
│  │  ├ stats.py             区間・縮小推定・ヒル数・重なり
│  │  ├ monthly.py           M1〜M5, M7
│  │  ├ cores.py             M6
│  │  ├ weekly.py            W1〜W4
│  │  ├ changepoint.py       W5
│  │  └ matchup.py           X1〜X3
│  ├ export.py               out/ に JSON を書く
│  └ __main__.py             コマンド（fetch-smogon / fetch-replays / dex / build / all）
├ tests/                     解析と読み取りのテスト（ネットにつながない）
├ data/                      リポジトリに入れる、縮めたデータ
│  ├ smogon/<YYYY-MM>/<format>-<cutoff>.json
│  ├ replays/<format>/<YYYY-MM-DD>.jsonl.gz   1 日 1 ファイル（一度書いたら書き換えない。git が膨らまない）
│  ├ dex/                    Showdown 図鑑・PokeAPI の日本語名の控え
│  ├ name_overrides.json     手で書く名前の対応
│  └ events.json             手で書く出来事（レギュレーションの開始日など。分からない日付は書かない）
├ out/                       デザイン部が読む JSON（生成物）
├ site/                      デザイン部（最後に作る）
├ docs/PLAN.md               この文書
├ docs/DATA_CONTRACT.md      out/ の JSON の約束事
└ .github/workflows/         定期実行
```

- 生のファイル（Smogon の 13MB の JSON、リプレイの全文）は `.cache/`（git 管理外）に置く。

## 5. 定期実行（GitHub Actions）
- **毎日**（JST 04:00）: リプレイの取得 → 週次の解析 → `data/` と `out/` をコミット。
  - 前回取った最新の時刻までさかのぼって取る。1 回の上限は 1 ルールあたり 1,500 件（OU は 1 日約 600 件なので足りる）。
  - 初回だけ、さかのぼる日数に上限を付ける（設定で 14 日）。
  - リプレイは日本時間の日付ごとのファイルに分ける。その日の分がまだ増えている間は、同じ日のファイルに追記して書き直す。
    前日より前のファイルは書き換えない。
- **毎月 3 日**（Smogon の公開を待つ）: 前月の統計の取得 → 月次の解析 → コミット。
- **hub への反映**はデザイン部ができてから。npb-odds と同じく、`out/` と `site/` を hub の
  `public/champions-meta/` に push する（hub 側のトークンが要る）。それまでは、このリポジトリの中だけで回す。

## 6. 進め方
| 段階 | 中身 | 完了の条件 | 状態（2026-09-25） |
|---|---|---|---|
| F0 | 骨組み・設定・ルール名の読み取り・取得の土台 | テストが通る | 済（テスト 19 件） |
| F1 | 図鑑と日本語名 | Smogon に出てくる名前の 95% 以上に日本語名が付く | 済（ポケモン 291 匹すべて。持ち物は新しいメガストーン 23 個が PokeAPI に未収録で英語名） |
| F2 | Smogon の取得・縮約・月次解析（M1〜M7） | 2026-04〜08 の全ルールで `out/` ができる。2 回回して同じ結果 | 済（9 ルール。PYTHONHASHSEED を変えても生成時刻以外は一致） |
| F3 | リプレイの取得・解析・週次（W1〜W5） | 1 週間ぶんを取り、シリーズがまとまり、週次の JSON ができる | 試験取得（3 ルール×150 件）で確認済み。本格的な取得は定期実行で |
| F4 | 実験的な解析（X1〜X3） | 件数が足りなければ `available: false` と理由が出る | 済（いまは件数不足で `available: false`） |
| F5 | 約束事の文書・定期実行 | `DATA_CONTRACT.md` と JSON が一致する | 済 |
| D1 | **デザイン部**（最後） | `out/` だけを読んで描く。hub に載せる | 未着手 |

## 7. 気をつけること（まとめ）
- ルールが変わると系列が切れる。つなげない。
- Smogon の使用率の合計は約 600%（6 匹の枠ぶん）。多様さの計算では割合に直してから使う。
- メガは Smogon では別のポケモン。リプレイの見せ合いでは元の姿で出る。比べるときは「元の姿にまとめた」集計どうしで比べる。
- リプレイは偏りがあり、レートも無い（VGC）。数字には区間を付け、少ないものは出さない。
- 足切りが違う系統（SV の OU など）とは比べない。

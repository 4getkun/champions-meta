# out/ の JSON の約束事（schema_version 1）

機能部（`src/cmeta/`）が書き、デザイン部（`site/`）が読むだけのファイル。**デザイン部はここに書いてあること以外を当てにしない。**
形を変えるときは、先にこの文書を直し、`schema_version` を上げる。

## 共通
- 文字コードは UTF-8。数値の割合はすべて 0〜1（% ではない）。
- 月は `YYYY-MM`、日付は `YYYY-MM-DD`、時刻は日本時間。
- **ポケモンの名前**は Showdown の英語名（例: `Charizard-Mega-Y`、`Floette-Eternal`）。表示には `names.json` の `ja` を使う。
  `ja` が `null` のときは英語名を出す。
- **「まとめた名前」**（`group`）は、メガ・ゲンシ・戦闘中だけの姿を元に戻したもの（`Charizard-Mega-Y` → `Charizard`、
  `Floette-Mega` → `Floette-Eternal`）。リージョンフォーム（`Ninetales-Alola`）は別のまま。
- 系列（配列）は `months` などの見出しの配列と同じ長さ。値が無い月は `null`。
- リプレイから作るもの（weekly・select・induce・diag・matchup）は、**ボットの試合を除く**
  （どちらかのプレイヤー名が bot・pokechamp・metamon・pokellmon・agent を含む試合）。
- 使用率 `usage` は **チームにそのポケモンが入っていた割合**。1 チーム 6 匹なので、全ポケモンの合計は約 6 になる
  （1 匹ぶんは 0〜1 の範囲）。割合の円グラフのように「合計 100%」として描かない。

## meta.json
```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-09-25T05:40:00+09:00",
  "default_cutoff": 1630,
  "formats": [{
    "id": "gen9championsvgc2026regmb",
    "family": "vgc2026",          // 系統
    "regulation": "M-B",          // 無い系統は null
    "bo3": false,
    "game_type": "doubles",       // "doubles" | "singles"
    "track": "vgc2026",           // tracks/<track>.json の名前
    "team_select": true,          // 見せ合いから選出するルールか（BSS・VGC・4v4）。false なら select/ と induce/ は予想を出さない
    "early": false,               // 月次統計がまだ無い（始まったばかりの）ルール。true なら monthly/・pokemon/・speed/・sets/ などは無く、early/ を使う
    "started": "2026-09-25",      // early のときだけ: 最初の公開リプレイの日
    "months": ["2026-06", "2026-07", "2026-08"],   // monthly/ にある月（無ければ []）
    "replay_days": 12             // リプレイがある日数（0 なら weekly/ は無い）
  }],
  "tracks": { "vgc2026": { "months": [...], "segments": [{ "month": "2026-04", "format": "…regma", "regulation": "M-A" }] } },
  "sources": [{ "name": "…", "url": "…" }],   // 出典。ページに必ず出す
  "events": [{ "date": "YYYY-MM-DD", "format": "…" | null, "label": "…" }],   // 手で書いた出来事
  "warnings": [{ "kind": "no_ja_name:pokemon", "count": 3, "examples": ["…"] }]
}
```

## names.json
```jsonc
{
  "pokemon":   { "Charizard-Mega-Y": { "ja": "メガリザードンＹ", "group": "Charizard", "mega": true,
                                       "types": ["Fire", "Flying"], "num": 6,
                                       "base_stats": { "hp": 78, "atk": 104, "def": 78, "spa": 159, "spd": 115, "spe": 100 },
                                       "sprite": { "front": "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/10035.png",
                                                   "home":  "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/home/10035.png" } } },
  "items":     { "sitrusberry": { "en": "Sitrus Berry", "ja": "オボンのみ" } },
  "moves":     { "fakeout":     { "en": "Fake Out", "ja": "ねこだまし" } },
  "abilities": { "intimidate":  { "en": "Intimidate", "ja": "いかく" } }
}
```
- `sprite` は PokeAPI の画像（CDN 経由。こちらには複製しない）。
  - `front`: 96px のドット絵（約 1.4KB）。**一覧・表・グラフの横など、並べる所はこちら**。`image-rendering: pixelated` で拡大してよい。
  - `home`: HOME の立体画像（約 110KB）。大きく 1 匹だけ見せる所だけ。`null` のときは `front` を使う。
  - `sprite` 自体が `null` のこともある（画像が見つからない姿）。名前だけで表示する。
  - 画像には `loading="lazy"` と `width`/`height` を付ける。ページのどこかに「画像: PokeAPI / © Nintendo・Creatures・GAME FREAK」を出す。

## monthly/&lt;format&gt;.json — 月次（Smogon）
```jsonc
{
  "format": "gen9championsvgc2026regmb",
  "months": ["2026-06", "2026-07", "2026-08"],
  "cutoffs": [0, 1500, 1630, 1760],
  "default_cutoff": 1630,
  "battles": { "0": [1163315, 1764686, 1269250], "1630": [...] },   // 月ごとの対戦数

  // M1 使用率と順位。どこかの月で 100 位以内に入ったものだけ
  "usage":         { "1630": { "Kingambit": [0.33, 0.35, 0.40] } },   // 姿ごと
  "rank":          { "1630": { "Kingambit": [2, 1, 1] } },
  "usage_grouped": { "1630": { "Charizard": [...] } },                // まとめた名前
  "rank_grouped":  { "1630": { ... } },

  // ここから下はすべて default_cutoff で計算したもの
  "diversity": { "2026-08": { "q0": 221, "q1": 58.9, "q2": 37.0 } },  // M2 実効的なポケモン数（まとめた名前）
  "turnover":  { "2026-08": 0.0176 },                                   // M3 前月からの入れ替わり（0〜1）。最初の月は無い
  "movers": { "2026-08": {                                              // M4 前月との比較。最初の月は無い
      "rising":  [{ "name": "Sneasler", "from": 0.19, "to": 0.26, "delta": 0.07, "rank_from": 9, "rank_to": 5 }],
      "falling": [...],
      "new_top30": [...] } },
  "cutoff_gap": { "low": 0, "high": 1760, "months": { "2026-08": {       // M5 上位ほど使われる / 使われない
      "higher_at_top": [{ "name": "Kingambit", "low": 0.30, "high": 0.50, "diff": 0.20 }],
      "lower_at_top":  [...] } } },
  "sets": { "2026-08": { "Incineroar": {                                // M7 型（上位 40 匹、各 6 位まで）
      "items": { "sitrusberry": 0.69 }, "moves": { "fakeout": 0.99 },    // moves は「その技を入れている割合」（合計は約 4）
      "abilities": { "intimidate": 0.99 }, "spreads": { "Careful:32/0/20/0/14/0": 0.04 } } } },
  "mega_split": { "2026-08": { "Charizard": { "Charizard-Mega-Y": 0.97, "Charizard-Mega-X": 0.03, "Charizard": 0.002 } } }
}
```

## pokemon/&lt;format&gt;.json — ポケモン詳細（最新の月・標準の足切り）
```jsonc
{
  "format": "…", "month": "2026-08", "cutoff": 1630, "battles": 1269250,
  "pokemon": { "Kingambit": {                  // 姿ごと。チームあたり 0.5% 以上のものだけ
      "usage": 0.40, "rank": 1, "raw": 12345,   // rank は姿ごとの順位
      "moves": { "suckerpunch": 0.998 },         // その技を入れている割合（合計は約 4）。12 位まで
      "items": { "chopleberry": 0.36 }, "abilities": { "defiant": 0.99 },
      "spreads": { "Adamant:32/32/0/0/2/0": 0.12 },   // 性格:H/A/B/C/D/S の能力ポイント
      "teammates": [["Basculegion", 0.376]]      // このポケモンのチームに相手もいた割合。12 匹まで
  } }
}
```
- 一覧の「まとめた名前」から詳細を開くときは、`names.json` の `group` が同じ姿を集める（例: Charizard → Charizard-Mega-Y / -X / Charizard）。

## tracks/&lt;track&gt;.json — レギュレーションをつないだ系列
```jsonc
{
  "track": "vgc2026",
  "months": ["2026-04", …, "2026-08"],
  "segments": [{ "month": "2026-06", "format": "gen9championsvgc2026regma", "regulation": "M-A" }],
  "usage_grouped": { "Kingambit": [0.34, 0.36, 0.37, 0.34, 0.41] }   // default_cutoff、まとめた名前
}
```
- ある月に二つのレギュレーションがある（切り替わりの月）ときは、対戦数の多いほうを採っている。
- **`segments` の `regulation` が変わる所で線を切るか、印を付けて描く**（同じ環境として続けて見せない）。

## cores/&lt;format&gt;.json — M6 並び（コア）
```jsonc
{
  "format": "…", "cutoff": 1630,
  "months": { "2026-08": {
    "nodes": [{ "name": "Kingambit", "usage": 0.40, "core": 4 }],     // core: 属するコアの id（無ければ null）
    "edges": [{ "a": "Basculegion", "b": "Sneasler", "lift": 2.1, "npmi": 0.35, "together": 0.12 }],
    "cores": [{ "id": 4, "members": ["Kingambit", "Farigiraf", …], "usage_sum": 1.2, "continued": true }]
  } }
}
```
- 名前は姿ごと（`Floette-Mega` など）。`members` は使用率の高い順。
- **`id` は月をまたいで同じまとまりに同じ番号**（前月と Jaccard 0.3 以上で引き継ぐ）。`continued: false` は新しく現れたまとまり。
- `together` は全チームのうちその 2 匹が同じチームにいる割合。

## weekly/&lt;format&gt;.json — 週次（リプレイ、参考値）
```jsonc
{
  "format": "…", "replays": 1234,
  "available": true,              // false のときは "reason" だけ
  "weeks": ["2026-09-14", "2026-09-21"],      // 月曜の日付（JST）
  "week_enough": [false, true],   // false の週は下の値が null（見せ合いが 20 未満）
  "n_teams": [12, 180], "n_series": [6, 90], "n_games": [10, 160],
  "pokemon": { "Kingambit": {     // 直近 28 日の見せ合いで多い順に 60 匹
      "usage":      [null, 0.41], "usage_ci": [null, [0.34, 0.48]],   // W1 見せ合いの使用率（95% 区間）
      "bring":      [null, 0.85], "bring_ci": [null, [0.76, 0.91]],   // W2 選出率 = 選出 / 見せ合い
      "win_shrunk": [null, 0.53], "win_ci":   [null, [0.44, 0.61]],   // W3 選出時の勝率（50% に寄せたもの）と生の区間
      "games":      [null, 120] } },
  "recent": {                     // 直近 28 日をまとめたもの
    "days": 28, "from": "…", "to": "…", "n_teams": …, "n_series": …, "n_games": …,
    "pokemon": { "Kingambit": { "usage": 0.41, "usage_ci": [..], "teams": 74, "bring": 0.85, "bring_ci": [..],
                                "win": 0.55, "win_shrunk": 0.53, "win_ci": [..], "games": 120 } },
    "leads": [{ "pair": ["Incineroar", "Sneasler"], "count": 12, "share": 0.05 }]   // W4 ダブルのみ
  },
  "alerts": [{ "name": "Staraptor", "day": "2026-09-10", "detected_on": "2026-09-15", "prob": 0.72,
               "before": 0.10, "after": 0.18, "n_before": 900, "n_after": 850 }]    // W5 変化の検知
}
```
- 名前は**まとめた名前**。
- 数える単位: 見せ合い・選出・先発は「シリーズ×プレイヤー」で 1 回。勝敗は 1 戦ごと
  （Bo3 の同じシリーズの試合は似ているので、`win_ci` は実際より狭い）。
- 公開されたリプレイだけの集計で、偏りがある。VGC はレートが無い。**「参考値」と必ず書く。**

## matchup/&lt;format&gt;.json — 実験的（X1〜X3）
```jsonc
{
  "format": "…", "experimental": true,
  "months": { "2026-09": {
    "available": false, "reason": "十分な試合数（90 戦以上）の並びが 3 つ未満（1 個）"
    // available: true のとき:
    // "archetypes": ["4", "7", "2"],                 // cores の id（文字列）
    // "games": { "4": 300 },
    // "matrix": [[null, 0.55, …], …],                // 行が列に勝った割合（50% に寄せたもの）。件数不足のマスは null
    // "matrix_n": [[0, 80, …], …],
    // "nash": { "4": 0.4 },                           // 均衡の混合戦略
    // "cycles": [["4", "7", "2"]],                    // 三すくみ
    // "share": { "4": 0.3 }, "pressure": { "4": 0.02 },   // 流れの予想（正なら増える予想）
    // "forecast_score": { "hits": 3, "total": 4, "rate": 0.75 }   // 翌月の答え合わせ（翌月があるときだけ）
  } }
}
```
- 並びの名前は `cores/<format>.json` の同じ月（無ければ直近の過去の月）の `cores[].members` から作る。
- **「強さ」と書かない**（腕前が混ざる）。「このリプレイ群では」と書く。

## select/&lt;format&gt;.json — P1 選出・先発の予想（組の予想）
見せ合いから選出するルール（`meta.json` の `team_select` が true）だけ。ボットの試合は使わない。
```jsonc
{
  "format": "…",
  "available": true,             // false のときは "reason" だけ
  "model": "joint",
  "usable": true,                // 答え合わせで確率の当てはまり（対数尤度）が「全体の率だけ」よりはっきり良かったか（95% 範囲の下端 > 0）
  "k_bring": 4, "k_lead": 2,     // 選出数・先発の数（シングルは 3 と 1）
  "m": 10,                       // 縮めの強さ
  "features": ["base", "lead_base", "cobring", "vs", "hit", "hurt", "speed", "stone", "stone_pair", …],
  "weights": [20 個],            // features と同じ順
  "g_bring": 0.66, "g_lead": 0.33,
  "base": { "Kingambit": [n, 選出, n先発, 先発] },             // まとめた名前
  "vs":   { "Kingambit": { "Incineroar": [n, 選出, n先発, 先発] } },   // 相手の見せ合いにいたとき
  "cobring": { "Incineroar|Kingambit": 0.21 },                 // 名前を並べた順（a < b）。同時に選出されやすさ（logit のずれ）
  "roles": { "Pelipper": { "redirect": 0.1, "stone": 0.0, "tr": 0.01, "set": { "rain": 1.0 }, "abuse": {…}, "speed": 65,
                           "types": ["Water", "Flying"] } },     // 無いキーは 0。types はメガストーンを持つ確率 0.5 以上のときのメガの姿のタイプ
  "avg_opp": [["Incineroar", 0.52], …],   // 自分のチームが分からないときの「平均的な相手」（重みの合計 6）
  "trained": { "samples": 2060, "from": 1788000000, "to": 1789900000 },   // UNIX 秒
  "eval": {
    "train": 5000, "test": 1202, "blocks": 4, "train_days": 30, "test_from": 1789300000,
    // 答え合わせ = 選出・先発がそろった標本を新しい順に 300 件ずつ区切った、重ならない区間（最大 4）をまとめたもの。
    // 各区間は、その直前 train_days 日の試合だけで学んだ予想で確かめる。test_from は一番古い区間の始まり
    "bring": { "model": 0.683, "baseline": 0.674, "diff": 0.009, "ci": [-0.004, 0.022], "random": 0.667, "unknown_opp": 0.671 },
    "lead":  { … },              // 予想の上位 k 匹のうち実際に選出・先発した割合。ci は差の 95% 範囲（試合を引き直す）
    "back":  { … },              // 実際の先発を見たあと、残りの選出の予想の当たり
    "loglik": { "model": -4.45, "baseline": -4.52, "diff": 0.07, "ci": [0.03, 0.11] },
    "bring_set_top1": { "model": 0.09, "baseline": 0.08 }, "lead_set_top3": { … },
    "calibration": [[予想の平均, 実際の割合, 件数], …],
    "temperature": { "t": 0.72, "loglik_gain": 0.018, "ci": [0.004, 0.031], "applied": true,   // 確率の補正の確かめ
                     "calibration": [[…]] },    // 区間ごとに、ほかの区間で決めた係数を当てたときの較正
    "odd_cut": -5.37,            // 「変わったチーム」のしきい（6 匹の月次使用率の対数の平均の下位 5%。画面側も同じ式で計算する）
    "bring_odd": { "n": 51, "model": 0.52, "baseline": 0.53 },       // 答え合わせのうち変わったチームの選出の当たり
    "bring_typical": { "n": 1151, "model": 0.57, "baseline": 0.53 },
    "ratings": { "n": 8897, "of": 9480, "p10": 1018, "p50": 1128, "p90": 1315 }   // 学習に使った試合のレート（分かるものだけ）
  },
  "examples": [{ "team": [...], "opp": [...] | "avg", "bring": { "名前": 確率 }, "lead": { … } }],  // 画面側の計算の確認用
  "temperature": 0.72,           // weights に掛け済みの確率の補正の係数（1 なら補正なし）。画面側は weights をそのまま使う
  "track": {                     // 成績表（前向きの答え合わせ）。available が false なら reason だけ
    "available": true, "n": 345, "snapshots": 23, "from": 1788468100, "to": 1790236651,
    "seeded_until": "2026-09-24" | null,   // この日までの保存は、あとから作り直したもの（その日までのデータだけ）
    "max_age_days": 7,
    "bring": { "model": 0.536, "baseline": 0.524, "diff": 0.013, "ci": [-0.013, 0.040] }, "lead": { … }, "loglik": { … },
    "by_day": [["2026-09-03", 67, 0.50, 0.53]],   // [保存した日, 試合, 選出の当たり（予想）, 全体の率だけ]
    "calibration": [[予想の平均, 実際の割合, 件数], …]
  }
}
```
**予想の計算**（`src/cmeta/analysis/joint.py` の `Featurizer.matrix()` と `probs()` と同じ。画面側はこれを実装する）:
1. 率 `rate(e, which, prior) = (当たり + m·prior) / (数 + m)`（e が無ければ prior）。which が bring なら `e[0], e[1]`、lead なら `e[2], e[3]`。
2. 予想される側のチーム T の各 k について（相手 = 自分の 6 匹。分からなければ avg_opp を重み付きで使う。名前だけなら重み 1）:
   - `pb = rate(base[k], bring, g_bring)`、`base = logit(pb)`、`lead_base = logit(rate(base[k], lead, g_lead))`
   - vs = Σ_{u, vs[k][u] がある} w_u · (logit(rate(vs[k][u], bring, pb)) − base)
   - タイプは `roles[k].types` があればそれ、無ければ `names.json` の types。
     hit = Σ w_u [k のタイプのどれかで u に倍率 ≥ 2] / 6、hurt = Σ w_u [u のタイプのどれかで k に倍率 ≥ 2] / 6
   - speed = (spe(k) − Σ w_u spe(u) / Σ w_u) / 50。spe は `roles[x].speed`、無ければ 80
3. 選択肢 = T から選ぶ k_bring 匹の組 S × その中の先発 k_lead 匹 L（ダブル 90 通り、シングル 60 通り）。特徴は:
   - S の和: base, vs, hit, hurt, stone, tr_bring(=tr)。S の 2 匹ずつ: stone_pair(= stone·stone), cobring
   - L の和: lead_base, speed, fakeout_lead, intimidate_lead, redirect_lead, tailwind_lead, tr_lead, hazard_lead, sash_lead
   - 天候 w ごとに: weather_bring += max_S set[w]、weather_pair += max_S set[w] × Σ_S abuse[w]、weather_lead += max_L set[w]
4. `P(S, L) = softmax(weights · 特徴)`。選出率・先発率は、その k を含む選択肢の確率の合計。
   先発を見たあとの残りは、L が見た先発の選択肢だけで割り戻す。
- logit は `p` を 1e-4〜1−1e-4 に収めてから計算する。タイプ相性は `dex.json` を使う。
- **usable が false のときは** weights の代わりに base と lead_base だけ 1（他は 0）で計算する（全体の率だけ）。

## speed/&lt;format&gt;.json — すばやさ（月次がある形式すべて）
```jsonc
{
  "format": "…", "month": "2026-08", "prev_month": "2026-07" | null, "cutoff": 1630,
  "pokemon": { "Primarina": {                     // 姿ごと（メガの姿は別）。使用率 0.3% 以上
    "group": "Primarina", "usage": 0.218, "base": 60,
    "dist": [[72, 0.19], [80, 0.24], …],          // [実数値, 割合]（振り方の全件から。合計約 1）
    "prev_dist": [[…]],                           // 前の月（同じルール）。無ければ無い
    "scarf": 0.0, "ironball": 0.0,                // 持ち物の割合
    "abilities": { "swiftswim": 0.03 },           // すばやさに関わる特性の割合（1% 以上）
    "spread": { "p05": 72, "p95": 112, "effective": 13.4 },   // 9 割が入る範囲と、実数値の実質の数（ヒル数 q=1。大きいほど読みにくい）
    "priority": { "aquajet": 0.68 }               // 優先度 1 以上の攻撃技の採用率（5% 以上、技の上位 12 まで）
  } },
  "lines": [{ "value": 214, "name": "Basculegion", "kind": "最速" | "準速" | "無振り" | "最遅" | "調整",
              "share": 0.39,                      // その姿のうち、この値にいる割合（スカーフの線は「最速・準速」の割合）
              "scarf": true, "scarf_share": 0.44, // スカーフの線（最速・準速 × 1.5。Showdown の丸め）
              "weight": 0.022,                    // 使用率 × 割合（× スカーフの割合）
              "aimed": 0.002 }]                   // この値のちょうど 1 上に、ほかの姿がすばやさを 1〜31 振って合わせている量（使用率の重み）
}
```
- 実数値 = `trunc((種族値 + 能力ポイント + 20) × 性格補正)`（上昇 110/100・下降 90/100 を整数で切り捨て。レベル 50・個体値 31 固定。Showdown の `data/mods/champions/scripts.ts`）。
- 統計には持ち物と振り方の組み合わせが無い。スカーフは分布に混ぜず、線として出す（「スカーフを持つ個体の振り方」は分からない）。
- 環境の割合（画面の「環境で先に動ける」）は、姿ごとに `usage` で重み付けて、同速は 1/2 と数える。

## top/&lt;format&gt;.json — 上位 500 人の選出率（見せ合いから選出するルールだけ）
```jsonc
{
  "format": "…", "available": true, "ladder_days": 1,   // 使ったランキング表の記録の日数
  "top_players": 499, "samples_top": 1485, "samples_other": 5414,
  "icc_bring": 0.139, "icc_lead": 0.108,     // 同じ人の選出の似かた（級内相関）
  "m_bring": 81.9, "m_lead": 28.0,           // ほかの人の選出率に寄せる強さ（件数ぶん）
  "coverage_bring": 0.961, "coverage_lead": 0.98,   // 人で半分に分けたとき、95% の予測範囲に入った割合
  "pokemon": { "Floette-Eternal": { "bring": {
      "n": 90, "n_eff": 39.4, "players": 25,       // 上位の人の見せ合い・人ごとに重みを付けた有効件数・人数
      "est": 0.44, "ci": [0.31, 0.57],            // 上位の人の選出率（部分プーリング）と 95% 範囲
      "other": 0.66, "other_ci": [..], "other_n": 1340,
      "clear": true },                             // 差がはっきりしている（BH 法 FDR 5%、10 人以上から来ているものだけ）
    "lead": { … } } },
  "induce": { "compared": 307,                    // 上位の人の選出誘導（相手に opp がいるといないで、name の選出率の差）
    "clear": [{ "opp": "Raichu", "name": "Garchomp", "diff": 0.29, "ci": [0.17, 0.41], "p": 1e-5, "players": 129, "n_with": 240 }] }
    // 人を単位に引き直した範囲・p 値に BH 法（FDR 5%）をかけ、はっきりした組だけ。選び出したぶん差は大きめに出やすい
}
```
- 上位の人 = 記録したランキング表に一度でも載った人（ボットの目印なし）。今の順位で決めているので、昔の試合の時点では上位でなかったこともある。
- 人ごとの重み w_i = n_i / (1 + (n_i − 1) ρ)（ρ は似かた）。1 人がたくさん戦っても、その人の癖で全体が動かないようにする。

## early/&lt;format&gt;.json — 開始直後の環境（月次統計がまだ無いルールだけ）
```jsonc
{
  "format": "gen9championsbssregmc", "available": true,
  "samples": 120, "teams": 80, "players": 60,     // 標本（重なりを除いた 1 側）・チーム（同じ人の同じ 6 匹は 1 つ）・人
  "from": 1790300000, "to": 1790330000, "teams_per_day": 45.0,   // 直近 3 日に初めて見たチームの数 / 日
  "ready": { "usage": { "need": 700, "have": 80, "days_left": 13.8 },     // 一般向けに出す目安までの残り
             "bring": { "need": 400, "have": 30, "days_left": 20.0, "note": "…" } },
  "pokemon": { "Garchomp": { "teams": 30, "usage": 0.375, "usage_ci": [0.27, 0.48],
                             "bring": 0.6, "bring_ci": [0.43, 0.76], "bring_teams": 25 } }   // 10 チーム以上に入っているもの
}
```
- 同じ人の同じ 6 匹は 1 チームと数える（始まったばかりは少数の人がたくさん戦うため）。選出率はチームごとに 1 票。勝率は出さない。
- 画面は、件数が ready の目安に届くまで「集計中（あと何日ほど）」と出す。

## sets/&lt;format&gt;.json — 型（持ち物・技）の移り変わり（月 × レート帯）
```jsonc
{
  "format": "…", "month": "2026-08", "prev_month": "2026-07", "cutoffs": [0, 1500, 1630, 1760],
  "default_cutoff": 1630, "low_cutoff": 0, "high_cutoff": 1760,
  "pokemon": { "Primarina": {                      // 標準の足切りで使用率 3% 以上の姿
      "n": { "2026-08:1630": 1234.5, … },           // 重みの合計（月:足切り）
      "items": { "sitrusberry": { "2026-07:1630": 0.57, "2026-08:1630": 0.35, "2026-08:0": 0.41, "2026-08:1760": 0.25, … } },
      "moves": { … } } },                           // どこかで 5% 以上の持ち物・技
  "changes": [{ "name": "Primarina", "kind": "items", "key": "sitrusberry", "type": "month" | "top",
                "a": 0.57, "b": 0.35, "diff": -0.22 }],   // 15pt 以上動いたもの（month: 先月→今月、top: 全体→一番高い足切り）
  "compared": 869
}
```
- **95% 範囲や「はっきり」は付けない。** 月次統計の件数は対戦の数で、同じ人の同じチームが何度も数えられていて、人の情報が無い。
  独立として検定すると、比べたものの半分以上が「はっきり」になってしまう。一番高い足切りは、重みの合計が 100 未満の姿は比べない。

## induce/&lt;format&gt;.json — 選出誘導
見せ合いから選出するルールだけ。ポケモン u を見せ合いに入れたとき、相手の選出・先発がどう変わるか。
```jsonc
{
  "format": "…", "available": true, "samples": 2060, "min_u": 60, "min_k": 15,
  "game_type": "doubles", "k_bring": 4,
  "m": { "bring": 125.0, "lead": 14.2 },       // 縮めの強さ（ベータ二項の周辺尤度でデータから決める。大きいほど強く寄せる）
  "pokemon": { "Floette-Eternal": {
    "n": 243,                                   // u を見せ合いに入れた回数（同じ見せ合いの繰り返しは 1 回）
    "strength": { "bring": 0.012, "lead": 0.0 }, // 誘導の強さ（率の変化の 2 乗平均から偶然の揺れを引いた平方根。0 は揺れと区別できない）
    "strength_logit": { … },                     // ルールをまたいで比べるときの物差し（対数オッズ）
    "stone": 0.98,
    "up":   [{ "name": "Metagross", "n": 21, "bring": [全体, uがいたとき], "ci": 0.12, "lead": [全体, uがいたとき],
               "clear": false, "type": "up" | "down" | null, "type_ok": true | false | null }],   // 増える順
    "down": [ … ],                                                                                  // 減る順
    "lead_pairs": [{ "pair": ["A", "B"], "n": 7, "share": [全体, uがいたとき] }]                    // ダブルだけ
  } },
  "mega_test": { "bring": { "available": true, "mega_mean": …, "other_mean": …, "diff": …, "p": 0.18 }, "lead": { … } },
  "type_check": { "agree": 40, "disagree": 15, "rate": 0.73 }
}
```

## diag/&lt;format&gt;.json — P2 チーム診断の材料
```jsonc
{
  "format": "…",
  "attack_types": { "Dark": 0.14, "Fire": 0.11 },     // 環境の攻撃技のタイプの割合（使用率 × 技の採用率、変化技は除く）
  "top": [["Garchomp", 0.445], …],                    // 使用率の上位 40（まとめた名前、標準の足切り）
  "pairs": { "Garchomp": { "Kingambit": [試合数, 勝ち数] } },   // A を出した側が B を出した側に勝った数（リプレイ、ミラーは除く）
  "min_games": 15                                     // これ未満の組は入っていない
}
```
- 勝率は 50% に向けて縮めて出す（例: `(勝ち + 5) / (試合 + 10)`）。腕前の差が混ざるので「このリプレイ群では」と書く。

## samples/&lt;format&gt;.json — 見本のチーム（見せ合いから選出するルールだけ）
```jsonc
{
  "format": "…",
  "days": 30,                 // 直近この日数のリプレイから
  "min_players": 3,           // まったく同じ 6 匹を、これ以上の人数が使っていたものだけ（1 人のチームは出さない）
  "teams": [                  // 使っていた人の数が多い順に最大 3 個（空のこともある）
    { "team": ["Salamence", "Archaludon", …], "players": 15, "games": 40 }   // team はまとめた名前、そのルールでよく見る順
  ]
}
```
- 選出予想とチーム診断で、まだ一度も入れていない欄に見本として入れる（自分は 1 番目、相手は 2 番目）。人はハッシュで数えるだけで、名前は出さない。

## dex.json
```jsonc
{ "typechart": { "Steel": { "Fire": 2, "Normal": 0.5, "Poison": 0 } } }   // {守るタイプ: {攻めるタイプ: 倍率}}
```

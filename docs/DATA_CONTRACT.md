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
                                       "base_stats": { "hp": 78, "atk": 104, "def": 78, "spa": 159, "spd": 115, "spe": 100 } } },
  "items":     { "sitrusberry": { "en": "Sitrus Berry", "ja": "オボンのみ" } },
  "moves":     { "fakeout":     { "en": "Fake Out", "ja": "ねこだまし" } },
  "abilities": { "intimidate":  { "en": "Intimidate", "ja": "いかく" } }
}
```
- 画像（スプライト）は出さない決まり（docs/PLAN.md 1.2）。タイプの色などはデザイン部で決める。

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

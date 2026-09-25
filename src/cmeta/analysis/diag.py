"""P2 チーム診断の材料: 環境でよく使われる攻撃のタイプ、上位のポケモン、ポケモンどうしの勝率。

- 攻撃のタイプ: 月次の型（標準の足切り）で、使用率 × 技の採用率を、攻撃技のタイプごとに足して割合にする。
- ポケモンどうしの勝率: リプレイで「A を出した側」と「B を出した側」が当たった試合の勝ち数（まとめた名前）。
  同じポケモンどうし（ミラー）は数えない。件数 MIN_GAMES 未満の組は書き出さない。
  腕前の差が混ざる（VGC にはレートが無い）ので、画面では 50% に向けて縮めた値と件数を出す。
"""

from collections import Counter, defaultdict

MIN_GAMES = 15
TOP_N = 40


def attack_types(detail: dict, move_info: dict) -> dict[str, float]:
    """detail: pokemon/<ルール>.json の中身。move_info: {技 ID: {"type", "category"}}。"""
    tot: Counter = Counter()
    for p in detail["pokemon"].values():
        for mid, share in p["moves"].items():
            m = move_info.get(mid)
            if not m or m.get("category") == "Status":
                continue
            tot[m["type"]] += p["usage"] * share
    s = sum(tot.values())
    return {t: round(v / s, 4) for t, v in sorted(tot.items(), key=lambda kv: -kv[1])} if s else {}


def pair_winrates(rows: list[dict], group_of) -> dict:
    games: dict[str, Counter] = defaultdict(Counter)
    wins: dict[str, Counter] = defaultdict(Counter)
    seen = Counter()
    for r in rows:
        if r["winner"] is None:
            continue
        b = [{group_of(x) for x in r["brought"][s]} for s in (0, 1)]
        for s in (0, 1):
            for a in b[s]:
                seen[a] += 1
                for o in b[1 - s]:
                    if a == o or a in b[1 - s]:
                        continue  # ミラーは数えない
                    games[a][o] += 1
                    wins[a][o] += r["winner"] == s
    top = [k for k, _ in sorted(seen.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_N * 3]]
    keep = set(top)
    out = {}
    for a in sorted(keep):
        row = {o: [games[a][o], wins[a][o]] for o in sorted(games[a]) if o in keep and games[a][o] >= MIN_GAMES}
        if row:
            out[a] = row
    return out


def build(detail: dict | None, rows: list[dict], group_of, move_info: dict, usage_grouped: dict, month_index: int) -> dict:
    top = sorted((k for k, v in usage_grouped.items() if v[month_index]), key=lambda k: -usage_grouped[k][month_index])
    return {
        "attack_types": attack_types(detail, move_info) if detail else {},
        "top": [[k, usage_grouped[k][month_index]] for k in top[:TOP_N]],
        "pairs": pair_winrates(rows, group_of) if rows else {},
        "min_games": MIN_GAMES,
    }

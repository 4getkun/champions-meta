"""開始直後の環境（月次統計がまだ無いルール）: リプレイだけで、同じ人の同じチームを 1 つとして数える。

始まったばかりは少数の人がたくさん戦うので、試合ごとに数えると、その人たちのチームが環境のように見えてしまう。
そこで「人 × 6 匹」の組を 1 チームとして数える。
- 使用率: そのポケモンが入っていたチームの割合（Jeffreys の 95% 範囲）。
- 選出率・先発率: チームごとに、そのポケモンを選出（先発）した割合を出し、チームで平均（1 チーム 1 票）。範囲は、チームの数を件数にした
  Jeffreys（チームの中の試合の揺れは見ない、控えめな近似）。
- 勝率は出さない（腕前の差が混ざる）。
- 目安（ready）: 一般向けに出す目安の件数（docs/PLAN.md 8.13）と、直近の増え方から見た残りの日数。
"""

from collections import defaultdict
from datetime import datetime

from ..config import JST
from .select import dedupe, samples
from .stats import jeffreys

MIN_TEAMS_SHOW = 10     # これ未満のチームにしか入っていないポケモンは出さない
READY_USAGE = 700       # 使用率を ±3pt 程度で出せるチームの数の目安（同じ人の重なりを 1 つにしたあと）
READY_BRING = 400       # 選出率を ±5pt 程度で出せる、そのポケモンの入ったチームの数の目安


def _r(v, n=4):
    return round(float(v), n)


def build(rows: list[dict], group_of, k_bring: int, k_lead: int = 1) -> dict:
    xs = dedupe(sorted(samples(rows, group_of), key=lambda x: x["t"]))
    if not xs:
        return {"available": False, "reason": "リプレイがまだない"}
    teams: dict[tuple, dict] = {}
    for x in xs:
        key = (x.get("player"), frozenset(x["team"]))
        e = teams.setdefault(key, {"n": 0, "full": 0, "brought": defaultdict(int), "nl": 0, "led": defaultdict(int)})
        e["n"] += 1
        if len(x["brought"]) == k_bring:
            e["full"] += 1
            for k in x["brought"]:
                e["brought"][k] += 1
        if len(x["leads"]) == k_lead:
            e["nl"] += 1
            for k in x["leads"]:
                e["led"][k] += 1
    n_teams = len(teams)
    use = defaultdict(int)
    bring_sum = defaultdict(float)
    bring_teams = defaultdict(int)
    lead_sum = defaultdict(float)
    lead_teams = defaultdict(int)
    for (_, team), e in teams.items():
        for k in team:
            use[k] += 1
            if e["full"]:
                bring_sum[k] += e["brought"][k] / e["full"]
                bring_teams[k] += 1
            if e["nl"]:
                lead_sum[k] += e["led"][k] / e["nl"]
                lead_teams[k] += 1
    pokemon = {}
    for k, c in sorted(use.items(), key=lambda kv: (-kv[1], kv[0])):
        if c < MIN_TEAMS_SHOW:
            continue
        lo, hi = jeffreys(c, n_teams)
        row = {"teams": c, "usage": _r(c / n_teams), "usage_ci": [_r(lo), _r(hi)]}
        if bring_teams[k]:
            b = bring_sum[k] / bring_teams[k]
            blo, bhi = jeffreys(b * bring_teams[k], bring_teams[k])
            row.update({"bring": _r(b), "bring_ci": [_r(blo), _r(bhi)], "bring_teams": bring_teams[k]})
        if lead_teams[k]:
            ld = lead_sum[k] / lead_teams[k]
            llo, lhi = jeffreys(ld * lead_teams[k], lead_teams[k])
            row.update({"lead": _r(ld), "lead_ci": [_r(llo), _r(lhi)], "lead_teams": lead_teams[k]})
        pokemon[k] = row
    t0, t1 = xs[0]["t"], xs[-1]["t"]
    days = max((t1 - t0) / 86400, 1.0)
    # 直近 3 日に初めて見たチームの数から、目安までの日数を見積もる
    first_seen: dict[tuple, int] = {}
    for x in xs:
        first_seen.setdefault((x.get("player"), frozenset(x["team"])), x["t"])
    per_day = sum(t >= t1 - 3 * 86400 for t in first_seen.values()) / min(3.0, days)
    top = max(use.values()) if use else 0

    def eta(need, have):
        if have >= need:
            return 0
        return round((need - have) / per_day, 1) if per_day > 0 else None

    return {
        "available": True, "samples": len(xs), "teams": n_teams, "players": len({p for p, _ in teams}),
        "from": int(t0), "to": int(t1), "teams_per_day": _r(per_day, 1),
        "ready": {"usage": {"need": READY_USAGE, "have": n_teams, "days_left": eta(READY_USAGE, n_teams)},
                  # 一番多いポケモンの入ったチームは、チーム全体の増え方 × その割合で増える
                  "bring": {"need": READY_BRING, "have": top,
                            "days_left": (0 if top >= READY_BRING else round((READY_BRING - top) / (per_day * top / n_teams), 1)
                                          if per_day > 0 and top else None),
                            "note": "一番多いポケモンの入ったチームの数"}},
        "k_bring": k_bring, "k_lead": k_lead, "pokemon": pokemon,
    }


def started(rows: list[dict]) -> str | None:
    return datetime.fromtimestamp(min(r["t"] for r in rows), JST).strftime("%Y-%m-%d") if rows else None

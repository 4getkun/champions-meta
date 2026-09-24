"""週次（リプレイ、参考値）の解析: W1 見せ合いの使用率、W2 選出率、W3 選出時の勝率、W4 先発の組。

数える単位（docs/PLAN.md 3.2）:
- 見せ合い・選出・先発は「シリーズ×プレイヤー」で 1 回。Bo3 の 2 戦目以降は数えない。
- 勝敗は 1 戦ごと。ミラー（両者が同じポケモンを出した試合）はそのポケモンの勝率から除く。
"""

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from ..config import JST, SERIES_GAP_SEC, WEEKLY_MIN_TEAMS, WEEKLY_TOP
from .stats import jeffreys, shrink

RECENT_DAYS = 28


def _top(c: Counter, n: int) -> list:
    """多い順。同数は名前順（Counter.most_common は同数の順が実行ごとに変わりうる）。"""
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
LEADS_TOP = 15


def jst_date(ts: int) -> date:
    return datetime.fromtimestamp(ts, JST).date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())  # 月曜


def build_series(rows: list[dict], group_of) -> list[dict]:
    """試合をシリーズにまとめる。名前は「元の姿にまとめた」名前に直す。

    返す要素: {t, day, sides: [{player, team:set, brought:set, leads:tuple}, …], games: [{winner, brought:[set,set]}]}
    """
    open_series: dict[tuple, dict] = {}
    out: list[dict] = []
    for r in sorted(rows, key=lambda r: (r["t"], r["id"])):
        if r["players"][0] == r["players"][1]:
            continue  # 同じ人どうし（別の窓で自分と対戦）は数えない
        teams = [frozenset(group_of(x) for x in r["teams"][s]) for s in (0, 1)]
        brought = [frozenset(group_of(x) for x in r["brought"][s]) for s in (0, 1)]
        leads = [tuple(sorted(group_of(x) for x in r["leads"][s])) for s in (0, 1)]
        key = tuple(sorted(((r["players"][s], teams[s]) for s in (0, 1)), key=lambda x: x[0]))
        game = {"winner_player": None if r["winner"] is None else r["players"][r["winner"]],
                "brought": {r["players"][s]: brought[s] for s in (0, 1)}}
        cur = open_series.get(key) if r.get("bo3") else None
        if cur is not None and r["t"] - cur["last_t"] <= SERIES_GAP_SEC and len(cur["games"]) < 3:
            cur["games"].append(game)
            cur["last_t"] = r["t"]
            for s in (0, 1):
                cur["sides"][r["players"][s]]["brought"] |= brought[s]
            continue
        cur = {
            "t": r["t"], "last_t": r["t"], "day": jst_date(r["t"]),
            "sides": {r["players"][s]: {"team": teams[s], "brought": set(brought[s]), "leads": leads[s]} for s in (0, 1)},
            "games": [game],
        }
        out.append(cur)
        if r.get("bo3"):
            open_series[key] = cur
    return out


def _tally(series: list[dict]):
    teams = Counter()
    brought = Counter()
    wins, games = Counter(), Counter()
    leads = Counter()
    n_sides = n_games = 0
    for s in series:
        for side in s["sides"].values():
            n_sides += 1
            teams.update(side["team"])
            brought.update(side["brought"] & side["team"])
            if len(side["leads"]) == 2:
                leads[side["leads"]] += 1
        for g in s["games"]:
            if g["winner_player"] is None:
                continue
            n_games += 1
            if len(g["brought"]) != 2:
                continue
            (pa, ba), (pb, bb) = g["brought"].items()
            for me, mine, theirs in ((pa, ba, bb), (pb, bb, ba)):
                for k in mine - theirs:  # ミラーを除く
                    games[k] += 1
                    wins[k] += g["winner_player"] == me
    return {"teams": teams, "brought": brought, "wins": wins, "games": games, "leads": leads,
            "n_sides": n_sides, "n_games": n_games, "n_series": len(series)}


def _row(t: dict, k: str) -> dict:
    n, c = t["n_sides"], t["teams"][k]
    b, g, w = t["brought"][k], t["games"][k], t["wins"][k]
    use_lo, use_hi = jeffreys(c, n)
    br_lo, br_hi = jeffreys(b, c)
    win_lo, win_hi = jeffreys(w, g)
    return {
        "usage": round(c / n, 5) if n else None, "usage_ci": [round(use_lo, 5), round(use_hi, 5)], "teams": c,
        "bring": round(b / c, 4) if c else None, "bring_ci": [round(br_lo, 4), round(br_hi, 4)],
        "win": round(w / g, 4) if g else None, "win_shrunk": round(shrink(w, g), 4) if g else None,
        "win_ci": [round(win_lo, 4), round(win_hi, 4)], "games": g,
    }


def analyze(rows: list[dict], group_of, doubles: bool, today: date | None = None) -> dict:
    series = build_series(rows, group_of)
    if not series:
        return {"available": False, "reason": "リプレイがまだない"}
    today = today or datetime.now(JST).date()

    # 直近 28 日（上位の並びを決めるのにも使う）
    recent = [s for s in series if (today - s["day"]).days < RECENT_DAYS]
    rt = _tally(recent)
    names = [k for k, _ in _top(rt["teams"], WEEKLY_TOP)]

    # 週ごと
    by_week: dict[date, list[dict]] = defaultdict(list)
    for s in series:
        by_week[week_start(s["day"])].append(s)
    weeks = sorted(by_week)
    tallies = [_tally(by_week[w]) for w in weeks]
    enough = [t["n_sides"] >= WEEKLY_MIN_TEAMS for t in tallies]

    per_pokemon = {}
    for k in names:
        rows_k = [_row(t, k) if ok else None for t, ok in zip(tallies, enough)]
        per_pokemon[k] = {
            f: [r[f] if r else None for r in rows_k]
            for f in ("usage", "usage_ci", "bring", "bring_ci", "win_shrunk", "win_ci", "games")
        }

    out = {
        "available": True,
        "weeks": [w.isoformat() for w in weeks],
        "week_enough": enough,
        "n_teams": [t["n_sides"] for t in tallies],
        "n_series": [t["n_series"] for t in tallies],
        "n_games": [t["n_games"] for t in tallies],
        "pokemon": per_pokemon,
        "recent": {
            "days": RECENT_DAYS, "from": (today - timedelta(days=RECENT_DAYS - 1)).isoformat(), "to": today.isoformat(),
            "n_teams": rt["n_sides"], "n_series": rt["n_series"], "n_games": rt["n_games"],
            "pokemon": {k: _row(rt, k) for k in names},
        },
    }
    if doubles:
        tot = sum(rt["leads"].values())
        out["recent"]["leads"] = [
            {"pair": list(p), "count": c, "share": round(c / tot, 4)} for p, c in _top(rt["leads"], LEADS_TOP)
        ] if tot else []
    return out


def daily_counts(rows: list[dict], group_of) -> tuple[list[date], list[int], dict[str, list[int]]]:
    """変化点検出用: 日ごとの「シリーズ×プレイヤー」の数と、各ポケモンが見せ合いにいた数。"""
    series = build_series(rows, group_of)
    if not series:
        return [], [], {}
    first, last = min(s["day"] for s in series), max(s["day"] for s in series)
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    idx = {d: i for i, d in enumerate(days)}
    n = [0] * len(days)
    k: dict[str, list[int]] = defaultdict(lambda: [0] * len(days))
    for s in series:
        i = idx[s["day"]]
        for side in s["sides"].values():
            n[i] += 1
            for p in side["team"]:
                k[p][i] += 1
    return days, n, dict(k)

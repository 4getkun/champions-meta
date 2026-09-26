"""選出の標本と集計（joint.py の予想と induce.py の選出誘導の材料）。

標本: 1 試合の 1 側 = 1 つ（見せ合いの 6 匹・相手の 6 匹・選出・先発・メガシンカ）。
同じ見せ合いどうし（同じ 6 匹と同じ相手の 6 匹）は 1 回と数える（Bo3 の 2・3 戦目や同じ人の連戦を重ねない）。
集計: ポケモンごとの選出率・先発率と、相手に u がいるときの選出率（件数の少ないものは除く。使う側で Beta で縮める）。

以前ここにあった「1 匹ずつのロジスティック回帰」の予想は、答え合わせで先発が全体の率だけより悪かった
（2026-09、VGC M-B、差 −1.53pt、95% 範囲 −2.99〜−0.08）ため、joint.py の組の予想に置き換えた。
"""

import math
from collections import defaultdict

M = 10.0  # 縮めの強さ（固定のときの値。いまは fit_ms でデータから決める）
M_BOUNDS = (0.5, 2000.0)
MIN_PAIR = 5
MIN_BASE = 5


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def samples(rows: list[dict], group_of) -> list[dict]:
    """1 試合の 1 側 = 1 標本。"""
    out = []
    for r in rows:
        for s in (0, 1):
            team = [group_of(x) for x in r["teams"][s]]
            if len(set(team)) != len(team):
                continue
            out.append({
                "t": r["t"], "team": team, "opp": [group_of(x) for x in r["teams"][1 - s]],
                "brought": {group_of(x) for x in r["brought"][s]},
                "leads": {group_of(x) for x in r["leads"][s]},
                "megas": {group_of(x) for x in r["megas"][s]},
                "rating": r.get("rating") or None,  # 一覧に出ている試合のレート（無いこともある）
                "player": (r.get("players") or [None, None])[s],  # 選んだ側のプレイヤー（ハッシュ）
            })
    return out


# ── 集計（特徴の材料） ────────────────────────────────────────


def fit_stats(xs: list[dict], k_bring: int) -> dict:
    """[選出を数えた数, 選出, 先発を数えた数, 先発]。選出は選出がそろった標本だけで数える。"""
    base = defaultdict(lambda: [0, 0, 0, 0])
    vs = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))
    for x in xs:
        full = len(x["brought"]) == k_bring
        opp = set(x["opp"])
        for k in x["team"]:
            br, ld = k in x["brought"], k in x["leads"]
            rows = [base[k]] + [vs[k][u] for u in opp]
            for e in rows:
                if full:
                    e[0] += 1
                    e[1] += br
                e[2] += 1
                e[3] += ld
    tot = [sum(e[i] for e in base.values()) for i in range(4)]
    g_bring = tot[1] / tot[0] if tot[0] else 0.0
    g_lead = tot[3] / tot[2] if tot[2] else 0.0
    keep = {k for k, e in base.items() if e[2] >= MIN_BASE}

    def trim(tab):
        out = {}
        for k in sorted(keep):
            row = {j: list(e) for j, e in sorted(tab.get(k, {}).items()) if j in keep and e[2] >= MIN_PAIR}
            if row:
                out[k] = row
        return out

    return {"g_bring": g_bring, "g_lead": g_lead, "base": {k: list(base[k]) for k in sorted(keep)},
            "vs": trim(vs)}


def dedupe(xs: list[dict]) -> list[dict]:
    """同じ見せ合いどうし（同じ 6 匹と同じ相手の 6 匹）は最初の 1 回だけ残す。"""
    seen, out = set(), []
    for x in xs:
        key = (frozenset(x["team"]), frozenset(x["opp"]))
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


# ── 縮めの強さをデータから決める ───────────────────────────────
# 率 h/n を事前の率 p へ (h + m p) / (n + m) と縮めるときの m を、ベータ二項の周辺尤度が最大になるように選ぶ
# （Beta(m p, m (1 − p)) を事前分布とした経験ベイズ）。ばらつきが件数の揺れで説明できるほど m は大きく（強く寄せる）、
# 本当の違いが大きいほど小さくなる。


def fit_m(pairs: list[tuple[int, int, float]]) -> float:
    """pairs: [(件数 n, 当たり h, 事前の率 p)]。"""
    from scipy import optimize
    from scipy.special import betaln

    pairs = [(n, h, min(max(p, 1e-3), 1 - 1e-3)) for n, h, p in pairs if n > 0]
    if len(pairs) < 5:
        return M

    def nll(logm):
        m = math.exp(logm)
        return -sum(betaln(h + m * p, n - h + m * (1 - p)) - betaln(m * p, m * (1 - p)) for n, h, p in pairs)

    lo, hi = (math.log(x) for x in M_BOUNDS)
    return round(math.exp(optimize.minimize_scalar(nll, bounds=(lo, hi), method="bounded").x), 2)


def fit_ms(stats: dict) -> dict:
    """fit_stats の結果から、3 か所の縮めの強さ: base_bring（全体の選出率へ）・base_lead（全体の先発率へ）・
    vs（相手に u がいたときの選出率を、そのポケモンの選出率へ）。"""
    gb, gl = stats["g_bring"], stats["g_lead"]
    base = stats["base"]
    mb = fit_m([(e[0], e[1], gb) for e in base.values()])
    ml = fit_m([(e[2], e[3], gl) for e in base.values()])
    pairs = []
    for k, row in stats["vs"].items():
        e = base.get(k)
        pk = (e[1] + mb * gb) / (e[0] + mb) if e else gb
        pairs += [(v[0], v[1], pk) for v in row.values()]
    return {"base_bring": mb, "base_lead": ml, "vs": fit_m(pairs)}

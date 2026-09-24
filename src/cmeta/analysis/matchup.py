"""実験的な解析（件数が足りるときだけ出す）: X1 並びどうしの相性表、X2 均衡と三すくみ、X3 流れの予想。

- 並び（アーキタイプ）: 各チームを、M6 のコアのうち重なりが最も大きいものに割り当てる
  （García-Sánchez ほか 2020 はデッキを群に分けて名前を付けた。ここでは群の代わりに Smogon のコアを使う）。
- 相性表: 並び i が j に勝った割合を、50% に向けて Beta で縮める。件数の少ないマスは表示しない。
- 均衡: 相性表を対称なゼロ和ゲームとみなし、線形計画法で混合戦略の均衡を解く（Balduzzi ほか 2018 の Nash averaging の土台）。
- 三すくみ: i>j>k>i がすべて十分な件数で成り立つ組（Czarnecki ほか 2020）。
- 流れ: レプリケーター方程式の 1 ステップ。平均より勝っている並びは増える、と予想する（Ramos・Soria 2026）。
  翌月の実際の増減と向きが合った割合で答え合わせする（Saravanan・Guzdial 2024 の採点の考え方）。
- レートが無いので、腕前の差が混ざる。「強さ」とは言わず「このリプレイ群では」と書く。
"""

from collections import Counter, defaultdict
from itertools import combinations

import numpy as np
from scipy.optimize import linprog

from ..config import MATCHUP_MIN_GAMES
from .stats import shrink

OTHER = "other"
MIN_OVERLAP = 2
MIN_ARCHETYPE_GAMES = 3 * MATCHUP_MIN_GAMES
MAX_ARCHETYPES = 12


def assign(team: frozenset[str], cores: list[dict]) -> str:
    """cores: [{id, members(まとめた名前)}]。重なりが最大のコアの id（文字列）。足りなければ 'other'。"""
    best, best_score = OTHER, 0.0
    for c in cores:
        ov = len(team & c["members"])
        if ov < MIN_OVERLAP:
            continue
        score = ov / len(c["members"]) + ov * 1e-3  # 割合が同じなら重なりの多いほう
        if score > best_score:
            best, best_score = str(c["id"]), score
    return best


def nash_symmetric(A: np.ndarray) -> np.ndarray:
    """対称ゼロ和ゲーム（A[i,j] = i の j に対する得点、A = −Aᵀ）の均衡の混合戦略。

    max v s.t. Aᵀx ≥ v, Σx = 1, x ≥ 0。対称なので v = 0。
    """
    n = A.shape[0]
    c = np.zeros(n + 1)
    c[-1] = -1  # v を最大化
    A_ub = np.hstack([-A.T, np.ones((n, 1))])
    b_ub = np.zeros(n)
    A_eq = np.hstack([np.ones((1, n)), np.zeros((1, 1))])
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=[1.0],
                  bounds=[(0, None)] * n + [(None, None)], method="highs")
    if not res.success:
        return np.full(n, 1 / n)
    x = np.clip(res.x[:n], 0, None)
    return x / x.sum()


def analyze_month(games: list[tuple[str, str, int]], shares: dict[str, float] | None = None) -> dict:
    """games: (並び a, 並び b, a が勝ったら 1)。shares: 並びの割合（無ければ試合の中の割合を使う）。"""
    count = Counter()
    for a, b, _ in games:
        count[a] += 1
        count[b] += 1
    ordered = sorted(count.items(), key=lambda kv: (-kv[1], kv[0]))
    arch = [k for k, n in ordered if k != OTHER and n >= MIN_ARCHETYPE_GAMES][:MAX_ARCHETYPES]
    if len(arch) < 3:
        return {"available": False,
                "reason": f"十分な試合数（{MIN_ARCHETYPE_GAMES} 戦以上）の並びが 3 つ未満（{len(arch)} 個）"}
    idx = {k: i for i, k in enumerate(arch)}
    n = len(arch)
    wins = np.zeros((n, n))
    played = np.zeros((n, n))
    for a, b, w in games:
        if a in idx and b in idx and a != b:
            i, j = idx[a], idx[b]
            played[i, j] += 1
            played[j, i] += 1
            wins[i, j] += w
            wins[j, i] += 1 - w
    P = np.full((n, n), 0.5)
    for i in range(n):
        for j in range(n):
            if i != j:
                P[i, j] = shrink(wins[i, j], played[i, j])
    A = P - 0.5
    A = (A - A.T) / 2  # 数値のずれを消して、きっちり反対称にする
    x = nash_symmetric(A)

    cycles = []
    ok = played >= MATCHUP_MIN_GAMES
    for i, j, k in combinations(range(n), 3):
        for a, b, c in ((i, j, k), (i, k, j)):
            if ok[a, b] and ok[b, c] and ok[c, a] and P[a, b] > 0.5 and P[b, c] > 0.5 and P[c, a] > 0.5:
                cycles.append([arch[a], arch[b], arch[c]])

    tot = sum(count[k] for k in arch)
    s = np.array([(shares or {}).get(k, count[k] / tot) for k in arch], dtype=float)
    s = s / s.sum()
    fitness = P @ s
    pressure = fitness - s @ fitness

    return {
        "available": True,
        "archetypes": arch,
        "games": {k: int(count[k]) for k in arch},
        "matrix": [[round(float(P[i, j]), 4) if i != j and ok[i, j] else None for j in range(n)] for i in range(n)],
        "matrix_n": played.astype(int).tolist(),
        "nash": {k: round(float(x[idx[k]]), 4) for k in arch},
        "cycles": cycles,
        "share": {k: round(float(s[idx[k]]), 4) for k in arch},
        "pressure": {k: round(float(pressure[idx[k]]), 4) for k in arch},
    }


def score_forecast(pressure: dict[str, float], share_now: dict[str, float], share_next: dict[str, float]) -> dict:
    """予想（pressure の符号）と、翌月の実際の増減の符号が合った割合。"""
    hits = total = 0
    for k, p in pressure.items():
        if k in share_now and k in share_next and p != 0:
            d = share_next[k] - share_now[k]
            if d != 0:
                total += 1
                hits += (p > 0) == (d > 0)
    return {"hits": hits, "total": total, "rate": round(hits / total, 3) if total else None}


def games_by_month(rows: list[dict], group_of, cores_by_month: dict[str, list[dict]], month_of) -> dict[str, list]:
    """リプレイの試合を月ごとに (並び a, 並び b, a の勝ち) にする。コアはその月（無ければ直近の過去の月）のもの。"""
    months_sorted = sorted(cores_by_month)
    out: dict[str, list] = defaultdict(list)
    for r in rows:
        if r["winner"] is None:
            continue
        m = month_of(r["t"])
        usable = [x for x in months_sorted if x <= m]
        if not usable:
            continue
        cores = cores_by_month[usable[-1]]
        a = assign(frozenset(group_of(x) for x in r["teams"][0]), cores)
        b = assign(frozenset(group_of(x) for x in r["teams"][1]), cores)
        out[m].append((a, b, 1 if r["winner"] == 0 else 0))
    return dict(out)

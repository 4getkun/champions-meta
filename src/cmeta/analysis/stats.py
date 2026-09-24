"""統計の部品。どれも小さい純粋関数（テストしやすいように）。"""

import math
from collections.abc import Iterable, Mapping

from scipy.stats import beta


def jeffreys(k: int, n: int, level: float = 0.95) -> tuple[float, float]:
    """二項の割合の区間（Brown・Cai・DasGupta 2001 が小さい n に勧めるもの）。Beta(k+½, n−k+½) の分位点。"""
    if n <= 0:
        return (0.0, 1.0)
    a = (1 - level) / 2
    lo = 0.0 if k == 0 else float(beta.ppf(a, k + 0.5, n - k + 0.5))
    hi = 1.0 if k == n else float(beta.ppf(1 - a, k + 0.5, n - k + 0.5))
    return (lo, hi)


def shrink(k: float, n: float, prior_mean: float = 0.5, prior_strength: float = 10.0) -> float:
    """Beta 事前分布で縮めた割合。n が小さいほど prior_mean に寄る。"""
    return (k + prior_mean * prior_strength) / (n + prior_strength)


def normalize(shares: Mapping[str, float]) -> dict[str, float]:
    total = sum(v for v in shares.values() if v > 0)
    return {k: v / total for k, v in shares.items() if v > 0} if total > 0 else {}


def hill(p: Iterable[float], q: float) -> float:
    """実効的な種類数（ヒル数、Jost 2006）。q=0: 種類数、q=1: exp(シャノン)、q=2: 1/シンプソン。"""
    p = [x for x in p if x > 0]
    if not p:
        return 0.0
    if q == 0:
        return float(len(p))
    if q == 1:
        return math.exp(-sum(x * math.log(x) for x in p))
    return sum(x**q for x in p) ** (1 / (1 - q))


def morisita_horn(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    """二つの分布の重なり（0〜1）。割合を渡す。1 − これ を「入れ替わり」とする。"""
    keys = set(a) | set(b)
    num = 2 * sum(a.get(k, 0) * b.get(k, 0) for k in keys)
    den = sum(v * v for v in a.values()) + sum(v * v for v in b.values())
    return num / den if den > 0 else 0.0


def pmi_stats(p_ab: float, p_a: float, p_b: float) -> tuple[float, float]:
    """(lift, NPMI)。lift = p(a,b)/(p(a)p(b))、NPMI は −1〜1 に正規化した PMI（Teng ほか 2012 の PMI を正規化）。"""
    if p_ab <= 0 or p_a <= 0 or p_b <= 0:
        return (0.0, -1.0)
    lift = p_ab / (p_a * p_b)
    if p_ab >= 1:
        return (lift, 1.0)
    return (lift, math.log(lift) / -math.log(p_ab))


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """スピアマンの順位相関（同順位は平均順位）。"""
    n = len(xs)
    if n < 3:
        return None

    def ranks(v):
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[order[j + 1]] == v[order[i]]:
                j += 1
            for t in range(i, j + 1):
                r[order[t]] = (i + j) / 2
            i = j + 1
        return r

    rx, ry = ranks(xs), ranks(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    vy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return cov / (vx * vy) if vx > 0 and vy > 0 else None

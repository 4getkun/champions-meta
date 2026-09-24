"""W5 変化の検知: ベイズ的なオンライン変化点検出（Adams・MacKay 2007）を、日ごとの「k 件中 n 件」に当てる。

観測は二項（その日の見せ合い n 件のうち、そのポケモンがいたのが k 件）、共役事前分布は Beta。
予測分布はベータ二項。ハザード（毎日「ここで変わる」確率）は一定。

一定のハザードでは P(run length = 0) は常にハザードと同じ値になるので、変化の判定には
「直近 WINDOW 日以内に新しい区間が始まった確率」P(r_t ≤ WINDOW) を使う。
"""

import numpy as np
from scipy.special import betaln, gammaln

HAZARD = 1 / 60
WINDOW = 5
THRESHOLD = 0.6
MAX_RUN = 400
PRIOR_STRENGTH = 4.0
MIN_SHIFT = 0.02  # 前後の平均の差がこれ未満なら知らせない
CONTEXT_DAYS = 14


def _log_pred(k: int, n: int, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if n == 0:
        return np.zeros_like(a)
    log_choose = gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1)
    return log_choose + betaln(k + a, n - k + b) - betaln(a, b)


def run_length_probs(k: list[int], n: list[int], p0: float) -> tuple[np.ndarray, np.ndarray]:
    """各日の P(r_t ≤ WINDOW) と、最もありそうな run length を返す。"""
    a0 = max(p0, 1e-3) * PRIOR_STRENGTH
    b0 = max(1 - p0, 1e-3) * PRIOR_STRENGTH
    R = np.array([1.0])
    a, b = np.array([a0]), np.array([b0])
    recent = np.zeros(len(k))
    map_r = np.zeros(len(k), dtype=int)
    for t, (kt, nt) in enumerate(zip(k, n)):
        lp = _log_pred(kt, nt, a, b)
        w = R * np.exp(lp - lp.max())
        growth = w * (1 - HAZARD)
        cp = w.sum() * HAZARD
        R = np.concatenate(([cp], growth))
        R /= R.sum()
        a = np.concatenate(([a0], a + kt))
        b = np.concatenate(([b0], b + nt - kt))
        if len(R) > MAX_RUN:
            R, a, b = R[:MAX_RUN], a[:MAX_RUN], b[:MAX_RUN]
            R /= R.sum()
        recent[t] = R[: WINDOW + 1].sum()
        map_r[t] = int(R.argmax())
    return recent, map_r


def detect(days: list, n: list[int], k: list[int]) -> list[dict]:
    total_n = sum(n)
    if total_n == 0:
        return []
    p0 = sum(k) / total_n
    recent, map_r = run_length_probs(k, n, p0)
    alerts = []
    last_at = -10**9
    for t in range(len(days)):
        # 始まってすぐは run length が短いのが当たり前なので見ない
        if t < CONTEXT_DAYS or recent[t] < THRESHOLD or t - last_at < CONTEXT_DAYS:
            continue
        cp = max(0, t - min(int(map_r[t]), WINDOW))
        lo, hi = max(0, cp - CONTEXT_DAYS), min(len(days), cp + CONTEXT_DAYS)
        nb, kb = sum(n[lo:cp]), sum(k[lo:cp])
        na, ka = sum(n[cp:hi]), sum(k[cp:hi])
        if nb == 0 or na == 0:
            continue
        before, after = kb / nb, ka / na
        if abs(after - before) < MIN_SHIFT:
            continue
        alerts.append({
            "day": days[cp].isoformat(), "detected_on": days[t].isoformat(),
            "prob": round(float(recent[t]), 3),
            "before": round(before, 4), "after": round(after, 4),
            "n_before": nb, "n_after": na,
        })
        last_at = t
    return alerts


def detect_all(days: list, n: list[int], counts: dict[str, list[int]], names: list[str]) -> list[dict]:
    out = []
    for name in names:
        if name in counts:
            for a in detect(days, n, counts[name]):
                out.append({"name": name, **a})
    out.sort(key=lambda a: (a["day"], -abs(a["after"] - a["before"])))
    return out

"""上位の人の選出率・先発率（部分プーリング）と、ほかの人との差。

上位の人: 記録したランキング表（上位 500 人）に載った人（ladder.top_players）。試合のレート欄は試合時点の値で、
シーズン序盤の試合では今の実力より低く出るので、人で分ける。選ぶのはその側のプレイヤーなので、側ごとに数える。

推定: 上位の人の選出率 p_k ~ Beta(m q_k, m (1 − q_k))。q_k はほかの人の選出率。
    m（寄せる強さ）は全ポケモンのベータ二項の周辺尤度を最大にして決める（上位とほかの人の差が大きいほど小さくなる）。
    推定値と 95% 範囲は、事後分布 Beta(b + m q_k, n − b + m (1 − q_k)) から。
差: 上位の推定 − ほかの人（ほかの人は Jeffreys）。2 つの割合の差の検定の p 値に、たくさん調べることの補正（BH 法、FDR 5%）をかけて
    「はっきり」の印を付ける。
同じ人の試合: 同じ人の選び方は似る（独立でない）。同じ人の中での似かたを級内相関 ρ として一元配置の分散分析で推定し
    （全ポケモンでまとめて）、人ごとの重み w_i = n_i / (1 + (n_i − 1) ρ) で選出率を平均し、有効件数を Σ w_i として推定・検定する。
    ρ = 0 なら試合ごとに数え、ρ = 1 なら 1 人 1 票（1 人がたくさん戦っても、その人の癖が全体を動かさない）。
    「はっきり」は、MIN_PLAYERS 人以上から来ているものだけ（1〜2 人の癖を、上位の人の傾向と見なさないため）。
被覆の確認: 上位の人を「人」で半分に分け、半分から出した 95% の予測範囲（ベータ二項）に、もう半分の選出数が入る割合を出す。
"""

import math
import random
from collections import defaultdict

from scipy import optimize, stats
from scipy.special import betaln

MIN_N = 20  # 上位の人の見せ合いがこれ未満のポケモンは出さない
MIN_PLAYERS = 10
FDR = 0.05
CHECK_REPS = 20


def _per_player(xs, which):
    per = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for x in xs:
        actual = x["brought"] if which == "bring" else x["leads"]
        for k in x["team"]:
            e = per[k][x.get("player")]
            e[0] += 1
            e[1] += k in actual
    return per


def icc(xs, which) -> float:
    """同じ人の選出（0/1）の級内相関（一元配置の分散分析、ポケモンごとの平均からのずれを全ポケモンでまとめる）。"""
    ssb = ssw = dfb = dfw = n0w = 0.0
    for k, pl in _per_player(xs, which).items():
        groups = [e for e in pl.values()]
        N = sum(e[0] for e in groups)
        G = len(groups)
        if G < 2 or N <= G:
            continue
        p = sum(e[1] for e in groups) / N
        ssb += sum(e[0] * (e[1] / e[0] - p) ** 2 for e in groups)
        ssw += sum(e[1] * (1 - e[1] / e[0]) for e in groups)  # 0/1 の群内の平方和 = b (1 − b/n)
        dfb += G - 1
        dfw += N - G
        n0w += (N - sum(e[0] ** 2 for e in groups) / N)
    if dfb <= 0 or dfw <= 0:
        return 0.0
    msb, msw, n0 = ssb / dfb, ssw / dfw, n0w / dfb
    den = msb + (n0 - 1) * msw
    return min(max((msb - msw) / den, 0.0), 1.0) if den > 0 else 0.0


def _counts(xs, which, rho):
    """{ポケモン: [有効件数, 有効な選出数, 人数]}（同じ人の似かた rho で割り引いたもの）。"""
    out = {}
    for k, pl in _per_player(xs, which).items():
        # 人ごとの重み w_i = n_i / (1 + (n_i − 1) ρ)（似かたが 0 なら試合ごと、1 なら 1 人 1 票）
        w = [(e[0] / (1 + (e[0] - 1) * rho), e[1] / e[0]) for e in pl.values()]
        out[k] = [sum(wi for wi, _ in w), sum(wi * pi for wi, pi in w), len(pl)]
    return out


def _raw_n(xs):
    c = defaultdict(int)
    for x in xs:
        for k in x["team"]:
            c[k] += 1
    return c


def _fit_m(ct, prior):
    ks = [k for k in ct if k in prior]
    if not ks:
        return 10.0

    def nll(logm):
        m = math.exp(logm)
        return -sum(betaln(ct[k][1] + m * prior[k], ct[k][0] - ct[k][1] + m * (1 - prior[k])) -
                    betaln(m * prior[k], m * (1 - prior[k])) for k in ks)

    return math.exp(optimize.minimize_scalar(nll, bounds=(-2, 8), method="bounded").x)


def _bh(pvals: dict) -> set:
    items = sorted(pvals.items(), key=lambda kv: kv[1])
    n = len(items)
    ok = set()
    for i, (k, p) in enumerate(items, 1):
        if p <= FDR * i / n:
            ok = {kk for kk, _ in items[:i]}
    return ok


def _r(v, n=4):
    return round(float(v), n)


def build(xs: list[dict], top: dict[str, float], k_bring: int, k_lead: int) -> dict:
    """xs: select.samples()（重なりを除いたもの）。top: {プレイヤーのハッシュ: レート}。"""
    xs = [x for x in xs if len(x["brought"]) == k_bring and len(x["leads"]) == k_lead]
    T = [x for x in xs if x.get("player") in top]
    O = [x for x in xs if x.get("player") not in top]
    if len(T) < 100:
        return {"available": False, "reason": f"上位の人の標本が足りない（{len(T)}）"}
    out = {"available": True, "top_players": len(top), "samples_top": len(T), "samples_other": len(O), "pokemon": {}}
    rng = random.Random(0)
    for which in ("bring", "lead"):
        rho = icc(T, which)
        out[f"icc_{which}"] = _r(rho, 3)
        co, ct = _counts(O, which, rho), _counts(T, which, rho)
        prior = {k: (b + 0.5) / (n + 1) for k, (n, b, _) in co.items() if n >= 5}
        m = _fit_m({k: v for k, v in ct.items() if k in prior}, prior)
        out[f"m_{which}"] = _r(m, 2)
        pvals, rows = {}, {}
        raw_n = _raw_n(T)
        for k, (n, b, players) in ct.items():
            if raw_n.get(k, 0) < MIN_N or k not in prior:
                continue
            a, c = b + m * prior[k], n - b + m * (1 - prior[k])
            lo, hi = stats.beta.ppf([0.025, 0.975], a, c)
            no, bo, _ = co[k]
            olo, ohi = stats.beta.ppf([0.025, 0.975], bo + 0.5, no - bo + 0.5)
            # 2 つの割合の差の検定（プールした割合で）
            pp = (b + bo) / (n + no)
            se = math.sqrt(max(pp * (1 - pp) * (1 / n + 1 / no), 1e-12))
            pvals[k] = 2 * (1 - stats.norm.cdf(abs(b / n - bo / no) / se))
            rows[k] = {"n": raw_n[k], "n_eff": _r(n, 1), "players": players, "est": _r(a / (a + c)), "ci": [_r(lo), _r(hi)],
                       "other": _r(bo / no), "other_ci": [_r(olo), _r(ohi)], "other_n": round(no)}
            if players < MIN_PLAYERS:
                pvals.pop(k)
        clear = _bh(pvals)
        for k, r in rows.items():
            r["clear"] = k in clear
            out["pokemon"].setdefault(k, {})[which] = r
        # 被覆の確認（人で半分に分ける）
        hit = tot = 0
        people = sorted({x.get("player") for x in T})
        for _ in range(CHECK_REPS):
            rng.shuffle(people)
            half = set(people[:len(people) // 2])
            A = [x for x in T if x.get("player") in half]
            B = [x for x in T if x.get("player") not in half]
            ca, cb = _counts(A, which, rho), _counts(B, which, rho)
            mA = _fit_m({k: v for k, v in ca.items() if k in prior}, prior)
            for k, (nb, bb, _) in cb.items():
                if nb < 5 or k not in prior:
                    continue
                na, ba, _ = ca.get(k, [0, 0, 0])
                nbi = max(1, round(nb))
                lo, hi = stats.betabinom.ppf([0.025, 0.975], nbi, ba + mA * prior[k], na - ba + mA * (1 - prior[k]))
                hit += lo <= round(bb * nbi / nb) <= hi
                tot += 1
        out[f"coverage_{which}"] = _r(hit / tot, 3) if tot else None
    return out


INDUCE_MIN_N = 30
INDUCE_REPS = 300


def induce_pairs(xs: list[dict], top: dict[str, float], k_bring: int, seed: int = 0) -> dict:
    """上位の人の選出誘導: 相手の見せ合いに u がいるときといないときの、自分の k の選出率の差（上位の人だけ）。

    同じ人の試合が重なるので、95% 範囲と p 値は人を単位に引き直して（クラスタ・ブートストラップ）求め、全部の組にまとめて
    BH 法（FDR 5%）をかける。対象は上位の人の標本が INDUCE_MIN_N 件以上・MIN_PLAYERS 人以上の組。
    注意: 「はっきり」の組の差は、選び出したぶん大きめに出る（勝者の呪い）。全体では、上位の人の差はほかの人の差の
    0.25 倍程度にしか揃っていなかった（2026-09、BSS・VGC M-B）。
    """
    import numpy as np

    xs = [x for x in xs if len(x["brought"]) == k_bring and x.get("player") in top]
    cnt = defaultdict(lambda: [0, set()])
    for x in xs:
        for k in x["team"]:
            for u in set(x["opp"]):
                cnt[(u, k)][0] += 1
                cnt[(u, k)][1].add(x["player"])
    pairs = sorted(p for p, (n, s) in cnt.items() if n >= INDUCE_MIN_N and len(s) >= MIN_PLAYERS)
    byk = defaultdict(list)
    for u, k in pairs:
        byk[k].append(u)
    per = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))  # 組 -> 人 -> [u あり n, 選出, u なし n, 選出]
    for x in xs:
        opp = set(x["opp"])
        for k in x["team"]:
            b = k in x["brought"]
            for u in byk.get(k, []):
                e = per[(u, k)][x["player"]]
                if u in opp:
                    e[0] += 1
                    e[1] += b
                else:
                    e[2] += 1
                    e[3] += b
    rng = np.random.default_rng(seed)

    def diff(a):
        n1, b1, n0, b0 = a.sum(0)
        return b1 / n1 - b0 / n0 if n1 > 0 and n0 > 0 else float("nan")

    rows = []
    for p in pairs:
        arr = np.array(list(per[p].values()), dtype=float)
        d = diff(arr)
        bs = np.array([diff(arr[rng.integers(0, len(arr), len(arr))]) for _ in range(INDUCE_REPS)])
        bs = bs[~np.isnan(bs)]
        se = bs.std(ddof=1) if len(bs) > 1 else 0.0
        pv = 2 * (1 - stats.norm.cdf(abs(d) / se)) if se > 0 else (0.0 if abs(d) > 0 else 1.0)  # 全員が同じ反応なら揺れは無い
        n1 = int(arr[:, 0].sum())
        rows.append({"opp": p[0], "name": p[1], "diff": _r(d), "ci": [_r(d - 1.96 * se), _r(d + 1.96 * se)],
                     "p": float(f"{pv:.3g}"), "players": len(arr), "n_with": n1})
    rows.sort(key=lambda r: r["p"])
    m, k_ok = len(rows), 0
    for i, r in enumerate(rows, 1):
        if r["p"] <= FDR * i / m:
            k_ok = i
    return {"compared": m, "clear": rows[:k_ok]}

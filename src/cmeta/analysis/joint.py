"""P1 選出・先発の予想: 選出と先発を「組」でまとめて予想する（条件付きロジット）。画面側 site/app.js も同じ式で計算する。

選択肢: 相手の見せ合い 6 匹から「選出する組 S（ダブル 4・シングル 3）× 先発 L（ダブル 2・シングル 1）」。
    ダブル 15 × 6 = 90 通り、シングル 20 × 3 = 60 通り。
確率: P(S, L) ∝ exp(w · φ(S, L))（選択肢の中での softmax）。6 匹が 4 枠を取り合う形なので、1 匹が選ばれれば他は選ばれにくくなる。

特徴 φ は、ポケモンの名前の組み合わせではなく、初めて見るチームにも当てはまる「役割」と「相性」で作る
（同じ 6 匹のチームはほとんど再登場しない: 答え合わせのチームのうち学習期間に同じ 6 匹があったのは 4%）。
役割は「覚えているか」ではなく「実際に使うか」で判定する（M-B ではトリックルームを覚えていても実際に使うのは 13% の試合だけ）。
重みはレギュレーション（ルール名）ごとに学ぶ。別のレギュレーションに持ち越さない。

**情報漏れを防ぐ（交差適合）**: 特徴の材料（選出率・相手ごとの選出率・同時に選出されやすさ）を重みと同じデータで集計すると、
学習データの上だけ当たるモデルになる（最初の検証で、較正が 93%→実際 74% と自信過剰になり、答え合わせでは全体の率より悪化した）。
学習データを FOLDS 個に分け、各部分の特徴は残りの部分の集計から作って重みを学ぶ。答え合わせのときは学習データ全体の集計を使う。
トリックルームを実際に使う割合も、学習期間の試合だけで数える。
"""

import itertools
import math
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import minimize

from .select import dedupe, fit_stats, logit, samples

M = 10.0
L2 = 1.0
HOLDOUT_DAYS = 7
MIN_TEST = 300  # 直近 7 日で足りなければ、この件数になるまで答え合わせの期間をさかのぼる（シングルは公開リプレイが少ない）
MAX_TEST_SHARE = 0.4  # ただし答え合わせは全体の 4 割まで（学習が足りなくならないように）
MIN_TRAIN = 300
FOLDS = 5
AVG_OPP_N = 80  # 自分のチームが分からないときの「平均的な相手」に使うポケモンの数
WEATHER_SETTER = {"drizzle": "rain", "drought": "sun", "sandstream": "sand", "snowwarning": "snow"}
WEATHER_ABUSER = {  # 天候で強くなる特性
    "swiftswim": "rain", "raindish": "rain", "dryskin": "rain", "hydration": "rain",
    "chlorophyll": "sun", "solarpower": "sun", "flowergift": "sun", "protosynthesis": "sun",
    "sandrush": "sand", "sandforce": "sand", "sandveil": "sand",
    "slushrush": "snow", "icebody": "snow", "snowcloak": "snow",
}
ROLE_MOVES = {"fakeout": "fakeout", "tailwind": "tailwind", "followme": "redirect", "ragepowder": "redirect",
              # シングルの先発役（設置技）
              "stealthrock": "hazard", "spikes": "hazard", "toxicspikes": "hazard", "stickyweb": "hazard"}
ROLE_ITEMS = {"focussash": "sash"}
ROLE_KEYS = ("fakeout", "intimidate", "redirect", "tailwind", "hazard", "sash")

# 特徴の名前と、まとまり（アブレーションで 1 まとまりずつ外す）
FEATURES = [
    ("base", "実績"), ("lead_base", "実績"), ("cobring", "実績"), ("vs", "相手との関係"),
    ("hit", "相性"), ("hurt", "相性"), ("speed", "相性"),
    ("stone", "メガ"), ("stone_pair", "メガ"),
    ("fakeout_lead", "役割"), ("intimidate_lead", "役割"), ("redirect_lead", "役割"), ("tailwind_lead", "役割"),
    ("tr_lead", "役割"), ("tr_bring", "役割"), ("hazard_lead", "役割"), ("sash_lead", "役割"),
    ("weather_bring", "天候"), ("weather_pair", "天候"), ("weather_lead", "天候"),
]
GROUPS = sorted({g for _, g in FEATURES})


# ── 役割の材料 ────────────────────────────────────────────


def roles_from(detail: dict, rows: list[dict], group_of, stone: dict[str, float]) -> dict:
    """{まとめた名前: {役割: 確率}}。技・特性は月次（姿ごと）を使用率で重み付けてまとめる。
    トリックルームだけはリプレイの「選出されたとき実際に使った割合」で決める（覚えているだけでは使わないため）。"""
    agg: dict[str, Counter] = defaultdict(Counter)
    wsum: Counter = Counter()
    for k, p in (detail or {}).get("pokemon", {}).items():
        g = group_of(k)
        u = p["usage"]
        wsum[g] += u
        roles_here = Counter()
        for mv, role in ROLE_MOVES.items():
            roles_here[role] = max(roles_here[role], p["moves"].get(mv, 0.0))  # 同じ役割の技は重ねて数えない
        for it, role in ROLE_ITEMS.items():
            roles_here[role] += p["items"].get(it, 0.0)
        for role, v in roles_here.items():
            agg[g][role] += u * v
        agg[g]["tr_learn"] += u * p["moves"].get("trickroom", 0.0)
        agg[g]["intimidate"] += u * p["abilities"].get("intimidate", 0.0)
        for ab, w in WEATHER_SETTER.items():
            agg[g][f"set_{w}"] += u * p["abilities"].get(ab, 0.0)
        for ab, w in WEATHER_ABUSER.items():
            agg[g][f"abuse_{w}"] += u * p["abilities"].get(ab, 0.0)
    out = {g: {r: v / wsum[g] for r, v in c.items()} for g, c in agg.items() if wsum[g] > 0}
    # 実際にトリックルームを使った割合（明かされた技が記録されている試合で、選出されたとき）
    n, used = Counter(), Counter()
    for r in rows:
        if "revealed" not in r:
            continue
        for s in (0, 1):
            for x in r["brought"][s]:
                g = group_of(x)
                n[g] += 1
                used[g] += "trickroom" in r["revealed"][s].get(x, {}).get("m", [])
    for g, d in out.items():
        prior = 0.3 * d.get("tr_learn", 0.0)  # 覚えていても使うとは限らないので、弱い目安
        d["tr_use"] = (used[g] + M * prior) / (n[g] + M)
    for g in out:
        out[g]["stone"] = stone.get(g, 0.0)
    return out


def _weather(d: dict, kind: str) -> dict[str, float]:
    return {w: d.get(f"{kind}_{w}", 0.0) for w in ("rain", "sun", "sand", "snow")}


# ── 選択肢と特徴 ───────────────────────────────────────────


def options(team: list[str], k_bring: int, k_lead: int) -> list[tuple[frozenset, frozenset]]:
    out = []
    for s in itertools.combinations(sorted(team), k_bring):
        for l_ in itertools.combinations(s, k_lead):
            out.append((frozenset(s), frozenset(l_)))
    return out


class Featurizer:
    def __init__(self, stats: dict, roles: dict, sd, k_bring: int):
        self.stats, self.roles, self.sd, self.k = stats, roles, sd, k_bring
        g = stats
        self.gb, self.gl = g["g_bring"], g["g_lead"]
        # 同時に選出されやすさ（両方がチームにいたとき、両方とも選出された割合の、独立の場合からのずれ）
        self.cob = stats.get("cobring", {})

    def _rate(self, e, which, prior):
        if not e:
            return prior
        n, h = (e[0], e[1]) if which == "bring" else (e[2], e[3])
        return (h + M * prior) / (n + M)

    def _types(self, k):
        """メガストーンを持つ確率が高ければ、メガの姿のタイプ。"""
        r = self.roles.get(k, {})
        mt = r.get("mega_types")
        return mt if mt and r.get("stone", 0) >= 0.5 else self.sd.types(k)

    def per_member(self, k, team, opp):
        """opp: 相手の名前のリスト、または (名前, 重み) のリスト（重みの合計 6。自分のチームが分からないときの平均的な相手）。"""
        opp_w = [(u, 1.0) for u in opp] if opp and isinstance(opp[0], str) else list(opp)
        pb = self._rate(self.stats["base"].get(k), "bring", self.gb)
        pl = self._rate(self.stats["base"].get(k), "lead", self.gl)
        lk = logit(pb)
        vsk = self.stats["vs"].get(k, {})
        vs = sum(w * (logit(self._rate(vsk[u], "bring", pb)) - lk) for u, w in sorted(dict(opp_w).items()) if u in vsk)
        kt = self._types(k)
        eff = self.sd.effectiveness
        hit = sum(w for u, w in opp_w if any(eff(t, self._types(u)) >= 2 for t in kt)) / 6
        hurt = sum(w for u, w in opp_w if any(eff(t, kt) >= 2 for t in self._types(u))) / 6
        tw = sum(w for _, w in opp_w)
        speed = (self._speed(k) - sum(w * self._speed(u) for u, w in opp_w) / tw) / 50 if tw else 0.0
        r = self.roles.get(k, {})
        return {"base": lk, "lead_base": logit(pl), "vs": vs, "hit": hit, "hurt": hurt, "speed": speed,
                "stone": r.get("stone", 0.0), **{x: r.get(x, 0.0) for x in ROLE_KEYS}, "tr": r.get("tr_use", 0.0),
                "set": _weather(r, "set"), "abuse": _weather(r, "abuse")}

    def _speed(self, k):
        return self.roles.get(k, {}).get("speed") or 80

    def matrix(self, team, opp, opts):
        pm = {k: self.per_member(k, team, opp) for k in team}
        X = np.zeros((len(opts), len(FEATURES)))
        for i, (s, l_) in enumerate(opts):
            f = dict.fromkeys((n for n, _ in FEATURES), 0.0)
            for k in s:
                m = pm[k]
                f["base"] += m["base"]
                f["vs"] += m["vs"]
                f["hit"] += m["hit"]
                f["hurt"] += m["hurt"]
                f["stone"] += m["stone"]
                f["tr_bring"] += m["tr"]
            for a, b in itertools.combinations(sorted(s), 2):
                f["stone_pair"] += pm[a]["stone"] * pm[b]["stone"]  # メガ要員を 2 匹以上出しても 1 匹しかメガシンカできない
                f["cobring"] += self.cob.get((a, b), 0.0)
            for k in l_:
                m = pm[k]
                f["lead_base"] += m["lead_base"]
                f["speed"] += m["speed"]
                f["fakeout_lead"] += m["fakeout"]
                f["intimidate_lead"] += m["intimidate"]
                f["redirect_lead"] += m["redirect"]
                f["tailwind_lead"] += m["tailwind"]
                f["tr_lead"] += m["tr"]
                f["hazard_lead"] += m["hazard"]
                f["sash_lead"] += m["sash"]
            for w in ("rain", "sun", "sand", "snow"):
                set_s = max((pm[k]["set"][w] for k in s), default=0.0)
                abuse_s = sum(pm[k]["abuse"][w] for k in s)
                f["weather_bring"] += set_s
                f["weather_pair"] += set_s * abuse_s  # 天候役と、その天候で強くなるポケモンを一緒に出す
                f["weather_lead"] += max((pm[k]["set"][w] for k in l_), default=0.0)
            X[i] = [f[n] for n, _ in FEATURES]
        return X


def add_cobring(stats: dict, xs: list[dict], k_bring: int) -> None:
    """同時に選出されやすさ: logit(両方選出の割合) − logit(独立なら期待される割合)。"""
    both_team, both_brought = Counter(), Counter()
    for x in xs:
        if len(x["brought"]) != k_bring:
            continue
        for a, b in itertools.combinations(sorted(x["team"]), 2):
            both_team[(a, b)] += 1
            both_brought[(a, b)] += a in x["brought"] and b in x["brought"]
    gb = stats["g_bring"]

    def p(k):
        e = stats["base"].get(k)
        return (e[1] + M * gb) / (e[0] + M) if e else gb

    out = {}
    for key, n in both_team.items():
        if n < 5:
            continue
        exp_ = p(key[0]) * p(key[1])
        q = (both_brought[key] + M * exp_) / (n + M)
        out[key] = logit(q) - logit(exp_)
    stats["cobring"] = out


# ── 学習・予想・答え合わせ ─────────────────────────────────────


def _dataset(xs, feat, k_bring, k_lead, opp=None):
    """opp: 全試合で相手をこれに置き換える（自分のチームが分からないときの答え合わせ用）。"""
    data = []
    for x in xs:
        if len(x["brought"]) != k_bring or len(x["leads"]) != k_lead:
            continue
        opts = options(x["team"], k_bring, k_lead)
        y = next((i for i, (s, l_) in enumerate(opts) if s == x["brought"] and l_ == x["leads"]), None)
        if y is None:
            continue
        data.append((feat.matrix(x["team"], x["opp"] if opp is None else opp, opts), y, opts, x))
    return data


def fit(data, mask=None) -> np.ndarray:
    """L2 付きの条件付きロジット。mask: 使う特徴（False の特徴は重み 0 に固定）。"""
    nf = len(FEATURES)
    mask = np.ones(nf, bool) if mask is None else mask
    w0 = np.zeros(nf)
    w0[0] = 1.0  # 「実績（選出率）」から始める
    w0[1] = 1.0

    def loss(w):
        w = np.where(mask, w, 0.0)
        tot, grad = 0.0, np.zeros(nf)
        for X, y, _, _ in data:
            z = X @ w
            zmax = z.max()
            e = np.exp(z - zmax)
            p = e / e.sum()
            tot += (zmax + math.log(e.sum())) - z[y]
            grad += p @ X - X[y]
        tot += L2 * np.sum((w - w0 * mask) ** 2)
        grad += 2 * L2 * (w - w0 * mask)
        return tot, np.where(mask, grad, 0.0)

    res = minimize(loss, w0 * mask, jac=True, method="L-BFGS-B")
    return np.where(mask, res.x, 0.0)


def probs(X, w):
    z = X @ w
    e = np.exp(z - z.max())
    return e / e.sum()


def marginals(p, opts, team):
    bring = dict.fromkeys(team, 0.0)
    lead = dict.fromkeys(team, 0.0)
    for pi, (s, l_) in zip(p, opts):
        for k in s:
            bring[k] += pi
        for k in l_:
            lead[k] += pi
    return bring, lead


def evaluate(data, w, k_bring, k_lead) -> dict:
    """bring / lead: 予想の上位（選出数・先発数）と実際の重なり。back: 実際の先発を見たあと、残りの選出の予想の当たり。"""
    ll = top_b = top_l = top_back = exact_b = lead_top3 = 0.0
    per = []
    calib = defaultdict(lambda: [0.0, 0.0, 0])
    k_back = k_bring - k_lead
    for X, y, opts, x in data:
        p = probs(X, w)
        ll += math.log(max(p[y], 1e-12))
        bring, lead = marginals(p, opts, x["team"])
        tb = sorted(bring, key=lambda k: (-bring[k], k))[:k_bring]
        tl = sorted(lead, key=lambda k: (-lead[k], k))[:k_lead]
        hb = len(set(tb) & x["brought"]) / k_bring
        hl = len(set(tl) & x["leads"]) / k_lead
        top_b += hb
        top_l += hl
        # 選出の組の確率を足し上げ、一番確率の高い組が当たったか。先発の組の上位 3 に実際の先発が入るか
        sp, lp = Counter(), Counter()
        for pi, (s, l_) in zip(p, opts):
            sp[s] += pi
            lp[l_] += pi
        exact_b += max(sp, key=lambda s: (sp[s], sorted(s))) == x["brought"]
        lead_top3 += x["leads"] in [l_ for l_, _ in sorted(lp.items(), key=lambda kv: (-kv[1], sorted(kv[0])))[:3]]
        # 先発を見たあと: 先発が実際の組の選択肢だけで確率を割り戻し、残りの選出を予想する
        back = Counter()
        for pi, (s, l_) in zip(p, opts):
            if l_ == x["leads"]:
                for k in s - l_:
                    back[k] += pi
        rest = [k for k in x["team"] if k not in x["leads"]]
        tk = sorted(rest, key=lambda k: (-back[k], k))[:k_back]
        hk = len(set(tk) & (x["brought"] - x["leads"])) / k_back
        top_back += hk
        for k in x["team"]:
            b = min(int(bring[k] * 10), 9)
            calib[b][0] += bring[k]
            calib[b][1] += k in x["brought"]
            calib[b][2] += 1
        per.append((hb, hl, math.log(max(p[y], 1e-12)), hk))
    n = len(data)
    return {
        "n": n, "loglik": ll / n, "bring_top": top_b / n, "lead_top": top_l / n, "back_top": top_back / n,
        "bring_set_top1": exact_b / n, "lead_set_top3": lead_top3 / n,
        "calibration": [[round(float(c[0] / c[2]), 3), round(float(c[1] / c[2]), 3), c[2]] for _, c in sorted(calib.items()) if c[2]],
        "_per": per,
    }


def baseline_w() -> np.ndarray:
    """「全体の選出率・先発率だけ」（独立に選ぶ形を、組の確率にしたもの）。"""
    w = np.zeros(len(FEATURES))
    w[0] = 1.0
    w[1] = 1.0
    return w


def bootstrap_diff(a_per, b_per, idx, reps=2000, seed=0) -> tuple[float, float, float]:
    """同じ試合で比べた差の平均と 95% 範囲（試合を引き直す）。idx: 0=選出, 1=先発, 2=対数尤度, 3=先発を見たあとの残り。"""
    rng = np.random.default_rng(seed)
    d = np.array([a[idx] - b[idx] for a, b in zip(a_per, b_per)])
    means = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(reps)]
    return float(d.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


# ── 準備（答え合わせと公開で共通） ──────────────────────────────────


def _roles(detail, rows, group_of, sd, stone, mega_types):
    roles = roles_from(detail, rows, group_of, stone)
    for g, d in roles.items():
        d["speed"] = (sd.species(g) or {}).get("baseStats", {}).get("spe")
        if mega_types and g in mega_types:
            d["mega_types"] = mega_types[g]
    return roles


def _crossfit(xs, roles, sd, k_bring, k_lead):
    """交差適合: 各部分の特徴は、残りの部分の集計から作る。"""
    data = []
    for i in range(FOLDS):
        part = [x for j, x in enumerate(xs) if j % FOLDS == i]
        rest = [x for j, x in enumerate(xs) if j % FOLDS != i]
        st = fit_stats(rest, k_bring)
        add_cobring(st, rest, k_bring)
        data += _dataset(part, Featurizer(st, roles, sd, k_bring), k_bring, k_lead)
    return data


def _featurizer(xs, roles, sd, k_bring):
    stats = fit_stats(xs, k_bring)
    add_cobring(stats, xs, k_bring)
    return Featurizer(stats, roles, sd, k_bring)


def avg_opponent(xs) -> list[tuple[str, float]]:
    """見せ合いに入っている割合の高い順に AVG_OPP_N 匹。重みはその割合（合計が 6 になるよう割り戻す）。"""
    c = Counter(k for x in xs for k in x["opp"])
    top = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:AVG_OPP_N]
    tot = sum(v for _, v in top)
    return [(k, 6 * v / tot) for k, v in top]


def split_holdout(xs, offset_days=0):
    """直近 HOLDOUT_DAYS 日（足りなければ MIN_TEST 件になるまでさかのぼる）を答え合わせに。"""
    end = xs[-1]["t"] - offset_days * 86400
    xs = [x for x in xs if x["t"] <= end]
    cut = end - HOLDOUT_DAYS * 86400
    n_test = min(MIN_TEST, int(len(xs) * MAX_TEST_SHARE))
    if sum(x["t"] >= cut for x in xs) < n_test and n_test > 0:
        cut = xs[-n_test]["t"]
    return [x for x in xs if x["t"] < cut], [x for x in xs if x["t"] >= cut], cut


def run(rows, group_of, sd, detail, stone, doubles: bool, mega_types: dict[str, list[str]] | None = None,
        offset_days: int = 0) -> dict:
    """答え合わせ用。offset_days: 答え合わせの期間を何日前にずらすか（ローリング検証用）。"""
    k_bring, k_lead = (4, 2) if doubles else (3, 1)
    xs = dedupe(sorted(samples(rows, group_of), key=lambda x: x["t"]))
    if not xs:
        return {"available": False, "reason": "リプレイがない"}
    train, test, cut = split_holdout(xs, offset_days)
    roles = _roles(detail, [r for r in rows if r["t"] < cut], group_of, sd, stone, mega_types)  # 答え合わせの期間は見ない
    dtrain = _crossfit(train, roles, sd, k_bring, k_lead)
    feat = _featurizer(train, roles, sd, k_bring)
    dtest = _dataset(test, feat, k_bring, k_lead)
    if len(dtrain) < MIN_TRAIN or len(dtest) < 100:
        return {"available": False,
                "reason": f"標本が足りない（学習 {len(dtrain)}・答え合わせ {len(dtest)}。{MIN_TRAIN} と 100 が必要）"}
    return {"available": True, "k": (k_bring, k_lead), "train": dtrain, "test": dtest, "roles": roles,
            "stats": feat.stats, "feat": feat, "test_x": test, "train_x": train, "cut": cut}


# ── 公開 ───────────────────────────────────────────────────


def _r(v, n=4):
    return round(float(v), n)


def build(rows, group_of, sd, detail, stone, doubles: bool, mega_types=None) -> dict:
    """答え合わせをして、公開用に全期間で学び直す。画面側は weights と材料の表から同じ確率を計算する。"""
    r = run(rows, group_of, sd, detail, stone, doubles, mega_types)
    if not r["available"]:
        return r
    kb, kl = r["k"]
    w = fit(r["train"])
    ev_m = evaluate(r["test"], w, kb, kl)
    ev_b = evaluate(r["test"], baseline_w(), kb, kl)
    # 自分のチームが分からないとき（平均的な相手）の当たり
    d_avg = _dataset(r["test_x"], r["feat"], kb, kl, opp=avg_opponent(r["train_x"]))
    ev_a = evaluate(d_avg, w, kb, kl)

    def cmp(idx, key):
        m, lo, hi = bootstrap_diff(ev_m["_per"], ev_b["_per"], idx)
        return {"model": _r(ev_m[key]), "baseline": _r(ev_b[key]), "diff": _r(m), "ci": [_r(lo), _r(hi)]}

    ev = {
        "train": len(r["train"]), "test": len(r["test"]), "test_from": int(r["cut"]),
        "bring": {**cmp(0, "bring_top"), "random": _r(kb / 6), "unknown_opp": _r(ev_a["bring_top"])},
        "lead": {**cmp(1, "lead_top"), "random": _r(kl / 6), "unknown_opp": _r(ev_a["lead_top"])},
        "back": {**cmp(3, "back_top"), "random": _r((kb - kl) / (6 - kl))},
        "loglik": cmp(2, "loglik"),
        "bring_set_top1": {"model": _r(ev_m["bring_set_top1"]), "baseline": _r(ev_b["bring_set_top1"])},
        "lead_set_top3": {"model": _r(ev_m["lead_set_top3"]), "baseline": _r(ev_b["lead_set_top3"])},
        "calibration": ev_m["calibration"],
    }
    # 予想を出すのは、確率の質（対数尤度）が全体の率だけよりはっきり良いときだけ
    usable = ev["loglik"]["ci"][0] > 0

    # 公開用: 全期間で学び直す（交差適合で重み、全期間の集計で材料）
    xs = r["train_x"] + r["test_x"]
    roles = _roles(detail, rows, group_of, sd, stone, mega_types)
    w_pub = fit(_crossfit(xs, roles, sd, kb, kl))
    feat = _featurizer(xs, roles, sd, kb)
    st = feat.stats
    keep_roles = {}
    for k in sorted({k for x in xs for k in x["team"] + x["opp"]}):
        d = roles.get(k)
        if not d:
            continue
        e = {x: _r(d.get(x, 0.0), 3) for x in (*ROLE_KEYS, "stone") if d.get(x, 0.0) >= 0.005}
        e["tr"] = _r(d.get("tr_use", 0.0), 3)
        for kind in ("set", "abuse"):
            ws = {wk: _r(v, 3) for wk, v in _weather(d, kind).items() if v >= 0.005}
            if ws:
                e[kind] = ws
        if d.get("speed"):
            e["speed"] = d["speed"]
        if d.get("mega_types") and d.get("stone", 0) >= 0.5:
            e["types"] = d["mega_types"]  # メガストーンを持つ確率が高いので、メガの姿のタイプで相性を見る
        keep_roles[k] = e
    # 画面と同じ丸めの材料で例を計算する（画面側の式が同じか確かめるため）
    pub = Featurizer(st, _unround(keep_roles), sd, kb)
    avg = [(k, _r(v, 3)) for k, v in avg_opponent(xs)]
    examples = []
    for x in r["test_x"][:3]:
        opts = options(x["team"], kb, kl)
        for opp in (x["opp"], avg):
            p = probs(pub.matrix(x["team"], opp, opts), np.array([_r(v) for v in w_pub]))
            b, l_ = marginals(p, opts, x["team"])
            examples.append({"team": x["team"], "opp": opp if opp is x["opp"] else "avg",
                             "bring": {k: _r(v) for k, v in b.items()}, "lead": {k: _r(v) for k, v in l_.items()}})
    return {
        "available": True, "model": "joint", "usable": bool(usable),
        "k_bring": kb, "k_lead": kl, "m": M, "features": [n for n, _ in FEATURES],
        "weights": [_r(v) for v in w_pub],
        "g_bring": _r(st["g_bring"], 5), "g_lead": _r(st["g_lead"], 5),
        "base": st["base"], "vs": st["vs"],
        "cobring": {f"{a}|{b}": _r(v, 3) for (a, b), v in sorted(st["cobring"].items())},
        "roles": keep_roles, "avg_opp": [[k, v] for k, v in avg],
        "trained": {"samples": len(xs), "from": int(xs[0]["t"]), "to": int(xs[-1]["t"])},
        "eval": ev, "examples": examples,
    }


def _unround(keep_roles: dict) -> dict:
    """公開した形の役割（roles）を、Featurizer が読む形に戻す。"""
    out = {}
    for k, e in keep_roles.items():
        d = {x: e.get(x, 0.0) for x in (*ROLE_KEYS, "stone")}
        d["tr_use"] = e.get("tr", 0.0)
        for kind in ("set", "abuse"):
            for wk, v in e.get(kind, {}).items():
                d[f"{kind}_{wk}"] = v
        d["speed"] = e.get("speed")
        if e.get("types"):
            d["mega_types"] = e["types"]
        out[k] = d
    return out

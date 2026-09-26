"""選出誘導: あるポケモン u を見せ合いに入れると、相手の選出・先発がどう変わるか。

- 標本: 1 試合の 1 側（相手の見せ合い = u を含むかどうか）。**同じ見せ合いどうし（同じ 6 匹と同じ相手の 6 匹）は 1 回と数える**
  （Bo3 の 2・3 戦目や同じ人の連戦が全体の約半分あり、数えると偶然の偏りが大きく見えるため）。
- 相手の各ポケモン k について、基準 p_k（k を見せ合いに入れた全体での選出率）と、相手に u がいたときの q_k を比べる。
  変化 d = q_k − p_k。件数の少ないものは基準に向けて縮めて出す（強さはデータから決める: select.fit_m）。95% の範囲も付ける。
- 誘導の強さ S_u: d² から偶然の揺れ p(1−p)/n を引いた「偏りのない 2 乗」を件数で重み付けて平均し、平方根（ポイント）。
- タイプ相性での裏付け: k のタイプ一致技で u に効果抜群を取れるなら「増えるはず」、u が k に取れるなら「減るはず」。
  向きが合っているかを印にする（誘導が偶然の揺れでないことの補助的な確認）。
- **シングルとダブルは混ぜない**（ルールごとに別々に集計する）。選ぶ数が違う（ダブル 6→4、シングル 6→3）ので、
  率の差（ポイント）は比べられない。ルールをまたいで比べるときは、対数オッズの変化（strength_logit）を使う。
- ダブルは先発が 2 匹なので、相手の先発の組の変化（lead_pairs）も出す。
- 経験則「メガシンカするポケモンは誘導が強い」の検証: メガストーンを持つ確率 0.5 以上とそれ以外で S の平均を比べ、
  並べ替え検定（印をでたらめに入れ替えて同じ以上の差が出る割合）を付ける。
"""

import math
import random
from collections import Counter, defaultdict

from .select import dedupe, fit_m

M = 10.0
MIN_K = 15
MIN_U = 60  # ダブル
MIN_U_SINGLES = 25  # シングルは件数が少ないので下げ、そのぶんタイプの目安に強く寄せる
TOP = 6
PERMUTATIONS = 5000
# 特性でそのタイプの技を受けないもの（ポケモンの特性が全部これなら、相性の上では効果抜群でも「取れない」とみなす）
IMMUNE_ABILITY = {
    "Levitate": "Ground", "Earth Eater": "Ground", "Flash Fire": "Fire", "Well-Baked Body": "Fire",
    "Water Absorb": "Water", "Storm Drain": "Water", "Dry Skin": "Water", "Volt Absorb": "Electric",
    "Lightning Rod": "Electric", "Motor Drive": "Electric", "Sap Sipper": "Grass",
}


def _tables(xs, k_bring):
    base = defaultdict(lambda: [0, 0, 0])  # [n, 選出, 先発]
    vs = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    seen = Counter()
    for x in xs:
        if len(x["brought"]) != k_bring:
            continue
        opp = set(x["opp"])
        for u in opp:
            seen[u] += 1
        for k in x["team"]:
            b, l_ = k in x["brought"], k in x["leads"]
            for e in [base[k]] + [vs[u][k] for u in opp]:
                e[0] += 1
                e[1] += b
                e[2] += l_
    return base, vs, seen


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _lead_pairs(xs, target):
    """ダブル: 相手に target がいたときといないときの、相手の先発の組の割合。"""
    all_c, hit_c = Counter(), Counter()
    n_all = n_hit = 0
    for x in xs:
        if len(x["leads"]) != 2:
            continue
        pair = tuple(sorted(x["leads"]))
        all_c[pair] += 1
        n_all += 1
        if target in x["opp"]:
            hit_c[pair] += 1
            n_hit += 1
    return all_c, n_all, hit_c, n_hit


def build(xs: list[dict], k_bring: int, sd, stone: dict[str, float], doubles: bool = True) -> dict:
    """xs: select.samples() の標本（1 つのルールだけ）。stone: {まとめた名前: メガストーンを持つ確率}。"""
    xs = dedupe(xs)
    base, vs, seen = _tables(xs, k_bring)
    def immune(b, t):
        abil = list(((sd.species(b) or {}).get("abilities") or {}).values())
        return bool(abil) and all(IMMUNE_ABILITY.get(a) == t for a in abil)

    # a のタイプ一致技で b に効果抜群を取れるか（b の特性で受けないタイプは除く。例: ふゆうのサザンドラにじめん）
    se = lambda a, b: any(sd.effectiveness(t, sd.types(b)) >= 2 and not immune(b, t) for t in sd.types(a))  # noqa: E731
    min_u = MIN_U if doubles else MIN_U_SINGLES

    def prior_of(u, k, p):
        """選出率の寄せ先: k の全体の選出率（シングル・ダブルとも）。
        以前はシングルだけ「同じタイプを見せたときの平均の変化」も足していたが、データから決めた強さ（シングルは上限近く）では
        寄せ先のずれがそのまま「はっきり」に見えてしまうので、全体の率に寄せる（2026-09-27）。"""
        return p

    # 縮めの強さをデータから決める（select.fit_m。ベータ二項の周辺尤度）。固定（ダブル 10・シングル 20）より、
    # 前半の試合で推定した変化が後半の試合の変化に近く（二乗誤差 6〜24% 減）、「はっきり」の印が後半でも同じ向きに出る割合が
    # 64〜83% → 92〜100% に上がった（2026-09、BSS・VGC の M-B・M-C で前後半に分けて確認）
    fit_b, fit_l = [], []
    for u in vs:
        if seen[u] < min_u:
            continue
        for k, e in vs[u].items():
            if e[0] < MIN_K or k == u or not base[k][0]:
                continue
            fit_b.append((e[0], e[1], prior_of(u, k, base[k][1] / base[k][0])))
            fit_l.append((e[0], e[2], base[k][2] / base[k][0]))
    m_bring, m_lead = fit_m(fit_b), fit_m(fit_l)

    out, agree_tot = {}, Counter()
    for u in sorted(vs):
        if seen[u] < min_u:
            continue
        rows, strength, strength_logit = [], {}, {}
        for which, idx in (("bring", 1), ("lead", 2)):
            num = den = 0.0
            lnum = lden = 0.0
            for k, e in vs[u].items():
                n = e[0]
                if n < MIN_K or k == u:
                    continue
                b = base[k]
                p = b[idx] / b[0]
                q_raw = e[idx] / n
                num += n * ((q_raw - p) ** 2 - p * (1 - p) / n)
                den += n
                # 対数オッズでの変化（ルールをまたいで比べられる物差し）。揺れの分は 1/(n p (1-p)) で引く
                lnum += n * ((_logit((e[idx] + 0.5) / (n + 1)) - _logit(p)) ** 2 - 1 / max(n * p * (1 - p), 1e-6))
                lden += n
                if which == "bring":
                    prior = prior_of(u, k, p)
                    q = (e[idx] + m_bring * prior) / (n + m_bring)
                    half = 1.96 * math.sqrt(max(q * (1 - q), 1e-6) / (n + m_bring))
                    pl = b[2] / b[0]
                    ql = (e[2] + m_lead * pl) / (n + m_lead)
                    up, down = se(k, u), se(u, k)
                    expect = "up" if up and not down else "down" if down and not up else None
                    clear = abs(q - p) > half
                    if clear and expect:
                        agree_tot["agree" if (q > p) == (expect == "up") else "disagree"] += 1
                    rows.append({"name": k, "n": n, "bring": [round(p, 4), round(q, 4)], "ci": round(half, 4),
                                 "lead": [round(pl, 4), round(ql, 4)], "clear": clear,
                                 "type": expect, "type_ok": (expect == "up") == (q > p) if expect else None})
            strength[which] = round(math.sqrt(max(num / den, 0.0)), 4) if den else None
            strength_logit[which] = round(math.sqrt(max(lnum / lden, 0.0)), 4) if lden else None
        rows.sort(key=lambda r: r["bring"][1] - r["bring"][0])
        entry = {
            "n": seen[u], "strength": strength, "strength_logit": strength_logit, "stone": round(stone.get(u, 0.0), 4),
            "up": list(reversed(rows[-TOP:])) if rows else [], "down": rows[:TOP],
        }
        if doubles:
            all_c, n_all, hit_c, n_hit = _lead_pairs(xs, u)
            pairs = []
            for pair, c in hit_c.items():
                if c < 5:
                    continue
                p = all_c[pair] / n_all
                q = (c + M * p) / (n_hit + M)
                pairs.append({"pair": list(pair), "n": c, "share": [round(p, 4), round(q, 4)]})
            entry["lead_pairs"] = sorted(pairs, key=lambda r: -(r["share"][1] - r["share"][0]))[:TOP]
        out[u] = entry

    # 経験則の検証（選出と先発それぞれ）
    tests = {}
    for which in ("bring", "lead"):
        vals = {u: v["strength"][which] for u, v in out.items() if v["strength"][which] is not None}
        a = [s for u, s in vals.items() if out[u]["stone"] >= 0.5]
        b = [s for u, s in vals.items() if out[u]["stone"] < 0.5]
        if len(a) < 3 or len(b) < 3:
            tests[which] = {"available": False, "reason": f"比べる数が足りない（メガ {len(a)}・それ以外 {len(b)}）"}
            continue
        diff = sum(a) / len(a) - sum(b) / len(b)
        rng = random.Random(0)
        pool = list(vals.values())
        hits = 0
        for _ in range(PERMUTATIONS):
            rng.shuffle(pool)
            if sum(pool[:len(a)]) / len(a) - sum(pool[len(a):]) / len(b) >= diff:
                hits += 1
        tests[which] = {"available": True, "mega_mean": round(sum(a) / len(a), 4), "other_mean": round(sum(b) / len(b), 4),
                        "diff": round(diff, 4), "p": round(hits / PERMUTATIONS, 4), "n_mega": len(a), "n_other": len(b)}
    tot = agree_tot["agree"] + agree_tot["disagree"]
    return {
        "available": bool(out), "samples": len(xs), "min_u": min_u, "min_k": MIN_K,
        "game_type": "doubles" if doubles else "singles", "k_bring": k_bring,
        "m": {"bring": m_bring, "lead": m_lead},  # データから決めた縮めの強さ
        "pokemon": out, "mega_test": tests,
        "type_check": {"agree": agree_tot["agree"], "disagree": agree_tot["disagree"],
                       "rate": round(agree_tot["agree"] / tot, 4) if tot else None},
    }

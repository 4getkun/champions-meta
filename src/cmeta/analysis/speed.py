"""すばやさ: 実数値の分布と、環境の「線」。

実数値（Champions、レベル 50・個体値 31 固定。Showdown の data/mods/champions/scripts.ts と同じ）:
    floor((種族値 + 能力ポイント + 20) × 性格補正)。性格補正は上昇 1.1・下降 0.9。
分布: Smogon の月次統計（標準の足切り）の振り方を、すばやさの向き（性格）とポイントにまとめたもの（smogon.speed_points）。
    姿ごと（メガの姿は別。メガシンカしたターンからメガの値で動く）。
持ち物・特性: こだわりスカーフ（×1.5）・くろいてっきゅう（×0.5）・すばやさの特性の割合も出す。
    統計には持ち物と振り方の組み合わせが無いので、スカーフは確率に混ぜず、「スカーフの線」として別に出す。
線（lines）:
    - よくある値: 使用率 LINE_MIN_USAGE 以上の姿で、その姿の LINE_MIN_SHARE 以上が集まる値（最速・準速・無振り・最遅・調整）
    - スカーフの線: スカーフが SCARF_MIN 以上の姿の、最速・準速 × 1.5
    - aimed: その線のちょうど 1 上に、ほかの姿がすばやさを 1〜31 振って合わせている量（使用率の重み。「抜き」の的になっているか）
読みにくさ（spread）: 5〜95% の範囲と、実数値の「実効的な数」（ヒル数 q=1 = exp(エントロピー)）。相手から見て値が読みにくいか。
先制技（priority）: 優先度が 1 以上の攻撃技の採用率（すばやさで負けても先に動ける手段。月次の技の上位 12 まで）。
理由（なぜその値にするか）は書かない。データから言えるのは「どの値に何割いるか」だけ。
"""

import math

LINE_MIN_USAGE = 0.02
LINE_MIN_SHARE = 0.2
SCARF_MIN = 0.1
MIN_USAGE = 0.003  # これ未満の姿は分布を出さない
SPEED_ABILITIES = ("swiftswim", "chlorophyll", "sandrush", "slushrush", "surgesurfer", "unburden", "quickfeet",
                   "speedboost")
KIND = {"+32": "最速", "=32": "準速", "=0": "無振り", "-0": "最遅"}


def stat(base: int, points: int, sign: str) -> int:
    v = base + points + 20
    return v * 110 // 100 if sign == "+" else v * 90 // 100 if sign == "-" else v  # Showdown と同じく整数で切り捨て


def modify(v: int, num: int, den: int) -> int:
    """Showdown の chainModify と同じ丸め（0.5 は切り捨て側）。スカーフは modify(v, 3, 2)。"""
    return (v * num * 4096 // den + 2047) // 4096


def base_speed(sd, name: str) -> int | None:
    e = sd.species(name) or {}
    bs = e.get("baseStats") or (sd.species(e.get("baseSpecies", "")) or {}).get("baseStats") or {}
    return bs.get("spe")


def distribution(sd, name: str, pts: dict[str, float]) -> tuple[dict[int, float], dict[int, str]]:
    """{実数値: 割合}（合計 1 に割り戻す）と、{実数値: 一番多い振り方の種類}。"""
    b = base_speed(sd, name)
    if b is None or not pts:
        return {}, {}
    tot = sum(pts.values())
    dist: dict[int, float] = {}
    top_kind: dict[int, tuple[float, str]] = {}
    for key, share in pts.items():
        v = stat(b, int(key[1:]), key[0])
        dist[v] = dist.get(v, 0.0) + share / tot
        kind = KIND.get(key, "調整")
        if share > top_kind.get(v, (0, ""))[0]:
            top_kind[v] = (share, kind)
    return dist, {v: k for v, (_, k) in top_kind.items()}


def _forms(month_data: dict, sd) -> dict[str, dict]:
    out = {}
    for name, p in month_data["pokemon"].items():
        if p["usage"] < MIN_USAGE or "speed" not in p:
            continue
        dist, kinds = distribution(sd, name, p["speed"])
        if not dist:
            continue
        out[name] = {"p": p, "dist": dist, "kinds": kinds, "base": base_speed(sd, name)}
    return out


def _spread(dist: dict[int, float]) -> dict:
    acc, lo, hi = 0.0, None, None
    for v, s in sorted(dist.items()):
        acc += s
        if lo is None and acc >= 0.05:
            lo = v
        if hi is None and acc >= 0.95:
            hi = v
    ent = -sum(s * math.log(s) for s in dist.values() if s > 0)
    return {"p05": lo, "p95": hi, "effective": round(math.exp(ent), 2)}


def _priority(p: dict, sd) -> dict[str, float]:
    out = {}
    for mv, share in p.get("moves", {}).items():
        info = sd.move_info.get(mv) or {}
        if info.get("priority", 0) > 0 and info.get("category") != "Status" and share >= 0.05:
            out[mv] = round(share, 4)
    return out


def build(cur: dict, prev: dict | None, sd) -> dict:
    """cur / prev: smogon の縮めた月次（標準の足切り、speed つき）。prev は同じルールの前の月（無ければ None）。"""
    forms = _forms(cur, sd)
    prev_forms = _forms(prev, sd) if prev else {}
    pokemon = {}
    for name, f in sorted(forms.items(), key=lambda kv: -kv[1]["p"]["usage"]):
        p = f["p"]
        e = {
            "group": sd.group_name(name), "usage": p["usage"], "base": f["base"],
            "dist": [[v, round(s, 4)] for v, s in sorted(f["dist"].items()) if s >= 0.0005],
            "scarf": round(p.get("items", {}).get("choicescarf", 0.0), 4),
            "ironball": round(p.get("items", {}).get("ironball", 0.0), 4),
            "abilities": {a: round(p["abilities"][a], 4) for a in SPEED_ABILITIES if p.get("abilities", {}).get(a, 0) >= 0.01},
            "spread": _spread(f["dist"]),
            "priority": _priority(p, sd),
        }
        if name in prev_forms:
            e["prev_dist"] = [[v, round(s, 4)] for v, s in sorted(prev_forms[name]["dist"].items()) if s >= 0.0005]
        pokemon[name] = e

    # 調整（1〜31 ポイント）の量を、実数値ごとに（使用率の重み）
    aimed_at: dict[int, dict[str, float]] = {}
    for name, f in forms.items():
        for key, share in f["p"]["speed"].items():
            pts = int(key[1:])
            if 0 < pts < 32:
                v = stat(f["base"], pts, key[0])
                aimed_at.setdefault(v, {})
                aimed_at[v][name] = aimed_at[v].get(name, 0.0) + f["p"]["usage"] * share / sum(f["p"]["speed"].values())

    def aimed(v, owner):
        return round(sum(m for k, m in aimed_at.get(v + 1, {}).items() if k != owner), 4)

    lines = []
    for name, f in forms.items():
        u = f["p"]["usage"]
        if u < LINE_MIN_USAGE:
            continue
        for v, s in f["dist"].items():
            if s >= LINE_MIN_SHARE:
                lines.append({"value": v, "name": name, "share": round(s, 4), "kind": f["kinds"][v], "scarf": False,
                              "weight": round(u * s, 4), "aimed": aimed(v, name)})
        scarf = f["p"].get("items", {}).get("choicescarf", 0.0)
        if scarf >= SCARF_MIN:
            tot = sum(f["p"]["speed"].values())
            for key in ("+32", "=32"):
                s = f["p"]["speed"].get(key, 0.0) / tot
                if s >= 0.1:
                    v = modify(stat(f["base"], 32, key[0]), 3, 2)
                    lines.append({"value": v, "name": name, "share": round(s, 4), "kind": KIND[key], "scarf": True,
                                  "scarf_share": round(scarf, 4), "weight": round(u * scarf * s, 4), "aimed": aimed(v, name)})
    lines.sort(key=lambda x: (-x["value"], x["name"]))
    return {"month": cur["month"], "prev_month": prev["month"] if prev else None, "cutoff": cur["cutoff"],
            "pokemon": pokemon, "lines": lines}


# 画面側と同じ計算（テストと答え合わせ用）
def p_faster(v: int, dist: list[list]) -> float:
    """実数値 v が、分布 dist の相手より先に動く確率（同速は 1/2）。"""
    return sum(s for x, s in dist if x < v) + 0.5 * sum(s for x, s in dist if x == v)


def mean_speed(e: dict) -> float:
    return sum(v * s for v, s in e["dist"]) / sum(s for _, s in e["dist"])


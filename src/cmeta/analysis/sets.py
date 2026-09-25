"""型（持ち物・技）の移り変わり: 月 × レート帯（Smogon の月次統計）。

割合は「そのポケモンを入れたチームのうち、その持ち物・技を入れていた割合」（重み付き）。
有効件数: そのレート帯でのそのポケモンの重みの合計（1 チームの重みは 0〜1。足切りが高いほど小さい）。
比べるもの:
    - month: 標準の足切りで、先月 → 今月（同じルール）
    - top: 今月、足切り 0（全体）→ 一番高い足切り（上位）
確かさは出さない: 月次統計の件数は対戦の数で、同じ人の同じチームが何度も数えられている（人の情報は無い）。
    独立と見なして検定すると、比べたものの半分以上が「はっきり」になる（2026-09 に試して確認）。
    そのため、差の大きさが NOTABLE 以上のものを「大きく動いた」として並べるだけにする。上位（高い足切り）は人が少なく、
    少数の人のチームで大きく動くことがあるので、重みの合計が MIN_TOP_WEIGHT 未満の姿は比べない。
表示の対象: 標準の足切りで使用率 MIN_USAGE 以上の姿、どちらかで割合 MIN_SHARE 以上の持ち物・技。
"""

MIN_USAGE = 0.03
MIN_SHARE = 0.05
NOTABLE = 0.15
MIN_TOP_WEIGHT = 100.0


def _r(v, n=4):
    return round(float(v), n)


def build(data: dict, fid: str, months: list[str], cutoffs: list[int], default_cutoff: int) -> dict:
    """data: smogon.load_all() の {(月, ルール, 足切り): 縮めた月次}。months: そのルールの月（古い順）。"""
    cur_m = months[-1]
    prev_m = months[-2] if len(months) > 1 else None
    cuts = [c for c in cutoffs if (cur_m, fid, c) in data]
    lo_cut, hi_cut = min(cuts), max(cuts)

    def get(m, c):
        return (data.get((m, fid, c)) or {}).get("pokemon", {})

    cur_def = get(cur_m, default_cutoff)
    names = sorted((k for k, p in cur_def.items() if p["usage"] >= MIN_USAGE and "items" in p),
                   key=lambda k: -cur_def[k]["usage"])
    out = {"month": cur_m, "prev_month": prev_m, "cutoffs": cuts, "default_cutoff": default_cutoff,
           "low_cutoff": lo_cut, "high_cutoff": hi_cut, "pokemon": {}, "changes": []}
    changes = []
    for k in names:
        e = {"n": {}, "items": {}, "moves": {}}
        cells = {(m, c): get(m, c).get(k) for m in (cur_m, prev_m) if m for c in cuts}
        for (m, c), p in cells.items():
            if p:
                e["n"][f"{m}:{c}"] = _r(p["weight"], 1)
        for kind in ("items", "moves"):
            keys = set()
            for p in cells.values():
                if p and kind in p:
                    keys |= {x for x, v in p[kind].items() if v >= MIN_SHARE}
            for x in sorted(keys):
                e[kind][x] = {f"{m}:{c}": _r(p[kind].get(x, 0.0)) for (m, c), p in cells.items() if p and kind in p}
                # 先月 → 今月（標準の足切り）
                a_p, b_p = cells.get((prev_m, default_cutoff)), cells.get((cur_m, default_cutoff))
                if a_p and b_p and kind in a_p and kind in b_p:
                    changes.append({"name": k, "kind": kind, "key": x, "type": "month",
                                    "a": a_p[kind].get(x, 0.0), "b": b_p[kind].get(x, 0.0)})
                # 全体 → 上位（今月）
                a_p, b_p = cells.get((cur_m, lo_cut)), cells.get((cur_m, hi_cut))
                if a_p and b_p and kind in a_p and kind in b_p and lo_cut != hi_cut and b_p["weight"] >= MIN_TOP_WEIGHT:
                    changes.append({"name": k, "kind": kind, "key": x, "type": "top",
                                    "a": a_p[kind].get(x, 0.0), "b": b_p[kind].get(x, 0.0), "top_weight": _r(b_p["weight"], 1)})
        out["pokemon"][k] = e
    for c in changes:
        c["diff"] = _r(c["b"] - c["a"])
        c["a"], c["b"] = _r(c["a"]), _r(c["b"])
    out["changes"] = sorted((c for c in changes if abs(c["diff"]) >= NOTABLE), key=lambda c: -abs(c["diff"]))
    out["compared"] = len(changes)
    return out

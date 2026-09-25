"""月次（Smogon）の解析: M1 使用率と順位、M2 多様さ、M3 入れ替わり、M4 伸びた・落ちた、M5 上位ほど使われる、M7 型。

入力は smogon.load_all() の {(月, ルール, 足切り): 縮約}。ルールごとの dict を返す（JSON にそのまま書ける形）。
"""

from collections import defaultdict

from ..config import DEFAULT_CUTOFF, MONTHLY_TOP_SETS
from .stats import hill, morisita_horn, normalize

SERIES_TOP = 100  # どこかの月でこの順位以内に入ったものだけ系列を出す
MOVERS_N = 10
GAP_N = 15
SETS_TOP_POKEMON = 40


def _grouped(pokemon: dict, group_of) -> dict[str, float]:
    """姿ごとの使用率を「元の姿にまとめた」使用率にする。"""
    out: dict[str, float] = defaultdict(float)
    for name, p in pokemon.items():
        out[group_of(name)] += p["usage"]
    return dict(out)


def _ranks(usage: dict[str, float]) -> dict[str, int]:
    order = sorted(usage, key=lambda k: (-usage[k], k))
    return {k: i + 1 for i, k in enumerate(order)}


def _series(by_month: dict[str, dict[str, float]], months: list[str]) -> tuple[dict, dict]:
    keep = set()
    for u in by_month.values():
        keep.update(k for k, r in _ranks(u).items() if r <= SERIES_TOP)
    usage = {k: [round(by_month[m].get(k, 0.0), 6) if m in by_month else None for m in months] for k in sorted(keep)}
    ranks_by_month = {m: _ranks(u) for m, u in by_month.items()}
    rank = {k: [ranks_by_month[m].get(k) if m in ranks_by_month else None for m in months] for k in sorted(keep)}
    return usage, rank


def _movers(prev: dict[str, float], cur: dict[str, float]) -> dict:
    pr, cr = _ranks(prev), _ranks(cur)
    rows = []
    for k in sorted(set(prev) | set(cur)):
        a, b = prev.get(k, 0.0), cur.get(k, 0.0)
        rows.append({"name": k, "from": round(a, 6), "to": round(b, 6), "delta": round(b - a, 6),
                     "rank_from": pr.get(k), "rank_to": cr.get(k)})
    rising = sorted((r for r in rows if r["delta"] > 0), key=lambda r: (-r["delta"], r["name"]))[:MOVERS_N]
    falling = sorted((r for r in rows if r["delta"] < 0), key=lambda r: (r["delta"], r["name"]))[:MOVERS_N]
    new = sorted((r for r in rows if (r["rank_to"] or 999) <= 30 and (r["rank_from"] or 999) > 30),
                 key=lambda r: r["rank_to"])
    return {"rising": rising, "falling": falling, "new_top30": new}


def analyze_format(data: dict, fid: str, group_of) -> dict | None:
    months = sorted({m for (m, f, _c) in data if f == fid})
    if not months:
        return None
    cutoffs = sorted({c for (_m, f, c) in data if f == fid})
    base_c = DEFAULT_CUTOFF if DEFAULT_CUTOFF in cutoffs else cutoffs[0]
    out: dict = {"format": fid, "months": months, "cutoffs": cutoffs, "default_cutoff": base_c}

    out["battles"] = {str(c): [data[(m, fid, c)]["battles"] if (m, fid, c) in data else None for m in months]
                      for c in cutoffs}

    # M1 使用率と順位（姿ごと・まとめたもの）
    out["usage"], out["rank"], out["usage_grouped"], out["rank_grouped"] = {}, {}, {}, {}
    for c in cutoffs:
        forms = {m: {k: p["usage"] for k, p in data[(m, fid, c)]["pokemon"].items()}
                 for m in months if (m, fid, c) in data}
        grouped = {m: _grouped(data[(m, fid, c)]["pokemon"], group_of) for m in months if (m, fid, c) in data}
        out["usage"][str(c)], out["rank"][str(c)] = _series(forms, months)
        out["usage_grouped"][str(c)], out["rank_grouped"][str(c)] = _series(grouped, months)

    grouped_base = {m: _grouped(data[(m, fid, base_c)]["pokemon"], group_of)
                    for m in months if (m, fid, base_c) in data}

    # M2 多様さ（まとめた使用率を割合に直して）、M3 前月との入れ替わり、M4 伸びた・落ちた
    out["diversity"], out["turnover"], out["movers"] = {}, {}, {}
    prev_m = None
    for m in months:
        if m not in grouped_base:
            continue
        p = normalize(grouped_base[m])
        out["diversity"][m] = {"q0": hill(p.values(), 0), "q1": round(hill(p.values(), 1), 3),
                               "q2": round(hill(p.values(), 2), 3)}
        if prev_m:
            out["turnover"][m] = round(1 - morisita_horn(normalize(grouped_base[prev_m]), p), 5)
            out["movers"][m] = _movers(grouped_base[prev_m], grouped_base[m])
        prev_m = m

    # M5 上位ほど使われる: 最上段と 0 の差（まとめた使用率）
    lo_c, hi_c = min(cutoffs), max(cutoffs)
    out["cutoff_gap"] = {"low": lo_c, "high": hi_c, "months": {}}
    if lo_c != hi_c:
        for m in months:
            if (m, fid, lo_c) not in data or (m, fid, hi_c) not in data:
                continue
            lo = _grouped(data[(m, fid, lo_c)]["pokemon"], group_of)
            hi = _grouped(data[(m, fid, hi_c)]["pokemon"], group_of)
            rows = [{"name": k, "low": round(lo.get(k, 0), 6), "high": round(hi.get(k, 0), 6),
                     "diff": round(hi.get(k, 0) - lo.get(k, 0), 6)}
                    for k in sorted(set(lo) | set(hi)) if max(lo.get(k, 0), hi.get(k, 0)) >= 0.01]
            out["cutoff_gap"]["months"][m] = {
                "higher_at_top": sorted((r for r in rows if r["diff"] > 0), key=lambda r: (-r["diff"], r["name"]))[:GAP_N],
                "lower_at_top": sorted((r for r in rows if r["diff"] < 0), key=lambda r: (r["diff"], r["name"]))[:GAP_N],
            }

    # M7 型（姿ごと。上位のポケモンだけ）と、メガの内訳
    out["sets"], out["mega_split"] = {}, {}
    for m in months:
        if (m, fid, base_c) not in data:
            continue
        pk = data[(m, fid, base_c)]["pokemon"]
        top = sorted(pk, key=lambda k: (-pk[k]["usage"], k))[:SETS_TOP_POKEMON]
        out["sets"][m] = {
            k: {f: dict(list(pk[k][f].items())[:MONTHLY_TOP_SETS]) for f in ("items", "moves", "abilities", "spreads")}
            for k in top
        }
        split: dict[str, dict[str, float]] = defaultdict(dict)
        for k, p in pk.items():
            split[group_of(k)][k] = p["usage"]
        out["mega_split"][m] = {
            g: {k: round(v / sum(forms.values()), 4) for k, v in forms.items()}
            for g, forms in split.items() if len(forms) > 1 and sum(forms.values()) >= 0.01
        }
    return out


DETAIL_MIN_USAGE = 0.005  # ポケモン詳細を出す下限（チームあたり 0.5%）
DETAIL_TOP = 12  # 技・持ち物などを何位まで
TEAMMATES_TOP = 12


def pokemon_detail(data: dict, fid: str, month: str, cutoff: int) -> dict | None:
    """その月・その足切りの、ポケモンごとの型と「一緒に使われる相手」（姿ごと）。ポケモン詳細ページ用。

    teammates の share は「a のチームに b もいた割合」= Teammates[a][b] / w_a。
    """
    d = data.get((month, fid, cutoff))
    if not d:
        return None
    pk = d["pokemon"]
    ranks = _ranks({k: p["usage"] for k, p in pk.items()})
    out = {}
    for k, p in pk.items():
        if p["usage"] < DETAIL_MIN_USAGE or "items" not in p:
            continue
        tm = sorted(((b, w / p["weight"]) for b, w in p.get("teammates", {}).items()), key=lambda t: (-t[1], t[0]))
        out[k] = {
            "usage": p["usage"], "rank": ranks[k], "raw": p["raw"],
            **{f: dict(list(p[f].items())[:DETAIL_TOP]) for f in ("moves", "items", "abilities", "spreads")},
            "teammates": [[b, round(s, 4)] for b, s in tm[:TEAMMATES_TOP]],
        }
    return {"format": fid, "month": month, "cutoff": cutoff, "battles": d["battles"], "pokemon": out}


def join_track(per_format: dict[str, dict], formats: list[dict]) -> dict[str, dict]:
    """同じ系統（例: vgc2026）のレギュレーションを月順につなぐ。ある月に二つあれば、対戦数の多いほうを採る。"""
    tracks: dict[str, list[dict]] = defaultdict(list)
    for f in formats:
        if f["id"] in per_format:
            tracks[f["track"]].append(f)
    out = {}
    for track, fs in tracks.items():
        chosen: dict[str, tuple[int, dict]] = {}
        for f in fs:
            mo = per_format[f["id"]]
            b0 = mo["battles"][str(mo["cutoffs"][0])]
            for m, n in zip(mo["months"], b0):
                if n is not None and (m not in chosen or n > chosen[m][0]):
                    chosen[m] = (n, f)
        months = sorted(chosen)
        segs = [{"month": m, "format": chosen[m][1]["id"], "regulation": chosen[m][1]["regulation"]} for m in months]
        # 使用率（まとめたもの・標準の足切り）を月ごとに寄せ集める
        usage: dict[str, list] = defaultdict(lambda: [None] * len(months))
        for i, m in enumerate(months):
            mo = per_format[chosen[m][1]["id"]]
            c = str(mo["default_cutoff"] if str(mo["default_cutoff"]) in mo["usage_grouped"] else mo["cutoffs"][0])
            j = mo["months"].index(m)
            for k, series in mo["usage_grouped"][c].items():
                if series[j] is not None:
                    usage[k][i] = series[j]
        out[track] = {"track": track, "months": months, "segments": segs,
                      "usage_grouped": dict(sorted(usage.items()))}
    return out

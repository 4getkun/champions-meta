"""選出予想の成績表: 公開した予想を保存しておき、そのあとに起きた試合で答え合わせする（後から作る余地の無い、前向きの答え合わせ）。

保存: data/predlog/<ルール>/<JST の日付>.json.gz（公開した select/ から、答え合わせと例を除いたもの）。
答え合わせ: 1 試合（重なりを除いた 1 側）ごとに、その試合より前（trained.to より後）に保存された一番新しい予想を 1 つだけ使う。
    保存から MAX_AGE_DAYS 日を過ぎた試合は数えない（古い予想で数え続けないため）。
    比べる相手は、同じ保存の材料の表で「全体の率だけ」（base と lead_base の重みだけ 1）にしたもの。
作り直し（seeded）: 成績表を始めた日より前の日について、その日までの試合と、その日より前に公開された月次統計だけで
    予想を作り直したもの。画面には作り直しであることを出す。
"""

import gzip
import json
import math
from collections import defaultdict
from datetime import datetime

import numpy as np

from ..config import DATA, JST
from .joint import Featurizer, _unround, bootstrap_diff, marginals, options, probs
from .select import dedupe, samples

PREDLOG = DATA / "predlog"
MAX_AGE_DAYS = 7
KEEP = ("model", "usable", "temperature", "k_bring", "k_lead", "m", "features", "weights", "g_bring", "g_lead",
        "base", "vs", "cobring", "roles", "avg_opp", "trained")


def _path(fmt: str, day: str):
    return PREDLOG / fmt / f"{day}.json.gz"


def save(fmt: str, pub: dict, day: str | None = None, seeded: bool = False) -> None:
    if not pub.get("available") or pub.get("model") != "joint":
        return
    day = day or datetime.fromtimestamp(pub["trained"]["to"], JST).strftime("%Y-%m-%d")
    obj = {k: pub[k] for k in KEEP if k in pub}
    obj.update({"day": day, "seeded": seeded})
    p = _path(fmt, day)
    p.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with open(p, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        f.write(body)


def load(fmt: str) -> list[dict]:
    out = []
    for p in sorted((PREDLOG / fmt).glob("*.json.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as f:
            out.append(json.load(f))
    return sorted(out, key=lambda s: s["trained"]["to"])


def _featurizer(snap: dict, sd) -> Featurizer:
    stats = {"g_bring": snap["g_bring"], "g_lead": snap["g_lead"], "base": snap["base"], "vs": snap["vs"], "m": snap.get("m", 10.0),
             "cobring": {tuple(k.split("|")): v for k, v in snap["cobring"].items()}}
    return Featurizer(stats, _unround(snap["roles"]), sd, snap["k_bring"])


def evaluate(fmt: str, rows: list[dict], group_of, sd) -> dict:
    snaps = load(fmt)
    if not snaps:
        return {"available": False, "reason": "保存した予想がまだ無い"}
    kb, kl = snaps[0]["k_bring"], snaps[0]["k_lead"]
    xs = [x for x in dedupe(sorted(samples(rows, group_of), key=lambda x: x["t"]))
          if len(x["brought"]) == kb and len(x["leads"]) == kl]
    feats = {}
    per_m, per_b, used = [], [], []
    by_snap = defaultdict(lambda: [0, 0.0, 0.0])
    cal = defaultdict(lambda: [0.0, 0.0, 0])
    si = -1
    for x in xs:
        while si + 1 < len(snaps) and snaps[si + 1]["trained"]["to"] < x["t"]:
            si += 1
        if si < 0 or x["t"] - snaps[si]["trained"]["to"] > MAX_AGE_DAYS * 86400:
            continue
        snap = snaps[si]
        if snap["day"] not in feats:
            feats[snap["day"]] = _featurizer(snap, sd)
        feat = feats[snap["day"]]
        opts = options(x["team"], kb, kl)
        y = next((i for i, (s, l_) in enumerate(opts) if s == x["brought"] and l_ == x["leads"]), None)
        if y is None:
            continue
        X = feat.matrix(x["team"], x["opp"], opts)
        w = np.array(snap["weights"])
        wb = np.array([1.0 if n in ("base", "lead_base") else 0.0 for n in snap["features"]])
        rec = []
        for ww in (w, wb):
            p = probs(X, ww)
            bring, lead = marginals(p, opts, x["team"])
            tb = sorted(bring, key=lambda k: (-bring[k], k))[:kb]
            tl = sorted(lead, key=lambda k: (-lead[k], k))[:kl]
            rec.append((len(set(tb) & x["brought"]) / kb, len(set(tl) & x["leads"]) / kl, math.log(max(p[y], 1e-12)), bring))
        per_m.append(rec[0][:3])
        per_b.append(rec[1][:3])
        used.append(x["t"])
        e = by_snap[snap["day"]]
        e[0] += 1
        e[1] += rec[0][0]
        e[2] += rec[1][0]
        for k, pk in rec[0][3].items():
            c = cal[min(int(pk * 10), 9)]
            c[0] += pk
            c[1] += k in x["brought"]
            c[2] += 1
    if len(per_m) < 30:
        return {"available": False, "reason": f"答え合わせできた試合が少ない（{len(per_m)}）", "snapshots": len(snaps)}

    def cmp(idx):
        m, lo, hi = bootstrap_diff(per_m, per_b, idx)
        return {"model": round(float(np.mean([p[idx] for p in per_m])), 4),
                "baseline": round(float(np.mean([p[idx] for p in per_b])), 4),
                "diff": round(m, 4), "ci": [round(lo, 4), round(hi, 4)]}

    seeded_days = [s["day"] for s in snaps if s.get("seeded")]
    return {
        "available": True, "n": len(per_m), "snapshots": len(snaps), "from": int(min(used)), "to": int(max(used)),
        "seeded_until": max(seeded_days) if seeded_days else None, "max_age_days": MAX_AGE_DAYS,
        "bring": cmp(0), "lead": cmp(1), "loglik": cmp(2),
        "by_day": [[d, n, round(a / n, 4), round(b / n, 4)] for d, (n, a, b) in sorted(by_snap.items())],
        "calibration": [[round(c[0] / c[2], 3), round(c[1] / c[2], 3), c[2]] for _, c in sorted(cal.items()) if c[2]],
    }


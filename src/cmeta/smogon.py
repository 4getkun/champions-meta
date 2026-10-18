"""Smogon の月次統計（chaos JSON）を取ってきて、必要な部分だけに縮めて data/smogon/ に置く。

chaos の値はどれも「重み付きの件数」。ポケモン a の重み w_a は Abilities の合計、全体の重み W は
w_a / usage_a（どのポケモンでも同じ）。usage は 6 匹の枠に占める割合で、全体の合計は約 6。
"""

import gzip
import json
import os
import re
import tempfile
import time
from datetime import datetime

from . import http
from .config import CACHE, CORE_MIN_WEIGHT_SHARE, CUTOFFS, DATA, DEFAULT_CUTOFF, FIRST_MONTH, JST, SMOGON_BASE
from .formats import month_range, parse_format

SMOGON_DIR = DATA / "smogon"

TOP_ITEMS = 10
TOP_MOVES = 12
TOP_SPREADS = 3
SETS_MIN_USAGE = 0.01  # 標準以外の足切りでも、これ以上のポケモンは持ち物・技・特性を残す（レート帯ごとの型の比較のため）
TEAMMATE_MIN_USAGE = CORE_MIN_WEIGHT_SHARE * 6  # これ未満のポケモンはコアの網に入らないので、味方の表を持たない


def last_complete_month(now: datetime | None = None) -> str:
    now = now or datetime.now(JST)
    y, m = now.year, now.month - 1
    if m == 0:
        y, m = y - 1, 12
    return f"{y:04d}-{m:02d}"


def list_files(month: str) -> list[tuple[str, int]]:
    """その月の chaos にあるチャンピオンズの (ルール名, 足切り)。月がまだ無ければ空。"""
    try:
        html = http.get_text(f"{SMOGON_BASE}/{month}/chaos/")
    except http.NotFound:
        return []
    out = []
    for fid, cut in re.findall(r'href="([a-z0-9]+)-(\d+)\.json"', html):
        if parse_format(fid) and int(cut) in CUTOFFS:
            out.append((fid, int(cut)))
    return sorted(set(out))


def _cached_list_files(month: str, bypass: bool = False) -> list[tuple[str, int]]:
    """月一覧を短期キャッシュする。元の list_files は常にAPIを直接読む。"""
    cache_path = CACHE / "smogon" / "index" / f"{month}.json"
    now = int(time.time())
    if not bypass and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text("utf-8"))
            checked_at = cached["checked_at"]
            pairs = cached["files"]
            if (type(checked_at) is int and isinstance(pairs, list)
                    and all(isinstance(p, list) and len(p) == 2 and isinstance(p[0], str)
                            and type(p[1]) is int for p in pairs)):
                age = now - checked_at
                ttl = 30 * 60 if not pairs else (6 * 3600 if month == last_complete_month() else 7 * 86400)
                if 0 <= age < ttl:
                    return [(fid, cut) for fid, cut in pairs]
        except (OSError, ValueError, KeyError, TypeError):
            pass

    files = list_files(month)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"checked_at": now, "files": [[fid, cut] for fid, cut in files]},
                         separators=(",", ":"))
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=cache_path.parent,
                                         prefix=f"{cache_path.name}.", suffix=".tmp", delete=False) as f:
            tmp_path = f.name
            f.write(payload)
        os.replace(tmp_path, cache_path)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    return files


SPEED_UP = {"Timid", "Jolly", "Hasty", "Naive"}
SPEED_DOWN = {"Brave", "Quiet", "Relaxed", "Sassy"}


def speed_points(spreads: dict[str, float], weight: float) -> dict[str, float]:
    """振り方（性格:H/A/B/C/D/S）を、すばやさだけの分布にまとめる。キーは「性格補正の向き + ポイント」
    （'+32' = すばやさ上昇の性格で 32、'=0' = 補正なしで 0、'-0' = すばやさ下降の性格で 0）。値はそのポケモンの重みに対する割合。
    上位だけに切らない（すばやさの線は、少数の調整の振り方が大事なので）。"""
    out: dict[str, float] = {}
    for sp, w in spreads.items():
        nature, pts = sp.split(":")
        sign = "+" if nature in SPEED_UP else "-" if nature in SPEED_DOWN else "="
        key = f"{sign}{int(pts.split('/')[5])}"
        out[key] = out.get(key, 0.0) + w / weight
    return {k: round(v, 5) for k, v in sorted(out.items()) if v >= 1e-5}


def _top(d: dict, weight: float, n: int) -> dict[str, float]:
    items = sorted(((k, v / weight) for k, v in d.items() if v > 0), key=lambda t: -t[1])[:n]
    return {k: round(v, 5) for k, v in items}


def condense(chaos: dict, month: str, full: bool = True) -> dict:
    """full=False なら使用率まわりと、使用率 SETS_MIN_USAGE 以上のポケモンの持ち物・技・特性だけ残す（振り方・味方の表は標準の足切りだけ）。"""
    info = chaos["info"]
    data = chaos["data"]
    weights = {name: sum(p["Abilities"].values()) for name, p in data.items()}
    # 全体の重み W: 使用率の大きいものから推定する（小さいものは丸め誤差が大きい）
    top = max(data, key=lambda k: data[k]["usage"])
    total_w = weights[top] / data[top]["usage"] if data[top]["usage"] > 0 else 0.0
    keep_tm = {n for n, p in data.items() if p["usage"] >= TEAMMATE_MIN_USAGE}
    pokemon = {}
    for name, p in data.items():
        w = weights[name]
        if w <= 0:
            continue
        entry = {"usage": round(p["usage"], 6), "raw": p["Raw count"], "weight": round(w, 3)}
        if not full and p["usage"] >= SETS_MIN_USAGE:
            entry.update({
                "abilities": _top(p["Abilities"], w, 5),
                "items": _top(p["Items"], w, TOP_ITEMS),
                "moves": _top(p["Moves"], w, TOP_MOVES),
            })
        if full:
            entry.update({
                "abilities": _top(p["Abilities"], w, 5),
                "items": _top(p["Items"], w, TOP_ITEMS),
                "moves": _top(p["Moves"], w, TOP_MOVES),
                "spreads": _top(p["Spreads"], w, TOP_SPREADS),
                "speed": speed_points(p["Spreads"], w),
            })
        if full and name in keep_tm:
            entry["teammates"] = {
                k: round(v, 2) for k, v in sorted(p["Teammates"].items()) if k in keep_tm and v > 0 and k != name
            }
        pokemon[name] = entry
    return {
        "month": month,
        "format": info["metagame"],
        "cutoff": info["cutoff"],
        "battles": info["number of battles"],
        "total_weight": round(total_w, 3),
        "pokemon": pokemon,
    }


def path_for(month: str, fid: str, cutoff: int):
    return SMOGON_DIR / month / f"{fid}-{cutoff}.json.gz"


def sync(months: list[str] | None = None, log=print, recondense: bool = False) -> list[str]:
    """まだ持っていない月を取ってくる。取った (月/ルール-足切り) を返す。

    recondense=True: 持っている月も .cache の生データから縮め直す（縮め方を変えたとき）。
    """
    months = months or month_range(FIRST_MONTH, last_complete_month())
    got = []
    for month in months:
        files = _cached_list_files(month, bypass=recondense)
        if not files:
            log(f"smogon {month}: まだ公開されていない")
            continue
        for fid, cut in files:
            dst = path_for(month, fid, cut)
            if dst.exists() and not recondense:
                continue
            url = f"{SMOGON_BASE}/{month}/chaos/{fid}-{cut}.json"
            raw = http.cached_bytes(url, CACHE / "smogon" / month / f"{fid}-{cut}.json")
            small = condense(json.loads(raw), month, full=cut == DEFAULT_CUTOFF)
            dst.parent.mkdir(parents=True, exist_ok=True)
            body = json.dumps(small, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            with open(dst, "wb") as raw_f, gzip.GzipFile(fileobj=raw_f, mode="wb", mtime=0) as f:
                f.write(body)  # mtime=0: 同じ中身なら同じバイト列
            got.append(f"{month}/{fid}-{cut}")
            log(f"smogon {month}/{fid}-{cut}: {small['battles']} 戦, {len(small['pokemon'])} 匹")
    return got


def load_all() -> dict[tuple[str, str, int], dict]:
    """data/smogon/ にあるものを {(月, ルール, 足切り): 中身} で。"""
    out = {}
    for p in sorted(SMOGON_DIR.glob("*/*.json.gz")):
        m = re.match(r"(.+)-(\d+)\.json\.gz$", p.name)
        if not m:
            continue
        with gzip.open(p, "rt", encoding="utf-8") as f:
            out[(p.parent.name, m.group(1), int(m.group(2)))] = json.load(f)
    return out

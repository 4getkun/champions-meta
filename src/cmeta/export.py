"""解析を回して out/ に JSON を書く。形は docs/DATA_CONTRACT.md が正本。"""

import json
from datetime import datetime

from . import smogon
from .analysis import changepoint, cores, matchup, monthly, weekly
from .config import DATA, DEFAULT_CUTOFF, JST, OUT, REPLAY_BASE, SMOGON_BASE
from .dex import JaNames, Showdown
from .formats import parse_format
from .replays import REPLAY_DIR, jst_day, load_rows

SCHEMA_VERSION = 1
CHANGEPOINT_TOP = 30


def _write(rel: str, obj) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def _month_of(ts: int) -> str:
    return datetime.fromtimestamp(ts, JST).strftime("%Y-%m")


def _events() -> list[dict]:
    """手で書く出来事（data/events.json）。日付が確かなものだけを書く決まり。"""
    p = DATA / "events.json"
    return json.loads(p.read_text("utf-8")).get("events", []) if p.exists() else []


def replay_formats() -> list[str]:
    return sorted(p.name for p in REPLAY_DIR.iterdir() if p.is_dir()) if REPLAY_DIR.exists() else []


def build(fetch_names: bool = True, log=print) -> dict:
    sd = Showdown()
    group_of = sd.group_name
    data = smogon.load_all()
    fids = sorted({f for (_m, f, _c) in data} | set(replay_formats()))
    formats = [f for f in (parse_format(x) for x in fids) if f]

    names_pokemon: set[str] = set()
    names_items: set[str] = set()
    names_moves: set[str] = set()
    names_abilities: set[str] = set()
    fmt_meta = []

    per_format = {}
    cores_by_format: dict[str, dict] = {}
    for f in formats:
        fid = f["id"]
        mo = monthly.analyze_format(data, fid, group_of)
        entry = {**f, "months": [], "replay_days": 0}
        if mo:
            per_format[fid] = mo
            entry["months"] = mo["months"]
            _write(f"monthly/{fid}.json", mo)
            for c in mo["usage"].values():
                names_pokemon.update(c)
            for c in mo["usage_grouped"].values():
                names_pokemon.update(c)
            for sets in mo["sets"].values():
                for k, s in sets.items():
                    names_pokemon.add(k)
                    names_items.update(s["items"])
                    names_moves.update(s["moves"])
                    names_abilities.update(s["abilities"])
            # M6 コア（標準の足切り）
            cut = mo["default_cutoff"]
            month_datas = {m: data[(m, fid, cut)] for m in mo["months"] if (m, fid, cut) in data}
            co = cores.analyze(month_datas)
            co.update({"format": fid, "cutoff": cut})
            cores_by_format[fid] = co
            _write(f"cores/{fid}.json", co)
            for md in co["months"].values():
                names_pokemon.update(n["name"] for n in md["nodes"])

        rows = load_rows(fid) if (REPLAY_DIR / fid).exists() else []
        if rows:
            entry["replay_days"] = len({jst_day(r["t"]) for r in rows})
            wk = weekly.analyze(rows, group_of, doubles=f["game_type"] == "doubles")
            if wk.get("available"):
                days, n, counts = weekly.daily_counts(rows, group_of)
                top = list(wk["pokemon"])[:CHANGEPOINT_TOP]
                wk["alerts"] = changepoint.detect_all(days, n, counts, top)
                names_pokemon.update(wk["pokemon"])
            wk.update({"format": fid, "replays": len(rows)})
            _write(f"weekly/{fid}.json", wk)

            # X1〜X3（コアがあるルールだけ）
            co = cores_by_format.get(fid)
            if co:
                cores_gm = {
                    m: [{"id": c["id"], "members": frozenset(group_of(x) for x in c["members"])} for c in md["cores"]]
                    for m, md in co["months"].items()
                }
                gm = matchup.games_by_month(rows, group_of, cores_gm, _month_of)
                res = {m: matchup.analyze_month(g) for m, g in sorted(gm.items())}
                ms = sorted(res)
                for a, b in zip(ms, ms[1:]):
                    if res[a].get("available") and res[b].get("available"):
                        res[a]["forecast_score"] = matchup.score_forecast(res[a]["pressure"], res[a]["share"],
                                                                         res[b]["share"])
                _write(f"matchup/{fid}.json", {"format": fid, "experimental": True, "months": res})
        fmt_meta.append(entry)

    tracks = monthly.join_track(per_format, formats)
    for t, obj in tracks.items():
        _write(f"tracks/{t}.json", obj)

    # 名前（日本語は PokeAPI、取ったものは控える）
    ja = JaNames(sd)
    warnings = []
    names = {"pokemon": {}, "items": {}, "moves": {}, "abilities": {}}
    for n in sorted(names_pokemon):
        e = sd.species(n)
        names["pokemon"][n] = {
            "ja": ja.species(n) if fetch_names else None,
            "group": group_of(n),
            "mega": sd.is_mega(n),
            "types": e["types"] if e else None,
            "num": e["num"] if e else None,
            "base_stats": e["baseStats"] if e else None,
        }
    for kind, ids, en_of, ja_of in (
        ("items", names_items, sd.item_names, ja.item),
        ("moves", names_moves, sd.move_names, ja.move),
        ("abilities", names_abilities, sd.ability_names, ja.ability),
    ):
        for i in sorted(ids):
            if i in ("", "nothing", "noability"):
                continue
            names[kind][i] = {"en": en_of.get(i), "ja": ja_of(i) if fetch_names else None}
    ja.save()
    for kind, d in names.items():
        missing = [k for k, v in d.items() if not v["ja"]]
        if missing and fetch_names:
            warnings.append({"kind": f"no_ja_name:{kind}", "count": len(missing), "examples": missing[:20]})
    by_ja: dict[str, list[str]] = {}
    for k, v in names["pokemon"].items():
        if v["ja"]:
            by_ja.setdefault(v["ja"], []).append(k)
    dup = {j: ks for j, ks in by_ja.items() if len(ks) > 1}
    if dup:  # 姿の違いが日本語名で区別できていない。data/name_overrides.json で直す
        warnings.append({"kind": "duplicate_ja_name:pokemon", "count": len(dup),
                         "examples": [f"{j}: {', '.join(ks)}" for j, ks in list(dup.items())[:20]]})
    _write("names.json", names)

    meta = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "default_cutoff": DEFAULT_CUTOFF,
        "formats": fmt_meta,
        "tracks": {t: {"months": o["months"], "segments": o["segments"]} for t, o in tracks.items()},
        "sources": [
            {"name": "Smogon usage statistics", "url": SMOGON_BASE},
            {"name": "Pokémon Showdown replays", "url": REPLAY_BASE},
            {"name": "Pokémon Showdown data (MIT)", "url": "https://github.com/smogon/pokemon-showdown"},
            {"name": "PokeAPI (BSD-3-Clause)", "url": "https://pokeapi.co/"},
        ],
        "events": _events(),
        "warnings": warnings,
    }
    _write("meta.json", meta)
    log(f"build: {len(formats)} ルール、名前 {len(names['pokemon'])} 匹、PokeAPI への問い合わせ {ja.fetched} 回")
    return meta

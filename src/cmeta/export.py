"""解析を回して out/ に JSON を書く。形は docs/DATA_CONTRACT.md が正本。"""

import hashlib
import json
from datetime import datetime
from pathlib import Path

from . import ladder, smogon
from .analysis import changepoint, cores, diag, induce, joint, matchup, monthly, select, speed, toprate, weekly
from .analysis import sets as set_trends
from .analysis import early, track
from .config import DATA, DEFAULT_CUTOFF, JST, OUT, REPLAY_BASE, SMOGON_BASE
from .dex import JaNames, Showdown, sprite_urls
from .formats import parse_format
from .replays import REPLAY_DIR, jst_day, load_rows

SCHEMA_VERSION = 1
CHANGEPOINT_TOP = 30


def _write(rel: str, obj) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


# ── 変わっていないルールの計算を飛ばす（GitHub Actions の使用時間を抑えるため） ─────────────
# リプレイ・月次・ランキングの入力内容と解析コードが前回と同じなら、書き出し済みの結果を再利用する。
# 通信やCLI・配布だけの変更は予測モデルの再学習を必要としない。
INPUTS_PATH = OUT / "build_inputs.json"


def _code_hash(source_root: Path | None = None) -> str:
    root = source_root or Path(__file__).parent
    h = hashlib.sha256()
    # CLI・通信・配布だけの変更で、変更のない予測モデルまで再学習しない。
    paths = list((root / "analysis").rglob("*.py"))
    paths.extend(root / name for name in ("export.py", "dex.py", "formats.py", "config.py", "smogon.py", "ladder.py"))
    for p in sorted(p for p in paths if p.exists()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def _replay_sig(rows: list[dict], mo: dict | None, code: str, snapshots=None) -> str:
    # 件数と最新時刻だけでは、過去の試合の修正や同じ月の型・ランキング変更を見逃す。
    h = hashlib.sha256()
    for value in (rows, mo, snapshots):
        h.update(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())
        h.update(b"\0")
    return f"{code}:{h.hexdigest()[:20]}"


def _month_of(ts: int) -> str:
    return datetime.fromtimestamp(ts, JST).strftime("%Y-%m")


def _events() -> list[dict]:
    """手で書く出来事（data/events.json）。日付が確かなものだけを書く決まり。"""
    p = DATA / "events.json"
    return json.loads(p.read_text("utf-8")).get("events", []) if p.exists() else []


def _speed_of(spd: dict, stone: dict[str, float]) -> dict[str, float]:
    """まとめた名前ごとの、実数値の平均（メガストーンを持つ確率 0.5 以上ならメガの姿、それ以外はメガでない姿で一番多いもの）。"""
    by_group: dict[str, list[tuple[float, str, dict]]] = {}
    for name, e in spd["pokemon"].items():
        by_group.setdefault(e["group"], []).append((e["usage"], name, e))
    out = {}
    for g, forms in by_group.items():
        want_mega = stone.get(g, 0.0) >= 0.5
        cands = [f for f in forms if ("-Mega" in f[1]) == want_mega] or forms
        out[g] = round(speed.mean_speed(max(cands)[2]), 2)
    return out


def select_inputs(data: dict, fid: str) -> dict | None:
    """選出予想の材料（月次から）: メガストーンを持つ確率・メガの姿のタイプ・ポケモン詳細・使用率。月次が無ければ None。"""
    sd = Showdown()
    mo = monthly.analyze_format(data, fid, sd.group_name)
    if not mo:
        return None
    cut = mo["default_cutoff"]
    ms = mo["mega_split"].get(mo["months"][-1], {})
    stone = {g: v for g, v in ((g, sum(x for f, x in forms.items() if "-Mega" in f)) for g, forms in ms.items()) if v > 0}
    mega_types = {g: sd.types(max((x for x in forms if "-Mega" in x), key=lambda x: (forms[x], x)))
                  for g, forms in ms.items() if any("-Mega" in x for x in forms)}
    ug = mo["usage_grouped"][str(cut)]
    return {"month": mo["months"][-1], "stone": stone, "mega_types": mega_types,
            "detail": monthly.pokemon_detail(data, fid, mo["months"][-1], cut),
            "usage": {g: v[-1] for g, v in ug.items() if v[-1]}}


def seed_predlog(fids: list[str], start: str | None = None, log=print) -> None:
    """成績表を始める前の日について、その日までの試合と、その日より前に公開された月次統計だけで予想を作り直して保存する。
    start を省くと、最新の月次の月の翌月 3 日から（月次は月初めに公開されるので、それより前の日は未来の月次を使ってしまう）。"""
    from datetime import date, timedelta
    sd = Showdown()
    data = smogon.load_all()
    for fid in fids:
        f = parse_format(fid)
        inp = select_inputs(data, fid)
        rows = load_rows(fid) if (REPLAY_DIR / fid).exists() else []
        if not f or not f["team_select"] or not inp or not rows:
            continue
        y, m = map(int, inp["month"].split("-"))
        first = date(y + (m == 12), m % 12 + 1, 3)
        d0 = date.fromisoformat(start) if start else first
        d0 = max(d0, first)
        last = datetime.fromtimestamp(max(r["t"] for r in rows), JST).date()
        d = d0
        while d < last:
            end = datetime(d.year, d.month, d.day, tzinfo=JST).timestamp() + 86400
            pub = joint.build([r for r in rows if r["t"] < end], sd.group_name, sd, inp["detail"], inp["stone"],
                              f["game_type"] == "doubles", inp["mega_types"], evaluate_blocks=False)
            if pub.get("available"):
                track.save(fid, pub, day=d.isoformat(), seeded=True)
            log(f"seed-predlog {fid} {d}: {'保存' if pub.get('available') else pub.get('reason')}")
            d += timedelta(days=1)


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
    prev_inputs = json.loads(INPUTS_PATH.read_text("utf-8")) if INPUTS_PATH.exists() else {}
    inputs, skipped, code = {}, set(), _code_hash()
    # 飛ばしたルールの名前も残るように、前回の名前を足しておく（多くても害はない）
    old_names = json.loads((OUT / "names.json").read_text("utf-8")) if (OUT / "names.json").exists() else {}
    names_pokemon.update(old_names.get("pokemon", {}))
    names_items.update(old_names.get("items", {}))
    names_moves.update(old_names.get("moves", {}))
    names_abilities.update(old_names.get("abilities", {}))
    for f in formats:
        fid = f["id"]
        mo = monthly.analyze_format(data, fid, group_of)
        entry = {**f, "months": [], "replay_days": 0, "early": not bool(mo)}
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
            # ポケモン詳細（最新の月・標準の足切り）
            cut = mo["default_cutoff"]
            det = monthly.pokemon_detail(data, fid, mo["months"][-1], cut)
            if det:
                _write(f"pokemon/{fid}.json", det)
                names_pokemon.update(det["pokemon"])
                for p in det["pokemon"].values():
                    names_pokemon.update(b for b, _ in p["teammates"])
                    names_items.update(p["items"])
                    names_moves.update(p["moves"])
                    names_abilities.update(p["abilities"])
            # すばやさの分布と線（最新の月と、その前の月）
            months = mo["months"]
            cur = data.get((months[-1], fid, cut))
            prev = data.get((months[-2], fid, cut)) if len(months) > 1 else None
            spd = speed.build(cur, prev, sd) if cur else None
            if spd:
                spd["format"] = fid
                _write(f"speed/{fid}.json", spd)
                names_pokemon.update(spd["pokemon"])
            # 型（持ち物・技）の移り変わり: 月 × レート帯
            st = set_trends.build(data, fid, mo["months"], mo["cutoffs"], cut)
            st["format"] = fid
            _write(f"sets/{fid}.json", st)
            for e in st["pokemon"].values():
                names_items.update(k for k in e["items"])
                names_moves.update(k for k in e["moves"])
            # M6 コア（標準の足切り）
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
            inputs[fid] = _replay_sig(rows, mo, code, ladder.load_snapshots(fid))
            if prev_inputs.get(fid) == inputs[fid] and (OUT / f"weekly/{fid}.json").exists():
                if not mo and f["team_select"]:
                    entry["started"] = early.started(rows)
                skipped.add(fid)
                log(f"build {fid}: リプレイも月次も前回と同じなので、リプレイからの計算は飛ばす")
                fmt_meta.append(entry)
                continue
            wk = weekly.analyze(rows, group_of, doubles=f["game_type"] == "doubles")
            if wk.get("available"):
                days, n, counts = weekly.daily_counts(rows, group_of)
                top = list(wk["pokemon"])[:CHANGEPOINT_TOP]
                wk["alerts"] = changepoint.detect_all(days, n, counts, top)
                names_pokemon.update(wk["pokemon"])
            wk.update({"format": fid, "replays": len(rows)})
            _write(f"weekly/{fid}.json", wk)

            # メガストーンを持つ確率（月次のメガの内訳。メガの姿の割合の合計）。月次が無いルールは、リプレイで
            # 「選出されたときにメガシンカした割合」で代える（持っていても使わなかった分は数えられないので、少なめに出る）
            stone, mega_types = {}, {}
            if not mo:
                nb, nm = {}, {}
                for r in rows:
                    for s_ in (0, 1):
                        for x in r["brought"][s_]:
                            g = group_of(x)
                            nb[g] = nb.get(g, 0) + 1
                        for x in r["megas"][s_]:
                            g = group_of(x)
                            nm[g] = nm.get(g, 0) + 1
                            mega_types.setdefault(g, sd.types(x))
                stone = {g: nm[g] / nb[g] for g in nm if nb.get(g, 0) >= 10}
            if mo:
                ms = mo["mega_split"].get(mo["months"][-1], {})
                stone = {g: sum(v for form, v in forms.items() if "-Mega" in form) for g, forms in ms.items()}
                stone = {g: v for g, v in stone.items() if v > 0}
                # メガの姿のタイプ（姿が複数あれば多いほう）
                mega_types = {g: sd.types(max((x for x in forms if "-Mega" in x), key=lambda x: (forms[x], x)))
                              for g, forms in ms.items() if any("-Mega" in x for x in forms)}

            # P1 選出・先発の予想（組の予想。答え合わせの結果つき）
            doubles = f["game_type"] == "doubles"
            if f["team_select"]:
                # すばやさの特徴は種族値のまま（振り方の分布の平均に替えても答え合わせは良くならなかった: 2026-09、
                # VGC M-B 選出 −0.3pt、BSS 差なし。_speed_of と joint の speed_of はその比べ直し用に残す）
                ug = mo["usage_grouped"][str(mo["default_cutoff"])] if mo else {}
                sel = joint.build(rows, group_of, sd, det if mo else None, stone, doubles, mega_types,
                                  usage={g: v[-1] for g, v in ug.items() if v[-1]})
            else:
                sel = {"available": False, "reason": "6 匹すべてで戦うルールなので、選出はありません"}
            sel["format"] = fid
            if sel.get("available"):
                # 成績表: 公開した予想を保存し、保存済みの予想をそのあとの試合で答え合わせする
                track.save(fid, sel)
                sel["track"] = track.evaluate(fid, rows, group_of, sd)
            _write(f"select/{fid}.json", sel)
            if sel.get("available"):
                names_pokemon.update(sel["base"])
                names_pokemon.update(sel["roles"])

            # 見本のチーム（選出予想・チーム診断の最初の入力。3 人以上がまったく同じ 6 匹を使っていたもの）
            if f["team_select"]:
                smp = diag.sample_teams(rows, group_of)
                _write(f"samples/{fid}.json", {"format": fid, "days": diag.SAMPLE_DAYS,
                                                "min_players": diag.SAMPLE_MIN_PLAYERS, "teams": smp})
                for s_ in smp:
                    names_pokemon.update(s_["team"])

            # 開始直後の環境（月次統計がまだ無いルール）: 同じ人の同じチームを 1 つとして数える
            if not mo and f["team_select"]:
                ea = early.build(rows, group_of, 4 if doubles else 3, 2 if doubles else 1)
                ea["format"] = fid
                _write(f"early/{fid}.json", ea)
                names_pokemon.update(ea.get("pokemon", {}))
                entry["started"] = early.started(rows)

            # 選出誘導（あるポケモンを見せると、相手の選出がどう変わるか）
            if f["team_select"]:
                ind = induce.build(select.samples(rows, group_of), 4 if doubles else 3, sd, stone, doubles)
                ind["format"] = fid
                _write(f"induce/{fid}.json", ind)
                for v in ind["pokemon"].values():
                    names_pokemon.update(r["name"] for r in v["up"] + v["down"])
                names_pokemon.update(ind["pokemon"])

                # 上位の人（ランキング表の上位 500 人）の選出率・先発率と、ほかの人との差
                top = toprate.build(select.dedupe(select.samples(rows, group_of)), ladder.top_players(fid),
                                    4 if doubles else 3, 2 if doubles else 1)
                top.update({"format": fid, "ladder_days": len(ladder.load_snapshots(fid))})
                if top.get("available"):
                    top["induce"] = toprate.induce_pairs(select.dedupe(select.samples(rows, group_of)),
                                                         ladder.top_players(fid), 4 if doubles else 3)
                _write(f"top/{fid}.json", top)
                names_pokemon.update(top.get("pokemon", {}))

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

    # P2 チーム診断の材料（月次がある形式だけ）
    for f in formats:
        mo = per_format.get(f["id"])
        if not mo or (f["id"] in skipped and (OUT / f"diag/{f['id']}.json").exists()):
            continue
        rows = load_rows(f["id"]) if (REPLAY_DIR / f["id"]).exists() else []
        det_path = OUT / f"pokemon/{f['id']}.json"
        det = json.loads(det_path.read_text("utf-8")) if det_path.exists() else None
        ug = mo["usage_grouped"][str(mo["default_cutoff"])]
        dg = diag.build(det, rows, group_of, sd.move_info, ug, len(mo["months"]) - 1)
        dg["format"] = f["id"]
        _write(f"diag/{f['id']}.json", dg)
        names_pokemon.update(dg["pairs"])

    # タイプ相性（画面側の予想と診断で使う）
    _write("dex.json", {"typechart": sd.typechart})

    tracks = monthly.join_track(per_format, formats)
    for t, obj in tracks.items():
        _write(f"tracks/{t}.json", obj)

    # 名前（日本語は PokeAPI、取ったものは控える）
    ja = JaNames(sd, offline=not fetch_names)  # fetch_names=False でも控えの日本語名・画像は使う
    warnings = []
    names = {"pokemon": {}, "items": {}, "moves": {}, "abilities": {}}
    for n in sorted(names_pokemon):
        e = sd.species(n)
        names["pokemon"][n] = {
            "ja": ja.species(n),
            "group": group_of(n),
            "mega": sd.is_mega(n),
            "types": sd.types(n) or None,
            "num": e.get("num") if e else None,
            "base_stats": (e.get("baseStats") or ((sd.species(e["baseSpecies"]) or {}).get("baseStats")
                                                   if e.get("baseSpecies") else None)) if e else None,
            "sprite": sprite_urls(ja.pokemon_id(n)),
        }
    for kind, ids, en_of, ja_of in (
        ("items", names_items, sd.item_names, ja.item),
        ("moves", names_moves, sd.move_names, ja.move),
        ("abilities", names_abilities, sd.ability_names, ja.ability),
    ):
        for i in sorted(ids):
            if i in ("", "nothing", "noability"):
                continue
            names[kind][i] = {"en": en_of.get(i), "ja": ja_of(i)}
    ja.save()
    # 日本語名がほとんど無いまま書き出さない（2026-09-26 に、名前の無い names.json を公開してしまった）
    no_ja = sum(1 for v in names["pokemon"].values() if not v["ja"])
    if names["pokemon"] and no_ja > len(names["pokemon"]) * 0.2:
        raise SystemExit(f"日本語名の無いポケモンが {no_ja} / {len(names['pokemon'])} あります。控え（data/dex/pokeapi_ja.json）を確かめてください")
    for kind, d in names.items():
        missing = [k for k, v in d.items() if not v["ja"]]
        if kind == "pokemon" and fetch_names:
            no_sprite = [k for k, v in d.items() if not v["sprite"]]
            if no_sprite:
                warnings.append({"kind": "no_sprite:pokemon", "count": len(no_sprite), "examples": no_sprite[:20]})
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
    _write(INPUTS_PATH.name, inputs)  # 次の作り直しで、変わっていないルールを飛ばすため
    log(f"build: {len(formats)} ルール、名前 {len(names['pokemon'])} 匹、PokeAPI への問い合わせ {ja.fetched} 回")
    return meta

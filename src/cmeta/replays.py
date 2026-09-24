"""Showdown の公開リプレイを取ってきて、1 試合 1 行の記録にする。

保存先は data/replays/<ルール>/<JST の日付>.jsonl.gz。プレイヤー名はハッシュにし、公開する out/ には出さない。
"""

import gzip
import hashlib
import json
import time
from collections import defaultdict
from datetime import datetime

from . import http
from .config import DATA, JST, REPLAY_BACKFILL_DAYS, REPLAY_BASE, REPLAY_MAX_PER_RUN
from .dex import to_id

REPLAY_DIR = DATA / "replays"
STATE_PATH = REPLAY_DIR / "state.json"


def hash_player(name: str) -> str:
    return hashlib.sha256(to_id(name).encode()).hexdigest()[:12]


def _species(details: str) -> str:
    return details.split(",")[0].strip()


def _side(ident: str) -> int | None:
    """'p1a: 名前' -> 0。"""
    if len(ident) >= 2 and ident[0] == "p" and ident[1] in "12":
        return int(ident[1]) - 1
    return None


def _match_preview(preview: list[str], species: str) -> int | None:
    """場に出た姿を、見せ合いのどの枠かに対応づける。"""
    if species in preview:
        return preview.index(species)
    for i, p in enumerate(preview):
        if p.endswith("-*") and species.startswith(p[:-2]):
            return i
    for i, p in enumerate(preview):
        if species.startswith(p + "-"):  # Charizard-Mega-Y など
            return i
    base = species.split("-Mega")[0].split("-Primal")[0]
    for i, p in enumerate(preview):
        if p == base or p.startswith(base + "-"):  # Floette-Mega の見せ合いは Floette-Eternal
            return i
    return None


def parse_log(log: str) -> dict | None:
    """ログ全文から、見せ合い・選出・メガ・先発・勝敗を取り出す。見せ合いが無い試合は None。"""
    players: list[str | None] = [None, None]
    preview: list[list[str]] = [[], []]
    brought: list[list[int]] = [[], []]  # 見せ合いの何番目が場に出たか（出た順）
    megas: list[list[str]] = [[], []]
    leads: list[list[int]] = [[], []]
    winner: int | None = None
    tie = False
    turns = 0
    bo3 = "Best of = " in log
    started_turns = False
    for line in log.split("\n"):
        if not line.startswith("|"):
            continue
        parts = line.split("|")
        if len(parts) < 2:
            continue
        tag = parts[1]
        if tag == "player" and len(parts) >= 4 and parts[3]:
            s = _side(parts[2])
            if s is not None and players[s] is None:
                players[s] = parts[3]
        elif tag == "poke" and len(parts) >= 4:
            s = _side(parts[2])
            if s is not None:
                preview[s].append(_species(parts[3]))
        elif tag in ("switch", "drag", "replace") and len(parts) >= 4:
            s = _side(parts[2])
            if s is None:
                continue
            sp = _species(parts[3])
            i = _match_preview(preview[s], sp)
            if i is None:
                continue
            if preview[s][i].endswith("-*"):
                preview[s][i] = sp  # 伏せられていた姿が分かった
            if i not in brought[s]:
                brought[s].append(i)
            if not started_turns and i not in leads[s]:
                leads[s].append(i)
        elif tag == "detailschange" and len(parts) >= 4:
            s = _side(parts[2])
            sp = _species(parts[3])
            if s is not None and "-Mega" in sp and sp not in megas[s]:
                megas[s].append(sp)
        elif tag == "turn":
            started_turns = True
            turns = max(turns, int(parts[2]) if parts[2].isdigit() else turns)
        elif tag == "win" and len(parts) >= 3:
            name = parts[2]
            if players[0] and to_id(name) == to_id(players[0]):
                winner = 0
            elif players[1] and to_id(name) == to_id(players[1]):
                winner = 1
        elif tag == "tie":
            tie = True
    if not preview[0] or not preview[1] or not players[0] or not players[1]:
        return None
    return {
        "players": [hash_player(players[0]), hash_player(players[1])],
        "teams": preview,
        "brought": [[preview[s][i] for i in brought[s]] for s in (0, 1)],
        "leads": [[preview[s][i] for i in leads[s]] for s in (0, 1)],
        "megas": megas,
        "winner": None if tie else winner,
        "turns": turns,
        "bo3": bo3,
    }


# ── 保存 ──────────────────────────────────────────────────────


def day_path(fmt: str, day: str):
    return REPLAY_DIR / fmt / f"{day}.jsonl.gz"


def read_day(fmt: str, day: str) -> list[dict]:
    p = day_path(fmt, day)
    if not p.exists():
        return []
    with gzip.open(p, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_day(fmt: str, day: str, rows: list[dict]) -> None:
    p = day_path(fmt, day)
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (r["t"], r["id"]))
    body = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
    # mtime=0: 中身が同じなら同じバイト列になり、git に差分が出ない
    with open(p, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        f.write(body.encode("utf-8"))


def load_rows(fmt: str) -> list[dict]:
    rows = []
    for p in sorted((REPLAY_DIR / fmt).glob("*.jsonl.gz")):
        rows.extend(read_day(fmt, p.name.split(".")[0]))
    return rows


def jst_day(ts: int) -> str:
    return datetime.fromtimestamp(ts, JST).strftime("%Y-%m-%d")


def _load_state() -> dict:
    return json.loads(STATE_PATH.read_text("utf-8")) if STATE_PATH.exists() else {}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=1, sort_keys=True), "utf-8")


# ── 取得 ──────────────────────────────────────────────────────


def list_new(fmt: str, since: int) -> list[dict]:
    """since より新しい公開リプレイの一覧（新しい順に取って、古い順に並べ直して返す）。"""
    out, before = [], None
    while True:
        url = f"{REPLAY_BASE}/search.json?format={fmt}" + (f"&before={before}" if before else "")
        page = http.get_json(url)
        more = len(page) > 50
        page = page[:50]
        done = False
        for r in page:
            if r["uploadtime"] <= since:
                done = True
                break
            if not r.get("private") and not r.get("password"):
                out.append(r)
        if done or not more or not page:
            break
        before = page[-1]["uploadtime"]
    out.sort(key=lambda r: (r["uploadtime"], r["id"]))
    return out


def crawl(fmt: str, max_n: int = REPLAY_MAX_PER_RUN, log=print) -> int:
    """新しいリプレイを古い順に max_n 件まで取り、日ごとのファイルに足す。取った件数を返す。"""
    state = _load_state()
    since = state.get(fmt, {}).get("last", int(time.time()) - REPLAY_BACKFILL_DAYS * 86400)
    new = list_new(fmt, since)
    todo = new[:max_n]
    if len(new) > max_n:
        log(f"replays {fmt}: 新しいものが {len(new)} 件。古い順に {max_n} 件だけ取り、残りは次回")
    if not todo:
        log(f"replays {fmt}: 新しいものなし")
        return 0
    by_day: dict[str, list[dict]] = defaultdict(list)
    last, skipped = since, 0
    for r in todo:
        try:
            body = http.get_json(f"{REPLAY_BASE}/{r['id']}.json")
        except http.NotFound:
            skipped += 1
            last = r["uploadtime"]
            continue
        rec = parse_log(body.get("log", ""))
        last = r["uploadtime"]
        if rec is None:
            skipped += 1
            continue
        rec.update({"id": r["id"], "t": r["uploadtime"], "rating": r.get("rating")})
        by_day[jst_day(r["uploadtime"])].append(rec)
    for day, rows in by_day.items():
        existing = read_day(fmt, day)
        seen = {x["id"] for x in existing}
        write_day(fmt, day, existing + [x for x in rows if x["id"] not in seen])
    state[fmt] = {"last": last}
    _save_state(state)
    n = sum(len(v) for v in by_day.values())
    log(f"replays {fmt}: {n} 件（読めなかったもの {skipped}）")
    return n

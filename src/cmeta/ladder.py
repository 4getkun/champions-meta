"""Showdown のランキング表（上位 500 人）を毎日記録し、上位の人の公開リプレイを狙って取る。

- 記録するのは名前のハッシュ・レート・GXE・対戦数・ボットらしさの目印だけ（名前は残さない）。
  名前は、その場でリプレイを検索するのに使うだけ。
- 保存先: data/ladder/<ルール>/<JST の日付>.json
"""

import json
import time
from datetime import datetime

from . import http, replays
from .config import DATA, JST, LADDER_REPLAYS_PER_RUN, LADDER_USERS_PER_RUN, REPLAY_BASE

LADDER_URL = "https://pokemonshowdown.com/ladder/{fmt}.json"
LADDER_DIR = DATA / "ladder"
STATE_PATH = LADDER_DIR / "state.json"
TOP_USERS = 200  # リプレイを狙って取る人数（上から）。ダブル
TOP_USERS_SINGLES = 500  # シングル（BSS）は公開リプレイが少ないので、上位 500 人全員から取る
TOP_DAYS = 28  # さかのぼる日数
BOT_NAME = replays.BOT_NAME


def fetch(fmt: str) -> list[dict]:
    d = http.get_json(LADDER_URL.format(fmt=fmt))
    return d.get("toplist", [])


def snapshot(fmt: str, top: list[dict], day: str | None = None) -> dict:
    day = day or datetime.now(JST).strftime("%Y-%m-%d")
    rows = [{
        "h": replays.hash_player(u["userid"]),
        "r": round(u["r"], 1),
        "gxe": u.get("gxe"),
        "n": u.get("w", 0) + u.get("l", 0),
        "bot": bool(BOT_NAME.search(u["userid"])),
    } for u in top]
    obj = {"format": fmt, "day": day, "players": rows}
    p = LADDER_DIR / fmt / f"{day}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, separators=(",", ":")), "utf-8")
    return obj


def crawl_top(fmt: str, top: list[dict], n_users: int = TOP_USERS, log=print, max_n: int = LADDER_REPLAYS_PER_RUN) -> int:
    """上位 n_users 人の直近 TOP_DAYS 日の公開リプレイで、まだ持っていないものを取る。"""
    if max_n <= 0:
        raise ValueError("max_n must be positive")
    since = time.time() - TOP_DAYS * 86400
    have = replays.known_ids(fmt, TOP_DAYS)
    todo = {}
    progress = json.loads(STATE_PATH.read_text("utf-8")) if STATE_PATH.exists() else {}
    state = progress.get(fmt, {})
    population = top[:n_users]
    offset = state.get("offset", 0) % max(1, len(population))
    selected = [population[(offset + i) % len(population)] for i in range(min(LADDER_USERS_PER_RUN, len(population)))] if population else []
    next_offset = (offset + len(selected)) % len(population) if population else 0
    for u in selected:
        page = http.get_json(f"{REPLAY_BASE}/search.json?user={u['userid']}&format={fmt}")
        for r in page[:50]:
            if (r["uploadtime"] >= since and r["id"] not in have and not r.get("private") and not r.get("password")
                    and not replays.is_bot(r.get("players", []))):
                todo[r["id"]] = {k: r[k] for k in ("id", "uploadtime", "rating") if k in r}
    for r in state.get("pending", []):
        if r["id"] not in have:
            todo.setdefault(r["id"], {k: r[k] for k in ("id", "uploadtime", "rating") if k in r})
    ordered = sorted(todo.values(), key=lambda r: (r["uploadtime"], r["id"]))
    chosen, pending = ordered[:max_n], ordered[max_n:]
    recs = []
    try:
        for r in chosen:
            rec = replays.fetch_record(r)
            if rec:
                recs.append(rec)
    finally:
        added = replays.store(fmt, recs)
    progress[fmt] = {"offset": next_offset, "pending": pending}
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(progress, separators=(",", ":")), "utf-8")
    log(f"ladder {fmt}: 上位 {len(selected)} 人を検索、詳細 {len(chosen)} 件以内、保存 {added} 件")
    return added


def load_snapshots(fmt: str) -> dict[str, dict]:
    """{日付: 記録}。"""
    return {p.stem: json.loads(p.read_text("utf-8")) for p in sorted((LADDER_DIR / fmt).glob("*.json"))}


def run(formats: list[str], log=print) -> None:
    for fmt in formats:
        try:
            top = fetch(fmt)
        except http.NotFound:
            log(f"ladder {fmt}: ランキング表なし")
            continue
        snapshot(fmt, top)
        crawl_top(fmt, top, n_users=TOP_USERS_SINGLES if "championsbss" in fmt else TOP_USERS, log=log)


def top_players(fmt: str) -> dict[str, float]:
    """記録したランキング表に一度でも載った人（ボットの目印が無い人）の {ハッシュ: 記録の中で一番高いレート}。
    試合のレート欄は試合時点の値で、シーズン序盤の試合では今の実力より低く出るため、人で上位かを見る。"""
    out: dict[str, float] = {}
    for snap in load_snapshots(fmt).values():
        for u in snap.get("players", []):
            if not u.get("bot"):
                out[u["h"]] = max(out.get(u["h"], 0.0), u.get("r") or 0.0)
    return out

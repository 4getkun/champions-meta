"""Showdown のランキング表（上位 500 人）を毎日記録し、上位の人の公開リプレイを狙って取る。

- 記録するのは名前のハッシュ・レート・GXE・対戦数・ボットらしさの目印だけ（名前は残さない）。
  名前は、その場でリプレイを検索するのに使うだけ。
- 保存先: data/ladder/<ルール>/<JST の日付>.json
"""

import json
import time
from datetime import datetime

from . import http, replays
from .config import DATA, JST, REPLAY_BASE

LADDER_URL = "https://pokemonshowdown.com/ladder/{fmt}.json"
LADDER_DIR = DATA / "ladder"
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


def crawl_top(fmt: str, top: list[dict], n_users: int = TOP_USERS, log=print) -> int:
    """上位 n_users 人の直近 TOP_DAYS 日の公開リプレイで、まだ持っていないものを取る。"""
    since = time.time() - TOP_DAYS * 86400
    have = replays.known_ids(fmt, TOP_DAYS)
    todo = {}
    for u in top[:n_users]:
        page = http.get_json(f"{REPLAY_BASE}/search.json?user={u['userid']}&format={fmt}")
        for r in page[:50]:
            if (r["uploadtime"] >= since and r["id"] not in have and not r.get("private") and not r.get("password")
                    and not replays.is_bot(r.get("players", []))):
                todo[r["id"]] = r
    recs = [rec for r in sorted(todo.values(), key=lambda r: r["uploadtime"]) if (rec := replays.fetch_record(r))]
    added = replays.store(fmt, recs)
    log(f"ladder {fmt}: 上位 {min(n_users, len(top))} 人から新しいリプレイ {added} 件")
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

"""Showdown の公開リプレイを取ってきて、1 試合 1 行の記録にする。

保存先は data/replays/<ルール>/<JST の日付>.jsonl.gz。プレイヤー名はハッシュにし、公開する out/ には出さない。
"""

import gzip
import hashlib
import json
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from . import http
from .config import DATA, JST, REPLAY_BACKFILL_DAYS, REPLAY_BASE, REPLAY_MAX_PER_RUN
from .dex import to_id

REPLAY_DIR = DATA / "replays"
# 読み取り方の版。上げたら fetch-replays --refetch で古い版の試合を取り直す
# 1: 見せ合い・選出など / 2: 手番の記録（order）/ 3: 回復・ダメージの行から持ち物（たべのこし・いのちのたまなど）
PARSE_VERSION = 3
BACKFILL_WORKERS = 3
STATE_PATH = REPLAY_DIR / "state.json"
# ボットらしい名前（研究用の AI など）。どちらかの名前が当てはまる試合は "bot": true を付け、解析から外す
# （ボットの選出は人の読み合いと違う。BSS では 2026-09-04〜06 の公開リプレイの大半がボットの試合だった）
BOT_NAME = re.compile(r"bot|pokechamp|metamon|pokellmon|agent", re.I)


def is_bot(names) -> bool:
    return any(n and BOT_NAME.search(to_id(n)) for n in names)


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


def _nick(ident: str) -> str:
    """'p1a: 名前' -> 'p1: 名前'（場の位置 a/b を落とす）。"""
    side, _, name = ident.partition(": ")
    return f"{side[:2]}: {name}"


def parse_log(log: str) -> dict | None:
    """ログ全文から、見せ合い・選出・メガ・先発・勝敗、明かされた技・持ち物・特性、倒れた順を取り出す。

    見せ合いが無い試合は None。明かされたものは「本人のもの」と分かる行だけを数える
    （トリックで受け取った持ち物、トレースで写した特性、他の技から呼ばれた技などは除く）。

    order: 行動の順番と、すばやさに関わる出来事を起きた順に並べたもの（手番からすばやさを推し量るため）。
    位置は [側, 見せ合いの何番目]。1 つの出来事は配列で、先頭が種類:
        ["T", n] ターン n の始まり / ["m", 側, 番, 技, f]（f=1: [from] 付き。呼ばれた技・固定された技など）
        ["s", 側, 番, f]（交代。f=1: 技などによる交代）/ ["M", 側, 番]（メガシンカ）
        ["TR", 1|0] トリックルーム / ["TW", 側, 1|0] おいかぜ / ["W", 天候] / ["F", フィールド, 1|0]
        ["st", 側, 番, 状態] / ["cs", 側, 番]（状態が治った）/ ["b", 側, 番, すばやさのランク変化] / ["cb", 側, 番]（ランクが戻った）
        ["i", 側, 番, 持ち物, 0|1]（1: なくなった）/ ["a", 側, 番, 特性] / ["q", 側, 番, 何]（せんせいのツメなどで先に動いた）
        ["c", 側, 番, 理由]（動けなかった）/ ["x", 側, 番]（倒れた）
    """
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
    slot: dict[str, tuple[int, int]] = {}  # 'p1: 名前' -> (側, 見せ合いの何番目)
    revealed: list[dict[int, dict]] = [{}, {}]
    faints: list[list] = []
    order: list[list] = []

    def who(ident: str):
        return slot.get(_nick(ident))

    def rev(pos) -> dict:
        return revealed[pos[0]].setdefault(pos[1], {"m": []})

    def ev(kind, ident, *rest):
        pos = who(ident)
        if pos:
            order.append([kind, pos[0], pos[1], *rest])

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
            slot[_nick(parts[2])] = (s, i)
            order.append(["s", s, i, int(any(x.startswith("[from]") for x in parts[4:]))])
        elif tag == "move" and len(parts) >= 4:
            ev("m", parts[2], to_id(parts[3]), int(any(x.startswith("[from]") for x in parts[4:])))
            pos = who(parts[2])
            if pos and parts[3] != "Struggle" and not any(x.startswith("[from]") for x in parts[4:]):
                r = rev(pos)
                mid = to_id(parts[3])
                if mid not in r["m"]:
                    r["m"].append(mid)
        elif tag in ("-item", "-enditem") and len(parts) >= 4:
            ev("i", parts[2], to_id(parts[3]), int(tag == "-enditem"))
            pos = who(parts[2])
            # -item の「[from] move: トリック」などは受け取った持ち物なので除く。-enditem は元の持ち物
            if pos and not (tag == "-item" and "[from] move:" in line):
                rev(pos).setdefault("i", to_id(parts[3]))
        elif tag in ("-heal", "-damage") and "[from] item:" in line:
            # たべのこし・くろいヘドロで回復、いのちのたまの反動など。[of] があればその持ち主（ゴツゴツメットなど）
            src = next(x for x in parts[3:] if x.startswith("[from] item:"))
            of = next((x[5:] for x in parts[3:] if x.startswith("[of] ")), parts[2])
            pos = who(of)
            if pos:
                rev(pos).setdefault("i", to_id(src.split(":", 1)[1]))
                ev("i", of, to_id(src.split(":", 1)[1]), 0)
        elif tag == "-mega" and len(parts) >= 5:
            pos = who(parts[2])
            if pos:
                rev(pos)["i"] = to_id(parts[4])
        elif tag == "-ability" and len(parts) >= 4:
            ev("a", parts[2], to_id(parts[3]))
            pos = who(parts[2])
            if pos and not any(x.startswith("[from]") for x in parts[4:]):
                rev(pos).setdefault("a", to_id(parts[3]))
        elif tag == "faint" and len(parts) >= 3:
            ev("x", parts[2])
            pos = who(parts[2])
            if pos:
                faints.append(pos)
        elif tag == "detailschange" and len(parts) >= 4:
            s = _side(parts[2])
            sp = _species(parts[3])
            if s is not None and "-Mega" in sp and sp not in megas[s]:
                megas[s].append(sp)
            if "-Mega" in sp:
                ev("M", parts[2])
        elif tag in ("-fieldstart", "-fieldend") and len(parts) >= 3:
            what = to_id(parts[2].replace("move: ", ""))
            on = int(tag == "-fieldstart")
            order.append(["TR", on] if what == "trickroom" else ["F", what, on])
        elif tag in ("-sidestart", "-sideend") and len(parts) >= 4 and to_id(parts[3].replace("move: ", "")) == "tailwind":
            s = _side(parts[2])
            if s is not None:
                order.append(["TW", s, int(tag == "-sidestart")])
        elif tag == "-weather" and len(parts) >= 3 and "[upkeep]" not in line:
            order.append(["W", to_id(parts[2])])
        elif tag == "-status" and len(parts) >= 4:
            ev("st", parts[2], parts[3])
        elif tag == "-curestatus" and len(parts) >= 3:
            ev("cs", parts[2])
        elif tag in ("-boost", "-unboost") and len(parts) >= 5 and parts[3] == "spe":
            n = int(parts[4]) if parts[4].lstrip("-").isdigit() else 0
            ev("b", parts[2], n if tag == "-boost" else -n)
        elif tag == "-setboost" and len(parts) >= 5 and parts[3] == "spe":
            ev("cb", parts[2])
            ev("b", parts[2], int(parts[4]) if parts[4].lstrip("-").isdigit() else 0)
        elif tag in ("-clearboost", "-clearallboost", "-clearnegativeboost") and len(parts) >= 3:
            if tag == "-clearallboost":
                order.append(["cb", -1, -1])
            else:
                ev("cb", parts[2])
        elif tag == "-activate" and len(parts) >= 4 and any(k in parts[3] for k in ("Quick Claw", "Quick Draw", "Custap")):
            ev("q", parts[2], to_id(parts[3].split(": ")[-1]))
        elif tag == "cant" and len(parts) >= 4:
            ev("c", parts[2], to_id(parts[3]))
        elif tag == "turn":
            if parts[2].isdigit():
                order.append(["T", int(parts[2])])
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
        "bot": is_bot(players),
        "teams": preview,
        "brought": [[preview[s][i] for i in brought[s]] for s in (0, 1)],
        "leads": [[preview[s][i] for i in leads[s]] for s in (0, 1)],
        "megas": megas,
        # 明かされた技・持ち物・特性（見せ合いの名前ごと。m: 技, i: 持ち物, a: 特性）と、倒れた順（[側, 名前]）
        "revealed": [{preview[s][i]: v for i, v in sorted(revealed[s].items())} for s in (0, 1)],
        "faints": [[fs, preview[fs][fi]] for fs, fi in faints],
        "order": order,
        "v": PARSE_VERSION,
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


def load_rows(fmt: str, bots: bool = False) -> list[dict]:
    """bots=False: ボットの試合を除く（解析はすべてこちら）。"""
    rows = []
    for p in sorted((REPLAY_DIR / fmt).glob("*.jsonl.gz")):
        rows.extend(r for r in read_day(fmt, p.name.split(".")[0]) if bots or not r.get("bot"))
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
            if not r.get("private") and not r.get("password") and not is_bot(r.get("players", [])):
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


# ── 上位の人のリプレイを狙って取るための部品（ladder.py から使う） ─────────


def fetch_record(r: dict) -> dict | None:
    """一覧の 1 行（id, uploadtime, rating）から、読み取った 1 試合を作る。読めなければ None。"""
    try:
        body = http.get_json(f"{REPLAY_BASE}/{r['id']}.json")
    except http.NotFound:
        return None
    rec = parse_log(body.get("log", ""))
    if rec is not None:
        rec.update({"id": r["id"], "t": r["uploadtime"], "rating": r.get("rating")})
    return rec


def store(fmt: str, recs: list[dict]) -> int:
    """日ごとのファイルに足す（同じ id は足さない）。足した件数を返す。"""
    by_day: dict[str, list[dict]] = defaultdict(list)
    for rec in recs:
        by_day[jst_day(rec["t"])].append(rec)
    added = 0
    for day, rows in by_day.items():
        existing = read_day(fmt, day)
        seen = {x["id"] for x in existing}
        new = [x for x in rows if x["id"] not in seen]
        if new:
            write_day(fmt, day, existing + new)
            added += len(new)
    return added


def backfill(fmt: str, days: int, max_n: int = REPLAY_MAX_PER_RUN, log=print) -> int:
    """過去 days 日の公開リプレイで、まだ持っていないものを新しい順に max_n 件まで取る（ボットの試合は取らない）。
    毎日の crawl は前回の続きからしか取らないので、始めた日より前の分や取りこぼしはこれで埋める。"""
    since = int(time.time()) - days * 86400
    have = known_ids(fmt, days + 1)
    todo = [r for r in reversed(list_new(fmt, since)) if r["id"] not in have][:max_n]
    log(f"backfill {fmt}: まだ持っていないもの {len(todo)} 件を取る")
    added = 0
    # 返事を待つ間に次を頼めるよう 3 本まで同時に取る（始める間隔は http が 1 秒以上に保つ）
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for i in range(0, len(todo), 200):  # 途中で止まっても取った分は残るよう、200 件ごとに書く
            added += store(fmt, [rec for rec in pool.map(fetch_record, todo[i:i + 200]) if rec])
        log(f"backfill {fmt}: {min(i + 200, len(todo))} / {len(todo)}")
    return added


def refetch(fmt: str, max_n: int = REPLAY_MAX_PER_RUN, log=print) -> int:
    """読み取り方の版（PARSE_VERSION）が古い試合を取り直す（読み取り方を足したとき用。ボットの試合は取り直さない）。
    新しい日から順に、1 日ぶんずつ書く。取り直した件数を返す。"""
    done = 0
    days = sorted((p.name.split(".")[0] for p in (REPLAY_DIR / fmt).glob("*.jsonl.gz")), reverse=True)
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for day in days:
            rows = read_day(fmt, day)
            todo = [r for r in rows if r.get("v", 2 if "order" in r else 1) < PARSE_VERSION and not r.get("bot")][:max(0, max_n - done)]
            if not todo:
                continue
            got = {rec["id"]: rec for rec in pool.map(fetch_record, [{"id": r["id"], "uploadtime": r["t"], "rating": r.get("rating")}
                                                                     for r in todo]) if rec}
            write_day(fmt, day, [got.get(r["id"], r) for r in rows])
            done += len(todo)
            log(f"refetch {fmt} {day}: {len(got)} / {len(todo)}（計 {done}）")
            if done >= max_n:
                break
    return done


def known_ids(fmt: str, days: int) -> set[str]:
    """直近 days 日ぶんのファイルにある id。"""
    today = datetime.now(JST).date()
    out = set()
    for d in range(days + 1):
        day = (today - timedelta(days=d)).isoformat()
        out.update(x["id"] for x in read_day(fmt, day))
    return out

"""使い方:
    python -m cmeta fetch-smogon          まだ持っていない月の Smogon 統計を取る
    python -m cmeta fetch-replays [--max N] [--format ID …] [--backfill DAYS]
                                          --backfill: 過去 DAYS 日の取りこぼしを埋める（ボットの試合は取らない）
                                          --refetch: 手番の記録（order）が無い試合を取り直す
    python -m cmeta fetch-ladder [--format ID …]  上位 500 人を記録し、上位の人のリプレイを狙って取る（シングル・ダブル）
    python -m cmeta build [--no-names]    out/ を作り直す（--no-names: PokeAPI に問い合わせない）
    python -m cmeta seed-predlog [--format ID …] [--start YYYY-MM-DD]
                                          成績表を始める前の日の予想を、その日までのデータだけで作り直して保存する
    python -m cmeta all                   取得の三つと build を順に
    python -m cmeta dist                  公開用の dist/ を作る（site/ + out/ を data/ として）
"""

import argparse
import contextlib
import os
import sys
import time
from datetime import datetime, timedelta

from . import dist, export, ladder, replays, smogon
from .config import JST
from .config import EXTRA_REPLAY_FORMATS, LADDER_EVERY_DAYS, REPLAY_CAP, REPLAY_MAX_PER_RUN


def _replay_targets() -> list[str]:
    """リプレイを取るルール: 今のレギュレーションだけ（config.EXTRA_REPLAY_FORMATS）。"""
    return sorted(EXTRA_REPLAY_FORMATS)


def _ladder_due(fid: str) -> bool:
    """ランキング表の記録が LADDER_EVERY_DAYS 日以上前（または無い）なら、記録し直す。"""
    snaps = ladder.load_snapshots(fid)
    if not snaps:
        return True
    last = datetime.strptime(max(snaps), "%Y-%m-%d").replace(tzinfo=JST)
    return datetime.now(JST) - last >= timedelta(days=LADDER_EVERY_DAYS - 0.5)


@contextlib.contextmanager
def fetch_lock(path, stale_hours: float = 12.0):
    """Showdown から取る処理を同時に 1 本だけにする（プロセスごとに間隔を空けているので、2 本動くと間隔が半分になる）。
    前の処理が落ちて残ったロックは、stale_hours を過ぎたら取り直す。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and time.time() - path.stat().st_mtime > stale_hours * 3600:
        path.unlink()
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise SystemExit(f"ほかの取得が動いています（{path} があります）。終わるのを待つか、止まっているならこのファイルを消してください")
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="cmeta")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch-smogon")
    fr = sub.add_parser("fetch-replays")
    fr.add_argument("--max", type=int, default=REPLAY_MAX_PER_RUN)
    fr.add_argument("--format", action="append")
    fr.add_argument("--backfill", type=int, metavar="DAYS")
    fr.add_argument("--refetch", action="store_true")
    fl = sub.add_parser("fetch-ladder")
    fl.add_argument("--format", action="append")
    b = sub.add_parser("build")
    b.add_argument("--no-names", action="store_true")
    sp = sub.add_parser("seed-predlog")
    sp.add_argument("--format", action="append")
    sp.add_argument("--start")
    sub.add_parser("dist")
    a = sub.add_parser("all")
    a.add_argument("--max", type=int, default=REPLAY_MAX_PER_RUN)
    args = ap.parse_args(argv)

    fetching = args.cmd in ("fetch-replays", "fetch-ladder", "all")
    lock = fetch_lock(replays.REPLAY_DIR / ".fetch.lock") if fetching else contextlib.nullcontext()
    with lock:
        _run(args)
    return 0


def _run(args) -> None:
    if args.cmd in ("fetch-smogon", "all"):
        smogon.sync()
    if args.cmd in ("fetch-replays", "all"):
        for fid in getattr(args, "format", None) or _replay_targets():
            if getattr(args, "refetch", False):
                replays.refetch(fid, max_n=args.max)
            elif getattr(args, "backfill", None):
                replays.backfill(fid, args.backfill, max_n=args.max)
            elif args.cmd == "all" and fid in REPLAY_CAP:
                replays.crawl(fid, max_n=min(args.max, REPLAY_CAP[fid]), sample=True)  # 指定上限とルール別上限の小さい方
            else:
                replays.crawl(fid, max_n=args.max)
    if args.cmd in ("fetch-ladder", "all"):
        # 上位の人を狙うのは、ゲーム内のランクバトルと同じルール（シングル = BSS、ダブル = VGC）だけ
        if args.cmd == "fetch-ladder" and getattr(args, "format", None):
            ladder.run(args.format)
        else:
            # 毎日の実行では、前の記録から LADDER_EVERY_DAYS 日たったルールだけ
            due = [f for f in _replay_targets() if ("championsbss" in f or "championsvgc" in f)
                   and (args.cmd == "fetch-ladder" or _ladder_due(f))]
            if due:
                ladder.run(due)
    if args.cmd == "seed-predlog":
        export.seed_predlog(args.format or [f for f in _replay_targets() if "championsbss" in f or "championsvgc" in f],
                            start=args.start)
    if args.cmd in ("build", "all"):
        export.build(fetch_names=not getattr(args, "no_names", False))
    if args.cmd == "dist":
        dist.build()


if __name__ == "__main__":
    raise SystemExit(main())

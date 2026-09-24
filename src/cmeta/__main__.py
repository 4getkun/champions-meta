"""使い方:
    python -m cmeta fetch-smogon          まだ持っていない月の Smogon 統計を取る
    python -m cmeta fetch-replays [--max N] [--format ID …]
    python -m cmeta build [--no-names]    out/ を作り直す（--no-names: PokeAPI に問い合わせない）
    python -m cmeta all                   上の三つを順に
"""

import argparse
import sys

from . import export, replays, smogon
from .config import EXTRA_REPLAY_FORMATS, REPLAY_MAX_PER_RUN


def _replay_targets() -> list[str]:
    data = smogon.load_all()
    if not data:
        return sorted(EXTRA_REPLAY_FORMATS)
    latest = max(m for (m, _f, _c) in data)
    return sorted({f for (m, f, _c) in data if m == latest} | set(EXTRA_REPLAY_FORMATS))


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="cmeta")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch-smogon")
    fr = sub.add_parser("fetch-replays")
    fr.add_argument("--max", type=int, default=REPLAY_MAX_PER_RUN)
    fr.add_argument("--format", action="append")
    b = sub.add_parser("build")
    b.add_argument("--no-names", action="store_true")
    a = sub.add_parser("all")
    a.add_argument("--max", type=int, default=REPLAY_MAX_PER_RUN)
    args = ap.parse_args(argv)

    if args.cmd in ("fetch-smogon", "all"):
        smogon.sync()
    if args.cmd in ("fetch-replays", "all"):
        for fid in getattr(args, "format", None) or _replay_targets():
            replays.crawl(fid, max_n=args.max)
    if args.cmd in ("build", "all"):
        export.build(fetch_names=not getattr(args, "no_names", False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

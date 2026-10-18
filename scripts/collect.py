"""cmeta all with privacy-safe phase and HTTP call metrics."""
import argparse, json, threading, time
from collections import defaultdict
from urllib.parse import parse_qs, urlparse
from cmeta import export, http, ladder, replays, smogon
from cmeta import __main__ as cli


def category(url):
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if host == "replay.pokemonshowdown.com":
        if p.path.endswith("/search.json"):
            return "showdown_user_list" if "user" in parse_qs(p.query) else "showdown_format_list"
        return "showdown_detail" if p.path.endswith(".json") else "showdown_other"
    if host.endswith(".pokemonshowdown.com") or host == "pokemonshowdown.com": return "showdown_other"
    if host == "smogon.com" or host.endswith(".smogon.com"): return "smogon"
    return f"other_host:{host or 'unknown'}"


def timed(label, fn, describe=lambda args, kwargs: ""):
    def call(*args, **kwargs):
        name = f"{label} {describe(args, kwargs)}".strip()
        began = time.monotonic()
        print(f"[phase:start] {name}", flush=True)
        try: result = fn(*args, **kwargs)
        except Exception as exc:
            print(f"[phase:fail] {name} seconds={time.monotonic()-began:.3f} error={type(exc).__name__}", flush=True)
            raise
        print(f"[phase:done] {name} seconds={time.monotonic()-began:.3f}", flush=True)
        return result
    return call


def run(max_replays, main_fn=None):
    main_fn = main_fn or cli.main
    stats, lock = defaultdict(lambda: {"calls": 0, "failures": 0, "seconds": 0.0, "bytes": 0}), threading.Lock()
    original_http = http.get_bytes
    originals = [(m, n, getattr(m, n)) for m, n in ((smogon, "sync"), (replays, "crawl"), (ladder, "run"), (export, "build"))]
    def observed(url, *args, **kwargs):
        key, began, size, failed = category(url), time.monotonic(), 0, False
        try:
            body = original_http(url, *args, **kwargs); size = len(body); return body
        except Exception: failed = True; raise
        finally:
            with lock:
                row = stats[key]; row["calls"] += 1; row["failures"] += int(failed)
                row["seconds"] += time.monotonic() - began; row["bytes"] += size
    try:
        http.get_bytes = observed
        for m, n, fn in originals:
            if n == "crawl": desc = lambda a, k: f"format={k.get('fmt', a[0] if a else 'unknown')}"
            elif n == "run": desc = lambda a, k: "formats=" + ",".join(k.get("formats", a[0] if a else []))
            else: desc = lambda a, k: ""
            setattr(m, n, timed(f"{m.__name__.rsplit('.', 1)[-1]}.{n}", fn, desc))
        print(f"[collect] start max_replays={max_replays}", flush=True)
        return int(main_fn(["all", "--max", str(max_replays)]) or 0)
    finally:
        http.get_bytes = original_http
        for m, n, fn in originals: setattr(m, n, fn)
        print("[http:metrics] " + json.dumps({"unit": "calls (HTTP retries are internal)", "categories": dict(stats)}, sort_keys=True), flush=True)


def main(argv=None):
    p = argparse.ArgumentParser(); p.add_argument("--max", type=int, default=300); args = p.parse_args(argv)
    try: return run(args.max)
    except Exception as exc:
        print(f"[collect] failed error={type(exc).__name__}", flush=True); return 1


if __name__ == "__main__": raise SystemExit(main())

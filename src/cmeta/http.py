"""取得の土台: 同じホストへの間隔を空け、失敗したら少し待って取り直す。"""

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .config import MIN_INTERVAL_SEC, USER_AGENT

_last_hit: dict[str, float] = {}
_lock = threading.Lock()  # 複数の取得を同時に待たせても、始める間隔は 1 ホストあたり MIN_INTERVAL_SEC 以上


class NotFound(Exception):
    pass


def _wait(host: str) -> None:
    with _lock:
        last = _last_hit.get(host)
        if last is not None:
            gap = time.monotonic() - last
            if gap < MIN_INTERVAL_SEC:
                time.sleep(MIN_INTERVAL_SEC - gap)
        _last_hit[host] = time.monotonic()


def get_bytes(url: str, retries: int = 3, timeout: float = 60) -> bytes:
    host = urllib.parse.urlparse(url).netloc
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        _wait(host)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound(url) from e
            if attempt == retries - 1 or e.code < 500 and e.code != 429:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            if attempt == retries - 1:
                raise
        time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def get_text(url: str) -> str:
    return get_bytes(url).decode("utf-8")


def get_json(url: str):
    return json.loads(get_bytes(url))


def cached_bytes(url: str, path: Path, refresh: bool = False) -> bytes:
    """path にあればそれを返し、無ければ取ってきて保存する。"""
    if path.exists() and not refresh:
        return path.read_bytes()
    body = get_bytes(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return body

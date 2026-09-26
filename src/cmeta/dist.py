"""公開用のフォルダ dist/ を作る: site/ の中身 + out/ を data/ として + sitemap.xml + 自前で配る書体（fonts.py）。

画面は既定で ./data/ を読む（app.js の BASE）。dist/ はコミットしない（毎回作り直す）。
"""

import hashlib
import json
import shutil
from datetime import datetime

from . import fonts
from .config import DIST, JST, OUT, SITE, SITE_URL


def build(log=print) -> None:
    if not (OUT / "meta.json").exists():
        raise SystemExit("out/ がありません。先に python -m cmeta build を実行してください")
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SITE, DIST)
    shutil.copytree(OUT, DIST / "data")
    html = _self_host_fonts((DIST / "index.html").read_text("utf-8"), log)
    (DIST / "index.html").write_text(html, "utf-8")
    # 画面の JS・CSS は中身ごとに URL を変える（?v=<中身のハッシュ>）。更新したらすぐ新しいものが読まれる
    html = (DIST / "index.html").read_text("utf-8")
    for name in ("app.js", "style.css"):
        h = hashlib.sha256((DIST / name).read_bytes()).hexdigest()[:10]
        html = html.replace(f'"{name}"', f'"{name}?v={h}"')
    (DIST / "index.html").write_text(html, "utf-8")
    meta = json.loads((OUT / "meta.json").read_text("utf-8"))
    day = (meta.get("generated_at") or datetime.now(JST).isoformat())[:10]
    # 画面はハッシュ（#v=…）で切り替えるので、URL は 1 つだけ
    (DIST / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{SITE_URL}</loc><lastmod>{day}</lastmod></url>\n"
        "</urlset>\n", "utf-8")
    n = sum(1 for p in DIST.rglob("*") if p.is_file())
    size = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    log(f"dist: {n} ファイル、{size / 1e6:.1f} MB → {DIST}")


def _page_text() -> str:
    """公開する文字: 画面のファイルと、データの JSON（エスケープをほどいた文字）。"""
    parts = []
    for p in DIST.rglob("*"):
        if p.suffix in (".html", ".js", ".css", ".webmanifest"):
            parts.append(p.read_text("utf-8", errors="ignore"))
        elif p.suffix == ".json":
            try:
                parts.append(json.dumps(json.loads(p.read_text("utf-8")), ensure_ascii=False))
            except ValueError:
                pass
    return "".join(parts)


def _self_host_fonts(html: str, log) -> str:
    start, end = "<!-- fonts:start", "<!-- fonts:end -->"
    if start not in html or end not in html:
        return html
    got = fonts.build(_page_text(), DIST / "fonts", log)
    if not got:
        return html
    a, b = html.index(start), html.index(end) + len(end)
    head = "".join(f'<link rel="preload" href="fonts/{n}" as="font" type="font/woff2" crossorigin>\n' for n in got["preload"])
    return html[:a] + head + f"<style>{got['css']}</style>" + html[b:]

"""公開用のフォルダ dist/ を作る: site/ の中身 + out/ を data/ として + sitemap.xml。

画面は既定で ./data/ を読む（app.js の BASE）。dist/ はコミットしない（毎回作り直す）。
"""

import hashlib
import json
import shutil
from datetime import datetime

from .config import DIST, JST, OUT, SITE, SITE_URL


def build(log=print) -> None:
    if not (OUT / "meta.json").exists():
        raise SystemExit("out/ がありません。先に python -m cmeta build を実行してください")
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SITE, DIST)
    shutil.copytree(OUT, DIST / "data")
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

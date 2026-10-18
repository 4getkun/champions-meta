"""書体を自前で配る（dist/ を作るときに使う）。

Google Fonts から読むと、日本語の書体は 100 前後の断片に分かれ、別のドメインへの接続と CSS の取得を待ってから読み始める。
そこで、公開する文字（site/ と out/ に出てくる文字）だけに絞った書体を、公開先から配る。
- 元の書体: google/fonts リポジトリの可変／静的書体（OFL）。.cache/fonts/ に置き、無ければ取りに行く。
- 太さの軸は使う範囲だけに絞る（instancer）。Inter の opsz は本文向けの 14 に固定する。
- 英数の書体（Inter）は U+2000 未満の文字、日本語の書体（Zen Kaku Gothic New）はそれ以外の文字
  （かなは全部）を持つ。画面の CSS は英数の書体を先に書いているので、日本語の書体が英数を持つ必要はない。
- 入力欄などで、絞った書体に無い文字が出たときは、system-ui などの後ろの書体で表示される。
fonttools と brotli が無い、または元の書体を取れないときは None を返し、dist は Google Fonts のまま出す。
"""

import hashlib
import io
import urllib.request
from pathlib import Path

from .config import CACHE

SRC = "https://raw.githubusercontent.com/google/fonts/main/ofl"
FONTS = [
    # family, 元のファイル, 太さの範囲, 固定する軸, 英数か
    ("Inter", "inter/Inter[opsz,wght].ttf", (400, 700), {"opsz": 14}, True),
    ("Zen Kaku Gothic New", "zenkakugothicnew/ZenKakuGothicNew-Regular.ttf", (400, 400), {}, False),
    ("Zen Kaku Gothic New", "zenkakugothicnew/ZenKakuGothicNew-Medium.ttf", (500, 500), {}, False),
    ("Zen Kaku Gothic New", "zenkakugothicnew/ZenKakuGothicNew-Bold.ttf", (700, 700), {}, False),
]
PRELOAD = ("Inter",)  # 日本語はMacのヒラギノ優先。未使用のWebフォントを先読みしない。
KANA = set(range(0x3000, 0x3100)) | set(range(0x30A0, 0x3100)) | set(range(0xFF00, 0xFFF0))
LATIN_BASE = set(range(0x20, 0x7F)) | set(range(0xA0, 0x180))
FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "palt", "tnum", "case", "ss01", "cv11"]


def _source(path: str) -> Path | None:
    dest = CACHE / "fonts" / Path(path).name
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{SRC}/{path.replace('[', '%5B').replace(']', '%5D')}"
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            dest.write_bytes(r.read())
    except OSError:
        return None
    return dest


def _ranges(cps: list[int]) -> str:
    out, cps = [], sorted(cps)
    i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f"U+{cps[i]:X}" if i == j else f"U+{cps[i]:X}-{cps[j]:X}")
        i = j + 1
    return ", ".join(out)


def build(text: str, out_dir: Path, log=print) -> dict | None:
    """text に出てくる文字だけの書体を out_dir に書き、{"css": @font-face の CSS, "preload": [ファイル名]} を返す。"""
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
        import brotli  # noqa: F401  （woff2 に要る）
    except ImportError:
        log("fonts: fonttools / brotli が無いので、Google Fonts のまま出します")
        return None
    used = {ord(c) for c in text}
    out_dir.mkdir(parents=True, exist_ok=True)
    css, preload, total = [], [], 0
    for family, path, (lo, hi), pin, latin in FONTS:
        src = _source(path)
        if src is None:
            log(f"fonts: {family} を取れなかったので、Google Fonts のまま出します")
            return None
        cps = sorted(c for c in (used | LATIN_BASE if latin else used | KANA) if (c < 0x2000) == latin and c >= 0x20)
        font = TTFont(src)
        if "fvar" in font:
            axes = {a.axisTag for a in font["fvar"].axes}
            limits = {"wght": (lo, hi), **{k: v for k, v in pin.items() if k in axes}}
            font = instancer.instantiateVariableFont(font, limits)
        # 絞った書体を一度書き出して読み直す（そのまま subset すると、遅延読み込みの表と字形の並びが合わないことがある）
        tmp = io.BytesIO()
        font.save(tmp)
        tmp.seek(0)
        font = TTFont(tmp)
        opt = subset.Options()
        opt.flavor = "woff2"
        opt.layout_features = FEATURES
        opt.name_IDs = ["*"]  # 著作権と OFL の表示を残す
        opt.notdef_outline = True
        sub = subset.Subsetter(opt)
        sub.populate(unicodes=cps)
        sub.subset(font)
        buf = io.BytesIO()
        font.flavor = "woff2"
        font.save(buf)
        body = buf.getvalue()
        name = f"{family.lower().replace(' ', '-')}-{hashlib.sha256(body).hexdigest()[:10]}.woff2"
        (out_dir / name).write_bytes(body)
        total += len(body)
        css.append(f"@font-face{{font-family:'{family}';src:url(fonts/{name}) format('woff2');"
                   f"font-weight:{lo if lo == hi else f'{lo} {hi}'};font-style:normal;font-display:swap;unicode-range:{_ranges(cps)}}}")
        if family in PRELOAD:
            preload.append(name)
        log(f"fonts: {family} {len(cps)} 字 → {len(body) / 1024:.0f} KB")
    log(f"fonts: 合計 {total / 1024:.0f} KB")
    return {"css": "\n".join(css), "preload": preload}

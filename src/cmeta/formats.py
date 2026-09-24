"""ルール名（例: gen9championsvgc2026regmbbo3）を系統・レギュレーション・Bo3 に分ける。"""

import re

from .config import FORMAT_PREFIX

_REG = re.compile(r"^(?P<kind>vgc(?P<year>\d{4})|bss)reg(?P<reg>[a-z]+)$")


def reg_label(code: str) -> str:
    """'mb' -> 'M-B'、'f' -> 'F'。"""
    code = code.upper()
    return code if len(code) == 1 else f"{code[0]}-{code[1:]}"


def parse_format(fid: str) -> dict | None:
    """チャンピオンズのルールでなければ None。"""
    if not fid.startswith(FORMAT_PREFIX):
        return None
    body = fid[len(FORMAT_PREFIX):]
    bo3 = body.endswith("bo3")
    if bo3:
        body = body[:-3]
    m = _REG.match(body)
    if m:
        family = m["kind"]
        regulation = reg_label(m["reg"])
    else:
        family, regulation = body, None
    doubles = family.startswith("vgc") or "doubles" in family
    return {
        "id": fid,
        "family": family,  # 系統: vgc2026 / bss / ou / uu / 4v4doublesuu …
        "regulation": regulation,  # 'M-B' など。無い系統は None
        "bo3": bo3,
        "game_type": "doubles" if doubles else "singles",
        # 同じ系統・同じ Bo3 区分の中で、レギュレーションをまたいで並べるための鍵
        "track": f"{family}{'-bo3' if bo3 else ''}",
    }


def month_range(first: str, last: str) -> list[str]:
    """'2026-04'〜'2026-08' を両端込みで。"""
    y, m = map(int, first.split("-"))
    ly, lm = map(int, last.split("-"))
    out = []
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out

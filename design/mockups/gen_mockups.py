"""デザイン案のモックアップを out/ の実データから作る（静的 HTML 4 枚 → スクリーンショット → 比較用の 1 枚の PNG）。

    python design/mockups/gen_mockups.py

モックアップは見た目の比較用。本番のデザイン部（site/）は、選んだ案をもとに別に作る。
"""

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "out"
FMT = "gen9championsvgc2026regmb"
MONTH = "2026-08"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
W = 1440


def load(p):
    return json.loads((OUT / p).read_text("utf-8"))


names = load("names.json")["pokemon"]
mo = load(f"monthly/{FMT}.json")
track = load("tracks/vgc2026.json")
cores = load(f"cores/{FMT}.json")["months"][MONTH]["cores"]
weekly = load(f"weekly/{FMT}.json")["recent"]


def ja(n):
    v = names.get(n) or {}
    return v.get("ja") or n


def short(n):
    """表示用に（…）を落とす。メガはそのまま。"""
    s = ja(n)
    return s.split("（")[0]


# ── 数字 ────────────────────────────────────────────────
div = mo["diversity"]
q1_now, q1_prev = div[MONTH]["q1"], div["2026-07"]["q1"]
turnover = mo["turnover"][MONTH]
battles = mo["battles"]["0"][-1]
months = track["months"]
seg = track["segments"]
break_i = next(i for i in range(1, len(seg)) if seg[i]["regulation"] != seg[i - 1]["regulation"])
usage = track["usage_grouped"]
top6 = sorted(usage, key=lambda k: -(usage[k][-1] or 0))[:6]
rising = mo["movers"][MONTH]["rising"][:5]
falling = mo["movers"][MONTH]["falling"][:5]
gap = mo["cutoff_gap"]["months"][MONTH]["higher_at_top"][:5]
core_list = [[short(x) for x in c["members"][:5]] for c in cores[:4]]
wk = sorted(weekly["pokemon"].items(), key=lambda kv: -kv[1]["usage"])[:18]
mlabel = [f"{int(m[5:])}月" for m in months]


core_raw = [c["members"][:5] for c in cores[:4]]


def sprite(n, kind="front"):
    sp = (names.get(n) or {}).get("sprite") or {}
    return sp.get(kind) or sp.get("front")


def icon(n, px=32):
    """一覧用のドット絵。無ければ空。"""
    u = sprite(n)
    return (f'<img src="{u}" width="{px}" height="{px}" loading="lazy" alt="" '
            f'style="image-rendering:pixelated;vertical-align:middle;margin:-6px 2px -6px -4px">') if u else ""


def svg_icon(n, x, y, px=28):
    u = sprite(n)
    return f'<image href="{u}" x="{x:.1f}" y="{y:.1f}" width="{px}" height="{px}" style="image-rendering:pixelated"/>' if u else ""


# ── SVG の部品（色は呼び出し側から） ─────────────────────────
def line_chart(t, w=720, h=300, focus=None, icons=False):
    """使用率の推移。focus の 1 本だけ色、残りは薄い灰色（色を系列の数だけ使わない）。"""
    focus = focus or top6[0]
    pad_l, pad_r, pad_t, pad_b = 44, (140 if icons else 120), 18, 30
    iw, ih = w - pad_l - pad_r, h - pad_t - pad_b
    ymax = 0.5
    X = lambda i: pad_l + iw * i / (len(months) - 1)
    Y = lambda v: pad_t + ih * (1 - v / ymax)
    s = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="使用率の推移">']
    for v in (0, 0.1, 0.2, 0.3, 0.4, 0.5):
        s.append(f'<line x1="{pad_l}" x2="{w-pad_r}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{t["grid"]}" stroke-width="1"/>')
        s.append(f'<text x="{pad_l-8}" y="{Y(v)+4:.1f}" text-anchor="end" font-size="11" fill="{t["muted"]}">{int(v*100)}%</text>')
    bx = (X(break_i - 1) + X(break_i)) / 2
    s.append(f'<line x1="{bx:.1f}" x2="{bx:.1f}" y1="{pad_t}" y2="{h-pad_b}" stroke="{t["muted"]}" stroke-dasharray="4 4"/>')
    s.append(f'<text x="{bx+6:.1f}" y="{pad_t+12}" font-size="11" fill="{t["muted"]}">M-A → M-B</text>')
    for i, lab in enumerate(mlabel):
        s.append(f'<text x="{X(i):.1f}" y="{h-8}" text-anchor="middle" font-size="11" fill="{t["muted"]}">{lab}</text>')
    order = [k for k in top6 if k != focus] + [focus]
    for k in order:
        col = t["accent"] if k == focus else t["context"]
        sw = 3 if k == focus else 1.5
        for a, b in ((0, break_i), (break_i, len(months))):  # レギュレーションの切れ目で線を切る
            pts = " ".join(f"{X(i):.1f},{Y(usage[k][i] or 0):.1f}" for i in range(a, b))
            s.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"/>')
        last = usage[k][-1] or 0
        s.append(f'<circle cx="{X(len(months)-1):.1f}" cy="{Y(last):.1f}" r="{4.5 if k==focus else 3}" fill="{col}" stroke="{t["surface"]}" stroke-width="2"/>')
    # 右端の名前（重ならないよう少しずらす）
    ys = sorted(((Y(usage[k][-1] or 0), k) for k in top6))
    placed = []
    for y, k in ys:
        y2 = max([y] + [p + (20 if icons else 14) for p in placed[-1:]])
        placed.append(y2)
        fw = "700" if k == focus else "400"
        col = t["text"] if k == focus else t["muted"]
        if icons:
            s.append(svg_icon(k, w - pad_r + 4, y2 - 12, 24))
        tx = w - pad_r + (30 if icons else 10)
        s.append(f'<text x="{tx}" y="{y2+4:.1f}" font-size="12" font-weight="{fw}" fill="{col}">{short(k)} {usage[k][-1]*100:.0f}%</text>')
    s.append("</svg>")
    return "".join(s)


def movers_chart(t, w=420, row=30, icons=False):
    rows = [(r["name"], r["delta"]) for r in rising] + [(r["name"], r["delta"]) for r in falling]
    h = row * len(rows) + 10
    mid = w * 0.5
    scale = (w * 0.5 - 70) / 0.08
    s = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="前月から伸びた・落ちた">']
    s.append(f'<line x1="{mid}" x2="{mid}" y1="0" y2="{h}" stroke="{t["grid"]}"/>')
    for i, (n, d) in enumerate(rows):
        y = 6 + i * row
        bw = abs(d) * scale
        if d > 0:
            s.append(f'<rect x="{mid+1}" y="{y}" width="{bw:.1f}" height="{row-12}" rx="4" fill="{t["up"]}"/>')
            s.append(f'<text x="{mid-(34 if icons else 8)}" y="{y+13}" text-anchor="end" font-size="12" fill="{t["text"]}">{short(n)}</text>')
            if icons:
                s.append(svg_icon(n, mid - 31, y - 7, 28))
            s.append(f'<text x="{mid+bw+6:.1f}" y="{y+13}" font-size="11" fill="{t["muted"]}">▲{d*100:.1f}</text>')
        else:
            s.append(f'<rect x="{mid-1-bw:.1f}" y="{y}" width="{bw:.1f}" height="{row-12}" rx="4" fill="{t["down"]}"/>')
            s.append(f'<text x="{mid+(34 if icons else 8)}" y="{y+13}" font-size="12" fill="{t["text"]}">{short(n)}</text>')
            if icons:
                s.append(svg_icon(n, mid + 3, y - 7, 28))
            s.append(f'<text x="{mid-bw-6:.1f}" y="{y+13}" text-anchor="end" font-size="11" fill="{t["muted"]}">▼{abs(d)*100:.1f}</text>')
    s.append("</svg>")
    return "".join(s)


def scatter(t, w=560, h=300, icons=False):
    """見せ合いの使用率 × 選出率（リプレイ、参考値）。"""
    pad_l, pad_r, pad_t, pad_b = 44, 90, 22, 40
    iw, ih = w - pad_l - pad_r, h - pad_t - pad_b
    xs = [v["usage"] for _, v in wk]
    xmin, xmax = min(xs) * 0.9, max(xs) * 1.08
    ylo, yhi = 0.6, 1.0
    X = lambda v: pad_l + iw * (v - xmin) / (xmax - xmin)
    Y = lambda v: pad_t + ih * (1 - (v - ylo) / (yhi - ylo))
    s = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="使用率と選出率">']
    for v in (0.6, 0.7, 0.8, 0.9, 1.0):
        s.append(f'<line x1="{pad_l}" x2="{w-pad_r}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{t["grid"]}"/>')
        s.append(f'<text x="{pad_l-8}" y="{Y(v)+4:.1f}" text-anchor="end" font-size="11" fill="{t["muted"]}">{int(v*100)}%</text>')
    step = 0.02
    v = (int(xmin / step) + 1) * step
    while v < xmax:
        s.append(f'<text x="{X(v):.1f}" y="{h-pad_b+16}" text-anchor="middle" font-size="11" fill="{t["muted"]}">{v*100:.0f}%</text>')
        v += step
    s.append(f'<text x="{w-pad_r}" y="{h-2}" text-anchor="end" font-size="11" fill="{t["muted"]}">見せ合いの使用率 →</text>')
    s.append(f'<text x="{pad_l}" y="{pad_t-2}" font-size="11" fill="{t["muted"]}">↑ 選出率</text>')
    labels = []
    for i, (n, v) in enumerate(wk):
        cx, cy = X(v["usage"]), Y(v["bring"])
        s.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6" fill="{t["accent"]}" fill-opacity=".85" stroke="{t["surface"]}" stroke-width="2"/>')
        if i < 8 and all(abs(cy - ly) > 15 or abs(cx - lx) > 90 for lx, ly in labels):
            labels.append((cx, cy))
            if icons:
                s.append(svg_icon(n, cx + 6, cy - 14, 26))
            s.append(f'<text x="{cx+(32 if icons else 10):.1f}" y="{cy+4:.1f}" font-size="12" fill="{t["text"]}">{short(n)}</text>')
    s.append("</svg>")
    return "".join(s)


def gap_list(t, cls="gap"):
    rows = "".join(f'<li><span>{short(r["name"])}</span><b>+{r["diff"]*100:.0f}pt</b></li>' for r in gap)
    return f'<ul class="{cls}">{rows}</ul>'


def spark(t, k, w=110, h=34):
    vals = [v or 0 for v in usage[k]]
    lo, hi = min(vals), max(vals)
    X = lambda i: 3 + (w - 6) * i / (len(vals) - 1)
    Y = lambda v: 3 + (h - 6) * (1 - (v - lo) / ((hi - lo) or 1))
    lines = []
    for a, b in ((0, break_i), (break_i, len(vals))):  # レギュレーションの切れ目で線を切る
        pts = " ".join(f"{X(i):.1f},{Y(vals[i]):.1f}" for i in range(a, b))
        lines.append(f'<polyline points="{pts}" fill="none" stroke="{t["accent"]}" stroke-width="2" '
                     f'stroke-linecap="round" stroke-linejoin="round"/>')
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}">{"".join(lines)}</svg>'


COMMON = {
    "q1": f"{q1_now:.1f}", "q1d": f"{q1_now - q1_prev:+.1f}", "turn": f"{turnover*100:.1f}%",
    "battles": f"{battles/10000:.0f}万", "top": short(top6[0]), "topv": f"{usage[top6[0]][-1]*100:.1f}%",
    "n_series": weekly["n_series"], "n_games": weekly["n_games"],
}


def page(title, fonts, css, body):
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?{fonts}&display=swap" rel="stylesheet">
<style>*{{box-sizing:border-box;margin:0}}body{{width:{W}px}}{css}</style></head><body>{body}</body></html>"""


# ── A: ガラスのベントー（hub と同じ ラベンダー×ライム） ───────────────
def concept_a():
    t = {"surface": "#ffffff", "grid": "#ece9f5", "muted": "#8a86a0", "text": "#1d1a2e",
         "accent": "#6d4df2", "context": "#d3cdea", "up": "#7cc94a", "down": "#c9c3dd"}
    css = """
body{font-family:'Zen Kaku Gothic New',system-ui,sans-serif;color:#1d1a2e;background:
 radial-gradient(900px 600px at 10% -10%,#e6dcff 0,transparent 60%),radial-gradient(800px 500px at 100% 10%,#e9ffd0 0,transparent 55%),#f6f4fb;padding:36px 48px 56px}
.top{display:flex;align-items:center;gap:16px;margin-bottom:28px}.logo{font-weight:900;font-size:15px;letter-spacing:.02em}
.pill{padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.6);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.9);font-size:13px;box-shadow:0 1px 0 rgba(255,255,255,.8) inset,0 8px 24px rgba(80,60,160,.08)}
.pill.on{background:#1d1a2e;color:#fff;border-color:#1d1a2e}.sp{flex:1}
h1{font-family:'Inter Tight','Zen Kaku Gothic New';font-size:84px;line-height:.95;letter-spacing:-.04em;font-weight:800;margin:6px 0 10px}
.lead{font-size:17px;color:#57536b;max-width:640px;line-height:1.7}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:18px;margin-top:30px}
.card{background:rgba(255,255,255,.72);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.95);border-radius:28px;padding:24px;box-shadow:0 1px 0 #fff inset,0 20px 50px rgba(70,50,150,.08)}
.k{font-size:12px;color:#8a86a0;letter-spacing:.08em}.big{font-family:'Inter Tight';font-size:64px;font-weight:800;letter-spacing:-.04em;line-height:1}
.chip{display:inline-block;padding:3px 10px;border-radius:999px;background:#e9ffd0;color:#3d6b12;font-size:12px;font-weight:700;margin-left:6px;vertical-align:middle}
.c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}.c7{grid-column:span 7}.c8{grid-column:span 8}.c12{grid-column:span 12}
h2{font-size:18px;margin-bottom:12px}.core{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px}.core span{padding:5px 10px;border-radius:12px;background:#f1edff;font-size:13px}
.core span:first-child{background:#6d4df2;color:#fff}.note{font-size:12px;color:#8a86a0;margin-top:8px}
.dark{background:#1d1a2e;color:#fff}.dark .k{color:#b9b3d6}
.gap{list-style:none;padding:0;margin-top:6px}.gap li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ece9f5;font-size:14px}.gap b{color:#6d4df2}"""
    body = f"""
<div class="top"><div class="logo">fourgetkun 工房 / Champions Meta</div><div class="sp"></div>
<div class="pill on">VGC M-B</div><div class="pill">VGC Bo3</div><div class="pill">シングル OU</div><div class="pill">BSS</div><div class="pill">◐</div></div>
<div class="k">2026年8月 · Showdown · レート1630以上</div>
<h1>いまの環境、<br>ひと目で。</h1>
<p class="lead">ポケモンチャンピオンズの使用率・並び・選出率を、Smogon の月次統計と公開リプレイから毎日更新。</p>
<div class="grid">
 <div class="card c3 dark"><div class="k">実効的なポケモン数</div><div class="big">{COMMON['q1']}</div><div class="note" style="color:#b9b3d6">前月 {COMMON['q1d']} · 多いほど多様</div></div>
 <div class="card c3"><div class="k">前月からの入れ替わり</div><div class="big">{COMMON['turn']}</div><div class="note">落ち着いた月</div></div>
 <div class="card c3"><div class="k">使用率 1位</div><div class="big" style="font-size:44px">{COMMON['top']}</div><div class="note">{COMMON['topv']}<span class="chip">▲6.9</span></div></div>
 <div class="card c3"><div class="k">対戦数</div><div class="big">{COMMON['battles']}</div><div class="note">Smogon 月次統計</div></div>
 <div class="card c8"><h2>使用率の推移 <span class="chip">上位6匹</span></h2>{line_chart(t)}</div>
 <div class="card c4"><h2>先月から伸びた・落ちた</h2>{movers_chart(t, w=380)}</div>
 <div class="card c5"><h2>いまの並び（コア）</h2>{''.join(f'<div class="core">{"".join(f"<span>{m}</span>" for m in c)}</div>' for c in core_list[:3])}
 <h2 style="margin-top:22px">上位ほど使われる <span class="chip">1760 − 全体</span></h2>{gap_list(t)}</div>
 <div class="card c7"><h2>選出率 × 使用率 <span class="chip" style="background:#fff1d6;color:#8a5a00">参考値</span></h2>{scatter(t)}
 <div class="note">公開リプレイ 直近28日 · {COMMON['n_series']}シリーズ / {COMMON['n_games']}戦</div></div>
</div>"""
    return page("A", "family=Zen+Kaku+Gothic+New:wght@400;700;900&family=Inter+Tight:wght@700;800", css, body)


# ── B: ドーパミン・マキシマル（高彩度・太い輪郭・ステッカー） ─────────
def concept_b():
    t = {"surface": "#fffdf5", "grid": "#f0e6c8", "muted": "#7a6a4a", "text": "#111",
         "accent": "#ff3d7f", "context": "#e8d9a8", "up": "#1f9d55", "down": "#ff8a3d"}
    css = """
body{font-family:'M PLUS Rounded 1c',system-ui,sans-serif;background:#fff3b0;color:#111;padding:32px 44px 56px}
.bar{display:flex;gap:10px;align-items:center;margin-bottom:26px}.logo{font-family:'Dela Gothic One';font-size:22px}
.tab{border:3px solid #111;border-radius:14px;padding:8px 16px;font-weight:800;background:#fff;box-shadow:4px 4px 0 #111}
.tab.on{background:#3d7bff;color:#fff}.sp{flex:1}
.hero{background:#ff3d7f;border:3px solid #111;border-radius:36px;padding:34px 40px;box-shadow:10px 10px 0 #111;color:#fff;position:relative;overflow:hidden}
.hero h1{font-family:'Dela Gothic One';font-size:88px;line-height:1;letter-spacing:-.02em}
.hero p{font-size:18px;font-weight:700;margin-top:12px}
.blob{position:absolute;right:-60px;top:-80px;width:360px;height:360px;background:#ffd23d;border-radius:43% 57% 61% 39%/45% 38% 62% 55%;border:3px solid #111}
.sticker{position:absolute;right:70px;top:60px;background:#fff;color:#111;border:3px solid #111;border-radius:999px;padding:18px 22px;font-family:'Dela Gothic One';font-size:26px;transform:rotate(8deg);text-align:center;line-height:1.1}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin:26px 0}
.stat{border:3px solid #111;border-radius:24px;padding:18px 20px;box-shadow:6px 6px 0 #111}
.stat b{display:block;font-family:'Dela Gothic One';font-size:48px;line-height:1.1}.stat small{font-weight:800}
.g{display:grid;grid-template-columns:1.6fr 1fr;gap:22px}.box{background:#fffdf5;border:3px solid #111;border-radius:28px;padding:22px;box-shadow:8px 8px 0 #111}
.box h2{font-weight:800;font-size:26px;margin-bottom:10px;letter-spacing:.02em}
.tag{display:inline-block;background:#111;color:#fff;border-radius:8px;padding:2px 8px;font-size:12px;font-weight:800;margin-left:8px;vertical-align:middle}
.cores{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.c{border:3px solid #111;border-radius:22px;padding:14px}
.c:nth-child(1){background:#b8f2c9}.c:nth-child(2){background:#c9dcff}.c:nth-child(3){background:#ffd0e1}
.gap{list-style:none;padding:0;display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:16px}.gap li{border:3px solid #111;border-radius:18px;padding:10px;background:#fff;text-align:center;font-weight:800}.gap li b{display:block;font-family:'Dela Gothic One';font-size:22px;color:#ff3d7f}
.c b{font-weight:800;font-size:18px}.c p{font-weight:700;font-size:13px;line-height:1.7;margin-top:4px}"""
    body = f"""
<div class="bar"><div class="logo">チャンピオンズ メタ図鑑</div><div class="sp"></div>
<div class="tab on">VGC M-B</div><div class="tab">Bo3</div><div class="tab">シングル</div><div class="tab">BSS</div></div>
<div class="hero"><div class="blob"></div><div class="sticker">8月の<br>1位！<br>{COMMON['top']}</div>
<h1>いま、何が<br>流行ってる？</h1><p>Showdown のチャンピオンズ環境を毎日集計 ／ 2026年8月</p></div>
<div class="row">
 <div class="stat" style="background:#c9dcff"><small>実効的なポケモン数</small><b>{COMMON['q1']}</b><small>前月 {COMMON['q1d']}</small></div>
 <div class="stat" style="background:#b8f2c9"><small>入れ替わり</small><b>{COMMON['turn']}</b><small>先月より落ち着いた</small></div>
 <div class="stat" style="background:#ffd0e1"><small>1位の使用率</small><b>{COMMON['topv']}</b><small>{COMMON['top']}</small></div>
 <div class="stat" style="background:#fff"><small>対戦数</small><b>{COMMON['battles']}</b><small>Smogon 月次</small></div></div>
<div class="g"><div class="box"><h2>使用率の推移<span class="tag">上位6</span></h2>{line_chart(t)}</div>
<div class="box"><h2>急上昇・急降下</h2>{movers_chart(t, w=400)}</div></div>
<div class="g" style="margin-top:22px"><div class="box"><h2>いまの並び</h2><div class="cores">
{''.join(f'<div class="c"><b>{c[0]}軸</b><p>{" / ".join(c[1:])}</p></div>' for c in core_list[:3])}</div>
<h2 style="margin-top:20px">上位ほど使われる<span class="tag">1760 − 全体</span></h2>{gap_list(t)}</div>
<div class="box"><h2>選出率<span class="tag">参考値</span></h2>{scatter(t, w=440, h=300)}</div></div>"""
    return page("B", "family=Dela+Gothic+One&family=M+PLUS+Rounded+1c:wght@500;700;800", css, body)


# ── C: 触れる質感のブルータリズム（ダーク・端末・等幅） ───────────────
def concept_c():
    t = {"surface": "#0c0d0b", "grid": "#23261f", "muted": "#7f8775", "text": "#e9f0df",
         "accent": "#c6ff3d", "context": "#3a4034", "up": "#c6ff3d", "down": "#ff5d3d"}
    css = """
body{font-family:'IBM Plex Sans JP',system-ui,sans-serif;background:#0c0d0b;color:#e9f0df;padding:0}
.mono{font-family:'JetBrains Mono',monospace}.hd{display:flex;border-bottom:1px solid #2f332a}
.hd div{padding:16px 22px;border-right:1px solid #2f332a;font-size:13px}.hd .on{background:#c6ff3d;color:#0c0d0b;font-weight:700}.hd .sp{flex:1;border-right:0}
.hero{display:grid;grid-template-columns:1.3fr 1fr;border-bottom:1px solid #2f332a}
.hero .l{padding:44px 40px;border-right:1px solid #2f332a}.hero h1{font-size:76px;line-height:1.02;letter-spacing:-.03em;font-weight:700}
.hero h1 em{font-style:normal;color:#c6ff3d}.hero p{color:#9aa38e;margin-top:16px;font-size:15px}
.kv{display:grid;grid-template-columns:1fr 1fr}.kv div{padding:26px 28px;border-bottom:1px solid #2f332a;border-right:1px solid #2f332a}
.kv b{display:block;font-family:'JetBrains Mono';font-size:48px;letter-spacing:-.03em}.kv small{color:#7f8775;font-size:12px}
.row{display:grid;grid-template-columns:2fr 1fr;border-bottom:1px solid #2f332a}.row>div{padding:26px 30px;border-right:1px solid #2f332a}
h2{font-family:'JetBrains Mono';font-size:13px;letter-spacing:.12em;color:#c6ff3d;margin-bottom:14px;text-transform:uppercase}
.tbl{width:100%;border-collapse:collapse;font-size:14px}.tbl td{padding:9px 6px;border-bottom:1px dashed #2f332a}.tbl td.n{font-family:'JetBrains Mono';text-align:right;color:#9aa38e}
.btn{display:inline-block;margin-top:18px;border:1px solid #c6ff3d;color:#c6ff3d;padding:10px 16px;font-family:'JetBrains Mono';font-size:13px;box-shadow:4px 4px 0 #c6ff3d}
.warn{color:#ffb13d;font-family:'JetBrains Mono';font-size:12px}"""
    tbl = "".join(
        f'<tr><td class="mono" style="color:#7f8775">{i+1:02d}</td><td>{short(k)}</td><td>{spark(t, k)}</td>'
        f'<td class="n">{usage[k][-1]*100:.1f}%</td></tr>' for i, k in enumerate(top6))
    body = f"""
<div class="hd mono"><div>CHAMPIONS/META</div><div class="on">VGC_M-B</div><div>VGC_BO3</div><div>OU</div><div>BSS</div><div class="sp"></div><div>2026-08 · CUTOFF 1630</div></div>
<div class="hero"><div class="l"><h1>環境は<em>{COMMON['q1']}</em>匹で<br>回っている。</h1>
<p>実効的なポケモン数（ヒル数 q=1）。Smogon 月次統計 {COMMON['battles']}戦から計算。</p><div class="btn">→ 計算方法を読む</div></div>
<div class="kv"><div><small>Δ前月</small><b>{COMMON['q1d']}</b></div><div><small>入れ替わり</small><b>{COMMON['turn']}</b></div>
<div><small>1位</small><b style="font-size:34px">{COMMON['top']}</b></div><div><small>1位の使用率</small><b>{COMMON['topv']}</b></div></div></div>
<div class="row"><div><h2>// usage_trend</h2>{line_chart(t, w=860, h=320)}</div><div><h2>// top6</h2><table class="tbl">{tbl}</table></div></div>
<div class="row"><div><h2>// bring_rate × usage <span class="warn">[参考値: 公開リプレイ {COMMON['n_games']}戦]</span></h2>{scatter(t, w=860, h=300)}</div>
<div><h2>// movers</h2>{movers_chart(t, w=420)}</div></div>"""
    return page("C", "family=IBM+Plex+Sans+JP:wght@400;700&family=JetBrains+Mono:wght@400;700", css, body)


# ── D: 自然の抽出・エディトリアル（生成り・明朝・土の色） ──────────────
def concept_d():
    t = {"surface": "#f5efe4", "grid": "#e4dccb", "muted": "#8b7f6a", "text": "#2b261d",
         "accent": "#b5552f", "context": "#d6ccb8", "up": "#5f7a3a", "down": "#c98a6b"}
    css = """
body{font-family:'Zen Kaku Gothic New',system-ui,sans-serif;background:#f5efe4;color:#2b261d;padding:40px 72px 64px}
.mast{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #2b261d;padding-bottom:12px}
.mast .t{font-family:'Shippori Mincho B1';font-size:26px;font-weight:800}.mast nav{font-size:14px;display:flex;gap:22px}
.mast nav .on{border-bottom:2px solid #b5552f}
.issue{display:grid;grid-template-columns:1.2fr 1fr;gap:56px;margin:40px 0 30px}
.issue h1{font-family:'Shippori Mincho B1';font-size:78px;line-height:1.15;font-weight:800;letter-spacing:.01em}
.issue h1 span{background:linear-gradient(transparent 62%,#e9b99a 62%)}
.issue .dek{font-size:17px;line-height:2;color:#5a5140;margin-top:18px}
.num{border-left:2px solid #2b261d;padding-left:24px;display:grid;gap:20px;align-content:start}
.num b{font-family:'Shippori Mincho B1';font-size:58px;font-weight:800;line-height:1}.num small{display:block;font-size:13px;color:#8b7f6a;margin-top:4px}
.cols{display:grid;grid-template-columns:1.6fr 1fr;gap:48px;border-top:1px solid #cfc4ae;padding-top:28px}
h2{font-family:'Shippori Mincho B1';font-size:26px;margin-bottom:6px}.cap{font-size:13px;color:#8b7f6a;margin-bottom:12px}
.core{padding:14px 0;border-bottom:1px solid #d9cfbc;font-size:15px;line-height:1.8}.core b{font-family:'Shippori Mincho B1';font-size:20px;margin-right:10px}
.foot{margin-top:28px;font-size:12px;color:#8b7f6a;border-top:1px solid #cfc4ae;padding-top:12px}"""
    body = f"""
<div class="mast"><div class="t">チャンピオンズ環境録</div><nav><span class="on">VGC M-B</span><span>Bo3</span><span>シングル</span><span>BSS</span><span>読み方</span></nav></div>
<div class="issue"><div><div class="cap">2026年8月号 · Pokémon Showdown</div>
<h1><span>{COMMON['top']}</span>が<br>頂に戻った月</h1>
<p class="dek">M-B に入って二か月。環境の入れ替わりは {COMMON['turn']} と小さく、上位の顔ぶれは固まりつつある。
一方で上位帯ほどドドゲザンやリザードンを選ぶ傾向が強い。</p></div>
<div class="num"><div><b>{COMMON['q1']}</b><small>実効的なポケモン数（前月 {COMMON['q1d']}）</small></div>
<div><b>{COMMON['turn']}</b><small>前月からの入れ替わり</small></div><div><b>{COMMON['battles']}</b><small>集計した対戦数</small></div></div></div>
<div class="cols"><div><h2>使用率の推移</h2><div class="cap">上位6匹 · 点線でレギュレーションが変わる</div>{line_chart(t, w=760)}</div>
<div><h2>伸びた・落ちた</h2><div class="cap">前月との差（ポイント）</div>{movers_chart(t, w=420)}</div></div>
<div class="cols" style="margin-top:30px"><div><h2>選出率と使用率</h2><div class="cap">公開リプレイ直近28日 · 参考値</div>{scatter(t, w=760, h=280)}</div>
<div><h2>いまの並び</h2><div class="cap">一緒に使われやすい組み合わせ</div>
{''.join(f'<div class="core"><b>{c[0]}</b>{"・".join(c[1:])}</div>' for c in core_list[:4])}</div></div>
<div class="foot">出典: Smogon usage statistics / Pokémon Showdown / PokeAPI。非公式ファンツール。</div>"""
    return page("D", "family=Shippori+Mincho+B1:wght@700;800&family=Zen+Kaku+Gothic+New:wght@400;700", css, body)


CONCEPTS = [
    ("A", "ガラスのベントー", ["トレンド: ベントーグリッド／すりガラス／特大の見出し", "hub と同じラベンダー×ライム。数字のカードで一覧"], concept_a),
    ("B", "ドーパミン・マキシマル", ["トレンド: ドーパミン配色／ネオブルータリズムの影", "高彩度・太い輪郭・ステッカー。遊び心と SNS 映え"], concept_b),
    ("C", "タクタイル・ブルータリズム", ["トレンド: 生のグリッド線／等幅／ダーク", "データ好き向けの端末感。数字が主役"], concept_c),
    ("D", "ネイチャー・エディトリアル", ["トレンド: 自然の色／文字が主役の誌面", "生成り・明朝・土の色。読み物として毎月の総評"], concept_d),
]


def shoot(html: Path, png: Path, height: int = 2000) -> None:
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={W},{height}",
                    "--virtual-time-budget=15000", "--force-device-scale-factor=1", f"--screenshot={png}", html.as_uri()],
                   check=True, capture_output=True)
    im = Image.open(png).convert("RGB")
    # 下の余白（背景と同じ色の行）を切る
    px = im.load()

    def busy(y):  # 隣り合う画素の差が大きい所がある行（グラデーションだけの行は静か）
        prev = px[0, y]
        for x in range(3, im.width, 3):
            cur = px[x, y]
            if sum(abs(a - b) for a, b in zip(cur, prev)) > 40:
                return True
            prev = cur
        return False

    bottom = im.height
    while bottom > 200 and not busy(bottom - 1):
        bottom -= 1
    im.crop((0, 0, im.width, min(im.height, bottom + 40))).save(png)


def compose(pngs: list[Path], dst: Path) -> None:
    col_w, gap, head = 680, 40, 150
    ims = [Image.open(p) for p in pngs]
    scaled = [im.resize((col_w, round(im.height * col_w / im.width)), Image.LANCZOS) for im in ims]
    head += 10
    h = head + 130 + max(s.height for s in scaled) + 60
    w = gap + (col_w + gap) * len(scaled)
    canvas = Image.new("RGB", (w, h), "#e9e9ee")
    d = ImageDraw.Draw(canvas)
    font = lambda s: ImageFont.truetype(r"C:\Windows\Fonts\YuGothB.ttc", s)
    fontr = lambda s: ImageFont.truetype(r"C:\Windows\Fonts\YuGothM.ttc", s)
    d.text((gap, 40), "champions-meta デザイン案の比較（実データ: VGC M-B / 2026年8月）", fill="#111", font=font(40))
    d.text((gap, 98), "すべて同じ中身（実効的なポケモン数・入れ替わり・使用率の推移・伸びた/落ちた・並び・選出率）を、4 つのトレンドで描き分けたもの。",
           fill="#555", font=fontr(22))
    for i, ((key, name, desc, _), s) in enumerate(zip(CONCEPTS, scaled)):
        x = gap + i * (col_w + gap)
        d.text((x, head), f"{key}. {name}", fill="#111", font=font(34))
        for j, line in enumerate(desc):
            d.text((x, head + 48 + j * 28), line, fill="#555", font=fontr(19))
        canvas.paste(s, (x, head + 130))
        d.rectangle((x - 1, head + 129, x + col_w, head + 130 + s.height), outline="#c9c9d2")
    canvas.save(dst, optimize=True)


def main():
    pngs = []
    for key, _name, _desc, fn in CONCEPTS:
        html = HERE / f"{key}.html"
        html.write_text(fn(), "utf-8")
        png = HERE / f"{key}.png"
        shoot(html, png)
        pngs.append(png)
    compose(pngs, HERE / "compare.png")
    print("wrote", HERE / "compare.png")


if __name__ == "__main__":
    main()

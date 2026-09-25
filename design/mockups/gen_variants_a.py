"""A 案（ガラスのベントー）の派生案を 5 つ作り、比較用の 1 枚の PNG にまとめる。

    python design/mockups/gen_variants_a.py
"""

import gen_mockups as g
from PIL import Image, ImageDraw, ImageFont

HERE = g.HERE
C = g.COMMON
MONTH = g.MONTH
names_all = g.load("names.json")
rank = g.mo["rank_grouped"]["1630"]
sets = g.mo["sets"][MONTH]
mega = g.mo["mega_split"][MONTH]

LIGHT = {"surface": "#ffffff", "grid": "#ece9f5", "muted": "#8a86a0", "text": "#1d1a2e",
         "accent": "#6d4df2", "context": "#d3cdea", "up": "#7cc94a", "down": "#c9c3dd"}
DARK = {"surface": "#1b1830", "grid": "#2e2a48", "muted": "#9c96bd", "text": "#f1eeff",
        "accent": "#b9a6ff", "context": "#433d66", "up": "#b6f36b", "down": "#5a537f"}

FONTS = "family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Inter+Tight:wght@600;700;800"

# 共通の見た目（A 案の土台）。色は変数だけで切り替える
BASE = """
:root{--bg:#f6f4fb;--glow1:#e6dcff;--glow2:#e9ffd0;--card:rgba(255,255,255,.74);--edge:rgba(255,255,255,.95);
 --ink:#1d1a2e;--sub:#57536b;--muted:#8a86a0;--line:#ece9f5;--accent:#6d4df2;--accent-soft:#f1edff;--lime:#e9ffd0;--lime-ink:#3d6b12;
 --shadow:0 1px 0 #fff inset,0 20px 50px rgba(70,50,150,.08)}
.dark{--bg:#100e1d;--glow1:#2b2058;--glow2:#1d3312;--card:rgba(35,31,60,.72);--edge:rgba(255,255,255,.08);
 --ink:#f1eeff;--sub:#c6c0e6;--muted:#9c96bd;--line:#2e2a48;--accent:#b9a6ff;--accent-soft:#2c2650;--lime:#2a3d17;--lime-ink:#c9f58f;
 --shadow:0 1px 0 rgba(255,255,255,.06) inset,0 20px 50px rgba(0,0,0,.35)}
body{font-family:'Zen Kaku Gothic New',system-ui,sans-serif;color:var(--ink);background:
 radial-gradient(900px 600px at 8% -10%,var(--glow1) 0,transparent 60%),radial-gradient(800px 500px at 100% 8%,var(--glow2) 0,transparent 55%),var(--bg)}
.card{background:var(--card);backdrop-filter:blur(20px);border:1px solid var(--edge);border-radius:28px;padding:24px;box-shadow:var(--shadow)}
.k{font-size:12px;color:var(--muted);letter-spacing:.08em}
.big{font-family:'Inter Tight','Zen Kaku Gothic New';font-size:60px;font-weight:800;letter-spacing:-.04em;line-height:1}
.note{font-size:12px;color:var(--muted);margin-top:8px}
.chip{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:700;margin-left:6px;vertical-align:middle}
.chip.warn{background:#fff1d6;color:#8a5a00}.dark .chip.warn{background:#3d2f12;color:#ffd48a}
h2{font-size:18px;margin-bottom:12px}
.pill{padding:8px 16px;border-radius:999px;background:var(--card);backdrop-filter:blur(14px);border:1px solid var(--edge);font-size:13px;color:var(--ink)}
.pill.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:18px}
.c2{grid-column:span 2}.c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}.c6{grid-column:span 6}
.c7{grid-column:span 7}.c8{grid-column:span 8}.c9{grid-column:span 9}.c12{grid-column:span 12}
.core{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}.core span{padding:5px 10px;border-radius:12px;background:var(--accent-soft);font-size:13px}
.core span:first-child{background:var(--accent);color:var(--bg)}
.rk{width:100%;border-collapse:collapse;font-size:14px}.rk td{padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
.rk .no{font-family:'Inter Tight';font-weight:800;font-size:18px;width:36px}.rk .v{font-family:'Inter Tight';font-weight:700;text-align:right}
.rk .d{font-size:12px;width:48px;text-align:right}.up{color:#3f8f1c}.dark .up{color:#b6f36b}.dn{color:var(--muted)}
.bar{height:8px;border-radius:4px;background:var(--accent-soft);position:relative;min-width:120px}.bar i{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--accent)}
.hb{display:grid;grid-template-columns:110px 1fr 46px;gap:10px;align-items:center;font-size:13px;margin:7px 0}
.hb .b{height:10px;border-radius:5px;background:var(--accent-soft);position:relative}.hb .b i{position:absolute;inset:0 auto 0 0;border-radius:5px;background:var(--accent)}
.hb .p{font-family:'Inter Tight';font-weight:700;text-align:right}
.stack{display:flex;height:14px;border-radius:7px;overflow:hidden;gap:2px;margin:6px 0 2px}.stack i{display:block}
"""


def ranking_rows(t, n=10, spark_w=110):
    top = sorted(rank, key=lambda k: rank[k][-1] or 999)[:n]
    rows = []
    for k in top:
        r = rank[k]
        d = (r[-2] - r[-1]) if r[-2] and r[-1] else 0
        dcls, dtxt = ("up", f"▲{d}") if d > 0 else (("dn", f"▼{-d}") if d < 0 else ("dn", "―"))
        u = g.usage.get(k, [0])[-1] or 0
        sp = g.spark(t, k, w=spark_w) if k in g.usage else ""
        rows.append(f'<tr><td class="no">{r[-1]}</td><td>{g.icon(k, 36)}{g.short(k)}</td><td>{sp}</td>'
                    f'<td style="width:34%"><div class="bar"><i style="width:{u/0.45*100:.0f}%"></i></div></td>'
                    f'<td class="v">{u*100:.1f}%</td><td class="d {dcls}">{dtxt}</td></tr>')
    return f'<table class="rk">{"".join(rows)}</table>'


def set_bars(k, field, kind, n=5):
    rows = []
    for sid, share in list(sets[k][field].items())[:n]:
        nm = (names_all[kind].get(sid) or {}).get("ja") or (names_all[kind].get(sid) or {}).get("en") or sid
        rows.append(f'<div class="hb"><span>{nm}</span><div class="b"><i style="width:{share*100:.0f}%"></i></div>'
                    f'<span class="p">{share*100:.0f}%</span></div>')
    return "".join(rows)


def mega_bars(n=5):
    palette = ["var(--accent)", "#9d8cf7", "#d3cdea"]
    out = []
    for grp, forms in list(mega.items())[:n]:
        segs = sorted(forms.items(), key=lambda kv: -kv[1])
        bar = "".join(f'<i style="width:{v*100:.1f}%;background:{palette[min(i,2)]}"></i>' for i, (f, v) in enumerate(segs))
        lab = " / ".join(f"{g.short(f)} {v*100:.0f}%" for f, v in segs if v >= 0.02)
        out.append(f'<div style="margin:10px 0"><div style="font-size:13px;font-weight:700">{g.icon(grp, 30)}{g.short(grp)}</div>'
                   f'<div class="stack">{bar}</div><div class="note" style="margin-top:2px">{lab}</div></div>')
    return "".join(out)


def cores_html(n=3):
    return "".join(f'<div class="core">{"".join(f"<span>{g.icon(m, 28)}{g.short(m)}</span>" for m in c)}</div>'
                   for c in g.core_raw[:n])


def topbar(extra=""):
    return f"""<div style="display:flex;align-items:center;gap:12px;margin-bottom:26px">
<div style="font-weight:900;font-size:15px">fourgetkun 工房 / Champions Meta</div><div style="flex:1"></div>
<div class="pill on">VGC M-B</div><div class="pill">VGC Bo3</div><div class="pill">シングル OU</div><div class="pill">BSS</div>{extra}</div>"""


def stat_tiles(cls="c3", dark_first=True):
    first = 'style="background:var(--ink);color:var(--bg)"' if dark_first else ""
    return f"""
<div class="card {cls}" {first}><div class="k" {'style="color:inherit;opacity:.7"' if dark_first else ''}>実効的なポケモン数</div><div class="big">{C['q1']}</div><div class="note" {'style="color:inherit;opacity:.7"' if dark_first else ''}>前月 {C['q1d']} · 多いほど多様</div></div>
<div class="card {cls}"><div class="k">前月からの入れ替わり</div><div class="big">{C['turn']}</div><div class="note">落ち着いた月</div></div>
<div class="card {cls}" style="position:relative;overflow:hidden"><img src="{g.sprite(g.top6[0], 'home')}" width="120" height="120" style="position:absolute;right:-22px;bottom:-30px;opacity:.9"><div class="k">使用率 1位</div><div class="big" style="font-size:36px;margin-top:6px;position:relative">{C['top']}</div><div class="note">{C['topv']}<span class="chip">▲6.9</span></div></div>
<div class="card {cls}"><div class="k">集計した対戦数</div><div class="big">{C['battles']}</div><div class="note">Smogon 月次統計</div></div>"""


def page(title, body, width=g.W, dark=False, extra_css=""):
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>{title}</title>
<link href="https://fonts.googleapis.com/css2?{FONTS}&display=swap" rel="stylesheet">
<style>*{{box-sizing:border-box;margin:0}}body{{width:{width}px}}{BASE}{extra_css}</style></head>
<body class="{'dark' if dark else ''}">{body}</body></html>"""


# ── A1: そのままダーク ──────────────────────────────────────
def a1():
    t = DARK
    body = f"""<div style="padding:36px 48px 56px">{topbar('<div class="pill">☀</div>')}
<div class="k">2026年8月 · Showdown · レート1630以上</div>
<h1 style="font-size:80px;line-height:.98;letter-spacing:-.04em;font-weight:900;margin:8px 0 12px">いまの環境、<br>ひと目で。</h1>
<p style="color:var(--sub);font-size:17px;max-width:640px;line-height:1.7">ポケモンチャンピオンズの使用率・並び・選出率を、Smogon の月次統計と公開リプレイから毎日更新。</p>
<div class="grid" style="margin-top:28px">{stat_tiles(dark_first=False)}
<div class="card c8"><h2>使用率の推移 <span class="chip">上位6匹</span></h2>{g.line_chart(t, icons=True)}</div>
<div class="card c4"><h2>先月から伸びた・落ちた</h2>{g.movers_chart(t, w=380, icons=True)}</div>
<div class="card c5"><h2>いまの並び（コア）</h2>{cores_html()}</div>
<div class="card c7"><h2>選出率 × 使用率 <span class="chip warn">参考値</span></h2>{g.scatter(t, icons=True)}</div></div></div>"""
    return page("A1", body, dark=True)


# ── A2: ベントー＋総評（D の読み物を 1 枚足す） ─────────────────────
def a2():
    t = LIGHT
    css = """.lead h1{font-family:'Shippori Mincho B1',serif;font-size:62px;line-height:1.2;font-weight:800}
.lead h1 span{background:linear-gradient(transparent 62%,#d9ccff 62%)}.lead p{font-size:16px;line-height:2;color:var(--sub);margin-top:14px;max-width:62%;position:relative}"""
    body = f"""<div style="padding:36px 48px 56px">{topbar('<div class="pill">◐</div>')}
<div class="grid">
<div class="card c8 lead" style="padding:36px 40px;position:relative;overflow:hidden"><img src="{g.sprite(g.top6[0], 'home')}" width="330" height="330" style="position:absolute;right:-10px;top:-20px;filter:drop-shadow(0 20px 30px rgba(60,40,140,.25))"><div class="k">今月の総評 · 2026年8月号</div>
<h1 style="margin-top:10px"><span>{C['top']}</span>が<br>頂に戻った月</h1>
<p>M-B に入って二か月。環境の入れ替わりは {C['turn']} と小さく、上位の顔ぶれは固まりつつある。
一方で上位帯ほどドドゲザンやリザードンを選ぶ傾向が強く、オオニューラとムクホークが大きく伸びた。</p></div>
<div class="c4" style="display:grid;gap:18px">
<div class="card" style="background:var(--ink);color:var(--bg)"><div class="k" style="color:inherit;opacity:.7">実効的なポケモン数</div><div class="big">{C['q1']}</div><div class="note" style="color:inherit;opacity:.7">前月 {C['q1d']}</div></div>
<div class="card"><div class="k">前月からの入れ替わり</div><div class="big">{C['turn']}</div></div></div>
<div class="card c8"><h2>使用率の推移 <span class="chip">上位6匹</span></h2>{g.line_chart(t, icons=True)}</div>
<div class="card c4"><h2>先月から伸びた・落ちた</h2>{g.movers_chart(t, w=380, icons=True)}</div>
<div class="card c5"><h2>いまの並び（コア）</h2>{cores_html()}<h2 style="margin-top:18px">上位ほど使われる <span class="chip">1760 − 全体</span></h2>{g.gap_list(t)}</div>
<div class="card c7"><h2>選出率 × 使用率 <span class="chip warn">参考値</span></h2>{g.scatter(t, icons=True)}</div></div></div>"""
    css += ".gap{list-style:none;padding:0}.gap li{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}.gap b{color:var(--accent)}"
    return page("A2", body, extra_css=css).replace(FONTS, FONTS + "&family=Shippori+Mincho+B1:wght@800")


# ── A3: ランキング主役（一覧 → 1 匹を深掘り） ──────────────────────
def a3():
    t = LIGHT
    k = "Kingambit"
    body = f"""<div style="padding:36px 48px 56px">{topbar('<div class="pill">◐</div>')}
<div style="display:flex;align-items:end;justify-content:space-between;margin-bottom:22px">
<div><div class="k">2026年8月 · レート1630以上</div><h1 style="font-family:'Inter Tight','Zen Kaku Gothic New';font-size:64px;font-weight:900;letter-spacing:-.04em">使用率ランキング</h1></div>
<div style="display:flex;gap:8px"><div class="pill on">1630+</div><div class="pill">1760+</div><div class="pill">全体</div></div></div>
<div class="grid">
<div class="card c7" style="padding:18px 24px">{ranking_rows(t)}</div>
<div class="c5" style="display:grid;gap:18px;align-content:start">
<div class="card" style="background:var(--ink);color:var(--bg);position:relative;overflow:hidden"><img src="{g.sprite(k, 'home')}" width="190" height="190" style="position:absolute;right:-6px;top:-18px"><div class="k" style="color:inherit;opacity:.7">選んだポケモン</div>
<div style="font-size:40px;font-weight:900;margin:6px 0 2px">{g.short(k)}</div><div class="note" style="color:inherit;opacity:.7">1位 · {C['topv']} · 上位帯ほど多い（+20pt）</div></div>
<div class="card"><h2>持ち物</h2>{set_bars(k, 'items', 'items')}</div>
<div class="card"><h2>技</h2>{set_bars(k, 'moves', 'moves', 6)}</div></div>
<div class="card c4"><div class="k">実効的なポケモン数</div><div class="big">{C['q1']}</div><div class="note">前月 {C['q1d']}</div></div>
<div class="card c4"><div class="k">入れ替わり</div><div class="big">{C['turn']}</div></div>
<div class="card c4"><h2>メガシンカの内訳</h2>{mega_bars(3)}</div></div></div>"""
    return page("A3", body)


# ── A4: ダッシュボード（左の操作盤＋密なベントー） ───────────────────
def a4():
    t = LIGHT
    css = """.wrap{display:grid;grid-template-columns:250px 1fr;gap:24px;padding:24px 32px 48px 24px}.side{position:relative;align-self:start;min-height:760px}.side .it{padding:10px 14px;border-radius:14px;font-size:14px;margin:2px 0}
.side .it.on{background:var(--ink);color:var(--bg)}.seg{display:flex;background:var(--accent-soft);border-radius:12px;padding:3px;margin:8px 0 18px}
.seg span{flex:1;text-align:center;padding:6px 0;font-size:13px;border-radius:9px}.seg .on{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);font-weight:700}
.big{font-size:46px}"""
    months = "".join(f'<span class="{"on" if m == "8月" else ""}">{m}</span>' for m in g.mlabel)
    body = f"""<div class="wrap"><div class="card side"><div style="font-weight:900;margin-bottom:18px">Champions Meta</div>
<div class="k">ルール</div><div class="it on">VGC M-B</div><div class="it">VGC M-B Bo3</div><div class="it">シングル OU</div><div class="it">BSS M-B</div><div class="it">UU</div>
<div class="k" style="margin-top:18px">レート</div><div class="seg"><span>全体</span><span>1500</span><span class="on">1630</span><span>1760</span></div>
<div class="k">月</div><div class="seg">{months}</div>
<div class="k">表示</div><div class="seg"><span class="on">姿ごと</span><span>まとめる</span></div>
<div class="note" style="position:absolute;bottom:22px">出典: Smogon / Showdown / PokeAPI</div></div>
<div class="main"><div class="grid">{stat_tiles('c3', dark_first=True)}
<div class="card c8"><h2>使用率の推移</h2>{g.line_chart(t, w=760, h=280, icons=True)}</div>
<div class="card c4"><h2>伸びた・落ちた</h2>{g.movers_chart(t, w=360, row=26, icons=True)}</div>
<div class="card c4"><h2>いまの並び</h2>{cores_html()}</div>
<div class="card c4"><h2>メガシンカの内訳</h2>{mega_bars(4)}</div>
<div class="card c4"><h2>上位ほど使われる</h2>{g.gap_list(t)}</div>
<div class="card c12"><h2>選出率 × 使用率 <span class="chip warn">参考値</span></h2>{g.scatter(t, w=1040, h=280, icons=True)}</div></div></div></div>"""
    css += ".gap{list-style:none;padding:0}.gap li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.gap b{color:var(--accent)}"
    return page("A4", body, extra_css=css)


# ── A5: スマホ（390px。A2 の中身を縦に積む） ────────────────────────
def a5():
    t = LIGHT
    css = """.m{padding:18px 16px 8px}.m .card{padding:18px;border-radius:22px;margin-bottom:14px}.big{font-size:40px}
.tabs{display:flex;gap:6px;overflow:hidden;margin:12px 0 16px}.tabs .pill{white-space:nowrap;font-size:12px;padding:7px 12px}
.bottom{margin:0 12px 16px;display:flex;justify-content:space-around;padding:12px;border-radius:22px;background:rgba(255,255,255,.8);backdrop-filter:blur(16px);border:1px solid #fff;box-shadow:0 10px 30px rgba(60,40,140,.15);font-size:11px}
.bottom b{display:block;font-size:18px;text-align:center}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.lead h1{font-family:'Shippori Mincho B1',serif;font-size:32px;line-height:1.3}.lead h1 span{background:linear-gradient(transparent 62%,#d9ccff 62%)}"""
    body = f"""<div class="m"><div style="font-weight:900;font-size:14px">Champions Meta</div>
<div class="tabs"><div class="pill on">VGC M-B</div><div class="pill">Bo3</div><div class="pill">シングル</div><div class="pill">BSS</div></div>
<div class="card lead" style="position:relative;overflow:hidden"><img src="{g.sprite(g.top6[0], 'home')}" width="140" height="140" style="position:absolute;right:-14px;top:-8px"><div class="k">今月の総評 · 8月号</div><h1 style="margin-top:6px"><span>{C['top']}</span>が<br>頂に戻った月</h1>
<p style="font-size:14px;line-height:1.9;color:var(--sub);margin-top:8px;max-width:70%">入れ替わりは {C['turn']} と小さく、上位の顔ぶれは固まりつつある。</p></div>
<div class="two"><div class="card" style="background:var(--ink);color:var(--bg)"><div class="k" style="color:inherit;opacity:.7">実効ポケモン数</div><div class="big">{C['q1']}</div></div>
<div class="card"><div class="k">入れ替わり</div><div class="big">{C['turn']}</div></div></div>
<div class="card"><h2>使用率の推移</h2>{g.line_chart(t, w=520, h=300, icons=True)}</div>
<div class="card"><h2>伸びた・落ちた</h2>{g.movers_chart(t, w=360, row=28, icons=True)}</div>
<div class="card"><h2>いまの並び</h2>{cores_html(2)}</div></div>
<div class="bottom"><span><b>◎</b>環境</span><span><b>≡</b>ランキング</span><span><b>⌘</b>並び</span><span><b>?</b>読み方</span></div>"""
    return page("A5", body, width=390, extra_css=css).replace(FONTS, FONTS + "&family=Shippori+Mincho+B1:wght@800")


VARIANTS = [
    ("A1", "ダーク", ["A をそのまま夜の色に。hub のテーマ切り替えと連動", "紫は明るめ・ライムは差し色。グラフは同じ部品"], a1, g.W),
    ("A2", "ベントー＋総評", ["見出しを「今月の総評」の読み物カードに（D の良さ）", "毎月の一文が検索・AI 検索にも効く"], a2, g.W),
    ("A3", "ランキング主役", ["入口を使用率ランキングにし、1匹を選ぶと型を深掘り", "持ち物・技・メガの内訳まで見られる"], a3, g.W),
    ("A4", "ダッシュボード", ["左に操作盤（ルール・レート・月・まとめ方）", "カードを小さく密に。調べ物向け"], a4, g.W),
    ("A5", "スマホ", ["A2 を 390px に縦積み。下に固定のタブ", "hub の利用はスマホが多い前提"], a5, 390),
]


def main():
    shots = []
    for key, _n, _d, fn, width in VARIANTS:
        html = HERE / f"{key}.html"
        html.write_text(fn(), "utf-8")
        png = HERE / f"{key}.png"
        g.W = width  # shoot() は g.W の幅で撮る
        g.shoot(html, png, height=2400 if width < 600 else 2000)
        shots.append(png)
    g.W = 1440

    col_w, mob_w, gap, head = 640, 300, 36, 170
    ims = [Image.open(p) for p in shots]
    widths = [mob_w if VARIANTS[i][4] < 600 else col_w for i in range(len(ims))]
    scaled = [im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) for im, w in zip(ims, widths)]
    W = gap + sum(w + gap for w in widths)
    H = head + 150 + max(s.height for s in scaled) + 40
    canvas = Image.new("RGB", (W, H), "#e9e9ee")
    d = ImageDraw.Draw(canvas)
    fb = lambda s: ImageFont.truetype(r"C:\Windows\Fonts\YuGothB.ttc", s)
    fm = lambda s: ImageFont.truetype(r"C:\Windows\Fonts\YuGothM.ttc", s)
    d.text((gap, 40), "A 案（ガラスのベントー）の派生 5 案 — PokeAPI のアイコン入り", fill="#111", font=fb(40))
    d.text((gap, 98), "実データ: VGC M-B / 2026年8月。一覧はドット絵（約1.4KB）、大きく見せる所だけ HOME の立体画像。骨組みは前回と同じ。", fill="#555", font=fm(22))
    x = gap
    for (key, name, desc, _fn, _w), s, w in zip(VARIANTS, scaled, widths):
        d.text((x, head), f"{key}. {name}", fill="#111", font=fb(30))
        wrap = 13 if w < 400 else 30
        lines = [ln[i:i + wrap] for ln in desc for i in range(0, len(ln), wrap)]
        for j, line in enumerate(lines[:4]):
            d.text((x, head + 44 + j * 24), line, fill="#555", font=fm(17))
        canvas.paste(s, (x, head + 150))
        d.rectangle((x - 1, head + 149, x + w, head + 150 + s.height), outline="#c9c9d2")
        x += w + gap
    canvas.save(HERE / "compare_a.png", optimize=True)
    print("wrote", HERE / "compare_a.png", canvas.size)


if __name__ == "__main__":
    main()

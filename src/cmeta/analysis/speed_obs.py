"""手番の順番から、すばやさを推し量る（Foul Play の考え方を、たくさんの試合に広げたもの）。

1 つの観測 = 同じターンに同じ優先度の技を使った 2 匹のうち、どちらが先に動いたか。
すばやさ以外で順番が決まりうる場面は使わない:
  トリックルーム・おいかぜ・まひ・すばやさのランク変化・せんせいのツメなど・そのターン中にすばやさが変わった
  （ランク変化・状態・メガシンカ以外の出来事の後）、変化技（いたずらごころ）・回復と吸収の技（ヒーリングシフト）・
  ひこう技（はやてのつばさ）、行動順を変える技（さきおくり・おさきにどうぞ・さいはい）が出たターン、
  天候・フィールドですばやさが上がる特性を持ちうるポケモンがその天候・フィールドにいるとき、かるわざ・はやあしの可能性があるとき。
メガシンカした後は、メガの姿の分布を使う（メガシンカしたターンから、メガの値で動く）。
こだわりスカーフ: その試合で持ち物が分かっていればそれで決め、分からなければ月次の割合で混ぜる。

予想: P(A が先) = Σ P(A の実数値 = a) P(B の実数値 = b) [a > b] + 1/2 [a = b]（スカーフで 1.5 倍を混ぜる）。
"""

import math
from collections import defaultdict

from .speed import modify

ORDER_MOVES = {"afteryou", "quash", "instruct", "allyswitch", "trickroom"}
WEATHER_ABIL = {"swiftswim": {"raindance", "primordialsea"}, "chlorophyll": {"sunnyday", "desolateland"},
                "sandrush": {"sandstorm"}, "slushrush": {"snowscape", "snow", "hail"}}
TERRAIN_ABIL = {"surgesurfer": "electricterrain"}


def _eff(e: dict, scarf: float) -> list[tuple[int, float]]:
    """分布にスカーフを混ぜたもの。"""
    out = defaultdict(float)
    for v, s in e["dist"]:
        out[v] += s * (1 - scarf)
        if scarf:
            out[modify(v, 3, 2)] += s * scarf
    return sorted(out.items())


def p_first(da, db) -> float:
    """分布 da の側が、分布 db の側より先に動く確率。"""
    tot = 0.0
    for a, pa in da:
        for b, pb in db:
            tot += pa * pb * (1.0 if a > b else 0.5 if a == b else 0.0)
    return tot


def observations(rows: list[dict], group_of, sd, speed: dict) -> list[dict]:
    """rows: order のある試合。speed: out/speed/<fmt>.json。"""
    S = speed["pokemon"]
    by_group = defaultdict(list)
    for name, e in S.items():
        by_group[e["group"]].append(name)
    info = sd.move_info
    out = []
    for r in rows:
        if "order" not in r or r.get("bot"):
            continue
        teams = r["teams"]
        # その試合で分かっている持ち物（本人のものと分かったもの）
        items = [{k: v.get("i") for k, v in r["revealed"][s].items()} for s in (0, 1)]
        megas = [set(r["megas"][s]) for s in (0, 1)]
        state = {}  # (側, 番) -> {"b": ランク, "st": 状態, "form": 姿, "lost": 持ち物をなくした}
        tr = False
        tw = [False, False]
        weather = None
        terrain = None
        turn_moves = []
        dirty = False
        turn_skip = False

        def form_of(s, i):
            st = state.setdefault((s, i), {"b": 0, "st": None, "form": None, "lost": False})
            if st["form"]:
                return st["form"]
            base = teams[s][i]
            return base if base in S else None

        def flush():
            if turn_skip:
                return
            for x in range(len(turn_moves)):
                for y in range(x + 1, len(turn_moves)):
                    a, b = turn_moves[x], turn_moves[y]
                    if a["dirty_before"] or b["dirty_before"]:
                        continue
                    if (a["s"], a["i"]) == (b["s"], b["i"]) or a["prio"] != b["prio"]:
                        continue
                    out.append({"t": r["t"], "id": r["id"], "a": a["form"], "b": b["form"], "sa": a["s"], "sb": b["s"],
                                "ia": f'{r["id"]}:{a["s"]}:{a["i"]}:{a["form"]}', "ib": f'{r["id"]}:{b["s"]}:{b["i"]}:{b["form"]}',
                                "scarf_a": a["scarf"], "scarf_b": b["scarf"], "prio": a["prio"],
                                "winner": r.get("winner")})

        for ev in r["order"]:
            k = ev[0]
            if k == "T":
                flush()
                turn_moves, dirty, turn_skip = [], False, False
            elif k == "s":
                state[(ev[1], ev[2])] = {"b": 0, "st": (state.get((ev[1], ev[2])) or {}).get("st"), "form":
                                         (state.get((ev[1], ev[2])) or {}).get("form"),
                                         "lost": (state.get((ev[1], ev[2])) or {}).get("lost", False)}
                if turn_moves:
                    dirty = True  # 技で交代した後に出てきたポケモンは、このターンの比べる相手にしない
            elif k == "M":
                s, i = ev[1], ev[2]
                g = group_of(teams[s][i])
                mf = [m for m in megas[s] if group_of(m) == g]
                st = state.setdefault((s, i), {"b": 0, "st": None, "form": None, "lost": False})
                st["form"] = mf[0] if mf and mf[0] in S else None
                if not st["form"]:
                    st["form"] = "?"  # メガの姿の分布が無い
            elif k == "TR":
                tr = bool(ev[1])
                if turn_moves:
                    dirty = True
            elif k == "TW":
                tw[ev[1]] = bool(ev[2])
                if turn_moves:
                    dirty = True
            elif k == "W":
                weather = ev[1] if ev[1] != "none" else None
                if turn_moves:
                    dirty = True
            elif k == "F":
                if ev[1].endswith("terrain"):
                    terrain = ev[1] if ev[2] else None
                    if turn_moves:
                        dirty = True
            elif k == "b":
                state.setdefault((ev[1], ev[2]), {"b": 0, "st": None, "form": None, "lost": False})["b"] += ev[3]
                dirty = True
            elif k == "cb":
                if ev[1] == -1:
                    for st in state.values():
                        st["b"] = 0
                else:
                    state.setdefault((ev[1], ev[2]), {"b": 0, "st": None, "form": None, "lost": False})["b"] = 0
                dirty = True
            elif k == "st":
                state.setdefault((ev[1], ev[2]), {"b": 0, "st": None, "form": None, "lost": False})["st"] = ev[3]
                dirty = True
            elif k == "cs":
                state.setdefault((ev[1], ev[2]), {"b": 0, "st": None, "form": None, "lost": False})["st"] = None
            elif k == "i" and ev[4] == 1:
                state.setdefault((ev[1], ev[2]), {"b": 0, "st": None, "form": None, "lost": False})["lost"] = True
                dirty = True
            elif k == "q":
                turn_skip = True
            elif k == "m":
                s, i, mv, f = ev[1], ev[2], ev[3], ev[4]
                if mv in ORDER_MOVES:
                    turn_skip = True
                if f:
                    dirty = True
                    continue
                m = info.get(mv) or {}
                form = form_of(s, i)
                st = state.get((s, i)) or {"b": 0, "st": None, "lost": False}
                ok = (form not in (None, "?") and not tr and not tw[0] and not tw[1] and st["b"] == 0
                      and st["st"] != "par" and m.get("category") not in (None, "Status") and not m.get("heal")
                      and m.get("type") != "Flying")
                if ok:
                    e = S[form]
                    ab = e.get("abilities", {})
                    if any(weather in ws for a, ws in WEATHER_ABIL.items() if ab.get(a)) or \
                            any(terrain == t for a, t in TERRAIN_ABIL.items() if ab.get(a)) or \
                            (ab.get("unburden") and st.get("lost")) or (ab.get("quickfeet") and st.get("st")) or \
                            ab.get("speedboost"):
                        ok = False
                if ok:
                    base = teams[s][i]
                    item = items[s].get(base)
                    scarf = 1.0 if item == "choicescarf" else 0.0 if item else S[form].get("scarf", 0.0)
                    if st.get("lost"):
                        scarf = 0.0
                    turn_moves.append({"s": s, "i": i, "form": form, "prio": m.get("priority", 0), "scarf": scarf,
                                       "dirty_before": dirty})
                else:
                    dirty = dirty or bool(f)
        flush()
    return out


def calibrate(obs: list[dict], speed: dict, bins: int = 10) -> dict:
    """月次の分布から予想した「先に動く確率」と、実際に先に動いた割合。"""
    S = speed["pokemon"]
    cal = defaultdict(lambda: [0.0, 0, 0])
    ll = ll0 = 0.0
    n = 0
    for o in obs:
        p = p_first(_eff(S[o["a"]], o["scarf_a"]), _eff(S[o["b"]], o["scarf_b"]))
        # 観測は「a が先」。確率 p で起きることを予想していた
        c = cal[min(int(p * bins), bins - 1)]
        c[0] += p
        c[1] += 1
        c[2] += 1  # a が先だったので当たり
        ll += math.log(max(p, 1e-6))
        ll0 += math.log(0.5)
        n += 1
    # 対称にするため、逆向き（b が先になる確率 1−p で、起きなかった）も同じ表に入れる
    for o in obs:
        p = 1 - p_first(_eff(S[o["a"]], o["scarf_a"]), _eff(S[o["b"]], o["scarf_b"]))
        c = cal[min(int(p * bins), bins - 1)]
        c[0] += p
        c[1] += 1
    return {"n": n, "loglik": ll / n if n else None, "loglik_coin": ll0 / n if n else None,
            "calibration": [[round(c[0] / c[1], 3), round(c[2] / c[1], 3), c[1]] for _, c in sorted(cal.items())]}


def posterior(obs: list[dict], speed: dict, prior_strength: float = 20.0, rounds: int = 5, min_ind: int = 1) -> dict:
    """月次の分布を事前の分布にして、観測（手番）で更新したポケモンごとの実数値の分布（EM。相手の分布は前の回の値で固定）。

    同じ試合の同じ個体の観測はまとめて 1 個体として数える（同じ個体が何ターンも動くので、別々に数えると重く見すぎる）。
    prior_strength: 事前の分布を何個体ぶんとして扱うか。返り値: {姿: {"dist": [[v, p]], "n": 個体数}}。
    """
    S = speed["pokemon"]
    cur = {k: {v: p for v, p in e["dist"]} for k, e in S.items()}
    ind = defaultdict(list)  # 個体 -> [(相手の姿, 自分が先か, 自分のスカーフ, 相手のスカーフ)]
    form_of = {}
    for o in obs:
        ind[o["ia"]].append((o["b"], True, o["scarf_a"], o["scarf_b"]))
        ind[o["ib"]].append((o["a"], False, o["scarf_b"], o["scarf_a"]))
        form_of[o["ia"]], form_of[o["ib"]] = o["a"], o["b"]
    by_form = defaultdict(list)
    for i, f in form_of.items():
        by_form[f].append(i)
    for _ in range(rounds):
        opp_cache = {}
        new = {}
        for f, inds in by_form.items():
            if len(inds) < min_ind:
                continue
            prior = {v: p for v, p in S[f]["dist"]}
            acc = {v: prior_strength * p for v, p in prior.items()}
            for i in inds:
                like = {}
                for v in prior:
                    lk = 1.0
                    for g, first, sc_me, sc_op in ind[i]:
                        key = (g, sc_op)
                        if key not in opp_cache:
                            opp_cache[key] = _eff({"dist": sorted(cur[g].items())}, sc_op)
                        opp = opp_cache[key]
                        mine = [(v, 1 - sc_me)] + ([(modify(v, 3, 2), sc_me)] if sc_me else [])
                        p = sum(w * sum(q * (1.0 if m > x else 0.5 if m == x else 0.0) for x, q in opp) for m, w in mine)
                        lk *= p if first else 1 - p
                    like[v] = cur[f].get(v, 0.0) * lk
                z = sum(like.values())
                if z <= 0:
                    continue
                for v, x in like.items():
                    acc[v] += x / z
            tot = sum(acc.values())
            new[f] = {v: x / tot for v, x in acc.items()}
        cur.update(new)
    return {f: {"dist": [[v, round(p, 4)] for v, p in sorted(cur[f].items()) if p >= 0.0005], "n": len(inds)}
            for f, inds in by_form.items() if len(inds) >= min_ind}

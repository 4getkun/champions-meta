import math
import random
from datetime import date, timedelta

import numpy as np

from cmeta.analysis import changepoint, cores, matchup, weekly
from cmeta.analysis.stats import hill, jeffreys, morisita_horn, pmi_stats, shrink, spearman


def ident(x):
    return x


def test_jeffreys():
    lo, hi = jeffreys(50, 100)
    assert 0.39 < lo < 0.41 and 0.59 < hi < 0.61
    assert jeffreys(0, 10)[0] == 0.0 and jeffreys(10, 10)[1] == 1.0
    assert jeffreys(0, 0) == (0.0, 1.0)


def test_shrink():
    assert shrink(0, 0) == 0.5
    assert 0.5 < shrink(10, 10) < 1.0


def test_hill():
    p = [0.25] * 4
    for q in (0, 1, 2):
        assert math.isclose(hill(p, q), 4.0)
    assert hill([0.9, 0.1], 2) < hill([0.9, 0.1], 1) < hill([0.9, 0.1], 0)


def test_morisita_horn():
    a = {"x": 0.5, "y": 0.5}
    assert math.isclose(morisita_horn(a, a), 1.0)
    assert morisita_horn({"x": 1.0}, {"y": 1.0}) == 0.0


def test_pmi():
    lift, npmi = pmi_stats(0.25, 0.5, 0.5)
    assert math.isclose(lift, 1.0) and math.isclose(npmi, 0.0, abs_tol=1e-12)
    lift, npmi = pmi_stats(0.5, 0.5, 0.5)
    assert lift == 2.0 and math.isclose(npmi, 1.0)


def test_spearman():
    assert math.isclose(spearman([1, 2, 3], [10, 20, 30]), 1.0)
    assert math.isclose(spearman([1, 2, 3], [3, 2, 1]), -1.0)


def _row(t, p1, p2, t1, t2, b1, b2, win, bo3=True, rid=None):
    return {"id": rid or f"r{t}", "t": t, "players": [p1, p2], "teams": [t1, t2], "brought": [b1, b2],
            "leads": [b1[:2], b2[:2]], "megas": [[], []], "winner": win, "turns": 5, "bo3": bo3, "rating": None}


def test_series_grouping():
    A = ["a", "b", "c", "d", "e", "f"]
    B = ["g", "h", "i", "j", "k", "l"]
    t0 = 1_790_000_000
    rows = [
        _row(t0, "p", "q", A, B, A[:4], B[:4], 0),
        _row(t0 + 600, "q", "p", B, A, B[2:6], A[1:5], 0),  # 同じシリーズ（席が逆でも）
        _row(t0 + 1200, "p", "q", A, B, A[:4], B[:4], 1),
        _row(t0 + 5 * 3600, "p", "q", A, B, A[:4], B[:4], 0),  # 3 時間より後は別シリーズ
    ]
    series = weekly.build_series(rows, ident)
    assert len(series) == 2
    assert len(series[0]["games"]) == 3
    assert series[0]["sides"]["p"]["brought"] == set(A[:5])
    res = weekly.analyze(rows, ident, doubles=True, today=date.fromtimestamp(t0) + timedelta(days=1))
    assert res["available"]
    rec = res["recent"]
    assert rec["n_series"] == 2 and rec["n_teams"] == 4 and rec["n_games"] == 4
    assert rec["pokemon"]["a"]["usage"] == 0.5  # 4 つの見せ合いのうち 2 つ（p の 2 シリーズ）


def test_changepoint_detects_shift_and_stays_quiet():
    rng = random.Random(0)
    days = [date(2026, 5, 1) + timedelta(days=i) for i in range(120)]
    n = [100] * 120
    flat = [sum(rng.random() < 0.2 for _ in range(100)) for _ in range(120)]
    assert changepoint.detect(days, n, flat) == []
    shifted = [sum(rng.random() < (0.2 if i < 60 else 0.4) for _ in range(100)) for i in range(120)]
    alerts = changepoint.detect(days, n, shifted)
    assert len(alerts) >= 1
    assert abs((date.fromisoformat(alerts[0]["day"]) - days[60]).days) <= 5
    assert alerts[0]["after"] > alerts[0]["before"]


def test_nash_rock_paper_scissors():
    A = np.array([[0, -1, 1], [1, 0, -1], [-1, 1, 0]], dtype=float)
    x = matchup.nash_symmetric(A)
    assert np.allclose(x, [1 / 3] * 3, atol=1e-6)
    B = np.array([[0, 0.2, 0.2], [-0.2, 0, 0.1], [-0.2, -0.1, 0]])
    assert np.allclose(matchup.nash_symmetric(B), [1, 0, 0], atol=1e-6)


def test_matchup_month_cycle_and_gate():
    games = []
    for a, b in (("1", "2"), ("2", "3"), ("3", "1")):
        games += [(a, b, 1)] * 60 + [(a, b, 0)] * 20
    res = matchup.analyze_month(games)
    assert res["available"]
    assert len(res["cycles"]) == 1
    assert all(abs(v - 1 / 3) < 1e-3 for v in res["nash"].values())
    assert not matchup.analyze_month(games[:10])["available"]


def test_assign():
    cores_ = [{"id": 1, "members": frozenset("abc")}, {"id": 2, "members": frozenset("defgh")}]
    assert matchup.assign(frozenset("abxyz1"), cores_) == "1"
    assert matchup.assign(frozenset("axyz12"), cores_) == matchup.OTHER


def test_cores_graph():
    # a と b はいつも一緒、c は独立
    md = {"total_weight": 1000.0, "pokemon": {
        "a": {"usage": 0.3, "weight": 300.0, "teammates": {"b": 290.0, "c": 30.0}},
        "b": {"usage": 0.3, "weight": 300.0, "teammates": {"a": 290.0, "c": 30.0}},
        "c": {"usage": 0.1, "weight": 100.0, "teammates": {"a": 30.0, "b": 30.0}},
    }}
    g = cores.build_graph(md)
    assert g.has_edge("a", "b") and not g.has_edge("a", "c")
    res = cores.analyze({"2026-04": md, "2026-05": md})
    c4, c5 = res["months"]["2026-04"]["cores"], res["months"]["2026-05"]["cores"]
    assert c4[0]["members"] == ["a", "b"] and c5[0]["id"] == c4[0]["id"] and c5[0]["continued"]


class _FakeDex:
    def types(self, k):
        return {"a": ["Fire"], "u": ["Grass"]}.get(k, ["Normal"])

    def effectiveness(self, atk, defs):
        return 2.0 if (atk, tuple(defs)) == ("Fire", ("Grass",)) else 1.0

    def species(self, k):
        return None


def _joint_samples(n=100):
    team = ["a", "b", "c", "d", "e", "f"]
    opp = ["u", "v", "w", "x", "y", "z"]
    # a と b はいつも選出・先発、f は一度も選出しない
    return [{"t": i, "team": team, "opp": opp, "brought": {"a", "b", "c" if i % 2 else "d", "e"},
             "leads": {"a", "b"}, "megas": set()} for i in range(n)]


def test_joint_probabilities_and_marginals():
    from cmeta.analysis import joint

    xs = _joint_samples()
    feat = joint._featurizer(xs, {"a": {"stone": 1.0}, "c": {"stone": 1.0}}, _FakeDex(), 4)
    opts = joint.options(xs[0]["team"], 4, 2)
    assert len(opts) == 15 * 6
    X = feat.matrix(xs[0]["team"], xs[0]["opp"], opts)
    p = joint.probs(X, joint.baseline_w())
    assert math.isclose(p.sum(), 1.0, abs_tol=1e-9)
    bring, lead = joint.marginals(p, opts, xs[0]["team"])
    assert math.isclose(sum(bring.values()), 4.0, abs_tol=1e-9) and math.isclose(sum(lead.values()), 2.0, abs_tol=1e-9)
    assert bring["a"] > bring["c"] > bring["f"]
    assert set(sorted(lead, key=lambda k: -lead[k])[:2]) == {"a", "b"}
    # メガ要員 2 匹（a と c）を同時に選ぶ組だけ stone_pair が 1
    i = joint.FEATURES.index(("stone_pair", "メガ"))
    assert {tuple(sorted(s)) for (s, _), row in zip(opts, X) if row[i] == 1.0} ==         {tuple(sorted(s)) for s, _ in opts if {"a", "c"} <= s}
    # a（ほのお）は相手の u（くさ）に抜群を取れる
    assert feat.per_member("a", xs[0]["team"], xs[0]["opp"])["hit"] == 1 / 6


def test_joint_evaluate_and_average_opponent():
    from cmeta.analysis import joint

    xs = _joint_samples()
    feat = joint._featurizer(xs, {}, _FakeDex(), 4)
    data = joint._dataset(xs[:20], feat, 4, 2)
    ev = joint.evaluate(data, joint.baseline_w(), 4, 2)
    assert ev["n"] == 20 and ev["lead_top"] == 1.0 and 0 <= ev["back_top"] <= 1
    assert ev["bring_top"] >= 0.75  # a・b・e は必ず当たる
    avg = joint.avg_opponent(xs)
    assert math.isclose(sum(w for _, w in avg), 6.0) and {k for k, _ in avg} == set(xs[0]["opp"])
    # 平均的な相手でも、名前の相手と同じ形で計算できる
    assert feat.matrix(xs[0]["team"], avg, joint.options(xs[0]["team"], 4, 2)).shape == (90, len(joint.FEATURES))


def test_split_holdout_extends_to_min_test():
    from cmeta.analysis import joint

    xs = [{"t": i * 86400} for i in range(1000)]  # 1 日 1 件
    train, test, _ = joint.split_holdout(xs)
    assert len(test) == joint.MIN_TEST and len(train) + len(test) == 1000
    train, test, _ = joint.split_holdout(xs[:500])
    assert len(test) == 200  # 4 割まで


def test_speed_stat_and_scarf_lines():
    from cmeta.analysis import speed
    from cmeta.smogon import speed_points

    # ガブリアス（種族値 102）: 最速 169・準速 154・無振り 122・最遅 109（Showdown: trunc(122 × 90 / 100)）
    assert [speed.stat(102, 32, "+"), speed.stat(102, 32, "="), speed.stat(102, 0, "="), speed.stat(102, 0, "-")] == \
        [169, 154, 122, 109]
    # スカーフ（Showdown の丸め）: イダイトウ ようき 143→214・いじっぱり 130→195、ガブリアス 169→253
    assert [speed.modify(143, 3, 2), speed.modify(130, 3, 2), speed.modify(169, 3, 2)] == [214, 195, 253]
    pts = speed_points({"Jolly:2/32/0/0/0/32": 3.0, "Adamant:2/32/0/0/0/32": 1.0, "Quiet:0/0/0/32/2/0": 1.0}, 5.0)
    assert pts == {"+32": 0.6, "-0": 0.2, "=32": 0.2}
    dist = [[100, 0.5], [110, 0.5]]
    assert speed.p_faster(110, dist) == 0.75 and speed.p_faster(100, dist) == 0.25 and speed.p_faster(111, dist) == 1.0


def test_toprate_pools_and_flags_differences():
    from cmeta.analysis import toprate

    xs = []
    team = ["a", "b", "c", "d", "e", "f"]
    for i in range(1200):
        top = i % 2 == 0
        # 上位の人（300 人が 2 回ずつ）は a を 9 割選び、ほかの人は 1 割
        pick_a = (i // 2) % 10 != 0 if top else (i // 2) % 10 == 0
        brought = {"a" if pick_a else "e", "c", "d"}
        xs.append({"t": i, "team": team, "opp": [], "brought": brought, "leads": {"c"},
                   "megas": set(), "player": f"p{(i // 2) % 300}" if top else f"q{i}"})
    top_players = {f"p{j}": 1700.0 for j in range(300)}
    res = toprate.build(xs, top_players, 3, 1)
    a = res["pokemon"]["a"]["bring"]
    assert a["est"] > 0.8 and a["other"] < 0.2 and a["clear"] and a["players"] == 300
    assert 0 <= res["icc_bring"] <= 1 and 0 <= res["coverage_bring"] <= 1


def test_toprate_icc_discounts_one_player():
    from cmeta.analysis import toprate

    # 1 人が同じ選び方を 100 回: 同じ人の似かたが大きく、差は「はっきり」にならない
    team = ["a", "b", "c", "d", "e", "f"]
    xs = [{"t": i, "team": team, "opp": [], "brought": {"a", "c", "d"}, "leads": {"c"}, "megas": set(), "player": "p0"}
          for i in range(100)]
    xs += [{"t": 100 + i, "team": team, "opp": [], "brought": {"a", "c", "d"} if i % 10 == 0 else {"b", "c", "d"},
            "leads": {"c"}, "megas": set(), "player": f"q{i}"} for i in range(400)]  # ほかの人は a を 1 割
    xs += [{"t": 600 + i, "team": team, "opp": [], "brought": {"b", "c", "d"}, "leads": {"c"}, "megas": set(),
            "player": f"p{1 + i}"} for i in range(20)]
    res = toprate.build(xs, {f"p{j}": 1700.0 for j in range(30)}, 3, 1)
    assert not res["pokemon"]["a"]["bring"]["clear"]


def test_set_trends_lists_big_changes_only():
    from cmeta.analysis import sets

    def month(m, share_a, w=500.0):
        return {"pokemon": {"x": {"usage": 0.2, "weight": w, "items": {"a": share_a, "b": 1 - share_a},
                                  "moves": {"m": 0.5}}}}
    data = {("2026-07", "f", 0): month("2026-07", 0.5), ("2026-07", "f", 1630): month("2026-07", 0.6),
            ("2026-08", "f", 0): month("2026-08", 0.45), ("2026-08", "f", 1630): month("2026-08", 0.3),
            ("2026-08", "f", 1760): month("2026-08", 0.2, 150.0)}
    out = sets.build(data, "f", ["2026-07", "2026-08"], [0, 1630, 1760], 1630)
    kinds = {(c["type"], c["key"]) for c in out["changes"]}
    assert ("month", "a") in kinds and ("top", "a") in kinds  # 60% → 30%、45% → 20%
    assert all(c["key"] != "m" for c in out["changes"])  # 動いていない技は出ない


def test_induce_pairs_finds_consistent_reaction():
    from cmeta.analysis import toprate

    team = ["k", "b", "c", "d", "e", "f"]
    xs = []
    for i in range(600):
        has_u = i % 2 == 0
        # 上位の人（40 人）は、相手に u がいると k を必ず選び、いないと選ばない
        brought = {"k", "c", "d"} if has_u else {"b", "c", "d"}
        xs.append({"t": i, "team": team, "opp": ["u" if has_u else "z", "y"], "brought": brought, "leads": {"c"},
                   "megas": set(), "player": f"p{i % 40}"})
    res = toprate.induce_pairs(xs, {f"p{j}": 1700.0 for j in range(40)}, 3)
    assert any(r["opp"] == "u" and r["name"] == "k" and r["diff"] > 0.9 for r in res["clear"])


def test_temperature_shrinks_overconfident_weights():
    import numpy as np

    from cmeta.analysis import joint

    rng = np.random.default_rng(0)
    data = []
    for _ in range(300):
        X = rng.normal(size=(5, 1))
        z = X[:, 0] * 1.0
        p = np.exp(z) / np.exp(z).sum()
        data.append((X, int(rng.choice(5, p=p)), np.array([3.0])))  # 本当の強さは 1 なのに、重みは 3（強すぎる）
    t = joint.fit_temperature(data)
    assert 0.2 < t < 0.6


def test_track_roundtrip(tmp_path, monkeypatch):
    from cmeta.analysis import track

    monkeypatch.setattr(track, "PREDLOG", tmp_path)
    pub = {"available": True, "model": "joint", "k_bring": 3, "k_lead": 1, "features": ["base"], "weights": [1.0],
           "g_bring": 0.5, "g_lead": 0.2, "base": {}, "vs": {}, "cobring": {}, "roles": {}, "avg_opp": [],
           "trained": {"samples": 1, "from": 0, "to": 100}, "eval": {"big": 1}, "examples": [1]}
    track.save("f", pub, day="2026-09-01", seeded=True)
    snaps = track.load("f")
    assert len(snaps) == 1 and snaps[0]["seeded"] and "eval" not in snaps[0] and "examples" not in snaps[0]

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

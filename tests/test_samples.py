from cmeta.analysis.diag import sample_teams


def _row(t, p0, p1, a, b):
    return {"t": t, "players": [p0, p1], "teams": [a, b]}


def test_sample_teams_needs_three_players():
    A = ["A", "B", "C", "D", "E", "F"]
    B = ["G", "H", "I", "J", "K", "L"]
    rows = [_row(100, "p1", "q", A, B), _row(101, "p2", "q", A, B), _row(102, "p3", "q", A, B),
            _row(103, "p1", "q", A, B)]  # A は 3 人、B は 1 人（何度戦っても 1 人）
    got = sample_teams(rows, lambda x: x)
    assert [s["team"] for s in got] == [A]
    assert got[0]["players"] == 3 and got[0]["games"] == 4

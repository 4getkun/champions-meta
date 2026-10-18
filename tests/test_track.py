from cmeta.analysis import track


def _pub(trained_to=100):
    return {
        "available": True,
        "model": "joint",
        "k_bring": 1,
        "k_lead": 1,
        "features": ["base", "lead_base"],
        "weights": [1.0, 1.0],
        "g_bring": 0.5,
        "g_lead": 0.2,
        "base": {},
        "vs": {},
        "cobring": {},
        "roles": {},
        "avg_opp": [],
        "trained": {"samples": 1, "from": 0, "to": trained_to},
    }


def test_regular_save_uses_current_day_and_does_not_overwrite(tmp_path, monkeypatch):
    monkeypatch.setattr(track, "PREDLOG", tmp_path)
    monkeypatch.setattr(track.time, "time", lambda: 1_800_000_000)
    track.save("f", _pub(), day="2000-01-01")
    expected_day = track.datetime.fromtimestamp(1_800_000_000, track.JST).strftime("%Y-%m-%d")
    path = tmp_path / "f" / f"{expected_day}.json.gz"
    first = path.read_bytes()
    saved = track.load("f")[0]
    assert saved["day"] == expected_day
    assert saved["published_at"] == 1_800_000_000
    assert not saved["seeded"]

    monkeypatch.setattr(track.time, "time", lambda: 1_800_000_100)
    replacement = _pub(trained_to=999)
    track.save("f", replacement)
    assert path.read_bytes() == first


def _mock_evaluation(monkeypatch, snaps, rows):
    monkeypatch.setattr(track, "load", lambda _: snaps)
    monkeypatch.setattr(track, "samples", lambda *_: rows)
    monkeypatch.setattr(track, "dedupe", lambda xs: xs)
    monkeypatch.setattr(track, "_featurizer", lambda *_: type("F", (), {"matrix": lambda self, *_: [1.0]})())
    monkeypatch.setattr(track, "options", lambda *_: [({"p"}, {"l"})])
    monkeypatch.setattr(track, "probs", lambda *_: [1.0])
    monkeypatch.setattr(track, "marginals", lambda *_: ({"p": 1.0}, {"l": 1.0}))
    monkeypatch.setattr(track, "bootstrap_diff", lambda *_: (0.0, 0.0, 0.0))


def _rows(start, count=30):
    return [{"t": start + i, "team": [], "opp": [], "brought": {"p"}, "leads": {"l"}} for i in range(count)]


def test_legacy_regular_snapshot_without_publish_time_is_excluded(monkeypatch):
    legacy = _pub()
    legacy.update({"day": "2026-01-01", "seeded": False})
    _mock_evaluation(monkeypatch, [legacy], _rows(101))
    result = track.evaluate("f", [], lambda *_: None, None)
    assert not result["available"]


def test_regular_snapshot_does_not_apply_before_publish_time(monkeypatch):
    snap = _pub()
    snap.update({"day": "2026-01-01", "seeded": False, "published_at": 200})
    _mock_evaluation(monkeypatch, [snap], _rows(150))
    result = track.evaluate("f", [], lambda *_: None, None)
    assert not result["available"]


def test_regular_snapshot_applies_after_publish_time(monkeypatch):
    snap = _pub()
    snap.update({"day": "2026-01-01", "seeded": False, "published_at": 200})
    _mock_evaluation(monkeypatch, [snap], _rows(201))
    result = track.evaluate("f", [], lambda *_: None, None)
    assert result["available"] and result["n"] == 30
    assert result["seeded_until"] is None


def test_seed_cannot_replace_a_regular_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr(track, "PREDLOG", tmp_path)
    monkeypatch.setattr(track.time, "time", lambda: 1_800_000_000)
    track.save("f", _pub())
    saved = track.load("f")[0]
    path = tmp_path / "f" / f"{saved['day']}.json.gz"
    before = path.read_bytes()
    track.save("f", _pub(trained_to=999), day=saved["day"], seeded=True)
    assert path.read_bytes() == before


def test_seeded_snapshot_keeps_trained_to_start(monkeypatch):
    snap = _pub()
    snap.update({"day": "2026-01-01", "seeded": True})
    _mock_evaluation(monkeypatch, [snap], _rows(101))
    result = track.evaluate("f", [], lambda *_: None, None)
    assert result["available"] and result["n"] == 30
    assert result["seeded_until"] == "2026-01-01"

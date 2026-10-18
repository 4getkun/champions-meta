import json

from cmeta import smogon


def _cache(tmp_path, monkeypatch):
    monkeypatch.setattr(smogon, "CACHE", tmp_path / "cache")
    return tmp_path / "cache" / "smogon" / "index"


def test_sync_reuses_month_index_and_existing_file(tmp_path, monkeypatch):
    cache_dir = _cache(tmp_path, monkeypatch)
    monkeypatch.setattr(smogon, "SMOGON_DIR", tmp_path / "data" / "smogon")
    month = "2026-01"
    listings = []
    bodies = []
    monkeypatch.setattr(smogon, "list_files", lambda m: listings.append(m) or [("gen9ou", 1500)])
    monkeypatch.setattr(smogon.http, "cached_bytes", lambda url, path: bodies.append(url) or b"{}")
    monkeypatch.setattr(smogon, "condense", lambda *_args, **_kwargs: {"battles": 1, "pokemon": {}})

    assert smogon.sync([month], log=lambda _: None) == [f"{month}/gen9ou-1500"]
    assert smogon.sync([month], log=lambda _: None) == []
    assert listings == [month]
    assert len(bodies) == 1
    saved = json.loads((cache_dir / f"{month}.json").read_text("utf-8"))
    assert set(saved) == {"checked_at", "files"}
    assert saved["files"] == [["gen9ou", 1500]]


def test_nonempty_index_ttls_expire_for_latest_and_past_month(tmp_path, monkeypatch):
    cache_dir = _cache(tmp_path, monkeypatch)
    now = 2_000_000
    monkeypatch.setattr(smogon.time, "time", lambda: now)
    latest = smogon.last_complete_month()
    past = "2020-01"
    calls = []

    def refresh(month):
        calls.append(month)
        return [("gen9ou", 1500)]

    monkeypatch.setattr(smogon, "list_files", refresh)
    for month, ttl in ((latest, 6 * 3600), (past, 7 * 86400)):
        path = cache_dir / f"{month}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"checked_at": now - ttl + 1, "files": [["old", 1500]]}))
        assert smogon._cached_list_files(month) == [("old", 1500)]
        path.write_text(json.dumps({"checked_at": now - ttl, "files": [["old", 1500]]}))
        assert smogon._cached_list_files(month) == [("gen9ou", 1500)]
    assert calls == [latest, past]


def test_empty_index_rechecks_and_can_become_available(tmp_path, monkeypatch):
    cache_dir = _cache(tmp_path, monkeypatch)
    now = 2_000_000
    monkeypatch.setattr(smogon.time, "time", lambda: now)
    calls = []
    responses = [[], [("gen9ou", 1500)]]
    monkeypatch.setattr(smogon, "list_files", lambda month: calls.append(month) or responses.pop(0))
    month = "2026-01"

    assert smogon._cached_list_files(month) == []
    now += 29 * 60
    assert smogon._cached_list_files(month) == []
    assert calls == [month]
    now += 2 * 60
    assert smogon._cached_list_files(month) == [("gen9ou", 1500)]
    assert calls == [month, month]
    saved = json.loads((cache_dir / f"{month}.json").read_text("utf-8"))
    assert saved["files"] == [["gen9ou", 1500]]


def test_corrupt_and_future_dated_index_are_refetched(tmp_path, monkeypatch):
    cache_dir = _cache(tmp_path, monkeypatch)
    now = 2_000_000
    monkeypatch.setattr(smogon.time, "time", lambda: now)
    calls = []
    monkeypatch.setattr(smogon, "list_files", lambda month: calls.append(month) or [])
    month = "2026-01"
    path = cache_dir / f"{month}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("not json")
    assert smogon._cached_list_files(month) == []
    path.write_text(json.dumps({"checked_at": now + 1, "files": [["gen9ou", 1500]]}))
    assert smogon._cached_list_files(month) == []
    assert calls == [month, month]


def test_recondense_bypasses_cached_index(tmp_path, monkeypatch):
    cache_dir = _cache(tmp_path, monkeypatch)
    monkeypatch.setattr(smogon, "SMOGON_DIR", tmp_path / "data" / "smogon")
    month = "2026-01"
    path = cache_dir / f"{month}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"checked_at": int(smogon.time.time()), "files": [["old", 1500]]}))
    calls = []
    monkeypatch.setattr(smogon, "list_files", lambda _: calls.append(1) or [("gen9ou", 1500)])
    monkeypatch.setattr(smogon.http, "cached_bytes", lambda *_: b"{}")
    monkeypatch.setattr(smogon, "condense", lambda *_args, **_kwargs: {"battles": 1, "pokemon": {}})
    smogon.sync([month], log=lambda _: None)
    smogon.sync([month], log=lambda _: None, recondense=True)
    assert calls == [1]

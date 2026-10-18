import json

from cmeta import http, ladder, replays


def _row(i, ts):
    return {"id": f"r{i}", "uploadtime": ts, "rating": 1500, "players": ["p1", "p2"]}


def test_replay_crawl_page_limit_persists_cursor_and_pending(tmp_path, monkeypatch):
    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    monkeypatch.setattr(replays, "REPLAY_DIR", tmp_path / "replays")
    monkeypatch.setattr(replays, "REPLAY_LIST_MAX_PAGES", 1)
    monkeypatch.setattr(replays.time, "time", lambda: 1000)
    (tmp_path / "state.json").write_text(json.dumps({"fmt": {"last": 100}}))
    pages = [[_row(i, 200 - i) for i in range(51)], [_row(51 + i, 149 - i) for i in range(50)]]
    calls = []

    def get_json(url):
        calls.append(url)
        if "/search.json" not in url:
            return {"log": ""}
        if url.endswith("before=151"):
            return [_row(51, 150)] + [_row(52 + i, 149 - i) for i in range(49)]
        return pages.pop(0)

    monkeypatch.setattr(replays.http, "get_json", get_json)
    monkeypatch.setattr(replays, "parse_log", lambda _: {"parsed": True})
    assert replays.crawl("fmt", max_n=2, sample=False, log=lambda _: None) == 2
    state = json.loads((tmp_path / "state.json").read_text())
    assert sum("/search.json" in url for url in calls) == 1
    assert state["fmt"]["before"] == 151
    assert len(state["fmt"]["pending"]) == 48
    assert all(set(row) <= {"id", "uploadtime", "rating"} for row in state["fmt"]["pending"])
    assert len(list((tmp_path / "replays" / "fmt").glob("*.jsonl.gz"))) == 1
    assert replays.crawl("fmt", max_n=2, sample=False, log=lambda _: None) == 2
    assert sum("/search.json" in url for url in calls) == 1
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["fmt"]["before"] == 151
    assert len(state["fmt"]["pending"]) == 46
    assert replays.crawl("fmt", max_n=46, sample=False, log=lambda _: None) == 46
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["fmt"]["pending"] == []
    assert sum("/search.json" in url for url in calls) == 1
    assert replays.crawl("fmt", max_n=1, sample=False, log=lambda _: None) == 1
    assert sum("/search.json" in url for url in calls) == 2


def test_sample_each_bounded_interval_then_resumes(tmp_path, monkeypatch):
    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    monkeypatch.setattr(replays, "REPLAY_DIR", tmp_path / "replays")
    monkeypatch.setattr(replays, "REPLAY_LIST_MAX_PAGES", 1)
    monkeypatch.setattr(replays.time, "time", lambda: 1000)
    (tmp_path / "state.json").write_text(json.dumps({"fmt": {"last": 100}}))
    newer = [_row(i, 200 - i) for i in range(51)]
    older = [_row(100 + i, 100 - i) for i in range(50)]
    pages = [newer, older]

    def get_json(url):
        if "/search.json" not in url:
            return {"log": ""}
        return pages.pop(0)

    monkeypatch.setattr(replays.http, "get_json", get_json)
    fetched = []

    original_get_json = replays.http.get_json

    def get_record(url):
        if "/search.json" in url:
            return original_get_json(url)
        fetched.append(url)
        return {"log": ""}

    monkeypatch.setattr(replays.http, "get_json", get_record)
    monkeypatch.setattr(replays, "parse_log", lambda _: {"parsed": True})
    assert replays.crawl("fmt", max_n=2, sample=True, log=lambda _: None) == 2
    assert len(fetched) == 2
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["fmt"]["last"] == 100
    assert state["fmt"]["before"] == 151
    assert replays.crawl("fmt", max_n=2, sample=True, log=lambda _: None) == 0
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["fmt"]["last"] == 200


def test_list_failure_checkpoints_candidates_and_resumes_cursor(tmp_path, monkeypatch):
    import pytest

    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    monkeypatch.setattr(replays, "REPLAY_DIR", tmp_path / "replays")
    monkeypatch.setattr(replays, "REPLAY_LIST_MAX_PAGES", 2)
    monkeypatch.setattr(replays.time, "time", lambda: 1000)
    (tmp_path / "state.json").write_text(json.dumps({"fmt": {"last": 100}}))
    page = [_row(i, 200 - i) for i in range(51)]
    listing_calls = []
    detail_calls = []

    def get_json(url):
        if "/search.json" in url:
            listing_calls.append(url)
            if len(listing_calls) == 1:
                return page
            if len(listing_calls) == 2:
                raise ConnectionResetError("second page unavailable")
            return [_row(51 + i, 150 - i) for i in range(50)]
        detail_calls.append(url)
        return {"log": "ok"}

    monkeypatch.setattr(replays.http, "get_json", get_json)
    monkeypatch.setattr(replays, "parse_log", lambda _: {"parsed": True})
    with pytest.raises(ConnectionResetError):
        replays.crawl("fmt", max_n=50, sample=True, log=lambda _: None)

    state = json.loads((tmp_path / "state.json").read_text())["fmt"]
    assert state["before"] == 151
    assert state["done"] is False
    assert len(state["pending"]) == 50
    assert all(set(row) <= {"id", "uploadtime", "rating"} for row in state["pending"])

    assert replays.crawl("fmt", max_n=50, sample=True, log=lambda _: None) == 50
    assert len(listing_calls) == 2  # 1ページ目の再取得なし
    assert len(detail_calls) == 50
    state = json.loads((tmp_path / "state.json").read_text())["fmt"]
    assert state["before"] == 151
    assert state["pending"] == []

    assert replays.crawl("fmt", max_n=1, sample=True, log=lambda _: None) == 1
    assert len(listing_calls) == 3
    assert listing_calls[-1].endswith("before=151")


def test_duplicate_listing_ids_do_not_consume_sample_slots(tmp_path, monkeypatch):
    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    monkeypatch.setattr(replays, "REPLAY_DIR", tmp_path / "replays")
    (tmp_path / "state.json").write_text(json.dumps({"fmt": {"last": 100}}))
    rows = [_row(1, 103), _row(1, 103), _row(2, 102), _row(3, 101)]
    details = []

    def get_json(url):
        if "/search.json" in url:
            return rows
        details.append(url.rsplit("/", 1)[-1].removesuffix(".json"))
        return {"log": "ok"}

    monkeypatch.setattr(replays.http, "get_json", get_json)
    monkeypatch.setattr(replays, "parse_log", lambda _: {"parsed": True})
    saved = []
    save_state = replays._save_state
    monkeypatch.setattr(replays, "_save_state", lambda state: (saved.append(json.loads(json.dumps(state))), save_state(state))[1])

    assert replays.crawl("fmt", max_n=2, sample=True, log=lambda _: None) == 2
    assert details == ["r3", "r2"]
    checkpoint_rows = saved[0]["fmt"]["pending"]
    assert [r["id"] for r in checkpoint_rows] == ["r1", "r2", "r3"]
    assert all(set(row) <= {"id", "uploadtime", "rating"} for row in checkpoint_rows)


def test_state_replace_failure_preserves_previous_file(tmp_path, monkeypatch):
    import pytest

    path = tmp_path / "state.json"
    monkeypatch.setattr(replays, "STATE_PATH", path)
    original = '{"fmt":{"last":100}}'
    path.write_text(original, "utf-8")

    def fail_replace(*_args):
        raise OSError("replace failed")

    monkeypatch.setattr(replays.os, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        replays._save_state({"fmt": {"last": 200}})
    assert path.read_text("utf-8") == original
    assert list(tmp_path.glob("state.json.*.tmp")) == []


def test_http_retries_connection_reset(monkeypatch):
    attempts = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b"ok"

    def open_url(*_, **__):
        attempts.append(1)
        if len(attempts) == 1:
            raise ConnectionResetError("reset")
        return Response()

    monkeypatch.setattr(http, "_wait", lambda _: None)
    monkeypatch.setattr(http.urllib.request, "urlopen", open_url)
    monkeypatch.setattr(http.time, "sleep", lambda _: None)
    assert http.get_bytes("https://example.test/data") == b"ok"
    assert len(attempts) == 2


def test_timestamp_tie_boundary_does_not_advance_cursor(monkeypatch):
    calls = []
    monkeypatch.setattr(replays.http, "get_json", lambda _: calls.append(1) or [_row(i, 200) for i in range(51)])
    rows, before, done, highwater = replays._list_batch("fmt", 100, 200, 10)
    assert len(rows) == 50
    assert before == 200
    assert highwater == 200
    assert not done
    assert len(calls) == 1


def test_timestamp_boundary_at_saved_watermark_is_complete(monkeypatch):
    monkeypatch.setattr(replays.http, "get_json", lambda _: [_row(i, 200) for i in range(51)])
    rows, before, done, _ = replays._list_batch("fmt", 200, 200, 10)
    assert rows == []
    assert before == 200
    assert done


def test_replay_all_filtered_page_advances_raw_highwater(tmp_path, monkeypatch):
    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    (tmp_path / "state.json").write_text(json.dumps({"fmt": {"last": 100}}))
    monkeypatch.setattr(replays.http, "get_json", lambda _: [_row(i, 200 - i) | {"players": ["metamon"]} for i in range(50)])
    assert replays.crawl("fmt", max_n=10, log=lambda _: None) == 0
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["fmt"] == {"last": 200}


def test_replay_crawl_does_not_move_highwater_backwards(tmp_path, monkeypatch):
    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    replays._save_state({"fmt": {"last": 200}})
    monkeypatch.setattr(replays, "_list_batch", lambda *args: ([], 100, True, 100))
    replays.crawl("fmt", max_n=1, log=lambda _: None)
    assert replays._load_state()["fmt"]["last"] == 200


def test_replay_crawl_rejects_nonpositive_limit():
    import pytest

    with pytest.raises(ValueError, match="max_n"):
        replays.crawl("fmt", max_n=0, log=lambda _: None)


def test_replay_partial_details_are_saved_and_skipped_on_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(replays, "STATE_PATH", tmp_path / "state.json")
    monkeypatch.setattr(replays, "REPLAY_DIR", tmp_path / "replays")
    (tmp_path / "state.json").write_text(json.dumps({"fmt": {"last": 1000}}))
    listings = [_row(1, 1003), _row(2, 1002), _row(3, 1001)]
    detail_calls = {}

    def get_json(url):
        if "/search.json" in url:
            return listings
        rid = url.rsplit("/", 1)[-1].removesuffix(".json")
        detail_calls[rid] = detail_calls.get(rid, 0) + 1
        if rid == "r2" and detail_calls[rid] == 1:
            raise ConnectionResetError("temporary")
        return {"log": "ok"}

    monkeypatch.setattr(replays.http, "get_json", get_json)
    monkeypatch.setattr(replays, "parse_log", lambda _: {"parsed": True})
    import pytest

    with pytest.raises(ConnectionResetError):
        replays.crawl("fmt", max_n=3, log=lambda _: None)
    day = replays.jst_day(1001)
    assert {r["id"] for r in replays.read_day("fmt", day)} == {"r3"}
    assert json.loads((tmp_path / "state.json").read_text())["fmt"]["last"] == 1000
    assert replays.crawl("fmt", max_n=3, log=lambda _: None) == 2
    assert detail_calls == {"r3": 1, "r2": 2, "r1": 1}
    assert {r["id"] for r in replays.read_day("fmt", day)} == {"r1", "r2", "r3"}


def test_ladder_rotates_users_and_bounds_details(tmp_path, monkeypatch):
    monkeypatch.setattr(ladder, "STATE_PATH", tmp_path / "ladder-state.json")
    monkeypatch.setattr(ladder, "LADDER_USERS_PER_RUN", 2)
    monkeypatch.setattr(ladder.replays, "known_ids", lambda *_: set())
    monkeypatch.setattr(ladder.replays, "fetch_record", lambda row: None)
    monkeypatch.setattr(ladder.replays, "store", lambda *_: 0)
    searched = []
    now = int(ladder.time.time())

    def search(url):
        searched.append(url)
        return [_row(len(searched), now), _row(len(searched) + 10, now - 1)]

    monkeypatch.setattr(ladder.http, "get_json", search)
    top = [{"userid": f"u{i}"} for i in range(4)]
    ladder.crawl_top("fmt", top, n_users=4, max_n=1, log=lambda _: None)
    ladder.crawl_top("fmt", top, n_users=4, max_n=1, log=lambda _: None)
    assert len(searched) == 4
    assert "user=u0" in searched[0] and "user=u1" in searched[1]
    assert "user=u2" in searched[2] and "user=u3" in searched[3]
    state = json.loads((tmp_path / "ladder-state.json").read_text())
    assert len(state["fmt"]["pending"]) == 6
    assert all(set(row) <= {"id", "uploadtime", "rating"} for row in state["fmt"]["pending"])


def test_ladder_partial_details_are_saved_and_skipped_on_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(ladder, "STATE_PATH", tmp_path / "ladder-state.json")
    known = set()
    monkeypatch.setattr(ladder.replays, "known_ids", lambda *_: known.copy())
    monkeypatch.setattr(ladder, "LADDER_USERS_PER_RUN", 1)
    now = int(ladder.time.time())
    searched = []
    listing = [_row(1, now), _row(2, now - 1)]

    def get_json(url):
        searched.append(url)
        return listing

    monkeypatch.setattr(ladder.http, "get_json", get_json)
    detail_calls = []

    def fetch_record(row):
        detail_calls.append(row["id"])
        if row["id"] == "r1" and detail_calls.count("r1") == 1:
            raise ConnectionResetError("temporary")
        return {"id": row["id"], "t": row["uploadtime"], "rating": row.get("rating")}

    def store(_fmt, recs):
        known.update(rec["id"] for rec in recs)
        return len(recs)

    monkeypatch.setattr(ladder.replays, "fetch_record", fetch_record)
    monkeypatch.setattr(ladder.replays, "store", store)
    import pytest

    with pytest.raises(ConnectionResetError):
        ladder.crawl_top("fmt", [{"userid": "u"}], n_users=1, max_n=2, log=lambda _: None)
    assert known == {"r2"}  # uploadtime順で先に保存済み
    assert not (tmp_path / "ladder-state.json").exists()
    ladder.crawl_top("fmt", [{"userid": "u"}], n_users=1, max_n=2, log=lambda _: None)
    assert detail_calls == ["r2", "r1", "r1"]
    assert known == {"r1", "r2"}

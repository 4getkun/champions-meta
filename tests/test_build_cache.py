from cmeta import export


def test_transport_changes_do_not_invalidate_analysis(tmp_path):
    analysis = tmp_path / "analysis"
    analysis.mkdir()
    (analysis / "joint.py").write_text("model = 1")
    (tmp_path / "http.py").write_text("transport = 1")
    first = export._code_hash(tmp_path)
    (tmp_path / "http.py").write_text("transport = 2")
    (tmp_path / "__main__.py").write_text("cli = 2")
    assert export._code_hash(tmp_path) == first
    (analysis / "joint.py").write_text("model = 2")
    assert export._code_hash(tmp_path) != first


def test_content_signature_detects_changes_with_same_count_and_time():
    rows = [{"t": 100, "id": "one", "rating": 1000}]
    monthly = {"months": ["2026-09"], "usage": {"A": 0.1}}
    original = export._replay_sig(rows, monthly, "code", {"day": 1})
    assert export._replay_sig([dict(rows[0])], dict(monthly), "code", {"day": 1}) == original
    assert export._replay_sig([{**rows[0], "rating": 1500}], monthly, "code", {"day": 1}) != original
    assert export._replay_sig(rows, {**monthly, "usage": {"A": 0.2}}, "code", {"day": 1}) != original
    assert export._replay_sig(rows, monthly, "code", {"day": 2}) != original

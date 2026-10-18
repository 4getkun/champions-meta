import importlib.util
import json
from pathlib import Path
from unittest.mock import Mock

import pytest


def _load_collect():
    path = Path(__file__).parents[1] / "scripts" / "collect.py"
    spec = importlib.util.spec_from_file_location("collect_metrics", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_collect_success_forwards_max_records_metrics_and_restores_http(monkeypatch, capsys):
    collect = _load_collect()
    original = Mock(return_value=b"private-response-body")
    monkeypatch.setattr(collect.http, "get_bytes", original)
    private_url = "https://replay.pokemonshowdown.com/search.json?user=private-player&format=gen9champions-secret"
    seen = []

    def command(argv):
        seen.extend(argv)
        assert collect.http.get_bytes(private_url) == b"private-response-body"
        return 17

    assert collect.run(37, command) == 17
    assert seen == ["all", "--max", "37"]
    assert collect.http.get_bytes is original
    output = capsys.readouterr().out
    assert private_url not in output and "private-player" not in output
    assert "private-response-body" not in output and "gen9champions-secret" not in output
    metrics = json.loads(next(line.removeprefix("[http:metrics] ") for line in output.splitlines()
                              if line.startswith("[http:metrics] ")))
    assert metrics["categories"]["showdown_user_list"]["calls"] == 1
    assert metrics["categories"]["showdown_user_list"]["bytes"] == len(b"private-response-body")


def test_collect_failure_counts_call_restores_http_and_reraises(monkeypatch, capsys):
    collect = _load_collect()
    error = RuntimeError("private-response-details")
    original = Mock(side_effect=error)
    monkeypatch.setattr(collect.http, "get_bytes", original)

    def command(_argv):
        collect.http.get_bytes("https://replay.pokemonshowdown.com/search.json?user=hidden-player&format=secret-format")

    with pytest.raises(RuntimeError) as raised:
        collect.run(9, command)
    assert raised.value is error
    assert collect.http.get_bytes is original
    output = capsys.readouterr().out
    assert "hidden-player" not in output and "secret-format" not in output
    assert "private-response-details" not in output
    metrics = json.loads(next(line.removeprefix("[http:metrics] ") for line in output.splitlines()
                              if line.startswith("[http:metrics] ")))
    assert metrics["categories"]["showdown_user_list"]["calls"] == 1
    assert metrics["categories"]["showdown_user_list"]["failures"] == 1

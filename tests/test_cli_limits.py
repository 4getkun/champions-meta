from cmeta import __main__ as cli


def test_all_honors_explicit_replay_limit(monkeypatch):
    from argparse import Namespace

    calls = []
    monkeypatch.setattr(cli.smogon, "sync", lambda: None)
    monkeypatch.setattr(cli, "_replay_targets", lambda: list(cli.REPLAY_CAP))
    monkeypatch.setattr(cli, "_ladder_due", lambda _: False)
    monkeypatch.setattr(cli.replays, "crawl", lambda fid, **kw: calls.append((fid, kw)))
    monkeypatch.setattr(cli.export, "build", lambda **_: None)
    cli._run(Namespace(cmd="all", max=3))
    assert calls
    assert all(kw == {"max_n": 3, "sample": True} for _, kw in calls)

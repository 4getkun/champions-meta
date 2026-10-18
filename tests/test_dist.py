import hashlib
import json
import pytest

from cmeta import dist


def test_build_copies_public_inputs_and_versions_assets(tmp_path, monkeypatch):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text(
        '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="dashboard.css">'
        '<script src="vendor/chart.umd.min.js"></script><script src="charts.js"></script>'
        '<script src="speed-share.js"></script><script src="app.js"></script>',
        encoding="utf-8",
    )
    (site / "style.css").write_text("body { color: red; }", encoding="utf-8")
    (site / "app.js").write_text("console.log('ok');", encoding="utf-8")
    (site / "dashboard.css").write_text("body { color: blue; }", encoding="utf-8")
    (site / "charts.js").write_text("window.MetaCharts = {};", encoding="utf-8")
    (site / "speed-share.js").write_text("window.SpeedShare = {};", encoding="utf-8")
    (site / "vendor").mkdir()
    (site / "vendor/chart.umd.min.js").write_text("window.Chart = {};", encoding="utf-8")

    out = tmp_path / "out"
    out.mkdir()
    (out / "meta.json").write_text(
        json.dumps({"generated_at": "2026-10-17T12:00:00+09:00"}), encoding="utf-8"
    )
    (out / "meta-public.json").write_text('{"ready":true}', encoding="utf-8")
    (out / "build_inputs.json").write_text('{"internal":"cache"}', encoding="utf-8")
    monkeypatch.setattr(dist, "SITE", site)
    monkeypatch.setattr(dist, "OUT", out)
    monkeypatch.setattr(dist, "DIST", tmp_path / "dist")
    monkeypatch.setattr(dist.fonts, "build", lambda *_args: None)

    dist.build(log=lambda _message: None)

    published = dist.DIST
    html = (published / "index.html").read_text(encoding="utf-8")
    for name in ("app.js", "style.css", "dashboard.css", "charts.js", "speed-share.js", "vendor/chart.umd.min.js"):
        digest = hashlib.sha256((published / name).read_bytes()).hexdigest()[:10]
        assert f'"{name}?v={digest}"' in html
    assert (published / "data" / "meta-public.json").exists()
    assert not (published / "data" / "build_inputs.json").exists()
    assert "<lastmod>2026-10-17</lastmod>" in (published / "sitemap.xml").read_text(
        encoding="utf-8"
    )


def test_build_fails_when_out_is_missing(tmp_path, monkeypatch):
    out = tmp_path / "out"
    out.mkdir()
    monkeypatch.setattr(dist, "OUT", out)
    monkeypatch.setattr(dist, "DIST", tmp_path / "dist")

    with pytest.raises(SystemExit, match="out/ がありません"):
        dist.build(log=lambda _message: None)

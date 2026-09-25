from pathlib import Path

from cmeta.dex import _js_object_names, to_id, to_slug
from cmeta.formats import month_range, parse_format
from cmeta.replays import parse_log

FIX = Path(__file__).parent / "fixtures"


def test_parse_format():
    f = parse_format("gen9championsvgc2026regmbbo3")
    assert f["family"] == "vgc2026" and f["regulation"] == "M-B" and f["bo3"] and f["game_type"] == "doubles"
    assert f["track"] == "vgc2026-bo3"
    f = parse_format("gen9championsbssregma")
    assert f["family"] == "bss" and f["regulation"] == "M-A" and not f["bo3"] and f["game_type"] == "singles"
    f = parse_format("gen9championsou")
    assert f["family"] == "ou" and f["regulation"] is None
    assert parse_format("gen9champions4v4doublesuu")["game_type"] == "doubles"
    assert parse_format("gen9ou") is None


def test_month_range():
    assert month_range("2026-11", "2027-02") == ["2026-11", "2026-12", "2027-01", "2027-02"]


def test_names():
    assert to_id("Kommo-o") == "kommoo"
    assert to_slug("Sitrus Berry") == "sitrus-berry"
    assert to_slug("Farfetch’d") == "farfetchd"
    src = 'exports.X = {abc:{name:"A b",flags:{x:1},desc:"has } brace"},def:{num:1,name:"D\\"q"}};'
    assert _js_object_names(src) == {"abc": "A b", "def": 'D\\"q'}


def test_parse_vgc_bo3_log():
    rec = parse_log((FIX / "vgc_bo3.log").read_text("utf-8"))
    assert rec["bo3"]
    assert [len(t) for t in rec["teams"]] == [6, 6]
    assert [len(b) for b in rec["brought"]] == [4, 4]
    assert all(set(b) <= set(t) for b, t in zip(rec["brought"], rec["teams"]))
    assert [len(x) for x in rec["leads"]] == [2, 2]
    assert rec["megas"] == [["Aerodactyl-Mega"], ["Floette-Mega"]]
    assert "Floette-Eternal" in rec["brought"][1]  # メガ後の名前も見せ合いの枠に対応づく
    assert rec["winner"] == 1


def test_parse_singles_log():
    rec = parse_log((FIX / "ou_single.log").read_text("utf-8"))
    assert not rec["bo3"]
    assert [len(t) for t in rec["teams"]] == [6, 6]
    assert [len(x) for x in rec["leads"]] == [1, 1]
    assert rec["winner"] in (0, 1)
    assert len(rec["players"][0]) == 12  # 名前はハッシュ


def test_parse_log_without_preview():
    assert parse_log("|player|p1|a|1|\n|player|p2|b|1|\n|win|a") is None


def test_japanese_names():
    from cmeta.dex import compose_ja, slug_candidates
    assert compose_ja("リザードン", "メガリザードンＹ") == "メガリザードンＹ"
    assert compose_ja("キュウコン", "アローラのすがた") == "キュウコン（アローラ）"
    assert compose_ja("フラエッテ", "えいえんのはな") == "フラエッテ（えいえんのはな）"
    assert compose_ja("イダイトウ", None) == "イダイトウ"
    assert slug_candidates("Meowstic-F-Mega") == ["meowstic-f-mega", "meowstic-female-mega"]
    assert slug_candidates("Kommo-o") == ["kommo-o"]


def test_revealed_and_faints():
    rec = parse_log((FIX / "vgc_bo3.log").read_text("utf-8"))
    mine, theirs = rec["revealed"]
    assert mine["Aerodactyl"]["i"] == "aerodactylite"  # メガストーン
    assert "trickroom" in theirs["Sinistcha"]["m"] and theirs["Sinistcha"]["i"] == "sitrusberry"
    assert all(set(r) <= set(t) for r, t in zip(rec["revealed"], rec["teams"]))
    assert rec["faints"][0] == [1, "Talonflame"] and len(rec["faints"]) == 6


def test_bot_names():
    from cmeta.replays import is_bot

    assert is_bot(["someone", "ChampNashBot94154"]) and is_bot(["PokeChamp v2", "x"])
    assert not is_bot(["alice", "carol"])

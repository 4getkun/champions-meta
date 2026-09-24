"""名前と基礎データ。

- 英語名・元の姿・タイプ・種族値は Showdown の図鑑（MIT）。Smogon とリプレイの名前はこれと同じ体系。
- 日本語名は PokeAPI。取ったものは data/dex/pokeapi_ja.json に控え、二度取りに行かない（PokeAPI の fair use）。
"""

import json
import re
import unicodedata

from . import http
from .config import CACHE, DATA, POKEAPI, SHOWDOWN_DATA

JA_PATH = DATA / "dex" / "pokeapi_ja.json"
OVERRIDES_PATH = DATA / "name_overrides.json"


def to_id(name: str) -> str:
    """Showdown の ID: 英小文字と数字だけ。"""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", name.lower())


def to_slug(name: str) -> str:
    """PokeAPI の slug: 'Sitrus Berry' -> 'sitrus-berry'、'Kommo-o' -> 'kommo-o'。"""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = s.replace(" ", "-")
    s = re.sub(r"[^a-z0-9-]", "", s)
    return re.sub(r"-+", "-", s).strip("-")


# ── Showdown のデータ ──────────────────────────────────────────


def _js_object_names(src: str) -> dict[str, str]:
    """`exports.X = {id:{…name:"…"…}, …}` から {id: name} を取る。

    キーに引用符が無い JS なので json では読めない。深さ 1 のキーと、その中の最初の name を拾う。
    """
    out: dict[str, str] = {}
    i = src.index("{") + 1
    depth, in_str, esc = 1, None, False
    key_start = None
    cur_key, chunk_start = None, None
    n = len(src)
    while i < n and depth > 0:
        c = src[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == in_str:
                in_str = None
        elif c in "\"'`":
            in_str = c
        elif c == "{":
            if depth == 1:
                m = re.search(r"([A-Za-z0-9_]+)\s*:\s*$", src[key_start or 0:i])
                cur_key = m.group(1) if m else None
                chunk_start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 1 and cur_key:
                m = re.search(r'\bname:"((?:[^"\\]|\\.)*)"', src[chunk_start:i])
                if m:
                    out[cur_key] = m.group(1)
                cur_key = None
                key_start = i + 1
        elif c == "," and depth == 1:
            key_start = i + 1
        i += 1
    return out


class Showdown:
    def __init__(self, refresh: bool = False):
        d = CACHE / "showdown"
        self.pokedex = json.loads(http.cached_bytes(f"{SHOWDOWN_DATA}/pokedex.json", d / "pokedex.json", refresh))
        moves = json.loads(http.cached_bytes(f"{SHOWDOWN_DATA}/moves.json", d / "moves.json", refresh))
        self.move_names = {k: v["name"] for k, v in moves.items() if "name" in v}
        items_js = http.cached_bytes(f"{SHOWDOWN_DATA}/items.js", d / "items.js", refresh).decode("utf-8")
        abil_js = http.cached_bytes(f"{SHOWDOWN_DATA}/abilities.js", d / "abilities.js", refresh).decode("utf-8")
        self.item_names = _js_object_names(items_js)
        self.ability_names = _js_object_names(abil_js)

    def species(self, name: str) -> dict | None:
        return self.pokedex.get(to_id(name.replace("-*", "")))

    def group_name(self, name: str) -> str:
        """「元の姿にまとめた」ときの名前。メガ・ゲンシ・戦闘中だけの姿は元に戻し、リージョンフォームなどは残す。"""
        e = self.species(name)
        if not e:
            return name.replace("-*", "")
        # battleOnly を先に見る（Floette-Mega の元は Floette ではなく Floette-Eternal。見せ合いにもこの名前で出る）
        bo = e.get("battleOnly")
        if bo:
            return bo if isinstance(bo, str) else bo[0]
        forme = e.get("forme") or ""
        if forme.startswith(("Mega", "Primal")):
            return e["baseSpecies"]
        return e["name"]

    def is_mega(self, name: str) -> bool:
        e = self.species(name)
        return bool(e and (e.get("forme") or "").startswith("Mega"))


# ── PokeAPI の日本語名 ─────────────────────────────────────────


def compose_ja(species: str | None, form: str | None) -> str | None:
    """種の名前と姿の名前をつなぐ。'リザードン' + 'メガリザードンＹ' -> 'メガリザードンＹ'、
    'キュウコン' + 'アローラのすがた' -> 'キュウコン（アローラ）'。"""
    if not species or not form:
        return species or form
    if species in form:
        return form
    form = form.removesuffix("のすがた")
    return f"{species}（{form}）"


def slug_candidates(name: str) -> list[str]:
    """Showdown の名前から、PokeAPI の slug の候補。'Meowstic-F-Mega' -> meowstic-female-mega など。"""
    base = to_slug(name)
    parts = base.split("-")
    swapped = "-".join({"f": "female", "m": "male"}.get(x, x) if i else x for i, x in enumerate(parts))
    return [base] + ([swapped] if swapped != base else [])


def _ja(names: list[dict]) -> str | None:
    by = {n["language"]["name"]: n["name"] for n in names}
    return by.get("ja") or by.get("ja-hrkt")


class JaNames:
    """日本語名の控え。キーは 'species:<showdown id>' など。値が None は「PokeAPI に無かった」。"""

    def __init__(self, sd: Showdown):
        self.sd = sd
        self.cache: dict[str, dict | None] = json.loads(JA_PATH.read_text("utf-8")) if JA_PATH.exists() else {}
        self.overrides: dict[str, str] = (
            json.loads(OVERRIDES_PATH.read_text("utf-8")) if OVERRIDES_PATH.exists() else {}
        )
        self.dirty = False
        self.fetched = 0

    def save(self) -> None:
        if self.dirty:
            JA_PATH.parent.mkdir(parents=True, exist_ok=True)
            JA_PATH.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1, sort_keys=True), "utf-8")
            self.dirty = False

    def _get(self, path: str):
        self.fetched += 1
        if self.fetched % 50 == 0:
            self.save()  # 途中で止まっても、取った分は無駄にしない
        return http.get_json(f"{POKEAPI}/{path}/")

    # ポケモン
    def species(self, name: str, retry_missing: bool = False) -> str | None:
        e = self.sd.species(name)
        sid = e["name"] if e else name
        key = f"species:{to_id(sid)}"
        if key in self.overrides:
            return self.overrides[key]
        if key in self.cache and (self.cache[key] is not None or not retry_missing):
            v = self.cache[key]
            return v and v["ja"]
        self.cache[key] = self._fetch_species(sid, e)
        self.dirty = True
        v = self.cache[key]
        return v and v["ja"]

    def _fetch_species(self, name: str, e: dict | None) -> dict | None:
        override = self.overrides.get(f"slug:{to_id(name)}")
        candidates = [override] if override else slug_candidates(name)
        poke = None
        for slug in candidates:
            try:
                poke = self._get(f"pokemon/{slug}")
                break
            except http.NotFound:
                continue
        if poke is None:
            try:  # 'basculegion' のように、既定の姿にだけ接尾辞が付く種
                spc = self._get(f"pokemon-species/{candidates[0]}")
            except http.NotFound:
                return None
            return {"ja": _ja(spc["names"]), "slug": candidates[0]}
        spc = self._get(f"pokemon-species/{poke['species']['name']}")
        species_ja = _ja(spc["names"])
        forme = (e or {}).get("forme")
        if not forme or not poke.get("forms"):
            return {"ja": species_ja, "slug": poke["name"]}
        form = self._get(f"pokemon-form/{poke['forms'][0]['name']}")
        full = _ja(form.get("names", []))
        if full:
            return {"ja": full, "slug": poke["name"]}
        form_ja = _ja(form.get("form_names", []))
        return {"ja": compose_ja(species_ja, form_ja), "species_ja": species_ja, "form_ja": form_ja,
                "slug": poke["name"]}

    # 持ち物・技・特性（Smogon は ID しか持たないので、Showdown の英語名を経由する）
    def _simple(self, kind: str, sid: str, en: str | None) -> str | None:
        key = f"{kind}:{sid}"
        if key in self.overrides:
            return self.overrides[key]
        if key in self.cache:
            v = self.cache[key]
            return v and v["ja"]
        v = None
        if en:
            try:
                d = self._get(f"{kind}/{to_slug(en)}")
                v = {"ja": _ja(d["names"]), "slug": d["name"]}
            except http.NotFound:
                v = None
        self.cache[key] = v
        self.dirty = True
        return v and v["ja"]

    def item(self, sid: str) -> str | None:
        return self._simple("item", sid, self.sd.item_names.get(sid))

    def move(self, sid: str) -> str | None:
        return self._simple("move", sid, self.sd.move_names.get(sid))

    def ability(self, sid: str) -> str | None:
        return self._simple("ability", sid, self.sd.ability_names.get(sid))

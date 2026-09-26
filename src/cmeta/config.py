"""設定。値の意味は docs/PLAN.md を参照。"""

from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CACHE = ROOT / ".cache"
OUT = ROOT / "out"
SITE = ROOT / "site"
DIST = ROOT / "dist"
SITE_URL = "https://champions.fourgetkun.com/"  # 公開先（Cloudflare Pages の champions-meta に、このサブドメインを割り当てる）

JST = timezone(timedelta(hours=9))

USER_AGENT = "champions-meta/0.1 (+https://fourgetkun.com/; non-commercial fan tool)"
MIN_INTERVAL_SEC = 1.0  # 同じホストへの間隔の下限

SMOGON_BASE = "https://www.smogon.com/stats"
SHOWDOWN_DATA = "https://play.pokemonshowdown.com/data"
REPLAY_BASE = "https://replay.pokemonshowdown.com"
POKEAPI = "https://pokeapi.co/api/v2"
SPRITE_BASE = "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites"  # 画像は複製せず CDN から

FORMAT_PREFIX = "gen9champions"
FIRST_MONTH = "2026-04"  # Smogon にチャンピオンズが出た最初の月

CUTOFFS = (0, 1500, 1630, 1760)
DEFAULT_CUTOFF = 1630

# リプレイ
REPLAY_MAX_PER_RUN = 1500  # 1 ルール・1 回の実行で取る上限
REPLAY_BACKFILL_DAYS = 14  # 初回にさかのぼる日数
SERIES_GAP_SEC = 3 * 3600  # これより離れていれば別のシリーズ
# リプレイを取るルール（今のレギュレーションだけ。終わったレギュレーションや OU・UU は取らない。月次統計は別に取る）
# GitHub Actions の使用時間を抑えるため（2026-09-26: 取りこぼしを追う取得で 1 回 60〜120 分かかり、月 2,000 分の枠を超える）
EXTRA_REPLAY_FORMATS: tuple[str, ...] = ("gen9championsbssregmc", "gen9championsvgc2026regmc", "gen9championsvgc2026regmcbo3")
# 1 回の実行で取る上限（ルールごと）。超えたら期間全体から等間隔に抜き取り、残りは取らない（次回に持ち越さない）。
# シングルは少ない（1 日 70 件ほど）ので全部、ダブルは多い（1 日 300〜500 件）ので抜き取り
REPLAY_CAP = {"gen9championsbssregmc": 1500, "gen9championsvgc2026regmc": 250, "gen9championsvgc2026regmcbo3": 150}
LADDER_EVERY_DAYS = 7  # 上位 500 人のランキング表の記録と、上位の人のリプレイ取得の間隔

# 解析
MONTHLY_TOP_SETS = 6  # 持ち物・技などを何位まで出すか
CORE_MIN_WEIGHT_SHARE = 0.002  # コアの網に入れるポケモンの最低の使用率（枠あたり）
CORE_MIN_LIFT = 1.5
CORE_MIN_NPMI = 0.1
WEEKLY_MIN_TEAMS = 20  # これ未満の週は出さない
WEEKLY_TOP = 60  # 週次で出すポケモンの数
MATCHUP_MIN_GAMES = 30

"""M6 並び（コア）: Smogon の Teammates から「一緒に使われやすさ」の網を作り、まとまりを見つけて月をまたいで追う。

- 辺の重み: lift = p(a,b) / (p(a) p(b)) と NPMI（Teng・Lin・Adamic 2012 の PMI を −1〜1 に正規化）。
  PMI は珍しい組で跳ねるので、同時に使われる割合の下限も付ける。
- まとまり: Louvain（seed 固定）。Leiden のほうが連結を保証する（Traag ほか 2019）が、networkx の Leiden は
  版によって別の実装を要するため Louvain にし、連結でないまとまりは連結成分に割る。
- 月をまたぐ対応: 前月のまとまりとの Jaccard 係数が最大で JACCARD_MIN 以上なら同じ番号を引き継ぐ。
"""

import networkx as nx

from ..config import CORE_MIN_LIFT, CORE_MIN_NPMI, CORE_MIN_WEIGHT_SHARE
from .stats import pmi_stats

MIN_PAIR_SHARE = 0.002  # 全チームのうち a と b が同じチームにいる割合の下限
JACCARD_MIN = 0.3
MIN_COMMUNITY = 2


def build_graph(month_data: dict) -> nx.Graph:
    total_w = month_data["total_weight"]
    pk = month_data["pokemon"]
    g = nx.Graph()
    nodes = {k for k, p in pk.items() if p["usage"] / 6 >= CORE_MIN_WEIGHT_SHARE and "teammates" in p}
    # 名前順に足す（集合の順は実行ごとに変わり、Louvain の結果が揺れるため）
    for k in sorted(nodes):
        g.add_node(k, usage=pk[k]["usage"])
    for a in sorted(nodes):
        for b, w_ab in pk[a]["teammates"].items():
            if b not in nodes or b <= a:
                continue
            p_ab = w_ab / total_w
            if p_ab < MIN_PAIR_SHARE:
                continue
            lift, npmi = pmi_stats(p_ab, pk[a]["weight"] / total_w, pk[b]["weight"] / total_w)
            if lift >= CORE_MIN_LIFT and npmi >= CORE_MIN_NPMI:
                g.add_edge(a, b, lift=round(lift, 3), npmi=round(npmi, 4), together=round(p_ab, 5))
    return g


def communities(g: nx.Graph, seed: int = 42) -> list[set[str]]:
    if g.number_of_edges() == 0:
        return []
    found = nx.community.louvain_communities(g, weight="npmi", seed=seed)
    out = []
    for c in found:
        for comp in nx.connected_components(g.subgraph(c)):
            if len(comp) >= MIN_COMMUNITY:
                out.append(set(comp))
    return out


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def analyze(month_datas: dict[str, dict]) -> dict:
    """{月: 縮約（標準の足切り）} → 月ごとの網とまとまり。まとまりには月をまたいで同じ番号を振る。"""
    out_months = {}
    prev: list[tuple[int, set[str]]] = []
    next_id = 1
    for m in sorted(month_datas):
        md = month_datas[m]
        g = build_graph(md)
        comms = sorted(communities(g), key=lambda c: (-sum(md["pokemon"][k]["usage"] for k in c), sorted(c)))
        assigned: list[tuple[int, set[str]]] = []
        used = set()
        for c in comms:
            best, best_j = None, 0.0
            for pid, pc in prev:
                j = _jaccard(c, pc)
                if pid not in used and j > best_j:
                    best, best_j = pid, j
            if best is not None and best_j >= JACCARD_MIN:
                cid = best
            else:
                cid, next_id = next_id, next_id + 1
            used.add(cid)
            assigned.append((cid, c))
        member_of = {k: cid for cid, c in assigned for k in c}
        out_months[m] = {
            "nodes": [{"name": k, "usage": g.nodes[k]["usage"], "core": member_of.get(k)}
                      for k in sorted(g.nodes, key=lambda k: (-g.nodes[k]["usage"], k))],
            "edges": [{"a": a, "b": b, **d} for a, b, d in sorted(g.edges(data=True))],
            "cores": [{
                "id": cid,
                "members": sorted(c, key=lambda k: (-md["pokemon"][k]["usage"], k)),
                "usage_sum": round(sum(md["pokemon"][k]["usage"] for k in c), 5),
                "continued": any(cid == pid for pid, _ in prev),
            } for cid, c in assigned],
        }
        prev = assigned
    return {"months": out_months}

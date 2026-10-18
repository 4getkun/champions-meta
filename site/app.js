// チャンピオンズ メタ — デザイン部。out/ の JSON（docs/DATA_CONTRACT.md）を読んで描くだけで、解析はしない。
// データの場所: 既定は ./data/（hub に置くとき out/ をここへ写す）。手元では ?data=../out/ で repo の out/ を読む。
'use strict';

// ?data= は同じサイトの中の相対パスだけ受け付ける（ほかのサイトの JSON を読ませて表示させないため）
const BASE = ((d) => (d && /^\.{0,2}\/?[\w./-]*\/$/.test(d) && !d.includes('//') ? d : './data/'))(new URLSearchParams(location.search).get('data'));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
function updateStatus(compact = false) {
  const date = new Date(META.generated_at);
  const stamp = Number.isNaN(date.getTime()) ? META.generated_at : date.toLocaleString('ja-JP');
  const age = Number.isNaN(date.getTime()) ? 0 : Math.floor((Date.now() - date.getTime()) / 86400000);
  const status = age >= 7 ? `更新が遅れています。以下は${stamp}時点の集計です。` : `最終更新: ${stamp}`;
  return compact ? status : `${status} 通常は3日に1回更新。Smogon の月次統計は毎月 3 日ごろ。`;
}
// 初期表示はシングル（ゲーム内のランクバトルと同じルールの BSS）。Smogon 独自のルールは後ろ
const FAMILY_ORDER = ['bss', 'vgc', 'ou', 'uu', '4v4doublesuu'];

let META = null;
let NAMES = null;
let view = null; // いま表示しているルールのデータ

async function getJSON(path) {
  const res = await fetch(BASE + path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ── 日本語の改行（文節） ──────────────────────────────────────
// Chrome・Edge は CSS の word-break: auto-phrase で足りる。効かないブラウザ（Safari など）だけ BudouX（Apache-2.0、
// 日本語モデルと処理部分で約 29KB）を読み込んで、文節の切れ目に改行の候補を入れる。?budoux=1 で試せる。
const NEEDS_BUDOUX = !CSS.supports('word-break', 'auto-phrase') || new URLSearchParams(location.search).has('budoux');
const BUDOUX = 'https://cdn.jsdelivr.net/npm/budoux@0.7.0/module/';
let budouxParser = null;
async function phrase(root) {
  if (!NEEDS_BUDOUX || !root) return;
  try {
    budouxParser = budouxParser || Promise.all([
      import(`${BUDOUX}html_processor.js/+esm`), import(`${BUDOUX}data/models/ja.js/+esm`),
    ]).then(([hp, ja]) => new hp.HTMLProcessingParser(ja.model));
    const parser = await budouxParser;
    root.querySelectorAll('h1, h2, p, li, .k, .note, .lead').forEach((el) => {
      if (el.dataset.bx || el.closest('svg')) return;
      parser.applyToElement(el);
      el.dataset.bx = '1';
    });
  } catch (e) { /* 読めなくても表示はできる（改行位置が少し不自然になるだけ） */ }
}

// 「A · B · C」を項目ごとの固まりにする（「·」が行頭に来たり、項目の途中で折り返したりしない）
const dots = (...parts) => `<span class="dots">${parts.filter(Boolean).map((x) => `<span>${x}</span>`).join('')}</span>`;
// 「フラエッテ（えいえんのはな）」→ 名前と姿に分ける
function nameParts(n) {
  const m = ja(n).match(/^(.+?)（(.+)）$/);
  return m ? [m[1], m[2]] : [ja(n), ''];
}

// ── 名前と画像 ────────────────────────────────────────────
const poke = (n) => (NAMES && NAMES.pokemon[n]) || {};
const ja = (n) => poke(n).ja || n;
// 短い名前: 姿の違いは別のポケモンとして数えているので、括弧の中は残して縮める（キュウコン（アローラ）→ キュウコン(アローラ)）
const short = (n) => ja(n).replace(/（([^）]+)）/, (_, x) => `(${x.replace(/パルデア・|のすがた|なすがた|サイズ|種$|のはな|のかた/g, '')})`);
function spriteUrl(n, kind = 'front') {
  const s = poke(n).sprite;
  return s ? s[kind] || s.front : null;
}
function icon(n, px = 28) {
  const u = spriteUrl(n);
  return u ? `<img class="spr" src="${esc(u)}" width="${px}" height="${px}" loading="lazy" decoding="async" alt="">` : '';
}
function svgIcon(n, x, y, px = 26) {
  const u = spriteUrl(n);
  return u ? `<image href="${esc(u)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${px}" height="${px}" style="image-rendering:pixelated"/>` : '';
}

function formatLabel(f) {
  // ゲーム内の呼び方にそろえる: BSS = シングル、VGC = ダブル。Smogon 独自のルールはそう書く
  const base = {
    bss: 'シングル', ou: 'シングル OU（Smogon）', uu: 'シングル UU（Smogon）', '4v4doublesuu': 'ダブル UU（Smogon）',
  }[f.family] || (f.family.startsWith('vgc') ? 'ダブル' : f.family);
  return [base, f.regulation, f.bo3 ? 'Bo3' : ''].filter(Boolean).join(' ');
}

function currentFormats() {
  // 最新の月にあるルールだけを並べる（終わったレギュレーションは推移のグラフで見られる）
  const latest = META.formats.reduce((m, f) => (f.months.length && f.months.at(-1) > m ? f.months.at(-1) : m), '');
  const rank = (f) => FAMILY_ORDER.findIndex((p) => f.family.startsWith(p));
  // 月次統計がまだ無い、始まったばかりのルール（リプレイがあり、見せ合いから選出するもの）も並べ、同じ系統では新しいレギュレーションを先に
  const reg = (f) => f.regulation || '';
  return META.formats
    .filter((f) => (f.months.length && f.months.at(-1) === latest) || (f.early && f.replay_days && f.team_select))
    .sort((a, b) => rank(a) - rank(b) || (reg(a) < reg(b) ? 1 : reg(a) > reg(b) ? -1 : 0) || a.bo3 - b.bo3);
}

// ── ツールチップ ──────────────────────────────────────────
const tip = () => $('tip');
function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  t.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 14))}px`;
  t.style.top = `${Math.min(window.innerHeight - h - 8, Math.max(8, y - h - 10))}px`;
}
function hideTip() { tip().hidden = true; }

// ── グラフ ──────────────────────────────────────────────
function breaks(segments) {
  const out = [];
  for (let i = 1; i < segments.length; i++) if (segments[i].regulation !== segments[i - 1].regulation) out.push(i);
  return out;
}

function trendChart(el, track, width) {
  const months = track.months;
  const usage = track.usage_grouped;
  const last = (k) => usage[k][months.length - 1] || 0;
  const top = Object.keys(usage).sort((a, b) => last(b) - last(a)).slice(0, 6);
  if (!top.length || months.length < 2) {
    el.innerHTML = '<p class="empty">まだ 2 か月ぶんのデータがありません。</p>';
    return top;
  }
  const focus = top[0];
  const w = Math.max(320, width);
  const small = w < 520;
  const h = small ? 260 : 300;
  const padL = 40, padR = small ? 118 : 150, padT = 18, padB = 30;
  const iw = w - padL - padR, ih = h - padT - padB;
  const ymax = Math.max(0.1, Math.ceil(Math.max(...top.map((k) => Math.max(...usage[k].map((v) => v || 0)))) * 10) / 10);
  const X = (i) => padL + (iw * i) / (months.length - 1);
  const Y = (v) => padT + ih * (1 - v / ymax);
  const cuts = breaks(track.segments);
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="使用率の推移（上位6匹）">`];
  for (let v = 0; v <= ymax + 1e-9; v += 0.1) {
    s.push(`<line x1="${padL}" x2="${w - padR}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/>`);
    s.push(`<text x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${Math.round(v * 100)}%</text>`);
  }
  for (const c of cuts) {
    const bx = (X(c - 1) + X(c)) / 2;
    s.push(`<line x1="${bx}" x2="${bx}" y1="${padT}" y2="${h - padB}" stroke-dasharray="4 4" style="stroke:var(--muted)"/>`);
    s.push(`<text x="${bx + 6}" y="${padT + 12}" font-size="11" style="fill:var(--muted)">${esc(track.segments[c - 1].regulation)} → ${esc(track.segments[c].regulation)}</text>`);
  }
  const step = small ? Math.ceil(months.length / 5) : 1;
  months.forEach((m, i) => {
    if (i % step === 0 || i === months.length - 1) {
      s.push(`<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${+m.slice(5)}月</text>`);
    }
  });
  const edges = [0, ...cuts, months.length];
  for (const k of [...top.slice(1), focus]) {
    const on = k === focus;
    const col = on ? 'var(--accent)' : 'var(--context)';
    for (let e = 0; e < edges.length - 1; e++) {
      const pts = [];
      for (let i = edges[e]; i < edges[e + 1]; i++) if (usage[k][i] != null) pts.push(`${X(i).toFixed(1)},${Y(usage[k][i]).toFixed(1)}`);
      if (pts.length) s.push(`<polyline points="${pts.join(' ')}" fill="none" style="stroke:${col}" stroke-width="${on ? 3 : 1.5}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    s.push(`<circle cx="${X(months.length - 1)}" cy="${Y(last(k))}" r="${on ? 4.5 : 3}" style="fill:${col};stroke:var(--bg)" stroke-width="2"/>`);
  }
  // 右端の名前（重ならないよう下へずらす）
  let prev = -1e9;
  for (const k of [...top].sort((a, b) => last(b) - last(a))) {
    const y = Math.max(Y(last(k)), prev + 20);
    prev = y;
    const on = k === focus;
    s.push(svgIcon(k, w - padR + 4, y - 13, 24));
    s.push(`<text x="${w - padR + 30}" y="${y + 4}" font-size="12" font-weight="${on ? 700 : 400}" style="fill:${on ? 'var(--ink)' : 'var(--muted)'}">${esc(short(k))} ${Math.round(last(k) * 100)}%</text>`);
  }
  s.push(`<line class="xh" x1="0" x2="0" y1="${padT}" y2="${h - padB}" style="stroke:var(--muted);display:none"/>`);
  s.push(`<rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent"/>`);
  s.push('</svg>');
  el.innerHTML = s.join('');

  // 十字線とツールチップ
  const svg = el.querySelector('svg');
  const xh = svg.querySelector('.xh');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * w;
    const i = Math.max(0, Math.min(months.length - 1, Math.round(((px - padL) / iw) * (months.length - 1))));
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.style.display = '';
    const rows = [...top].sort((a, b) => (usage[b][i] || 0) - (usage[a][i] || 0))
      .map((k) => `${esc(short(k))} <b>${pct(usage[k][i])}</b>`).join('<br>');
    showTip(`<b>${+months[i].slice(5)}月</b>（${esc(track.segments[i].regulation || '')}）<br>${rows}`, ev.clientX, ev.clientY);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { xh.style.display = 'none'; hideTip(); });
  return top;
}

function trendTable(el, track, top) {
  const head = track.months.map((m) => `<th>${+m.slice(5)}月</th>`).join('');
  const rows = top.map((k) => `<tr><td>${esc(short(k))}</td>${track.usage_grouped[k].map((v) => `<td>${pct(v)}</td>`).join('')}</tr>`).join('');
  el.innerHTML = `<table><thead><tr><th>ポケモン</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function moversChart(el, movers, width) {
  if (!movers) {
    el.innerHTML = '<p class="empty">前の月が無いので比べられません。</p>';
    return;
  }
  const rows = [...movers.rising.slice(0, 5), ...movers.falling.slice(0, 5)];
  const row = 30;
  const w = Math.max(300, width);
  const h = row * rows.length + 10;
  const mid = w / 2;
  const maxd = Math.max(0.01, ...rows.map((r) => Math.abs(r.delta)));
  const scale = (mid - 60) / maxd;
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="前月から伸びた・落ちた">`];
  s.push(`<line x1="${mid}" x2="${mid}" y1="0" y2="${h}" style="stroke:var(--line)"/>`);
  rows.forEach((r, i) => {
    const y = 6 + i * row;
    const bw = Math.abs(r.delta) * scale;
    const up = r.delta > 0;
    const name = esc(short(r.name));
    const tipTxt = `${name}<br>${pct(r.from)} → <b>${pct(r.to)}</b>（${up ? '+' : ''}${(r.delta * 100).toFixed(1)}pt）<br>順位 ${r.rank_from ?? '—'} → ${r.rank_to ?? '—'}`;
    s.push(`<g data-tip="${esc(tipTxt)}">`);
    s.push(`<rect x="0" y="${y - 4}" width="${w}" height="${row}" fill="transparent"/>`);
    if (up) {
      s.push(`<rect x="${mid + 1}" y="${y}" width="${bw.toFixed(1)}" height="${row - 12}" rx="4" style="fill:var(--up)"/>`);
      s.push(`<text x="${mid - 32}" y="${y + 13}" text-anchor="end" font-size="12" style="fill:var(--ink)">${name}</text>`);
      s.push(svgIcon(r.name, mid - 30, y - 6, 28));
      s.push(`<text x="${mid + bw + 6}" y="${y + 13}" font-size="11" style="fill:var(--muted)">▲${(r.delta * 100).toFixed(1)}</text>`);
    } else {
      s.push(`<rect x="${(mid - 1 - bw).toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${row - 12}" rx="4" style="fill:var(--down)"/>`);
      s.push(`<text x="${mid + 32}" y="${y + 13}" font-size="12" style="fill:var(--ink)">${name}</text>`);
      s.push(svgIcon(r.name, mid + 2, y - 6, 28));
      s.push(`<text x="${mid - bw - 6}" y="${y + 13}" text-anchor="end" font-size="11" style="fill:var(--muted)">▼${(-r.delta * 100).toFixed(1)}</text>`);
    }
    s.push('</g>');
  });
  s.push('</svg>');
  el.innerHTML = s.join('');
  bindTips(el);
}

function scatterChart(el, weekly, width) {
  if (!weekly || !weekly.available || !weekly.recent || !Object.keys(weekly.recent.pokemon).length) {
    el.innerHTML = '<p class="empty">このルールはリプレイがまだ足りません。</p>';
    return;
  }
  const pts = Object.entries(weekly.recent.pokemon)
    .filter(([, v]) => v.usage != null && v.bring != null)
    .sort((a, b) => b[1].usage - a[1].usage).slice(0, 18);
  const w = Math.max(320, width);
  const small = w < 520;
  const h = small ? 280 : 360;
  const padL = 44, padR = small ? 70 : 90, padT = 22, padB = 40;
  const iw = w - padL - padR, ih = h - padT - padB;
  const xs = pts.map(([, v]) => v.usage);
  const xmin = Math.min(...xs) * 0.9, xmax = Math.max(...xs) * 1.08;
  const ylo = Math.min(0.6, Math.floor(Math.min(...pts.map(([, v]) => v.bring)) * 10) / 10), yhi = 1;
  const X = (v) => padL + (iw * (v - xmin)) / (xmax - xmin || 1);
  const Y = (v) => padT + ih * (1 - (v - ylo) / (yhi - ylo));
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="見せ合いの使用率と選出率">`];
  for (let v = ylo; v <= 1.0001; v += 0.1) {
    s.push(`<line x1="${padL}" x2="${w - padR}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/>`);
    s.push(`<text x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${Math.round(v * 100)}%</text>`);
  }
  const span = xmax - xmin;
  const step = span > 0.2 ? 0.1 : span > 0.08 ? 0.05 : 0.02;
  for (let v = Math.ceil(xmin / step) * step; v < xmax; v += step) {
    s.push(`<text x="${X(v)}" y="${h - padB + 16}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${Math.round(v * 100)}%</text>`);
  }
  s.push(`<text x="${w - padR}" y="${h - 2}" text-anchor="end" font-size="11" style="fill:var(--muted)">見せ合いの使用率 →</text>`);
  s.push(`<text x="${padL}" y="${padT - 6}" font-size="11" style="fill:var(--muted)">↑ 選出率</text>`);
  const labels = [];
  pts.forEach(([n, v], i) => {
    const cx = X(v.usage), cy = Y(v.bring);
    const tipTxt = `${esc(short(n))}<br>使用率 <b>${pct(v.usage)}</b>（${v.teams} チーム）<br>選出率 <b>${pct(v.bring, 0)}</b>（${pct(v.bring_ci[0], 0)}〜${pct(v.bring_ci[1], 0)}）`
      + (v.games ? `<br>選出時の勝率 ${pct(v.win_shrunk, 0)}（${v.games} 戦）` : '');
    s.push(`<g data-tip="${esc(tipTxt)}"><circle cx="${cx}" cy="${cy}" r="14" fill="transparent"/>`
      + `<circle cx="${cx}" cy="${cy}" r="6" style="fill:var(--accent);stroke:var(--bg)" stroke-width="2" fill-opacity=".9"/>`);
    if (i < 8 && labels.every(([lx, ly]) => Math.abs(cy - ly) > 16 || Math.abs(cx - lx) > 96) && cx + 100 < w) {
      labels.push([cx, cy]);
      s.push(svgIcon(n, cx + 6, cy - 14, 26));
      s.push(`<text x="${cx + 32}" y="${cy + 4}" font-size="12" style="fill:var(--ink)">${esc(short(n))}</text>`);
    }
    s.push('</g>');
  });
  s.push('</svg>');
  el.innerHTML = s.join('');
  bindTips(el);
}

function bindTips(el) {
  el.querySelectorAll('[data-tip]').forEach((g) => {
    g.addEventListener('pointermove', (ev) => showTip(g.dataset.tip, ev.clientX, ev.clientY));
    g.addEventListener('pointerleave', hideTip);
  });
}

// ── 順位の推移（バンプチャート） ──────────────────────────────
function bumpChart(el, track, width) {
  const months = track.months;
  const usage = track.usage_grouped;
  const n = 10;
  const rankAt = (i) => {
    const names = Object.keys(usage).filter((k) => usage[k][i] != null && usage[k][i] > 0)
      .sort((a, b) => usage[b][i] - usage[a][i]);
    return Object.fromEntries(names.map((k, j) => [k, j + 1]));
  };
  const ranks = months.map((_, i) => rankAt(i));
  const last = ranks.at(-1);
  const top = Object.keys(last).filter((k) => last[k] <= n).sort((a, b) => last[a] - last[b]);
  const w = Math.max(320, width);
  const small = w < 520;
  const padL = small ? 34 : 44, padR = small ? 118 : 150, padT = 24, padB = 30;
  const rowH = small ? 26 : 28;
  const h = padT + padB + rowH * (n + 1);
  const iw = w - padL - padR;
  const X = (i) => padL + (iw * i) / Math.max(1, months.length - 1);
  const Y = (r) => padT + rowH * (Math.min(r, n + 1) - 1) + rowH / 2;
  const cuts = breaks(track.segments);
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="順位の推移（上位${n}匹）">`];
  for (let r = 1; r <= n; r++) s.push(`<text x="${padL - 14}" y="${Y(r) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${r}</text>`);
  s.push(`<text x="${padL - 14}" y="${Y(n + 1) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">圏外</text>`);
  for (const c of cuts) {
    const bx = (X(c - 1) + X(c)) / 2;
    s.push(`<line x1="${bx}" x2="${bx}" y1="${padT - 12}" y2="${h - padB}" stroke-dasharray="4 4" style="stroke:var(--muted)"/>`);
    s.push(`<text x="${bx + 6}" y="${padT - 2}" font-size="11" style="fill:var(--muted)">${esc(track.segments[c - 1].regulation)} → ${esc(track.segments[c].regulation)}</text>`);
  }
  months.forEach((m, i) => s.push(`<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${+m.slice(5)}月</text>`));
  const edges = [0, ...cuts, months.length];
  top.forEach((k) => {
    const on = last[k] === 1;
    const col = on ? 'var(--accent)' : 'var(--context)';
    for (let e = 0; e < edges.length - 1; e++) {
      const pts = [];
      for (let i = edges[e]; i < edges[e + 1]; i++) pts.push(`${X(i).toFixed(1)},${Y(ranks[i][k] || n + 1).toFixed(1)}`);
      s.push(`<polyline points="${pts.join(' ')}" fill="none" style="stroke:${col}" stroke-width="${on ? 3 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    months.forEach((_, i) => {
      const r = ranks[i][k];
      if (r && r <= n) s.push(`<circle cx="${X(i)}" cy="${Y(r)}" r="${on ? 4.5 : 3.5}" style="fill:${col};stroke:var(--bg)" stroke-width="2"/>`);
    });
    const y = Y(last[k]);
    const hist = months.map((m, i) => `${+m.slice(5)}月 ${ranks[i][k] ? `${ranks[i][k]}位` : '圏外'}`).join(' → ');
    s.push(`<g data-tip="${esc(`${short(k)}<br>${hist}`)}">`
      + `<rect x="${w - padR}" y="${y - rowH / 2}" width="${padR}" height="${rowH}" fill="transparent"/>`
      + svgIcon(k, w - padR + 4, y - 13, 26)
      + `<text x="${w - padR + 32}" y="${y + 4}" font-size="12" font-weight="${on ? 700 : 400}" style="fill:${on ? 'var(--ink)' : 'var(--sub)'}">${esc(short(k))}</text></g>`);
  });
  s.push('</svg>');
  el.innerHTML = s.join('');
  bindTips(el);
  return top;
}

// ── 画面の切り替え（URL の # に f=ルール&v=画面&p=ポケモン） ──────────
const route = { f: null, v: 'env', p: null };
let routeRevision = 0;
function readHash() {
  const raw = location.hash.slice(1);
  let h;
  try { h = decodeURIComponent(raw); } catch (e) { h = raw; }
  if (h && !h.includes('=')) return { f: h, v: 'env', p: null }; // 以前の #<ルール> の形
  const q = new URLSearchParams(h);
  return { f: q.get('f'), v: q.get('v') || 'env', p: q.get('p') };
}
function linkTo(next) {
  const r = { ...route, ...next };
  const q = new URLSearchParams();
  if (r.f) q.set('f', r.f);
  if (r.v && r.v !== 'env') q.set('v', r.v);
  if ((r.v === 'poke' || r.v === 'speed') && r.p) q.set('p', r.p);
  return `#${q.toString()}`;
}
function go(next) { location.hash = linkTo(next).slice(1); }
function speedFormatFor(fid) {
  const f = META.formats.find((x) => x.id === fid);
  if (!f || !f.early) return fid;
  const alt = currentFormats().find((x) => !x.early && x.family === f.family && x.bo3 === f.bo3);
  return alt ? alt.id : fid;
}

function renderPills() {
  $('formats').innerHTML = currentFormats().map((f) => `<button class="pill" type="button" data-fmt="${esc(f.id)}" aria-pressed="false">${esc(formatLabel(f))}</button>`).join('');
  $('formats').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-fmt]');
    if (b) go({ f: b.dataset.fmt });
  });
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-retry-route]')) { view = null; onRoute(); return; }
    const a = ev.target.closest('[data-view]');
    if (a) {
      ev.preventDefault();
      // すばやさとチーム診断は月次統計から計算するので、始まったばかりのルールでは、同じ系統の月次統計のあるルール（前のレギュレーション）を開く
      const f = ['speed', 'diag'].includes(a.dataset.view) ? speedFormatFor(route.f) : route.f;
      go({ v: a.dataset.view, p: null, f });
      window.scrollTo({ top: 0 });
      return;
    }
    const j = ev.target.closest('[data-jump]');
    if (j) {
      ev.preventDefault();
      const jump = () => $(j.dataset.jump).scrollIntoView({ behavior: 'smooth' });
      if (j.dataset.jump === 'sec-about' || route.v === 'env') jump();
      else { go({ v: 'env', p: null }); setTimeout(jump, 300); }
    }
  });
}

async function load(fid, revision = routeRevision) {
  const f = META.formats.find((x) => x.id === fid) || currentFormats()[0];
  if (view && view.f.id === f.id) return;
  if (f.early) {
    const [early, weekly, top] = await Promise.all([
      getJSON(`early/${f.id}.json`).catch(() => null),
      f.replay_days ? getJSON(`weekly/${f.id}.json`).catch(() => null) : Promise.resolve(null),
      getJSON(`top/${f.id}.json`).catch(() => null),
    ]);
    if (!early) throw new Error(`early/${f.id}.json が取得できません`);
    if (revision !== routeRevision) return;
    view = { f, mo: null, early, weekly, top, trend: 'usage' };
    document.querySelectorAll('.cut').forEach((el) => { el.textContent = META.default_cutoff; });
    renderEnv();
    renderRank();
    fillDatalist();
    useTeamFor(f);
    renderTeamInputs();
    return;
  }
  const [mo, track, cores, weekly, detail, top, sets] = await Promise.all([
    getJSON(`monthly/${f.id}.json`),
    getJSON(`tracks/${f.track}.json`),
    getJSON(`cores/${f.id}.json`).catch(() => null),
    f.replay_days ? getJSON(`weekly/${f.id}.json`).catch(() => null) : Promise.resolve(null),
    getJSON(`pokemon/${f.id}.json`).catch(() => null),
    f.team_select && f.replay_days ? getJSON(`top/${f.id}.json`).catch(() => null) : Promise.resolve(null),
    getJSON(`sets/${f.id}.json`).catch(() => null),
  ]);
  if (revision !== routeRevision) return;
  view = { f, mo, track, cores, weekly, detail, top, sets, trend: view ? view.trend : 'usage' };
  renderEnv();
  renderRank();
  fillDatalist();
  useTeamFor(f);
  renderTeamInputs();
}

async function onRoute() {
  const revision = ++routeRevision;
  const r = readHash();
  route.f = r.f && META.formats.some((x) => x.id === r.f) ? r.f : currentFormats()[0].id;
  route.v = ['env', 'rank', 'poke', 'select', 'diag', 'speed'].includes(r.v) ? r.v : 'env';
  route.p = r.p;
  try {
    await load(route.f, revision);
  } catch (e) {
    if (revision !== routeRevision) return;
    document.querySelectorAll('[data-view-panel]').forEach((el) => { el.hidden = el.dataset.viewPanel !== route.v; });
    const panel = document.querySelector(`[data-view-panel="${route.v}"]`);
    if (panel) {
      panel.querySelectorAll('.route-error').forEach((el) => el.remove());
      panel.insertAdjacentHTML('afterbegin', `<p class="empty route-error" role="alert">データを読めませんでした（${esc(e.message)}）。<button type="button" data-retry-route>再読み込み</button></p>`);
    }
    return;
  }
  if (revision !== routeRevision) return;
  document.querySelectorAll('.route-error').forEach((el) => el.remove());
  if (route.v === 'poke') {
    const found = view.early
      ? !!view.early.pokemon?.[route.p]
      : rankRows().some((row) => row.k === route.p) || Object.keys(view.detail?.pokemon || {}).some((k) => groupOf(k) === route.p);
    if (!found) { route.p = null; route.v = 'rank'; }
  }
  document.querySelectorAll('#formats .pill').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === route.f)));
  const formatNav = $('formats');
  const chosenFormat = formatNav?.querySelector('[aria-pressed="true"]');
  if (chosenFormat && formatNav.scrollWidth > formatNav.clientWidth) {
    formatNav.scrollLeft = Math.max(0, chosenFormat.offsetLeft - formatNav.offsetLeft - (formatNav.clientWidth - chosenFormat.offsetWidth) / 2);
  }
  const shown = route.v === 'poke' && !route.p ? 'rank' : route.v;
  document.querySelectorAll('[data-view-panel]').forEach((m) => { m.hidden = m.dataset.viewPanel !== shown; });
  document.querySelectorAll('.views a, .tabbar a[data-view]').forEach((a) => {
    const cur = a.dataset.view === shown || (shown === 'poke' && a.dataset.view === 'rank');
    if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (shown === 'poke') renderPoke(route.p);
  if (shown === 'env') drawCharts();
  if (shown === 'select') await renderSelect(revision);
  if (shown === 'diag') await renderDiag(revision);
  if (shown === 'speed') await renderSpeedView(revision);
  if (revision !== routeRevision) return;
  phrase(document.querySelector(`[data-view-panel="${shown}"]`));
  const label = formatLabel(view.f);
  document.title = {
    poke: `${short(route.p || '')}の使用率・技・持ち物（${label}）— チャンピオンズ メタ`,
    rank: `使用率ランキング（${label}）— チャンピオンズ メタ`,
    select: `選出予想（${label}）— チャンピオンズ メタ`,
    diag: `チーム診断（${label}）— チャンピオンズ メタ`,
    speed: `すばやさ調整${route.p ? `・${short(route.p)}` : ''}（${label}）— チャンピオンズ メタ`,
  }[shown] || `チャンピオンズ メタ（${label}）— 選出の傾向・選出予想・すばやさ`;
}

// ── 開始直後の環境（月次統計がまだ無いルール。src/cmeta/analysis/early.py） ─────────────
// 同じ人の同じチームを 1 つとして数えた、リプレイだけの数字。件数が目安に届くまでは「集計中」と出す
function earlyDays(t) { return new Date(t * 1000).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }); }
function earlyReadyTxt(r, what) {
  if (!r) return '';
  if (r.have >= r.need) return '';
  const left = r.days_left == null ? '' : `（いまの増え方で、あと ${Math.max(1, Math.ceil(r.days_left))} 日ほど）`;
  return `<p class="evalbox" style="margin-top:0">${what}は集計中です: ${r.have.toLocaleString()} / ${r.need.toLocaleString()}${left}。それまでの数字は揺れが大きいので、範囲を目安にしてください。</p>`;
}
function earlyRow(k, e, maxU) {
  const u = spriteUrl(k);
  const bar = (v, lo, hi) => `<span class="b"><i style="width:${(v / maxU * 100).toFixed(0)}%"></i></span>`;
  return `<li><a class="plain" href="${linkTo({ v: 'poke', p: k })}">${u ? `<img src="${esc(u)}" width="40" height="40" alt="" loading="lazy">` : ''}`
    + `<span class="nm">${esc(short(k))}</span></a>`
    + `<span class="ebar">${bar(e.usage)}<b>${pct(e.usage, 0)}</b><small class="note">${pct(e.usage_ci[0], 0)}〜${pct(e.usage_ci[1], 0)}</small></span>`
    + `<span class="ebr">${e.bring != null ? `選出 <b>${pct(e.bring, 0)}</b><small class="note">${pct(e.bring_ci[0], 0)}〜${pct(e.bring_ci[1], 0)}</small>` : ''}</span></li>`;
}
function renderEarlyEnv() {
  const E = view.early;
  const f = view.f;
  const box = $('early-env');
  if (!E || !E.available) { box.innerHTML = `<section class="card c12"><p class="empty">${esc(formatLabel(f))} は始まったばかりで、まだ集計できる試合がありません。</p></section>`; return; }
  const all = Object.entries(E.pokemon);
  const MIN = 30; // 選出・先発の割合を並べるのは、30 チーム以上に入っているポケモンだけ
  // .mu の 1 行は「アイコン・名前・数字」の 3 つに分けて並べる
  const rateLi = (k, v, lo, hi, n) => `<li>${icon(k, 36)}<a class="plain" href="${linkTo({ v: 'poke', p: k })}">${esc(short(k))}</a>`
    + `<span><b>${pct(v, 0)}</b> <small class="note">${pct(lo, 0)}〜${pct(hi, 0)}・${n}チーム</small></span></li>`;
  const withB = all.filter(([, e]) => e.bring != null && e.bring_teams >= MIN);
  const hiB = [...withB].sort((a, b) => b[1].bring - a[1].bring).slice(0, 6);
  const loB = [...withB].sort((a, b) => a[1].bring - b[1].bring).slice(0, 6);
  const withL = all.filter(([, e]) => e.lead != null && e.lead_teams >= MIN);
  const hiL = [...withL].sort((a, b) => b[1].lead - a[1].lead).slice(0, 6);
  const expB = E.k_bring / 6, expL = E.k_lead / 6;
  const usage = all.slice(0, 20);
  const USAGE_OPEN = 5; // 使用率はほかでも見られるので、上位だけ開いて残りは畳む
  const maxU = Math.max(...usage.map(([, e]) => e.usage), 0.01);
  const none = '<li class="note">まだ件数が足りません</li>';
  box.innerHTML = `<section class="hero"><div class="k">${dots(esc(formatLabel(f)), `${earlyDays(E.from)}〜${earlyDays(E.to)}`, 'Showdown の公開リプレイ')}</div>`
    + `<h1>${esc(formatLabel(f))}、<br>何を出してくるか。</h1>`
    + `<p class="lead">見せ合いのあと、実際に何を選出・先発させているか。Showdown（対戦シミュレーター）の公開リプレイ ${E.samples.toLocaleString()} 回・${E.players.toLocaleString()} 人・${E.teams.toLocaleString()} チームから（同じ人の同じ 6 匹は 1 つと数えています）。ゲーム内のランクバトルとは遊んでいる人の層が違うので、傾向がずれることがあります。</p></section>`
    + '<div class="grid">'
    + `<section class="card c12"><h2>選出の傾向 <span class="chip warn">開始直後</span></h2>${earlyReadyTxt(E.ready.bring, '選出率')}`
    + `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">入れたら、よく出す</div><ul class="mu">${hiB.map(([k, e]) => rateLi(k, e.bring, e.bring_ci[0], e.bring_ci[1], e.bring_teams)).join('') || none}</ul></div>`
    + `<div class="c6"><div class="k">見せ合いに入れても、出さないことが多い</div><ul class="mu">${loB.map(([k, e]) => rateLi(k, e.bring, e.bring_ci[0], e.bring_ci[1], e.bring_teams)).join('') || none}</ul></div></div>`
    + `<p class="note">そのポケモンをチームに入れていた人が、実際に選出した割合（チームごとに 1 票）。${E.k_bring} 匹を選ぶので、平均は ${pct(expB, 0)}。小さい数字は 95% 範囲。${MIN} チーム以上に入っているポケモンだけ。</p></section>`
    + `<section class="card c6"><h2>先発に出やすい</h2><ul class="mu">${hiL.map(([k, e]) => rateLi(k, e.lead, e.lead_ci[0], e.lead_ci[1], e.lead_teams)).join('') || none}</ul>`
    + `<p class="note">チームに入れていた人が、先発にした割合。平均は ${pct(expL, 0)}。</p></section>`
    + '<section class="card c6" id="early-induce"><h2>見せると相手の選出が変わる <span class="chip warn">参考値</span></h2><p class="empty">読み込み中…</p></section>'
    + `<section class="card c12"><h2>選出予想</h2><p>相手の 6 匹を入れると、どれを選出・先発してきそうかを確率で出します。先発が出たあとは、残りの選出に切り替わります。</p>`
    + `<p><a class="btn" href="${linkTo({ v: 'select' })}">選出予想を開く ›</a></p><p class="note" id="early-select-note"></p></section>`
    + `<section class="card c12"><h2 class="sub" style="margin-top:0">参考: 使用率（チームに入っていた割合）</h2>`
    + `<ol class="early-list compact">${usage.slice(0, USAGE_OPEN).map(([k, e]) => earlyRow(k, e, maxU)).join('')}</ol>`
    + (usage.length > USAGE_OPEN ? `<details class="table"><summary>${USAGE_OPEN + 1}〜${usage.length} 位を見る</summary>`
      + `<ol class="early-list compact">${usage.slice(USAGE_OPEN).map(([k, e]) => earlyRow(k, e, maxU)).join('')}</ol></details>` : '')
    + '<p class="note">使用率の順位は、ゲーム内や既存のサイトで、ゲーム内のデータを使って見られます。このサイトでは、上の「実際に出すか」を中心に見てください。勝率は、使う人の腕前の差が混ざるので出していません。</p></section>'
    + '</div>';
  // 選出誘導のはっきりした変化（全ポケモンから、●の付いたものを変化の大きい順に）
  const targetView = view;
  loadInduce().then((ind) => {
    if (view !== targetView || route.f !== f.id) return;
    const el = $('early-induce');
    if (!el) return;
    const rows = [];
    for (const [u, v] of Object.entries(ind?.pokemon || {})) {
      for (const r of [...(v.up || []), ...(v.down || [])]) if (r.clear && r.type_ok === true) rows.push({ u, ...r, d: r.bring[1] - r.bring[0] });
    }
    rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    el.innerHTML = '<h2>見せると相手の選出が変わる <span class="chip warn">参考値</span></h2>'
      + (rows.length ? `<ul class="mu">${rows.slice(0, 6).map((r) => `<li>${icon(r.name, 36)}`
        + `<span>${esc(short(r.u))} を見せると、<a class="plain" href="${linkTo({ v: 'poke', p: r.name })}">${esc(short(r.name))}</a> の選出が</span>`
        + `<span><b>${pct(r.bring[0], 0)} → ${pct(r.bring[1], 0)}</b></span></li>`).join('')}</ul>`
        : '<p class="empty">まだ、はっきりした変化は見つかっていません（試合が増えると出てきます）。</p>')
      + '<p class="note">相手の見せ合いにそのポケモンがいたとき、こちらの選出率がどれだけ変わったか。偶然の揺れを超え、しかもタイプ相性どおりの向きのものだけ。詳しくは各ポケモンのページ。</p>';
  });
  getJSON(`select/${f.id}.json`).then((S) => {
    if (view !== targetView || route.f !== f.id) return;
    const el = $('early-select-note');
    if (!el) return;
    if (!S?.available) { el.textContent = `いまは試合が足りず、全体の選出率から計算します（${S?.reason || ''}）。`; return; }
    const ev = S.eval;
    el.textContent = `答え合わせ（${ev.test.toLocaleString()} 試合）: 確率の当てはまりは全体の率だけより ${ev.loglik.diff >= 0 ? '+' : ''}${ev.loglik.diff.toFixed(3)}`
      + `（${ev.loglik.ci[0] > 0 ? 'はっきり良い' : '差ははっきりしない'}）。${S.track?.available ? `前向きの成績表: ${S.track.n} 試合。` : '前向きの成績表は、集計開始時点から記録しています。'}`;
  }).catch(() => {});
}
function renderEarlyRank() {
  const E = view.early;
  const q = norm($('q').value.trim());
  $('rank-asof').innerHTML = dots(esc(formatLabel(view.f)), '開始直後', 'Showdown の公開リプレイ', '同じ人の同じチームは 1 つ');
  if (!E || !E.available) { $('rank-grid').innerHTML = '<li class="empty">まだ集計できる試合がありません。</li>'; return; }
  const list = Object.entries(E.pokemon).filter(([k]) => !q || norm(ja(k)).includes(q) || norm(k).includes(q));
  const maxU = Math.max(...list.map(([, e]) => e.usage), 0.01);
  $('rank-grid').innerHTML = list.length
    ? list.map(([k, e], i) => `<li class="early-rank"><span class="no">${i + 1}</span>${earlyRow(k, e, maxU).replace(/^<li>|<\/li>$/g, '')}</li>`).join('')
    : '<li class="empty">条件に合うデータがありません。</li>';
}
function renderEarlyPoke(g) {
  const E = view.early;
  const e = E?.pokemon?.[g];
  const types = (poke(g).types || []).map((t) => `<span class="type t-${t.toLowerCase()}">${TYPE_JA[t] || t}</span>`).join(' ');
  const home = spriteUrl(g, 'home');
  $('poke-bar').innerHTML = `${home ? `<img class="home" src="${esc(home)}" width="84" height="84" alt="">` : icon(g, 64)}`
    + `<div><h1 class="nm">${esc(ja(g))}</h1><div class="meta">${types}${dots(esc(formatLabel(view.f)), '開始直後')}</div></div><div class="nav"></div>`;
  const cards = [];
  cards.push(`<section class="card c12"><h2>いまの数字 <span class="chip warn">開始直後</span></h2>${e ? `<div class="kv">`
    + `<div><span class="k">使用率（チーム）</span><b>${pct(e.usage, 0)}</b><small class="note">${pct(e.usage_ci[0], 0)}〜${pct(e.usage_ci[1], 0)}・${e.teams} チーム</small></div>`
    + (e.bring != null ? `<div><span class="k">選出率</span><b>${pct(e.bring, 0)}</b><small class="note">${pct(e.bring_ci[0], 0)}〜${pct(e.bring_ci[1], 0)}・${e.bring_teams} チーム</small></div>` : '')
    + '</div>' : '<p class="empty">まだ入っているチームが少なく、出せません。</p>'}`
    + '<p class="note">同じ人の同じ 6 匹は 1 つと数えています。技・持ち物・すばやさは、月次統計が出てから（月が終わったあと）表示します。</p></section>');
  if (view.f.team_select) cards.push('<section class="card c8" id="p-induce"><h2>選出誘導 <span class="chip warn">参考値</span></h2><p class="empty">読み込み中…</p></section>');
  $('poke-body').innerHTML = cards.join('');
  if ($('p-induce')) { const target = view; loadInduce().then((ind) => { if (view === target && $('p-induce') && route.p === g) $('p-induce').innerHTML = induceCard(ind, g); }); }
}

// ── 環境 ────────────────────────────────────────────────
function renderEnv() {
  const early = !!view.early || !view.mo;
  $('early-env').hidden = !early;
  document.querySelectorAll('#view-env > :not(#early-env)').forEach((el) => { el.hidden = early; });
  if (early) { renderEarlyEnv(); return; }
  const { f, mo, cores, weekly } = view;
  const month = mo.months.at(-1);
  const prevMonth = mo.months.at(-2);
  const cut = String(mo.default_cutoff);
  const ug = mo.usage_grouped[cut];
  const i = mo.months.length - 1;
  const top = Object.keys(ug).sort((a, b) => (ug[b][i] || 0) - (ug[a][i] || 0))[0];
  const topDelta = prevMonth && ug[top][i - 1] != null ? ug[top][i] - ug[top][i - 1] : null;
  const div = mo.diversity[month];
  const divPrev = prevMonth ? mo.diversity[prevMonth] : null;
  const turn = mo.turnover[month];
  const battles = mo.battles['0'] ? mo.battles['0'][i] : null;
  const label = formatLabel(f);
  const [y, m] = month.split('-');
  $('asof').innerHTML = dots(`${y}年${+m}月`, esc(label), 'Showdown', `レート${cut}以上`);
  document.querySelectorAll('.cut').forEach((e) => { e.textContent = cut; });

  $('t-div').innerHTML = `<div class="k">実効的なポケモン数</div><div class="big">${div ? div.q1.toFixed(1) : '—'}</div>`
    + `<div class="note">${dots(divPrev ? `前月 ${(div.q1 - divPrev.q1 >= 0 ? '+' : '')}${(div.q1 - divPrev.q1).toFixed(1)}` : '', '多いほど多様')}</div>`;
  $('t-turn').innerHTML = `<div class="k">前月からの入れ替わり</div><div class="big">${turn != null ? pct(turn) : '—'}</div>`
    + `<div class="note">${turn == null ? '前の月がありません' : turn < 0.03 ? '落ち着いた月' : turn < 0.06 ? 'やや動いた月' : '大きく動いた月'}</div>`;
  const home = spriteUrl(top, 'home');
  $('t-top').href = linkTo({ v: 'poke', p: top });
  $('t-top').innerHTML = `${home ? `<img src="${esc(home)}" width="140" height="140" alt="">` : ''}`
    + `<div class="k">使用率 1位</div><div class="big name">${esc(short(top))}</div>`
    + `<div class="note">${pct(ug[top][i])}${topDelta != null ? `<span class="chip">${topDelta >= 0 ? '▲' : '▼'}${Math.abs(topDelta * 100).toFixed(1)}</span>` : ''}</div>`;
  $('t-battles').innerHTML = `<div class="k">集計した対戦数</div><div class="big">${battles != null ? (battles >= 10000 ? `${Math.round(battles / 10000)}万` : battles.toLocaleString()) : '—'}</div><div class="note">Smogon 月次統計</div>`;

  // スマホの総評（A5）: 1位と、伸びたポケモンを文にする
  const risers = (mo.movers[month]?.rising || []).slice(0, 2).map((r) => short(r.name));
  const turnTxt = turn == null ? '' : `入れ替わりは ${pct(turn)} と${turn < 0.03 ? '小さく、上位の顔ぶれは固まりつつある' : '大きく、環境が動いている'}。`;
  $('summary').innerHTML = `${home ? `<img src="${esc(home)}" width="140" height="140" alt="">` : ''}`
    + `<div class="k">今月の総評 · ${+m}月 · ${esc(label)}</div>`
    + `<h1><span>${esc(short(top))}</span>が<br>使用率1位</h1>`
    + `<p>${turnTxt}${risers.length ? `${risers.map(esc).join('と')}が大きく伸びた。` : ''}</p>`;

  // 並び（名前を押すと詳細へ）
  const cm = cores && cores.months[month];
  const chipLink = (n) => `<a class="plain" href="${linkTo({ v: 'poke', p: groupOf(n) })}"><span>${icon(n, 28)}${esc(short(n))}</span></a>`;
  $('cores').innerHTML = cm && cm.cores.length
    ? cm.cores.slice(0, 3).map((c) => `<div class="core">${c.members.slice(0, 5).map(chipLink).join('')}</div>`).join('')
    : '<p class="empty">まとまった並びが見つかりませんでした。</p>';
  const gap = mo.cutoff_gap.months[month];
  $('gap-chip').textContent = `${mo.cutoff_gap.high} − 全体`;
  $('gap').innerHTML = gap
    ? gap.higher_at_top.slice(0, 5).map((r) => `<li><a class="plain" href="${linkTo({ v: 'poke', p: r.name })}"><span>${icon(r.name, 28)}${esc(short(r.name))}</span></a><b>+${Math.round(r.diff * 100)}pt</b></li>`).join('')
    : '';

  renderTopCard();
  renderSetMoves();

  const rec = weekly && weekly.available ? weekly.recent : null;
  $('bring-note').textContent = rec
    ? `Showdown に公開されたリプレイ 直近${rec.days}日 · ${rec.n_series.toLocaleString()} シリーズ / ${rec.n_games.toLocaleString()} 戦。Bo3 は 1 シリーズを 1 回と数えています。`
    : '';

  $('sources').innerHTML = '出典: ' + META.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.name)}</a>`).join(' / ');
  $('generated').textContent = updateStatus();
}

function drawCharts() {
  if (!view || !view.mo || $('view-env').hidden) return;
  const { mo, track, weekly } = view;
  const month = mo.months.at(-1);
  document.querySelectorAll('[data-trend]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.trend === view.trend)));
  $('sec-trend').querySelector('h2').firstChild.textContent = view.trend === 'rank' ? '順位の推移 ' : '使用率の推移 ';
  const top = view.trend === 'rank'
    ? bumpChart($('trend'), track, $('trend').clientWidth || 700)
    : trendChart($('trend'), track, $('trend').clientWidth || 700);
  trendTable($('trend-table'), track, top);
  moversChart($('movers'), mo.movers[month], $('movers').clientWidth || 380);
  scatterChart($('scatter'), weekly, $('scatter').clientWidth || 600);
}

// ── ランキング ───────────────────────────────────────────
const groupOf = (n) => poke(n).group || n;
const typeClass = (n) => { const t = poke(n).types; return t ? `t-${t[0].toLowerCase()}` : ''; };
// 検索: ひらがな/カタカナ・全角/半角・大文字/小文字を区別しない
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

function rankRows() {
  const { mo } = view;
  const cut = String(mo.default_cutoff);
  const ug = mo.usage_grouped[cut];
  const rg = mo.rank_grouped[cut];
  const i = mo.months.length - 1;
  return Object.keys(ug).filter((k) => rg[k][i] != null).sort((a, b) => rg[a][i] - rg[b][i])
    .map((k) => ({ k, rank: rg[k][i], usage: ug[k][i], prev: i > 0 ? rg[k][i - 1] : null }));
}

function renderRank() {
  if (!view.mo) { renderEarlyRank(); return; }
  const { f, mo } = view;
  const month = mo.months.at(-1);
  const [y, m] = month.split('-');
  $('rank-asof').innerHTML = dots(`${y}年${+m}月`, esc(formatLabel(f)), `レート${mo.default_cutoff}以上`, 'メガは元の姿にまとめています');
  const q = norm($('q').value.trim());
  const rows = rankRows().filter((r) => !q || norm(ja(r.k)).includes(q) || norm(r.k).includes(q));
  $('rank-grid').innerHTML = rows.length ? rows.map((r) => {
    const d = r.prev ? r.prev - r.rank : null;
    const delta = d == null ? '<small class="up-t">NEW</small>' : d > 0 ? `<small class="up-t">▲${d}</small>` : d < 0 ? `<small class="dn-t">▼${-d}</small>` : '<small class="eq-t">―</small>';
    const u = spriteUrl(r.k);
    return `<li><a class="${typeClass(r.k)}" href="${linkTo({ v: 'poke', p: r.k })}">`
      + `<span class="no">${r.rank}</span><span class="pic">${u ? `<img src="${esc(u)}" width="64" height="64" loading="lazy" alt="">` : ''}</span>`
      + `<span class="nm">${esc(nameParts(r.k)[0])}${nameParts(r.k)[1] ? `<small>${esc(nameParts(r.k)[1])}</small>` : ''}</span>`
      + `<span class="v">${pct(r.usage)}${delta}</span></a></li>`;
  }).join('') : '<li class="none">見つかりませんでした。</li>';
}

// ── ポケモン詳細 ─────────────────────────────────────────
const NATURE = {
  Hardy: 'がんばりや', Lonely: 'さみしがり', Brave: 'ゆうかん', Adamant: 'いじっぱり', Naughty: 'やんちゃ', Bold: 'ずぶとい',
  Docile: 'すなお', Relaxed: 'のんき', Impish: 'わんぱく', Lax: 'のうてんき', Timid: 'おくびょう', Hasty: 'せっかち',
  Serious: 'まじめ', Jolly: 'ようき', Naive: 'むじゃき', Modest: 'ひかえめ', Mild: 'おっとり', Quiet: 'れいせい',
  Bashful: 'てれや', Rash: 'うっかりや', Calm: 'おだやか', Gentle: 'おとなしい', Sassy: 'なまいき', Careful: 'しんちょう', Quirky: 'きまぐれ',
};
const TYPE_JA = {
  Normal: 'ノーマル', Fire: 'ほのお', Water: 'みず', Electric: 'でんき', Grass: 'くさ', Ice: 'こおり', Fighting: 'かくとう', Poison: 'どく',
  Ground: 'じめん', Flying: 'ひこう', Psychic: 'エスパー', Bug: 'むし', Rock: 'いわ', Ghost: 'ゴースト', Dragon: 'ドラゴン', Dark: 'あく',
  Steel: 'はがね', Fairy: 'フェアリー',
};
function spreadLabel(sp) {
  const [nat, pts] = sp.split(':');
  const v = (pts || '').split('/').map(Number);
  const parts = ['H', 'A', 'B', 'C', 'D', 'S'].map((s, i) => (v[i] ? `${s}${v[i]}` : '')).filter(Boolean).join(' ');
  return `${NATURE[nat] || nat} ${parts}`;
}
function barList(obj, nameOf, n = 8) {
  const rows = Object.entries(obj || {}).slice(0, n);
  if (!rows.length) return '<p class="empty">データがありません。</p>';
  return `<ul class="bl">${rows.map(([k, v]) => `<li><span class="nm">${esc(nameOf(k))}</span><span class="b"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></span><span class="p">${pct(v)}</span></li>`).join('')}</ul>`;
}
const nameIn = (kind) => (id) => { const e = NAMES[kind][id]; return (e && (e.ja || e.en)) || id; };

function renderPoke(g) {
  if (!view.mo) { renderEarlyPoke(g); return; }
  const { f, mo, track, weekly, detail } = view;
  const rows = rankRows();
  const idx = rows.findIndex((r) => r.k === g);
  const row = rows[idx];
  const cut = String(mo.default_cutoff);
  const i = mo.months.length - 1;
  const month = mo.months.at(-1);
  const forms = detail ? Object.keys(detail.pokemon).filter((k) => groupOf(k) === g).sort((a, b) => detail.pokemon[b].usage - detail.pokemon[a].usage) : [];
  // タイプと種族値は元の姿のもの（メガの値は姿ごとの見出しで分かる）
  const info = poke(g).base_stats ? poke(g) : poke(forms.find((k) => !poke(k).mega) || forms[0] || g);
  const home = spriteUrl(forms[0] || g, 'home');
  const types = (info.types || []).map((t) => `<span class="type t-${t.toLowerCase()}">${TYPE_JA[t] || t}</span>`).join(' ');
  const prev = rows[idx - 1];
  const next = rows[idx + 1];
  $('poke-bar').innerHTML = `${home ? `<img class="home" src="${esc(home)}" width="84" height="84" alt="">` : icon(g, 64)}`
    + `<div><h1 class="nm">${esc(ja(g))}</h1><div class="meta">${types}`
    + `${row ? dots(`${row.rank}位`, pct(row.usage), esc(formatLabel(f))) : dots('圏外', esc(formatLabel(f)))}</div></div>`
    + `<div class="nav">${prev ? `<a href="${linkTo({ p: prev.k })}">‹ <span class="lbl">${esc(short(prev.k))}</span></a>` : ''}`
    + `${next ? `<a href="${linkTo({ p: next.k })}"><span class="lbl">${esc(short(next.k))}</span> ›</a>` : ''}</div>`;

  const cards = [];
  const series = track.usage_grouped[g];
  if (series) cards.push('<section class="card c7"><h2>使用率の推移</h2><div class="chart" id="p-trend"></div></section>');
  const lo = mo.usage_grouped[String(mo.cutoff_gap.low)]?.[g]?.[i];
  const hi = mo.usage_grouped[String(mo.cutoff_gap.high)]?.[g]?.[i];
  const wr = weekly && weekly.available ? weekly.recent.pokemon[g] : null;
  cards.push(`<section class="card ${series ? 'c5' : 'c12'}"><h2>いまの数字</h2><div class="kv">`
    + `<div><span class="k">使用率（${cut}+）</span><b>${row ? pct(row.usage) : '—'}</b></div>`
    + `<div><span class="k">順位</span><b>${row ? `${row.rank}位` : '—'}</b></div>`
    + `<div><span class="k">全体 → ${mo.cutoff_gap.high}+</span><b>${lo != null && hi != null ? `${pct(lo, 0)} → ${pct(hi, 0)}` : '—'}</b></div>`
    + `<div><span class="k">選出率 <span class="chip warn">参考値</span></span><b>${wr ? pct(wr.bring, 0) : '—'}</b></div>`
    + (view.top?.pokemon?.[g]?.bring ? (() => { const t = view.top.pokemon[g].bring; return `<div><span class="k">選出率（上位 500 人）</span><b>${pct(t.est, 0)}</b><small class="note">${pct(t.ci[0], 0)}〜${pct(t.ci[1], 0)}・ほかの人 ${pct(t.other, 0)}・${t.players}人${t.clear ? '・はっきり差あり' : ''}</small></div>`; })() : '')
    + `</div>${wr ? `<p class="note">公開リプレイ直近28日: 見せ合い ${wr.teams} チーム、選出時の勝率 ${pct(wr.win_shrunk, 0)}（${wr.games} 戦、50% に寄せた値）</p>` : ''}</section>`);

  // 姿ごとの型（メガなど複数の姿があれば、使われている順に）
  const split = mo.mega_split[month]?.[g];
  const total = forms.reduce((s, x) => s + detail.pokemon[x].usage, 0);
  forms.forEach((k, j) => {
    const d = detail.pokemon[k];
    if (forms.length > 1) {
      const share = split && split[k] != null ? split[k] : d.usage / total;
      cards.push(`<div class="c12"><h2 style="margin:12px 4px 0;display:flex;align-items:center;gap:6px">${icon(k, 40)}${esc(ja(k))}<span class="chip">${pct(share, 0)}</span></h2></div>`);
    }
    cards.push(`<section class="card c4"><h2>技</h2>${barList(d.moves, nameIn('moves'), 10)}</section>`);
    cards.push(`<section class="card c4"><h2>持ち物</h2>${barList(d.items, nameIn('items'), 8)}<h2 class="sub">特性</h2>${barList(d.abilities, nameIn('abilities'), 3)}</section>`);
    cards.push(`<section class="card c4"><h2>能力ポイント（性格）</h2>${barList(d.spreads, spreadLabel, 5)}</section>`);
    if (view.sets?.pokemon?.[k]) cards.push(setTrendCard(view.sets, k));
    cards.push(`<div data-spd-slot="${esc(k)}" hidden></div>`);
    if (j === 0 && d.teammates.length) {
      cards.push(`<section class="card c8"><h2>同じチームに入りやすい</h2><ul class="mates">${d.teammates.map(([b, sh]) => `<li><a href="${linkTo({ p: groupOf(b) })}">${icon(b, 48)}<span>${esc(short(b))}</span><b>${pct(sh, 0)}</b></a></li>`).join('')}</ul></section>`);
    }
  });
  if (!forms.length) cards.push('<section class="card c8"><p class="empty">使用率が低いため、型のデータがありません。</p></section>');
  if (f.team_select && f.replay_days) cards.push('<section class="card c8" id="p-induce"><h2>選出誘導 <span class="chip warn">参考値</span></h2><p class="empty">読み込み中…</p></section>');
  const bs = info.base_stats;
  if (bs) {
    const lab = { hp: 'HP', atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ' };
    const sum = Object.values(bs).reduce((a, b) => a + b, 0);
    cards.push(`<section class="card c4"><h2>種族値 <span class="chip">合計 ${sum}</span></h2>${Object.entries(lab).map(([k, l]) => `<div class="stat"><span>${l}</span><b>${bs[k]}</b><span class="b"><i style="width:${Math.min(100, bs[k] / 2)}%"></i></span></div>`).join('')}</section>`);
  }
  $('poke-body').innerHTML = cards.join('');
  if (series) trendChart($('p-trend'), { ...track, usage_grouped: { [g]: series } }, $('p-trend').clientWidth || 600);
  if (document.querySelector('[data-spd-slot]')) fillSpeedCards();
  if ($('p-induce')) { const target = view; loadInduce().then((ind) => { if (view === target && $('p-induce') && route.p === g) $('p-induce').innerHTML = induceCard(ind, g); }); }
}

// ── すばやさ（src/cmeta/analysis/speed.py） ─────────────────────────
// 実数値 = trunc((種族値 + 能力ポイント + 20) × 性格補正)。レベル 50・個体値 31 固定
async function loadSpeed() {
  const target = view;
  if (target.speed === undefined) target.speed = await getJSON(`speed/${target.f.id}.json`).catch(() => null);
  return target.speed;
}
const spdStat = (b, pts, sign) => { const v = b + pts + 20; return sign === '+' ? Math.floor(v * 110 / 100) : sign === '-' ? Math.floor(v * 90 / 100) : v; };
const spdScarf = (v) => Math.floor((v * 6144 + 2047) / 4096); // Showdown の丸め
// 実数値 v が、分布の相手より先に動く確率（同速は 1/2）
const spdFaster = (v, dist) => dist.reduce((a, [x, s]) => a + (x < v ? s : x === v ? s / 2 : 0), 0);
const spdSlower = (v, dist) => dist.reduce((a, [x, s]) => a + (x > v ? s : x === v ? s / 2 : 0), 0);
// ミラーでは厳密な大小と同速を分ける。公開JSONの丸め誤差は合計で正規化する。
function spdMirrorSplit(v, dist) {
  let faster = 0, tie = 0, slower = 0;
  for (const [x, weight] of dist) {
    if (!Number.isFinite(x) || !Number.isFinite(weight) || weight <= 0) continue;
    if (x < v) faster += weight;
    else if (x === v) tie += weight;
    else slower += weight;
  }
  const total = faster + tie + slower;
  if (!total) return { faster: 0, tie: 0, slower: 0, first: 0, available: false };
  faster /= total; tie /= total; slower /= total;
  return { faster, tie, slower, first: faster + tie / 2, available: true };
}

function spdDistribution(e, mine, width = 680) {
  const W = Math.max(280, Math.min(680, width)), H = 180, L = 30, R = 16, T = 34, B = 32;
  const values = e.dist.filter(([, weight]) => weight > 0);
  if (!values.length) return '';
  const low = Math.min(mine, ...values.map(([v]) => v)) - 2;
  const high = Math.max(mine, ...values.map(([v]) => v)) + 2;
  const x = (v) => L + (v - low) / (high - low) * (W - L - R);
  const max = Math.max(...values.map(([, p]) => p));
  const bw = Math.max(3, Math.min(22, (W - L - R) / (high - low) * .75));
  const bars = values.map(([v, p]) => {
    const h = p / max * (H - T - B);
    return `<rect class="${v < mine ? 'faster' : v === mine ? 'tie' : 'slower'}" x="${x(v) - bw / 2}" y="${H - B - h}" width="${bw}" height="${h}"><title>実数値 ${v}: ${pct(p, 1)}</title></rect>`;
  }).join('');
  const ticks = [...new Set([Math.min(...values.map(([v]) => v)), spdMode(e), Math.max(...values.map(([v]) => v))])].sort((a, b) => a - b);
  return `<svg class="mirror-distribution" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ja(e.name || ''))}相手のすばやさ分布。自分の実数値 ${mine}。棒の高さは各配分の割合">`
    + `<line class="mirror-axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>${bars}`
    + `<line class="mirror-mine" x1="${x(mine)}" y1="24" x2="${x(mine)}" y2="${H - B}"/>`
    + `<text class="mirror-mine-label" x="${Math.max(72, Math.min(W - 72, x(mine)))}" y="17" text-anchor="middle">あなた ${mine}</text>`
    + ticks.map((v) => `<text x="${x(v)}" y="${H - 11}" text-anchor="middle">${v}</text>`).join('') + '</svg>';
}

function spdMirrorSummary(e, k, bare) {
  const p = spdMirrorSplit(bare, e.dist);
  if (!p.available) return '<p class="empty">ミラーの分布データがありません。</p>';
  const mode = spdMode(e);
  const next = [...e.dist].filter(([v, weight]) => weight > 0 && v >= bare)
    .map(([v]) => ({ value: v, need: Array.from({ length: 33 }, (_, i) => i).find((i) => spdStat(e.base, i, spdState.sign) > v) }))
    .filter((x) => x.need != null && x.need > spdState.sp).sort((a, b) => a.need - b.need)[0];
  const segment = (key, label) => `<span class="${key}" style="width:${p[key] * 100}%" title="${label} ${pct(p[key], 1)}"></span>`;
  const legend = (key, label) => `<div class="${key}"><b>${pct(p[key], 1)}</b><span>${label}</span></div>`;
  const gain = next ? spdMirrorSplit(spdStat(e.base, next.need, spdState.sign), e.dist).first - p.first : 0;
  return `<div class="mirror-head"><div><h2>${esc(ja(k))}同士のミラー</h2><p class="note">同じポケモン・同じ姿の、実際に使われている配分と比較</p></div>`
    + `<div class="mirror-verdict" role="status"><b>${pct(p.first, 1)}</b><small>先に動く見込み<br>同速は半分として計算</small></div></div>`
    + `<div class="mirror-matchup"><div class="mirror-side">${icon(k, 56)}<div><span class="k">あなたの素の実数値</span><strong>${bare}</strong><small>${esc(SIGN_JA[spdState.sign])}・${spdState.sp}ポイント</small></div></div>`
    + `<div class="mirror-side">${icon(k, 56)}<div><span class="k">相手にいちばん多い実数値</span><strong>${mode}</strong><small>1つの型に固定せず、分布全体と比較</small></div></div></div>`
    + `<div class="mirror-meter" role="img" aria-label="自分が速い ${pct(p.faster, 1)}、同速 ${pct(p.tie, 1)}、相手が速い ${pct(p.slower, 1)}">${segment('faster', '自分が速い')}${segment('tie', '同速')}${segment('slower', '相手が速い')}</div>`
    + `<div class="mirror-legend">${legend('faster', '自分が速い')}${legend('tie', '同速：行動順は半々')}${legend('slower', '相手が速い')}</div>`
    + `<h3>相手のすばやさは、どこに集まっている？</h3>${spdDistribution(e, bare, $('speed-out').clientWidth - 40)}<p class="note">横軸は実数値、棒の高さはその配分の割合。縦線があなたの位置です。</p>`
    + `<div class="mirror-actions">${next ? `<p>あと<strong> ${next.need - spdState.sp}ポイント</strong>で実数値${next.value}の相手を抜けます。先に動く見込みは<strong> +${(gain * 100).toFixed(1)}pt</strong>。</p><button type="button" class="pill" data-mirror-sp="${next.need}" data-mirror-sign="${spdState.sign}">${next.need}ポイントを試す</button>` : '<p>この性格では、追加のポイントで抜ける相手の配分はありません。</p>'}</div>`
    + '<p class="note">ミラーはお互いの補正条件が同じ場合の比較です。下の環境ラインに使うスカーフ・おいかぜの自分だけの補正は、ここには加えていません。先制技・トリックルーム・特性などは含みません。</p>';
}
// 環境全体（姿ごと、使用率で重み付け）に対して
function spdVsMeta(S, v, exclude) {
  let f = 0, sl = 0, u = 0;
  for (const [k, e] of Object.entries(S.pokemon)) {
    if (k === exclude) continue;
    f += e.usage * spdFaster(v, e.dist);
    sl += e.usage * spdSlower(v, e.dist);
    u += e.usage;
  }
  return { faster: f / u, slower: sl / u };
}
function spdKinds(e) {
  const b = e.base;
  const named = { [spdStat(b, 32, '+')]: '最速', [b + 52]: '準速', [b + 20]: '無振り', [spdStat(b, 0, '-')]: '最遅' };
  const out = { 最速: 0, 準速: 0, 無振り: 0, 最遅: 0, 調整: 0 };
  for (const [v, s] of e.dist) out[named[v] || '調整'] += s;
  return out;
}
const spdMode = (e) => e.dist.reduce((m, d) => (d[1] > m[1] ? d : m), [0, -1])[0];

function speedCard(S, k) {
  const e = S.pokemon[k];
  const b = e.base;
  const kinds = spdKinds(e);
  const lo = e.dist[0][0], hi = e.dist.at(-1)[0];
  const maxS = Math.max(...e.dist.map(([, s]) => s));
  const bars = e.dist.map(([v, s]) => `<i style="left:${hi > lo ? ((v - lo) / (hi - lo) * 100).toFixed(1) : 50}%;height:${Math.max(4, s / maxS * 100).toFixed(0)}%" title="${v}: ${pct(s, 0)}"></i>`).join('');
  const chips = Object.entries(kinds).filter(([, s]) => s >= 0.005).map(([n, s]) => `<span class="chip">${n} ${pct(s, 0)}</span>`).join(' ');
  const extra = [e.scarf >= 0.01 ? `こだわりスカーフ ${pct(e.scarf, 0)}` : '', e.ironball >= 0.01 ? `くろいてっきゅう ${pct(e.ironball, 0)}` : '',
    ...Object.entries(e.abilities || {}).map(([a, s]) => `${esc(nameIn('abilities')(a))} ${pct(s, 0)}`)].filter(Boolean).join('・');
  const prio = Object.entries(e.priority || {}).map(([m, s]) => `${esc(nameIn('moves')(m))} ${pct(s, 0)}`).join('・');
  const sp = e.spread;
  const spreadTxt = sp ? `実数値の 9 割は ${sp.p05}〜${sp.p95}（よくある値の実質の数 ${sp.effective.toFixed(1)}。多いほど相手から見て読みにくい）` : '';
  const id = `spd-${k.replace(/[^A-Za-z0-9]/g, '')}`;
  return `<section class="card c12 spd" id="${id}" data-form="${esc(k)}"><h2>すばやさ <span class="chip">種族値 ${b}</span> <a class="plain more" href="${linkTo({ v: 'speed', p: k })}">すばやさ調整 ›</a></h2>`
    + `<div class="spd-top"><div><div class="spd-hist">${bars}</div><div class="spd-axis"><span>${lo}</span><span>${hi}</span></div>`
    + `<p class="note" style="margin:6px 0 0">${chips}<br>${spreadTxt}${prio ? `<br>先制技: ${prio}` : ''}${extra ? `<br>${extra}` : ''}</p></div>`
    + `<div class="spd-in"><label>実数値 <input type="number" min="1" max="999" value="${spdMode(e)}" data-v></label>`
    + `<label class="chk"><input type="checkbox" data-scarf> スカーフ</label>`
    + `<div class="spd-quick">${[['最速', spdStat(b, 32, '+')], ['準速', b + 52], ['無振り', b + 20], ['最遅', spdStat(b, 0, '-')]].map(([n, v]) => `<button type="button" data-set="${v}">${n} ${v}</button>`).join('')}</div></div></div>`
    + '<div class="spd-out" data-out></div>'
    + `<p class="note">Smogon の月次統計（${esc(S.month)}・レート ${S.cutoff} 以上）の振り方から計算。環境の割合は姿ごとに使用率で重み付け。`
    + '持ち物・特性・おいかぜ・トリックルーム・まひ・ランク変化は含みません（相手のスカーフは線で確認してください）。統計には持ち物と振り方の組み合わせが無いため、スカーフの線は「最速・準速のスカーフ」を仮に置いたものです。</p></section>';
}

function speedUpdate(S, root) {
  const k = root.dataset.form;
  const e = S.pokemon[k];
  let v = +root.querySelector('[data-v]').value || 0;
  const scarf = root.querySelector('[data-scarf]').checked;
  if (scarf) v = spdScarf(v);
  const m = spdVsMeta(S, v, null);
  const mirror = spdFaster(v, e.dist);
  const prev = e.prev_dist ? spdFaster(v, e.prev_dist) : null;
  // 近くの線（上下 12 以内、多い順に 10 本まで）
  const near = S.lines.filter((l) => Math.abs(l.value - v) <= 12).sort((a, b) => b.value - a.value || b.weight - a.weight).slice(0, 12);
  const mark = (x) => (v > x ? '<b class="up">抜ける</b>' : v === x ? '<b>同速</b>' : '<b class="down">抜かれる</b>');
  const lineRow = (l) => `<li>${icon(l.name, 28)}<span class="v">${l.value}</span><span>${esc(short(l.name))} ${l.scarf ? 'スカーフ' : ''}${l.kind}`
    + ` <small class="note">${l.scarf ? `スカーフ ${pct(l.scarf_share, 0)}・` : ''}${esc(short(l.name))}の ${pct(l.share, 0)}${l.aimed >= 0.025 ? `・${l.value + 1} に合わせる調整が多い` : ''}</small></span>${mark(l.value)}</li>`;
  root.querySelector('[data-out]').innerHTML = `<div class="kv">`
    + `<div><span class="k">${scarf ? `スカーフ込み ${v}` : `実数値 ${v}`}: 環境で先に動ける</span><b>${pct(m.faster, 0)}</b></div>`
    + `<div><span class="k">後に動ける</span><b>${pct(m.slower, 0)}</b></div>`
    + `<div><span class="k">ミラーで先に動ける</span><b>${pct(mirror, 0)}</b>${prev != null ? `<small class="note">先月 ${pct(prev, 0)}</small>` : ''}</div></div>`
    + (near.length ? `<div class="k" style="margin-top:10px">近くの線</div><ul class="spd-lines">${near.map(lineRow).join('')}</ul>` : '');
}

async function fillSpeedCards() {
  const S = await loadSpeed();
  if (!S) return;
  document.querySelectorAll('[data-spd-slot]').forEach((slot) => {
    const k = slot.dataset.spdSlot;
    if (!S.pokemon[k]) { slot.remove(); return; }
    slot.outerHTML = speedCard(S, k);
  });
  document.querySelectorAll('.spd').forEach((root) => {
    const upd = () => speedUpdate(S, root);
    root.querySelector('[data-v]').addEventListener('input', upd);
    root.querySelector('[data-scarf]').addEventListener('change', upd);
    root.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => { root.querySelector('[data-v]').value = b.dataset.set; upd(); }));
    upd();
  });
}

// チーム診断: メガストーンを持つ割合が 5 割以上ならメガの姿、それ以外はメガでない姿で一番多いもの
function spdFormOf(S, g) {
  const forms = Object.entries(S.pokemon).filter(([, e]) => e.group === g);
  if (!forms.length) return null;
  const split = view.mo.mega_split?.[view.mo.months.at(-1)]?.[g] || {};
  const megaShare = Object.entries(split).filter(([f]) => f.includes('-Mega')).reduce((a, [, s]) => a + s, 0);
  const want = megaShare >= 0.5;
  const cands = forms.filter(([f]) => f.includes('-Mega') === want);
  return (cands.length ? cands : forms).sort((a, b) => b[1].usage - a[1].usage)[0][0];
}

// ── すばやさ調整（ミラー）: 何ポイント振れば、同じポケモンどうしで先に動けるか ─────────
const SPD_THRESH = [[0.5, '5割'], [0.8, '8割'], [0.9, '9割'], [1, '統計上100%']];
// 振る数 0〜32 のうち、ミラーで先に動く確率が thr 以上になる最小の振る数（届かなければ null）
function spdNeed(e, dist, sign, thr) {
  for (let sp = 0; sp <= 32; sp++) {
    const p = spdFaster(spdStat(e.base, sp, sign), dist);
    if (thr >= 1 ? p >= 1 - 1e-9 : p >= thr - 1e-9) return sp;
  }
  return null;
}
function spdMirrorChart(e, width) {
  const W = Math.max(280, Math.min(width, 720)), H = 220, L = 38, R = 12, T = 12, B = 30;
  const x = (sp) => L + sp / 32 * (W - L - R);
  const y = (p) => T + (1 - p) * (H - T - B);
  const line = (dist, sign) => Array.from({ length: 33 }, (_, sp) => `${x(sp).toFixed(1)},${y(spdFaster(spdStat(e.base, sp, sign), dist)).toFixed(1)}`).join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="gl"/><text x="${L - 6}" y="${y(p) + 4}" text-anchor="end">${Math.round(p * 100)}%</text>`).join('');
  const xt = [0, 8, 16, 24, 32].map((sp) => `<text x="${x(sp)}" y="${H - 10}" text-anchor="middle">${sp}</text>`).join('');
  const series = [];
  if (e.prev_dist) {
    series.push(`<polyline points="${line(e.prev_dist, '=')}" class="ln prev"/>`, `<polyline points="${line(e.prev_dist, '+')}" class="ln prev plus"/>`);
  }
  series.push(`<polyline points="${line(e.dist, '=')}" class="ln now"/>`, `<polyline points="${line(e.dist, '+')}" class="ln now plus"/>`);
  return `<svg class="spd-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="ポイントごとのミラーで先に動く確率">${grid}${xt}${series.join('')}`
    + `<text x="${W - R}" y="${H - 10}" text-anchor="end">ポイント</text></svg>`
    + `<p class="note spd-legend"><span class="sw now"></span>今月 無補正 <span class="sw now plus"></span>今月 上昇の性格${e.prev_dist ? ' <span class="sw prev"></span>先月（点線）' : ''}</p>`;
}

// ── すばやさ調整の画面: 自分の配分を入れると、環境の中で何を抜けて何に抜かれるかが分かる ─────────
// ① 入力 → ② 答え（環境・ミラーで先に動く割合と、次に抜けるライン）→ ③ ライン表（実際に使われている値だけ）→ ④ ミラー → ⑤ 注意
// ライン表は、使用率 SPD_ROW_USAGE 以上の姿の、その姿の SPD_ROW_SHARE 以上が集まる値（と、月次のスカーフの線）。
// 暫定の作り（2026-09）。見せ方は変わる可能性がある
const SPD_ROW_USAGE = 0.01;
const SPD_ROW_SHARE = 0.15;
const SPD_NEAR = 15;
const spdState = { k: null, sign: '=', sp: 0, scarf: false, tw: false, all: false };
const SIGN_JA = { '+': 'すばやさ上昇の性格', '=': '無補正の性格', '-': 'すばやさ下降の性格' };

// いちばん多い実数値になる配分（無補正 → 上昇 → 下降の順に、少ない振り数から探す）
function spdDefault(e) {
  const mode = spdMode(e);
  for (const sign of ['=', '+', '-']) for (let sp = 0; sp <= 32; sp++) if (spdStat(e.base, sp, sign) === mode) return { sign, sp };
  return { sign: '+', sp: 32 };
}
function spdKindOf(e, v) {
  const b = e.base;
  return v === spdStat(b, 32, '+') ? '最速' : v === b + 52 ? '準速' : v === b + 20 ? '無振り' : v === spdStat(b, 0, '-') ? '最遅' : '調整';
}
// 環境のライン（実際に使われている値だけ）: {value, name, share, weight, kind, scarf}
function spdRows(S) {
  const rows = [];
  for (const [n, e] of Object.entries(S.pokemon)) {
    if (e.usage < SPD_ROW_USAGE) continue;
    for (const [v, s] of e.dist) if (s >= SPD_ROW_SHARE) rows.push({ value: v, name: n, share: s, weight: e.usage * s, kind: spdKindOf(e, v), scarf: false });
  }
  for (const l of S.lines) if (l.scarf) rows.push({ value: l.value, name: l.name, share: l.share, weight: l.weight, kind: l.kind, scarf: true, scarf_share: l.scarf_share });
  return rows.sort((a, b) => b.value - a.value || b.weight - a.weight);
}
// 自分の実数値（スカーフ・おいかぜ込み）
function spdMineAt(e, sp) {
  let v = spdStat(e.base, sp, spdState.sign);
  if (spdState.scarf) v = spdScarf(v);
  if (spdState.tw) v *= 2;
  return v;
}
// 相手の値 x を抜く（x より大きくなる）のに必要な振り数（いまの性格で）。抜けなければ null
function spdToPass(e, x) {
  for (let sp = 0; sp <= 32; sp++) if (spdMineAt(e, sp) > x) return sp;
  return null;
}

async function renderSpeedView(revision = routeRevision) {
  const S = await loadSpeed();
  if (revision !== routeRevision) return;
  const out = $('speed-out');
  const label = formatLabel(view.f);
  if (!S) {
    $('speed-asof').innerHTML = dots(esc(label));
    out.innerHTML = `<section class="card c12"><p class="empty">${view.mo ? 'このルールは、すばやさのデータがありません。' : 'すばやさ（振り方の分布）は月次統計から計算するので、始まったばかりのこのルールは、月が終わって月次統計が出てから表示します。'}</p></section>`;
    return;
  }
  $('speed-asof').innerHTML = dots(esc(label), `Smogon の月次統計 ${esc(S.month)}${S.prev_month ? `（先月 ${esc(S.prev_month)}）` : ''}`, `レート ${S.cutoff} 以上`);
  const forms = Object.entries(S.pokemon).sort((a, b) => b[1].usage - a[1].usage);
  const inp = $('spd-q');
  $('spd-names').innerHTML = forms.map(([k]) => `<option value="${esc(ja(k))}"></option>`).join('');
  if (!inp.dataset.bound) {
    inp.dataset.bound = '1';
    inp.addEventListener('change', () => {
      const t = norm(inp.value.trim());
      const hit = Object.keys(view.speed?.pokemon || {}).find((k) => norm(ja(k)) === t || norm(k) === t || norm(short(k)) === t);
      if (hit) go({ v: 'speed', p: hit });
    });
  }
  // 最初に開くポケモン: M-B はアシレーヌ（ミラーのすばやさ調整が目立つ、見本向きの例）。ほかは使用率 1 位
  const first = /regmb/.test(view.f.id) && S.pokemon.Primarina ? 'Primarina' : forms[0][0];
  const k = route.p && S.pokemon[route.p] ? route.p : first;
  inp.value = ja(k);
  const e = S.pokemon[k];
  const key = `${view.f.id}:${k}`;
  if (spdState.k !== key) Object.assign(spdState, { k: key, scarf: false, tw: false, all: false }, spdDefault(e));
  const doubles = view.f.game_type === 'doubles';

  // ① 入力
  const signBtn = (s, t) => `<button type="button" data-sign="${s}" aria-pressed="${spdState.sign === s}">${t}</button>`;
  const input = '<section class="card c12"><div class="spd-form">'
    + `<div class="spd-who">${icon(k, 56)}<div><h2 style="margin:0">${esc(ja(k))}</h2><div class="note">種族値 ${e.base}・使用率 ${pct(e.usage, 1)}</div></div></div>`
    + `<div class="spd-ctl"><div><span class="k">性格</span> <div class="seg" role="group" aria-label="性格">${signBtn('+', '上昇')}${signBtn('=', '無補正')}${signBtn('-', '下降')}</div></div>`
    + `<div class="spd-sp"><label for="spd-points" class="k">すばやさのポイント</label><input id="spd-points" type="range" min="0" max="32" step="1" value="${spdState.sp}" data-sp><input aria-label="すばやさのポイント（数値入力）" type="number" min="0" max="32" step="1" value="${spdState.sp}" data-sp-number><output data-sp-out hidden>${spdState.sp}</output></div>`
    + `<div class="spd-chk"><label class="chk"><input type="checkbox" data-scarf ${spdState.scarf ? 'checked' : ''}> こだわりスカーフ</label>`
    + (doubles ? `<label class="chk"><input type="checkbox" data-tw ${spdState.tw ? 'checked' : ''}> おいかぜ（自分だけ 2 倍）</label>` : '')
    + '</div></div><div class="spd-stat"><span class="k">実数値</span><b data-stat></b></div></div>'
    + `<div class="spd-presets" role="group" aria-label="よく使う配分"><button class="pill" type="button" data-sp-preset="0" data-sign-preset="=">無振り</button><button class="pill" type="button" data-sp-preset="32" data-sign-preset="=">準速</button><button class="pill" type="button" data-sp-preset="32" data-sign-preset="+">最速</button><button class="pill" type="button" data-sp-preset="${spdDefault(e).sp}" data-sign-preset="${spdDefault(e).sign}">いちばん多い配分</button></div>`
    + '<p class="note" style="margin:8px 0 0">0〜32ポイントで調整。最初は、このポケモンにいちばん多い実数値です。</p></section>';
  // ②③ は入力のたびに描き直す
  const result = '<section class="card c12 mirror-summary" data-spd-mirror></section><section class="card c12" data-spd-result></section><section class="card c12" data-spd-lines></section>';

  // ④ ミラー
  const needTxt = (dist, sign) => SPD_THRESH.map(([thr, lab]) => {
    const sp = spdNeed(e, dist, sign, thr);
    const why = sp == null ? 'この性格では届かない' : `実数値 ${spdStat(e.base, sp, sign)}`;
    return `<div><span class="k">${lab}</span><b>${sp == null ? '—' : sp}</b><small class="note">${why}</small></div>`;
  }).join('');
  const creep = e.prev_dist ? ['=', '+'].map((sign) => {
    const a = spdNeed(e, e.prev_dist, sign, 0.9), b = spdNeed(e, e.dist, sign, 0.9);
    return `${sign === '=' ? '無補正' : '上昇'}の性格で 9 割: 先月 ${a == null ? '届かない' : a} → 今月 ${b == null ? '届かない' : b}`;
  }).join('・') : '';
  const others = forms.slice(0, 30).filter(([, x]) => x.usage >= 0.02).map(([n, x]) => {
    const a = spdNeed(x, x.dist, '=', 0.9), b = spdNeed(x, x.dist, '+', 0.9);
    return `<tr><td><a class="plain" href="${linkTo({ v: 'speed', p: n })}">${icon(n, 28)} ${esc(short(n))}</a></td><td>${x.base}</td><td>${pct(x.usage, 1)}</td>`
      + `<td>${a == null ? '届かない' : a}</td><td>${b == null ? '届かない' : b}</td></tr>`;
  }).join('');
  const mirror = `<section class="card c12"><details class="mirror-details"><summary>もっと調べる：性格ごとの必要ポイントと先月との比較</summary><h2>ミラーの調整早見表</h2>`
    + `<div class="spd-mirror"><div><div class="k">無補正の性格: 必要なポイント</div><div class="kv kv4">${needTxt(e.dist, '=')}</div>`
    + `<div class="k" style="margin-top:10px">すばやさ上昇の性格: 必要なポイント</div><div class="kv kv4">${needTxt(e.dist, '+')}</div>`
    + (creep ? `<p class="note">先月からの変化: ${creep}</p>` : '') + `</div><div>${spdMirrorChart(e, 560)}</div></div>`
    + '<details class="table"><summary>ほかのポケモンのミラー（9 割で先に動くのに必要なポイント）</summary>'
    + `<table class="tt"><thead><tr><th>ポケモン</th><th>種族値</th><th>使用率</th><th>無補正</th><th>上昇</th></tr></thead><tbody>${others}</tbody></table></details></details></section>`;

  // ⑤ 注意
  const prio = Object.entries(e.priority || {}).map(([m, s]) => `${esc(nameIn('moves')(m))}（${pct(s, 0)}）`).join('・');
  const notes = '<section class="card c12"><p class="note" style="margin:0">'
    + (prio ? `${esc(ja(k))}の先制技: ${prio}。先制技は、すばやさに関係なく先に動きます。<br>` : '')
    + (e.spread ? `${esc(ja(k))}の実数値は、9 割が ${e.spread.p05}〜${e.spread.p95} の間にあります。<br>` : '')
    + `数字は Smogon の月次統計（Pokémon Showdown の対戦・レート ${S.cutoff} 以上）の振り方から計算した、環境の中での割合です。環境の割合は、姿ごとに使用率で重み付けしています。`
    + ' 実数値 = trunc((種族値 + ポイント + 20) × 性格補正)、レベル 50。相手のこだわりスカーフは、スカーフを持つ割合が高い姿の「最速・準速のスカーフ」だけを線にしています（持ち物と振り方の組み合わせは統計に無いため）。'
    + ' トリックルーム・まひ・ランク変化・特性（すいすい など）は含みません。メガシンカする場合は、メガの姿を選んでください。</p></section>';

  out.innerHTML = input + result + mirror + notes;
  const redraw = () => spdRedraw(S, k);
  out.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => {
    spdState.sign = b.dataset.sign;
    out.querySelectorAll('[data-sign]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    redraw();
  }));
  const setPoints = (value, sign = spdState.sign) => {
    spdState.sp = Math.max(0, Math.min(32, Math.trunc(Number(value) || 0)));
    spdState.sign = sign;
    out.querySelector('[data-sp]').value = spdState.sp;
    out.querySelector('[data-sp-number]').value = spdState.sp;
    out.querySelectorAll('[data-sign]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sign === sign));
    redraw();
  };
  out.querySelector('[data-sp]').addEventListener('input', (ev) => setPoints(ev.target.value));
  out.querySelector('[data-sp-number]').addEventListener('input', (ev) => {
    if (ev.target.value !== '' && !ev.target.validity.badInput) setPoints(ev.target.value);
  });
  out.querySelector('[data-sp-number]').addEventListener('change', (ev) => setPoints(ev.target.value));
  out.querySelectorAll('[data-sp-preset]').forEach((b) => b.addEventListener('click', () => setPoints(b.dataset.spPreset, b.dataset.signPreset)));
  out.querySelector('[data-scarf]').addEventListener('change', (ev) => { spdState.scarf = ev.target.checked; redraw(); });
  out.querySelector('[data-tw]')?.addEventListener('change', (ev) => { spdState.tw = ev.target.checked; redraw(); });
  redraw();
}

function spdRedraw(S, k) {
  const e = S.pokemon[k];
  const v = spdMineAt(e, spdState.sp);
  const bare = spdStat(e.base, spdState.sp, spdState.sign);
  const out = $('speed-out');
  out.querySelector('[data-sp-out]').textContent = spdState.sp;
  out.querySelector('[data-sp-number]').value = spdState.sp;
  out.querySelector('[data-stat]').innerHTML = `${v}${v !== bare ? ` <small class="note">（素の値 ${bare}）</small>` : ''}`;
  const m = spdVsMeta(S, v, null);
  // ミラーは素の値どうしで比べる（相手も同じ条件とは限らないので、スカーフ・おいかぜは足さない）
  out.querySelector('[data-spd-mirror]').innerHTML = spdMirrorSummary(e, k, bare);
  out.querySelectorAll('[data-mirror-sp]').forEach((b) => b.addEventListener('click', () => {
    spdState.sp = +b.dataset.mirrorSp;
    spdState.sign = b.dataset.mirrorSign;
    out.querySelector('[data-sp]').value = spdState.sp;
    out.querySelectorAll('[data-sign]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.sign === spdState.sign));
    spdRedraw(S, k);
  }));
  const rows = spdRows(S).filter((r) => r.name !== k || r.scarf);
  // 次に抜けるライン: 自分以上の値のうち、少ないポイントで抜けるもの（同じなら環境での重みが大きいもの）
  const ahead = rows.filter((r) => r.value >= v).map((r) => ({ ...r, need: spdToPass(e, r.value) })).filter((r) => r.need != null && r.need > spdState.sp);
  const next = ahead.sort((a, b) => a.need - b.need || b.weight - a.weight)[0];
  const lineName = (r) => `${esc(short(r.name))}（${r.scarf ? 'スカーフ・' : ''}${r.kind}）`;
  out.querySelector('[data-spd-result]').innerHTML = '<h2>ほかのポケモンも含めた、環境での位置</h2><div class="kv">'
    + `<div><span class="k">環境の相手より先に動く</span><b>${pct(m.faster, 0)}</b><small class="note">同速は半分として数える</small></div>`
    + `<div><span class="k">環境の相手に先に動かれる</span><b>${pct(m.slower, 0)}</b><small class="note">スカーフ・おいかぜの設定を反映</small></div></div>`
    + (next ? `<p class="spd-next">あと <b>${next.need - spdState.sp}</b> ポイント（計 ${next.need}）で、${icon(next.name, 28)} ${lineName(next)} の実数値 ${next.value} を抜けます。<small class="note">その姿の ${pct(next.share, 0)} がこの値</small></p>`
      : '<p class="spd-next note">この性格では、この先に抜けるラインはありません。</p>');
  // ③ ライン表
  // 同じ実数値のラインは 1 行にまとめる（環境での重みの大きい順に並べる）
  const byVal = new Map();
  for (const r of rows) { if (!byVal.has(r.value)) byVal.set(r.value, []); byVal.get(r.value).push(r); }
  const vals = [...byVal.keys()].sort((a, b) => b - a);
  const shownVals = spdState.all ? vals : vals.filter((x) => Math.abs(x - v) <= SPD_NEAR);
  const you = `<tr class="you"><td>${v}</td><td colspan="2">▶ あなた（${SIGN_JA[spdState.sign]}・${spdState.sp} ポイント${spdState.scarf ? '・スカーフ' : ''}${spdState.tw ? '・おいかぜ' : ''}）</td></tr>`;
  const body = [];
  let youDone = false;
  for (const x of shownVals) {
    if (!youDone && x < v) { body.push(you); youDone = true; }
    const need = x >= v ? spdToPass(e, x) : null;
    const res = x < v ? '<b class="up">抜ける</b>' : x === v ? '<b>同速</b>' : '<b class="down">抜かれる</b>';
    const hint = x >= v ? `<small class="note">${need == null ? 'この性格では抜けない' : `${need} ポイントで抜ける`}</small>` : '';
    const who = byVal.get(x).sort((a, b) => b.weight - a.weight).map((r) => `<a class="plain spd-mon" href="${linkTo({ v: 'speed', p: r.name })}">${icon(r.name, 24)}${esc(short(r.name))}`
      + `<small class="note">${r.scarf ? `スカーフ・${r.kind}（持つ ${pct(r.scarf_share, 0)}）` : `${r.kind} ${pct(r.share, 0)}`}</small></a>`).join('');
    body.push(`<tr><td>${x}</td><td class="spd-who-list">${who}</td><td>${res}${hint}</td></tr>`);
  }
  if (!youDone) body.push(you);
  const hidden = vals.length - shownVals.length;
  out.querySelector('[data-spd-lines]').innerHTML = '<h2>近くのライン <span class="chip">実際に使われている値</span></h2>'
    + `<div class="tt-wrap"><table class="tt spd-rows"><thead><tr><th>実数値</th><th>この値のポケモン（配分・その姿のうちの割合）</th><th>あなたから見て</th></tr></thead><tbody>${body.join('')}</tbody></table></div>`
    + `<p class="note">使用率 ${pct(SPD_ROW_USAGE, 0)} 以上の姿で、その姿の ${pct(SPD_ROW_SHARE, 0)} 以上が集まる値だけを並べています（理論上ありうる値ではなく、環境に実際にいる値）。`
    + `${spdState.all ? '' : `あなたの実数値の上下 ${SPD_NEAR} まで。`}</p>`
    + `<button type="button" class="pill" data-spd-all>${spdState.all ? '近くだけにする' : `すべて表示（ほか ${hidden} 行）`}</button>`;
  out.querySelector('[data-spd-all]').addEventListener('click', () => { spdState.all = !spdState.all; spdRedraw(S, k); });
}

// ── 型の移り変わり（src/cmeta/analysis/sets.py）: 月 × レート帯。確かさは出さず、大きさだけ ──────
const SET_NOTE = '月次統計の件数は対戦の数で、同じ人の同じチームが何度も数えられているため、偶然の揺れの大きさ（95% 範囲）は出せません。上位の足切りは人が少なく、少数の人のチームで大きく動くことがあります。';
function setTrendCard(S, k) {
  const e = S.pokemon[k];
  const cols = [[S.prev_month, S.default_cutoff, `先月（${S.default_cutoff}+）`], [S.month, S.default_cutoff, `今月（${S.default_cutoff}+）`],
    [S.month, S.low_cutoff, `今月・全体`], [S.month, S.high_cutoff, `今月・${S.high_cutoff}+`]].filter(([m]) => m);
  const big = new Set(S.changes.filter((c) => c.name === k).map((c) => `${c.type}:${c.kind}:${c.key}`));
  const rows = (kind, label, n) => {
    const keys = Object.keys(e[kind]).sort((a, b) => (e[kind][b][`${S.month}:${S.default_cutoff}`] || 0) - (e[kind][a][`${S.month}:${S.default_cutoff}`] || 0)).slice(0, n);
    return keys.map((x) => {
      const v = e[kind][x];
      const cell = ([m, c]) => { const y = v[`${m}:${c}`]; return `<td>${y == null ? '—' : pct(y, 0)}</td>`; };
      const mark = (big.has(`month:${kind}:${x}`) ? ' <small class="note">先月から大きく動いた</small>' : '') + (big.has(`top:${kind}:${x}`) ? ' <small class="note">上位で違う</small>' : '');
      return `<tr><td>${esc(nameIn(kind)(x))}${mark}</td>${cols.map(cell).join('')}</tr>`;
    }).join('');
  };
  const head = `<tr><th></th>${cols.map(([, , l]) => `<th>${l}</th>`).join('')}</tr>`;
  return `<section class="card c12"><h2>型の移り変わり（${esc(ja(k))}）</h2><table class="tt set-tbl"><thead>${head}</thead><tbody>`
    + `<tr><th colspan="${cols.length + 1}" class="k">持ち物</th></tr>${rows('items', '持ち物', 6)}`
    + `<tr><th colspan="${cols.length + 1}" class="k">技</th></tr>${rows('moves', '技', 8)}</tbody></table>`
    + `<p class="note">Smogon の月次統計（そのポケモンを入れたチームのうち、その持ち物・技を入れていた割合）。「大きく動いた」は 15pt 以上の差。${SET_NOTE}</p></section>`;
}
function renderSetMoves() {
  const S = view.sets;
  const sec = $('sec-sets');
  if (!S || !S.changes?.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const li = (c) => `<li><a class="plain" href="${linkTo({ v: 'poke', p: groupOf(c.name) })}"><span>${icon(c.name, 28)}${esc(short(c.name))}</span></a>`
    + `<span>${esc(nameIn(c.kind)(c.key))} <b>${pct(c.a, 0)} → ${pct(c.b, 0)}</b></span></li>`;
  const month = S.changes.filter((c) => c.type === 'month').slice(0, 8);
  const top = S.changes.filter((c) => c.type === 'top').slice(0, 8);
  $('sets-out').innerHTML = `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">先月から大きく動いた（${esc(S.prev_month || '')} → ${esc(S.month)}、${S.default_cutoff}+）</div><ul class="mu">${month.map(li).join('') || '<li class="note">なし</li>'}</ul></div>`
    + `<div class="c6"><div class="k">全体と上位（${S.high_cutoff}+）で違う（${esc(S.month)}）</div><ul class="mu">${top.map(li).join('') || '<li class="note">なし</li>'}</ul></div></div>`
    + `<p class="note">15pt 以上動いたもの。${SET_NOTE}</p>`;
}

// ── 上位 500 人の選出（src/cmeta/analysis/toprate.py） ──────────────────
function renderTopCard() {
  const T = view.top;
  const sec = $('sec-top');
  if (!T || !T.available) { sec.hidden = true; return; }
  sec.hidden = false;
  const rows = Object.entries(T.pokemon).filter(([, v]) => v.bring && v.bring.players >= 10)
    .map(([k, v]) => ({ k, d: v.bring.est - v.bring.other, v: v.bring }));
  const nClear = rows.filter((r) => r.v.clear).length;
  const li = (r) => `<li class="top-player-row"><a class="plain top-player-name" href="${linkTo({ v: 'poke', p: r.k })}">${icon(r.k, 36)}<span>${esc(short(r.k))}</span></a>`
    + `<div class="top-player-metric"><div class="top-player-values"><b>${pct(r.v.est, 0)}</b><small>ほかの人 ${pct(r.v.other, 0)}</small></div>`
    + `<div class="top-player-track" role="img" aria-label="上位の人 ${pct(r.v.est, 0)}、ほかの人 ${pct(r.v.other, 0)}"><span class="top-player-fill" style="width:${r.v.est * 100}%"></span><i class="top-player-other" style="left:${r.v.other * 100}%"></i></div>`
    + `<small class="top-player-meta">95%範囲 ${pct(r.v.ci[0], 0)}〜${pct(r.v.ci[1], 0)} · ${r.v.players}人${r.v.clear ? ' · 差が明確' : ''}</small></div></li>`;
  const more = rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
  const less = rows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  $('top-out').innerHTML = (nClear ? '' : '<p class="top-note">今のデータでは、上位の人との<strong>明確な差は確認されていません。</strong>下の違いは参考として見てください。</p>')
    + '<p class="note top-key">棒：上位の人の選出率 ／ 縦の印：ほかの人の選出率</p>'
    + `<div class="top-compare"><section><h3>上位の人が、より選んでいる</h3><ul class="top-player-list">${more.map(li).join('') || '<li class="empty">比較できるデータがありません。</li>'}</ul></section>`
    + `<section><h3>上位の人が、あまり選んでいない</h3><ul class="top-player-list">${less.map(li).join('') || '<li class="empty">比較できるデータがありません。</li>'}</ul></section></div>`
    + `<details class="top-method"><summary>データの件数と、比較の読み方</summary><p class="note">ランキング表の上位 500 人（記録 ${T.ladder_days} 日ぶん）が選んだ ${T.samples_top.toLocaleString()} 回（10 人以上から来ているポケモンだけ）と、ほかの ${T.samples_other.toLocaleString()} 回の比較（公開リプレイ）。`
    + ` 同じ人の選び方は似るので（似かた ${T.icc_bring}）、その分だけ件数を割り引き、ほかの人の選出率に寄せて推定した値と 95% 範囲です。`
    + `人で半分に分けて確かめると、95% のつもりの範囲に実際に ${pct(T.coverage_bring, 0)} が入りました。偶然の差を除く補正（FDR 5%）もかけています。上位かどうかは今のランキング表で決めています。</p></details>`;
}

// ── 選出誘導（src/cmeta/analysis/induce.py） ───────────────────────
async function loadInduce() {
  const target = view;
  if (target.induce === undefined) target.induce = await getJSON(`induce/${target.f.id}.json`).catch(() => null);
  return target.induce;
}
function induceRow(r, which) {
  const [p, q] = r[which];
  return `<li>${icon(r.name, 36)}<span>${esc(short(r.name))}${r.clear ? ' <b class="clear" title="偶然の揺れ（95%）を超える変化">●</b>' : ''}`
    + `${r.type_ok ? ' <small class="note">相性どおり</small>' : ''}</span><span><b>${pct(p, 0)} → ${pct(q, 0)}</b> <small class="note">${r.n}回</small></span></li>`;
}
function induceCard(ind, g) {
  const head = '<h2>選出誘導 <span class="chip warn">参考値</span></h2>';
  const e = ind?.pokemon?.[g];
  if (e && e.strength.bring == null) return `${head}<p class="empty">変化を比べられる相手が足りないため、まだ出せません。</p>`;
  if (!e) return `${head}<p class="empty">見せ合いの件数が足りないため、まだ出せません（${ind ? `${ind.min_u} 回以上` : 'データなし'}が必要）。</p>`;
  const all = Object.values(ind.pokemon).map((v) => v.strength.bring).filter((v) => v != null).sort((a, b) => b - a);
  const rank = all.indexOf(e.strength.bring) + 1;
  const up = e.up.filter((r) => r.bring[1] > r.bring[0]);
  const down = e.down.filter((r) => r.bring[1] < r.bring[0]);
  const none = '<li class="note">目立つ変化なし</li>';
  const pairs = (e.lead_pairs || []).filter((r) => r.share[1] > r.share[0]).slice(0, 3);
  return head
    + `<p class="note" style="margin-top:0">${esc(short(g))}を見せ合いに入れると、相手の選出がどれだけ変わるか。`
    + ` 強さ <b>${(e.strength.bring * 100).toFixed(1)} pt</b>（調べた ${all.length} 匹のうち ${rank} 位。見せ合い ${e.n} 回）${e.stone >= 0.5 ? '・メガシンカ要員' : ''}`
    + (e.strength.bring < 0.005
      ? (up.concat(down).some((r) => r.clear)
        ? '。全体としての誘導は小さく、ほとんどの相手の選出は変わりません（●の付いた相手だけは、はっきり変わります）。'
        : '。<b>偶然の揺れと区別できないくらい小さく</b>、下の変化もほとんどが揺れの範囲です。')
      : '') + '</p>'
    + `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">相手が出しやすくなる</div><ul class="mu">${up.map((r) => induceRow(r, 'bring')).join('') || none}</ul></div>`
    + `<div class="c6"><div class="k">相手が出しにくくなる</div><ul class="mu">${down.map((r) => induceRow(r, 'bring')).join('') || none}</ul></div></div>`
    + (pairs.length ? `<div class="k" style="margin-top:10px">増える相手の先発の組</div><ul class="sets">${pairs.map((r) => `<li><span class="icons">${r.pair.map((k) => icon(k, 36)).join('')}</span><span>${r.pair.map((k) => esc(short(k))).join('・')}</span><b>${pct(r.share[0], 0)} → ${pct(r.share[1], 0)}</b></li>`).join('')}</ul>` : '')
    + ((() => {
      const tp = (view.top?.induce?.clear || []).filter((r) => r.opp === g);
      if (!tp.length) return '';
      return `<div class="k" style="margin-top:10px">上位 500 人では（はっきりした組だけ）</div><ul class="mu">${tp.map((r) => `<li>${icon(r.name, 36)}<span>${esc(short(r.name))}</span>`
        + `<span><b>${r.diff >= 0 ? '+' : ''}${Math.round(r.diff * 100)}pt</b> <small class="note">${Math.round(r.ci[0] * 100)}〜${Math.round(r.ci[1] * 100)}pt・${r.players}人</small></span></li>`).join('')}</ul>`
        + '<p class="note">上位の人だけで、このポケモンがいたときといないときの選出率の差。範囲は人を単位に引き直して求め、たくさんの組を調べる補正（FDR 5%）をかけています。選び出した組なので、差は大きめに出やすい点に注意してください。</p>';
    })())
    + '<p class="note">「全体での選出率 → このポケモンがいたときの選出率」。同じ見せ合いの繰り返しは 1 回と数え、件数の少ない変化は全体の率に寄せています。'
    + '●は偶然の揺れを超える変化、「相性どおり」はタイプ相性から予想される向きと合っているもの。腕前やチームの組み方の違いも混ざります。</p>';
}

// ── チームの入力（選出予想・チーム診断で共通） ───────────────────────
// 入れたチームは、この端末だけに保存する（次に開いたときのため）。保存できなくても使える
// シングルとダブルでチームは別（ダブルのチームをシングルのデータで見ないように）
const TEAMS = { singles: { opp: Array(6).fill(''), mine: Array(6).fill(''), sampled: {} }, doubles: { opp: Array(6).fill(''), mine: Array(6).fill(''), sampled: {} } };
try { const saved = JSON.parse(localStorage.getItem('cm-teams2') || '{}'); for (const k of Object.keys(TEAMS)) Object.assign(TEAMS[k], saved[k] || {}); } catch (e) { /* 保存がなくても動く */ }
for (const t of Object.values(TEAMS)) if (!t.sampled || typeof t.sampled !== 'object') t.sampled = {};
let TEAM = TEAMS.singles;
const useTeamFor = (f) => { TEAM = TEAMS[f.game_type === 'doubles' ? 'doubles' : 'singles']; };
const saveTeams = () => { try { localStorage.setItem('cm-teams2', JSON.stringify(TEAMS)); } catch (e) { /* 保存できなくてもよい */ } };

let NAME_INDEX = null; // 入力の文字 → まとめた名前
function nameIndex() {
  if (NAME_INDEX) return NAME_INDEX;
  NAME_INDEX = new Map();
  for (const [k, v] of Object.entries(NAMES.pokemon)) {
    const g = v.group || k;
    for (const s of [k, g, v.ja, short(k), v.ja && v.ja.split('（')[0]]) if (s && !NAME_INDEX.has(norm(s))) NAME_INDEX.set(norm(s), g);
  }
  return NAME_INDEX;
}
const resolveName = (text) => (text ? nameIndex().get(norm(text.trim())) || null : null);

function fillDatalist() {
  if (!view.mo) {
    $('poke-names').innerHTML = Object.keys(view.early?.pokemon || {}).map((k) => `<option value="${esc(ja(k))}"></option>`).join('');
    return;
  }
  const { mo } = view;
  const ug = mo.usage_grouped[String(mo.default_cutoff)];
  const i = mo.months.length - 1;
  const keys = Object.keys(ug).sort((a, b) => (ug[b][i] || 0) - (ug[a][i] || 0));
  $('poke-names').innerHTML = keys.map((k) => `<option value="${esc(ja(k))}"></option>`).join('');
}

// 保存されていたチームを、いまの「まとめた名前」に直す（見た目違いをまとめる前の名前などが残っていることがある）
function normalizeTeams() {
  for (const t of Object.values(TEAMS)) {
    for (const role of ['opp', 'mine']) {
      t[role] = Array.from({ length: 6 }, (_, i) => {
        const x = t[role][i];
        return x ? resolveName(x) || resolveName(x.split('-')[0]) || x : '';
      });
    }
  }
}

function renderTeamInputs() {
  document.querySelectorAll('.team-in').forEach((box) => {
    const role = box.dataset.team;
    const slots = TEAM[role].map((g, i) => {
      const u = g ? spriteUrl(g) : null;
      return `<label class="slot">${u ? `<img src="${esc(u)}" width="40" height="40" alt="">` : '<span class="ph"></span>'}`
        + `<input list="poke-names" data-role="${role}" data-i="${i}" value="${g ? esc(ja(g)) : ''}" placeholder="${i + 1}匹目" autocomplete="off"></label>`;
    }).join('');
    box.innerHTML = `<div class="slots">${slots}</div><div class="tools">`
      + `<button type="button" data-clear="${role}">消す</button></div>`;
  });
}

function onTeamChanged() {
  saveTeams();
  renderTeamInputs();
  if (route.v === 'select') renderSelect();
  if (route.v === 'diag') renderDiag();
}

function setupTeamInputs() {
  document.addEventListener('change', (ev) => {
    const inp = ev.target.closest('.team-in input[data-role]');
    if (!inp) return;
    const g = resolveName(inp.value);
    if (inp.value.trim() && !g) { inp.closest('.slot').classList.add('bad'); return; }
    TEAM[inp.dataset.role][+inp.dataset.i] = g || '';
    onTeamChanged();
  });
  document.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-clear]');
    if (c) { TEAM[c.dataset.clear].fill(''); onTeamChanged(); return; }
    if (ev.target.closest('[data-sel-run]')) { runSelect(); return; }
    const sb = ev.target.closest('[data-sample]');
    if (sb && view.samples?.teams) {
      const t = view.samples.teams[+sb.dataset.sample].team;
      const role = sb.dataset.sampleRole;
      TEAM[role] = [...t, ...Array(6).fill('')].slice(0, 6);
      TEAM.sampled[role] = t.join('|');
      onTeamChanged();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  });
}

// ── 選出予想（docs/DATA_CONTRACT.md の select の式。src/cmeta/analysis/joint.py の Featurizer / probs と同じ） ──
let DEX = null;
const logitP = (p) => { const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(q / (1 - q)); };
function effect(atk, defTypes) {
  return (defTypes || []).reduce((m, t) => m * ((DEX.typechart[t] || {})[atk] ?? 1), 1);
}
const typesOf = (k) => poke(k).types || [];
const WEATHERS = ['rain', 'sun', 'sand', 'snow'];
const ROLE_KEYS = ['fakeout', 'intimidate', 'redirect', 'tailwind', 'hazard', 'sash'];

let SEL = null;
// 縮めの強さ SEL.m: { base_bring, base_lead, vs }（データから決めたもの。古い形は 1 つの数）
function selRate(e, which, prior, key) {
  if (!e) return prior;
  const [n, hit] = which === 'bring' ? [e[0], e[1]] : [e[2], e[3]];
  const m = typeof SEL.m === 'number' ? SEL.m : SEL.m[key];
  return (hit + m * prior) / (n + m);
}
// メガストーンを持つ確率が高いポケモンは、メガの姿のタイプで相性を見る
const selTypes = (k) => SEL.roles[k]?.types || typesOf(k);
const selSpeed = (k) => SEL.roles[k]?.speed || 80;

// opp: 名前の配列、または [名前, 重み] の配列（自分のチームが分からないときの平均的な相手。重みの合計 6）
function selMember(k, opp) {
  const oppW = opp.length && typeof opp[0] === 'string' ? opp.map((u) => [u, 1]) : opp;
  const pb = selRate(SEL.base[k], 'bring', SEL.g_bring, 'base_bring');
  const pl = selRate(SEL.base[k], 'lead', SEL.g_lead, 'base_lead');
  const lk = logitP(pb);
  const vsk = SEL.vs[k] || {};
  let vs = 0;
  for (const [u, w] of [...oppW].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (vsk[u]) vs += w * (logitP(selRate(vsk[u], 'bring', pb, 'vs')) - lk);
  }
  const kt = selTypes(k);
  let hit = 0, hurt = 0, tw = 0, sp = 0;
  for (const [u, w] of oppW) {
    const ut = selTypes(u);
    if (kt.some((t) => effect(t, ut) >= 2)) hit += w;
    if (ut.some((t) => effect(t, kt) >= 2)) hurt += w;
    tw += w;
    sp += w * selSpeed(u);
  }
  const r = SEL.roles[k] || {};
  const m = { base: lk, lead_base: logitP(pl), vs, hit: hit / 6, hurt: hurt / 6, speed: tw ? (selSpeed(k) - sp / tw) / 50 : 0,
    stone: r.stone || 0, tr: r.tr || 0, set: {}, abuse: {} };
  for (const x of ROLE_KEYS) m[x] = r[x] || 0;
  for (const w of WEATHERS) { m.set[w] = r.set?.[w] || 0; m.abuse[w] = r.abuse?.[w] || 0; }
  return m;
}

function combos(arr, k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

// 選択肢（選出する組 × 先発）ごとの確率。weights を省くと SEL.weights
function selJoint(team, opp, kb, kl, weights = SEL.weights) {
  const pm = Object.fromEntries(team.map((k) => [k, selMember(k, opp)]));
  const idx = Object.fromEntries(SEL.features.map((n, i) => [n, i]));
  const opts = [];
  for (const s of combos([...team].sort(), kb)) for (const l of combos(s, kl)) opts.push([s, l]);
  const z = opts.map(([s, l]) => {
    const f = new Array(SEL.features.length).fill(0);
    const add = (n, v) => { if (n in idx) f[idx[n]] += v; };
    for (const k of s) {
      const m = pm[k];
      add('base', m.base); add('vs', m.vs); add('hit', m.hit); add('hurt', m.hurt); add('stone', m.stone); add('tr_bring', m.tr);
    }
    for (const [a, b] of combos([...s].sort(), 2)) {
      add('stone_pair', pm[a].stone * pm[b].stone); // 1 試合 1 匹しかメガシンカできない
      add('cobring', SEL.cobring[`${a}|${b}`] || 0);
    }
    for (const k of l) {
      const m = pm[k];
      add('lead_base', m.lead_base); add('speed', m.speed);
      add('fakeout_lead', m.fakeout); add('intimidate_lead', m.intimidate); add('redirect_lead', m.redirect);
      add('tailwind_lead', m.tailwind); add('tr_lead', m.tr); add('hazard_lead', m.hazard); add('sash_lead', m.sash);
    }
    for (const w of WEATHERS) {
      const setS = Math.max(0, ...s.map((k) => pm[k].set[w]));
      const abuseS = s.reduce((a, k) => a + pm[k].abuse[w], 0);
      add('weather_bring', setS); add('weather_pair', setS * abuseS);
      add('weather_lead', Math.max(0, ...l.map((k) => pm[k].set[w])));
    }
    return f.reduce((a, v, i) => a + weights[i] * v, 0);
  });
  const zmax = Math.max(...z);
  const e = z.map((v) => Math.exp(v - zmax));
  const tot = e.reduce((a, b) => a + b, 0);
  return opts.map(([s, l], i) => ({ s, l, p: e[i] / tot }));
}

function selMarginals(team, joint) {
  const bring = Object.fromEntries(team.map((k) => [k, 0]));
  const lead = Object.fromEntries(team.map((k) => [k, 0]));
  for (const o of joint) { for (const k of o.s) bring[k] += o.p; for (const k of o.l) lead[k] += o.p; }
  return { bring, lead };
}

// 組ごとに確率を足し上げて、上位 n 個
function selTopSets(joint, key, n) {
  const acc = new Map();
  for (const o of joint) { const id = [...o[key]].sort().join('|'); acc.set(id, (acc.get(id) || 0) + o.p); }
  return [...acc.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([id, p]) => ({ set: id.split('|'), p }));
}

// 画面の計算が Python と同じか（?check=1 のとき、公開した例と照らし合わせてコンソールに出す）
function selSelfCheck() {
  let worst = 0;
  for (const ex of SEL.examples || []) {
    const opp = ex.opp === 'avg' ? SEL.avg_opp : ex.opp;
    const { bring, lead } = selMarginals(ex.team, selJoint(ex.team, opp, SEL.k_bring, SEL.k_lead));
    for (const k of ex.team) worst = Math.max(worst, Math.abs(bring[k] - ex.bring[k]), Math.abs(lead[k] - ex.lead[k]));
  }
  console.log(`select self-check: 最大のずれ ${worst.toFixed(5)}（${(SEL.examples || []).length} 例）`);
  return worst;
}

async function loadToolData() {
  const target = view;
  const f = target.f;
  if (!DEX) DEX = await getJSON('dex.json');
  if (!target.sel) target.sel = f.replay_days ? await getJSON(`select/${f.id}.json`).catch(() => null) : null;
  if (target.diag === undefined) target.diag = target.mo ? await getJSON(`diag/${f.id}.json`).catch(() => null) : null; // 月次の無いルールには無い
  if (target.samples === undefined) target.samples = f.team_select ? await getJSON(`samples/${f.id}.json`).catch(() => null) : null;
  return target;
}

// ── 見本のチーム（samples/<ルール>.json: 3 人以上がまったく同じ 6 匹を使っていたもの） ─────────
// まだ一度も入れていない欄にだけ、見本を入れておく（消したあとに勝手に入れ直さない）。自分は 1 番目、相手は 2 番目の見本
const SAMPLE_ROLE_JA = { mine: '自分', opp: '相手' };
function applySamples(roles) {
  const teams = view.samples?.teams || [];
  if (!teams.length) return;
  let changed = false;
  for (const role of roles) {
    if (TEAM[role].some(Boolean) || TEAM.sampled[role]) continue;
    const t = teams[role === 'opp' && teams.length > 1 ? 1 : 0].team;
    TEAM[role] = [...t, ...Array(6).fill('')].slice(0, 6);
    TEAM.sampled[role] = t.join('|');
    changed = true;
  }
  if (changed) { saveTeams(); renderTeamInputs(); }
}
const isSample = (role) => TEAM.sampled[role] && TEAM.sampled[role] === TEAM[role].filter(Boolean).join('|');
function sampleCard(roles) {
  const S = view.samples;
  if (!S?.teams?.length) return '';
  const now = roles.filter(isSample).map((r) => SAMPLE_ROLE_JA[r]);
  return '<section class="card c12 diag-sample"><h2>見本のチーム</h2>'
    + (now.length ? `<p>いまは見本として、よく使われているチームを「${now.join('」と「')}」に入れてあります。上の欄を書き換えると、あなたの入力で計算し直します。</p>` : '')
    + `<ul class="diag-samples">${S.teams.map((t, i) => `<li><span class="mons">${t.team.map((k) => icon(k, 32)).join('')}</span>`
      + `<span class="note">${t.players} 人が使用</span><span class="btns">${roles.map((r) => `<button type="button" class="pill" data-sample="${i}" data-sample-role="${r}">${SAMPLE_ROLE_JA[r]}に入れる</button>`).join('')}</span></li>`).join('')}</ul>`
    + `<p class="note">直近 ${S.days} 日の Showdown の公開リプレイで、まったく同じ 6 匹を使っていた人の数が多いもの（${S.min_players} 人以上）。</p></section>`;
}

let SEEN_LEADS = new Set(); // 先発に出たポケモン（押して選ぶ）
const selSlot = (p) => (p >= 0.8 ? ['fix', 'ほぼ出す'] : p <= 0.3 ? ['bench', '出にくい'] : ['flex', '相手しだい']);

let SEL_RUN = null; // 解析した時点のルールとチーム（変わったら結果を隠す）
const selSig = () => `${view.f.id}|${TEAM.opp.join(',')}|${TEAM.mine.join(',')}`;
const SEL_STEPS = ['見せ合いの実績を読み込んでいます', '相手の 6 匹から選出の組み合わせを数えています', 'あなたのチームを見たときの傾向を足しています', '確率をまとめています'];
async function runSelect() {
  const revision = routeRevision;
  const target = view;
  const signature = selSig();
  const isCurrent = () => revision === routeRevision && view === target && selSig() === signature;
  const out = $('select-out');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  out.innerHTML = `<div class="sel-scan" aria-live="polite"><div class="bar"><i></i></div><ol>${SEL_STEPS.map((t) => `<li>${t}</li>`).join('')}</ol></div>`;
  const items = out.querySelectorAll('.sel-scan li');
  for (let i = 0; i < items.length; i++) {
    if (!isCurrent()) return;
    items[i].classList.add('on');
    if (!reduce) await new Promise((r) => setTimeout(r, 280));
    if (!isCurrent()) return;
    items[i].classList.add('done');
  }
  if (!isCurrent()) return;
  SEL_RUN = signature;
  await renderSelect(revision);
  if (!isCurrent()) return;
  out.classList.remove('sel-in');
  void out.offsetWidth; // 結果を出すたびに動きを最初から
  out.classList.add('sel-in');
}
async function renderSelect(revision = routeRevision) {
  await loadToolData();
  if (revision !== routeRevision) return;
  SEL = view.sel;
  applySamples(['opp', 'mine']);
  $('select-samples').innerHTML = sampleCard(['mine', 'opp']);
  const label = formatLabel(view.f);
  const day = (t) => new Date(t * 1000).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  $('select-asof').innerHTML = dots(esc(label), 'Showdown の公開リプレイ', SEL?.trained ? `${day(SEL.trained.from)}〜${day(SEL.trained.to)}` : '');
  const out = $('select-out');
  const opp = TEAM.opp.filter(Boolean);
  const mine = TEAM.mine.filter(Boolean);
  if (!SEL || !SEL.available || SEL.model !== 'joint') {
    out.innerHTML = `<h2>予想</h2><p class="empty">このルールではまだ予想を出せません（${esc(SEL?.reason || 'リプレイがない')}）。</p>`;
    return;
  }
  if (opp.length < 6) { out.innerHTML = '<h2>予想</h2><p class="empty">相手の 6 匹を入れてください。</p>'; return; }
  // 「解析する」を押すまで結果は出さない。チームかルールを変えたら、もう一度押す
  if (SEL_RUN !== selSig()) {
    out.innerHTML = '<div class="sel-go"><div><h2 style="margin:0">解析の準備ができました</h2>'
      + `<p class="note" style="margin:4px 0 0">相手 ${opp.length} 匹${mine.length === 6 ? '・自分 6 匹' : '（自分のチームなし: 環境の平均的な相手として計算）'}</p></div>`
      + '<button type="button" class="btn sel-run" data-sel-run>解析する</button></div>';
    return;
  }
  if (new URLSearchParams(location.search).get('check')) selSelfCheck();
  const kb = SEL.k_bring, kl = SEL.k_lead;
  // 予想が全体の率より良くならないルールでは、全体の率だけ（weights の base と lead_base だけ 1）で計算する
  const w = SEL.usable ? SEL.weights : SEL.features.map((n) => (n === 'base' || n === 'lead_base' ? 1 : 0));
  const joint = selJoint(opp, mine.length === 6 ? mine : SEL.avg_opp, kb, kl, w);
  const { bring, lead } = selMarginals(opp, joint);
  SEEN_LEADS = new Set([...SEEN_LEADS].filter((k) => opp.includes(k)));
  const seen = SEEN_LEADS.size === kl ? SEEN_LEADS : null;
  // 先発を見たあと: 先発がその組の選択肢だけで割り戻した、残りの選出の確率
  let back = null;
  if (seen) {
    const cond = joint.filter((o) => o.l.every((k) => seen.has(k)));
    const tot = cond.reduce((a, o) => a + o.p, 0);
    back = Object.fromEntries(opp.map((k) => [k, 0]));
    for (const o of cond) for (const k of o.s) if (!seen.has(k)) back[k] += o.p / tot;
  }
  const order = [...opp].sort((a, b) => bring[b] - bring[a] || (a < b ? -1 : 1));
  const bar = (v, cls = '') => `<span class="b"><i class="${cls}" style="width:${(v * 100).toFixed(0)}%"></i></span><b>${pct(v, 0)}</b>`;
  const rows = order.map((k) => {
    const [cls, txt] = selSlot(bring[k]);
    const u = spriteUrl(k);
    const e = SEL.base[k];
    const st = SEL.roles[k]?.stone || 0;
    const isSeen = SEEN_LEADS.has(k);
    return `<li class="${cls}${isSeen ? ' seen' : ''}">${u ? `<img src="${esc(u)}" width="48" height="48" alt="">` : '<span></span>'}`
      + `<div class="nm">${esc(ja(k))} <span class="slot ${cls}">${txt}</span>`
      + `<small>${e ? `見せ合い ${e[2]} 回` : 'データ不足（全体の平均で計算）'}${st >= 0.05 ? `・メガストーン ${pct(st, 0)}` : ''}</small>`
      + `<button type="button" class="seen-btn" data-seen="${esc(k)}" aria-pressed="${isSeen}">${isSeen ? '先発に出た ✓' : '先発に出た'}</button></div>`
      + `<div class="bars"><div><span>選出</span>${bar(bring[k])}</div><div><span>先発</span>${bar(lead[k], 'ld')}</div>`
      + (back ? `<div><span>残り</span>${seen.has(k) ? '<span class="b"></span><b>先発</b>' : bar(back[k], 'bk')}</div>` : '')
      + '</div></li>';
  }).join('');
  const setList = (sets) => sets.map(({ set, p }) => `<li><span class="icons">${set.map((k) => icon(k, 36)).join('')}</span>`
    + `<span>${set.map((k) => esc(short(k))).join('・')}</span><b>${pct(p, 0)}</b></li>`).join('');
  const leadSets = selTopSets(joint, 'l', 3);
  // 先発を見たあとは、その先発の選択肢だけで割り戻した選出の組
  const bringSets = selTopSets(seen ? (() => {
    const cond = joint.filter((o) => o.l.every((k) => seen.has(k)));
    const tot = cond.reduce((a, o) => a + o.p, 0);
    return cond.map((o) => ({ ...o, p: o.p / tot }));
  })() : joint, 's', 3);
  const ev = SEL.eval;
  const n2 = (x, k) => (x * k).toFixed(2);
  const pt = (d) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}`;
  const sig = (c) => (c.ci[0] > 0 ? '（はっきり良い）' : c.ci[1] < 0 ? '（はっきり悪い）' : '（差ははっきりしない）');
  const evalTxt = `<b>答え合わせ</b>（${day(ev.test_from)} 以降の ${ev.test.toLocaleString()} 試合を ${ev.blocks || 1} 区間に分け、それぞれ直前 ${ev.train_days || 30} 日の試合で学んだ予想で確かめたもの）<br>月次の型・使用率は集計時点の統計を使った過去の答え合わせです。保存後の試合に対する成績は、下の成績表で確認できます。<br>`
    + `・選出: 予想の上位 ${kb} 匹のうち実際に出たのは平均 <b>${n2(ev.bring.model, kb)} 匹</b>（全体の選出率だけ ${n2(ev.bring.baseline, kb)} 匹、でたらめ ${n2(ev.bring.random, kb)} 匹）${sig(ev.bring)}<br>`
    + `・先発: 上位 ${kl} 匹のうち平均 ${n2(ev.lead.model, kl)} 匹（全体だけ ${n2(ev.lead.baseline, kl)} 匹）${sig(ev.lead)}<br>`
    + `・先発を見たあとの残り: 上位 ${kb - kl} 匹のうち平均 ${n2(ev.back.model, kb - kl)} 匹（全体だけ ${n2(ev.back.baseline, kb - kl)} 匹）${sig(ev.back)}<br>`
    + `・${kl === 2 ? '先発の組' : '先発'}の上位 3 に実際の先発が入った: ${pct(ev.lead_set_top3.model, 0)}`
    + `・確率の当てはまり（対数尤度）: 全体だけより ${ev.loglik.diff >= 0 ? '+' : ''}${ev.loglik.diff.toFixed(3)} ${sig(ev.loglik)}`;
  const mode = SEL.usable
    ? `確率は相性（タイプ・メガシンカ後のタイプ）・役割（天候・${kl === 2 ? 'ねこだまし・いかく・トリックルームなど' : '設置技・きあいのタスキなど'}）・実績から計算しています。`
      + ' 選出は相手を見て変える読み合いの部分が大きく、ぴったり当てるのは難しい予想です。確率が高くない枠は「相手しだい」と考えてください。'
    : 'このルールでは、予想の確率が全体の率だけより良くならなかったため、<b>全体の選出率・先発率</b>から計算しています。';
  // よくある組み合わせから外れたチーム（ふつうさの下位 5%。低レートに多い）は、予想が当たりにくい
  const ugU = view.mo?.usage_grouped?.[String(view.mo.default_cutoff)] || {};
  const typ = opp.reduce((a, k) => a + Math.log(Math.max(ugU[k]?.at(-1) || 0, 1e-4)), 0) / opp.length;
  // 注意は、答え合わせで変わったチームの予想が全体の率だけを上回れていないルールだけ（BSS は下回った。VGC は上回った）
  const odd = ev.odd_cut != null && typ <= ev.odd_cut && ev.bring_odd && ev.bring_odd.model <= ev.bring_odd.baseline + 0.005;
  const oddTxt = odd ? `<p class="evalbox" style="margin-top:0">このチームは、よくある組み合わせから大きく外れています（下位 5%）。こうしたチームでは予想が当たりにくく、答え合わせでは上位 ${kb} 匹の当たりが平均 ${ev.bring_odd ? (ev.bring_odd.model * kb).toFixed(2) : '—'} 匹（全体の率だけ ${ev.bring_odd ? (ev.bring_odd.baseline * kb).toFixed(2) : '—'} 匹）でした。</p>` : '';
  const rateTxt = ev.ratings ? `<br>学習に使った試合のレートは中央値 ${ev.ratings.p50}（1 割〜9 割で ${ev.ratings.p10}〜${ev.ratings.p90}。レートの分かる ${ev.ratings.n.toLocaleString()} 件）。${ev.ratings.p90 < 1500 ? '上位の対戦の公開リプレイは少ないため、上位帯の選び方とは違うことがあります。' : ''}` : '';
  const tt = ev.temperature;
  const tempTxt = tt ? (tt.applied
    ? `<br>確率の補正: 答え合わせで予想の確率が${tt.t < 1 ? '強く出すぎていたので、控えめに' : '弱く出すぎていたので、強めに'}しています（係数 ${tt.t}。区間どうしで確かめて、確率の当てはまりが +${tt.loglik_gain.toFixed(3)}）。当たる順番は変わりません。`
    : '<br>確率の補正: 答え合わせで補正の効果がはっきりしなかったので、補正していません。') : '';
  const unknown = mine.length === 6 ? '' : `<br>自分の 6 匹を入れると、あなたのチームとの相性も考えます（いまは環境の平均的な相手として計算。答え合わせでは選出 ${n2(ev.bring.unknown_opp, kb)} 匹）。`;
  out.innerHTML = `<h2>相手の選出 <span class="chip warn">参考値</span></h2>${oddTxt}`
    + '<p class="note" style="margin-top:0">相手の先発が出たら「先発に出た」を押すと、残りの選出の確率に切り替わります。</p>'
    + `<ul class="pred">${rows}</ul>`
    + `<div class="grid" style="gap:12px;margin-top:14px"><div class="c6"><div class="k">${kl === 2 ? '先発の組' : '先発'}の候補</div><ul class="sets">${setList(leadSets)}</ul></div>`
    + `<div class="c6"><div class="k">選出の組の候補${seen ? '（先発を見たあと）' : ''}</div><ul class="sets">${setList(bringSets)}</ul></div></div>`
    + `<div class="evalbox">${mode}${unknown}<br>${evalTxt}${rateTxt}${tempTxt}</div>`
    + trackCard(SEL.track, kb, kl);
  out.querySelectorAll('[data-seen]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.seen;
    if (SEEN_LEADS.has(k)) SEEN_LEADS.delete(k);
    else { if (SEEN_LEADS.size >= kl) SEEN_LEADS.clear(); SEEN_LEADS.add(k); }
    renderSelect();
  }));
}

// 成績表（src/cmeta/analysis/track.py）: 公開した予想を保存し、そのあとの試合で答え合わせしたもの
function trackCard(T, kb, kl) {
  if (!T || !T.available) return T && T.reason ? `<div class="track"><h2 class="sub">予想の成績表</h2><p class="note">${esc(T.reason)}</p></div>` : '';
  const day = (t) => new Date(t * 1000).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  const sig = (c) => (c.ci[0] > 0 ? '<b class="up-t">はっきり良い</b>' : c.ci[1] < 0 ? '<b class="dn-t">はっきり悪い</b>' : '差ははっきりしない');
  const n2 = (x, k) => (x * k).toFixed(2);
  const rows = T.by_day.slice(-10).map(([d, n, m, b]) => `<tr><td>${esc(d.slice(5).replace('-', '/'))}</td><td>${n}</td><td>${n2(m, kb)}</td><td>${n2(b, kb)}</td></tr>`).join('');
  return `<div class="track"><h2 class="sub">予想の成績表 <span class="chip">前向きの答え合わせ</span></h2>`
    + `<p class="note" style="margin-top:0">毎日、その時点の予想を保存しておき、<b>そのあとに起きた試合</b>で当たり外れを数えたものです（結果を見てから予想を作る余地がありません）。`
    + ` 1 試合につき、その試合より前に保存した一番新しい予想（${T.max_age_days} 日以内）を 1 つだけ使っています。${day(T.from)}〜${day(T.to)}の ${T.n.toLocaleString()} 試合。</p>`
    + `<div class="kv"><div><span class="k">選出: 上位 ${kb} 匹の当たり</span><b>${n2(T.bring.model, kb)} 匹</b><small class="note">全体の率だけ ${n2(T.bring.baseline, kb)} 匹・${sig(T.bring)}</small></div>`
    + `<div><span class="k">先発: 上位 ${kl} 匹の当たり</span><b>${n2(T.lead.model, kl)} 匹</b><small class="note">全体の率だけ ${n2(T.lead.baseline, kl)} 匹・${sig(T.lead)}</small></div>`
    + `<div><span class="k">確率の当てはまり</span><b>${T.loglik.diff >= 0 ? '+' : ''}${T.loglik.diff.toFixed(3)}</b><small class="note">全体の率だけとの差・${sig(T.loglik)}</small></div></div>`
    + `<table class="tt" style="margin-top:10px"><thead><tr><th>予想を保存した日</th><th>試合</th><th>選出の当たり</th><th>全体の率だけ</th></tr></thead><tbody>${rows}</tbody></table>`
    + (T.seeded_until ? `<p class="note">${esc(T.seeded_until.slice(5).replace('-', '/'))} までの予想は、成績表を始める前の日について、その日までの試合と、その時点で公開済みの月次統計だけで作り直したものです（確率の補正は入っていません）。</p>` : '')
    + '</div>';
}

// ── チーム診断 ───────────────────────────────────────────
async function renderDiag(revision = routeRevision) {
  if (!view.mo) {
    $('diag-asof').innerHTML = dots(esc(formatLabel(view.f)), '開始直後');
    $('diag-out').innerHTML = '<section class="card c12"><p class="empty">チーム診断は、月次統計（よく使われる技・すばやさ）が出てから使えます。このルールは始まったばかりで、月次統計は月が終わってから公開されます。それまでは、ひとつ前のレギュレーションを選ぶと診断できます。</p></section>';
    return;
  }
  await loadToolData();
  if (revision !== routeRevision) return;
  const D = view.diag;
  const label = formatLabel(view.f);
  $('diag-asof').innerHTML = dots(esc(label), `レート${view.mo.default_cutoff}以上の月次統計`, 'Showdown の公開リプレイ');
  const out = $('diag-out');
  if (!D) { out.innerHTML = '<section class="card c12"><p class="empty">このルールは診断の材料がありません。</p></section>'; return; }
  applySamples(['mine']);
  const team = TEAM.mine.filter(Boolean);
  if (!team.length) { out.innerHTML = '<section class="card c12"><p class="empty">自分の 6 匹を入れてください。</p></section>' + sampleCard(['mine']); return; }
  const cards = [];

  // 1) 環境でよく使われる攻撃のタイプへの弱点
  const types = Object.entries(D.attack_types).slice(0, 10);
  const maxShare = Math.max(...types.map(([, v]) => v), 0.01);
  const trow = types.map(([t, share]) => {
    const weak = team.filter((k) => effect(t, typesOf(k)) >= 2).length;
    const res = team.filter((k) => effect(t, typesOf(k)) <= 0.5).length;
    const hole = weak >= 3 || (weak >= 2 && res === 0);
    const good = res >= 2 && weak === 0;
    return `<tr><td><span class="type t-${t.toLowerCase()}">${TYPE_JA[t] || t}</span></td>`
      + `<td style="text-align:left"><span class="share" style="width:${(share / maxShare * 80).toFixed(0)}px"></span>${pct(share, 0)}</td>`
      + `<td class="${weak >= 2 ? 'hole' : ''}">${weak}</td><td>${res}</td><td class="${hole ? 'hole' : good ? 'ok' : ''}">${hole ? '要注意' : good ? '安心' : ''}</td></tr>`;
  }).join('');
  cards.push(`<section class="card c6"><h2>よく使われる攻撃への弱点</h2><table class="tt"><thead><tr><th>攻撃のタイプ</th><th style="text-align:left">環境での割合</th><th>弱点</th><th>半減以下</th><th></th></tr></thead><tbody>${trow}</tbody></table>`
    + '<p class="note">環境での割合 = 使用率 × 技の採用率（変化技を除く）。タイプ相性だけで、特性・持ち物は考えていません。</p></section>');

  // 2) 上位のポケモンとの相性（リプレイの勝敗）
  const mu = [];
  for (const [b] of D.top) {
    if (team.includes(b)) continue;
    let g = 0, w = 0;
    for (const a of team) { const e = D.pairs[a]?.[b]; if (e) { g += e[0]; w += e[1]; } }
    if (g >= D.min_games) mu.push({ b, g, wr: (w + 5) / (g + 10) });
  }
  const li = (r) => `<li>${icon(r.b, 36)}<span>${esc(short(r.b))}</span><span><b>${pct(r.wr, 0)}</b> <small class="note">${r.g}戦</small></span></li>`;
  // 苦手は 50% 未満、得意は 50% 超だけ（相手が少ないとき同じポケモンが両方に出ないように）
  const worst = mu.filter((r) => r.wr < 0.5).sort((x, y) => x.wr - y.wr).slice(0, 5);
  const best = mu.filter((r) => r.wr > 0.5).sort((x, y) => y.wr - x.wr).slice(0, 5);
  const none = '<li class="note">該当なし</li>';
  cards.push(`<section class="card c6"><h2>上位のポケモンとの相性 <span class="chip warn">参考値</span></h2>`
    + (mu.length ? `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">苦手（勝率が低い）</div><ul class="mu">${worst.map(li).join('') || none}</ul></div>`
      + `<div class="c6"><div class="k">得意（勝率が高い）</div><ul class="mu">${best.map(li).join('') || none}</ul></div></div>`
      + '<p class="note">あなたのチームのポケモンを出した側が、そのポケモンを出した側に勝った割合（公開リプレイ。50% に寄せた値）。腕前の差も混ざります。</p>'
      : '<p class="empty">このルールはリプレイがまだ足りません。</p>')
    + '</section>');

  // 3) すばやさ（振り方の分布どうし。メガストーンを持つ割合が 5 割以上ならメガの姿）
  const S = await loadSpeed();
  if (S) {
    const srow = team.map((g) => [g, spdFormOf(S, g)]).map(([g, k]) => {
      if (!k) return [g, null, -1, ''];
      const e = S.pokemon[k];
      // 自分の分布 × 環境: Σ 自分の割合 × その値で先に動ける割合
      const f = e.dist.reduce((a, [v, s]) => a + s * spdVsMeta(S, v, null).faster, 0);
      const fast = spdVsMeta(S, spdStat(e.base, 32, '+'), null).faster;
      return [g, k, f, `<tr><td>${icon(k, 28)} ${esc(short(k))}</td><td>${spdMode(e)}</td><td><b>${pct(f, 0)}</b></td><td>${pct(fast, 0)}</td></tr>`];
    }).sort((x, y) => y[2] - x[2]).map((r) => r[3] || `<tr><td>${icon(r[0], 28)} ${esc(short(r[0]))}</td><td colspan="3" class="note">データ不足</td></tr>`).join('');
    cards.push(`<section class="card c6"><h2>すばやさ</h2><table class="tt"><thead><tr><th>ポケモン</th><th>よくある実数値</th><th>環境で先に動ける</th><th>最速なら</th></tr></thead><tbody>${srow}</tbody></table>`
      + `<p class="note">そのポケモンのよくある振り方の分布どうしで比べ、環境（使用率で重み付け）の何%より先に動けるか（${esc(S.month)}・レート ${S.cutoff} 以上）。持ち物・特性・場の状態は含みません。詳しい線は各ポケモンのページ。</p></section>`);
  }

  // 4) 並びとの重なりと、相方の候補
  const month = view.mo.months.at(-1);
  const cm = view.cores?.months[month]?.cores || [];
  let bestCore = null;
  for (const c of cm) {
    const mem = [...new Set(c.members.map(groupOf))];
    const ov = mem.filter((m) => team.includes(m));
    if (ov.length >= 2 && (!bestCore || ov.length > bestCore.ov.length)) bestCore = { mem, ov };
  }
  const sugg = new Map();
  for (const [k, p] of Object.entries(view.detail?.pokemon || {})) {
    if (!team.includes(groupOf(k))) continue;
    for (const [b, s] of p.teammates) { const gb = groupOf(b); if (!team.includes(gb)) sugg.set(gb, (sugg.get(gb) || 0) + s); }
  }
  const sug = [...sugg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  cards.push(`<section class="card c6"><h2>並び</h2>`
    + (bestCore ? `<p class="note" style="margin-top:0">いまの並びのうち、<b>${bestCore.ov.map((m) => esc(short(m))).join('・')}</b> が重なっています。</p>`
      + `<div class="core">${bestCore.mem.slice(0, 6).map((m) => `<span>${icon(m, 28)}${esc(short(m))}</span>`).join('')}</div>`
      : '<p class="note" style="margin-top:0">いまのよく使われる並びとの重なりは小さいチームです。</p>')
    + (sug.length ? `<h2 class="sub">このチームによく一緒に入るポケモン</h2><ul class="mates">${sug.map(([b]) => `<li><a href="${linkTo({ v: 'poke', p: b })}">${icon(b, 48)}<span>${esc(short(b))}</span></a></li>`).join('')}</ul>` : '')
    + '</section>');

  // 5) 選出誘導: このチームを見た相手が、出しやすくなるポケモン
  const ind = view.f.team_select && view.f.replay_days ? await loadInduce() : null;
  if (ind?.available) {
    const got = team.filter((k) => ind.pokemon[k]);
    const up = new Map(); // 相手のポケモン → [全体, 変化の合計, 誘導したメンバー]
    // 誘導の強さが偶然の揺れと区別できるメンバーだけ（0pt のメンバーの変化は揺れ）。重なりの足し算はせず、一番大きい変化
    for (const k of got.filter((x) => (ind.pokemon[x].strength.bring ?? 0) >= 0.005)) {
      for (const r of ind.pokemon[k].up) {
        // 偶然の揺れを超え（●）、しかもタイプ相性で説明がつく（相手のタイプ一致技がこのメンバーに効果抜群。特性で受けるものは除く）変化だけ。
        // 1 匹ずつの比較には、チームのほかのメンバーや時期・人の違いが混ざり、相性と逆向きや無関係の組も「はっきり」に出てしまうため
        if (team.includes(r.name) || r.bring[1] <= r.bring[0] || !r.clear || r.type_ok !== true) continue;
        const e = up.get(r.name) || [r.bring[0], 0, []];
        e[1] = Math.max(e[1], r.bring[1] - r.bring[0]);
        e[2].push(k);
        up.set(r.name, e);
      }
    }
    const top = [...up.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 6);
    const strong = got.map((k) => [k, ind.pokemon[k].strength.bring ?? 0]).sort((a, b) => b[1] - a[1]);
    cards.push(`<section class="card c6"><h2>このチームを見た相手の選出 <span class="chip warn">参考値</span></h2>`
      + (got.length
        ? `<p class="note" style="margin-top:0">誘導の強さ: ${strong.map(([k, s]) => `${esc(short(k))} <b>${(s * 100).toFixed(1)}pt</b>`).join('・')}`
          + `${team.length > got.length ? `（ほかは件数不足）` : ''}</p>`
          + (top.length ? `<div class="k">相手が出しやすくなる（タイプ相性どおりのものだけ）</div><ul class="mu">${top.map(([n, [p, d, by]]) => `<li>${icon(n, 36)}<span>${esc(short(n))} <small class="note">${by.map((k) => esc(short(k))).join('・')}を見て</small></span><span><b>+${(d * 100).toFixed(0)}pt</b> <small class="note">全体 ${pct(p, 0)}</small></span></li>`).join('')}</ul>` : '')
          + (top.length ? '' : '<p class="empty">タイプ相性で説明のつく、はっきりした変化は見つかりませんでした。</p>')
          + '<p class="note">誘導の強さが 0.5pt 以上のメンバーについて、1 匹ずつ調べた変化のうち、偶然の揺れを超え、しかも<b>相手のタイプ一致技がそのメンバーに効果抜群</b>（ふゆう などの特性で受けるものは除く）のものだけを出しています。'
          + '1 匹ずつの比較には、チームのほかのメンバーや、時期・遊ぶ人の違いが混ざるため、相性で説明のつかない組は出していません。組み合わせの効果は考えていない目安です。</p>'
        : '<p class="empty">このチームのポケモンは、まだ件数が足りません。</p>')
      + '</section>');
  }

  cards.push(sampleCard(['mine']));
  out.innerHTML = cards.join('');
}
// ── テーマ ──────────────────────────────────────────────
function setupTheme() {
  const btn = $('theme');
  const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const sync = () => { btn.textContent = isDark() ? '☀' : '◐'; btn.setAttribute('aria-label', isDark() ? '明るい表示にする' : '暗い表示にする'); };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* 保存できなくても表示は切り替わる */ }
    sync();
  });
  sync();
}

async function main() {
  setupTheme();
  try {
    [META, NAMES] = await Promise.all([getJSON('meta.json'), getJSON('names.json')]);
  } catch (e) {
    document.querySelector('.grid').innerHTML = `<p class="empty" role="alert">データを読めませんでした（${esc(e.message)}）。<button type="button" id="retry-main">再読み込み</button></p>`;
    $('retry-main').addEventListener('click', () => location.reload());
    return;
  }
  renderPills();
  setupTeamInputs();
  normalizeTeams();
  renderTeamInputs();
  phrase($('sec-about'));
  $('generated').textContent = updateStatus();
  $('data-status').textContent = updateStatus(true);
  $('data-status').classList.toggle('stale', Date.now() - new Date(META.generated_at).getTime() >= 7 * 86400000);
  document.querySelectorAll('[data-trend]').forEach((b) => b.addEventListener('click', () => { view.trend = b.dataset.trend; drawCharts(); }));
  $('q').addEventListener('input', () => renderRank());
  window.addEventListener('hashchange', onRoute);
  await onRoute();
  let t = 0;
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return; // スマホのアドレスバーの出入りでは描き直さない
    lastW = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(() => {
      drawCharts();
      if (route.v === 'poke' && route.p) renderPoke(route.p);
      const speedKey = spdState.k?.split(':')[1];
      if (route.v === 'speed' && view.speed?.pokemon[speedKey]) spdRedraw(view.speed, speedKey);
    }, 150);
  });
}

main();

// チャンピオンズ メタ — デザイン部。out/ の JSON（docs/DATA_CONTRACT.md）を読んで描くだけで、解析はしない。
// データの場所: 既定は ../data/（hub に置くとき out/ をここへ写す）。手元では ?data=../out/ で repo の out/ を読む。
'use strict';

// ?data= は同じサイトの中の相対パスだけ受け付ける（ほかのサイトの JSON を読ませて表示させないため）
const BASE = ((d) => (d && /^\.{0,2}\/?[\w./-]*\/$/.test(d) && !d.includes('//') ? d : '../data/'))(new URLSearchParams(location.search).get('data'));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
function updateStatus(compact = false) {
  const date = new Date(META.generated_at);
  const stamp = Number.isNaN(date.getTime()) ? META.generated_at : date.toLocaleString('en-US');
  const age = Number.isNaN(date.getTime()) ? 0 : Math.floor((Date.now() - date.getTime()) / 86400000);
  const status = age >= 7 ? `Updates are delayed. These statistics are from ${stamp}.` : `Last updated: ${stamp}`;
  return compact ? status : `${status} Usually updated every 3 days. Monthly Smogon statistics arrive around the 3rd of each month.`;
}
// 初期表示はシングル（ゲーム内のランクバトルと同じルールの BSS）。Smogon 独自のルールは後ろ
const FAMILY_ORDER = ['bss', 'vgc', 'ou', 'uu', '4v4doublesuu'];

let META = null;
let NAMES = null;
let view = null; // いま表示しているルールのデータ

// Translate reviewed source-generated reasons at display boundaries only.
function reasonEn(reason) {
  const exact = {
    'リプレイがない': 'No replays',
    '区間が足りない': 'Not enough evaluation blocks',
    '保存した予想がまだ無い': 'No saved predictions yet',
  };
  if (Object.prototype.hasOwnProperty.call(exact, reason)) return exact[reason];
  if (typeof reason !== 'string') return reason;
  let m = reason.match(/^答え合わせできた試合が少ない（(\d+)）$/);
  if (m) return `Too few battles available for evaluation (${m[1]})`;
  m = reason.match(/^標本が足りない（(\d+)）$/);
  if (m) return `Not enough samples (${m[1]})`;
  m = reason.match(/^標本が足りない（学習 (\d+)・答え合わせ (\d+)。(\d+) と 100 が必要）$/);
  if (m) return `Not enough samples (training: ${m[1]}; evaluation: ${m[2]}; requires ${m[3]} and 100, respectively)`;
  return reason;
}

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
const sourceJa = (n) => poke(n).ja || n;
const ja = (n) => n; // Canonical Showdown English name; display only.
// 短い名前: 姿の違いは別のポケモンとして数えているので、括弧の中は残して縮める（キュウコン（アローラ）→ キュウコン(アローラ)）
const sourceShort = (n) => sourceJa(n).replace(/（([^）]+)）/, (_, x) => `(${x.replace(/パルデア・|のすがた|なすがた|サイズ|種$|のはな|のかた/g, '')})`);
const short = (n) => n;
function spriteUrl(n, kind = 'front') {
  const s = poke(n).sprite;
  return s ? s[kind] || s.front : null;
}
document.addEventListener('error', (event) => {
  const image = event.target;
  const fallback = image?.dataset?.spriteFallback;
  if (!fallback) return;
  delete image.dataset.spriteFallback;
  if (image.getAttribute('src') !== fallback) image.src = fallback;
}, true);
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
    bss: 'Singles', ou: 'Singles OU (Smogon)', uu: 'Singles UU (Smogon)', '4v4doublesuu': 'Doubles UU (Smogon)',
  }[f.family] || (f.family.startsWith('vgc') ? 'Doubles' : f.family);
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
  if (window.Chart && window.MetaCharts) {
    return window.MetaCharts.trend(el, track, { name: ja, short, icon: (n) => icon(n, 22) });
  }
  const months = track.months;
  const usage = track.usage_grouped;
  const last = (k) => usage[k][months.length - 1] || 0;
  const top = Object.keys(usage).sort((a, b) => last(b) - last(a)).slice(0, 6);
  if (!top.length || months.length < 2) {
    el.innerHTML = '<p class="empty">Two months of data are not yet available.</p>';
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
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Usage trends (top 6)">`];
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
      s.push(`<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">Month ${+m.slice(5)}</text>`);
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
    showTip(`<b>Month ${+months[i].slice(5)}</b> (${esc(track.segments[i].regulation || '')})<br>${rows}`, ev.clientX, ev.clientY);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { xh.style.display = 'none'; hideTip(); });
  return top;
}

function trendTable(el, track, top) {
  const head = track.months.map((m) => `<th>Month ${+m.slice(5)}</th>`).join('');
  const ranks = view?.trend === 'rank' ? track.months.map((_, i) => Object.fromEntries(Object.keys(track.usage_grouped)
    .filter((k) => track.usage_grouped[k][i] != null && track.usage_grouped[k][i] > 0)
    .sort((a, b) => track.usage_grouped[b][i] - track.usage_grouped[a][i]).map((k, index) => [k, index + 1]))) : null;
  const rows = top.map((k) => `<tr><td>${esc(short(k))}</td>${track.months.map((_, i) => `<td>${ranks ? (ranks[i][k] ? `#${ranks[i][k]}` : 'Outside top ranks') : pct(track.usage_grouped[k][i])}</td>`).join('')}</tr>`).join('');
  el.innerHTML = `<table><thead><tr><th>Pokémon</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function moversChart(el, movers, width) {
  if (!movers) {
    el.innerHTML = '<p class="empty">No previous month is available for comparison.</p>';
    return;
  }
  const rows = [...movers.rising.slice(0, 5), ...movers.falling.slice(0, 5)];
  const row = 30;
  const w = Math.max(300, width);
  const h = row * rows.length + 10;
  const mid = w / 2;
  const maxd = Math.max(0.01, ...rows.map((r) => Math.abs(r.delta)));
  const scale = (mid - 60) / maxd;
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Risers and fallers since last month">`];
  s.push(`<line x1="${mid}" x2="${mid}" y1="0" y2="${h}" style="stroke:var(--line)"/>`);
  rows.forEach((r, i) => {
    const y = 6 + i * row;
    const bw = Math.abs(r.delta) * scale;
    const up = r.delta > 0;
    const name = esc(short(r.name));
    const tipTxt = `${name}<br>${pct(r.from)} → <b>${pct(r.to)}</b> (${up ? '+' : ''}${(r.delta * 100).toFixed(1)}pt)<br>Rank ${r.rank_from ?? '—'} → ${r.rank_to ?? '—'}`;
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
  window.MetaCharts?.destroy(el);
  if (window.Chart && window.MetaCharts && weekly?.available && weekly?.recent) {
    return window.MetaCharts.scatter(el, weekly, { name: ja, short, link: (n) => go({ v: 'poke', p: groupOf(n) }), href: (n) => linkTo({ v: 'poke', p: groupOf(n) }) });
  }
  if (!weekly || !weekly.available || !weekly.recent || !Object.keys(weekly.recent.pokemon).length) {
    el.innerHTML = '<p class="empty">Not enough replays are available for this format yet.</p>';
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
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Team-preview usage and selection rate">`];
  for (let v = ylo; v <= 1.0001; v += 0.1) {
    s.push(`<line x1="${padL}" x2="${w - padR}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/>`);
    s.push(`<text x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${Math.round(v * 100)}%</text>`);
  }
  const span = xmax - xmin;
  const step = span > 0.2 ? 0.1 : span > 0.08 ? 0.05 : 0.02;
  for (let v = Math.ceil(xmin / step) * step; v < xmax; v += step) {
    s.push(`<text x="${X(v)}" y="${h - padB + 16}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${Math.round(v * 100)}%</text>`);
  }
  s.push(`<text x="${w - padR}" y="${h - 2}" text-anchor="end" font-size="11" style="fill:var(--muted)">Team-preview usage →</text>`);
  s.push(`<text x="${padL}" y="${padT - 6}" font-size="11" style="fill:var(--muted)">↑ Selection rate</text>`);
  const labels = [];
  pts.forEach(([n, v], i) => {
    const cx = X(v.usage), cy = Y(v.bring);
    const tipTxt = `${esc(short(n))}<br>Usage <b>${pct(v.usage)}</b> (${v.teams} teams)<br>Selection rate <b>${pct(v.bring, 0)}</b> (${pct(v.bring_ci[0], 0)}–${pct(v.bring_ci[1], 0)})`
      + (v.games ? `<br>Win rate when selected ${pct(v.win_shrunk, 0)} (${v.games} battles)` : '');
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
  window.MetaCharts?.destroy(el);
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
  const s = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Rank trends (top ${n})">`];
  for (let r = 1; r <= n; r++) s.push(`<text x="${padL - 14}" y="${Y(r) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${r}</text>`);
  s.push(`<text x="${padL - 14}" y="${Y(n + 1) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">Outside top ranks</text>`);
  for (const c of cuts) {
    const bx = (X(c - 1) + X(c)) / 2;
    s.push(`<line x1="${bx}" x2="${bx}" y1="${padT - 12}" y2="${h - padB}" stroke-dasharray="4 4" style="stroke:var(--muted)"/>`);
    s.push(`<text x="${bx + 6}" y="${padT - 2}" font-size="11" style="fill:var(--muted)">${esc(track.segments[c - 1].regulation)} → ${esc(track.segments[c].regulation)}</text>`);
  }
  months.forEach((m, i) => s.push(`<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">Month ${+m.slice(5)}</text>`));
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
    const hist = months.map((m, i) => `Month ${+m.slice(5)} ${ranks[i][k] ? `#${ranks[i][k]}` : 'Outside top ranks'}`).join(' → ');
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
    if (!early) throw new Error(`early/${f.id}.json could not be loaded`);
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
  globalThis.MetaCharts?.destroyAll();
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
      panel.insertAdjacentHTML('afterbegin', `<p class="empty route-error" role="alert">Unable to load data (${esc(e.message)}).<button type="button" data-retry-route>Reload</button></p>`);
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
    poke: `${short(route.p || '')}: usage, moves and items (${label})— Champions Meta`,
    rank: `Usage rankings (${label})— Champions Meta`,
    select: `Selection predictions (${label})— Champions Meta`,
    diag: `Team analysis (${label})— Champions Meta`,
    speed: `Speed tuning${route.p ? ` · ${short(route.p)}` : ''} (${label})— Champions Meta`,
  }[shown] || `Champions Meta (${label})— Selection trends, predictions and Speed`;
}

// ── 開始直後の環境（月次統計がまだ無いルール。src/cmeta/analysis/early.py） ─────────────
// 同じ人の同じチームを 1 つとして数えた、リプレイだけの数字。件数が目安に届くまでは「集計中」と出す
function earlyDays(t) { return new Date(t * 1000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }); }
function earlyReadyTxt(r, what) {
  if (!r) return '';
  if (r.have >= r.need) return '';
  const left = r.days_left == null ? '' : `(At the current rate, approximately ${Math.max(1, Math.ceil(r.days_left))} more days)`;
  return `<p class="evalbox" style="margin-top:0">${what}: collecting data: ${r.have.toLocaleString()} / ${r.need.toLocaleString()}${left}. Estimates remain volatile until then; use the intervals as a guide.</p>`;
}
function earlyRow(k, e, maxU) {
  const u = spriteUrl(k);
  const bar = (v, lo, hi) => `<span class="b"><i style="width:${(v / maxU * 100).toFixed(0)}%"></i></span>`;
  return `<li><a class="plain" href="${linkTo({ v: 'poke', p: k })}">${u ? `<img src="${esc(u)}" width="40" height="40" alt="" loading="lazy">` : ''}`
    + `<span class="nm">${esc(short(k))}</span></a>`
    + `<span class="ebar">${bar(e.usage)}<b>${pct(e.usage, 0)}</b><small class="note">${pct(e.usage_ci[0], 0)}〜${pct(e.usage_ci[1], 0)}</small></span>`
    + `<span class="ebr">${e.bring != null ? `Selected <b>${pct(e.bring, 0)}</b><small class="note">${pct(e.bring_ci[0], 0)}–${pct(e.bring_ci[1], 0)}</small>` : ''}</span></li>`;
}
function renderEarlyEnv() {
  const E = view.early;
  const f = view.f;
  const box = $('early-env');
  if (!E || !E.available) { box.innerHTML = `<section class="card c12"><p class="empty">${esc(formatLabel(f))} has just started; no eligible battles are available yet.</p></section>`; return; }
  const all = Object.entries(E.pokemon);
  const MIN = 30; // 選出・先発の割合を並べるのは、30 チーム以上に入っているポケモンだけ
  // .mu の 1 行は「アイコン・名前・数字」の 3 つに分けて並べる
  const rateLi = (k, v, lo, hi, n) => `<li>${icon(k, 36)}<a class="plain" href="${linkTo({ v: 'poke', p: k })}">${esc(short(k))}</a>`
    + `<span><b>${pct(v, 0)}</b> <small class="note">${pct(lo, 0)}–${pct(hi, 0)} · ${n} teams</small></span></li>`;
  const withB = all.filter(([, e]) => e.bring != null && e.bring_teams >= MIN);
  const hiB = [...withB].sort((a, b) => b[1].bring - a[1].bring).slice(0, 6);
  const loB = [...withB].sort((a, b) => a[1].bring - b[1].bring).slice(0, 6);
  const withL = all.filter(([, e]) => e.lead != null && e.lead_teams >= MIN);
  const hiL = [...withL].sort((a, b) => b[1].lead - a[1].lead).slice(0, 6);
  const expB = E.k_bring / 6, expL = E.k_lead / 6;
  const usage = all.slice(0, 20);
  const USAGE_OPEN = 5; // 使用率はほかでも見られるので、上位だけ開いて残りは畳む
  const maxU = Math.max(...usage.map(([, e]) => e.usage), 0.01);
  const none = '<li class="note">Not enough samples yet</li>';
  box.innerHTML = `<section class="hero"><div class="k">${dots(esc(formatLabel(f)), `${earlyDays(E.from)}–${earlyDays(E.to)}`, 'Public Showdown replays')}</div>`
    + `<h1>${esc(formatLabel(f))}:<br>What will they bring?</h1>`
    + `<p class="lead">What do players actually select and lead after team preview? Based on public replays from the Showdown battle simulator: ${E.samples.toLocaleString()} replays · ${E.players.toLocaleString()} players · ${E.teams.toLocaleString()} teams (each player’s identical six-Pokémon team is counted once). The player population differs from in-game Ranked Battles, so trends may differ.</p></section>`
    + '<div class="grid">'
    + `<section class="card c12"><h2>Selection trends <span class="chip warn">New format</span></h2>${earlyReadyTxt(E.ready.bring, 'Selection rate')}`
    + `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">Often selected when on the team</div><ul class="mu">${hiB.map(([k, e]) => rateLi(k, e.bring, e.bring_ci[0], e.bring_ci[1], e.bring_teams)).join('') || none}</ul></div>`
    + `<div class="c6"><div class="k">Often benched despite appearing in team preview</div><ul class="mu">${loB.map(([k, e]) => rateLi(k, e.bring, e.bring_ci[0], e.bring_ci[1], e.bring_teams)).join('') || none}</ul></div></div>`
    + `<p class="note">Fraction of teams containing the Pokémon that actually selected it (one vote per team). With ${E.k_bring} Pokémon selected, the average is ${pct(expB, 0)}. Small figures show 95% intervals. Only Pokémon on at least ${MIN} teams are shown.</p></section>`
    + `<section class="card c6"><h2>Common leads</h2><ul class="mu">${hiL.map(([k, e]) => rateLi(k, e.lead, e.lead_ci[0], e.lead_ci[1], e.lead_teams)).join('') || none}</ul>`
    + `<p class="note">Fraction of teams containing the Pokémon that led with it. Average: ${pct(expL, 0)}.</p></section>`
    + '<section class="card c6" id="early-induce"><h2>How team preview changes opposing selections <span class="chip warn">Estimate</span></h2><p class="empty">Loading…</p></section>'
    + `<section class="card c12"><h2>Selection predictions</h2><p>Enter the opposing six to estimate selection and lead probabilities. After the leads appear, switch to probabilities for the remaining selections.</p>`
    + `<p><a class="btn" href="${linkTo({ v: 'select' })}">Open selection predictions ›</a></p><p class="note" id="early-select-note"></p></section>`
    + `<section class="card c12"><h2 class="sub" style="margin-top:0">Reference: usage (fraction of teams containing the Pokémon)</h2>`
    + `<ol class="early-list compact">${usage.slice(0, USAGE_OPEN).map(([k, e]) => earlyRow(k, e, maxU)).join('')}</ol>`
    + (usage.length > USAGE_OPEN ? `<details class="table"><summary>${USAGE_OPEN + 1}–${usage.length}: show ranks</summary>`
      + `<ol class="early-list compact">${usage.slice(USAGE_OPEN).map(([k, e]) => earlyRow(k, e, maxU)).join('')}</ol></details>` : '')
    + '<p class="note">In-game usage rankings are available in the game and on other sites. Here, focus on whether a Pokémon is actually selected. Win rates are omitted because player skill differences affect them.</p></section>'
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
    el.innerHTML = '<h2>How team preview changes opposing selections <span class="chip warn">Estimate</span></h2>'
      + (rows.length ? `<ul class="mu">${rows.slice(0, 6).map((r) => `<li>${icon(r.name, 36)}`
        + `<span>${esc(short(r.u))} in team preview changes selections of <a class="plain" href="${linkTo({ v: 'poke', p: r.name })}">${esc(short(r.name))}</a> by</span>`
        + `<span><b>${pct(r.bring[0], 0)} → ${pct(r.bring[1], 0)}</b></span></li>`).join('')}</ul>`
        : '<p class="empty">No clear changes have been found yet; more battles may reveal them.</p>')
      + '<p class="note">Changes in our selection rate when that Pokémon appeared in opposing team preview. Only changes beyond random variation and consistent with type matchups are shown. See individual Pokémon pages for details.</p>';
  });
  getJSON(`select/${f.id}.json`).then((S) => {
    if (view !== targetView || route.f !== f.id) return;
    const el = $('early-select-note');
    if (!el) return;
    if (!S?.available) { el.textContent = `Not enough battles yet; calculations use overall selection rates (${reasonEn(S?.reason) || ''}).`; return; }
    const ev = S.eval;
    el.textContent = `Evaluation (${ev.test.toLocaleString()} battles): probability fit compared with overall rates alone: ${ev.loglik.diff >= 0 ? '+' : ''}${ev.loglik.diff.toFixed(3)}`
      + ` (${ev.loglik.ci[0] > 0 ? 'Clearly better' : 'No clear difference'}).${S.track?.available ? `Prospective results: ${S.track.n} battles.` : 'Prospective results are recorded from the start of data collection.'}`;
  }).catch(() => {});
}
function renderEarlyRank() {
  const E = view.early;
  const q = norm($('q').value.trim());
  $('rank-asof').innerHTML = dots(esc(formatLabel(view.f)), 'New format', 'Public Showdown replays', 'Each player’s identical team counted once');
  if (!E || !E.available) { $('rank-grid').innerHTML = '<li class="empty">No eligible battles yet.</li>'; return; }
  const list = Object.entries(E.pokemon).filter(([k]) => !q || norm(sourceJa(k)).includes(q) || norm(k).includes(q));
  const maxU = Math.max(...list.map(([, e]) => e.usage), 0.01);
  $('rank-grid').innerHTML = list.length
    ? list.map(([k, e], i) => `<li class="early-rank"><span class="no">${i + 1}</span>${earlyRow(k, e, maxU).replace(/^<li>|<\/li>$/g, '')}</li>`).join('')
    : '<li class="empty">No data match these filters.</li>';
}
function renderEarlyPoke(g) {
  const E = view.early;
  const e = E?.pokemon?.[g];
  const types = (poke(g).types || []).map((t) => `<span class="type t-${t.toLowerCase()}">${TYPE_JA[t] || t}</span>`).join(' ');
  const home = spriteUrl(g, 'artwork');
  $('poke-bar').innerHTML = `${home ? `<img class="home" src="${esc(home)}" data-sprite-fallback="${esc(home.replace(/other\/official-artwork\//, ''))}" width="84" height="84" alt="">` : icon(g, 64)}`
    + `<div><h1 class="nm">${esc(ja(g))}</h1><div class="meta">${types}${dots(esc(formatLabel(view.f)), 'New format')}</div></div><div class="nav"></div>`;
  const cards = [];
  cards.push(`<section class="card c12"><h2>Current statistics <span class="chip warn">New format</span></h2>${e ? `<div class="kv">`
    + `<div><span class="k">Usage (teams)</span><b>${pct(e.usage, 0)}</b><small class="note">${pct(e.usage_ci[0], 0)}–${pct(e.usage_ci[1], 0)} · ${e.teams} teams</small></div>`
    + (e.bring != null ? `<div><span class="k">Selection rate</span><b>${pct(e.bring, 0)}</b><small class="note">${pct(e.bring_ci[0], 0)}–${pct(e.bring_ci[1], 0)} · ${e.bring_teams} teams</small></div>` : '')
    + '</div>' : '<p class="empty">Too few teams contain this Pokémon to display an estimate yet.</p>'}`
    + '<p class="note">Each player’s identical six-Pokémon team is counted once. Moves, items and Speed will be shown when monthly statistics are released after the month ends.</p></section>');
  if (view.f.team_select) cards.push('<section class="card c8" id="p-induce"><h2>Selection influence <span class="chip warn">Estimate</span></h2><p class="empty">Loading…</p></section>');
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
  $('asof').innerHTML = dots(`${y}-${+m}`, esc(label), 'Showdown', `Rating ${cut}+`);
  document.querySelectorAll('.cut').forEach((e) => { e.textContent = cut; });

  $('t-div').innerHTML = `<div class="k">Effective number of Pokémon</div><div class="big">${div ? div.q1.toFixed(1) : '—'}</div>`
    + `<div class="note">${dots(divPrev ? `Previous month ${(div.q1 - divPrev.q1 >= 0 ? '+' : '')}${(div.q1 - divPrev.q1).toFixed(1)}` : '', 'Diversity accounting for uneven usage')}</div>`;
  $('t-turn').innerHTML = `<div class="k">Turnover since last month</div><div class="big">${turn != null ? pct(turn) : '—'}</div>`
    + `<div class="note">${turn == null ? 'No previous month' : turn < 0.03 ? 'A stable month' : turn < 0.06 ? 'Some change this month' : 'Major change this month'}</div>`;
  const home = spriteUrl(top, 'artwork');
  $('t-top').href = linkTo({ v: 'poke', p: top });
  $('t-top').innerHTML = `${home ? `<img src="${esc(home)}" data-sprite-fallback="${esc(home.replace(/other\/official-artwork\//, ''))}" width="140" height="140" alt="">` : ''}`
    + `<div class="k">No. 1 in usage</div><div class="big name">${esc(short(top))}</div>`
    + `<div class="note">${pct(ug[top][i])}${topDelta != null ? `<span class="chip">${topDelta >= 0 ? '▲' : '▼'}${Math.abs(topDelta * 100).toFixed(1)}</span>` : ''}</div>`;
  $('t-battles').innerHTML = `<div class="k">Battles included</div><div class="big">${battles != null ? (battles >= 10000 ? `${Math.round(battles / 10000)} × 10,000` : battles.toLocaleString()) : '—'}</div><div class="note">Monthly Smogon statistics</div>`;

  // スマホの総評（A5）: 1位と、伸びたポケモンを文にする
  const risers = (mo.movers[month]?.rising || []).slice(0, 2).map((r) => short(r.name));
  const turnTxt = turn == null ? '' : `Turnover is ${pct(turn)}: ${turn < 0.03 ? 'low; the leading Pokémon are settling' : 'high; the metagame is shifting'}.`;
  $('summary').innerHTML = `${home ? `<img src="${esc(home)}" data-sprite-fallback="${esc(home.replace(/other\/official-artwork\//, ''))}" width="140" height="140" alt="">` : ''}`
    + `<div class="k">Monthly overview · Month ${+m} · ${esc(label)}</div>`
    + `<h2><span>${esc(short(top))}</span> leads usage</h2>`
    + `<p>${turnTxt}${risers.length ? `${risers.map(esc).join(' and ')} rose sharply.` : 'Select a Pokémon to explore its sets and common teammates.'}</p>`
    + `<div class="summary-actions"><a href="${linkTo({ v: 'select' })}">Predict selections</a><a href="${linkTo({ v: 'speed', f: speedFormatFor(view.f.id) })}">Tune Speed</a></div>`;

  // 並び（名前を押すと詳細へ）
  const cm = cores && cores.months[month];
  const chipLink = (n) => `<a class="plain" href="${linkTo({ v: 'poke', p: groupOf(n) })}"><span>${icon(n, 28)}${esc(short(n))}</span></a>`;
  $('cores').innerHTML = cm && cm.cores.length
    ? cm.cores.slice(0, 3).map((c) => `<div class="core">${c.members.slice(0, 5).map(chipLink).join('')}</div>`).join('')
    : '<p class="empty">No distinct cores were found.</p>';
  const gap = mo.cutoff_gap.months[month];
  $('gap-chip').textContent = `${mo.cutoff_gap.high} − overall`;
  $('gap').innerHTML = gap
    ? gap.higher_at_top.slice(0, 5).map((r) => `<li><a class="plain" href="${linkTo({ v: 'poke', p: r.name })}"><span>${icon(r.name, 28)}${esc(short(r.name))}</span></a><b>+${Math.round(r.diff * 100)}pt</b></li>`).join('')
    : '';

  renderTopCard();
  renderSetMoves();

  const rec = weekly && weekly.available ? weekly.recent : null;
  $('bring-note').textContent = rec
    ? `Public Showdown replays from the last ${rec.days} days · ${rec.n_series.toLocaleString()} series / ${rec.n_games.toLocaleString()} battles. Each best-of-three series is counted once.`
    : '';

  $('sources').innerHTML = 'Sources: ' + META.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.name)}</a>`).join(' / ');
  $('generated').textContent = updateStatus();
}

function drawCharts() {
  if (!view || !view.mo || $('view-env').hidden) return;
  const { mo, track, weekly } = view;
  const month = mo.months.at(-1);
  document.querySelectorAll('[data-trend]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.trend === view.trend)));
  $('sec-trend').querySelector('h2').firstChild.textContent = view.trend === 'rank' ? 'Rank trends ' : 'Usage trends ';
  const top = view.trend === 'rank'
    ? (window.Chart && window.MetaCharts
      ? window.MetaCharts.trend($('trend'), track, { name: ja, short, icon: (n) => icon(n, 22), mode: 'rank' })
      : bumpChart($('trend'), track, $('trend').clientWidth || 700))
    : trendChart($('trend'), track, $('trend').clientWidth || 700);
  trendTable($('trend-table'), track, top);
  $('trend-table').closest('details').hidden = !!(window.Chart && window.MetaCharts);
  $('sec-trend').querySelector('.chart-note').hidden = !(window.Chart && window.MetaCharts);
  const movers = mo.movers[month];
  $('sec-movers').querySelector('h2').textContent = movers ? 'Risers and fallers since last month' : 'Top 5 in usage this month';
  if (movers) moversChart($('movers'), movers, $('movers').clientWidth || 380);
  else {
    const usage = track.usage_grouped;
    const rows = Object.keys(usage).sort((a, b) => (usage[b].at(-1) || 0) - (usage[a].at(-1) || 0)).slice(0, 5);
    $('movers').innerHTML = `<ul class="usage-list">${rows.map((k) => `<li><a href="${linkTo({ v: 'poke', p: k })}">${icon(k, 28)}<span>${esc(short(k))}</span><b>${pct(usage[k].at(-1))}</b></a><div class="usage-track"><i style="width:${Math.min(100, Math.max(0, (usage[k].at(-1) || 0) * 100))}%"></i></div></li>`).join('')}</ul><p class="note">Showing this month’s leaders because no previous-month data are available for this format.</p>`;
  }
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
  $('rank-asof').innerHTML = dots(`${y}-${+m}`, esc(formatLabel(f)), `Rating ${mo.default_cutoff}+`, 'Mega forms grouped with their base forms');
  const q = norm($('q').value.trim());
  const rows = rankRows().filter((r) => !q || norm(sourceJa(r.k)).includes(q) || norm(r.k).includes(q));
  $('rank-count').textContent = `${rows.length} Pokémon ${q ? 'found' : 'sorted by usage'} · Values show the fraction of teams containing each Pokémon`;
  $('rank-grid').innerHTML = rows.length ? rows.map((r) => {
    const d = r.prev ? r.prev - r.rank : null;
    const delta = d == null ? '<small class="up-t">NEW</small>' : d > 0 ? `<small class="up-t">▲${d}</small>` : d < 0 ? `<small class="dn-t">▼${-d}</small>` : '<small class="eq-t">―</small>';
    const u = spriteUrl(r.k);
    return `<li><a class="${typeClass(r.k)}" href="${linkTo({ v: 'poke', p: r.k })}">`
      + `<span class="no">${r.rank}</span><span class="pic">${u ? `<img src="${esc(u)}" width="64" height="64" loading="lazy" alt="">` : ''}</span>`
      + `<span class="nm">${esc(nameParts(r.k)[0])}${nameParts(r.k)[1] ? `<small>${esc(nameParts(r.k)[1])}</small>` : ''}</span>`
      + `<span class="v">${pct(r.usage)}${delta}</span></a></li>`;
  }).join('') : '<li class="none">No matches found.</li>';
}

// ── ポケモン詳細 ─────────────────────────────────────────
const NATURE = {
  Hardy: 'Hardy', Lonely: 'Lonely', Brave: 'Brave', Adamant: 'Adamant', Naughty: 'Naughty', Bold: 'Bold',
  Docile: 'Docile', Relaxed: 'Relaxed', Impish: 'Impish', Lax: 'Lax', Timid: 'Timid', Hasty: 'Hasty',
  Serious: 'Serious', Jolly: 'Jolly', Naive: 'Naive', Modest: 'Modest', Mild: 'Mild', Quiet: 'Quiet',
  Bashful: 'Bashful', Rash: 'Rash', Calm: 'Calm', Gentle: 'Gentle', Sassy: 'Sassy', Careful: 'Careful', Quirky: 'Quirky',
};
const TYPE_JA = {
  Normal: 'Normal', Fire: 'Fire', Water: 'Water', Electric: 'Electric', Grass: 'Grass', Ice: 'Ice', Fighting: 'Fighting', Poison: 'Poison',
  Ground: 'Ground', Flying: 'Flying', Psychic: 'Psychic', Bug: 'Bug', Rock: 'Rock', Ghost: 'Ghost', Dragon: 'Dragon', Dark: 'Dark',
  Steel: 'Steel', Fairy: 'Fairy',
};
function spreadLabel(sp) {
  const [nat, pts] = sp.split(':');
  const v = (pts || '').split('/').map(Number);
  const parts = ['H', 'A', 'B', 'C', 'D', 'S'].map((s, i) => (v[i] ? `${s}${v[i]}` : '')).filter(Boolean).join(' ');
  return `${NATURE[nat] || nat} ${parts}`;
}
function barList(obj, nameOf, n = 8) {
  const rows = Object.entries(obj || {}).slice(0, n);
  if (!rows.length) return '<p class="empty">No data available.</p>';
  return `<ul class="bl">${rows.map(([k, v]) => `<li><span class="nm">${esc(nameOf(k))}</span><span class="b"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></span><span class="p">${pct(v)}</span></li>`).join('')}</ul>`;
}
const nameIn = (kind) => (id) => { const e = NAMES[kind][id]; return (e && (e.en || e.ja)) || id; };

function renderPoke(g) {
  globalThis.MetaCharts?.destroy($('p-trend'));
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
  const home = spriteUrl(forms[0] || g, 'artwork');
  const types = (info.types || []).map((t) => `<span class="type t-${t.toLowerCase()}">${TYPE_JA[t] || t}</span>`).join(' ');
  const prev = rows[idx - 1];
  const next = rows[idx + 1];
  $('poke-bar').innerHTML = `${home ? `<img class="home" src="${esc(home)}" data-sprite-fallback="${esc(home.replace(/other\/official-artwork\//, ''))}" width="84" height="84" alt="">` : icon(g, 64)}`
    + `<div><h1 class="nm">${esc(ja(g))}</h1><div class="meta">${types}`
    + `${row ? dots(`#${row.rank}`, pct(row.usage), esc(formatLabel(f))) : dots('Outside top ranks', esc(formatLabel(f)))}</div></div>`
    + `<div class="nav">${prev ? `<a href="${linkTo({ p: prev.k })}">‹ <span class="lbl">${esc(short(prev.k))}</span></a>` : ''}`
    + `${next ? `<a href="${linkTo({ p: next.k })}"><span class="lbl">${esc(short(next.k))}</span> ›</a>` : ''}</div>`;

  const cards = [];
  const series = track.usage_grouped[g];
  if (series) cards.push('<section class="card c7"><h2>Usage trends</h2><div class="chart" id="p-trend"></div></section>');
  const lo = mo.usage_grouped[String(mo.cutoff_gap.low)]?.[g]?.[i];
  const hi = mo.usage_grouped[String(mo.cutoff_gap.high)]?.[g]?.[i];
  const wr = weekly && weekly.available ? weekly.recent.pokemon[g] : null;
  cards.push(`<section class="card ${series ? 'c5' : 'c12'}"><h2>Current statistics</h2><div class="kv">`
    + `<div><span class="k">Usage (${cut}+)</span><b>${row ? pct(row.usage) : '—'}</b></div>`
    + `<div><span class="k">Rank</span><b>${row ? `#${row.rank}` : '—'}</b></div>`
    + `<div><span class="k">Overall → ${mo.cutoff_gap.high}+</span><b>${lo != null && hi != null ? `${pct(lo, 0)} → ${pct(hi, 0)}` : '—'}</b></div>`
    + `<div><span class="k">Selection rate <span class="chip warn">Estimate</span></span><b>${wr ? pct(wr.bring, 0) : '—'}</b></div>`
    + (view.top?.pokemon?.[g]?.bring ? (() => { const t = view.top.pokemon[g].bring; return `<div><span class="k">Selection rate (top 500 players)</span><b>${pct(t.est, 0)}</b><small class="note">${pct(t.ci[0], 0)}–${pct(t.ci[1], 0)} · Other players ${pct(t.other, 0)} · ${t.players} players${t.clear ? ' · Clear difference' : ''}</small></div>`; })() : '')
    + `</div>${wr ? `<p class="note">Public replays from the last 28 days: team preview on ${wr.teams} teams, win rate when selected ${pct(wr.win_shrunk, 0)} (${wr.games} battles, shrunk toward 50%)</p>` : ''}</section>`);

  // 姿ごとの型（メガなど複数の姿があれば、使われている順に）
  const split = mo.mega_split[month]?.[g];
  const total = forms.reduce((s, x) => s + detail.pokemon[x].usage, 0);
  forms.forEach((k, j) => {
    const d = detail.pokemon[k];
    if (forms.length > 1) {
      const share = split && split[k] != null ? split[k] : d.usage / total;
      cards.push(`<div class="c12"><h2 style="margin:12px 4px 0;display:flex;align-items:center;gap:6px">${icon(k, 40)}${esc(ja(k))}<span class="chip">${pct(share, 0)}</span></h2></div>`);
    }
    cards.push(`<section class="card c4"><h2>Moves</h2>${barList(d.moves, nameIn('moves'), 10)}</section>`);
    cards.push(`<section class="card c4"><h2>Items</h2>${barList(d.items, nameIn('items'), 8)}<h2 class="sub">Abilities</h2>${barList(d.abilities, nameIn('abilities'), 3)}</section>`);
    cards.push(`<section class="card c4"><h2>Stat points (nature)</h2>${barList(d.spreads, spreadLabel, 5)}</section>`);
    if (view.sets?.pokemon?.[k]) cards.push(setTrendCard(view.sets, k));
    cards.push(`<div data-spd-slot="${esc(k)}" hidden></div>`);
    if (j === 0 && d.teammates.length) {
      cards.push(`<section class="card c8"><h2>Common teammates</h2><ul class="mates">${d.teammates.map(([b, sh]) => `<li><a href="${linkTo({ p: groupOf(b) })}">${icon(b, 48)}<span>${esc(short(b))}</span><b>${pct(sh, 0)}</b></a></li>`).join('')}</ul></section>`);
    }
  });
  if (!forms.length) cards.push('<section class="card c8"><p class="empty">Set data are unavailable due to low usage.</p></section>');
  if (f.team_select && f.replay_days) cards.push('<section class="card c8" id="p-induce"><h2>Selection influence <span class="chip warn">Estimate</span></h2><p class="empty">Loading…</p></section>');
  const bs = info.base_stats;
  if (bs) {
    const lab = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
    const sum = Object.values(bs).reduce((a, b) => a + b, 0);
    cards.push(`<section class="card c4"><h2>Base stats <span class="chip">Total ${sum}</span></h2>${Object.entries(lab).map(([k, l]) => `<div class="stat"><span>${l}</span><b>${bs[k]}</b><span class="b"><i style="width:${Math.min(100, bs[k] / 2)}%"></i></span></div>`).join('')}</section>`);
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
    return `<rect class="${v < mine ? 'faster' : v === mine ? 'tie' : 'slower'}" x="${x(v) - bw / 2}" y="${H - B - h}" width="${bw}" height="${h}"><title>Speed stat ${v}: ${pct(p, 1)}</title></rect>`;
  }).join('');
  const ticks = [...new Set([Math.min(...values.map(([v]) => v)), spdMode(e), Math.max(...values.map(([v]) => v))])].sort((a, b) => a - b);
  return `<svg class="mirror-distribution" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ja(e.name || ''))} opposing Speed distribution. Your Speed stat: ${mine}. Bar height shows the share of each spread">`
    + `<line class="mirror-axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>${bars}`
    + `<line class="mirror-mine" x1="${x(mine)}" y1="24" x2="${x(mine)}" y2="${H - B}"/>`
    + `<text class="mirror-mine-label" x="${Math.max(72, Math.min(W - 72, x(mine)))}" y="17" text-anchor="middle">You ${mine}</text>`
    + ticks.map((v) => `<text x="${x(v)}" y="${H - 11}" text-anchor="middle">${v}</text>`).join('') + '</svg>';
}

function spdMirrorSummary(e, k, bare) {
  const p = spdMirrorSplit(bare, e.dist);
  if (!p.available) return '<p class="empty">No mirror-match distribution data are available.</p>';
  const mode = spdMode(e);
  const next = [...e.dist].filter(([v, weight]) => weight > 0 && v >= bare)
    .map(([v]) => ({ value: v, need: Array.from({ length: 33 }, (_, i) => i).find((i) => spdStat(e.base, i, spdState.sign) > v) }))
    .filter((x) => x.need != null && x.need > spdState.sp).sort((a, b) => a.need - b.need)[0];
  const segment = (key, label) => `<span class="${key}" style="width:${p[key] * 100}%" title="${label} ${pct(p[key], 1)}"></span>`;
  const legend = (key, label) => `<div class="${key}"><b>${pct(p[key], 1)}</b><span>${label}</span></div>`;
  const gain = next ? spdMirrorSplit(spdStat(e.base, next.need, spdState.sign), e.dist).first - p.first : 0;
  return `<div class="mirror-head"><div><h2>Chance of moving first in a mirror match</h2><p class="note">${esc(ja(k))} mirror match, with identical modifiers on both sides</p></div>`
    + `<div class="mirror-verdict" role="status"><b>${pct(p.first, 1)}</b><small>Speed ties count as half</small></div></div>`
    + `<p class="mirror-context">Common opposing Speed stat: <strong>${mode}</strong>; compared across all spreads</p>`
    + `<div class="mirror-meter" role="img" aria-label="You are faster ${pct(p.faster, 1)}, Speed tie ${pct(p.tie, 1)}, Opponent is faster ${pct(p.slower, 1)}">${segment('faster', 'You are faster')}${segment('tie', 'Speed tie')}${segment('slower', 'Opponent is faster')}</div>`
    + `<div class="mirror-legend">${legend('faster', 'You are faster')}${legend('tie', 'Speed tie')}${legend('slower', 'Opponent is faster')}</div>`
    + `<div class="mirror-actions">${next ? `<p>Add <strong> ${next.need - spdState.sp} points</strong> to outspeed ${next.value}.<br>Chance of moving first: <strong>+${(gain * 100).toFixed(1)}pt</strong></p><button type="button" class="pill" data-mirror-sp="${next.need}" data-mirror-sign="${spdState.sign}">${next.need} points: try this spread</button>` : '<p>Additional points with this nature cannot outspeed any further spreads.</p>'}</div>`
    + `<details class="speed-distribution"><summary>Chart opposing spreads</summary>${spdDistribution(e, bare, Math.min(720, $('speed-out').clientWidth - 40))}<p class="note">The horizontal axis shows Speed stats; bars show spread shares. The vertical line marks your stat.</p></details>`;

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
  const chips = Object.entries(kinds).filter(([, s]) => s >= 0.005).map(([n, s]) => `<span class="chip">${speedKindLabel(n)} ${pct(s, 0)}</span>`).join(' ');
  const extra = [e.scarf >= 0.01 ? `Choice Scarf ${pct(e.scarf, 0)}` : '', e.ironball >= 0.01 ? `Iron Ball ${pct(e.ironball, 0)}` : '',
    ...Object.entries(e.abilities || {}).map(([a, s]) => `${esc(nameIn('abilities')(a))} ${pct(s, 0)}`)].filter(Boolean).join('・');
  const prio = Object.entries(e.priority || {}).map(([m, s]) => `${esc(nameIn('moves')(m))} ${pct(s, 0)}`).join('・');
  const sp = e.spread;
  const spreadTxt = sp ? `90% of Speed stats fall within ${sp.p05}–${sp.p95} (effective number of common values: ${sp.effective.toFixed(1)}; a higher value means less predictability for opponents)` : '';
  const id = `spd-${k.replace(/[^A-Za-z0-9]/g, '')}`;
  return `<section class="card c12 spd" id="${id}" data-form="${esc(k)}"><h2>Speed <span class="chip">Base stats ${b}</span> <a class="plain more" href="${linkTo({ v: 'speed', p: k })}">Speed tuning ›</a></h2>`
    + `<div class="spd-top"><div><div class="spd-hist">${bars}</div><div class="spd-axis"><span>${lo}</span><span>${hi}</span></div>`
    + `<p class="note" style="margin:6px 0 0">${chips}<br>${spreadTxt}${prio ? `<br>Priority moves: ${prio}` : ''}${extra ? `<br>${extra}` : ''}</p></div>`
    + `<div class="spd-in"><label>Speed stat <input type="number" min="1" max="999" value="${spdMode(e)}" data-v></label>`
    + `<label class="chk"><input type="checkbox" data-scarf> Scarf</label>`
    + `<div class="spd-quick">${[['Maximum Speed', spdStat(b, 32, '+')], ['Max investment, neutral', b + 52], ['No investment', b + 20], ['Minimum Speed', spdStat(b, 0, '-')]].map(([n, v]) => `<button type="button" data-set="${v}">${n} ${v}</button>`).join('')}</div></div></div>`
    + '<div class="spd-out" data-out></div>'
    + `<p class="note">Monthly Smogon statistics (${esc(S.month)} · Rating ${S.cutoff}+) are used to calculate spread distributions. Metagame shares are weighted by usage for each form.`
    + 'Items, abilities, Tailwind, Trick Room, paralysis and stat stages are excluded (see the lines for opposing Choice Scarf users). As the statistics do not link items to spreads, Scarf lines assume maximum investment with a boosting or neutral nature.</p></section>';
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
  const mark = (x) => (v > x ? '<b class="up">Faster</b>' : v === x ? '<b>Speed tie</b>' : '<b class="down">Slower</b>');
  const lineRow = (l) => `<li>${icon(l.name, 28)}<span class="v">${l.value}</span><span>${esc(short(l.name))} ${l.scarf ? 'Scarf' : ''}${speedKindLabel(l.kind)}`
    + ` <small class="note">${l.scarf ? `Scarf ${pct(l.scarf_share, 0)} · ` : ''}${esc(short(l.name))}: ${pct(l.share, 0)}${l.aimed >= 0.025 ? ` · ${l.value + 1} is a common target stat` : ''}</small></span>${mark(l.value)}</li>`;
  root.querySelector('[data-out]').innerHTML = `<div class="kv">`
    + `<div><span class="k">${scarf ? `With Choice Scarf: ${v}` : `Speed stat ${v}`}: Move first against the metagame</span><b>${pct(m.faster, 0)}</b></div>`
    + `<div><span class="k">Move after opponents</span><b>${pct(m.slower, 0)}</b></div>`
    + `<div><span class="k">Move first in a mirror match</span><b>${pct(mirror, 0)}</b>${prev != null ? `<small class="note">Last month ${pct(prev, 0)}</small>` : ''}</div></div>`
    + (near.length ? `<div class="k" style="margin-top:10px">Nearby benchmarks</div><ul class="spd-lines">${near.map(lineRow).join('')}</ul>` : '');
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
const speedKindLabel = (kind) => ({ '最速': 'Maximum Speed', '準速': 'Max investment, neutral', '無振り': 'No investment', '最遅': 'Minimum Speed', '調整': 'Custom spread' }[kind] || kind);
const SPD_THRESH = [[0.5, '50%'], [0.8, '80%'], [0.9, '90%'], [1, '100% in the data']];
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
  return `<svg class="spd-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Chance of moving first in a mirror match by point investment">${grid}${xt}${series.join('')}`
    + `<text x="${W - R}" y="${H - 10}" text-anchor="end"> points</text></svg>`
    + `<p class="note spd-legend"><span class="sw now"></span>This month, neutral nature <span class="sw now plus"></span>This month, Speed-boosting nature${e.prev_dist ? ' <span class="sw prev"></span>Last month (dotted)' : ''}</p>`;
}

// ── すばやさ調整の画面: 自分の配分を入れると、環境の中で何を抜けて何に抜かれるかが分かる ─────────
// ① 入力 → ② 答え（環境・ミラーで先に動く割合と、次に抜けるライン）→ ③ ライン表（実際に使われている値だけ）→ ④ ミラー → ⑤ 注意
// ライン表は、使用率 SPD_ROW_USAGE 以上の姿の、その姿の SPD_ROW_SHARE 以上が集まる値（と、月次のスカーフの線）。
// 暫定の作り（2026-09）。見せ方は変わる可能性がある
const SPD_ROW_USAGE = 0.01;
const SPD_ROW_SHARE = 0.15;
const SPD_NEAR = 15;
const spdState = { k: null, sign: '=', sp: 0, scarf: false, tw: false, all: false };
const SIGN_JA = { '+': 'Speed-boosting nature', '=': 'Neutral nature', '-': 'Speed-lowering nature' };

// 共有URLは調整条件だけを記録。データ自体は公開時点の統計を使う。
function spdReadShared(hash, doubles) {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const sp = q.get('sp'), sign = { up: '+', neutral: '=', down: '-' }[q.get('nature')];
  if (!sign || sp == null || !/^\d+$/.test(sp) || +sp > 32) return {};
  return { sp: +sp, sign, scarf: q.get('scarf') === '1', tw: doubles && q.get('tw') === '1' };
}
function spdShareURL(k, state = spdState) {
  const url = new URL(location.href);
  url.search = ''; // ローカル確認用のdata指定などは共有しない。
  const q = new URLSearchParams({ f: view.f.id, v: 'speed', p: k,
    sp: String(state.sp), nature: { '+': 'up', '=': 'neutral', '-': 'down' }[state.sign] });
  if (state.scarf) q.set('scarf', '1');
  if (state.tw) q.set('tw', '1');
  url.hash = q.toString();
  return url.href;
}
async function spdOpenShare(S, k) {
  document.querySelector('#speed-share-dialog')?.close();
  const e = S.pokemon[k], state = { ...spdState };
  const bare = spdStat(e.base, state.sp, state.sign);
  const p = spdMirrorSplit(bare, e.dist), url = spdShareURL(k, state);
  const text = `${ja(k)}: Speed tuning\n${SIGN_JA[state.sign]} · ${state.sp} points / Unmodified Speed stat: ${bare}\nChance of moving first in an equal-condition mirror match: ${pct(p.first, 1)} (ties count as half)\n#ChampionsMeta`;
  const intent = new URL('https://x.com/intent/post');
  intent.search = new URLSearchParams({ text, url }).toString();
  const dialog = document.createElement('dialog');
  dialog.id = 'speed-share-dialog';
  dialog.className = 'speed-share-dialog';
  dialog.setAttribute('aria-labelledby', 'speed-share-title');
  dialog.innerHTML = `<div class="speed-share-heading"><h2 id="speed-share-title">Share your Speed spread</h2><button type="button" class="pill" data-close aria-label="Close sharing dialog">Close</button></div>`
    + '<p class="note">Choose Copy image, then Create X post, and paste into the post (Ctrl+V or ⌘V on Mac). No image download is needed.</p><div class="speed-share-preview"><p>Creating result image…</p></div>'
    + `<div class="speed-share-actions"><button type="button" class="btn" data-copy-image disabled>Copy image</button><a class="btn" href="${esc(intent.href)}" target="_blank" rel="noopener noreferrer">Create X post</a><a class="pill" data-save hidden>Save image</a><button type="button" class="pill" data-native hidden>Share image</button></div>`
    + `<label class="k" for="speed-share-url">Link to this Speed spread</label><div class="speed-share-link"><input id="speed-share-url" type="text" readonly value="${esc(url)}"><button type="button" class="pill" data-copy>Copy</button></div><p class="note">Results at this link may change when the statistics are updated.</p><p class="note" role="status" data-share-status></p>`;
  document.body.append(dialog);
  let objectURL;
  dialog.addEventListener('close', () => { if (objectURL) URL.revokeObjectURL(objectURL); dialog.remove(); }, { once: true });
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('[data-copy]').onclick = async () => {
    const status = dialog.querySelector('[data-share-status]');
    try { await navigator.clipboard.writeText(url); status.textContent = 'Speed-spread link copied.'; }
    catch { dialog.querySelector('input').select(); status.textContent = 'Link selected. Copy it to share.'; }
  };
  dialog.showModal();
  try {
    const blob = await window.SpeedShare.render({ name: ja(k), signLabel: SIGN_JA[state.sign], points: state.sp,
      sprite: spriteUrl(k, 'artwork'), spriteFallback: spriteUrl(k),
      onImageError: () => { if (dialog.isConnected) dialog.querySelector('[data-share-status]').textContent = 'The Pokémon image could not be loaded, so the image contains only the results.'; },
      bare, effective: spdMineAt(e, state.sp), scarf: state.scarf, tw: state.tw, ...p,
      format: formatLabel(view.f), month: S.month, cutoff: S.cutoff, url });
    if (!dialog.isConnected) return;
    objectURL = URL.createObjectURL(blob);
    const image = new Image(); image.src = objectURL; image.alt = `${ja(k)}: Speed spread results. Speed stat ${bare}, chance of moving first in an equal-condition mirror match: ${pct(p.first, 1)}`;
    dialog.querySelector('.speed-share-preview').replaceChildren(image);
    const save = dialog.querySelector('[data-save]');
    const filename = `speed-${k.replace(/[^a-z0-9-]/gi, '-')}-${state.sp}.png`;
    save.href = objectURL; save.download = filename; save.hidden = false;
    const copyImage = dialog.querySelector('[data-copy-image]');
    if (navigator.clipboard?.write && window.ClipboardItem && (!ClipboardItem.supports || ClipboardItem.supports('image/png'))) {
      copyImage.disabled = false;
      copyImage.onclick = async () => {
        const status = dialog.querySelector('[data-share-status]');
        // 生成済みBlobをクリック直後に渡し、Safariなどのユーザー操作条件を満たす。
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          status.textContent = 'Image copied. Paste into your X post with Ctrl+V (⌘V on Mac).';
        } catch {
          status.textContent = 'Could not copy the image. Check browser clipboard permissions or choose Save image.';
        }
      };
    } else {
      copyImage.title = 'This browser does not support copying images. Save the image and attach it instead.';
      dialog.querySelector('[data-share-status]').textContent = copyImage.title;
    }
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      const native = dialog.querySelector('[data-native]'); native.hidden = false;
      native.onclick = async () => {
        try { await navigator.share({ files: [file], title: `${ja(k)}: Speed tuning`, text: `${text}\n${url}` }); }
        catch (error) { if (error.name !== 'AbortError') dialog.querySelector('[data-share-status]').textContent = 'Direct sharing failed. Choose Save image and attach it instead.'; }
      };
    }
  } catch {
    if (dialog.isConnected) dialog.querySelector('.speed-share-preview').textContent = 'Could not create the image. Use the Speed-spread link or the X post button instead.';
  }
}

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
    out.innerHTML = `<section class="card c12"><p class="empty">${view.mo ? 'No Speed data are available for this format.' : 'Speed spread distributions are calculated from monthly statistics. This format has just started; data will appear after the month ends and statistics are released.'}</p></section>`;
    return;
  }
  $('speed-asof').innerHTML = dots(esc(label), `Monthly Smogon statistics ${esc(S.month)}${S.prev_month ? ` (Last month ${esc(S.prev_month)})` : ''}`, `Rating ${S.cutoff}+`);
  const forms = Object.entries(S.pokemon).sort((a, b) => b[1].usage - a[1].usage);
  const inp = $('spd-q');
  const picker = inp.closest('.search');
  $('spd-names').innerHTML = forms.map(([k]) => `<option value="${esc(sourceJa(k))}" label="${esc(ja(k))}"></option>`).join('');
  if (!inp.dataset.bound) {
    inp.dataset.bound = '1';
    inp.addEventListener('change', () => {
      const t = norm(inp.value.trim());
      const hit = Object.keys(view.speed?.pokemon || {}).find((k) => norm(sourceJa(k)) === t || norm(k) === t || norm(sourceShort(k)) === t);
      if (hit) go({ v: 'speed', p: hit });
    });
  }
  // 最初はミラーの調整に役立つアシレーヌ。データがないルールでは使用率 1 位。
  const first = S.pokemon.Primarina ? 'Primarina' : forms[0][0];
  const k = route.p && S.pokemon[route.p] ? route.p : first;
  inp.value = ja(k);
  const e = S.pokemon[k];
  const key = `${view.f.id}:${k}`;
  if (spdState.k !== key) Object.assign(spdState, { k: key, scarf: false, tw: false, all: false }, spdDefault(e));
  const doubles = view.f.game_type === 'doubles';
  Object.assign(spdState, spdReadShared(location.hash, doubles));

  // ① 入力
  const signBtn = (s, t) => `<button type="button" data-sign="${s}" aria-pressed="${spdState.sign === s}">${t}</button>`;
  const input = '<section class="card c12 speed-workspace"><div class="speed-editor"><div class="spd-form">'
    + `<div class="spd-who">${icon(k, 56)}<div class="speed-picker"><label for="spd-q" class="k">Pokémon to tune</label><div data-spd-picker></div><div class="note">Base stats ${e.base} · Usage ${pct(e.usage, 1)}</div></div></div>`
    + `<div class="spd-ctl"><div><span class="k">Nature</span> <div class="seg" role="group" aria-label="Nature">${signBtn('+', 'Boosting')}${signBtn('=', 'Neutral')}${signBtn('-', 'Lowering')}</div></div>`
    + `<div class="spd-sp"><label for="spd-points" class="k">Speed points</label><input id="spd-points" type="range" min="0" max="32" step="1" value="${spdState.sp}" data-sp><input aria-label="Speed points (numeric input)" type="number" min="0" max="32" step="1" value="${spdState.sp}" data-sp-number><output data-sp-out hidden>${spdState.sp}</output></div>`
    + `<div class="spd-chk" hidden><label class="chk"><input type="checkbox" data-scarf ${spdState.scarf ? 'checked' : ''}> Choice Scarf</label>`
    + (doubles ? `<label class="chk"><input type="checkbox" data-tw ${spdState.tw ? 'checked' : ''}> Tailwind (double your Speed only)</label>` : '')
    + '</div></div><div class="spd-stat"><span class="k">Your Speed stat</span><b data-stat></b></div></div>'
    + `<div class="spd-presets" role="group" aria-label="Common spreads"><button class="pill" type="button" data-sp-preset="0" data-sign-preset="=">No investment</button><button class="pill" type="button" data-sp-preset="32" data-sign-preset="=">Max investment, neutral</button><button class="pill" type="button" data-sp-preset="32" data-sign-preset="+">Maximum Speed</button><button class="pill" type="button" data-sp-preset="${spdDefault(e).sp}" data-sign-preset="${spdDefault(e).sign}">Most common spread</button></div>`
    + '<p class="note speed-input-hint">Tune with 0–32 points, or choose a preset.</p></div>';
  // ②③ は入力のたびに描き直す
  const result = '<div class="speed-result mirror-summary" data-spd-mirror></div><div class="speed-share-bar"><p>Save or share this spread</p><button type="button" class="btn" data-speed-share>Result image / share on X</button></div></section>'
    + '<section class="card c12 speed-environment"><details><summary>Compare with the metagame and find opponents you outspeed</summary><p class="note">Choice Scarf and Tailwind apply only here. The mirror comparison above keeps identical conditions.</p><div data-speed-modifiers></div><div data-spd-result></div><div data-spd-lines></div></details></section>';

  // ④ ミラー
  const needTxt = (dist, sign) => SPD_THRESH.map(([thr, lab]) => {
    const sp = spdNeed(e, dist, sign, thr);
    const why = sp == null ? 'Not reachable with this nature' : `Speed stat ${spdStat(e.base, sp, sign)}`;
    return `<div><span class="k">${lab}</span><b>${sp == null ? '—' : sp}</b><small class="note">${why}</small></div>`;
  }).join('');
  const creep = e.prev_dist ? ['=', '+'].map((sign) => {
    const a = spdNeed(e, e.prev_dist, sign, 0.9), b = spdNeed(e, e.dist, sign, 0.9);
    return `${sign === '=' ? 'Neutral' : 'Boosting'} nature, 90%: last month ${a == null ? 'Not reachable' : a} → this month ${b == null ? 'Not reachable' : b}`;
  }).join('・') : '';
  const others = forms.slice(0, 30).filter(([, x]) => x.usage >= 0.02).map(([n, x]) => {
    const a = spdNeed(x, x.dist, '=', 0.9), b = spdNeed(x, x.dist, '+', 0.9);
    return `<tr><td><a class="plain" href="${linkTo({ v: 'speed', p: n })}">${icon(n, 28)} ${esc(short(n))}</a></td><td>${x.base}</td><td>${pct(x.usage, 1)}</td>`
      + `<td>${a == null ? 'Not reachable' : a}</td><td>${b == null ? 'Not reachable' : b}</td></tr>`;
  }).join('');
  const mirror = `<section class="card c12"><details class="mirror-details"><summary>Explore further: points needed by nature and comparison with last month</summary><h2>Mirror-match spread reference</h2>`
    + `<div class="spd-mirror"><div><div class="k">Neutral nature: Points needed</div><div class="kv kv4">${needTxt(e.dist, '=')}</div>`
    + `<div class="k" style="margin-top:10px">Speed-boosting nature: Points needed</div><div class="kv kv4">${needTxt(e.dist, '+')}</div>`
    + (creep ? `<p class="note">Change since last month: ${creep}</p>` : '') + `</div><div>${spdMirrorChart(e, 560)}</div></div>`
    + '<details class="table"><summary>Other Pokémon mirror matches (points needed for a 90% chance of moving first)</summary>'
    + `<table class="tt"><thead><tr><th>Pokémon</th><th>Base stats</th><th>Usage</th><th>Neutral</th><th>Boosting</th></tr></thead><tbody>${others}</tbody></table></details></details></section>`;

  // ⑤ 注意
  const prio = Object.entries(e.priority || {}).map(([m, s]) => `${esc(nameIn('moves')(m))}（${pct(s, 0)}）`).join('・');
  const notes = '<section class="card c12 speed-method"><details><summary>Calculation assumptions and data</summary><p class="note">'
    + (prio ? `${esc(ja(k))}: priority moves: ${prio}. Priority moves act first regardless of Speed.<br>` : '')
    + (e.spread ? `${esc(ja(k))}: 90% of Speed stats fall within ${e.spread.p05}–${e.spread.p95}.<br>` : '')
    + `Figures are metagame shares calculated from spreads in monthly Smogon statistics (Pokémon Showdown battles, rating ${S.cutoff}+). Metagame shares are weighted by usage for each form.`
    + ' Speed stat = trunc((base stat + points + 20) × nature modifier), at level 50. Opposing Choice Scarf benchmarks assume maximum investment with boosting or neutral natures for forms that commonly hold Scarf, as the statistics do not link items to spreads.'
    + ' Trick Room, paralysis, stat stages and abilities (such as Swift Swim) are excluded. Choose the Mega form if you will Mega Evolve.</p></details></section>';

  out.innerHTML = input + result + mirror + notes;
  out.querySelector('[data-spd-picker]').append(picker);
  const modifiers = out.querySelector('.spd-chk');
  modifiers.hidden = false;
  out.querySelector('[data-speed-modifiers]').append(modifiers);
  out.querySelector('[data-speed-share]').addEventListener('click', () => spdOpenShare(S, k));
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
  out.querySelector('[data-stat]').textContent = bare;
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
  const lineName = (r) => `${esc(short(r.name))} (${r.scarf ? 'Scarf · ' : ''}${speedKindLabel(r.kind)})`;
  out.querySelector('[data-spd-result]').innerHTML = `<h2>Position in the metagame <span class="chip">Speed stat with modifiers: ${v}</span></h2><div class="kv">`
    + `<div><span class="k">Move first against metagame opponents</span><b>${pct(m.faster, 0)}</b><small class="note">Speed ties count as half</small></div>`
    + '</div>'
    + (next ? `<p class="spd-next">Add <b>${next.need - spdState.sp}</b> points (total ${next.need}) to outspeed ${icon(next.name, 28)} ${lineName(next)} at Speed stat ${next.value}.<small class="note">Of this form, ${pct(next.share, 0)} use this value</small></p>`
      : '<p class="spd-next note">No further benchmark can be surpassed with this nature.</p>');
  // ③ ライン表
  // 同じ実数値のラインは 1 行にまとめる（環境での重みの大きい順に並べる）
  const byVal = new Map();
  for (const r of rows) { if (!byVal.has(r.value)) byVal.set(r.value, []); byVal.get(r.value).push(r); }
  const vals = [...byVal.keys()].sort((a, b) => b - a);
  const shownVals = spdState.all ? vals : vals.filter((x) => Math.abs(x - v) <= SPD_NEAR);
  const you = `<tr class="you"><td>${v}</td><td colspan="2">▶ You (${SIGN_JA[spdState.sign]} · ${spdState.sp} points${spdState.scarf ? ' · Scarf' : ''}${spdState.tw ? ' · Tailwind' : ''})</td></tr>`;
  const body = [];
  let youDone = false;
  for (const x of shownVals) {
    if (!youDone && x < v) { body.push(you); youDone = true; }
    const need = x >= v ? spdToPass(e, x) : null;
    const res = x < v ? '<b class="up">Faster</b>' : x === v ? '<b>Speed tie</b>' : '<b class="down">Slower</b>';
    const hint = x >= v ? `<small class="note">${need == null ? 'Cannot outspeed with this nature' : `${need} points to outspeed`}</small>` : '';
    const who = byVal.get(x).sort((a, b) => b.weight - a.weight).map((r) => `<a class="plain spd-mon" href="${linkTo({ v: 'speed', p: r.name })}">${icon(r.name, 24)}${esc(short(r.name))}`
      + `<small class="note">${r.scarf ? `Scarf · ${speedKindLabel(r.kind)} (held by ${pct(r.scarf_share, 0)})` : `${speedKindLabel(r.kind)} ${pct(r.share, 0)}`}</small></a>`).join('');
    body.push(`<tr><td>${x}</td><td class="spd-who-list">${who}</td><td>${res}${hint}</td></tr>`);
  }
  if (!youDone) body.push(you);
  const hidden = vals.length - shownVals.length;
  out.querySelector('[data-spd-lines]').innerHTML = '<h2>Nearby benchmarks <span class="chip">Values observed in play</span></h2>'
    + `<div class="tt-wrap"><table class="tt spd-rows"><thead><tr><th>Speed stat</th><th>Pokémon at this value (spread and share within that form)</th><th>Compared with you</th></tr></thead><tbody>${body.join('')}</tbody></table></div>`
    + `<p class="note">Usage ${pct(SPD_ROW_USAGE, 0)} or higher; values used by at least ${pct(SPD_ROW_SHARE, 0)} of that form are shown (observed values, not all theoretically possible values).`
    + `${spdState.all ? '' : `Within ±${SPD_NEAR} of your Speed stat.`}</p>`
    + `<button type="button" class="pill" data-spd-all>${spdState.all ? 'Show nearby only' : `Show all (${hidden} more rows)`}</button>`;
  out.querySelector('[data-spd-all]').addEventListener('click', () => { spdState.all = !spdState.all; spdRedraw(S, k); });
}

// ── 型の移り変わり（src/cmeta/analysis/sets.py）: 月 × レート帯。確かさは出さず、大きさだけ ──────
const SET_NOTE = 'Monthly sample counts represent battles; each player’s identical team may be counted repeatedly, so 95% intervals for random variation cannot be given. High-rating cutoffs include fewer players and can be strongly affected by a few teams.';
function setTrendCard(S, k) {
  const e = S.pokemon[k];
  const cols = [[S.prev_month, S.default_cutoff, `Last month (${S.default_cutoff}+)`], [S.month, S.default_cutoff, `This month (${S.default_cutoff}+)`],
    [S.month, S.low_cutoff, `This month · Overall`], [S.month, S.high_cutoff, `This month · ${S.high_cutoff}+`]].filter(([m]) => m);
  const big = new Set(S.changes.filter((c) => c.name === k).map((c) => `${c.type}:${c.kind}:${c.key}`));
  const rows = (kind, label, n) => {
    const keys = Object.keys(e[kind]).sort((a, b) => (e[kind][b][`${S.month}:${S.default_cutoff}`] || 0) - (e[kind][a][`${S.month}:${S.default_cutoff}`] || 0)).slice(0, n);
    return keys.map((x) => {
      const v = e[kind][x];
      const cell = ([m, c]) => { const y = v[`${m}:${c}`]; return `<td>${y == null ? '—' : pct(y, 0)}</td>`; };
      const mark = (big.has(`month:${kind}:${x}`) ? ' <small class="note">Large change since last month</small>' : '') + (big.has(`top:${kind}:${x}`) ? ' <small class="note">Different at high ratings</small>' : '');
      return `<tr><td>${esc(nameIn(kind)(x))}${mark}</td>${cols.map(cell).join('')}</tr>`;
    }).join('');
  };
  const head = `<tr><th></th>${cols.map(([, , l]) => `<th>${l}</th>`).join('')}</tr>`;
  return `<section class="card c12"><h2>Set trends (${esc(ja(k))})</h2><table class="tt set-tbl"><thead>${head}</thead><tbody>`
    + `<tr><th colspan="${cols.length + 1}" class="k">Items</th></tr>${rows('items', 'Items', 6)}`
    + `<tr><th colspan="${cols.length + 1}" class="k">Moves</th></tr>${rows('moves', 'Moves', 8)}</tbody></table>`
    + `<p class="note">Monthly Smogon statistics: the fraction of teams containing the Pokémon that used that item or move. “Large change” means a difference of at least 15 percentage points.${SET_NOTE}</p></section>`;
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
  $('sets-out').innerHTML = `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">Large change since last month (${esc(S.prev_month || '')} → ${esc(S.month)}, ${S.default_cutoff}+)</div><ul class="mu">${month.map(li).join('') || '<li class="note">None</li>'}</ul></div>`
    + `<div class="c6"><div class="k">Overall versus high ratings (${S.high_cutoff}+), differences (${esc(S.month)})</div><ul class="mu">${top.map(li).join('') || '<li class="note">None</li>'}</ul></div></div>`
    + `<p class="note">Changes of at least 15 percentage points.${SET_NOTE}</p>`;
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
    + `<div class="top-player-metric"><div class="top-player-values"><b>${pct(r.v.est, 0)}</b><small>Other players ${pct(r.v.other, 0)}</small></div>`
    + `<div class="top-player-track" role="img" aria-label="Top players ${pct(r.v.est, 0)}, Other players ${pct(r.v.other, 0)}"><span class="top-player-fill" style="width:${r.v.est * 100}%"></span><i class="top-player-other" style="left:${r.v.other * 100}%"></i></div>`
    + `<small class="top-player-meta">95% interval ${pct(r.v.ci[0], 0)}–${pct(r.v.ci[1], 0)} · ${r.v.players} players${r.v.clear ? ' · Clear difference' : ''}</small></div></li>`;
  const more = rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
  const less = rows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  $('top-out').innerHTML = (nClear ? '' : '<p class="top-note">Current data show <strong>no clear difference from top players.</strong> Treat the differences below as estimates.</p>')
    + '<p class="note top-key">Bars: top-player selection rates / vertical marks: other-player selection rates</p>'
    + `<div class="top-compare"><section><h3>Selected more often by top players</h3><ul class="top-player-list">${more.map(li).join('') || '<li class="empty">No comparable data are available.</li>'}</ul></section>`
    + `<section><h3>Selected less often by top players</h3><ul class="top-player-list">${less.map(li).join('') || '<li class="empty">No comparable data are available.</li>'}</ul></section></div>`
    + `<details class="top-method"><summary>Sample counts and interpreting comparisons</summary><p class="note">Top 500 ladder players (recorded over ${T.ladder_days} days): ${T.samples_top.toLocaleString()} selections (only Pokémon used by at least 10 players), compared with ${T.samples_other.toLocaleString()} other selections from public replays.`
    + ` A player’s selections tend to be similar (similarity ${T.icc_bring}), so effective sample sizes are discounted accordingly. Estimates and 95% intervals are shrunk toward other-player selection rates.`
    + `When checked by splitting players in half, intervals intended to cover 95% actually covered ${pct(T.coverage_bring, 0)}. A 5% FDR adjustment also filters chance differences. Top-player status uses the current ladder.</p></details>`;
}

// ── 選出誘導（src/cmeta/analysis/induce.py） ───────────────────────
async function loadInduce() {
  const target = view;
  if (target.induce === undefined) target.induce = await getJSON(`induce/${target.f.id}.json`).catch(() => null);
  return target.induce;
}
function induceRow(r, which) {
  const [p, q] = r[which];
  return `<li>${icon(r.name, 36)}<span>${esc(short(r.name))}${r.clear ? ' <b class="clear" title="Change beyond random variation (95%)">●</b>' : ''}`
    + `${r.type_ok ? ' <small class="note">Consistent with type matchup</small>' : ''}</span><span><b>${pct(p, 0)} → ${pct(q, 0)}</b> <small class="note">${r.n} previews</small></span></li>`;
}
function induceCard(ind, g) {
  const head = '<h2>Selection influence <span class="chip warn">Estimate</span></h2>';
  const e = ind?.pokemon?.[g];
  if (e && e.strength.bring == null) return `${head}<p class="empty">Too few comparable opponents to show changes yet.</p>`;
  if (!e) return `${head}<p class="empty">Too few team previews to display an estimate (${ind ? `${ind.min_u} or more previews` : 'No data'} required).</p>`;
  const all = Object.values(ind.pokemon).map((v) => v.strength.bring).filter((v) => v != null).sort((a, b) => b - a);
  const rank = all.indexOf(e.strength.bring) + 1;
  const up = e.up.filter((r) => r.bring[1] > r.bring[0]);
  const down = e.down.filter((r) => r.bring[1] < r.bring[0]);
  const none = '<li class="note">No notable change</li>';
  const pairs = (e.lead_pairs || []).filter((r) => r.share[1] > r.share[0]).slice(0, 3);
  return head
    + `<p class="note" style="margin-top:0">${esc(short(g))} in team preview: how much does the opponent’s selection change?`
    + ` Strength <b>${(e.strength.bring * 100).toFixed(1)} pt</b> (Among ${all.length} Pokémon examined, rank ${rank}; team previews: ${e.n} previews)${e.stone >= 0.5 ? ' · Mega Evolution candidate' : ''}`
    + (e.strength.bring < 0.005
      ? (up.concat(down).some((r) => r.clear)
        ? '. Overall influence is small; most opposing selections do not change (only those marked ● show a clear change).'
        : '. The effect is <b>too small to distinguish from random variation</b>; most changes below are also within that range.')
      : '') + '</p>'
    + `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">More likely opposing selections</div><ul class="mu">${up.map((r) => induceRow(r, 'bring')).join('') || none}</ul></div>`
    + `<div class="c6"><div class="k">Less likely opposing selections</div><ul class="mu">${down.map((r) => induceRow(r, 'bring')).join('') || none}</ul></div></div>`
    + (pairs.length ? `<div class="k" style="margin-top:10px">Opposing lead pairs that become more common</div><ul class="sets">${pairs.map((r) => `<li><span class="icons">${r.pair.map((k) => icon(k, 36)).join('')}</span><span>${r.pair.map((k) => esc(short(k))).join(' · ')}</span><b>${pct(r.share[0], 0)} → ${pct(r.share[1], 0)}</b></li>`).join('')}</ul>` : '')
    + ((() => {
      const tp = (view.top?.induce?.clear || []).filter((r) => r.opp === g);
      if (!tp.length) return '';
      return `<div class="k" style="margin-top:10px">Among the top 500 players (clear pairings only)</div><ul class="mu">${tp.map((r) => `<li>${icon(r.name, 36)}<span>${esc(short(r.name))}</span>`
        + `<span><b>${r.diff >= 0 ? '+' : ''}${Math.round(r.diff * 100)}pt</b> <small class="note">${Math.round(r.ci[0] * 100)}–${Math.round(r.ci[1] * 100)}pt · ${r.players} players</small></span></li>`).join('')}</ul>`
        + '<p class="note">Difference in selection rates among top players with versus without this Pokémon. Intervals use player-level resampling, with a 5% FDR adjustment for testing many pairings. Because these pairings were selected for their differences, effects may be overstated.</p>';
    })())
    + '<p class="note">“Overall selection rate → rate when this Pokémon is present.” Repeated identical team previews count once, and small-sample changes are shrunk toward overall rates.'
    + '● marks changes beyond random variation. “Consistent with type matchup” means the direction matches type-based expectations. Skill and team-building differences also affect these results.</p>';
}

// ── チームの入力（選出予想・チーム診断で共通） ───────────────────────
// 入れたチームは、この端末だけに保存する（次に開いたときのため）。保存できなくても使える
// シングルとダブルでチームは別（ダブルのチームをシングルのデータで見ないように）
const TEAMS = { singles: { opp: Array(6).fill(''), mine: Array(6).fill(''), sampled: {} }, doubles: { opp: Array(6).fill(''), mine: Array(6).fill(''), sampled: {} } };
try { const saved = JSON.parse(localStorage.getItem('cm-en-teams2') || '{}'); for (const k of Object.keys(TEAMS)) Object.assign(TEAMS[k], saved[k] || {}); } catch (e) { /* 保存がなくても動く */ }
for (const t of Object.values(TEAMS)) if (!t.sampled || typeof t.sampled !== 'object') t.sampled = {};
let TEAM = TEAMS.singles;
const useTeamFor = (f) => { TEAM = TEAMS[f.game_type === 'doubles' ? 'doubles' : 'singles']; };
const saveTeams = () => { try { localStorage.setItem('cm-en-teams2', JSON.stringify(TEAMS)); } catch (e) { /* 保存できなくてもよい */ } };

let NAME_INDEX = null; // 入力の文字 → まとめた名前
function nameIndex() {
  if (NAME_INDEX) return NAME_INDEX;
  NAME_INDEX = new Map();
  for (const [k, v] of Object.entries(NAMES.pokemon)) {
    const g = v.group || k;
    for (const s of [k, g, v.ja, sourceShort(k), v.ja && v.ja.split('（')[0]]) if (s && !NAME_INDEX.has(norm(s))) NAME_INDEX.set(norm(s), g);
  }
  return NAME_INDEX;
}
const resolveName = (text) => (text ? nameIndex().get(norm(text.trim())) || null : null);

function fillDatalist() {
  if (!view.mo) {
    $('poke-names').innerHTML = Object.keys(view.early?.pokemon || {}).map((k) => `<option value="${esc(sourceJa(k))}" label="${esc(ja(k))}"></option>`).join('');
    return;
  }
  const { mo } = view;
  const ug = mo.usage_grouped[String(mo.default_cutoff)];
  const i = mo.months.length - 1;
  const keys = Object.keys(ug).sort((a, b) => (ug[b][i] || 0) - (ug[a][i] || 0));
  $('poke-names').innerHTML = keys.map((k) => `<option value="${esc(sourceJa(k))}" label="${esc(ja(k))}"></option>`).join('');
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
        + `<input list="poke-names" data-role="${role}" data-i="${i}" value="${g ? esc(ja(g)) : ''}" placeholder="Pokémon ${i + 1}" aria-label="${role === 'mine' ? 'Your team' : 'Opponent'}: Pokémon ${i + 1}" autocomplete="off"></label>`;
    }).join('');
    box.innerHTML = `<div class="slots">${slots}</div><div class="tools">`
      + `<span class="team-count">${TEAM[role].filter(Boolean).length} / 6 Pokémon entered</span><button type="button" data-clear="${role}">Clear</button></div>`;
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
  console.log(`select self-check: maximum difference ${worst.toFixed(5)} (${(SEL.examples || []).length} examples)`);
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
const SAMPLE_ROLE_JA = { mine: 'Your team', opp: 'Opponent' };
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
  return '<section class="card c12 diag-sample"><h2>Sample teams</h2>'
    + (now.length ? `<p>Common teams have been entered as examples for “${now.join('” and “')}”. Edit the fields above to recalculate using your own entries.</p>` : '')
    + `<ul class="diag-samples">${S.teams.map((t, i) => `<li><span class="mons">${t.team.map((k) => icon(k, 32)).join('')}</span>`
      + `<span class="note">${t.players} players used this team</span><span class="btns">${roles.map((r) => `<button type="button" class="pill" data-sample="${i}" data-sample-role="${r}">${SAMPLE_ROLE_JA[r]}: use this team</button>`).join('')}</span></li>`).join('')}</ul>`
    + `<p class="note">Last ${S.days} days of public Showdown replays: teams with the most players using exactly the same six (at least ${S.min_players} players).</p></section>`;
}

let SEEN_LEADS = new Set(); // 先発に出たポケモン（押して選ぶ）
const selSlot = (p) => (p >= 0.8 ? ['fix', 'Likely selection'] : p <= 0.3 ? ['bench', 'Unlikely selection'] : ['flex', 'Matchup dependent']);

let SEL_RUN = null; // 解析した時点のルールとチーム（変わったら結果を隠す）
const selSig = () => `${view.f.id}|${TEAM.opp.join(',')}|${TEAM.mine.join(',')}`;
const SEL_STEPS = ['Loading team-preview history', 'Counting selection combinations from the opposing six', 'Adding selection tendencies against your team', 'Calculating probabilities'];
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
  const day = (t) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  $('select-asof').innerHTML = dots(esc(label), 'Public Showdown replays', SEL?.trained ? `${day(SEL.trained.from)}–${day(SEL.trained.to)}` : '');
  const out = $('select-out');
  const opp = TEAM.opp.filter(Boolean);
  const mine = TEAM.mine.filter(Boolean);
  if (!SEL || !SEL.available || SEL.model !== 'joint') {
    out.innerHTML = `<h2>Prediction</h2><p class="empty">Predictions are not yet available for this format (${esc(reasonEn(SEL?.reason) || 'No replays')}).</p>`;
    return;
  }
  if (opp.length < 6) { out.innerHTML = '<h2>Prediction</h2><p class="empty">Enter the opposing six Pokémon.</p>'; return; }
  // 「解析する」を押すまで結果は出さない。チームかルールを変えたら、もう一度押す
  if (SEL_RUN !== selSig()) {
    out.innerHTML = '<div class="sel-go"><div><h2 style="margin:0">Ready to analyze</h2>'
      + `<p class="note" style="margin:4px 0 0">Opponent: ${opp.length} Pokémon${mine.length === 6 ? ' · Your team: 6 Pokémon' : ' (your team omitted: assuming an average metagame opponent)'}</p></div>`
      + '<button type="button" class="btn sel-run" data-sel-run>Analyze</button></div>';
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
      + `<small>${e ? `Team previews: ${e[2]} previews` : 'Insufficient data (using the overall average)'}${st >= 0.05 ? ` · Mega Stone ${pct(st, 0)}` : ''}</small>`
      + `<button type="button" class="seen-btn" data-seen="${esc(k)}" aria-pressed="${isSeen}">${isSeen ? 'Seen as lead ✓' : 'Seen as lead'}</button></div>`
      + `<div class="bars"><div><span>Selected</span>${bar(bring[k])}</div><div><span>Lead</span>${bar(lead[k], 'ld')}</div>`
      + (back ? `<div><span>Remaining</span>${seen.has(k) ? '<span class="b"></span><b>Lead</b>' : bar(back[k], 'bk')}</div>` : '')
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
  const sig = (c) => (c.ci[0] > 0 ? ' (Clearly better)' : c.ci[1] < 0 ? ' (Clearly worse)' : ' (No clear difference)');
  const evalTxt = `<b>Evaluation</b> (${day(ev.test_from)} onward: ${ev.test.toLocaleString()} battles split into ${ev.blocks || 1} blocks, each checked using predictions trained on the preceding ${ev.train_days || 30} days of battles).<br>This is a retrospective evaluation using monthly set and usage statistics available at aggregation time. Results for battles after predictions were saved appear in the performance table below.<br>`
    + ` · Selections: among the top ${kb} predictions, an average of <b>${n2(ev.bring.model, kb)} Pokémon</b> (overall selection rates only: ${n2(ev.bring.baseline, kb)} Pokémon; random: ${n2(ev.bring.random, kb)} Pokémon)${sig(ev.bring)}<br>`
    + ` · Leads: among the top ${kl} predictions, average correct: ${n2(ev.lead.model, kl)} Pokémon (overall rates only: ${n2(ev.lead.baseline, kl)} Pokémon)${sig(ev.lead)}<br>`
    + ` · Remaining after leads are seen: among the top ${kb - kl} predictions, average correct: ${n2(ev.back.model, kb - kl)} Pokémon (overall rates only: ${n2(ev.back.baseline, kb - kl)} Pokémon)${sig(ev.back)}<br>`
    + ` · ${kl === 2 ? 'Lead combinations' : 'Lead'}: actual leads appeared in the top 3 predictions: ${pct(ev.lead_set_top3.model, 0)}`
    + ` · Probability fit (log likelihood), versus overall rates only: ${ev.loglik.diff >= 0 ? '+' : ''}${ev.loglik.diff.toFixed(3)} ${sig(ev.loglik)}`;
  const mode = SEL.usable
    ? `Probabilities use matchups (types, including Mega Evolution types), roles (weather, ${kl === 2 ? 'Fake Out, Intimidate, Trick Room, etc.' : 'entry hazards, Focus Sash, etc.'}), and observed selections.`
      + ' Selection depends heavily on adapting to an opponent, so exact predictions are difficult. Treat slots without high probabilities as matchup dependent.'
    : 'For this format, predicted probabilities did not improve over overall rates alone, so calculations use <b>overall selection and lead rates</b>.';
  // よくある組み合わせから外れたチーム（ふつうさの下位 5%。低レートに多い）は、予想が当たりにくい
  const ugU = view.mo?.usage_grouped?.[String(view.mo.default_cutoff)] || {};
  const typ = opp.reduce((a, k) => a + Math.log(Math.max(ugU[k]?.at(-1) || 0, 1e-4)), 0) / opp.length;
  // 注意は、答え合わせで変わったチームの予想が全体の率だけを上回れていないルールだけ（BSS は下回った。VGC は上回った）
  const odd = ev.odd_cut != null && typ <= ev.odd_cut && ev.bring_odd && ev.bring_odd.model <= ev.bring_odd.baseline + 0.005;
  const oddTxt = odd ? `<p class="evalbox" style="margin-top:0">This team is far outside common combinations (bottom 5% in typicality). Such teams are harder to predict. In evaluation, the top ${kb} predictions averaged ${ev.bring_odd ? (ev.bring_odd.model * kb).toFixed(2) : '—'} correct Pokémon (overall rates only: ${ev.bring_odd ? (ev.bring_odd.baseline * kb).toFixed(2) : '—'} Pokémon).</p>` : '';
  const rateTxt = ev.ratings ? `<br>Training battles had a median rating of ${ev.ratings.p50} (10th–90th percentile: ${ev.ratings.p10}–${ev.ratings.p90}; ${ev.ratings.n.toLocaleString()} battles with known ratings).${ev.ratings.p90 < 1500 ? 'Few high-rating battles have public replays, so selection patterns may differ at high ratings.' : ''}` : '';
  const tt = ev.temperature;
  const tempTxt = tt ? (tt.applied
    ? `<br>Probability calibration: evaluation showed predictions were ${tt.t < 1 ? 'too confident, so confidence is reduced' : 'too weak, so confidence is increased'} (factor ${tt.t}; cross-block validation improved probability fit by +${tt.loglik_gain.toFixed(3)}). Prediction order is unchanged.`
    : '<br>Probability calibration: no clear benefit was found in evaluation, so no adjustment is applied.') : '';
  const unknown = mine.length === 6 ? '' : `<br>Enter your six to include matchups against your team (currently assuming an average metagame opponent; evaluation averaged ${n2(ev.bring.unknown_opp, kb)} correct selections).`;
  out.innerHTML = `<h2>Opposing selections <span class="chip warn">Estimate</span></h2>${oddTxt}`
    + '<p class="note" style="margin-top:0">When opposing leads appear, select “Seen as lead” to switch to probabilities for the remaining selections.</p>'
    + `<ul class="pred">${rows}</ul>`
    + `<div class="grid" style="gap:12px;margin-top:14px"><div class="c6"><div class="k">${kl === 2 ? 'Lead combinations' : 'Lead'} candidates</div><ul class="sets">${setList(leadSets)}</ul></div>`
    + `<div class="c6"><div class="k">Selection combination candidates${seen ? ' (after seeing leads)' : ''}</div><ul class="sets">${setList(bringSets)}</ul></div></div>`
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
  if (!T || !T.available) return T && T.reason ? `<div class="track"><h2 class="sub">Prediction performance</h2><p class="note">${esc(reasonEn(T.reason))}</p></div>` : '';
  const day = (t) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  const sig = (c) => (c.ci[0] > 0 ? '<b class="up-t">Clearly better</b>' : c.ci[1] < 0 ? '<b class="dn-t">Clearly worse</b>' : 'No clear difference');
  const n2 = (x, k) => (x * k).toFixed(2);
  const rows = T.by_day.slice(-10).map(([d, n, m, b]) => `<tr><td>${esc(d.slice(5).replace('-', '/'))}</td><td>${n}</td><td>${n2(m, kb)}</td><td>${n2(b, kb)}</td></tr>`).join('');
  return `<div class="track"><h2 class="sub">Prediction performance <span class="chip">Prospective evaluation</span></h2>`
    + `<p class="note" style="margin-top:0">Predictions are saved daily and evaluated against <b>battles played afterward</b>, preventing predictions from being made after seeing results.`
    + ` Each battle uses only the latest prediction saved beforehand, within ${T.max_age_days} days. ${day(T.from)}–${day(T.to)}: ${T.n.toLocaleString()} battles.</p>`
    + `<div class="kv"><div><span class="k">Selections: top ${kb} predictions correct</span><b>${n2(T.bring.model, kb)} Pokémon</b><small class="note">Overall rates only ${n2(T.bring.baseline, kb)} Pokémon · ${sig(T.bring)}</small></div>`
    + `<div><span class="k">Leads: top ${kl} predictions correct</span><b>${n2(T.lead.model, kl)} Pokémon</b><small class="note">Overall rates only ${n2(T.lead.baseline, kl)} Pokémon · ${sig(T.lead)}</small></div>`
    + `<div><span class="k">Probability fit</span><b>${T.loglik.diff >= 0 ? '+' : ''}${T.loglik.diff.toFixed(3)}</b><small class="note">Difference from overall rates only · ${sig(T.loglik)}</small></div></div>`
    + `<table class="tt" style="margin-top:10px"><thead><tr><th>Prediction saved</th><th>Battles</th><th>Correct selections</th><th>Overall rates only</th></tr></thead><tbody>${rows}</tbody></table>`
    + (T.seeded_until ? `<p class="note">${esc(T.seeded_until.slice(5).replace('-', '/'))} and earlier: predictions for dates before tracking began were reconstructed using only battles up to that date and monthly statistics already released at that time (without probability calibration).</p>` : '')
    + '</div>';
}

// ── チーム診断 ───────────────────────────────────────────
async function renderDiag(revision = routeRevision) {
  if (!view.mo) {
    $('diag-asof').innerHTML = dots(esc(formatLabel(view.f)), 'New format');
    $('diag-out').innerHTML = '<section class="card c12"><p class="empty">Team analysis becomes available when monthly statistics for common moves and Speed are released. This format has just started; monthly statistics arrive after the month ends. Until then, select the previous regulation for analysis.</p></section>';
    return;
  }
  await loadToolData();
  if (revision !== routeRevision) return;
  const D = view.diag;
  const label = formatLabel(view.f);
  $('diag-asof').innerHTML = dots(esc(label), `Rating ${view.mo.default_cutoff}+ monthly statistics`, 'Public Showdown replays');
  const out = $('diag-out');
  if (!D) { out.innerHTML = '<section class="card c12"><p class="empty">No analysis data are available for this format.</p></section>'; return; }
  applySamples(['mine']);
  const team = TEAM.mine.filter(Boolean);
  if (!team.length) { out.innerHTML = '<section class="card c12"><p class="empty">Enter your six Pokémon.</p></section>' + sampleCard(['mine']); return; }
  const cards = [];

  // 1) 環境でよく使われる攻撃のタイプへの弱点
  const types = Object.entries(D.attack_types).slice(0, 10);
  const maxShare = Math.max(...types.map(([, v]) => v), 0.01);
  const concerns = types.filter(([t]) => {
    const weak = team.filter((k) => effect(t, typesOf(k)) >= 2).length;
    const res = team.filter((k) => effect(t, typesOf(k)) <= 0.5).length;
    return weak >= 3 || (weak >= 2 && res === 0);
  }).map(([t]) => TYPE_JA[t] || t);
  cards.push(`<section class="card c12 diag-overview"><div><h2>${team.length}-Pokémon team analysis</h2><p>Among the 10 most common attacking types in this metagame: ${concerns.length ? `<b>${concerns.length} types</b> have overlapping weaknesses.` : 'no types have overlapping weaknesses.'}</p><p class="note">Flags types hitting at least three members super effectively, or at least two with no teammate resisting or immune. Abilities and items are excluded.</p></div>${concerns.length ? `<div class="diag-concerns">${concerns.map((t) => `<span class="chip warn">${esc(t)}</span>`).join('')}</div>` : ''}</section>`);
  const trow = types.map(([t, share]) => {
    const weak = team.filter((k) => effect(t, typesOf(k)) >= 2).length;
    const res = team.filter((k) => effect(t, typesOf(k)) <= 0.5).length;
    const hole = weak >= 3 || (weak >= 2 && res === 0);
    const good = res >= 2 && weak === 0;
    return `<tr><td><span class="type t-${t.toLowerCase()}">${TYPE_JA[t] || t}</span></td>`
      + `<td style="text-align:left"><span class="share" style="width:${(share / maxShare * 80).toFixed(0)}px"></span>${pct(share, 0)}</td>`
      + `<td class="${weak >= 2 ? 'hole' : ''}">${weak}</td><td>${res}</td><td class="${hole ? 'hole' : good ? 'ok' : ''}">${hole ? 'Caution' : good ? 'Covered' : ''}</td></tr>`;
  }).join('');
  cards.push(`<section class="card c6"><h2>Weaknesses to common attacks</h2><table class="tt"><thead><tr><th>Attacking type</th><th style="text-align:left">Metagame share</th><th>Weak</th><th>Resists or immune</th><th></th></tr></thead><tbody>${trow}</tbody></table>`
    + '<p class="note">Metagame share = usage × move adoption (excluding status moves). Based on type matchups only; abilities and items are excluded.</p></section>');

  // 2) 上位のポケモンとの相性（リプレイの勝敗）
  const mu = [];
  for (const [b] of D.top) {
    if (team.includes(b)) continue;
    let g = 0, w = 0;
    for (const a of team) { const e = D.pairs[a]?.[b]; if (e) { g += e[0]; w += e[1]; } }
    if (g >= D.min_games) mu.push({ b, g, wr: (w + 5) / (g + 10) });
  }
  const li = (r) => `<li>${icon(r.b, 36)}<span>${esc(short(r.b))}</span><span><b>${pct(r.wr, 0)}</b> <small class="note">${r.g} battles</small></span></li>`;
  // 苦手は 50% 未満、得意は 50% 超だけ（相手が少ないとき同じポケモンが両方に出ないように）
  const worst = mu.filter((r) => r.wr < 0.5).sort((x, y) => x.wr - y.wr).slice(0, 5);
  const best = mu.filter((r) => r.wr > 0.5).sort((x, y) => y.wr - x.wr).slice(0, 5);
  const none = '<li class="note">None</li>';
  cards.push(`<section class="card c6"><h2>Matchups against leading Pokémon <span class="chip warn">Estimate</span></h2>`
    + (mu.length ? `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">Difficult (lower win rates)</div><ul class="mu">${worst.map(li).join('') || none}</ul></div>`
      + `<div class="c6"><div class="k">Favorable (higher win rates)</div><ul class="mu">${best.map(li).join('') || none}</ul></div></div>`
      + '<p class="note">Win rate of sides selecting a member of your team against sides selecting that Pokémon (public replays, shrunk toward 50%). Skill differences also affect these rates.</p>'
      : '<p class="empty">Not enough replays are available for this format yet.</p>')
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
    }).sort((x, y) => y[2] - x[2]).map((r) => r[3] || `<tr><td>${icon(r[0], 28)} ${esc(short(r[0]))}</td><td colspan="3" class="note">Insufficient data</td></tr>`).join('');
    cards.push(`<section class="card c6"><h2>Speed</h2><table class="tt"><thead><tr><th>Pokémon</th><th>Common Speed stat</th><th>Move first against the metagame</th><th>At maximum Speed</th></tr></thead><tbody>${srow}</tbody></table>`
      + `<p class="note">Compares common spread distributions to estimate the percentage of the usage-weighted metagame this Pokémon moves before (${esc(S.month)} · Rating ${S.cutoff}+). Items, abilities and field conditions are excluded. See individual Pokémon pages for detailed benchmarks.</p></section>`);
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
  cards.push(`<section class="card c6"><h2>Cores</h2>`
    + (bestCore ? `<p class="note" style="margin-top:0">Overlap with a current core: <b>${bestCore.ov.map((m) => esc(short(m))).join(' · ')}</b>.</p>`
      + `<div class="core">${bestCore.mem.slice(0, 6).map((m) => `<span>${icon(m, 28)}${esc(short(m))}</span>`).join('')}</div>`
      : '<p class="note" style="margin-top:0">This team has little overlap with common current cores.</p>')
    + (sug.length ? `<h2 class="sub">Common additions to this team</h2><ul class="mates">${sug.map(([b]) => `<li><a href="${linkTo({ v: 'poke', p: b })}">${icon(b, 48)}<span>${esc(short(b))}</span></a></li>`).join('')}</ul>` : '')
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
    cards.push(`<section class="card c6"><h2>Opposing selections against this team <span class="chip warn">Estimate</span></h2>`
      + (got.length
        ? `<p class="note" style="margin-top:0">Influence strength: ${strong.map(([k, s]) => `${esc(short(k))} <b>${(s * 100).toFixed(1)}pt</b>`).join(' · ')}`
          + `${team.length > got.length ? ` (insufficient samples for the others)` : ''}</p>`
          + (top.length ? `<div class="k">More likely opposing selections (only changes consistent with type matchups)</div><ul class="mu">${top.map(([n, [p, d, by]]) => `<li>${icon(n, 36)}<span>${esc(short(n))} <small class="note">${by.map((k) => esc(short(k))).join(' · ')} in team preview</small></span><span><b>+${(d * 100).toFixed(0)}pt</b> <small class="note">Overall ${pct(p, 0)}</small></span></li>`).join('')}</ul>` : '')
          + (top.length ? '' : '<p class="empty">No clear changes explainable by type matchups were found.</p>')
          + '<p class="note">For members with influence strength of at least 0.5 percentage points, shows only individually measured changes beyond random variation where <b>the opponent’s same-type attacks are super effective against that member</b> (excluding defenses from abilities such as Levitate).'
          + 'Individual comparisons are affected by other teammates, timing and player differences, so pairings unexplained by type matchups are omitted. These estimates do not model combined effects.</p>'
        : '<p class="empty">Not enough samples for the Pokémon on this team yet.</p>')
      + '</section>');
  }

  cards.push(sampleCard(['mine']));
  out.innerHTML = cards.join('');
}
// ── テーマ ──────────────────────────────────────────────
function setupTheme() {
  const btn = $('theme');
  const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const sync = () => { btn.textContent = isDark() ? '☀' : '◐'; btn.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme'); };
  const redraw = () => {
    if (!view) return;
    drawCharts();
    if (route.v === 'poke' && route.p) renderPoke(route.p);
  };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cm-en-theme', next); } catch (e) { /* 保存できなくても表示は切り替わる */ }
    sync();
    redraw();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) { sync(); redraw(); }
  });
  sync();
}

async function main() {
  setupTheme();
  try {
    [META, NAMES] = await Promise.all([getJSON('meta.json'), getJSON('names.json')]);
  } catch (e) {
    document.querySelector('.grid').innerHTML = `<p class="empty" role="alert">Unable to load data (${esc(e.message)}).<button type="button" id="retry-main">Reload</button></p>`;
    $('retry-main').addEventListener('click', () => location.reload());
    return;
  }
  renderPills();
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const svg = document.querySelector(`.views a[data-view="${a.dataset.view}"] svg`);
    if (svg) a.querySelector('b').replaceChildren(svg.cloneNode(true));
  });
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
  // Webフォントの読み込み後は、Canvas内の日本語も同じ書体で描き直す。
  const refreshChartFonts = () => document.querySelectorAll('canvas').forEach((canvas) => {
    window.Chart?.getChart(canvas)?.update('none');
  });
  document.fonts?.ready.then(refreshChartFonts);
  document.fonts?.addEventListener('loadingdone', refreshChartFonts);
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

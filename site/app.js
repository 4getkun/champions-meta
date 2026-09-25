// チャンピオンズ メタ — デザイン部。out/ の JSON（docs/DATA_CONTRACT.md）を読んで描くだけで、解析はしない。
// データの場所: 既定は ./data/（hub に置くとき out/ をここへ写す）。手元では ?data=../out/ で repo の out/ を読む。
'use strict';

const BASE = new URLSearchParams(location.search).get('data') || './data/';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
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
const short = (n) => ja(n).split('（')[0];
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
  return META.formats
    .filter((f) => f.months.length && f.months.at(-1) === latest)
    .sort((a, b) => rank(a) - rank(b) || a.bo3 - b.bo3);
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
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h && !h.includes('=')) return { f: h, v: 'env', p: null }; // 以前の #<ルール> の形
  const q = new URLSearchParams(h);
  return { f: q.get('f'), v: q.get('v') || 'env', p: q.get('p') };
}
function linkTo(next) {
  const r = { ...route, ...next };
  const q = new URLSearchParams();
  if (r.f) q.set('f', r.f);
  if (r.v && r.v !== 'env') q.set('v', r.v);
  if (r.v === 'poke' && r.p) q.set('p', r.p);
  return `#${q.toString()}`;
}
function go(next) { location.hash = linkTo(next).slice(1); }

function renderPills() {
  $('formats').innerHTML = currentFormats().map((f) => `<button class="pill" type="button" data-fmt="${esc(f.id)}" aria-pressed="false">${esc(formatLabel(f))}</button>`).join('');
  $('formats').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-fmt]');
    if (b) go({ f: b.dataset.fmt });
  });
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-view]');
    if (a) { ev.preventDefault(); go({ v: a.dataset.view, p: null }); window.scrollTo({ top: 0 }); return; }
    const j = ev.target.closest('[data-jump]');
    if (j) {
      ev.preventDefault();
      const jump = () => $(j.dataset.jump).scrollIntoView({ behavior: 'smooth' });
      if (j.dataset.jump === 'sec-about' || route.v === 'env') jump();
      else { go({ v: 'env', p: null }); setTimeout(jump, 300); }
    }
  });
}

async function load(fid) {
  const f = META.formats.find((x) => x.id === fid) || currentFormats()[0];
  if (view && view.f.id === f.id) return;
  const [mo, track, cores, weekly, detail] = await Promise.all([
    getJSON(`monthly/${f.id}.json`),
    getJSON(`tracks/${f.track}.json`),
    getJSON(`cores/${f.id}.json`).catch(() => null),
    f.replay_days ? getJSON(`weekly/${f.id}.json`).catch(() => null) : Promise.resolve(null),
    getJSON(`pokemon/${f.id}.json`).catch(() => null),
  ]);
  view = { f, mo, track, cores, weekly, detail, trend: view ? view.trend : 'usage' };
  renderEnv();
  renderRank();
  fillDatalist();
  useTeamFor(f);
  renderTeamInputs();
}

async function onRoute() {
  const r = readHash();
  route.f = r.f && META.formats.some((x) => x.id === r.f) ? r.f : currentFormats()[0].id;
  route.v = ['env', 'rank', 'poke', 'select', 'diag'].includes(r.v) ? r.v : 'env';
  route.p = r.p;
  await load(route.f);
  document.querySelectorAll('#formats .pill').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === route.f)));
  const shown = route.v === 'poke' && !route.p ? 'rank' : route.v;
  document.querySelectorAll('[data-view-panel]').forEach((m) => { m.hidden = m.dataset.viewPanel !== shown; });
  document.querySelectorAll('.views a, .tabbar a[data-view]').forEach((a) => {
    const cur = a.dataset.view === shown || (shown === 'poke' && a.dataset.view === 'rank');
    if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (shown === 'poke') renderPoke(route.p);
  if (shown === 'env') drawCharts();
  if (shown === 'select') await renderSelect();
  if (shown === 'diag') await renderDiag();
  phrase(document.querySelector(`[data-view-panel="${shown}"]`));
  const label = formatLabel(view.f);
  document.title = {
    poke: `${short(route.p || '')}の使用率・技・持ち物（${label}）— チャンピオンズ メタ`,
    rank: `使用率ランキング（${label}）— チャンピオンズ メタ`,
    select: `選出予想（${label}）— チャンピオンズ メタ`,
    diag: `チーム診断（${label}）— チャンピオンズ メタ`,
  }[shown] || `チャンピオンズ メタ（${label}）— 使用率・並び・選出率の推移`;
}

// ── 環境 ────────────────────────────────────────────────
function renderEnv() {
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
  const updated = META.generated_at.slice(5, 16).replace('-', '/').replace('T', ' ');

  $('asof').innerHTML = dots(`${y}年${+m}月`, esc(label), 'Showdown', `レート${cut}以上`, `更新 ${updated}`);
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

  const rec = weekly && weekly.available ? weekly.recent : null;
  $('bring-note').textContent = rec
    ? `Showdown に公開されたリプレイ 直近${rec.days}日 · ${rec.n_series.toLocaleString()} シリーズ / ${rec.n_games.toLocaleString()} 戦。Bo3 は 1 シリーズを 1 回と数えています。`
    : '';

  $('sources').innerHTML = '出典: ' + META.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.name)}</a>`).join(' / ');
  $('generated').textContent = `更新: ${META.generated_at.replace('T', ' ').slice(0, 16)}（毎日更新。Smogon の月次統計は毎月 3 日ごろ）`;
}

function drawCharts() {
  if (!view || $('view-env').hidden) return;
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
    + `<div><div class="nm">${esc(ja(g))}</div><div class="meta">${types}`
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
  if ($('p-induce')) loadInduce().then((ind) => { if ($('p-induce') && route.p === g) $('p-induce').innerHTML = induceCard(ind, g); });
}

// ── 選出誘導（src/cmeta/analysis/induce.py） ───────────────────────
async function loadInduce() {
  if (view.induce === undefined) view.induce = await getJSON(`induce/${view.f.id}.json`).catch(() => null);
  return view.induce;
}
function induceRow(r, which) {
  const [p, q] = r[which];
  return `<li>${icon(r.name, 36)}<span>${esc(short(r.name))}${r.clear ? ' <b class="clear" title="偶然の揺れ（95%）を超える変化">●</b>' : ''}`
    + `${r.type_ok ? ' <small class="note">相性どおり</small>' : ''}</span><span><b>${pct(p, 0)} → ${pct(q, 0)}</b> <small class="note">${r.n}回</small></span></li>`;
}
function induceCard(ind, g) {
  const head = '<h2>選出誘導 <span class="chip warn">参考値</span></h2>';
  const e = ind?.pokemon?.[g];
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
    + (e.strength.bring < 0.005 ? '。<b>偶然の揺れと区別できないくらい小さく</b>、下の変化もほとんどが揺れの範囲です。' : '') + '</p>'
    + `<div class="grid" style="margin-top:0;gap:12px"><div class="c6"><div class="k">相手が出しやすくなる</div><ul class="mu">${up.map((r) => induceRow(r, 'bring')).join('') || none}</ul></div>`
    + `<div class="c6"><div class="k">相手が出しにくくなる</div><ul class="mu">${down.map((r) => induceRow(r, 'bring')).join('') || none}</ul></div></div>`
    + (pairs.length ? `<div class="k" style="margin-top:10px">増える相手の先発の組</div><ul class="sets">${pairs.map((r) => `<li><span class="icons">${r.pair.map((k) => icon(k, 36)).join('')}</span><span>${r.pair.map((k) => esc(short(k))).join('・')}</span><b>${pct(r.share[0], 0)} → ${pct(r.share[1], 0)}</b></li>`).join('')}</ul>` : '')
    + '<p class="note">「全体での選出率 → このポケモンがいたときの選出率」。同じ見せ合いの繰り返しは 1 回と数え、件数の少ない変化は全体の率に寄せています。'
    + '●は偶然の揺れを超える変化、「相性どおり」はタイプ相性から予想される向きと合っているもの。腕前やチームの組み方の違いも混ざります。</p>';
}

// ── チームの入力（選出予想・チーム診断で共通） ───────────────────────
// 入れたチームは、この端末だけに保存する（次に開いたときのため）。保存できなくても使える
// シングルとダブルでチームは別（ダブルのチームをシングルのデータで見ないように）
const TEAMS = { singles: { opp: Array(6).fill(''), mine: Array(6).fill('') }, doubles: { opp: Array(6).fill(''), mine: Array(6).fill('') } };
try { const saved = JSON.parse(localStorage.getItem('cm-teams2') || '{}'); for (const k of Object.keys(TEAMS)) Object.assign(TEAMS[k], saved[k] || {}); } catch (e) { /* 保存がなくても動く */ }
let TEAM = TEAMS.singles;
const useTeamFor = (f) => { TEAM = TEAMS[f.game_type === 'doubles' ? 'doubles' : 'singles']; };
const saveTeams = () => { try { localStorage.setItem('cm-teams2', JSON.stringify(TEAMS)); } catch (e) { /* 保存できなくてもよい */ } };

let NAME_INDEX = null; // 入力の文字 → まとめた名前
function nameIndex() {
  if (NAME_INDEX) return NAME_INDEX;
  NAME_INDEX = new Map();
  for (const [k, v] of Object.entries(NAMES.pokemon)) {
    const g = v.group || k;
    for (const s of [k, g, v.ja, v.ja && v.ja.split('（')[0]]) if (s && !NAME_INDEX.has(norm(s))) NAME_INDEX.set(norm(s), g);
  }
  return NAME_INDEX;
}
const resolveName = (text) => (text ? nameIndex().get(norm(text.trim())) || null : null);

// Showdown の書き出し（「ニックネーム (種族) (M) @ 持ち物」など）から種族を取る
function parseShowdownTeam(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    let line = block.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) continue;
    line = line.replace(/\s+@.*$/, '').replace(/\s+\((M|F)\)\s*$/, '');
    const m = line.match(/\(([^()]+)\)\s*$/);
    const g = resolveName(m ? m[1] : line) || resolveName(line);
    if (g) out.push(g);
  }
  return out.slice(0, 6);
}

function fillDatalist() {
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
      + `<button type="button" data-paste="${role}">Showdown のチームを貼り付け</button><button type="button" data-clear="${role}">消す</button></div>`;
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
    const p = ev.target.closest('[data-paste]');
    if (p) {
      const box = p.closest('.team-in');
      let ta = box.querySelector('textarea');
      if (ta) { ta.remove(); return; }
      ta = document.createElement('textarea');
      ta.placeholder = 'Showdown の「Export」のテキストを貼り付けてください';
      ta.addEventListener('input', () => {
        const got = parseShowdownTeam(ta.value);
        if (got.length) { TEAM[p.dataset.paste].splice(0, 6, ...got, ...Array(6 - got.length).fill('')); onTeamChanged(); }
      });
      box.appendChild(ta);
      ta.focus();
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
function selRate(e, which, prior) {
  if (!e) return prior;
  const [n, hit] = which === 'bring' ? [e[0], e[1]] : [e[2], e[3]];
  return (hit + SEL.m * prior) / (n + SEL.m);
}
// メガストーンを持つ確率が高いポケモンは、メガの姿のタイプで相性を見る
const selTypes = (k) => SEL.roles[k]?.types || typesOf(k);
const selSpeed = (k) => SEL.roles[k]?.speed || 80;

// opp: 名前の配列、または [名前, 重み] の配列（自分のチームが分からないときの平均的な相手。重みの合計 6）
function selMember(k, opp) {
  const oppW = opp.length && typeof opp[0] === 'string' ? opp.map((u) => [u, 1]) : opp;
  const pb = selRate(SEL.base[k], 'bring', SEL.g_bring);
  const pl = selRate(SEL.base[k], 'lead', SEL.g_lead);
  const lk = logitP(pb);
  const vsk = SEL.vs[k] || {};
  let vs = 0;
  for (const [u, w] of [...oppW].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (vsk[u]) vs += w * (logitP(selRate(vsk[u], 'bring', pb)) - lk);
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
  const f = view.f;
  if (!DEX) DEX = await getJSON('dex.json');
  if (!view.sel) view.sel = f.replay_days ? await getJSON(`select/${f.id}.json`).catch(() => null) : null;
  if (!view.diag) view.diag = await getJSON(`diag/${f.id}.json`).catch(() => null);
}

let SEEN_LEADS = new Set(); // 先発に出たポケモン（押して選ぶ）
const selSlot = (p) => (p >= 0.8 ? ['fix', 'ほぼ出す'] : p <= 0.3 ? ['bench', '出にくい'] : ['flex', '相手しだい']);

async function renderSelect() {
  await loadToolData();
  SEL = view.sel;
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
  const evalTxt = `<b>答え合わせ</b>（予想に使っていない ${day(ev.test_from)} 以降の ${ev.test.toLocaleString()} 試合）<br>`
    + `・選出: 予想の上位 ${kb} 匹のうち実際に出たのは平均 <b>${n2(ev.bring.model, kb)} 匹</b>（全体の選出率だけ ${n2(ev.bring.baseline, kb)} 匹、でたらめ ${n2(ev.bring.random, kb)} 匹）${sig(ev.bring)}<br>`
    + `・先発: 上位 ${kl} 匹のうち平均 ${n2(ev.lead.model, kl)} 匹（全体だけ ${n2(ev.lead.baseline, kl)} 匹）${sig(ev.lead)}<br>`
    + `・先発を見たあとの残り: 上位 ${kb - kl} 匹のうち平均 ${n2(ev.back.model, kb - kl)} 匹（全体だけ ${n2(ev.back.baseline, kb - kl)} 匹）${sig(ev.back)}<br>`
    + `・${kl === 2 ? '先発の組' : '先発'}の上位 3 に実際の先発が入った: ${pct(ev.lead_set_top3.model, 0)}`
    + `・確率の当てはまり（対数尤度）: 全体だけより ${ev.loglik.diff >= 0 ? '+' : ''}${ev.loglik.diff.toFixed(3)} ${sig(ev.loglik)}`;
  const mode = SEL.usable
    ? `確率は相性（タイプ・メガシンカ後のタイプ）・役割（天候・${kl === 2 ? 'ねこだまし・いかく・トリックルームなど' : '設置技・きあいのタスキなど'}）・実績から計算しています。`
      + ' 選出は相手を見て変える読み合いの部分が大きく、ぴったり当てるのは難しい予想です。確率が高くない枠は「相手しだい」と考えてください。'
    : 'このルールでは、予想の確率が全体の率だけより良くならなかったため、<b>全体の選出率・先発率</b>から計算しています。';
  const unknown = mine.length === 6 ? '' : `<br>自分の 6 匹を入れると、あなたのチームとの相性も考えます（いまは環境の平均的な相手として計算。答え合わせでは選出 ${n2(ev.bring.unknown_opp, kb)} 匹）。`;
  out.innerHTML = `<h2>相手の選出 <span class="chip warn">参考値</span></h2>`
    + '<p class="note" style="margin-top:0">相手の先発が出たら「先発に出た」を押すと、残りの選出の確率に切り替わります。</p>'
    + `<ul class="pred">${rows}</ul>`
    + `<div class="grid" style="gap:12px;margin-top:14px"><div class="c6"><div class="k">${kl === 2 ? '先発の組' : '先発'}の候補</div><ul class="sets">${setList(leadSets)}</ul></div>`
    + `<div class="c6"><div class="k">選出の組の候補${seen ? '（先発を見たあと）' : ''}</div><ul class="sets">${setList(bringSets)}</ul></div></div>`
    + `<div class="evalbox">${mode}${unknown}<br>${evalTxt}</div>`;
  out.querySelectorAll('[data-seen]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.seen;
    if (SEEN_LEADS.has(k)) SEEN_LEADS.delete(k);
    else { if (SEEN_LEADS.size >= kl) SEEN_LEADS.clear(); SEEN_LEADS.add(k); }
    renderSelect();
  }));
}

// ── チーム診断 ───────────────────────────────────────────
async function renderDiag() {
  await loadToolData();
  const D = view.diag;
  const label = formatLabel(view.f);
  $('diag-asof').innerHTML = dots(esc(label), `レート${view.mo.default_cutoff}以上の月次統計`, 'Showdown の公開リプレイ');
  const team = TEAM.mine.filter(Boolean);
  const out = $('diag-out');
  if (!team.length) { out.innerHTML = '<section class="card c12"><p class="empty">自分の 6 匹を入れてください。</p></section>'; return; }
  if (!D) { out.innerHTML = '<section class="card c12"><p class="empty">このルールは診断の材料がありません。</p></section>'; return; }
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

  // 3) すばやさ（種族値）
  const top20 = D.top.slice(0, 20).map(([k]) => k).filter((k) => !team.includes(k));
  const spe = (k) => poke(k).base_stats?.spe;
  const srow = [...team].sort((a, b) => (spe(b) ?? 0) - (spe(a) ?? 0)).map((k) => {
    const s = spe(k);
    const faster = s == null ? 0 : top20.filter((o) => (spe(o) ?? 999) < s).length;
    return `<tr><td>${icon(k, 28)} ${esc(short(k))}</td><td>${s ?? '—'}</td><td>${faster} / ${top20.length}</td></tr>`;
  }).join('');
  cards.push(`<section class="card c6"><h2>すばやさ</h2><table class="tt"><thead><tr><th>ポケモン</th><th>種族値</th><th>上位 20 匹より速い数</th></tr></thead><tbody>${srow}</tbody></table>`
    + '<p class="note">種族値だけで比べています（能力ポイント・性格・持ち物・メガシンカは考えていません）。</p></section>');

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
    for (const k of got.filter((x) => ind.pokemon[x].strength.bring >= 0.005)) {
      for (const r of ind.pokemon[k].up) {
        if (team.includes(r.name) || r.bring[1] <= r.bring[0]) continue;
        const e = up.get(r.name) || [r.bring[0], 0, []];
        e[1] = Math.max(e[1], r.bring[1] - r.bring[0]);
        e[2].push(k);
        up.set(r.name, e);
      }
    }
    const top = [...up.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 6);
    const strong = got.map((k) => [k, ind.pokemon[k].strength.bring]).sort((a, b) => b[1] - a[1]);
    cards.push(`<section class="card c6"><h2>このチームを見た相手の選出 <span class="chip warn">参考値</span></h2>`
      + (got.length
        ? `<p class="note" style="margin-top:0">誘導の強さ: ${strong.map(([k, s]) => `${esc(short(k))} <b>${(s * 100).toFixed(1)}pt</b>`).join('・')}`
          + `${team.length > got.length ? `（ほかは件数不足）` : ''}</p>`
          + (top.length ? `<div class="k">相手が出しやすくなる</div><ul class="mu">${top.map(([n, [p, d, by]]) => `<li>${icon(n, 36)}<span>${esc(short(n))} <small class="note">${by.map((k) => esc(short(k))).join('・')}を見て</small></span><span><b>+${(d * 100).toFixed(0)}pt</b> <small class="note">全体 ${pct(p, 0)}</small></span></li>`).join('')}</ul>` : '')
          + '<p class="note">誘導の強さが 0.5pt 以上のメンバーについて、1 匹ずつ調べた変化のうち一番大きいもの（組み合わせの効果は考えていない目安）。0pt 近くのメンバーは、見せても相手の選出がほとんど変わりません。詳しくは各ポケモンのページ。</p>'
        : '<p class="empty">このチームのポケモンは、まだ件数が足りません。</p>')
      + '</section>');
  }

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
    document.querySelector('.grid').innerHTML = `<p class="empty">データを読めませんでした（${esc(e.message)}）。</p>`;
    return;
  }
  renderPills();
  setupTeamInputs();
  normalizeTeams();
  renderTeamInputs();
  phrase($('sec-about'));
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
    t = setTimeout(() => { drawCharts(); if (route.v === 'poke' && route.p) renderPoke(route.p); }, 150);
  });
}

main();

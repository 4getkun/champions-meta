/* チャンピオンズ メタのグラフ。Chart.jsの後に読み込む。 */
(() => {
  'use strict';

  const instances = new WeakMap();
  const owners = new Set();
  const palette = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];
  const colors = ['#2563eb', '#0d9488', '#d97706', '#8b5cf6', '#e11d48', '#64748b'];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const pct = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
    ? '—' : `${(Number(value) * 100).toFixed(digits)}%`;
  const monthLabel = (month) => {
    const [year, m] = String(month).split('-');
    return `${year}年${Number(m)}月`;
  };

  function color(el, key, fallback) {
    return getComputedStyle(el).getPropertyValue(key).trim() || fallback;
  }

  function clear(el) {
    const old = instances.get(el);
    if (old) {
      old.chart?.destroy();
      old.wrapper.remove();
      instances.delete(el);
      owners.delete(el);
    }
  }

  function shell(el, label, tableHtml) {
    clear(el);
    const wrapper = document.createElement('div');
    wrapper.className = 'meta-chart-wrap';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    wrapper.append(canvas);
    const details = document.createElement('details');
    details.className = 'meta-chart-data';
    details.innerHTML = `<summary>表で見る</summary>${tableHtml}`;
    el.replaceChildren(wrapper, details);
    return { wrapper, canvas };
  }

  function chartBase(el) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // 遅延更新を残すと、画面遷移で破棄した後のCanvasに更新が走るため即時にする。
      resizeDelay: 0,
      layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
      plugins: {
        legend: { position: 'bottom', labels: { color: color(el, '--sub', '#504a63'), usePointStyle: true, boxWidth: 8, padding: 14 } },
        tooltip: {
          backgroundColor: color(el, '--card', '#fff'),
          titleColor: color(el, '--ink', '#211d32'),
          bodyColor: color(el, '--sub', '#504a63'),
          borderColor: color(el, '--line', '#e7e3ef'), borderWidth: 1, padding: 10,
        },
      },
      scales: {
        x: { ticks: { color: color(el, '--sub', '#504a63'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: color(el, '--sub', '#504a63'), callback: (v) => pct(v, 0) }, grid: { color: color(el, '--line', '#e7e3ef') }, beginAtZero: true },
      },
    };
  }

  function trend(el, track, { name = (id) => id, short = (id) => id } = {}) {
    if (!el || !track?.months || !track.usage_grouped) return [];
    const months = track.months;
    const usage = track.usage_grouped;
    const latest = (key) => usage[key]?.[months.length - 1] ?? 0;
    const top = Object.keys(usage).sort((a, b) => latest(b) - latest(a)).slice(0, 6);
    const rows = top.map((key) => `<tr><th scope="row">${esc(name(key))}</th>${months.map((_, i) => `<td>${pct(usage[key]?.[i])}</td>`).join('')}</tr>`).join('');
    const head = months.map((m) => `<th scope="col">${esc(monthLabel(m))}</th>`).join('');
    const table = `<div class="meta-chart-table-wrap"><table class="meta-chart-table"><thead><tr><th>ポケモン</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const { canvas, wrapper } = shell(el, '使用率の推移（最新月の上位6匹）', table);

    if (!months.length || !top.length) {
      wrapper.remove();
      el.querySelector('details')?.remove();
      el.insertAdjacentHTML('afterbegin', '<p class="empty">表示できる使用率データがありません。</p>');
      return top;
    }

    const cuts = [];
    for (let i = 1; i < (track.segments || []).length; i++) {
      if (track.segments[i]?.regulation !== track.segments[i - 1]?.regulation) cuts.push(i);
    }
    const boundaryPlugin = {
      id: 'metaRegulationBoundaries',
      afterDatasetsDraw(chart) {
        if (!cuts.length) return;
        const { ctx, chartArea, scales: { x } } = chart;
        if (!chartArea || !x) return;
        ctx.save();
        ctx.strokeStyle = color(el, '--sub', '#504a63');
        ctx.fillStyle = color(el, '--sub', '#504a63');
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.font = '11px system-ui, sans-serif';
        for (const cut of cuts) {
          const left = x.getPixelForTick(cut - 1), right = x.getPixelForTick(cut);
          const at = (left + right) / 2;
          ctx.beginPath(); ctx.moveTo(at, chartArea.top); ctx.lineTo(at, chartArea.bottom); ctx.stroke();
          const before = track.segments[cut - 1]?.regulation || '';
          const after = track.segments[cut]?.regulation || '';
          ctx.setLineDash([]);
          ctx.fillText(`${before} → ${after}`, Math.min(at + 4, chartArea.right - 90), chartArea.top + 12);
          ctx.setLineDash([4, 4]);
        }
        ctx.restore();
      },
    };
    const base = chartBase(el);
    base.plugins.tooltip.callbacks = {
      title(items) {
        const i = items[0]?.dataIndex ?? 0;
        return `${monthLabel(months[i])}（${track.segments?.[i]?.regulation || 'レギュレーション不明'}）`;
      },
      label(item) { return `${short(item.dataset.pokemon)}: ${pct(item.parsed.y)}`; },
    };
    base.scales.y.suggestedMax = Math.max(0.1, Math.ceil(Math.max(...top.flatMap((k) => usage[k] || []).map((v) => v || 0)) * 10) / 10);
    const datasets = top.map((key, index) => ({
      label: name(key), pokemon: key,
      data: months.map((_, i) => usage[key]?.[i] ?? null),
      borderColor: color(el, palette[index], colors[index]),
      backgroundColor: color(el, palette[index], colors[index]),
      borderWidth: index === 0 ? 3 : 2,
      pointRadius: months.length > 20 ? 0 : 2,
      pointHoverRadius: 5,
      tension: 0.2,
      segment: {
        borderColor(context) {
          const i = context.p1DataIndex;
          return cuts.includes(i) ? 'transparent' : color(el, palette[index], colors[index]);
        },
      },
      spanGaps: false,
    }));
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line', plugins: [boundaryPlugin],
      data: { labels: months.map(monthLabel), datasets },
      options: { ...base, interaction: { mode: 'index', intersect: false }, scales: { ...base.scales, y: { ...base.scales.y, min: 0, suggestedMax: base.scales.y.suggestedMax } } },
    });
    instances.set(el, { chart, wrapper });
    owners.add(el);
    return top;
  }

  function scatter(el, weekly, { name = (id) => id, short = (id) => id, link = () => {}, href = null } = {}) {
    const pokemon = weekly?.available && weekly?.recent?.pokemon;
    if (!el || !pokemon) return [];
    const points = Object.entries(pokemon).filter(([, v]) => v.usage != null && v.bring != null)
      .sort((a, b) => b[1].usage - a[1].usage).slice(0, 18);
    const tableRows = points.map(([key, v]) => `<tr><th scope="row">${href ? `<a href="${esc(href(key))}">${esc(name(key))}</a>` : esc(name(key))}</th><td>${pct(v.usage)}</td><td>${v.teams ?? '—'}</td><td>${pct(v.bring, 0)}</td><td>${pct(v.bring_ci?.[0], 0)}〜${pct(v.bring_ci?.[1], 0)}</td><td>${v.games ?? '—'}</td></tr>`).join('');
    const table = `<div class="meta-chart-table-wrap"><table class="meta-chart-table"><thead><tr><th>ポケモン</th><th>使用率</th><th>見せ合い数</th><th>選出率</th><th>95%範囲</th><th>試合数</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
    const { canvas, wrapper } = shell(el, '見せ合いの使用率と選出率（使用率上位18匹）', table);
    if (!points.length) {
      wrapper.remove();
      el.querySelector('details')?.remove();
      el.insertAdjacentHTML('afterbegin', '<p class="empty">このルールはリプレイがまだ足りません。</p>');
      return [];
    }
    const base = chartBase(el);
    base.scales.x = { type: 'linear', title: { display: true, text: '使用率', color: color(el, '--sub', '#504a63') }, ticks: { color: color(el, '--sub', '#504a63'), callback: (v) => pct(v, 0) }, grid: { color: color(el, '--line', '#e7e3ef') } };
    base.scales.y = { min: 0, max: 1, title: { display: true, text: '選出率', color: color(el, '--sub', '#504a63') }, ticks: { color: color(el, '--sub', '#504a63'), callback: (v) => pct(v, 0) }, grid: { color: color(el, '--line', '#e7e3ef') } };
    base.plugins.legend = { display: false };
    base.plugins.tooltip.callbacks = {
      title(items) { return name(points[items[0]?.dataIndex]?.[0] || ''); },
      label(item) {
        const v = points[item.dataIndex]?.[1];
        return [
          `使用率 ${pct(v?.usage)}（${v?.teams ?? '—'} チーム）`,
          `選出率 ${pct(v?.bring, 0)}（${pct(v?.bring_ci?.[0], 0)}〜${pct(v?.bring_ci?.[1], 0)}）`,
          ...(v?.games ? [`選出時の勝率 ${pct(v.win_shrunk, 0)}（${v.games} 戦）`] : []),
        ];
      },
    };
    const pointLabels = {
      id: 'metaScatterLabels',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const area = chart.chartArea;
        if (!area || !meta?.data?.length) return;
        const ctx = chart.ctx;
        const occupied = [];
        ctx.save();
        ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
        ctx.font = '12px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < Math.min(6, points.length); i++) {
          const element = meta.data[i];
          if (!element) continue;
          const { x, y } = element.getProps(['x', 'y'], true);
          const text = String(short(points[i][0]));
          const width = ctx.measureText(text).width + 12;
          const height = 20;
          const candidates = [
            [x + 9, y - height - 3], [x - width - 9, y - height - 3],
            [x + 9, y + 3], [x - width - 9, y + 3],
          ];
          const rect = candidates.map(([left, top]) => ({ left, top, right: left + width, bottom: top + height }))
            .find((r) => r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom
              && occupied.every((o) => r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom));
          if (!rect) continue;
          occupied.push(rect);
          ctx.fillStyle = color(el, '--card', '#fff');
          ctx.fillRect(rect.left, rect.top, width, height);
          ctx.strokeStyle = color(el, '--line', '#e7e3ef');
          ctx.strokeRect(rect.left, rect.top, width, height);
          ctx.fillStyle = color(el, '--ink', '#211d32');
          ctx.fillText(text, rect.left + 6, rect.top + height / 2);
        }
        ctx.restore();
      },
    };
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'scatter', plugins: [pointLabels],
      data: { datasets: [{
        data: points.map(([, v]) => ({ x: v.usage, y: v.bring })),
        backgroundColor: color(el, '--chart-1', colors[0]),
        borderColor: color(el, '--card', '#fff'), borderWidth: 2,
        pointRadius: 6, pointHoverRadius: 9,
      }] },
      options: {
        ...base,
        onClick(_event, elements) {
          const point = elements[0];
          if (point) link(points[point.index][0]);
        },
      },
    });
    instances.set(el, { chart, wrapper });
    owners.add(el);
    return points.map(([key]) => key);
  }

  function destroy(el) { if (el) clear(el); }
  function destroyAll() { for (const el of owners) clear(el); }

  window.MetaCharts = { trend, scatter, destroy, destroyAll };
})();
